// Pipeline: prospects grouped by their ACTUAL status values. Each card opens the full prospect page.
// (The old inline detail view moved to #/prospects/<id>; old #/pipeline/<id> links redirect there.)

import { h, notice, badge, emptyState, fmtRange, fmtDateTime, toNumber } from '../dom.js';
import { countBy, sortStatuses } from '../api.js';
import { statusLabel } from '../utilities/labels.js';
import { hrefProspect } from '../utilities/query.js';

function prospectCard(p) {
  const badges = [];
  if (p.lead_score !== null && p.lead_score !== undefined) badges.push(badge('Score ' + p.lead_score, 'score'));
  if (p.replied_at) badges.push(badge('Replied', 'ok'));
  if (p.do_not_contact) badges.push(badge('Do not contact', 'danger'));

  return h('a', { class: 'cc-pcard', href: hrefProspect(p.id) },
    h('div', { class: 'cc-pcard-title', text: p.company_name || '(unnamed company)' }),
    h('div', { class: 'cc-muted', text: p.contact_name || '—' }),
    h('div', { class: 'cc-pcard-meta', text: fmtRange(p.estimated_value_min, p.estimated_value_max) }),
    p.next_followup_at ? h('div', { class: 'cc-muted', text: 'Next follow-up ' + fmtDateTime(p.next_followup_at) }) : null,
    badges.length ? h('div', { class: 'cc-badges' }, badges) : null
  );
}

export function render(container, ctx) {
  const snap = ctx.snap;

  container.appendChild(h('h1', { class: 'cc-h1', text: 'Pipeline' }));
  container.appendChild(notice('info', 'Columns are the status values currently in the database. Select a prospect to open its full page.'));

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
        h('h2', { class: 'cc-h2', text: statusLabel(status) }),
        h('span', { class: 'cc-chip-count', text: String(rows.length) })
      ),
      h('div', { class: 'cc-muted', text: fmtRange(min || null, max || null) }),
      rows.map(prospectCard)
    );
  });

  container.appendChild(h('div', { class: 'cc-board' }, columns));
}
