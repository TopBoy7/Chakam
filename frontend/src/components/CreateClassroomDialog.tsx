import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

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

export default function CreateClassroomDialog({ open, onOpenChange, onSubmit }: CreateClassroomDialogProps) {
  const [formData, setFormData] = useState({ classId: '', className: '', capacity: 50, deviceId: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => setFormData({ classId: '', className: '', capacity: 50, deviceId: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit(formData);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { reset(); setError(null); } }}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl font-normal">Add New Classroom</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="classId" className="text-xs tracking-widest uppercase text-muted-foreground">
              Class ID
            </Label>
            <Input id="classId" placeholder="e.g. ELT" value={formData.classId}
              onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
              className="bg-background" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="className" className="text-xs tracking-widest uppercase text-muted-foreground">
              Class Name
            </Label>
            <Input id="className" placeholder="e.g. Engineering Lecture Theatre" value={formData.className}
              onChange={(e) => setFormData({ ...formData, className: e.target.value })}
              className="bg-background" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="capacity" className="text-xs tracking-widest uppercase text-muted-foreground">
              Capacity
            </Label>
            <Input id="capacity" type="number" min="1" value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) || 1 })}
              className="bg-background" required />
          </div>

          <div className="space-y-2">
            {/* BACKEND NOTE: deviceId is the unique identifier of the ESP32-CAM unit
                mounted in this classroom. It is used to:
                  1. Route WebSocket occupancy updates to the correct classroom record.
                  2. Signal the correct camera when starting an attendance session.
                The format is defined by the firmware — e.g. "CAM_001" or "dev-00123". */}
            <Label htmlFor="deviceId" className="text-xs tracking-widest uppercase text-muted-foreground">
              Device ID (IoT Camera)
            </Label>
            <Input id="deviceId" placeholder="e.g. CAM_001" value={formData.deviceId}
              onChange={(e) => setFormData({ ...formData, deviceId: e.target.value })}
              className="bg-background" required />
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
              {loading ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
