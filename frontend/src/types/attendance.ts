export interface Course {
  id: string;
  courseCode: string;
  courseName: string;
  studentCount: number;
  createdAt: string;
  registrationToken: string;
}

export interface RegisteredStudent {
  id: string;
  matricNumber: string;
  photoUrl?: string;
  courseId: string;
  registeredAt: string;
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
