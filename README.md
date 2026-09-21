# Be Smart Gym Management System

A modern, high-performance, responsive Gym Management Web Application built with React, Vite, Tailwind CSS, Lucide Icons, Recharts, and Supabase.

## System Architecture Overview

Be Smart Gym is designed to streamline administrative operations, member tracking, membership subscriptions, attendance scanning via QR code, payment auditing, and financial analytics for single-branch and multi-branch fitness centers.

### Key Modules & Capabilities

1. **Authentication & Role-Based Access**
   - Secure login via Supabase Auth.
   - Row Level Security (RLS) enforcement at database layer.
   - Admin and Staff roles with audit logging.

2. **Dashboard & Analytics**
   - Key Performance Indicators (Active Members, Daily Attendance, Revenue, Expiring Subscriptions).
   - Real-time interactive charts (Attendance trends, Revenue breakdowns).
   - Recent check-in live feeds and expiration alerts.

3. **Member Management**
   - Profile creation with contact details, emergency contacts, medical notes, and assigned plan.
   - Unique QR code generation for instant check-in scanning.
   - Membership status tracking (Active, Expiring, Expired, Suspended).

4. **Attendance & QR Scanner**
   - Camera-based QR Scanner for rapid check-ins.
   - Manual check-in fallback with member lookup.
   - Real-time attendance logging with time-stamps.

5. **Memberships & Plans**
   - Custom plan definition (Monthly, Quarterly, Annual, VIP, Personal Training).
   - Automated expiration warnings and renewal workflows.

6. **Payments & Invoicing**
   - Transaction logging (Cash, Card, UPI/Online).
   - Receipt generation and payment status audit.

7. **Reports & Exports**
   - Revenue reports, attendance frequency reports, member growth statistics.

8. **Settings & Configuration**
   - Gym profile details, operational hours, notification preferences, security settings.

---

## Project Structure

```
Gym/
├── .env.example
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js
├── README.md
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── index.css
    ├── components/
    │   ├── ui/
    │   │   ├── Button.jsx
    │   │   ├── Card.jsx
    │   │   ├── Input.jsx
    │   │   ├── Badge.jsx
    │   │   ├── Modal.jsx
    │   │   └── Table.jsx
    │   └── common/
    │       ├── StatCard.jsx
    │       └── PageHeader.jsx
    ├── layouts/
    │   ├── DashboardLayout.jsx
    │   └── AuthLayout.jsx
    ├── pages/
    │   ├── LoginPage.jsx
    │   ├── DashboardPage.jsx
    │   ├── MembersPage.jsx
    │   ├── AttendancePage.jsx
    │   ├── QRScannerPage.jsx
    │   ├── MembershipsPage.jsx
    │   ├── PlansPage.jsx
    │   ├── PaymentsPage.jsx
    │   ├── ReportsPage.jsx
    │   ├── SettingsPage.jsx
    │   └── NotFoundPage.jsx
    ├── features/
    ├── hooks/
    │   └── useAuth.js
    ├── services/
    │   └── authService.js
    ├── lib/
    │   └── supabase.js
    ├── utils/
    │   ├── cn.js
    │   └── formatters.js
    ├── contexts/
    │   └── AuthContext.jsx
    └── routes/
        └── AppRoutes.jsx
```

---

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm or yarn

### Installation
1. Clone or navigate to the directory:
   ```bash
   cd c:/xampp/htdocs/Gym
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy environment variables:
   ```bash
   cp .env.example .env
   ```
4. Configure your Supabase credentials in `.env`:
   ```env
   VITE_SUPABASE_URL=https://your-supabase-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
5. Start development server:
   ```bash
   npm run dev
   ```

---

## Phase Roadmap

- **Phase 1 (Completed)**: Core UI architecture, Vite + React setup, Tailwind CSS styling system, responsive dark sidebar navigation (10 modules), Dashboard KPI overview with charts, Glassmorphism Login page, centralized Supabase client integration, placeholder routes.
- **Phase 2 (Upcoming)**: Supabase database schema setup (Tables: `profiles`, `plans`, `members`, `memberships`, `attendance`, `payments`), RLS policies, live authentication, and Member management CRUD.
- **Phase 3 (Upcoming)**: Live QR scanner integration, membership renewals, automated payment receipts, and advanced report exports.
