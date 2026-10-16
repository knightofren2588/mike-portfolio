// Stark AI: the controller. It ties the pieces together and owns the "what is happening right now" state.
//
//   page context  ->  quick prompts for that page
//   a question    ->  checks (no network) -> history -> minimised summary -> ONE call to the function -> reply
//
// The UI (Step 3) will only ever call the methods returned here and render getState(). It never talks to the function
// or to the data layer itself.
//
// SAFETY RULES BUILT IN
//  - Disabled (config.enabled !== true): every question returns { code:'disabled' } and NOTHING is requested.
//  - One question at a time. A second send while one is running is refused (duplicate-submit protection), and a short
//    cooldown follows each answer.
//  - Nothing is stored anywhere but this object's memory. reset() (session end) and clear() wipe it.
//  - A late answer that arrives after reset / clear / cancel is thrown away, never shown.
//  - The conversation, the prospect label, errors and the pending request all disappear on reset().
//  - READ-ONLY: this file has no way to write to the CRM. It cannot approve, reject, send or edit anything.

import { createStarkAiClient, makeError } from './starkAiClient.js';
import { createConversation } from './starkAiState.js';
import { detectContext, describeContext, buildSummary, sectionsFor, cleanLabel, isUuid } from './starkAiContext.js';
import { promptsForPage, findPrompt, PROSPECT_INTENTS, PAGE_LABELS } from './starkAiPrompts.js';
import { createRetryStore } from './starkAiRetry.js';

const DEFAULT_CONTEXT = Object.freeze({ page: 'overview', prospectId: null });

export function createStarkAi(deps) {
  const d = deps || {};
  const config = d.config;
  const getInsightsData = d.getInsightsData;           // async () => the Phase 3B insights object (may throw)
  const now = d.now || (() => Date.now());
  const onAuthExpired = typeof d.onAuthExpired === 'function' ? d.onAuthExpired : null;

  const client = createStarkAiClient({
    invoke: d.invoke, config: config, now: now, setTimer: d.setTimer, clearTimer: d.clearTimer, uuid: d.uuid
  });
  const retryStore = d.retryStore || createRetryStore();   // memory only; injectable so tests can inspect it
  const conversation = createConversation({
    storedMessagesMax: config.storedMessagesMax,
    historyMaxEntries: config.historyMaxEntries,
    historyEntryChars: config.historyEntryChars,
    historyTotalChars: config.historyTotalChars
  });

  let context = { page: DEFAULT_CONTEXT.page, prospectId: DEFAULT_CONTEXT.prospectId };
  let prospectLabel = '';
  let sending = false;
  let error = null;          // { code, message, retryable, retryAfterMs } | null
  let errorKey = null;       // which conversation the error belongs to (see keyOf)
  let generation = 0;        // bumped by cancel / clear / reset: an answer from an older generation is discarded
  let listeners = [];

  // ----- notifications -----
  function notify() {
    listeners.slice().forEach((fn) => {
      try { fn(); } catch (e) { /* a broken listener must not break the others */ }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.push(fn);
    return () => { listeners = listeners.filter((x) => x !== fn); };
  }

  // ----- which conversation is on screen -----
  // Every message belongs to ONE conversation: a prospect (its id) or "dashboard" (everything that is not about one
  // prospect). The panel only ever shows the conversation you are looking at, so a draft for Prospect A can never sit
  // under Prospect B. Switching back restores the earlier conversation (it stays in memory only).
  const keyOf = (page, prospectId) => (page === 'prospect' ? (prospectId ? 'p:' + prospectId : 'none') : 'g');
  const currentKey = () => keyOf(context.page, context.prospectId);
  const messageKey = (m) => (m.scope ? 'p:' + m.scope : 'g');

  // ----- state for the UI -----
  function quickPrompts() {
    if (!client.isEnabled()) return [];
    if (context.page === 'prospect' && !context.prospectId) return [];
    return promptsForPage(context.page).slice();
  }

  function getState() {
    const enabled = client.isEnabled();
    const key = currentKey();
    const retryInfo = describeRetry();
    const retryHere = !!(retryInfo && retryInfo.sameConversation);
    const elsewhere = !!(sending && active && keyOf(active.request.page, active.request.prospectId) !== key);
    return {
      enabled: enabled,
      service: client.serviceState(),
      sending: sending,
      // a question still running for ANOTHER conversation (the one you navigated away from)
      workingElsewhere: elsewhere ? (active.request.page === 'prospect' ? (active.request.prospectLabel || 'another prospect') : PAGE_LABELS[active.request.page]) : '',
      error: error && errorKey === key ? Object.assign({}, error) : null,
      messages: conversation.list().filter((m) => messageKey(m) === key),
      context: describeContext(context, prospectLabel),
      quickPrompts: quickPrompts(),
      canRetry: enabled && !sending && retryHere,
      retry: retryHere ? retryInfo : null,
      canSend: enabled && !sending && !(context.page === 'prospect' && !context.prospectId)
    };
  }

  function setError(err, key) {
    errorKey = key || currentKey();
    error = { code: err.code, message: err.message, retryable: !!err.retryable, retryAfterMs: err.retryAfterMs || 0 };
  }

  // ----- context -----
  function setContext(next) {
    const c = next || {};
    const page = Object.prototype.hasOwnProperty.call(PAGE_LABELS, c.page) ? c.page : 'overview';
    const prospectId = page === 'prospect' && isUuid(c.prospectId) ? c.prospectId.toLowerCase() : null;
    applyContext({ page: page, prospectId: prospectId });
  }

  function setContextFromHash(hash) {
    applyContext(detectContext(hash));
  }

  function applyContext(next) {
    const changed = next.page !== context.page || next.prospectId !== context.prospectId;
    context = { page: next.page, prospectId: next.prospectId };
    if (changed) {
      prospectLabel = '';
      error = null; // an old page's message should not follow you to a new page
      notify();
    }
  }

  /** The company name for the prospect page (display only; supplied by the view that already loaded it). */
  function setProspectLabel(label) {
    const next = context.page === 'prospect' ? cleanLabel(label, 80) : '';
    if (next !== prospectLabel) {
      prospectLabel = next;
      notify();
    }
  }

  // ----- sending -----
  function rejectEarly(code, extra) {
    const err = makeError(code, extra);
    if (code !== 'disabled' && code !== 'busy') {
      setError(err);
      notify();
    }
    return err;
  }

  // The request being worked on right now (kept so cancel() can keep it retryable). Memory only.
  let active = null; // { request, messageId }

  /** What the UI may know about the retryable request (no history, no summary). */
  function describeRetry() {
    const snap = retryStore.get();
    if (!snap) return null;
    return {
      messageId: snap.messageId,
      question: snap.message,
      intent: snap.intent,
      promptId: snap.promptId,
      page: snap.page,
      pageLabel: PAGE_LABELS[snap.page],
      prospectId: snap.prospectId,
      prospectLabel: snap.prospectLabel,
      sameContext: snap.page === context.page && snap.prospectId === context.prospectId,
      sameConversation: keyOf(snap.page, snap.prospectId) === currentKey(),
      errorCode: snap.errorCode,
      errorRetryable: snap.errorRetryable
    };
  }

  async function send(text, options) {
    const opts = options || {};
    if (!client.isEnabled()) return makeError('disabled');   // nothing requested, nothing changed
    if (sending || client.isBusy()) return rejectEarly('busy');

    const page = context.page;
    const prospectId = context.prospectId;
    if (page === 'prospect' && !prospectId) return rejectEarly('no_prospect');

    // Quick prompt: the TEXT and INTENT come from our own definition, never from the caller.
    let intent = 'free';
    let promptId = null;
    let question = text;
    if (opts.promptId) {
      const prompt = findPrompt(page, opts.promptId);
      if (!prompt) return rejectEarly('bad_context');
      intent = prompt.intent;
      promptId = prompt.id;
      question = prompt.text;
    }
    if (PROSPECT_INTENTS.indexOf(intent) !== -1 && !prospectId) return rejectEarly('no_prospect');

    // Validate the question itself (empty / too long / bad page) BEFORE touching the conversation.
    const check = client.buildChatPayload({ message: question, intent: intent, page: page, prospectId: prospectId, history: [], insights: null });
    if (check.error) return rejectEarly(check.error);

    const wait = client.cooldownRemainingMs();
    if (wait > 0) return rejectEarly('cooldown', { retryAfterMs: wait });

    const scope = page === 'prospect' ? prospectId : null;
    return run({
      message: check.body.message, intent: intent, promptId: promptId, page: page, prospectId: prospectId,
      history: conversation.historyFor(scope),         // computed BEFORE the new question is added
      insights: null,
      summaryPending: !scope && sectionsFor(intent, page).length > 0 && typeof getInsightsData === 'function',
      prospectLabel: scope ? prospectLabel : ''
    }, null);
  }

  /**
   * Run ONE request exactly as described by `request` (it already holds its page, prospect id, history and summary).
   * Used for new questions and for retries, so a retry can never pick up the page you are looking at now.
   */
  async function run(request, replaceId) {
    const scope = request.page === 'prospect' ? request.prospectId : null;
    if (replaceId) conversation.remove(replaceId);
    retryStore.clear();   // a newer request makes any older failed request obsolete
    const q = conversation.add({
      role: 'user', text: request.message, scope: scope, state: 'pending', intent: request.intent, promptId: request.promptId,
      page: request.page, prospectId: request.prospectId, label: scope ? request.prospectLabel : '', at: now()
    });
    const myGeneration = generation;
    active = { request: request, messageId: q.id };
    sending = true;
    error = null;
    notify();

    const failWith = (err) => {
      conversation.update(q.id, { state: 'failed', errorCode: err.code });
      retryStore.set(request, { messageId: q.id, errorCode: err.code, errorRetryable: err.retryable });
      active = null;
      sending = false;
      setError(err, keyOf(request.page, request.prospectId));
      notify();
      if (err.authExpired && onAuthExpired) {
        try { onAuthExpired(); } catch (e) { /* ignore */ }
      }
      return err;
    };
    const stale = () => ({ ok: false, code: 'aborted', discarded: true });

    // The operations summary (never for a question about one prospect: the server loads that record itself).
    if (request.summaryPending && typeof getInsightsData === 'function') {
      try {
        const data = await getInsightsData();
        if (generation !== myGeneration) return stale();
        request.insights = buildSummary(data, { intent: request.intent, page: request.page });
        request.summaryPending = false;
      } catch (e) {
        if (generation !== myGeneration) return stale();
        if (request.intent !== 'free') return failWith(makeError('data_unavailable'));
        request.insights = null; // a free-form question can still be answered without the dashboard summary
        request.summaryPending = false;
      }
    }
    if (generation !== myGeneration) return stale();

    const result = await client.ask({
      message: request.message, intent: request.intent, page: request.page, prospectId: request.prospectId,
      history: request.history, insights: request.insights
    });
    if (generation !== myGeneration) return stale();   // reset / clear / cancel happened while we waited

    if (!result.ok) return failWith(result);

    conversation.update(q.id, { state: 'ok' });
    conversation.add({
      role: 'assistant', text: result.reply, scope: scope, state: 'ok', replyTo: q.id, intent: request.intent, page: request.page,
      prospectId: request.prospectId, label: scope ? request.prospectLabel : '', blocked: result.blocked, truncated: result.truncated, refused: result.refused,
      requestId: result.requestId, at: now()
    });
    retryStore.clear();
    active = null;
    sending = false;
    error = null;
    notify();
    return { ok: true, reply: result.reply, blocked: result.blocked, truncated: result.truncated, refused: result.refused };
  }

  function sendQuickPrompt(id) {
    return send('', { promptId: id });
  }

  /**
   * "Retry previous request": replays the ORIGINAL failed request (its own page, prospect id, history and summary),
   * whatever page you are on now. The server reloads the prospect from the database using the original prospect id.
   */
  function retry() {
    if (!client.isEnabled()) return Promise.resolve(makeError('disabled'));
    if (sending || client.isBusy()) return Promise.resolve(rejectEarly('busy'));
    const snap = retryStore.get();
    if (!snap) return Promise.resolve(makeError('bad_context'));   // nothing to retry
    const wait = client.cooldownRemainingMs();
    if (wait > 0) return Promise.resolve(rejectEarly('cooldown', { retryAfterMs: wait }));
    return run({
      message: snap.message, intent: snap.intent, promptId: snap.promptId, page: snap.page, prospectId: snap.prospectId,
      history: snap.history.map((e) => ({ role: e.role, text: e.text })),
      insights: snap.insights ? JSON.parse(JSON.stringify(snap.insights)) : null,
      summaryPending: snap.summaryPending,
      prospectLabel: snap.prospectLabel
    }, snap.messageId);
  }

  // ----- stopping / clearing -----
  function stopInFlight() {
    generation++;
    client.cancel();
  }

  /** Stop waiting for the current answer. The question stays in the conversation as "failed" and can be retried. */
  function cancel() {
    if (!sending) return;
    stopInFlight();
    const pending = conversation.list().filter((m) => m.state === 'pending');
    pending.forEach((m) => conversation.update(m.id, { state: 'failed', errorCode: 'aborted' }));
    if (active) {
      const cancelled = makeError('aborted');
      retryStore.set(active.request, { messageId: active.messageId, errorCode: cancelled.code, errorRetryable: cancelled.retryable });
    }
    const cancelledKey = active ? keyOf(active.request.page, active.request.prospectId) : currentKey();
    active = null;
    sending = false;
    setError(makeError('aborted'), cancelledKey);
    notify();
  }

  /**
   * The "Clear conversation" button: forgets the conversation you are looking at (its messages, its retry snapshot, and a
   * request still running for it). Other prospects' conversations are not touched. Keeps the page context.
   */
  function clear() {
    const key = currentKey();
    if (active && keyOf(active.request.page, active.request.prospectId) === key) {
      stopInFlight();
      active = null;
      sending = false;
    }
    conversation.removeWhere((m) => messageKey(m) === key);
    const snap = retryStore.get();
    if (snap && keyOf(snap.page, snap.prospectId) === key) retryStore.clear();
    error = null;
    notify();
  }

  /** Session end (sign-out, idle timeout, expired session): forget EVERYTHING, including context and listeners. */
  function reset() {
    stopInFlight();
    client.reset();
    conversation.clear();
    retryStore.clear();
    active = null;
    context = { page: DEFAULT_CONTEXT.page, prospectId: DEFAULT_CONTEXT.prospectId };
    prospectLabel = '';
    sending = false;
    error = null;
    notify();
    listeners = [];
  }

  async function checkService() {
    const result = await client.ping();
    notify();
    return result;
  }

  return {
    getState, subscribe, setContext, setContextFromHash, setProspectLabel, quickPrompts,
    send, sendQuickPrompt, retry, cancel, clear, reset, checkService,
    cooldownRemainingMs: () => client.cooldownRemainingMs()
  };
}
