import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { useClassroomWebSocket } from "@/hooks/useClassroomWebSocket";
import Navigation from "@/components/Navigation";
import EditClassroomDialog from "@/components/EditClassroomDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronLeft, Trash2, Users, Calendar, Clock, Edit2, AlertCircle, Cpu, BookOpen, UserCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import type { Classroom, UpdateClassroomRequest } from "@/types/classroom";
import type { Session } from "@/types/attendance";

// Status colour uses design tokens — no hardcoded Tailwind colour classes.
function statusInfo(pct: number): { label: string; cls: string } {
  if (pct === 0) return { label: "Empty",    cls: "text-muted-foreground" };
  if (pct < 50)  return { label: "Low",      cls: "text-success" };
  if (pct < 80)  return { label: "Moderate", cls: "text-warning" };
  return              { label: "High",     cls: "text-destructive" };
}

const ClassroomDetail = () => {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [classroom, setClassroom]         = useState<Classroom | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [deleting, setDeleting]           = useState(false);
  const [showEditDialog, setShowEditDialog]   = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [sessions, setSessions]           = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      if (!classId) return;
      try {
        setError(null);
        const data = await api.classrooms.get(classId);
        setClassroom(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load classroom");
      } finally {
        setLoading(false);
      }
      // Fetch session history in parallel (non-blocking)
      setSessionsLoading(true);
      try {
        const s = await api.attendance.sessions.listByClass(classId);
        setSessions(s.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()));
      } catch { /* ignore */ } finally {
        setSessionsLoading(false);
      }
    };
    fetchAll();
  }, [classId]);

  // Real-time occupancy updates via WebSocket.
  // The backend broadcasts classroom_updated events whenever the IoT camera
  // sends a new occupancy reading. No polling needed — just update state.
  useClassroomWebSocket((message) => {
    const incoming = message.classroom;
    if (!classroom) return;
    if (incoming._id === classroom.id || incoming.classId === classroom.classId) {
      setClassroom(incoming);
    }
  });

  const handleDelete = async () => {
    if (!classId) return;
    setDeleting(true);
    try {
      await api.classrooms.delete(classId);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete classroom");
      setDeleting(false);
    }
  };

  const handleEdit = async (oldClassId: string, updateData: UpdateClassroomRequest) => {
    const updated = await api.classrooms.update(oldClassId, updateData);
    setClassroom(updated);
    if (updateData.classId && updateData.classId !== oldClassId) {
      navigate(`/classroom/${updateData.classId}`, { replace: true });
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin" />
          <p className="text-sm text-muted-foreground tracking-wide">Loading classroom…</p>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && !classroom) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="max-w-lg mx-auto px-6 pt-28">
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!classroom) return null;

  const pct = classroom.capacity > 0
    ? Math.round((classroom.occupancy / classroom.capacity) * 100)
    : 0;
  const { label: statusLabel, cls: statusCls } = statusInfo(pct);
  const lastUpdated = classroom.updatedAt ? new Date(classroom.updatedAt) : null;

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        {/* Breadcrumb */}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All Classrooms
        </Link>

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-1">{classroom.classId}</p>
            <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl text-foreground">
              {classroom.className}
            </h1>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={() => setShowEditDialog(true)}
                className="inline-flex items-center gap-2 border border-border text-xs tracking-widest uppercase px-5 py-2.5 rounded-full text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteDialog(true)}
                className="inline-flex items-center gap-2 border border-destructive/40 text-xs tracking-widest uppercase px-5 py-2.5 rounded-full text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>

        <div className="h-px bg-border mb-10" />

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          {/* ── Left: Camera feed ──────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <div className="border border-border rounded-lg bg-card/60 overflow-hidden">
              <div className="px-6 py-4 border-b border-border flex items-center justify-between">
                <p className="text-xs tracking-widest uppercase text-muted-foreground">
                  Latest Camera Feed
                </p>
                {lastUpdated && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {lastUpdated.toLocaleString()}
                  </span>
                )}
              </div>
              {classroom.latestImage ? (
                <img
                  src={classroom.latestImage}
                  alt="Latest classroom capture"
                  className="w-full h-auto"
                />
              ) : (
                <div className="flex items-center justify-center h-72 text-muted-foreground/40">
                  <div className="text-center">
                    <div className="text-4xl mb-3">📷</div>
                    <p className="text-sm">No image received yet</p>
                    <p className="text-xs mt-1">The camera will send its first frame shortly</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Info panels ─────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Occupancy card */}
            <div className="border border-border rounded-lg bg-card/60 p-6 space-y-5">
              <p className="text-xs tracking-widest uppercase text-muted-foreground">
                Live Occupancy
              </p>

              <div className="flex items-baseline gap-2">
                <span className="font-serif text-5xl text-foreground">{classroom.occupancy}</span>
                <span className="text-muted-foreground text-lg">/ {classroom.capacity}</span>
              </div>

              <Progress value={pct} className="h-1.5" />

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{pct}% full</span>
                <span className={`font-medium ${statusCls}`}>{statusLabel}</span>
              </div>

              {/* Stat grid */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Capacity</p>
                  <p className="font-serif text-2xl flex items-center gap-1.5">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    {classroom.capacity}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Free seats</p>
                  <p className="font-serif text-2xl text-success">
                    {classroom.capacity - classroom.occupancy}
                  </p>
                </div>
              </div>
            </div>

            {/* Device info card */}
            <div className="border border-border rounded-lg bg-card/60 p-6 space-y-3">
              <p className="text-xs tracking-widest uppercase text-muted-foreground">
                Device
              </p>
              <div className="flex items-center gap-2 text-sm">
                <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="font-mono break-all">{classroom.deviceId}</span>
              </div>
            </div>

            {/* Timestamps card */}
            {(classroom.createdAt || classroom.updatedAt) && (
              <div className="border border-border rounded-lg bg-card/60 p-6 space-y-3">
                <p className="text-xs tracking-widest uppercase text-muted-foreground">
                  Timestamps
                </p>
                {classroom.createdAt && (
                  <div className="flex items-start gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Created</p>
                      <p className="font-mono text-xs">{new Date(classroom.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                )}
                {classroom.updatedAt && (
                  <div className="flex items-start gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Last updated</p>
                      <p className="font-mono text-xs">{new Date(classroom.updatedAt).toLocaleString()}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Session history card */}
            <div className="border border-border rounded-lg bg-card/60 p-6 space-y-3">
              <p className="text-xs tracking-widest uppercase text-muted-foreground">
                Session History
              </p>
              {sessionsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <div className="h-3.5 w-3.5 rounded-full border-2 border-border border-t-foreground animate-spin" />
                  Loading…
                </div>
              ) : sessions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">No sessions recorded for this classroom.</p>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto -mx-1 px-1">
                  {sessions.map((s) => {
                    const duration = s.endedAt
                      ? Math.round((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000)
                      : null;
                    return (
                      <div key={s.id} className="space-y-1 border-b border-border last:border-0 pb-3 last:pb-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                            <BookOpen className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span className="font-mono">{s.courseId}</span>
                          </div>
                          <Badge variant={s.status === "active" ? "default" : "secondary"} className="text-xs shrink-0">
                            {s.status === "active" ? "Live" : "Ended"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground pl-5">
                          {format(new Date(s.startedAt), "MMM d, yyyy · h:mm a")}
                          {duration !== null && ` · ${duration} min`}
                        </p>
                        {s.presentCount > 0 && (
                          <p className="text-xs text-muted-foreground pl-5 flex items-center gap-1">
                            <UserCheck className="h-3 w-3" />
                            {s.presentCount} present
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <EditClassroomDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        classroom={classroom}
        onSubmit={handleEdit}
      />

      {/* Delete Confirmation — uses AlertDialog, not browser confirm() */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal">
              Delete classroom?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              This will permanently delete{" "}
              <strong className="text-foreground">{classroom.className}</strong> and all
              associated data. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="text-xs tracking-widest uppercase rounded-full"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground text-xs tracking-widest uppercase rounded-full hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClassroomDetail;
