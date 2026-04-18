import { Link } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';
import { Users, ArrowRight } from 'lucide-react';
import type { Classroom } from '@/types/classroom';

interface ClassroomCardProps {
  classroom: Classroom;
}

function occupancyLabel(pct: number): string {
  if (pct === 0) return 'Empty';
  if (pct < 50)  return 'Low';
  if (pct < 80)  return 'Moderate';
  return 'High';
}

// Status colour uses design tokens — never hardcoded Tailwind colour classes.
// text-success / text-warning / text-destructive resolve through CSS variables
// so they automatically respect the current theme.
function statusClass(pct: number): string {
  if (pct === 0) return 'text-muted-foreground';
  if (pct < 50)  return 'text-success';
  if (pct < 80)  return 'text-warning';
  return 'text-destructive';
}

export default function ClassroomCard({ classroom }: ClassroomCardProps) {
  const pct = classroom.capacity > 0
    ? Math.round((classroom.occupancy / classroom.capacity) * 100)
    : 0;

  return (
    <Link to={`/classroom/${classroom.classId}`} className="block group">
      <div className="border border-border rounded-lg bg-card/60 p-6 flex flex-col gap-5 hover:border-foreground/25 transition-colors duration-200 h-full">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-serif text-xl leading-snug text-foreground truncate">
              {classroom.className}
            </h3>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              {classroom.classId}
            </p>
          </div>
          <span className={`text-xs font-medium tracking-wide flex-shrink-0 ${statusClass(pct)}`}>
            {occupancyLabel(pct)}
          </span>
        </div>

        {/* Latest camera image */}
        {classroom.latestImage && (
          <div className="w-full h-32 rounded-md overflow-hidden bg-muted border border-border">
            <img
              src={classroom.latestImage}
              alt={classroom.className}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            />
          </div>
        )}

        {/* Occupancy */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Occupancy
            </span>
            <span className="font-mono tabular-nums">
              {classroom.occupancy} / {classroom.capacity}
            </span>
          </div>
          <Progress value={pct} className="h-1.5" />
        </div>

        {/* Device */}
        <p className="text-xs text-muted-foreground">
          Device: <span className="font-mono">{classroom.deviceId}</span>
        </p>

        {/* CTA */}
        <div className="flex items-center gap-1.5 text-xs tracking-widest uppercase text-muted-foreground group-hover:text-foreground transition-colors mt-auto">
          View Details
          <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
        </div>
      </div>
    </Link>
  );
}
