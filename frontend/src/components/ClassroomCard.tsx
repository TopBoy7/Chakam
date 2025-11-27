import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ChevronRight, Users } from 'lucide-react';
import type { Classroom } from '@/types/classroom';
import { cn } from '@/lib/utils';

interface ClassroomCardProps {
  classroom: Classroom;
}

export default function ClassroomCard({ classroom }: ClassroomCardProps) {
  const occupancyPercent = (classroom.occupancy / classroom.capacity) * 100;
  const status =
    occupancyPercent > 80 ? 'high' : occupancyPercent > 40 ? 'medium' : 'low';
  const statusLabel = status === 'high' ? 'High' : status === 'medium' ? 'Medium' : 'Low';
  const statusColor =
    status === 'high'
      ? 'bg-red-100 text-red-800'
      : status === 'medium'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-green-100 text-green-800';

  return (
    <Link to={`/classroom/${classroom.classId}`}>
      <Card className="border-2 hover:border-primary/50 hover:shadow-lg transition-all duration-300 cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg line-clamp-1">
                {classroom.className}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {classroom.classId}
              </p>
            </div>
            <Badge className={cn('ml-2', statusColor)}>
              {statusLabel}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Image Preview */}
          {classroom.latestImage && (
            <div className="w-full h-32 rounded-lg overflow-hidden bg-muted">
              <img
                src={classroom.latestImage}
                alt={classroom.className}
                className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
              />
            </div>
          )}

          {/* Occupancy */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Occupancy</span>
              </div>
              <span className="text-sm font-bold">
                {classroom.occupancy}/{classroom.capacity}
              </span>
            </div>
            <Progress value={occupancyPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {occupancyPercent.toFixed(0)}% full
            </p>
          </div>

          {/* Device ID */}
          <div className="text-xs text-muted-foreground">
            Device: <span className="font-mono">{classroom.deviceId}</span>
          </div>

          {/* View Button */}
          <Button variant="outline" className="w-full group">
            View Details
            <ChevronRight className="h-4 w-4 ml-2 group-hover:translate-x-1 transition-transform" />
          </Button>
        </CardContent>
      </Card>
    </Link>
  );
}
