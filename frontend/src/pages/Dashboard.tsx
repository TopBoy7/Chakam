import { useState, useEffect } from 'react';
import Navigation from '@/components/Navigation';
import ClassroomCard from '@/components/ClassroomCard';
import StatsCard from '@/components/StatsCard';
import { mockClassrooms } from '@/data/mockData';
import { Activity, CheckCircle, XCircle, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const Dashboard = () => {
  const [classrooms, setClassrooms] = useState(mockClassrooms);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdate(new Date());
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalClassrooms = classrooms.length;
  const occupiedCount = classrooms.filter((c) => c.status === 'occupied').length;
  const availableCount = totalClassrooms - occupiedCount;
  const occupancyRate = Math.round((occupiedCount / totalClassrooms) * 100);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Live Dashboard</h1>
            <p className="text-muted-foreground">
              Real-time classroom occupancy across campus
            </p>
          </div>
          <div className="flex items-center gap-3 mt-4 md:mt-0">
            <Badge variant="outline" className="px-3 py-1">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse mr-2" />
              Live Updates
            </Badge>
            <span className="text-sm text-muted-foreground">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total Classrooms"
            value={totalClassrooms}
            description="Monitored spaces"
            icon={Activity}
          />
          <StatsCard
            title="Currently Occupied"
            value={occupiedCount}
            description="Active classrooms"
            icon={XCircle}
            className="border-warning/20"
          />
          <StatsCard
            title="Available Now"
            value={availableCount}
            description="Free to use"
            icon={CheckCircle}
            className="border-success/20"
          />
          <StatsCard
            title="Occupancy Rate"
            value={`${occupancyRate}%`}
            description="Current utilization"
            icon={TrendingUp}
            className="border-primary/20"
          />
        </div>

        {/* Classroom Grid */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold mb-4">Classroom Status</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {classrooms.map((classroom) => (
              <ClassroomCard key={classroom.id} classroom={classroom} />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
