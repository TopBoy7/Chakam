import type { Course, RegisteredStudent, Session, AttendanceRecord, StudentAttendanceSummary, StudentRecord, Enrollment } from '@/types/attendance';
import type { Lecturer } from '@/types/lecturer';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE  = import.meta.env.VITE_WS_URL       || 'ws://localhost:8000';

// ── helpers ──────────────────────────────────────────────────────────────────

async function throwOnError(res: Response): Promise<Response> {
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json())?.detail || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res;
}

function transformCourse(raw: Record<string, unknown>, studentCount = 0): Course {
  return {
    id: raw.courseCode as string,
    courseCode: raw.courseCode as string,
    courseName: raw.courseName as string,
    registrationToken: (raw.registrationToken as string) || '',
    studentCount,
    createdAt: raw.createdAt as string,
  };
}

function transformSession(raw: Record<string, unknown>): Session {
  const attendees = (raw.attendees as unknown[]) ?? [];
  return {
    id: raw.sessionId as string,
    courseId: raw.courseCode as string,
    classroomId: raw.classId as string,
    classroomName: raw.classroomName as string | undefined,
    startedAt: raw.startedAt as string,
    endedAt: raw.endedAt as string | undefined,
    status: raw.status as 'active' | 'ended',
    presentCount: attendees.length,
    totalStudents: 0,
  };
}

function transformAttendees(attendees: Array<Record<string, unknown>>, sessionId: string): AttendanceRecord[] {
  return attendees.map((a) => ({
    id: a.matricNumber as string,
    sessionId,
    studentId: a.matricNumber as string,
    matricNumber: a.matricNumber as string,
    status: 'present' as const,
    detectedAt: a.markedAt as string | undefined,
    manuallyOverridden: (a.manuallyOverridden as boolean) ?? false,
  }));
}

function transformLecturer(raw: Record<string, unknown>): Lecturer {
  return {
    id: (raw.id ?? raw._id ?? raw.staffId) as string,
    staffId: raw.staffId as string,
    fullName: raw.fullName as string,
    email: raw.email as string,
    createdAt: raw.createdAt as string,
  };
}

function transformStudentRecord(raw: Record<string, unknown>): StudentRecord {
  return {
    id: (raw.id ?? raw._id ?? raw.matricNumber) as string,
    matricNumber: raw.matricNumber as string,
    fullName: (raw.fullName as string) || '',
    registeredAt: raw.registeredAt as string,
    embeddingsDeleted: (raw.embeddingsDeleted as boolean) ?? false,
    consentTimestamp: raw.consentTimestamp as string | undefined,
    consentVersion: (raw.consentVersion as string) || '1.0',
    consentWithdrawnAt: raw.consentWithdrawnAt as string | undefined,
  };
}

function transformEnrollment(raw: Record<string, unknown>): Enrollment {
  return {
    id: (raw.id ?? raw._id ?? `${raw.courseCode}-${raw.matricNumber}`) as string,
    courseCode: raw.courseCode as string,
    matricNumber: raw.matricNumber as string,
    enrolledAt: raw.enrolledAt as string,
  };
}

// ── api ───────────────────────────────────────────────────────────────────────

export const api = {

  // ===========================================================================
  // CLASSROOMS
  // ===========================================================================
  classrooms: {
    list: async () => {
      const res = await throwOnError(await fetch(`${API_BASE}/classrooms`));
      return (await res.json()).data.classrooms;
    },
    get: async (classId: string) => {
      const res = await throwOnError(await fetch(`${API_BASE}/classrooms/${classId}`));
      return (await res.json()).data.classroom;
    },
    create: async (payload: { classId: string; className: string; capacity: number; deviceId: string }) => {
      const res = await throwOnError(await fetch(`${API_BASE}/classrooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      return (await res.json()).data;
    },
    update: async (classId: string, payload: {
      classId?: string; className?: string; capacity?: number;
      deviceId?: string; latestImage?: string; occupancy?: number;
    }) => {
      const res = await throwOnError(await fetch(`${API_BASE}/classrooms/${classId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      return (await res.json()).data.classroom;
    },
    delete: async (classId: string) => {
      await throwOnError(await fetch(`${API_BASE}/classrooms/${classId}`, { method: 'DELETE' }));
      return true;
    },
  },

  // ===========================================================================
  // LECTURERS  (GET /lecturers, POST /lecturers, GET /lecturers/{staffId}, DELETE /lecturers/{staffId})
  // ===========================================================================
  lecturers: {
    list: async (): Promise<Lecturer[]> => {
      const res = await throwOnError(await fetch(`${API_BASE}/lecturers`));
      const raw: Array<Record<string, unknown>> = (await res.json()).data.lecturers ?? [];
      return raw.map(transformLecturer);
    },
    get: async (staffId: string): Promise<Lecturer> => {
      const res = await throwOnError(await fetch(`${API_BASE}/lecturers/${encodeURIComponent(staffId)}`));
      return transformLecturer((await res.json()).data.lecturer);
    },
    create: async (payload: { staffId: string; fullName: string; email: string }): Promise<string> => {
      const res = await throwOnError(await fetch(`${API_BASE}/lecturers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }));
      return (await res.json()).data.id as string;
    },
    delete: async (staffId: string): Promise<void> => {
      await throwOnError(await fetch(`${API_BASE}/lecturers/${encodeURIComponent(staffId)}`, { method: 'DELETE' }));
    },
  },

  // ===========================================================================
  // STUDENTS  (admin — GET /students, GET /students/{matric}, DELETE embeddings, register)
  // ===========================================================================
  students: {
    list: async (): Promise<StudentRecord[]> => {
      const res = await throwOnError(await fetch(`${API_BASE}/students`));
      const raw: Array<Record<string, unknown>> = (await res.json()).data.students ?? [];
      return raw.map(transformStudentRecord);
    },
    get: async (matricNumber: string): Promise<StudentRecord> => {
      const res = await throwOnError(await fetch(`${API_BASE}/students/${encodeURIComponent(matricNumber)}`));
      return transformStudentRecord((await res.json()).data.student);
    },
    deleteEmbeddings: async (matricNumber: string): Promise<void> => {
      await throwOnError(await fetch(`${API_BASE}/students/${encodeURIComponent(matricNumber)}/embeddings`, {
        method: 'DELETE',
      }));
    },
    getEnrollments: async (matricNumber: string): Promise<Enrollment[]> => {
      const res = await throwOnError(await fetch(`${API_BASE}/students/${encodeURIComponent(matricNumber)}/enrollments`));
      const raw: Array<Record<string, unknown>> = (await res.json()).data.enrollments ?? [];
      return raw.map(transformEnrollment);
    },
    register: async (formData: FormData): Promise<void> => {
      await throwOnError(await fetch(`${API_BASE}/students/register`, {
        method: 'POST',
        body: formData,
      }));
    },
  },

  // ===========================================================================
  // ATTENDANCE MODULE
  // ===========================================================================
  attendance: {

    // ── COURSES ────────────────────────────────────────────────────────────────
    courses: {

      list: async (): Promise<Course[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/courses`));
        const rawCourses: Record<string, unknown>[] = (await res.json()).data.courses;

        const counts = await Promise.all(
          rawCourses.map(async (c) => {
            try {
              const r = await fetch(`${API_BASE}/courses/${c.courseCode}/enrollments`);
              if (!r.ok) return 0;
              const d = await r.json();
              return (d.data?.enrollments as unknown[] ?? []).length;
            } catch {
              return 0;
            }
          })
        );

        return rawCourses.map((c, i) => transformCourse(c, counts[i]));
      },

      get: async (courseCode: string): Promise<Course> => {
        const res = await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}`));
        const raw = (await res.json()).data.course as Record<string, unknown>;

        let studentCount = 0;
        try {
          const r = await fetch(`${API_BASE}/courses/${courseCode}/enrollments`);
          if (r.ok) {
            const d = await r.json();
            studentCount = (d.data?.enrollments as unknown[] ?? []).length;
          }
        } catch { /* ignore */ }

        return transformCourse(raw, studentCount);
      },

      create: async (payload: { courseCode: string; courseName: string }): Promise<Course> => {
        await throwOnError(await fetch(`${API_BASE}/courses`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }));
        const res = await throwOnError(await fetch(`${API_BASE}/courses/${payload.courseCode}`));
        const raw = (await res.json()).data.course as Record<string, unknown>;
        return transformCourse(raw, 0);
      },

      update: async (courseCode: string, payload: { courseName?: string; lecturerId?: string }): Promise<Course> => {
        const res = await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }));
        const raw = (await res.json()).data.course as Record<string, unknown>;
        return transformCourse(raw);
      },

      delete: async (courseCode: string): Promise<void> => {
        await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}`, { method: 'DELETE' }));
      },
    },

    // ── ENROLLMENTS ────────────────────────────────────────────────────────────
    enrollments: {

      list: async (courseCode: string): Promise<Enrollment[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}/enrollments`));
        const raw: Array<Record<string, unknown>> = (await res.json()).data.enrollments ?? [];
        return raw.map(transformEnrollment);
      },

      enroll: async (courseCode: string, matricNumber: string): Promise<void> => {
        await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}/enrollments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matricNumber }),
        }));
      },

      unenroll: async (courseCode: string, matricNumber: string): Promise<void> => {
        await throwOnError(await fetch(
          `${API_BASE}/courses/${courseCode}/enrollments/${encodeURIComponent(matricNumber)}`,
          { method: 'DELETE' }
        ));
      },
    },

    // ── STUDENTS (course-scoped) ────────────────────────────────────────────────
    students: {

      list: async (courseCode: string): Promise<RegisteredStudent[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}/students`));
        const raw: Array<Record<string, unknown>> = (await res.json()).data.students ?? [];
        return raw.map((s) => ({
          id: s.matricNumber as string,
          matricNumber: s.matricNumber as string,
          fullName: (s.fullName as string) || '',
          courseId: courseCode,
          registeredAt: s.registeredAt as string,
        }));
      },

      register: async (courseCode: string, formData: FormData): Promise<void> => {
        await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}/register`, {
          method: 'POST',
          body: formData,
        }));
      },

      deleteBiometrics: async (courseCode: string, matricNumber: string): Promise<void> => {
        await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}/students/biometrics`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matricNumber: matricNumber.trim().toUpperCase() }),
        }));
      },
    },

    // ── SESSIONS ───────────────────────────────────────────────────────────────
    sessions: {

      list: async (courseCode: string): Promise<Session[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/sessions?courseCode=${encodeURIComponent(courseCode)}`));
        const raw: Array<Record<string, unknown>> = (await res.json()).data.sessions ?? [];
        return raw.map(transformSession);
      },

      listByClass: async (classId: string, status?: string): Promise<Session[]> => {
        const params = new URLSearchParams({ classId });
        if (status) params.set('status', status);
        const res = await throwOnError(await fetch(`${API_BASE}/sessions?${params}`));
        const raw: Array<Record<string, unknown>> = (await res.json()).data.sessions ?? [];
        return raw.map(transformSession);
      },

      get: async (sessionId: string): Promise<Session> => {
        const res = await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}`));
        return transformSession((await res.json()).data.session);
      },

      start: async (courseCode: string, classId: string): Promise<Session> => {
        const res = await throwOnError(await fetch(`${API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseCode, classId }),
        }));
        const { sessionId } = (await res.json()).data as { sessionId: string };
        const full = await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}`));
        return transformSession((await full.json()).data.session);
      },

      end: async (sessionId: string): Promise<void> => {
        await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}/end`, { method: 'POST' }));
      },

      getAttendance: async (sessionId: string): Promise<AttendanceRecord[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}/attendance`));
        const data = (await res.json()).data;
        const attendees: Array<Record<string, unknown>> = data?.attendees ?? [];
        return transformAttendees(attendees, sessionId);
      },

      updateAttendance: async (sessionId: string, matricNumber: string, status: 'present' | 'absent'): Promise<void> => {
        await throwOnError(await fetch(
          `${API_BASE}/sessions/${sessionId}/attendance/${encodeURIComponent(matricNumber)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          }
        ));
      },

      capture: async (sessionId: string): Promise<AttendanceRecord[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}/capture`, { method: 'POST' }));
        const records: AttendanceRecord[] = (await res.json()).data.records ?? [];
        return records;
      },
    },

    // ── STUDENT PORTAL ─────────────────────────────────────────────────────────
    portal: {
      lookup: async (matricNumber: string): Promise<StudentAttendanceSummary[]> => {
        const encoded = encodeURIComponent(matricNumber.trim().toUpperCase());
        const res = await throwOnError(await fetch(`${API_BASE}/students/lookup/${encoded}`));
        return (await res.json()).data.results;
      },
    },
  },
};

export { WS_BASE };
