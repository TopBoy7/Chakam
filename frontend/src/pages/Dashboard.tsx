import { useEffect, useState, useCallback } from "react";
import { useClassroomWebSocket } from "@/hooks/useClassroomWebSocket";
import { api } from "@/lib/api";
import Navigation from "@/components/Navigation";
import ClassroomCard from "@/components/ClassroomCard";
import CreateClassroomDialog from "@/components/CreateClassroomDialog";
import { Plus, AlertCircle, LayoutGrid, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import type { Classroom, WebSocketMessage } from "@/types/classroom";

const Dashboard = () => {
  const { isAdmin } = useAuth();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const fetchClassrooms = async () => {
      try {
        setError(null);
        const data = await api.classrooms.list();
        setClassrooms(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load classrooms");
      } finally {
        setLoading(false);
      }
    };
    fetchClassrooms();
  }, []);

  const handleWSMessage = useCallback((message: WebSocketMessage) => {
    const incoming = message.classroom;
    setClassrooms((prev) => {
      const idx = prev.findIndex((c) => c.id === incoming.id || c.classId === incoming.classId);
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = incoming;
        return copy;
      }
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
      setError(err instanceof Error ? err.message : "Failed to create classroom");
    }
  };

  const filtered = classrooms.filter((c) => {
    const q = query.toLowerCase();
    return !q || c.className.toLowerCase().includes(q) || c.classId.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-12">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">Live Monitoring</p>
            <h1 className="font-serif text-4xl md:text-5xl text-foreground">Classrooms</h1>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Classroom
            </button>
          )}
        </div>

        <div className="h-px bg-border mb-8" />

        {/* Search */}
        <div className="relative mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search classrooms…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:max-w-sm bg-background border border-border rounded-full pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 transition-colors"
          />
        </div>

        {error && (
          <Alert variant="destructive" className="mb-8">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex flex-col items-center py-24 gap-4">
            <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin" />
            <p className="text-sm text-muted-foreground tracking-wide">Loading classrooms…</p>
          </div>
        ) : classrooms.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-6 text-center">
            <LayoutGrid className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-serif text-2xl text-foreground mb-2">No classrooms yet</p>
              <p className="text-sm text-muted-foreground">Add your first classroom to begin monitoring.</p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Classroom
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-3 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No classrooms match "{query}"</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((classroom) => (
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
