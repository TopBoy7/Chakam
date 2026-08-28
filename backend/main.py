from fastapi import (
    FastAPI, HTTPException, status,
    UploadFile, File, Form, Response, WebSocket, WebSocketDisconnect, Query,
    BackgroundTasks, Depends
)
from fastapi.middleware.cors import CORSMiddleware

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from typing import List, Optional
from io import BytesIO
import asyncio
import json
import os
import cv2
import numpy as np
import logging
import time
import uuid

import database, models, schemas, env, auth
from send_email import EmailService


# Who receives capacity-exceeded alerts. Override with the ALERT_EMAIL env var.
ALERT_EMAIL = os.getenv("ALERT_EMAIL", "okefejoseph9@gmail.com")

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
# ROBUST FACE ENCODING (registration)
# -------------------------------------------------------
def extract_face_encodings(contents: bytes):
    """Extract face encodings from raw image bytes, tolerant of the two things
    that most often cause a false 'no face detected' on a photo that clearly has
    a face:

      1. Phone-photo EXIF rotation — the pixels are stored sideways with an
         orientation flag; face_recognition/OpenCV ignore that flag, so the
         detector sees a rotated face and misses it. We apply exif_transpose.
      2. The default HOG detector being too weak for smaller / slightly angled
         faces. We retry with more upsampling, then fall back to the CNN model.

    Runs synchronously (CPU-bound) — call it via run_in_executor.
    Returns a list of 128-float encodings (empty if truly no face).
    """
    import face_recognition
    from PIL import Image, ImageOps

    img = Image.open(BytesIO(contents))
    img = ImageOps.exif_transpose(img)          # honour phone orientation
    img = img.convert("RGB")

    # Cap very large uploads so detection stays fast and consistent.
    if max(img.size) > 1600:
        img.thumbnail((1600, 1600))

    rgb = np.array(img)

    # Progressive detection: cheap HOG first, then more upsampling, then CNN.
    for model, upsample in (("hog", 1), ("hog", 2), ("cnn", 1)):
        try:
            locations = face_recognition.face_locations(
                rgb, number_of_times_to_upsample=upsample, model=model
            )
        except Exception:
            locations = []
        if locations:
            return face_recognition.face_encodings(rgb, known_face_locations=locations)

    return []


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

    def join(self, ws: WebSocket):
        """Register an already-accepted, already-authenticated socket."""
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
from fastapi.responses import JSONResponse
from fastapi import Request

app = FastAPI(title="Smart Classroom - FastAPI + YOLO + MongoDB")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )


@app.on_event("startup")
async def create_indexes():
    await database.create_auth_indexes()


@app.get("/healthz")
async def healthz():
    """Health probe for the Azure load balancer / uptime monitor."""
    return {
        "status": "ok",
        "service": "smart-classroom-api",
        "timestamp": datetime.utcnow().isoformat(),
    }


# -------------------------------------------------------
# WEBSOCKET ENDPOINT
# -------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    # Browsers can't set headers on a WS handshake, so the token travels as the
    # first message instead. The server closes any connection that hasn't
    # authenticated within 5 seconds.
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
        token = json.loads(first).get("token", "")
        claims = auth.decode_token(token)
        user = await database.get_user_by_email(claims.get("sub", ""))
        if not user or user.status == "suspended":
            raise ValueError("invalid or suspended user")
    except Exception:
        await ws.close(code=4001)
        return

    manager.join(ws)
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
async def create_classroom(
    req: schemas.CreateClassroomRequest,
    _admin: models.User = Depends(auth.require_role("admin")),
):
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
async def get_classrooms(_user: models.User = Depends(auth.require_role(*auth.ACTIVE_ROLES))):
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
async def get_classroom(
    classId: str,
    _user: models.User = Depends(auth.require_role(*auth.ACTIVE_ROLES)),
):
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
async def update_classroom(
    classId: str,
    req: schemas.UpdateClassroomRequest,
    background_tasks: BackgroundTasks,
    _admin: models.User = Depends(auth.require_role("admin")),
):
    payload = {k: v for k, v in req.model_dump().items() if v is not None}
    existing = await database.get_classroom_by_classId(classId)
    if not existing:
        raise HTTPException(404, "classroom not found")

    if not payload:
        raise HTTPException(400, "no fields to update")

    if "classId" in payload and payload["classId"] != classId:
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

    try:
        occupancy_after = updated.occupancy
        capacity_after = updated.capacity
        class_name = updated_dict.get("className") or "Unknown Classroom"

        if (
            occupancy_after is not None
            and capacity_after is not None
            and occupancy_after > capacity_after
        ):
            background_tasks.add_task(
                EmailService.send_occupancy_alert,
                to_email=ALERT_EMAIL,
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


# -------------------------------------------------------
# DELETE CLASSROOM
# -------------------------------------------------------
@app.delete("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def delete_classroom(
    classId: str,
    _admin: models.User = Depends(auth.require_role("admin")),
):
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
async def upload_image(
    classId: str,
    background_tasks: BackgroundTasks,
    deviceId: str = Form(...),
    file: UploadFile = File(...),
):
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
    # conf=0.5 (was 0.25) and augment off — at 0.25 the nano model was counting
    # low-confidence partial detections (limbs, background clutter) as extra
    # people; a single person in frame was reading as 2-4. augment=True's
    # multi-scale merging made this worse, letting one person generate
    # several overlapping low-confidence boxes NMS didn't fully collapse.
    t_infer_start = time.perf_counter()
    results = await loop.run_in_executor(
        None,
        lambda: model.predict(img, imgsz=1920, conf=0.5, iou=0.45)
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
            present_count = sum(1 for a in active_session.attendees if a.present) + len(newly_marked)
            session_label = f"Session: {active_session.courseCode} | Present: {present_count}"
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

    # Capacity alert: fire when MORE people are detected than the room allows.
    # (occupancy is stored capped at capacity, so we compare the raw detected count.)
    try:
        if person_count > classroom.capacity:
            background_tasks.add_task(
                EmailService.send_occupancy_alert,
                to_email=ALERT_EMAIL,
                class_id=classId,
                class_name=classroom.className or "Unknown Classroom",
                occupancy=person_count,
                capacity=classroom.capacity,
            )
    except Exception as e:
        logger.exception("Failed to schedule occupancy alert email: %s", e)

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
async def create_lecturer(
    req: schemas.CreateLecturerRequest,
    _admin: models.User = Depends(auth.require_role("admin")),
):
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
async def list_lecturers(_admin: models.User = Depends(auth.require_role("admin"))):
    docs = await database.list_lecturers()
    return {
        "success": True,
        "message": "ok",
        "data": {"lecturers": [d.model_dump() for d in docs]},
    }


@app.get("/lecturers/{staffId}", response_model=schemas.ResponseModel)
async def get_lecturer(
    staffId: str,
    _admin: models.User = Depends(auth.require_role("admin")),
):
    doc = await database.get_lecturer_by_staffId(staffId)
    if not doc:
        raise HTTPException(404, "lecturer not found")
    return {
        "success": True,
        "message": "ok",
        "data": {"lecturer": doc.model_dump()},
    }


@app.delete("/lecturers/{staffId}", response_model=schemas.ResponseModel)
async def delete_lecturer(
    staffId: str,
    _admin: models.User = Depends(auth.require_role("admin")),
):
    ok = await database.delete_lecturer_by_staffId(staffId)
    if not ok:
        raise HTTPException(404, "lecturer not found")
    return {"success": True, "message": "deleted", "data": None}


# -------------------------------------------------------
# COURSES
# -------------------------------------------------------
@app.post("/courses", response_model=schemas.ResponseModel, status_code=status.HTTP_201_CREATED)
async def create_course(
    req: schemas.CreateCourseRequest,
    user: models.User = Depends(auth.require_role("lecturer", "admin")),
):
    existing = await database.get_course_by_courseCode(req.courseCode)
    if existing:
        raise HTTPException(409, "courseCode already exists")

    payload = req.model_dump()
    if user.role == "lecturer":
        # A lecturer creating a course always becomes its lecturer — never let
        # the request body assign the course to someone else.
        if not user.staffId:
            raise HTTPException(403, "your account is not linked to a lecturer profile")
        payload["lecturerId"] = user.staffId
    elif payload.get("lecturerId"):
        lecturer = await database.get_lecturer_by_staffId(payload["lecturerId"])
        if not lecturer:
            raise HTTPException(404, "lecturer not found")

    course = models.Course(
        **payload,
        registrationToken=await database.generate_unique_registration_code(),
    )
    inserted_id = await database.add_course(course)

    return {
        "success": True,
        "message": "course created",
        "data": {"id": inserted_id},
    }


@app.get("/courses", response_model=schemas.ResponseModel)
async def list_courses(
    lecturerId: Optional[str] = Query(default=None),
    _user: models.User = Depends(auth.require_role(*auth.ACTIVE_ROLES)),
):
    docs = await database.list_courses(lecturerId=lecturerId)
    return {
        "success": True,
        "message": "ok",
        "data": {"courses": [d.model_dump() for d in docs]},
    }


@app.get("/courses/{courseCode}", response_model=schemas.ResponseModel)
async def get_course(
    courseCode: str,
    _user: models.User = Depends(auth.require_role(*auth.ACTIVE_ROLES)),
):
    doc = await database.get_course_by_courseCode(courseCode)
    if not doc:
        raise HTTPException(404, "course not found")
    return {
        "success": True,
        "message": "ok",
        "data": {"course": doc.model_dump()},
    }


@app.put("/courses/{courseCode}", response_model=schemas.ResponseModel)
async def update_course(
    courseCode: str,
    req: schemas.UpdateCourseRequest,
    _admin: models.User = Depends(auth.require_role("admin")),
):
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
async def delete_course(
    courseCode: str,
    _admin: models.User = Depends(auth.require_role("admin")),
):
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
    _admin: models.User = Depends(auth.require_role("admin")),
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

        try:
            encodings = await loop.run_in_executor(
                None, lambda c=contents: extract_face_encodings(c)
            )
        except Exception as exc:
            raise HTTPException(400, f"could not process photo {i + 1}: {exc}")

        if not encodings:
            raise HTTPException(422, f"no face detected in photo {i + 1}")

        embeddings.append(encodings[0].tolist())
        # contents / decoded image go out of scope here — never written to disk or cloud

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
async def list_students(_admin: models.User = Depends(auth.require_role("admin"))):
    docs = await database.list_students()
    # Strip embeddings from the list response — large and not useful to display
    safe = [
        {k: v for k, v in d.model_dump().items() if k != "embeddings"}
        for d in docs
    ]
    return {"success": True, "message": "ok", "data": {"students": safe}}


@app.get("/students/{matricNumber}", response_model=schemas.ResponseModel)
async def get_student(
    matricNumber: str,
    _user: models.User = Depends(auth.require_self_or_admin),
):
    doc = await database.get_student_by_matric(matricNumber)
    if not doc:
        raise HTTPException(404, "student not found")
    safe = {k: v for k, v in doc.model_dump().items() if k != "embeddings"}
    return {"success": True, "message": "ok", "data": {"student": safe}}


@app.delete("/students/{matricNumber}/embeddings", response_model=schemas.ResponseModel)
async def delete_student_embeddings(
    matricNumber: str,
    _user: models.User = Depends(auth.require_self_or_admin),
):
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
async def enroll_student(
    courseCode: str,
    req: schemas.EnrollStudentRequest,
    user: models.User = Depends(auth.get_current_user),
):
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    auth.assert_course_access(course, user)

    matric = req.matricNumber.strip().upper()

    student = await database.get_student_by_matric(matric)
    if not student:
        full_name = (req.fullName or "").strip()
        if not full_name:
            raise HTTPException(
                422,
                "student has no biometric record — provide fullName to enroll "
                "them without face registration (they'll be marked present manually)",
            )
        # Manual-only student: no embeddings, never auto-matched by the
        # recognition pipeline (get_students_for_recognition filters on
        # embeddings existing and non-empty) — the lecturer marks them by hand.
        manual_student = models.Student(
            matricNumber=matric,
            fullName=full_name,
            embeddings=[],
            biometricConsent=False,
            manualAltConsent=True,
            ageConsent=False,
        )
        await database.add_student(manual_student)

    existing = await database.get_enrollment(courseCode, matric)
    if existing:
        raise HTTPException(409, "student already enrolled in this course")

    enrollment = models.Enrollment(courseCode=courseCode, matricNumber=matric)
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
async def unenroll_student(
    courseCode: str,
    matricNumber: str,
    user: models.User = Depends(auth.get_current_user),
):
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    auth.assert_course_access(course, user)

    ok = await database.delete_enrollment(courseCode, matricNumber)
    if not ok:
        raise HTTPException(404, "enrollment not found")
    return {"success": True, "message": "unenrolled", "data": None}


@app.get("/courses/{courseCode}/enrollments", response_model=schemas.ResponseModel)
async def list_course_enrollments(
    courseCode: str,
    user: models.User = Depends(auth.get_current_user),
):
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    auth.assert_course_access(course, user)

    enrollments = await database.list_enrollments_by_course(courseCode)
    return {
        "success": True,
        "message": "ok",
        "data": {"enrollments": [e.model_dump() for e in enrollments]},
    }


@app.get("/students/{matricNumber}/enrollments", response_model=schemas.ResponseModel)
async def list_student_enrollments(
    matricNumber: str,
    _user: models.User = Depends(auth.require_self_or_admin),
):
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
async def start_session(
    req: schemas.StartSessionRequest,
    user: models.User = Depends(auth.get_current_user),
):
    course = await database.get_course_by_courseCode(req.courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    auth.assert_course_access(course, user)

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
    user: models.User = Depends(auth.require_role("lecturer", "admin")),
):
    # No single course to check against an unfiltered/classId-only listing —
    # ownership is only enforced when the caller filters by a specific course.
    if courseCode:
        course = await database.get_course_by_courseCode(courseCode)
        if not course:
            raise HTTPException(404, "course not found")
        auth.assert_course_access(course, user)

    docs = await database.list_sessions(classId=classId, courseCode=courseCode, status=status)
    return {
        "success": True,
        "message": "ok",
        "data": {"sessions": [d.model_dump() for d in docs]},
    }


@app.get("/sessions/{sessionId}", response_model=schemas.ResponseModel)
async def get_session(
    sessionId: str,
    user: models.User = Depends(auth.get_current_user),
):
    doc = await database.get_session_by_sessionId(sessionId)
    if not doc:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(doc, user)
    return {
        "success": True,
        "message": "ok",
        "data": {"session": doc.model_dump()},
    }


@app.put("/sessions/{sessionId}/end", response_model=schemas.ResponseModel)
async def end_session(
    sessionId: str,
    user: models.User = Depends(auth.get_current_user),
):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(session, user)
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
async def get_attendance(
    sessionId: str,
    user: models.User = Depends(auth.get_current_user),
):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(session, user)
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
            "totalPresent": sum(1 for a in session.attendees if a.present),
        },
    }


@app.post("/sessions/{sessionId}/attendance", response_model=schemas.ResponseModel)
async def manual_attendance(
    sessionId: str,
    req: schemas.ManualAttendanceRequest,
    user: models.User = Depends(auth.get_current_user),
):
    """Manually mark a student present or absent.
    Overrides auto-recognition for this student in this session."""
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(session, user)

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
async def resolve_registration_token(
    token: str,
    _user: models.User = Depends(auth.require_role("student")),
):
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
async def list_enrolled_students(
    courseCode: str,
    user: models.User = Depends(auth.get_current_user),
):
    """Return all students enrolled in a course with their profile details."""
    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")
    auth.assert_course_access(course, user)
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
    biometricConsent: str = Form(...),
    manualAltConsent: str = Form(...),
    ageConsent: str = Form(...),
    photos: List[UploadFile] = File(...),
    user: models.User = Depends(auth.require_role("student")),
):
    """Student self-registration. Matric number and full name come from the
    authenticated user's own token — never from the request — so a student
    can only ever register their own face. Validates consent, extracts face
    embeddings from uploaded photos (in memory only — never saved), creates
    enrollment."""
    if biometricConsent != "true":
        raise HTTPException(422, "biometric consent is required")
    if manualAltConsent != "true":
        raise HTTPException(422, "manual alternative acknowledgment is required")
    if ageConsent != "true":
        raise HTTPException(422, "age declaration is required")

    course = await database.get_course_by_courseCode(courseCode)
    if not course:
        raise HTTPException(404, "course not found")

    matric = user.matricNumber
    fullName = user.fullName

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
        try:
            encodings = await loop.run_in_executor(
                None, lambda c=contents: extract_face_encodings(c)
            )
        except Exception as exc:
            raise HTTPException(400, f"could not process photo {i + 1}: {exc}")
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
async def delete_course_student_biometrics(
    courseCode: str,
    req: schemas.DeleteBiometricsRequest,
    user: models.User = Depends(auth.get_current_user),
):
    """Delete a student's face embeddings for consent withdrawal (NDPA s.34).
    Body: { matricNumber: string }"""
    matric = req.matricNumber.strip().upper()
    if user.role != "admin" and user.matricNumber != matric:
        raise HTTPException(403, "not permitted")
    ok = await database.delete_student_embeddings_for_course(courseCode, matric)
    if not ok:
        raise HTTPException(404, "student enrollment not found")
    return {"success": True, "message": "biometric data deleted", "data": None}


# -------------------------------------------------------
# SESSION END — POST alias (frontend uses POST, core logic is PUT)
# -------------------------------------------------------
@app.post("/sessions/{sessionId}/end", response_model=schemas.ResponseModel)
async def end_session_post(
    sessionId: str,
    user: models.User = Depends(auth.get_current_user),
):
    """POST alias for ending a session — some clients prefer POST over PUT."""
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(session, user)
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
async def update_student_attendance(
    sessionId: str,
    matricNumber: str,
    req: dict,
    user: models.User = Depends(auth.get_current_user),
):
    """Set a single student's attendance status. Body: { status: 'present' | 'absent' }
    Sets manuallyOverridden=True so face recognition won't overwrite it."""
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(session, user)

    status_value = req.get("status")
    if status_value not in {"present", "absent"}:
        raise HTTPException(400, "status must be 'present' or 'absent'")

    present = status_value == "present"
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
async def capture_attendance(
    sessionId: str,
    user: models.User = Depends(auth.get_current_user),
):
    session = await database.get_session_by_sessionId(sessionId)
    if not session:
        raise HTTPException(404, "session not found")
    await auth.assert_session_access(session, user)
    if session.status != "active":
        raise HTTPException(400, "session is not active")

    records = [
        {
            "id": a.matricNumber,
            "sessionId": sessionId,
            "studentId": a.matricNumber,
            "matricNumber": a.matricNumber,
            "status": "present" if a.present else "absent",
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
async def student_portal_lookup(
    matricNumber: str,
    _user: models.User = Depends(auth.require_self_or_admin),
):
    """Returns attendance summary across all courses for a student. Reads the
    matric number from the caller's own token; an explicit matric belonging
    to someone else is only permitted for an admin (NDPA s.34 right of access
    — this is now delivered to the verified data subject, not any caller who
    knows a matric number)."""
    matric = matricNumber.strip().upper()
    results = await database.get_student_portal_summary(matric)
    if not results:
        raise HTTPException(404, "no student found with this matric number")

    target_user = await database.get_user_by_matric(matric)
    identity = {
        "email": target_user.email if target_user else None,
        "role": target_user.role if target_user else None,
        "emailVerifiedAt": target_user.emailVerifiedAt.isoformat() if target_user else None,
        "lastLoginAt": target_user.lastLoginAt.isoformat() if target_user and target_user.lastLoginAt else None,
    }
    return {"success": True, "message": "ok", "data": {"results": results, "identity": identity}}


# =========================================================
# AUTHENTICATION (Phase 1 — not yet enforced on any route above)
# =========================================================
def _user_out(user: models.User) -> dict:
    return {
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "matricNumber": user.matricNumber,
        "staffId": user.staffId,
        "fullName": user.fullName,
        "emailVerifiedAt": user.emailVerifiedAt.isoformat(),
        "createdAt": user.createdAt.isoformat(),
        "lastLoginAt": user.lastLoginAt.isoformat() if user.lastLoginAt else None,
    }


@app.post("/auth/request-code", response_model=schemas.ResponseModel)
async def request_code(req: schemas.RequestCodeRequest, request: Request):
    email = auth.normalize_email(req.email)
    classification = await auth.classify_email(email)
    if classification is None:
        raise HTTPException(403, "must be a UNILAG address")

    client_ip = request.client.host if request.client else "unknown"
    auth.check_request_code_rate_limit(email, client_ip)

    await database.invalidate_codes_for_email(email)
    code = auth.generate_code()
    expires_at = auth.utcnow() + timedelta(minutes=auth.LOGIN_CODE_TTL_MINUTES)
    await database.create_login_code(email, auth.hash_code(code), expires_at)
    EmailService.send_login_code(email, code, auth.LOGIN_CODE_TTL_MINUTES)

    return {
        "success": True,
        "message": "If this address is eligible, a login code has been sent.",
        "data": None,
    }


@app.post("/auth/verify-code", response_model=schemas.ResponseModel)
async def verify_code(req: schemas.VerifyCodeRequest):
    email = auth.normalize_email(req.email)
    code = req.code.strip()

    login_code = await database.get_active_login_code(email)
    if not login_code or login_code.expiresAt < auth.utcnow():
        raise HTTPException(400, "invalid or expired code")

    if login_code.attempts >= auth.MAX_VERIFY_ATTEMPTS:
        raise HTTPException(429, "too many attempts, request a new code")

    if not auth.verify_code(code, login_code.codeHash):
        await database.increment_code_attempts(login_code.id)
        raise HTTPException(400, "invalid or expired code")

    await database.consume_login_code(login_code.id)

    classification = await auth.classify_email(email)
    if classification is None:
        raise HTTPException(403, "must be a UNILAG address")
    role, matricNumber, staffId = classification

    user = await database.get_user_by_email(email)
    if not user:
        user = models.User(
            email=email,
            role=role,
            matricNumber=matricNumber,
            staffId=staffId,
        )
        await database.create_user(user)
        user = await database.get_user_by_email(email)
    elif email in env.ADMIN_EMAILS and user.role != "admin":
        # Re-asserted on every login per §3.5 — removing an address from
        # ADMIN_EMAILS does not silently demote it; that must be explicit.
        await database.update_user_role(email, "admin")
        user = await database.get_user_by_email(email)

    await database.update_last_login(email)
    user.lastLoginAt = auth.utcnow()

    token = auth.create_token(user)
    return {
        "success": True,
        "message": "ok",
        "data": {"token": token, "user": _user_out(user)},
    }


@app.get("/auth/me", response_model=schemas.ResponseModel)
async def get_me(user: models.User = Depends(auth.get_current_user)):
    return {"success": True, "message": "ok", "data": {"user": _user_out(user)}}


@app.patch("/auth/me", response_model=schemas.ResponseModel)
async def update_me(
    req: schemas.UpdateMeRequest, user: models.User = Depends(auth.get_current_user)
):
    updated = await database.update_user_fullname(user.email, req.fullName)
    return {"success": True, "message": "ok", "data": {"user": _user_out(updated)}}


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout():
    # Stateless JWTs — the client discards the token. Present for symmetry and
    # for a future revocation list.
    return None


@app.get("/admin/users", response_model=schemas.ResponseModel)
async def list_users(
    role: Optional[str] = Query(None),
    _admin: models.User = Depends(auth.require_role("admin")),
):
    docs = await database.list_users_by_role(role)
    return {"success": True, "message": "ok", "data": {"users": [_user_out(d) for d in docs]}}


@app.put("/admin/users/{email}/role", response_model=schemas.ResponseModel)
async def assign_role(
    email: str,
    req: schemas.AssignRoleRequest,
    admin: models.User = Depends(auth.require_role("admin")),
):
    target_email = auth.normalize_email(email)
    if target_email == admin.email and req.role != "admin":
        raise HTTPException(403, "cannot demote your own account")

    updated = await database.update_user_role(
        target_email, req.role, staffId=req.staffId, fullName=req.fullName,
        roleAssignedBy=admin.email,
    )
    if not updated:
        raise HTTPException(404, "user not found")

    if req.role == "lecturer" and req.staffId:
        existing = await database.get_lecturer_by_staffId(req.staffId)
        if not existing:
            lecturer = models.Lecturer(
                staffId=req.staffId,
                fullName=req.fullName or updated.fullName or target_email,
                email=target_email,
            )
            await database.add_lecturer(lecturer)

    return {"success": True, "message": "ok", "data": {"user": _user_out(updated)}}


@app.put("/admin/users/{email}/status", response_model=schemas.ResponseModel)
async def set_user_status(
    email: str,
    req: schemas.SetStatusRequest,
    _admin: models.User = Depends(auth.require_role("admin")),
):
    updated = await database.update_user_status(auth.normalize_email(email), req.status)
    if not updated:
        raise HTTPException(404, "user not found")
    return {"success": True, "message": "ok", "data": {"user": _user_out(updated)}}
