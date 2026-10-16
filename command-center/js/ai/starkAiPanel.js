// Stark AI panel: the right-hand panel (desktop) / full-screen sheet (phones and tablets).
//
// WHAT THIS FILE DOES: it draws the panel and handles opening, closing, focus and the Clear button.
// WHAT IT DOES NOT DO: it never talks to the network, to Supabase or to Anthropic. Every question goes through the
// approved controller (starkAi.js), which this file receives as `options.ai`. The panel only displays what
// ai.getState() says and calls ai.send / sendQuickPrompt / retry / cancel / clear.
//
// SAFETY: every element is built with the safe h() helper (text nodes only). No innerHTML anywhere. AI text is drawn by
// renderReply() (paragraphs and "- " lists, nothing else). The panel is only created when STARK_AI.enabled is true; with
// the flag off the router never builds it, so there is no button, no panel and no request.
//
// LAYOUT: the panel is a UI state, not a URL route. Desktop >= 1200px: a third grid column beside the page (the page
// keeps working). 961-1199px: it overlays the right edge (the page keeps its width). <= 960px: a full-screen sheet and
// the page behind it is made inert.
//
// FOCUS: opening moves focus into the panel (the question box on desktop; the panel title on touch layouts so the
// on-screen keyboard does not jump up). Closing returns focus to the button that opened it. Escape closes the panel when
// focus is inside it (or when it is a full-screen sheet). It is a normal tab order: there is no focus trap, the
// full-screen sheet simply makes everything behind it inert.

import { h } from '../dom.js';
import { createMessages, createAlerts } from './starkAiMessages.js';
import { createComposer, createQuickPrompts } from './starkAiComposer.js';

const SHEET_QUERY = '(max-width: 960px)';
const WELCOME = 'Ask about your pipeline, prospects, activity, or what needs your attention.';
// What is sent, in plain words (kept in step with the server: your question and the earlier turns of THIS conversation; for
// a prospect question that prospect's record; contact name and the 2 newest message texts only with drafts, call preparation
// and open questions; email addresses and phone numbers are never sent as fields, and a pattern filter removes them from free
// text but it is NOT a guarantee (names, signatures and street addresses are not filtered); other pages send a dashboard
// summary that includes company names).
const WELCOME_NOTE = 'Stark AI is read-only: it cannot send, approve or change anything. To answer, it shares information with an AI service (Anthropic): your question, the earlier messages in this conversation, and the CRM details it needs. For a question about one prospect, that is the prospect\'s record: company details, status, notes, recent activity, and message subjects and dates. Drafts, call preparation and open questions also include the contact\'s name and the text of the 2 newest messages. Email addresses and phone numbers are not sent as fields, and an automatic filter removes them from free text such as notes and messages, but it can miss unusual formats, and names, signatures and street addresses are not filtered. On other pages it shares a dashboard summary that includes company names. Answers can be wrong, so check important details in the CRM.';

export function createStarkAiPanel(options) {
  const ai = options.ai;
  let open = false;
  let trigger = null;
  let extraTriggers = [];
  let confirming = false;
  let listeners = [];
  let unsubscribe = null;
  let sheet = false;
  let lastCount = 0;
  let lastSending = false;
  let lastErrorSig = '';
  let destroyed = false;

  // ----- sr-only live region (polite) for "working", "cancelled", "cleared" -----
  const statusRegion = h('div', { class: 'cc-sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  let announceTimer = null;
  function announce(text) {
    // Clear first so repeating the same sentence is announced again.
    statusRegion.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { statusRegion.textContent = text; announceTimer = null; }, 30);
  }

  // ----- header -----
  const title = h('h2', { class: 'cc-ai-title', id: 'cc-ai-title', tabindex: '-1', text: 'STARK AI' });
  const clearBtn = h('button', { type: 'button', class: 'cc-btn cc-ai-clear', text: 'Clear', 'aria-label': 'Clear conversation' });
  const closeBtn = h('button', { type: 'button', class: 'cc-btn cc-ai-close', text: 'Close', 'aria-label': 'Close Stark AI' });

  const contextName = h('span', { class: 'cc-ai-context-name' });
  const contextTag = h('span', { class: 'cc-badge cc-badge-type cc-ai-context-tag', text: 'Prospect', hidden: true });
  const context = h('p', { class: 'cc-ai-context' },
    h('span', { class: 'cc-ai-context-label', text: 'Asking about' }), contextName, contextTag);

  const confirmText = h('span', { class: 'cc-ai-confirm-text', id: 'cc-ai-confirm-text', text: 'Clear this conversation? It cannot be undone.' });
  const confirmYes = h('button', { type: 'button', class: 'cc-btn cc-btn-danger cc-ai-confirm-yes', text: 'Clear conversation' });
  const confirmNo = h('button', { type: 'button', class: 'cc-btn cc-ai-confirm-no', text: 'Keep' });
  const confirmRow = h('div', { class: 'cc-ai-confirm', role: 'group', 'aria-labelledby': 'cc-ai-confirm-text', hidden: true },
    confirmText, h('span', { class: 'cc-ai-confirm-actions' }, confirmNo, confirmYes));

  const header = h('header', { class: 'cc-ai-head' },
    h('div', { class: 'cc-ai-head-top' },
      h('div', { class: 'cc-ai-titles' }, title, h('p', { class: 'cc-ai-sub', text: 'Read-only business copilot' })),
      h('div', { class: 'cc-ai-head-actions' }, clearBtn, closeBtn)
    ),
    context,
    confirmRow
  );

  // ----- body -----
  const messages = createMessages({ announce: announce });
  const alerts = createAlerts({ ai: ai, announce: announce });
  const welcomeChips = createQuickPrompts({ ai: ai, label: 'Suggested questions' });
  const moreChips = createQuickPrompts({ ai: ai, label: 'More suggested questions' });
  const welcomeText = h('p', { class: 'cc-ai-welcome-text', text: WELCOME });
  const welcomeNote = h('p', { class: 'cc-ai-welcome-note', text: WELCOME_NOTE });
  const welcome = h('div', { class: 'cc-ai-welcome' }, welcomeText, welcomeChips.element, welcomeNote);
  const body = h('div', { class: 'cc-ai-body', id: 'cc-ai-body' }, welcome, messages.element, alerts.element);

  const more = h('details', { class: 'cc-ai-more', hidden: true },
    h('summary', { class: 'cc-ai-more-summary', text: 'Suggested questions' }), moreChips.element);

  const composer = createComposer({ ai: ai, announce: announce });

  const element = h('aside', { class: 'cc-ai-panel', id: 'cc-ai-panel', 'aria-labelledby': 'cc-ai-title', hidden: true },
    header, body, more, composer.element, statusRegion);

  // ----- roles: a companion panel on desktop, a modal dialog as a full-screen sheet -----
  function applyRole() {
    if (sheet) {
      element.setAttribute('role', 'dialog');
      element.setAttribute('aria-modal', 'true');
    } else {
      element.setAttribute('role', 'complementary');
      element.removeAttribute('aria-modal');
    }
  }

  // ----- change notifications (the shell listens: buttons, drawer, inert, scroll lock) -----
  function emit() {
    listeners.slice().forEach((fn) => { try { fn({ open: open, sheet: sheet }); } catch (e) { /* ignore */ } });
  }
  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return () => { listeners = listeners.filter((x) => x !== fn); };
  }

  // ----- viewport mode -----
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(SHEET_QUERY) : null;
  sheet = !!(mq && mq.matches);
  applyRole();
  const onMq = (event) => {
    sheet = !!event.matches;
    applyRole();
    emit();
  };
  if (mq) {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMq);
    else if (typeof mq.addListener === 'function') mq.addListener(onMq);
  }

  // ----- rendering -----
  function nearBottom() {
    return body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  }
  function scrollToEnd() { body.scrollTop = body.scrollHeight; }

  function renderContext(state) {
    const c = state.context;
    contextTag.hidden = true;
    if (c.page === 'prospect') {
      if (!c.prospectId) {
        contextName.textContent = 'Unknown prospect';
      } else {
        contextName.textContent = c.prospectLabel || 'This prospect';
        contextTag.hidden = false;
      }
    } else {
      contextName.textContent = c.pageLabel;
    }
  }

  function render() {
    if (destroyed) return;
    const state = ai.getState();
    const stick = nearBottom();

    renderContext(state);

    const hasMessages = state.messages.length > 0;
    const somethingToClear = hasMessages || !!state.error || !!state.retry;
    clearBtn.disabled = !somethingToClear;
    if (!somethingToClear && confirming) setConfirming(false, false);

    // Welcome (empty conversation) versus the compact "Suggested questions" box (after the first message).
    welcome.hidden = hasMessages;
    welcomeText.textContent = state.enabled ? WELCOME : 'Stark AI is turned off.';
    welcomeNote.hidden = !state.enabled;
    welcomeChips.render(state);
    moreChips.render(state);
    more.hidden = !(hasMessages && moreChips.hasButtons());

    const shown = messages.render(state);
    alerts.render(state);
    composer.render(state);

    // Where to scroll: a new question goes to the bottom; a new answer starts at its own first line (so a long answer is
    // read from the top, not dropped at its end); sending / a new error stays pinned to the bottom when you were there.
    const addedAi = shown.added.filter((m) => m.role === 'assistant').pop();
    const addedUser = shown.added.filter((m) => m.role === 'user').pop();
    if (addedAi) {
      const node = shown.nodeFor(addedAi.id);
      if (node) body.scrollTop = Math.max(0, node.offsetTop - 8);
    } else if (addedUser) {
      scrollToEnd();
    } else if ((state.sending && !lastSending) || stick) {
      scrollToEnd();
    }
    const errorSig = state.error ? state.error.code : '';
    if (errorSig && errorSig !== lastErrorSig) scrollToEnd();
    lastErrorSig = errorSig;
    lastSending = state.sending;
    lastCount = state.messages.length;
  }

  // ----- Clear conversation (two steps, inline, no dialog) -----
  function setConfirming(on, moveFocus) {
    confirming = on;
    confirmRow.hidden = !on;
    clearBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on && moveFocus !== false) confirmNo.focus(); // the safe choice is the one focused
    if (!on && moveFocus === true) clearBtn.focus();
  }
  clearBtn.setAttribute('aria-expanded', 'false');
  clearBtn.setAttribute('aria-controls', 'cc-ai-confirm-row');
  confirmRow.setAttribute('id', 'cc-ai-confirm-row');
  clearBtn.addEventListener('click', () => setConfirming(!confirming, true));
  confirmNo.addEventListener('click', () => setConfirming(false, true));
  confirmYes.addEventListener('click', () => {
    setConfirming(false, false);
    ai.clear();                 // wipes messages, error, retry snapshot and in-flight request; keeps the page and the sign-in
    composer.reset();
    announce('Conversation cleared.');
    if (!composer.input.disabled) composer.focus();
    else title.focus({ preventScroll: true });
  });

  // ----- open / close -----
  function focusTrigger() {
    const candidates = [trigger].concat(extraTriggers).filter(Boolean);
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (!el.isConnected) continue;
      el.focus({ preventScroll: true });
      if (document.activeElement === el) return;
    }
  }

  function onDocKeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const inside = element.contains(document.activeElement);
    if (!inside && !sheet) return;      // desktop: Escape elsewhere on the page is not ours
    event.preventDefault();
    if (confirming) { setConfirming(false, true); return; }
    close(true);
  }

  function openPanel(from) {
    if (destroyed || open) return;
    if (!ai.getState().enabled) return;
    open = true;
    if (from) trigger = from;
    element.hidden = false;
    document.addEventListener('keydown', onDocKeydown);
    render();
    scrollToEnd();
    emit();
    // Desktop: straight to the question box. Touch layouts: the title, so the keyboard does not cover the sheet.
    if (!sheet && !composer.input.disabled) composer.focus();
    else title.focus({ preventScroll: true });
  }

  function close(returnFocus) {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onDocKeydown);
    setConfirming(false, false);
    element.hidden = true;
    emit();
    if (returnFocus !== false) focusTrigger();
  }

  function toggle(from) {
    if (open) close(true);
    else openPanel(from);
  }

  closeBtn.addEventListener('click', () => close(true));

  unsubscribe = ai.subscribe(render);
  render();

  return {
    element: element,
    open: openPanel,
    close: close,
    toggle: toggle,
    isOpen: () => open,
    isSheet: () => sheet,
    onChange: onChange,
    /** The buttons that can open the panel (focus goes back to the one that did; the others are the fallback). */
    setTriggers(list) { extraTriggers = Array.isArray(list) ? list.filter(Boolean) : []; },
    announce: announce,
    destroy() {
      if (destroyed) return;
      close(false);
      destroyed = true;
      if (unsubscribe) unsubscribe();
      if (announceTimer) clearTimeout(announceTimer);
      if (mq) {
        if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMq);
        else if (typeof mq.removeListener === 'function') mq.removeListener(onMq);
      }
      listeners = [];
      if (element.parentNode) element.parentNode.removeChild(element);
    }
  };
}
