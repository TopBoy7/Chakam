const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export const api = {
  classrooms: {
    list: async () => {
      const res = await fetch(`${API_BASE}/classrooms`);
      if (!res.ok) throw new Error('Failed to fetch classrooms');
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
      if (!res.ok) throw new Error('Failed to create classroom');
      const data = await res.json();
      return data.data;
    },
    update: async (classId: string, payload: Record<string, any>) => {
      const res = await fetch(`${API_BASE}/classrooms/${classId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update classroom');
      const data = await res.json();
      return data.data.classroom;
    },
    delete: async (classId: string) => {
      const res = await fetch(`${API_BASE}/classrooms/${classId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete classroom');
      return true;
    },
  },
};

export { WS_BASE };