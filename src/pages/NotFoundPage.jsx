import { useNavigate } from 'react-router-dom';
import { HelpCircle, ArrowLeft } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[80vh] flex items-center justify-center">
      <Card className="max-w-md w-full text-center p-8 space-y-4">
        <div className="mx-auto w-16 h-16 rounded-full bg-gym-800 text-brand-cyan flex items-center justify-center">
          <HelpCircle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">404 - Page Not Found</h2>
        <p className="text-xs text-slate-400">
          The requested page route does not exist or has been relocated.
        </p>
        <Button variant="primary" icon={ArrowLeft} onClick={() => navigate('/')}>
          Return to Dashboard
        </Button>
      </Card>
    </div>
  );
}
