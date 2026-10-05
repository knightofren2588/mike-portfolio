// Small DOM + formatting helpers.
//
// SECURITY RULE FOR THE WHOLE COMMAND CENTER:
// Prospect research, scraped evidence, email drafts, and activity details are UNTRUSTED text
// (they can come from web pages and AI output). They must only ever reach the page through
// textContent / text nodes. This file is the single place that builds DOM, and it:
//   - never uses innerHTML, outerHTML, insertAdjacentHTML, or document.write
//   - only allows a short list of attributes (no on* handlers, no style attribute)
//   - only allows href values that are in-page "#/..." routes
//   - allows no src attribute at all (the app displays no images)

const ALLOWED_ATTRS = new Set([
  'id', 'type', 'name', 'for', 'value', 'placeholder', 'autocomplete', 'inputmode',
  'pattern', 'maxlength', 'minlength', 'required', 'disabled', 'role', 'title',
  'colspan', 'scope', 'href', 'tabindex', 'spellcheck', 'selected', 'rows',
  'checked', 'rel', 'hidden'
]);

/**
 * Build an element.
 *   h('div', { class: 'card', text: 'hello' }, child1, child2)
 * props.class  -> className
 * props.text   -> textContent
 * props.on     -> { eventName: handler } (addEventListener, never inline)
 * Children may be strings (become text nodes), Nodes, arrays of those, or null/undefined/false.
 */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  const p = props || {};

  for (const key of Object.keys(p)) {
    const value = p[key];
    if (value === undefined || value === null || value === false) continue;

    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'on') {
      for (const evt of Object.keys(value)) node.addEventListener(evt, value[evt]);
    } else if (key === 'href') {
      const href = String(value);
      if (!/^#\//.test(href)) throw new Error('Blocked href (only #/ routes allowed).');
      node.setAttribute('href', href);
    } else if (ALLOWED_ATTRS.has(key) || key.startsWith('aria-') || key.startsWith('data-')) {
      node.setAttribute(key, value === true ? '' : String(value));
    } else {
      throw new Error('Blocked attribute: ' + key);
    }
  }

  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) {
      append(node, child);
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// ---------- formatting ----------

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmtMoney(v) {
  const n = toNumber(v);
  return n === null ? '—' : MONEY.format(n);
}

export function fmtRange(min, max) {
  const a = toNumber(min);
  const b = toNumber(max);
  if (a === null && b === null) return '—';
  if (a !== null && b !== null && a !== b) return MONEY.format(a) + ' – ' + MONEY.format(b);
  return MONEY.format(a !== null ? a : b);
}

export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtRelative(v, now) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  const ref = now instanceof Date ? now : new Date();
  const diff = ref.getTime() - d.getTime();
  const abs = Math.abs(diff);
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  let text;
  if (abs < min) text = 'moments';
  else if (abs < hour) text = Math.round(abs / min) + ' min';
  else if (abs < day) text = Math.round(abs / hour) + ' h';
  else text = Math.round(abs / day) + ' d';
  if (abs < min) return diff >= 0 ? 'just now' : 'in moments';
  return diff >= 0 ? text + ' ago' : 'in ' + text;
}

export function humanize(s) {
  if (s === null || s === undefined || s === '') return '—';
  const t = String(s).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Turn any database value into display text (never HTML). */
export function formatValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch (e) {
    return String(v);
  }
}

// ---------- tiny UI pieces ----------

export function badge(text, kind) {
  return h('span', { class: 'cc-badge' + (kind ? ' cc-badge-' + kind : ''), text: text });
}

export function emptyState(message) {
  return h('p', { class: 'cc-empty', text: message });
}

export function notice(kind, message) {
  return h('div', { class: 'cc-notice cc-notice-' + kind, role: kind === 'error' ? 'alert' : 'status', text: message });
}

/** A long untrusted text block: preserves line breaks, never interpreted as HTML. */
export function textBlock(value, extraClass) {
  return h('div', { class: 'cc-textblock' + (extraClass ? ' ' + extraClass : ''), text: formatValue(value) });
}

/** Label/value pair list. rows = [[label, value], ...]; values are shown as text. */
export function factList(rows) {
  const dl = h('dl', { class: 'cc-facts' });
  for (const row of rows) {
    dl.appendChild(h('dt', { text: row[0] }));
    const dd = h('dd');
    const v = row[1];
    if (v instanceof Node) dd.appendChild(v);
    else dd.textContent = formatValue(v);
    dl.appendChild(dd);
  }
  return dl;
}

export function section(title, ...children) {
  return h('section', { class: 'cc-section' }, h('h2', { class: 'cc-h2', text: title }), children);
}
