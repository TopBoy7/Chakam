// =============================================================================
// PAGE: /register/:token  — Public student self-registration
// =============================================================================
// What this page does:
//   - Resolves the registration token in the URL to a course
//       GET /attendance/register/:token  → returns the Course object
//     This is a PUBLIC endpoint — no authentication required. Students open
//     a link shared by their lecturer and land here directly.
//   - Shows a form where the student enters their matric number and uploads
//     a passport-style photo of their face.
//   - On submit, sends the form to:
//       POST /attendance/courses/:courseId/register  (multipart/form-data)
//       Fields: matricNumber (string), photo (File — JPEG or PNG)
//   - Shows a success screen once the backend confirms registration.
//
// TOKEN vs COURSE ID:
//   The URL contains the `registrationToken` (a UUID), NOT the courseId.
//   This is intentional — tokens are random and unguessable, unlike sequential IDs.
//   The backend needs TWO endpoints:
//     1. GET /attendance/register/:token
//        Looks up the course by registrationToken, returns the Course object.
//        Used here to show the course name before the student submits.
//        Return 404 if the token doesn't match any course.
//     2. POST /attendance/courses/:courseId/register  (already documented in api.ts)
//        The actual registration submission. courseId comes from the Course
//        object returned by step 1.
//
// PHOTO STORAGE:
//   The backend should store the uploaded photo in Cloudinary (same approach as
//   classroom images) and save the secure_url as the student's `photoUrl`.
//   Optionally, compute a face embedding from the photo at registration time and
//   cache it — this speeds up facial recognition during live sessions.
//
// ERROR STATES:
//   - Invalid/unknown token → "Link not found" screen
//   - Duplicate matric number for same course → show the backend's error message
//     (backend should return 409 with { detail: "Already registered" })
//   - Network/server error → inline error alert, form stays visible for retry
// =============================================================================

import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Camera, CheckCircle2, Upload, AlertCircle, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Course } from "@/types/attendance";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const StudentRegistration = () => {
  const { token } = useParams<{ token: string }>();

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [courseError, setCourseError] = useState<string | null>(null);

  const [matricNumber, setMatricNumber] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    const fetchCourse = async () => {
      try {
        const res = await fetch(`${API_BASE}/attendance/register/${token}`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || "Invalid or expired registration link");
        }
        const data = await res.json();
        setCourse(data.data.course);
      } catch (err) {
        setCourseError(
          err instanceof Error ? err.message : "Failed to load registration info"
        );
      } finally {
        setLoading(false);
      }
    };
    fetchCourse();
  }, [token]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course || !matricNumber.trim() || !photoFile) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("matricNumber", matricNumber.trim().toUpperCase());
      formData.append("photo", photoFile);
      await api.attendance.students.register(course.id, formData);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Registration failed. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Loading registration...</p>
        </div>
      </div>
    );
  }

  // ── Invalid link ─────────────────────────────────────────────────────────────
  if (courseError || !course) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
            <div>
              <h2 className="text-lg font-semibold">Link not found</h2>
              <p className="text-muted-foreground text-sm mt-1">
                {courseError || "This registration link is invalid or has expired."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-10 pb-10 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <div>
              <h2 className="text-2xl font-bold">You're registered!</h2>
              <p className="text-muted-foreground mt-2 leading-relaxed max-w-xs mx-auto">
                Your attendance for{" "}
                <span className="font-semibold text-foreground">{course.courseCode}</span>{" "}
                will be tracked automatically when you attend class. No further action
                needed.
              </p>
            </div>
            <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
              {course.courseCode}
            </Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Registration Form ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Branding + Course Info */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-5">
            <img src="/cam.png" alt="Chakam" className="h-8 w-8 img-foreground" />
            <span className="text-xl font-bold">Chakam</span>
          </div>
          <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
            {course.courseCode}
          </Badge>
          <h1 className="text-xl font-semibold">{course.courseName}</h1>
          <p className="text-muted-foreground text-sm">Student Attendance Registration</p>
        </div>

        {/* Form Card */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Register for attendance tracking</CardTitle>
            <CardDescription>
              Your photo will be used by the classroom camera to automatically mark you
              present during lectures. You only need to do this once.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Matric Number */}
              <div className="space-y-2">
                <Label htmlFor="matric">Matric Number</Label>
                <Input
                  id="matric"
                  placeholder="e.g. 19/30CS/01234"
                  value={matricNumber}
                  onChange={(e) => setMatricNumber(e.target.value)}
                  required
                  className="font-mono"
                />
              </div>

              {/* Photo Upload */}
              <div className="space-y-2">
                <Label>Passport Photograph</Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Use a clear, front-facing photo with good lighting. Your full face must
                  be visible and unobstructed — no sunglasses or hats.
                </p>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()
                  }
                  className="border-2 border-dashed border-border rounded-lg p-5 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {photoPreview ? (
                    <div className="flex flex-col items-center gap-3">
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="h-32 w-32 rounded-full object-cover mx-auto ring-2 ring-border"
                      />
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Click to change photo
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-4">
                      <Camera className="h-12 w-12 text-muted-foreground/60" />
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium">Click to upload photo</p>
                        <p className="text-xs text-muted-foreground">
                          JPG or PNG, up to 5 MB
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  aria-label="Upload passport photograph"
                  onChange={handlePhotoChange}
                />
              </div>

              {submitError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={submitting || !matricNumber.trim() || !photoFile}
              >
                {submitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                    Registering...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Register
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground px-4">
          Your photo is stored securely and used only for attendance verification in
          this course.
        </p>
      </div>
    </div>
  );
};

export default StudentRegistration;
