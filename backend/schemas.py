from pydantic import BaseModel, Field, field_validator
from typing import Union
from enum import Enum


class CreateClassroomRequest(BaseModel):
    classId: str
    className: str                     # ← NEW FIELD
    deviceId: str
    capacity: int
    occupancy: int = 0
    latestImage: Union[str, None] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "classId": "ELT",
                "className": "Engineering Lecture Theatre 1",  # ← example
                "deviceId": "dev-00123",
                "capacity": 150,
                "occupancy": 0,
            }
        }
    }


class UpdateClassroomRequest(BaseModel):
    className: Union[str, None]        # ← NEW FIELD
    deviceId: Union[str, None]
    capacity: Union[int, None]
    occupancy: Union[int, None]
    latestImage: Union[str, None]

    @field_validator("capacity")
    def capacity_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("capacity must be >= 0")
        return v

    @field_validator("occupancy")
    def occupancy_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("occupancy must be >= 0")
        return v


class ResponseModel(BaseModel):
    success: bool
    message: str
    data: Union[dict, None]