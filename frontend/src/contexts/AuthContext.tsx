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
  loginWithToken: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(
    () => !!localStorage.getItem(TOKEN_STORAGE_KEY)
  );

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

  const loginWithToken = (newToken: string, newUser: User) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
    // Stateless JWTs — nothing server-side to revoke, best-effort only.
    api.auth.logout().catch(() => { /* ignore */ });
  };

  const isAdmin = user?.role === "admin";

  return (
    <AuthContext.Provider
      value={{ token, user, loading, isAdmin, loginWithToken, logout, refreshUser }}
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
