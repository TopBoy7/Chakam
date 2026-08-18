import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Activity, BarChart3, ClipboardList, ArrowRight, LogIn, LogOut } from "lucide-react";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";

/* ── Scroll-reveal hook ─────────────────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("visible"); observer.disconnect(); } },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

/* ── Feature card data ──────────────────────────────────────────────────── */
const features = [
  {
    label: "01",
    title: "Live Occupancy",
    body: "Classroom status updates the instant it changes — IoT sensors push data over WebSocket so the dashboard is always current.",
    to: "/dashboard",
    cta: "Open Dashboard",
    Icon: Activity,
  },
  {
    label: "02",
    title: "Usage Analytics",
    body: "Fill rates, peak hours, and comparative occupancy across every room — all derived from real sensor data, zero guesswork.",
    to: "/analytics",
    cta: "View Analytics",
    Icon: BarChart3,
  },
  {
    label: "03",
    title: "Attendance Tracking",
    body: "When the lecturer is ready, one button triggers an instant snapshot. Every face in the room is matched and marked present in one shot. Export in CSV, DOCX, or PDF.",
    to: "/attendance",
    cta: "Manage Courses",
    Icon: ClipboardList,
  },
];

/* ── Stat items ─────────────────────────────────────────────────────────── */
const stats = [
  { value: "< 5 s", label: "Occupancy update latency" },
  { value: "1 tap", label: "To capture full attendance" },
  { value: "4", label: "Export formats supported" },
  { value: "∞", label: "Classrooms monitored" },
];

/* ======================================================================== */
const Home = () => {
  const { user, logout } = useAuth();

  const heroRef    = useReveal();
  const statsRef   = useReveal();
  const feat1Ref   = useReveal();
  const feat2Ref   = useReveal();
  const feat3Ref   = useReveal();
  const footerRef  = useReveal();
  const featRefs   = [feat1Ref, feat2Ref, feat3Ref];

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <Navigation />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 pt-16 pb-24">
        <div ref={heroRef} className="reveal max-w-3xl mx-auto space-y-8">
          <div className="inline-flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground border border-border rounded-full px-4 py-2">
            <span className="h-1.5 w-1.5 rounded-full bg-accent inline-block" />
            Smart Classroom System
          </div>

          <h1 className="font-serif text-[clamp(3.5rem,10vw,8rem)] leading-[0.95] text-foreground">
            Chakam
          </h1>

          <p className="text-muted-foreground text-lg leading-relaxed max-w-xl mx-auto font-light">
            Occupancy monitoring and instant attendance capture for every
            classroom on campus — powered by IoT cameras and facial recognition.
          </p>

          <div className="rule-gold w-24 mx-auto" />

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link
              to="/dashboard"
              className="group inline-flex items-center gap-2 bg-foreground text-background text-sm tracking-widest uppercase px-8 py-3.5 rounded-full hover:bg-foreground/90 transition-colors duration-200"
            >
              View Dashboard
              <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>

            {user ? (
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground border border-border px-8 py-3.5 rounded-full hover:border-foreground hover:text-foreground transition-colors duration-200"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground border border-border px-8 py-3.5 rounded-full hover:border-foreground hover:text-foreground transition-colors duration-200"
              >
                <LogIn className="h-4 w-4" />
                Log In
              </Link>
            )}
          </div>
        </div>

        {/* Scroll cue */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground/60">
          <span className="text-[10px] tracking-[0.25em] uppercase">Scroll</span>
          <div className="h-8 w-px bg-gradient-to-b from-muted-foreground/40 to-transparent" />
        </div>
      </section>

      {/* ── Stats strip ───────────────────────────────────────────────────── */}
      <section className="border-y border-border py-14 px-6">
        <div ref={statsRef} className="reveal max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-10 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="font-serif text-4xl md:text-5xl text-foreground">{s.value}</p>
              <p className="mt-2 text-xs tracking-widest uppercase text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────────── */}
      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {features.map((f, i) => {
            const Icon = f.Icon;
            return (
              <div
                key={f.label}
                ref={featRefs[i]}
                className={`reveal group border border-border rounded-lg p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-8 hover:border-foreground/30 transition-colors duration-300 bg-card/50 ${["reveal-delay-1","reveal-delay-2","reveal-delay-3"][i]}`}
              >
                {/* Number + icon */}
                <div className="flex-shrink-0 flex flex-col items-start gap-4">
                  <span className="text-xs tracking-[0.2em] text-muted-foreground/60 font-mono">{f.label}</span>
                  <div className="h-12 w-12 rounded-full border border-border flex items-center justify-center group-hover:border-foreground/30 transition-colors">
                    <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1">
                  <h3 className="font-serif text-2xl md:text-3xl text-foreground mb-3">{f.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed max-w-lg">{f.body}</p>
                </div>

                {/* CTA */}
                <Link
                  to={f.to}
                  className="flex-shrink-0 inline-flex items-center gap-2 text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors group/link"
                >
                  {f.cta}
                  <ArrowRight className="h-3.5 w-3.5 group-hover/link:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">How it works</p>
            <h2 className="font-serif text-4xl md:text-6xl text-foreground">From room to report</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-0 border border-border rounded-lg overflow-hidden">
            {[
              { step: "01", title: "Students register", desc: "Each student scans a link shared by their lecturer, enters their matric number, and uploads a passport photo — once, before the semester begins." },
              { step: "02", title: "Lecturer captures", desc: "At the moment the lecturer decides attendance is closed, they tap one button. The camera captures a single snapshot of the entire room." },
              { step: "03", title: "Instant results", desc: "Every face is matched against registered photos in seconds. The dashboard shows who is present, allows manual overrides, and exports clean reports." },
            ].map((item, i) => (
              <div key={item.step} className={`p-8 md:p-10 ${i < 2 ? "border-b md:border-b-0 md:border-r border-border" : ""}`}>
                <p className="text-xs tracking-[0.2em] text-muted-foreground/60 font-mono mb-6">{item.step}</p>
                <h3 className="font-serif text-2xl text-foreground mb-3">{item.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ───────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-t border-border">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          <h2 className="font-serif text-4xl md:text-6xl text-foreground leading-tight">
            One tap.<br />
            <em className="not-italic text-muted-foreground">Every student accounted for.</em>
          </h2>
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 bg-foreground text-background text-sm tracking-widest uppercase px-10 py-4 rounded-full hover:bg-foreground/90 transition-colors duration-200"
          >
            Open Dashboard
            <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer ref={footerRef} className="reveal border-t border-border py-12 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div className="flex items-center gap-2.5">
            <img src="/cam.png" alt="Chakam" className="h-6 w-6 img-foreground" />
            <span className="font-serif text-lg text-foreground">Chakam</span>
          </div>

          <nav className="flex flex-wrap gap-6">
            {[
              { label: "Dashboard", to: "/dashboard" },
              { label: "Attendance", to: "/attendance" },
              { label: "My Attendance", to: "/my-attendance" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-xs tracking-widest uppercase text-muted-foreground hover:text-foreground transition-colors"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Chakam · All rights reserved
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Home;
