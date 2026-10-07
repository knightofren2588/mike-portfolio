// Operations intelligence: ONE place that turns the authenticated CRM snapshot into the business concepts the
// dashboards (and the future Stark AI layer) need, so nothing has to re-interpret raw tables.
//
//   needsAttention, nextActions, waitingApprovals, failedMessages, overdueFollowups, recentReplies,
//   upcoming, pipelineSummary, recentActivity, systemHealth, meta
//
// RULES
//  - PURE and READ-ONLY: no database calls, no DOM, no network. Input is the snapshot already loaded for the signed-in admin.
//  - JSON-SAFE: only strings, numbers, booleans, null, arrays and plain objects (dates are ISO strings), so
//    JSON.stringify(insights) round-trips exactly.
//  - DATA-MINIMAL: items carry ids, company names, statuses, labels, timestamps and counts. They never contain
//    email addresses, phone numbers, contact names, message subjects, message bodies or notes.
//  - NOT STORED: nothing here is saved, attached to window, logged or sent anywhere. The small cache is in memory only
//    and is wiped when the session ends.
//  - HONEST: it describes DATABASE EVIDENCE and Command Center configuration. It never claims an n8n workflow is live,
//    running or healthy. Urgency comes only from explicit states (failed, stuck beyond the configured threshold,
//    a reply, a past follow-up date). Nothing is flagged merely because a system is quiet.

import {
  isAwaitingApproval, isApprovedWaiting, isFollowupDue, isActiveProspect, isDoNotContact
} from '../api.js';
import { ATTENTION, AUTOMATION_SYSTEMS, SENDER_WORKFLOWS } from '../config.js';
import { PHASES, statusLabel, messageTypeLabel, activityLabel, activityGroup } from './labels.js';
import { toNumber } from '../dom.js';
import { buildHash, hrefProspect } from './query.js';
import { onSessionEnd } from './session.js';

export const SCHEMA_VERSION = 1;
export const INSIGHT_KEYS = [
  'needsAttention', 'nextActions', 'waitingApprovals', 'failedMessages', 'overdueFollowups', 'recentReplies',
  'upcoming', 'pipelineSummary', 'recentActivity', 'systemHealth', 'meta'
];

const MINUTE = 60 * 1000;
const FOLLOWUP_TYPES = ['followup_1', 'followup_2'];
const EXPECTED_FOLLOWUP = { sent: 'followup_1', followup_1: 'followup_2' }; // prospect status -> the next follow-up type

// ---------- small helpers ----------
function ms(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function iso(t) {
  return t === null || t === undefined ? null : new Date(t).toISOString();
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

/** Sort by a numeric key. Missing values always last. Ties broken by id so the order is stable. */
function sortBy(list, keyOf, descending) {
  return list.slice().sort((a, b) => {
    const x = keyOf(a), y = keyOf(b);
    if (x === null && y === null) return String(a.id).localeCompare(String(b.id));
    if (x === null) return 1;
    if (y === null) return -1;
    return (descending ? y - x : x - y) || String(a.id).localeCompare(String(b.id));
  });
}

function resolveConfig(c) {
  const o = c || {};
  return {
    ATTENTION: Object.assign({}, ATTENTION, o.ATTENTION || {}),
    AUTOMATION_SYSTEMS: o.AUTOMATION_SYSTEMS || AUTOMATION_SYSTEMS,
    SENDER_WORKFLOWS: o.SENDER_WORKFLOWS || SENDER_WORKFLOWS
  };
}

/** 'ready' = marked published in config, 'unready' = listed but not marked published, 'none' = no workflow listed. */
function senderState(type, cfg) {
  const entry = cfg.SENDER_WORKFLOWS[type];
  if (!entry) return 'none';
  return entry.published ? 'ready' : 'unready';
}

const queueSection = (key) => buildHash(['queue'], { section: key });
const queueMessage = (id) => buildHash(['queue'], { msg: String(id) });

/** Estimated value range for one prospect. If only one side exists it is used for both. Null = no estimate. */
function valueRange(p) {
  // A zero or negative figure is treated as "not set" (it is almost always a placeholder, not a real estimate).
  const usable = (v) => { const n = toNumber(v); return n !== null && n > 0 ? n : null; };
  const a = usable(p.estimated_value_min);
  const b = usable(p.estimated_value_max);
  if (a === null && b === null) return null;
  const lo = a === null ? b : a;
  const hi = b === null ? a : b;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function summarize(list) {
  let min = 0, max = 0, n = 0;
  list.forEach((p) => {
    const r = valueRange(p);
    if (r) { min += r[0]; max += r[1]; n++; }
  });
  return {
    count: list.length,
    valueMin: n ? min : null,
    valueMax: n ? max : null,
    withEstimate: n,
    withoutEstimate: list.length - n
  };
}

// =====================================================================================================
export function buildInsights(snap, options) {
  const opts = options || {};
  const nowMs = opts.now instanceof Date ? opts.now.getTime() : Date.now();
  const now = new Date(nowMs);
  const cfg = resolveConfig(opts.config);
  const A = cfg.ATTENTION;
  const limit = A.listLimit > 0 ? A.listLimit : 5;

  const prospects = snap.prospects || [];
  const messages = snap.messages || [];
  const activities = snap.activities || [];

  const byId = new Map();
  prospects.forEach((p) => byId.set(String(p.id), p));
  const companyOf = (id) => {
    const p = byId.get(String(id));
    return p ? (p.company_name || '(unnamed company)') : 'Unknown prospect';
  };

  // ---------- message classification ----------
  const awaiting = messages.filter(isAwaitingApproval);
  const approvedWaiting = messages.filter(isApprovedWaiting);
  const scheduled = messages.filter((m) => m.status === 'scheduled');
  const failed = messages.filter((m) => m.status === 'failed');

  const stuckLimitMs = A.scheduledStuckMinutes === null || A.scheduledStuckMinutes === undefined
    ? null : A.scheduledStuckMinutes * MINUTE;
  const scheduledView = scheduled.map((m) => {
    const t = ms(m.scheduled_at);
    if (t === null) return { m: m, state: 'claim_time_unknown', t: null };
    const stuck = stuckLimitMs !== null && nowMs - t > stuckLimitMs;
    return { m: m, state: stuck ? 'stuck' : 'in_flight', t: t };
  });
  const stuck = scheduledView.filter((s) => s.state === 'stuck');
  const inFlight = scheduledView.filter((s) => s.state !== 'stuck');

  const messageItem = (m, atValue, atKind, extra) => {
    const t = ms(atValue);
    return Object.assign({
      messageId: String(m.id),
      prospectId: String(m.prospect_id),
      label: companyOf(m.prospect_id),
      messageType: m.message_type || null,
      typeLabel: messageTypeLabel(m.message_type),
      status: m.status,
      at: iso(t),
      atKind: atKind,
      ageMs: t === null ? null : nowMs - t,
      href: queueMessage(m.id)
    }, extra || {});
  };

  const prospectItem = (p, atValue, atKind, extra) => {
    const t = ms(atValue);
    return Object.assign({
      prospectId: String(p.id),
      label: p.company_name || '(unnamed company)',
      status: p.status || null,
      statusLabel: statusLabel(p.status),
      at: iso(t),
      atKind: atKind,
      ageMs: t === null ? null : nowMs - t,
      href: hrefProspect(p.id),
      flags: isDoNotContact(p) ? ['do_not_contact'] : []
    }, extra || {});
  };

  // ---------- the lists behind Needs Attention ----------
  const awaitingItems = sortBy(awaiting, (m) => ms(m.created_at), false)
    .map((m) => messageItem(m, m.created_at, 'drafted'));

  const failedItems = sortBy(failed, (m) => ms(m.created_at), true)
    .map((m) => messageItem(m, m.created_at, 'drafted'));

  const stuckItems = sortBy(stuck.map((s) => s.m), (m) => ms(m.scheduled_at), false)
    .map((m) => messageItem(m, m.scheduled_at, 'scheduled', { state: 'stuck' }));

  const waitingItems = sortBy(approvedWaiting, (m) => ms(m.approved_at) !== null ? ms(m.approved_at) : ms(m.created_at), false)
    .map((m) => messageItem(m, m.approved_at || m.created_at, 'approved', { senderState: senderState(m.message_type, cfg) }));

  // Follow-up drafts that already exist, so an overdue follow-up can be labelled (never hidden).
  const followupMessages = new Map(); // prospectId -> [{ state, message }]
  awaiting.concat(approvedWaiting).forEach((m) => {
    if (FOLLOWUP_TYPES.indexOf(m.message_type) === -1) return;
    const key = String(m.prospect_id);
    if (!followupMessages.has(key)) followupMessages.set(key, []);
    followupMessages.get(key).push({ state: isAwaitingApproval(m) ? 'draft_in_queue' : 'approved_waiting', message: m });
  });
  const draftFor = (p) => {
    const list = followupMessages.get(String(p.id));
    if (!list || !list.length) return null;
    const expected = EXPECTED_FOLLOWUP[p.status];
    return list.find((x) => x.message.message_type === expected) || (expected ? null : list[0]);
  };

  const overdueProspects = sortBy(prospects.filter((p) => isFollowupDue(p, now)), (p) => ms(p.next_followup_at), false);
  const overdueItems = overdueProspects.map((p) => {
    const d = draftFor(p);
    return prospectItem(p, p.next_followup_at, 'due', {
      overdueMs: nowMs - ms(p.next_followup_at),
      draftState: d ? d.state : null,
      messageId: d ? String(d.message.id) : null,
      messageHref: d ? queueMessage(d.message.id) : null
    });
  });

  const awaitingReplyProspects = sortBy(prospects.filter((p) => p.status === 'replied'), (p) => ms(p.replied_at), true);
  const replyItems = awaitingReplyProspects.map((p) => prospectItem(p, p.replied_at, 'replied'));

  const reviewProspects = sortBy(prospects.filter((p) => p.status === 'needs_review' && !isDoNotContact(p)), (p) => ms(p.created_at), false);
  const reviewItems = reviewProspects.map((p) => prospectItem(p, p.created_at, 'added'));

  // ---------- needsAttention ----------
  const entry = (kind, severity, title, full, href, rule, extra) => {
    const ats = full.map((i) => ms(i.at)).filter((x) => x !== null);
    const oldest = ats.length ? Math.min.apply(null, ats) : null;
    return Object.assign({
      kind: kind, severity: severity, title: title, count: full.length,
      oldestAt: iso(oldest), oldestAgeMs: oldest === null ? null : nowMs - oldest,
      href: href, rule: rule, items: full.slice(0, limit)
    }, extra || {});
  };
  const n = (list) => list.length;
  const candidates = {};
  if (n(replyItems)) candidates.replies = entry('replies', 'reply',
    n(replyItems) + ' ' + plural(n(replyItems), 'reply awaits', 'replies await') + ' your attention',
    replyItems, n(replyItems) === 1 ? replyItems[0].href : buildHash(['prospects'], { status: 'replied' }),
    'Prospect status is "replied". It stays here until the status changes.');
  if (n(failedItems)) candidates.failed = entry('failed', 'failure',
    n(failedItems) + ' failed ' + plural(n(failedItems), 'message', 'messages'),
    failedItems, queueSection('failed'), 'Message status is "failed". An explicit failure until resolved or removed.');
  if (n(stuckItems)) candidates.stuck = entry('stuck', 'failure',
    n(stuckItems) + ' scheduled ' + plural(n(stuckItems), 'message', 'messages') + ' may be stuck (over ' + A.scheduledStuckMinutes + ' min)',
    stuckItems, queueSection('waiting'),
    'Message status is "scheduled" (the in-flight claim state) and scheduled_at is more than ' + A.scheduledStuckMinutes + ' minutes old.');
  if (n(awaitingItems)) candidates.drafts = entry('drafts', 'waiting',
    n(awaitingItems) + ' ' + plural(n(awaitingItems), 'draft awaits', 'drafts await') + ' approval',
    awaitingItems, queueSection('awaiting'), 'Message status is "draft" and not approved. Waiting on you.');
  if (n(overdueItems)) candidates.overdue = entry('overdue', 'overdue',
    n(overdueItems) + ' overdue ' + plural(n(overdueItems), 'follow-up', 'follow-ups'),
    overdueItems, buildHash(['prospects'], { due: 'yes', sort: 'followup' }),
    'Active prospect, not replied, with a next follow-up date in the past. An estimate: n8n\'s own query is the authority.',
    { withDraft: overdueItems.filter((i) => i.draftState).length });
  if (n(reviewItems)) candidates.review = entry('review', 'waiting',
    n(reviewItems) + ' ' + plural(n(reviewItems), 'prospect needs', 'prospects need') + ' review',
    reviewItems, buildHash(['prospects'], { status: 'needs_review' }), 'Prospect status is "needs_review". Waiting on you.');
  if (n(waitingItems)) {
    const expected = waitingItems.every((i) => i.senderState !== 'ready');
    candidates.waiting = entry('waiting', 'info',
      n(waitingItems) + ' approved ' + plural(n(waitingItems), 'message', 'messages') + ' waiting to send',
      waitingItems, queueSection('waiting'),
      'Message status is "approved" and not yet sent.' ,
      { expectedToWait: expected,
        note: expected ? 'Expected to wait: according to Command Center configuration, the sender for these messages is not marked as published.' : null });
  }
  const order = (A.nextActionOrder || []).slice();
  Object.keys(candidates).forEach((k) => { if (order.indexOf(k) === -1) order.push(k); });
  const needsAttention = order.filter((k) => candidates[k]).map((k) => candidates[k]);

  // ---------- nextActions (deterministic business rules, not AI) ----------
  const isDncItem = (i) => !!i.flags && i.flags.indexOf('do_not_contact') !== -1;
  const actionLabel = (e) => {
    const first = e.items[0];
    switch (e.kind) {
      // SAFETY: a do-not-contact prospect is NEVER given an outbound recommendation ("Reply to ..."). A reply from one is
      // surfaced for REVIEW ONLY, with the do-not-contact state stated in the label itself.
      case 'replies': {
        const dnc = replyItems.filter(isDncItem).length; // over the FULL list, not just the first few shown
        if (e.count === 1) return dnc ? 'Review reply from ' + first.label + ' · Do not contact is active' : 'Reply to ' + first.label;
        return 'Review ' + e.count + ' replies' + (dnc ? ' · ' + dnc + ' flagged do not contact' : '');
      }
      case 'failed': return 'Review ' + e.count + ' failed ' + plural(e.count, 'message', 'messages');
      case 'stuck': return 'Check ' + e.count + ' possibly stuck ' + plural(e.count, 'message', 'messages');
      case 'drafts': return 'Approve ' + e.count + ' outreach ' + plural(e.count, 'draft', 'drafts');
      case 'overdue': return e.count === 1 ? 'Follow up with ' + first.label : 'Follow up on ' + e.count + ' overdue prospects';
      case 'review': return 'Review ' + e.count + ' ' + plural(e.count, 'prospect', 'prospects');
      default: return e.count + ' approved ' + plural(e.count, 'message', 'messages') + ' waiting to send';
    }
  };
  const nextActions = needsAttention.slice(0, A.nextActionCount > 0 ? A.nextActionCount : 3).map((e, i) => ({
    rank: i + 1, kind: e.kind, severity: e.severity, label: actionLabel(e), count: e.count,
    doNotContact: e.kind === 'replies' && replyItems.some(isDncItem),
    href: e.kind === 'replies' || e.kind === 'overdue' ? (e.count === 1 ? e.items[0].href : e.href) : e.href,
    reason: e.rule
  }));

  // ---------- waitingApprovals / failedMessages / overdueFollowups / recentReplies ----------
  const waitingApprovals = { count: awaitingItems.length, items: awaitingItems.slice(0, limit) };
  const failedMessages = { count: failedItems.length, items: failedItems.slice(0, limit) };
  const overdueFollowups = {
    count: overdueItems.length,
    withDraft: overdueItems.filter((i) => i.draftState).length,
    items: overdueItems.slice(0, limit)
  };
  const repliedEver = sortBy(prospects.filter((p) => ms(p.replied_at) !== null), (p) => ms(p.replied_at), true);
  const recentReplies = {
    count: repliedEver.length,
    awaitingAttention: awaitingReplyProspects.length,
    items: repliedEver.slice(0, limit).map((p) => prospectItem(p, p.replied_at, 'replied', { awaitingAttention: p.status === 'replied' }))
  };

  // ---------- upcoming ----------
  const futureFollowups = sortBy(prospects.filter((p) => isActiveProspect(p) && !p.replied_at && ms(p.next_followup_at) !== null && ms(p.next_followup_at) > nowMs),
    (p) => ms(p.next_followup_at), false);
  const outreachRows = [];
  scheduledView.forEach((s) => outreachRows.push({ m: s.m, t: s.t, state: s.state === 'stuck' ? 'stuck' : 'scheduled' }));
  approvedWaiting.forEach((m) => outreachRows.push({ m: m, t: ms(m.approved_at) !== null ? ms(m.approved_at) : ms(m.created_at), state: 'approved' }));
  const outreachSorted = sortBy(outreachRows.map((r) => Object.assign({ id: r.m.id }, r)), (r) => r.t, false);
  const contacted = sortBy(prospects.filter((p) => ms(p.last_contact_at) !== null), (p) => ms(p.last_contact_at), true);
  const upcoming = {
    overdueFollowups: { count: overdueItems.length, items: overdueItems.slice(0, limit) },
    nextFollowups: {
      count: futureFollowups.length,
      items: futureFollowups.slice(0, limit).map((p) => prospectItem(p, p.next_followup_at, 'due', { inMs: ms(p.next_followup_at) - nowMs }))
    },
    outreach: {
      count: outreachSorted.length,
      items: outreachSorted.slice(0, limit).map((r) => messageItem(r.m, r.t, r.state === 'approved' ? 'approved' : 'scheduled',
        { state: r.state, senderState: senderState(r.m.message_type, cfg) }))
    },
    recentlyContacted: {
      count: contacted.length,
      items: contacted.slice(0, limit).map((p) => prospectItem(p, p.last_contact_at, 'contacted'))
    }
  };

  // ---------- pipelineSummary ----------
  const active = prospects.filter(isActiveProspect);
  const scores = active.map((p) => toNumber(p.lead_score)).filter((v) => v !== null);
  const won = prospects.filter((p) => p.status === 'won');
  const knownStatuses = [];
  const openStatuses = [];
  PHASES.forEach((ph) => ph.statuses.forEach((s) => { knownStatuses.push(s); if (ph.key !== 'closed') openStatuses.push(s); }));
  const phaseSummary = PHASES.map((ph) => {
    const closed = ph.key === 'closed';
    const stages = ph.statuses.map((s) => {
      const rows = prospects.filter((p) => p.status === s && (closed || !p.do_not_contact));
      return Object.assign({ status: s, label: statusLabel(s) }, summarize(rows));
    });
    if (closed) {
      const flagged = prospects.filter((p) => p.do_not_contact && openStatuses.indexOf(p.status) !== -1);
      stages.push(Object.assign({ status: 'dnc_flagged', label: 'Flagged do-not-contact (status still open)' }, summarize(flagged)));
      const unknown = prospects.filter((p) => knownStatuses.indexOf(p.status) === -1);
      if (unknown.length) stages.push(Object.assign({ status: 'unknown', label: 'Unrecognized status' }, summarize(unknown)));
    }
    return {
      key: ph.key, label: ph.label,
      count: stages.reduce((s, x) => s + x.count, 0),
      valueMin: closed ? null : stages.reduce((s, x) => s + (x.valueMin || 0), 0) || null,
      valueMax: closed ? null : stages.reduce((s, x) => s + (x.valueMax || 0), 0) || null,
      stages: stages
    };
  });
  const pipelineSummary = {
    totalProspects: prospects.length,
    active: Object.assign(summarize(active), {
      averageLeadScore: scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : null,
      scoredCount: scores.length
    }),
    qualified: summarize(active.filter((p) => p.status === 'qualified')),
    proposals: summarize(active.filter((p) => p.status === 'proposal')),
    won: summarize(won),
    phases: phaseSummary
  };

  // ---------- recentActivity ----------
  const noise = A.noiseActivityTypes || [];
  const meaningful = activities.filter((a) => noise.indexOf(a.activity_type) === -1);
  const recentActivity = {
    total: meaningful.length,
    items: sortBy(meaningful, (a) => ms(a.created_at), true).slice(0, A.recentActivityLimit > 0 ? A.recentActivityLimit : 8).map((a) => {
      const t = ms(a.created_at);
      const known = a.prospect_id !== null && a.prospect_id !== undefined && byId.has(String(a.prospect_id));
      return {
        activityId: String(a.id), type: a.activity_type || null, label: activityLabel(a.activity_type), group: activityGroup(a.activity_type),
        prospectId: known ? String(a.prospect_id) : null, company: known ? companyOf(a.prospect_id) : null,
        at: iso(t), ageMs: t === null ? null : nowMs - t, href: known ? hrefProspect(a.prospect_id, 'timeline') : '#/activity'
      };
    })
  };

  // ---------- systemHealth ----------
  const newestOf = (cands) => cands.filter((c) => c.t !== null).sort((a, b) => b.t - a.t)[0] || null;
  const actTimes = (types) => activities.filter((a) => types.indexOf(a.activity_type) !== -1).map((a) => ms(a.created_at)).filter((x) => x !== null);
  const maxOf = (arr) => (arr.length ? Math.max.apply(null, arr) : null);

  const ownedTypes = [];
  cfg.AUTOMATION_SYSTEMS.forEach((s) => { if (s.kind === 'sender') (s.messageTypes || []).forEach((t) => ownedTypes.push(t)); });

  const systems = cfg.AUTOMATION_SYSTEMS.map((sys) => {
    const types = sys.messageTypes || [];
    const sources = [];
    const parts = [];
    const exceptions = [];
    const addPart = (key, label, count, tone, href, extra) => { if (count > 0) parts.push(Object.assign({ key: key, label: typeof label === 'function' ? label(count) : label, count: count, tone: tone, href: href || null }, extra || {})); };
    let published = null;
    let coverage = [];

    if (sys.kind === 'sender') {
      const mine = (m) => types.indexOf(m.message_type) !== -1;
      const sentTimes = messages.filter((m) => mine(m) && ms(m.sent_at) !== null).map((m) => ms(m.sent_at));
      sources.push({ source: 'newest sent_at on ' + types.join(' / ') + ' messages', t: maxOf(sentTimes) });
      sources.push({ source: 'newest ' + (sys.evidenceActivityTypes || []).join(' / ') + ' activity', t: maxOf(actTimes(sys.evidenceActivityTypes || [])) });
      const entries = types.map((t) => cfg.SENDER_WORKFLOWS[t]).filter(Boolean);
      published = entries.length ? entries.every((e) => !!e.published) : null;
      coverage = types.map((t) => ({ messageType: t, label: messageTypeLabel(t), state: senderState(t, cfg) }));

      const waitingHere = approvedWaiting.filter(mine);
      const expected = waitingHere.length > 0 && waitingHere.every((m) => senderState(m.message_type, cfg) !== 'ready');
      addPart('drafts_awaiting', (c) => plural(c, 'draft awaiting your approval', 'drafts awaiting your approval'), awaiting.filter(mine).length, 'waiting', queueSection('awaiting'));
      addPart('approved_waiting', (c) => plural(c, 'approved message waiting to send', 'approved messages waiting to send') + (expected ? ' (expected: sender not marked as published)' : ''), waitingHere.length, 'info', queueSection('waiting'), { expected: expected });
      addPart('in_flight', (c) => plural(c, 'message scheduled / in flight', 'messages scheduled / in flight'), inFlight.filter((s) => mine(s.m)).length, 'info', queueSection('waiting'));
      if (sys.includesOverdueFollowups) addPart('overdue_followups', (c) => plural(c, 'overdue follow-up (approximate)', 'overdue follow-ups (approximate)'), overdueItems.length, 'overdue', buildHash(['prospects'], { due: 'yes', sort: 'followup' }));
      const failedHere = failed.filter(mine).length;
      const stuckHere = stuck.filter((s) => mine(s.m)).length;
      addPart('failed', 'failed ' + plural(failedHere, 'message', 'messages'), failedHere, 'exception', queueSection('failed'));
      addPart('stuck', 'scheduled ' + plural(stuckHere, 'message', 'messages') + ' possibly stuck (over ' + A.scheduledStuckMinutes + ' min)', stuckHere, 'exception', queueSection('waiting'));
      if (failedHere) exceptions.push({ key: 'failed', label: failedHere + ' failed ' + plural(failedHere, 'message', 'messages'), count: failedHere, href: queueSection('failed') });
      if (stuckHere) exceptions.push({ key: 'stuck', label: stuckHere + ' scheduled ' + plural(stuckHere, 'message', 'messages') + ' possibly stuck', count: stuckHere, href: queueSection('waiting') });
    } else if (sys.kind === 'replies') {
      published = sys.published === undefined ? null : sys.published;
      sources.push({ source: 'newest ' + (sys.evidenceActivityTypes || ['reply_received']).join(' / ') + ' activity', t: maxOf(actTimes(sys.evidenceActivityTypes || ['reply_received'])) });
      sources.push({ source: 'newest prospect replied_at', t: maxOf(prospects.map((p) => ms(p.replied_at)).filter((x) => x !== null)) });
      addPart('replies_awaiting', (c) => plural(c, 'reply awaiting your attention', 'replies awaiting your attention'), awaitingReplyProspects.length, 'waiting', buildHash(['prospects'], { status: 'replied' }));
    } else {
      published = sys.published === undefined ? null : sys.published;
      sources.push({ source: 'newest prospect created_at', t: maxOf(prospects.map((p) => ms(p.created_at)).filter((x) => x !== null)) });
      if ((sys.evidenceActivityTypes || []).length) sources.push({ source: 'newest ' + sys.evidenceActivityTypes.join(' / ') + ' activity', t: maxOf(actTimes(sys.evidenceActivityTypes)) });
      addPart('needs_review', (c) => plural(c, 'prospect awaiting your review', 'prospects awaiting your review'), reviewItems.length, 'waiting', buildHash(['prospects'], { status: 'needs_review' }));
    }

    const winner = newestOf(sources);
    const total = parts.reduce((s, p) => s + p.count, 0);
    return {
      key: sys.key, label: sys.label, kind: sys.kind, messageTypes: types,
      configuredCapability: sys.capability || '',
      coverage: coverage,
      published: published,
      publishedLabel: published === true ? 'Marked as published' : published === false ? 'Not marked as published' : 'Not tracked',
      lastEvidence: winner ? { at: iso(winner.t), source: winner.source } : null,
      ageMs: winner ? nowMs - winner.t : null,
      evidenceSources: sources.map((s) => ({ source: s.source, at: iso(s.t) })),
      backlog: { total: total, parts: parts },
      exceptions: exceptions,
      attention: exceptions.length ? 'exception' : (total > 0 ? 'info' : 'none')
    };
  });

  const unassigned = {
    failed: failed.filter((m) => ownedTypes.indexOf(m.message_type) === -1).length,
    stuck: stuck.filter((s) => ownedTypes.indexOf(s.m.message_type) === -1).length
  };
  const exceptionsTotal = failed.length + stuck.length;
  const systemHealth = {
    systems: systems,
    unassigned: unassigned,
    exceptionsTotal: exceptionsTotal,
    // The System Status nav badge: true machinery exceptions ONLY (failed / stuck). Never ordinary work or expected waiting.
    badgeCount: exceptionsTotal,
    evidenceNote: 'Inferred from database evidence and Command Center configuration. It is not live n8n telemetry.'
  };

  const meta = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    counts: { prospects: prospects.length, messages: messages.length, activities: activities.length },
    truncated: Object.assign({}, snap.truncated || {}),
    auditColumns: !!snap.auditColumns,
    thresholds: {
      scheduledStuckMinutes: A.scheduledStuckMinutes === undefined ? null : A.scheduledStuckMinutes,
      approvedWaitingWarnMinutes: A.approvedWaitingWarnMinutes === undefined ? null : A.approvedWaitingWarnMinutes,
      evidenceStaleHours: A.evidenceStaleHours === undefined ? null : A.evidenceStaleHours
    },
    privacy: 'Contains ids, company names, statuses, labels, timestamps and counts only: no email addresses, phone numbers, contact names, message subjects or bodies, or notes.',
    definitions: {
      activeProspect: 'Not closed, won, lost or do_not_contact, and not flagged do_not_contact.',
      activePipelineValue: 'Sum of estimated_value_min / estimated_value_max over ACTIVE prospects. If only one side exists it is used for both. Prospects with no usable estimate (empty, or zero) are excluded from the total. Won prospects are never included.',
      wonValue: 'Same calculation over prospects with status won, reported separately.',
      repliesAwaitingAttention: 'Prospects whose status is "replied". They stay until the status changes.',
      overdueFollowup: 'Active prospect, not replied, with next_followup_at in the past (an estimate; n8n is the authority).',
      draftsAwaitingApproval: 'Messages with status "draft" that are not approved.',
      approvedWaiting: 'Messages with status "approved" and no sent_at. Expected to wait when their sender is not marked as published.',
      scheduledStuck: 'status "scheduled" is the claim / in-flight state. It is a possible stuck message when scheduled_at is more than the threshold old. If scheduled_at is empty the age is unknown and nothing is flagged.',
      failedMessages: 'Messages with status "failed": an explicit exception until resolved or removed.',
      systemStatusBadge: 'Failed or stuck messages only. Not ordinary work, overdue follow-ups, needs-review prospects, or approved messages waiting for an unpublished sender.'
    }
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    needsAttention: needsAttention,
    nextActions: nextActions,
    waitingApprovals: waitingApprovals,
    failedMessages: failedMessages,
    overdueFollowups: overdueFollowups,
    recentReplies: recentReplies,
    upcoming: upcoming,
    pipelineSummary: pipelineSummary,
    recentActivity: recentActivity,
    systemHealth: systemHealth,
    meta: meta
  };
}

// ---------- short-lived in-memory cache (wiped when the session ends) ----------
// The router asks for the nav badge and the page asks for the dashboard in the same moment; this avoids computing twice.
let cached = new WeakMap();
const CACHE_MS = 15 * 1000;

export function resetInsights() {
  cached = new WeakMap();
}
onSessionEnd(resetInsights);

export function getInsights(snap, options) {
  const opts = options || {};
  if (!opts.now && !opts.config) {
    const hit = cached.get(snap);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  }
  const value = buildInsights(snap, opts);
  if (!opts.now && !opts.config) cached.set(snap, { at: Date.now(), value: value });
  return value;
}
