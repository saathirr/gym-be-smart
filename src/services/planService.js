import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

export const PLAN_FIELDS =
  'id, name, description, duration_days, price, features, is_active, created_at';

function normalize(plan) {
  return {
    ...plan,
    price: Number(plan.price),
    duration_days: Number(plan.duration_days),
    features: Array.isArray(plan.features) ? plan.features : [],
  };
}

// Plans come back cheapest first, so plans[0] is the LKR 250 day pass. Using
// that as the preselected plan in a form would quietly sell a one-day pass to
// someone registering a normal membership, so default to the longest plan
// instead. Pass preferredId to keep a member on the plan they already have.
export function pickDefaultPlan(plans, preferredId) {
  if (!Array.isArray(plans) || plans.length === 0) return undefined;

  const preferred = plans.find((plan) => plan.id === preferredId);
  if (preferred) return preferred;

  return plans.reduce((longest, plan) =>
    plan.duration_days > longest.duration_days ? plan : longest
  );
}

export const planService = {
  async getPlans({ includeInactive = true } = {}) {
    let query = supabase
      .from('plans')
      .select(PLAN_FIELDS)
      .order('price', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw toMessage(error);

    return (data || []).map(normalize);
  },

  async createPlan(planData) {
    const { data, error } = await supabase
      .from('plans')
      .insert([planData])
      .select(PLAN_FIELDS)
      .single();

    if (error) throw toMessage(error);
    return normalize(data);
  },

  async updatePlan(id, planData) {
    const { data, error } = await supabase
      .from('plans')
      .update(planData)
      .eq('id', id)
      .select(PLAN_FIELDS)
      .single();

    if (error) throw toMessage(error);
    return normalize(data);
  },

  async setPlanActive(id, isActive) {
    const { data, error } = await supabase
      .from('plans')
      .update({ is_active: isActive })
      .eq('id', id)
      .select(PLAN_FIELDS)
      .single();

    if (error) throw toMessage(error);
    return normalize(data);
  },

  async deletePlan(id) {
    const { error } = await supabase.from('plans').delete().eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },
};
