import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { GymProvider } from './contexts/GymContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppRoutes } from './routes/AppRoutes';
import { SetupRequired } from './pages/SetupRequired';
import { isSupabaseConfigured } from './lib/supabase';

export function App() {
  return (
    <ThemeProvider>
      {isSupabaseConfigured ? (
        <BrowserRouter>
          <AuthProvider>
            <GymProvider>
              <AppRoutes />
            </GymProvider>
          </AuthProvider>
        </BrowserRouter>
      ) : (
        <SetupRequired />
      )}
    </ThemeProvider>
  );
}

export default App;
