from datetime import datetime, timezone
from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Union, List, Dict, Optional
import secrets

import env, models


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


client = AsyncIOMotorClient(env.MONGO_URI, tls=True, tlsAllowInvalidCertificates=True)
db = client["smartclassDB"]


def throw_mongo_error() -> None:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="This is most likely a MongoDB connection error. Check connection and try again.",
    )


# -------------------------------------------------------
# CLASSROOMS
# -------------------------------------------------------
async def add_classroom(classroom: models.Classroom) -> str:
    try:
        now = datetime.now()
        payload = classroom.model_dump()
        payload.update({"created_at": now, "updated_at": now})
        result = await db.classrooms.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_classroom_by_classId(classId: str) -> Union[models.Classroom, None]:
    try:
        doc = await db.classrooms.find_one({"classId": classId})
        return models.Classroom(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_classrooms() -> List[models.Classroom]:
    try:
        cursor = db.classrooms.find({})
        docs = await cursor.to_list(length=1000)
        return [models.Classroom(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def update_classroom_by_classId(classId: str, payload: Dict) -> Union[models.Classroom, None]:
    try:
        payload.update({"updated_at": datetime.now()})
        result = await db.classrooms.find_one_and_update(
            {"classId": classId}, {"$set": payload}, return_document=True
        )
        return models.Classroom(**result) if result else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def delete_classroom_by_classId(classId: str) -> bool:
    try:
        res = await db.classrooms.delete_one({"classId": classId})
        return res.deleted_count == 1
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# LECTURERS
# -------------------------------------------------------
async def add_lecturer(lecturer: models.Lecturer) -> str:
    try:
        payload = lecturer.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.lecturers.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_lecturer_by_staffId(staffId: str) -> Union[models.Lecturer, None]:
    try:
        doc = await db.lecturers.find_one({"staffId": staffId})
        return models.Lecturer(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_lecturers() -> List[models.Lecturer]:
    try:
        docs = await db.lecturers.find({}).to_list(length=1000)
        return [models.Lecturer(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def delete_lecturer_by_staffId(staffId: str) -> bool:
    try:
        res = await db.lecturers.delete_one({"staffId": staffId})
        return res.deleted_count == 1
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_lecturer_by_email(email: str) -> Union[models.Lecturer, None]:
    """Used by auth's automatic lecturer linking (a staff address that matches an
    existing lecturer document is promoted to role 'lecturer' on first login)."""
    try:
        doc = await db.lecturers.find_one({"email": email})
        return models.Lecturer(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# COURSES
# -------------------------------------------------------
async def add_course(course: models.Course) -> str:
    try:
        payload = course.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.courses.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_course_by_courseCode(courseCode: str) -> Union[models.Course, None]:
    try:
        doc = await db.courses.find_one({"courseCode": courseCode})
        return models.Course(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_courses(lecturerId: Optional[str] = None) -> List[models.Course]:
    try:
        query = {"lecturerId": lecturerId} if lecturerId else {}
        docs = await db.courses.find(query).to_list(length=1000)
        return [models.Course(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def update_course_by_courseCode(courseCode: str, payload: Dict) -> Union[models.Course, None]:
    try:
        result = await db.courses.find_one_and_update(
            {"courseCode": courseCode}, {"$set": payload}, return_document=True
        )
        return models.Course(**result) if result else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def delete_course_by_courseCode(courseCode: str) -> bool:
    try:
        res = await db.courses.delete_one({"courseCode": courseCode})
        return res.deleted_count == 1
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# STUDENTS
# -------------------------------------------------------
async def add_student(student: models.Student) -> str:
    try:
        payload = student.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.students.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_student_by_matric(matricNumber: str) -> Union[models.Student, None]:
    try:
        doc = await db.students.find_one({"matricNumber": matricNumber})
        return models.Student(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_students() -> List[models.Student]:
    try:
        docs = await db.students.find({}).to_list(length=5000)
        return [models.Student(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def delete_student_embeddings(matricNumber: str) -> bool:
    """Wipe stored face vectors when a student withdraws biometric consent."""
    try:
        result = await db.students.find_one_and_update(
            {"matricNumber": matricNumber},
            {"$set": {"embeddings": [], "embeddingsDeleted": True}},
            return_document=True,
        )
        return result is not None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_students_for_recognition(matric_numbers: List[str]) -> List[Dict]:
    """Return raw dicts with embeddings for a list of matric numbers.
    Only returns students where embeddingsDeleted is False and embeddings exist.
    Called during the face recognition pipeline — returns dicts, not Pydantic models,
    because numpy needs the raw lists directly."""
    try:
        docs = await db.students.find(
            {
                "matricNumber": {"$in": matric_numbers},
                "embeddingsDeleted": {"$ne": True},
                "embeddings": {"$exists": True, "$ne": []},
            },
            {"matricNumber": 1, "fullName": 1, "embeddings": 1},
        ).to_list(length=5000)
        return docs
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# ENROLLMENTS
# -------------------------------------------------------
async def add_enrollment(enrollment: models.Enrollment) -> str:
    try:
        payload = enrollment.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.enrollments.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_enrollment(courseCode: str, matricNumber: str) -> Union[models.Enrollment, None]:
    try:
        doc = await db.enrollments.find_one(
            {"courseCode": courseCode, "matricNumber": matricNumber}
        )
        return models.Enrollment(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_enrollments_by_course(courseCode: str) -> List[models.Enrollment]:
    try:
        docs = await db.enrollments.find({"courseCode": courseCode}).to_list(length=5000)
        return [models.Enrollment(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_enrollments_by_student(matricNumber: str) -> List[models.Enrollment]:
    try:
        docs = await db.enrollments.find({"matricNumber": matricNumber}).to_list(length=1000)
        return [models.Enrollment(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def delete_enrollment(courseCode: str, matricNumber: str) -> bool:
    try:
        res = await db.enrollments.delete_one(
            {"courseCode": courseCode, "matricNumber": matricNumber}
        )
        return res.deleted_count == 1
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# SESSIONS
# -------------------------------------------------------
async def add_session(session: models.Session) -> str:
    try:
        payload = session.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.sessions.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_session_by_sessionId(sessionId: str) -> Union[models.Session, None]:
    try:
        doc = await db.sessions.find_one({"sessionId": sessionId})
        return models.Session(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_active_session_by_classId(classId: str) -> Union[models.Session, None]:
    """Returns the currently active session for a classroom, or None."""
    try:
        doc = await db.sessions.find_one({"classId": classId, "status": "active"})
        return models.Session(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_sessions(
    classId: Optional[str] = None,
    courseCode: Optional[str] = None,
    status: Optional[str] = None,
) -> List[models.Session]:
    try:
        query: Dict = {}
        if classId:
            query["classId"] = classId
        if courseCode:
            query["courseCode"] = courseCode
        if status:
            query["status"] = status
        docs = await db.sessions.find(query).sort("startedAt", -1).to_list(length=1000)
        return [models.Session(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def end_session(sessionId: str) -> Union[models.Session, None]:
    try:
        result = await db.sessions.find_one_and_update(
            {"sessionId": sessionId, "status": "active"},
            {"$set": {"status": "ended", "endedAt": datetime.now()}},
            return_document=True,
        )
        return models.Session(**result) if result else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def mark_attendance(
    sessionId: str, matricNumber: str, fullName: str, method: str = "auto"
) -> bool:
    """Add or update an attendance entry.
    Auto entries are updated in place.
    Manual (manuallyOverridden=True) entries are never overwritten by auto."""
    try:
        # Try to update an existing non-overridden entry for this student.
        result = await db.sessions.update_one(
            {
                "sessionId": sessionId,
                "attendees": {
                    "$elemMatch": {
                        "matricNumber": matricNumber,
                        "manuallyOverridden": False,
                    }
                },
            },
            {"$set": {"attendees.$.markedAt": datetime.now(), "attendees.$.method": method}},
        )

        if result.matched_count > 0:
            return True

        # If no match, check whether the student is already locked by a manual override.
        locked = await db.sessions.find_one(
            {
                "sessionId": sessionId,
                "attendees": {
                    "$elemMatch": {
                        "matricNumber": matricNumber,
                        "manuallyOverridden": True,
                    }
                },
            }
        )
        if locked:
            return False  # manual override — do not touch

        # Student not in the list yet — add them.
        entry = {
            "matricNumber": matricNumber,
            "fullName": fullName,
            "markedAt": datetime.now(),
            "method": method,
            "manuallyOverridden": False,
        }
        await db.sessions.update_one(
            {"sessionId": sessionId}, {"$push": {"attendees": entry}}
        )
        return True
    except Exception as e:
        print(e)
        throw_mongo_error()


async def manual_attendance_override(
    sessionId: str, matricNumber: str, fullName: str, present: bool
) -> Union[models.Session, None]:
    """Lecturer manually marks a student present or absent.
    Sets manuallyOverridden=True so auto recognition won't touch this record."""
    try:
        if present:
            # Upsert the entry: update if exists, push if not.
            result = await db.sessions.update_one(
                {"sessionId": sessionId, "attendees.matricNumber": matricNumber},
                {
                    "$set": {
                        "attendees.$.markedAt": datetime.now(),
                        "attendees.$.method": "manual",
                        "attendees.$.manuallyOverridden": True,
                        "attendees.$.fullName": fullName,
                    }
                },
            )
            if result.matched_count == 0:
                # Student not yet in list — add them.
                entry = {
                    "matricNumber": matricNumber,
                    "fullName": fullName,
                    "markedAt": datetime.now(),
                    "method": "manual",
                    "manuallyOverridden": True,
                }
                await db.sessions.update_one(
                    {"sessionId": sessionId}, {"$push": {"attendees": entry}}
                )
        else:
            # Mark absent = remove the entry if it exists (or leave absent by omission).
            await db.sessions.update_one(
                {"sessionId": sessionId},
                {"$pull": {"attendees": {"matricNumber": matricNumber}}},
            )

        doc = await db.sessions.find_one({"sessionId": sessionId})
        return models.Session(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# COURSE REGISTRATION TOKEN
# -------------------------------------------------------
async def get_course_by_token(token: str) -> Union[models.Course, None]:
    """Resolve a registrationToken to a course."""
    try:
        doc = await db.courses.find_one({"registrationToken": token})
        return models.Course(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


# Excludes 0/O and 1/I/l — easy to misread when copied by hand or read aloud.
_REGISTRATION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


async def generate_unique_registration_code(length: int = 7) -> str:
    """Short, human-friendly alternative to a UUID for course registration
    links — easier to read aloud, retype, or fit on one line than a full
    UUID. Checked for uniqueness against existing courses; collisions are
    astronomically unlikely at this alphabet/length but courses are created
    rarely enough that the check costs nothing."""
    for _ in range(10):
        code = "".join(secrets.choice(_REGISTRATION_CODE_ALPHABET) for _ in range(length))
        if not await get_course_by_token(code):
            return code
    raise RuntimeError("could not generate a unique registration code")


# -------------------------------------------------------
# ENROLLED STUDENTS WITH DETAILS
# -------------------------------------------------------
async def get_enrolled_students_details(courseCode: str) -> List[Dict]:
    """Return enrolled students with their full profile details."""
    try:
        enrollments = await db.enrollments.find({"courseCode": courseCode}).to_list(length=5000)
        matric_numbers = [e["matricNumber"] for e in enrollments]
        if not matric_numbers:
            return []
        students = await db.students.find(
            {"matricNumber": {"$in": matric_numbers}},
            {"_id": 0, "matricNumber": 1, "fullName": 1, "registeredAt": 1, "embeddingsDeleted": 1},
        ).to_list(length=5000)
        student_map = {s["matricNumber"]: s for s in students}
        return [student_map[m] for m in matric_numbers if m in student_map]
    except Exception as e:
        print(e)
        throw_mongo_error()


async def count_enrollments_for_courses(course_codes: List[str]) -> Dict[str, int]:
    """Return courseCode → enrollment count for a list of courses."""
    try:
        pipeline = [
            {"$match": {"courseCode": {"$in": course_codes}}},
            {"$group": {"_id": "$courseCode", "count": {"$sum": 1}}},
        ]
        result: Dict[str, int] = {}
        async for doc in db.enrollments.aggregate(pipeline):
            result[doc["_id"]] = doc["count"]
        return result
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# STUDENT EMBEDDINGS UPSERT
# -------------------------------------------------------
async def upsert_student_with_embeddings(
    matricNumber: str,
    fullName: str,
    embeddings: List[List[float]],
) -> bool:
    """Create or update a student's face embeddings. Returns True if newly created."""
    try:
        existing = await db.students.find_one({"matricNumber": matricNumber})
        now = datetime.now()
        if existing:
            await db.students.update_one(
                {"matricNumber": matricNumber},
                {
                    "$set": {
                        "embeddings": embeddings,
                        "embeddingsDeleted": False,
                        "consentWithdrawnAt": None,
                        "biometricConsent": True,
                        "manualAltConsent": True,
                        "ageConsent": True,
                        "consentTimestamp": now,
                        "fullName": fullName,
                    }
                },
            )
            return False
        student = models.Student(
            matricNumber=matricNumber,
            fullName=fullName,
            embeddings=embeddings,
        )
        payload = student.model_dump(by_alias=False)
        payload.pop("id", None)
        await db.students.insert_one(payload)
        return True
    except Exception as e:
        print(e)
        throw_mongo_error()


async def delete_student_embeddings_for_course(courseCode: str, matricNumber: str) -> bool:
    """Delete embeddings when a student withdraws consent for a specific course."""
    try:
        enrollment = await db.enrollments.find_one(
            {"courseCode": courseCode, "matricNumber": matricNumber}
        )
        if not enrollment:
            return False
        result = await db.students.find_one_and_update(
            {"matricNumber": matricNumber},
            {"$set": {"embeddings": [], "embeddingsDeleted": True, "consentWithdrawnAt": datetime.now()}},
        )
        return result is not None
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# STUDENT PORTAL LOOKUP
# -------------------------------------------------------
async def get_student_portal_summary(matricNumber: str) -> List[Dict]:
    """Build full attendance summary for a student across all enrolled courses."""
    try:
        enrollments = await db.enrollments.find({"matricNumber": matricNumber}).to_list(length=1000)
        if not enrollments:
            return []

        student = await db.students.find_one({"matricNumber": matricNumber})
        results = []

        for enrollment in enrollments:
            courseCode = enrollment["courseCode"]
            course = await db.courses.find_one({"courseCode": courseCode})
            if not course:
                continue

            sessions = await db.sessions.find(
                {"courseCode": courseCode, "status": "ended"}
            ).sort("startedAt", -1).to_list(length=1000)

            session_records = []
            present_count = 0

            for session in sessions:
                attendees = session.get("attendees", [])
                entry = next((a for a in attendees if a.get("matricNumber") == matricNumber), None)
                is_present = entry is not None
                if is_present:
                    present_count += 1
                started_at = session.get("startedAt")
                date_str = started_at.isoformat() if hasattr(started_at, "isoformat") else str(started_at)
                session_records.append({
                    "sessionId": session.get("sessionId", ""),
                    "date": date_str,
                    "classroomName": session.get("classroomName"),
                    "status": "present" if is_present else "absent",
                    "manuallyOverridden": entry.get("manuallyOverridden", False) if entry else False,
                })

            total_sessions = len(sessions)
            attendance_rate = (present_count / total_sessions) if total_sessions > 0 else 0.0

            consent = None
            if student:
                ts = student.get("consentTimestamp")
                withdrawn = student.get("consentWithdrawnAt")
                consent = {
                    "consentGivenAt": ts.isoformat() if hasattr(ts, "isoformat") else str(ts or ""),
                    "consentVersion": student.get("consentVersion", "1.0"),
                    "biometricsActive": not student.get("embeddingsDeleted", False),
                    "consentWithdrawnAt": withdrawn.isoformat() if hasattr(withdrawn, "isoformat") else None,
                }

            results.append({
                "courseId": courseCode,
                "courseCode": courseCode,
                "courseName": course.get("courseName", ""),
                "presentCount": present_count,
                "totalSessions": total_sessions,
                "attendanceRate": round(attendance_rate, 4),
                "sessions": session_records,
                "consent": consent,
            })

        return results
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# USERS (authentication)
# -------------------------------------------------------
async def get_user_by_email(email: str) -> Union[models.User, None]:
    try:
        doc = await db.users.find_one({"email": email})
        return models.User(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_user_by_matric(matricNumber: str) -> Union[models.User, None]:
    try:
        doc = await db.users.find_one({"matricNumber": matricNumber})
        return models.User(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def create_user(user: models.User) -> str:
    try:
        payload = user.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.users.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def update_user_role(
    email: str,
    role: str,
    staffId: Optional[str] = None,
    fullName: Optional[str] = None,
    roleAssignedBy: Optional[str] = None,
) -> Union[models.User, None]:
    try:
        update: Dict = {"role": role, "roleAssignedAt": _utcnow()}
        if staffId is not None:
            update["staffId"] = staffId
        if fullName is not None:
            update["fullName"] = fullName
        if roleAssignedBy is not None:
            update["roleAssignedBy"] = roleAssignedBy
        result = await db.users.find_one_and_update(
            {"email": email}, {"$set": update}, return_document=True
        )
        return models.User(**result) if result else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def update_user_fullname(email: str, fullName: str) -> Union[models.User, None]:
    try:
        result = await db.users.find_one_and_update(
            {"email": email}, {"$set": {"fullName": fullName}}, return_document=True
        )
        return models.User(**result) if result else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def update_user_status(email: str, status_: str) -> Union[models.User, None]:
    try:
        result = await db.users.find_one_and_update(
            {"email": email}, {"$set": {"status": status_}}, return_document=True
        )
        return models.User(**result) if result else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def update_last_login(email: str) -> None:
    try:
        await db.users.update_one(
            {"email": email}, {"$set": {"lastLoginAt": _utcnow()}}
        )
    except Exception as e:
        print(e)
        throw_mongo_error()


async def list_users_by_role(role: Optional[str] = None) -> List[models.User]:
    try:
        query = {"role": role} if role else {}
        docs = await db.users.find(query).to_list(length=5000)
        return [models.User(**d) for d in docs]
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# LOGIN CODES (authentication)
# -------------------------------------------------------
async def create_login_code(email: str, codeHash: str, expiresAt: datetime) -> str:
    try:
        login_code = models.LoginCode(email=email, codeHash=codeHash, expiresAt=expiresAt)
        payload = login_code.model_dump(by_alias=False)
        payload.pop("id", None)
        result = await db.login_codes.insert_one(payload)
        return str(result.inserted_id)
    except Exception as e:
        print(e)
        throw_mongo_error()


async def get_active_login_code(email: str) -> Union[models.LoginCode, None]:
    """Most recent unconsumed code for this email, regardless of expiry —
    callers must check expiresAt themselves (the TTL index is cleanup, not
    enforcement; MongoDB's TTL monitor runs on roughly a 60s cycle)."""
    try:
        doc = await db.login_codes.find_one(
            {"email": email, "consumedAt": None},
            sort=[("createdAt", -1)],
        )
        return models.LoginCode(**doc) if doc else None
    except Exception as e:
        print(e)
        throw_mongo_error()


async def increment_code_attempts(login_code_id: str) -> int:
    try:
        result = await db.login_codes.find_one_and_update(
            {"_id": ObjectId(login_code_id)},
            {"$inc": {"attempts": 1}},
            return_document=True,
        )
        return result["attempts"] if result else 0
    except Exception as e:
        print(e)
        throw_mongo_error()


async def consume_login_code(login_code_id: str) -> None:
    try:
        await db.login_codes.update_one(
            {"_id": ObjectId(login_code_id)}, {"$set": {"consumedAt": _utcnow()}}
        )
    except Exception as e:
        print(e)
        throw_mongo_error()


async def invalidate_codes_for_email(email: str) -> None:
    """Marks any outstanding (unconsumed) codes for this email as consumed so
    they can no longer be exchanged, per the 'invalidate on new code' rule."""
    try:
        await db.login_codes.update_many(
            {"email": email, "consumedAt": None}, {"$set": {"consumedAt": _utcnow()}}
        )
    except Exception as e:
        print(e)
        throw_mongo_error()


# -------------------------------------------------------
# AUTH INDEXES
# -------------------------------------------------------
async def create_auth_indexes() -> None:
    """Called once at application startup by both backends. Unique index enforces
    one user document per email; the TTL index lets MongoDB delete expired login
    codes automatically (expiry is also checked in application code — see
    get_active_login_code)."""
    try:
        await db.users.create_index("email", unique=True)
        await db.login_codes.create_index("expiresAt", expireAfterSeconds=0)
    except Exception as e:
        print(e)
