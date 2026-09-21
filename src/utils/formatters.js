import { format, parseISO } from 'date-fns';

export function formatCurrency(amount, currency = 'LKR') {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-LK', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  })
    .format(num)
    .replace('LKR', 'Rs.')
    .replace('SLRs', 'Rs.');
}

export function formatDate(dateString, pattern = 'MMM dd, yyyy') {
  if (!dateString) return 'N/A';
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return format(date, pattern);
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'Invalid Date';
  }
}

export function formatStatus(status) {
  if (!status) return '';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}
