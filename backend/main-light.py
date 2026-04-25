from dotenv import load_dotenv

load_dotenv()

import os
import uuid
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import List, Optional

from fastapi import (
    FastAPI, HTTPException, status,
    UploadFile, File, Form,
    WebSocket, WebSocketDisconnect,
    BackgroundTasks, Query
)

from fastapi.middleware.cors import CORSMiddleware

import httpx

from send_email import EmailService

import database, models, schemas, env


# -------------------------------------------------------
# CONFIG
# -------------------------------------------------------
HEAVY_BACKEND_URL = os.getenv("HEAVY_BACKEND_URL", "http://51.107.0.26").rstrip("/")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("smart-classroom-proxy")


# -------------------------------------------------------
# HELPERS
# -------------------------------------------------------
def serialize(obj):
    if isinstance(obj, dict):
        return {k: serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [serialize(v) for v in obj]
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        logger.info("WS connected: total=%d", len(self.active))

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
            logger.info("WS disconnected: total=%d", len(self.active))

    async def broadcast(self, data: dict):
        logger.info("Broadcasting %s to %d clients", data.get("event"), len(self.active))
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.exception("WS send failed: %s", e)
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)
        logger.info("Broadcast complete. active=%d dead=%d", len(self.active), len(dead))


manager = ConnectionManager()


# -------------------------------------------------------
# APP
# -------------------------------------------------------
app = FastAPI(title="Smart Classroom (lightweight proxy)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------
# WEBSOCKET
# -------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            try:
                text = await ws.receive_text()
                logger.info("Received from client WS: %s", text)
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.exception("Error receiving from WS: %s", e)
                break
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        logger.exception("WS handler error")
        manager.disconnect(ws)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "service": "smart-classroom-api",
        "timestamp": datetime.utcnow().isoformat()
    }


# -------------------------------------------------------
# CLASSROOMS
# -------------------------------------------------------
@app.post("/classrooms", response_model=schemas.ResponseModel)
async def create_classroom(req: schemas.CreateClassroomRequest):
    existing = await database.get_classroom_by_classId(req.classId)
    if existing:
        raise HTTPException(409, "classId already exists")

    classroom = models.Classroom(**req.model_dump())
    inserted_id = await database.add_classroom(classroom)

    return {
        "success": True,
        "message": "classroom created",
        "data": {"id": inserted_id}
    }


@app.get("/classrooms", response_model=schemas.ResponseModel)
async def get_classrooms():
    docs = await database.list_classrooms()
    return {
        "success": True,
        "message": "ok",
        "data": {"classrooms": [d.model_dump() for d in docs]}
    }


@app.get("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def get_classroom(classId: str):
    doc = await database.get_classroom_by_classId(classId)
    if not doc:
        raise HTTPException(404, "classroom not found")

    return {
        "success": True,
        "message": "ok",
        "data": {"classroom": doc.model_dump()}
    }


@app.put("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def update_classroom(
    classId: str,
    req: schemas.UpdateClassroomRequest,
    background_tasks: BackgroundTasks,
):
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    existing = await database.get_classroom_by_classId(classId)
    if not existing:
        raise HTTPException(404, "classroom not found")

    if payload.get("classId") and payload.get("classId") != classId:
        other = await database.get_classroom_by_classId(payload["classId"])
        if other:
            raise HTTPException(409, "new classId already exists")

    updated = await database.update_classroom_by_classId(classId, payload)

    updated_dict = updated.model_dump()
    if "_id" in updated_dict:
        updated_dict["_id"] = str(updated_dict["_id"])

    for dt_key in ("createdAt", "updatedAt"):
        if updated_dict.get(dt_key):
            try:
                updated_dict[dt_key] = updated_dict[dt_key].isoformat()
            except Exception:
                pass

    await manager.broadcast(
        serialize({"event": "classroom_updated", "classroom": updated_dict})
    )

    try:
        occupancy_after = updated.occupancy
        capacity_after = updated.capacity
        class_name = updated_dict.get("className") or "Unknown Classroom"

        if (
            occupancy_after is not None
            and capacity_after is not None
            and occupancy_after > capacity_after
        ):
            print("Exceeded!")
            background_tasks.add_task(
                EmailService.send_occupancy_alert,
                to_email="okefejoseph9@gmail.com",
                class_id=classId,
                class_name=class_name,
                occupancy=occupancy_after,
                capacity=capacity_after,
            )
    except Exception as e:
        logger.exception("Failed to schedule occupancy alert email: %s", e)

    return {
        "success": True,
        "message": "updated",
        "data": {"classroom": updated.model_dump()}
    }


@app.delete("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def delete_classroom(classId: str):
    ok = await database.delete_classroom_by_classId(classId)
    if not ok:
        raise HTTPException(404, "classroom not found")

    return {"success": True, "message": "deleted", "data": None}


# -------------------------------------------------------
# IMAGE ENDPOINT — forward to heavy backend (unchanged)
# -------------------------------------------------------
@app.post("/classrooms/{classId}/image", response_model=schemas.ResponseModel)
async def upload_image(
    classId: str,
    background_tasks: BackgroundTasks,
    deviceId: str = Form(...),
    file: UploadFile = File(...)
):
    classroom = await database.get_classroom_by_classId(classId)
    if not classroom:
        raise HTTPException(404, "classroom not found")

    if classroom.deviceId != deviceId:
        raise HTTPException(400, "deviceId mismatch")

    contents = await file.read()
    forward_url = f"{HEAVY_BACKEND_URL}/classrooms/{classId}/image"
    logger.info("Forwarding image to heavy backend %s", forward_url)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            files = {"file": (file.filename or "upload.jpg", contents, file.content_type)}
            data = {"deviceId": deviceId}
            resp = await client.post(forward_url, data=data, files=files)

        resp.raise_for_status()
        resp_json = resp.json()

        classroom_payload = resp_json.get("data", {}).get("classroom")

        if classroom_payload:
            if "_id" in classroom_payload:
                classroom_payload["_id"] = str(classroom_payload["_id"])

            for dt_key in ("createdAt", "updatedAt"):
                if classroom_payload.get(dt_key):
                    if isinstance(classroom_payload[dt_key], datetime):
                        classroom_payload[dt_key] = classroom_payload[dt_key].isoformat()

            await manager.broadcast(serialize({
                "event": "classroom_image_update",
                "classroom": classroom_payload
            }))

            occupancy_after = classroom_payload.get("occupancy")
            capacity_after = classroom_payload.get("capacity")
            class_name = classroom_payload.get("className") or "Unknown Classroom"

            if (
                occupancy_after is not None
                and capacity_after is not None
                and occupancy_after > capacity_after
            ):
                print("Exceeded after image upload!")
                background_tasks.add_task(
                    EmailService.send_occupancy_alert,
                    to_email="okefejoseph9@gmail.com",
                    class_id=classId,
                    class_name=class_name,
                    occupancy=occupancy_after,
                    capacity=capacity_after,
                )

        # Also forward attendance_update broadcast if present in response
        attendance_payload = resp_json.get("data", {}).get("attendance")
        if attendance_payload and attendance_payload.get("newlyMarked"):
            await manager.broadcast(serialize({
                "event": "attendance_update",
                "sessionId": attendance_payload.get("sessionId"),
                "courseCode": attendance_payload.get("courseCode"),
                "newlyMarked": attendance_payload.get("newlyMarked"),
            }))

        return resp_json

    except Exception as e:
        logger.exception("Heavy backend unavailable or error occurred: %s", e)
        return schemas.ResponseModel(
            success=False,
            message="image analytics server currently unavailable",
            data=None
        ).model_dump()


# -------------------------------------------------------
# LECTURERS
# -------------------------------------------------------
@app.post("/lecturers", response_model=schemas.ResponseModel, status_code=status.HTTP_201_CREATED)
async def create_lecturer(req: schemas.CreateLecturerRequest):
    existing = await database.get_lecturer_by_staffId(req.staffId)
    if existing:
        raise HTTPException(409, "staffId already exists")

    lecturer = models.Lecturer(**req.model_dump())
    inserted_id = await database.add_lecturer(lecturer)

    return {
        "success": True,
        "message": "lecturer registered",
        "data": {"id": inserted_id},
    }


@app.get("/lecturers", response_model=schemas.ResponseModel)
async def list_lecturers():
    docs = await database.list_lecturers()
    return {
        "success": True,
        "message": "ok",
        "data": {"lecturers": [d.model_dump() for d in docs]},
    }


@app.get("/lecturers/{staffId}", response_model=schemas.ResponseModel)
async def get_lecturer(staffId: str):
    doc = await database.get_lecturer_by_staffId(staffId)
    if not doc:
        raise HTTPException(404, "lecturer not found")
    return {
        "success": True,
        "message": "ok",
        "data": {"lecturer": doc.model_dump()},
    }


@app.delete("/lecturers/{staffId}", response_model=schemas.ResponseModel)
async def delete_lecturer(staffId: str):
    ok = await database.delete_lecturer_by_staffId(staffId)
    if not ok:
        raise HTTPException(404, "lecturer not found")
    return {"success": True, "message": "deleted", "data": None}


# -------------------------------------------------------
# COURSES
# -------------------------------------------------------
@app.post("/courses", response_model=schemas.ResponseModel, status_code=status.HTTP_201_CREATED)
async def create_course(req: schemas.CreateCourseRequest):
    existing = await database.get_course_by_courseCode(req.courseCode)
    if existing:
        raise HTTPException(409, "courseCode already exists")

    if req.lecturerId:
        lecturer = await database.get_lecturer_by_staffId(req.lecturerId)
        if not lecturer:
            raise HTTPException(404, "lecturer not found")

    course = models.Course(**req.model_dump(), registrationToken=str(uuid.uuid4()))
    inserted_id = await database.add_course(course)

    return {
        "success": True,
        "message": "course created",
        "data": {"id": inserted_id},
    }


@app.get("/courses", response_model=schemas.ResponseModel)
async def list_courses(lecturerId: Optional[str] = Query(default=None)):
    docs = await database.list_courses(lecturerId=lecturerId)
    return {
        "success": True,
        "message": "ok",
        "data": {"courses": [d.model_dump() for d in docs]},
    }


@app.get("/courses/{courseCode}", response_model=schemas.ResponseModel)
async def get_course(courseCode: str):
    doc = await database.get_course_by_courseCode(courseCode)
    if not doc:
        raise HTTPException(404, "course not found")
    return {
        "success": True,
        "message": "ok",
        "data": {"course": doc.model_dump()},
    }


@app.put("/courses/{courseCode}", response_model=schemas.ResponseModel)
async def update_course(courseCode: str, req: schemas.UpdateCourseRequest):
    existing = await database.get_course_by_courseCode(courseCode)
    if not existing:
        raise HTTPException(404, "course not found")

    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(400, "no fields to update")

    if "lecturerId" in payload:
        lecturer = await database.get_lecturer_by_staffId(payload["lecturerId"])
        if not lecturer:
            raise HTTPException(404, "lecturer not found")

    updated = await database.update_course_by_courseCode(courseCode, payload)
    return {
        "success": True,
        "message": "updated",
        "data": {"course": updated.model_dump()},
    }


@app.delete("/courses/{courseCode}", response_model=schemas.ResponseModel)
async def delete_course(courseCode: str):
    ok = await database.delete_course_by_courseCode(courseCode)
    if not ok:
        raise HTTPException(404, "course not found")
    return {"success": True, "message": "deleted", "data": None}


# -------------------------------------------------------
# STUDENTS
# Student registration requires face_recognition (heavy dep).
# This server forwards that request to the heavy backend.
# All other student endpoints are handled locally.
# -------------------------------------------------------
@app.post("/students/register", response_model=schemas.ResponseModel, status_code=status.HTTP_201_CREATED)
async def register_student(
    matricNumber: str = Form(...),
    fullName: str = Form(...),
    photos: List[UploadFile] = File(...),
):
    """Forward to heavy backend — face embedding extraction requires face_recognition."""
    contents_list = []
    for photo in photos:
        contents = await photo.read()
        contents_list.append((photo.filename or "photo.jpg", contents, photo.content_type or "image/jpeg"))

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            files = [("photos", item) for item in contents_list]
            data = {"matricNumber": matricNumber, "fullName": fullName}
            resp = await client.post(
                f"{HEAVY_BACKEND_URL}/students/register",
                data=data,
                files=files,
            )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.exception("Heavy backend error during student registration: %s", e)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "face recognition service currently unavailable",
        )


@app.get("/students", response_model=schemas.ResponseModel)
async def list_students():
    docs = await database.list_students()
    safe = [
        {k: v for k, v in d.model_dump().items() if k != "embeddings"}
        for d in docs
    ]
    return {"success": True, "message": "ok", "data": {"students": safe}}


@app.get("/students/{matricNumber}", response_model=schemas.ResponseModel)
async def get_student(matricNumber: str):
    doc = await database.get_student_by_matric(matricNumber)
    if not doc:
        raise HTTPException(404, "student not found")
    safe = {k: v for k, v in doc.model_dump().items() if k != "embeddings"}
    return {"success": True, "message": "ok", "data": {"student": safe}}


@app.delete("/students/{matricNumber}/embeddings", response_model=schemas.ResponseModel)
async def delete_student_embeddings(matricNumber: str):
    ok = await database.delete_student_embeddings(matricNumber)
    if not ok:
        raise HTTPException(404, "student not found")
    return {"success": True, "message": "biometric data deleted", "data": None}


# -------------------------------------------------------
# ENROLLMENTS
# -------------------------------------------------------
@app.post(
    "/courses/{courseCode}/enrollments",
    response_model=schemas.ResponseModel,
    status_code=status.HTTP_201_CREATED,
)
async def enroll_student(courseCode: str, req: schemas.EnrollStudentRequest):
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")

    student = await database.get_student_by_matric(req.matricNumber)
    if not student:
        raise HTTPException(404, "student not found — student must register first")

    existing = await database.get_enrollment(courseCode, req.matricNumber)
    if existing:
        raise HTTPException(409, "student already enrolled in this course")

    enrollment = models.Enrollment(courseCode=courseCode, matricNumber=req.matricNumber)
    inserted_id = await database.add_enrollment(enrollment)

    return {
        "success": True,
        "message": "enrolled",
        "data": {"id": inserted_id},
    }


@app.delete(
    "/courses/{courseCode}/enrollments/{matricNumber}",
    response_model=schemas.ResponseModel,
)
async def unenroll_student(courseCode: str, matricNumber: str):
    ok = await database.delete_enrollment(courseCode, matricNumber)
    if not ok:
        raise HTTPException(404, "enrollment not found")
    return {"success": True, "message": "unenrolled", "data": None}


@app.get("/courses/{courseCode}/enrollments", response_model=schemas.ResponseModel)
async def list_course_enrollments(courseCode: str):
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")

    enrollments = await database.list_enrollments_by_course(courseCode)
    return {
        "success": True,
        "message": "ok",
        "data": {"enrollments": [e.model_dump() for e in enrollments]},
    }


@app.get("/students/{matricNumber}/enrollments", response_model=schemas.ResponseModel)
async def list_student_enrollments(matricNumber: str):
    student = await database.get_student_by_matric(matricNumber)
    if not student:
        raise HTTPException(404, "student not found")

    enrollments = await database.list_enrollments_by_student(matricNumber)
    return {
        "success": True,
        "message": "ok",
        "data": {"enrollments": [e.model_dump() for e in enrollments]},
    }


# -------------------------------------------------------
# SESSIONS
# -------------------------------------------------------
@app.post("/sessions", response_model=schemas.ResponseModel, status_code=status.HTTP_201_CREATED)
async def start_session(req: schemas.StartSessionRequest):
    import uuid

    course = await database.get_course_by_courseCode(req.courseCode)
    if not course:
        raise HTTPException(404, "course not found")

    classroom = await database.get_classroom_by_classId(req.classId)
    if not classroom:
        raise HTTPException(404, "classroom not found")

    active = await database.get_active_session_by_classId(req.classId)
    if active:
        raise HTTPException(
            409,
            f"classroom already has an active session ({active.sessionId}) for course {active.courseCode}",
        )

    session = models.Session(
        sessionId=str(uuid.uuid4()),
        courseCode=req.courseCode,
        classId=req.classId,
    )
    inserted_id = await database.add_session(session)

    await manager.broadcast(serialize({
        "event": "session_started",
        "session": session.model_dump(),
    }))

    return {
        "success": True,
        "message": "session started",
        "data": {"id": inserted_id, "sessionId": session.sessionId},
    }


@app.get("/sessions", response_model=schemas.ResponseModel)
async def list_sessions(
    classId: Optional[str] = Query(default=None),
    courseCode: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
):
    docs = await database.list_sessions(classId=classId, courseCode=courseCode, status=status)
    return {
        "success": True,
        "message": "ok",
        "data": {"sessions": [d.model_dump() for d in docs]},
    }


@app.get("/sessions/{sessionId}", response_model=schemas.ResponseModel)
async def get_session(sessionId: str):
    doc = await database.get_session_by_sessionId(sessionId)
    if not doc:
        raise HTTPException(404, "session not found")
    return {
        "success": True,
        "message": "ok",
        "data": {"session": doc.model_dump()},
    }


@app.put("/sessions/{sessionId}/end", response_model=schemas.ResponseModel)
async def end_session(sessionId: str):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    if session.status == "ended":
        raise HTTPException(400, "session already ended")

    ended = await database.end_session(sessionId)

    await manager.broadcast(serialize({
        "event": "session_ended",
        "session": ended.model_dump(),
    }))

    return {
        "success": True,
        "message": "session ended",
        "data": {"session": ended.model_dump()},
    }


# -------------------------------------------------------
# ATTENDANCE
# -------------------------------------------------------
@app.get("/sessions/{sessionId}/attendance", response_model=schemas.ResponseModel)
async def get_attendance(sessionId: str):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    return {
        "success": True,
        "message": "ok",
        "data": {
            "sessionId": sessionId,
            "courseCode": session.courseCode,
            "classId": session.classId,
            "status": session.status,
            "startedAt": session.startedAt.isoformat(),
            "endedAt": session.endedAt.isoformat() if session.endedAt else None,
            "attendees": [a.model_dump() for a in session.attendees],
            "totalPresent": len(session.attendees),
        },
    }


@app.post("/sessions/{sessionId}/attendance", response_model=schemas.ResponseModel)
async def manual_attendance(sessionId: str, req: schemas.ManualAttendanceRequest):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")

    student = await database.get_student_by_matric(req.matricNumber)
    if not student:
        raise HTTPException(404, "student not found")

    updated = await database.manual_attendance_override(
        sessionId, req.matricNumber, student.fullName, req.present
    )

    await manager.broadcast(serialize({
        "event": "attendance_update",
        "session": updated.model_dump(),
        "manualOverride": {
            "matricNumber": req.matricNumber,
            "present": req.present,
        },
    }))

    return {
        "success": True,
        "message": "attendance updated",
        "data": {
            "sessionId": sessionId,
            "attendees": [a.model_dump() for a in updated.attendees],
        },
    }


# -------------------------------------------------------
# REGISTRATION TOKEN RESOLUTION
# -------------------------------------------------------
@app.get("/register/{token}", response_model=schemas.ResponseModel)
async def resolve_registration_token(token: str):
    doc = await database.get_course_by_token(token)
    if not doc:
        raise HTTPException(404, "invalid or expired registration link")
    safe = {k: v for k, v in doc.model_dump().items() if k != "embeddings"}
    return {"success": True, "message": "ok", "data": {"course": safe}}


# -------------------------------------------------------
# COURSE-SCOPED STUDENT LIST
# -------------------------------------------------------
@app.get("/courses/{courseCode}/students", response_model=schemas.ResponseModel)
async def list_enrolled_students(courseCode: str):
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    students = await database.get_enrolled_students_details(courseCode)
    return {"success": True, "message": "ok", "data": {"students": students}}


# -------------------------------------------------------
# COURSE-SCOPED STUDENT REGISTRATION  (forward to heavy backend)
# -------------------------------------------------------
@app.post(
    "/courses/{courseCode}/register",
    response_model=schemas.ResponseModel,
    status_code=status.HTTP_201_CREATED,
)
async def register_student_for_course(
    courseCode: str,
    matricNumber: str = Form(...),
    fullName: str = Form(...),
    biometricConsent: str = Form(...),
    manualAltConsent: str = Form(...),
    ageConsent: str = Form(...),
    photos: List[UploadFile] = File(...),
):
    contents_list = []
    for photo in photos:
        contents = await photo.read()
        contents_list.append((photo.filename or "photo.jpg", contents, photo.content_type or "image/jpeg"))

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            files = [("photos", item) for item in contents_list]
            data = {
                "matricNumber": matricNumber,
                "fullName": fullName,
                "biometricConsent": biometricConsent,
                "manualAltConsent": manualAltConsent,
                "ageConsent": ageConsent,
            }
            resp = await client.post(
                f"{HEAVY_BACKEND_URL}/courses/{courseCode}/register",
                data=data,
                files=files,
            )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        logger.exception("Heavy backend error during course registration: %s", e)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "face recognition service currently unavailable",
        )


# -------------------------------------------------------
# COURSE-SCOPED BIOMETRICS DELETION
# -------------------------------------------------------
@app.delete("/courses/{courseCode}/students/biometrics", response_model=schemas.ResponseModel)
async def delete_course_student_biometrics(courseCode: str, req: schemas.ManualAttendanceRequest):
    matric = req.matricNumber.strip().upper()
    ok = await database.delete_student_embeddings_for_course(courseCode, matric)
    if not ok:
        raise HTTPException(404, "student enrollment not found")
    return {"success": True, "message": "biometric data deleted", "data": None}


# -------------------------------------------------------
# SESSION END — POST alias
# -------------------------------------------------------
@app.post("/sessions/{sessionId}/end", response_model=schemas.ResponseModel)
async def end_session_post(sessionId: str):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    if session.status == "ended":
        raise HTTPException(400, "session already ended")
    ended = await database.end_session(sessionId)
    await manager.broadcast(serialize({"event": "session_ended", "session": ended.model_dump()}))
    return {"success": True, "message": "session ended", "data": {"session": ended.model_dump()}}


# -------------------------------------------------------
# PER-STUDENT ATTENDANCE UPDATE  (PUT)
# -------------------------------------------------------
@app.put(
    "/sessions/{sessionId}/attendance/{matricNumber}",
    response_model=schemas.ResponseModel,
)
async def update_student_attendance(sessionId: str, matricNumber: str, req: dict):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")

    present = req.get("status") == "present"
    student = await database.get_student_by_matric(matricNumber)
    full_name = student.fullName if student else matricNumber

    updated = await database.manual_attendance_override(sessionId, matricNumber, full_name, present)

    await manager.broadcast(serialize({
        "event": "attendance_update",
        "session": updated.model_dump(),
        "manualOverride": {"matricNumber": matricNumber, "present": present},
    }))

    return {
        "success": True,
        "message": "attendance updated",
        "data": {"sessionId": sessionId, "matricNumber": matricNumber, "present": present},
    }


# -------------------------------------------------------
# ON-DEMAND CAPTURE STUB
# -------------------------------------------------------
@app.post("/sessions/{sessionId}/capture", response_model=schemas.ResponseModel)
async def capture_attendance(sessionId: str):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    if session.status != "active":
        raise HTTPException(400, "session is not active")

    records = [
        {
            "id": a.matricNumber,
            "sessionId": sessionId,
            "studentId": a.matricNumber,
            "matricNumber": a.matricNumber,
            "status": "present",
            "detectedAt": a.markedAt.isoformat() if hasattr(a.markedAt, "isoformat") else str(a.markedAt),
            "manuallyOverridden": a.manuallyOverridden,
        }
        for a in session.attendees
    ]

    return {"success": True, "message": "ok", "data": {"records": records}}


# -------------------------------------------------------
# STUDENT PORTAL LOOKUP
# -------------------------------------------------------
@app.get("/students/lookup/{matricNumber}", response_model=schemas.ResponseModel)
async def student_portal_lookup(matricNumber: str):
    matric = matricNumber.strip().upper()
    results = await database.get_student_portal_summary(matric)
    if not results:
        raise HTTPException(404, "no student found with this matric number")
    return {"success": True, "message": "ok", "data": {"results": results}}


# -------------------------------------------------------
# COURSE CREATION — also update to generate registrationToken
# -------------------------------------------------------
# Note: the create_course endpoint defined above already handles lecturerId=None.
# We override it here to also inject registrationToken.
