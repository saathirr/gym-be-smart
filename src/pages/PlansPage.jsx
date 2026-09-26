import { useCallback, useEffect, useState } from 'react';
import { Plus, Check, Trash2, Pencil, AlertCircle, Power } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { planService } from '../services/planService';
import { formatCurrency } from '../utils/formatters';
import { useAuth } from '../hooks/useAuth';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';

function blankForm() {
  return {
    name: '',
    description: '',
    duration_days: 30,
    price: '',
    featuresText: '',
  };
}

export function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [formData, setFormData] = useState(blankForm);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { isAdmin } = useAuth();
  const { currency } = useGym();

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setPlans(await planService.getPlans());
    } catch (err) {
      setError(toMessage(err, 'Could not load membership plans.'));
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleOpenAddModal = () => {
    setEditingPlan(null);
    setFormData(blankForm());
    setFormError('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (plan) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      description: plan.description || '',
      duration_days: plan.duration_days,
      price: String(plan.price),
      featuresText: plan.features.join(', '),
    });
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const price = Number(formData.price);
    const duration = Number(formData.duration_days);

    if (!formData.name.trim()) {
      setFormError('Give the plan a name.');
      return;
    }
    if (!(duration > 0)) {
      setFormError('Duration must be at least 1 day.');
      return;
    }
    if (!(price >= 0) || formData.price === '') {
      setFormError('Enter a valid price.');
      return;
    }

    try {
      setSubmitting(true);
      setFormError('');

      const payload = {
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        duration_days: duration,
        price,
        features: formData.featuresText
          .split(',')
          .map((feature) => feature.trim())
          .filter(Boolean),
      };

      if (editingPlan) {
        await planService.updatePlan(editingPlan.id, payload);
      } else {
        await planService.createPlan(payload);
      }

      setIsModalOpen(false);
      await loadPlans();
    } catch (err) {
      setFormError(toMessage(err, 'Could not save this plan.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (plan) => {
    try {
      await planService.setPlanActive(plan.id, !plan.is_active);
      await loadPlans();
    } catch (err) {
      setError(toMessage(err, 'Could not change the plan status.'));
    }
  };

  const handleDelete = async (plan) => {
    if (
      !window.confirm(
        `Delete "${plan.name}"? Plans already bought by members cannot be removed.`
      )
    ) {
      return;
    }

    try {
      await planService.deletePlan(plan.id);
      await loadPlans();
    } catch (err) {
      setError(
        toMessage(
          err,
          'This plan is already linked to memberships. Deactivate it instead of deleting.'
        )
      );
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membership plans"
        description="Define subscription tiers, pricing, duration, and included perks."
      >
        {isAdmin && (
          <Button variant="primary" icon={Plus} onClick={handleOpenAddModal}>
            Create plan
          </Button>
        )}
      </PageHeader>

      {error && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-amber-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={loadPlans}>
            Retry
          </Button>
        </div>
      )}

      {!isAdmin && (
        <p className="text-xs text-slate-400">
          Only administrators can change plan tiers. You can view them here.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <p className="text-xs text-slate-400 col-span-3 text-center py-8">
            Loading plans...
          </p>
        ) : plans.length === 0 ? (
          <div className="col-span-3 text-center py-12 space-y-3">
            <p className="text-sm text-slate-300">No membership plans yet.</p>
            <p className="text-xs text-slate-400">
              Create a plan so members can be registered against it.
            </p>
            {isAdmin && (
              <Button variant="primary" icon={Plus} onClick={handleOpenAddModal}>
                Create the first plan
              </Button>
            )}
          </div>
        ) : (
          plans.map((plan) => (
            <Card
              key={plan.id}
              className={`flex flex-col justify-between transition-all duration-300 relative group ${
                plan.is_active
                  ? 'border-edge hover:border-brand-cyan/50'
                  : 'border-edge/60 opacity-70'
              }`}
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Badge variant="cyan">{plan.duration_days} days</Badge>
                  {isAdmin && (
                    <div className="space-x-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                      <button
                        onClick={() => handleOpenEditModal(plan)}
                        className="p-1 text-slate-400 hover:text-white rounded"
                        title="Edit plan"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(plan)}
                        className="p-1 text-slate-400 hover:text-white rounded"
                        title={plan.is_active ? 'Deactivate plan' : 'Activate plan'}
                      >
                        <Power className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(plan)}
                        className="p-1 text-rose-400 hover:text-rose-300 rounded"
                        title="Delete plan"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    {plan.name}
                    {!plan.is_active && (
                      <Badge variant="default" className="text-[10px]">
                        Inactive
                      </Badge>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 min-h-[32px]">
                    {plan.description || 'No description'}
                  </p>
                </div>

                <div className="py-2 border-y border-edge/80">
                  <span className="text-3xl font-extrabold text-slate-100 tracking-tight">
                    {formatCurrency(plan.price, currency)}
                  </span>
                  <span className="text-xs text-slate-400 ml-1">
                    / {plan.duration_days} days
                  </span>
                </div>

                {plan.features.length > 0 && (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-brand-emerald shrink-0 mt-px" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-edge/60">
                <p className="text-[11px] text-slate-500 text-center">
                  {plan.is_active
                    ? 'Available for new and renewing members'
                    : 'Hidden from new registrations'}
                </p>
              </div>
            </Card>
          ))
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingPlan ? 'Edit membership plan' : 'Create membership plan'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
              <span>{formError}</span>
            </div>
          )}

          <Input
            label="Plan name *"
            placeholder="e.g. Gold Quarterly"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <Input
            label="Description"
            placeholder="e.g. Full gym floor and sauna access"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Duration (days) *"
              type="number"
              min="1"
              value={formData.duration_days}
              onChange={(e) => setFormData({ ...formData, duration_days: e.target.value })}
              required
            />
            <Input
              label={`Price (${currency}) *`}
              type="number"
              min="0"
              step="1"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Included perks (comma separated)
            </label>
            <textarea
              rows="3"
              value={formData.featuresText}
              onChange={(e) => setFormData({ ...formData, featuresText: e.target.value })}
              className="w-full rounded-lg bg-gym-950 border border-edge text-slate-100 text-xs p-3 focus:outline-none focus:border-brand-cyan"
              placeholder="Gym Floor, Sauna, Free Towel Service"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving...' : editingPlan ? 'Update plan' : 'Create plan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
