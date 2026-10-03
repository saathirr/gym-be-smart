// Postgres and PostgREST error codes we can turn into something a gym staff
// member can act on. Anything not listed here falls back to the raw message.
const CODE_MESSAGES = {
  '23505': 'That record already exists.',
  '23503': 'That record is still linked to other data and cannot be removed.',
  '23514': 'That value is not allowed.',
  '42501': 'You do not have permission to do that.',
  PGRST116: 'No matching record was found.',
  PGRST205: 'The database schema is out of date. Run supabase_schema.sql again.',
  '42P01': 'The database schema is out of date. Run supabase_schema.sql again.',
};

const DEFAULT_MESSAGE = 'Something went wrong. Please try again.';

export function toMessage(error, fallback = DEFAULT_MESSAGE) {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error.code && CODE_MESSAGES[error.code]) return CODE_MESSAGES[error.code];
  if (error.message) return error.message;
  return fallback;
}

export function isMissingRow(error) {
  return Boolean(error) && error.code === 'PGRST116';
}

// PostgREST cannot find the function in its schema cache, or Postgres says the
// function does not exist. All three mean "this build of the database does not
// have that function yet", which is the one condition under which the member
// creation code may fall back to its older multi-request path.
const MISSING_FUNCTION_CODES = new Set(['PGRST202', 'PGRST203', '42883']);

/**
 * True only when the database is missing the function entirely.
 *
 * This distinction matters more than it looks. A function that exists and then
 * raises has already rolled back its own transaction, so retrying the same work
 * as separate requests is exactly what would produce the half-created member
 * the function was written to prevent. Only a missing function is safe to
 * fall back from.
 */
export function isMissingFunction(error) {
  return Boolean(error) && MISSING_FUNCTION_CODES.has(error.code);
}

/**
 * The untranslated parts of a Supabase/Postgres error.
 *
 * toMessage() deliberately swaps the real message for something a gym staff
 * member can act on, which is right for a form but wrong for the bulk import:
 * a file of twenty rows either works or does not, and "That value is not
 * allowed." on all twenty tells the person fixing the spreadsheet nothing about
 * which value or which rule. The code is what identifies the rule (22007 is a
 * bad date, 23514 a check violation, PGRST204 a column the database does not
 * have), and details/hint carry the column name and constraint Postgres quotes.
 *
 * Read-only and additive: nothing here changes what toMessage() returns.
 *
 * @returns {{ code: string | null, message: string, detail: string | null, hint: string | null }}
 */
export function describeError(error, fallback = 'Unknown error') {
  if (!error) return { code: null, message: fallback, detail: null, hint: null };

  if (typeof error === 'string') {
    return { code: null, message: error, detail: null, hint: null };
  }

  // Supabase calls it `details`; stageError wraps it as `detail`. Both are read
  // so the column name Postgres quotes in `details` is never lost on the way to
  // the import summary.
  const detail = error.details || error.detail || null;

  // An error thrown by our own stage wrapper already carries these.
  if (error.code || detail || error.hint) {
    return {
      code: error.code || null,
      message: error.message || fallback,
      detail,
      hint: error.hint || null,
    };
  }

  return {
    code: null,
    message: error.message || fallback,
    detail: null,
    hint: null,
  };
}

/**
 * Wraps a failure with the step it happened in, keeping the human-readable
 * message that toMessage() produces for the single-member form.
 *
 * The stage matters because createMember is several operations, not one: a
 * member whose row was written but whose membership or payment failed has not
 * been rejected, and reporting that as a plain failure sends the person
 * looking for a duplicate phone number that does not exist.
 */
export function stageError(stage, error, fallback) {
  const described = describeError(error, fallback);
  const wrapped = new Error(described.message);
  wrapped.stage = stage;
  wrapped.code = described.code;
  wrapped.detail = described.detail;
  wrapped.hint = described.hint;
  return wrapped;
}
