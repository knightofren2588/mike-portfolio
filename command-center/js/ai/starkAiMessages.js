// Stark AI panel: the conversation, the "working" row, the error, and the "Retry previous request" box.
//
// Everything here is built with the safe h() helper (text nodes only). AI replies go through renderReply(), which turns
// plain text into paragraphs and "- " lists and nothing else: no HTML, no Markdown, no links, no images.
//
// Messages are drawn INCREMENTALLY (one cached element per message id) so a screen reader announces only what is new,
// never the whole conversation again.

import { h, clear } from '../dom.js';
import { renderReply, isDraftReply, extractEmail } from './renderReply.js';

const FLAG_NOTES = {
  blocked: 'Outreach was blocked for this prospect.',
  refused: 'Stark AI declined to answer this.',
  truncated: 'This reply was shortened.'
};

const COPY_LABEL = 'Copy email';

/** Copy text to the clipboard (the browser's own clipboard; no network). Returns true if it worked. */
async function copyToClipboard(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* denied or unavailable: reported to the user below */ }
  return false;
}

function buildMessage(m, announce) {
  const isUser = m.role === 'user';
  // Which prospect this question or answer was about (display only), so an answer about one company is never mistaken
  // for an answer about the one you are looking at now.
  const about = m.label ? h('span', { class: 'cc-ai-about', text: '· ' + m.label }) : null;
  const draft = !isUser && !m.blocked && !m.refused && isDraftReply(m.text);
  const who = h('div', { class: 'cc-ai-who-row' },
    h('span', { class: 'cc-ai-who', text: isUser ? 'You' : 'Stark AI' }),
    about,
    draft ? h('span', { class: 'cc-ai-draft-tag', text: 'Draft, not sent' }) : null
  );
  const body = isUser
    ? h('div', { class: 'cc-ai-text', text: m.text })
    : h('div', { class: 'cc-ai-reply' }, renderReply(m.text));
  const notes = h('div', { class: 'cc-ai-notes' });
  const parts = [who, body];

  // "Copy email": the subject, body and signature, WITHOUT the review line. It only copies text. Nothing is sent, approved or
  // saved anywhere. A shortened (truncated) draft is never offered for copying.
  const email = draft && !m.truncated ? extractEmail(m.text) : '';
  if (email) {
    const button = h('button', { type: 'button', class: 'cc-btn cc-ai-copy', text: COPY_LABEL });
    let timer = null;
    button.addEventListener('click', async () => {
      const ok = await copyToClipboard(email);
      if (timer) clearTimeout(timer);
      button.textContent = ok ? 'Copied' : 'Could not copy';
      announce(ok ? 'Email copied. Nothing has been sent.' : 'Could not copy. Select the text and copy it yourself.');
      timer = setTimeout(() => { button.textContent = COPY_LABEL; timer = null; }, 2500);
    });
    parts.push(h('div', { class: 'cc-ai-actions' }, button));
  }
  parts.push(notes);

  const node = h('li', { class: 'cc-ai-msg ' + (isUser ? 'cc-ai-msg-user' : 'cc-ai-msg-ai'), 'data-id': m.id }, parts);
  node.__notes = notes;
  node.__sig = null;
  return node;
}

function updateMessage(node, m) {
  const sig = [m.state, m.blocked, m.refused, m.truncated].join('|');
  if (node.__sig === sig) return;
  node.__sig = sig;
  node.classList.toggle('is-pending', m.state === 'pending');
  node.classList.toggle('is-failed', m.state === 'failed');
  clear(node.__notes);
  const lines = [];
  if (m.role === 'user' && m.state === 'pending') lines.push('Sending…');
  if (m.role === 'user' && m.state === 'failed') lines.push('Not answered.');
  if (m.role === 'assistant') {
    if (m.blocked) lines.push(FLAG_NOTES.blocked);
    if (m.refused) lines.push(FLAG_NOTES.refused);
    if (m.truncated) lines.push(FLAG_NOTES.truncated);
  }
  lines.forEach((line) => node.__notes.appendChild(h('p', { class: 'cc-ai-note', text: line })));
}

/** The scrolling conversation (without the welcome block). */
export function createMessages(options) {
  const announce = (options && options.announce) || (() => {});
  const list = h('ol', { class: 'cc-ai-list', role: 'log', 'aria-label': 'Conversation', 'aria-live': 'polite', 'aria-relevant': 'additions' });
  const nodes = new Map();

  /** Returns what was added so the panel can decide where to scroll: { added: [message...] }. */
  function render(state) {
    const ids = new Set(state.messages.map((m) => m.id));
    nodes.forEach((node, id) => {
      if (!ids.has(id)) { node.remove(); nodes.delete(id); }
    });
    const added = [];
    let prev = null;
    state.messages.forEach((m) => {
      let node = nodes.get(m.id);
      if (!node) {
        node = buildMessage(m, announce);
        nodes.set(m.id, node);
        added.push(m);
      }
      updateMessage(node, m);
      const expected = prev ? prev.nextSibling : list.firstChild;
      if (node !== expected) list.insertBefore(node, expected);
      prev = node;
    });
    return { added: added, nodeFor: (id) => nodes.get(id) || null };
  }

  return { element: list, render: render, count: () => nodes.size };
}

function contextLabelOf(retry) {
  if (retry.page === 'prospect') return retry.prospectLabel || 'Prospect';
  return retry.pageLabel;
}

/**
 * The status area under the conversation:
 *   "Working on your question…" + Cancel      (while a question is running)
 *   the normalised error (a short, client-written sentence; never server text)
 *   "Previous request failed." + "Retry previous request · <where it will be asked>"
 * The retry wording comes from getState().retry (the Step 2 snapshot), never from the page you are looking at now.
 */
export function createAlerts(options) {
  const ai = options.ai;
  const announce = options.announce || (() => {});

  const working = h('div', { class: 'cc-ai-working', hidden: true },
    h('span', { class: 'cc-ai-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'cc-ai-working-text', text: 'Working on your question…' }),
    h('button', { type: 'button', class: 'cc-btn cc-ai-cancel', text: 'Cancel' })
  );
  const workingText = working.querySelector('.cc-ai-working-text');
  const cancelBtn = working.querySelector('.cc-ai-cancel');
  cancelBtn.addEventListener('click', () => {
    ai.cancel();
    announce('Cancelled.');
  });

  const errorHost = h('div', { class: 'cc-ai-error-host' });
  const retryHost = h('div', { class: 'cc-ai-retry-host' });
  const element = h('div', { class: 'cc-ai-alerts' }, working, errorHost, retryHost);
  let errorSig = '';
  let retrySig = '';
  let wasSending = false;

  function renderError(state) {
    const sig = state.error ? state.error.code + '|' + state.error.message : '';
    if (sig === errorSig) return;
    errorSig = sig;
    clear(errorHost);
    if (state.error) {
      errorHost.appendChild(h('div', { class: 'cc-notice cc-notice-error cc-ai-error', role: 'alert', text: state.error.message }));
    }
  }

  function renderRetry(state) {
    const r = state.retry;
    // Only offer Retry when trying again can reasonably work (a 'not allowed' or 'session expired' error will not).
    const show = !!(r && state.enabled && !state.sending && state.canRetry && r.errorRetryable);
    const sig = show ? [r.messageId, r.sameContext, r.page, r.prospectLabel, r.errorCode].join('|') : '';
    if (sig === retrySig) return;
    retrySig = sig;
    clear(retryHost);
    if (!show) return;

    const where = contextLabelOf(r);
    const headline = r.errorCode === 'aborted' ? 'Previous request was cancelled.' : 'Previous request failed.';
    const button = h('button', { type: 'button', class: 'cc-btn cc-btn-primary cc-ai-retry-btn' },
      'Retry previous request', h('span', { class: 'cc-ai-retry-where', text: ' · ' + where }));
    button.addEventListener('click', () => {
      announce('Retrying the previous request.');
      ai.retry();
    });
    retryHost.appendChild(h('div', { class: 'cc-ai-retry' },
      h('p', { class: 'cc-ai-retry-title', text: headline }),
      h('p', { class: 'cc-ai-retry-q', text: r.question }),
      r.sameContext ? null : h('p', { class: 'cc-ai-retry-note', text: 'This will ask about ' + where + ' again, not the page you are viewing now.' }),
      button
    ));
  }

  function render(state) {
    working.hidden = !state.sending;
    // A question you asked on another prospect/page is still running: say so, without showing what it was.
    workingText.textContent = state.workingElsewhere
      ? 'Still working on your question about ' + state.workingElsewhere + '…'
      : 'Working on your question…';
    if (state.sending && !wasSending) announce('Stark AI is working on your question.');
    wasSending = state.sending;
    renderError(state);
    renderRetry(state);
  }

  return { element: element, render: render };
}
