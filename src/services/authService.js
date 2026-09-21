import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const authService = {
  async getCurrentUser() {
    if (!isSupabaseConfigured) {
      const storedUser = localStorage.getItem('be_smart_demo_user');
      return storedUser ? JSON.parse(storedUser) : null;
    }
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  },

  async signInWithEmail(email, password) {
    if (!isSupabaseConfigured) {
      // Demo authentication mode when Supabase credentials are not populated
      if (email && password) {
        const demoUser = {
          id: 'demo-admin-id',
          email,
          user_metadata: { full_name: 'Gym Administrator', role: 'admin' },
        };
        localStorage.setItem('be_smart_demo_user', JSON.stringify(demoUser));
        return { user: demoUser, session: { access_token: 'demo-token' } };
      }
      throw new Error('Please enter a valid email and password');
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signOut() {
    if (!isSupabaseConfigured) {
      localStorage.removeItem('be_smart_demo_user');
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};
