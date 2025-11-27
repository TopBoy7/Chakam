from pydantic import BaseModel, Field, model_validator
from typing import Optional
from datetime import datetime
from bson import ObjectId


class Classroom(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    classId: str
    deviceId: str
    capacity: int
    occupancy: int = 0

    created_at: datetime = datetime.now()
    updated_at: datetime = datetime.now()

    @model_validator(mode="before")
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])  # Convert ObjectId to string
        return values
