import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildMonthSummary,
  dayOfMonth,
  firstCheckInLabel,
  listMonths,
  monthLabel,
  toDateKey,
  weekdayLabel,
} from '../../utils/attendanceMath';
import { Card, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { cn } from '../../utils/cn';

// Monthly attendance for one player.
//
// The counting rules live in attendanceMath.buildMonthSummary rather than here:
// DISTINCT days attended, assessed from the later of the 1st of the month and
// the player's registration date, never past today, in the club's timezone.
// This component only decides what to show.
//
// The distinction that matters on screen: a day before the player joined, and a
// day in the future, are NOT absences. Both are rendered as blank. Reporting
// them as "Leave" would show a new member as absent for most of their first
// month and would count days that have not happened yet.

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function DayCell({ day, isToday, isSelected, onSelect, timeZone }) {
  if (!day) {
    return <div className="aspect-square" />;
  }

  const present = day.status === 'Present';
  // The club's zone, not the browser's: a check-in at 00:30 Colombo time is the
  // next morning's "07:12" to a laptop set to UTC, and the day cell would then
  // disagree with the check-in engine that wrote the row.
  const checkIn = firstCheckInLabel(day.checkIns, timeZone);

  return (
    <button
      type="button"
      onClick={() => onSelect?.(day)}
      title={
        present
          ? `Present${checkIn ? ` - checked in ${checkIn}` : ''}`
          : 'Did not attend'
      }
      className={cn(
        'aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-all cursor-pointer relative',
        present
          ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
          : 'bg-rose-500/10 text-rose-300/80 hover:bg-rose-500/20 border border-rose-500/10',
        isToday && 'ring-2 ring-brand-gold',
        isSelected && 'ring-2 ring-brand-cyan scale-105 shadow-md z-10 font-bold'
      )}
    >
      <span>{dayOfMonth(day.date)}</span>
      {present && checkIn && (
        <span className="text-[9px] font-normal opacity-80 leading-none font-mono">{checkIn}</span>
      )}
    </button>
  );
}

function EmptyMessage({ summary }) {
  if (summary.notStarted) {
    return 'This month has not started yet, or you had not joined by then.';
  }
  // The window starting later than the 1st is the registration cutoff doing its
  // job, not a gap in the record.
  if (summary.startDate !== summary.monthStart) {
    return `You joined on ${summary.startDate}, so the days before it are not counted.`;
  }
  return 'No attendance recorded in this month.';
}

export function MemberAttendanceHistory({
  attendanceRows = [],
  registrationDate,
  timeZone,
  today,
  loading = false,
  className,
}) {
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);

  // `today` is injected by the page. If it is null/undefined during load or offline,
  // fallback to todayKey(timeZone) so the calendar always renders rather than showing a blank screen.
  const effectiveTodayKey = toDateKey(today, timeZone) || todayKey(timeZone);

  const months = useMemo(() => {
    if (!effectiveTodayKey) return [];
    const regKey = toDateKey(registrationDate, timeZone);
    const startKey = regKey && regKey <= effectiveTodayKey
      ? `${regKey.slice(0, 7)}-01`
      : `${effectiveTodayKey.slice(0, 7)}-01`;
    const list = listMonths(startKey, effectiveTodayKey);
    if (list.length > 0) return list;
    const year = Number(effectiveTodayKey.slice(0, 4));
    const month = Number(effectiveTodayKey.slice(5, 7));
    return [{ year, month, key: effectiveTodayKey.slice(0, 7) }];
  }, [registrationDate, effectiveTodayKey, timeZone]);

  const activeMonth = selectedMonth || effectiveTodayKey?.slice(0, 7) || null;

  const summary = useMemo(() => {
    if (!activeMonth) return null;
    return buildMonthSummary({
      attendanceRows,
      registrationDate,
      monthStart: `${activeMonth}-01`,
      today: effectiveTodayKey,
      timeZone,
    });
  }, [activeMonth, attendanceRows, registrationDate, effectiveTodayKey, timeZone]);

  // The grid is offset so the 1st lands under the right weekday. 2026-01-01 was
  // a Thursday, so the offset is computed rather than hard-coded per month.
  const leadingBlanks = useMemo(() => {
    if (!activeMonth) return 0;
    const first = `${activeMonth}-01`;
    // Zeller-free: Date.UTC on the 1st, read back with getUTCDay, which gives
    // 0 = Sunday without depending on the reader's own timezone.
    const [year, month] = first.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  }, [activeMonth]);

  const index = months.findIndex((m) => m.key === activeMonth);
  const canGoNewer = index > 0;
  const canGoOlder = index >= 0 && index < months.length - 1;

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <div className="h-40 rounded-xl bg-gym-850/50 animate-pulse" />
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle icon={CalendarDays}>Attendance</CardTitle>

        {summary && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!canGoNewer}
              onClick={() => {
                setSelectedMonth(months[index - 1]?.key || null);
                setSelectedDay(null);
              }}
              aria-label="Newer month"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <span className="text-sm text-slate-300 min-w-[7.5rem] text-center">
              {monthLabel(summary.year, summary.month)}
            </span>

            <Button
              size="sm"
              variant="ghost"
              disabled={!canGoOlder}
              onClick={() => {
                setSelectedMonth(months[index + 1]?.key || null);
                setSelectedDay(null);
              }}
              aria-label="Older month"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardHeader>

      {!summary || months.length === 0 ? (
        <p className="text-sm text-slate-400">No attendance history to show yet.</p>
      ) : (
        <div className="space-y-5">
          {/* Totals */}
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Present" value={summary.presentDays} tone="emerald" />
            <Stat label="Leave" value={summary.leaveDays} tone="rose" />
            <Stat
              label="Attendance"
              value={`${summary.attendancePercentage}%`}
              tone={summary.attendancePercentage >= 70 ? 'emerald' : 'amber'}
            />
          </div>

          <p className="text-xs text-slate-500">
            Counted over {summary.applicableDays} day
            {summary.applicableDays === 1 ? '' : 's'}, from {summary.startDate} to{' '}
            {summary.endDate}.
          </p>

          {/* Calendar */}
          <div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAY_INITIALS.map((initial, i) => (
                <div
                  key={i}
                  className="text-center text-[10px] font-semibold text-slate-500 uppercase"
                >
                  {initial}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlanks }, (_, i) => (
                <div key={`blank-${i}`} className="aspect-square" />
              ))}

              {summary.days.map((day) => (
                <DayCell
                  key={day.date}
                  day={day}
                  isToday={day.date === effectiveTodayKey}
                  isSelected={selectedDay?.date === day.date}
                  onSelect={setSelectedDay}
                  timeZone={timeZone}
                />
              ))}
            </div>
          </div>

          {selectedDay && (
            <div className="rounded-xl bg-gym-850/60 p-3 text-sm space-y-1">
              <p className="text-slate-200 font-medium">
                {weekdayLabel(selectedDay.date, { short: false })}, {selectedDay.date}
              </p>
              {selectedDay.status === 'Present' ? (
                <p className="text-emerald-300 text-xs">
                  Checked in at {firstCheckInLabel(selectedDay.checkIns, timeZone) || 'an unrecorded time'}
                </p>
              ) : (
                <p className="text-rose-300 text-xs">Did not attend</p>
              )}
            </div>
          )}

          {summary.presentDays === 0 && (
            <p className="text-xs text-slate-500">{EmptyMessage(summary)}</p>
          )}

          {months.length > 1 && (
            <p className="text-xs text-slate-600">
              {months.length} month{months.length === 1 ? '' : 's'} on record
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: 'text-emerald-300',
    rose: 'text-rose-300',
    amber: 'text-amber-300',
  };

  return (
    <div className="rounded-xl bg-gym-850/60 p-3 text-center">
      <p className={cn('text-xl font-semibold', tones[tone])}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
