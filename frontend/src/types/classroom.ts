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

export interface UsagePattern {
  hour: number;
  occupancyRate: number;
  day: string;
}
