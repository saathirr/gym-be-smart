import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

// Layouts
import { DashboardLayout } from '../layouts/DashboardLayout';
import { AuthLayout } from '../layouts/AuthLayout';

// Pages
import { LoginPage } from '../pages/LoginPage';
import { SetupPage } from '../pages/SetupPage';
import { DashboardPage } from '../pages/DashboardPage';
import { MembersPage } from '../pages/MembersPage';
import { AttendancePage } from '../pages/AttendancePage';
import { QRScannerPage } from '../pages/QRScannerPage';
import { MembershipsPage } from '../pages/MembershipsPage';
import { PlansPage } from '../pages/PlansPage';
import { PaymentsPage } from '../pages/PaymentsPage';
import { ReportsPage } from '../pages/ReportsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { NotFoundPage } from '../pages/NotFoundPage';

function FullPageLoader({ label = 'Loading your club...' }) {
  return (
    <div className="min-h-screen bg-gym-950 flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-4 border-brand-cyan border-t-transparent rounded-full animate-spin" />
      <p className="text-xs text-slate-400 font-medium">{label}</p>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading, needsBootstrap } = useAuth();

  if (loading) return <FullPageLoader />;
  if (needsBootstrap) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;

  return children;
}

function PublicOnlyRoute({ children }) {
  const { user, loading, needsBootstrap } = useAuth();

  if (loading) return <FullPageLoader />;
  if (needsBootstrap) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;

  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      {/* First-run: create the very first admin account */}
      <Route element={<AuthLayout />}>
        <Route
          path="/setup"
          element={
            <PublicOnlyRoute>
              <SetupPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
      </Route>

      {/* Club operations */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/qr-scanner" element={<QRScannerPage />} />
        <Route path="/memberships" element={<MembershipsPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
