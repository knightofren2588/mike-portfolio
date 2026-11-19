// READ-ONLY data access for the Command Center.
//
// This file only READS (.select()). Every write the app can make lives in actions.js, and is limited
// to exactly three database functions. There is no insert / update / upsert / delete here.
// Even if some code tried a direct table write, the database has no write grants or policies for
// browser roles, so it would fail with "permission denied".
//
// Columns are listed explicitly (never "*") and match the verified Stark Tech Sales schema.

import { sb } from './supabaseClient.js';
import { PAGE_SIZE, MAX_ROWS_PER_TABLE, SENDER_WORKFLOWS } from './config.js';
import { PROSPECT_STATUSES } from './utilities/labels.js';
import { isMissingTable } from './utilities/findings.js';

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

// Step 612: website research findings (read-only, admin-only through RLS). The table is added by a separate, not yet applied
// migration, so a missing table is NOT an error: the app simply shows "not installed yet".
const FINDING_COLUMNS = [
  'id', 'prospect_id', 'run_sha256', 'check_id', 'category', 'title', 'status', 'confidence', 'observation',
  'evidence_source_url', 'evidence_source_type', 'evidence_snippet', 'observed_at', 'recommended_solution',
  'impact_note', 'service', 'weight', 'is_primary', 'created_at'
].join(',');

// Step 620: discovered businesses (read-only, admin-only through RLS). Public-directory data staged by the research engine; NOT prospects.
// Fail-soft like findings: a missing table (migration 33 not applied yet) is "not installed", never an error.
// There is no email or phone VALUE in these tables, only has_phone / has_email flags.
const DISCOVERY_COLUMNS = [
  'id', 'overture_id', 'name', 'website', 'domain', 'address', 'city', 'state', 'postcode', 'region_label', 'category', 'category_group',
  'confidence', 'datasets', 'independent_datasets', 'operating_status', 'has_phone', 'has_email', 'identity_strength', 'qualification',
  'score', 'score_parts', 'shortlisted', 'shortlist_rank', 'shortlist_reason', 'hypotheses', 'missing', 'rules_version', 'crm_status',
  'crm_reason', 'crm_checked_at', 'prospect_id', 'research_status', 'research_attempts', 'research_error', 'researched_at',
  'research_summary', 'research_claimed_at', 'promoted_at', 'first_seen_at', 'last_seen_at'
].join(',');
const DISCOVERY_RUN_COLUMNS = ['id', 'run_key', 'kind', 'status', 'overture_release', 'rules_version', 'executor', 'stats', 'rows_staged', 'started_at', 'finished_at'].join(',');
// Step 624: one heartbeat row per scheduled pull or research run (success or failure). The error text never contains an address or a link (the database refuses it).
const DISCOVERY_HEARTBEAT_COLUMNS = ['id', 'kind', 'status', 'executor', 'error', 'started_at'].join(',');
const DISCOVERY_FINDING_COLUMNS = [
  'id', 'candidate_id', 'run_sha256', 'check_id', 'category', 'title', 'status', 'confidence', 'observation', 'evidence_source_url',
  'evidence_source_type', 'evidence_snippet', 'observed_at', 'recommended_solution', 'impact_note', 'service', 'weight', 'is_primary', 'created_at'
].join(',');

// Only the address is needed (to disable Approve for suppressed contacts).
const SUPPRESSION_COLUMNS = ['id', 'email'].join(',');

// Status values that the existing n8n workflows rely on (from the verified setup).
// The UI only uses these to decide where a message belongs; every other value in the
// database is still displayed exactly as it is.
export const MESSAGE_STATUS_DRAFT = 'draft';
export const MESSAGE_STATUS_APPROVED = 'approved';

// Display order for pipeline columns and status filters: the real prospect statuses your database allows
// (utilities/labels.js is the single source). A status that is not in the data simply has no rows.
export const STAGE_ORDER = PROSPECT_STATUSES;

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
async function selectAll(table, columns, orderColumn, narrow) {
  const order = orderColumn || 'created_at';
  const rows = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE_SIZE) {
    const base = sb.from(table).select(columns);
    const { data, error } = await (typeof narrow === 'function' ? narrow(base) : base)
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

/** Findings never block the rest of the app: any problem is reported as "unavailable". */
async function selectFindings() {
  try {
    const result = await selectAll('website_findings', FINDING_COLUMNS);
    result.available = true;
    return result;
  } catch (err) {
    if (err && err.authExpired) throw err; // a dead session is still a dead session
    return { rows: [], truncated: false, available: false, missing: isMissingTable(err && { code: err.code, message: err.message }) };
  }
}

/** Discovery never blocks the rest of the app: any problem is reported as "unavailable". Only qualified candidates are loaded (rejected ones are counted in the run stats). */
async function selectDiscovery() {
  try {
    const result = await selectAll('discovery_candidates', DISCOVERY_COLUMNS, 'score', (q) => q.eq('qualification', 'qualified'));
    // the newest STAGING batch carries the statistics; heartbeats (kind pull / research) are loaded separately and never mistaken for it
    const { data: runs } = await sb.from('discovery_runs').select(DISCOVERY_RUN_COLUMNS).eq('kind', 'batch').order('started_at', { ascending: false }).limit(1);
    return { ...result, available: true, run: runs && runs[0] ? runs[0] : null, heartbeats: await selectHeartbeats(), loadedAt: new Date() };
  } catch (err) {
    if (err && err.authExpired) throw err;
    return { rows: [], truncated: false, available: false, run: null, loadedAt: new Date(), missing: isMissingTable(err && { code: err.code, message: err.message }) };
  }
}

/** Recent scheduled-run heartbeats. Soft: a problem here only means "no health information", it never hides the businesses. */
async function selectHeartbeats() {
  try {
    const { data, error } = await sb.from('discovery_runs').select(DISCOVERY_HEARTBEAT_COLUMNS).in('kind', ['pull', 'research']).order('started_at', { ascending: false }).limit(60);
    return error ? [] : (data || []);
  } catch (err) {
    if (err && err.authExpired) throw err;
    return [];
  }
}

/** The light read for System Status: heartbeats plus stuck claims only (it does not load the businesses). */
async function selectDiscoveryHealth() {
  try {
    const { error: probe } = await sb.from('discovery_runs').select('id').limit(1);
    if (probe) throw toError('discovery_runs', probe);
    const heartbeats = await selectHeartbeats();
    const { data: claimed } = await sb.from('discovery_candidates').select('id,research_claimed_at').eq('research_status', 'claimed').limit(200);
    return { available: true, heartbeats, rows: (claimed || []).map((c) => ({ research_status: 'claimed', research_claimed_at: c.research_claimed_at })), loadedAt: new Date() };
  } catch (err) {
    if (err && err.authExpired) throw err;
    return { available: false, heartbeats: [], rows: [], missing: isMissingTable(err && { code: err.code, message: err.message }), loadedAt: new Date() };
  }
}

let cache = null;
let inflight = null;
let discoveryCache = null;
let healthCache = null;
let generation = 0; // bumped by clearCache(): a load that was in flight when you signed out must not refill the cache

export function clearCache() {
  cache = null;
  inflight = null;
  discoveryCache = null;
  healthCache = null;
  generation++;
}

/** Discovered businesses (read-only), loaded on demand and cached until Refresh or sign-out. */
export async function getDiscovery(options) {
  if (discoveryCache && !(options && options.force)) return discoveryCache;
  const startedInGeneration = generation;
  const result = await selectDiscovery();
  if (startedInGeneration === generation) discoveryCache = result;
  return result;
}

/** Discovery job health for System Status (read-only, cached until Refresh or sign-out; a problem here never blocks the page). */
export async function getDiscoveryHealth(options) {
  if (healthCache && !(options && options.force)) return healthCache;
  const startedInGeneration = generation;
  const result = await selectDiscoveryHealth();
  if (startedInGeneration === generation) healthCache = result;
  return result;
}

/** The cached discovery data, or null when it has not been loaded (used for the navigation badge; never loads anything). */
export function peekDiscovery() {
  return discoveryCache;
}

/** Research evidence for ONE candidate. Same row shape as website_findings, so the same panels display it. */
export async function getDiscoveryFindings(candidateId) {
  try {
    const { data, error } = await sb.from('discovery_findings').select(DISCOVERY_FINDING_COLUMNS).eq('candidate_id', String(candidateId)).order('created_at', { ascending: false }).limit(100);
    if (error) throw toError('discovery_findings', error);
    return { rows: data || [], available: true };
  } catch (err) {
    if (err && err.authExpired) throw err;
    return { rows: [], available: false };
  }
}

/** Load (or reuse) one read-only snapshot of the CRM. */
export function getSnapshot(options) {
  const force = !!(options && options.force);
  if (force) { discoveryCache = null; healthCache = null; } // Refresh re-reads discovery data too
  if (cache && !force) return Promise.resolve(cache);
  if (inflight) return inflight;

  const run = (async () => {
    const startedInGeneration = generation;
    const [p, m, a, s, f] = await Promise.all([
      selectAll('prospects', PROSPECT_COLUMNS),
      selectMessages(),
      selectAll('activities', ACTIVITY_COLUMNS),
      selectAll('suppression_list', SUPPRESSION_COLUMNS, 'suppressed_at'),
      selectFindings()
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

    const findingsByProspect = new Map();
    for (const row of f.rows) {
      const key = String(row.prospect_id);
      if (!findingsByProspect.has(key)) findingsByProspect.set(key, []);
      findingsByProspect.get(key).push(row);
    }

    const suppressed = new Set();
    for (const row of s.rows) {
      const value = normalizeEmail(row.email);
      if (value) suppressed.add(value);
    }

    const snapshot = {
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
      activitiesByProspect: activitiesByProspect,
      findingsByProspect: findingsByProspect,
      findingsAvailable: f.available
    };
    // If you signed out while this was loading, hand the result to the caller but do NOT keep it.
    if (startedInGeneration === generation) cache = snapshot;
    return snapshot;
  })();

  const tracked = run.finally(() => {
    if (inflight === tracked) inflight = null;
  });
  inflight = tracked;
  return tracked;
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

/**
 * What config.js says about a sender workflow for this message type. Command Center cannot see n8n, so this
 * only reflects what YOU set in config.js (SENDER_WORKFLOWS); it never claims a workflow is live.
 *   'ready'    marked published in config.js
 *   'unready'  a workflow is listed but NOT marked published
 *   'none'     no sender workflow listed for this type
 */
export function senderCapability(messageType) {
  const entry = SENDER_WORKFLOWS[messageType];
  if (!entry) return { state: 'none', workflow: null, note: null };
  return { state: entry.published ? 'ready' : 'unready', workflow: entry.workflow || 'sender workflow', note: entry.note || null };
}

/** Warning for approving / queueing a message of this type, or null when config.js marks its sender as published. */
export function senderWarning(messageType) {
  const cap = senderCapability(messageType);
  const type = messageType || 'unknown';
  if (cap.state === 'ready') return null;
  if (cap.state === 'unready') {
    return 'According to config.js, the ' + cap.workflow + ' is not marked as published, so an approved "' + type +
      '" message will wait until it is.' + (cap.note ? ' ' + cap.note : '');
  }
  return 'According to config.js, no sender workflow is set up for "' + type + '" messages, so an approved one will wait.';
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

// Prospects that are no longer in play. "Active" means NOT one of these statuses and NOT flagged do-not-contact.
export const INACTIVE_PROSPECT_STATUSES = ['closed', 'won', 'lost', 'do_not_contact'];

/** True when the prospect is flagged do-not-contact, by the flag or by the status. */
export function isDoNotContact(prospect) {
  return !!prospect.do_not_contact || prospect.status === 'do_not_contact';
}

/** Active prospect: not closed / won / lost / do_not_contact, and not flagged do-not-contact. */
export function isActiveProspect(prospect) {
  return INACTIVE_PROSPECT_STATUSES.indexOf(prospect.status) === -1 && !prospect.do_not_contact;
}

/**
 * APPROXIMATE follow-up-due check, computed in the browser from timestamps.
 * n8n's own "Get Follow-Up Candidates" query is the authority; this is only a dashboard hint.
 */
export function isFollowupDue(prospect, now) {
  const ref = now instanceof Date ? now : new Date();
  if (!prospect.next_followup_at) return false;
  if (!isActiveProspect(prospect)) return false;
  if (prospect.replied_at) return false;
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
