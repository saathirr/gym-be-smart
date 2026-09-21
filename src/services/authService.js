import { supabase, isSupabaseConfigured } from '../lib/supabase';

export const authService = {
  async getCurrentUser() {
    if (!isSupabaseConfigured) {
      const storedUser = localStorage.getItem('be_smart_demo_user');
      return storedUser ? JSON.parse(storedUser) : null;
    }

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;

    // Fetch user profile role from public.profiles
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    return {
      ...user,
      role: profile?.role || 'admin',
      full_name: profile?.full_name || user.user_metadata?.full_name || 'Gym Administrator',
    };
  },

  async signInWithEmail(email, password) {
    if (!email || !password) {
      throw new Error('Please fill in both email and password.');
    }

    if (!isSupabaseConfigured) {
      // Demo authentication mode when Supabase credentials are not populated
      const demoUser = {
        id: 'demo-admin-id',
        email,
        role: 'admin',
        user_metadata: { full_name: 'Gym Administrator', role: 'admin' },
      };
      localStorage.setItem('be_smart_demo_user', JSON.stringify(demoUser));
      return { user: demoUser, session: { access_token: 'demo-token' } };
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('Invalid email or password. Please verify your credentials.');
      }
      throw error;
    }

    // Verify admin/staff role
    const user = data.user;
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    return {
      user: {
        ...user,
        role: profile?.role || 'admin',
        full_name: profile?.full_name || user.user_metadata?.full_name || 'Gym Administrator',
      },
      session: data.session,
    };
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
