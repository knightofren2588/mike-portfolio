// Overview: headline numbers computed from one read-only snapshot.
// Only statuses that actually exist in the database are shown.

import { h, notice, section, fmtRange, humanize, toNumber } from '../dom.js';
import {
  isAwaitingApproval, isApprovedWaiting, isSent, isFollowupDue, countBy, sortStatuses
} from '../api.js';

function tile(label, value, sub) {
  return h('div', { class: 'cc-tile' },
    h('div', { class: 'cc-tile-value', text: value }),
    h('div', { class: 'cc-tile-label', text: label }),
    sub ? h('div', { class: 'cc-tile-sub', text: sub }) : null
  );
}

function chipLink(label, count, href) {
  const inner = [h('span', { class: 'cc-chip-count', text: String(count) }), h('span', { text: label })];
  return href
    ? h('a', { class: 'cc-chip', href: href }, inner)
    : h('span', { class: 'cc-chip' }, inner);
}

export function render(container, ctx) {
  const snap = ctx.snap;
  const now = new Date();

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

  const open = snap.prospects.filter((p) => p.status !== 'closed');
  let valueMin = 0;
  let valueMax = 0;
  open.forEach((p) => {
    valueMin += toNumber(p.estimated_value_min) || 0;
    valueMax += toNumber(p.estimated_value_max) || 0;
  });

  const drafts = snap.messages.filter(isAwaitingApproval).length;
  const approvedWaiting = snap.messages.filter(isApprovedWaiting).length;
  const sent = snap.messages.filter(isSent).length;
  const replied = snap.prospects.filter((p) => !!p.replied_at).length;
  const replyActivities = snap.activities.filter((a) => a.activity_type === 'reply_received').length;
  const due = snap.prospects.filter((p) => isFollowupDue(p, now)).length;
  const dnc = snap.prospects.filter((p) => p.do_not_contact).length;

  container.appendChild(h('div', { class: 'cc-tiles' },
    tile('Prospects in CRM', String(snap.prospects.length), open.length + ' not closed'),
    tile('Drafts awaiting approval', String(drafts), 'status draft, not approved'),
    tile('Approved, waiting to send', String(approvedWaiting), 'picked up by n8n'),
    tile('Emails sent', String(sent), 'outreach messages sent'),
    tile('Replies received', String(replied), replyActivities + ' reply activities logged'),
    tile('Follow-ups due (approx.)', String(due), 'estimate; n8n is authoritative'),
    tile('Estimated pipeline value', fmtRange(valueMin || null, valueMax || null), 'not-closed prospects'),
    tile('Do-not-contact', String(dnc), snap.suppressionCount + ' on suppression list')
  ));

  const byStatus = countBy(snap.prospects, (p) => p.status);
  const statusChips = sortStatuses(byStatus.keys()).map((s) => chipLink(humanize(s), byStatus.get(s), '#/pipeline'));
  container.appendChild(section('Prospects by status',
    statusChips.length ? h('div', { class: 'cc-chips' }, statusChips) : h('p', { class: 'cc-empty', text: 'No prospects yet.' })
  ));

  const byMsg = countBy(snap.messages, (m) => m.status);
  const msgChips = Array.from(byMsg.keys()).sort().map((s) => chipLink(humanize(s), byMsg.get(s), '#/queue'));
  container.appendChild(section('Outreach messages by status',
    msgChips.length ? h('div', { class: 'cc-chips' }, msgChips) : h('p', { class: 'cc-empty', text: 'No messages yet.' })
  ));

  const byType = countBy(snap.activities, (a) => a.activity_type);
  const typeChips = Array.from(byType.keys()).sort().map((t) => chipLink(humanize(t), byType.get(t), '#/activity'));
  container.appendChild(section('Activity by type',
    typeChips.length ? h('div', { class: 'cc-chips' }, typeChips) : h('p', { class: 'cc-empty', text: 'No activity yet.' })
  ));
}
