// Stark AI: page context, prospect context and the minimised operations summary.
//
// WHAT THIS FILE DOES
//  1. detectContext(hash)  -> which Command Center page you are on, and (on a prospect page) which prospect.
//  2. buildSummary(...)    -> a small, strictly allow-listed copy of the Phase 3B insights that is safe to send.
//
// DATA MINIMISATION
//  The Phase 3B insights layer (utilities/insights.js) is the ONLY place business logic lives. This file does not
//  recompute anything; it COPIES a few fields out of the insights object, and nothing else:
//   - only the sections the selected question needs (a status question never carries pipeline values, etc.)
//   - only the fields named in SUMMARY_SCHEMA below. Anything else (ids, links, rules, extra fields added in the
//     future) is dropped here, in the browser, before it can leave the machine.
//   - text is cleaned and length-capped, and anything that looks like an email address or phone number is replaced.
//  The summary never contains email addresses, phone numbers, contact names, notes, message subjects or bodies,
//  login data, or the contents of the suppression list. (Insights does not hold them either; this is a second lock.)
//
// TRUST
//  The summary is INFORMATIONAL ONLY. The server treats it as untrusted and re-checks it. It must never be used to
//  authorise a future write or send action. For questions about ONE prospect the browser sends only the prospect id;
//  the server reads the authoritative record (including do-not-contact and suppression state) itself.
//
// SYNC NOTE: SUMMARY_SCHEMA, SECTIONS_BY_INTENT and FREE_SECTIONS_BY_PAGE mirror the server's digest.ts / config.ts.
// A contract test compares them with the server source, so the two cannot drift apart unnoticed.

import { parseHash } from '../utilities/query.js';
import { PAGE_LABELS } from './starkAiPrompts.js';

export const SUMMARY_MAX_CHARS = 8000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const LIST_ROUTES = ['overview', 'queue', 'pipeline', 'prospects', 'activity', 'status'];

// ---------------------------------------------------------------------------------------------
// Page / prospect context
// ---------------------------------------------------------------------------------------------

/**
 * "#/prospects/<uuid>/timeline" -> { page: 'prospect', prospectId: '<uuid>' }
 * "#/pipeline"                  -> { page: 'pipeline',  prospectId: null }
 * Unknown or empty hashes fall back to the overview (the same fallback the router uses).
 * A prospect page whose id is not a valid UUID keeps page 'prospect' but prospectId null: nothing can be asked about
 * "a prospect" that does not exist, and the controller refuses (without any network request).
 */
export function detectContext(hash) {
  let segments = [];
  try {
    segments = parseHash(hash).segments;
  } catch (e) {
    segments = [];
  }
  const first = segments[0];
  if (LIST_ROUTES.indexOf(first) === -1) return { page: 'overview', prospectId: null };
  if (first === 'prospects' && segments.length >= 2) {
    const id = String(segments[1]);
    return { page: 'prospect', prospectId: UUID_RE.test(id) ? id.toLowerCase() : null };
  }
  return { page: first, prospectId: null };
}

/** A short company name for display only (never sent to the server). Plain text, capped, control characters removed. */
export function cleanLabel(value, max) {
  const limit = max || 80;
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

export function describeContext(context, prospectLabel) {
  const page = context && Object.prototype.hasOwnProperty.call(PAGE_LABELS, context.page) ? context.page : 'overview';
  return {
    page: page,
    pageLabel: PAGE_LABELS[page],
    prospectId: page === 'prospect' && context.prospectId ? context.prospectId : null,
    prospectLabel: page === 'prospect' ? cleanLabel(prospectLabel, 80) : ''
  };
}

// ---------------------------------------------------------------------------------------------
// Summary schema (allow-list). Same shape as the server's DIGEST_SCHEMA.
// ---------------------------------------------------------------------------------------------

const str = (max) => ({ t: 'str', max: max });
const int = (min, max) => ({ t: 'int', min: min === undefined ? 0 : min, max: max === undefined ? 1000000 : max });
const num = (min, max) => ({ t: 'num', min: min === undefined ? 0 : min, max: max === undefined ? 1e12 : max });
const bool = { t: 'bool' };
const arr = (of, max) => ({ t: 'arr', of: of, max: max });
const obj = (fields) => ({ t: 'obj', fields: fields });

const AGE = int(0, 1e12); // milliseconds
const FLAGS = arr(str(40), 6);

const attentionItem = obj({ label: str(120), statusLabel: str(60), status: str(40), ageMs: AGE, flags: FLAGS });
const messageItem = obj({ label: str(120), typeLabel: str(40), status: str(40), ageMs: AGE });
const followupItem = obj({ label: str(120), statusLabel: str(60), overdueMs: AGE, draftState: str(40), flags: FLAGS });
const replyItem = obj({ label: str(120), statusLabel: str(60), ageMs: AGE, flags: FLAGS, awaitingAttention: bool });
const valueBlock = obj({
  count: int(), valueMin: num(), valueMax: num(), withEstimate: int(), withoutEstimate: int(),
  averageLeadScore: num(0, 100), scoredCount: int()
});

export const SUMMARY_SCHEMA = Object.freeze({
  schemaVersion: int(0, 100),
  generatedAt: str(40),
  needsAttention: arr(obj({
    kind: str(30), severity: str(30), title: str(160), count: int(), oldestAgeMs: AGE, items: arr(attentionItem, 5)
  }), 7),
  nextActions: arr(obj({ rank: int(0, 50), kind: str(30), label: str(200), count: int(), doNotContact: bool }), 5),
  waitingApprovals: obj({ count: int(), items: arr(messageItem, 5) }),
  failedMessages: obj({ count: int(), items: arr(messageItem, 5) }),
  overdueFollowups: obj({ count: int(), withDraft: int(), items: arr(followupItem, 5) }),
  recentReplies: obj({ count: int(), awaitingAttention: int(), items: arr(replyItem, 5) }),
  pipelineSummary: obj({
    totalProspects: int(),
    active: valueBlock, qualified: valueBlock, proposals: valueBlock, won: valueBlock,
    phases: arr(obj({
      key: str(30), label: str(60), count: int(), valueMin: num(), valueMax: num(),
      stages: arr(obj({
        label: str(60), count: int(), valueMin: num(), valueMax: num(), withEstimate: int(), withoutEstimate: int()
      }), 8)
    }), 6)
  }),
  recentActivity: obj({
    total: int(),
    items: arr(obj({ label: str(80), group: str(30), company: str(120), ageMs: AGE }), 8)
  }),
  systemHealth: obj({
    exceptionsTotal: int(), evidenceNote: str(240),
    unassigned: obj({ failed: int(), stuck: int() }),
    systems: arr(obj({
      label: str(80), kind: str(30), publishedLabel: str(40), attention: str(20),
      lastEvidence: obj({ at: str(40), source: str(80) }),
      backlog: obj({ total: int() }),
      exceptions: arr(obj({ label: str(120), count: int() }), 6)
    }), 6)
  })
});

// Which sections each question may carry. A question about ONE prospect carries none (the server loads that record).
export const SECTIONS_BY_INTENT = Object.freeze({
  free: ['needsAttention', 'nextActions', 'pipelineSummary', 'systemHealth'],
  overview_attention: ['needsAttention', 'nextActions', 'recentReplies', 'overdueFollowups', 'waitingApprovals', 'failedMessages'],
  sales_brief: ['pipelineSummary', 'recentReplies', 'overdueFollowups', 'nextActions', 'needsAttention'],
  work_next: ['nextActions', 'needsAttention', 'recentReplies', 'overdueFollowups', 'waitingApprovals', 'failedMessages'],
  prospect_summary: [], prospect_next_step: [], prospect_followup: [], call_prep: [],
  pipeline_summary: ['pipelineSummary', 'nextActions'],
  pipeline_strongest: ['pipelineSummary', 'recentReplies', 'overdueFollowups'],
  pipeline_stuck: ['pipelineSummary', 'overdueFollowups', 'needsAttention'],
  activity_changed: ['recentActivity', 'recentReplies', 'nextActions'],
  activity_summary: ['recentActivity', 'recentReplies'],
  status_explain: ['systemHealth', 'failedMessages', 'needsAttention'],
  status_stuck: ['systemHealth', 'failedMessages', 'needsAttention'],
  queue_review: ['waitingApprovals', 'failedMessages', 'nextActions'],
  queue_prioritize: ['waitingApprovals', 'overdueFollowups', 'nextActions']
});

// A free-form question gets a few extra sections on the pages where they make sense.
export const FREE_SECTIONS_BY_PAGE = Object.freeze({
  overview: ['recentReplies', 'overdueFollowups', 'waitingApprovals', 'failedMessages'],
  prospects: ['recentReplies', 'overdueFollowups'],
  pipeline: ['recentReplies', 'overdueFollowups'],
  queue: ['waitingApprovals', 'failedMessages', 'overdueFollowups'],
  activity: ['recentActivity', 'recentReplies'],
  status: ['failedMessages'],
  prospect: []
});

/** The section names a question is allowed to carry (empty for an unknown intent). */
export function sectionsFor(intent, page) {
  if (page === 'prospect') return []; // about ONE prospect: the server loads the record itself, the browser sends no summary
  if (!Object.prototype.hasOwnProperty.call(SECTIONS_BY_INTENT, intent)) return [];
  const wanted = SECTIONS_BY_INTENT[intent].slice();
  if (intent === 'free' && Object.prototype.hasOwnProperty.call(FREE_SECTIONS_BY_PAGE, page)) {
    FREE_SECTIONS_BY_PAGE[page].forEach((s) => { if (wanted.indexOf(s) === -1) wanted.push(s); });
  }
  return wanted;
}

// ---------------------------------------------------------------------------------------------
// Projection (copy only what the schema names; drop everything else)
// ---------------------------------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
const EMAIL_RE = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[^\s@<>()[\]",;:]+/g;
// 555-010-9999, (555) 010 9999, +1 555.010.9999, 5550109999. (Dates such as 2026-10-07 do not match.)
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

/** Clean a piece of text: control characters out, email-like and phone-like text replaced, trimmed, capped. */
export function cleanSummaryText(value, max) {
  return String(value)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .replace(EMAIL_RE, '[removed]')
    .replace(PHONE_RE, '[removed]')
    .trim()
    .slice(0, max);
}

const OMIT = Symbol('omit');

function project(spec, value) {
  if (value === null) return null;
  switch (spec.t) {
    case 'str':
      return typeof value === 'string' ? cleanSummaryText(value, spec.max) : OMIT;
    case 'bool':
      return typeof value === 'boolean' ? value : OMIT;
    case 'int':
    case 'num': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return OMIT;
      const clamped = Math.min(spec.max, Math.max(spec.min, value));
      return spec.t === 'int' ? Math.round(clamped) : clamped;
    }
    case 'arr': {
      if (!Array.isArray(value)) return OMIT;
      const out = [];
      value.slice(0, spec.max).forEach((v) => {
        const p = project(spec.of, v);
        if (p !== OMIT) out.push(p);
      });
      return out;
    }
    case 'obj': {
      if (typeof value !== 'object' || Array.isArray(value)) return OMIT;
      const out = {};
      Object.keys(spec.fields).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(value, key)) return;
        const p = project(spec.fields[key], value[key]);
        if (p !== OMIT) out[key] = p;
      });
      return out;
    }
    default:
      return OMIT;
  }
}

// Same size measure the server uses (it escapes < > & in the model prompt, which makes the text slightly longer).
function measure(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .length;
}

/** Shrink to the size budget: fewer list items first, then drop the last sections. */
export function fitSummary(sections, maxChars) {
  const limit = maxChars === undefined ? SUMMARY_MAX_CHARS : maxChars;
  let current = JSON.parse(JSON.stringify(sections));
  const trimItems = (n) => {
    const visit = (v) => {
      if (Array.isArray(v)) { v.forEach(visit); return; }
      if (v && typeof v === 'object') {
        if (Array.isArray(v.items) && v.items.length > n) v.items = v.items.slice(0, n);
        Object.keys(v).forEach((k) => visit(v[k]));
      }
    };
    visit(current);
  };
  const keep = [3, 2, 1, 0];
  for (let i = 0; i < keep.length; i++) {
    if (measure(current) <= limit) return current;
    trimItems(keep[i]);
  }
  const keys = Object.keys(current).filter((k) => k !== 'generatedAt' && k !== 'schemaVersion');
  while (measure(current) > limit && keys.length) delete current[keys.pop()];
  if (measure(current) > limit) current = {};
  return current;
}

/**
 * Build the operations summary for ONE question.
 *   insights : the object returned by getInsights() (Phase 3B)
 *   intent   : the question type (decides which sections are copied)
 *   page     : the page the question is asked from
 * Returns null when there is nothing to send (no insights, an unknown intent, or a question about one prospect).
 */
export function buildSummary(insights, options) {
  const opts = options || {};
  if (!insights || typeof insights !== 'object' || Array.isArray(insights)) return null;
  const sections = sectionsFor(opts.intent, opts.page);
  if (!sections.length) return null;

  const out = {};
  if (typeof insights.schemaVersion === 'number') {
    const v = project(SUMMARY_SCHEMA.schemaVersion, insights.schemaVersion);
    if (v !== OMIT) out.schemaVersion = v;
  }
  const generatedAt = insights.meta && typeof insights.meta === 'object' ? insights.meta.generatedAt : null;
  if (typeof generatedAt === 'string') out.generatedAt = cleanSummaryText(generatedAt, SUMMARY_SCHEMA.generatedAt.max);

  sections.forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(insights, key)) return;
    const p = project(SUMMARY_SCHEMA[key], insights[key]);
    if (p !== OMIT && p !== null) out[key] = p;
  });
  return fitSummary(out, SUMMARY_MAX_CHARS);
}
