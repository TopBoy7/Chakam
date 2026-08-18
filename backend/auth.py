"""Authentication: email classification, one-time codes, and JWT issuing/verification.

Deliberately kept free of heavy imports (cv2, face_recognition, ultralytics) so
both main.py (heavy) and main-light.py (light) can import it — the light backend
does not install the heavy dependencies.
"""
import hashlib
import hmac
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import jwt
from fastapi import Depends, Header, HTTPException, status

import database
import env
import models


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# Any logged-in, non-pending role — used for routes that require "any active
# user" per the §8 protection matrix.
ACTIVE_ROLES = ("student", "lecturer", "admin")


def normalize_email(email: str) -> str:
    return email.strip().lower()


# -------------------------------------------------------
# EMAIL CLASSIFICATION
# -------------------------------------------------------
_STUDENT_EMAIL_RE = re.compile(
    r"^(\d{" + str(env.MATRIC_DIGITS) + r"})@" + re.escape(env.STUDENT_EMAIL_DOMAIN) + r"$"
)
_STAFF_EMAIL_RE = re.compile(
    r"^[a-z][a-z0-9._-]*@" + re.escape(env.STAFF_EMAIL_DOMAIN) + r"$"
)


async def classify_email(email: str) -> Optional[Tuple[str, Optional[str], Optional[str]]]:
    """Implements the ordered classification table (auth_design.txt §3.2/§3.4).
    Returns (role, matricNumber, staffId) or None if the address matches neither
    pattern and isn't a bootstrap admin — callers should reject with 403 on None.

    Async (rather than a pure table lookup) because the lecturer-linking step
    requires a database call between the admin check and the student-pattern
    check.
    """
    if email in env.ADMIN_EMAILS:
        return "admin", None, None

    lecturer = await database.get_lecturer_by_email(email)
    if lecturer:
        return "lecturer", None, lecturer.staffId

    student_match = _STUDENT_EMAIL_RE.match(email)
    if student_match:
        return "student", student_match.group(1), None

    if _STAFF_EMAIL_RE.match(email):
        return "pending", None, None

    return None


# -------------------------------------------------------
# ONE-TIME CODES
# -------------------------------------------------------
def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def verify_code(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_code(code), code_hash)


# -------------------------------------------------------
# JWT
# -------------------------------------------------------
def create_token(user: models.User) -> str:
    ttl_hours = env.ADMIN_TOKEN_TTL_HOURS if user.role == "admin" else env.TOKEN_TTL_HOURS
    now = utcnow()
    claims = {
        "sub": user.email,
        "role": user.role,
        "matricNumber": user.matricNumber,
        "staffId": user.staffId,
        "iat": now,
        "exp": now + timedelta(hours=ttl_hours),
    }
    return jwt.encode(claims, env.JWT_SECRET, algorithm="HS256")


def decode_token(token: str) -> Dict:
    try:
        return jwt.decode(token, env.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")


# -------------------------------------------------------
# DEPENDENCIES
# -------------------------------------------------------
async def get_current_user(authorization: Optional[str] = Header(None)) -> models.User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")

    token = authorization.split(" ", 1)[1].strip()
    claims = decode_token(token)

    # Role is re-read from the database on every request, never trusted from the
    # token claim — a promotion or suspension takes effect immediately rather
    # than waiting for the token to expire.
    user = await database.get_user_by_email(claims.get("sub", ""))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    if user.status == "suspended":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account suspended")

    return user


def require_role(*roles: str):
    async def dependency(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        return user

    return dependency


def assert_course_access(course: models.Course, user: models.User) -> None:
    """Raise 403 unless the user is admin or the lecturer assigned to this
    course. A course with no lecturerId is admin-only — null must fail closed,
    not match a lecturer whose own staffId also happens to be None."""
    if user.role == "admin":
        return
    if course.lecturerId is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "course has no assigned lecturer")
    if user.role != "lecturer" or user.staffId != course.lecturerId:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the lecturer for this course")


async def assert_session_access(session: models.Session, user: models.User) -> None:
    """Same rule as assert_course_access, resolved from a Session's courseCode.
    Fails closed (admin-only) if the course was deleted out from under a
    session that still references it — there is no owner to check against."""
    course = await database.get_course_by_courseCode(session.courseCode)
    if course:
        assert_course_access(course, user)
    elif user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the lecturer for this course")


async def require_self_or_admin(
    matricNumber: str, user: models.User = Depends(get_current_user)
) -> models.User:
    """For routes with a {matricNumber} path parameter — usable directly as a
    Depends() without a factory call, e.g. Depends(require_self_or_admin).
    Not yet wired into any route in Phase 1; the identity-dependent flows that
    use it (student portal, student lookup) are Phase 4."""
    if user.role != "admin" and user.matricNumber != matricNumber:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    return user


# -------------------------------------------------------
# RATE LIMITING
# -------------------------------------------------------
# In-memory, per-process dicts. This is acceptable for a single-worker
# deployment only — it does NOT survive a restart, does NOT synchronise across
# multiple uvicorn workers, and (specific to this repo) does NOT synchronise
# between the two independently-running backend processes (main.py and
# main-light.py both register these routes and each keeps its own counters).
# A caller could in principle get 3 attempts against one process and 3 more
# against the other. Fixing that needs a shared store (e.g. Redis) that this
# stack does not currently have.
_code_requests_by_email: Dict[str, List[float]] = {}
_code_requests_by_ip: Dict[str, List[float]] = {}

_EMAIL_LIMIT, _EMAIL_WINDOW_SECONDS = 3, 15 * 60
_IP_LIMIT, _IP_WINDOW_SECONDS = 10, 15 * 60


def _check_and_record(bucket: Dict[str, List[float]], key: str, limit: int, window_seconds: int) -> bool:
    """Returns True if the request is allowed (and records it), False if rate limited."""
    now = time.monotonic()
    timestamps = [t for t in bucket.get(key, []) if now - t < window_seconds]
    if len(timestamps) >= limit:
        bucket[key] = timestamps
        return False
    timestamps.append(now)
    bucket[key] = timestamps
    return True


def check_request_code_rate_limit(email: str, ip: str) -> None:
    if not _check_and_record(_code_requests_by_email, email, _EMAIL_LIMIT, _EMAIL_WINDOW_SECONDS):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many code requests, try again later")
    if not _check_and_record(_code_requests_by_ip, ip, _IP_LIMIT, _IP_WINDOW_SECONDS):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many code requests, try again later")


MAX_VERIFY_ATTEMPTS = 5
LOGIN_CODE_TTL_MINUTES = env.LOGIN_CODE_TTL_MINUTES
