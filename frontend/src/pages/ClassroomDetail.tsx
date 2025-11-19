import { useParams, Link } from 'react-router-dom';
import Navigation from '@/components/Navigation';
import { mockClassrooms } from '@/data/mockData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Activity, MapPin, Users, Clock, Gauge } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const ClassroomDetail = () => {
  const { id } = useParams<{ id: string }>();
  const classroom = mockClassrooms.find((c) => c.id === id);

  if (!classroom) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Classroom Not Found</h1>
            <Link to="/dashboard">
              <Button>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isOccupied = classroom.status === 'occupied';
  const sensorHistory = Array.from({ length: 12 }, (_, i) => ({
    time: `${14 - i}:00`,
    motion: Math.random() > 0.5 ? 1 : 0,
    distance: Math.floor(Math.random() * 100) + 30,
  })).reverse();

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <main className="container mx-auto px-4 py-8">
        <Link to="/dashboard">
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </Link>

        {/* Header Card */}
        <Card className="mb-6 border-2">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="text-3xl font-bold mb-2">
                  {classroom.name}
                </CardTitle>
                <div className="flex items-center gap-2 text-muted-foreground mb-4">
                  <MapPin className="h-4 w-4" />
                  <span>{classroom.building}</span>
                </div>
              </div>
              <Badge
                variant={isOccupied ? 'destructive' : 'default'}
                className={cn(
                  'text-lg px-4 py-2 mt-2 md:mt-0',
                  isOccupied
                    ? 'bg-warning text-warning-foreground'
                    : 'bg-success text-success-foreground'
                )}
              >
                {isOccupied ? 'Occupied' : 'Available'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Capacity</p>
                  <p className="text-xl font-bold">{classroom.capacity}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center">
                  <Gauge className="h-6 w-6 text-success" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Occupancy</p>
                  <p className="text-xl font-bold">{classroom.occupancyPercentage}%</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-warning/10 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Last Update</p>
                  <p className="text-xl font-bold">
                    {new Date(classroom.lastUpdated).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sensor Data Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Current Sensor Readings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Motion Detection</span>
                  <span className="text-sm font-bold">
                    {classroom.sensorData.motion === 1 ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <Progress
                  value={classroom.sensorData.motion === 1 ? 100 : 0}
                  className="h-2"
                />
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Distance Reading</span>
                  <span className="text-sm font-bold">
                    {classroom.sensorData.distance} cm
                  </span>
                </div>
                <Progress
                  value={(classroom.sensorData.distance / 150) * 100}
                  className="h-2"
                />
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium">Occupancy Level</span>
                  <span className="text-sm font-bold">
                    {classroom.occupancyPercentage}%
                  </span>
                </div>
                <Progress
                  value={classroom.occupancyPercentage}
                  className="h-2"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sensor History (Last 12 Hours)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {sensorHistory.map((reading, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <span className="text-sm font-medium">{reading.time}</span>
                    <div className="flex items-center gap-4">
                      <Badge
                        variant={reading.motion === 1 ? 'default' : 'outline'}
                        className={cn(
                          reading.motion === 1
                            ? 'bg-warning text-warning-foreground'
                            : ''
                        )}
                      >
                        {reading.motion === 1 ? 'Motion' : 'Clear'}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {reading.distance}cm
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default ClassroomDetail;
