import { Users, Plus } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function MembersPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Members Management"
        description="View, register, search, and manage gym member directory."
      >
        <Button variant="primary" icon={Plus}>
          Add New Member
        </Button>
      </PageHeader>

      <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800">
        <div className="p-4 rounded-full bg-gym-800/80 text-brand-cyan mb-4">
          <Users className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Member Directory Engine</h3>
        <p className="text-sm text-slate-400 max-w-md mt-1">
          This module will provide complete member registration, profile customization, unique QR code generation, and membership status tracking in Phase 2.
        </p>
      </Card>
    </div>
  );
}
