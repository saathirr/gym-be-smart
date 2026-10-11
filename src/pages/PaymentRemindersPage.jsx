import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
} from 'lucide-react';
import { PageHeader } from '../components/common/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { reminderService } from '../services/reminderService';
import { useGym } from '../hooks/useGym';
import { toMessage } from '../lib/supabaseErrors';
import { formatTimestamp } from '../utils/attendanceMath';
import { formatPhone } from '../utils/phone';
import {
  REMINDER_DAYS_AFTER_START,
  buildPaymentReminderMessage,
  buildReminderWhatsAppUrl,
} from '../utils/reminders';

// The day number a player is on (the start day is day 1), and how they read.
function reminderLabel(reminder) {
  const dayNumber = reminder.daysSinceStart + 1;
  if (reminder.daysSinceStart > REMINDER_DAYS_AFTER_START) {
    return { dayNumber, tone: 'rose', text: `Overdue ${reminder.daysSinceStart - REMINDER_DAYS_AFTER_START}d` };
  }
  return { dayNumber, tone: 'amber', text: 'Due now' };
}

export function PaymentRemindersPage() {
  const { currency, settings, gymName } = useGym();

  const [reminders, setReminders] = useState([]);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sendingId, setSendingId] = useState(null);
  const [logError, setLogError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLogError('');
    try {
      const { today: clubToday, reminders: rows } = await reminderService.getDueReminders({
        timeZone: settings?.timezone,
      });
      setToday(clubToday);
      setReminders(rows);
    } catch (err) {
      setError(toMessage(err, 'Could not load the payment reminders.'));
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, [settings?.timezone]);

  useEffect(() => {
    load();
  }, [load]);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return reminders;
    return reminders.filter((row) => {
      const m = row.member;
      return (
        m.full_name?.toLowerCase().includes(term) ||
        m.member_code?.toLowerCase().includes(term) ||
        m.phone?.toLowerCase().includes(term) ||
        m.whatsapp_number?.toLowerCase().includes(term)
      );
    });
  }, [reminders, term]);

  const stats = useMemo(() => {
    const dueToday = reminders.filter(
      (row) => row.reminder.daysSinceStart === REMINDER_DAYS_AFTER_START
    ).length;
    const overdue = reminders.filter(
      (row) => row.reminder.daysSinceStart > REMINDER_DAYS_AFTER_START
    ).length;
    const remindedToday = reminders.filter((row) => {
      if (!row.lastReminder?.sent_at || !today) return false;
      const key = new Date(row.lastReminder.sent_at).toISOString().slice(0, 10);
      return key === today;
    }).length;
    return { dueToday, overdue, pending: reminders.length - remindedToday, remindedToday };
  }, [reminders, today]);

  const handleSent = useCallback(
    async (row, message) => {
      setSendingId(row.member.id);
      setLogError('');
      try {
        const saved = await reminderService.recordReminder({
          memberId: row.member.id,
          membershipId: row.member.membership_id,
          phone: row.member.whatsapp_number || row.member.phone,
          message,
          status: 'Sent',
          daysSinceStart: row.reminder.daysSinceStart,
        });
        setReminders((prev) =>
          prev.map((item) =>
            item.member.id === row.member.id ? { ...item, lastReminder: saved } : item
          )
        );
      } catch (err) {
        setLogError(
          toMessage(err, 'The WhatsApp chat opened, but the reminder could not be logged.')
        );
      } finally {
        setSendingId(null);
      }
    },
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment reminders"
        description={`Players past ${REMINDER_DAYS_AFTER_START} days of their membership are listed here for a WhatsApp follow-up.`}
      >
        <Button variant="secondary" icon={RefreshCw} onClick={load} disabled={loading}>
          Refresh
        </Button>
      </PageHeader>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-rose-400">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>
            Retry
          </Button>
        </div>
      )}

      {logError && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{logError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Due today" value={stats.dueToday} tone="text-amber-400" />
        <Stat label="Overdue" value={stats.overdue} tone="text-rose-400" />
        <Stat label="Still to remind" value={stats.pending} tone="text-sky-400" />
        <Stat label="Reminded today" value={stats.remindedToday} tone="text-emerald-400" />
      </div>

      <Card className="p-4 bg-gym-900/80">
        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search name, code or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-gym-850 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
          />
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-gym-950/80 border-b text-slate-400 uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Member</th>
                <th className="py-3.5 px-4">Plan</th>
                <th className="py-3.5 px-4">Started</th>
                <th className="py-3.5 px-4">Cycle</th>
                <th className="py-3.5 px-4">Last reminded</th>
                <th className="py-3.5 px-4 text-right">Remind</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    Checking who is due...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-slate-400">
                    {reminders.length === 0
                      ? 'No payments are due. Everyone is up to date.'
                      : 'No players match that search.'}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const { member, reminder, lastReminder } = row;
                  const phone = member.whatsapp_number || member.phone;
                  const message = buildPaymentReminderMessage(member, { gymName, currency });
                  const url = buildReminderWhatsAppUrl(phone, member, { gymName, currency });
                  const label = reminderLabel(reminder);

                  return (
                    <tr key={member.id} className="hover:bg-gym-800/40 transition">
                      <td className="py-3.5 px-4">
                        <Link
                          to={`/members/${member.id}`}
                          className="font-semibold text-slate-100 hover:text-brand-cyan"
                        >
                          {member.full_name}
                        </Link>
                        <p className="text-[11px] text-slate-400 font-mono">{member.member_code}</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Phone className="w-3 h-3" />
                          {formatPhone(phone)}
                        </p>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        {member.plan_name || 'No plan'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">{reminder.startDate || 'N/A'}</td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={label.tone}>{label.text}</Badge>
                          <span className="text-[11px] text-slate-500">Day {label.dayNumber}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-400">
                        {lastReminder ? (
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            {formatTimestamp(lastReminder.sent_at, settings?.timezone)}
                          </span>
                        ) : (
                          <span className="text-slate-500">Not yet</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => handleSent(row, message)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-emerald hover:bg-emerald-500 text-white text-xs font-medium transition disabled:opacity-50"
                            title={`Remind ${member.full_name} on WhatsApp`}
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            {sendingId === member.id ? 'Logging...' : 'WhatsApp'}
                          </a>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gym-800 text-slate-500 text-xs cursor-not-allowed"
                            title="No WhatsApp-usable number on file"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            No number
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5" />
        Each player&apos;s cycle restarts when their membership is renewed, so the same renewal is
        chased once. Sending opens WhatsApp with the message pre-written; the message is logged
        against the player.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-2xl font-bold font-mono mt-1 ${tone}`}>{value}</p>
    </Card>
  );
}
