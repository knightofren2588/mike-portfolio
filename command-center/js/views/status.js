// System Status: one card per automation, built from DATABASE EVIDENCE and Command Center configuration.
//
// THIS IS NOT LIVE n8n TELEMETRY. Command Center cannot see n8n, so it never says a workflow is running, live or
// healthy. It shows: what config.js says the system is for, whether YOU marked it as published, the newest database
// record that points to it, how old that record is, what is backlogged, and any EXPLICIT exceptions (failed messages,
// scheduled messages stuck past the threshold). A quiet system is never called stale: time-based staleness is off.

import { h, notice, fmtDateTime, fmtRelative, humanize, emptyState } from '../dom.js';
import { getInsights } from '../utilities/insights.js';
import { block, healthCard } from '../components/dashboard.js';
import { activityLabel } from '../utilities/labels.js';

export const title = 'System Status';

function thresholdText(minutes, onText) {
  return minutes === null || minutes === undefined ? 'off' : onText(minutes);
}

export function render(container, ctx) {
  const snap = ctx.snap;
  const now = new Date();
  const ins = getInsights(snap, { now: now });
  const sh = ins.systemHealth;
  const th = ins.meta.thresholds;

  container.appendChild(h('h1', { class: 'cc-h1', text: 'System Status' }));
  container.appendChild(notice('info',
    'Inferred from database evidence and Command Center configuration. This is not live n8n telemetry. ' +
    'A quiet system may simply have had nothing to do, so quiet is never treated as a fault.'));

  container.appendChild(h('p', { class: sh.badgeCount ? 'cc-status-summary is-exception' : 'cc-status-summary', role: 'status',
    text: sh.badgeCount
      ? sh.badgeCount + ' system ' + (sh.badgeCount === 1 ? 'exception' : 'exceptions') + ' in the database: failed or possibly stuck messages.'
      : 'No failed or stuck messages recorded in the database.' }));

  if (sh.unassigned.failed || sh.unassigned.stuck) {
    container.appendChild(notice('error',
      'Some failed or stuck messages belong to a message type that no configured automation handles (' +
      sh.unassigned.failed + ' failed, ' + sh.unassigned.stuck + ' stuck). They are still counted above and listed in the Approval Queue.'));
  }

  container.appendChild(block('Automations',
    h('div', { class: 'cc-health-grid cc-health-grid-full' }, sh.systems.map((s) => healthCard(s, now, false))),
    { id: 'cc-st-automations' }));

  container.appendChild(block('Rules in effect', h('ul', { class: 'cc-list' },
    h('li', { text: 'Scheduled messages: flagged as possibly stuck after ' + thresholdText(th.scheduledStuckMinutes, (m) => m + ' minutes') +
      ' (status "scheduled" is the in-flight claim state, aged from scheduled_at).' }),
    h('li', { text: 'Approved messages waiting too long: ' + thresholdText(th.approvedWaitingWarnMinutes, (m) => 'warning after ' + m + ' minutes') +
      '. Waiting for a sender that is not marked as published is expected, not a fault.' }),
    h('li', { text: 'Time-based staleness of a quiet system: ' + thresholdText(th.evidenceStaleHours, (hrs) => 'warning after ' + hrs + ' hours') +
      '. Off until real production schedules exist.' }),
    h('li', { text: 'Failed messages are always an exception until resolved or removed.' }),
    h('li', { text: 'The navigation badge counts only failed and stuck messages, never ordinary work.' })
  ), { id: 'cc-st-rules' }));

  // Newest activity per type, from whatever types actually exist.
  const types = new Map();
  snap.activities.forEach((a) => {
    const key = String(a.activity_type);
    const t = new Date(a.created_at).getTime();
    if (!types.has(key) || t > types.get(key)) types.set(key, t);
  });
  const rows = Array.from(types.entries()).sort((a, b) => b[1] - a[1]);
  container.appendChild(block('Newest activity by type',
    rows.length
      ? h('ul', { class: 'cc-list' }, rows.map((entry) =>
          h('li', { text: activityLabel(entry[0]) + ': ' + fmtDateTime(new Date(entry[1])) + ' (' + fmtRelative(new Date(entry[1]), now) + ')' })))
      : emptyState('No CRM activity recorded yet.'),
    { id: 'cc-st-activity' }));

  container.appendChild(h('p', { class: 'cc-muted', text: 'This page last loaded ' + fmtDateTime(snap.loadedAt) + '. Use Refresh in the top bar to re-read the database.' }));
}
