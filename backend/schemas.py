from pydantic import BaseModel, Field, field_validator
from typing import Union, Optional, List


# -------------------------------------------------------
# CLASSROOM
# -------------------------------------------------------
class CreateClassroomRequest(BaseModel):
    classId: str
    className: str
    deviceId: str
    capacity: int
    occupancy: int = 0
    latestImage: Union[str, None] = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "classId": "ELT",
                "className": "Engineering Lecture Theatre 1",
                "deviceId": "dev-00123",
                "capacity": 150,
                "occupancy": 0,
            }
        }
    }

    @field_validator("capacity")
    @classmethod
    def capacity_non_negative(cls, v):
        if v < 0:
            raise ValueError("capacity must be >= 0")
        return v

    @field_validator("occupancy")
    @classmethod
    def occupancy_non_negative(cls, v):
        if v < 0:
            raise ValueError("occupancy must be >= 0")
        return v


class UpdateClassroomRequest(BaseModel):
    className: Union[str, None] = None
    deviceId: Union[str, None] = None
    capacity: Union[int, None] = None
    occupancy: Union[int, None] = None
    latestImage: Union[str, None] = None
    classId: Union[str, None] = None

    @field_validator("capacity")
    @classmethod
    def capacity_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("capacity must be >= 0")
        return v

    @field_validator("occupancy")
    @classmethod
    def occupancy_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("occupancy must be >= 0")
        return v


# -------------------------------------------------------
# LECTURER
# -------------------------------------------------------
class CreateLecturerRequest(BaseModel):
    staffId: str
    fullName: str
    email: str

    model_config = {
        "json_schema_extra": {
            "example": {
                "staffId": "STAFF-001",
                "fullName": "Dr. Amaka Obi",
                "email": "a.obi@university.edu.ng",
            }
        }
    }


# -------------------------------------------------------
# COURSE
# -------------------------------------------------------
class CreateCourseRequest(BaseModel):
    courseCode: str
    courseName: str
    lecturerId: Optional[str] = None  # optional — no lecturer auth required

    model_config = {
        "json_schema_extra": {
            "example": {
                "courseCode": "CSC301",
                "courseName": "Data Structures and Algorithms",
            }
        }
    }


class UpdateCourseRequest(BaseModel):
    courseName: Optional[str] = None
    lecturerId: Optional[str] = None


# -------------------------------------------------------
# ENROLLMENT
# -------------------------------------------------------
class EnrollStudentRequest(BaseModel):
    matricNumber: str

    model_config = {
        "json_schema_extra": {
            "example": {"matricNumber": "190403014"}
        }
    }


# -------------------------------------------------------
# SESSION
# -------------------------------------------------------
class StartSessionRequest(BaseModel):
    courseCode: str
    classId: str

    model_config = {
        "json_schema_extra": {
            "example": {
                "courseCode": "CSC301",
                "classId": "ELT",
            }
        }
    }


# -------------------------------------------------------
# ATTENDANCE
# -------------------------------------------------------
class ManualAttendanceRequest(BaseModel):
    matricNumber: str
    present: bool

    model_config = {
        "json_schema_extra": {
            "example": {"matricNumber": "190403014", "present": True}
        }
    }


class DeleteBiometricsRequest(BaseModel):
    matricNumber: str


# -------------------------------------------------------
# SHARED RESPONSE
# -------------------------------------------------------
class ResponseModel(BaseModel):
    success: bool
    message: str
    data: Union[dict, None]
