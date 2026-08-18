import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { UserRole } from "@/types/auth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
}

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  // Wait for the /auth/me rehydration to resolve before deciding — otherwise
  // a logged-in user briefly flashes a redirect while the token is verified.
  if (loading) {
    return null;
  }

  // Legacy password login — developer's own temporary testing fallback
  // until the mailer is confirmed working (see AuthContext.tsx). Remove
  // this block together with that one.
  if (isAdmin && allowedRoles.includes("admin")) {
    return <>{children}</>;
  }

  if (!user) {
    const destination = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(destination)}`} replace />;
  }

  if (user.role === "pending") {
    return <Navigate to="/pending-approval" replace />;
  }

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
