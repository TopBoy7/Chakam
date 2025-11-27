from datetime import datetime
from bson import ObjectId
from fastapi import HTTPException, status
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Union, List, Dict

import env, models


client = AsyncIOMotorClient(env.MONGO_URI, tls=True, tlsAllowInvalidCertificates=True)
db = client["smartclassDB"]


def throw_mongo_error() -> None:
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail="This is most likely a MongoDB connection error. Check connection and try again.",
    )


# CRUD for classrooms
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
