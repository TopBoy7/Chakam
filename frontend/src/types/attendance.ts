// =============================================================================
// ATTENDANCE MODULE — SHARED TYPE DEFINITIONS
// =============================================================================
// All date/time fields are ISO 8601 strings e.g. "2025-04-18T10:30:00.000Z"
// =============================================================================

export interface Course {
  id: string;
  courseCode: string;
  courseName: string;
  studentCount: number;    // live count — backend must compute dynamically
  createdAt: string;
  registrationToken: string;
}

export interface RegisteredStudent {
  id: string;
  matricNumber: string;
  fullName: string;
  courseId: string;
  registeredAt: string;
  photoUrl?: string;  // never populated — photos are not stored (NDPA s.24)
}

export interface Session {
  id: string;
  courseId: string;
  classroomId: string;
  classroomName?: string;
  startedAt: string;
  endedAt?: string;
  status: 'active' | 'ended';
  presentCount: number;
  totalStudents: number;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  matricNumber: string;
  status: 'present' | 'absent';
  detectedAt?: string;
  manuallyOverridden: boolean;
}

// =============================================================================
// STUDENT PORTAL TYPES
// =============================================================================
// Used by the public /my-attendance page where a student can check their own
// attendance history by entering their matric number.
//
// BACKEND: Implement GET /attendance/students/lookup/:matricNumber
//   - Public endpoint, no auth required
//   - Look up all AttendanceRecord documents where matricNumber matches
//   - Group by course, then by session
//   - Return { data: { results: StudentAttendanceSummary[] } }
// =============================================================================

export interface StudentSessionRecord {
  sessionId: string;
  date: string;                       // ISO 8601 startedAt of the session
  classroomName?: string;
  status: 'present' | 'absent';
  manuallyOverridden: boolean;
}

// Consent record returned alongside attendance so the student can verify
// what they agreed to and when (NDPA s.34 — right of access).
//
// BACKEND: include this on every StudentAttendanceSummary entry.
// Source fields from the RegisteredStudent document in MongoDB:
//   consentTimestamp    → consentGivenAt
//   consentVersion      → consentVersion
//   embeddingsDeleted   → biometricsActive (invert the flag)
//   consentWithdrawnAt  → consentWithdrawnAt (omit if still active)
export interface ConsentRecord {
  consentGivenAt: string;            // ISO 8601 — when all three boxes were checked
  consentVersion: string;            // e.g. "1.0" — bump when notice text changes
  biometricsActive: boolean;         // false once student has deleted their embedding
  consentWithdrawnAt?: string;       // ISO 8601 — set when student deletes their data
}

// Admin-level student record (from GET /students — no embeddings)
export interface StudentRecord {
  id: string;
  matricNumber: string;
  fullName: string;
  registeredAt: string;
  embeddingsDeleted: boolean;
  consentTimestamp?: string;
  consentVersion: string;
  consentWithdrawnAt?: string;
}

// Course enrollment record
export interface Enrollment {
  id: string;
  courseCode: string;
  matricNumber: string;
  enrolledAt: string;
}

export interface StudentAttendanceSummary {
  courseId: string;
  courseCode: string;
  courseName: string;
  presentCount: number;
  totalSessions: number;              // all ended sessions for this course
  attendanceRate: number;             // 0–1 float, e.g. 0.75 — backend computes, frontend multiplies ×100 for display
  sessions: StudentSessionRecord[];
  consent: ConsentRecord;             // NDPA s.34 — always included
}
