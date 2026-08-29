#!/usr/bin/env python3
"""
chakam_attendance_test.py
================================================================================
Chakam Test Runner & Result Logger — Attendance Mode (A/B) + Occupancy Mode (C/D)

Usage:
    python chakam_attendance_test.py --config config.json          # all tests
    python chakam_attendance_test.py --config config.json --test b1 # one test

Results are saved to:
    test_results/<timestamp>/
        results.json   — full structured output per test
        summary.csv    — one-row-per-test pass/fail summary
        report.txt     — human-readable report (paste into report §4.6/§4.5)

Prerequisites (see config.example.json):
    - At least 2 students registered with photos on the live system
    - A classroom and course already created
    - Images of each registered student saved locally
    - Session trial images (attendance) and occupancy trial images saved locally

IMPORTANT — backend response shape:
    Every Chakam API response is wrapped as {"success", "message", "data"}.
    All payload fields (session id, metrics, attendees, classroom, ...) live
    under "data", never at the top level. Every helper below unwraps that
    envelope before reading anything — do not add a new API call without
    doing the same, or it will silently read None/[] instead of erroring.

IMPORTANT — Test A3 (export) cannot be automated against the API:
    Attendance export (CSV/JSON/DOCX/PDF) runs entirely client-side in the
    browser (frontend/src/lib/exportAttendance.ts, using docx/jsPDF) — there
    is no backend /export endpoint to call. test_a3_export() below prints
    manual verification steps instead of making HTTP calls; it always logs
    as "skipped", by design, not a bug.

IMPORTANT — Test C2 (capacity alert) is semi-manual for the same reason:
    the alert is a real email (send_email.py, via the mailer/ service) — the
    script can trigger it, but only a human checking the ALERT_EMAIL inbox
    can confirm delivery. Also worth knowing: there is no cooldown/throttle
    in send_occupancy_alert — every single over-capacity frame sends a new
    email, not once per "became over capacity" transition.

Dependencies:  pip install requests websockets
================================================================================
"""

import os, sys, json, csv, time, argparse, datetime, statistics, asyncio
import requests
from pathlib import Path
from typing import Optional, List

# ── Terminal colours ───────────────────────────────────────────────────────
GREEN  = '\033[92m'; RED    = '\033[91m'
YELLOW = '\033[93m'; BLUE   = '\033[94m'
RESET  = '\033[0m';  BOLD   = '\033[1m'

def ok(msg):    print(f'{GREEN}  ✓ PASS{RESET} — {msg}')
def fail(msg):  print(f'{RED}  ✗ FAIL{RESET} — {msg}')
def info(msg):  print(f'{BLUE}  ·{RESET} {msg}')
def warn(msg):  print(f'{YELLOW}  ⚠{RESET} {msg}')
def head(msg):  print(f'\n{BOLD}{msg}{RESET}\n' + '─' * 60)
def skip(msg):  print(f'  {YELLOW}SKIP{RESET} — {msg}')


# ═══════════════════════════════════════════════════════════════════════════
class ChakamTestRunner:
    """Runs functional and quantitative tests against the live Chakam backend."""

    def __init__(self, config_path: str):
        with open(config_path, encoding='utf-8') as f:
            self.cfg = json.load(f)

        self.base      = self.cfg['api_base_url'].rstrip('/')
        self.token: Optional[str] = None
        self.device_id = self.cfg['device_id']

        # Initialise result store
        self.results = {
            'session': {
                'label':      self.cfg.get('session_label', 'Unnamed session'),
                'started_at': datetime.datetime.now().isoformat(),
                'api_base':   self.base,
            },
            'tests':   {},   # per-test results
            'metrics': {},   # computed metrics (B1/B2/B3)
        }

        # Output directory
        self.ts      = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        self.out_dir = Path(self.cfg.get('output_dir', './test_results')) / self.ts
        self.out_dir.mkdir(parents=True, exist_ok=True)

    # ── Authentication ───────────────────────────────────────────────────────

    def authenticate(self, email: str, role_label: str = 'user') -> bool:
        """Interactive OTP-based authentication — sends code to email, prompts user."""
        head(f'AUTH — {role_label}  ({email})')

        r = requests.post(f'{self.base}/auth/request-code',
                          json={'email': email}, timeout=15)
        if r.status_code not in (200, 201):
            fail(f'request-code — HTTP {r.status_code}: {r.text[:200]}')
            return False
        info(f'OTP sent to {email}')

        for attempt in range(3):
            code = input(f'  Enter 6-digit code (attempt {attempt+1}/3): ').strip()
            r2 = requests.post(f'{self.base}/auth/verify-code',
                               json={'email': email, 'code': code}, timeout=15)
            if r2.status_code in (200, 201):
                # Response is {"success", "message", "data": {"token", "user"}} —
                # the token is nested under "data", never top-level.
                data = r2.json().get('data') or {}
                self.token = data.get('token')
                if self.token:
                    ok(f'Authenticated as {role_label}')
                    return True
            warn(f'Code rejected — {r2.status_code}: {r2.text[:100]}')

        fail('Authentication failed after 3 attempts')
        return False

    def _headers(self) -> dict:
        return {'Authorization': f'Bearer {self.token}'} if self.token else {}

    # ── Shared API helpers ──────────────────────────────────────────────────

    def _upload_image(self, class_id: str, image_path: str) -> dict:
        """
        POST an image to the classroom endpoint, simulating what the camera
        firmware does. The endpoint requires a multipart field named 'file'
        (not 'image') plus a required 'deviceId' form field matching the
        classroom's registered device — both are easy to get wrong since the
        firmware/frontend don't document this endpoint anywhere public.

        Returns the unwrapped 'metrics' dict from the response (decode_ms,
        inference_ms, face_recognition_ms, cloudinary_ms, db_ms,
        ws_broadcast_ms, total_ms), plus '_wall_ms' (total request time) and
        '_attendance' (the attendance block, if a session was active).
        Returns {'_error': True, ...} on failure.
        """
        t0 = time.perf_counter()
        try:
            with open(image_path, 'rb') as f:
                r = requests.post(
                    f'{self.base}/classrooms/{class_id}/image',
                    files={'file': (Path(image_path).name, f, 'image/jpeg')},
                    data={'deviceId': self.device_id},
                    headers=self._headers(),
                    timeout=30,
                )
        except requests.RequestException as e:
            return {'_error': True, 'exception': str(e)}

        wall_ms = (time.perf_counter() - t0) * 1000
        if r.status_code not in (200, 201):
            return {'_error': True, 'status': r.status_code, 'body': r.text[:300]}

        payload = r.json().get('data') or {}
        out = dict(payload.get('metrics') or {})
        out['_wall_ms'] = round(wall_ms, 2)
        out['_attendance'] = payload.get('attendance')
        out['_classroom'] = payload.get('classroom')
        return out

    def _get_classroom(self, class_id: str) -> Optional[dict]:
        """GET /classrooms/{classId} — returns the unwrapped classroom dict."""
        r = requests.get(f'{self.base}/classrooms/{class_id}',
                         headers=self._headers(), timeout=10)
        if r.status_code == 200:
            return (r.json().get('data') or {}).get('classroom')
        return None

    def _ws_url(self) -> str:
        return self.base.replace('https://', 'wss://').replace('http://', 'ws://') + '/ws'

    async def _upload_and_wait_for_broadcast(
        self, class_id: str, image_path: str, timeout: float = 10.0
    ) -> dict:
        """Open an authenticated WS connection, upload an image, and wait for
        the matching classroom_image_update broadcast. Returns
        {'upload': <_upload_image result>, 'event': <ws message or None>,
        'latency_ms': <float or None>} — latency is measured from just before
        the upload starts to when the broadcast is received, so it reflects
        what a lecturer watching the dashboard actually experiences."""
        import websockets

        result: dict = {'upload': None, 'event': None, 'latency_ms': None}
        try:
            async with websockets.connect(self._ws_url()) as ws:
                await ws.send(json.dumps({'token': self.token}))
                loop = asyncio.get_running_loop()
                t_start = loop.time()
                result['upload'] = await loop.run_in_executor(
                    None, lambda: self._upload_image(class_id, image_path)
                )
                deadline = loop.time() + timeout
                while loop.time() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=deadline - loop.time())
                    except asyncio.TimeoutError:
                        break
                    try:
                        msg = json.loads(raw)
                    except (json.JSONDecodeError, TypeError):
                        continue
                    if msg.get('event') in ('classroom_image_update', 'classroom_updated'):
                        result['event'] = msg
                        result['latency_ms'] = round((loop.time() - t_start) * 1000, 2)
                        break
        except Exception as e:
            result['ws_error'] = str(e)
        return result

    async def capture_live_frames(
        self, class_id: str, out_dir: Path, duration: Optional[float] = None
    ) -> int:
        """Listen on the WebSocket for real classroom_image_update broadcasts
        from the actual device and save each one to out_dir as it arrives.

        This exists because the backend keeps only the SINGLE most recent
        image per classroom — every new upload deletes the previous one from
        Cloudinary immediately (see upload_image in main.py). There is no way
        to retroactively collect multiple frames from a live session by
        checking Cloudinary afterward; only the last frame would still exist.
        The WebSocket broadcast fires with the fresh URL before the NEXT
        upload replaces it, so downloading immediately on receipt is the only
        reliable way to capture more than one real frame from a live session.

        Runs until Ctrl+C, or until `duration` seconds have elapsed if given.
        Returns the number of frames saved."""
        out_dir.mkdir(parents=True, exist_ok=True)
        saved = 0
        start = time.time()

        import websockets
        async with websockets.connect(self._ws_url()) as ws:
            await ws.send(json.dumps({'token': self.token}))
            info(f'Listening for real frames from {class_id} — Ctrl+C to stop'
                 + (f' (auto-stop after {duration:.0f}s)' if duration else ''))
            while True:
                if duration and (time.time() - start) > duration:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
                except asyncio.TimeoutError:
                    continue
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue
                if msg.get('event') not in ('classroom_image_update', 'classroom_updated'):
                    continue
                classroom = msg.get('classroom') or {}
                if classroom.get('classId') != class_id:
                    continue
                url = classroom.get('latestImage')
                if not url:
                    continue

                # Download NOW — the previous frame was just deleted from
                # Cloudinary the moment this one arrived, and this one will be
                # deleted the moment the next frame arrives. No time to wait.
                try:
                    r = requests.get(url, timeout=10)
                    r.raise_for_status()
                except requests.RequestException as e:
                    warn(f'Failed to download frame: {e}'); continue

                saved += 1
                ts = datetime.datetime.now().strftime('%H%M%S')
                fname = out_dir / f'frame_{saved:03d}_{ts}.jpg'
                fname.write_bytes(r.content)
                ok(f'Saved {fname.name}  (occupancy at capture: {classroom.get("occupancy")})')

        info(f'Done — {saved} frame(s) saved to {out_dir}')
        return saved

    def _get_attendees(self, session_id: str) -> List[dict]:
        """Return the attendees list for a session, unwrapped.
        Each entry now includes a real 'present' bool — a manual 'absent'
        override is a persisted entry with present=False, not a missing
        entry, so this correctly reflects overrides (see database.py's
        manual_attendance_override)."""
        r = requests.get(f'{self.base}/sessions/{session_id}/attendance',
                         headers=self._headers(), timeout=10)
        if r.status_code == 200:
            return (r.json().get('data') or {}).get('attendees', [])
        return []

    def _override(self, session_id: str, matric: str, present: bool) -> bool:
        """PUT /sessions/{id}/attendance/{matric}  body: {status: 'present'|'absent'}"""
        r = requests.put(
            f'{self.base}/sessions/{session_id}/attendance/{matric}',
            json={'status': 'present' if present else 'absent'},
            headers=self._headers(), timeout=10,
        )
        return r.status_code in (200, 201)

    def _create_session(self, class_id: str, course_code: str) -> Optional[str]:
        """POST /sessions  body: {classId, courseCode} — these are the
        human-readable codes used everywhere in the app (e.g. 'ELT',
        'CSC301'), NOT MongoDB ObjectIds."""
        r = requests.post(
            f'{self.base}/sessions',
            json={'classId': class_id, 'courseCode': course_code},
            headers=self._headers(), timeout=10,
        )
        if r.status_code in (200, 201):
            data = r.json().get('data') or {}
            return data.get('sessionId') or data.get('id')
        warn(f'create_session — {r.status_code}: {r.text[:200]}')
        return None

    def _end_session(self, session_id: str) -> bool:
        """PUT /sessions/{id}/end — no body."""
        r = requests.put(
            f'{self.base}/sessions/{session_id}/end',
            headers=self._headers(), timeout=10,
        )
        return r.status_code in (200, 201)

    def _get_session(self, session_id: str) -> Optional[dict]:
        """GET /sessions/{id} — returns the unwrapped session dict, or None."""
        r = requests.get(f'{self.base}/sessions/{session_id}',
                         headers=self._headers(), timeout=10)
        if r.status_code == 200:
            return (r.json().get('data') or {}).get('session')
        return None

    def _images_from_dir(self, directory: str) -> List[Path]:
        """Return sorted list of .jpg/.jpeg/.png/.webp files in a directory."""
        d = Path(directory)
        if not d.exists():
            warn(f'Directory not found: {directory}')
            return []
        exts = ('*.jpg', '*.jpeg', '*.png', '*.webp')
        return sorted(f for ext in exts for f in d.glob(ext))

    def _log(self, name: str, passed: bool, details: dict):
        self.results['tests'][name] = {
            'passed':    passed,
            'timestamp': datetime.datetime.now().isoformat(),
            **details,
        }

    # ═══════════════════════════════════════════════════════════════════════
    # TEST A1 — Manual Override Persistence
    # ═══════════════════════════════════════════════════════════════════════
    def test_a1_manual_override(self):
        head('TEST A1 — Manual Override Persistence')
        cfg = self.cfg
        s   = cfg['test_students'][0]
        class_id    = cfg['class_id']
        course_code = cfg['course_code']
        matric      = s['matric']
        images      = self._images_from_dir(s['images_dir'])

        if not images:
            skip(f'No images in {s["images_dir"]}')
            self._log('A1_manual_override', False, {'skipped': True})
            return

        # ① Create session
        session_id = self._create_session(class_id, course_code)
        if not session_id:
            fail('Could not create session'); return
        info(f'Session: {session_id}')

        # ② Upload initial frames — expect auto-recognition
        info('Uploading initial frames to trigger auto-recognition…')
        for img in images[:2]:
            r = self._upload_image(class_id, str(img))
            fr = r.get('face_recognition_ms', 'N/A')
            info(f'  {img.name} — face_recognition_ms={fr} ms')
            time.sleep(1)

        attendees_before = self._get_attendees(session_id)
        auto_entry = next((a for a in attendees_before if a.get('matricNumber') == matric), None)
        auto_marked = auto_entry is not None and not auto_entry.get('manuallyOverridden') and auto_entry.get('present', True)
        if auto_marked:
            ok(f'{matric} auto-marked present')
        else:
            warn(f'{matric} NOT auto-marked — may need more frames or check registration')

        # ③ Override to Absent
        override_ok = self._override(session_id, matric, False)
        info(f'Override to Absent: {"applied ✓" if override_ok else "FAILED ✗"}')

        # ④ Upload more frames — override must persist
        info('Uploading post-override frames…')
        for img in (images[2:4] if len(images) >= 4 else images[:2]):
            self._upload_image(class_id, str(img))
            time.sleep(1)

        # ⑤ Verify override held — the entry must still exist, with
        # manuallyOverridden=True and present=False (not missing/removed).
        attendees_after = self._get_attendees(session_id)
        after_entry = next((a for a in attendees_after if a.get('matricNumber') == matric), None)
        override_held = (
            after_entry is not None
            and after_entry.get('manuallyOverridden') is True
            and after_entry.get('present') is False
        )

        self._end_session(session_id)

        passed = override_ok and override_held
        if passed: ok('Override held — not re-marked by subsequent frames')
        else:      fail('Override did NOT persist correctly')

        self._log('A1_manual_override', passed, {
            'session_id':         session_id,
            'test_matric':        matric,
            'auto_marked':        auto_marked,
            'override_applied':   override_ok,
            'override_held':      override_held,
            'final_entry':        after_entry,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST A2 — Biometric Erasure
    # ═══════════════════════════════════════════════════════════════════════
    def test_a2_erasure(self):
        head('TEST A2 — Biometric Erasure')
        cfg = self.cfg

        if len(cfg['test_students']) < 2:
            skip('Need ≥ 2 test_students for A2')
            self._log('A2_erasure', False, {'skipped': True, 'reason': 'need 2 students'})
            return

        s2          = cfg['test_students'][1]
        class_id    = cfg['class_id']
        course_code = cfg['course_code']
        matric      = s2['matric']
        images      = self._images_from_dir(s2['images_dir'])

        if not images:
            skip(f'No images for student {matric}')
            self._log('A2_erasure', False, {'skipped': True}); return

        # ① Confirm recognised BEFORE erasure
        sid1 = self._create_session(class_id, course_code)
        if not sid1: fail('Could not create pre-erasure session'); return

        for img in images[:2]:
            self._upload_image(class_id, str(img)); time.sleep(1)

        attendees1         = self._get_attendees(sid1)
        recognized_before = any(a.get('matricNumber') == matric and a.get('present', True)
                                 for a in attendees1)
        self._end_session(sid1)
        info(f'Recognised before erasure: {recognized_before}')

        # ② Erase embeddings
        r = requests.delete(f'{self.base}/students/{matric}/embeddings',
                            headers=self._headers(), timeout=10)
        erasure_ok = r.status_code in (200, 204)
        if erasure_ok:
            ok(f'Embeddings deleted for {matric} (HTTP {r.status_code})')
        else:
            fail(f'Erasure failed: {r.status_code} — {r.text[:200]}')

        # ③ Confirm NOT recognised AFTER erasure
        sid2 = self._create_session(class_id, course_code)
        if not sid2: fail('Could not create post-erasure session'); return

        for img in images[:2]:
            self._upload_image(class_id, str(img)); time.sleep(1)

        attendees2        = self._get_attendees(sid2)
        recognized_after = any(a.get('matricNumber') == matric and a.get('present', True)
                                for a in attendees2)
        self._end_session(sid2)

        if not recognized_after: ok('Not recognised after erasure — PASS')
        else:                     fail('Still recognised after erasure — FAIL')

        passed = erasure_ok and not recognized_after
        self._log('A2_erasure', passed, {
            'matric':             matric,
            'recognized_before':  recognized_before,
            'erasure_ok':         erasure_ok,
            'recognized_after':   recognized_after,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST A3 — Export Verification (MANUAL — see module docstring)
    # ═══════════════════════════════════════════════════════════════════════
    def test_a3_export(self):
        head('TEST A3 — Attendance Export Verification')
        warn('Export (CSV/JSON/DOCX/PDF) runs entirely client-side in the browser')
        warn('(frontend/src/lib/exportAttendance.ts, via docx/jsPDF) — there is')
        warn('no backend /export endpoint, so this cannot be driven over HTTP.')
        info('Manual steps:')
        info('  1. In the dashboard, open a completed session for this course.')
        info('  2. Click each export option: CSV, JSON, Word (.docx), PDF.')
        info('  3. Open each downloaded file and verify: student names/matric')
        info('     numbers are correct, present/absent status matches the')
        info('     dashboard, method (auto/manual) and timestamp are present.')
        info('  4. Record the result directly in the Export Verification Log')
        info('     table in the test document — there is no script output for this test.')

        self._log('A3_export', False, {
            'skipped': True,
            'reason': ('export is client-side only; no backend endpoint exists to '
                       'test against. Verify manually via the dashboard UI.'),
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST A4 — Session Lifecycle
    # ═══════════════════════════════════════════════════════════════════════
    def test_a4_session_lifecycle(self):
        head('TEST A4 — Session Lifecycle (Create → Upload → End → Freeze)')
        cfg         = self.cfg
        class_id    = cfg['class_id']
        course_code = cfg['course_code']
        images      = self._images_from_dir(cfg['test_students'][0]['images_dir'])

        # ① Create
        session_id = self._create_session(class_id, course_code)
        if not session_id:
            fail('Session creation failed')
            self._log('A4_session_lifecycle', False, {'error': 'creation failed'}); return
        ok(f'Session created: {session_id}')

        # ② Upload during active session
        active_upload_ok = False
        if images:
            resp = self._upload_image(class_id, str(images[0]))
            active_upload_ok = '_error' not in resp
            info(f'Upload during active session: {"OK ✓" if active_upload_ok else "FAILED ✗"}')

        attendees_before_end = self._get_attendees(session_id)

        # ③ End session
        end_ok = self._end_session(session_id)
        if end_ok: ok('Session ended successfully')
        else:      fail('Session end call failed')

        # ④ Upload AFTER end — attendance should be frozen. Uploading to an
        # ended session's classroom still runs YOLO/occupancy (that endpoint
        # doesn't know about session state), but face recognition only marks
        # attendance for an ACTIVE session, so the attendee list must be
        # unchanged — verify this directly rather than eyeballing the response.
        attendance_frozen = True
        if images:
            resp2 = self._upload_image(class_id, str(images[0]))
            info(f'Post-end upload response: {"OK ✓" if "_error" not in resp2 else "error"}')
            attendees_after_end = self._get_attendees(session_id)
            attendance_frozen = (
                sorted(a.get('matricNumber') for a in attendees_before_end)
                == sorted(a.get('matricNumber') for a in attendees_after_end)
            )
            info(f'Attendance list unchanged after end: {attendance_frozen}')

        # ⑤ Confirm endedAt field
        session_doc = self._get_session(session_id)
        has_ended_at   = False
        ended_at_value = None
        if session_doc:
            ended_at_value = session_doc.get('endedAt')
            has_ended_at = bool(ended_at_value)
            info(f'endedAt present: {has_ended_at}  value: {ended_at_value}')

        passed = end_ok and has_ended_at and attendance_frozen
        if passed: ok('Lifecycle test PASS')
        else:      fail('Lifecycle test FAIL — see fields above')

        self._log('A4_session_lifecycle', passed, {
            'session_id':         session_id,
            'end_ok':             end_ok,
            'has_ended_at':       has_ended_at,
            'ended_at_value':     ended_at_value,
            'attendance_frozen':  attendance_frozen,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST B1 — Recognition Accuracy (TP / FP / FN across conditions)
    # ═══════════════════════════════════════════════════════════════════════
    def test_b1_recognition_accuracy(self):
        head('TEST B1 — Face Recognition Accuracy')
        cfg    = self.cfg
        trials = cfg.get('recognition_trials', [])

        if not trials:
            skip('Add "recognition_trials" to config to run B1')
            self._log('B1_recognition_accuracy', False, {'skipped': True}); return

        class_id    = cfg['class_id']
        course_code = cfg['course_code']

        all_TP = all_FP = all_FN = 0
        trial_results = []

        for trial in trials:
            name         = trial['name']
            images       = self._images_from_dir(trial['images_dir'])
            ground_truth = set(trial['ground_truth_present'])
            unregistered = set(trial.get('unregistered_present', []))

            info(f'\nTrial: {name}')
            info(f'  Images:       {len(images)}')
            info(f'  Enrolled+present: {ground_truth}')
            info(f'  Unregistered+present: {unregistered}')

            if not images:
                warn(f'  No images in {trial["images_dir"]} — skipping trial'); continue

            session_id = self._create_session(class_id, course_code)
            if not session_id:
                warn(f'  Could not create session for trial "{name}"'); continue

            frame_records = []
            for img in images:
                resp = self._upload_image(class_id, str(img))
                record = {
                    'file':                img.name,
                    'wall_ms':             resp.get('_wall_ms'),
                    'face_recognition_ms': resp.get('face_recognition_ms'),
                    'decode_ms':           resp.get('decode_ms'),
                    'inference_ms':        resp.get('inference_ms'),
                    'cloudinary_ms':       resp.get('cloudinary_ms'),
                    'error':               resp.get('_error'),
                }
                frame_records.append(record)
                info(f'  {img.name}: FR={resp.get("face_recognition_ms","N/A")} ms '
                     f'wall={resp.get("_wall_ms","N/A")} ms')
                time.sleep(0.5)

            self._end_session(session_id)

            # Pull final attendance — only entries that are actually present
            # AND auto-detected count toward recognition accuracy (a manual
            # override, present or absent, is not a recognition result).
            attendees   = self._get_attendees(session_id)
            auto_marked = {
                a['matricNumber'] for a in attendees
                if a.get('present', True) and a.get('method') == 'auto'
            }

            # Confusion matrix
            TP = len(ground_truth & auto_marked)
            FN = len(ground_truth - auto_marked)
            FP = len(auto_marked - ground_truth)   # marked but not in ground truth

            all_TP += TP; all_FP += FP; all_FN += FN

            rec_rate = (TP / (TP + FN) * 100) if (TP + FN) > 0 else 0.0
            fpr = None
            if unregistered:
                # FP only among unregistered
                fp_unregistered = len(auto_marked & unregistered)
                fpr = round(fp_unregistered / len(unregistered) * 100, 2)

            info(f'  TP={TP}  FP={FP}  FN={FN}  '
                 f'Recognition rate={rec_rate:.1f}%'
                 + (f'  FPR={fpr}%' if fpr is not None else ''))

            trial_results.append({
                'trial':                name,
                'session_id':           session_id,
                'ground_truth_present': list(ground_truth),
                'auto_marked':          list(auto_marked),
                'TP': TP, 'FP': FP, 'FN': FN,
                'recognition_rate_pct': round(rec_rate, 2),
                'fpr_pct':              fpr,
                'frame_records':        frame_records,
            })

        # Overall
        total_p = all_TP + all_FN
        overall  = (all_TP / total_p * 100) if total_p > 0 else 0.0

        print(f'\n  ── OVERALL ─────────────────────────────')
        print(f'  TP={all_TP}  FP={all_FP}  FN={all_FN}')
        print(f'  Recognition rate: {overall:.2f}%')

        if overall >= 90: ok(f'B1 target met: {overall:.2f}% ≥ 90%')
        else:             warn(f'B1 below target: {overall:.2f}% < 90%')

        self.results['metrics']['B1'] = {
            'overall_TP':  all_TP, 'overall_FP': all_FP, 'overall_FN': all_FN,
            'overall_recognition_rate_pct': round(overall, 2),
        }
        self._log('B1_recognition_accuracy', overall >= 90, {
            'overall_recognition_rate_pct': round(overall, 2),
            'trials': trial_results,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST B2 — Face Recognition Pipeline Latency
    # ═══════════════════════════════════════════════════════════════════════
    def test_b2_fr_latency(self):
        head('TEST B2 — Face Recognition Pipeline Latency')
        cfg         = self.cfg
        class_id    = cfg['class_id']
        course_code = cfg['course_code']

        images = []
        for s in cfg['test_students']:
            images += self._images_from_dir(s['images_dir'])
        images = images[:15]   # cap at 15 uploads

        if not images:
            skip('No images available for B2')
            self._log('B2_fr_latency', False, {'skipped': True}); return

        session_id = self._create_session(class_id, course_code)
        if not session_id:
            fail('Could not create session'); return

        fr_ms_vals   = []
        wall_ms_vals = []
        per_frame    = []

        for img in images:
            resp = self._upload_image(class_id, str(img))
            fr   = resp.get('face_recognition_ms')
            wall = resp.get('_wall_ms')
            if fr is not None:  fr_ms_vals.append(fr)
            if wall is not None: wall_ms_vals.append(wall)
            per_frame.append({'file': Path(img).name,
                              'face_recognition_ms': fr, 'wall_ms': wall})
            info(f'  {Path(img).name}: FR={fr} ms  wall={wall} ms')
            time.sleep(0.5)

        self._end_session(session_id)

        if not fr_ms_vals:
            warn('No face_recognition_ms values — check session was active')
            self._log('B2_fr_latency', False,
                      {'reason': 'no FR timing data', 'per_frame': per_frame}); return

        metrics = {
            'n':        len(fr_ms_vals),
            'min_ms':   round(min(fr_ms_vals), 2),
            'max_ms':   round(max(fr_ms_vals), 2),
            'avg_ms':   round(statistics.mean(fr_ms_vals), 2),
            'median_ms':round(statistics.median(fr_ms_vals), 2),
            'wall_avg_ms': round(statistics.mean(wall_ms_vals), 2) if wall_ms_vals else None,
            'all_ms':   fr_ms_vals,
        }
        ok(f'n={metrics["n"]}  min={metrics["min_ms"]}  '
           f'avg={metrics["avg_ms"]}  max={metrics["max_ms"]} ms')

        self.results['metrics']['B2'] = metrics
        self._log('B2_fr_latency', True, {**metrics, 'per_frame': per_frame})

    # ═══════════════════════════════════════════════════════════════════════
    # TEST B3 — End-to-End Attendance Latency
    # ═══════════════════════════════════════════════════════════════════════
    def test_b3_e2e_latency(self):
        head('TEST B3 — End-to-End Attendance Latency')
        cfg         = self.cfg
        class_id    = cfg['class_id']
        course_code = cfg['course_code']
        s0          = cfg['test_students'][0]
        matric      = s0['matric']
        images      = self._images_from_dir(s0['images_dir'])[:5]

        if not images:
            skip('No images for B3')
            self._log('B3_e2e_latency', False, {'skipped': True}); return

        e2e_ms_vals = []

        for i, img in enumerate(images):
            session_id = self._create_session(class_id, course_code)
            if not session_id:
                warn(f'  Trial {i+1}: could not create session'); continue

            t_start = time.perf_counter()
            self._upload_image(class_id, str(img))

            # Poll until student appears (present) or 10 s timeout
            marked   = False
            deadline = time.perf_counter() + 10
            while time.perf_counter() < deadline:
                if any(a.get('matricNumber') == matric and a.get('present', True)
                       for a in self._get_attendees(session_id)):
                    marked = True
                    break
                time.sleep(0.2)

            e2e_ms = (time.perf_counter() - t_start) * 1000
            self._end_session(session_id)

            if marked:
                e2e_ms_vals.append(round(e2e_ms, 2))
                ok(f'  Trial {i+1}: {e2e_ms:.0f} ms')
            else:
                warn(f'  Trial {i+1}: not marked within 10 s (e2e_ms={e2e_ms:.0f})')

        if not e2e_ms_vals:
            fail('No successful measurements — check student registration')
            self._log('B3_e2e_latency', False, {'no_measurements': True}); return

        metrics = {
            'n':         len(e2e_ms_vals),
            'min_ms':    min(e2e_ms_vals),
            'max_ms':    max(e2e_ms_vals),
            'avg_ms':    round(statistics.mean(e2e_ms_vals), 2),
            'median_ms': round(statistics.median(e2e_ms_vals), 2),
            'all_ms':    e2e_ms_vals,
        }
        ok(f'avg={metrics["avg_ms"]} ms  max={metrics["max_ms"]} ms  '
           f'(target < 5000 ms)')

        passed = metrics['avg_ms'] < 5000
        self.results['metrics']['B3'] = metrics
        self._log('B3_e2e_latency', passed, metrics)

    # ═══════════════════════════════════════════════════════════════════════
    # TEST C1 — Occupancy Capped at Capacity
    # ═══════════════════════════════════════════════════════════════════════
    def test_c1_occupancy_cap(self):
        head('TEST C1 — Occupancy Capped at Capacity')
        cfg      = self.cfg
        class_id = cfg['class_id']
        over_dir = cfg.get('occupancy_over_capacity_dir')

        if not over_dir:
            skip('Set "occupancy_over_capacity_dir" in config to run C1')
            self._log('C1_occupancy_cap', False, {'skipped': True}); return

        images = self._images_from_dir(over_dir)
        if not images:
            skip(f'No images in {over_dir}')
            self._log('C1_occupancy_cap', False, {'skipped': True}); return

        classroom = self._get_classroom(class_id)
        if not classroom:
            fail('Could not read classroom'); return
        capacity = classroom.get('capacity')
        info(f'Classroom capacity: {capacity}')

        resp = self._upload_image(class_id, str(images[0]))
        if '_error' in resp:
            fail(f'Upload failed: {resp}'); return

        reported = (resp.get('_classroom') or {}).get('occupancy')
        info(f'Reported occupancy after over-capacity frame: {reported}')

        passed = reported is not None and capacity is not None and reported <= capacity
        if passed: ok(f'Occupancy capped at {reported} (capacity {capacity})')
        else:      fail(f'Occupancy {reported} exceeds capacity {capacity} — cap not applied')

        self._log('C1_occupancy_cap', passed, {
            'capacity': capacity,
            'reported_occupancy': reported,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST C2 — Capacity Alert Email (MANUAL confirmation — see module docstring)
    # ═══════════════════════════════════════════════════════════════════════
    def test_c2_capacity_alert(self):
        head('TEST C2 — Capacity Alert Email')
        cfg       = self.cfg
        class_id  = cfg['class_id']
        over_dir  = cfg.get('occupancy_over_capacity_dir')
        under_dir = cfg.get('occupancy_under_capacity_dir')

        if not over_dir:
            skip('Set "occupancy_over_capacity_dir" in config to run C2')
            self._log('C2_capacity_alert', False, {'skipped': True}); return

        if under_dir:
            under_images = self._images_from_dir(under_dir)
            if under_images:
                info('Uploading an under-capacity frame — should NOT trigger an alert…')
                self._upload_image(class_id, str(under_images[0]))
                time.sleep(1)

        over_images = self._images_from_dir(over_dir)
        if not over_images:
            skip(f'No images in {over_dir}')
            self._log('C2_capacity_alert', False, {'skipped': True}); return

        info('Uploading an over-capacity frame — SHOULD trigger an alert…')
        resp = self._upload_image(class_id, str(over_images[0]))
        if '_error' in resp:
            fail(f'Upload failed: {resp}'); return

        warn('Alert delivery cannot be confirmed over the API — it is a real email.')
        info('Check the ALERT_EMAIL inbox now: expect one "Capacity Alert" email for '
             f'{class_id}, sent only after the over-capacity upload.')
        warn('No cooldown/throttle exists in send_occupancy_alert() — every single '
             'over-capacity frame sends a new email. A room that stays over capacity '
             'in production (camera uploads every ~3s) means one email per upload, '
             'not one per "became over capacity" transition — worth knowing before '
             'you leave a real classroom over capacity for any length of time.')

        self._log('C2_capacity_alert', False, {
            'skipped': True,
            'reason': 'alert delivery can only be confirmed by checking the ALERT_EMAIL inbox by hand',
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST C3 — Live WebSocket Occupancy Broadcast
    # ═══════════════════════════════════════════════════════════════════════
    def test_c3_ws_broadcast(self):
        head('TEST C3 — Live WebSocket Occupancy Broadcast')
        cfg      = self.cfg
        class_id = cfg['class_id']
        images   = self._images_from_dir(cfg['test_students'][0]['images_dir']) if cfg.get('test_students') else []

        if not images:
            skip('No images available for C3')
            self._log('C3_ws_broadcast', False, {'skipped': True}); return

        result = asyncio.run(self._upload_and_wait_for_broadcast(class_id, str(images[0])))

        if result.get('ws_error'):
            fail(f'WebSocket connection failed: {result["ws_error"]}')
            self._log('C3_ws_broadcast', False, {'ws_error': result['ws_error']}); return

        event             = result.get('event')
        upload_occupancy  = ((result.get('upload') or {}).get('_classroom') or {}).get('occupancy')
        event_occupancy   = ((event or {}).get('classroom') or {}).get('occupancy')

        passed = event is not None and event_occupancy == upload_occupancy
        if passed:
            ok(f'Broadcast received in {result.get("latency_ms")} ms, '
               f'occupancy matches ({event_occupancy})')
        else:
            fail('No matching broadcast received, or occupancy mismatch')

        self._log('C3_ws_broadcast', passed, {
            'received':         event is not None,
            'latency_ms':       result.get('latency_ms'),
            'upload_occupancy': upload_occupancy,
            'event_occupancy':  event_occupancy,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST C4 — Image Rotation (Cloudinary)
    # ═══════════════════════════════════════════════════════════════════════
    def test_c4_image_rotation(self):
        head('TEST C4 — Image Rotation (Cloudinary)')
        cfg      = self.cfg
        class_id = cfg['class_id']
        images   = self._images_from_dir(cfg['test_students'][0]['images_dir']) if cfg.get('test_students') else []

        if len(images) < 2:
            skip('Need at least 2 images for C4')
            self._log('C4_image_rotation', False, {'skipped': True}); return

        classroom_before = self._get_classroom(class_id)
        url_before = (classroom_before or {}).get('latestImage')

        resp1 = self._upload_image(class_id, str(images[0]))
        url_after_1 = (resp1.get('_classroom') or {}).get('latestImage')

        resp2 = self._upload_image(class_id, str(images[1]))
        url_after_2 = (resp2.get('_classroom') or {}).get('latestImage')

        changed_once  = bool(url_after_1) and url_after_1 != url_before
        changed_twice = bool(url_after_2) and url_after_2 != url_after_1
        passed = changed_once and changed_twice

        if passed: ok('latestImage URL changed on every upload')
        else:      fail('latestImage did not change as expected')

        warn('Deletion of the OLD Cloudinary asset is best-effort (wrapped in a silent '
             'try/except in upload_image) — this only confirms the URL rotated, not that '
             'the previous asset was actually removed. Spot-check the Cloudinary console\'s '
             '"smart_classrooms" folder by hand to confirm images aren\'t piling up unbounded.')

        self._log('C4_image_rotation', passed, {
            'url_before':  url_before,
            'url_after_1': url_after_1,
            'url_after_2': url_after_2,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST D1 — Occupancy Counting Accuracy Across Conditions
    # ═══════════════════════════════════════════════════════════════════════
    def test_d1_occupancy_accuracy(self):
        head('TEST D1 — Occupancy Counting Accuracy Across Conditions')
        cfg    = self.cfg
        trials = cfg.get('occupancy_trials', [])

        if not trials:
            skip('Add "occupancy_trials" to config to run D1')
            self._log('D1_occupancy_accuracy', False, {'skipped': True}); return

        class_id = cfg['class_id']
        errors   = []
        trial_results = []

        for trial in trials:
            name       = trial['name']
            images     = self._images_from_dir(trial['images_dir'])
            true_count = trial['true_count']

            info(f'\nTrial: {name}  (true count: {true_count})')
            if not images:
                warn(f'  No images in {trial["images_dir"]} — skipping trial'); continue

            detected_counts = []
            for img in images:
                resp = self._upload_image(class_id, str(img))
                occ  = (resp.get('_classroom') or {}).get('occupancy')
                if occ is not None:
                    detected_counts.append(occ)
                    info(f'  {img.name}: detected={occ}')
                time.sleep(0.5)

            if not detected_counts:
                warn(f'  No valid detections for trial "{name}"'); continue

            avg_detected = statistics.mean(detected_counts)
            error = avg_detected - true_count
            errors.append(abs(error))

            info(f'  Avg detected={avg_detected:.2f}  true={true_count}  error={error:+.2f}')
            trial_results.append({
                'trial':            name,
                'true_count':       true_count,
                'detected_counts':  detected_counts,
                'avg_detected':     round(avg_detected, 2),
                'error':            round(error, 2),
            })

        if not errors:
            fail('No trials produced results')
            self._log('D1_occupancy_accuracy', False, {'no_results': True}); return

        mae = statistics.mean(errors)
        print(f'\n  ── OVERALL ─────────────────────────────')
        print(f'  Mean Absolute Error: {mae:.2f} people')

        # No official target exists for this in the project docs (unlike B1's
        # 90%/5% from the original attendance test plan) — 1.0 is a reasonable
        # starting bar for a single-camera nano-YOLO setup at conf=0.5; adjust
        # to whatever your report actually commits to.
        passed = mae <= 1.0
        if passed: ok(f'D1 within suggested target: MAE={mae:.2f} <= 1.0')
        else:      warn(f'D1 above suggested target: MAE={mae:.2f} > 1.0')

        self.results['metrics']['D1'] = {'mae': round(mae, 2)}
        self._log('D1_occupancy_accuracy', passed, {
            'mae': round(mae, 2),
            'trials': trial_results,
        })

    # ═══════════════════════════════════════════════════════════════════════
    # TEST D2 — YOLO Inference Latency
    # ═══════════════════════════════════════════════════════════════════════
    def test_d2_inference_latency(self):
        head('TEST D2 — YOLO Inference Latency')
        cfg      = self.cfg
        class_id = cfg['class_id']

        images = []
        for s in cfg.get('test_students', []):
            images += self._images_from_dir(s['images_dir'])
        images = images[:15]

        if not images:
            skip('No images available for D2')
            self._log('D2_inference_latency', False, {'skipped': True}); return

        inf_vals  = []
        per_frame = []
        for img in images:
            resp = self._upload_image(class_id, str(img))
            inf  = resp.get('inference_ms')
            if inf is not None: inf_vals.append(inf)
            per_frame.append({'file': Path(img).name, 'inference_ms': inf})
            info(f'  {Path(img).name}: inference_ms={inf}')
            time.sleep(0.5)

        if not inf_vals:
            warn('No inference_ms values returned — check the classroom accepts uploads')
            self._log('D2_inference_latency', False,
                      {'reason': 'no timing data', 'per_frame': per_frame}); return

        metrics = {
            'n':         len(inf_vals),
            'min_ms':    round(min(inf_vals), 2),
            'max_ms':    round(max(inf_vals), 2),
            'avg_ms':    round(statistics.mean(inf_vals), 2),
            'median_ms': round(statistics.median(inf_vals), 2),
            'all_ms':    inf_vals,
        }
        ok(f'n={metrics["n"]}  min={metrics["min_ms"]}  '
           f'avg={metrics["avg_ms"]}  max={metrics["max_ms"]} ms')

        self.results['metrics']['D2'] = metrics
        self._log('D2_inference_latency', True, {**metrics, 'per_frame': per_frame})

    # ═══════════════════════════════════════════════════════════════════════
    # TEST D3 — End-to-End Occupancy Update Latency (WebSocket-confirmed)
    # ═══════════════════════════════════════════════════════════════════════
    def test_d3_e2e_occupancy_latency(self):
        head('TEST D3 — End-to-End Occupancy Update Latency')
        cfg      = self.cfg
        class_id = cfg['class_id']

        images = []
        for s in cfg.get('test_students', []):
            images += self._images_from_dir(s['images_dir'])
        images = images[:5]

        if not images:
            skip('No images for D3')
            self._log('D3_e2e_occupancy_latency', False, {'skipped': True}); return

        e2e_vals = []
        for i, img in enumerate(images):
            result = asyncio.run(self._upload_and_wait_for_broadcast(class_id, str(img)))
            latency = result.get('latency_ms')
            if result.get('ws_error'):
                warn(f'  Trial {i+1}: WebSocket error — {result["ws_error"]}')
            elif latency is not None:
                e2e_vals.append(latency)
                ok(f'  Trial {i+1}: {latency:.0f} ms')
            else:
                warn(f'  Trial {i+1}: no broadcast received within 10 s')

        if not e2e_vals:
            fail('No successful measurements')
            self._log('D3_e2e_occupancy_latency', False, {'no_measurements': True}); return

        metrics = {
            'n':         len(e2e_vals),
            'min_ms':    min(e2e_vals),
            'max_ms':    max(e2e_vals),
            'avg_ms':    round(statistics.mean(e2e_vals), 2),
            'median_ms': round(statistics.median(e2e_vals), 2),
            'all_ms':    e2e_vals,
        }
        ok(f'avg={metrics["avg_ms"]} ms  max={metrics["max_ms"]} ms  (target < 5000 ms)')

        passed = metrics['avg_ms'] < 5000
        self.results['metrics']['D3'] = metrics
        self._log('D3_e2e_occupancy_latency', passed, metrics)

    # ═══════════════════════════════════════════════════════════════════════
    # Save outputs
    # ═══════════════════════════════════════════════════════════════════════
    def save_results(self):
        self.results['session']['ended_at'] = datetime.datetime.now().isoformat()

        # ── 1. Full JSON ────────────────────────────────────────────────────
        json_path = self.out_dir / 'results.json'
        json_path.write_text(json.dumps(self.results, indent=2, default=str), encoding='utf-8')

        # ── 2. CSV summary ──────────────────────────────────────────────────
        csv_path = self.out_dir / 'summary.csv'
        rows = []
        for name, data in self.results['tests'].items():
            status = ('pass'    if data.get('passed')  else
                      'skipped' if data.get('skipped') else 'fail')
            rows.append({
                'test':      name,
                'status':    status,
                'timestamp': data.get('timestamp', ''),
                'notes':     data.get('reason', data.get('error', '')),
            })
        with open(csv_path, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=['test', 'status', 'timestamp', 'notes'])
            w.writeheader(); w.writerows(rows)

        # ── 3. Human-readable report ────────────────────────────────────────
        m = self.results.get('metrics', {})
        lines = [
            'CHAKAM TEST REPORT — ATTENDANCE MODE + OCCUPANCY MODE',
            '=' * 60,
            f'Session : {self.results["session"]["label"]}',
            f'Started : {self.results["session"]["started_at"]}',
            f'Ended   : {self.results["session"]["ended_at"]}',
            f'API     : {self.base}',
            '',
            'ALL TESTS',
            '-' * 40,
        ]
        for name, data in self.results['tests'].items():
            s = ('✓ PASS' if data.get('passed') else
                 'SKIP'   if data.get('skipped') else '✗ FAIL')
            lines.append(f'  {s}  {name}')

        lines += ['', 'QUANTITATIVE METRICS', '-' * 40]
        if 'B1' in m:
            b = m['B1']
            lines.append(f'  Recognition accuracy  : {b["overall_recognition_rate_pct"]}%  '
                         f'(TP={b["overall_TP"]}  FP={b["overall_FP"]}  FN={b["overall_FN"]})')
        if 'B2' in m:
            b = m['B2']
            lines.append(f'  FR latency  (n={b["n"]}): '
                         f'min={b["min_ms"]}  avg={b["avg_ms"]}  '
                         f'max={b["max_ms"]} ms')
        if 'B3' in m:
            b = m['B3']
            lines.append(f'  E2E latency (n={b["n"]}): '
                         f'avg={b["avg_ms"]}  max={b["max_ms"]} ms')
        if 'D1' in m:
            lines.append(f'  Occupancy MAE         : {m["D1"]["mae"]} people')
        if 'D2' in m:
            b = m['D2']
            lines.append(f'  YOLO inference (n={b["n"]}): '
                         f'min={b["min_ms"]}  avg={b["avg_ms"]}  '
                         f'max={b["max_ms"]} ms')
        if 'D3' in m:
            b = m['D3']
            lines.append(f'  Occupancy E2E (n={b["n"]}): '
                         f'avg={b["avg_ms"]}  max={b["max_ms"]} ms')
        lines.append('')
        lines.append('NOTE: A3 (export) and C2 (capacity alert) always show SKIP — both')
        lines.append('are verified manually (browser export buttons / ALERT_EMAIL inbox),')
        lines.append('not scripted. See the module docstring for why.')
        lines.append('')

        rpt_path = self.out_dir / 'report.txt'
        rpt_path.write_text('\n'.join(lines), encoding='utf-8')

        # ── Print summary ───────────────────────────────────────────────────
        print('\n' + '\n'.join(lines))
        print(f'Output directory: {self.out_dir}')
        print(f'  results.json : {json_path}')
        print(f'  summary.csv  : {csv_path}')
        print(f'  report.txt   : {rpt_path}')


# ═══════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(
        description='Chakam Test Runner — Attendance Mode (A/B) + Occupancy Mode (C/D)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python chakam_attendance_test.py --config config.json
  python chakam_attendance_test.py --config config.json --test b1
  python chakam_attendance_test.py --config config.json --test a3
  python chakam_attendance_test.py --config config.json --test c1
  python chakam_attendance_test.py --config config.json --capture test_images/trials/trial_1
  python chakam_attendance_test.py --config config.json --capture test_images/occupancy/trial_2 --capture-duration 30
        """
    )
    parser.add_argument('--config', default='config.json',
                        help='Path to config JSON (default: config.json)')
    parser.add_argument('--test',   default='all',
        choices=['all','a1','a2','a3','a4','b1','b2','b3','c1','c2','c3','c4','d1','d2','d3'],
        help='Which test to run (default: all)')
    parser.add_argument('--capture', metavar='OUT_DIR', default=None,
        help='Instead of running tests, listen live on the WebSocket and save '
             'every real frame the device sends to OUT_DIR as it arrives '
             '(Ctrl+C to stop). Use this to collect real camera frames for a '
             'B1/D1 trial while people are physically in the room — the '
             'backend only ever keeps the single latest image, so this is the '
             'only reliable way to capture more than one frame from a live '
             'session.')
    parser.add_argument('--capture-duration', type=float, default=None,
        help='With --capture: auto-stop after this many seconds instead of '
             'waiting for Ctrl+C.')
    args = parser.parse_args()

    if not Path(args.config).exists():
        print(f'Config file not found: {args.config}')
        print('Copy config.example.json → config.json and fill in your values.')
        sys.exit(1)

    runner = ChakamTestRunner(args.config)

    # Auth
    if not runner.authenticate(runner.cfg['lecturer_email'], 'Lecturer'):
        sys.exit(1)

    if args.capture:
        out_dir = Path(args.capture)
        try:
            saved = asyncio.run(
                runner.capture_live_frames(runner.cfg['class_id'], out_dir, args.capture_duration)
            )
        except KeyboardInterrupt:
            print('\nCapture stopped.')
            saved = None
        if saved is not None:
            print(f'\n{saved} frame(s) saved to {out_dir}')
        return

    test_map = {
        'a1': runner.test_a1_manual_override,
        'a2': runner.test_a2_erasure,
        'a3': runner.test_a3_export,
        'a4': runner.test_a4_session_lifecycle,
        'b1': runner.test_b1_recognition_accuracy,
        'b2': runner.test_b2_fr_latency,
        'b3': runner.test_b3_e2e_latency,
        'c1': runner.test_c1_occupancy_cap,
        'c2': runner.test_c2_capacity_alert,
        'c3': runner.test_c3_ws_broadcast,
        'c4': runner.test_c4_image_rotation,
        'd1': runner.test_d1_occupancy_accuracy,
        'd2': runner.test_d2_inference_latency,
        'd3': runner.test_d3_e2e_occupancy_latency,
    }

    if args.test == 'all':
        for fn in test_map.values():
            fn()
    else:
        test_map[args.test]()

    runner.save_results()


if __name__ == '__main__':
    main()
