// One place for human-readable names and badge colours, so every screen labels things the same way.
// Statuses below are the real values your database allows (its CHECK constraints), in sales order.

import { humanize } from '../dom.js';

// kind -> badge colour class (see .cc-badge-* in cc.css)
export const STATUS_META = {
  researched:     { label: 'Researched',     kind: 'neutral', phase: 'intake' },
  needs_review:   { label: 'Needs review',   kind: 'warn',    phase: 'intake' },
  approved:       { label: 'Approved',       kind: 'info',    phase: 'outreach' },
  sent:           { label: 'Sent',           kind: 'type',    phase: 'outreach' },
  followup_1:     { label: 'Follow-Up 1',    kind: 'type',    phase: 'outreach' },
  followup_2:     { label: 'Follow-Up 2',    kind: 'type',    phase: 'outreach' },
  replied:        { label: 'Replied',        kind: 'ok',      phase: 'engaged' },
  qualified:      { label: 'Qualified',      kind: 'ok',      phase: 'engaged' },
  proposal:       { label: 'Proposal',       kind: 'info',    phase: 'engaged' },
  won:            { label: 'Won',            kind: 'ok',      phase: 'closed' },
  lost:           { label: 'Lost',           kind: 'neutral', phase: 'closed' },
  closed:         { label: 'Closed',         kind: 'neutral', phase: 'closed' },
  do_not_contact: { label: 'Do not contact', kind: 'danger',  phase: 'closed' }
};

/** All real prospect statuses, in sales order. */
export const PROSPECT_STATUSES = Object.keys(STATUS_META);

// The four pipeline phases, built from the single mapping above (STATUS_META[...].phase) so that Overview,
// System Status, the Pipeline and the future Stark AI all share ONE definition. Do not copy these lists elsewhere.
//   Intake:   researched, needs_review          Outreach: approved, sent, followup_1, followup_2
//   Engaged:  replied, qualified, proposal      Closed:   won, lost, closed, do_not_contact
const PHASE_ORDER = [
  { key: 'intake', label: 'Intake' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'closed', label: 'Closed' }
];
export const PHASES = PHASE_ORDER.map((p) => ({
  key: p.key,
  label: p.label,
  statuses: PROSPECT_STATUSES.filter((s) => STATUS_META[s].phase === p.key)
}));

/** 'intake' | 'outreach' | 'engaged' | 'closed', or null for a status that is not in the list. */
export function phaseOf(status) {
  return STATUS_META[status] ? STATUS_META[status].phase : null;
}

export function statusLabel(status) {
  return STATUS_META[status] ? STATUS_META[status].label : humanize(status);
}

export function statusKind(status) {
  return STATUS_META[status] ? STATUS_META[status].kind : 'neutral';
}

export const MESSAGE_STATUS_META = {
  draft:     { label: 'Draft',     kind: 'warn' },
  approved:  { label: 'Approved',  kind: 'info' },
  scheduled: { label: 'Scheduled', kind: 'type' },
  sent:      { label: 'Sent',      kind: 'ok' },
  failed:    { label: 'Failed',    kind: 'danger' },
  cancelled: { label: 'Cancelled', kind: 'neutral' }
};

export function messageStatusLabel(status) {
  return MESSAGE_STATUS_META[status] ? MESSAGE_STATUS_META[status].label : humanize(status);
}

export function messageStatusKind(status) {
  return MESSAGE_STATUS_META[status] ? MESSAGE_STATUS_META[status].kind : 'neutral';
}

const MESSAGE_TYPE_META = {
  initial:    { label: 'Initial',     title: 'Initial message', order: 1 },
  followup_1: { label: 'Follow-Up 1', title: 'Follow-up 1',     order: 2 },
  followup_2: { label: 'Follow-Up 2', title: 'Follow-up 2',     order: 3 },
  reply:      { label: 'Reply',       title: 'Reply',           order: 4 }
};

export function messageTypeLabel(type) {
  return MESSAGE_TYPE_META[type] ? MESSAGE_TYPE_META[type].label : humanize(type);
}

export function messageTypeTitle(type) {
  return MESSAGE_TYPE_META[type] ? MESSAGE_TYPE_META[type].title : humanize(type);
}

/** Sort rank so messages read initial -> follow-up 1 -> follow-up 2 -> replies -> anything else. */
export function messageTypeOrder(type) {
  return MESSAGE_TYPE_META[type] ? MESSAGE_TYPE_META[type].order : 99;
}

// Activity types seen so far. Anything not listed falls back to a readable version of its name,
// and the grouping rules below, so new activity types never break the screens.
const ACTIVITY_META = {
  initial_sent:        { label: 'Initial email sent',  group: 'outreach' },
  initial_send_failed: { label: 'Initial send failed', group: 'failures' },
  followup_1_sent:     { label: 'Follow-Up 1 sent',    group: 'outreach' },
  reply_received:      { label: 'Reply received',      group: 'replies' },
  message_approved:    { label: 'Message approved',    group: 'approvals' },
  message_rejected:    { label: 'Message rejected',    group: 'approvals' },
  message_edited:      { label: 'Draft edited',        group: 'approvals' }
};

export const ACTIVITY_GROUPS = {
  outreach:  'Outreach',
  replies:   'Replies',
  approvals: 'Approvals',
  failures:  'Failures',
  system:    'System / automation'
};

export function activityLabel(type) {
  return ACTIVITY_META[type] ? ACTIVITY_META[type].label : humanize(type);
}

export function activityGroup(type) {
  if (ACTIVITY_META[type]) return ACTIVITY_META[type].group;
  const t = String(type || '');
  if (/fail|error/.test(t)) return 'failures';
  if (/_sent$/.test(t)) return 'outreach';
  if (/reply/.test(t)) return 'replies';
  if (/^message_/.test(t)) return 'approvals';
  return 'system';
}

const GROUP_KIND = { outreach: 'type', replies: 'ok', approvals: 'info', failures: 'danger', system: 'neutral' };

export function activityKind(type) {
  return GROUP_KIND[activityGroup(type)] || 'neutral';
}
