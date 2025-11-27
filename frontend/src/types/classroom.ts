export interface ClassroomData {
  id: string;
  name: string;
  building: string;
  capacity: number;
  status: 'occupied' | 'available';
  lastUpdated: Date;
  sensorData: {
    motion: number;
    distance: number;
    timestamp: Date;
  };
  occupancyPercentage?: number;
}

export interface Classroom {
  _id: string;
  classId: string;
  className: string;
  capacity: number;
  occupancy: number;
  deviceId: string;
  latestImage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateClassroomRequest {
  classId: string;
  className: string;
  capacity: number;
  deviceId: string;
}

export interface ClassroomResponse {
  success: boolean;
  message: string;
  data: {
    classroom?: Classroom;
    classrooms?: Classroom[];
    id?: string;
  };
}

export interface WebSocketMessage {
  event: 'classroom_updated' | 'classroom_image_update';
  classroom: Classroom;
}

export interface UsagePattern {
  hour: number;
  occupancyRate: number;
  day: string;
}
