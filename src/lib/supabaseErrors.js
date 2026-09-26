import { supabase } from './supabase';

export function toMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error.message) return error.message;

  if (error.code) {
    switch (error.code) {
      case '23505':
        return 'That record already exists.';
      case '23503':
        return 'That record is still linked to other data.';
      case '42501':
        return 'You do not have permission to do that.';
      case 'PGRST116':
        return 'No matching record was found.';
      default:
        return error.code;
    }
  }

  return fallback;
}

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add your project URL and anon key to .env');
  }
  return supabase;
}
