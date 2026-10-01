// A small accessible modal dialog (no <dialog>, no innerHTML, no inline styles; CSP-safe).
//
//   const modal = openModal({ title, content, actions: [{ label, kind, onClick(modal) }], onClose, onIdle });
//   modal.setBusy(true|false)  disables every control while a request is in flight
//   modal.setError(text)       shows an error inside the dialog (plain text)
//   modal.close()
//
// Escape closes it (unless busy). Tab is kept inside the dialog. Focus returns to the opener on close.
// Clicking the dim background does NOT close it, so a half-typed edit is never lost by accident.

import { h } from './dom.js';

let current = null;

export function openModal(options) {
  if (current) current.close();

  const opener = document.activeElement;
  const titleId = 'cc-modal-title';
  let busy = false;
  let closed = false;

  const errorBox = h('div', { class: 'cc-modal-error', role: 'alert' });

  const modal = {
    buttons: [],
    isBusy: () => busy,
    setError: (text) => {
      errorBox.textContent = text ? String(text) : '';
    },
    setBusy: (value) => {
      busy = !!value;
      dialog.querySelectorAll('button, input, textarea').forEach((el) => {
        el.disabled = busy;
      });
      if (!busy && typeof options.onIdle === 'function') options.onIdle(modal);
    },
    close: () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      document.body.classList.remove('cc-modal-open');
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      if (current === modal) current = null;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
      if (typeof options.onClose === 'function') options.onClose();
    }
  };

  modal.buttons = options.actions.map((action) => {
    const button = h('button', {
      type: 'button',
      class: 'cc-btn' + (action.kind ? ' cc-btn-' + action.kind : ''),
      text: action.label
    });
    button.addEventListener('click', () => {
      if (busy || button.disabled) return;
      action.onClick(modal);
    });
    return button;
  });

  const dialog = h('div', { class: 'cc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('h2', { id: titleId, class: 'cc-h2', text: options.title }),
    h('div', { class: 'cc-modal-body' }, options.content),
    errorBox,
    h('div', { class: 'cc-modal-actions' }, modal.buttons)
  );
  const backdrop = h('div', { class: 'cc-modal-backdrop' }, dialog);

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!busy) modal.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll('button, input, textarea')).filter((el) => !el.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeydown, true);
  document.body.classList.add('cc-modal-open');
  document.body.appendChild(backdrop);
  current = modal;

  const firstField = dialog.querySelector('input, textarea');
  const safeButton = modal.buttons[0];
  (firstField || safeButton).focus();

  if (typeof options.onIdle === 'function') options.onIdle(modal);
  return modal;
}

export function closeActiveModal() {
  if (current) current.close();
}
