import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AlertCircle, Mail, ShieldCheck, ShieldOff, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { User, UserRole } from "@/types/auth";

const TABS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "lecturer", label: "Lecturers" },
  { value: "student", label: "Students" },
  { value: "admin", label: "Admins" },
  { value: "all", label: "All" },
];

function roleBadgeVariant(role: UserRole): "default" | "secondary" | "destructive" | "outline" {
  if (role === "admin") return "default";
  if (role === "lecturer") return "secondary";
  if (role === "pending") return "outline";
  return "outline";
}

const AdminUsers = () => {
  const [tab, setTab] = useState("pending");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Assign-role dialog
  const [target, setTarget] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>("lecturer");
  const [staffId, setStaffId] = useState("");
  const [fullName, setFullName] = useState("");
  const [assigning, setAssigning] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setError(null);
      const data = await api.auth.listUsers(tab === "all" ? undefined : tab);
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [tab]);

  const openAssignDialog = (user: User) => {
    setTarget(user);
    setRole(user.role === "pending" ? "lecturer" : user.role);
    setStaffId(user.staffId || "");
    setFullName(user.fullName || "");
  };

  const handleAssign = async () => {
    if (!target) return;
    setAssigning(true);
    try {
      await api.auth.assignRole(target.email, {
        role,
        staffId: role === "lecturer" ? staffId.trim() : undefined,
        fullName: fullName.trim() || undefined,
      });
      toast.success("Role updated");
      setTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setAssigning(false);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const next = user.status === "active" ? "suspended" : "active";
    try {
      await api.auth.setUserStatus(user.email, next);
      toast.success(next === "suspended" ? "Account suspended" : "Account reactivated");
      setUsers((prev) => prev.map((u) => (u.email === user.email ? { ...u, status: next } : u)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-6xl mx-auto px-6 pt-28 pb-16">
        <div className="mb-10">
          <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-3">Access Control</p>
          <h1 className="font-serif text-4xl md:text-5xl text-foreground">Users</h1>
        </div>

        <div className="h-px bg-border mb-8" />

        <Tabs value={tab} onValueChange={setTab} className="mb-10">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {error && (
          <Alert variant="destructive" className="mb-8">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex flex-col items-center py-24 gap-4">
            <div className="h-8 w-8 rounded-full border-2 border-border border-t-foreground animate-spin" />
            <p className="text-sm text-muted-foreground tracking-wide">Loading users…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center py-24 gap-4 text-center">
            <Users className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-serif text-2xl text-foreground">No users in this group</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {users.map((u) => (
              <div
                key={u.email}
                className="group border border-border rounded-lg bg-card/60 p-6 flex flex-col gap-4 hover:border-foreground/25 transition-colors duration-200"
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge variant={roleBadgeVariant(u.role)} className="text-xs">{u.role}</Badge>
                  {u.status === "suspended" && (
                    <Badge variant="destructive" className="text-xs">suspended</Badge>
                  )}
                </div>

                <div>
                  <h3 className="font-serif text-lg leading-snug text-foreground truncate">
                    {u.fullName || "—"}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{u.email}</span>
                  </div>
                  {(u.matricNumber || u.staffId) && (
                    <p className="text-xs font-mono text-muted-foreground mt-1">
                      {u.matricNumber || u.staffId}
                    </p>
                  )}
                </div>

                <div className="flex gap-2 mt-auto pt-3 border-t border-border">
                  <button
                    type="button"
                    onClick={() => openAssignDialog(u)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground border border-border rounded-full px-3 py-2 transition-colors"
                  >
                    <UserCog className="h-3.5 w-3.5" />
                    Role
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(u)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground border border-border rounded-full px-3 py-2 transition-colors"
                  >
                    {u.status === "active"
                      ? <><ShieldOff className="h-3.5 w-3.5" />Suspend</>
                      : <><ShieldCheck className="h-3.5 w-3.5" />Reactivate</>
                    }
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign Role Dialog */}
      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-normal">
              Assign Role — {target?.email}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs tracking-widest uppercase text-muted-foreground">Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lecturer">Lecturer</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {role === "lecturer" && (
              <div className="space-y-2">
                <Label htmlFor="staffId" className="text-xs tracking-widest uppercase text-muted-foreground">
                  Staff ID
                </Label>
                <Input
                  id="staffId"
                  placeholder="e.g. STAFF-001"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="bg-background font-mono"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="assignFullName" className="text-xs tracking-widest uppercase text-muted-foreground">
                Full Name
              </Label>
              <Input
                id="assignFullName"
                placeholder="e.g. Dr. Amaka Obi"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-background"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={assigning} className="rounded-full text-xs tracking-widest uppercase">
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={assigning || (role === "lecturer" && !staffId.trim())}
              className="rounded-full text-xs tracking-widest uppercase"
            >
              {assigning ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminUsers;
