# Be Smart Gym Management System

A responsive Gym Management web application built with React, Vite, Tailwind CSS, Supabase, Recharts, jsPDF and Lucide icons. Handles member tracking, membership subscriptions, QR-code attendance, payment auditing and financial analytics for single- and multi-branch fitness centres.

## Key Modules

1. **Authentication & Roles**
   - Supabase Auth email/password sign-in.
   - `admin` and `staff` roles enforced by Row Level Security, plus a `prevent_role_escalation` trigger so nobody can promote themselves.
   - First-run setup flow that creates the initial admin, then locks itself down.

2. **Dashboard & Analytics**
   - KPIs: active members, today's attendance, month and total revenue, expiring subscriptions.
   - Weekly attendance and 6-month revenue charts, recent check-in feed, expiry alerts.

3. **Member Management**
   - Profiles with contact details, emergency contact, medical notes, branch and plan assignment.
   - Unique QR code per member, membership status tracking (Active, Expiring, Expired, Suspended).
   - Photo picker on the registration and edit forms, thumbnails in the members list, and a link into each player's profile.

4. **Attendance & QR Scanner**
   - Camera-based scanning via `html5-qrcode`, with manual check-in fallback.
   - Timestamped attendance log, one row per member per club-local day, enforced in the database by a unique index.
   - A repeated scan reports "already checked in at 07:12" instead of writing a second record.

5. **Memberships & Plans**
   - Custom plans (duration, price, feature list) with active/inactive toggle.
   - Renewal workflows, expiring-soon warnings, one-open-membership-per-member enforced by a partial unique index.

6. **Payments & Invoicing**
   - Transaction log with Cash, Card, Bank Transfer and Online methods.
   - Auto-generated receipt numbers, payment status audit, configurable currency and invoice footer.

7. **Reports**
   - Revenue, attendance frequency and member growth reports.

8. **Settings**
   - Club profile, opening hours, currency, invoice footer.
   - Branch management and staff role management.

9. **Player Profiles** (`/members/:id`)
   - Photo, contact details, medical note, membership history and payment history for one player.
   - Monthly attendance calendar: distinct days attended, counted from the later of the 1st of the month and the player's join date, and never into the future. Days before joining and days still to come render as blank, not as "Leave".
   - Five sections - Overview, Attendance, Membership, Payments, Gym Card - behind a sticky nav that marks the section on screen. Nothing is hidden behind a tab, so the record still prints and scrolls end to end.
   - The pass itself sits in the overview, drawn from the same payload builder as the card and the PDF, so the code at the door cannot drift from the code on the card.
   - Reachable from the members list (click a name) and from the scanner result.

10. **Gym Cards**
    - On-screen card showing only what the front desk needs: photo, name, member code, plan, expiry and QR code. No NIC, address, phone or date of birth, because the card is photographed and left on a desk.
    - Print-ready PDF (85.6 x 54 mm, 300 dpi) drawn in the browser, plus a WhatsApp share that opens the chat with the message written for you to attach the file by hand.

11. **Members list**
    - Search finds a player by name, member code, NIC, email, or a phone number written as `077 123 4567`, `+94771234567` or `771234567` - all three forms are tried, including when the number is typed next to a name.
    - A compact Present/Leave column for the current month for every visible row, batched into one request per 100 players, counted by the same rules as the profile calendar. The day-by-day record stays on the profile.
    - Registering a player opens their pass immediately, with a link straight to their profile.

## Project Structure

```
Gym/
├── .env.example
├── .htaccess                  # Apache/XAMPP SPA fallback
├── index.html
├── package.json
├── postcss.config.js
├── supabase_schema.sql        # full schema + RLS, run this first
├── supabase_migration_phase2_daypass_attendance.sql
├── supabase_migration_phase3_player_profiles.sql
├── tailwind.config.js
├── vercel.json                # Vercel SPA rewrites
├── vite.config.js
├── vitest.config.js           # test config, kept separate from the build
├── public/
│   ├── _redirects             # Netlify / Cloudflare Pages SPA fallback
│   ├── favicon.ico
│   └── favicon.svg
└── src/
    ├── main.jsx
    ├── App.jsx                # config gate -> BrowserRouter -> providers
    ├── index.css
    ├── components/
    │   ├── ui/                # Button, Card, Input, Badge, Modal
    │   ├── common/            # StatCard, PageHeader, GymLogo
    │   └── members/           # MemberPhoto, PhotoField, GymCardPanel,
    │                          # MemberAttendanceHistory
    ├── contexts/
    │   ├── AuthContext.jsx
    │   ├── AuthContextInstance.js
    │   ├── GymContext.jsx     # club settings + branches
    │   ├── GymContextInstance.js
    │   ├── ThemeContext.jsx   # light/dark, from the logo's own colours
    │   └── ThemeContextInstance.js
    ├── hooks/
    │   ├── useAuth.js
    │   ├── useGym.js
    │   ├── useTheme.js
    │   └── useMemberPhotoUrls.js  # batch-signs photo paths for the list
    ├── layouts/
    │   ├── DashboardLayout.jsx
    │   └── AuthLayout.jsx
    ├── lib/
    │   ├── supabase.js        # client, created only when configured
    │   ├── supabaseErrors.js  # error-code -> readable message
    │   └── gymCardPdf.js      # gym card drawn straight into a PDF
    ├── pages/                 # Dashboard, Members, PlayerProfile, Memberships,
    │                          # Plans, Attendance, QRScanner, Payments, Reports,
    │                          # Settings, Login, Setup, SetupRequired, NotFound
    ├── routes/
    │   └── AppRoutes.jsx
    ├── services/              # one module per domain, all Supabase calls
    │   ├── authService.js
    │   ├── memberService.js
    │   ├── membershipService.js
    │   ├── planService.js
    │   ├── attendanceService.js
    │   ├── paymentService.js
    │   ├── dashboardService.js
    │   ├── settingsService.js
    │   ├── staffService.js
    │   └── storageService.js  # private member-photos bucket
    └── utils/                 # pure logic, unit tested
        ├── attendanceMath.js  # club-local dates and monthly attendance
        ├── membership.js      # admission rules for the front door
        ├── gymCard.js         # gym card data + filenames
        ├── phone.js           # Sri Lankan number normalisation
        ├── brand.js
        ├── chartTheme.js
        ├── cn.js
        ├── constants.js
        └── formatters.js
```

Tests sit next to the file they cover as `<name>.test.js(x)` and are picked up by
`npm test`; see [Tests](#tests).

## Getting Started

### Prerequisites
- Node.js v18+
- A Supabase project

### Installation

```bash
cd c:/xampp/htdocs/Gym
npm install
```

### 1. Create the database

Run the SQL files in the Supabase SQL editor, in this order. All three are idempotent, so re-running one after an update is safe.

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase_schema.sql` | Tables, sequences, helper functions and RLS policies. |
| 2 | `supabase_migration_phase2_daypass_attendance.sql` | Club timezone, `attendance.attendance_date`, the reporting indexes, the one-check-in-per-day unique index, day-pass plans and the private `member-photos` bucket. |
| 3 | `supabase_migration_phase3_player_profiles.sql` | The `log_attendance()` check-in engine and a re-assertion of the photo bucket and its policies. |

`supabase_schema.sql` creates `profiles`, `gym_settings`, `branches`, `plans`, `members`, `memberships`, `attendance`, `payments`, the `current_role()` / `is_admin()` / `is_bootstrap_needed()` helper functions, the `next_member_code()` and `next_receipt_number()` sequences, and all RLS policies.

Phase 3 refuses to run if the attendance table already holds two check-ins for the same member on the same club-local day, and prints the diagnostic query plus the admin-only `dedupe_attendance()` call to resolve them. That is deliberate: merging attendance history is the club's decision, not the migration's. See section 7 of that file.

The app does not require phase 3 to work. `attendanceService.recordCheckIn` falls back to a direct insert with a duplicate-key catch when `log_attendance()` is missing, so check-ins behave correctly before and after the migration is applied.

### 2. Configure the environment

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_GYM_NAME=Be Smart Fitness Club
```

`VITE_GYM_NAME` is only used on the sign-in screen, before the database can be read. Once signed in, the name from `gym_settings` takes over.

If these values are missing the app renders a "Database not connected" screen instead of the dashboard, so it can never silently run on placeholder data.

### 3. Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production bundle in dist/
npm run preview  # serve the production bundle locally
npm run lint
```

## Tests

```bash
npm test           # one run
npm run test:watch # re-runs on change
```

The suite covers the pure logic that is expensive to get wrong and easy to break silently: club-local date maths and the monthly attendance summary (including the batched version behind the members list column), the front-door admission rules, Sri Lankan phone normalisation and the search variants built from it, the gym card data and the PDF it produces, the storage path rules, the attendance and member services, and the theme contrast check. Component tests render to static markup, so there is no DOM shim to keep in sync.

The one thing the suite cannot check is the database's own guarantees. One row per member per club day, the duplicate report, and the signed photo bucket are enforced in Postgres, so they are verified by the manual steps in [Getting Started](#1-create-the-database) rather than by a mock.

## Deployment

This is a single-page app using `BrowserRouter`, so the server must return `index.html` for unknown paths or deep links such as `/members` will 404 on refresh. Rewrite config is included for the common targets:

| Target | File |
| --- | --- |
| Vercel | `vercel.json` |
| Apache / XAMPP | `.htaccess` |
| Netlify, Cloudflare Pages | `public/_redirects` |

Vite only copies `public/` into `dist/`. If you serve `dist/` as the Apache document root, copy `.htaccess` into `dist/` as well, and make sure `AllowOverride All` is set for that directory.

Note: `index.html` and `assets/` use absolute paths (`/assets/...`), so the app must be served from the root of a domain. To host it under a sub-path, set `base` in `vite.config.js` to match.

## Current Status

- **Phase 1 — done**: Vite + React + Tailwind setup, dark responsive sidebar, dashboard KPIs and charts, glassmorphism login, centralised Supabase client.
- **Phase 2 — done**: live Supabase schema, RLS policies, role-based access, member/membership/plan/payment/attendance CRUD.
- **Phase 3 — done**: QR scanner, renewals, receipt generation, reports, club settings, branches, staff management.
- **Phase 4 — done**: player profiles, member photos in a private bucket, printable gym cards, and attendance counted in club-local days with a database-enforced one-check-in-per-day rule.
- Branded light/dark theming, with a contrast test that fails if either theme drifts.
- 260 unit and component tests, run with `npm test`.

Note: the "phase" numbers in the SQL filenames are the database migrations, not the phases above. Run them in the order given in [Getting Started](#1-create-the-database).
