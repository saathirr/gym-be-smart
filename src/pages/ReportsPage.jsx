import { useState } from 'react';
import { Download, Calendar, TrendingUp, Users } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function ReportsPage() {
  const [downloading, setDownloading] = useState(false);

  const handleExportCSV = () => {
    setDownloading(true);
    setTimeout(() => {
      const csvContent = "data:text/csv;charset=utf-8,Date,Active Members,Daily Attendance,Monthly Revenue\n2026-09-01,450,160,18500\n2026-09-15,482,174,19450";
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "Be_Smart_Gym_Report_2026.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloading(false);
    }, 600);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics & Business Reports"
        description="Export financial statistics, member retention metrics, and facility attendance analytics."
      >
        <Button
          variant="primary"
          icon={Download}
          onClick={handleExportCSV}
          disabled={downloading}
        >
          {downloading ? 'Generating Report...' : 'Export Financial CSV Report'}
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6 space-y-3 border-gym-800">
          <div className="p-3 rounded-xl bg-sky-500/10 text-sky-400 w-fit">
            <TrendingUp className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Revenue Growth Audit</h3>
          <p className="text-xs text-slate-400">
            Monthly recurring revenue breakdown, plan sales distribution, and payment channel totals.
          </p>
          <Button variant="secondary" size="sm" onClick={handleExportCSV}>
            Download Revenue CSV
          </Button>
        </Card>

        <Card className="p-6 space-y-3 border-gym-800">
          <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 w-fit">
            <Users className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Member Retention & Churn</h3>
          <p className="text-xs text-slate-400">
            Active vs expired memberships, renewal retention rates, and member acquisition statistics.
          </p>
          <Button variant="secondary" size="sm" onClick={handleExportCSV}>
            Download Member CSV
          </Button>
        </Card>

        <Card className="p-6 space-y-3 border-gym-800">
          <div className="p-3 rounded-xl bg-violet-500/10 text-violet-400 w-fit">
            <Calendar className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-100">Facility Peak Occupancy</h3>
          <p className="text-xs text-slate-400">
            Hourly check-in analytics, peak equipment utilization hours, and weekly scanner logs.
          </p>
          <Button variant="secondary" size="sm" onClick={handleExportCSV}>
            Download Attendance CSV
          </Button>
        </Card>
      </div>
    </div>
  );
}
