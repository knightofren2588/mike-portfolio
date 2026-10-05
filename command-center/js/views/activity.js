// Activity Feed: the newest activity records, with an in-page type filter (no extra database calls).
//
// Desktop: a table. Phone / tablet (<= 960px): each record becomes a CARD
//   [activity type] ........ [date]
//   [prospect]
//   [details, collapsed behind "Show details" when large or structured]
// This is one set of rows restyled by cc.css, not two separate lists. READ-ONLY; all text via textContent.

import { h, clear, badge, emptyState, fmtRelative } from '../dom.js';
import { countBy } from '../api.js';
import { activityLabel, activityKind } from '../utilities/labels.js';
import { fmtDate, fmtTime, fmtFull } from '../utilities/format.js';
import { hrefProspect } from '../utilities/query.js';
import { renderDetails } from '../components/ui.js';

const FEED_LIMIT = 100;

function buildRow(a, snap, now) {
  const prospect = snap.prospectsById.get(String(a.prospect_id));
  return h('tr', { class: 'cc-arow' },
    h('td', { class: 'cc-acell-when', 'data-label': 'When' },
      h('div', { class: 'cc-when', title: fmtFull(a.created_at) },
        h('span', { class: 'cc-when-main', text: fmtDate(a.created_at, now) + ' · ' + fmtTime(a.created_at) }),
        h('span', { class: 'cc-muted cc-when-rel', text: fmtRelative(a.created_at, now) })
      )
    ),
    h('td', { class: 'cc-acell-type', 'data-label': 'Type' }, badge(activityLabel(a.activity_type), activityKind(a.activity_type))),
    h('td', { class: 'cc-acell-prospect', 'data-label': 'Prospect' },
      prospect
        ? h('a', { class: 'cc-link-strong', href: hrefProspect(prospect.id), text: prospect.company_name || '(unnamed company)' })
        : h('span', { class: 'cc-muted', text: 'Unknown prospect' })
    ),
    h('td', { class: 'cc-acell-details', 'data-label': 'Details' }, renderDetails(a.details))
  );
}

function buildTable(snap, filter) {
  const now = new Date();
  const rows = snap.activities.filter((a) => filter === '' || String(a.activity_type) === filter);
  const shown = rows.slice(0, FEED_LIMIT);

  const wrap = h('div', {});
  wrap.appendChild(h('p', { class: 'cc-muted', text: 'Showing ' + shown.length + ' of ' + rows.length + (rows.length > FEED_LIMIT ? ' (newest first)' : '') }));
  if (shown.length === 0) {
    wrap.appendChild(emptyState('No activity matches.'));
    return wrap;
  }

  const body = h('tbody', {});
  shown.forEach((a) => body.appendChild(buildRow(a, snap, now)));

  wrap.appendChild(h('div', { class: 'cc-table-wrap' },
    h('table', { class: 'cc-table cc-atable' },
      h('caption', { class: 'cc-sr-only', text: 'Activity records, newest first' }),
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
  types.forEach((entry) => select.appendChild(h('option', { value: entry[0], text: activityLabel(entry[0]) + ' (' + entry[1] + ')' })));

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
