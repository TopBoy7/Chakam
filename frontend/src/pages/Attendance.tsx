// =============================================================================
// PAGE: /attendance  — Lecturer's course management hub
// =============================================================================
// What this page does:
//   - Shows all courses the lecturer has created (GET /attendance/courses)
//   - Lets the lecturer create a new course (POST /attendance/courses)
//   - Lets the lecturer delete a course with confirmation (DELETE /attendance/courses/:id)
//   - Provides a "Copy Registration Link" button per course that copies the
//     public student sign-up URL to clipboard:
//       {window.location.origin}/register/{course.registrationToken}
//     Students open this link to register their matric number + photo.
//   - Navigates to /attendance/course/:courseId for session and attendance management
//
// Auth: Only admins (lecturers) can see this page's content. Non-admins see a
// login prompt. This is enforced client-side via useAuth(); the backend does
// not yet have per-lecturer authentication.
//
// APIs used on this page:
//   GET    /attendance/courses            → load course list on mount
//   POST   /attendance/courses            → create course (courseCode + courseName)
//   DELETE /attendance/courses/:courseId  → delete course + cascade
// =============================================================================

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Plus,
  Users,
  Copy,
  ArrowRight,
  AlertCircle,
  BookOpen,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { Course } from "@/types/attendance";

const Attendance = () => {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [courseCode, setCourseCode] = useState("");
  const [courseName, setCourseName] = useState("");
  const [creating, setCreating] = useState(false);

  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Re-fetches the full course list after create/delete so studentCount stays accurate.
  // The backend computes studentCount dynamically, so a fresh GET is the simplest approach.
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

  useEffect(() => {
    fetchCourses();
  }, []);

  // Sends courseCode uppercased — the frontend normalises it before the request.
  // The backend returns the full Course object (including the new registrationToken)
  // which is why we re-fetch rather than optimistically inserting a partial object.
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
      toast.success("Course created successfully");
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

  // Builds the public student registration URL using the course's registrationToken.
  // The token (not the courseId) is in the URL for a layer of obscurity — random UUIDs
  // are harder to guess than sequential IDs.
  // The backend resolves this token via GET /attendance/register/:token.
  const copyRegistrationLink = (course: Course) => {
    const link = `${window.location.origin}/register/${course.registrationToken}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success("Registration link copied to clipboard");
    });
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="container mx-auto px-4 py-24 text-center">
          <BookOpen className="h-14 w-14 text-muted-foreground mx-auto mb-5" />
          <h2 className="text-2xl font-bold mb-2">Attendance Management</h2>
          <p className="text-muted-foreground max-w-sm mx-auto">
            Please log in as a lecturer to manage courses and track attendance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Attendance</h1>
            <p className="text-muted-foreground mt-1">
              Manage courses and track student attendance automatically
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)} size="lg">
            <Plus className="h-4 w-4 mr-2" />
            Create Course
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
            <p className="mt-4 text-muted-foreground">Loading courses...</p>
          </div>
        ) : courses.length === 0 ? (
          <div className="text-center py-20">
            <BookOpen className="h-14 w-14 text-muted-foreground mx-auto mb-4 opacity-60" />
            <p className="text-xl font-semibold mb-2">No courses yet</p>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Create your first course to start automated attendance tracking.
            </p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Course
            </Button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
              <Card key={course.id} className="flex flex-col hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <Badge
                      variant="secondary"
                      className="text-sm font-mono tracking-wide"
                    >
                      {course.courseCode}
                    </Badge>
                    <button
                      onClick={() => setCourseToDelete(course)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                      aria-label="Delete course"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <h3 className="font-semibold text-lg mt-2 leading-snug">
                    {course.courseName}
                  </h3>
                </CardHeader>

                <CardContent className="flex flex-col gap-4 flex-1">
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Users className="h-4 w-4 flex-shrink-0" />
                    <span>
                      {course.studentCount}{" "}
                      {course.studentCount === 1 ? "student" : "students"} registered
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 mt-auto pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyRegistrationLink(course)}
                      className="w-full"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Registration Link
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => navigate(`/attendance/course/${course.id}`)}
                      className="w-full"
                    >
                      View Course
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create Course Dialog */}
      <Dialog
        open={showCreateDialog}
        onOpenChange={(open) => {
          setShowCreateDialog(open);
          if (!open) {
            setCourseCode("");
            setCourseName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="courseCode">Course Code</Label>
              <Input
                id="courseCode"
                placeholder="e.g. EMT 401"
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCourse()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="courseName">Course Name</Label>
              <Input
                id="courseName"
                placeholder="e.g. Electromagnetic Theory"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateCourse()}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateCourse}
              disabled={creating || !courseCode.trim() || !courseName.trim()}
            >
              {creating ? "Creating..." : "Create Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!courseToDelete}
        onOpenChange={(open) => !open && setCourseToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete course?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{" "}
              <strong>{courseToDelete?.courseCode}</strong> and all its student
              registrations and session records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCourse}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Attendance;
