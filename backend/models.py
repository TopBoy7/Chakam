from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from datetime import datetime, timezone
from bson import ObjectId


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Classroom(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    classId: str
    className: str = None
    latestImage: Optional[str] = None
    deviceId: str
    capacity: int
    occupancy: int = 0

    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class Lecturer(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    staffId: str
    fullName: str
    email: str
    createdAt: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class Course(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    courseCode: str
    courseName: str
    lecturerId: Optional[str] = None
    registrationToken: Optional[str] = None  # UUID stored on create, used for student signup links
    createdAt: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class Student(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    matricNumber: str
    fullName: str
    # Up to 5 × 128-float vectors; populated by face_recognition during registration.
    # Photos are processed in memory and immediately discarded — never persisted.
    embeddings: List[List[float]] = []
    biometricConsent: bool = True
    manualAltConsent: bool = True
    ageConsent: bool = True
    consentTimestamp: datetime = Field(default_factory=datetime.now)
    consentVersion: str = "1.0"
    # Set to True when student withdraws biometric consent — skipped in recognition.
    embeddingsDeleted: bool = False
    consentWithdrawnAt: Optional[datetime] = None
    registeredAt: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class Enrollment(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    courseCode: str
    matricNumber: str
    enrolledAt: datetime = Field(default_factory=datetime.now)

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class AttendanceEntry(BaseModel):
    matricNumber: str
    fullName: str
    markedAt: datetime = Field(default_factory=datetime.now)
    method: str = "auto"      # "auto" | "manual"
    manuallyOverridden: bool = False


class User(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    email: str
    role: str = "pending"          # "student" | "lecturer" | "admin" | "pending"
    status: str = "active"         # "active" | "suspended"
    matricNumber: Optional[str] = None   # students only, derived from email local part
    staffId: Optional[str] = None        # lecturers only, links to lecturers collection
    fullName: str = ""
    emailVerifiedAt: datetime = Field(default_factory=_utcnow)
    createdAt: datetime = Field(default_factory=_utcnow)
    lastLoginAt: Optional[datetime] = None
    roleAssignedBy: Optional[str] = None
    roleAssignedAt: Optional[datetime] = None

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class LoginCode(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    email: str
    codeHash: str
    expiresAt: datetime
    attempts: int = 0
    consumedAt: Optional[datetime] = None
    createdAt: datetime = Field(default_factory=_utcnow)

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}


class Session(BaseModel):
    id: Optional[str] = Field(default=None, alias="_id")
    sessionId: str
    courseCode: str
    classId: str
    classroomName: Optional[str] = None  # stored at session start for display
    startedAt: datetime = Field(default_factory=datetime.now)
    endedAt: Optional[datetime] = None
    status: str = "active"    # "active" | "ended"
    attendees: List[AttendanceEntry] = []

    @model_validator(mode="before")
    @classmethod
    def convert_objectid_to_str(cls, values):
        if "_id" in values and isinstance(values["_id"], ObjectId):
            values["_id"] = str(values["_id"])
        return values

    model_config = {"populate_by_name": True}
