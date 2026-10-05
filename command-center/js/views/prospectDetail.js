// Prospect Detail: the full history of one business in one place.
//   #/prospects/<id>            Summary
//   #/prospects/<id>/research   Research
//   #/prospects/<id>/outreach   Outreach
//   #/prospects/<id>/timeline   Timeline   (?order=asc for oldest first)
//   #/prospects/<id>/contact    Contact state
//
// READ-ONLY. The "reserved slots" (hidden, empty, unwired) mark where controlled edit actions will live later.
// The id and tab come from the URL, so they are untrusted: the id is only a Map lookup key and the tab is
// checked against an allowlist. All database text is shown through textContent only.

import { h, notice, badge, emptyState, factList, fmtRange, fmtDateTime, fmtRelative, formatValue } from '../dom.js';
import { isFollowupDue, isDoNotContact, isSuppressed } from '../api.js';
import {
  messageTypeTitle, messageTypeLabel, messageTypeOrder, messageStatusLabel, activityLabel, activityKind
} from '../utilities/labels.js';
import { buildHash, pickEnum, hrefProspect } from '../utilities/query.js';
import { fmtDate, fmtFull } from '../utilities/format.js';
import {
  statusBadge, dncBadge, scorePill, panel, tabNav, stat, emptyBlock, messageStatusBadge, renderValue, reservedSlot
} from '../components/ui.js';

const TABS = ['summary', 'research', 'outreach', 'timeline', 'contact'];
const TAB_LABELS = {
  summary: 'Summary', research: 'Research', outreach: 'Outreach', timeline: 'Timeline', contact: 'Contact state'
};

export const title = 'Prospect';

export function crumbs(ctx) {
  const p = ctx.snap.prospectsById.get(String(ctx.route.segments[1]));
  return [
    { label: 'Sales' },
    { label: 'Prospects', href: '#/prospects' },
    { label: p ? (p.company_name || '(unnamed company)') : 'Prospect not found' }
  ];
}

function time(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function whenNode(value, overdue, now) {
  if (!value) return h('span', { class: 'cc-muted', text: '—' });
  return h('span', { class: overdue ? 'cc-when-overdue' : '', title: fmtFull(value) },
    fmtDate(value, now) + ' ',
    h('span', { class: 'cc-muted', text: '(' + fmtRelative(value, now) + ')' }),
    overdue ? ' ' : null,
    overdue ? h('span', { class: 'cc-when-flag', text: 'Due' }) : null
  );
}

function detailsBlock(value) {
  const text = formatValue(value);
  if (text === '—') return null;
  if (text.length <= 180) return h('pre', { class: 'cc-pre', text: text });
  return h('details', { class: 'cc-details' },
    h('summary', {}, text.slice(0, 180) + '…'),
    h('pre', { class: 'cc-pre', text: text })
  );
}

// ---------- tabs ----------

function summaryTab(p, messages, activities, now) {
  const location = [p.city, p.state].filter(Boolean).join(', ');
  const recent = activities.slice().sort((a, b) => time(b.created_at) - time(a.created_at)).slice(0, 3);
  const latest = messages.slice().sort((a, b) => time(b.created_at) - time(a.created_at))[0];

  const glance = h('div', {},
    factList([
      ['Tracked messages', String(messages.length)],
      ['Latest message', latest ? messageTypeLabel(latest.message_type) + ' · ' + messageStatusLabel(latest.status) : null],
      ['CRM activity', String(activities.length)]
    ]),
    recent.length
      ? h('ul', { class: 'cc-mini-timeline' }, recent.map((a) =>
          h('li', {},
            badge(activityLabel(a.activity_type), activityKind(a.activity_type)),
            ' ',
            h('span', { class: 'cc-muted', text: fmtRelative(a.created_at, now) })
          )))
      : emptyState('No CRM activity recorded yet.'),
    recent.length ? h('a', { href: hrefProspect(p.id, 'timeline'), text: 'See the full timeline →' }) : null
  );

  return h('div', { class: 'cc-grid-2' },
    panel('Company', factList([
      ['Company', p.company_name], ['Industry', p.industry], ['Location', location || null], ['Website', p.website]
    ]), { slot: 'summary-edit-company' }),
    panel('Contact', factList([
      ['Name', p.contact_name], ['Email', p.contact_email], ['Phone', p.contact_phone]
    ]), { slot: 'summary-edit-contact' }),
    panel('Deal', factList([
      ['Status', statusBadge(p.status)],
      ['Lead score', scorePill(p.lead_score)],
      ['Estimated value', fmtRange(p.estimated_value_min, p.estimated_value_max)]
    ])),
    panel('At a glance', glance)
  );
}

function researchTab(p) {
  return h('div', { class: 'cc-stack' },
    panel('Pain point', renderValue(p.pain_point)),
    panel('Evidence', renderValue(p.evidence)),
    panel('Proposed offer', renderValue(p.proposed_offer)),
    panel('Notes', renderValue(p.notes), { slot: 'research-edit-notes' }),
    panel('Source', factList([['Source', p.source], ['Source URL', p.source_url]]))
  );
}

function approvalText(m) {
  if (m.rejected_at) return 'Rejected ' + fmtDateTime(m.rejected_at);
  if (m.approved) return 'Approved' + (m.approved_at ? ' ' + fmtDateTime(m.approved_at) : '');
  return 'Not approved';
}

function messagePanel(m, openByDefault) {
  const facts = [
    ['Status', messageStatusBadge(m.status)],
    ['Approval', approvalText(m)],
    ['Drafted', fmtDateTime(m.created_at)],
    m.edited_at ? ['Edited', fmtDateTime(m.edited_at)] : null,
    m.scheduled_at ? ['Scheduled', fmtDateTime(m.scheduled_at)] : null,
    m.sent_at ? ['Sent', fmtDateTime(m.sent_at)] : null,
    m.rejection_reason ? ['Rejection reason', m.rejection_reason] : null
  ].filter(Boolean);

  const body = h('details', { class: 'cc-details' },
    h('summary', { text: 'Show email body' }),
    renderValue(m.body)
  );
  if (openByDefault) body.open = true;

  return panel(messageTypeTitle(m.message_type), h('div', {},
    factList(facts),
    h('p', { class: 'cc-subject', text: m.subject || '(no subject)' }),
    body,
    m.status === 'draft' ? h('p', {}, h('a', { href: '#/queue', text: 'Review this draft in the Approval Queue →' })) : null
  ));
}

function outreachTab(messages) {
  if (messages.length === 0) {
    return emptyBlock('No tracked outreach messages.', 'No outreach messages are recorded in the Command Center for this prospect.');
  }
  const sorted = messages.slice().sort((a, b) =>
    messageTypeOrder(a.message_type) - messageTypeOrder(b.message_type) || time(a.created_at) - time(b.created_at));
  return h('div', { class: 'cc-stack' }, sorted.map((m, index) => messagePanel(m, index === 0)));
}

function timelineTab(p, activities, order, now) {
  if (activities.length === 0) return emptyBlock('No CRM activity recorded for this prospect.');
  const asc = order === 'asc';
  const sorted = activities.slice().sort((a, b) => asc ? time(a.created_at) - time(b.created_at) : time(b.created_at) - time(a.created_at));
  const toggle = h('a', {
    class: 'cc-btn',
    href: buildHash(['prospects', p.id, 'timeline'], asc ? {} : { order: 'asc' }),
    text: asc ? 'Show newest first' : 'Show oldest first'
  });
  return h('div', {},
    h('div', { class: 'cc-toolbar' },
      h('span', { class: 'cc-muted', text: sorted.length + ' records · ' + (asc ? 'oldest first' : 'newest first') }),
      toggle
    ),
    h('ul', { class: 'cc-timeline' }, sorted.map((a) =>
      h('li', {},
        h('div', { class: 'cc-timeline-head' },
          badge(activityLabel(a.activity_type), activityKind(a.activity_type)),
          h('span', { class: 'cc-muted', title: fmtFull(a.created_at), text: fmtDateTime(a.created_at) + ' (' + fmtRelative(a.created_at, now) + ')' })
        ),
        detailsBlock(a.details)
      )))
  );
}

function contactTab(snap, p, now) {
  const due = isFollowupDue(p, now);
  const facts = factList([
    ['Status', statusBadge(p.status)],
    ['Approved to contact', p.approved_to_contact ? badge('Yes', 'ok') : badge('No', 'neutral')],
    ['Do not contact', isDoNotContact(p) ? dncBadge() : 'No'],
    ['On suppression list', isSuppressed(snap, p.contact_email) ? badge('Yes', 'danger') : 'No'],
    ['First contact', fmtDateTime(p.first_contact_at)],
    ['Last contact', fmtDateTime(p.last_contact_at)],
    ['Next follow-up', whenNode(p.next_followup_at, due, now)],
    ['Follow-ups sent', p.followup_count],
    ['Replied', fmtDateTime(p.replied_at)]
  ]);

  return panel('Contact state', h('div', {},
    facts,
    due ? h('p', { class: 'cc-muted', text: '"Due" is an estimate from the dates above. n8n\'s own follow-up query is the authority.' }) : null,
    // Reserved, inactive homes for future controlled actions (change status, mark do-not-contact, set next follow-up).
    reservedSlot('contact-status-change'),
    reservedSlot('contact-do-not-contact'),
    reservedSlot('contact-next-followup')
  ));
}

// ---------- page ----------

export function render(container, ctx) {
  const snap = ctx.snap;
  const now = new Date();
  const id = ctx.route.segments[1];
  const tab = pickEnum(ctx.route.segments[2], TABS, 'summary');
  const p = snap.prospectsById.get(String(id));

  if (!p) {
    container.appendChild(h('h1', { class: 'cc-h1', text: 'Prospect not found' }));
    container.appendChild(emptyBlock(
      'That prospect was not found in the loaded data.',
      'It may not exist, or only the newest rows were loaded.',
      h('a', { class: 'cc-btn', href: '#/prospects', text: 'Back to prospects' })
    ));
    return;
  }

  const messages = (snap.messagesByProspect.get(String(p.id)) || []).slice();
  const activities = (snap.activitiesByProspect.get(String(p.id)) || []).slice();
  const due = isFollowupDue(p, now);
  const subtitle = [p.industry, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');

  container.appendChild(h('header', { class: 'cc-detail-head' },
    h('div', { class: 'cc-detail-title' },
      h('h1', { class: 'cc-h1', text: p.company_name || '(unnamed company)' }),
      h('div', { class: 'cc-badges' },
        statusBadge(p.status),
        isDoNotContact(p) ? dncBadge() : null,
        p.replied_at ? badge('Replied', 'ok') : null
      ),
      reservedSlot('prospect-header-actions')
    ),
    subtitle ? h('p', { class: 'cc-muted cc-detail-sub', text: subtitle }) : null
  ));

  if (isDoNotContact(p)) {
    container.appendChild(notice('error', 'DO NOT CONTACT: this prospect is marked do-not-contact. Do not send anything to them.'));
  }

  container.appendChild(h('div', { class: 'cc-stats' },
    stat('Lead score', scorePill(p.lead_score)),
    stat('Estimated value', h('span', { text: fmtRange(p.estimated_value_min, p.estimated_value_max) })),
    stat('Next follow-up', whenNode(p.next_followup_at, due, now)),
    stat('Last contact', whenNode(p.last_contact_at, false, now))
  ));

  container.appendChild(tabNav(
    TABS.map((key) => ({
      key: key,
      label: TAB_LABELS[key],
      href: hrefProspect(p.id, key),
      count: key === 'outreach' ? messages.length : key === 'timeline' ? activities.length : undefined
    })),
    tab,
    'Prospect sections'
  ));

  let content;
  if (tab === 'research') content = researchTab(p);
  else if (tab === 'outreach') content = outreachTab(messages);
  else if (tab === 'timeline') content = timelineTab(p, activities, ctx.route.params.order === 'asc' ? 'asc' : 'desc', now);
  else if (tab === 'contact') content = contactTab(snap, p, now);
  else content = summaryTab(p, messages, activities, now);
  container.appendChild(h('div', { class: 'cc-tab-panel' }, content));
}
