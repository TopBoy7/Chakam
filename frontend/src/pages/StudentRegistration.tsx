// =============================================================================
// PAGE: /register/:token  — Public student self-registration
// =============================================================================
// Flow:
//   1. Resolve token → course via GET /attendance/register/:token  (public)
//   2. Student reads the consent form and checks the biometric consent checkbox
//      (required by NDPA Section 30 — biometric data is sensitive personal data)
//   3. Student enters matric number and uploads UP TO 5 passport photos
//   4. Submit → POST /attendance/courses/:courseId/register  (multipart/form-data)
//        Fields: matricNumber (string), photos (File[] — up to 5 JPEG/PNG images),
//                biometricConsent (string "true") — store this flag with the record
//
// BACKEND NOTE for /register endpoint:
//   - Accept `photos` as a multi-file field — iterate request.files.getlist("photos")
//   - Store `biometricConsent: true` and `consentTimestamp: now()` on the student record
//     (NDPA requires an audit trail of when consent was given)
//   - Upload each photo to Cloudinary, store all URLs in an array field (photoUrls[])
//   - Compute face embeddings for EACH photo and store them all
//   - Still enforce duplicate matricNumber per course → 409 Conflict
//
// BACKEND NOTE for DELETE /attendance/courses/:courseId/students/biometrics:
//   - Body: { matricNumber: string }
//   - Delete all stored photos from Cloudinary (all photoUrls)
//   - Delete all face embeddings for this student in this course
//   - Set photosDeleted: true, embeddingsDeleted: true, consentWithdrawnAt: now()
//     on the student record (keep the record itself for audit — do NOT hard-delete)
//   - Attendance records (past sessions) must be preserved — only biometrics are removed
//   - Return 204 No Content
// =============================================================================

import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Camera, CheckCircle2, Upload, AlertCircle, RefreshCw, X, ShieldCheck, Info } from "lucide-react";
import { api } from "@/lib/api";
import type { Course } from "@/types/attendance";

const MAX_PHOTOS = 5;
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const StudentRegistration = () => {
  const { token } = useParams<{ token: string }>();

  const [course, setCourse]           = useState<Course | null>(null);
  const [loading, setLoading]         = useState(true);
  const [courseError, setCourseError] = useState<string | null>(null);

  const [biometricConsent, setBiometricConsent] = useState(false);
  const [matricNumber, setMatricNumber]         = useState("");
  const [photoFiles, setPhotoFiles]             = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews]       = useState<string[]>([]);
  const [submitting, setSubmitting]             = useState(false);
  const [submitted, setSubmitted]               = useState(false);
  const [submitError, setSubmitError]           = useState<string | null>(null);

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
    e.target.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!course || !matricNumber.trim() || photoFiles.length === 0 || !biometricConsent) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("matricNumber", matricNumber.trim().toUpperCase());
      formData.append("biometricConsent", "true");
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
            <p className="text-xs text-muted-foreground pt-2 max-w-xs mx-auto">
              You can withdraw consent and delete your biometric data at any time from the{" "}
              <a href="/my-attendance" className="underline underline-offset-2 hover:text-foreground transition-colors">
                My Attendance
              </a>{" "}
              page.
            </p>
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

        {/* ── Consent Card (NDPA Section 30) ── */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground shrink-0" />
              <CardTitle className="font-serif text-base font-normal">
                Biometric Data &amp; Privacy Notice
              </CardTitle>
            </div>
            <CardDescription className="text-xs leading-relaxed mt-1">
              Under the Nigeria Data Protection Act 2023 (NDPA), Section 30, facial images and
              face embeddings are classified as <strong className="text-foreground">biometric personal data</strong>{" "}
              — a special category requiring your explicit consent before processing.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 text-sm text-muted-foreground">
            {/* What we collect */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">What we collect</p>
              <p className="text-xs leading-relaxed">
                Up to 5 passport-style photos of your face. From these, a mathematical
                representation (face embedding) is computed. Both the photos and the
                embedding are stored in encrypted cloud storage (Cloudinary).
              </p>
            </div>

            {/* How it's used */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">How it's used</p>
              <p className="text-xs leading-relaxed">
                Your face embedding is compared against a photo captured in the classroom when
                your lecturer triggers attendance. It is used <strong className="text-foreground">only</strong> for
                verifying your presence in <strong className="text-foreground">{course.courseName}</strong>. It is
                not shared with third parties and not used for any other purpose.
              </p>
            </div>

            {/* Retention */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">Retention</p>
              <p className="text-xs leading-relaxed">
                Your photos and embedding are retained for the duration of the course or until
                you withdraw consent, whichever comes first.
              </p>
            </div>

            {/* Your rights */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">Your rights</p>
              <p className="text-xs leading-relaxed">
                You may <strong className="text-foreground">withdraw consent and delete your biometric data at
                any time</strong> from the{" "}
                <a href="/my-attendance" className="underline underline-offset-2 hover:text-foreground transition-colors">
                  My Attendance
                </a>{" "}
                page. Deleting your data does not affect past attendance records.
              </p>
            </div>

            {/* Manual alternative */}
            <div className="rounded-lg bg-foreground/[0.04] border border-border px-4 py-3 flex gap-3">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <strong className="text-foreground">No consent? No problem.</strong> If you do not
                wish to provide biometric data, you do not need to register here.
                Your lecturer will record your attendance manually each class.
              </p>
            </div>

            {/* Consent checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group pt-1">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={biometricConsent}
                  onChange={(e) => {
                    setBiometricConsent(e.target.checked);
                    if (!e.target.checked) {
                      setPhotoFiles([]);
                      setPhotoPreviews([]);
                    }
                  }}
                  className="peer sr-only"
                />
                <div className="h-4 w-4 rounded border border-border bg-background peer-checked:bg-foreground peer-checked:border-foreground transition-colors flex items-center justify-center">
                  {biometricConsent && (
                    <svg className="h-2.5 w-2.5 text-background" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs leading-relaxed text-foreground">
                I have read and understood the above. I <strong>explicitly consent</strong> to
                the collection and processing of my biometric (facial) data for automated
                attendance in <strong>{course.courseCode} — {course.courseName}</strong>, in
                accordance with NDPA Section 30.
              </span>
            </label>
          </CardContent>
        </Card>

        {/* ── Registration Form (only active after consent) ── */}
        <Card className={!biometricConsent ? "opacity-50 pointer-events-none select-none" : ""}>
          <CardHeader className="pb-4">
            <CardTitle className="font-serif text-lg font-normal">Register for attendance tracking</CardTitle>
            <CardDescription className="text-sm">
              {biometricConsent
                ? "Upload clear, front-facing photos. You only need to do this once."
                : "Check the consent box above to continue."}
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
                  disabled={!biometricConsent}
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
                    tabIndex={biometricConsent ? 0 : -1}
                    onClick={() => biometricConsent && fileInputRef.current?.click()}
                    onKeyDown={(e) => biometricConsent && (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
                    className="border-2 border-dashed border-border rounded-lg p-5 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex flex-col items-center gap-3 py-2">
                      {photoFiles.length > 0
                        ? <RefreshCw className="h-8 w-8 text-muted-foreground/60" />
                        : <Camera className="h-8 w-8 text-muted-foreground/60" />
                      }
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
                disabled={submitting || !matricNumber.trim() || photoFiles.length === 0 || !biometricConsent}
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
          Chakam processes biometric data under NDPA 2023. Your data is encrypted at rest and in transit.
        </p>
      </div>
    </div>
  );
};

export default StudentRegistration;
