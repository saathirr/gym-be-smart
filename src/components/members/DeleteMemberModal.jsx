import { useState } from 'react';
import { Trash2, AlertTriangle, ShieldAlert, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { memberService } from '../../services/memberService';
import { useAuth } from '../../hooks/useAuth';
import { toMessage } from '../../lib/supabaseErrors';

export function DeleteMemberModal({ isOpen, onClose, member, photoUrl, onDeleted }) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');
  const { user } = useAuth();

  if (!member) return null;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError('');

    try {
      await memberService.deleteMember(member.id, {
        avatarUrl: member.avatar_url,
        member,
        user,
      });

      onDeleted?.(member);
      onClose();
    } catch (err) {
      setError(toMessage(err, 'Failed to delete member. Please try again.'));
    } finally {
      setIsDeleting(false);
    }
  };

  const imageSrc = photoUrl || (member.avatar_url && !member.avatar_url.includes('/') ? member.avatar_url : null);

  return (
    <Modal
      isOpen={isOpen}
      onClose={isDeleting ? undefined : onClose}
      title="Delete Member"
      className="w-[min(540px,94vw)] max-w-none"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-2 w-full">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={isDeleting}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            disabled={isDeleting}
            icon={isDeleting ? Loader2 : Trash2}
            className="w-full sm:w-auto shadow-rose-600/30"
          >
            {isDeleting ? 'Deleting Member...' : 'Yes, Delete Member'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Warning Badge / Header */}
        <div className="flex items-start gap-3.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25">
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
            <Trash2 className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-rose-300">
              Confirm Member Permanent Deletion
            </h4>
            <p className="text-xs text-rose-200/80 mt-0.5 leading-relaxed">
              Are you sure you want to delete this member? This action is permanent and will completely remove them from the database and the system.
            </p>
          </div>
        </div>

        {/* Member Profile Preview Card */}
        <div className="p-4 rounded-xl bg-gym-850/80 border border-hairline space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gym-800 border border-hairline flex items-center justify-center font-bold text-brand-cyan text-base shrink-0 overflow-hidden">
              {imageSrc ? (
                <img
                  src={imageSrc}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                member.full_name?.charAt(0) || 'M'
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-bold text-slate-100 truncate">
                {member.full_name}
              </h3>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-gym-950 text-brand-cyan border border-brand-cyan/20">
                  {member.member_code}
                </span>
                {member.nic_number && (
                  <span className="text-[11px] font-mono text-slate-400">
                    NIC: {member.nic_number}
                  </span>
                )}
                <Badge
                  variant={
                    member.status === 'Active'
                      ? 'emerald'
                      : member.status === 'Expired'
                      ? 'rose'
                      : 'amber'
                  }
                >
                  {member.status}
                </Badge>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-hairline/60 text-xs">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Phone</span>
              <span className="text-slate-200 font-medium">{member.phone || 'N/A'}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px] uppercase font-semibold">Current Plan</span>
              <span className="text-slate-200 font-medium">{member.plan_name || 'No Active Plan'}</span>
            </div>
          </div>
        </div>

        {/* Cascade Deletion Notice */}
        <div className="p-3.5 rounded-xl bg-gym-950/60 border border-hairline text-xs space-y-2">
          <p className="font-semibold text-slate-300 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            The following records will be permanently removed:
          </p>
          <ul className="space-y-1.5 text-slate-400 pl-5 list-disc text-[11px]">
            <li>Member record and profile from the database</li>
            <li>All active and expired membership subscriptions</li>
            <li>Daily attendance check-in records</li>
            <li>Payment history, transactions and receipts</li>
            <li>Uploaded avatar photo from cloud storage</li>
          </ul>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
