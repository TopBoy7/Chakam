from fastapi import FastAPI, HTTPException, status, UploadFile, File, Form, Response
from fastapi.responses import StreamingResponse
from typing import List
from io import BytesIO

import database, models, schemas

from ultralytics import YOLO
import cv2
import numpy as np

# Load YOLO model once at server start
yolo_model = YOLO("yolov8n.pt")  # lightweight + fast

app = FastAPI(title="Smart Classroom - FastAPI + YOLO + MongoDB")


# ---------------------------------------------------------
# CREATE CLASSROOM
# ---------------------------------------------------------
@app.post("/classrooms", response_model=schemas.ResponseModel)
async def create_classroom(req: schemas.CreateClassroomRequest):
    existing = await database.get_classroom_by_classId(req.classId)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="classId already exists")

    classroom = models.Classroom(**req.model_dump())
    inserted_id = await database.add_classroom(classroom)

    return schemas.ResponseModel(
        success=True,
        message="classroom created",
        data={"id": inserted_id}
    ).model_dump()


# ---------------------------------------------------------
# GET ALL CLASSROOMS
# ---------------------------------------------------------
@app.get("/classrooms", response_model=schemas.ResponseModel)
async def get_classrooms():
    docs = await database.list_classrooms()
    data = [d.model_dump() for d in docs]

    return schemas.ResponseModel(
        success=True,
        message="ok",
        data={"classrooms": data}
    ).model_dump()


# ---------------------------------------------------------
# GET ONE CLASSROOM
# ---------------------------------------------------------
@app.get("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def get_classroom(classId: str):
    doc = await database.get_classroom_by_classId(classId)
    if not doc:
        raise HTTPException(status_code=404, detail="classroom not found")

    return schemas.ResponseModel(
        success=True,
        message="ok",
        data={"classroom": doc.model_dump()}
    ).model_dump()


# ---------------------------------------------------------
# UPDATE CLASSROOM
# ---------------------------------------------------------
@app.put("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def update_classroom(classId: str, req: schemas.UpdateClassroomRequest):
    payload = {k: v for k, v in req.model_dump().items() if v is not None}

    if "occupancy" in payload and "capacity" in payload:
        if payload["occupancy"] > payload["capacity"]:
            raise HTTPException(status_code=400, detail="occupancy cannot exceed capacity")

    if "occupancy" in payload:
        existing = await database.get_classroom_by_classId(classId)
        if existing and payload["occupancy"] > existing.capacity:
            raise HTTPException(status_code=400, detail="occupancy cannot exceed capacity")

    updated = await database.update_classroom_by_classId(classId, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="classroom not found")

    return schemas.ResponseModel(
        success=True,
        message="updated",
        data={"classroom": updated.model_dump()}
    ).model_dump()


# ---------------------------------------------------------
# DELETE CLASSROOM
# ---------------------------------------------------------
@app.delete("/classrooms/{classId}", response_model=schemas.ResponseModel)
async def delete_classroom(classId: str):
    ok = await database.delete_classroom_by_classId(classId)
    if not ok:
        raise HTTPException(status_code=404, detail="classroom not found")

    return schemas.ResponseModel(
        success=True,
        message="deleted",
        data=None
    ).model_dump()


# ---------------------------------------------------------
# IMAGE UPLOAD + YOLO PERSON DETECTION
# ---------------------------------------------------------
@app.post("/classrooms/{classId}/image")
async def upload_image(
    classId: str,
    deviceId: str = Form(...),
    file: UploadFile = File(...)
):
    classroom = await database.get_classroom_by_classId(classId)
    if not classroom:
        raise HTTPException(status_code=404, detail="classroom not found")

    if classroom.deviceId != deviceId:
        raise HTTPException(status_code=400, detail="deviceId does not match classroom")

    contents = await file.read()

    try:
        # Decode image from bytes
        img_array = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return Response(content=contents, media_type=file.content_type)

        # ----------------------------------------------------------
        # YOLO IMPROVED SETTINGS FOR SMALL / FAR PERSON DETECTION.
        # ----------------------------------------------------------
        results = yolo_model.predict(
            img,
            imgsz=1920,          # bigger input — catches small people
            conf=0.25,          # lower confidence — sensitive to small objects
            iou=0.45,           # lower NMS — keeps tiny detections
            augment=True        # YOLO TTA — improves accuracy significantly
        )

        person_count = 0
        boxes = results[0].boxes if results and len(results) > 0 else []

        # ----------------------------------------------------------
        # COUNT PERSONS + DRAW BOXES
        # ----------------------------------------------------------
        if boxes is not None:
            for box in boxes:
                cls = int(box.cls[0])
                if cls == 0:  # YOLO class 0 = person
                    person_count += 1

                    # bounding box
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)

        # ----------------------------------------------------------
        # UPDATE OCCUPANCY IN DB
        # ----------------------------------------------------------
        new_occupancy = min(person_count, classroom.capacity)

        try:
            await database.update_classroom_by_classId(classId, {"occupancy": new_occupancy})
            classroom = await database.get_classroom_by_classId(classId)
        except:
            pass

        # ----------------------------------------------------------
        # OVERLAY TEXT
        # ----------------------------------------------------------
        label = f"detected: {person_count} | occupancy: {classroom.occupancy}/{classroom.capacity}"

        cv2.putText(
            img, label, (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX, 1.1,
            (255, 255, 255), 3
        )

        # Encode JPEG output
        _, encoded = cv2.imencode(".jpg", img)
        return Response(content=encoded.tobytes(), media_type="image/jpeg")

    except Exception as e:
        print("YOLO ERROR:", e)
        return Response(content=contents, media_type=file.content_type)
