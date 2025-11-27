import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useClassroomWebSocket } from '@/hooks/useClassroomWebSocket';
import Navigation from '@/components/Navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Trash2, Users, Calendar, Clock } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { Classroom } from '@/types/classroom';

const ClassroomDetail = () => {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchClassroom = async () => {
         console.log(classId);
      if (!classId) return;
   
      
      try {
        setError(null);
        const data = await api.classrooms.get(classId);
        console.log(data);
        
        setClassroom(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load classroom');
      } finally {
        setLoading(false);
      }
    };

    fetchClassroom();
  }, [classId]);

  // Real-time updates via WebSocket
  useClassroomWebSocket((message) => {
    if (
      (message.event === 'classroom_updated' ||
        message.event === 'classroom_image_update') &&
      message.classroom._id === classroom?._id
    ) {
      setClassroom(message.classroom);
    }
  });

  const handleDelete = async () => {
    if (!classId) return;
    if (!confirm('Are you sure you want to delete this classroom?')) return;

    try {
      setDeleting(true);
      await api.classrooms.delete(classId);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete classroom');
      setDeleting(false);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  if (error)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  if (!classroom)
    return (
      <div className="min-h-screen flex items-center justify-center">
        Classroom not found
      </div>
    );

  const occupancyPercent = (classroom.occupancy / classroom.capacity) * 100;
  const occupancyStatus =
    occupancyPercent > 80 ? 'High' : occupancyPercent > 40 ? 'Medium' : 'Low';
  const statusColor =
    occupancyPercent > 80
      ? 'text-red-600'
      : occupancyPercent > 40
        ? 'text-yellow-600'
        : 'text-green-600';

  const lastUpdated = classroom.updatedAt
    ? new Date(classroom.updatedAt)
    : null;

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

        <div className="grid md:grid-cols-3 gap-6">
          {/* Left: Image */}
          <div className="md:col-span-2">
            <Card className="border-2">
              <CardHeader>
                <CardTitle>Latest Camera Feed</CardTitle>
              </CardHeader>
              <CardContent>
                {classroom.latestImage ? (
                  <div className="space-y-4">
                    <img
                      src={classroom.latestImage}
                      alt="Latest classroom image"
                      className="w-full h-auto rounded-lg border border-border"
                    />
                    {lastUpdated && (
                      <p className="text-sm text-muted-foreground flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Last updated:{' '}
                        {lastUpdated.toLocaleString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="w-full h-96 bg-muted rounded-lg flex items-center justify-center">
                    <p className="text-muted-foreground">
                      No image available yet
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right: Info */}
          <div className="space-y-4">
            {/* Basic Info Card */}
            <Card className="border-2">
              <CardHeader>
                <div>
                  <CardTitle className="text-2xl">
                    {classroom.className}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Class ID: {classroom.classId}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Device ID</p>
                  <p className="font-mono text-sm bg-muted px-2 py-1 rounded">
                    {classroom.deviceId}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Occupancy
                  </p>
                  <div className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <p className="text-3xl font-bold">
                        {classroom.occupancy}
                      </p>
                      <p className="text-muted-foreground">
                        / {classroom.capacity}
                      </p>
                    </div>
                    <Progress value={occupancyPercent} className="h-2" />
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        {occupancyPercent.toFixed(1)}% full
                      </p>
                      <p className={`text-sm font-semibold ${statusColor}`}>
                        {occupancyStatus}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stats Card */}
            <Card className="border-2">
              <CardContent className="pt-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-primary/10">
                    <p className="text-xs text-muted-foreground mb-1">
                      Capacity
                    </p>
                    <p className="text-2xl font-bold flex items-center gap-1">
                      <Users className="h-5 w-5 text-primary" />
                      {classroom.capacity}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-success/10">
                    <p className="text-xs text-muted-foreground mb-1">
                      Currently
                    </p>
                    <p className="text-2xl font-bold">
                      {classroom.occupancy}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-warning/10 col-span-2">
                    <p className="text-xs text-muted-foreground mb-1">
                      Available Seats
                    </p>
                    <p className="text-2xl font-bold">
                      {classroom.capacity - classroom.occupancy}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Metadata Card */}
            {(classroom.createdAt || classroom.updatedAt) && (
              <Card className="border-2">
                <CardContent className="pt-6 space-y-3">
                  {classroom.createdAt && (
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Created
                        </p>
                        <p className="font-mono text-xs">
                          {new Date(classroom.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  )}
                  {classroom.updatedAt && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Last Updated
                        </p>
                        <p className="font-mono text-xs">
                          {new Date(classroom.updatedAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Delete Button */}
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {deleting ? 'Deleting...' : 'Delete Classroom'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ClassroomDetail;
