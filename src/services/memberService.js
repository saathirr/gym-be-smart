import { supabase } from '../lib/supabase';
import { toMessage, stageError, describeError, isMissingFunction } from '../lib/supabaseErrors';
import { addDays } from 'date-fns';
import { phoneSearchVariants } from '../utils/phone';
import { canonicalPhoneKey } from '../utils/memberImport';
import { storageService } from './storageService';

const MEMBER_SELECT = `
  id,
  member_code,
  qr_code_id,
  full_name,
  nic_number,
  email,
  phone,
  whatsapp_number,
  district,
  address,
  gender,
  date_of_birth,
  emergency_contact,
  medical_conditions,
  branch_id,
  status,
  created_at,
  avatar_url,
  memberships (
    id,
    start_date,
    end_date,
    status,
    plans ( id, name, price, duration_days )
  )
`;

// Everything the player profile shows below the identity card. Fetched as one
// extra pair of queries rather than through MEMBER_SELECT, because the members
// list renders 200 rows at a time and joining every historical membership and
// payment onto all of them would be a lot of data for a table that shows a
// name and a plan badge.
const MEMBERSHIP_HISTORY_SELECT = `
  id,
  start_date,
  end_date,
  status,
  auto_renew,
  notes,
  created_at,
  plans ( id, name, price, duration_days )
`;

const PAYMENT_HISTORY_SELECT = `
  id,
  membership_id,
  amount,
  payment_method,
  payment_status,
  receipt_number,
  transaction_date,
  notes
`;

function withPlanSummary(member) {
  const open = member.memberships?.find(
    (sub) => sub.status === 'Active' || sub.status === 'Expiring'
  );
  const current = open || member.memberships?.[0];

  return {
    ...member,
    plan_id: current?.plans?.id ?? null,
    plan_name: current?.plans?.name || 'No Active Plan',
    plan_price: current?.plans?.price ?? null,
    membership_id: current?.id ?? null,
    membership_status: current?.status ?? null,
    start_date: current?.start_date ?? null,
    expiration_date: current?.end_date || null,
  };
}

function emptyMemberForm() {
  return {
    full_name: '',
    nic_number: '',
    phone: '',
    whatsapp_number: '',
    email: '',
    district: 'Colombo',
    address: '',
    gender: 'Male',
    date_of_birth: '',
    emergency_contact: '',
    medical_conditions: '',
    branch_id: '',
  };
}

/**
 * A blank spreadsheet cell must reach the database as NULL, not as '' or '   '.
 *
 * The step-by-step path already did this with `.trim() || null` on every optional
 * field. Without the same treatment here the atomic function would receive
 * '   ' where the old path sent null, and the two would store different values
 * for the same sheet. The function also applies NULLIF(btrim(x), '') so the
 * guarantee does not depend on the caller.
 */
function textOrNull(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

export const memberService = {
  emptyMemberForm,

  async getMembers({ search = '', status = 'ALL', branchId = 'ALL', limit = 200 } = {}) {
    let query = supabase
      .from('members')
      .select(MEMBER_SELECT)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search.trim()) {
      // PostgREST's or() filter is a comma-separated list of column.pattern
      // pairs, so the pattern itself must not contain a comma, percent sign or
      // parenthesis. The text term is flattened to spaces for that reason; the
      // phone variants are digits only and need no escaping.
      const term = search.trim().replace(/[%,()]/g, ' ').trim();
      const conditions = [];
      if (term) {
        conditions.push(
          `full_name.ilike.%${term}%`,
          `member_code.ilike.%${term}%`,
          `nic_number.ilike.%${term}%`,
          `phone.ilike.%${term}%`,
          `whatsapp_number.ilike.%${term}%`,
          `email.ilike.%${term}%`
        );
      }

      // "077 123 4567" has to find a member stored as "0771234567", and
      // "94771234567" has to find them too, so every form of the number is
      // searched instead of only the one that was typed. Empty for a name or a
      // member code, which is what keeps the filter to one round trip.
      for (const variant of phoneSearchVariants(search)) {
        conditions.push(`phone.ilike.%${variant}%`, `whatsapp_number.ilike.%${variant}%`);
      }

      if (conditions.length > 0) {
        query = query.or(conditions.join(','));
      }
    }

    if (status && status !== 'ALL') {
      query = query.eq('status', status);
    }

    if (branchId && branchId !== 'ALL') {
      query = query.eq('branch_id', branchId);
    }

    const { data, error } = await query;
    if (error) throw toMessage(error);

    return (data || []).map(withPlanSummary);
  },

  async getMemberById(id) {
    const { data, error } = await supabase
      .from('members')
      .select(MEMBER_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) throw toMessage(error);
    return data ? withPlanSummary(data) : null;
  },

  /**
   * One member with their full subscription and payment history.
   *
   * The two history queries run in parallel because they are independent, and
   * each is ordered by date so the profile can show them newest-first without
   * sorting in the browser. Both are separate from getMemberById so the
   * members list does not pay for them.
   */
  async getMemberProfile(id) {
    const member = await this.getMemberById(id);
    if (!member) return null;

    const [memberships, payments] = await Promise.all([
      supabase
        .from('memberships')
        .select(MEMBERSHIP_HISTORY_SELECT)
        .eq('member_id', id)
        .order('start_date', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw toMessage(error, 'Could not load the membership history.');
          return data || [];
        }),

      supabase
        .from('payments')
        .select(PAYMENT_HISTORY_SELECT)
        .eq('member_id', id)
        .order('transaction_date', { ascending: false })
        .then(({ data, error }) => {
          if (error) throw toMessage(error, 'Could not load the payment history.');
          return data || [];
        }),
    ]);

    return {
      ...member,
      // withPlanSummary already flattens the *current* membership onto the
      // member. The history keeps every row, including the current one, so the
      // profile can show a plan that has since been renewed or cancelled.
      membershipHistory: memberships,
      paymentHistory: payments,
    };
  },

  // Accepts either the QR payload or the human-readable member code.
  async getMemberByPass(passValue) {
    const value = passValue?.trim();
    if (!value) return null;

    const { data, error } = await supabase
      .from('members')
      .select(MEMBER_SELECT)
      .or(`qr_code_id.eq.${value},member_code.eq.${value}`)
      .limit(1);

    if (error) throw toMessage(error);
    if (!data || data.length === 0) return null;

    return withPlanSummary(data[0]);
  },

  /**
   * Registers one member, on the same path for the single-member form and the
   * bulk import.
   *
   * Prefers create_member_with_membership, which writes the member, the
   * membership and the first payment inside one database transaction so a
   * failure part way through cannot leave a member with no subscription behind.
   * That function arrives with
   * supabase_migration_phase5_atomic_member_creation.sql.
   *
   * Until it is applied the call falls back to the older sequence of separate
   * requests, so nothing breaks if the file has not been run yet. The fallback
   * removes the member row again when a later step fails, which gets the same
   * all-or-nothing outcome as the function as long as the cleanup succeeds.
   */
  async createMember(payload, planId, photoFile = null) {
    const { data, error } = await supabase.rpc('create_member_with_membership', {
      p_full_name: String(payload.full_name ?? '').trim(),
      p_nic_number: textOrNull(payload.nic_number),
      p_email: textOrNull(payload.email),
      p_phone: String(payload.phone ?? '').trim(),
      p_whatsapp_number: textOrNull(payload.whatsapp_number),
      p_district: textOrNull(payload.district),
      p_address: textOrNull(payload.address),
      p_gender: textOrNull(payload.gender),
      p_date_of_birth: payload.date_of_birth || null,
      p_emergency_contact: textOrNull(payload.emergency_contact),
      p_medical_conditions: textOrNull(payload.medical_conditions),
      p_branch_id: payload.branch_id || null,
      p_plan_id: planId || null,
      p_payment_method: payload.payment_method || 'Cash',
    });

    if (!error) {
      const member = await this.getMemberById(data?.member_id);
      if (!member) throw toMessage(new Error('The member was saved but could not be read back.'));
      return this.attachMemberPhoto(member, photoFile);
    }

    if (isMissingFunction(error)) {
      return this.createMemberStepByStep(payload, planId, photoFile);
    }

    // The function ran and failed, which means it rolled back. Reporting the
    // stage matters: with the atomic path a member-insert failure is the only
    // kind there is, because the membership and payment writes are inside the
    // same transaction as the member.
    throw stageError('member-insert', error, 'Could not save this member.');
  },

  /**
   * The photo is uploaded after the row exists, because the storage path is
   * namespaced by member id. Doing it the other way round would mean either a
   * client-generated folder that does not match the member, or an orphaned file
   * when the insert fails.
   *
   * A photo failure does NOT fail the registration. The member is already on
   * file and losing them because a jpeg failed to upload would be the far worse
   * outcome, so the error is handed back for the UI to show and the photo can be
   * added later from the profile.
   */
  async attachMemberPhoto(member, photoFile) {
    if (!photoFile) return { ...withPlanSummary(member), photoError: null };

    try {
      const avatarUrl = await storageService.uploadMemberPhoto({
        memberId: member.id,
        file: photoFile,
      });

      const { error: avatarError } = await supabase
        .from('members')
        .update({ avatar_url: avatarUrl })
        .eq('id', member.id);

      if (avatarError) throw toMessage(avatarError);

      member.avatar_url = avatarUrl;
    } catch (error) {
      return { ...withPlanSummary(member), photoError: toMessage(error, 'The photo could not be saved.') };
    }

    return { ...withPlanSummary(member), photoError: null };
  },

  /**
   * The pre-phase-5 path: three independent PostgREST requests, each its own
   * transaction. Reachable only while the database has no
   * create_member_with_membership function.
   */
  async createMemberStepByStep(payload, planId, photoFile = null) {
    const { data: codeRow, error: codeError } = await supabase.rpc('next_member_code');
    if (codeError) {
      throw stageError('member-code', codeError, 'Could not generate a member code.');
    }

    const memberCode = codeRow;
    const qrCodeId = `${memberCode}.${Date.now().toString(36).toUpperCase()}`;

    const { data: member, error } = await supabase
      .from('members')
      .insert([
        {
          member_code: memberCode,
          qr_code_id: qrCodeId,
          full_name: payload.full_name.trim(),
          nic_number: payload.nic_number?.trim() || null,
          email: payload.email?.trim() || null,
          phone: payload.phone.trim(),
          whatsapp_number: payload.whatsapp_number?.trim() || null,
          district: payload.district || null,
          address: payload.address?.trim() || null,
          // Not defaulted to a value. gender is nullable with a CHECK on the
          // allowed words, so an import that genuinely left it blank should stay
          // blank rather than assert something untrue about the member. The
          // single-member form always submits one of the three allowed words.
          gender: payload.gender?.trim() || null,
          date_of_birth: payload.date_of_birth || null,
          emergency_contact: payload.emergency_contact?.trim() || null,
          medical_conditions: payload.medical_conditions?.trim() || null,
          branch_id: payload.branch_id || null,
          status: 'Active',
        },
      ])
      .select(MEMBER_SELECT)
      .single();

    if (error) throw stageError('member-insert', error, 'Could not save this member.');

    // Past this point the member row exists but the registration is not finished.
    // Without the atomic function there is no transaction spanning the remaining
    // writes, so the row is removed again here rather than left behind. This only
    // ever deletes the row this same call just inserted, identified by the id the
    // insert returned, so it cannot touch an existing member. memberships and
    // payments cascade from members, so a membership that did get created goes
    // with it.
    //
    // If the cleanup itself fails the failure is reported as a partial, because at
    // that point the member really is on file and pretending otherwise would send
    // the next attempt straight into a duplicate.
    const failAfterMemberSaved = async (stage, laterError, fallback) => {
      const wrapped = stageError(stage, laterError, fallback);
      const { error: cleanupError } = await supabase
        .from('members')
        .delete()
        .eq('id', member.id);

      // The row is only still on file when the cleanup failed, so it is the
      // failure of the cleanup, not the success of the write, that makes this a
      // partial rather than a clean failure.
      wrapped.rolledBack = !cleanupError;
      wrapped.memberCreated = Boolean(cleanupError);
      wrapped.memberId = cleanupError ? member.id : null;
      wrapped.memberCode = cleanupError ? member.member_code || memberCode : null;

      if (cleanupError) {
        wrapped.detail = [wrapped.detail, `The member row could not be cleaned up: ${cleanupError.message}`]
          .filter(Boolean)
          .join(' ');
      }

      return wrapped;
    };

    if (planId) {
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .select('id, name, price, duration_days')
        .eq('id', planId)
        .maybeSingle();

      if (planError) {
        throw await failAfterMemberSaved('plan-lookup', planError, 'Could not load that plan.');
      }

      if (plan) {
        const startDate = new Date().toISOString().slice(0, 10);
        const endDate = addDays(new Date(), plan.duration_days).toISOString().slice(0, 10);

        const { data: membership, error: membershipError } = await supabase
          .from('memberships')
          .insert([
            {
              member_id: member.id,
              plan_id: plan.id,
              start_date: startDate,
              end_date: endDate,
              status: 'Active',
            },
          ])
          .select('id')
          .single();

        if (membershipError) {
          throw await failAfterMemberSaved(
            'membership',
            membershipError,
            'Could not start the membership.'
          );
        }

        if (Number(plan.price) > 0) {
          const { data: receiptRow, error: receiptError } = await supabase.rpc(
            'next_receipt_number'
          );
          if (receiptError) {
            throw await failAfterMemberSaved(
              'receipt-number',
              receiptError,
              'Could not generate a receipt number.'
            );
          }

          const { error: paymentError } = await supabase.from('payments').insert([
            {
              member_id: member.id,
              membership_id: membership.id,
              amount: plan.price,
              payment_method: payload.payment_method || 'Cash',
              payment_status: 'Paid',
              receipt_number: receiptRow,
              notes: `New membership - ${plan.name}`,
            },
          ]);

          if (paymentError) {
            throw await failAfterMemberSaved('payment', paymentError, 'Could not record the payment.');
          }
        }
      }
    }

    return this.attachMemberPhoto(member, photoFile);
  },

  async updateMember(id, payload) {
    const { data, error } = await supabase
      .from('members')
      .update({
        full_name: payload.full_name.trim(),
        nic_number: payload.nic_number?.trim() || null,
        email: payload.email?.trim() || null,
        phone: payload.phone.trim(),
        whatsapp_number: payload.whatsapp_number?.trim() || null,
        district: payload.district || null,
        address: payload.address?.trim() || null,
        gender: payload.gender || 'Male',
        date_of_birth: payload.date_of_birth || null,
        emergency_contact: payload.emergency_contact?.trim() || null,
        medical_conditions: payload.medical_conditions?.trim() || null,
        branch_id: payload.branch_id || null,
      })
      .eq('id', id)
      .select(MEMBER_SELECT)
      .single();

    if (error) throw toMessage(error);
    return withPlanSummary(data);
  },

  async updateMemberStatus(id, status) {
    const { error } = await supabase.from('members').update({ status }).eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },

  async deleteMember(id) {
    const { error } = await supabase.from('members').delete().eq('id', id);
    if (error) throw toMessage(error);
    return true;
  },

  async bulkImportMembers({ rows, planId = null, paymentMethod = 'Cash', onProgress }) {
    // Rows whose member record was written but whose plan, membership or payment
    // step then failed, and rows that never made it into the members table. Both
    // are reported, but they mean opposite things to whoever fixes the file: a
    // failed row can simply be retried, a partial row is already on file and
    // re-uploading it creates a second member with the same phone number.
    const created = [];
    const partial = [];
    const failed = [];

    // Only rows the validator accepted are written. A row that failed
    // validation must never be inserted with a corrected-up value, so this is
    // enforced here as well as in the modal.
    const importable = rows.filter((row) => row.isValid !== false);

    for (let i = 0; i < importable.length; i++) {
      const row = importable[i];
      try {
        const member = await this.createMember(
          {
            full_name: row.full_name,
            nic_number: row.nic_number || null,
            phone: row.phone,
            whatsapp_number: row.whatsapp_number || row.phone,
            email: row.email || null,
            district: row.district || null,
            address: row.address || null,
            gender: row.gender || null,
            date_of_birth: row.date_of_birth || null,
            emergency_contact: row.emergency_contact || null,
            medical_conditions: row.medical_conditions || null,
            payment_method: paymentMethod,
          },
          planId,
          null
        );

        created.push({
          row: row.excelRow ?? row.rowId,
          name: row.full_name,
          phone: row.phone,
          memberCode: member?.member_code || null,
        });
      } catch (err) {
        const described = describeError(err, 'Could not save this member.');
        // The untranslated code and detail are what identify the rule that
        // rejected the row: 22007 is a value the wrong type, 23514 a check
        // violation, 23505 a unique index, PGRST204 a column the database does
        // not have. Collapsing these into one sentence is what made twenty
        // identical failures look like twenty duplicate phone numbers.
        const record = {
          row: row.excelRow ?? row.rowId,
          name: row.full_name,
          phone: row.phone,
          stage: err?.stage || 'member-insert',
          code: described.code,
          message: described.message,
          detail: described.detail,
          hint: described.hint,
          memberCreated: Boolean(err?.memberCreated),
          memberCode: err?.memberCode || null,
        };

        if (record.memberCreated) partial.push(record);
        else failed.push(record);
      }

      if (onProgress) {
        onProgress(i + 1, importable.length);
      }
    }

    return {
      // Kept as plain counts because the summary line and the tests both read
      // them, and a caller should not have to length() an array to render a
      // number.
      successCount: created.length,
      errorCount: failed.length,
      partialCount: partial.length,
      created,
      partial,
      failed,
      // One flat list, for the table, ordered by the spreadsheet row so it reads
      // in the same order as the file.
      errors: [...partial, ...failed].sort((a, b) => (a.row ?? 0) - (b.row ?? 0)),
    };
  },

  // Canonical phone keys of every number already on file, used by the bulk
  // import to reject a spreadsheet that would register existing members a
  // second time.
  //
  // Both phone and WhatsApp are collected, because a member can be reachable on
  // a number that only appears in one of the two columns, and an import row that
  // collides with either one is still a duplicate member.
  //
  // Every registered number is fetched rather than filtering on the handful in
  // the upload. The directory is a gym, not a call centre, so two columns with no
  // joins is a small read, whereas an `in.(...)` list of every digit variant
  // would grow a very long query URL for a large upload.
  async getExistingPhoneKeys() {
    const { data, error } = await supabase.from('members').select('phone, whatsapp_number');

    if (error) throw toMessage(error, 'Could not check for existing members.');

    const keys = new Set();
    for (const member of data || []) {
      const phoneKey = canonicalPhoneKey(member.phone);
      if (phoneKey) keys.add(phoneKey);
      const whatsappKey = canonicalPhoneKey(member.whatsapp_number);
      if (whatsappKey) keys.add(whatsappKey);
    }

    return keys;
  },
};
