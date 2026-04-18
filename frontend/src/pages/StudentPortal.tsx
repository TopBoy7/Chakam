// =============================================================================
// PAGE: /my-attendance  — Public student self-service portal
// =============================================================================
// Flow:
//   1. Student enters their matric number (no auth required — public page)
//   2. GET /attendance/students/lookup/:matricNumber
//        Returns StudentAttendanceSummary[] — one entry per enrolled course
//   3. Shows per-course attendance rate with 75% threshold indicator
//   4. Expandable session log per course
//
// BACKEND NOTE for /attendance/students/lookup/:matricNumber:
//   - Public endpoint — no auth header required
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

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ChevronDown, ChevronRight, Search } from "lucide-react";
import Navigation from "@/components/Navigation";
import { api } from "@/lib/api";
import type { StudentAttendanceSummary } from "@/types/attendance";

const THRESHOLD = 0.75;

function rateColor(rate: number): string {
  if (rate >= THRESHOLD)  return "text-success";
  if (rate >= 0.5)        return "text-warning";
  return "text-destructive";
}

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
  const [matric, setMatric]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [results, setResults]     = useState<StudentAttendanceSummary[] | null>(null);
  const [expanded, setExpanded]   = useState<Record<string, boolean>>({});

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matric.trim()) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setExpanded({});
    try {
      const data = await api.attendance.portal.lookup(matric);
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No records found for this matric number.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = (courseId: string) =>
    setExpanded((prev) => ({ ...prev, [courseId]: !prev[courseId] }));

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="max-w-2xl mx-auto px-6 pt-28 pb-20">

        {/* Header */}
        <div className="mb-10">
          <p className="text-xs tracking-widest uppercase text-muted-foreground mb-3">Student Portal</p>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight mb-4">My Attendance</h1>
          <p className="text-muted-foreground text-sm leading-relaxed max-w-md">
            Enter your matric number to view your attendance record across all your registered courses.
          </p>
        </div>

        {/* Lookup form */}
        <form onSubmit={handleLookup} className="space-y-4 mb-10">
          <div className="space-y-2">
            <Label htmlFor="matric" className="text-xs tracking-widest uppercase text-muted-foreground">
              Matric Number
            </Label>
            <div className="flex gap-3">
              <Input
                id="matric"
                placeholder="e.g. 19/30CS/01234"
                value={matric}
                onChange={(e) => setMatric(e.target.value)}
                className="font-mono bg-background flex-1"
                required
              />
              <button
                type="submit"
                disabled={loading || !matric.trim()}
                className="bg-foreground text-background text-xs tracking-widest uppercase px-6 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-40 flex items-center gap-2 whitespace-nowrap"
              >
                {loading
                  ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-current border-t-transparent" />Searching…</>
                  : <><Search className="h-3.5 w-3.5" />Look Up</>
                }
              </button>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </form>

        {/* Results */}
        {results && results.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No course records found for this matric number.</p>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs tracking-widest uppercase text-muted-foreground">
              {results.length} {results.length === 1 ? "course" : "courses"} found
            </p>

            {results.map((course) => {
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

                    <div className="flex items-center gap-3 shrink-0 pt-1">
                      {/* Mini progress bar */}
                      <div className="hidden sm:block w-24 h-1.5 bg-border rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            course.attendanceRate >= THRESHOLD
                              ? "bg-success"
                              : course.attendanceRate >= 0.5
                              ? "bg-warning"
                              : "bg-destructive"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
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
        )}
      </main>
    </div>
  );
};

export default StudentPortal;
