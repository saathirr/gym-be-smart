import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

const DEFAULT_SETTINGS = {
  gym_name: 'Be Smart Fitness Club',
  tagline: 'Train smarter. Live stronger.',
  phone: '',
  support_email: '',
  address: '',
  district: 'Colombo',
  opening_time: '05:30',
  closing_time: '22:00',
  currency: 'LKR',
  invoice_footer: 'Thank you for training with us.',
};

export const settingsService = {
  DEFAULT_SETTINGS,

  async getGymSettings() {
    const { data, error } = await supabase
      .from('gym_settings')
      .select(
        'gym_name, tagline, phone, support_email, address, district, opening_time, closing_time, currency, invoice_footer'
      )
      .eq('id', true)
      .maybeSingle();

    if (error) throw error;

    return { ...DEFAULT_SETTINGS, ...(data || {}) };
  },

  async saveGymSettings(values) {
    const { data, error } = await supabase
      .from('gym_settings')
      .update({
        gym_name: values.gym_name?.trim() || DEFAULT_SETTINGS.gym_name,
        tagline: values.tagline?.trim() || null,
        phone: values.phone?.trim() || null,
        support_email: values.support_email?.trim() || null,
        address: values.address?.trim() || null,
        district: values.district?.trim() || null,
        opening_time: values.opening_time || DEFAULT_SETTINGS.opening_time,
        closing_time: values.closing_time || DEFAULT_SETTINGS.closing_time,
        currency: values.currency || DEFAULT_SETTINGS.currency,
        invoice_footer: values.invoice_footer?.trim() || null,
      })
      .eq('id', true)
      .select()
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async getBranches({ includeInactive = true } = {}) {
    let query = supabase.from('branches').select('*').order('name');

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async saveBranch(branch) {
    const payload = {
      name: branch.name?.trim(),
      code: branch.code?.trim() || null,
      phone: branch.phone?.trim() || null,
      address: branch.address?.trim() || null,
      district: branch.district?.trim() || null,
      is_active: branch.is_active ?? true,
    };

    if (!payload.name) throw new Error('Branch name is required.');

    if (branch.id) {
      const { data, error } = await supabase
        .from('branches')
        .update(payload)
        .eq('id', branch.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase.from('branches').insert([payload]).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBranch(id) {
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) throw toMessage(error, 'Could not delete that branch.');
    return true;
  },
};
