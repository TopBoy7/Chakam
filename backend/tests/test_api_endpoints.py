import os
import sys
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch


BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


ultralytics_stub = types.ModuleType("ultralytics")


class DummyYOLO:
    def __init__(self, *args, **kwargs):
        pass

    def predict(self, *args, **kwargs):
        return []


ultralytics_stub.YOLO = DummyYOLO
sys.modules.setdefault("ultralytics", ultralytics_stub)

cloudinary_stub = types.ModuleType("cloudinary")
cloudinary_uploader_stub = types.ModuleType("cloudinary.uploader")
cloudinary_stub.config = lambda **kwargs: None
cloudinary_uploader_stub.upload = lambda *args, **kwargs: {"secure_url": "https://example.com/image.jpg"}
cloudinary_uploader_stub.destroy = lambda *args, **kwargs: {"result": "ok"}
cloudinary_stub.uploader = cloudinary_uploader_stub
sys.modules.setdefault("cloudinary", cloudinary_stub)
sys.modules.setdefault("cloudinary.uploader", cloudinary_uploader_stub)

os.chdir(BACKEND_DIR)

import main  # noqa: E402
import models  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def make_classroom(**overrides):
    payload = {
        "classId": "ELT",
        "className": "Engineering Lecture Theatre",
        "deviceId": "dev-001",
        "capacity": 100,
        "occupancy": 0,
        "latestImage": None,
        "created_at": datetime(2026, 4, 25, 12, 0, 0),
        "updated_at": datetime(2026, 4, 25, 12, 0, 0),
    }
    payload.update(overrides)
    return models.Classroom(**payload)


def make_course(**overrides):
    payload = {
        "courseCode": "CSC301",
        "courseName": "Algorithms",
        "lecturerId": None,
        "registrationToken": "token-123",
        "createdAt": datetime(2026, 4, 25, 12, 0, 0),
    }
    payload.update(overrides)
    return models.Course(**payload)


def make_student(**overrides):
    payload = {
        "matricNumber": "MAT001",
        "fullName": "Jane Doe",
        "embeddings": [[0.1, 0.2, 0.3]],
        "registeredAt": datetime(2026, 4, 25, 12, 0, 0),
    }
    payload.update(overrides)
    return models.Student(**payload)


def make_session(**overrides):
    payload = {
        "sessionId": "sess-001",
        "courseCode": "CSC301",
        "classId": "ELT",
        "classroomName": "Engineering Lecture Theatre",
        "startedAt": datetime(2026, 4, 25, 12, 0, 0),
        "status": "active",
        "attendees": [],
    }
    payload.update(overrides)
    return models.Session(**payload)


class ApiEndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_create_classroom_rejects_negative_capacity(self):
        response = self.client.post(
            "/classrooms",
            json={
                "classId": "ELT",
                "className": "Engineering Lecture Theatre",
                "deviceId": "dev-001",
                "capacity": -1,
                "occupancy": 0,
            },
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("capacity must be >= 0", response.text)

    def test_update_classroom_allows_partial_updates_without_classid(self):
        updated = make_classroom(className="Renamed Hall")
        with patch.object(main.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())), \
             patch.object(main.database, "update_classroom_by_classId", AsyncMock(return_value=updated)), \
             patch.object(main.manager, "broadcast", AsyncMock()):
            response = self.client.put("/classrooms/ELT", json={"className": "Renamed Hall"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["classroom"]["className"], "Renamed Hall")

    def test_update_classroom_rejects_empty_payload(self):
        with patch.object(main.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())):
            response = self.client.put("/classrooms/ELT", json={})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "no fields to update")

    def test_create_course_rejects_unknown_lecturer(self):
        with patch.object(main.database, "get_course_by_courseCode", AsyncMock(return_value=None)), \
             patch.object(main.database, "get_lecturer_by_staffId", AsyncMock(return_value=None)):
            response = self.client.post(
                "/courses",
                json={
                    "courseCode": "CSC301",
                    "courseName": "Algorithms",
                    "lecturerId": "STAFF-404",
                },
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "lecturer not found")

    def test_update_course_rejects_empty_payload(self):
        with patch.object(main.database, "get_course_by_courseCode", AsyncMock(return_value=make_course())):
            response = self.client.put("/courses/CSC301", json={})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "no fields to update")

    def test_start_session_rejects_duplicate_active_session(self):
        active = make_session(sessionId="sess-live")
        with patch.object(main.database, "get_course_by_courseCode", AsyncMock(return_value=make_course())), \
             patch.object(main.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())), \
             patch.object(main.database, "get_active_session_by_classId", AsyncMock(return_value=active)):
            response = self.client.post("/sessions", json={"courseCode": "CSC301", "classId": "ELT"})

        self.assertEqual(response.status_code, 409)
        self.assertIn("classroom already has an active session", response.json()["detail"])

    def test_manual_attendance_rejects_unknown_student(self):
        with patch.object(main.database, "get_session_by_sessionId", AsyncMock(return_value=make_session())), \
             patch.object(main.database, "get_student_by_matric", AsyncMock(return_value=None)):
            response = self.client.post(
                "/sessions/sess-001/attendance",
                json={"matricNumber": "MAT404", "present": True},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "student not found")

    def test_update_student_attendance_rejects_invalid_status_value(self):
        with patch.object(main.database, "get_session_by_sessionId", AsyncMock(return_value=make_session())):
            response = self.client.put(
                "/sessions/sess-001/attendance/MAT001",
                json={"status": "late"},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "status must be 'present' or 'absent'")

    def test_resolve_registration_token_returns_404_for_unknown_token(self):
        with patch.object(main.database, "get_course_by_token", AsyncMock(return_value=None)):
            response = self.client.get("/register/bad-token")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "invalid or expired registration link")

    def test_student_registration_rejects_more_than_five_photos(self):
        files = [
            ("photos", (f"face-{index}.jpg", b"fake-image-bytes", "image/jpeg"))
            for index in range(6)
        ]
        response = self.client.post(
            "/students/register",
            data={"matricNumber": "MAT001", "fullName": "Jane Doe"},
            files=files,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "maximum 5 registration photos allowed")

    def test_course_registration_requires_biometric_consent(self):
        files = [("photos", ("face.jpg", b"fake-image-bytes", "image/jpeg"))]
        response = self.client.post(
            "/courses/CSC301/register",
            data={
                "matricNumber": "mat001",
                "fullName": "Jane Doe",
                "biometricConsent": "false",
                "manualAltConsent": "true",
                "ageConsent": "true",
            },
            files=files,
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "biometric consent is required")

    def test_course_registration_rejects_more_than_five_photos(self):
        files = [
            ("photos", (f"face-{index}.jpg", b"fake-image-bytes", "image/jpeg"))
            for index in range(6)
        ]
        with patch.object(main.database, "get_course_by_courseCode", AsyncMock(return_value=make_course())), \
             patch.object(main.database, "get_enrollment", AsyncMock(return_value=None)):
            response = self.client.post(
                "/courses/CSC301/register",
                data={
                    "matricNumber": "mat001",
                    "fullName": "Jane Doe",
                    "biometricConsent": "true",
                    "manualAltConsent": "true",
                    "ageConsent": "true",
                },
                files=files,
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "maximum 5 registration photos allowed")

    def test_upload_image_rejects_device_mismatch_before_processing(self):
        with patch.object(main.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom(deviceId="dev-expected"))):
            response = self.client.post(
                "/classrooms/ELT/image",
                data={"deviceId": "dev-other"},
                files={"file": ("frame.jpg", b"fake-image-bytes", "image/jpeg")},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "deviceId mismatch")

    def test_upload_image_rejects_invalid_image_payload(self):
        with patch.object(main.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())), \
             patch.object(main.cv2, "imdecode", return_value=None):
            response = self.client.post(
                "/classrooms/ELT/image",
                data={"deviceId": "dev-001"},
                files={"file": ("frame.jpg", b"not-an-image", "image/jpeg")},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "invalid image")


if __name__ == "__main__":
    unittest.main()
