// =============================================================================
// ATTENDANCE MODULE — SHARED TYPE DEFINITIONS
// =============================================================================
// These types define the exact shape of data the frontend expects from every
// attendance-related API response. The backend must return objects that match
// these interfaces exactly (field names, types, and optionality).
//
// All date/time fields are expected as ISO 8601 strings
// e.g. "2025-04-18T10:30:00.000Z"
// =============================================================================

/**
 * A course created by a lecturer for attendance tracking.
 *
 * Backend responsibility:
 *  - Generate a unique `id` (e.g. MongoDB ObjectId stringified)
 *  - Generate a cryptographically random `registrationToken` (UUID v4 recommended).
 *    This token is embedded in the student registration URL:
 *    {FRONTEND_BASE_URL}/register/{registrationToken}
 *    It must be unique across all courses.
 *  - `studentCount` should be computed dynamically (COUNT of registered students
 *    for this course), NOT stored as a static field — otherwise it goes stale.
 *  - `courseCode` should be stored case-insensitively but returned in UPPERCASE.
 */
export interface Course {
  id: string;              // MongoDB _id stringified, used in all subsequent course API calls
  courseCode: string;      // e.g. "EMT 401" — displayed prominently as the course identifier
  courseName: string;      // e.g. "Electromagnetic Theory"
  studentCount: number;    // live count of students registered for this course
  createdAt: string;       // ISO 8601 datetime string
  registrationToken: string; // UUID used to build the public student registration link
}

/**
 * A student who has self-registered for a course.
 *
 * Backend responsibility:
 *  - Store the uploaded photo (e.g. in Cloudinary, same approach as classroom images).
 *  - `photoUrl` is the publicly accessible URL to the stored photo.
 *    It will be displayed as a small avatar next to the student's matric number.
 *  - The photo is the face embedding source for facial recognition. When a session
 *    is active, the recognition model should compare live camera frames against
 *    all photos for students registered in that course.
 *  - Enforce uniqueness of `matricNumber` per course — a student should not be
 *    able to register twice for the same course.
 */
export interface RegisteredStudent {
  id: string;            // MongoDB _id stringified
  matricNumber: string;  // e.g. "19/30CS/01234" — stored uppercase
  photoUrl?: string;     // Cloudinary (or equivalent) URL to the passport photo
  courseId: string;      // ID of the course this student is registered for
  registeredAt: string;  // ISO 8601 datetime string of when they registered
}

/**
 * A single class session — from "Start Class" to "End Class".
 *
 * Backend responsibility:
 *  - When a session is started (`status: "active"`), the backend should signal
 *    the facial recognition service to begin processing snapshots from the
 *    camera associated with `classroomId` → classroom.deviceId.
 *  - The camera takes a snapshot every 5 minutes. The recognition model runs
 *    on each snapshot and updates attendance records accordingly.
 *  - Only one session per course should be `active` at a time. The backend
 *    should reject a start request if the course already has an active session.
 *  - `classroomName` is optional but strongly recommended — it makes the
 *    session history readable without extra lookups.
 *  - `presentCount` and `totalStudents` are used in the session history list.
 *    They should be computed at end time and stored, not recalculated on every
 *    list request.
 *  - When a session ends (`POST /attendance/sessions/:id/end`), the backend
 *    should stop facial recognition for that classroom and finalise the records.
 */
export interface Session {
  id: string;                // MongoDB _id stringified
  courseId: string;          // ID of the course this session belongs to
  classroomId: string;       // ID of the classroom — used to look up deviceId for the camera
  classroomName?: string;    // Human-readable name, e.g. "Lecture Theatre 3" — include this
  startedAt: string;         // ISO 8601 datetime when the lecturer pressed "Start Class"
  endedAt?: string;          // ISO 8601 datetime when the lecturer pressed "End Class"
  status: 'active' | 'ended'; // "active" while class is running, "ended" after
  presentCount: number;      // Number of students marked present when session ended
  totalStudents: number;     // Total registered students at the time the session ended
}

/**
 * One student's attendance status within a specific session.
 *
 * Backend responsibility:
 *  - Records are created/updated when:
 *      a) The facial recognition model detects a student in a snapshot, OR
 *      b) The lecturer manually marks/unmarks a student via the frontend toggle.
 *  - `detectedAt` should be set to the timestamp of the snapshot in which the
 *    student was first identified by the camera. Leave null/omitted for manual entries.
 *  - `manuallyOverridden` must be true whenever a lecturer changes a student's
 *    status via the PUT endpoint, regardless of whether the camera had previously
 *    detected them. This flag is shown in the UI so the lecturer knows which
 *    entries were hand-edited.
 *  - The frontend uses an UPSERT pattern: if a record for (sessionId, studentId)
 *    already exists, update it; otherwise create a new one. The PUT endpoint
 *    must handle both cases.
 *  - All registered students for a course are shown in the live attendance list.
 *    Students with no record yet are shown as "not yet detected" (absent by default).
 */
export interface AttendanceRecord {
  id: string;                  // MongoDB _id stringified
  sessionId: string;           // ID of the session this record belongs to
  studentId: string;           // ID of the registered student
  matricNumber: string;        // Denormalised for display — avoids extra lookups
  status: 'present' | 'absent'; // "present" = detected or manually marked; "absent" = manually removed
  detectedAt?: string;         // ISO 8601 timestamp of the snapshot that caught the student
  manuallyOverridden: boolean; // true if a lecturer changed this status manually via the UI
}
