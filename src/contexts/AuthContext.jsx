import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { authService } from '../services/authService';
import { AuthContext } from './AuthContextInstance';

const SUPER_ADMIN_EMAIL = 'besmart@admin.lk';

function isSuperAdminUser(user) {
  if (!user) return false;
  const email = String(user.email || '').toLowerCase().trim();
  if (email === SUPER_ADMIN_EMAIL) return true;
  return user.role === 'super_admin' || user.role === 'owner';
}

function isAdminUser(user) {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  return user.role === 'admin';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  useEffect(() => {
    let active = true;

    async function init() {
      try {
        const [session, bootstrap] = await Promise.all([
          supabase.auth.getSession(),
          authService.needsBootstrap(),
        ]);

        if (!active) return;
        setNeedsBootstrap(bootstrap);
        setUser(session.session?.user ? await authService.getCurrentUser() : null);
      } catch (err) {
        console.error('Auth initialization failed:', err);
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    init();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setTimeout(async () => {
          try {
            setUser(session?.user ? await authService.getCurrentUser() : null);
          } catch (err) {
            console.error('Could not load profile for session:', err);
            setUser(null);
          } finally {
            setLoading(false);
          }
        }, 0);
      }
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const markBootstrapComplete = useCallback(() => {
    setNeedsBootstrap(false);
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await authService.signInWithEmail(email, password);
    setUser(result.user);
    return result;
  }, []);

  const signupFirstAdmin = useCallback(async (payload) => {
    const result = await authService.signUpFirstAdmin(payload);
    markBootstrapComplete();
    return result;
  }, [markBootstrapComplete]);

  const logout = useCallback(async () => {
    await authService.signOut();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const current = await authService.getCurrentUser();
    setUser(current);
    return current;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        needsBootstrap,
        isAdmin: isAdminUser(user),
        isSuperAdmin: isSuperAdminUser(user),
        isOwner: isSuperAdminUser(user),
        login,
        signupFirstAdmin,
        logout,
        refreshUser,
        markBootstrapComplete,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
