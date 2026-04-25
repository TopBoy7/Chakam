# Chakam — Technical Overview

## Architecture

Chakam is a **Smart Classroom Management System** composed of four distinct components: IoT firmware, a Python backend, a Node.js proxy, and a React frontend.

```
ESP32-CAM (30 s interval)
       │  POST /classrooms/{classId}/image  (multipart: deviceId + JPEG)
       ▼
 [Node.js Proxy on Vercel]  ← forwards HTTP to backend IP
       │
       ▼
 [FastAPI Backend (Python)]
       │   MongoDB (Motor async driver)
       │   Cloudinary (annotated image CDN)
       │   YOLOv8n (occupancy detection)
       │   face_recognition (attendance)
       │
       ▼  WebSocket /ws  (push events to all connected browser tabs)
       ▼  HTTP REST API
 [React + Vite Frontend]
```

---

## 1. IoT Firmware (`firmware/firmware.ino`)

**Hardware**: ESP32-CAM module (AI Thinker variant).

**Operation**:
- Connects to WiFi on startup, initialises the OV2640 camera (SVGA 800×600 if PSRAM is found, CIF otherwise, JPEG format).
- Every **30 seconds**, captures a JPEG and POSTs it as `multipart/form-data` to the backend, including its hardcoded `deviceId` string.
- Streams the image in 1 KB chunks over a plain TCP `WiFiClient` (raw HTTP/1.1, no TLS).
- Parses the JSON response and logs the returned `classId`, `occupancy`, and `capacity` to Serial.
- If capture fails, restarts the MCU via `ESP.restart()`.

---

## 2. Proxy Backend (`proxy-backend/`)

A minimal **Express.js** reverse proxy deployed to Vercel (serverless).

**Why it exists**: The FastAPI backend runs on a plain HTTP server at a fixed IP (`51.107.0.26`). The frontend is hosted on HTTPS. Browsers block mixed-content requests (HTTPS frontend → HTTP backend), so the proxy bridges the gap.

**What it does**: Receives every request, strips the `host` header, forwards the entire raw body (using `express.raw({ type: "*/*" })`) to the upstream backend via `node-fetch`, then mirrors the exact status code, headers, and body back to the caller. Handles all HTTP methods and body types — including `multipart/form-data` for image uploads.

---

## 3. Backend (`backend/`)

**Stack**: Python 3.11+, FastAPI, Uvicorn, Motor (async MongoDB), Pydantic v2.

### Key Dependencies

| Library | Purpose |
|---|---|
| `fastapi` | HTTP + WebSocket API framework |
| `motor` | Async MongoDB driver |
| `ultralytics` (YOLOv8) | Person detection / occupancy counting |
| `face_recognition` (dlib) | 128-float face embedding extraction and matching |
| `opencv-python-headless` | Image decode, colour conversion, annotation |
| `cloudinary` | Annotated image storage / CDN |
| `pydantic` v2 | Request/response validation |

### MongoDB Collections

| Collection | Model | Purpose |
|---|---|---|
| `classrooms` | `Classroom` | Room metadata, live occupancy, latest image URL, `deviceId` |
| `lecturers` | `Lecturer` | Staff profiles |
| `courses` | `Course` | Course metadata + `registrationToken` UUID |
| `students` | `Student` | Matric, name, up to 5 × 128-float embeddings, full consent audit fields |
| `enrollments` | `Enrollment` | Many-to-many course ↔ student join |
| `sessions` | `Session` | A class meeting; contains embedded `attendees[]` array |

### Data Model Highlights

- `Session.attendees` is an **embedded array** of `AttendanceEntry` objects — no separate attendance collection. Each entry holds `matricNumber`, `fullName`, `markedAt`, `method` ("auto"/"manual"), and `manuallyOverridden` (bool).
- `Student.embeddings` holds up to 5 × 128-float vectors. Photos are extracted and immediately discarded — **never saved to disk or cloud**.
- `Student.embeddingsDeleted` lets the recognition pipeline skip a student who withdrew consent without deleting their historical attendance records.

### WebSocket (`/ws`)

A global `ConnectionManager` holds all active WebSocket connections in an in-memory list. It broadcasts JSON to every connected client on these events:

| Event | Trigger |
|---|---|
| `classroom_image_update` | Every image processed by `/classrooms/{classId}/image` |
| `classroom_updated` | Classroom settings changed |
| `session_started` | New session opened |
| `session_ended` | Session closed |
| `attendance_update` | New face recognised or manual override applied |

### Core Image Processing Pipeline (`POST /classrooms/{classId}/image`)

1. Validates `deviceId` matches the classroom's registered device.
2. Decodes JPEG with OpenCV.
3. **YOLO inference** — `yolov8n.pt` run in a thread pool executor; counts bounding boxes with class `0` (person); caps at `classroom.capacity`.
4. Annotates the image with occupancy label + Nigeria/Lagos timestamp.
5. **Face recognition** (only if a session is active for this classroom):
   - Extracts face locations (HOG model) and encodes them.
   - Fetches only the embeddings of students enrolled in the active session's course.
   - Matches each detected face against stored embeddings using `face_distance()`, threshold **0.55**.
   - Respects `manuallyOverridden` lock — manual marks are never overwritten by auto recognition.
6. Annotates the image with session info.
7. Uploads the annotated JPEG to Cloudinary; deletes the previous image.
8. Persists new `occupancy` + `latestImage` URL to MongoDB.
9. Broadcasts `classroom_image_update` (always) and `attendance_update` (if new faces were recognised) over WebSocket.
10. Returns a `metrics` dict with millisecond timing for each stage (`decode_ms`, `inference_ms`, `face_recognition_ms`, `cloudinary_ms`, `db_ms`, `ws_broadcast_ms`, `total_ms`).

### Environment Variables

Validated at startup via `env.py`. Missing any will halt the process:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | MongoDB Atlas connection string |
| `CLOUDINARY_API_KEY` | Cloudinary credentials |
| `CLOUDINARY_API_SECRET` | Cloudinary credentials |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary credentials |

### `main-light.py`

A stripped-down version of the backend without YOLO/face_recognition, used for lightweight deployments where ML libraries aren't available.

---

## 4. Frontend (`frontend/`)

**Stack**: React 18, TypeScript, Vite, React Router v6, Tailwind CSS, shadcn/ui components, Recharts (charts), `docx` + `jsPDF` (export), `date-fns`.

### Auth

A simple `AuthContext` gates admin-only pages behind an `isAdmin` flag.

### API Client (`src/lib/api.ts`)

Single module wrapping all `fetch` calls to the backend. Handles error extraction from FastAPI's `detail` field and maps raw MongoDB-shaped responses to typed TypeScript interfaces via transform functions (`transformCourse`, `transformSession`, etc.).

### WebSocket Hook (`useClassroomWebSocket`)

Persistent reconnecting WebSocket to `/ws`. Auto-reconnects with exponential backoff (1 s base, 30 s cap), pings every 25 seconds to keep proxies alive. Used by Dashboard, ClassroomDetail, and CourseDetail pages.

### Pages

| Route | Page | Purpose |
|---|---|---|
| `/` | `Home` | Landing / splash |
| `/dashboard` | `Dashboard` | Live classroom grid with real-time occupancy |
| `/dashboard/:classId` | `ClassroomDetail` | Single classroom — live image, occupancy, session history |
| `/analytics` | `Analytics` | Recharts bar chart of fill rates across all classrooms |
| `/attendance` | `Attendance` | Lecturer's course list — create, search, copy registration link |
| `/attendance/course/:courseId` | `CourseDetail` | Full course management — start/end sessions, live attendance, manual overrides, export |
| `/lecturers` | `LecturersPage` | Manage lecturer profiles |
| `/students` | `StudentsPage` | Admin student list — view consent status, delete biometrics |
| `/register/:token` | `StudentRegistration` | Public self-registration — consent checkboxes, photo upload, face embedding |
| `/my-attendance` | `StudentPortal` | Public — student enters matric number, sees per-course attendance rate + session log |

### Attendance Export (`src/lib/exportAttendance.ts`)

Generates attendance documents entirely in-browser in four formats:
- **CSV** — plain string
- **JSON** — `JSON.stringify`
- **DOCX** — `docx` library with a styled table
- **PDF** — `jsPDF` + `jspdf-autotable` with colour-coded status column

No server round-trip required.

---

## 5. Complete API Surface

| Method | Path | Purpose |
|---|---|---|
| WS | `/ws` | Real-time push |
| POST | `/classrooms` | Create classroom |
| GET | `/classrooms` | List classrooms |
| GET / PUT / DELETE | `/classrooms/{classId}` | Read / update / delete classroom |
| **POST** | `/classrooms/{classId}/image` | Image ingest — YOLO + face recognition |
| POST / GET | `/lecturers` | Create / list lecturers |
| GET / DELETE | `/lecturers/{staffId}` | Read / delete lecturer |
| POST / GET | `/courses` | Create / list courses |
| GET / PUT / DELETE | `/courses/{courseCode}` | Read / update / delete course |
| POST / GET | `/courses/{code}/enrollments` | Enroll student / list enrollments |
| DELETE | `/courses/{code}/enrollments/{matric}` | Unenroll student |
| GET | `/courses/{code}/students` | Enrolled students with profile |
| POST | `/courses/{code}/register` | Student self-registration (multipart, consent-gated) |
| DELETE | `/courses/{code}/students/biometrics` | Consent withdrawal — wipes embeddings |
| GET | `/students` | Admin: list all students |
| GET / DELETE | `/students/{matric}` | Admin: read / delete student |
| DELETE | `/students/{matric}/embeddings` | Admin: wipe biometrics |
| **GET** | `/students/lookup/{matric}` | **Public** — student portal lookup |
| GET | `/students/{matric}/enrollments` | Student's enrolled courses |
| POST | `/sessions` | Start session |
| GET | `/sessions` | List sessions (filterable by `classId`, `courseCode`, `status`) |
| GET | `/sessions/{id}` | Get session detail |
| POST | `/sessions/{id}/end` | End session |
| GET | `/sessions/{id}/attendance` | Get full attendee list |
| POST | `/sessions/{id}/attendance` | Manually mark attendance |
| PUT | `/sessions/{id}/attendance/{matric}` | Toggle per-student present / absent |
| POST | `/sessions/{id}/capture` | Return current attendance state |
| GET | `/register/{token}` | Resolve registration token → course |

---

## 6. Key Design Decisions

1. **Attendance embedded in Session** — no separate collection; one read gives everything for a session.
2. **Manual override lock** — `manuallyOverridden=True` in MongoDB prevents auto recognition from ever touching a manually-set record.
3. **Privacy by design** — photos are processed in memory only; embeddings are the only biometric artefact stored; `embeddingsDeleted` supports the right to erasure; full consent audit trail included in every student portal response.
4. **One active session per classroom** — enforced at session start to prevent two courses sharing the same camera pipeline.
5. **Face recognition is optional** — if `face_recognition` is not installed, the image endpoint degrades gracefully (YOLO still runs, attendance marking is skipped).
6. **Proxy layer** — decouples ESP32 firmware's hardcoded plain-HTTP calls from a TLS-required frontend, allowing the backend to run without TLS infrastructure.
