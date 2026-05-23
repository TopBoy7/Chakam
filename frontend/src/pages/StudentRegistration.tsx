// =============================================================================
// PAGE: /register/:token  — Public student self-registration
// =============================================================================
// Flow:
//   1. Resolve token → course via GET /attendance/register/:token  (public)
//   2. Student reads the privacy notice, checks BOTH consent checkboxes
//   3. Student enters matric number and uploads passport photo(s)
//   4. Submit → POST /attendance/courses/:courseId/register  (multipart/form-data)
//        Fields:
//          matricNumber       (string)
//          photos             (File[] — up to 5 JPEG/PNG)
//          biometricConsent   ("true")
//          manualAltConsent   ("true")
//          ageConsent         ("true")
//
// =============================================================================
// BACKEND ENFORCEMENT — POST /attendance/courses/:courseId/register
// =============================================================================
// The frontend collects consent. The backend must PROVE and ENFORCE it.
// Do not trust the UI — treat every request as potentially tampered.
//
// STEP 1 — CONSENT GATE (reject before touching any data):
//   if request.form.get("biometricConsent") != "true":
//       raise HTTPException(422, "Biometric consent is required")
//   if request.form.get("manualAltConsent") != "true":
//       raise HTTPException(422, "Manual alternative acknowledgment is required")
//   if request.form.get("ageConsent") != "true":
//       raise HTTPException(422, "Age declaration is required")
//
// STEP 2 — DUPLICATE CHECK:
//   Reject if matricNumber already registered for this courseId → 409 Conflict
//
// STEP 3 — PHOTO PROCESSING (DATA MINIMISATION — NDPA s.24):
//   *** DO NOT upload photos to Cloudinary or save them anywhere ***
//   For each uploaded photo:
//     a. Read into memory (bytes / numpy array)
//     b. Run face_recognition.face_encodings() → extract 128-float vector
//     c. If no face detected → return 422 "No face detected in photo N"
//     d. Discard the image bytes immediately — never written to disk or cloud
//   Store ONLY the embedding vector(s) in MongoDB
//
// STEP 4 — STORE CONSENT AUDIT RECORD:
//   On the student document store:
//     {
//       matricNumber:       str   (uppercase),
//       courseId:           str,
//       embeddings:         List[List[float]],   # one per photo, 128 floats each
//       biometricConsent:   True,
//       manualAltConsent:   True,
//       consentTimestamp:   datetime.utcnow(),   # NDPA audit trail
//       consentVersion:     "1.0",               # bump when notice text changes
//       registeredAt:       datetime.utcnow(),
//     }
//   No photoUrls field. No Cloudinary reference. Photos are gone.
//
// STEP 5 — RESPONSE:
//   Return 201 Created: { data: { student: { matricNumber, courseId, registeredAt } } }
//   Do not echo back embeddings.
//
// =============================================================================
// BACKEND ENFORCEMENT — DELETE /attendance/courses/:courseId/students/biometrics
// =============================================================================
//   Body: { matricNumber: string }
//
//   The student has the right to erasure under NDPA s.36. This must be instant.
//
//   1. Find student by (courseId, matricNumber). Return 404 if not found.
//   2. Delete all stored embeddings for this student (set embeddings: []).
//   3. Update the document:
//        embeddingsDeleted:    True
//        consentWithdrawnAt:   datetime.utcnow()
//      Do NOT hard-delete the document — preserve the audit trail.
//   4. Past AttendanceRecord documents are NOT touched — historical marks are kept.
//   5. After this, the recognition pipeline must skip this student (check embeddingsDeleted flag).
//   6. Return 204 No Content.
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
  const [manualAltConsent, setManualAltConsent] = useState(false);
  const [ageConsent, setAgeConsent]             = useState(false);
  const [matricNumber, setMatricNumber]         = useState("");
  const [fullName, setFullName]                 = useState("");
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
        const res = await fetch(`${API_BASE}/register/${token}`);
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d?.detail || "Invalid or expired registration link");
        }
        const data = await res.json();
        const raw = data.data.course;
        setCourse({ ...raw, id: raw.courseCode, studentCount: 0 });
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
    if (!course || !matricNumber.trim() || !fullName.trim() || photoFiles.length === 0 || !biometricConsent || !manualAltConsent || !ageConsent) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append("matricNumber", matricNumber.trim().toUpperCase());
      formData.append("fullName", fullName.trim());
      formData.append("biometricConsent", "true");
      formData.append("manualAltConsent", "true");
      formData.append("ageConsent", "true");
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
                Your photo is processed <strong className="text-foreground">in memory only</strong> to extract
                a 128-number mathematical vector (face embedding). The photo is{" "}
                <strong className="text-foreground">immediately deleted</strong> after extraction — it is never
                saved to disk, cloud storage, or any database. Only the numerical vector is stored.
                It cannot be reversed back into a face image.
              </p>
            </div>

            {/* What is stored */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">What is stored</p>
              <p className="text-xs leading-relaxed">
                Your matric number, your face embedding (128 numbers, AES-256 encrypted), and
                a record that you gave consent with the exact date and time. Nothing else.
              </p>
            </div>

            {/* How it's used */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">How it's used</p>
              <p className="text-xs leading-relaxed">
                During class, the camera sends a snapshot to the server. The system compares
                detected faces against stored embeddings <strong className="text-foreground">in memory</strong> — the
                snapshot is not saved. Your embedding is used <strong className="text-foreground">only</strong> for
                attendance in <strong className="text-foreground">{course.courseName}</strong>. It is
                not shared with any third party.
              </p>
            </div>

            {/* Who can access */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">Who can access</p>
              <p className="text-xs leading-relaxed">
                Only the course lecturer can view attendance results. Your lecturer reviews and
                can override every automated mark before it affects your record (NDPA s.37).
              </p>
            </div>

            {/* Retention */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">Retention</p>
              <p className="text-xs leading-relaxed">
                Your embedding is deleted at the end of the academic session, or immediately
                upon your request — whichever comes first.
              </p>
            </div>

            {/* Your rights */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-foreground">Your rights (NDPA 2023)</p>
              <p className="text-xs leading-relaxed">
                You have the right to access your data (s.34), correct it (s.35), erase it (s.36),
                and object to processing (s.38). To delete your embedding, visit the{" "}
                <a href="/my-attendance" className="underline underline-offset-2 hover:text-foreground transition-colors">
                  My Attendance
                </a>{" "}
                page. Deletion is immediate and does not affect past attendance records.
              </p>
            </div>

            {/* Manual alternative */}
            <div className="rounded-lg bg-foreground/[0.04] border border-border px-4 py-3 flex gap-3">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">
                <strong className="text-foreground">No consent? No problem.</strong> You do not need
                to register here. Your lecturer will record your attendance manually.{" "}
                <strong className="text-foreground">There is no academic penalty for opting out.</strong>
              </p>
            </div>

            {/* Checkbox 1 — Biometric consent (NDPA s.26 + s.30(1)(a)) */}
            <label className="flex items-start gap-3 cursor-pointer pt-1">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={biometricConsent}
                  onChange={(e) => {
                    setBiometricConsent(e.target.checked);
                    if (!e.target.checked) { setPhotoFiles([]); setPhotoPreviews([]); }
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
                I understand that my photograph will be used to create a facial recognition
                template for automated attendance in{" "}
                <strong>{course.courseCode}</strong>. The photo will be deleted immediately
                after processing. I can withdraw from this system at any time.
              </span>
            </label>

            {/* Checkbox 2 — Manual alternative acknowledgment (NDPA s.26 freely given) */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={manualAltConsent}
                  onChange={(e) => setManualAltConsent(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-4 w-4 rounded border border-border bg-background peer-checked:bg-foreground peer-checked:border-foreground transition-colors flex items-center justify-center">
                  {manualAltConsent && (
                    <svg className="h-2.5 w-2.5 text-background" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs leading-relaxed text-foreground">
                I understand that a manual attendance alternative is available and that
                choosing not to register carries <strong>no academic penalty</strong>.
              </span>
            </label>

            {/* Checkbox 3 — Age declaration (NDPA s.31 — parental consent required for under-18) */}
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={ageConsent}
                  onChange={(e) => setAgeConsent(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="h-4 w-4 rounded border border-border bg-background peer-checked:bg-foreground peer-checked:border-foreground transition-colors flex items-center justify-center">
                  {ageConsent && (
                    <svg className="h-2.5 w-2.5 text-background" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-xs leading-relaxed text-foreground">
                I confirm I am <strong>18 years of age or older</strong>, or I have obtained
                parental/guardian consent to register (required under NDPA Section 31).
              </span>
            </label>
          </CardContent>
        </Card>

        {/* ── Registration Form (only active after consent) ── */}
        <Card className={(!biometricConsent || !manualAltConsent || !ageConsent) ? "opacity-50 pointer-events-none select-none" : ""}>
          <CardHeader className="pb-4">
            <CardTitle className="font-serif text-lg font-normal">Register for attendance tracking</CardTitle>
            <CardDescription className="text-sm">
              {biometricConsent && manualAltConsent && ageConsent
                ? "Upload clear, front-facing photos. You only need to do this once."
                : "Check all three boxes above to continue."}
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
                  placeholder="e.g. 190403014"
                  value={matricNumber}
                  onChange={(e) => setMatricNumber(e.target.value)}
                  required
                  disabled={!biometricConsent}
                  className="font-mono bg-background"
                />
              </div>

              {/* Full Name */}
              <div className="space-y-2">
                <Label htmlFor="fullName" className="text-xs tracking-widest uppercase text-muted-foreground">
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  placeholder="e.g. Chukwuemeka Obi"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  disabled={!biometricConsent}
                  className="bg-background"
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
                disabled={submitting || !matricNumber.trim() || !fullName.trim() || photoFiles.length === 0 || !biometricConsent || !manualAltConsent || !ageConsent}
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
