import { useEffect, useState, useCallback } from 'react';
import { Plus, Check, Trash2, Edit2 } from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { planService } from '../services/planService';
import { formatCurrency } from '../utils/formatters';

export function PlansPage() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    duration_days: 30,
    price: 49.00,
    featuresText: 'Gym Floor Access, Cardio Zone, Locker Room',
  });
  const [submitting, setSubmitting] = useState(false);

  const loadPlans = useCallback(async () => {
    try {
      setLoading(true);
      const data = await planService.getPlans();
      setPlans(data);
    } catch (err) {
      console.error('Error loading plans:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const handleOpenAddModal = () => {
    setEditingPlan(null);
    setFormData({
      name: '',
      description: '',
      duration_days: 30,
      price: 49.00,
      featuresText: 'Gym Floor Access, Cardio Zone, Locker Room',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (plan) => {
    setEditingPlan(plan);
    setFormData({
      name: plan.name,
      description: plan.description || '',
      duration_days: plan.duration_days,
      price: plan.price,
      featuresText: Array.isArray(plan.features) ? plan.features.join(', ') : '',
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.price || !formData.duration_days) return;

    try {
      setSubmitting(true);
      const featuresArr = formData.featuresText
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);

      const payload = {
        name: formData.name,
        description: formData.description,
        duration_days: Number(formData.duration_days),
        price: Number(formData.price),
        features: featuresArr,
      };

      if (editingPlan) {
        await planService.updatePlan(editingPlan.id, payload);
      } else {
        await planService.createPlan(payload);
      }

      setIsModalOpen(false);
      await loadPlans();
    } catch (err) {
      console.error('Error saving plan:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm('Delete this plan tier?')) {
      await planService.deletePlan(id);
      await loadPlans();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membership Plans & Packages"
        description="Configure gym subscription tiers, pricing structure, duration, and facility perks."
      >
        <Button variant="primary" icon={Plus} onClick={handleOpenAddModal}>
          Create Plan Tier
        </Button>
      </PageHeader>

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {loading ? (
          <p className="text-xs text-slate-400 col-span-4 text-center py-8">
            Loading membership plan packages...
          </p>
        ) : (
          plans.map((plan) => {
            const features = Array.isArray(plan.features) ? plan.features : [];
            return (
              <Card
                key={plan.id}
                className="flex flex-col justify-between border-gym-800 hover:border-brand-cyan/50 transition-all duration-300 relative group"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Badge variant="cyan">{plan.duration_days} Days Access</Badge>
                    <div className="space-x-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => handleOpenEditModal(plan)}
                        className="p-1 text-slate-400 hover:text-white rounded"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(plan.id)}
                        className="p-1 text-rose-400 hover:text-rose-300 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-slate-100">{plan.name}</h3>
                    <p className="text-xs text-slate-400 mt-1 min-h-[32px]">{plan.description}</p>
                  </div>

                  <div className="py-2 border-y border-gym-800/80">
                    <span className="text-3xl font-extrabold text-slate-100 tracking-tight">
                      {formatCurrency(plan.price)}
                    </span>
                    <span className="text-xs text-slate-400 ml-1">/ {plan.duration_days} days</span>
                  </div>

                  <ul className="space-y-2 text-xs text-slate-300">
                    {features.map((feat, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-brand-emerald shrink-0" />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-6 pt-4 border-t border-gym-800/60">
                  <Button variant="secondary" size="sm" className="w-full">
                    Active Plan Tier
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Plan Add/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingPlan ? 'Edit Membership Plan' : 'Create New Plan Package'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Plan Name *"
            placeholder="Gold Quarterly"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <Input
            label="Description"
            placeholder="Full gym floor and sauna access"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Duration (Days) *"
              type="number"
              value={formData.duration_days}
              onChange={(e) => setFormData({ ...formData, duration_days: e.target.value })}
              required
            />
            <Input
              label="Price ($) *"
              type="number"
              step="0.01"
              value={formData.price}
              onChange={(e) => setFormData({ ...formData, price: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Included Perks (Comma Separated)
            </label>
            <textarea
              rows="3"
              value={formData.featuresText}
              onChange={(e) => setFormData({ ...formData, featuresText: e.target.value })}
              className="w-full rounded-lg bg-gym-950 border border-gym-800 text-slate-100 text-xs p-3 focus:outline-none focus:border-brand-cyan"
              placeholder="Gym Floor, Sauna, Free Towel Service"
            ></textarea>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving...' : editingPlan ? 'Update Plan' : 'Create Plan'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
