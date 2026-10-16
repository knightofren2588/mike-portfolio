// Stark AI: the RETRY SNAPSHOT (runtime memory only).
//
// When a question fails, the controller keeps ONE small snapshot of exactly what was sent, so "Retry previous request"
// replays THAT request, not "whatever page you happen to be looking at now". Example: the question failed on Prospect A,
// you open Prospect B, and press Retry: the retry still asks about Prospect A.
//
// WHAT IS KEPT (allow-list; nothing else can get in):
//   message, intent, promptId, page, prospectId (a UUID only), the bounded history that request used, the
//   allow-listed operations summary that request used (or null), and a few display labels.
// WHAT IS NEVER KEPT: the prospect record (the server reloads it from the database using the original prospect id),
//   email addresses, phone numbers, notes, message bodies, tokens or any auth data.
//
// MEMORY ONLY: this is a plain object inside this module instance. It is never written to localStorage,
// sessionStorage, IndexedDB, cookies, the database or the server.
// It is cleared by: a successful retry (or any newer request being accepted), Clear Conversation, and session end
// (sign-out, idle timeout, expired session). Only the MOST RECENT failed request can be retried.

import { isUuid, cleanLabel } from './starkAiContext.js';
import { PAGE_LABELS } from './starkAiPrompts.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.keys(value).forEach((k) => deepFreeze(value[k]));
  }
  return value;
}

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Build a snapshot from a request using an allow-list. Returns null if the request is not safe to keep. */
export function makeRetrySnapshot(request, meta) {
  const r = request || {};
  const m = meta || {};
  if (typeof r.message !== 'string' || !r.message || typeof r.intent !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(PAGE_LABELS, r.page)) return null;
  const isProspectPage = r.page === 'prospect';
  if (isProspectPage && !isUuid(r.prospectId)) return null;      // never keep an unusable prospect request

  const history = [];
  (Array.isArray(r.history) ? r.history : []).forEach((e) => {
    if (plain(e) && (e.role === 'user' || e.role === 'assistant') && typeof e.text === 'string') history.push({ role: e.role, text: e.text });
  });

  const snapshot = {
    messageId: typeof m.messageId === 'string' ? m.messageId : null,
    message: r.message,
    intent: r.intent,
    promptId: typeof r.promptId === 'string' ? r.promptId : null,
    page: r.page,
    prospectId: isProspectPage ? String(r.prospectId).toLowerCase() : null,
    history: history,
    // a question about one prospect never carries a browser summary (the server loads the record itself)
    insights: !isProspectPage && plain(r.insights) ? JSON.parse(JSON.stringify(r.insights)) : null,
    summaryPending: !isProspectPage && r.summaryPending === true,
    prospectLabel: isProspectPage ? cleanLabel(r.prospectLabel, 80) : '',
    errorCode: typeof m.errorCode === 'string' ? m.errorCode.slice(0, 40) : null,
    errorRetryable: m.errorRetryable === true
  };
  return deepFreeze(snapshot);
}

export function createRetryStore() {
  let snapshot = null;
  return {
    /** Replace whatever was stored with this request. Returns true if something was stored. */
    set(request, meta) {
      snapshot = makeRetrySnapshot(request, meta);
      return snapshot !== null;
    },
    get() { return snapshot; },
    has() { return snapshot !== null; },
    clear() { snapshot = null; }
  };
}
