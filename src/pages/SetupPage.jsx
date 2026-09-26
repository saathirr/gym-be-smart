import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, ShieldCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { authService } from '../services/authService';
import { toMessage } from '../lib/supabaseErrors';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export function SetupPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const { signupFirstAdmin, refreshUser } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.email.trim() || !form.password) {
      setError('Enter an email address and a password.');
      return;
    }
    if (form.password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }

    try {
      setSubmitting(true);
      const result = await signupFirstAdmin({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
      });

      if (result.confirmationRequired) {
        setNotice(
          'Account created. Check your inbox to confirm the address, then sign in.'
        );
        return;
      }

      // The signup trigger already granted the first account 'admin'; this
      // call is a safety net and also unlocks the rest of the app.
      await authService.promoteSelfToAdmin();
      await refreshUser();
      navigate('/', { replace: true });
    } catch (err) {
      setError(toMessage(err, 'Could not create the administrator account.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="shadow-2xl p-8 space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 flex items-center justify-center">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <h3 className="text-xl font-bold text-slate-100">First-time setup</h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Create the administrator account for this club. Later staff accounts are
          added from Settings.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-xs text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400">
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Your full name"
          placeholder="e.g. Kasun Perera"
          value={form.fullName}
          onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          required
        />

        <Input
          label="Admin email address"
          type="email"
          placeholder="admin@besmartfitness.lk"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Input
            label="Confirm password"
            type="password"
            placeholder="Repeat password"
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            required
          />
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting}
          icon={UserPlus}
          className="w-full"
        >
          {submitting ? 'Creating account...' : 'Create administrator account'}
        </Button>
      </form>
    </Card>
  );
}
