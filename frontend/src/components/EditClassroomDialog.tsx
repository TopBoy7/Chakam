import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import type { Classroom, UpdateClassroomRequest } from '@/types/classroom';

interface EditClassroomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classroom: Classroom | null;
  onSubmit: (classId: string, data: UpdateClassroomRequest) => Promise<void>;
}

export default function EditClassroomDialog({ open, onOpenChange, classroom, onSubmit }: EditClassroomDialogProps) {
  const [formData, setFormData] = useState({ classId: '', className: '', capacity: 1, deviceId: '', latestImage: '', occupancy: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (open && classroom) {
      setFormData({
        classId:     classroom.classId     || '',
        className:   classroom.className   || '',
        capacity:    classroom.capacity    || 1,
        deviceId:    classroom.deviceId    || '',
        latestImage: classroom.latestImage || '',
        occupancy:   classroom.occupancy   || 0,
      });
      setError(null);
    }
  }, [open, classroom]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.classId.trim())  { setError('Class ID is required');  return; }
    if (!formData.className.trim()){ setError('Class name is required'); return; }
    if (formData.capacity < 1)     { setError('Capacity must be ≥ 1');   return; }
    if (!formData.deviceId.trim()) { setError('Device ID is required');  return; }

    setLoading(true);
    try {
      await onSubmit(classroom!.classId, formData as UpdateClassroomRequest);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update classroom');
    } finally {
      setLoading(false);
    }
  };

  if (!classroom) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg bg-card">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal">Edit Classroom</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Update classroom details. The camera image is managed by the device.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="edit-classId" className="text-xs tracking-widest uppercase text-muted-foreground">
              Class ID
            </Label>
            <Input id="edit-classId" value={formData.classId}
              onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
              disabled={loading} className="bg-background" />
            <p className="text-xs text-muted-foreground">Unique identifier used in URLs</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-className" className="text-xs tracking-widest uppercase text-muted-foreground">
              Class Name
            </Label>
            <Input id="edit-className" value={formData.className}
              onChange={(e) => setFormData({ ...formData, className: e.target.value })}
              disabled={loading} className="bg-background" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-capacity" className="text-xs tracking-widest uppercase text-muted-foreground">
                Capacity
              </Label>
              <Input id="edit-capacity" type="number" min="1" max="500" value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 1 })}
                disabled={loading} className="bg-background" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-deviceId" className="text-xs tracking-widest uppercase text-muted-foreground">
                Device ID
              </Label>
              <Input id="edit-deviceId" value={formData.deviceId}
                onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
                disabled={loading} className="bg-background" />
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={() => onOpenChange(false)} disabled={loading}
              className="border border-border text-xs tracking-widest uppercase px-5 py-2.5 rounded-full text-muted-foreground hover:text-foreground hover:border-foreground transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="bg-foreground text-background text-xs tracking-widest uppercase px-5 py-2.5 rounded-full hover:bg-foreground/90 transition-colors disabled:opacity-40">
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
