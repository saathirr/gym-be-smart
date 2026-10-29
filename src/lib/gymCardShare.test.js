import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  shareGymCardWhatsApp,
  triggerBrowserDownload,
} from './gymCardShare';

const dummyMember = {
  full_name: 'Saathir New',
  member_code: 'BSG-1070',
  plan_name: 'Monthly',
  expiration_date: '2026-11-28',
  phone: '0771234567',
  whatsapp_number: '0771234567',
};

describe('shareGymCardWhatsApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a missing member', async () => {
    await expect(shareGymCardWhatsApp(null)).rejects.toThrow(/no member/i);
    await expect(shareGymCardWhatsApp(undefined)).rejects.toThrow(/no member/i);
  });

  it('handles triggerBrowserDownload gracefully with null', () => {
    expect(() => triggerBrowserDownload(null, 'test.jpg')).not.toThrow();
  });
});
