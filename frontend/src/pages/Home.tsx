import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, TrendingUp, Zap, Shield } from "lucide-react";
import { Link } from "react-router-dom";
import Navigation from "@/components/Navigation";

const Home = () => {
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-primary/5 to-background overflow-x-hidden">
      <Navigation />

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full mb-6">
            <Activity className="h-4 w-4" />
            <span className="text-sm font-medium">University of Lagos</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Chakam
          </h1>
          <p className="text-xl text-muted-foreground mb-8 leading-relaxed">
            Real-time monitoring and intelligent analytics for efficient
            classroom management. Track occupancy, analyze patterns, and
            optimize space utilization across campus.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
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
      <footer className="border-t border-border mt-20">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-muted-foreground">
            <p className="mb-2">
              Smart Classroom Occupancy Detection and Monitoring System
            </p>
            <p className="text-sm">
              Department of Computer Engineering • University of Lagos
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Home;
