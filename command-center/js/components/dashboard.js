// Dashboard building blocks for Overview and System Status. They only DRAW the data produced by
// utilities/insights.js; they never read the database. All text goes through h() / textContent (never HTML),
// and every link is an in-page "#/..." route (dom.js refuses anything else).
//
// Desktop can be dense. At <= 960px cc.css recomposes the same markup: single columns, items behind disclosure
// buttons ("Show items"), and cards instead of tables.

import { h, badge, fmtRange, fmtRelative, fmtDateTime } from '../dom.js';
import { disclosure } from './disclosure.js';
import { onSessionEnd } from '../utilities/session.js';
import { activityKind } from '../utilities/labels.js';

// Which disclosures the user opened, remembered for this signed-in session only.
let opened = Object.create(null);
onSessionEnd(() => { opened = Object.create(null); });
function isOpen(key, fallback) {
  return Object.prototype.hasOwnProperty.call(opened, key) ? opened[key] : !!fallback;
}

const SEVERITY = {
  failure: { label: 'Failure', badge: 'danger' },
  reply: { label: 'Reply', badge: 'ok' },
  waiting: { label: 'Waiting on you', badge: 'warn' },
  overdue: { label: 'Overdue', badge: 'overdue' },
  info: { label: 'Informational', badge: 'neutral' }
};

/** "5 min", "3 h", "2 d". */
export function fmtDuration(ms) {
  const abs = Math.abs(ms);
  if (abs < 60 * 1000) return 'under a minute';
  if (abs < 3600 * 1000) return Math.round(abs / 60000) + ' min';
  if (abs < 86400 * 1000) return Math.round(abs / 3600000) + ' h';
  return Math.round(abs / 86400000) + ' d';
}

/** A titled block with an optional "See all" link. */
export function block(title, children, opts) {
  const o = opts || {};
  return h('section', { class: 'cc-block' + (o.className ? ' ' + o.className : ''), id: o.id },
    h('header', { class: 'cc-block-head' },
      h('h2', { class: 'cc-h2', text: title }),
      o.link ? h('a', { class: 'cc-block-link', href: o.link.href, text: o.link.label }) : null
    ),
    children
  );
}

// ---------- next actions ----------
export function nextActionsPanel(actions) {
  if (!actions.length) return null;
  return h('ol', { class: 'cc-next', 'aria-label': 'Recommended next actions' },
    actions.map((a) => h('li', {},
      h('a', { class: 'cc-next-item cc-sev-' + a.severity, href: a.href },
        h('span', { class: 'cc-next-rank', 'aria-hidden': 'true', text: String(a.rank) }),
        h('span', { class: 'cc-next-label', text: a.label }),
        h('span', { class: 'cc-next-go', 'aria-hidden': 'true', text: '→' })
      )
    ))
  );
}

// ---------- needs attention ----------
function itemDetail(kind, item, now) {
  const rel = item.at ? fmtRelative(item.at, now) : null;
  switch (kind) {
    case 'replies': {
      const base = rel ? 'Replied ' + rel : 'Replied';
      // A do-not-contact prospect's reply is for review only; say so on the card (the red badge is shown too).
      return item.flags && item.flags.indexOf('do_not_contact') !== -1 ? base + ' · review only, do not contact is active' : base;
    }
    case 'failed': return item.typeLabel + (rel ? ' · drafted ' + rel : '');
    case 'stuck': return item.typeLabel + (rel ? ' · scheduled ' + rel : '');
    case 'drafts': return item.typeLabel + (rel ? ' · drafted ' + rel : '');
    case 'overdue': return item.overdueMs !== undefined ? 'Follow-up due ' + fmtDuration(item.overdueMs) + ' ago' : 'Follow-up overdue';
    case 'review': return rel ? 'Added ' + rel : 'Needs review';
    default: return item.typeLabel + (rel ? ' · approved ' + rel : '');
  }
}

export function attentionCard(entry, now) {
  const sev = SEVERITY[entry.severity] || SEVERITY.info;
  const list = h('ul', { class: 'cc-att-items' }, entry.items.map((item) => {
    const flags = [];
    if (item.draftState === 'draft_in_queue') flags.push(badge('Draft already in queue', 'info'));
    if (item.draftState === 'approved_waiting') flags.push(badge('Approved, waiting to send', 'info'));
    if (item.flags && item.flags.indexOf('do_not_contact') !== -1) flags.push(badge('Do not contact', 'danger'));
    return h('li', {},
      h('a', { class: 'cc-att-link', href: item.href },
        h('span', { class: 'cc-att-name', text: item.label }),
        h('span', { class: 'cc-muted cc-att-detail', text: itemDetail(entry.kind, item, now) })
      ),
      flags.length ? h('span', { class: 'cc-badges' }, flags) : null,
      item.draftState && item.messageHref ? h('a', { class: 'cc-att-sub', href: item.messageHref, text: 'Open the draft' }) : null
    );
  }));
  if (entry.count > entry.items.length) {
    list.appendChild(h('li', {}, h('a', { class: 'cc-att-more', href: entry.href, text: 'View all ' + entry.count })));
  }

  const key = 'att-' + entry.kind;
  return h('article', { class: 'cc-att cc-att-' + entry.severity },
    h('header', { class: 'cc-att-head' },
      h('h3', { class: 'cc-h3' }, h('a', { class: 'cc-link-strong', href: entry.href, text: entry.title })),
      badge(sev.label, sev.badge)
    ),
    entry.oldestAt ? h('p', { class: 'cc-muted cc-att-meta', text: 'Oldest: ' + fmtRelative(entry.oldestAt, now) }) : null,
    entry.kind === 'overdue' && entry.withDraft
      ? h('p', { class: 'cc-muted cc-att-meta', text: entry.withDraft + ' of these already ' + (entry.withDraft === 1 ? 'has' : 'have') + ' a draft in the queue.' })
      : null,
    entry.note ? h('p', { class: 'cc-att-note', text: entry.note }) : null,
    disclosure({
      id: 'cc-ov-' + key, label: 'Show ' + entry.items.length + (entry.items.length === 1 ? ' item' : ' items'),
      open: isOpen(key, false), onToggle: (o) => { opened[key] = o; }, body: list
    })
  );
}

// ---------- sales ----------
export function statTile(label, value, sub, className) {
  return h('div', { class: 'cc-tile' + (className ? ' ' + className : '') },
    h('div', { class: 'cc-tile-value', text: value }),
    h('div', { class: 'cc-tile-label', text: label }),
    sub ? h('div', { class: 'cc-tile-sub', text: sub }) : null
  );
}

export function moneyRange(summary) {
  return summary.valueMin === null ? '—' : fmtRange(summary.valueMin, summary.valueMax);
}

export function stageDistribution(phases) {
  const maxCount = Math.max(1, ...phases.flatMap((p) => p.stages.map((s) => s.count)));
  return h('div', { class: 'cc-phases' }, phases.map((ph) =>
    h('section', { class: 'cc-phase' },
      h('header', { class: 'cc-phase-head' },
        h('h3', { class: 'cc-h4', text: ph.label }),
        h('span', { class: 'cc-chip-count', text: String(ph.count) })
      ),
      h('ul', { class: 'cc-stage-list' }, ph.stages.map((s) => {
        // Value is shown for the open phases and for Won (reported separately); not for lost / closed / DNC.
        const showValue = s.valueMin !== null && (ph.key !== 'closed' || s.status === 'won');
        return h('li', { class: 'cc-stage-row' + (s.count === 0 ? ' is-empty' : '') },
          h('span', { class: 'cc-stage-label', text: s.label }),
          h('span', { class: 'cc-stage-count', text: String(s.count) }),
          h('progress', { class: 'cc-bar', value: String(s.count), max: String(maxCount), 'aria-label': s.label + ': ' + s.count }),
          h('span', { class: 'cc-muted cc-stage-value', text: showValue ? fmtRange(s.valueMin, s.valueMax) : '' })
        );
      }))
    )
  ));
}

// ---------- upcoming ----------
export function upcomingGroup(key, title, group, emptyText, describe, link, openDefault) {
  const body = group.items.length
    ? h('ul', { class: 'cc-up-items' }, group.items.map((item) => h('li', {},
        h('a', { class: 'cc-att-link', href: item.href },
          h('span', { class: 'cc-att-name', text: item.label }),
          h('span', { class: 'cc-muted cc-att-detail', text: describe(item) })
        ),
        item.draftState === 'draft_in_queue' ? badge('Draft already in queue', 'info') : null,
        item.draftState === 'approved_waiting' ? badge('Approved, waiting to send', 'info') : null
      )))
    : h('p', { class: 'cc-muted', text: emptyText });
  const wrap = h('div', {}, body);
  if (link && group.count > group.items.length) {
    wrap.appendChild(h('p', {}, h('a', { class: 'cc-att-more', href: link, text: 'View all ' + group.count })));
  }
  return h('section', { class: 'cc-up' },
    h('header', { class: 'cc-up-head' },
      h('h3', { class: 'cc-h4', text: title }),
      h('span', { class: 'cc-chip-count', text: String(group.count) })
    ),
    disclosure({
      id: 'cc-ov-up-' + key, label: 'Show ' + title.toLowerCase(), open: isOpen('up-' + key, openDefault && group.items.length > 0),
      onToggle: (o) => { opened['up-' + key] = o; }, body: wrap
    })
  );
}

// ---------- recent activity ----------
export function activityList(items, now) {
  if (!items.length) return h('p', { class: 'cc-muted', text: 'No CRM activity recorded yet.' });
  return h('ul', { class: 'cc-act-list' }, items.map((a) =>
    h('li', { class: 'cc-act-item' },
      badge(a.label, activityKind(a.type)),
      a.company
        ? h('a', { class: 'cc-link-strong cc-act-company', href: a.href, text: a.company })
        : h('span', { class: 'cc-muted', text: 'Unknown prospect' }),
      h('span', { class: 'cc-muted cc-act-when', title: a.at ? fmtDateTime(a.at) : '', text: a.at ? fmtRelative(a.at, now) : '' })
    )
  ));
}

// ---------- system health ----------
function backlogSummary(system) {
  if (!system.backlog.parts.length) return 'None';
  return system.backlog.parts.map((p) => p.count + ' ' + p.label).join('; ');
}

function kvRows(rows) {
  const dl = h('dl', { class: 'cc-qkv' });
  rows.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '').forEach((r) => {
    dl.appendChild(h('dt', { text: r[0] }));
    const dd = h('dd');
    if (r[1] instanceof Node) dd.appendChild(r[1]); else dd.textContent = String(r[1]);
    dl.appendChild(dd);
  });
  return dl;
}

const ATTENTION_BADGE = {
  exception: ['Exception', 'danger'],
  info: ['Backlog', 'neutral'],
  none: ['No backlog', 'neutral']
};

/** compact = the small card on the Overview; otherwise the full card on System Status. */
export function healthCard(system, now, compact) {
  const att = ATTENTION_BADGE[system.attention];
  const evidence = system.lastEvidence
    ? fmtDateTime(system.lastEvidence.at) + ' (' + fmtRelative(system.lastEvidence.at, now) + ')'
    : 'No database evidence yet';

  const head = h('header', { class: 'cc-hcard-head' },
    h('h3', { class: 'cc-h3' }, compact ? h('a', { class: 'cc-link-strong', href: '#/status', text: system.label }) : system.label),
    h('span', { class: 'cc-badges' }, badge(att[0], att[1]))
  );

  const exceptionNodes = system.exceptions.map((e) =>
    h('p', { class: 'cc-hcard-exception' }, h('a', { href: e.href, text: e.label }))
  );

  if (compact) {
    return h('article', { class: 'cc-hcard cc-hcard-' + system.attention },
      head,
      h('p', { class: 'cc-muted cc-hcard-line', text: system.publishedLabel + ' (according to Command Center configuration)' }),
      h('p', { class: 'cc-hcard-line' }, h('span', { class: 'cc-muted', text: 'Last evidence: ' }), system.lastEvidence ? fmtRelative(system.lastEvidence.at, now) : 'none yet'),
      h('p', { class: 'cc-hcard-line' }, h('span', { class: 'cc-muted', text: 'Backlog: ' }), system.backlog.parts.length ? system.backlog.total + ' (' + backlogSummary(system).replace(/ \(expected[^)]*\)/g, '') + ')' : 'none'),
      exceptionNodes
    );
  }

  const coverage = system.coverage.length
    ? h('ul', { class: 'cc-list' }, system.coverage.map((c) => h('li', {
        text: c.label + ': ' + (c.state === 'ready' ? 'sender marked as published' : c.state === 'unready' ? 'sender listed, not marked as published' : 'no sender workflow configured') })))
    : null;
  const sources = h('ul', { class: 'cc-list' }, system.evidenceSources.map((s) =>
    h('li', { text: s.source + ': ' + (s.at ? fmtDateTime(s.at) : 'none') })));

  return h('article', { class: 'cc-hcard cc-hcard-' + system.attention },
    head,
    h('p', { class: 'cc-muted cc-hcard-line', text: system.configuredCapability }),
    kvRows([
      ['Published state', system.publishedLabel + ' (according to Command Center configuration)'],
      ['Last database evidence', evidence],
      ['Evidence source', system.lastEvidence ? system.lastEvidence.source : null],
      ['Evidence age', system.lastEvidence ? fmtRelative(system.lastEvidence.at, now) : null],
      ['Backlog', backlogSummary(system)]
    ]),
    system.exceptions.length
      ? h('div', { class: 'cc-hcard-exceptions' }, h('h4', { class: 'cc-h4', text: 'Attention' }), exceptionNodes)
      : h('p', { class: 'cc-muted cc-hcard-line', text: 'No failed or stuck messages recorded for this system.' }),
    disclosure({
      id: 'cc-st-' + system.key, label: 'Evidence details', open: isOpen('st-' + system.key, false),
      onToggle: (o) => { opened['st-' + system.key] = o; },
      body: h('div', {},
        coverage ? h('div', { class: 'cc-qsub' }, h('h4', { class: 'cc-h4', text: 'Message types' }), coverage) : null,
        h('div', { class: 'cc-qsub' }, h('h4', { class: 'cc-h4', text: 'Evidence sources checked' }), sources))
    })
  );
}
