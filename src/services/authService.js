import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

const DEFAULT_NAME = 'Gym Staff';

async function loadProfile(user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw toMessage(error, 'Could not load your staff profile.');

  // No profile means the account was never provisioned (or was removed).
  // Fail closed instead of guessing a role, otherwise a leftover Auth user
  // would sign in and inherit the operational permissions of a staff member.
  if (!data) {
    throw new Error(
      'This account has no staff profile. Ask an administrator to restore access for you.'
    );
  }

  return {
    id: user.id,
    email: user.email,
    role: data.role,
    full_name: data.full_name || user.email?.split('@')[0] || DEFAULT_NAME,
  };
}

export const authService = {
  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw toMessage(error);
    if (!data.user) return null;

    return loadProfile(data.user);
  },

  async signInWithEmail(email, password) {
    const trimmed = email?.trim();
    if (!trimmed || !password) {
      throw new Error('Please enter both your email address and password.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });

    if (error) {
      if (/invalid login credentials/i.test(error.message)) {
        throw new Error('Incorrect email or password.');
      }
      if (/email not confirmed/i.test(error.message)) {
        throw new Error('Confirm your email address before signing in.');
      }
      throw toMessage(error, 'Could not sign you in. Please try again.');
    }

    return { user: await loadProfile(data.user), session: data.session };
  },

  // First-run only. The database refuses this once any staff account exists.
  async signUpFirstAdmin({ email, password, fullName }) {
    const trimmed = email?.trim();
    if (!trimmed || !password) {
      throw new Error('Please enter both your email address and password.');
    }
    if (password.length < 8) {
      throw new Error('Use a password of at least 8 characters.');
    }

    const { data, error } = await supabase.auth.signUp({
      email: trimmed,
      password,
      options: { data: { full_name: fullName?.trim() || 'Gym Administrator' } },
    });

    if (error) throw toMessage(error);

    if (data.session) {
      return { user: await loadProfile(data.user), session: data.session };
    }

    return { user: null, session: null, confirmationRequired: true };
  },

  // Admins provisioning staff from the Settings screen.
  //
  // NOTE: Supabase deliberately exposes signUp to the browser and cannot gate
  // it on a role, so this path is protected by the admin-only UI rather than by
  // the database. Move it to an Edge Function with the service-role key
  // before exposing this app publicly.
  async createStaffAccount({ email, password, fullName, role = 'staff' }) {
    if (password?.length < 8) {
      throw new Error('Use a password of at least 8 characters.');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getUser();
    if (sessionError) throw toMessage(sessionError, 'Could not verify your session.');

    const { data: caller, error: roleReadError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', sessionData?.user?.id ?? '')
      .maybeSingle();

    if (roleReadError) throw toMessage(roleReadError, 'Could not verify your permissions.');
    if (caller?.role !== 'admin') {
      throw new Error('Only an administrator can create staff accounts.');
    }

    const { data, error } = await supabase.auth.signUp({
      email: email?.trim(),
      password,
      options: { data: { full_name: fullName?.trim() || 'Gym Staff' } },
    });

    if (error) throw toMessage(error);
    if (!data.user) throw new Error('Supabase did not return the new account.');

    const { error: roleError } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', data.user.id);

    if (roleError) {
      // The account exists but has the wrong role. Say so instead of
      // pretending the account is fully set up.
      throw new Error(
        `The account was created but the role could not be set to "${role}". ` +
          `Open Supabase → Authentication → Users and remove ${data.user.email} if it should not exist.`
      );
    }

    return data.user;
  },

  async needsBootstrap() {
    const { data, error } = await supabase.rpc('is_bootstrap_needed');
    if (error) throw toMessage(error);
    return data === true;
  },

  async promoteSelfToAdmin() {
    const { data, error } = await supabase.rpc('bootstrap_admin');
    if (error) throw toMessage(error);
    if (data !== true) {
      throw new Error('Setup is already complete. Ask an existing admin for access.');
    }
    return true;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw toMessage(error);
  },
};
