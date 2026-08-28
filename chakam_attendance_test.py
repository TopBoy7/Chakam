#!/usr/bin/env python3
"""
chakam_attendance_test.py
================================================================================
Chakam Attendance Mode — Automated Test Runner & Result Logger

Usage:
    python chakam_attendance_test.py --config config.json          # all tests
    python chakam_attendance_test.py --config config.json --test b1 # one test

Results are saved to:
    test_results/<timestamp>/
        results.json   — full structured output per test
        summary.csv    — one-row-per-test pass/fail summary
        report.txt     — human-readable report (paste into report §4.6)

Prerequisites (see config.example.json):
    - At least 2 students registered with photos on the live system
    - A classroom and course already created
    - Images of each registered student saved locally
    - Session trial images saved locally

IMPORTANT — backend response shape:
    Every Chakam API response is wrapped as {"success", "message", "data"}.
    All payload fields (session id, metrics, attendees, ...) live under
    "data", never at the top level. Every helper below unwraps that envelope
    before reading anything — do not add a new API call without doing the
    same, or it will silently read None/[] instead of erroring.

IMPORTANT — Test A3 (export) cannot be automated against the API:
    Attendance export (CSV/JSON/DOCX/PDF) runs entirely client-side in the
    browser (frontend/src/lib/exportAttendance.ts, using docx/jsPDF) — there
    is no backend /export endpoint to call. test_a3_export() below prints
    manual verification steps instead of making HTTP calls; it always logs
    as "skipped", by design, not a bug.

Dependencies:  pip install requests
================================================================================
"""

import os, sys, json, csv, time, argparse, datetime, statistics
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
        with open(config_path) as f:
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
        return out

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
        """Return sorted list of .jpg/.jpeg/.png files in a directory."""
        d = Path(directory)
        if not d.exists():
            warn(f'Directory not found: {directory}')
            return []
        return sorted(
            list(d.glob('*.jpg')) + list(d.glob('*.jpeg')) + list(d.glob('*.png'))
        )

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
    # Save outputs
    # ═══════════════════════════════════════════════════════════════════════
    def save_results(self):
        self.results['session']['ended_at'] = datetime.datetime.now().isoformat()

        # ── 1. Full JSON ────────────────────────────────────────────────────
        json_path = self.out_dir / 'results.json'
        json_path.write_text(json.dumps(self.results, indent=2, default=str))

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
        with open(csv_path, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['test', 'status', 'timestamp', 'notes'])
            w.writeheader(); w.writerows(rows)

        # ── 3. Human-readable report ────────────────────────────────────────
        m = self.results.get('metrics', {})
        lines = [
            'CHAKAM ATTENDANCE MODE — TEST REPORT',
            '=' * 60,
            f'Session : {self.results["session"]["label"]}',
            f'Started : {self.results["session"]["started_at"]}',
            f'Ended   : {self.results["session"]["ended_at"]}',
            f'API     : {self.base}',
            '',
            'FUNCTIONAL TESTS',
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
        lines.append('')
        lines.append('NOTE: A3 (export) always shows SKIP — it is verified manually via')
        lines.append('the dashboard UI, not scripted. See the module docstring for why.')
        lines.append('')

        rpt_path = self.out_dir / 'report.txt'
        rpt_path.write_text('\n'.join(lines))

        # ── Print summary ───────────────────────────────────────────────────
        print('\n' + '\n'.join(lines))
        print(f'Output directory: {self.out_dir}')
        print(f'  results.json : {json_path}')
        print(f'  summary.csv  : {csv_path}')
        print(f'  report.txt   : {rpt_path}')


# ═══════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(
        description='Chakam Attendance Mode Test Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python chakam_attendance_test.py --config config.json
  python chakam_attendance_test.py --config config.json --test b1
  python chakam_attendance_test.py --config config.json --test a3
        """
    )
    parser.add_argument('--config', default='config.json',
                        help='Path to config JSON (default: config.json)')
    parser.add_argument('--test',   default='all',
        choices=['all','a1','a2','a3','a4','b1','b2','b3'],
        help='Which test to run (default: all)')
    args = parser.parse_args()

    if not Path(args.config).exists():
        print(f'Config file not found: {args.config}')
        print('Copy config.example.json → config.json and fill in your values.')
        sys.exit(1)

    runner = ChakamTestRunner(args.config)

    # Auth
    if not runner.authenticate(runner.cfg['lecturer_email'], 'Lecturer'):
        sys.exit(1)

    test_map = {
        'a1': runner.test_a1_manual_override,
        'a2': runner.test_a2_erasure,
        'a3': runner.test_a3_export,
        'a4': runner.test_a4_session_lifecycle,
        'b1': runner.test_b1_recognition_accuracy,
        'b2': runner.test_b2_fr_latency,
        'b3': runner.test_b3_e2e_latency,
    }

    if args.test == 'all':
        for fn in test_map.values():
            fn()
    else:
        test_map[args.test]()

    runner.save_results()


if __name__ == '__main__':
    main()
