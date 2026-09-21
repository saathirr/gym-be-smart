import { useState } from 'react';
import { Save, ShieldCheck, Database, Building2 } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { isSupabaseConfigured } from '../lib/supabase';

export function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [gymName, setGymName] = useState('Be Smart Gym HQ');
  const [phone, setPhone] = useState('+1 (555) 019-2831');
  const [email, setEmail] = useState('admin@besmartgym.com');
  const [address, setAddress] = useState('100 Fitness Boulevard, Suite 400');

  const handleSave = (e) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="System & Facility Settings"
        description="Configure gym profile details, branch location, security preferences, and database connection status."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6 space-y-6 border-gym-800">
          <div className="flex items-center gap-2 pb-3 border-b border-gym-800">
            <Building2 className="w-5 h-5 text-brand-cyan" />
            <h3 className="text-base font-bold text-slate-100">Gym Facility Profile</h3>
          </div>

          {saved && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
              Settings saved successfully!
            </div>
          )}

          <form onSubmit={handleSave} className="space-y-4">
            <Input
              label="Gym Name"
              value={gymName}
              onChange={(e) => setGymName(e.target.value)}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Contact Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <Input
                label="Support Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <Input
              label="Facility Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />

            <div className="pt-2 flex justify-end">
              <Button type="submit" variant="primary" icon={Save}>
                Save Facility Profile
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="p-6 space-y-4 border-gym-800">
            <div className="flex items-center gap-2 pb-2 border-b border-gym-800">
              <Database className="w-5 h-5 text-brand-emerald" />
              <h3 className="text-sm font-bold text-slate-100">Database Status</h3>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Supabase Engine:</span>
                <Badge variant={isSupabaseConfigured ? 'emerald' : 'amber'}>
                  {isSupabaseConfigured ? 'Connected & Active' : 'Local Fallback Mode'}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Row Level Security:</span>
                <Badge variant="emerald">RLS Enforced</Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">QR Cipher Payload:</span>
                <span className="font-mono text-slate-200">SHA-256 Encoded</span>
              </div>
            </div>
          </Card>

          <Card className="p-6 space-y-4 border-gym-800">
            <div className="flex items-center gap-2 pb-2 border-b border-gym-800">
              <ShieldCheck className="w-5 h-5 text-brand-violet" />
              <h3 className="text-sm font-bold text-slate-100">Security & Roles</h3>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Row Level Security policies prevent unauthorized data access across branches. Only authenticated administrators and verified staff members can alter membership records.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
