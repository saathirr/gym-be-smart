import { CalendarCheck, QrCode } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function AttendancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Records"
        description="Daily check-in activity, historical attendance logs, and manual entries."
      >
        <Button variant="emerald" icon={QrCode}>
          Check-in Scanner
        </Button>
      </PageHeader>

      <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800">
        <div className="p-4 rounded-full bg-gym-800/80 text-brand-emerald mb-4">
          <CalendarCheck className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Attendance Audit System</h3>
        <p className="text-sm text-slate-400 max-w-md mt-1">
          This module will track live member check-ins, time stamps, peak facility occupancy, and attendance history in Phase 2.
        </p>
      </Card>
    </div>
  );
}
