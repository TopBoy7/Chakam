import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  InputOTP, InputOTPGroup, InputOTPSlot,
} from "@/components/ui/input-otp";
import { AlertCircle, Mail, ArrowLeft } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import type { User } from "@/types/auth";

const RESEND_COOLDOWN_SECONDS = 60;

type Step = "email" | "code" | "name";

const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pendingUser, setPendingUser] = useState<{ token: string; user: User } | null>(null);
  const sessionExpired = searchParams.get("reason") === "session_expired";

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const redirectAfterAuth = (user: User) => {
    const redirect = searchParams.get("redirect");
    if (redirect) {
      navigate(redirect, { replace: true });
      return;
    }
    if (user.role === "pending") {
      navigate("/pending-approval", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api.auth.requestCode(email.trim());
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a login code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    setError(null);
    try {
      await api.auth.requestCode(email.trim());
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the code.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (submittedCode: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.auth.verifyCode(email.trim(), submittedCode);
      loginWithToken(result.token, result.user);
      if (!result.user.fullName) {
        setPendingUser(result);
        setStep("name");
      } else {
        redirectAfterAuth(result.user);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !pendingUser) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.auth.updateMe(fullName.trim());
      redirectAfterAuth(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your name.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="max-w-md mx-auto px-6 pt-32 pb-20">
        <div className="mb-10">
          <p className="text-xs tracking-widest uppercase text-muted-foreground mb-3">
            {step === "email" && "Sign In"}
            {step === "code" && "Verify"}
            {step === "name" && "One Last Thing"}
          </p>
          <h1 className="font-serif text-4xl md:text-5xl leading-tight mb-4">
            {step === "email" && "Log In"}
            {step === "code" && "Enter Your Code"}
            {step === "name" && "What's Your Name?"}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {step === "email" && "Use your UNILAG email address — student or staff. We'll send a one-time code to sign you in."}
            {step === "code" && <>Code sent to <span className="text-foreground font-medium">{email}</span>. Enter it below.</>}
            {step === "name" && "This is the first time we've seen this address — tell us your full name."}
          </p>
        </div>

        {sessionExpired && step === "email" && (
          <Alert className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Your session expired before that finished. Verify again and you'll be brought
              straight back to continue — nothing you entered on the previous page was saved,
              so you'll need to redo any form you were filling in.
            </AlertDescription>
          </Alert>
        )}

        {step === "email" && (
          <form onSubmit={handleRequestCode} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs tracking-widest uppercase text-muted-foreground">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="190403014@live.unilag.edu.ng"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(null); }}
                  className="pl-10 bg-background"
                  required
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-foreground text-background text-sm tracking-widest uppercase py-3 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-40"
            >
              {loading ? "Sending…" : "Send Code"}
            </button>
          </form>
        )}

        {step === "code" && (
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setError(null); }}
              className="inline-flex items-center gap-1.5 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Change address
            </button>

            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setError(null);
                  if (value.length === 6) handleVerify(value);
                }}
                disabled={loading}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="text-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0 || loading}
                className="text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:text-muted-foreground"
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend Code"}
              </button>
            </div>
          </div>
        )}

        {step === "name" && (
          <form onSubmit={handleNameSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-xs tracking-widest uppercase text-muted-foreground">
                Full Name
              </Label>
              <Input
                id="fullName"
                placeholder="e.g. Ada Obi"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-background"
                required
                autoFocus
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <button
              type="submit"
              disabled={loading || !fullName.trim()}
              className="w-full bg-foreground text-background text-sm tracking-widest uppercase py-3 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-40"
            >
              {loading ? "Saving…" : "Continue"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
};

export default Login;
