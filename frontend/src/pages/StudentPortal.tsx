// =============================================================================
// PAGE: /my-attendance  — Student self-service portal (requires login)
// =============================================================================
// Flow:
//   1. Route is gated by ProtectedRoute allowedRoles=["student"] — a logged-
//      out visitor is redirected to /login?redirect=/my-attendance and lands
//      back here after verifying.
//   2. GET /students/lookup/:matricNumber, called automatically with the
//      logged-in student's own matric number — never typed in
//   3. Shows per-course attendance rate with 75% threshold indicator
//   4. Expandable session log per course
//
// BACKEND NOTE for GET /students/lookup/:matricNumber:
//   - Requires login (self-or-admin — a student can only look up their own
//     matric number; an admin may pass any)
//   - Case-insensitive matric match (normalize to uppercase on both ends)
//   - Return shape:
//     {
//       data: {
//         results: [
//           {
//             courseId: string,
//             courseCode: string,
//             courseName: string,
//             presentCount: number,
//             totalSessions: number,
//             attendanceRate: number,   // 0–1 float, e.g. 0.75
//             sessions: [
//               {
//                 sessionId: string,
//                 date: string,        // ISO-8601
//                 classroomName?: string,
//                 status: 'present' | 'absent',
//                 manuallyOverridden: boolean,
//               }
//             ]
//           }
//         ]
//       }
//     }
//   - If matric number not found in any course → 404 with detail message
// =============================================================================

import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, ChevronDown, ChevronRight, Search, Trash2, ShieldCheck, ShieldOff } from "lucide-react";
import Navigation from "@/components/Navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { StudentAttendanceSummary } from "@/types/attendance";

const THRESHOLD = 0.75;

function rateBadgeVariant(rate: number): "default" | "secondary" | "destructive" | "outline" {
  if (rate >= THRESHOLD) return "secondary";
  if (rate >= 0.5)       return "outline";
  return "destructive";
}

function fmt(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const StudentPortal = () => {
  const { user } = useAuth();
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [results, setResults]         = useState<StudentAttendanceSummary[] | null>(null);
  const [expanded, setExpanded]       = useState<Record<string, boolean>>({});
  const [courseQuery, setCourseQuery] = useState("");

  // Biometric deletion state
  const [deleteTarget, setDeleteTarget]     = useState<StudentAttendanceSummary | null>(null);
  const [deleting, setDeleting]             = useState(false);
  const [deleteError, setDeleteError]       = useState<string | null>(null);
  const [deletedCourses, setDeletedCourses] = useState<Set<string>>(new Set());

  // Page is behind ProtectedRoute allowedRoles=["student"], so a matric
  // number is always present here — no more typing one in, load it as soon
  // as the logged-in user's identity is known.
  useEffect(() => {
    const matric = user?.matricNumber;
    if (!matric) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.attendance.portal.lookup(matric);
        setResults(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load your attendance record.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.matricNumber]);

  const toggle = (courseId: string) =>
    setExpanded((prev) => ({ ...prev, [courseId]: !prev[courseId] }));

  const handleDeleteBiometrics = async () => {
    if (!deleteTarget || !user?.matricNumber) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.attendance.students.deleteBiometrics(deleteTarget.courseId, user.matricNumber);
      setDeletedCourses((prev) => new Set(prev).add(deleteTarget.courseId));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete biometric data.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="max-w-2xl mx-auto px-6 pt-28 pb-20">

        {/* Header */}
        <div className="mb-10">
          <p className="text-xs tracking-widest uppercase text-muted-foreground mb-3">Student Portal</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight mb-4">My Attendance</h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-md">
            Your attendance record across all your registered courses.
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-8">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="flex flex-col items-center py-16 gap-4">
            <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin" />
            <p className="text-sm text-muted-foreground tracking-wide">Loading your attendance…</p>
          </div>
        )}

        {/* Results */}
        {/* Course filter — only visible after results load */}
        {!loading && results && results.length > 0 && (
          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by course…"
              value={courseQuery}
              onChange={(e) => setCourseQuery(e.target.value)}
              className="w-full bg-background border border-border rounded-full pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 transition-colors"
            />
          </div>
        )}

        {results && results.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No course records found for this matric number.</p>
          </div>
        )}

        {results && results.length > 0 && (() => {
          const visible = results.filter((c) => {
            const q = courseQuery.toLowerCase();
            return !q || c.courseCode.toLowerCase().includes(q) || c.courseName.toLowerCase().includes(q);
          });
          return (
          <div className="space-y-4">
            <p className="text-xs tracking-widest uppercase text-muted-foreground">
              {visible.length} {visible.length === 1 ? "course" : "courses"} found
            </p>

            {visible.length === 0 ? (
              <div className="flex flex-col items-center py-12 gap-3 text-center">
                <Search className="h-7 w-7 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No courses match "{courseQuery}"</p>
              </div>
            ) : visible.map((course) => {
              const pct = Math.round(course.attendanceRate * 100);
              const isOpen = !!expanded[course.courseId];

              return (
                <div key={course.courseId} className="border border-border rounded-xl overflow-hidden">
                  {/* Course header row */}
                  <button
                    type="button"
                    onClick={() => toggle(course.courseId)}
                    className="w-full text-left px-5 py-4 flex items-start justify-between gap-4 hover:bg-foreground/[0.02] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground">{course.courseCode}</span>
                        <Badge variant={rateBadgeVariant(course.attendanceRate)} className="text-xs">
                          {pct}%
                        </Badge>
                        {course.attendanceRate < THRESHOLD && (
                          <Badge variant="destructive" className="text-xs">Below 75%</Badge>
                        )}
                      </div>
                      <p className="font-serif text-lg leading-snug truncate">{course.courseName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {course.presentCount} of {course.totalSessions} sessions attended
                      </p>
                    </div>

                    <div className="flex items-center shrink-0 pt-1">
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      }
                    </div>
                  </button>

                  {/* Session log */}
                  {isOpen && (
                    <div className="border-t border-border divide-y divide-border">
                      {course.sessions.length === 0 ? (
                        <p className="px-5 py-4 text-sm text-muted-foreground">No sessions recorded yet.</p>
                      ) : (
                        course.sessions.map((s) => (
                          <div key={s.sessionId} className="px-5 py-3 flex items-center justify-between gap-4">
                            <div>
                              <p className="text-sm">{fmt(s.date)}</p>
                              {s.classroomName && (
                                <p className="text-xs text-muted-foreground">{s.classroomName}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {s.manuallyOverridden && (
                                <span className="text-xs text-muted-foreground italic">manual</span>
                              )}
                              <span
                                className={`text-xs font-medium uppercase tracking-wider ${
                                  s.status === "present" ? "text-success" : "text-destructive"
                                }`}
                              >
                                {s.status}
                              </span>
                            </div>
                          </div>
                        ))
                      )}

                      {/* Consent record — NDPA s.34 right of access */}
                      <div className="px-5 py-4 space-y-1">
                        <p className="text-xs font-medium uppercase tracking-widest text-foreground mb-2">Your Consent Record</p>
                        {course.consent ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              {course.consent.biometricsActive
                                ? <ShieldCheck className="h-3.5 w-3.5 text-success shrink-0" />
                                : <ShieldOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              }
                              <span className="text-xs text-foreground">
                                Biometric data:{" "}
                                <strong>{course.consent.biometricsActive ? "Active" : "Deleted"}</strong>
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground pl-5">
                              Consent given: {fmt(course.consent.consentGivenAt)} · Version {course.consent.consentVersion}
                            </p>
                            {course.consent.consentWithdrawnAt && (
                              <p className="text-xs text-muted-foreground pl-5">
                                Withdrawn: {fmt(course.consent.consentWithdrawnAt)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Consent record unavailable.</p>
                        )}
                      </div>

                      {/* Biometric data deletion */}
                      <div className="px-5 py-4">
                        {deletedCourses.has(course.courseId) || course.consent?.biometricsActive === false ? (
                          <p className="text-xs text-muted-foreground">
                            Biometric data has been deleted. Future attendance will be recorded manually.
                          </p>
                        ) : (
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                              Under NDPA s.36, you may delete your face embedding at any time.
                            </p>
                            <button
                              type="button"
                              onClick={() => { setDeleteError(null); setDeleteTarget(course); }}
                              className="shrink-0 flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete my data
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Threshold notice */}
            <p className="text-xs text-muted-foreground text-center pt-2">
              The university requires a minimum of 75% attendance per course.
            </p>
          </div>
          );
        })()}
      </main>

      {/* Biometric deletion confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal">
              Delete biometric data?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground space-y-2">
              <span className="block">
                This will permanently delete your stored photos and face embeddings for{" "}
                <strong className="text-foreground">{deleteTarget?.courseCode} — {deleteTarget?.courseName}</strong>.
              </span>
              <span className="block">
                Your past attendance records are not affected. However, the camera will no longer
                be able to detect you automatically — your lecturer will record your attendance manually going forward.
              </span>
              <span className="block font-medium text-foreground">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError && (
            <Alert variant="destructive" className="mt-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-border text-xs tracking-widest uppercase rounded-full"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBiometrics}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground text-xs tracking-widest uppercase rounded-full hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete My Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default StudentPortal;
