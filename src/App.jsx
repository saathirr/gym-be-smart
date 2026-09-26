import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { GymProvider } from './contexts/GymContext';
import { AppRoutes } from './routes/AppRoutes';
import { SetupRequired } from './pages/SetupRequired';
import { isSupabaseConfigured } from './lib/supabase';

export function App() {
  if (!isSupabaseConfigured) {
    return <SetupRequired />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <GymProvider>
          <AppRoutes />
        </GymProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
