// Overview: an operations dashboard. It answers, in this order:
//   what needs me / what should I do next / what is overdue and waiting / what is stuck or failed /
//   what is the opportunity / where do prospects sit / what just happened / what do the automations' records show.
//
// Everything comes from utilities/insights.js (one derivation, shared with System Status and the future Stark AI).
// READ-ONLY. Wording stays honest: "last database evidence", "backlog", "according to Command Center configuration".
// Nothing here claims an n8n workflow is live, running or healthy.
//
// Desktop is dense; at <= 960px the same markup recomposes (one column, items behind "Show items" buttons).

import { h, notice, fmtRelative, fmtDateTime } from '../dom.js';
import { getInsights } from '../utilities/insights.js';
import { emptyBlock } from '../components/ui.js';
import {
  block, nextActionsPanel, attentionCard, statTile, moneyRange, stageDistribution, upcomingGroup, activityList, healthCard, fmtDuration
} from '../components/dashboard.js';
import { fmtDate } from '../utilities/format.js';

export const title = 'Overview';

function plural(n, one, many) {
  return n === 1 ? one : many;
}

export function render(container, ctx) {
  const snap = ctx.snap;
  const now = new Date();
  const ins = getInsights(snap, { now: now });
  const ps = ins.pipelineSummary;

  container.appendChild(h('h1', { class: 'cc-h1', text: 'Overview' }));

  if (snap.prospects.length === 0) {
    container.appendChild(notice('warn',
      'No prospect rows are visible. Either the CRM is empty, or this session is not authorized to read it ' +
      '(it must be your allowlisted admin account).'));
  }
  Object.keys(snap.truncated).forEach((table) => {
    if (snap.truncated[table]) {
      container.appendChild(notice('warn', 'Only the newest rows of "' + table + '" were loaded; totals may be low.'));
    }
  });

  // ---- 1. the headline: what needs me, and what to do next ----
  const actionable = ins.needsAttention.filter((e) => e.severity !== 'info');
  const total = actionable.reduce((sum, e) => sum + e.count, 0);
  container.appendChild(h('section', { class: 'cc-dash-banner ' + (total ? 'is-attn' : 'is-clear'), 'aria-labelledby': 'cc-ov-headline' },
    h('h2', { id: 'cc-ov-headline', class: 'cc-dash-headline', text: total
      ? total + ' ' + plural(total, 'item needs', 'items need') + ' your attention'
      : 'Nothing needs your attention right now' }),
    h('p', { class: 'cc-muted cc-dash-sub', text: 'Based on database evidence loaded at ' + fmtDateTime(snap.loadedAt) + '. Ranked by a fixed rule, not by AI.' }),
    nextActionsPanel(ins.nextActions)
  ));

  if (ins.systemHealth.badgeCount > 0) {
    container.appendChild(notice('error',
      ins.systemHealth.badgeCount + ' system ' + plural(ins.systemHealth.badgeCount, 'exception', 'exceptions') +
      ' (failed or possibly stuck messages). See System Status for details.'));
  }

  // ---- 2. needs attention ----
  container.appendChild(block('Needs attention',
    ins.needsAttention.length
      ? h('div', { class: 'cc-att-grid' }, ins.needsAttention.map((e) => attentionCard(e, now)))
      : emptyBlock('Nothing is waiting on you.', 'No replies, failures, drafts, overdue follow-ups or reviews right now.'),
    { id: 'cc-ov-attention' }));

  // ---- 3. sales snapshot ----
  const a = ps.active;
  container.appendChild(block('Sales snapshot', h('div', {},
    h('div', { class: 'cc-sales-grid' },
      statTile('Active prospects', String(a.count), a.withEstimate + ' of ' + a.count + ' have a value estimate'),
      statTile('Active pipeline value', moneyRange(a), a.withEstimate ? 'estimated range, active prospects only' : 'no estimates yet'),
      statTile('Qualified', String(ps.qualified.count), moneyRange(ps.qualified) === '—' ? null : moneyRange(ps.qualified)),
      statTile('Proposals', String(ps.proposals.count), moneyRange(ps.proposals) === '—' ? null : moneyRange(ps.proposals)),
      statTile('Average lead score', a.averageLeadScore === null ? '—' : String(a.averageLeadScore), a.scoredCount + ' active ' + plural(a.scoredCount, 'prospect', 'prospects') + ' scored'),
      statTile('Won', String(ps.won.count), 'not part of the active pipeline value', 'cc-tile-won'),
      statTile('Won value', moneyRange(ps.won), ps.won.count ? ps.won.withEstimate + ' of ' + ps.won.count + ' have a value' : null, 'cc-tile-won')
    ),
    h('h3', { class: 'cc-h3 cc-sub-h', text: 'Where prospects sit' }),
    stageDistribution(ps.phases)
  ), { id: 'cc-ov-sales', link: { href: '#/pipeline', label: 'Open pipeline' } }));

  // ---- 4. upcoming ----
  const up = ins.upcoming;
  container.appendChild(block('Upcoming', h('div', { class: 'cc-up-grid' },
    upcomingGroup('overdue', 'Overdue follow-ups', up.overdueFollowups, 'No overdue follow-ups.',
      (i) => 'Due ' + fmtDuration(i.overdueMs) + ' ago', '#/prospects?due=yes&sort=followup', true),
    upcomingGroup('next', 'Next follow-ups', up.nextFollowups, 'No upcoming follow-up dates.',
      (i) => 'In ' + fmtDuration(i.inMs) + ' (' + fmtDate(i.at, now) + ')', '#/prospects?sort=followup', true),
    upcomingGroup('outreach', 'Approved / scheduled outreach', up.outreach, 'Nothing approved or scheduled.',
      (i) => i.typeLabel + ' · ' + (i.state === 'approved' ? 'approved ' : i.state === 'stuck' ? 'scheduled (possibly stuck) ' : 'scheduled ') + (i.at ? fmtRelative(i.at, now) : ''), '#/queue?section=waiting', false),
    upcomingGroup('contacted', 'Recently contacted', up.recentlyContacted, 'No contact dates recorded.',
      (i) => i.statusLabel + ' · ' + fmtRelative(i.at, now), '#/prospects', false)
  ), { id: 'cc-ov-upcoming' }));

  // ---- 5. recent activity ----
  container.appendChild(block('Recent activity', h('div', {},
    activityList(ins.recentActivity.items, now),
    h('p', { class: 'cc-act-all' }, h('a', { href: '#/activity', text: 'See all activity' + (ins.recentActivity.total ? ' (' + ins.recentActivity.total + ')' : '') }))
  ), { id: 'cc-ov-activity' }));

  // ---- 6. system health (database evidence, not live telemetry) ----
  container.appendChild(block('System health', h('div', {},
    h('p', { class: 'cc-muted', text: 'Inferred from database evidence and Command Center configuration. This is not live n8n telemetry.' }),
    h('div', { class: 'cc-health-grid' }, ins.systemHealth.systems.map((s) => healthCard(s, now, true)))
  ), { id: 'cc-ov-health', link: { href: '#/status', label: 'System status' } }));
}
