// Stark AI: the ready-to-use instance for the Command Center.
//
// Importing this file does NOTHING visible and makes NO network request. The instance stays dormant until the UI (Step 3)
// calls it, and every call is a no-op while STARK_AI.enabled is false (see config.js).
//
// It is wired to the existing pieces only:
//   - the Supabase client's functions.invoke   (attaches the signed-in user's own session token; no key in the browser)
//   - getSnapshot() + getInsights()            (the existing Phase 3B READ-ONLY data layer, same cache as the dashboards)
//   - onSessionEnd()                           (the existing cleanup hub: sign-out, idle timeout, expired session)
// This file does not import auth.js or actions.js and does not change either.

import { sb } from '../supabaseClient.js';
import { getSnapshot } from '../api.js';
import { getInsights } from '../utilities/insights.js';
import { onSessionEnd } from '../utilities/session.js';
import { STARK_AI } from '../config.js';
import { createStarkAi } from './starkAiController.js';

let authExpiredHandler = null;

/** The shell can register what happens when the function says the session is no longer valid. */
export function setAuthExpiredHandler(fn) {
  authExpiredHandler = typeof fn === 'function' ? fn : null;
}

function invoke(name, options) {
  if (!sb || !sb.functions || typeof sb.functions.invoke !== 'function') {
    return Promise.resolve({ data: null, error: { name: 'FunctionsFetchError', message: 'unavailable' } });
  }
  return sb.functions.invoke(name, options);
}

export const starkAi = createStarkAi({
  config: STARK_AI,
  invoke: invoke,
  getInsightsData: async () => getInsights(await getSnapshot()),
  onAuthExpired: () => { if (authExpiredHandler) authExpiredHandler(); }
});

// Session end wipes the conversation, any request in flight, the page/prospect context, errors and the UI subscriptions.
onSessionEnd(() => starkAi.reset());
