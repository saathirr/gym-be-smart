import { describe, it, expect, beforeEach, vi } from 'vitest';

const deleteEqMock = vi.fn();
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
const selectSingleMock = vi.fn();
const selectMock = vi.fn(() => ({
  eq: vi.fn(() => ({
    maybeSingle: selectSingleMock,
  })),
}));

const rpcMock = vi.fn();

const fromMock = vi.fn((table) => {
  if (table === 'members') {
    return {
      delete: deleteMock,
      select: selectMock,
    };
  }
  return {};
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args) => fromMock(...args),
    rpc: (...args) => rpcMock(...args),
  },
}));

vi.mock('../lib/supabaseErrors', () => ({
  toMessage: (error, fallback) => error?.message || fallback || String(error),
  isMissingFunction: (error) => Boolean(error?.code === 'PGRST202' || /function .* does not exist/i.test(error?.message || '')),
}));

vi.mock('./storageService', () => ({
  storageService: {
    deletePhoto: vi.fn().mockResolvedValue(true),
    isStoredPhotoPath: (path) => typeof path === 'string' && path.includes('/'),
  },
}));

vi.mock('./activityLogService', () => ({
  activityLogService: {
    logActivity: vi.fn().mockResolvedValue({ id: 'log-1' }),
  },
}));

const { memberService } = await import('./memberService');
const { storageService } = await import('./storageService');
const { activityLogService } = await import('./activityLogService');

describe('memberService.deleteMember', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws an error if no member ID is provided', async () => {
    await expect(memberService.deleteMember(null)).rejects.toThrow('A member ID is required.');
  });

  it('deletes member using atomic RPC when RPC succeeds', async () => {
    rpcMock.mockResolvedValue({ data: { success: true }, error: null });

    const result = await memberService.deleteMember('mem-123', {
      member: {
        id: 'mem-123',
        full_name: 'Kasun Perera',
        member_code: 'BSG-1001',
      },
    });

    expect(result).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith('delete_member_completely', {
      p_member_id: 'mem-123',
    });
    expect(activityLogService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MEMBER_DELETED',
        category: 'Members',
        entityId: 'mem-123',
      })
    );
  });

  it('falls back to direct table delete if RPC is missing', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'function delete_member_completely does not exist' },
    });
    deleteEqMock.mockResolvedValue({ error: null });

    const result = await memberService.deleteMember('mem-123', {
      member: {
        id: 'mem-123',
        full_name: 'Kasun Perera',
        member_code: 'BSG-1001',
      },
    });

    expect(result).toBe(true);
    expect(fromMock).toHaveBeenCalledWith('members');
    expect(deleteMock).toHaveBeenCalled();
    expect(deleteEqMock).toHaveBeenCalledWith('id', 'mem-123');
  });

  it('cleans up avatar photo in storage when an avatar exists', async () => {
    rpcMock.mockResolvedValue({ data: { success: true }, error: null });

    await memberService.deleteMember('mem-123', {
      avatarUrl: 'mem-123/photo.jpg',
      member: {
        id: 'mem-123',
        full_name: 'Kasun Perera',
        avatar_url: 'mem-123/photo.jpg',
      },
    });

    expect(storageService.deletePhoto).toHaveBeenCalledWith('mem-123/photo.jpg');
  });

  it('fetches member info before delete if member is not passed in options', async () => {
    selectSingleMock.mockResolvedValue({
      data: {
        id: 'mem-456',
        full_name: 'Nimal Silva',
        member_code: 'BSG-1002',
        avatar_url: 'mem-456/avatar.jpg',
      },
      error: null,
    });
    rpcMock.mockResolvedValue({ data: { success: true }, error: null });

    await memberService.deleteMember('mem-456');

    expect(selectMock).toHaveBeenCalled();
    expect(storageService.deletePhoto).toHaveBeenCalledWith('mem-456/avatar.jpg');
    expect(activityLogService.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.stringContaining('Nimal Silva'),
      })
    );
  });

  it('propagates an error if deletion fails in database', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '23503', message: 'Foreign key violation' },
    });

    await expect(memberService.deleteMember('mem-123')).rejects.toThrow('Foreign key violation');
  });
});
