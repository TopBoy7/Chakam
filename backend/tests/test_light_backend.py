"""
Tests for the lightweight Render backend (main-light.py).

Focus:
  1. Route parity — the light backend exposes exactly the same routes as the
     heavy backend, so the frontend cannot tell which one it is talking to.
  2. Transparent forwarding — the three heavy endpoints (image upload + the two
     face-registration routes) relay the heavy backend's status code and message
     verbatim, and only emit a distinct 503 on a real transport failure.
  3. The schema/behaviour fixes (biometrics deletion, classroomName on session
     start, attendance status validation).
"""
import importlib.util
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


# ── stub the heavy-only deps so we can import main.py for the parity check ──────
ultralytics_stub = types.ModuleType("ultralytics")


class DummyYOLO:
    def __init__(self, *a, **k):
        pass

    def predict(self, *a, **k):
        return []


ultralytics_stub.YOLO = DummyYOLO
sys.modules.setdefault("ultralytics", ultralytics_stub)

cloudinary_stub = types.ModuleType("cloudinary")
cloudinary_uploader_stub = types.ModuleType("cloudinary.uploader")
cloudinary_stub.config = lambda **k: None
cloudinary_uploader_stub.upload = lambda *a, **k: {"secure_url": "https://example.com/x.jpg"}
cloudinary_uploader_stub.destroy = lambda *a, **k: {"result": "ok"}
cloudinary_stub.uploader = cloudinary_uploader_stub
sys.modules.setdefault("cloudinary", cloudinary_stub)
sys.modules.setdefault("cloudinary.uploader", cloudinary_uploader_stub)

os.chdir(BACKEND_DIR)


def _load_light_module():
    """main-light.py is not a valid module name (hyphen) — load it by path."""
    spec = importlib.util.spec_from_file_location("main_light", BACKEND_DIR / "main-light.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


import main  # noqa: E402
import models  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

main_light = _load_light_module()


def make_classroom(**overrides):
    payload = {
        "classId": "ELT",
        "className": "Engineering Lecture Theatre",
        "deviceId": "dev-001",
        "capacity": 100,
        "occupancy": 0,
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


def routes_of(app):
    """Set of (method, path) for comparable HTTP routes (ignore HEAD/OPTIONS)."""
    out = set()
    for r in app.routes:
        methods = getattr(r, "methods", None)
        if not methods:
            continue
        for m in methods:
            if m in ("HEAD", "OPTIONS"):
                continue
            out.add((m, r.path))
    return out


class RouteParityTests(unittest.TestCase):
    def test_light_backend_exposes_same_routes_as_heavy(self):
        heavy = routes_of(main.app)
        light = routes_of(main_light.app)
        self.assertEqual(
            heavy,
            light,
            msg=f"\nonly in heavy: {sorted(heavy - light)}\nonly in light: {sorted(light - heavy)}",
        )


class TransparentForwardingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main_light.app)

    def test_course_register_relays_heavy_422_consent_error(self):
        async def fake_forward(path, data, files, timeout=60.0):
            return 422, {"detail": "biometric consent is required"}

        with patch.object(main_light, "_forward_multipart_to_heavy", fake_forward):
            resp = self.client.post(
                "/courses/CSC301/register",
                data={
                    "matricNumber": "mat001",
                    "fullName": "Jane Doe",
                    "biometricConsent": "false",
                    "manualAltConsent": "true",
                    "ageConsent": "true",
                },
                files=[("photos", ("face.jpg", b"bytes", "image/jpeg"))],
            )
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(resp.json()["detail"], "biometric consent is required")

    def test_course_register_relays_heavy_422_no_face(self):
        async def fake_forward(path, data, files, timeout=60.0):
            return 422, {"detail": "no face detected in photo 1"}

        with patch.object(main_light, "_forward_multipart_to_heavy", fake_forward):
            resp = self.client.post(
                "/courses/CSC301/register",
                data={
                    "matricNumber": "mat001",
                    "fullName": "Jane Doe",
                    "biometricConsent": "true",
                    "manualAltConsent": "true",
                    "ageConsent": "true",
                },
                files=[("photos", ("face.jpg", b"bytes", "image/jpeg"))],
            )
        self.assertEqual(resp.status_code, 422)
        self.assertEqual(resp.json()["detail"], "no face detected in photo 1")

    def test_course_register_success_relays_body(self):
        async def fake_forward(path, data, files, timeout=60.0):
            return 201, {"success": True, "message": "registered", "data": {"student": {"matricNumber": "MAT001"}}}

        with patch.object(main_light, "_forward_multipart_to_heavy", fake_forward):
            resp = self.client.post(
                "/courses/CSC301/register",
                data={
                    "matricNumber": "mat001",
                    "fullName": "Jane Doe",
                    "biometricConsent": "true",
                    "manualAltConsent": "true",
                    "ageConsent": "true",
                },
                files=[("photos", ("face.jpg", b"bytes", "image/jpeg"))],
            )
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(resp.json()["success"])
        self.assertEqual(resp.json()["data"]["student"]["matricNumber"], "MAT001")

    def test_course_register_returns_503_only_on_transport_failure(self):
        async def fake_forward(path, data, files, timeout=60.0):
            raise main_light.HeavyBackendUnavailable("connection refused")

        with patch.object(main_light, "_forward_multipart_to_heavy", fake_forward):
            resp = self.client.post(
                "/courses/CSC301/register",
                data={
                    "matricNumber": "mat001",
                    "fullName": "Jane Doe",
                    "biometricConsent": "true",
                    "manualAltConsent": "true",
                    "ageConsent": "true",
                },
                files=[("photos", ("face.jpg", b"bytes", "image/jpeg"))],
            )
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.json()["detail"], "face recognition service currently unavailable")

    def test_student_register_relays_heavy_400(self):
        async def fake_forward(path, data, files, timeout=60.0):
            return 400, {"detail": "maximum 5 registration photos allowed"}

        with patch.object(main_light, "_forward_multipart_to_heavy", fake_forward):
            resp = self.client.post(
                "/students/register",
                data={"matricNumber": "MAT001", "fullName": "Jane Doe"},
                files=[("photos", ("face.jpg", b"bytes", "image/jpeg"))],
            )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "maximum 5 registration photos allowed")

    def test_image_upload_success_path_rebroadcasts(self):
        heavy_body = {
            "success": True,
            "message": "classroom image updated",
            "data": {"classroom": {"classId": "ELT", "occupancy": 5, "capacity": 100, "className": "ELT"}},
        }

        async def fake_forward(path, data, files, timeout=60.0):
            return 200, heavy_body

        with patch.object(main_light.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())), \
             patch.object(main_light, "_forward_multipart_to_heavy", fake_forward), \
             patch.object(main_light.manager, "broadcast", AsyncMock()) as bcast:
            resp = self.client.post(
                "/classrooms/ELT/image",
                data={"deviceId": "dev-001"},
                files={"file": ("frame.jpg", b"bytes", "image/jpeg")},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["success"])
        bcast.assert_awaited()  # re-broadcast to this server's WS clients

    def test_image_upload_graceful_when_heavy_down(self):
        async def fake_forward(path, data, files, timeout=30.0):
            raise main_light.HeavyBackendUnavailable("connection refused")

        with patch.object(main_light.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())), \
             patch.object(main_light, "_forward_multipart_to_heavy", fake_forward):
            resp = self.client.post(
                "/classrooms/ELT/image",
                data={"deviceId": "dev-001"},
                files={"file": ("frame.jpg", b"bytes", "image/jpeg")},
            )
        # ESP32 stays happy: 200 with success:false, no HTTP error.
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["success"])
        self.assertIn("unavailable", resp.json()["message"])

    def test_image_upload_rejects_device_mismatch_locally(self):
        with patch.object(main_light.database, "get_classroom_by_classId",
                          AsyncMock(return_value=make_classroom(deviceId="dev-expected"))):
            resp = self.client.post(
                "/classrooms/ELT/image",
                data={"deviceId": "dev-other"},
                files={"file": ("frame.jpg", b"bytes", "image/jpeg")},
            )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "deviceId mismatch")


class LightBackendFixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main_light.app)

    def test_delete_biometrics_accepts_only_matric_number(self):
        # Previously required a `present` field (wrong schema) -> 422.
        with patch.object(main_light.database, "delete_student_embeddings_for_course",
                          AsyncMock(return_value=True)):
            resp = self.client.request(
                "DELETE",
                "/courses/CSC301/students/biometrics",
                json={"matricNumber": "mat001"},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["success"])

    def test_start_session_persists_classroom_name(self):
        captured = {}

        async def fake_add_session(session):
            captured["classroomName"] = session.classroomName
            return "id-1"

        with patch.object(main_light.database, "get_course_by_courseCode", AsyncMock(return_value=make_course())), \
             patch.object(main_light.database, "get_classroom_by_classId", AsyncMock(return_value=make_classroom())), \
             patch.object(main_light.database, "get_active_session_by_classId", AsyncMock(return_value=None)), \
             patch.object(main_light.database, "add_session", fake_add_session), \
             patch.object(main_light.manager, "broadcast", AsyncMock()):
            resp = self.client.post("/sessions", json={"courseCode": "CSC301", "classId": "ELT"})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(captured["classroomName"], "Engineering Lecture Theatre")

    def test_update_attendance_rejects_invalid_status(self):
        with patch.object(main_light.database, "get_session_by_sessionId", AsyncMock(return_value=make_session())):
            resp = self.client.put(
                "/sessions/sess-001/attendance/MAT001",
                json={"status": "late"},
            )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "status must be 'present' or 'absent'")


if __name__ == "__main__":
    unittest.main()
