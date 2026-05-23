import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Search, AlertCircle, GraduationCap, Mail, IdCard } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { Lecturer } from "@/types/lecturer";

const LecturersPage = () => {
  const { isAdmin } = useAuth();

  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete dialog
  const [toDelete, setToDelete] = useState<Lecturer | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    try {
      setError(null);
      const data = await api.lecturers.list();
      setLecturers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lecturers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!staffId.trim() || !fullName.trim() || !email.trim()) return;
    setCreating(true);
    try {
      await api.lecturers.create({
        staffId: staffId.trim().toUpperCase(),
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
      });
      await load();
      setShowCreate(false);
      setStaffId(""); setFullName(""); setEmail("");
      toast.success("Lecturer registered");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create lecturer");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.lecturers.delete(toDelete.staffId);
      setLecturers((prev) => prev.filter((l) => l.staffId !== toDelete.staffId));
      toast.success("Lecturer removed");
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete lecturer");
    } finally {
      setDeleting(false);
    }
  };

  const filtered = lecturers.filter((l) => {
    const q = query.toLowerCase();
    return !q || l.fullName.toLowerCase().includes(q) || l.staffId.toLowerCase().includes(q) || l.email.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-6 pt-28 pb-16">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 mb-12">
          <div>
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">Staff Management</p>
            <h1 className="font-serif text-4xl md:text-5xl text-foreground">Lecturers</h1>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Lecturer
            </button>
          )}
        </div>

        <div className="h-px bg-border mb-8" />

        {/* Search */}
        <div className="relative mb-10">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, staff ID or email…"
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
            <p className="text-sm text-muted-foreground tracking-wide">Loading lecturers…</p>
          </div>
        ) : lecturers.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-6 text-center">
            <GraduationCap className="h-10 w-10 text-muted-foreground/40" />
            <div>
              <p className="font-serif text-2xl text-foreground mb-2">No lecturers yet</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Register lecturers so they can be assigned to courses.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-6 py-3 rounded-full hover:bg-foreground/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Lecturer
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-3 text-center">
            <Search className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No lecturers match "{query}"</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map((lecturer) => (
              <div
                key={lecturer.staffId}
                className="group border border-border rounded-lg bg-card/60 p-6 flex flex-col gap-4 hover:border-foreground/25 transition-colors duration-200"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-mono tracking-widest text-muted-foreground border border-border rounded px-2 py-1">
                    {lecturer.staffId}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setToDelete(lecturer)}
                      className="text-muted-foreground/40 hover:text-destructive transition-colors p-1"
                      aria-label="Delete lecturer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Name */}
                <h3 className="font-serif text-xl leading-snug text-foreground">{lecturer.fullName}</h3>

                {/* Email */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{lecturer.email}</span>
                </div>

                {/* Footer */}
                {lecturer.createdAt && (
                  <p className="text-xs text-muted-foreground border-t border-border pt-3 mt-auto">
                    Added {format(new Date(lecturer.createdAt), "MMM d, yyyy")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setStaffId(""); setFullName(""); setEmail(""); } }}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-normal">Add Lecturer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="staffId" className="text-xs tracking-widest uppercase text-muted-foreground">Staff ID</Label>
              <div className="relative">
                <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="staffId"
                  placeholder="e.g. STAFF-001"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="pl-10 bg-background font-mono"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lecturerName" className="text-xs tracking-widest uppercase text-muted-foreground">Full Name</Label>
              <Input
                id="lecturerName"
                placeholder="e.g. Dr. Amaka Obi"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-background"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lecturerEmail" className="text-xs tracking-widest uppercase text-muted-foreground">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="lecturerEmail"
                  type="email"
                  placeholder="a.obi@university.edu.ng"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 bg-background"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} disabled={creating} className="rounded-full text-xs tracking-widest uppercase">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !staffId.trim() || !fullName.trim() || !email.trim()}
              className="rounded-full text-xs tracking-widest uppercase"
            >
              {creating ? "Adding…" : "Add Lecturer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-xl font-normal">Remove lecturer?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              This will permanently remove{" "}
              <strong className="text-foreground">{toDelete?.fullName}</strong> ({toDelete?.staffId}).
              Any courses assigned to this lecturer will remain but will have no lecturer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="border-border text-xs tracking-widest uppercase rounded-full">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground text-xs tracking-widest uppercase rounded-full hover:bg-destructive/90"
            >
              {deleting ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LecturersPage;
