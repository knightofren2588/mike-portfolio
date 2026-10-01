// System Status: INFERRED from database timestamps. It does not talk to n8n.
// "Quiet" does not mean "broken" (nothing may have been due), so there are no pass/fail lights here.

import {
  h, notice, section, fmtDateTime, fmtRelative, humanize, emptyState
} from '../dom.js';
import { isApprovedWaiting, isFollowupDue, latestTimestamp } from '../api.js';

function statusRow(system, evidence, when, now) {
  return h('tr', {},
    h('td', { text: system }),
    h('td', { class: 'cc-muted', text: evidence }),
    h('td', { text: when ? fmtDateTime(when) : 'No data yet' }),
    h('td', { text: when ? fmtRelative(when, now) : '—' })
  );
}

function latestActivity(snap, type) {
  return latestTimestamp(snap.activities.filter((a) => a.activity_type === type).map((a) => a.created_at));
}

export function render(container, ctx) {
  const snap = ctx.snap;
  const now = new Date();

  container.appendChild(h('h1', { class: 'cc-h1', text: 'System Status' }));
  container.appendChild(notice('info',
    'Inferred from timestamps in the database. This is not live n8n state. A quiet system may simply have had nothing to do.'));

  const lastReplyActivity = latestActivity(snap, 'reply_received');
  const lastRepliedAt = latestTimestamp(snap.prospects.map((p) => p.replied_at));
  const lastFollowupSent = latestActivity(snap, 'followup_1_sent');
  const lastSentMessage = latestTimestamp(snap.messages.map((m) => m.sent_at));
  const lastProspectCreated = latestTimestamp(snap.prospects.map((p) => p.created_at));

  container.appendChild(section('Automations (by last evidence)',
    h('div', { class: 'cc-table-wrap' },
      h('table', { class: 'cc-table' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'System' }),
          h('th', { scope: 'col', text: 'Evidence used' }),
          h('th', { scope: 'col', text: 'Last seen' }),
          h('th', { scope: 'col', text: 'Age' })
        )),
        h('tbody', {},
          statusRow('Reply detection', 'newest reply_received activity', lastReplyActivity || lastRepliedAt, now),
          statusRow('Follow-up engine', 'newest followup_1_sent activity', lastFollowupSent, now),
          statusRow('Approved sender', 'newest message sent_at', lastSentMessage, now),
          statusRow('Prospecting system', 'newest prospect created_at', lastProspectCreated, now)
        )
      )
    )
  ));

  // Backlog indicators.
  const waiting = snap.messages.filter(isApprovedWaiting);
  const oldestWaiting = waiting.length
    ? waiting.map((m) => new Date(m.created_at).getTime()).reduce((a, b) => Math.min(a, b))
    : null;
  const due = snap.prospects.filter((p) => isFollowupDue(p, now));

  container.appendChild(section('Backlog',
    h('ul', { class: 'cc-list' },
      h('li', { text: 'Approved but not yet sent: ' + waiting.length + (oldestWaiting ? ' (oldest drafted ' + fmtRelative(new Date(oldestWaiting), now) + ')' : '') }),
      h('li', { text: 'Follow-ups past due (approximate): ' + due.length })
    )
  ));

  // Newest activity per type, from whatever types actually exist.
  const types = new Map();
  snap.activities.forEach((a) => {
    const key = String(a.activity_type);
    const t = new Date(a.created_at).getTime();
    if (!types.has(key) || t > types.get(key)) types.set(key, t);
  });
  const rows = Array.from(types.entries()).sort((a, b) => b[1] - a[1]);
  container.appendChild(section('Newest activity by type',
    rows.length
      ? h('ul', { class: 'cc-list' }, rows.map((entry) =>
          h('li', { text: humanize(entry[0]) + ': ' + fmtDateTime(new Date(entry[1])) + ' (' + fmtRelative(new Date(entry[1]), now) + ')' })))
      : emptyState('No activity recorded yet.')
  ));

  container.appendChild(section('Data freshness',
    h('p', { class: 'cc-muted', text: 'This page last loaded ' + fmtDateTime(snap.loadedAt) + '. Use “Refresh data” in the header to re-read the database.' })
  ));
}
