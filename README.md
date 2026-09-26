# Be Smart Gym Management System

A responsive Gym Management web application built with React, Vite, Tailwind CSS, Supabase, Recharts and Lucide icons. Handles member tracking, membership subscriptions, QR-code attendance, payment auditing and financial analytics for single- and multi-branch fitness centres.

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

4. **Attendance & QR Scanner**
   - Camera-based scanning via `html5-qrcode`, with manual check-in fallback.
   - Timestamped attendance log, duplicate check-in protection.

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

## Project Structure

```
Gym/
├── .env.example
├── .htaccess                  # Apache/XAMPP SPA fallback
├── index.html
├── package.json
├── postcss.config.js
├── supabase_schema.sql        # full schema + RLS, run this first
├── tailwind.config.js
├── vercel.json                # Vercel SPA rewrites
├── vite.config.js
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
    │   └── common/            # StatCard, PageHeader
    ├── contexts/
    │   ├── AuthContext.jsx
    │   ├── AuthContextInstance.js
    │   ├── GymContext.jsx     # club settings + branches
    │   └── GymContextInstance.js
    ├── hooks/
    │   ├── useAuth.js
    │   └── useGym.js
    ├── layouts/
    │   ├── DashboardLayout.jsx
    │   └── AuthLayout.jsx
    ├── lib/
    │   ├── supabase.js        # client, created only when configured
    │   └── supabaseErrors.js  # error-code -> readable message
    ├── pages/                 # Dashboard, Members, Memberships, Plans,
    │                          # Attendance, QRScanner, Payments, Reports,
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
    │   └── staffService.js
    └── utils/
        ├── cn.js
        ├── constants.js
        └── formatters.js
```

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

Run `supabase_schema.sql` in the Supabase SQL editor. It is idempotent, so it is safe to re-run after an update. It creates:

`profiles`, `gym_settings`, `branches`, `plans`, `members`, `memberships`, `attendance`, `payments`, the `current_role()` / `is_admin()` / `is_bootstrap_needed()` helper functions, the `next_member_code()` and `next_receipt_number()` sequences, and all RLS policies.

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
