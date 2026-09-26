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
