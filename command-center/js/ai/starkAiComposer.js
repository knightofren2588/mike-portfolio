// Stark AI panel: the question box and the quick-prompt buttons.
//
// The quick prompts come from the controller (state.quickPrompts, which comes from starkAiPrompts.js). This file never
// defines a question of its own, and a quick prompt always sends its OWN approved text.

import { h, clear } from '../dom.js';
import { STARK_AI } from '../config.js';

const COUNT_FROM_RATIO = 0.75; // the counter appears once you are close to the limit

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Buttons for the contextual quick prompts. Used in the welcome block and in the collapsed "Suggested questions" box. */
export function createQuickPrompts(options) {
  const ai = options.ai;
  const label = options.label || 'Suggested questions';
  const element = h('div', { class: 'cc-ai-quick', role: 'group', 'aria-label': label });
  let sig = '';
  let buttons = [];

  function render(state) {
    const ids = state.quickPrompts.map((q) => q.id).join(',');
    if (ids !== sig) {
      sig = ids;
      clear(element);
      buttons = state.quickPrompts.map((q) => {
        const b = h('button', { type: 'button', class: 'cc-ai-chip', text: q.text, 'data-prompt': q.id });
        b.addEventListener('click', () => { ai.sendQuickPrompt(q.id); });
        element.appendChild(b);
        return b;
      });
    }
    const off = !state.canSend || state.sending;
    buttons.forEach((b) => { b.disabled = off; });
    element.hidden = buttons.length === 0;
  }

  return { element: element, render: render, hasButtons: () => buttons.length > 0 };
}

export function createComposer(options) {
  const ai = options.ai;
  const max = (options.config || STARK_AI).maxMessageChars;
  const announce = options.announce || (() => {});

  const input = h('textarea', {
    id: 'cc-ai-input', class: 'cc-ai-input', rows: '2', placeholder: 'Ask Stark AI…', autocomplete: 'off', spellcheck: 'true',
    'aria-describedby': 'cc-ai-hint cc-ai-count'
  });
  input.setAttribute('enterkeyhint', 'send');
  const label = h('label', { class: 'cc-sr-only', for: 'cc-ai-input', text: 'Message to Stark AI' });
  const hint = h('span', { class: 'cc-ai-hint', id: 'cc-ai-hint', text: 'Enter to send · Shift+Enter for a new line' });
  const count = h('span', { class: 'cc-ai-count', id: 'cc-ai-count', hidden: true });
  const send = h('button', { type: 'submit', class: 'cc-btn cc-btn-primary cc-ai-send', text: 'Send' });
  const form = h('form', { class: 'cc-ai-composer', 'aria-label': 'Ask Stark AI' },
    label, input,
    h('div', { class: 'cc-ai-composer-row' }, h('div', { class: 'cc-ai-composer-info' }, hint, count), send)
  );
  form.setAttribute('novalidate', '');

  let lastState = null;

  const overBy = () => Math.max(0, input.value.trim().length - max);
  const blank = () => input.value.trim().length === 0;

  function refreshCount() {
    const n = input.value.length;
    const over = overBy();
    if (n >= max * COUNT_FROM_RATIO) {
      count.hidden = false;
      count.textContent = over > 0
        ? fmt(n) + ' / ' + fmt(max) + ' — too long: remove ' + fmt(over) + ' character' + (over === 1 ? '' : 's') + '.'
        : fmt(n) + ' / ' + fmt(max);
      count.classList.toggle('is-over', over > 0);
    } else {
      count.hidden = true;
      count.textContent = '';
      count.classList.remove('is-over');
    }
    input.setAttribute('aria-invalid', over > 0 ? 'true' : 'false');
    const lines = Math.min(6, Math.max(2, input.value.split('\n').length));
    input.rows = lines;
  }

  function refreshSend() {
    const s = lastState;
    const usable = !!(s && s.enabled && s.canSend);
    send.disabled = !usable || blank() || overBy() > 0;
    input.disabled = !(s && s.enabled) || (s && s.context.page === 'prospect' && !s.context.prospectId);
  }

  function submit() {
    if (blank() || overBy() > 0) return false;
    const text = input.value;
    const pending = ai.send(text);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    // Only forget the text if the question was actually accepted (a refused one, e.g. "wait a moment", keeps your words).
    if (ai.getState().sending) {
      input.value = '';
      refreshCount();
      refreshSend();
      return true;
    }
    return false;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();       // Enter sends; Shift+Enter keeps its normal "new line" behaviour
    if (!send.disabled) submit();
  });

  input.addEventListener('input', () => {
    refreshCount();
    refreshSend();
  });

  function render(state) {
    lastState = state;
    refreshCount();
    refreshSend();
    if (!state.enabled) hint.textContent = 'Stark AI is turned off.';
    else if (state.context.page === 'prospect' && !state.context.prospectId) hint.textContent = 'Open a prospect from the Prospects list to ask about it.';
    else hint.textContent = 'Enter to send · Shift+Enter for a new line';
  }

  return {
    element: form,
    input: input,
    render: render,
    focus: () => { if (!input.disabled) input.focus({ preventScroll: true }); },
    reset: () => { input.value = ''; refreshCount(); refreshSend(); },
    submit: submit,
    announce: announce
  };
}
