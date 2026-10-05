// Session-end cleanup hub.
//
// Anything that holds data or UI on screen while you are signed in registers a cleanup function here.
// endSession() runs ALL of them. The router calls it on every path that leads to the sign-in screen:
// idle logout, manual sign-out, expired session, auth failure, and a SIGNED_OUT event.
//
// This is what guarantees a write dialog, the mobile drawer, the command palette, cached CRM data and any
// search/index state are gone BEFORE the sign-in screen is shown.
//
// Cleanup functions must be safe to run more than once (endSession can be called several times).

const hooks = [];

export function onSessionEnd(fn) {
  if (typeof fn === 'function' && hooks.indexOf(fn) === -1) hooks.push(fn);
}

export function offSessionEnd(fn) {
  const i = hooks.indexOf(fn);
  if (i !== -1) hooks.splice(i, 1);
}

export function endSession() {
  hooks.slice().forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* one failing cleanup must never stop the others */
    }
  });
}
