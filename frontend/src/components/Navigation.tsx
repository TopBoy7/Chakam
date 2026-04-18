import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

const Navigation = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => setIsOpen(false), [location.pathname]);

  const links = [
    { to: "/", label: "Home" },
    { to: "/dashboard", label: "Dashboard" },
    { to: "/analytics", label: "Analytics" },
    { to: "/attendance", label: "Attendance" },
  ];

  const isActive = (to: string) => {
    if (to === "/attendance")
      return location.pathname === "/attendance" || location.pathname.startsWith("/attendance/");
    return location.pathname === to;
  };

  return (
    <nav
      className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled ? "nav-scrolled" : "bg-transparent"
      )}
    >
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between">

          {/* Left — nav links (desktop) */}
          <div className="hidden md:flex items-center gap-8">
            {links.slice(0, 2).map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "text-xs tracking-widest uppercase transition-colors duration-200",
                  isActive(link.to)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Center — wordmark */}
          <Link
            to="/"
            className="flex items-center gap-2.5 absolute left-1/2 -translate-x-1/2"
          >
            <img src="/cam.png" alt="Chakam" className="h-6 w-6 img-foreground" />
            <span className="font-serif text-xl tracking-wide text-foreground">
              Chakam
            </span>
          </Link>

          {/* Right — nav links (desktop) */}
          <div className="hidden md:flex items-center gap-8">
            {links.slice(2).map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "text-xs tracking-widest uppercase transition-colors duration-200",
                  isActive(link.to)
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Mobile burger */}
          <button
            type="button"
            className="md:hidden ml-auto text-foreground"
            onClick={() => setIsOpen(!isOpen)}
            aria-label="Toggle menu"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Divider line */}
        <div className={cn(
          "h-px transition-opacity duration-300",
          scrolled ? "opacity-0" : "bg-border opacity-60"
        )} />
      </div>

      {/* Mobile drawer */}
      {isOpen && (
        <div className="md:hidden bg-background/95 backdrop-blur border-t border-border">
          <div className="px-6 py-6 flex flex-col gap-5">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "text-sm tracking-widest uppercase transition-colors",
                  isActive(link.to)
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navigation;
