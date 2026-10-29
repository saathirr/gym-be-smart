import { describe, it, expect } from 'vitest';
import {
  createGymCardJpg,
  shareGymCardJpgWhatsApp,
} from './gymCardImage';

describe('gymCardImage - input validation', () => {
  it('rejects a missing member in createGymCardJpg', async () => {
    await expect(createGymCardJpg(null)).rejects.toThrow(/no member/i);
    await expect(createGymCardJpg(undefined)).rejects.toThrow(/no member/i);
  });

  it('rejects a missing member in shareGymCardJpgWhatsApp', async () => {
    await expect(shareGymCardJpgWhatsApp(null)).rejects.toThrow(/no member/i);
    await expect(shareGymCardJpgWhatsApp(undefined)).rejects.toThrow(/no member/i);
  });
});
