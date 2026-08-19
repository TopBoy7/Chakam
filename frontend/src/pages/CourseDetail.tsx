// =============================================================================
// PAGE: /attendance/course/:courseId  — Course detail & live session management
// =============================================================================
// What this page does:
//   - Loads a course's full detail: name, registered students, session history
//   - Shows an inline classroom selector so the lecturer picks which room they're in
//   - "Start Class" → POST /attendance/sessions → activates facial recognition
//     on the selected classroom's camera (identified by classroom.deviceId)
//   - While a session is active:
//       • Displays a live timer counting up from startedAt
//       • Shows the active classroom name + deviceId so it's clear which camera is live
//       • Polls GET /attendance/sessions/:id/attendance every 30 seconds to pick up
//         students newly detected by the camera
//       • Lets the lecturer manually toggle any student present/absent
//         → PUT /attendance/sessions/:id/attendance/:studentId
//   - "End Class" → POST /attendance/sessions/:id/end → stops recognition, saves records
//   - Sessions tab: history of past sessions (ended only) with date, room, duration, count
//   - Students tab: all registered students with photo thumbnail and registration date
//
// APIs used on this page:
//   GET  /attendance/courses/:id                         → course info
//   GET  /attendance/courses/:id/students                → registered student list
//   GET  /attendance/courses/:id/sessions                → session history
//   GET  /classrooms                                     → classroom list for selector
//   POST /attendance/sessions                            → start session (body: courseId, classroomId)
//   POST /attendance/sessions/:id/end                   → end session
//   GET  /attendance/sessions/:id/attendance             → polled every 30s during active session
//   PUT  /attendance/sessions/:id/attendance/:studentId → manual present/absent toggle
//
// KEY BEHAVIOUR NOTES FOR BACKEND:
//   1. classroomId sent on session start is the classroom's MongoDB _id.
//      Use it to look up the classroom's `deviceId` — that is the camera identifier.
//   2. The backend must NOT overwrite manuallyOverridden=true records when the
//      facial recognition pipeline processes a new snapshot.
//   3. The backend should return classroomName in the Session object so the
//      frontend can display it without an extra request.
// =============================================================================

import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { format } from "date-fns";
import Navigation from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  AlertCircle,
  Users,
  Clock,
  Play,
  Square,
  CheckCircle2,
  XCircle,
  Camera,
  UserCheck,
  CalendarDays,
  Copy,
  MapPin,
  Cpu,
  Download,
  ChevronDown,
  Loader2,
  Edit2,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { exportAttendance } from "@/lib/exportAttendance";
import type { ExportFormat } from "@/lib/exportAttendance";
import type { Course, RegisteredStudent, Session, AttendanceRecord } from "@/types/attendance";
import type { Classroom } from "@/types/classroom";
import type { Lecturer } from "@/types/lecturer";

function formatElapsed(startedAt: string): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  );
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  return `${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

const CourseDetail = () => {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<RegisteredStudent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClassroomId, setSelectedClassroomId] = useState("");
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [elapsed, setElapsed] = useState("");
  const [updatingStudent, setUpdatingStudent] = useState<string | null>(null);
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);

  // Edit course
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [editCourseName, setEditCourseName] = useState("");
  const [editLecturerId, setEditLecturerId] = useState("");
  const [editLecturers, setEditLecturers] = useState<Lecturer[]>([]);
  const [savingCourse, setSavingCourse] = useState(false);

  // Enroll student
  const [showEnroll, setShowEnroll] = useState(false);
  const [enrollMatric, setEnrollMatric] = useState("");
  const [enrolling, setEnrolling] = useState(false);

  // Unenroll student
  const [unenrollTarget, setUnenrollTarget] = useState<RegisteredStudent | null>(null);
  const [unenrolling, setUnenrolling] = useState(false);

  // Per-student attendance summary across ALL ended sessions.
  // Computed in loadData by fetching records for every ended session in parallel.
  // Used to show threshold warning badges in the Students tab.
  // BACKEND NOTE: If this becomes slow as session count grows, add:
  //   GET /attendance/courses/:courseId/students/summary
  //   Returns { studentId, presentCount, totalSessions, attendanceRate }[]
  const [studentSummaries, setStudentSummaries] = useState<Record<string, { present: number; total: number }>>({});

  // Derived from the sessions list — at most one session has status "active" at a time.
  // The backend must enforce this: reject POST /attendance/sessions if an active session
  // already exists for the given courseId.
  const activeSession = sessions.find((s) => s.status === "active") ?? null;

  // Session/enrollment/attendance management on the backend requires "course owner or
  // admin" (never just "any lecturer") — mirror that here so the lecturer who actually
  // owns this course can use Start/End Class, capture, enroll, etc. Course rename/
  // lecturer-reassignment stays admin-only to match PUT /courses/{code}.
  const isCourseOwner = user?.role === "lecturer" && !!user.staffId && course?.lecturerId === user.staffId;
  const canManage = isAdmin || isCourseOwner;

  // Ticks every second to display a live elapsed timer (e.g. "01m 23s") in the banner.
  // Purely client-side — startedAt from the backend is the source of truth.
  useEffect(() => {
    if (!activeSession) return;
    const tick = () => setElapsed(formatElapsed(activeSession.startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [activeSession?.startedAt]);

  // Polls GET /attendance/sessions/:id/attendance every 30 seconds while a session is active.
  // The camera takes a snapshot every 5 minutes and the recognition pipeline may take
  // additional seconds to process it, so 30s polling is a good balance between freshness
  // and request volume. Each poll replaces the full records array — the backend is the
  // source of truth. Polling errors are silently swallowed to avoid disrupting the UI.
  useEffect(() => {
    if (!activeSession) return;
    const fetchAttendance = async () => {
      try {
        const records = await api.attendance.sessions.getAttendance(activeSession.id);
        setAttendanceRecords(records);
      } catch {
        // silently ignore polling errors
      }
    };
    fetchAttendance();
    const id = setInterval(fetchAttendance, 30000);
    return () => clearInterval(id);
  }, [activeSession?.id]);

  // Loads all page data in parallel on mount.
  // Also fetches attendance records for every ended session so we can compute
  // per-student attendance rates for the threshold badge in the Students tab.
  const loadData = useCallback(async () => {
    if (!courseId) return;
    try {
      setError(null);
      const [courseData, studentsData, sessionsData, classroomsData] = await Promise.all([
        api.attendance.courses.get(courseId),
        api.attendance.students.list(courseId),
        api.attendance.sessions.list(courseId),
        api.classrooms.list(),
      ]);
      setCourse(courseData);
      setStudents(studentsData);
      setSessions(sessionsData.map((s) => ({ ...s, totalStudents: studentsData.length })));
      setClassrooms(classroomsData);

      // Fetch records for all ended sessions to compute per-student attendance rates.
      // Uses existing GET /attendance/sessions/:id/attendance — no new endpoint needed.
      // Errors per-session are swallowed so one bad session doesn't block the page.
      const endedSessions = sessionsData.filter((s) => s.status === "ended");
      if (endedSessions.length > 0 && studentsData.length > 0) {
        const allRecords = await Promise.all(
          endedSessions.map((s) =>
            api.attendance.sessions
              .getAttendance(s.id)
              .catch(() => [] as typeof studentsData)
          )
        );
        const summaries: Record<string, { present: number; total: number }> = {};
        for (const student of studentsData) {
          summaries[student.id] = { present: 0, total: endedSessions.length };
        }
        for (const records of allRecords) {
          for (const record of records) {
            if (summaries[record.studentId] && record.status === "present") {
              summaries[record.studentId].present++;
            }
          }
        }
        setStudentSummaries(summaries);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load course");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sends { courseId, classroomId } to POST /attendance/sessions.
  // `classroomId` is the classroom's MongoDB _id — the backend uses this to look up
  // the classroom's `deviceId` and activate facial recognition on that camera.
  // After the session is created, we enrich the returned Session object locally with
  // `classroomName` (in case the backend omits it) so the UI can display it immediately.
  const handleStartClass = async () => {
    if (!courseId || !selectedClassroomId) return;
    setStarting(true);
    try {
      const session = await api.attendance.sessions.start(courseId, selectedClassroomId);
      const classroom = classrooms.find((c) => c.classId === selectedClassroomId);
      setSessions((prev) => [
        { ...session, classroomName: classroom?.className ?? session.classroomName, totalStudents: students.length },
        ...prev,
      ]);
      setAttendanceRecords([]);
      toast.success(`Class started — ${classroom?.className ?? "camera"} will track attendance`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start class");
    } finally {
      setStarting(false);
    }
  };

  // Calls POST /attendance/sessions/:id/end.
  // The backend should: set status="ended", set endedAt, compute final presentCount
  // and totalStudents, and stop the facial recognition pipeline for this classroom.
  // The frontend updates local state optimistically using the current attendanceRecords
  // so the session card appears immediately in the Sessions tab.
  const handleEndClass = async () => {
    if (!activeSession) return;
    setEnding(true);
    try {
      await api.attendance.sessions.end(activeSession.id);
      const presentCount = attendanceRecords.filter((r) => r.status === "present").length;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                status: "ended" as const,
                endedAt: new Date().toISOString(),
                presentCount,
              }
            : s
        )
      );
      setAttendanceRecords([]);
      toast.success("Class ended — attendance has been saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to end class");
    } finally {
      setEnding(false);
    }
  };

  // Handles the lecturer manually marking a student present or absent.
  // Uses an UPSERT pattern:
  //   - If a record already exists for this student in this session → update status
  //   - If no record exists yet (student not detected by camera) → create a new one
  // In both cases `manuallyOverridden: true` is set, which tells the backend's
  // recognition pipeline NOT to overwrite this record on the next snapshot.
  // State is updated optimistically — the spinner appears per-student, not globally.
  const handleToggleStudentPresence = async (student: RegisteredStudent) => {
    if (!activeSession) return;
    const record = attendanceRecords.find((r) => r.studentId === student.id);
    const currentStatus = record?.status ?? "absent";
    const newStatus: "present" | "absent" = currentStatus === "present" ? "absent" : "present";
    setUpdatingStudent(student.id);
    try {
      // PUT /attendance/sessions/:sessionId/attendance/:studentId  { status }
      await api.attendance.sessions.updateAttendance(activeSession.id, student.id, newStatus);
      setAttendanceRecords((prev) => {
        const existing = prev.find((r) => r.studentId === student.id);
        if (existing) {
          return prev.map((r) =>
            r.studentId === student.id
              ? { ...r, status: newStatus, manuallyOverridden: true }
              : r
          );
        }
        // Student had no record (never detected) — create a local placeholder.
        // The backend creates the real document; on the next 30s poll this is replaced.
        return [
          ...prev,
          {
            id: `manual-${student.id}`,
            sessionId: activeSession.id,
            studentId: student.id,
            matricNumber: student.matricNumber,
            status: newStatus,
            manuallyOverridden: true,
          },
        ];
      });
    } catch {
      toast.error("Failed to update attendance");
    } finally {
      setUpdatingStudent(null);
    }
  };

  // On-demand attendance capture — the primary attendance mechanism.
  // Calls POST /attendance/sessions/:id/capture which signals the camera to
  // take a snapshot NOW and run facial recognition against all registered students.
  // BACKEND: see api.ts → attendance.sessions.capture() for full spec.
  const handleCaptureAttendance = async () => {
    if (!activeSession) return;
    setCapturing(true);
    try {
      const records = await api.attendance.sessions.capture(activeSession.id);
      setAttendanceRecords(records);
      const present = records.filter((r) => r.status === "present").length;
      toast.success(`Attendance captured — ${present} student${present !== 1 ? "s" : ""} detected`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Capture failed. Check camera connection.");
    } finally {
      setCapturing(false);
    }
  };

  // Fallback: mark every unrecorded student as present when the camera fails.
  // Sets manuallyOverridden: true so the camera result (if it comes later) won't
  // overwrite these entries. The lecturer can still toggle individuals afterwards.
  const handleMarkAllPresent = async () => {
    if (!activeSession || students.length === 0) return;
    setMarkingAll(true);
    const toMark = students.filter((s) => {
      const rec = attendanceRecords.find((r) => r.studentId === s.id);
      return !rec || rec.status !== "present";
    });
    try {
      await Promise.all(
        toMark.map((s) =>
          api.attendance.sessions.updateAttendance(activeSession.id, s.id, "present")
        )
      );
      setAttendanceRecords((prev) => {
        const updated = [...prev];
        for (const student of toMark) {
          const idx = updated.findIndex((r) => r.studentId === student.id);
          if (idx !== -1) {
            updated[idx] = { ...updated[idx], status: "present", manuallyOverridden: true };
          } else {
            updated.push({
              id: `manual-${student.id}`,
              sessionId: activeSession.id,
              studentId: student.id,
              matricNumber: student.matricNumber,
              status: "present",
              manuallyOverridden: true,
            });
          }
        }
        return updated;
      });
      toast.success(`Marked ${toMark.length} student${toMark.length !== 1 ? "s" : ""} present`);
    } catch {
      toast.error("Failed to mark all present");
    } finally {
      setMarkingAll(false);
    }
  };

  const copyRegistrationLink = () => {
    if (!course) return;
    const link = `${window.location.origin}/register/${course.registrationToken}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success("Registration link copied to clipboard");
    });
  };

  const openEditCourse = async () => {
    if (!course) return;
    setEditCourseName(course.courseName);
    setEditLecturerId("");
    setShowEditCourse(true);
    try {
      const data = await api.lecturers.list();
      setEditLecturers(data);
    } catch { /* ignore — lecturer selector just stays empty */ }
  };

  const handleSaveCourse = async () => {
    if (!courseId || !editCourseName.trim()) return;
    setSavingCourse(true);
    try {
      const payload: { courseName?: string; lecturerId?: string } = {};
      if (editCourseName.trim() !== course?.courseName) payload.courseName = editCourseName.trim();
      if (editLecturerId) payload.lecturerId = editLecturerId;
      if (Object.keys(payload).length === 0) { setShowEditCourse(false); return; }
      const updated = await api.attendance.courses.update(courseId, payload);
      setCourse(updated);
      setShowEditCourse(false);
      toast.success("Course updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update course");
    } finally {
      setSavingCourse(false);
    }
  };

  const handleEnrollStudent = async () => {
    if (!courseId || !enrollMatric.trim()) return;
    setEnrolling(true);
    try {
      await api.attendance.enrollments.enroll(courseId, enrollMatric.trim().toUpperCase());
      // Refresh student list
      const updated = await api.attendance.students.list(courseId);
      setStudents(updated);
      setEnrollMatric("");
      setShowEnroll(false);
      toast.success("Student enrolled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to enroll student");
    } finally {
      setEnrolling(false);
    }
  };

  const handleUnenrollStudent = async () => {
    if (!courseId || !unenrollTarget) return;
    setUnenrolling(true);
    try {
      await api.attendance.enrollments.unenroll(courseId, unenrollTarget.matricNumber);
      setStudents((prev) => prev.filter((s) => s.matricNumber !== unenrollTarget.matricNumber));
      setUnenrollTarget(null);
      toast.success("Student unenrolled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unenroll student");
    } finally {
      setUnenrolling(false);
    }
  };

  // ── Export helper ────────────────────────────────────────────────────────────

  const handleExportSession = async (session: Session, fmt: ExportFormat) => {
    if (!course) return;
    let records: AttendanceRecord[];
    if (session.status === "active") {
      records = attendanceRecords;
    } else {
      setExportingSessionId(session.id);
      try {
        records = await api.attendance.sessions.getAttendance(session.id);
      } catch {
        toast.error("Failed to load attendance data for export");
        setExportingSessionId(null);
        return;
      }
      setExportingSessionId(null);
    }
    try {
      await exportAttendance(fmt, course, session, students, records);
    } catch {
      toast.error("Export failed. Please try again.");
    }
  };

  const presentCount = attendanceRecords.filter((r) => r.status === "present").length;
  const endedSessions = sessions.filter((s) => s.status === "ended");
  const activeClassroom = classrooms.find((c) => c.classId === activeSession?.classroomId) ?? null;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin" />
          <p className="text-sm text-muted-foreground tracking-wide">Loading course…</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !course) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="max-w-lg mx-auto px-6 pt-28">
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error || "Course not found"}</AlertDescription>
          </Alert>
          <button
            type="button"
            onClick={() => navigate("/attendance")}
            className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to Attendance
          </button>
        </div>
      </div>
    );
  }

  // ── Main page ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        {/* Breadcrumb */}
        <Link
          to="/attendance"
          className="inline-flex items-center gap-1 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          All Courses
        </Link>

        {/* Course Header */}
        <div className="mb-3">
          <span className="text-xs font-mono tracking-widest text-muted-foreground border border-border rounded px-2 py-1">
            {course.courseCode}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl text-foreground">{course.courseName}</h1>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {students.length} {students.length === 1 ? "student" : "students"}
            </span>
            <button
              type="button"
              onClick={copyRegistrationLink}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors tracking-widest uppercase"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy link
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={openEditCourse}
                className="flex items-center gap-1.5 hover:text-foreground transition-colors tracking-widest uppercase"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>
        </div>

        <div className="h-px bg-border mb-8" />

        {/* Active Session Banner */}
        {activeSession && (
          <div className="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <span className="font-medium text-green-700 dark:text-green-400">
                Class in session
              </span>
              <span className="text-muted-foreground text-sm font-mono tabular-nums">
                {elapsed}
              </span>
              {activeClassroom && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  {activeClassroom.className}
                </span>
              )}
            </div>
            {canManage && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleEndClass}
                disabled={ending}
              >
                <Square className="h-3.5 w-3.5 mr-2" />
                {ending ? "Ending..." : "End Class"}
              </Button>
            )}
          </div>
        )}

        {/* Main Two-Column Layout */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* ── Left: Tabs ──────────────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <Tabs defaultValue="sessions">
              <TabsList className="mb-5 w-full sm:w-auto">
                <TabsTrigger value="sessions" className="flex-1 sm:flex-none">
                  <CalendarDays className="h-4 w-4 mr-2" />
                  Sessions
                </TabsTrigger>
                <TabsTrigger value="students" className="flex-1 sm:flex-none">
                  <Users className="h-4 w-4 mr-2" />
                  Students ({students.length})
                </TabsTrigger>
              </TabsList>

              {/* Sessions Tab */}
              <TabsContent value="sessions" className="space-y-3 focus-visible:outline-none">
                {endedSessions.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <CalendarDays className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No sessions recorded yet</p>
                    <p className="text-sm mt-1">
                      Start a class to begin tracking attendance.
                    </p>
                  </div>
                ) : (
                  endedSessions.map((session) => {
                    const duration =
                      session.endedAt
                        ? Math.round(
                            (new Date(session.endedAt).getTime() -
                              new Date(session.startedAt).getTime()) /
                              60000
                          )
                        : null;

                    return (
                      <Card key={session.id}>
                        <CardContent className="py-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 font-medium text-sm">
                                <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                {format(new Date(session.startedAt), "MMMM d, yyyy")}
                                <span className="text-muted-foreground font-normal">
                                  {format(new Date(session.startedAt), "h:mm a")}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground ml-6">
                                {session.classroomName && (
                                  <span>{session.classroomName}</span>
                                )}
                                {duration !== null && (
                                  <span>{duration} min</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge
                                variant={
                                  session.presentCount > 0 ? "default" : "secondary"
                                }
                              >
                                <UserCheck className="h-3 w-3 mr-1" />
                                {session.presentCount} / {session.totalStudents} present
                              </Badge>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    disabled={exportingSessionId === session.id}
                                  >
                                    {exportingSessionId === session.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Download className="h-3 w-3" />
                                    )}
                                    <ChevronDown className="h-3 w-3 ml-1" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => handleExportSession(session, "csv")}
                                  >
                                    Export as CSV
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleExportSession(session, "json")}
                                  >
                                    Export as JSON
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleExportSession(session, "docx")}
                                  >
                                    Export as Word (.docx)
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleExportSession(session, "pdf")}
                                  >
                                    Export as PDF
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </TabsContent>

              {/* Students Tab */}
              <TabsContent value="students" className="space-y-2 focus-visible:outline-none">
                {/* Enroll existing student action */}
                {canManage && (
                  <div className="flex justify-end mb-2">
                    <Button variant="outline" size="sm" onClick={() => setShowEnroll(true)} className="text-xs tracking-widest uppercase">
                      <UserPlus className="h-3.5 w-3.5 mr-2" />
                      Enroll Student
                    </Button>
                  </div>
                )}
                {students.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p className="font-medium">No students registered</p>
                    <p className="text-sm mt-1 max-w-xs mx-auto">
                      Share the registration link with your students so they can sign up.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={copyRegistrationLink}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Registration Link
                    </Button>
                  </div>
                ) : (
                  students.map((student) => {
                    const summary = studentSummaries[student.id];
                    // Attendance threshold badge — warns when a student is at risk.
                    // 75% is the standard university attendance requirement.
                    // Only shown once there is at least one ended session to measure against.
                    const rate = summary && summary.total > 0
                      ? Math.round((summary.present / summary.total) * 100)
                      : null;
                    const thresholdBadge =
                      rate === null ? null :
                      rate >= 75 ? { label: `${rate}%`, cls: "text-success" } :
                      rate >= 50 ? { label: `${rate}% ⚠`, cls: "text-warning" } :
                                   { label: `${rate}% ✕`, cls: "text-destructive" };

                    return (
                      <Card key={student.id}>
                        <CardContent className="py-3">
                          <div className="flex items-center gap-3">
                            {student.photoUrl ? (
                              <img
                                src={student.photoUrl}
                                alt={student.matricNumber}
                                className="h-10 w-10 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                <Users className="h-5 w-5 text-muted-foreground" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium font-mono text-sm">
                                {student.matricNumber}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {student.fullName && <span>{student.fullName} · </span>}
                                Registered{" "}
                                {format(new Date(student.registeredAt), "MMM d, yyyy")}
                              </p>
                            </div>
                            {thresholdBadge && (
                              <span className={`text-xs font-mono font-medium flex-shrink-0 ${thresholdBadge.cls}`}>
                                {thresholdBadge.label}
                              </span>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => setUnenrollTarget(student)}
                                className="flex-shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors p-1"
                                title="Unenroll student"
                              >
                                <UserMinus className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* ── Right: Session Control ───────────────────────────────────────── */}
          <div>
            {!activeSession ? (
              /* Start Class Card — classroom selector is inline so it's always visible */
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Start a Class</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="classroom-select">Classroom</Label>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Select the room you're teaching in — this tells the system which
                      camera to activate for attendance tracking.
                    </p>
                    {classrooms.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-1">
                        No classrooms available. Add one in the Dashboard first.
                      </p>
                    ) : (
                      <Select
                        value={selectedClassroomId}
                        onValueChange={setSelectedClassroomId}
                      >
                        <SelectTrigger id="classroom-select">
                          <SelectValue placeholder="Select classroom..." />
                        </SelectTrigger>
                        <SelectContent>
                          {classrooms.map((c) => (
                            <SelectItem key={c.classId} value={c.classId}>
                              <span className="font-medium">{c.className}</span>
                              <span className="text-muted-foreground ml-1">
                                ({c.classId})
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleStartClass}
                    disabled={!canManage || starting || !selectedClassroomId}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {starting ? "Starting..." : "Start Class"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              /* Live Attendance Card */
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Camera className="h-4 w-4 text-primary" />
                    Live Attendance
                  </CardTitle>
                  {activeClassroom && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {activeClassroom.className}
                        <span className="text-muted-foreground font-normal">
                          ({activeClassroom.classId})
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Cpu className="h-3 w-3" />
                        Camera: {activeClassroom.deviceId}
                      </p>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">
                      Click "Take Attendance" when ready
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {presentCount} / {students.length}
                    </Badge>
                  </div>

                  <Separator />

                  {/* Primary: on-demand capture trigger.
                      BACKEND: POST /attendance/sessions/:id/capture
                      Signals the camera to snapshot now, runs recognition, returns records.
                      Requires course owner or admin — hidden entirely for anyone else,
                      since the backend rejects it and there's nothing useful to show. */}
                  {canManage && (
                    <Button
                      className="w-full"
                      onClick={handleCaptureAttendance}
                      disabled={capturing || students.length === 0}
                    >
                      {capturing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Capturing…
                        </>
                      ) : (
                        <>
                          <Camera className="h-4 w-4 mr-2" />
                          Take Attendance
                        </>
                      )}
                    </Button>
                  )}

                  {/* Fallback: mark everyone present when the camera is unavailable */}
                  {canManage && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={handleMarkAllPresent}
                      disabled={markingAll || students.length === 0}
                    >
                      {markingAll ? (
                        <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Marking…</>
                      ) : (
                        <>
                          <UserCheck className="h-3.5 w-3.5 mr-2" />
                          Mark All Present (camera fallback)
                        </>
                      )}
                    </Button>
                  )}

                  {/* Export live attendance snapshot */}
                  {students.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full text-xs">
                          <Download className="h-3.5 w-3.5 mr-2" />
                          Export Attendance
                          <ChevronDown className="h-3.5 w-3.5 ml-auto" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => handleExportSession(activeSession, "csv")}>
                          Export as CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportSession(activeSession, "json")}>
                          Export as JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportSession(activeSession, "docx")}>
                          Export as Word (.docx)
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleExportSession(activeSession, "pdf")}>
                          Export as PDF
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  <Separator />

                  <div className="space-y-1 max-h-[420px] overflow-y-auto -mx-1 px-1">
                    {students.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        No students registered.
                      </p>
                    ) : (
                      students.map((student) => {
                        const record = attendanceRecords.find(
                          (r) => r.studentId === student.id
                        );
                        const isPresent = record?.status === "present";
                        const isManual = record?.manuallyOverridden;
                        const isUpdating = updatingStudent === student.id;

                        return (
                          <div
                            key={student.id}
                            className="flex items-center gap-2.5 py-2 rounded-md px-1 hover:bg-muted/50 transition-colors"
                          >
                            {student.photoUrl ? (
                              <img
                                src={student.photoUrl}
                                alt=""
                                className="h-7 w-7 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              </div>
                            )}

                            <span className="flex-1 text-sm font-mono truncate min-w-0">
                              {student.matricNumber}
                            </span>

                            {isManual && (
                              <span className="text-xs text-muted-foreground hidden sm:inline">
                                manual
                              </span>
                            )}

                            {canManage ? (
                              <button
                                type="button"
                                onClick={() => handleToggleStudentPresence(student)}
                                disabled={isUpdating}
                                className="flex-shrink-0 transition-opacity disabled:opacity-50"
                                aria-label={
                                  isPresent
                                    ? `Mark ${student.matricNumber} absent`
                                    : `Mark ${student.matricNumber} present`
                                }
                              >
                                {isUpdating ? (
                                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                ) : isPresent ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-muted-foreground/60 hover:text-muted-foreground" />
                                )}
                              </button>
                            ) : (
                              // Read-only status for a viewer who can't manage this course
                              // (backend rejects the toggle for anyone but the owning
                              // lecturer or an admin) — show status, not a dead control.
                              <span className="flex-shrink-0" aria-label={isPresent ? "Present" : "Absent"}>
                                {isPresent ? (
                                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-muted-foreground/60" />
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit Course Dialog ─────────────────────────────────────────────── */}
      <Dialog open={showEditCourse} onOpenChange={setShowEditCourse}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-normal">Edit Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="editCourseName" className="text-xs tracking-widest uppercase text-muted-foreground">Course Name</Label>
              <Input
                id="editCourseName"
                value={editCourseName}
                onChange={(e) => setEditCourseName(e.target.value)}
                className="bg-background"
              />
            </div>
            {editLecturers.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs tracking-widest uppercase text-muted-foreground">Assign Lecturer (optional)</Label>
                <Select value={editLecturerId} onValueChange={setEditLecturerId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="No lecturer assigned" />
                  </SelectTrigger>
                  <SelectContent>
                    {editLecturers.map((l) => (
                      <SelectItem key={l.staffId} value={l.staffId}>
                        {l.fullName}
                        <span className="text-muted-foreground ml-1">({l.staffId})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditCourse(false)} disabled={savingCourse} className="rounded-full text-xs tracking-widest uppercase">
              Cancel
            </Button>
            <Button
              onClick={handleSaveCourse}
              disabled={savingCourse || !editCourseName.trim()}
              className="rounded-full text-xs tracking-widest uppercase"
            >
              {savingCourse ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Enroll Student Dialog ──────────────────────────────────────────── */}
      <Dialog open={showEnroll} onOpenChange={(open) => { setShowEnroll(open); if (!open) setEnrollMatric(""); }}>
        <DialogContent className="bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-normal">Enroll Student</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The student must already be registered in the system. Enter their matric number to enroll them in this course.
            </p>
            <div className="space-y-2">
              <Label htmlFor="enrollMatric" className="text-xs tracking-widest uppercase text-muted-foreground">Matric Number</Label>
              <Input
                id="enrollMatric"
                placeholder="e.g. 190403014"
                value={enrollMatric}
                onChange={(e) => setEnrollMatric(e.target.value)}
                className="bg-background font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleEnrollStudent()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEnroll(false); setEnrollMatric(""); }} disabled={enrolling} className="rounded-full text-xs tracking-widest uppercase">
              Cancel
            </Button>
            <Button
              onClick={handleEnrollStudent}
              disabled={enrolling || !enrollMatric.trim()}
              className="rounded-full text-xs tracking-widest uppercase"
            >
              {enrolling ? "Enrolling…" : "Enroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unenroll Confirmation ──────────────────────────────────────────── */}
      <AlertDialog open={!!unenrollTarget} onOpenChange={(open) => !open && setUnenrollTarget(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal">Unenroll student?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              This removes <strong className="text-foreground">{unenrollTarget?.matricNumber}</strong> from{" "}
              <strong className="text-foreground">{course?.courseCode}</strong>. Their past attendance
              records for this course are not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unenrolling} className="border-border text-xs tracking-widest uppercase rounded-full">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnenrollStudent}
              disabled={unenrolling}
              className="bg-destructive text-destructive-foreground text-xs tracking-widest uppercase rounded-full hover:bg-destructive/90"
            >
              {unenrolling ? "Unenrolling…" : "Unenroll"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default CourseDetail;
