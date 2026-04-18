import { useEffect, useState, useCallback } from "react";
import Navigation from "@/components/Navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Users,
  Building2,
  TrendingUp,
  Percent,
  AlertCircle,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useClassroomWebSocket } from "@/hooks/useClassroomWebSocket";
import type { Classroom, WebSocketMessage } from "@/types/classroom";

function fillRate(c: Classroom) {
  return c.capacity > 0 ? Math.round((c.occupancy / c.capacity) * 100) : 0;
}

function statusInfo(rate: number): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  dot: string;
} {
  if (rate === 0) return { label: "Empty", variant: "secondary", dot: "bg-muted-foreground/40" };
  if (rate < 50) return { label: "Low", variant: "outline", dot: "bg-success" };
  if (rate < 80) return { label: "Moderate", variant: "default", dot: "bg-warning" };
  return { label: "High", variant: "destructive", dot: "bg-destructive" };
}

function barColor(rate: number) {
  if (rate === 0) return "hsl(var(--muted-foreground) / 0.3)";
  if (rate < 50) return "hsl(var(--success))";
  if (rate < 80) return "hsl(var(--warning))";
  return "hsl(var(--destructive))";
}

const Analytics = () => {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await api.classrooms.list();
        setClassrooms(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load classrooms");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleWSMessage = useCallback((message: WebSocketMessage) => {
    const incoming = message.classroom;
    setClassrooms((prev) => {
      const idx = prev.findIndex(
        (c) => c.id === incoming.id || c.classId === incoming.classId
      );
      if (idx !== -1) {
        const copy = [...prev];
        copy[idx] = incoming;
        return copy;
      }
      return [incoming, ...prev];
    });
  }, []);

  useClassroomWebSocket(handleWSMessage);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const totalCapacity = classrooms.reduce((sum, c) => sum + c.capacity, 0);
  const totalOccupied = classrooms.reduce((sum, c) => sum + c.occupancy, 0);
  const totalAvailable = totalCapacity - totalOccupied;
  const overallRate =
    totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

  const statusCounts = {
    empty: classrooms.filter((c) => c.occupancy === 0).length,
    low: classrooms.filter((c) => { const r = fillRate(c); return r > 0 && r < 50; }).length,
    moderate: classrooms.filter((c) => { const r = fillRate(c); return r >= 50 && r < 80; }).length,
    high: classrooms.filter((c) => fillRate(c) >= 80).length,
  };

  const chartData = [...classrooms]
    .sort((a, b) => fillRate(b) - fillRate(a))
    .map((c) => ({
      name:
        c.className.length > 14 ? c.className.slice(0, 13) + "…" : c.className,
      fullName: c.className,
      classId: c.classId,
      occupancy: c.occupancy,
      capacity: c.capacity,
      rate: fillRate(c),
    }));

  const sortedByRate = [...classrooms].sort((a, b) => fillRate(b) - fillRate(a));
  const mostOccupied = sortedByRate[0] ?? null;
  const leastOccupied = sortedByRate[sortedByRate.length - 1] ?? null;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading analytics...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-1">Analytics</h1>
          <p className="text-muted-foreground">
            Live occupancy overview — updates automatically
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {classrooms.length === 0 ? (
          <div className="text-center py-24">
            <Building2 className="h-14 w-14 text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="text-xl font-semibold mb-2">No classrooms yet</p>
            <p className="text-muted-foreground">
              Add classrooms in the Dashboard to see analytics here.
            </p>
          </div>
        ) : (
          <>
            {/* ── Top stats ──────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <Building2 className="h-3.5 w-3.5" />
                    Classrooms
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{classrooms.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {statusCounts.empty} empty ·{" "}
                    {classrooms.length - statusCounts.empty} in use
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <Users className="h-3.5 w-3.5" />
                    Occupants
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{totalOccupied}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    of {totalCapacity} total seats
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <Percent className="h-3.5 w-3.5" />
                    Fill Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{overallRate}%</p>
                  <Progress value={overallRate} className="mt-2 h-1.5" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Available
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">{totalAvailable}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    seats free right now
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ── Status breakdown + bar chart ───────────────────────────────── */}
            <div className="grid lg:grid-cols-3 gap-6 mb-6">
              {/* Status breakdown */}
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Status Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {[
                      { label: "Empty (0%)", count: statusCounts.empty, dot: "bg-muted-foreground/40" },
                      { label: "Low (1–49%)", count: statusCounts.low, dot: "bg-success" },
                      { label: "Moderate (50–79%)", count: statusCounts.moderate, dot: "bg-warning" },
                      { label: "High (≥80%)", count: statusCounts.high, dot: "bg-destructive" },
                    ].map(({ label, count, dot }) => (
                      <div key={label} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />
                            {label}
                          </span>
                          <span className="font-semibold tabular-nums">{count}</span>
                        </div>
                        {classrooms.length > 0 && (
                          <Progress
                            value={(count / classrooms.length) * 100}
                            className="h-1"
                          />
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Spotlight cards */}
                {mostOccupied && leastOccupied && mostOccupied.id !== leastOccupied.id && (
                  <div className="space-y-3">
                    <Card className="border-destructive/30 bg-destructive/5">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-muted-foreground mb-0.5 flex items-center gap-1">
                              <ArrowUpRight className="h-3 w-3 text-destructive" />
                              Most occupied
                            </p>
                            <p className="font-semibold text-sm truncate">{mostOccupied.className}</p>
                            <p className="text-xs text-muted-foreground font-mono">{mostOccupied.classId}</p>
                          </div>
                          <p className="text-2xl font-bold text-destructive flex-shrink-0">
                            {fillRate(mostOccupied)}%
                          </p>
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-success/30 bg-success/5">
                      <CardContent className="py-3 px-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-muted-foreground mb-0.5 flex items-center gap-1">
                              <ArrowDownRight className="h-3 w-3 text-success" />
                              Least occupied
                            </p>
                            <p className="font-semibold text-sm truncate">{leastOccupied.className}</p>
                            <p className="text-xs text-muted-foreground font-mono">{leastOccupied.classId}</p>
                          </div>
                          <p className="text-2xl font-bold text-success flex-shrink-0">
                            {fillRate(leastOccupied)}%
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>

              {/* Bar chart */}
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Occupancy by Classroom</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        formatter={(value, _name, props) => [
                          `${value}%  (${props.payload.occupancy} / ${props.payload.capacity})`,
                          "Occupancy",
                        ]}
                        labelFormatter={(_label, payload) =>
                          payload?.[0]?.payload?.fullName ?? _label
                        }
                      />
                      <Bar dataKey="rate" radius={[5, 5, 0, 0]} maxBarSize={52}>
                        {chartData.map((entry, index) => (
                          <Cell key={index} fill={barColor(entry.rate)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-3 justify-center flex-wrap">
                    {[
                      { color: "bg-success", label: "Low (<50%)" },
                      { color: "bg-warning", label: "Moderate (50–79%)" },
                      { color: "bg-destructive", label: "High (≥80%)" },
                    ].map(({ color, label }) => (
                      <span key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={`h-2 w-2 rounded-full ${color}`} />
                        {label}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Full classroom table ────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">All Classrooms</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-5 py-3 font-medium text-muted-foreground">
                          Classroom
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                          Occupied
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                          Capacity
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                          Free
                        </th>
                        <th className="px-4 py-3 font-medium text-muted-foreground w-36">
                          Fill rate
                        </th>
                        <th className="text-center px-5 py-3 font-medium text-muted-foreground">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sortedByRate.map((c) => {
                        const rate = fillRate(c);
                        const { label, variant } = statusInfo(rate);
                        return (
                          <tr
                            key={c.id}
                            className="hover:bg-muted/30 transition-colors"
                          >
                            <td className="px-5 py-3">
                              <p className="font-medium">{c.className}</p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {c.classId}
                              </p>
                            </td>
                            <td className="text-right px-4 py-3 tabular-nums font-semibold">
                              {c.occupancy}
                            </td>
                            <td className="text-right px-4 py-3 tabular-nums text-muted-foreground">
                              {c.capacity}
                            </td>
                            <td className="text-right px-4 py-3 tabular-nums text-muted-foreground">
                              {c.capacity - c.occupancy}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Progress
                                  value={rate}
                                  className="flex-1 h-1.5 min-w-[60px]"
                                />
                                <span className="tabular-nums text-xs w-9 text-right">
                                  {rate}%
                                </span>
                              </div>
                            </td>
                            <td className="text-center px-5 py-3">
                              <Badge variant={variant} className="text-xs">
                                {label}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
};

export default Analytics;
