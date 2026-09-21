import { Settings, Save } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="System Settings"
        description="Facility profile details, operational hours, security preferences, and Supabase database status."
      >
        <Button variant="primary" icon={Save}>
          Save Settings
        </Button>
      </PageHeader>

      <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800">
        <div className="p-4 rounded-full bg-gym-800/80 text-brand-cyan mb-4">
          <Settings className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Facility Configuration Center</h3>
        <p className="text-sm text-slate-400 max-w-md mt-1">
          This module will configure gym profile details, branch locations, notification webhooks, and database backups in Phase 2.
        </p>
      </Card>
    </div>
  );
}
