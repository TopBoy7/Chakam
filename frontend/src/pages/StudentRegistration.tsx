// =============================================================================
// PAGE: /register/:token  — Public student self-registration
// =============================================================================
// Flow:
//   1. Resolve token → course via GET /attendance/register/:token  (public)
//   2. Student enters matric number and uploads UP TO 5 passport photos
//   3. Submit → POST /attendance/courses/:courseId/register  (multipart/form-data)
//        Fields: matricNumber (string), photos (File[] — up to 5 JPEG/PNG images)
//
// WHY MULTIPLE PHOTOS:
//   A single reference photo is fragile — lighting, angle, hairstyle changes between
//   registration day and class day all reduce match accuracy. Multiple photos (e.g.
//   front, slight left, slight right, with/without glasses) give the recognition model
//   multiple embeddings to compare against, significantly improving hit rate.
//
// BACKEND NOTE for /register endpoint:
//   - Accept `photos` as a multi-file field (not `photo`) — FormData will have
//     multiple entries all keyed "photos".
//   - Upload each to Cloudinary, store all URLs in an array field (e.g. photoUrls[]).
//   - Compute face embeddings for EACH photo and store them all — the recognition
//     pipeline should match against the closest embedding rather than a single one.
//   - Still enforce duplicate matricNumber per course → 409 Conflict.
// =============================================================================

import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Camera, CheckCircle2, Upload, AlertCircle, RefreshCw, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Course } from "@/types/attendance";

const MAX_PHOTOS = 5;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const StudentRegistration = () => {
  const { token } = useParams<{ token: string }>();

  const [course, setCourse]         = useState<Course | null>(null);
  const [loading, setLoading]       = useState(true);
  const [courseError, setCourseError] = useState<string | null>(null);

  const [matricNumber, setMatricNumber] = useState("");
  const [photoFiles, setPhotoFiles]     = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting]     = useState(false);
  const [submitted, setSubmitted]       = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);

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
        setCourseError(err instanceof Error ? err.message : "Failed to load registration info");
      } finally {
        setLoading(false);
      }
    };
    fetchCourse();
  }, [token]);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    if (!incoming.length) return;

    setPhotoFiles((prev) => {
      const combined = [...prev, ...incoming].slice(0, MAX_PHOTOS);
      // Regenerate all previews
      combined.forEach((file, i) => {
        if (i >= prev.length) {
          const reader = new FileReader();
          reader.onload = (ev) =>
            setPhotoPreviews((p) => {
              const next = [...p];
              next[i] = ev.target?.result as string;
              return next;
            });
          reader.readAsDataURL(file);
        }
      });
      return combined;
    });
    // Reset input so the same file can be re-added after removal
    e.target.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course || !matricNumber.trim() || photoFiles.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("matricNumber", matricNumber.trim().toUpperCase());
      // Append all photos under the key "photos" (array).
      // BACKEND: accept photos as a multi-file field — iterate request.files.getlist("photos")
      for (const file of photoFiles) {
        formData.append("photos", file);
      }
      await api.attendance.students.register(course.id, formData);
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin mx-auto" />
          <p className="mt-4 text-sm text-muted-foreground">Loading registration…</p>
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
              <h2 className="font-serif text-xl">Link not found</h2>
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
            <CheckCircle2 className="h-16 w-16 text-success mx-auto" />
            <div>
              <h2 className="font-serif text-2xl">You're registered!</h2>
              <p className="text-muted-foreground mt-2 leading-relaxed max-w-xs mx-auto text-sm">
                Your lecturer will capture attendance during class — you just need to be present
                and facing the camera when they trigger it.
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
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-5">
            <img src="/cam.png" alt="Chakam" className="h-8 w-8 img-foreground" />
            <span className="font-serif text-xl text-foreground">Chakam</span>
          </div>
          <Badge variant="secondary" className="font-mono text-sm px-3 py-1">
            {course.courseCode}
          </Badge>
          <h1 className="font-serif text-xl">{course.courseName}</h1>
          <p className="text-muted-foreground text-sm">Student Attendance Registration</p>
        </div>

        {/* Form Card */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="font-serif text-lg font-normal">Register for attendance tracking</CardTitle>
            <CardDescription className="text-sm">
              Your photos will be used to identify you when your lecturer captures attendance.
              You only need to do this once.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Matric Number */}
              <div className="space-y-2">
                <Label htmlFor="matric" className="text-xs tracking-widest uppercase text-muted-foreground">
                  Matric Number
                </Label>
                <Input
                  id="matric"
                  placeholder="e.g. 19/30CS/01234"
                  value={matricNumber}
                  onChange={(e) => setMatricNumber(e.target.value)}
                  required
                  className="font-mono bg-background"
                />
              </div>

              {/* Multi-photo Upload */}
              <div className="space-y-2">
                <Label className="text-xs tracking-widest uppercase text-muted-foreground">
                  Passport Photos ({photoFiles.length}/{MAX_PHOTOS})
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Upload up to {MAX_PHOTOS} clear, front-facing photos — different angles and
                  lighting improve recognition accuracy. No sunglasses or hats.
                </p>

                {/* Preview grid */}
                {photoPreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {photoPreviews.map((src, i) => (
                      <div key={i} className="relative group">
                        <img
                          src={src}
                          alt={`Photo ${i + 1}`}
                          className="h-24 w-full rounded-lg object-cover border border-border"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={`Remove photo ${i + 1}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Upload area */}
                {photoFiles.length < MAX_PHOTOS && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-lg p-5 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-col items-center gap-3 py-2">
                      {photoFiles.length > 0 ? (
                        <RefreshCw className="h-8 w-8 text-muted-foreground/60" />
                      ) : (
                        <Camera className="h-8 w-8 text-muted-foreground/60" />
                      )}
                      <div className="text-center space-y-1">
                        <p className="text-sm font-medium">
                          {photoFiles.length === 0 ? "Click to upload photos" : "Add more photos"}
                        </p>
                        <p className="text-xs text-muted-foreground">JPG or PNG, up to 5 MB each</p>
                      </div>
                    </div>
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  aria-label="Upload passport photographs"
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
                disabled={submitting || !matricNumber.trim() || photoFiles.length === 0}
              >
                {submitting ? (
                  <><div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />Registering…</>
                ) : (
                  <><Upload className="h-4 w-4 mr-2" />Register</>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground px-4">
          Your photos are stored securely and used only for attendance verification in this course.
        </p>
      </div>
    </div>
  );
};

export default StudentRegistration;
