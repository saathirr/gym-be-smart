import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const { gymName } = useGym();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      setError('Enter both your email address and password.');
      return;
    }

    try {
      setError('');
      setLoading(true);
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(toMessage(err, 'Could not sign in. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="glass-panel shadow-2xl p-8 space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100 text-center">Staff sign in</h3>
        <p className="text-xs text-slate-400 text-center mt-1">
          {gymName} administration
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2 text-xs text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email address"
          type="email"
          placeholder="admin@besmartfitness.lk"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          icon={Mail}
          autoComplete="email"
          required
        />

        <Input
          label="Password"
          type="password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          icon={Lock}
          autoComplete="current-password"
          required
        />

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading}
          icon={LogIn}
          className="w-full mt-2"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}
