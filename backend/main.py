from fastapi import (
    FastAPI, HTTPException, status,
    UploadFile, File, Form, Response, WebSocket, WebSocketDisconnect, Query
)
from fastapi.middleware.cors import CORSMiddleware

from datetime import datetime
from zoneinfo import ZoneInfo

from typing import List, Optional
from io import BytesIO
import cv2
import numpy as np
import logging
import time
import uuid

import database, models, schemas, env

from ultralytics import YOLO
import cloudinary
import cloudinary.uploader


# -------------------------------------------------------
# CLOUDINARY CONFIG
# -------------------------------------------------------
cloudinary.config(
    cloud_name=env.CLOUDINARY_CLOUD_NAME,
    api_key=env.CLOUDINARY_API_KEY,
    api_secret=env.CLOUDINARY_API_SECRET
)


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("smart-classroom")


# -------------------------------------------------------
# GLOBAL WEBSOCKET MANAGER
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
        logger.info("Broadcast complete. sent=%d dead=%d", len(self.active), len(dead))


manager = ConnectionManager()


# -------------------------------------------------------
# FASTAPI APP
# -------------------------------------------------------
app = FastAPI(title="Smart Classroom - FastAPI + YOLO + MongoDB")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------
# WEBSOCKET ENDPOINT
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


# -------------------------------------------------------
# CREATE CLASSROOM
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


# -------------------------------------------------------
# LIST CLASSROOMS
# -------------------------------------------------------
@app.get("/classrooms", response_model=schemas.ResponseModel)
async def get_classrooms():
    docs = await database.list_classrooms()
    return {
        "success": True,
        "message": "ok",
        "data": {"classrooms": [d.model_dump() for d in docs]}
    }


# -------------------------------------------------------
# GET ONE CLASSROOM
# -------------------------------------------------------
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


# -------------------------------------------------------
# UPDATE CLASSROOM
# -------------------------------------------------------
@app.put("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def update_classroom(classId: str, req: schemas.UpdateClassroomRequest):
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    existing = await database.get_classroom_by_classId(classId)
    if not existing:
        raise HTTPException(404, "classroom not found")

    if payload.get("classId") != classId:
        other = await database.get_classroom_by_classId(payload["classId"])
        if other:
            raise HTTPException(409, "new classId already exists")

    updated = await database.update_classroom_by_classId(classId, payload)

    updated_dict = updated.model_dump()
    if "_id" in updated_dict:
        updated_dict["_id"] = str(updated_dict["_id"])
    for dt_key in ("createdAt", "updatedAt"):
        if dt_key in updated_dict and updated_dict[dt_key] is not None:
            try:
                updated_dict[dt_key] = updated_dict[dt_key].isoformat()
            except Exception:
                pass

    await manager.broadcast(serialize({"event": "classroom_updated", "classroom": updated_dict}))

    return {
        "success": True,
        "message": "updated",
        "data": {"classroom": updated.model_dump()}
    }


# -------------------------------------------------------
# DELETE CLASSROOM
# -------------------------------------------------------
@app.delete("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def delete_classroom(classId: str):
    ok = await database.delete_classroom_by_classId(classId)
    if not ok:
        raise HTTPException(404, "classroom not found")

    return {
        "success": True,
        "message": "deleted",
        "data": None
    }


# -------------------------------------------------------
# YOLO + FACE RECOGNITION IMAGE ENDPOINT
# -------------------------------------------------------
@app.post("/classrooms/{classId}/image", response_model=schemas.ResponseModel)
async def upload_image(classId: str, deviceId: str = Form(...), file: UploadFile = File(...)):
    t_total_start = time.perf_counter()

    classroom = await database.get_classroom_by_classId(classId)
    if not classroom:
        raise HTTPException(404, "classroom not found")

    if classroom.deviceId != deviceId:
        raise HTTPException(400, "deviceId mismatch")

    contents = await file.read()

    # Decode image
    t_decode_start = time.perf_counter()
    img_array = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "invalid image")
    decode_ms = (time.perf_counter() - t_decode_start) * 1000

    import asyncio
    loop = asyncio.get_running_loop()

    # Lazy-load YOLO
    model = getattr(app.state, "yolo_model", None)
    if model is None:
        model = await loop.run_in_executor(None, lambda: YOLO("yolov8n.pt"))
        app.state.yolo_model = model

    # Run YOLO in executor
    t_infer_start = time.perf_counter()
    results = await loop.run_in_executor(
        None,
        lambda: model.predict(img, imgsz=1920, conf=0.25, iou=0.45, augment=True)
    )
    inference_ms = (time.perf_counter() - t_infer_start) * 1000

    boxes = results[0].boxes if len(results) else []
    person_count = sum(1 for b in boxes if int(b.cls[0]) == 0)
    new_occupancy = min(person_count, classroom.capacity)

    now_ng = datetime.now(ZoneInfo("Africa/Lagos"))
    timestamp = now_ng.strftime("%d %b %Y, %I:%M %p").replace(" 0", " ")
    ANNOTATION_COLOR = (234, 241, 246)

    label = f"Occupancy: {new_occupancy}/{classroom.capacity}"
    cv2.putText(img, label, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, ANNOTATION_COLOR, 3)
    cv2.putText(img, timestamp, (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, ANNOTATION_COLOR, 2)

    # -------------------------------------------------------
    # FACE RECOGNITION — runs only if there is an active session
    # -------------------------------------------------------
    t_fr_start = time.perf_counter()
    active_session = await database.get_active_session_by_classId(classId)
    newly_marked: List[str] = []
    fr_error: Optional[str] = None

    if active_session:
        try:
            import face_recognition  # optional heavy dep

            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            face_locations = await loop.run_in_executor(
                None, lambda: face_recognition.face_locations(rgb, model="hog")
            )
            detected_faces = await loop.run_in_executor(
                None, lambda: face_recognition.face_encodings(rgb, face_locations)
            )

            if detected_faces:
                enrollments = await database.list_enrollments_by_course(active_session.courseCode)
                matric_numbers = [e.matricNumber for e in enrollments]
                students_data = await database.get_students_for_recognition(matric_numbers)

                for detected in detected_faces:
                    best_match = None
                    best_distance = 1.0

                    for student in students_data:
                        known = [np.array(e) for e in student["embeddings"]]
                        if not known:
                            continue
                        distances = face_recognition.face_distance(known, detected)
                        d = float(min(distances))
                        if d < best_distance:
                            best_distance = d
                            best_match = student

                    # Threshold: 0.55 — tune during testing (lower = stricter)
                    if best_match and best_distance < 0.55:
                        marked = await database.mark_attendance(
                            active_session.sessionId,
                            best_match["matricNumber"],
                            best_match["fullName"],
                            method="auto",
                        )
                        if marked:
                            newly_marked.append(best_match["matricNumber"])

            # Annotate image with active session info
            session_label = f"Session: {active_session.courseCode} | Present: {len(active_session.attendees) + len(newly_marked)}"
            cv2.putText(img, session_label, (20, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.9, ANNOTATION_COLOR, 2)

        except ImportError:
            fr_error = "face_recognition not installed"
            logger.warning("face_recognition library not available — attendance skipped")
        except Exception as e:
            fr_error = str(e)
            logger.exception("Face recognition error: %s", e)

    fr_ms = (time.perf_counter() - t_fr_start) * 1000

    # Encode annotated image
    _, encoded = cv2.imencode(".jpg", img)
    annotated_bytes = encoded.tobytes()

    # Upload to Cloudinary
    t_cloudinary_start = time.perf_counter()
    upload_result = cloudinary.uploader.upload(annotated_bytes, folder="smart_classrooms")
    new_url = upload_result["secure_url"]
    cloudinary_ms = (time.perf_counter() - t_cloudinary_start) * 1000

    # Delete old image
    if classroom.latestImage:
        public_id = "/".join(classroom.latestImage.split("/")[-2:]).split(".")[0]
        try:
            cloudinary.uploader.destroy(public_id)
        except Exception:
            pass

    # Update DB
    t_db_start = time.perf_counter()
    await database.update_classroom_by_classId(classId, {"occupancy": new_occupancy, "latestImage": new_url})
    updated = await database.get_classroom_by_classId(classId)
    db_ms = (time.perf_counter() - t_db_start) * 1000

    updated_dict = updated.model_dump()
    if "_id" in updated_dict:
        try:
            updated_dict["_id"] = str(updated_dict["_id"])
        except Exception:
            pass
    for dt_key in ("createdAt", "updatedAt"):
        if dt_key in updated_dict and updated_dict[dt_key] is not None:
            try:
                updated_dict[dt_key] = updated_dict[dt_key].isoformat()
            except Exception:
                pass

    # Broadcast classroom update
    t_ws_start = time.perf_counter()
    await manager.broadcast(serialize({
        "event": "classroom_image_update",
        "classroom": updated_dict
    }))

    # Broadcast attendance update if a session is active and students were marked
    if active_session and newly_marked:
        refreshed_session = await database.get_session_by_sessionId(active_session.sessionId)
        if refreshed_session:
            await manager.broadcast(serialize({
                "event": "attendance_update",
                "session": refreshed_session.model_dump(),
                "newlyMarked": newly_marked,
            }))

    ws_ms = (time.perf_counter() - t_ws_start) * 1000
    total_ms = (time.perf_counter() - t_total_start) * 1000

    metrics = {
        "decode_ms": round(decode_ms, 2),
        "inference_ms": round(inference_ms, 2),
        "face_recognition_ms": round(fr_ms, 2),
        "cloudinary_ms": round(cloudinary_ms, 2),
        "db_ms": round(db_ms, 2),
        "ws_broadcast_ms": round(ws_ms, 2),
        "total_ms": round(total_ms, 2),
    }

    response_data: dict = {"classroom": updated.model_dump(), "metrics": metrics}
    if active_session:
        response_data["attendance"] = {
            "sessionId": active_session.sessionId,
            "courseCode": active_session.courseCode,
            "newlyMarked": newly_marked,
        }
        if fr_error:
            response_data["attendance"]["error"] = fr_error

    return schemas.ResponseModel(
        success=True,
        message="classroom image updated",
        data=response_data,
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

    course = models.Course(
        **req.model_dump(),
        registrationToken=str(uuid.uuid4()),
    )
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
# -------------------------------------------------------
@app.post("/students/register", response_model=schemas.ResponseModel, status_code=status.HTTP_201_CREATED)
async def register_student(
    matricNumber: str = Form(...),
    fullName: str = Form(...),
    photos: List[UploadFile] = File(...),
):
    """Register a student by extracting face embeddings from uploaded photos.
    Photos are processed in memory — never written to disk or cloud.
    Between 1 and 5 photos accepted; more angles improve recognition accuracy."""
    existing = await database.get_student_by_matric(matricNumber)
    if existing:
        raise HTTPException(409, "student already registered")

    if len(photos) > 5:
        raise HTTPException(400, "maximum 5 registration photos allowed")

    try:
        import face_recognition
    except ImportError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "face recognition service not available on this server",
        )

    import asyncio
    loop = asyncio.get_running_loop()

    embeddings: List[List[float]] = []

    for i, photo in enumerate(photos):
        contents = await photo.read()
        arr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(400, f"invalid image in photo {i + 1}")

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

        encodings = await loop.run_in_executor(
            None, lambda rgb=rgb: face_recognition.face_encodings(rgb)
        )

        if not encodings:
            raise HTTPException(422, f"no face detected in photo {i + 1}")

        embeddings.append(encodings[0].tolist())
        # img / rgb go out of scope here — never written to disk or cloud

    student = models.Student(
        matricNumber=matricNumber,
        fullName=fullName,
        embeddings=embeddings,
    )
    inserted_id = await database.add_student(student)

    return {
        "success": True,
        "message": "student registered",
        "data": {"id": inserted_id, "photosProcessed": len(embeddings)},
    }


@app.get("/students", response_model=schemas.ResponseModel)
async def list_students():
    docs = await database.list_students()
    # Strip embeddings from the list response — large and not useful to display
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
    """Withdraw biometric consent — deletes stored face vectors.
    The student record itself is kept; only embeddings are wiped."""
    ok = await database.delete_student_embeddings(matricNumber)
    if not ok:
        raise HTTPException(404, "student not found")
    return {
        "success": True,
        "message": "biometric data deleted",
        "data": None,
    }


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
    course = await database.get_course_by_courseCode(req.courseCode)
    if not course:
        raise HTTPException(404, "course not found")

    classroom = await database.get_classroom_by_classId(req.classId)
    if not classroom:
        raise HTTPException(404, "classroom not found")

    # Enforce one active session per classroom at a time
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
        classroomName=classroom.className,
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
    """Manually mark a student present or absent.
    Overrides auto-recognition for this student in this session."""
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
    """Resolve a course registrationToken to a course object.
    Called by the student registration page on load."""
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
    """Return all students enrolled in a course with their profile details."""
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    students = await database.get_enrolled_students_details(courseCode)
    return {"success": True, "message": "ok", "data": {"students": students}}


# -------------------------------------------------------
# COURSE-SCOPED STUDENT REGISTRATION  (with face_recognition)
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
    """Student self-registration. Validates consent, extracts face embeddings
    from uploaded photos (in memory only — never saved), creates enrollment."""
    if biometricConsent != "true":
        raise HTTPException(422, "biometric consent is required")
    if manualAltConsent != "true":
        raise HTTPException(422, "manual alternative acknowledgment is required")
    if ageConsent != "true":
        raise HTTPException(422, "age declaration is required")

    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")

    matric = matricNumber.strip().upper()

    existing_enrollment = await database.get_enrollment(courseCode, matric)
    if existing_enrollment:
        raise HTTPException(409, "already registered for this course")

    if len(photos) > 5:
        raise HTTPException(400, "maximum 5 registration photos allowed")

    try:
        import face_recognition
    except ImportError:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "face recognition service not available on this server",
        )

    import asyncio
    loop = asyncio.get_running_loop()

    embeddings: List[List[float]] = []
    for i, photo in enumerate(photos):
        contents = await photo.read()
        arr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(400, f"invalid image in photo {i + 1}")
        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        encodings = await loop.run_in_executor(
            None, lambda rgb=rgb: face_recognition.face_encodings(rgb)
        )
        if not encodings:
            raise HTTPException(422, f"no face detected in photo {i + 1}")
        embeddings.append(encodings[0].tolist())

    await database.upsert_student_with_embeddings(matric, fullName.strip(), embeddings)

    enrollment = models.Enrollment(courseCode=courseCode, matricNumber=matric)
    await database.add_enrollment(enrollment)

    return {
        "success": True,
        "message": "registered",
        "data": {
            "student": {
                "matricNumber": matric,
                "courseCode": courseCode,
                "registeredAt": datetime.now().isoformat(),
            }
        },
    }


# -------------------------------------------------------
# COURSE-SCOPED BIOMETRICS DELETION
# -------------------------------------------------------
@app.delete("/courses/{courseCode}/students/biometrics", response_model=schemas.ResponseModel)
async def delete_course_student_biometrics(courseCode: str, req: schemas.DeleteBiometricsRequest):
    """Delete a student's face embeddings for consent withdrawal (NDPA s.36).
    Body: { matricNumber: string }"""
    matric = req.matricNumber.strip().upper()
    ok = await database.delete_student_embeddings_for_course(courseCode, matric)
    if not ok:
        raise HTTPException(404, "student enrollment not found")
    return {"success": True, "message": "biometric data deleted", "data": None}


# -------------------------------------------------------
# SESSION END — POST alias (frontend uses POST, core logic is PUT)
# -------------------------------------------------------
@app.post("/sessions/{sessionId}/end", response_model=schemas.ResponseModel)
async def end_session_post(sessionId: str):
    """POST alias for ending a session — some clients prefer POST over PUT."""
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
    """Set a single student's attendance status. Body: { status: 'present' | 'absent' }
    Sets manuallyOverridden=True so face recognition won't overwrite it."""
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
# ON-DEMAND CAPTURE  (returns current attendance state)
# Face recognition runs automatically via /classrooms/{classId}/image.
# This endpoint just returns the latest attendance for the active session.
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
    """Public endpoint — no auth required.
    Returns attendance summary across all courses for a student."""
    matric = matricNumber.strip().upper()
    results = await database.get_student_portal_summary(matric)
    if not results:
        raise HTTPException(404, "no student found with this matric number")
    return {"success": True, "message": "ok", "data": {"results": results}}
