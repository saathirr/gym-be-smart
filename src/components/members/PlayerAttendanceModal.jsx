import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Clock, ListFilter, UserRound, ArrowRight } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { MemberAttendanceHistory } from './MemberAttendanceHistory';
import { attendanceService, getClubToday } from '../../services/attendanceService';
import { memberService } from '../../services/memberService';
import { toDateKey, formatTimestamp, weekdayLabel } from '../../utils/attendanceMath';
import { useGym } from '../../hooks/useGym';

export function PlayerAttendanceModal({
  member: initialMember,
  memberId,
  isOpen,
  onClose,
}) {
  const navigate = useNavigate();
  const { settings } = useGym();
  const timeZone = settings?.timezone;

  const [member, setMember] = useState(initialMember || null);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('calendar'); // 'calendar' | 'present_list'

  const effectiveMemberId = initialMember?.id || memberId;

  const loadAttendance = useCallback(async () => {
    if (!effectiveMemberId || !isOpen) return;

    setLoading(true);
    try {
      let memberDetails = initialMember;
      if (!memberDetails) {
        memberDetails = await memberService.getMemberProfile(effectiveMemberId);
        setMember(memberDetails);
      } else {
        setMember(initialMember);
      }

      const [rows, clubToday] = await Promise.all([
        attendanceService.getMemberAttendance({ memberId: effectiveMemberId }),
        getClubToday({ timeZone }),
      ]);

      setAttendanceRows(rows || []);
      setToday(clubToday);
    } catch (err) {
      console.error('Failed to load player attendance history:', err);
    } finally {
      setLoading(false);
    }
  }, [effectiveMemberId, initialMember, isOpen, timeZone]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  const registrationDate = useMemo(
    () => toDateKey(member?.created_at, timeZone),
    [member?.created_at, timeZone]
  );

  // Present records only (with check-in time)
  const presentLogs = useMemo(() => {
    return (attendanceRows || []).filter((row) => row.attendance_date || row.check_in_time);
  }, [attendanceRows]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={member ? `${member.full_name}'s Attendance Calendar` : 'Player Attendance'}
      className="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Header summary of member */}
        {member && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-gym-850/70 border border-hairline">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gym-800 border border-hairline flex items-center justify-center text-brand-gold font-bold text-base">
                {member.full_name?.charAt(0) || 'P'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-slate-100">{member.full_name}</h4>
                  <Badge variant={member.status === 'Active' ? 'emerald' : 'rose'}>
                    {member.status || 'Active'}
                  </Badge>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  {member.member_code} {member.plan_name ? `• ${member.plan_name}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1.5 text-brand-cyan hover:text-brand-cyan/80"
                onClick={() => {
                  onClose();
                  navigate(`/members/${member.id}#attendance`);
                }}
              >
                <UserRound className="w-3.5 h-3.5" />
                Full Profile
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* View mode toggle */}
        <div className="flex items-center gap-2 border-b border-hairline pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'calendar'
                ? 'bg-brand-gold text-gym-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-gym-800'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Calendar View
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('present_list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeTab === 'present_list'
                ? 'bg-brand-gold text-gym-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-gym-800'
            }`}
          >
            <ListFilter className="w-3.5 h-3.5" />
            Present Dates ({presentLogs.length})
          </button>
        </div>

        {/* Tab 1: Calendar View */}
        {activeTab === 'calendar' && (
          <MemberAttendanceHistory
            attendanceRows={attendanceRows}
            registrationDate={registrationDate}
            timeZone={timeZone}
            today={today}
            loading={loading}
          />
        )}

        {/* Tab 2: Present Dates List */}
        {activeTab === 'present_list' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              Complete list of dates and check-in times when {member?.full_name || 'this player'} was present in the gym.
            </p>

            {loading ? (
              <div className="h-40 rounded-xl bg-gym-850/50 animate-pulse" />
            ) : presentLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-gym-850/40 rounded-xl">
                No check-in records found for this player.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {presentLogs.map((log) => {
                  const dateStr = log.attendance_date || toDateKey(log.check_in_time, timeZone);
                  const dayName = weekdayLabel(dateStr, { short: false });

                  return (
                    <div
                      key={log.id || log.check_in_time}
                      className="flex items-center justify-between p-3 rounded-xl bg-gym-850/60 border border-hairline hover:bg-gym-800/60 transition text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-slate-200">
                            {dayName ? `${dayName}, ` : ''}{dateStr}
                          </p>
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3 text-slate-500" />
                            {log.check_in_time ? formatTimestamp(log.check_in_time, timeZone) : 'Check-in time recorded'}
                            {log.check_out_time ? ` · out ${formatTimestamp(log.check_out_time, timeZone)}` : ''}
                          </p>
                        </div>
                      </div>

                      <Badge variant="emerald" className="text-[10px]">
                        Present ({log.method === 'MANUAL_ENTRY' ? 'Manual' : 'QR Scan'})
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
