import { useNavigate } from "react-router-dom";
import { Clock3, LogOut } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";

const PendingApproval = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="max-w-md mx-auto px-6 pt-32 pb-20 text-center">
        <div className="h-14 w-14 rounded-full border border-border flex items-center justify-center mx-auto mb-8">
          <Clock3 className="h-6 w-6 text-muted-foreground" />
        </div>

        <p className="text-xs tracking-widest uppercase text-muted-foreground mb-3">Pending Approval</p>
        <h1 className="font-serif text-4xl leading-tight mb-4">Awaiting Access</h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Your staff address was verified, but an administrator hasn't assigned
          you a role yet. Share the address below with an administrator to
          request access.
        </p>

        {user?.email && (
          <div className="border border-border rounded-full px-6 py-3 mb-10 inline-block">
            <span className="font-mono text-sm text-foreground">{user.email}</span>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground border border-border px-8 py-3.5 rounded-full hover:border-foreground hover:text-foreground transition-colors duration-200"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </main>
    </div>
  );
};

export default PendingApproval;
