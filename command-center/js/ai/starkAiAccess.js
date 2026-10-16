// Stark AI: is the signed-in user a Command Center administrator? (Used ONLY to decide whether to show Stark AI.)
//
// This is a convenience, NOT a security control. The server remains the boundary: the "stark-ai" function checks the
// user's token and calls is_admin() itself for every request, and the database enforces Row Level Security.
// Hiding the buttons from non-administrators just means nobody sees a feature they cannot use.
//
// It uses the SAME read-only database function the backend and the CRM's security rules already use (public.is_admin(),
// called as the signed-in user). It FAILS CLOSED: anything other than a clear "true" (an error, no answer, a timeout, a
// non-boolean) means "not an administrator", so Stark AI stays hidden. The rest of the Command Center is not affected.
//
// It is only called when STARK_AI.enabled is true. With the flag off, nothing here runs and no request is made.

export const ADMIN_CHECK_TIMEOUT_MS = 6000;

/**
 * rpc: (name) => Promise<{ data, error }>   (the Supabase client's rpc, supplied by the router)
 * Returns true ONLY when the database answers exactly `true`.
 */
export async function checkAdminAccess(rpc, options) {
  const o = options || {};
  const timeoutMs = typeof o.timeoutMs === 'number' ? o.timeoutMs : ADMIN_CHECK_TIMEOUT_MS;
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((t) => clearTimeout(t));
  if (typeof rpc !== 'function') return false;

  let timer = null;
  try {
    const timeout = new Promise((resolve) => { timer = setTimer(() => resolve(null), timeoutMs); });
    const result = await Promise.race([Promise.resolve().then(() => rpc('is_admin')), timeout]);
    if (!result || typeof result !== 'object' || result.error) return false;
    return result.data === true;
  } catch (e) {
    return false;
  } finally {
    if (timer !== null) clearTimer(timer);
  }
}
