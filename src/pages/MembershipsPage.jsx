import { CreditCard, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function MembershipsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Active Memberships"
        description="Monitor active subscriptions, renewal dates, and status changes."
      >
        <Button variant="primary" icon={RefreshCw}>
          Renew Subscriptions
        </Button>
      </PageHeader>

      <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800">
        <div className="p-4 rounded-full bg-gym-800/80 text-brand-violet mb-4">
          <CreditCard className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Subscription Lifecycle Engine</h3>
        <p className="text-sm text-slate-400 max-w-md mt-1">
          This module will manage member subscription assignment, renewal workflows, pause/suspension logic, and expiration notifications in Phase 2.
        </p>
      </Card>
    </div>
  );
}
