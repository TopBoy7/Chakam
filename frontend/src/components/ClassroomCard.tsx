import { ClassroomData } from '@/types/classroom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Users, Clock, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface ClassroomCardProps {
  classroom: ClassroomData;
}

const ClassroomCard = ({ classroom }: ClassroomCardProps) => {
  const isOccupied = classroom.status === 'occupied';
  const minutesAgo = Math.floor(
    (Date.now() - new Date(classroom.lastUpdated).getTime()) / 60000
  );

  return (
    <Link to={`/classroom/${classroom.id}`}>
      <Card
        className={cn(
          'hover:shadow-lg transition-all duration-300 cursor-pointer border-2',
          isOccupied
            ? 'border-warning/20 bg-gradient-to-br from-card to-warning/5'
            : 'border-success/20 bg-gradient-to-br from-card to-success/5'
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <CardTitle className="text-xl font-bold">{classroom.name}</CardTitle>
            <Badge
              variant={isOccupied ? 'destructive' : 'default'}
              className={cn(
                'font-semibold',
                isOccupied
                  ? 'bg-warning text-warning-foreground'
                  : 'bg-success text-success-foreground'
              )}
            >
              {isOccupied ? 'Occupied' : 'Available'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="h-4 w-4" />
            <span>{classroom.building}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            <span>Capacity: {classroom.capacity} students</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4" />
            <span>Motion: {classroom.sensorData.motion === 1 ? 'Detected' : 'None'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>Updated {minutesAgo === 0 ? 'just now' : `${minutesAgo}m ago`}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
};

export default ClassroomCard;
