// =============================================================================
// API CLIENT
// =============================================================================
// Central place for every HTTP call the frontend makes.
//
// Base URL is set via the VITE_API_BASE_URL environment variable (see .env).
// Defaults to http://localhost:8000 for local development.
//
// RESPONSE ENVELOPE
// -----------------
// All endpoints — both existing classrooms and new attendance — must return
// JSON in this standard shape (already used by the existing classroom routes):
//
//   {
//     "success": true,
//     "message": "short human-readable status",
//     "data": { ... }          // the actual payload, shape varies per endpoint
//   }
//
// On errors, return HTTP 4xx/5xx with:
//   { "detail": "human-readable error message" }
//
// The frontend reads `detail` from error responses and shows it in the UI.
// =============================================================================

import type { Course, RegisteredStudent, Session, AttendanceRecord, StudentAttendanceSummary } from '@/types/attendance';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE  = import.meta.env.VITE_WS_URL       || 'ws://localhost:8000';

export const api = {

  // ===========================================================================
  // CLASSROOMS  (existing — no changes needed)
  // ===========================================================================
  // These routes already exist in main.py. Documented here for completeness.
  // The Classroom object shape is defined in src/types/classroom.ts.
  //
  //   GET    /classrooms              → { data: { classrooms: Classroom[] } }
  //   GET    /classrooms/:classId     → { data: { classroom: Classroom } }
  //   POST   /classrooms              → { data: { id: string } }
  //   PUT    /classrooms/:classId     → { data: { classroom: Classroom } }
  //   DELETE /classrooms/:classId     → { data: null }
  //   POST   /classrooms/:classId/image  (multipart) → { data: { classroom, metrics } }
  // ===========================================================================

  classrooms: {
    list: async () => {
      const res = await fetch(`${API_BASE}/classrooms`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData?.detail || 'Failed to fetch classrooms');
      }
      const data = await res.json();
      return data.data.classrooms;
    },
    get: async (classId: string) => {
      const res = await fetch(`${API_BASE}/classrooms/${classId}`);
      if (!res.ok) throw new Error('Classroom not found');
      const data = await res.json();
      return data.data.classroom;
    },
    create: async (payload: {
      classId: string;
      className: string;
      capacity: number;
      deviceId: string;
    }) => {
      const res = await fetch(`${API_BASE}/classrooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData?.detail || 'Failed to create classroom');
      }
      const data = await res.json();
      return data.data;
    },
    update: async (
      classId: string,
      payload: {
        classId?: string;
        className?: string;
        capacity?: number;
        deviceId?: string;
        latestImage?: string;
        occupancy?: number;
      }
    ) => {
      const res = await fetch(`${API_BASE}/classrooms/${classId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData?.detail || 'Failed to update classroom');
      }
      const data = await res.json();
      return data.data.classroom;
    },
    delete: async (classId: string) => {
      const res = await fetch(`${API_BASE}/classrooms/${classId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData?.detail || 'Failed to delete classroom');
      }
      return true;
    },
  },

  // ===========================================================================
  // ATTENDANCE MODULE  (new — all routes need to be implemented)
  // ===========================================================================
  // Router prefix: /attendance
  // Suggested FastAPI file: backend/attendance_router.py, included in main.py
  // with: app.include_router(attendance_router, prefix="/attendance")
  // ===========================================================================

  attendance: {

    // ─────────────────────────────────────────────────────────────────────────
    // COURSES
    // ─────────────────────────────────────────────────────────────────────────
    courses: {

      /**
       * GET /attendance/courses
       *
       * Returns all courses. For now there is no per-lecturer auth, so this
       * returns every course in the database. Later you could filter by
       * the logged-in lecturer's ID if you add lecturer accounts.
       *
       * Response shape:
       *   { data: { courses: Course[] } }
       *
       * Note: `studentCount` on each Course object must be a live count of
       * documents in the students collection for that courseId — do NOT store
       * it as a static field, it will go out of sync as students register.
       */
      list: async (): Promise<Course[]> => {
        const res = await fetch(`${API_BASE}/attendance/courses`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to fetch courses');
        }
        const data = await res.json();
        return data.data.courses;
      },

      /**
       * GET /attendance/courses/:courseId
       *
       * Returns a single course by its MongoDB _id (stringified).
       * Used when the lecturer navigates to a specific course's detail page.
       *
       * Response shape:
       *   { data: { course: Course } }
       *
       * Return 404 if courseId does not exist.
       */
      get: async (courseId: string): Promise<Course> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}`);
        if (!res.ok) throw new Error('Course not found');
        const data = await res.json();
        return data.data.course;
      },

      /**
       * POST /attendance/courses
       *
       * Creates a new course. The backend must auto-generate the
       * `registrationToken` (UUID v4) — the frontend does not send one.
       *
       * Request body (JSON):
       *   { courseCode: string, courseName: string }
       *
       * Response shape:
       *   { data: { course: Course } }   ← full Course object including the new id and token
       *
       * The `registrationToken` in the response is immediately used by the frontend
       * to generate the shareable student sign-up link:
       *   {FRONTEND_ORIGIN}/register/{registrationToken}
       *
       * Optionally enforce uniqueness of courseCode if desired.
       */
      create: async (payload: { courseCode: string; courseName: string }): Promise<Course> => {
        const res = await fetch(`${API_BASE}/attendance/courses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to create course');
        }
        const data = await res.json();
        return data.data.course;
      },

      /**
       * DELETE /attendance/courses/:courseId
       *
       * Deletes a course and should cascade-delete all related data:
       *   - All RegisteredStudent documents for this course
       *   - All Session documents for this course
       *   - All AttendanceRecord documents for those sessions
       *   - The stored passport photos from Cloudinary (or equivalent)
       *
       * Response shape:
       *   { data: null }
       *
       * Return 404 if courseId does not exist.
       */
      delete: async (courseId: string): Promise<void> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to delete course');
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STUDENTS
    // ─────────────────────────────────────────────────────────────────────────
    students: {

      /**
       * GET /attendance/courses/:courseId/students
       *
       * Returns all students registered for a specific course, ordered by
       * `registeredAt` ascending (oldest first) or by `matricNumber` alphabetically.
       *
       * Response shape:
       *   { data: { students: RegisteredStudent[] } }
       *
       * Do NOT include photoUrl — photos are never stored (NDPA s.24 data minimisation).
       * Return only: id, matricNumber, courseId, registeredAt.
       */
      list: async (courseId: string): Promise<RegisteredStudent[]> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}/students`);
        if (!res.ok) throw new Error('Failed to fetch students');
        const data = await res.json();
        return data.data.students;
      },

      /**
       * POST /attendance/courses/:courseId/register
       *
       * Student self-registration. Accepts multipart/form-data.
       * Public endpoint — no auth token required.
       *
       * Request body (multipart/form-data):
       *   matricNumber     string   uppercased by the frontend
       *   photos           File[]   up to 5 JPEG/PNG images (multi-file field)
       *   biometricConsent string   must equal "true"
       *   manualAltConsent string   must equal "true"
       *   ageConsent       string   must equal "true"  (NDPA s.31 — under-18 requires parental consent)
       *
       * ── CONSENT GATE (check FIRST, before touching any data) ──────────────
       *   if form.get("biometricConsent") != "true":
       *       raise HTTPException(422, "Biometric consent is required")
       *   if form.get("manualAltConsent") != "true":
       *       raise HTTPException(422, "Manual alternative acknowledgment is required")
       *   if form.get("ageConsent") != "true":
       *       raise HTTPException(422, "Age declaration is required")
       *   Never rely on the frontend to have already validated this.
       *
       * ── DUPLICATE CHECK ───────────────────────────────────────────────────
       *   Reject duplicate matricNumber for the same courseId → 409 Conflict.
       *
       * ── PHOTO PROCESSING — DATA MINIMISATION (NDPA s.24) ─────────────────
       *   *** DO NOT save photos to disk, Cloudinary, or any storage ***
       *   For each uploaded photo file:
       *     1. Read bytes into memory as a numpy array
       *     2. Run face_recognition.face_encodings() → 128-float vector
       *     3. If no face detected → return 422 "No face detected in photo N"
       *     4. Discard the image bytes — they must not persist anywhere
       *
       * ── STORE IN MONGODB ──────────────────────────────────────────────────
       *   {
       *     matricNumber:       str (uppercase),
       *     courseId:           str,
       *     embeddings:         List[List[float]],  # one per photo, 128 floats
       *     biometricConsent:   True,
       *     manualAltConsent:   True,
       *     ageConsent:         True,
       *     consentTimestamp:   datetime.utcnow(),  # NDPA audit trail
       *     consentVersion:     "1.0",
       *     registeredAt:       datetime.utcnow(),
       *     embeddingsDeleted:  False,
       *   }
       *   No photoUrls field. No Cloudinary reference. Photos are gone.
       *
       * ── RESPONSE ──────────────────────────────────────────────────────────
       *   201 Created: { data: { student: { matricNumber, courseId, registeredAt } } }
       *   Do NOT echo back embeddings.
       *
       * NOTE: courseId is the MongoDB _id of the course, NOT the registrationToken.
       * The token → courseId resolution happens at GET /attendance/register/:token.
       */
      /**
       * DELETE /attendance/courses/:courseId/students/biometrics
       *
       * Student right to erasure — NDPA s.36. Must be instant and irreversible.
       *
       * Request body (JSON):
       *   { matricNumber: string }
       *
       * Backend must:
       *   1. Find RegisteredStudent by (courseId, matricNumber). Return 404 if not found.
       *   2. Set embeddings: [] on the student document (wipe all 128-float vectors).
       *      There are no photos to delete — photos were never stored (see register endpoint).
       *   3. Update the document:
       *        embeddingsDeleted:    True
       *        consentWithdrawnAt:   datetime.utcnow()
       *      Do NOT hard-delete the document — the audit trail (consentTimestamp,
       *      consentWithdrawnAt) must be preserved for NDPA accountability.
       *   4. Past AttendanceRecord documents are NOT touched — historical marks are kept.
       *   5. Ensure the recognition pipeline skips this student by checking
       *      embeddingsDeleted == True before any face comparison.
       *   6. Return 204 No Content.
       */
      deleteBiometrics: async (courseId: string, matricNumber: string): Promise<void> => {
        const res = await fetch(
          `${API_BASE}/attendance/courses/${courseId}/students/biometrics`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ matricNumber: matricNumber.trim().toUpperCase() }),
          }
        );
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to delete biometric data');
        }
      },

      register: async (courseId: string, formData: FormData): Promise<void> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}/register`, {
          method: 'POST',
          body: formData,
          // Do NOT set Content-Type header — the browser sets it automatically
          // with the correct multipart boundary when body is FormData.
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Registration failed');
        }
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SESSIONS
    // ─────────────────────────────────────────────────────────────────────────
    sessions: {

      /**
       * GET /attendance/courses/:courseId/sessions
       *
       * Returns all sessions for a course, ordered by `startedAt` descending
       * (most recent first). Active sessions appear at the top.
       *
       * Response shape:
       *   { data: { sessions: Session[] } }
       *
       * Include `classroomName` in each session — the frontend uses it to show
       * which room the class was held in without needing an extra lookup.
       *
       * `presentCount` and `totalStudents` are only meaningful on ended sessions.
       * For active sessions, return the current live count.
       */
      list: async (courseId: string): Promise<Session[]> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}/sessions`);
        if (!res.ok) throw new Error('Failed to fetch sessions');
        const data = await res.json();
        return data.data.sessions;
      },

      /**
       * POST /attendance/sessions
       *
       * Starts a new class session. This is the most important endpoint in the
       * attendance module — it is the trigger that activates facial recognition.
       *
       * Request body (JSON):
       *   { courseId: string, classroomId: string }
       *
       *   `classroomId` is the MongoDB _id of the classroom (from the classrooms
       *   collection). Use it to look up the classroom's `deviceId`, which
       *   identifies the physical camera to activate.
       *
       * Backend must:
       *   1. Validate that courseId and classroomId both exist.
       *   2. Reject if the course already has an active session (return 409).
       *   3. Create a Session document with status: "active", startedAt: now().
       *   4. Look up the classroom to get its `deviceId`.
       *   5. Signal the facial recognition service to begin processing snapshots
       *      from that camera, cross-referenced against all registered student
       *      photos for this course.
       *      (Implementation detail: this could be a message on a queue, a
       *      direct call to a recognition worker, setting a flag in Redis, etc.)
       *
       * Response shape:
       *   { data: { session: Session } }
       *
       * The returned Session object must include `classroomName` so the frontend
       * can immediately display it in the active session banner without another request.
       */
      start: async (courseId: string, classroomId: string): Promise<Session> => {
        const res = await fetch(`${API_BASE}/attendance/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, classroomId }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to start session');
        }
        const data = await res.json();
        return data.data.session;
      },

      /**
       * POST /attendance/sessions/:sessionId/end
       *
       * Ends an active session.
       *
       * Backend must:
       *   1. Set status: "ended", endedAt: now() on the session document.
       *   2. Compute and store `presentCount` (students with status "present")
       *      and `totalStudents` (all registered students for the course at that time).
       *   3. Stop the facial recognition service for this classroom.
       *
       * Response shape:
       *   { data: null }   ← the frontend only checks for success/failure.
       *
       * Return 404 if sessionId does not exist.
       * Return 400 if session is already ended.
       */
      end: async (sessionId: string): Promise<void> => {
        const res = await fetch(`${API_BASE}/attendance/sessions/${sessionId}/end`, {
          method: 'POST',
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to end session');
        }
      },

      /**
       * GET /attendance/sessions/:sessionId/attendance
       *
       * Returns all attendance records for a session.
       * Only students detected by the camera OR manually overridden will have
       * a record. Students with no record are treated as absent by the frontend.
       *
       * Response shape:
       *   { data: { records: AttendanceRecord[] } }
       *
       * This endpoint is polled by the frontend every 30 seconds while a session
       * is active, to pick up new detections from the camera. Keep it fast.
       * The camera takes a snapshot every 5 minutes; new records may appear
       * between polls as the recognition pipeline processes each snapshot.
       */
      getAttendance: async (sessionId: string): Promise<AttendanceRecord[]> => {
        const res = await fetch(`${API_BASE}/attendance/sessions/${sessionId}/attendance`);
        if (!res.ok) throw new Error('Failed to fetch attendance');
        const data = await res.json();
        return data.data.records;
      },

      /**
       * PUT /attendance/sessions/:sessionId/attendance/:studentId
       *
       * Manually sets a student's attendance status. Called when the lecturer
       * clicks the toggle button next to a student in the Live Attendance panel.
       *
       * This is an UPSERT — if a record already exists for (sessionId, studentId),
       * update it. If not, create a new one. Either way, set `manuallyOverridden: true`.
       *
       * Request body (JSON):
       *   { status: "present" | "absent" }
       *
       * Use cases:
       *   - Lecturer marks a student present who wasn't captured by camera.
       *   - Lecturer marks a student absent who was captured but left early.
       *
       * Response shape:
       *   { data: null }   ← the frontend updates local state optimistically.
       *
       * Return 404 if sessionId or studentId does not exist.
       *
       * IMPORTANT: A manual override should NOT be reverted by the facial
       * recognition pipeline on the next snapshot. If `manuallyOverridden` is true,
       * the recognition service must leave that record alone.
       */
      updateAttendance: async (
        sessionId: string,
        studentId: string,
        status: 'present' | 'absent'
      ): Promise<void> => {
        const res = await fetch(
          `${API_BASE}/attendance/sessions/${sessionId}/attendance/${studentId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          }
        );
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to update attendance');
        }
      },

      /**
       * POST /attendance/sessions/:sessionId/capture
       *
       * On-demand attendance capture. Called when the lecturer taps "Take Attendance".
       * This replaces the old periodic-snapshot model — the lecturer decides the exact
       * moment to capture, so there are no late-arrival edge cases.
       *
       * Backend must:
       *   1. Retrieve the session and verify it is still active (return 400 if ended).
       *   2. Look up the classroom via session.classroomId → get classroom.deviceId.
       *   3. Signal the physical camera (identified by deviceId) to capture a snapshot NOW.
       *      Recommendation: take 2–3 frames over ~90 seconds and union the detections —
       *      this guards against a single bad frame (blinks, movement, occlusion).
       *   4. Run facial recognition on the captured frame(s) against all registered
       *      student photos for this course.
       *   5. For each matched student:
       *        a. If no attendance record exists → create one (status: "present", manuallyOverridden: false)
       *        b. If record exists and manuallyOverridden is false → update to "present"
       *        c. If record exists and manuallyOverridden is true → DO NOT touch (respect lecturer override)
       *   6. Return the full updated attendance list.
       *
       * Response shape:
       *   { data: { records: AttendanceRecord[] } }
       *
       * Return 400 if session is not active.
       * Return 503 with { detail: "Camera unreachable" } if the device cannot be contacted.
       */
      capture: async (sessionId: string): Promise<AttendanceRecord[]> => {
        const res = await fetch(
          `${API_BASE}/attendance/sessions/${sessionId}/capture`,
          { method: 'POST' }
        );
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to capture attendance');
        }
        const data = await res.json();
        return data.data.records;
      },
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STUDENT PORTAL  (public — no auth)
    // ─────────────────────────────────────────────────────────────────────────
    portal: {

      /**
       * GET /attendance/students/lookup/:matricNumber
       *
       * Public endpoint — no auth required. Used by /my-attendance.
       *
       * Backend must:
       *   1. Find all RegisteredStudent documents where matricNumber matches
       *      (case-insensitive). A student may be registered for multiple courses.
       *   2. For each course, find all ended Session documents.
       *   3. For each session, find the AttendanceRecord for this student (if any).
       *      Students with no record for a session count as absent.
       *   4. Compute attendanceRate = presentCount / totalSessions (0–1 float).
       *   5. Include the consent record from the RegisteredStudent document
       *      so the student can exercise their right of access (NDPA s.34).
       *
       * Response shape:
       *   { data: { results: StudentAttendanceSummary[] } }
       *
       *   Each result must include a `consent` object:
       *   {
       *     consentGivenAt:      str   (ISO 8601 — from consentTimestamp field),
       *     consentVersion:      str   (e.g. "1.0"),
       *     biometricsActive:    bool  (True unless embeddingsDeleted == True),
       *     consentWithdrawnAt:  str | null  (ISO 8601 if withdrawn, else omit/null),
       *   }
       *
       * Return 404 { detail: "No student found with this matric number" }
       *   if the matric number does not exist in any course.
       */
      lookup: async (matricNumber: string): Promise<StudentAttendanceSummary[]> => {
        const encoded = encodeURIComponent(matricNumber.trim().toUpperCase());
        const res = await fetch(`${API_BASE}/attendance/students/lookup/${encoded}`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'No records found for this matric number');
        }
        const data = await res.json();
        return data.data.results;
      },
    },
  },
};

export { WS_BASE };
