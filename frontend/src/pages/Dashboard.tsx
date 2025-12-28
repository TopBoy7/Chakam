import { useEffect, useState, useCallback } from "react";
import { useClassroomWebSocket } from "@/hooks/useClassroomWebSocket";
import { api } from "@/lib/api";
import Navigation from "@/components/Navigation";
import ClassroomCard from "@/components/ClassroomCard";
import CreateClassroomDialog from "@/components/CreateClassroomDialog";
import { Button } from "@/components/ui/button";
import { Plus, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import type { Classroom, WebSocketMessage } from "@/types/classroom";

const Dashboard = () => {
  const { isAdmin } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load initial classrooms
  useEffect(() => {
    const fetchClassrooms = async () => {
      try {
        setError(null);
        const data = await api.classrooms.list();
        setClassrooms(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load classrooms"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchClassrooms();
  }, []);

  // WebSocket listener for real-time updates
  const handleWSMessage = useCallback((message: WebSocketMessage) => {
    const incoming = message.classroom;
    setClassrooms((prev) => {
      const idx = prev.findIndex(
        (c) => c.id === incoming.id || c.classId === incoming.classId
      );
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = incoming;
        return copy;
      }
      // if not found, prepend (or push) the incoming classroom
      return [incoming, ...prev];
    });
  }, []);

  useClassroomWebSocket(handleWSMessage);

  const handleCreateClassroom = async (data: Classroom) => {
    try {
      await api.classrooms.create(data);
      const updated = await api.classrooms.list();
      setClassrooms(updated);
      setShowCreateDialog(false);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create classroom"
      );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Classrooms</h1>
            <p className="text-muted-foreground mt-1">
              Manage and monitor all classrooms
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => setShowCreateDialog(true)} size="lg">
              <Plus className="h-4 w-4 mr-2" />
              Add Classroom
            </Button>
          )}
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
            <p className="mt-4 text-muted-foreground">Loading classrooms...</p>
          </div>
        ) : classrooms.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">No classrooms yet.</p>
            {isAdmin && (
              <Button onClick={() => setShowCreateDialog(true)}>
                Create your first classroom
              </Button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {classrooms.map((classroom) => (
              <ClassroomCard key={classroom.id} classroom={classroom} />
            ))}
          </div>
        )}
      </div>

      <CreateClassroomDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={handleCreateClassroom}
      />
    </div>
  );
};

export default Dashboard;
