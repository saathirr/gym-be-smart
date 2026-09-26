import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { authService } from '../services/authService';
import { AuthContext } from './AuthContextInstance';

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
        // Never await Supabase calls inside this callback: the auth client
        // holds a lock that deadlocks if we do. Defer to the next tick.
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

  // Called after the first admin is created, otherwise the router keeps
  // bouncing the new admin back to /setup.
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
    // The account now exists, so the first-run screen is done either way.
    // Otherwise /login would bounce back to /setup until a page reload.
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
        isAdmin: user?.role === 'admin',
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
