import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Activity, TrendingUp, Zap, Shield, LogIn, LogOut } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/contexts/AuthContext";

const Home = () => {
  const { isAdmin, login, logout } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (login(password)) {
      setError("");
      setPassword("");
      setDialogOpen(false);
      navigate("/dashboard");
    } else {
      setError("Invalid password");
    }
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-primary/5 to-background overflow-x-hidden">
      <Navigation />

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <div className="mb-6">
            <img src="/cam.png" alt="Chakam" className="h-16 w-16 mx-auto" />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Chakam
          </h1>
          <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
            Real-time monitoring and intelligent analytics for efficient
            classroom management. Track occupancy, analyze patterns, and
            optimize space utilization across campus.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
            <Link to="/dashboard" className="w-full sm:w-auto">
              <Button size="lg" className="text-base w-full sm:w-auto">
                <Activity className="h-5 w-5 mr-2" />
                View Dashboard
              </Button>
            </Link>
            <Link to="/analytics" className="w-full sm:w-auto">
              <Button
                size="lg"
                variant="outline"
                className="text-base w-full sm:w-auto"
              >
                <TrendingUp className="h-5 w-5 mr-2" />
                View Analytics
              </Button>
            </Link>
            {isAdmin ? (
              <Button
                size="lg"
                variant="destructive"
                className="text-base w-full sm:w-auto"
                onClick={handleLogout}
              >
                <LogOut className="h-5 w-5 mr-2" />
                Logout
              </Button>
            ) : (
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="lg"
                    variant="secondary"
                    className="text-base w-full sm:w-auto"
                  >
                    <LogIn className="h-5 w-5 mr-2" />
                    Admin Login
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Admin Login</DialogTitle>
                    <DialogDescription>
                      Enter the admin password to manage classrooms.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        placeholder="Enter admin password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setError("");
                        }}
                      />
                      {error && (
                        <p className="text-sm text-destructive">{error}</p>
                      )}
                    </div>
                    <Button type="submit" className="w-full">
                      Login
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          System Features
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="border-2 hover:border-primary/50 transition-all duration-300">
            <CardContent className="pt-6">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                <Activity className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-bold text-lg mb-2">Real-Time Monitoring</h3>
              <p className="text-muted-foreground text-sm">
                Live classroom status updates using IoT sensors and wireless
                communication.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 hover:border-primary/50 transition-all duration-300">
            <CardContent className="pt-6">
              <div className="h-12 w-12 rounded-lg bg-success/10 flex items-center justify-center mb-4">
                <TrendingUp className="h-6 w-6 text-success" />
              </div>
              <h3 className="font-bold text-lg mb-2">AI Analytics</h3>
              <p className="text-muted-foreground text-sm">
                Predictive analytics and pattern recognition for optimal space
                planning.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 hover:border-primary/50 transition-all duration-300">
            <CardContent className="pt-6">
              <div className="h-12 w-12 rounded-lg bg-warning/10 flex items-center justify-center mb-4">
                <Zap className="h-6 w-6 text-warning" />
              </div>
              <h3 className="font-bold text-lg mb-2">Instant Updates</h3>
              <p className="text-muted-foreground text-sm">
                Receive immediate notifications about classroom availability
                changes.
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 hover:border-primary/50 transition-all duration-300">
            <CardContent className="pt-6">
              <div className="h-12 w-12 rounded-lg bg-accent/10 flex items-center justify-center mb-4">
                <Shield className="h-6 w-6 text-accent" />
              </div>
              <h3 className="font-bold text-lg mb-2">Reliable System</h3>
              <p className="text-muted-foreground text-sm">
                ESP32 microcontroller with camera for accurate detection.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Technical Overview */}

      {/* Footer */}
      <footer className="bg-muted/50 py-12 px-4">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <div className="flex items-center space-x-2 mb-4">
              <img src="/cam.png" className="h-10 w-10" alt="Chakam Logo" />
              <span className="text-foreground font-semibold">Chakam</span>
            </div>
            <p className="text-muted-foreground text-sm max-w-sm">
              Intelligent classroom monitoring and analytics platform for
              efficient space utilization.
            </p>
            <div className="flex space-x-3 mt-4">
              <a
                href="#twitter"
                className="text-muted-foreground hover:text-foreground transition"
              >
                𝕏
              </a>
              <a
                href="#facebook"
                className="text-muted-foreground hover:text-foreground transition"
              >
                f
              </a>
              <a
                href="#linkedin"
                className="text-muted-foreground hover:text-foreground transition"
              >
                in
              </a>
            </div>
          </div>

          <div>
            <h6 className="text-foreground font-semibold mb-4">Quick Links</h6>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  to="/dashboard"
                  className="hover:text-foreground transition"
                >
                  Dashboard
                </Link>
              </li>
              <li>
                <Link
                  to="/analytics"
                  className="hover:text-foreground transition"
                >
                  Analytics
                </Link>
              </li>
              <li>
                <a href="#about" className="hover:text-foreground transition">
                  About
                </a>
              </li>
              <li>
                <a href="#contact" className="hover:text-foreground transition">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h6 className="text-foreground font-semibold mb-4">Resources</h6>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#privacy" className="hover:text-foreground transition">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#terms" className="hover:text-foreground transition">
                  Terms of Use
                </a>
              </li>
              <li>
                <a
                  href="#documentation"
                  className="hover:text-foreground transition"
                >
                  Documentation
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-foreground transition">
                  FAQ
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h6 className="text-foreground font-semibold mb-4">Contact Info</h6>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li>Email: info@chakam.com</li>
              <li>Phone: +1 (555) 123-4567</li>
              <li>Support: chakam_support@chakam.com</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border mt-8 pt-8 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Chakam. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default Home;
