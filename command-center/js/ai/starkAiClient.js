// Stark AI: the function-call wrapper for the Supabase Edge Function "stark-ai".
//
// SAFETY
//  - While config.enabled is false this file makes NO network request of any kind. ask() and ping() return
//    { ok:false, code:'disabled' } immediately and invoke() is never called. There is no "online" state while disabled.
//  - It is the ONLY place that calls the function, and it only ever calls `invoke(functionName, { body, signal })`.
//    In the real app `invoke` is the Supabase client's functions.invoke, which attaches the signed-in user's own token.
//    This file never sets an Authorization header and never sees a key.
//  - It cannot write to the database: there is no insert/update/delete/rpc anywhere in the AI client code.
//  - Every failure is turned into a small, friendly, client-owned message. Server error text is never shown.
//
// TESTING: createStarkAiClient takes its dependencies as arguments, so a test passes a fake `invoke`, a fake clock and
// fake timers. Nothing here touches the real network or real time unless you let it.

import { PROSPECT_INTENTS } from './starkAiPrompts.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_VERSION = 1;

const INTENTS = [
  'free', 'overview_attention', 'sales_brief', 'work_next',
  'prospect_summary', 'prospect_next_step', 'prospect_followup', 'call_prep',
  'pipeline_summary', 'pipeline_strongest', 'pipeline_stuck',
  'activity_changed', 'activity_summary', 'status_explain', 'status_stuck',
  'queue_review', 'queue_prioritize'
];
const PAGES = ['overview', 'prospects', 'pipeline', 'queue', 'activity', 'status', 'prospect'];

// Friendly messages (owned by the client). `retryable` = trying again can reasonably work.
const ERRORS = {
  disabled:            { message: 'Stark AI is turned off.', retryable: false },
  busy:                { message: 'Stark AI is still working on your last question.', retryable: false },
  cooldown:            { message: 'Please wait a moment before asking again.', retryable: true },
  empty:               { message: 'Type a question first.', retryable: false },
  too_long:            { message: 'That question is too long. Please shorten it.', retryable: false },
  bad_context:         { message: 'That question does not fit this page.', retryable: false },
  no_prospect:         { message: 'Open a prospect first, then ask about it.', retryable: false },
  data_unavailable:    { message: 'The dashboard data could not be loaded, so the question was not sent. Try again.', retryable: true },
  timeout:             { message: 'That took too long. Try again, or ask a shorter question.', retryable: true },
  aborted:             { message: 'Cancelled.', retryable: true },
  network:             { message: 'Could not reach Stark AI. Check your connection and try again.', retryable: true },
  // A 401 from Stark AI is a "could not verify this request" event, NOT proof that the Command Center session ended.
  // The router asks Supabase; only if Supabase says there is no valid user does the normal sign-out flow take over.
  unauthenticated:     { message: "Stark AI couldn't verify this request. Please try again.", retryable: true },
  forbidden:           { message: 'Stark AI is only available to the Command Center administrator.', retryable: false },
  bad_request:         { message: 'Stark AI could not understand that request.', retryable: false },
  too_large:           { message: 'That request was too large to send.', retryable: false },
  not_found:           { message: 'That prospect could not be found.', retryable: false },
  method_not_allowed:  { message: 'Stark AI is not set up correctly.', retryable: false },
  origin_not_allowed:  { message: 'Stark AI is not allowed from this address.', retryable: false },
  rate_limited:        { message: 'You are asking too quickly. Wait a moment and try again.', retryable: true },
  ai_overloaded:       { message: 'The AI service is busy right now. Try again in a minute.', retryable: true },
  ai_unavailable:      { message: 'The AI service could not be reached. Try again shortly.', retryable: true },
  ai_timeout:          { message: 'The AI took too long to answer. Try again.', retryable: true },
  ai_limit:            { message: 'Stark AI has reached its usage limit for now.', retryable: false },
  ai_incomplete:       { message: 'The answer came back incomplete. Try again, or ask a narrower question.', retryable: true },
  config_error:        { message: 'Stark AI is not configured correctly on the server.', retryable: false },
  internal:            { message: 'Something went wrong on the server. Try again.', retryable: true },
  unavailable:         { message: 'Stark AI is not available right now.', retryable: true },
  bad_response:        { message: 'Stark AI returned something unexpected. Try again.', retryable: true }
};

// The error codes the server is documented to send. Anything else a server (or a tampered response) sends is ignored.
const SERVER_CODES = ['unauthenticated', 'forbidden', 'bad_request', 'too_large', 'not_found', 'method_not_allowed', 'origin_not_allowed', 'rate_limited', 'ai_overloaded', 'ai_unavailable', 'ai_timeout', 'ai_limit', 'ai_incomplete', 'config_error', 'internal'];

const STATUS_TO_CODE = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed', 413: 'too_large', 429: 'rate_limited', 502: 'ai_unavailable', 503: 'ai_overloaded', 504: 'ai_timeout' };

export function isKnownErrorCode(code) {
  return Object.prototype.hasOwnProperty.call(ERRORS, code);
}

/** A normalised failure: { ok:false, code, message, retryable, authExpired, retryAfterMs, requestId }. */
export function makeError(code, extra) {
  const c = isKnownErrorCode(code) ? code : 'internal';
  const e = extra || {};
  return {
    ok: false,
    code: c,
    message: ERRORS[c].message,
    retryable: ERRORS[c].retryable,
    authExpired: c === 'unauthenticated',
    retryAfterMs: typeof e.retryAfterMs === 'number' && e.retryAfterMs > 0 ? Math.min(e.retryAfterMs, 5 * 60 * 1000) : 0,
    requestId: typeof e.requestId === 'string' ? e.requestId.slice(0, 64) : null
  };
}

function plainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function createStarkAiClient(deps) {
  const d = deps || {};
  const config = d.config;
  const invoke = d.invoke;
  const setTimer = d.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer || ((t) => clearTimeout(t));
  const now = d.now || (() => Date.now());
  const makeUuid = d.uuid || (() => (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : null));

  let lastAskAt = -Infinity;
  let lastPingAt = -Infinity;
  let service = 'unknown'; // unknown | disabled | checking | ready | not_configured | unavailable   (never "online")
  let inflight = null;     // the AbortController of the request in flight

  const isEnabled = () => !!(config && config.enabled === true && typeof invoke === 'function');

  // ----- request building (exact keys the server accepts) -----

  function buildChatPayload(input) {
    const i = input || {};
    const intent = INTENTS.indexOf(i.intent) !== -1 ? i.intent : null;
    const page = PAGES.indexOf(i.page) !== -1 ? i.page : null;
    if (!intent || !page) return { error: 'bad_context' };

    const message = typeof i.message === 'string' ? i.message.replace(/\r\n?/g, '\n').trim() : '';
    if (!message) return { error: 'empty' };
    if (message.length > config.maxMessageChars) return { error: 'too_long' };

    let prospectId = null;
    if (page === 'prospect') {
      if (typeof i.prospectId !== 'string' || !UUID_RE.test(i.prospectId)) return { error: 'no_prospect' };
      prospectId = i.prospectId.toLowerCase();
    } else if (PROSPECT_INTENTS.indexOf(intent) !== -1) {
      return { error: 'bad_context' };
    }

    const history = Array.isArray(i.history) ? i.history : [];
    if (!validHistory(history)) return { error: 'bad_context' };

    const clientRequestId = typeof i.clientRequestId === 'string' && UUID_RE.test(i.clientRequestId) ? i.clientRequestId : null;
    const body = {
      v: API_VERSION,
      op: 'chat',
      message: message,
      intent: intent,
      page: page,
      prospectId: prospectId,
      history: history.map((e) => ({ role: e.role, text: e.text })),
      // A question about one prospect never carries the browser's summary: the server loads the record itself.
      insights: prospectId ? null : (plainObject(i.insights) ? i.insights : null)
    };
    if (clientRequestId) body.clientRequestId = clientRequestId;
    return { body: body };
  }

  function validHistory(h) {
    if (h.length > config.historyMaxEntries) return false;
    let total = 0;
    for (let i = 0; i < h.length; i++) {
      const e = h[i];
      if (!plainObject(e) || typeof e.text !== 'string' || !e.text.trim() || e.text.length > config.historyEntryChars) return false;
      if (e.role !== (i % 2 === 0 ? 'user' : 'assistant')) return false;
      total += e.text.length;
    }
    if (total > config.historyTotalChars) return false;
    return h.length === 0 || h[h.length - 1].role === 'assistant';
  }

  // ----- the call itself (timeout + abort that work even if invoke ignores the signal) -----

  function guardedInvoke(body, timeoutMs, externalSignal) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    let settled = false;
    let onExternalAbort = null;

    const done = new Promise((resolve) => {
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      timer = setTimer(() => {
        finish({ failure: 'timeout' });
        try { if (controller) controller.abort(); } catch (e) { /* ignore */ }
      }, timeoutMs);
      if (externalSignal) {
        onExternalAbort = () => {
          finish({ failure: 'aborted' });
          try { if (controller) controller.abort(); } catch (e) { /* ignore */ }
        };
        if (externalSignal.aborted) onExternalAbort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
      let call;
      try {
        call = invoke(config.functionName, controller ? { body: body, signal: controller.signal } : { body: body });
      } catch (e) {
        finish({ thrown: e });
        return;
      }
      Promise.resolve(call).then((result) => finish({ result: result }), (e) => finish({ thrown: e }));
    });

    return done.finally(() => {
      if (timer !== null) clearTimer(timer);
      if (externalSignal && onExternalAbort) externalSignal.removeEventListener('abort', onExternalAbort);
    });
  }

  async function readErrorBody(context) {
    if (!context) return { status: 0, body: null, retryAfterSec: 0 };
    const status = typeof context.status === 'number' ? context.status : 0;
    let retryAfterSec = 0;
    try {
      const header = context.headers && typeof context.headers.get === 'function' ? context.headers.get('retry-after') : null;
      const n = header ? parseInt(header, 10) : 0;
      if (Number.isFinite(n) && n > 0) retryAfterSec = n;
    } catch (e) { /* ignore */ }
    let body = null;
    try {
      if (typeof context.json === 'function') body = await context.json();
    } catch (e) { body = null; }
    return { status: status, body: plainObject(body) ? body : null, retryAfterSec: retryAfterSec };
  }

  /** Turn anything that can go wrong into one of the client-owned error codes. Never throws. */
  async function normalizeFailure(outcome) {
    if (outcome.failure === 'timeout') return makeError('timeout');
    if (outcome.failure === 'aborted') return makeError('aborted');
    if (outcome.thrown) {
      const t = outcome.thrown;
      if (t && t.name === 'AbortError') return makeError('aborted');
      return makeError('network');
    }
    const result = outcome.result;
    if (!plainObject(result)) return makeError('bad_response');
    const err = result.error;
    if (err) {
      const name = err && err.name;
      if (name === 'FunctionsHttpError') {
        const info = await readErrorBody(err.context);
        const serverCode = info.body && typeof info.body.code === 'string' ? info.body.code : null;
        const code = serverCode && SERVER_CODES.indexOf(serverCode) !== -1
          ? serverCode
          : (STATUS_TO_CODE[info.status] || (info.status >= 500 ? 'internal' : 'bad_response'));
        const sec = info.body && typeof info.body.retryAfterSec === 'number' ? info.body.retryAfterSec : info.retryAfterSec;
        return makeError(code, { retryAfterMs: sec * 1000, requestId: info.body && info.body.requestId });
      }
      if (name === 'FunctionsFetchError') return makeError('network');
      if (name === 'FunctionsRelayError') return makeError('unavailable');
      if (name === 'AbortError') return makeError('aborted');
      return makeError('internal');
    }
    return null; // no error: the caller looks at result.data
  }

  // ----- chat -----

  async function ask(input) {
    if (!isEnabled()) return makeError('disabled');            // NO network call, ever, while disabled
    const built = buildChatPayload(input);
    if (built.error) return makeError(built.error);

    const t = now();
    if (inflight) return makeError('busy');
    if (t - lastAskAt < config.minSecondsBetweenRequests * 1000) {
      return makeError('cooldown', { retryAfterMs: config.minSecondsBetweenRequests * 1000 - (t - lastAskAt) });
    }

    const body = built.body;
    if (!body.clientRequestId) {
      const id = makeUuid();
      if (id) body.clientRequestId = id;
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    inflight = controller || { abort() {} };
    try {
      const outcome = await guardedInvoke(body, config.requestTimeoutMs, controller ? controller.signal : null);
      lastAskAt = now();
      const failure = await normalizeFailure(outcome);
      if (failure) return failure;

      const data = outcome.result.data;
      if (!plainObject(data) || data.ok !== true || typeof data.reply !== 'string') {
        if (plainObject(data) && data.ok === false && typeof data.code === 'string') {
          return makeError(SERVER_CODES.indexOf(data.code) !== -1 ? data.code : 'internal', { requestId: data.requestId });
        }
        return makeError('bad_response');
      }
      const reply = data.reply.length > config.replyMaxChars ? data.reply.slice(0, config.replyMaxChars) : data.reply;
      if (!reply.trim()) return makeError('bad_response');
      return {
        ok: true,
        reply: reply,
        blocked: data.blocked === true,
        truncated: data.truncated === true || data.reply.length > config.replyMaxChars,
        refused: data.refused === true,
        requestId: typeof data.requestId === 'string' ? data.requestId.slice(0, 64) : null
      };
    } finally {
      inflight = null;
    }
  }

  /** Cancel the request in flight (if any). The result of that request is discarded by the caller. */
  function cancel() {
    if (inflight) {
      try { inflight.abort(); } catch (e) { /* ignore */ }
    }
  }

  // ----- service check (an honest, optional "is the function configured" probe; only runs when enabled) -----

  async function ping() {
    if (!isEnabled()) { service = 'disabled'; return { ok: false, code: 'disabled', service: service }; }
    const t = now();
    if (t - lastPingAt < config.minSecondsBetweenPings * 1000) return { ok: service === 'ready', code: 'cooldown', service: service };
    lastPingAt = t;
    service = 'checking';
    const body = { v: API_VERSION, op: 'ping' };
    const id = makeUuid();
    if (id) body.clientRequestId = id;
    const outcome = await guardedInvoke(body, config.pingTimeoutMs, null);
    const failure = await normalizeFailure(outcome);
    if (failure) {
      service = failure.code === 'config_error' ? 'not_configured' : 'unavailable';
      return Object.assign({ service: service }, failure);
    }
    const data = outcome.result.data;
    if (plainObject(data) && data.ok === true && data.ready === true) {
      service = 'ready';
      return { ok: true, service: service };
    }
    service = plainObject(data) && data.ok === true && data.ready === false ? 'not_configured' : 'unavailable';
    return { ok: false, code: service === 'not_configured' ? 'config_error' : 'bad_response', service: service };
  }

  /** unknown | disabled | checking | ready | not_configured | unavailable */
  function serviceState() {
    return isEnabled() ? service : 'disabled';
  }

  function reset() {
    cancel();
    inflight = null;
    lastAskAt = -Infinity;
    lastPingAt = -Infinity;
    service = 'unknown';
  }

  function isBusy() {
    return inflight !== null;
  }

  function cooldownRemainingMs() {
    if (!config) return 0;
    return Math.max(0, config.minSecondsBetweenRequests * 1000 - (now() - lastAskAt));
  }

  return { isEnabled, buildChatPayload, ask, cancel, ping, serviceState, reset, isBusy, cooldownRemainingMs };
}
