import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, LogIn, AlertCircle, Sparkles } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, isConfigured } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please provide both email and password.');
      return;
    }

    try {
      setError('');
      setLoading(true);
      await login(email, password);
      navigate('/');
    } catch (err) {
      console.error('Login failed:', err);
      setError(err.message || 'Failed to sign in. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoFill = () => {
    setEmail('admin@besmartgym.com');
    setPassword('admin123');
    setError('');
  };

  return (
    <Card className="glass-panel border-gym-800 shadow-2xl p-8 space-y-6">
      <div>
        <h3 className="text-xl font-bold text-slate-100 text-center">Admin Portal Login</h3>
        <p className="text-xs text-slate-400 text-center mt-1">
          Sign in to access gym operations, member records & metrics
        </p>
      </div>

      {!isConfigured && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <span className="font-semibold">Supabase credentials pending setup:</span> Running in local Auth fallback mode. Use any credentials or click quick demo below.
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center gap-2 text-xs text-rose-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email Address"
          type="email"
          placeholder="admin@besmartgym.com"
          icon={Mail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          icon={Lock}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
          {loading ? 'Authenticating...' : 'Sign In to Dashboard'}
        </Button>
      </form>

      <div className="pt-4 border-t border-gym-800/80 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleDemoFill}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-cyan hover:text-sky-400 transition"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Fill Quick Demo Credentials
        </button>
      </div>
    </Card>
  );
}
