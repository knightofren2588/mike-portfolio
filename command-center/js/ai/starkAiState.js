// Stark AI: the conversation, kept in RUNTIME MEMORY ONLY.
//
// Nothing here is ever written to localStorage, sessionStorage, IndexedDB, cookies, the database or the server.
// The conversation lives in a plain JavaScript object. It is lost when the page reloads and is wiped when the
// session ends (sign-out, idle timeout, expired session) or when you press Clear Conversation.
//
// HISTORY SENT WITH A QUESTION
//  The server (and Anthropic) need a strictly alternating history that starts with a user turn and ends with an
//  assistant turn:   user, assistant, user, assistant ...
//  historyFor() builds that from COMPLETED question/answer pairs only (a pending or failed question is never
//  included), newest pairs first, within the approved bounds. When the limits are exceeded the OLDEST pairs are
//  dropped. A question about one prospect only ever sees history from that same prospect.

export function createConversation(options) {
  const o = options || {};
  const storedMax = o.storedMessagesMax || 20;
  const maxEntries = o.historyMaxEntries || 8;
  const entryChars = o.historyEntryChars || 4000;
  const totalChars = o.historyTotalChars || 12000;
  const makeId = o.makeId || (() => 'm' + (++counter));
  let counter = 0;

  let messages = [];

  const snapshotOf = (m) => Object.assign({}, m);

  function add(fields) {
    const m = Object.assign({
      id: makeId(), role: 'user', text: '', scope: null, state: 'ok',
      intent: 'free', promptId: null, page: 'overview', prospectId: null, label: '', replyTo: null,
      blocked: false, truncated: false, refused: false, requestId: null, errorCode: null
    }, fields);
    messages.push(m);
    // memory only keeps the newest messages; the oldest fall off first
    while (messages.length > storedMax) messages.shift();
    return snapshotOf(m);
  }

  function update(id, patch) {
    const m = messages.find((x) => x.id === id);
    if (!m) return null;
    Object.assign(m, patch);
    return snapshotOf(m);
  }

  function remove(id) {
    const before = messages.length;
    messages = messages.filter((m) => m.id !== id);
    return messages.length !== before;
  }

  function get(id) {
    const m = messages.find((x) => x.id === id);
    return m ? snapshotOf(m) : null;
  }

  function list() {
    return messages.map(snapshotOf);
  }

  function clear() {
    messages = [];
  }

  /** Forget only the messages for which `test(message)` is true (used by "Clear" for one conversation). */
  function removeWhere(test) {
    messages = messages.filter((m) => !test(snapshotOf(m)));
  }

  /** The most recent failed question (to offer Retry), or null. */
  function lastFailed() {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].state === 'failed') return snapshotOf(messages[i]);
      if (messages[i].state === 'pending') return null;
    }
    return null;
  }

  function hasPending() {
    return messages.some((m) => m.state === 'pending');
  }

  /**
   * Strictly alternating, user-first, assistant-last history for the next question in `scope`
   * (scope = a prospect id, or null for everything that is not about one prospect).
   */
  function historyFor(scope) {
    const wanted = scope || null;
    const pairs = [];
    for (let i = 0; i < messages.length; i++) {
      const q = messages[i];
      if (q.role !== 'user' || q.state !== 'ok' || (q.scope || null) !== wanted) continue;
      const a = messages.find((x) => x.role === 'assistant' && x.state === 'ok' && x.replyTo === q.id && (x.scope || null) === wanted);
      if (!a) continue;
      const qText = String(q.text).slice(0, entryChars).trim();
      const aText = String(a.text).slice(0, entryChars).trim();
      if (!qText || !aText) continue;
      pairs.push([qText, aText]);
    }
    // newest first until a limit is reached, then restore the original order
    const kept = [];
    let entries = 0;
    let chars = 0;
    for (let i = pairs.length - 1; i >= 0; i--) {
      const size = pairs[i][0].length + pairs[i][1].length;
      if (entries + 2 > maxEntries || chars + size > totalChars) break;
      kept.unshift(pairs[i]);
      entries += 2;
      chars += size;
    }
    const out = [];
    kept.forEach((pair) => {
      out.push({ role: 'user', text: pair[0] });
      out.push({ role: 'assistant', text: pair[1] });
    });
    return out;
  }

  return { add, update, remove, get, list, clear, removeWhere, lastFailed, hasPending, historyFor };
}
