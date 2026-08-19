// =============================================================================
// PAGE: /attendance  — Lecturer's course management hub
// =============================================================================
// APIs used:
//   GET    /attendance/courses            → load course list on mount
//   POST   /attendance/courses            → create course (courseCode + courseName)
//   DELETE /attendance/courses/:courseId  → delete course + cascade
// =============================================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Plus, Users, Copy, ArrowRight, AlertCircle, BookOpen, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { Course } from "@/types/attendance";

const Attendance = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  // Course creation matches the backend's POST /courses check: admin, or any
  // lecturer (who is then auto-assigned as the course's own lecturer).
  const canCreate = isAdmin || user?.role === "lecturer";

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [courseCode, setCourseCode] = useState("");
  const [courseName, setCourseName] = useState("");
  const [creating, setCreating] = useState(false);

  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCourses = async () => {
    try {
      setError(null);
      const data = await api.attendance.courses.list();
      setCourses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load courses");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCourses(); }, []);

  const handleCreateCourse = async () => {
    if (!courseCode.trim() || !courseName.trim()) return;
    setCreating(true);
    try {
      await api.attendance.courses.create({
        courseCode: courseCode.trim().toUpperCase(),
        courseName: courseName.trim(),
      });
      await fetchCourses();
      setShowCreateDialog(false);
      setCourseCode("");
      setCourseName("");
      toast.success("Course created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create course");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCourse = async () => {
    if (!courseToDelete) return;
    setDeleting(true);
    try {
      await api.attendance.courses.delete(courseToDelete.id);
      setCourses((prev) => prev.filter((c) => c.id !== courseToDelete.id));
      toast.success("Course deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete course");
    } finally {
      setDeleting(false);
      setCourseToDelete(null);
    }
  };

  const copyRegistrationLink = (course: Course) => {
    const link = `${window.location.origin}/register/${course.registrationToken}`;
    navigator.clipboard.writeText(link).then(() => toast.success("Registration link copied"));
  };

  const filtered = courses.filter((c) => {
    const q = query.toLowerCase();
    return !q || c.courseCode.toLowerCase().includes(q) || c.courseName.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-12">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">Course Management</p>
            <h1 className="font-serif text-4xl md:text-5xl text-foreground">Attendance</h1>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Create Course
            </button>
          )}
        </div>

        <div className="h-px bg-border mb-8" />

        {/* Search */}
        <div className="relative mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search courses…"
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
            <p className="text-sm text-muted-foreground tracking-wide">Loading courses…</p>
          </div>
        ) : courses.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-6 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-serif text-2xl text-foreground mb-2">No courses yet</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {canCreate
                  ? "Create your first course to start automated attendance tracking."
                  : "No courses have been created yet."}
              </p>
            </div>
            {canCreate && (
              <button
                type="button"
                onClick={() => setShowCreateDialog(true)}
                className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Course
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-3 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No courses match "{query}"</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((course) => (
              <div
                key={course.id}
                className="group border border-border rounded-lg bg-card/60 p-6 flex flex-col gap-5 hover:border-foreground/25 transition-colors duration-200"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-mono tracking-widest text-muted-foreground border border-border rounded px-2 py-1">
                    {course.courseCode}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setCourseToDelete(course)}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors p-1"
                      aria-label="Delete course"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Course name */}
                <h3 className="font-serif text-xl leading-snug text-foreground flex-1">
                  {course.courseName}
                </h3>

                {/* Student count */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>
                    {course.studentCount} {course.studentCount === 1 ? "student" : "students"} registered
                  </span>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => copyRegistrationLink(course)}
                    className="w-full inline-flex items-center justify-center gap-2 border border-border text-xs tracking-widest uppercase py-2.5 rounded-full text-muted-foreground hover:border-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    Copy Registration Link
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/attendance/course/${course.id}`)}
                    className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase py-2.5 rounded-full hover:bg-foreground/90 transition-colors"
                  >
                    View Course
                    <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Course Dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) { setCourseCode(""); setCourseName(""); }
        }}
      >
        <DialogContent className="sm:max-w-md bg-card">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl font-normal">Create New Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="courseCode" className="text-xs tracking-widest uppercase text-muted-foreground">
                Course Code
              </Label>
              <Input
                id="courseCode"
                placeholder="e.g. EMT 401"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCourse()}
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="courseName" className="text-xs tracking-widest uppercase text-muted-foreground">
                Course Name
              </Label>
              <Input
                id="courseName"
                placeholder="e.g. Electromagnetic Theory"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCourse()}
                className="bg-background"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setShowCreateDialog(false)}
              disabled={creating}
              className="border border-border text-xs tracking-widest uppercase px-5 py-2.5 rounded-full text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateCourse}
              disabled={creating || !courseCode.trim() || !courseName.trim()}
              className="bg-foreground text-background text-xs tracking-widest uppercase px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-40"
            >
              {creating ? "Creating…" : "Create Course"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!courseToDelete} onOpenChange={(open) => !open && setCourseToDelete(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal">Delete course?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              This will permanently delete{" "}
              <strong className="text-foreground">{courseToDelete?.courseCode}</strong> and all its
              student registrations and session records. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-border text-xs tracking-widest uppercase rounded-full"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCourse}
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

export default Attendance;
