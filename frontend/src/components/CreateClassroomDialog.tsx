import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CreateClassroomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    classId: string;
    className: string;
    capacity: number;
    deviceId: string;
  }) => Promise<void>;
}

export default function CreateClassroomDialog({
  open,
  onOpenChange,
  onSubmit,
}: CreateClassroomDialogProps) {
  const [formData, setFormData] = useState({
    classId: '',
    className: '',
    capacity: 50,
    deviceId: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await onSubmit(formData);
      setFormData({
        classId: '',
        className: '',
        capacity: 50,
        deviceId: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Classroom</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="classId">Class ID</Label>
            <Input
              id="classId"
              placeholder="e.g., ELT"
              value={formData.classId}
              onChange={(e) =>
                setFormData({ ...formData, classId: e.target.value })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="className">Class Name</Label>
            <Input
              id="className"
              placeholder="e.g., Enginerring Lecture Theatre"
              value={formData.className}
              onChange={(e) =>
                setFormData({ ...formData, className: e.target.value })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="capacity">Capacity</Label>
            <Input
              id="capacity"
              type="number"
              min="1"
              value={formData.capacity}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  capacity: parseInt(e.target.value) || 1,
                })
              }
              required
            />
          </div>

          <div>
            <Label htmlFor="deviceId">Device ID (IoT Camera)</Label>
            <Input
              id="deviceId"
              placeholder="e.g., dev-00123"
              value={formData.deviceId}
              onChange={(e) =>
                setFormData({ ...formData, deviceId: e.target.value })
              }
              required
            />
          </div>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}