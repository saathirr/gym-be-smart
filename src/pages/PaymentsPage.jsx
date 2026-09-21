import { CircleDollarSign, Plus } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function PaymentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Transactions"
        description="Audit cash, card, and digital payment transactions and issue receipts."
      >
        <Button variant="emerald" icon={Plus}>
          Record Transaction
        </Button>
      </PageHeader>

      <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800">
        <div className="p-4 rounded-full bg-gym-800/80 text-brand-emerald mb-4">
          <CircleDollarSign className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Financial Transaction Audit</h3>
        <p className="text-sm text-slate-400 max-w-md mt-1">
          This module will record transactions, filter payment methods (Cash, Card, UPI), and generate invoice receipts in Phase 2.
        </p>
      </Card>
    </div>
  );
}
