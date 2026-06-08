# Chakam — Changes Made & Testing Guide

This document explains the work done to make the **two-backend split** work cleanly,
the bugs that were fixed, and exactly how you can test everything yourself.

---

## 1. The architecture (how the two backends relate)

Chakam runs the **same FastAPI app in two flavours**, both pointing at the **same MongoDB**:

| | File | Where it runs | Carries YOLO + face_recognition? |
|---|---|---|---|
| **Light** | `backend/main-light.py` | **Render** (always on, free/cheap) | ❌ No — forwards the heavy work |
| **Heavy** | `backend/main.py` | **Azure** (paid, often switched off) | ✅ Yes — does image counting + face ID |

Three endpoints need the heavy ML dependencies. On the light backend these are
**forwarded** to the heavy backend over HTTP:

- `POST /classrooms/{classId}/image` — YOLO person-count + face-recognition attendance
- `POST /students/register` — face-embedding extraction
- `POST /courses/{courseCode}/register` — face-embedding extraction (student self-registration)

**Every other endpoint** (classrooms, lecturers, courses, enrollments, sessions,
attendance, student portal, registration-token lookup) is served **locally** by the
light backend directly against MongoDB.

```
                         ┌───────────────────────────────┐
   Frontend (Vercel)     │   Render — main-light.py       │
   ───────────────────►  │   • all CRUD endpoints (local) │
   VITE_API_BASE_URL     │   • /ws websocket              │
   = Render URL          │   • forwards 3 heavy endpoints │──┐
                         └───────────────────────────────┘  │ httpx
                                      ▲                       │ (HEAVY_BACKEND_URL)
                         shared       │                       ▼
                         MongoDB ─────┤            ┌───────────────────────────┐
                                      │            │  Azure — main.py          │
                                      └────────────│  • YOLO person count      │
                                                   │  • face_recognition       │
                                                   │  • Cloudinary upload      │
                                                   └───────────────────────────┘
```

### The key design goal you asked for
> *"If the backend connected to the frontend is the heavy backend there will be no
> difference at all from the frontend perspective, because it's the same exact endpoints."*

This is now **guaranteed and tested**:

- A new automated test (`test_light_backend_exposes_same_routes_as_heavy`) compares the
  full route table of `main.py` and `main-light.py` and asserts they are **identical**.
- The forwarding is now **transparent** (see fix #1 below): the light backend relays the
  heavy backend's exact HTTP status code and message. So whether the frontend talks to
  Render or directly to Azure, it sees the same responses and the same errors.

You can therefore point `VITE_API_BASE_URL` at **either** backend and the app behaves the same.

---

## 2. Bugs fixed

### Fix #1 — Forwarding was masking the heavy backend's real responses ⚠️ (most important)
**Before:** the light backend did `resp.raise_for_status()` inside a broad `try/except`.
Any non-2xx response from the heavy backend (e.g. `422 no face detected`,
`422 biometric consent required`, `409 already registered`, `400 too many photos`) raised
an exception that was caught and turned into a generic **`503 face recognition service
currently unavailable`**. The student saw the wrong error, and the behaviour differed from
talking to the heavy backend directly.

**After:** a shared helper `_forward_multipart_to_heavy()` relays the heavy backend's
**status code and message verbatim**. A real `503` is now returned **only** when the heavy
backend is genuinely unreachable (connection refused / DNS / timeout) — which is a
distinct, meaningful signal. Applied to all three forwarded endpoints.

### Fix #2 — Wrong request schema on biometrics deletion (light backend)
`DELETE /courses/{courseCode}/students/biometrics` used `ManualAttendanceRequest`, which
**requires a `present` field**. The frontend only sends `{ matricNumber }`, so the light
backend rejected every consent-withdrawal with **`422`**. Switched to the correct
`DeleteBiometricsRequest` (matches `main.py`).

### Fix #3 — Sessions started on the light backend lost their classroom name
`POST /sessions` on the light backend did not store `classroomName`. The heavy backend did.
This left `classroomName` blank in the student portal and session views when sessions were
created via Render. Now both backends store `classroom.className` on the session.

### Fix #4 — Missing attendance-status validation (light backend)
`PUT /sessions/{sessionId}/attendance/{matricNumber}` silently treated any value other than
`"present"` as *absent*. It now validates the body and returns `400 status must be
'present' or 'absent'`, matching the heavy backend.

### Fix #5 — Invalid CORS configuration (light backend)
The light backend used `allow_credentials=True` together with `allow_origins=["*"]`, which
is invalid per the CORS spec and can cause browsers to reject responses. Set to
`allow_credentials=False` (the frontend uses no cookies), matching `main.py`.

### Fix #6 — Light backend couldn't boot on Render without Cloudinary vars
`env.py` hard-required the 3 `CLOUDINARY_*` variables and called `exit(1)` if missing.
The light backend never uses Cloudinary, so requiring them was needless friction on Render.
Now **only `DATABASE_URL` is required**; the Cloudinary vars are optional (still needed by
the heavy backend, which is documented). It prints a harmless note if they're absent.

### Fix #7 — Added `/healthz` to the heavy backend
The light backend already had `/healthz`; the heavy backend did not. Added it so Azure's
load balancer / uptime monitor can probe it, and so the two route tables match exactly.

### Fix #8 — Frontend env files cleaned up
The old `frontend/.env` pointed the **API at `localhost`** but the **WebSocket at Render** —
a mismatch. Now:
- `frontend/.env` → consistent **local** dev (`http://localhost:8000` + `ws://localhost:8000`)
- `frontend/.env.production` → **Render** (`https://…onrender.com` + `wss://…onrender.com`)
- `frontend/.env.example` → documented template
- Removed a stray `console.log('hmm')` that fired on every WebSocket message.

### Note — `proxy-backend/` is now unused
The separate Express proxy is **no longer part of the flow** — forwarding happens inside
`main-light.py` directly via `httpx`. You can delete the `proxy-backend/` folder. (I left it
in place so nothing is removed without your say-so.)

---

## 3. ⚠️ One thing you must decide: how the ESP32-CAM reaches the backend

This is the only part that can't be "just wired" in code, because of a hardware limitation.

- The frontend should connect to **Render** (always on), so for the **live occupancy/attendance
  WebSocket updates to reach the dashboard**, the camera's image POST must also go **through
  Render** (Render forwards to Azure, gets the result, and re-broadcasts on its own WebSocket).
- **But** the current firmware (`firmware/firmware.ino`) uses a plain `WiFiClient` on **port 80
  (HTTP)**. Render only serves **HTTPS (443)** and redirects HTTP→HTTPS, which the firmware
  won't follow. So the ESP32 **cannot** reach Render as written.

You have two clean options:

**Option A (recommended) — ESP32 posts to Render over HTTPS.**
Update the firmware to use `WiFiClientSecure` with `client.setInsecure()` and port `443`:

```cpp
#include <WiFiClientSecure.h>
WiFiClientSecure client;          // instead of WiFiClient

String serverName = "chakam-backend.onrender.com";   // your Render host (no https://)
String serverPath = "/classrooms/<YOUR_CLASS_ID>/image";
const int serverPort = 443;

void setup() {
  // ... existing camera init ...
  client.setInsecure();           // skip cert validation (fine for this project)
}
```
Everything else stays the same. Now: **ESP32 → Render → Azure**, and the dashboard updates
live via Render's WebSocket. When Azure is off, Render returns `success:false` and the camera
keeps running (no crash).

**Option B — ESP32 posts directly to Azure over HTTP (port 80), frontend points at Azure.**
Keep the firmware as-is, set `serverName` to the Azure DNS name (see the Azure guide), and set
the frontend `VITE_API_BASE_URL`/`VITE_WS_URL` to Azure. Simpler firmware, but you lose the
"always-on Render" benefit — the dashboard only works while Azure is running.

> For a demo where Azure is on anyway, Option B is fine. For day-to-day use where you keep
> Azure off to save credit, **use Option A** so CRUD + the dashboard keep working on Render.

---

## 4. How to test

### 4.1 Backend unit + integration tests (no hardware, no cloud needed)

```bash
cd backend
# the repo already has a venv with everything installed; if not:
#   python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt httpx

venv/bin/python -m unittest discover -s tests -p "test_*.py" -v
```

You should see **26 tests pass**. They cover:
- `tests/test_api_endpoints.py` — the heavy backend (validation, sessions, attendance,
  registration guards, image-upload guards). External deps (YOLO, Cloudinary) are stubbed.
- `tests/test_light_backend.py` — the light backend:
  - **route parity** with the heavy backend (identical route tables),
  - **transparent forwarding** (relays heavy `422`/`400`/`201`; `503` only when heavy is down),
  - the schema/behaviour fixes (#2, #3, #4 above).

### 4.2 Live forwarding test (proves real HTTP forwarding works)

A self-contained script that boots a fake "heavy" backend, points the light backend at it,
and forwards real multipart uploads through it:

```bash
cd backend
venv/bin/python /tmp/live_forward_test.py   # script is generated below if you don't have it
```
Expected output ends with `ALL LIVE FORWARDING TESTS PASSED`, confirming:
- both photos are forwarded byte-for-byte,
- a heavy `422` is relayed verbatim,
- heavy-down yields `503`.

> The exact script used is reproduced in Appendix A so you can re-run it anytime.

### 4.3 Run a backend locally and click around

You need MongoDB reachable (your `DATABASE_URL` in `backend/.env` already points at Atlas).

**Run the light backend locally** (forwards heavy ops to your Azure URL or any heavy backend):
```bash
cd backend
HEAVY_BACKEND_URL=http://<your-azure-dns-or-ip> venv/bin/uvicorn main-light:app --reload --port 8000
```

**Or run the heavy backend locally** (does everything itself; needs the ML deps installed):
```bash
cd backend
venv/bin/uvicorn main:app --reload --port 8000
```

Then open the interactive API docs at **http://localhost:8000/docs** and try endpoints, e.g.:
```bash
curl http://localhost:8000/healthz
curl http://localhost:8000/classrooms
curl -X POST http://localhost:8000/classrooms \
  -H 'Content-Type: application/json' \
  -d '{"classId":"ELT","className":"Eng LT","deviceId":"dev-001","capacity":100}'
```

### 4.4 Run the frontend against your local backend
```bash
cd frontend
npm install          # first time only
npm run dev          # http://localhost:5173, uses frontend/.env (localhost backend)
```
Log in with the password in `VITE_ADMIN_PASSWORD` (`password` by default), create a classroom,
a course, start a session, and watch the dashboard. Open the browser console — you should see
`[WS] open` and `[WS] message …` as updates arrive.

### 4.5 Production build check
```bash
cd frontend
npm run build        # must finish with "✓ built in …" (verified passing)
```

### 4.6 End-to-end smoke test (full stack)
1. Start/confirm the heavy backend is up on Azure (see the Azure guide).
2. On Render, set `HEAVY_BACKEND_URL` to your Azure DNS name and deploy the light backend.
3. Point the frontend (`VITE_API_BASE_URL` / `VITE_WS_URL`) at Render.
4. From a terminal, simulate a camera frame through Render:
   ```bash
   curl -X POST https://chakam-backend.onrender.com/classrooms/ELT/image \
     -F deviceId=dev-001 \
     -F file=@/path/to/a/classroom_photo.jpg
   ```
   - If Azure is **up**: response has `success:true`, occupancy updates, and the dashboard
     updates live over the WebSocket.
   - If Azure is **down**: response has `success:false, "image analytics server currently
     unavailable"` — and all other (CRUD) parts of the app keep working on Render.

---

## 5. Quick reference — environment variables

**Render (light backend):**
| Var | Required | Example |
|---|---|---|
| `DATABASE_URL` | ✅ | `mongodb+srv://…/smartclassDB` |
| `HEAVY_BACKEND_URL` | ✅ | `http://chakam-heavy.switzerlandnorth.cloudapp.azure.com` |
| `SMTP_EMAIL`, `SMTP_PASSWORD` | optional (capacity alert emails) | Gmail + app password |
| `CLOUDINARY_*` | ❌ not used by light backend | — |

**Azure (heavy backend):**
| Var | Required | Example |
|---|---|---|
| `DATABASE_URL` | ✅ | same Atlas URI as Render |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | ✅ | from your Cloudinary dashboard |

**Frontend (Vercel):** `VITE_API_BASE_URL`, `VITE_WS_URL`, `VITE_ADMIN_PASSWORD`.

---

## Appendix A — live forwarding test script

Save as `backend/tests/live_forward_test.py` and run with `venv/bin/python tests/live_forward_test.py`:

```python
import os, sys, threading, time, importlib.util
from pathlib import Path
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND)); os.chdir(BACKEND)
import uvicorn
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from typing import List

heavy = FastAPI()
@heavy.post("/courses/{courseCode}/register")
async def reg(courseCode: str, matricNumber: str = Form(...), fullName: str = Form(...),
              biometricConsent: str = Form(...), manualAltConsent: str = Form(...),
              ageConsent: str = Form(...), photos: List[UploadFile] = File(...)):
    if biometricConsent != "true":
        raise HTTPException(422, "biometric consent is required")
    total = sum(len(await p.read()) for p in photos)
    return {"success": True, "message": "registered",
            "data": {"student": {"matricNumber": matricNumber.upper(),
                                 "numPhotos": len(photos), "bytesReceived": total}}}

threading.Thread(target=lambda: uvicorn.run(heavy, host="127.0.0.1", port=9099,
                 log_level="warning"), daemon=True).start()
time.sleep(2)

os.environ["HEAVY_BACKEND_URL"] = "http://127.0.0.1:9099"
spec = importlib.util.spec_from_file_location("main_light", BACKEND / "main-light.py")
ml = importlib.util.module_from_spec(spec); spec.loader.exec_module(ml)
from fastapi.testclient import TestClient
c = TestClient(ml.app)

r = c.post("/courses/CSC301/register",
    data={"matricNumber":"mat777","fullName":"Live","biometricConsent":"true",
          "manualAltConsent":"true","ageConsent":"true"},
    files=[("photos",("a.jpg", b"X"*1234, "image/jpeg")),
           ("photos",("b.jpg", b"Y"*4321, "image/jpeg"))])
assert r.status_code == 201 and r.json()["data"]["student"]["bytesReceived"] == 5555
r = c.post("/courses/CSC301/register",
    data={"matricNumber":"m","fullName":"x","biometricConsent":"false",
          "manualAltConsent":"true","ageConsent":"true"},
    files=[("photos",("a.jpg", b"X", "image/jpeg"))])
assert r.status_code == 422 and r.json()["detail"] == "biometric consent is required"
ml.HEAVY_BACKEND_URL = "http://127.0.0.1:9999"  # nothing listening
r = c.post("/courses/CSC301/register",
    data={"matricNumber":"m","fullName":"x","biometricConsent":"true",
          "manualAltConsent":"true","ageConsent":"true"},
    files=[("photos",("a.jpg", b"X", "image/jpeg"))])
assert r.status_code == 503
print("ALL LIVE FORWARDING TESTS PASSED")
```
