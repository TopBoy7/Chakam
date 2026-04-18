import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import Navigation from "@/components/Navigation";
import { ArrowRight } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 text-center px-6">
        <p className="font-serif text-[clamp(6rem,20vw,14rem)] leading-none text-foreground/10 select-none">
          404
        </p>
        <div className="-mt-8 space-y-3">
          <h1 className="font-serif text-3xl md:text-4xl text-foreground">Page not found</h1>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            The page at <span className="font-mono">{location.pathname}</span> doesn't exist.
          </p>
        </div>
        <Link
          to="/"
          className="group inline-flex items-center gap-2 bg-foreground text-background text-xs tracking-widest uppercase px-8 py-3.5 rounded-full hover:bg-foreground/90 transition-colors"
        >
          Back to Home
          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
