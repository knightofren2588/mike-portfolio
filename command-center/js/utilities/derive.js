// Pure selectors for the Prospects page (no database calls, no DOM).
// Kept separate from the view so the rules can be tested on their own.

import { isFollowupDue, isActiveProspect, isDoNotContact } from '../api.js';
import { PROSPECT_STATUSES } from './labels.js';
import { toNumber } from '../dom.js';
import { onSessionEnd } from './session.js';

// ---------- search index (in memory only, wiped when the session ends) ----------
let haystacks = new WeakMap();

export function resetDerived() {
  haystacks = new WeakMap();
}
onSessionEnd(resetDerived);

function haystack(prospect) {
  let text = haystacks.get(prospect);
  if (text === undefined) {
    text = [prospect.company_name, prospect.contact_name, prospect.contact_email]
      .map((v) => String(v === null || v === undefined ? '' : v).toLowerCase())
      .join('\n');
    haystacks.set(prospect, text);
  }
  return text;
}

// ---------- filters ----------
export const SORT_KEYS = ['newest', 'score', 'value', 'followup'];
export const DNC_OPTIONS = ['any', 'only', 'exclude'];
export const APPROVED_OPTIONS = ['any', 'yes', 'no'];
export const SCOPE_OPTIONS = ['all', 'active'];
export const DUE_OPTIONS = ['any', 'yes'];
export const REPLIED_OPTIONS = ['any', 'yes', 'no'];
export const STATUS_OPTIONS = [''].concat(PROSPECT_STATUSES);

export const FILTER_DEFAULTS = Object.freeze({
  q: '', status: '', dnc: 'any', approved: 'any', scope: 'all', due: 'any', replied: 'any', sort: 'newest'
});

export function isDefaultFilters(f) {
  return Object.keys(FILTER_DEFAULTS).every((key) => f[key] === FILTER_DEFAULTS[key]);
}

export function filterProspects(prospects, f, now) {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  return prospects.filter((p) => {
    if (f.status !== '' && p.status !== f.status) return false;
    if (f.dnc === 'only' && !isDoNotContact(p)) return false;
    if (f.dnc === 'exclude' && isDoNotContact(p)) return false;
    if (f.approved === 'yes' && !p.approved_to_contact) return false;
    if (f.approved === 'no' && p.approved_to_contact) return false;
    if (f.scope === 'active' && !isActiveProspect(p)) return false;
    if (f.due === 'yes' && !isFollowupDue(p, now)) return false;
    if (f.replied === 'yes' && !p.replied_at) return false;
    if (f.replied === 'no' && p.replied_at) return false;
    if (terms.length) {
      const text = haystack(p);
      for (const term of terms) if (text.indexOf(term) === -1) return false;
    }
    return true;
  });
}

// ---------- sorting ----------
function time(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function valueOf(p) {
  const max = toNumber(p.estimated_value_max);
  const min = toNumber(p.estimated_value_min);
  return max !== null ? max : min;
}

function nameOf(p) {
  return String(p.company_name || '').toLowerCase();
}

// Missing values always sort last, whichever direction is used.
function compareNullable(a, b, descending) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return descending ? b - a : a - b;
}

export function sortProspects(rows, key) {
  const copy = rows.slice();
  const by = {
    newest: (a, b) => compareNullable(time(a.created_at), time(b.created_at), true),
    score: (a, b) => compareNullable(toNumber(a.lead_score), toNumber(b.lead_score), true),
    value: (a, b) => compareNullable(valueOf(a), valueOf(b), true),
    followup: (a, b) => compareNullable(time(a.next_followup_at), time(b.next_followup_at), false)
  }[key] || (() => 0);
  return copy.sort((a, b) => by(a, b) || nameOf(a).localeCompare(nameOf(b)));
}
