// READ-ONLY data access for the Command Center.
//
// This file only READS (.select()). Every write the app can make lives in actions.js, and is limited
// to exactly three database functions. There is no insert / update / upsert / delete here.
// Even if some code tried a direct table write, the database has no write grants or policies for
// browser roles, so it would fail with "permission denied".
//
// Columns are listed explicitly (never "*") and match the verified Stark Tech Sales schema.

import { sb } from './supabaseClient.js';
import { PAGE_SIZE, MAX_ROWS_PER_TABLE, N8N_SENDER_MESSAGE_TYPES } from './config.js';

const PROSPECT_COLUMNS = [
  'id', 'company_name', 'website', 'industry', 'city', 'state', 'contact_name',
  'contact_email', 'contact_phone', 'pain_point', 'evidence', 'proposed_offer',
  'estimated_value_min', 'estimated_value_max', 'status', 'lead_score',
  'approved_to_contact', 'do_not_contact', 'first_contact_at', 'last_contact_at',
  'next_followup_at', 'followup_count', 'replied_at', 'source', 'source_url',
  'notes', 'created_at', 'updated_at'
].join(',');

// provider_message_id is intentionally not requested: nothing in the UI needs it.
const MESSAGE_COLUMNS = [
  'id', 'prospect_id', 'message_type', 'subject', 'body', 'status', 'approved',
  'scheduled_at', 'sent_at', 'created_at'
].join(',');

// Added by the Phase 2 database migration. If the migration has not been applied yet, the loader
// falls back to MESSAGE_COLUMNS so the app keeps working (see selectMessages).
const MESSAGE_AUDIT_COLUMNS = ['approved_at', 'approved_by', 'rejected_at', 'rejection_reason', 'edited_at'].join(',');

const ACTIVITY_COLUMNS = ['id', 'prospect_id', 'activity_type', 'details', 'created_at'].join(',');

// Only the address is needed (to disable Approve for suppressed contacts).
const SUPPRESSION_COLUMNS = ['id', 'email'].join(',');

// Status values that the existing n8n workflows rely on (from the verified setup).
// The UI only uses these to decide where a message belongs; every other value in the
// database is still displayed exactly as it is.
export const MESSAGE_STATUS_DRAFT = 'draft';
export const MESSAGE_STATUS_APPROVED = 'approved';

// Display order for pipeline columns. Used only for SORTING statuses that actually exist
// in the data; a status that is not in the database never appears.
export const STAGE_ORDER = [
  'researched', 'approved', 'sent', 'followup_1', 'followup_2', 'replied',
  'qualified', 'proposal', 'won', 'lost', 'closed'
];

function isAuthProblem(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return (
    error.status === 401 ||
    code === 'PGRST301' ||
    code === 'PGRST303' ||
    /jwt/i.test(msg)
  );
}

function toError(table, error) {
  const err = new Error('Could not load ' + table + ': ' + (error.message || 'unknown error'));
  err.authExpired = isAuthProblem(error);
  err.code = error.code ? String(error.code) : '';
  return err;
}

/** Page through a table with .select() only. Stable order so pages do not overlap. */
async function selectAll(table, columns, orderColumn) {
  const order = orderColumn || 'created_at';
  const rows = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE_SIZE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order(order, { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw toError(table, error);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Messages, including the Phase 2 audit columns when they exist (42703 = undefined column). */
async function selectMessages() {
  try {
    const result = await selectAll('outreach_messages', MESSAGE_COLUMNS + ',' + MESSAGE_AUDIT_COLUMNS);
    result.auditColumns = true;
    return result;
  } catch (err) {
    if (err && err.code === '42703') {
      const result = await selectAll('outreach_messages', MESSAGE_COLUMNS);
      result.auditColumns = false;
      return result;
    }
    throw err;
  }
}

let cache = null;
let inflight = null;

export function clearCache() {
  cache = null;
}

/** Load (or reuse) one read-only snapshot of the CRM. */
export function getSnapshot(options) {
  const force = !!(options && options.force);
  if (cache && !force) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = (async () => {
    const [p, m, a, s] = await Promise.all([
      selectAll('prospects', PROSPECT_COLUMNS),
      selectMessages(),
      selectAll('activities', ACTIVITY_COLUMNS),
      selectAll('suppression_list', SUPPRESSION_COLUMNS, 'suppressed_at')
    ]);

    const prospectsById = new Map();
    for (const row of p.rows) prospectsById.set(String(row.id), row);

    const messagesByProspect = new Map();
    for (const row of m.rows) {
      const key = String(row.prospect_id);
      if (!messagesByProspect.has(key)) messagesByProspect.set(key, []);
      messagesByProspect.get(key).push(row);
    }

    const activitiesByProspect = new Map();
    for (const row of a.rows) {
      const key = String(row.prospect_id);
      if (!activitiesByProspect.has(key)) activitiesByProspect.set(key, []);
      activitiesByProspect.get(key).push(row);
    }

    const suppressed = new Set();
    for (const row of s.rows) {
      const value = normalizeEmail(row.email);
      if (value) suppressed.add(value);
    }

    cache = {
      loadedAt: new Date(),
      prospects: p.rows,
      messages: m.rows,
      activities: a.rows,
      suppressionCount: s.rows.length,
      suppressed: suppressed,
      auditColumns: m.auditColumns,
      truncated: {
        prospects: p.truncated,
        messages: m.truncated,
        activities: a.truncated,
        suppression: s.truncated
      },
      prospectsById: prospectsById,
      messagesByProspect: messagesByProspect,
      activitiesByProspect: activitiesByProspect
    };
    return cache;
  })();

  inflight = inflight.finally(() => {
    inflight = null;
  });
  return inflight;
}

// ---------- derived, read-only helpers (no database calls) ----------

export function isAwaitingApproval(message) {
  return message.status === MESSAGE_STATUS_DRAFT && !message.approved;
}

/** Approved in the UI/DB but n8n has not sent it yet (matches the sender's approved = true AND status = approved). */
export function isApprovedWaiting(message) {
  return message.status === MESSAGE_STATUS_APPROVED && message.approved === true && !message.sent_at;
}

export function isSent(message) {
  return !!message.sent_at || message.status === 'sent';
}

/** True when the n8n approved-sender is known to pick up this message_type. */
export function isHandledBySender(messageType) {
  return N8N_SENDER_MESSAGE_TYPES.indexOf(messageType) !== -1;
}

export function normalizeEmail(value) {
  return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
}

/**
 * Mirrors the database check: the address itself, its bare domain ("example.com"), or "@example.com"
 * on the suppression list. The database function re-checks this independently on approval.
 */
export function isSuppressed(snap, email) {
  const address = normalizeEmail(email);
  if (!address) return false;
  if (snap.suppressed.has(address)) return true;
  const domain = address.split('@')[1] || ''; // same as the database's split_part(address, '@', 2)
  return domain !== '' && (snap.suppressed.has(domain) || snap.suppressed.has('@' + domain));
}

// ---------- approval rules (mirror of approve_outreach_message) ----------
// The database function is the authority. These copies exist only so the UI can disable Approve
// and explain why, using the same checks in the same order, with the same wording.

// Only these message types can ever be approved. 'reply' and anything unexpected cannot.
export const APPROVABLE_MESSAGE_TYPES = ['initial', 'followup_1', 'followup_2'];

// The prospect state each message type requires at the moment of approval.
const ELIGIBLE_PROSPECT_STATUSES = {
  initial: ['researched', 'needs_review'],
  followup_1: ['sent'],
  followup_2: ['followup_1']
};

const INELIGIBLE_TEXT = {
  initial: 'Prospect is no longer eligible for initial outreach.',
  followup_1: 'Prospect is no longer eligible for Follow-Up 1.',
  followup_2: 'Prospect is no longer eligible for Follow-Up 2.'
};

// Basic shape only (not full RFC validation); same idea as the database's regular expression.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isApprovableType(messageType) {
  return APPROVABLE_MESSAGE_TYPES.indexOf(messageType) !== -1;
}

/**
 * Why Approve should be disabled for this draft, or null if nothing blocks it.
 * UI convenience only: approve_outreach_message() enforces the same rules inside the database.
 * Order matches the database: type, prospect exists, do-not-contact, sales state, email, suppression.
 */
export function approvalBlocker(snap, message, prospect) {
  if (!isApprovableType(message.message_type)) return 'This message type cannot be approved from Command Center.';
  if (!prospect) return 'The prospect record could not be found.';
  if (prospect.do_not_contact || prospect.status === 'do_not_contact') return 'This prospect is marked do-not-contact.';
  if (ELIGIBLE_PROSPECT_STATUSES[message.message_type].indexOf(prospect.status) === -1) {
    return INELIGIBLE_TEXT[message.message_type];
  }
  const email = normalizeEmail(prospect.contact_email);
  if (email === '') return 'This prospect has no contact email.';
  if (!EMAIL_SHAPE.test(email)) return 'The contact email address is not valid.';
  if (isSuppressed(snap, prospect.contact_email)) return 'This email address or domain is on the suppression list.';
  return null;
}

/**
 * APPROXIMATE follow-up-due check, computed in the browser from timestamps.
 * n8n's own "Get Follow-Up Candidates" query is the authority; this is only a dashboard hint.
 */
export function isFollowupDue(prospect, now) {
  const ref = now instanceof Date ? now : new Date();
  if (!prospect.next_followup_at) return false;
  if (prospect.do_not_contact) return false;
  if (prospect.replied_at) return false;
  if (prospect.status === 'closed') return false;
  return new Date(prospect.next_followup_at).getTime() <= ref.getTime();
}

export function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const label = key === null || key === undefined || key === '' ? '(none)' : String(key);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return counts;
}

/** Statuses that exist in the data, sorted by STAGE_ORDER first, then alphabetically. */
export function sortStatuses(statuses) {
  const rank = (s) => {
    const i = STAGE_ORDER.indexOf(s);
    return i === -1 ? STAGE_ORDER.length : i;
  };
  return Array.from(statuses).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function latestTimestamp(values) {
  let best = null;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best);
}
