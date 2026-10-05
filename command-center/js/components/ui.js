// Shared UI building blocks. Everything is built with h() from dom.js, so database text only ever reaches the
// page through textContent (never as HTML).

import { h, badge, notice, textBlock, formatValue, humanize } from '../dom.js';
import { statusLabel, statusKind, messageStatusLabel, messageStatusKind } from '../utilities/labels.js';
import { LEAD_SCORE_BANDS } from '../config.js';

export function statusBadge(status) {
  return badge(statusLabel(status), statusKind(status));
}

export function messageStatusBadge(status) {
  return badge(messageStatusLabel(status), messageStatusKind(status));
}

export function dncBadge() {
  return badge('Do not contact', 'danger');
}

/** Lead score 0-100 as a coloured pill (bands live in config.js). */
export function scorePill(score) {
  if (score === null || score === undefined || score === '') return h('span', { class: 'cc-muted', text: '—' });
  const n = Number(score);
  const band = n >= LEAD_SCORE_BANDS.high ? 'high' : n >= LEAD_SCORE_BANDS.medium ? 'mid' : 'low';
  return h('span', { class: 'cc-score cc-score-' + band, title: 'Lead score (0-100)', text: String(score) });
}

/**
 * A RESERVED, INACTIVE home for a future controlled action (for example "Edit details" or "Set next follow-up").
 * It is an empty hidden element today. Nothing is wired to it and it cannot change any data. When a future phase
 * adds a controlled database function for that action, the button is appended here.
 */
export function reservedSlot(name) {
  return h('div', { class: 'cc-slot', 'data-slot': name, hidden: true });
}

/** A titled panel. opts.slot names a reserved (inactive) action slot placed in the panel header. */
export function panel(title, body, opts) {
  const o = opts || {};
  return h('section', { class: 'cc-panel' },
    h('header', { class: 'cc-panel-head' },
      h('h2', { class: 'cc-h2', text: title }),
      o.slot ? reservedSlot(o.slot) : null
    ),
    body
  );
}

/** Link-style tabs (each tab is its own URL, so tabs are bookmarkable and the back button works). */
export function tabNav(items, activeKey, label) {
  return h('nav', { class: 'cc-tabs', 'aria-label': label },
    items.map((item) => h('a', { class: 'cc-tab', href: item.href, 'aria-current': item.key === activeKey ? 'page' : false },
      item.label,
      item.count === undefined ? null : h('span', { class: 'cc-tab-count', text: String(item.count) })
    ))
  );
}

export function stat(label, valueNode) {
  return h('div', { class: 'cc-stat' },
    h('div', { class: 'cc-stat-label', text: label }),
    h('div', { class: 'cc-stat-value' }, valueNode)
  );
}

export function loadingState(text) {
  return h('div', { class: 'cc-loading', role: 'status', 'aria-live': 'polite', text: text || 'Loading…' });
}

export function errorState(message, onRetry) {
  const box = h('div', { class: 'cc-error-state' }, notice('error', message));
  if (typeof onRetry === 'function') {
    const retry = h('button', { type: 'button', class: 'cc-btn', text: 'Try again' });
    retry.addEventListener('click', onRetry);
    box.appendChild(retry);
  }
  return box;
}

/** An empty state with a short explanation and optional action nodes. */
export function emptyBlock(title, text, actions) {
  return h('div', { class: 'cc-empty-block' },
    h('p', { class: 'cc-empty-title', text: title }),
    text ? h('p', { class: 'cc-muted', text: text }) : null,
    actions || null
  );
}

/** Show a database value that might be text, a list or JSON. Always plain text. */
export function renderValue(value) {
  if (value === null || value === undefined || value === '') return h('p', { class: 'cc-muted', text: '—' });
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' || typeof v === 'number')) {
    return h('ul', { class: 'cc-list' }, value.map((v) => h('li', { text: String(v) })));
  }
  return textBlock(value);
}

// ---------- activity details: readable, collapsed by default when large or structured ----------
const INLINE_MAX_CHARS = 140;
const KV_MAX_FIELDS = 40;

function collapsible(content) {
  const summary = h('summary', { text: 'Show details' });
  const box = h('details', { class: 'cc-details-inline' }, summary, content);
  box.addEventListener('toggle', () => {
    summary.textContent = box.open ? 'Hide details' : 'Show details';
  });
  return box;
}

function fillValue(dd, value) {
  if (value === null || value === undefined || value === '') dd.textContent = '—';
  else if (typeof value === 'object') dd.appendChild(h('pre', { class: 'cc-pre cc-pre-inline', text: formatValue(value) }));
  else dd.textContent = String(value);
}

/**
 * Details for an activity record. Short text is shown inline. Long text and JSON are COLLAPSED behind a
 * "Show details" control, and JSON objects open as readable key / value rows (not a raw JSON blob).
 * Everything is plain text.
 */
export function renderDetails(value) {
  if (value === null || value === undefined || value === '') return h('span', { class: 'cc-muted', text: '—' });
  if (typeof value === 'string') {
    if (value.length <= INLINE_MAX_CHARS && value.indexOf('\n') === -1) return h('p', { class: 'cc-detail-text', text: value });
    return collapsible(textBlock(value));
  }
  if (typeof value !== 'object') return h('p', { class: 'cc-detail-text', text: String(value) });

  const isList = Array.isArray(value);
  const entries = isList ? value.map((v, i) => [String(i + 1), v]) : Object.keys(value).map((k) => [k, value[k]]);
  if (entries.length === 0) return h('span', { class: 'cc-muted', text: '—' });

  const dl = h('dl', { class: 'cc-kv' });
  entries.slice(0, KV_MAX_FIELDS).forEach((entry) => {
    dl.appendChild(h('dt', { text: isList ? '#' + entry[0] : humanize(entry[0]) }));
    const dd = h('dd');
    fillValue(dd, entry[1]);
    dl.appendChild(dd);
  });
  if (entries.length > KV_MAX_FIELDS) {
    dl.appendChild(h('dt', { text: '…' }));
    dl.appendChild(h('dd', { class: 'cc-muted', text: (entries.length - KV_MAX_FIELDS) + ' more fields not shown' }));
  }
  return collapsible(dl);
}
