import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Exercises memberService against a scripted Supabase double.
//
// The two things these tests exist to pin down are the two ways member creation
// can run. With supabase_migration_phase5_atomic_member_creation.sql applied it
// is one call to create_member_with_membership; without it, it is the older
// sequence of separate requests. The fallback must only engage when the function
// is genuinely absent, because a function that raised has already rolled back
// and retrying it request by request is precisely what produces a member with no
// membership attached.

const SAVED_MEMBER = {
  id: 'M1',
  member_code: 'BSG-1001',
  qr_code_id: 'BSG-1001.ABC',
  full_name: 'Kasun Perera',
  phone: '0771234567',
  status: 'Active',
  memberships: [],
};

const PLAN = { id: 'P1', name: 'Monthly', price: 5000, duration_days: 30 };

let supabase;

function resolve(result) {
  return Promise.resolve(
    typeof result === 'function' ? result() : (result ?? { data: null, error: null })
  );
}

function makeQuery(table, op) {
  const query = {
    _result: { data: null, error: null },
    // A write sets its own result, and the .select() that follows it (PostgREST's
    // insert-then-return idiom) must not replace that with the read fixture.
    _fromWrite: false,
    select() {
      if (op === 'select' && !query._fromWrite) {
        query._result = supabase.state.selects[table] ?? { data: null, error: null };
      }
      return query;
    },
    insert(values) {
      supabase.state.calls.insert.push({ table, values: values[0] });
      query._result = supabase.state.inserts[table] ?? { data: null, error: null };
      query._fromWrite = true;
      return query;
    },
    update(values) {
      supabase.state.calls.update.push({ table, values });
      query._result = supabase.state.updates[table] ?? { data: null, error: null };
      query._fromWrite = true;
      return query;
    },
    delete() {
      supabase.state.calls.delete.push({ table });
      query._result = supabase.state.deletes[table] ?? { data: null, error: null };
      query._fromWrite = true;
      return query;
    },
    upsert(values) {
      supabase.state.calls.upsert.push({ table, values: values[0] });
      query._result = supabase.state.upserts[table] ?? { data: null, error: null };
      query._fromWrite = true;
      return query;
    },
    rpc(name, rpcArgs) {
      supabase.state.calls.rpc.push({ name, args: rpcArgs });
      const scripted = supabase.state.rpc[name] ?? { data: null, error: null };
      query._result = scripted;
      return query;
    },
    eq() {
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    maybeSingle() {
      return resolve(query._result);
    },
    single() {
      return resolve(query._result);
    },
    then(onOk, onErr) {
      return resolve(query._result).then(onOk, onErr);
    },
  };
  return query;
}

function installMock() {
  supabase = {
    state: {
      // Each entry is either a fixed result or a function, so a test can decide
      // per call whether an insert succeeds.
      rpc: {},
      inserts: {},
      selects: {},
      updates: {},
      deletes: {},
      upserts: {},
      calls: { rpc: [], insert: [], delete: [], update: [], upsert: [] },
    },
    from(table) {
      return makeQuery(table, 'select');
    },
    // Called directly by the service for functions, not chained from a table.
    rpc(name, args) {
      supabase.state.calls.rpc.push({ name, args });
      const scripted = supabase.state.rpc[name] ?? { data: null, error: null };
      return resolve(scripted);
    },
  };

  vi.doMock('../lib/supabase', () => ({ supabase }));
  vi.resetModules();
}

describe('memberService member creation', () => {
  let memberService;

  beforeEach(async () => {
    installMock();

    const s = supabase.state;
    s.rpc.create_member_with_membership = {
      data: {
        member_id: 'M1',
        member_code: 'BSG-1001',
        qr_code_id: 'BSG-1001.ABC',
        membership_id: 'MS1',
        receipt_number: 'REC-2026-00001',
      },
      error: null,
    };
    s.selects.members = { data: SAVED_MEMBER, error: null };
    s.rpc.next_member_code = { data: 'BSG-1001', error: null };
    s.rpc.next_receipt_number = { data: 'REC-2026-00001', error: null };
    s.inserts.members = { data: SAVED_MEMBER, error: null };
    s.inserts.memberships = { data: { id: 'MS1' }, error: null };
    s.inserts.payments = { data: { id: 'PAY1' }, error: null };
    s.selects.plans = { data: PLAN, error: null };
    s.selects['members, memberships'] = { data: SAVED_MEMBER, error: null };
    s.deletes.members = { data: null, error: null };

    ({ memberService } = await import('./memberService'));
  });

  afterEach(() => {
    vi.doUnmock('../lib/supabase');
    vi.resetModules();
  });

  const validPayload = {
    full_name: 'Kasun Perera',
    phone: '0771234567',
    nic_number: '199512345678',
    email: 'kasun@example.com',
    district: 'Colombo',
    address: 'No 45 Temple Road',
    gender: 'Male',
    date_of_birth: '1995-05-14',
    emergency_contact: '0777654321',
    medical_conditions: 'None',
    payment_method: 'Cash',
  };

  const dbError = (code, message, extra = {}) => ({
    code,
    message,
    details: null,
    hint: null,
    ...extra,
  });

  describe('atomic path, once the phase 5 function exists', () => {
    it('creates the member through the function and returns it', async () => {
      const member = await memberService.createMember(validPayload, 'P1');

      expect(member.member_code).toBe('BSG-1001');
      expect(member.id).toBe('M1');
      expect(supabase.state.calls.rpc[0].name).toBe('create_member_with_membership');
    });

    it('writes no member, membership or payment row of its own', async () => {
      await memberService.createMember(validPayload, 'P1');

      expect(supabase.state.calls.insert).toEqual([]);
    });

    it('passes every column the function declares', async () => {
      await memberService.createMember(validPayload, 'P1');

      expect(supabase.state.calls.rpc[0].args).toEqual({
        p_full_name: 'Kasun Perera',
        p_nic_number: '199512345678',
        p_email: 'kasun@example.com',
        p_phone: '0771234567',
        p_whatsapp_number: null,
        p_district: 'Colombo',
        p_address: 'No 45 Temple Road',
        p_gender: 'Male',
        p_date_of_birth: '1995-05-14',
        p_emergency_contact: '0777654321',
        p_medical_conditions: 'None',
        p_branch_id: null,
        p_plan_id: 'P1',
        p_payment_method: 'Cash',
      });
    });

    it('sends blank optional fields as null rather than empty strings', async () => {
      await memberService.createMember(
        { full_name: 'Blank Fields', phone: '0779999999' },
        null
      );

      const { args } = supabase.state.calls.rpc[0];
      expect(args.p_nic_number).toBeNull();
      expect(args.p_email).toBeNull();
      expect(args.p_district).toBeNull();
      expect(args.p_gender).toBeNull();
      expect(args.p_date_of_birth).toBeNull();
      expect(args.p_medical_conditions).toBeNull();
    });

    it('never sends an empty string for a text column', async () => {
      await memberService.createMember(
        { full_name: 'Empty Strings', phone: '0779999999', address: '   ', email: '' },
        null
      );

      const { args } = supabase.state.calls.rpc[0];
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') expect(value.trim(), key).not.toBe('');
      }
    });

    it('registers a member with no plan selected', async () => {
      const member = await memberService.createMember(validPayload, null);

      expect(member.id).toBe('M1');
      expect(supabase.state.calls.rpc[0].args.p_plan_id).toBeNull();
    });

    // A function that exists and raises has already rolled its own transaction
    // back. Retrying the work as separate requests here would rebuild the exact
    // partial member the function was written to prevent.
    it('does not fall back when the function exists and rejects the row', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('22007', 'invalid input syntax for type date: "34335"'),
      };

      await expect(memberService.createMember(validPayload, 'P1')).rejects.toMatchObject({
        stage: 'member-insert',
        code: '22007',
      });

      expect(supabase.state.calls.insert).toEqual([]);
      // The step-by-step path was never entered, so it never asked for a code.
      expect(supabase.state.calls.rpc.map((c) => c.name)).toEqual([
        'create_member_with_membership',
      ]);
    });

    it('surfaces the real message, not a guess about duplicates', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('22007', 'invalid input syntax for type date: "34335"'),
      };

      await expect(memberService.createMember(validPayload, 'P1')).rejects.toThrow(
        /invalid input syntax/
      );
    });
  });

  describe('fallback path, before the phase 5 function is applied', () => {
    beforeEach(() => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('PGRST202', 'Could not find the function public.create_member_with_membership'),
      };
    });

    it('still creates a member when only the plan is chosen', async () => {
      const member = await memberService.createMember(validPayload, 'P1');

      expect(member.id).toBe('M1');
      const tables = supabase.state.calls.insert.map((c) => c.table);
      expect(tables).toEqual(['members', 'memberships', 'payments']);
    });

    it('skips the membership and payment writes when no plan is chosen', async () => {
      await memberService.createMember(validPayload, null);

      expect(supabase.state.calls.insert.map((c) => c.table)).toEqual(['members']);
    });

    it('does not record a payment for a free plan', async () => {
      supabase.state.selects.plans = {
        data: { ...PLAN, price: 0 },
        error: null,
      };

      await memberService.createMember(validPayload, 'P1');

      expect(supabase.state.calls.insert.map((c) => c.table)).toEqual([
        'members',
        'memberships',
      ]);
    });

    it('stores blank optional text as null on the member row', async () => {
      await memberService.createMember(
        { full_name: 'Blank Fields', phone: '0779999999', address: '  ' },
        null
      );

      const memberInsert = supabase.state.calls.insert[0].values;
      expect(memberInsert.address).toBeNull();
      expect(memberInsert.nic_number).toBeNull();
      expect(memberInsert.gender).toBeNull();
      expect(memberInsert.district).toBeNull();
    });

    it('writes an Active status and a unique member code', async () => {
      await memberService.createMember(validPayload, null);

      const memberInsert = supabase.state.calls.insert[0].values;
      expect(memberInsert.status).toBe('Active');
      expect(memberInsert.member_code).toBe('BSG-1001');
      expect(memberInsert.qr_code_id.startsWith('BSG-1001')).toBe(true);
    });

    // Requirement: no half-created members. The fallback cannot be atomic, so it
    // removes the row it just wrote instead of leaving it behind.
    it('removes the member row when the membership write fails', async () => {
      supabase.state.inserts.memberships = {
        data: null,
        error: dbError('42501', 'new row violates row-level security policy'),
      };

      await expect(memberService.createMember(validPayload, 'P1')).rejects.toMatchObject({
        stage: 'membership',
        code: '42501',
        memberCreated: false,
      });

      expect(supabase.state.calls.delete).toEqual([{ table: 'members' }]);
    });

    it('removes the member row when the payment write fails', async () => {
      supabase.state.inserts.payments = {
        data: null,
        error: dbError('23514', 'new row violates check constraint "payments_payment_method_check"'),
      };

      await expect(memberService.createMember(validPayload, 'P1')).rejects.toMatchObject({
        stage: 'payment',
        code: '23514',
        memberCreated: false,
      });

      expect(supabase.state.calls.delete).toEqual([{ table: 'members' }]);
    });

    it('removes the member row when the plan lookup fails', async () => {
      supabase.state.selects.plans = {
        data: null,
        error: dbError('PGRST116', 'JSON object requested, multiple rows returned'),
      };

      await expect(memberService.createMember(validPayload, 'P1')).rejects.toMatchObject({
        stage: 'plan-lookup',
        memberCreated: false,
      });

      expect(supabase.state.calls.delete).toEqual([{ table: 'members' }]);
    });

    it('reports a partial only when the cleanup itself fails', async () => {
      supabase.state.inserts.payments = {
        data: null,
        error: dbError('23514', 'check constraint failed'),
      };
      supabase.state.deletes.members = {
        data: null,
        error: dbError('42501', 'delete denied'),
      };

      const error = await memberService
        .createMember(validPayload, 'P1')
        .then(() => null)
        .catch((err) => err);

      expect(error.memberCreated).toBe(true);
      expect(error.memberCode).toBe('BSG-1001');
      expect(error.detail).toMatch(/could not be cleaned up/i);
    });

    it('names the member code step when the sequence function fails', async () => {
      supabase.state.rpc.next_member_code = {
        data: null,
        error: dbError('42883', 'function public.next_member_code() does not exist'),
      };

      await expect(memberService.createMember(validPayload, 'P1')).rejects.toMatchObject({
        stage: 'member-code',
        code: '42883',
      });

      expect(supabase.state.calls.insert).toEqual([]);
    });

    it('treats a blank date of birth as no date of birth', async () => {
      await memberService.createMember(
        { full_name: 'No DOB', phone: '0779999999', date_of_birth: '' },
        null
      );

      expect(supabase.state.calls.insert[0].values.date_of_birth).toBeNull();
    });

    it('accepts an unusual NIC, because the column has no format constraint', async () => {
      // members.nic_number is nullable TEXT with no CHECK anywhere in the schema
      // files, so a synthetic value is what the database would store. Adding a
      // client-side format rule would reject data the database accepts.
      await memberService.createMember(
        { full_name: 'Test Person', phone: '0779999999', nic_number: 'TESTNIC001' },
        null
      );

      expect(supabase.state.calls.insert[0].values.nic_number).toBe('TESTNIC001');
    });
  });

  describe('bulkImportMembers', () => {
    const row = (overrides = {}) => ({
      rowId: 1,
      excelRow: 2,
      full_name: 'Kasun Perera',
      phone: '0771234567',
      nic_number: '199512345678',
      isValid: true,
      isDuplicate: false,
      errors: [],
      ...overrides,
    });

    // The shape of the original report: a twenty row sheet where every row
    // failed for one shared reason.
    const twentyRows = () =>
      Array.from({ length: 20 }, (_, i) =>
        row({
          rowId: i + 1,
          excelRow: i + 2,
          full_name: `Test Member ${i + 1}`,
          phone: `0771000${String(i).padStart(3, '0')}`,
        })
      );

    it('creates one valid member', async () => {
      const summary = await memberService.bulkImportMembers({ rows: [row()] });

      expect(summary.successCount).toBe(1);
      expect(summary.failed).toEqual([]);
      expect(summary.partial).toEqual([]);
      expect(summary.created[0].memberCode).toBe('BSG-1001');
    });

    it('creates twenty valid members, the original failing shape', async () => {
      supabase.state.rpc.create_member_with_membership = () => ({
        data: {
          member_id: 'M1',
          member_code: 'BSG-1001',
          qr_code_id: 'BSG-1001.ABC',
        },
        error: null,
      });

      const summary = await memberService.bulkImportMembers({ rows: twentyRows() });

      expect(summary.successCount).toBe(20);
      expect(summary.errorCount).toBe(0);
      expect(summary.partialCount).toBe(0);
    });

    it('reports progress once per row', async () => {
      const onProgress = vi.fn();
      await memberService.bulkImportMembers({ rows: twentyRows(), onProgress });

      expect(onProgress).toHaveBeenCalledTimes(20);
      expect(onProgress).toHaveBeenLastCalledWith(20, 20);
    });

    it('never inserts a row the validator rejected', async () => {
      const summary = await memberService.bulkImportMembers({
        rows: [
          row(),
          row({
            rowId: 2,
            excelRow: 3,
            full_name: 'Bad District',
            isValid: false,
            errors: ['Invalid district: Nowhere'],
          }),
        ],
      });

      expect(summary.successCount).toBe(1);
      expect(
        supabase.state.calls.rpc.filter((c) => c.name === 'create_member_with_membership')
      ).toHaveLength(1);
    });

    it('does not report a database failure as a duplicate phone number', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('22007', 'invalid input syntax for type date: "34335"'),
      };

      const summary = await memberService.bulkImportMembers({ rows: [row()] });

      expect(summary.errorCount).toBe(1);
      expect(summary.partialCount).toBe(0);
      expect(summary.failed[0].code).toBe('22007');
      expect(summary.failed[0].message).toMatch(/invalid input syntax/);
      expect(JSON.stringify(summary.failed[0])).not.toMatch(/duplicate/i);
    });

    it('preserves the postgres code, detail and hint verbatim', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError(
          '23514',
          'new row for relation "members" violates check constraint "members_gender_check"',
          { details: 'Failing row contains (gender, x)', hint: 'gender must be Male, Female or Other' }
        ),
      };

      const summary = await memberService.bulkImportMembers({ rows: [row()] });

      expect(summary.failed[0]).toMatchObject({
        code: '23514',
        detail: 'Failing row contains (gender, x)',
        hint: 'gender must be Male, Female or Other',
        stage: 'member-insert',
      });
    });

    it('keeps the spreadsheet row number so the row can be found', async () => {
      let call = 0;
      supabase.state.rpc.create_member_with_membership = () => {
        call += 1;
        return call === 2
          ? { data: null, error: dbError('22007', 'invalid input syntax for type date') }
          : { data: { member_id: `M${call}`, member_code: `BSG-100${call}` }, error: null };
      };

      const summary = await memberService.bulkImportMembers({
        rows: [row(), row({ rowId: 7, excelRow: 8, full_name: 'Second Person' })],
      });

      // The first row succeeds, so only the second is reported, against the
      // spreadsheet row the user can actually see.
      expect(summary.successCount).toBe(1);
      expect(summary.failed.map((f) => f.row)).toEqual([8]);
      expect(summary.failed[0].name).toBe('Second Person');
    });

    // The atomic function cannot produce a partial: its membership and payment
    // writes are in the same transaction as the member, so any failure removes
    // all three. A partial is only possible on the fallback path, and only when
    // the compensating delete is itself refused.
    it('counts a partial only when the member row survives a failed cleanup', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('PGRST202', 'Could not find the function'),
      };
      supabase.state.inserts.payments = {
        data: null,
        error: dbError('23514', 'check constraint "payments_payment_method_check" failed'),
      };
      supabase.state.deletes.members = { data: null, error: dbError('42501', 'delete denied') };

      const summary = await memberService.bulkImportMembers({ rows: [row()], planId: 'P1' });

      expect(summary.partialCount).toBe(1);
      expect(summary.errorCount).toBe(0);
      expect(summary.partial[0].memberCreated).toBe(true);
      expect(summary.partial[0].memberCode).toBe('BSG-1001');
      expect(summary.partial[0].stage).toBe('payment');
    });

    it('reports a clean failure when the fallback cleans up after itself', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('PGRST202', 'Could not find the function'),
      };
      supabase.state.inserts.payments = {
        data: null,
        error: dbError('23514', 'check constraint failed'),
      };

      const summary = await memberService.bulkImportMembers({ rows: [row()], planId: 'P1' });

      expect(summary.partialCount).toBe(0);
      expect(summary.errorCount).toBe(1);
      expect(summary.failed[0].memberCreated).toBe(false);
      expect(supabase.state.calls.delete).toEqual([{ table: 'members' }]);
    });

    it('mixes successes and failures in one sheet without losing any', async () => {
      let call = 0;
      supabase.state.rpc.create_member_with_membership = () => {
        call += 1;
        return call === 2
          ? { data: null, error: dbError('23505', 'duplicate key value violates unique constraint') }
          : { data: { member_id: `M${call}`, member_code: `BSG-100${call}` }, error: null };
      };

      const summary = await memberService.bulkImportMembers({
        rows: twentyRows(),
      });

      expect(summary.successCount).toBe(19);
      expect(summary.failed).toHaveLength(1);
      expect(summary.errors).toHaveLength(1);
      // Sorted by spreadsheet row so the table reads in file order.
      expect(summary.errors[0].row).toBe(3);
    });

    it('treats a missing atomic function as a supported state, not an error', async () => {
      supabase.state.rpc.create_member_with_membership = {
        data: null,
        error: dbError('PGRST202', 'Could not find the function'),
      };

      const summary = await memberService.bulkImportMembers({ rows: [row()], planId: 'P1' });

      expect(summary.successCount).toBe(1);
      expect(summary.errors).toEqual([]);
    });
  });
});