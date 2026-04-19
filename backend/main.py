from fastapi import (
    FastAPI, HTTPException, status,
    UploadFile, File, Form, Response, WebSocket, WebSocketDisconnect
)
from fastapi.middleware.cors import CORSMiddleware

from datetime import datetime
from zoneinfo import ZoneInfo

from typing import List
from io import BytesIO
import cv2
import numpy as np
import logging
import time

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
        # Check for classId uniqueness
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

    # WebSocket push
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
# YOLO IMAGE + CLOUDINARY + BROADCAST
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

    # Lazy load YOLO if not already
    model = getattr(app.state, "yolo_model", None)
    if model is None:
        model = await loop.run_in_executor(None, lambda: YOLO("yolov8n.pt"))
        app.state.yolo_model = model

    # Run YOLO in executor to avoid blocking
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
    # Annotation color: matches the frontend background hsl(38 38% 94%) = RGB(246,241,234) = BGR(234,241,246)
    ANNOTATION_COLOR = (234, 241, 246)

    # Overlay text: occupancy / capacity
    label = f"Occupancy: {new_occupancy}/{classroom.capacity}"
    cv2.putText(img, label, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, ANNOTATION_COLOR, 3)

    # Overlay timestamp
    cv2.putText(img, timestamp, (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, ANNOTATION_COLOR, 2)

    # Encode annotated image to bytes
    _, encoded = cv2.imencode(".jpg", img)
    annotated_bytes = encoded.tobytes()

    # Upload annotated image to Cloudinary
    t_cloudinary_start = time.perf_counter()
    upload_result = cloudinary.uploader.upload(annotated_bytes, folder="smart_classrooms")
    new_url = upload_result["secure_url"]
    cloudinary_ms = (time.perf_counter() - t_cloudinary_start) * 1000

    # Delete old image if exists
    if classroom.latestImage:
        public_id = "/".join(classroom.latestImage.split("/")[-2:]).split(".")[0]
        try:
            cloudinary.uploader.destroy(public_id)
        except:
            pass

    # Update DB
    t_db_start = time.perf_counter()
    await database.update_classroom_by_classId(classId, {"occupancy": new_occupancy, "latestImage": new_url})
    updated = await database.get_classroom_by_classId(classId)
    db_ms = (time.perf_counter() - t_db_start) * 1000

    # prepare payload: ensure _id is a string and datetimes are serializable
    updated_dict = updated.model_dump()
    if "_id" in updated_dict:
        try:
            updated_dict["_id"] = str(updated_dict["_id"])
        except Exception:
            updated_dict["_id"] = updated_dict["_id"]
    # convert datetimes if present
    for dt_key in ("createdAt", "updatedAt"):
        if dt_key in updated_dict and updated_dict[dt_key] is not None:
            try:
                updated_dict[dt_key] = updated_dict[dt_key].isoformat()
            except Exception:
                pass

    logger.info("Broadcast payload prepared for classroom_image_update: %s", updated_dict)

    # Broadcast via WebSocket.
    t_ws_start = time.perf_counter()
    await manager.broadcast(serialize({
        "event": "classroom_image_update",
        "classroom": updated_dict
    }))
    ws_ms = (time.perf_counter() - t_ws_start) * 1000

    total_ms = (time.perf_counter() - t_total_start) * 1000

    metrics = {
        "decode_ms": round(decode_ms, 2),
        "inference_ms": round(inference_ms, 2),
        "cloudinary_ms": round(cloudinary_ms, 2),
        "db_ms": round(db_ms, 2),
        "ws_broadcast_ms": round(ws_ms, 2),
        "total_ms": round(total_ms, 2),
    }

    # Return updated classroom JSON only
    return schemas.ResponseModel(
        success=True,
        message="classroom image updated",
        data={"classroom": updated.model_dump(), "metrics": metrics}
    ).model_dump()


# ===============================================================================
# ATTENDANCE MODULE — FACIAL RECOGNITION PIPELINE
# ===============================================================================
# This section documents how the attendance router should work end-to-end.
# Implement this in a separate file (e.g. attendance_router.py) and include
# it in this app with:
#   app.include_router(attendance_router, prefix="/attendance")
#
# Install the required library:
#   pip install face_recognition
# face_recognition is built on dlib. On some systems you may need to install
# dlib separately first:
#   pip install dlib        (requires cmake and a C++ compiler)
#   OR use a pre-built wheel for your Python/OS version.
#
# -------------------------------------------------------------------------------
# HOW THE PIPELINE WORKS — TWO MODELS, TWO SEPARATE JOBS
# -------------------------------------------------------------------------------
# YOLOv8 (already running above):
#   Counts HOW MANY people are in the room → occupancy / headcount.
#   Not involved in attendance at all.
#
# face_recognition (dlib):
#   Identifies WHO those people are → marks them present by name/matric number.
#   This is the brain of the attendance pipeline.
#
# -------------------------------------------------------------------------------
# STEP 1 — REGISTRATION: EXTRACT AND STORE THE EMBEDDING
# -------------------------------------------------------------------------------
# When a student uploads their photo(s) on the registration page, the backend
# must process each photo in memory and extract a 128-dimensional face embedding.
# The photo is discarded immediately after extraction — never saved anywhere.
# Only the 128-float vector goes into MongoDB.
#
# import face_recognition
# import numpy as np
# import cv2
#
# async def register_student(photos, matric_number, course_id):
#     embeddings = []
#
#     for i, photo in enumerate(photos):
#         contents = await photo.read()
#         arr = np.frombuffer(contents, np.uint8)
#         img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
#
#         # face_recognition expects RGB — OpenCV gives BGR, so convert first
#         rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
#
#         encodings = face_recognition.face_encodings(rgb)
#
#         if not encodings:
#             raise HTTPException(422, f"No face detected in photo {i + 1}")
#
#         embeddings.append(encodings[0].tolist())   # 128 floats as plain list
#         # img goes out of scope here — never written to disk or cloud
#
#     await db.students.insert_one({
#         "matricNumber":      matric_number,
#         "courseId":          course_id,
#         "embeddings":        embeddings,   # list of up to 5 × 128-float lists
#         "biometricConsent":  True,
#         "manualAltConsent":  True,
#         "ageConsent":        True,
#         "consentTimestamp":  datetime.utcnow(),
#         "consentVersion":    "1.0",
#         "embeddingsDeleted": False,
#         "registeredAt":      datetime.utcnow(),
#     })
#
# face_encodings() returns a list of 128-float vectors, one per face found in
# the image. If the student uploaded 5 photos you get up to 5 vectors, each
# capturing a different angle or lighting condition. Storing all of them is what
# makes recognition robust — a student who looks different on a bad hair day
# still gets matched by their best embedding.
#
# -------------------------------------------------------------------------------
# STEP 2 — ATTENDANCE CAPTURE: MATCH FACES IN THE CLASSROOM SNAPSHOT
# -------------------------------------------------------------------------------
# When the lecturer clicks "Take Attendance", the frontend calls
# POST /attendance/sessions/:sessionId/capture. This endpoint must:
#
#   1. Get a snapshot from the ESP32-CAM for the session's classroom.
#      (Signal the device by deviceId — implementation detail: HTTP, MQTT, etc.)
#      Recommendation: capture 2–3 frames over ~90 seconds and union the results
#      to guard against a single bad frame (blinks, movement, occlusion).
#
#   2. Detect every face in the classroom image.
#
#   3. Load all registered student embeddings for this course from MongoDB
#      (skip any student where embeddingsDeleted == True — they opted out).
#
#   4. For each detected face, compute the distance to every stored embedding.
#      The student with the lowest distance below the threshold is the match.
#
#   5. Mark matched students present. Respect manuallyOverridden — if a lecturer
#      has already set a record manually, do not overwrite it.
#
# async def capture_attendance(session_id):
#     session = await db.sessions.find_one({"_id": session_id})
#     if session["status"] != "active":
#         raise HTTPException(400, "Session is not active")
#
#     # 1. Get snapshot from ESP32-CAM
#     snapshot_bytes = await signal_camera_and_wait(session["classroomId"])
#
#     arr = np.frombuffer(snapshot_bytes, np.uint8)
#     img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
#     rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
#
#     # 2. Detect every face in the classroom image
#     face_locations  = face_recognition.face_locations(rgb)          # bounding boxes
#     classroom_faces = face_recognition.face_encodings(rgb, face_locations)
#
#     # 3. Load all eligible student embeddings for this course
#     students = await db.students.find({
#         "courseId":          session["courseId"],
#         "embeddingsDeleted": {"$ne": True},
#     }).to_list(None)
#
#     # 4. Match each detected face against every student's stored embeddings
#     for detected in classroom_faces:
#         best_match   = None
#         best_distance = 1.0   # worst possible distance
#
#         for student in students:
#             known = [np.array(e) for e in student["embeddings"]]
#
#             # face_distance returns one value per stored embedding.
#             # A student with 5 registration photos gets 5 distances — take the best.
#             distances = face_recognition.face_distance(known, detected)
#             d = float(min(distances))
#
#             if d < best_distance:
#                 best_distance = d
#                 best_match    = student
#
#         # Threshold: 0.55 is slightly tighter than the library default of 0.6.
#         # Lower = stricter (fewer false positives). Tune during testing.
#         if best_match and best_distance < 0.55:
#             await mark_present(session_id, best_match["matricNumber"])
#
#     # 5. Return full updated attendance list
#     records = await db.attendance.find({"sessionId": session_id}).to_list(None)
#     return {"data": {"records": records}}
#
# -------------------------------------------------------------------------------
# END-TO-END DATA FLOW SUMMARY
# -------------------------------------------------------------------------------
#
#   REGISTRATION
#   Photo → [in memory] → face_recognition.face_encodings()
#                                  ↓
#                           128-float vector → MongoDB
#                                  ↓
#                           photo discarded (never saved)
#
#   ATTENDANCE CAPTURE
#   ESP32-CAM snapshot → [in memory] → face_recognition.face_locations()
#                                                ↓
#                              face_recognition.face_encodings()  (one per face)
#                                                ↓
#                              face_recognition.face_distance()   (vs all students)
#                                                ↓
#                              best distance < 0.55 → mark present → AttendanceRecord
#                                                ↓
#                              snapshot never saved
#
# -------------------------------------------------------------------------------
# PRACTICAL NOTES
# -------------------------------------------------------------------------------
# Detection model:
#   face_locations(rgb, model="hog")  — CPU, fast, good enough for a demo
#   face_locations(rgb, model="cnn")  — GPU, significantly more accurate
#   Start with "hog". Switch to "cnn" if accuracy is poor in the real classroom.
#
# Scale:
#   100 students × 3 embeddings average = 300 NumPy comparisons per detected face.
#   If 40 faces are in the frame → 12,000 dot products. Runs in under a second
#   on any modern CPU. Not a bottleneck.
#
# Unknown faces (non-consenting students):
#   They will not match any stored embedding. No record is created.
#   The lecturer marks them present or absent manually — exactly as designed.
#   The YOLOv8 occupancy count will still include them in the headcount.
#
# ESP32-CAM image quality:
#   This is the biggest variable affecting accuracy. Low resolution or motion
#   blur will reduce match rates. Capturing multiple frames and unioning results
#   is the most effective mitigation without changing hardware.
#
# Threshold tuning:
#   Start at 0.55. If legitimate students are not being matched (false negatives),
#   raise toward 0.60. If wrong students are being matched (false positives),
#   lower toward 0.50. Log best_distance for every match during testing so you
#   have data to calibrate against.
# ===============================================================================
