import type { Course, RegisteredStudent, Session, AttendanceRecord, StudentAttendanceSummary } from '@/types/attendance';

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
  // ATTENDANCE MODULE
  // ===========================================================================
  attendance: {

    // ── COURSES ────────────────────────────────────────────────────────────────
    courses: {

      list: async (): Promise<Course[]> => {
        const res = await throwOnError(await fetch(`${API_BASE}/courses`));
        const rawCourses: Record<string, unknown>[] = (await res.json()).data.courses;

        // Parallel-fetch enrollment counts for all courses
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

        // Fetch enrollment count for this single course
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
        // Backend returns only {id}; fetch the full course
        const res = await throwOnError(await fetch(`${API_BASE}/courses/${payload.courseCode}`));
        const raw = (await res.json()).data.course as Record<string, unknown>;
        return transformCourse(raw, 0);
      },

      delete: async (courseCode: string): Promise<void> => {
        await throwOnError(await fetch(`${API_BASE}/courses/${courseCode}`, { method: 'DELETE' }));
      },
    },

    // ── STUDENTS ───────────────────────────────────────────────────────────────
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
        const encoded = encodeURIComponent(courseCode);
        const res = await throwOnError(await fetch(`${API_BASE}/sessions?courseCode=${encoded}`));
        const raw: Array<Record<string, unknown>> = (await res.json()).data.sessions ?? [];
        return raw.map(transformSession);
      },

      start: async (courseCode: string, classId: string): Promise<Session> => {
        const res = await throwOnError(await fetch(`${API_BASE}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseCode, classId }),
        }));
        const { sessionId } = (await res.json()).data as { sessionId: string };
        // Fetch the full session object
        const full = await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}`));
        const raw = (await full.json()).data.session as Record<string, unknown>;
        return transformSession(raw);
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
        await throwOnError(await fetch(`${API_BASE}/sessions/${sessionId}/attendance/${encodeURIComponent(matricNumber)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }));
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
