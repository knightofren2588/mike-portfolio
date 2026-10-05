// Disclosure controls for the Approval Queue (sections and card details).
//
// Both are REAL <button>s with aria-expanded and aria-controls, so they work with the keyboard and screen readers.
// Whether anything is actually collapsed is decided by cc.css:
//   - at <= 960px (phones and tablets) a closed disclosure hides its body and the toggle is shown;
//   - above 960px (desktop) the toggle is hidden and the body is always visible, so the desktop layout is
//     unchanged and nothing is hidden behind a control.
// Open/closed state is remembered by the caller (queue.js) for the rest of the signed-in session.

import { h } from '../dom.js';

function chevron() {
  return h('span', { class: 'cc-chev', 'aria-hidden': 'true', text: '▾' });
}

/** A "Preview message" / "More details" / "View details" control with its body. */
export function disclosure(opts) {
  const button = h('button', {
    type: 'button',
    class: 'cc-qdisc-toggle',
    'aria-expanded': opts.open ? 'true' : 'false',
    'aria-controls': opts.id
  }, h('span', { text: opts.label }), chevron());

  const body = h('div', { class: 'cc-qdisc-body', id: opts.id }, opts.body);
  const wrap = h('div', { class: 'cc-qdisc' + (opts.open ? ' is-open' : '') }, button, body);

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    wrap.classList.toggle('is-open', open);
    if (typeof opts.onToggle === 'function') opts.onToggle(open);
  });
  return wrap;
}

/**
 * A queue section: "Awaiting approval (2)  ▾". On desktop it is a plain heading above an always-visible body.
 * On phones the heading is a disclosure button. Both headings exist in the page, and CSS shows only one of them,
 * so assistive technology never meets the wrong one.
 */
export function collapsibleSection(opts) {
  const label = opts.title + ' (' + opts.count + ')';
  const bodyId = opts.id + '-body';

  const plain = h('h2', { class: 'cc-h2 cc-qs-plain', text: label });
  const toggle = h('button', {
    type: 'button',
    class: 'cc-qs-toggle',
    'aria-expanded': opts.open ? 'true' : 'false',
    'aria-controls': bodyId
  }, h('span', { text: label }), chevron());
  const mobileHeading = h('h2', { class: 'cc-h2 cc-qs-mobile' }, toggle);

  const body = h('div', { class: 'cc-qsection-body', id: bodyId }, opts.body);
  const section = h('section', { class: 'cc-qsection' + (opts.open ? ' is-open' : '') }, plain, mobileHeading, body);

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    section.classList.toggle('is-open', open);
    if (typeof opts.onToggle === 'function') opts.onToggle(open);
  });
  return section;
}
