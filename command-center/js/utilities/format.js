// Compact date formatting for dense lists. (dom.js keeps the longer fmtDateTime / fmtRelative.)

function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Oct 5" this year, "Oct 5, 2025" otherwise. */
export function fmtDate(value, now) {
  const d = toDate(value);
  if (!d) return '—';
  const ref = now instanceof Date ? now : new Date();
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== ref.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** "3:42 PM" */
export function fmtTime(value) {
  const d = toDate(value);
  return d ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—';
}

/** Full local date and time, used for hover text (title attributes). */
export function fmtFull(value) {
  const d = toDate(value);
  return d ? d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' }) : '';
}
