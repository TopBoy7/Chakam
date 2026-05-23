import { useEffect, useState, useRef } from "react";
import Navigation from "@/components/Navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Search, AlertCircle, Users, ShieldCheck, ShieldOff,
  ChevronDown, ChevronRight, Trash2, Camera, X, Upload, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { StudentRecord, Enrollment } from "@/types/attendance";

const MAX_PHOTOS = 5;

const StudentsPage = () => {
  const { isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Expandable enrollments per student
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [enrollments, setEnrollments] = useState<Record<string, Enrollment[]>>({});
  const [enrollmentsLoading, setEnrollmentsLoading] = useState<Record<string, boolean>>({});

  // Delete embeddings confirmation
  const [deleteTarget, setDeleteTarget] = useState<StudentRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Register student dialog
  const [showRegister, setShowRegister] = useState(false);
  const [regMatric, setRegMatric] = useState("");
  const [regFullName, setRegFullName] = useState("");
  const [regPhotos, setRegPhotos] = useState<File[]>([]);
  const [regPreviews, setRegPreviews] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const data = await api.students.list();
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load students");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleExpanded = async (matricNumber: string) => {
    const next = !expanded[matricNumber];
    setExpanded((prev) => ({ ...prev, [matricNumber]: next }));
    if (next && !enrollments[matricNumber]) {
      setEnrollmentsLoading((prev) => ({ ...prev, [matricNumber]: true }));
      try {
        const data = await api.students.getEnrollments(matricNumber);
        setEnrollments((prev) => ({ ...prev, [matricNumber]: data }));
      } catch {
        setEnrollments((prev) => ({ ...prev, [matricNumber]: [] }));
      } finally {
        setEnrollmentsLoading((prev) => ({ ...prev, [matricNumber]: false }));
      }
    }
  };

  const handleDeleteEmbeddings = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.students.deleteEmbeddings(deleteTarget.matricNumber);
      setStudents((prev) =>
        prev.map((s) =>
          s.matricNumber === deleteTarget.matricNumber
            ? { ...s, embeddingsDeleted: true }
            : s
        )
      );
      toast.success("Biometric data deleted");
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete biometric data");
    } finally {
      setDeleting(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files ?? []);
    if (!incoming.length) return;
    setRegPhotos((prev) => {
      const combined = [...prev, ...incoming].slice(0, MAX_PHOTOS);
      combined.forEach((file, i) => {
        if (i >= prev.length) {
          const reader = new FileReader();
          reader.onload = (ev) =>
            setRegPreviews((p) => { const next = [...p]; next[i] = ev.target?.result as string; return next; });
          reader.readAsDataURL(file);
        }
      });
      return combined;
    });
    e.target.value = "";
  };

  const removePhoto = (index: number) => {
    setRegPhotos((prev) => prev.filter((_, i) => i !== index));
    setRegPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRegister = async () => {
    if (!regMatric.trim() || !regFullName.trim() || regPhotos.length === 0) return;
    setRegistering(true);
    setRegError(null);
    try {
      const formData = new FormData();
      formData.append("matricNumber", regMatric.trim().toUpperCase());
      formData.append("fullName", regFullName.trim());
      for (const file of regPhotos) formData.append("photos", file);
      await api.students.register(formData);
      toast.success("Student registered");
      setShowRegister(false);
      setRegMatric(""); setRegFullName(""); setRegPhotos([]); setRegPreviews([]);
      await load();
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  };

  const closeRegisterDialog = () => {
    setShowRegister(false);
    setRegMatric(""); setRegFullName(""); setRegPhotos([]); setRegPreviews([]); setRegError(null);
  };

  const filtered = students.filter((s) => {
    const q = query.toLowerCase();
    return !q || s.matricNumber.toLowerCase().includes(q) || s.fullName.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-12">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">Student Registry</p>
            <h1 className="font-serif text-4xl md:text-5xl text-foreground">Students</h1>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowRegister(true)}
              className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Register Student
            </button>
          )}
        </div>

        <div className="h-px bg-border mb-8" />

        {/* Search */}
        <div className="relative mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by matric number or name…"
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
            <p className="text-sm text-muted-foreground tracking-wide">Loading students…</p>
          </div>
        ) : students.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-6 text-center">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-serif text-2xl text-foreground mb-2">No students registered</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Students register themselves via course registration links, or an admin can register them here.
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-3 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No students match "{query}"</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs tracking-widest uppercase text-muted-foreground mb-4">
              {filtered.length} {filtered.length === 1 ? "student" : "students"}
            </p>
            {filtered.map((student) => {
              const isExpanded = !!expanded[student.matricNumber];
              const courseEnrollments = enrollments[student.matricNumber];
              const isLoadingEnrollments = enrollmentsLoading[student.matricNumber];

              return (
                <div key={student.matricNumber} className="border border-border rounded-xl overflow-hidden">
                  {/* Student row */}
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{student.matricNumber}</span>
                        <Badge
                          variant={student.embeddingsDeleted ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {student.embeddingsDeleted ? (
                            <><ShieldOff className="h-3 w-3 mr-1" />Biometrics deleted</>
                          ) : (
                            <><ShieldCheck className="h-3 w-3 mr-1 text-success" />Biometrics active</>
                          )}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{student.fullName}</p>
                      {student.registeredAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Registered {format(new Date(student.registeredAt), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isAdmin && !student.embeddingsDeleted && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(student)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete biometric data"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(student.matricNumber)}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                        aria-label="Toggle enrollments"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-4 w-4" />
                          : <ChevronRight className="h-4 w-4" />
                        }
                      </button>
                    </div>
                  </div>

                  {/* Enrollments panel */}
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/20 px-5 py-4">
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-3">
                        Course Enrollments
                      </p>
                      {isLoadingEnrollments ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading…
                        </div>
                      ) : !courseEnrollments || courseEnrollments.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-1">Not enrolled in any courses.</p>
                      ) : (
                        <div className="space-y-2">
                          {courseEnrollments.map((enr) => (
                            <div
                              key={`${enr.courseCode}-${enr.matricNumber}`}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="font-mono text-xs text-foreground">{enr.courseCode}</span>
                              <span className="text-xs text-muted-foreground">
                                {enr.enrolledAt ? format(new Date(enr.enrolledAt), "MMM d, yyyy") : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Delete Embeddings Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal">Delete biometric data?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground space-y-2">
              <span className="block">
                This permanently deletes all stored face embeddings for{" "}
                <strong className="text-foreground">{deleteTarget?.fullName} ({deleteTarget?.matricNumber})</strong>.
              </span>
              <span className="block">
                Past attendance records are not affected. The student can no longer be recognised
                automatically — a lecturer will need to mark them manually.
              </span>
              <span className="block font-medium text-foreground">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="border-border text-xs tracking-widest uppercase rounded-full">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteEmbeddings}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground text-xs tracking-widest uppercase rounded-full hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete Data"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Register Student Dialog */}
      <Dialog open={showRegister} onOpenChange={(open) => { if (!open) closeRegisterDialog(); else setShowRegister(true); }}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-normal">Register Student</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="regMatric" className="text-xs tracking-widest uppercase text-muted-foreground">Matric Number</Label>
              <Input
                id="regMatric"
                placeholder="e.g. 190403014"
                value={regMatric}
                onChange={(e) => setRegMatric(e.target.value)}
                className="bg-background font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="regName" className="text-xs tracking-widest uppercase text-muted-foreground">Full Name</Label>
              <Input
                id="regName"
                placeholder="e.g. Chukwuemeka Obi"
                value={regFullName}
                onChange={(e) => setRegFullName(e.target.value)}
                className="bg-background"
              />
            </div>

            {/* Photo upload */}
            <div className="space-y-2">
              <Label className="text-xs tracking-widest uppercase text-muted-foreground">
                Passport Photos ({regPhotos.length}/{MAX_PHOTOS})
              </Label>
              <p className="text-xs text-muted-foreground">Up to {MAX_PHOTOS} clear, front-facing photos.</p>

              {regPreviews.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {regPreviews.map((src, i) => (
                    <div key={i} className="relative group">
                      <img src={src} alt={`Photo ${i + 1}`} className="h-16 w-full rounded object-cover border border-border" />
                      <button
                        type="button"
                        onClick={() => removePhoto(i)}
                        className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {regPhotos.length < MAX_PHOTOS && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Camera className="h-6 w-6 opacity-60" />
                    <p className="text-xs">Click to upload photos</p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            {regError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{regError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={closeRegisterDialog}
              disabled={registering}
              className="text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRegister}
              disabled={registering || !regMatric.trim() || !regFullName.trim() || regPhotos.length === 0}
              className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-40"
            >
              {registering ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Registering…</>
              ) : (
                <><Upload className="h-3.5 w-3.5" />Register</>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentsPage;
