import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

export const staffService = {
  async listStaff() {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .order('created_at', { ascending: true });

    if (error) throw toMessage(error);
    return data || [];
  },

  async updateRole(id, role) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },

  // NOTE: there is intentionally no "remove staff" call here. Deleting the
  // profile row would leave a working Supabase Auth account behind that can
  // still sign in, so account removal has to happen in Supabase Auth
  // (Authentication -> Users) or from a service-role Edge Function.
};
