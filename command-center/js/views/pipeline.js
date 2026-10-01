// Pipeline: prospects grouped by their ACTUAL status values, plus a read-only detail page.

import {
  h, notice, section, badge, textBlock, emptyState, factList, fmtRange, fmtDateTime, fmtRelative,
  humanize, formatValue, toNumber
} from '../dom.js';
import { countBy, sortStatuses } from '../api.js';
import { prospectFacts } from './queue.js';

function prospectCard(p) {
  const badges = [];
  if (p.lead_score !== null && p.lead_score !== undefined) badges.push(badge('Score ' + p.lead_score, 'score'));
  if (p.replied_at) badges.push(badge('Replied', 'ok'));
  if (p.do_not_contact) badges.push(badge('Do not contact', 'danger'));

  return h('a', { class: 'cc-pcard', href: '#/pipeline/' + encodeURIComponent(String(p.id)) },
    h('div', { class: 'cc-pcard-title', text: p.company_name || '(unnamed company)' }),
    h('div', { class: 'cc-muted', text: p.contact_name || '—' }),
    h('div', { class: 'cc-pcard-meta', text: fmtRange(p.estimated_value_min, p.estimated_value_max) }),
    p.next_followup_at ? h('div', { class: 'cc-muted', text: 'Next follow-up ' + fmtDateTime(p.next_followup_at) }) : null,
    badges.length ? h('div', { class: 'cc-badges' }, badges) : null
  );
}

function renderBoard(container, snap) {
  container.appendChild(h('h1', { class: 'cc-h1', text: 'Pipeline' }));
  container.appendChild(notice('info', 'Columns are the status values currently in the database. Select a prospect to see its messages and history.'));

  if (snap.prospects.length === 0) {
    container.appendChild(emptyState('No prospects are visible.'));
    return;
  }

  const counts = countBy(snap.prospects, (p) => p.status);
  const columns = sortStatuses(counts.keys()).map((status) => {
    const rows = snap.prospects.filter((p) => (p.status === null || p.status === undefined || p.status === '' ? '(none)' : String(p.status)) === status);
    let min = 0;
    let max = 0;
    rows.forEach((p) => {
      min += toNumber(p.estimated_value_min) || 0;
      max += toNumber(p.estimated_value_max) || 0;
    });
    return h('section', { class: 'cc-column' },
      h('header', { class: 'cc-column-head' },
        h('h2', { class: 'cc-h2', text: humanize(status) }),
        h('span', { class: 'cc-chip-count', text: String(rows.length) })
      ),
      h('div', { class: 'cc-muted', text: fmtRange(min || null, max || null) }),
      rows.map(prospectCard)
    );
  });

  container.appendChild(h('div', { class: 'cc-board' }, columns));
}

function renderDetail(container, snap, id) {
  const prospect = snap.prospectsById.get(String(id));
  container.appendChild(h('p', {}, h('a', { class: 'cc-back', href: '#/pipeline', text: '← Back to pipeline' })));

  if (!prospect) {
    container.appendChild(notice('warn', 'That prospect was not found in the loaded data.'));
    return;
  }

  container.appendChild(h('h1', { class: 'cc-h1' }, prospect.company_name || '(unnamed company)', ' ', badge(humanize(prospect.status), 'status')));

  container.appendChild(section('Details', prospectFacts(prospect)));
  container.appendChild(section('Research',
    h('div', { class: 'cc-labeled' }, h('h4', { class: 'cc-h4', text: 'Pain point' }), textBlock(prospect.pain_point)),
    h('div', { class: 'cc-labeled' }, h('h4', { class: 'cc-h4', text: 'Evidence' }), textBlock(prospect.evidence)),
    h('div', { class: 'cc-labeled' }, h('h4', { class: 'cc-h4', text: 'Proposed offer' }), textBlock(prospect.proposed_offer)),
    h('div', { class: 'cc-labeled' }, h('h4', { class: 'cc-h4', text: 'Notes' }), textBlock(prospect.notes)),
    factList([
      ['Source', prospect.source],
      ['Source URL', prospect.source_url],
      ['First contact', fmtDateTime(prospect.first_contact_at)],
      ['Last contact', fmtDateTime(prospect.last_contact_at)],
      ['Created', fmtDateTime(prospect.created_at)],
      ['Updated', fmtDateTime(prospect.updated_at)]
    ])
  ));

  const messages = (snap.messagesByProspect.get(String(prospect.id)) || []).slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.appendChild(section('Messages (' + messages.length + ')',
    messages.length ? messages.map((m) =>
      h('details', { class: 'cc-details' },
        h('summary', {}, humanize(m.message_type) + ' · ' + humanize(m.status) + ' · ' + fmtDateTime(m.created_at)),
        h('p', { class: 'cc-subject', text: m.subject || '—' }),
        textBlock(m.body),
        h('p', { class: 'cc-muted', text:
          'approved: ' + (m.approved ? 'yes' : 'no') +
          (m.scheduled_at ? ' · scheduled ' + fmtDateTime(m.scheduled_at) : '') +
          (m.sent_at ? ' · sent ' + fmtDateTime(m.sent_at) : '') })
      )
    ) : emptyState('No messages for this prospect.')
  ));

  const acts = (snap.activitiesByProspect.get(String(prospect.id)) || []).slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.appendChild(section('Activity history (' + acts.length + ')',
    acts.length ? h('ul', { class: 'cc-timeline' }, acts.map((a) =>
      h('li', {},
        h('div', { class: 'cc-timeline-head' },
          badge(humanize(a.activity_type), 'type'),
          h('span', { class: 'cc-muted', text: fmtDateTime(a.created_at) + ' (' + fmtRelative(a.created_at) + ')' })
        ),
        a.details !== null && a.details !== undefined && a.details !== ''
          ? h('pre', { class: 'cc-pre', text: formatValue(a.details) })
          : null
      )
    )) : emptyState('No activity recorded for this prospect.')
  ));
}

export function render(container, ctx) {
  if (ctx.param) renderDetail(container, ctx.snap, ctx.param);
  else renderBoard(container, ctx.snap);
}
