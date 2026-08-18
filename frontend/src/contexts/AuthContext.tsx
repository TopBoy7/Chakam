import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { api, TOKEN_STORAGE_KEY } from "@/lib/api";
import type { User } from "@/types/auth";

interface AuthContextType {
  token: string | null;
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (password: string) => boolean;
  loginWithToken: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Legacy admin-password path. Auth Phase 4 (real email + one-time-code login
// for every role, including admin via ADMIN_EMAILS) is otherwise complete —
// this is kept ONLY as the developer's own temporary testing fallback until
// the mailer service is confirmed delivering login codes. Remove before
// final submission: delete this block, the VITE_ADMIN_PASSWORD env var, and
// the bypass in ProtectedRoute.tsx.
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || "password";
const LEGACY_AUTH_STORAGE_KEY = "chakam_admin_auth";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [legacyAdmin, setLegacyAdmin] = useState<boolean>(
    () => localStorage.getItem(LEGACY_AUTH_STORAGE_KEY) === "true"
  );
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(
    () => !!localStorage.getItem(TOKEN_STORAGE_KEY)
  );

  useEffect(() => {
    localStorage.setItem(LEGACY_AUTH_STORAGE_KEY, legacyAdmin ? "true" : "false");
  }, [legacyAdmin]);

  // Never trust a cached user object — always rehydrate from the server.
  const refreshUser = async () => {
    if (!localStorage.getItem(TOKEN_STORAGE_KEY)) {
      setUser(null);
      return;
    }
    try {
      const me = await api.auth.getMe();
      setUser(me);
    } catch {
      // Invalid/expired/suspended — throwOnError already cleared the token on 401.
      setUser(null);
      setToken(null);
    }
  };

  useEffect(() => {
    (async () => {
      await refreshUser();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = (password: string): boolean => {
    if (password === ADMIN_PASSWORD) {
      setLegacyAdmin(true);
      return true;
    }
    return false;
  };

  const loginWithToken = (newToken: string, newUser: User) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    setLegacyAdmin(false);
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
    // Stateless JWTs — nothing server-side to revoke, best-effort only.
    api.auth.logout().catch(() => { /* ignore */ });
  };

  const isAdmin = legacyAdmin || user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{ token, user, loading, isAdmin, login, loginWithToken, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
