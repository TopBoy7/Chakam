import type { Course, RegisteredStudent, Session, AttendanceRecord } from '@/types/attendance';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export const api = {
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

  attendance: {
    courses: {
      list: async (): Promise<Course[]> => {
        const res = await fetch(`${API_BASE}/attendance/courses`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to fetch courses');
        }
        const data = await res.json();
        return data.data.courses;
      },
      get: async (courseId: string): Promise<Course> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}`);
        if (!res.ok) throw new Error('Course not found');
        const data = await res.json();
        return data.data.course;
      },
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

    students: {
      list: async (courseId: string): Promise<RegisteredStudent[]> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}/students`);
        if (!res.ok) throw new Error('Failed to fetch students');
        const data = await res.json();
        return data.data.students;
      },
      register: async (courseId: string, formData: FormData): Promise<void> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}/register`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Registration failed');
        }
      },
    },

    sessions: {
      list: async (courseId: string): Promise<Session[]> => {
        const res = await fetch(`${API_BASE}/attendance/courses/${courseId}/sessions`);
        if (!res.ok) throw new Error('Failed to fetch sessions');
        const data = await res.json();
        return data.data.sessions;
      },
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
      end: async (sessionId: string): Promise<void> => {
        const res = await fetch(`${API_BASE}/attendance/sessions/${sessionId}/end`, {
          method: 'POST',
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || 'Failed to end session');
        }
      },
      getAttendance: async (sessionId: string): Promise<AttendanceRecord[]> => {
        const res = await fetch(`${API_BASE}/attendance/sessions/${sessionId}/attendance`);
        if (!res.ok) throw new Error('Failed to fetch attendance');
        const data = await res.json();
        return data.data.records;
      },
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
    },
  },
};

export { WS_BASE };
