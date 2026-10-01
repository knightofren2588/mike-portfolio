// Activity Feed: the newest activity records, with an in-page type filter (no extra database calls).

import { h, clear, badge, emptyState, fmtDateTime, fmtRelative, humanize, formatValue } from '../dom.js';
import { countBy } from '../api.js';

const FEED_LIMIT = 100;
const DETAIL_PREVIEW_CHARS = 180;

function detailsCell(value) {
  const text = formatValue(value);
  if (text === '—') return h('span', { class: 'cc-muted', text: '—' });
  if (text.length <= DETAIL_PREVIEW_CHARS) return h('pre', { class: 'cc-pre cc-pre-inline', text: text });
  return h('details', { class: 'cc-details' },
    h('summary', {}, text.slice(0, DETAIL_PREVIEW_CHARS) + '…'),
    h('pre', { class: 'cc-pre', text: text })
  );
}

function buildTable(snap, filter) {
  const rows = snap.activities.filter((a) => filter === '' || String(a.activity_type) === filter);
  const shown = rows.slice(0, FEED_LIMIT);

  const wrap = h('div', {});
  wrap.appendChild(h('p', { class: 'cc-muted', text: 'Showing ' + shown.length + ' of ' + rows.length + (rows.length > FEED_LIMIT ? ' (newest first)' : '') }));
  if (shown.length === 0) {
    wrap.appendChild(emptyState('No activity matches.'));
    return wrap;
  }

  const body = h('tbody', {});
  shown.forEach((a) => {
    const prospect = snap.prospectsById.get(String(a.prospect_id));
    body.appendChild(h('tr', {},
      h('td', { text: fmtDateTime(a.created_at) + ' · ' + fmtRelative(a.created_at) }),
      h('td', {}, badge(humanize(a.activity_type), 'type')),
      h('td', {}, prospect ? (prospect.company_name || '(unnamed company)') : 'Unknown prospect'),
      h('td', {}, detailsCell(a.details))
    ));
  });

  wrap.appendChild(h('div', { class: 'cc-table-wrap' },
    h('table', { class: 'cc-table' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', text: 'When' }),
        h('th', { scope: 'col', text: 'Type' }),
        h('th', { scope: 'col', text: 'Prospect' }),
        h('th', { scope: 'col', text: 'Details' })
      )),
      body
    )
  ));
  return wrap;
}

export function render(container, ctx) {
  const snap = ctx.snap;
  container.appendChild(h('h1', { class: 'cc-h1', text: 'Activity Feed' }));

  if (snap.truncated.activities) {
    container.appendChild(h('p', { class: 'cc-muted', text: 'Only the newest activity rows were loaded.' }));
  }

  const types = Array.from(countBy(snap.activities, (a) => a.activity_type).entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const select = h('select', { id: 'cc-activity-filter' }, h('option', { value: '', text: 'All activity types' }));
  types.forEach((entry) => select.appendChild(h('option', { value: entry[0], text: humanize(entry[0]) + ' (' + entry[1] + ')' })));

  container.appendChild(h('div', { class: 'cc-toolbar' },
    h('label', { for: 'cc-activity-filter', text: 'Filter' }), select
  ));

  const results = h('div', {});
  container.appendChild(results);
  const draw = () => {
    clear(results);
    results.appendChild(buildTable(snap, select.value));
  };
  select.addEventListener('change', draw);
  draw();
}
