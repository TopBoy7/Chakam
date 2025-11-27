from pydantic import BaseModel, Field, field_validator
from typing import Union
from enum import Enum


class CreateClassroomRequest(BaseModel):
    classId: str
    deviceId: str
    capacity: int
    occupancy: int = 0

    model_config = {
        "json_schema_extra": {
            "example": {
                "classId": "EEE101",
                "deviceId": "dev-00123",
                "capacity": 150,
                "occupancy": 0,
            }
        }
    }

    @field_validator("capacity")
    def capacity_non_negative(cls, v):
        if v < 0:
            raise ValueError("capacity must be >= 0")
        return v

    @field_validator("occupancy")
    def occupancy_non_negative(cls, v):
        if v < 0:
            raise ValueError("occupancy must be >= 0")
        return v


class UpdateClassroomRequest(BaseModel):
    deviceId: Union[str, None]
    capacity: Union[int, None]
    occupancy: Union[int, None]

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