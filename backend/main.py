from fastapi import (
    FastAPI, HTTPException, status,
    UploadFile, File, Form, Response, WebSocket, WebSocketDisconnect
)
from fastapi.middleware.cors import CORSMiddleware

from typing import List
from io import BytesIO
import cv2
import numpy as np

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


# -------------------------------------------------------
# GLOBAL WEBSOCKET MANAGER
# -------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws)


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
            await ws.receive_text()  # keep alive
    except WebSocketDisconnect:
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

    if "occupancy" in payload:
        if payload["occupancy"] > (payload.get("capacity") or existing.capacity):
            raise HTTPException(400, "occupancy cannot exceed capacity")

    updated = await database.update_classroom_by_classId(classId, payload)

    # WebSocket push
    await manager.broadcast({"event": "classroom_updated", "classroom": updated.model_dump()})

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

    # Overlay text: occupancy / capacity
    label = f"Occupancy: {new_occupancy}/{classroom.capacity}"
    cv2.putText(img, label, (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 255, 0), 3)

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

    # Broadcast via WebSocket
    await manager.broadcast({
        "event": "classroom_image_update",
        "classroom": updated.model_dump()
    })

    # Return updated classroom JSON only
    return schemas.ResponseModel(
        success=True,
        message="classroom image updated",
        data={"classroom": updated.model_dump()}
    ).model_dump()
