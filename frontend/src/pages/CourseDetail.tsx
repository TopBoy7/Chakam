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
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { Course, RegisteredStudent, Session, AttendanceRecord } from "@/types/attendance";
import type { Classroom } from "@/types/classroom";

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
  const { isAdmin } = useAuth();

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
  const [elapsed, setElapsed] = useState("");
  const [updatingStudent, setUpdatingStudent] = useState<string | null>(null);
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);

  // Derived from the sessions list — at most one session has status "active" at a time.
  // The backend must enforce this: reject POST /attendance/sessions if an active session
  // already exists for the given courseId.
  const activeSession = sessions.find((s) => s.status === "active") ?? null;

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

  // Loads all page data in parallel on mount. The classrooms list is also fetched
  // here because the lecturer needs it for the "Select Classroom" dropdown on this page.
  // The classrooms come from the existing /classrooms endpoint — no new backend work needed.
  const loadData = useCallback(async () => {
    if (!courseId) return;
    try {
      setError(null);
      const [courseData, studentsData, sessionsData, classroomsData] = await Promise.all([
        api.attendance.courses.get(courseId),           // GET /attendance/courses/:id
        api.attendance.students.list(courseId),          // GET /attendance/courses/:id/students
        api.attendance.sessions.list(courseId),          // GET /attendance/courses/:id/sessions
        api.classrooms.list(),                           // GET /classrooms (existing endpoint)
      ]);
      setCourse(courseData);
      setStudents(studentsData);
      setSessions(sessionsData);
      setClassrooms(classroomsData);
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
      const classroom = classrooms.find((c) => c.id === selectedClassroomId);
      setSessions((prev) => [
        { ...session, classroomName: classroom?.className ?? session.classroomName },
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

  const copyRegistrationLink = () => {
    if (!course) return;
    const link = `${window.location.origin}/register/${course.registrationToken}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success("Registration link copied to clipboard");
    });
  };

  // ── Export helpers ───────────────────────────────────────────────────────────

  // Creates a temporary <a> element, triggers a download, then cleans up.
  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportSession = async (
    session: Session,
    exportFormat: "csv" | "json"
  ) => {
    if (!course) return;

    // Active session: records are already in state from the 30s poll.
    // Past sessions: fetch from GET /attendance/sessions/:id/attendance on demand.
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

    // Cross-reference every registered student with their attendance record.
    // Students with no record are absent (not yet detected by the camera).
    const rows = students.map((student) => {
      const record = records.find((r) => r.studentId === student.id);
      return {
        matricNumber: student.matricNumber,
        status: record?.status ?? "absent",
        method: record
          ? record.manuallyOverridden
            ? "manual"
            : "camera"
          : null,
        detectedAt: record?.detectedAt ?? null,
      };
    });

    const presentCount = rows.filter((r) => r.status === "present").length;
    const attendanceRate =
      students.length > 0
        ? `${Math.round((presentCount / students.length) * 100)}%`
        : "0%";

    const sessionDate = format(new Date(session.startedAt), "MMMM d, yyyy");
    const sessionStart = format(new Date(session.startedAt), "h:mm a");
    const sessionEnd = session.endedAt
      ? format(new Date(session.endedAt), "h:mm a")
      : "ongoing";
    const durationMin = session.endedAt
      ? Math.round(
          (new Date(session.endedAt).getTime() -
            new Date(session.startedAt).getTime()) /
            60000
        )
      : null;

    // Sanitise course code for use in the filename (remove spaces/slashes).
    const safeCode = course.courseCode.replace(/[^a-zA-Z0-9]/g, "_");
    const safeDate = format(new Date(session.startedAt), "yyyy-MM-dd");
    const filename = `${safeCode}_${safeDate}_attendance`;

    if (exportFormat === "csv") {
      const header = [
        `Course,${course.courseCode} - ${course.courseName}`,
        `Session Date,${sessionDate}`,
        `Session Time,${sessionStart}${session.endedAt ? ` - ${sessionEnd} (${durationMin} min)` : ""}`,
        session.classroomName ? `Classroom,${session.classroomName}` : "",
        `Exported,"${new Date().toLocaleString()}"`,
        "",
        "Matric Number,Status,Method,Detected At",
      ].filter(Boolean);

      const dataRows = rows.map((r) =>
        [
          r.matricNumber,
          r.status === "present" ? "Present" : "Absent",
          r.method ?? "",
          r.detectedAt ?? "",
        ].join(",")
      );

      const footer = [
        "",
        `Summary,${presentCount} present of ${students.length} (${attendanceRate})`,
      ];

      downloadFile(
        [...header, ...dataRows, ...footer].join("\n"),
        `${filename}.csv`,
        "text/csv;charset=utf-8;"
      );
    } else {
      const payload = {
        course: `${course.courseCode} - ${course.courseName}`,
        courseCode: course.courseCode,
        session: {
          id: session.id,
          date: sessionDate,
          startTime: sessionStart,
          endTime: session.endedAt ? sessionEnd : null,
          durationMinutes: durationMin,
          classroom: session.classroomName ?? null,
          status: session.status,
        },
        exportedAt: new Date().toISOString(),
        attendance: rows,
        summary: {
          present: presentCount,
          absent: students.length - presentCount,
          total: students.length,
          attendanceRate,
        },
      };
      downloadFile(
        JSON.stringify(payload, null, 2),
        `${filename}.json`,
        "application/json"
      );
    }

    toast.success(`Attendance exported as ${exportFormat.toUpperCase()}`);
  };

  const presentCount = attendanceRecords.filter((r) => r.status === "present").length;
  const endedSessions = sessions.filter((s) => s.status === "ended");
  const activeClassroom = classrooms.find((c) => c.id === activeSession?.classroomId) ?? null;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading course...</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !course) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto px-4 py-8 max-w-lg">
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error || "Course not found"}</AlertDescription>
          </Alert>
          <Button variant="ghost" onClick={() => navigate("/attendance")}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Attendance
          </Button>
        </div>
      </div>
    );
  }

  // ── Main page ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <Link
          to="/attendance"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          All Courses
        </Link>

        {/* Course Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-2">
          <Badge variant="secondary" className="text-base font-mono tracking-wide w-fit px-3 py-1">
            {course.courseCode}
          </Badge>
          <h1 className="text-2xl sm:text-3xl font-bold">{course.courseName}</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8">
          <span className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            {students.length} {students.length === 1 ? "student" : "students"}
          </span>
          <button
            type="button"
            onClick={copyRegistrationLink}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            <Copy className="h-4 w-4" />
            Copy registration link
          </button>
        </div>

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
            <Button
              variant="destructive"
              size="sm"
              onClick={handleEndClass}
              disabled={ending}
            >
              <Square className="h-3.5 w-3.5 mr-2" />
              {ending ? "Ending..." : "End Class"}
            </Button>
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
                  students.map((student) => (
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
                              Registered{" "}
                              {format(new Date(student.registeredAt), "MMM d, yyyy")}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
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
                            <SelectItem key={c.id} value={c.id}>
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
                    disabled={!isAdmin || starting || !selectedClassroomId}
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
                      Snapshots every 5 min · auto-refreshing
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {presentCount} / {students.length}
                    </Badge>
                  </div>

                  <Separator />

                  {/* Export the live attendance list mid-session or snapshot for records */}
                  {activeSession && students.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full text-xs">
                          <Download className="h-3.5 w-3.5 mr-2" />
                          Export Attendance
                          <ChevronDown className="h-3.5 w-3.5 ml-auto" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem
                          onClick={() => handleExportSession(activeSession, "csv")}
                        >
                          Export as CSV
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleExportSession(activeSession, "json")}
                        >
                          Export as JSON
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

    </div>
  );
};

export default CourseDetail;
