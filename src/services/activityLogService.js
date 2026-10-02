import { supabase } from '../lib/supabase';
import { toMessage } from '../lib/supabaseErrors';

const LOGS_STORAGE_KEY = 'besmart_activity_logs_v1';

const INITIAL_LOGS = [
  {
    id: 'log-101',
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    action: 'MEMBER_CHECK_IN',
    category: 'Attendance',
    performed_by: 'Super Admin (Owner)',
    performer_email: 'admin@besmartfitness.lk',
    ip_address: '127.0.0.1',
    entity_type: 'Attendance',
    entity_id: 'att-991',
    details: 'Logged check-in for Kasun Kalhara Perera (M-1001) via QR Scanner',
    changes: { method: 'QR_SCAN', status: 'Granted', result: 'Success' },
  },
  {
    id: 'log-102',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    action: 'BULK_MEMBER_IMPORT',
    category: 'Members',
    performed_by: 'Super Admin (Owner)',
    performer_email: 'admin@besmartfitness.lk',
    ip_address: '127.0.0.1',
    entity_type: 'Member',
    entity_id: 'bulk-import-batch',
    details: 'Bulk imported members from Excel file (Be_Smart_Members_2026.xlsx)',
    changes: { total_imported: 12, plan_assigned: 'Monthly Package', errors: 0 },
  },
  {
    id: 'log-103',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    action: 'MEMBER_REGISTERED',
    category: 'Members',
    performed_by: 'Super Admin (Owner)',
    performer_email: 'admin@besmartfitness.lk',
    ip_address: '127.0.0.1',
    entity_type: 'Member',
    entity_id: 'mem-102',
    details: 'Registered new member: Dilhani Silva (NIC: 987654321V)',
    changes: { plan: 'Monthly Package', payment: 'LKR 5,000.00 (Cash)' },
  },
  {
    id: 'log-104',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    action: 'STAFF_ROLE_CHANGED',
    category: 'Admin Access',
    performed_by: 'Super Admin (Owner)',
    performer_email: 'admin@besmartfitness.lk',
    ip_address: '127.0.0.1',
    entity_type: 'Staff',
    entity_id: 'usr-staff-2',
    details: 'Updated user role for Nimal Siriwardena from Staff to Admin',
    changes: { old_role: 'Staff', new_role: 'Admin' },
  },
  {
    id: 'log-105',
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    action: 'PLAN_PRICE_UPDATED',
    category: 'Plans',
    performed_by: 'Super Admin (Owner)',
    performer_email: 'admin@besmartfitness.lk',
    ip_address: '127.0.0.1',
    entity_type: 'Plan',
    entity_id: 'plan-1',
    details: 'Updated price for Annual VIP Plan',
    changes: { old_price: 'LKR 45,000.00', new_price: 'LKR 50,000.00' },
  },
];

function loadLocalLogs() {
  try {
    const raw = localStorage.getItem(LOGS_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(INITIAL_LOGS));
      return INITIAL_LOGS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_LOGS;
  }
}

function saveLocalLogs(logs) {
  try {
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(logs));
  } catch (e) {
    console.error('Failed to persist local activity logs:', e);
  }
}

export const activityLogService = {
  async getLogs({ search = '', category = 'ALL', limit = 100 } = {}) {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!error && data && data.length > 0) {
        return data;
      }
    } catch {
      // Fallback to local storage audit trail if database table does not exist
    }

    let logs = loadLocalLogs();

    if (category && category !== 'ALL') {
      logs = logs.filter((l) => l.category === category || l.action === category);
    }

    if (search.trim()) {
      const term = search.toLowerCase().trim();
      logs = logs.filter(
        (l) =>
          l.details.toLowerCase().includes(term) ||
          l.performed_by.toLowerCase().includes(term) ||
          l.action.toLowerCase().includes(term)
      );
    }

    return logs.slice(0, limit);
  },

  async getChangeLogs(limit = 50) {
    const logs = await this.getLogs({ limit });
    return logs.filter((l) => l.changes && Object.keys(l.changes).length > 0);
  },

  async logActivity({ action, category = 'General', details, changes = null, entityType = null, entityId = null, user = null }) {
    const newLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      action,
      category,
      performed_by: user?.full_name || 'Super Admin (Owner)',
      performer_email: user?.email || 'admin@besmartfitness.lk',
      ip_address: '127.0.0.1',
      entity_type: entityType,
      entity_id: entityId,
      details,
      changes,
    };

    try {
      await supabase.from('activity_logs').insert([
        {
          action: newLog.action,
          category: newLog.category,
          performed_by: newLog.performed_by,
          performer_email: newLog.performer_email,
          entity_type: newLog.entity_type,
          entity_id: newLog.entity_id,
          details: newLog.details,
          changes: newLog.changes,
        },
      ]);
    } catch {
      // Silent catch for optional table
    }

    const currentLogs = loadLocalLogs();
    const updated = [newLog, ...currentLogs];
    saveLocalLogs(updated);
    return newLog;
  },
};
