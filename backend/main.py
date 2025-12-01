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

    if "occupancy" in payload:
        if payload["occupancy"] > (payload.get("capacity") or existing.capacity):
            raise HTTPException(400, "occupancy cannot exceed capacity")

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
    classroom = await database.get_classroom_by_classId(classId)
    if not classroom:
        raise HTTPException(404, "classroom not found")

    if classroom.deviceId != deviceId:
        raise HTTPException(400, "deviceId mismatch")

    contents = await file.read()

    # Decode image
    img_array = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "invalid image")

    import asyncio
    loop = asyncio.get_running_loop()

    # Lazy load YOLO if not already
    model = getattr(app.state, "yolo_model", None)
    if model is None:
        model = await loop.run_in_executor(None, lambda: YOLO("yolov8n.pt"))
        app.state.yolo_model = model

    # Run YOLO in executor to avoid blocking
    results = await loop.run_in_executor(
        None,
        lambda: model.predict(img, imgsz=1920, conf=0.25, iou=0.45, augment=True)
    )

    boxes = results[0].boxes if len(results) else []
    person_count = sum(1 for b in boxes if int(b.cls[0]) == 0)
    new_occupancy = min(person_count, classroom.capacity)

    now_ng = datetime.now(ZoneInfo("Africa/Lagos"))
    timestamp = now_ng.strftime("%d %b %Y, %I:%M %p").replace(" 0", " ")
    # Overlay text: occupancy / capacity
    label = f"Occupancy: {new_occupancy}/{classroom.capacity}"
    cv2.putText(img, label, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

    # Overlay timestamp
    cv2.putText(img, timestamp, (20, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)

    # Encode annotated image to bytes
    _, encoded = cv2.imencode(".jpg", img)
    annotated_bytes = encoded.tobytes()

    # Upload annotated image to Cloudinary
    upload_result = cloudinary.uploader.upload(annotated_bytes, folder="smart_classrooms")
    new_url = upload_result["secure_url"]

    # Delete old image if exists
    if classroom.latestImage:
        public_id = "/".join(classroom.latestImage.split("/")[-2:]).split(".")[0]
        try:
            cloudinary.uploader.destroy(public_id)
        except:
            pass

    # Update DB
    await database.update_classroom_by_classId(classId, {"occupancy": new_occupancy, "latestImage": new_url})
    updated = await database.get_classroom_by_classId(classId)

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
    await manager.broadcast(serialize({
        "event": "classroom_image_update",
        "classroom": updated_dict
    }))

    # Return updated classroom JSON only
    return schemas.ResponseModel(
        success=True,
        message="classroom image updated",
        data={"classroom": updated.model_dump()}
    ).model_dump()
