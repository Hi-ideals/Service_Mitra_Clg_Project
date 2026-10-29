/**
 * Display formatting.
 *
 * Money arrives from the API in both paise and rupees. These helpers render
 * the rupee value; nothing here does currency arithmetic, because the server
 * already did it and two answers is one too many.
 */

const RUPEES = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const RUPEES_PRECISE = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

/** Formats a rupee amount. Whole rupees drop the decimals, which most are. */
export function money(value, { precise = false } = {}) {
  if (value === null || value === undefined) return '—';
  const amount = Number(value);
  if (Number.isNaN(amount)) return '—';
  return precise || amount % 1 !== 0 ? RUPEES_PRECISE.format(amount) : RUPEES.format(amount);
}

/** Formats a paise amount, for the rare place that only has the minor value. */
export function moneyMinor(minor, options) {
  if (minor === null || minor === undefined) return '—';
  return money(Number(minor) / 100, options);
}

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });

export function formatDate(value, { short = false } = {}) {
  if (!value) return '—';
  const date = new Date(value);
  return (short ? DATE_SHORT : DATE).format(date);
}

export function formatTime(value) {
  if (!value) return '—';
  return TIME.format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return DATE_SHORT.format(date) + ', ' + TIME.format(date);
}

export function formatWeekday(value) {
  if (!value) return '';
  return WEEKDAY.format(new Date(value));
}

/**
 * Human-friendly relative time.
 *
 * Says "Today" and "Tomorrow" rather than a date, because that is how someone
 * thinks about an appointment they are about to attend.
 */
export function relativeDay(value) {
  if (!value) return '—';
  const date = new Date(value);
  const today = new Date();

  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(today)) / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return formatWeekday(date);
  return formatDate(date, { short: days > -365 && days < 365 });
}

/** "2 hours ago" / "in 20 minutes", for activity feeds and countdowns. */
export function timeAgo(value) {
  if (!value) return '';
  const diffMs = new Date(value).getTime() - Date.now();
  const absMinutes = Math.abs(diffMs) / 60000;

  const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

  if (absMinutes < 1) return 'just now';
  if (absMinutes < 60) return rtf.format(Math.round(diffMs / 60000), 'minute');
  if (absMinutes < 1440) return rtf.format(Math.round(diffMs / 3600000), 'hour');
  if (absMinutes < 43200) return rtf.format(Math.round(diffMs / 86400000), 'day');
  return formatDate(value);
}

/** Minutes as "1 hr 30 min", which reads better than "90 minutes". */
export function duration(minutes) {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return mins + ' min';
  if (!mins) return hours + (hours === 1 ? ' hr' : ' hrs');
  return hours + ' hr ' + mins + ' min';
}

export function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/** Turns a snake_case status into something readable. */
export function humanise(value) {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function pluralise(count, singular, plural) {
  return count + ' ' + (count === 1 ? singular : plural || singular + 's');
}

export default { money, moneyMinor, formatDate, formatTime, formatDateTime, relativeDay, timeAgo, duration, initials, humanise, pluralise };
