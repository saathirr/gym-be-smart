import { supabase, isSupabaseConfigured } from '../lib/supabase';

// Fallback seed plans if Supabase is not configured yet
const fallbackPlans = [
  {
    id: 'plan-1',
    name: 'Basic Monthly',
    description: 'Standard gym floor access and cardio zone',
    duration_days: 30,
    price: 49.00,
    features: ['Gym Floor', 'Cardio Zone', 'Locker Room'],
    is_active: true,
  },
  {
    id: 'plan-2',
    name: 'Gold Quarterly',
    description: 'Full access including group classes and sauna',
    duration_days: 90,
    price: 129.00,
    features: ['Gym Floor', 'Group Classes', 'Sauna', '1 Guest Pass/Mo'],
    is_active: true,
  },
  {
    id: 'plan-3',
    name: 'VIP Annual',
    description: 'All access VIP membership with free towel service',
    duration_days: 365,
    price: 449.00,
    features: ['24/7 Access', 'All Facilities', 'Free Towel Service', 'Free Drinks', 'Unlimited Guest Passes'],
    is_active: true,
  },
  {
    id: 'plan-4',
    name: 'Personal Training',
    description: 'Dedicated 1-on-1 coaching package',
    duration_days: 30,
    price: 199.00,
    features: ['12 PT Sessions', 'Custom Nutrition Plan', 'Body Comp Tracking'],
    is_active: true,
  },
];

export const planService = {
  async getPlans() {
    if (!isSupabaseConfigured) {
      const stored = localStorage.getItem('be_smart_plans');
      return stored ? JSON.parse(stored) : fallbackPlans;
    }

    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .order('price', { ascending: true });

    if (error) {
      console.error('Error fetching plans:', error);
      return fallbackPlans;
    }
    return data || fallbackPlans;
  },

  async createPlan(planData) {
    if (!isSupabaseConfigured) {
      const existing = await this.getPlans();
      const newPlan = { ...planData, id: `plan-${Date.now()}`, is_active: true };
      const updated = [...existing, newPlan];
      localStorage.setItem('be_smart_plans', JSON.stringify(updated));
      return newPlan;
    }

    const { data, error } = await supabase
      .from('plans')
      .insert([planData])
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updatePlan(id, planData) {
    if (!isSupabaseConfigured) {
      const existing = await this.getPlans();
      const updated = existing.map((p) => (p.id === id ? { ...p, ...planData } : p));
      localStorage.setItem('be_smart_plans', JSON.stringify(updated));
      return { id, ...planData };
    }

    const { data, error } = await supabase
      .from('plans')
      .update(planData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deletePlan(id) {
    if (!isSupabaseConfigured) {
      const existing = await this.getPlans();
      const updated = existing.filter((p) => p.id !== id);
      localStorage.setItem('be_smart_plans', JSON.stringify(updated));
      return true;
    }

    const { error } = await supabase.from('plans').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
};
