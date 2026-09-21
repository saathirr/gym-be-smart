import { BarChart3, Download } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics & Business Reports"
        description="Comprehensive reports on revenue trends, member retention, and attendance distribution."
      >
        <Button variant="secondary" icon={Download}>
          Export PDF / CSV
        </Button>
      </PageHeader>

      <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-gym-800">
        <div className="p-4 rounded-full bg-gym-800/80 text-brand-violet mb-4">
          <BarChart3 className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-semibold text-slate-200">Advanced Analytics Engine</h3>
        <p className="text-sm text-slate-400 max-w-md mt-1">
          This module will provide exportable business reports, revenue forecasting, churn analysis, and attendance metrics in Phase 2.
        </p>
      </Card>
    </div>
  );
}
