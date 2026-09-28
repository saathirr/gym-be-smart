import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  CalendarRange,
  CreditCard,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  QrCode,
  UserRound,
} from 'lucide-react';
import { memberService } from '../services/memberService';
import { attendanceService, getClubToday } from '../services/attendanceService';
import { settingsService } from '../services/settingsService';
import { toDateKey } from '../utils/attendanceMath';
import { buildGymCardData } from '../utils/gymCard';
import { formatPhone } from '../utils/phone';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { MemberPhoto } from '../components/members/MemberPhoto';
import { MemberAttendanceHistory } from '../components/members/MemberAttendanceHistory';
import { GymCardPanel } from '../components/members/GymCardPanel';
import { cn } from '../utils/cn';

// The five areas of a player record, in the order they are read: who they are,
// how they have been coming in, what they are paying for, what they have paid,
// and the card that gets them through the door.
//
// The nav is anchors rather than tabs on purpose. Nothing is hidden behind a
// click, so the page can still be printed or scrolled end to end, and the
// section ids double as deep links.
const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'membership', label: 'Membership' },
  { id: 'payments', label: 'Payments' },
  { id: 'gym-card', label: 'Gym Card' },
];

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-sm text-slate-200 break-words">{value}</p>
      </div>
    </div>
  );
}

function statusVariant(status) {
  if (status === 'Active') return 'emerald';
  if (status === 'Expiring') return 'amber';
  if (status === 'Suspended') return 'rose';
  return 'default';
}

function formatDate(value) {
  if (!value) return null;
  const key = toDateKey(value);
  if (!key) return String(value);
  return key;
}

function formatMoney(amount, currency = 'LKR') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return `${currency} ${value.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
}

export function PlayerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [member, setMember] = useState(null);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [settings, setSettings] = useState(null);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setError(null);
    try {
      const [profile, club] = await Promise.all([
        memberService.getMemberProfile(id),
        settingsService.getGymSettings(),
      ]);

      if (!profile) {
        setMember(null);
        setError('That player could not be found.');
        return;
      }

      setMember(profile);
      setSettings(club);

      // The club's current date comes from the database, so the calendar and the
      // expiry checks agree with what the check-in engine will write.
      const clubToday = await getClubToday({ timeZone: club.timezone });
      setToday(clubToday);

      setAttendanceLoading(true);
      try {
        const rows = await attendanceService.getMemberAttendance({ memberId: id });
        setAttendanceRows(rows);
      } finally {
        setAttendanceLoading(false);
      }
    } catch (err) {
      setError(err.message || 'The profile could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // The attendance cutoff is the player's registration date. members has no
  // registration_date column, so created_at is the join date; it is converted
  // to a club-local key so a player registered at 23:30 is not assessed from
  // the following day.
  const registrationDate = useMemo(
    () => toDateKey(member?.created_at, settings?.timezone),
    [member?.created_at, settings?.timezone]
  );

  // One QR payload source for the whole app: the card, the PDF and this pass all
  // read buildGymCardData, so the code on the badge and the code at the door
  // cannot drift apart. It carries the opaque token and nothing else.
  const qrPayload = useMemo(
    () => buildGymCardData(member, { gymName: settings?.gym_name })?.qrPayload || '',
    [member, settings?.gym_name]
  );

  // Scroll spy for the section nav. IntersectionObserver rather than a scroll
  // handler: it fires on layout changes too, so a section that grows when the
  // month calendar loads still marks itself correctly.
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof document === 'undefined') {
      return undefined;
    }

    const seen = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => seen.set(entry.target.id, entry.isIntersecting));
        // The topmost visible section wins, so scrolling up through a short
        // section does not leave the nav showing the one below it.
        const visible = SECTIONS.find((section) => seen.get(section.id));
        if (visible) setActiveSection(visible.id);
      },
      { rootMargin: '-25% 0px -55% 0px', threshold: 0 }
    );

    SECTIONS.forEach((section) => {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [member?.id]);

  const scrollToSection = useCallback((id) => {
    const node = typeof document === 'undefined' ? null : document.getElementById(id);
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-lg bg-gym-850/60 animate-pulse" />
        <div className="h-64 rounded-xl bg-gym-900/70 animate-pulse" />
      </div>
    );
  }

  if (error || !member) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Player profile</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-300">{error || 'That player could not be found.'}</p>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/members')}>Back to members</Button>
            <Button variant="ghost" onClick={load}>
              Try again
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const currency = settings?.currency || 'LKR';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('/members')}>
            Members
          </Button>
          <h1 className="text-xl font-semibold text-slate-100">Player profile</h1>
        </div>

        <Badge variant={statusVariant(member.status)}>{member.status}</Badge>
      </div>

      {/* Section nav. Sticky so the record stays navigable however long the
          history is, and marked with the section actually on screen. */}
      <nav
        aria-label="Player profile sections"
        className="sticky top-2 z-10 flex gap-1 overflow-x-auto rounded-xl bg-gym-900/90 backdrop-blur border border-hairline p-1"
      >
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => scrollToSection(section.id)}
            aria-current={activeSection === section.id ? 'true' : undefined}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition',
              activeSection === section.id
                ? 'bg-brand-gold text-gym-950'
                : 'text-slate-400 hover:text-slate-100 hover:bg-gym-800'
            )}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {/* Overview */}
      <div id="overview" className="scroll-mt-20">
        <Card>
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="lg:w-64 shrink-0">
              <MemberPhoto
                photoPath={member.avatar_url}
                name={member.full_name}
                memberId={member.id}
                editable
                size="xl"
                onChanged={() => load()}
              />
            </div>

            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <h2 className="text-2xl font-semibold text-slate-100">{member.full_name}</h2>
                <p className="text-sm text-slate-400 mt-0.5">
                  {member.member_code}
                  {member.gender ? ` · ${member.gender}` : ''}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant={statusVariant(member.membership_status)}>
                  {member.plan_name}
                </Badge>
                {member.expiration_date && (
                  <Badge variant="cyan">Valid until {formatDate(member.expiration_date)}</Badge>
                )}
                <Badge variant="default">Joined {formatDate(registrationDate)}</Badge>
              </div>

              <div className="grid sm:grid-cols-2 gap-x-6 divide-y sm:divide-y-0 divide-white/5">
                <InfoRow icon={Phone} label="Phone" value={formatPhone(member.phone)} />
                <InfoRow
                  icon={MessageCircle}
                  label="WhatsApp"
                  value={formatPhone(member.whatsapp_number)}
                />
                <InfoRow icon={Mail} label="Email" value={member.email} />
                <InfoRow icon={BadgeCheck} label="NIC" value={member.nic_number} />
                <InfoRow icon={MapPin} label="District" value={member.district} />
                <InfoRow icon={MapPin} label="Address" value={member.address} />
                <InfoRow
                  icon={UserRound}
                  label="Date of birth"
                  value={formatDate(member.date_of_birth)}
                />
                <InfoRow
                  icon={Phone}
                  label="Emergency contact"
                  value={formatPhone(member.emergency_contact)}
                />
              </div>

              {member.medical_conditions && (
                <div className="rounded-xl bg-amber-500/10 border-l-2 border-amber-500 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-amber-400 mb-0.5">
                    Medical note
                  </p>
                  <p className="text-sm text-amber-100">{member.medical_conditions}</p>
                </div>
              )}
            </div>

            {/* The pass itself, so staff can show it from the profile without
                opening the members table. Same payload as the card and the PDF. */}
            <div className="lg:w-52 shrink-0">
              <div className="flex flex-col items-center gap-2">
                <div className="p-3 rounded-2xl bg-white shadow-xl">
                  {qrPayload ? (
                    <QRCodeSVG value={qrPayload} size={132} level="H" includeMargin />
                  ) : (
                    <div className="w-[132px] h-[132px] flex items-center justify-center text-[10px] text-center text-slate-500 p-2">
                      No QR token on this record
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <QrCode className="w-3 h-3" />
                  Unique pass code
                </p>
                <p className="text-[10px] text-slate-500 text-center">
                  Encodes the member token only. No name, phone or NIC.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Attendance */}
      <div id="attendance" className="scroll-mt-20">
        <MemberAttendanceHistory
          attendanceRows={attendanceRows}
          registrationDate={registrationDate}
          timeZone={settings?.timezone}
          today={today}
          loading={attendanceLoading}
        />
      </div>

      {/* Gym card */}
      <div id="gym-card" className="scroll-mt-20">
        <Card>
          <CardHeader>
            <CardTitle icon={BadgeCheck}>Gym card</CardTitle>
          </CardHeader>
          <GymCardPanel member={member} gymName={settings?.gym_name} />
        </Card>
      </div>

      {/* History */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div id="membership" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle icon={CalendarRange}>Membership history</CardTitle>
            </CardHeader>

            {member.membershipHistory.length === 0 ? (
              <p className="text-sm text-slate-400">No memberships recorded.</p>
            ) : (
              <ul className="space-y-2">
                {member.membershipHistory.map((entry) => (
                  <li
                    key={entry.id}
                    className="rounded-xl bg-gym-850/50 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-medium truncate">
                        {entry.plans?.name || 'Unknown plan'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(entry.start_date)} to {formatDate(entry.end_date)}
                      </p>
                    </div>
                    <Badge variant={statusVariant(entry.status)}>{entry.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div id="payments" className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle icon={CreditCard}>Payment history</CardTitle>
            </CardHeader>

            {member.paymentHistory.length === 0 ? (
              <p className="text-sm text-slate-400">No payments recorded.</p>
            ) : (
              <ul className="space-y-2">
                {member.paymentHistory.map((payment) => (
                  <li
                    key={payment.id}
                    className="rounded-xl bg-gym-850/50 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-medium">
                        {formatMoney(payment.amount, currency) || payment.amount}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {formatDate(payment.transaction_date)} · {payment.payment_method}
                        {payment.receipt_number ? ` · ${payment.receipt_number}` : ''}
                      </p>
                    </div>
                    <Badge variant={payment.payment_status === 'Paid' ? 'emerald' : 'amber'}>
                      {payment.payment_status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="flex justify-end">
        <Link
          to="/attendance"
          className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200"
        >
          <Activity className="w-3.5 h-3.5" />
          See the full attendance log
        </Link>
      </div>
    </div>
  );
}
