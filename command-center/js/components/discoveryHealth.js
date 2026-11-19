// Discovery job health (Step 624): one read-only card. Used on System Status and at the top of the Discovery screen.
//
// It is built ONLY from rows the scheduled jobs wrote to the database (a heartbeat per run, success or failure). It is not live GitHub
// telemetry: if the schedule were switched off, this card turns amber because the last good run gets old, which is the point.
// Nothing here starts, stops or changes a job. All text goes through h() (textContent only).

import { h, badge, fmtDateTime, fmtRelative } from '../dom.js';
import { healthOf, HEALTH_LIMITS } from '../utilities/discovery.js';

const BADGE = { not_started: ['Not started', 'neutral'], green: ['Healthy', 'ok'], amber: ['Needs attention', 'warn'], red: ['Failing', 'danger'] };

function lastLine(label, k, now) {
  if (!k.last) return [label, 'Never run'];
  const ok = k.lastOk ? fmtDateTime(k.lastOk.started_at) + ' (' + fmtRelative(k.lastOk.started_at, now) + ')' : 'no successful run yet';
  const latest = 'latest run ' + k.last.status + ' ' + fmtRelative(k.last.started_at, now);
  return [label, 'last success ' + ok + ' · ' + latest + (k.failuresSinceOk ? ' · ' + k.failuresSinceOk + ' failed since' : '')];
}

/** @param data { available, heartbeats, rows } from getDiscovery() or getDiscoveryHealth() */
export function discoveryHealthCard(data, now) {
  const at = now || new Date();
  if (!data || !data.available) {
    return h('article', { class: 'cc-hcard cc-hcard-info' },
      h('header', { class: 'cc-hcard-head' }, h('h3', { class: 'cc-h3', text: 'Business discovery' }), h('span', { class: 'cc-badges' }, badge(data && data.missing ? 'Not installed' : 'Unavailable', 'neutral'))),
      h('p', { class: 'cc-muted cc-hcard-line', text: data && data.missing ? 'The discovery tables (migration 33) are not in this database yet. Nothing is wrong; the rest of the Command Center is unaffected.' : 'Discovery data could not be read. This session may not be an allowlisted admin, or the database could not be reached. Try Refresh.' }));
  }
  const hl = healthOf(data.heartbeats || [], data.rows || [], at);
  const b = BADGE[hl.status];
  const lines = [lastLine('Weekly pull', hl.pull, at), lastLine('Daily research', hl.research, at)];
  const body = [
    h('header', { class: 'cc-hcard-head' }, h('h3', { class: 'cc-h3', text: 'Business discovery' }), h('span', { class: 'cc-badges' }, badge(b[0], b[1]))),
    hl.status === 'not_started'
      ? h('p', { class: 'cc-muted cc-hcard-line', text: 'The scheduled jobs have not run yet. Until they do, this is expected and nothing is wrong.' })
      : h('p', { class: 'cc-muted cc-hcard-line', text: 'From the run records the scheduled jobs write to the database. Amber when the last good pull is over ' + HEALTH_LIMITS.maxPullAgeDays + ' days old or the last good research run over ' + HEALTH_LIMITS.maxResearchAgeHours + ' hours old. Red after ' + HEALTH_LIMITS.maxConsecutiveFailures + ' failed runs in a row.' }),
    h('dl', { class: 'cc-facts' }, lines.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))
  ];
  if (hl.problems.length) body.push(h('div', { class: 'cc-hcard-exceptions' }, h('h4', { class: 'cc-h4', text: 'Attention' }), hl.problems.map((p) => h('p', { class: 'cc-hcard-exception', text: p }))));
  const err = [hl.pull, hl.research].map((k) => k.lastError).filter(Boolean);
  if (err.length) body.push(h('p', { class: 'cc-muted cc-hcard-line', text: 'Latest failure note: ' + err.join(' · ') }));
  if (hl.stuckClaims) body.push(h('p', { class: 'cc-muted cc-hcard-line', text: hl.stuckClaims + ' research claim(s) have been open over 30 minutes. They are released automatically on the next run.' }));
  return h('article', { class: 'cc-hcard cc-hcard-' + hl.status }, body);
}
