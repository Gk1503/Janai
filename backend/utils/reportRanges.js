// Date handling for the Reports module.
//
// The application has no stored timezone setting, so report days are fixed to India Standard Time
// (UTC+05:30, no daylight saving): "today" and every day/month bucket start at 00:00 IST. Ranges are
// half-open [from, to) in UTC instants, so a report never double-counts or drops an order at midnight.
export const REPORT_TIMEZONE = '+05:30';
export const REPORT_TIMEZONE_LABEL = 'Asia/Kolkata (UTC+05:30)';
export const RANGE_KEYS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth', 'custom'];
export const DEFAULT_RANGE = 'last30';
export const MAX_CUSTOM_DAYS = 366;
// Longer ranges are grouped by month so a chart never has hundreds of bars.
export const MAX_DAILY_DAYS = 62;

const OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (value) => String(value).padStart(2, '0');

const shifted = (date) => new Date(date.getTime() + OFFSET_MS);
export const istDateString = (date) => { const t = shifted(date); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export const istStartOfDay = (date) => { const t = shifted(date); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - OFFSET_MS); };
// month0 may be negative or above 11; Date.UTC rolls the year.
const istMonthStart = (year, month0) => new Date(Date.UTC(year, month0, 1) - OFFSET_MS);

// YYYY-MM-DD -> the instant that calendar day starts in IST, or null for anything that is not a real date.
export function parseReportDay(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return new Date(probe.getTime() - OFFSET_MS);
}

const LABELS = { today: 'Today', yesterday: 'Yesterday', last7: 'Last 7 days', last30: 'Last 30 days', thisMonth: 'This month', lastMonth: 'Last month', custom: 'Custom range' };

// Resolves ?range=... (and ?from=&to= for custom) into concrete boundaries plus the previous equivalent
// period used for comparisons. Returns { error } for anything invalid.
export function resolveRange(query = {}, now = new Date()) {
  const key = query.range === undefined || query.range === '' ? DEFAULT_RANGE : query.range;
  if (typeof key !== 'string' || !RANGE_KEYS.includes(key)) return { error: `Choose a valid date range: ${RANGE_KEYS.join(', ')}.` };

  const today = istStartOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const parts = shifted(now);
  const year = parts.getUTCFullYear();
  const month0 = parts.getUTCMonth();
  let from;
  let to;
  let previous;

  if (key === 'today') { from = today; to = tomorrow; }
  else if (key === 'yesterday') { from = new Date(today.getTime() - DAY_MS); to = today; }
  else if (key === 'last7') { from = new Date(today.getTime() - 6 * DAY_MS); to = tomorrow; }
  else if (key === 'last30') { from = new Date(today.getTime() - 29 * DAY_MS); to = tomorrow; }
  else if (key === 'thisMonth') {
    from = istMonthStart(year, month0);
    to = tomorrow;
    // Compare month-to-date with the same number of days at the start of the previous month.
    const previousFrom = istMonthStart(year, month0 - 1);
    previous = { from: previousFrom, to: new Date(Math.min(previousFrom.getTime() + (to.getTime() - from.getTime()), from.getTime())) };
  } else if (key === 'lastMonth') {
    from = istMonthStart(year, month0 - 1);
    to = istMonthStart(year, month0);
    previous = { from: istMonthStart(year, month0 - 2), to: from };
  } else {
    const start = parseReportDay(query.from);
    const end = parseReportDay(query.to);
    if (!start || !end) return { error: 'Enter the custom range as valid YYYY-MM-DD dates.' };
    if (end < start) return { error: 'The end date cannot be before the start date.' };
    from = start;
    to = new Date(end.getTime() + DAY_MS);
    if (to > tomorrow) return { error: 'The end date cannot be in the future.' };
    if (Math.round((to.getTime() - from.getTime()) / DAY_MS) > MAX_CUSTOM_DAYS) return { error: `Choose a range of at most ${MAX_CUSTOM_DAYS} days.` };
  }

  const length = to.getTime() - from.getTime();
  previous = previous || { from: new Date(from.getTime() - length), to: from };
  const days = Math.round(length / DAY_MS);
  return {
    key, label: LABELS[key], from, to, days, previous,
    granularity: days > MAX_DAILY_DAYS ? 'month' : 'day',
  };
}

// The shape sent to clients and printed on exports: inclusive calendar dates, not UTC instants.
export function describeRange(range) {
  return {
    key: range.key,
    label: range.label,
    from: istDateString(range.from),
    to: istDateString(new Date(range.to.getTime() - 1)),
    days: range.days,
    granularity: range.granularity,
    timezone: REPORT_TIMEZONE_LABEL,
    previous: { from: istDateString(range.previous.from), to: istDateString(new Date(range.previous.to.getTime() - 1)) },
  };
}

export const dateFormatFor = (range) => (range.granularity === 'month' ? '%Y-%m' : '%Y-%m-%d');

// Every bucket key in the range, so charts show zero-sales days instead of gaps.
export function bucketKeys(range) {
  const keys = [];
  if (range.granularity === 'month') {
    const start = shifted(range.from);
    let cursor = istMonthStart(start.getUTCFullYear(), start.getUTCMonth());
    while (cursor < range.to) {
      keys.push(istDateString(cursor).slice(0, 7));
      const parts = shifted(cursor);
      cursor = istMonthStart(parts.getUTCFullYear(), parts.getUTCMonth() + 1);
    }
  } else {
    for (let cursor = range.from.getTime(); cursor < range.to.getTime(); cursor += DAY_MS) keys.push(istDateString(new Date(cursor)));
  }
  return keys;
}

// rows: [{ _id: '2026-10-01', ...numbers }] from an aggregation; missing buckets are filled with zeros.
export function fillSeries(range, rows, zero) {
  const byKey = new Map((rows || []).map((row) => [row._id, row]));
  return bucketKeys(range).map((period) => {
    const { _id, ...values } = byKey.get(period) || {};
    return { period, ...zero, ...values };
  });
}

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Percentage change against the previous period. null means "not comparable" (previous period was zero).
export function percentChange(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / before) * 1000) / 10;
}
