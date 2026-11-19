// Entry point: frame guard -> authentication gate -> app shell with hash routing.
//
// SESSION END: every path that leads to the sign-in screen goes through endSession() FIRST:
//   idle logout, manual sign-out, expired session (load or action), auth failure, and a SIGNED_OUT event.
// endSession() closes any open write dialog, the mobile drawer and (later) the command palette, clears cached CRM
// data and search/index state, stops the idle timer and scrubs search text from the address bar, all before the
// sign-in screen is drawn.

import { sb, startupError } from './supabaseClient.js';
import * as auth from './auth.js';
import { getSnapshot, clearCache, isAwaitingApproval, getDiscovery, peekDiscovery, getDiscoveryFindings, getDiscoveryHealth } from './api.js';
import { h, clear, notice } from './dom.js';
import { closeActiveModal } from './modal.js';
import { endSession, onSessionEnd } from './utilities/session.js';
import { getInsights } from './utilities/insights.js';
import { parseHash, buildHash } from './utilities/query.js';
import { createShell, navEntry } from './components/shell.js';
import { STARK_AI } from './config.js';
import { starkAi, setAuthExpiredHandler } from './ai/starkAi.js';
import { createStarkAiPanel } from './ai/starkAiPanel.js';
import { checkAdminAccess } from './ai/starkAiAccess.js';
import { errorState, loadingState } from './components/ui.js';
import * as overview from './views/overview.js';
import * as queue from './views/queue.js';
import * as pipeline from './views/pipeline.js';
import * as prospects from './views/prospects.js';
import * as prospectDetail from './views/prospectDetail.js';
import * as activity from './views/activity.js';
import * as status from './views/status.js';
import * as discovery from './views/discovery.js';
import * as discoveryDetail from './views/discoveryDetail.js';
import { isAwaitingVerification } from './utilities/discovery.js';

const ROUTES = {
  overview: { view: overview },
  queue: { view: queue },
  pipeline: { view: pipeline },
  prospects: { view: prospects, detail: prospectDetail },
  discovery: { view: discovery, detail: discoveryDetail },
  activity: { view: activity },
  status: { view: status }
};
const DEFAULT_ROUTE = 'overview';

const root = document.getElementById('app');
let shell = null;
let main = null;
let renderToken = 0;
let hashHandlerAttached = false;
let pendingFlash = null; // one-time banner shown after an action (e.g. "Approved ...")
let lastPathKey = '';
let signingOut = false;  // true while WE are signing out (so the SIGNED_OUT event does not navigate a second time)

// ---------- cleanup registered once, run by endSession() ----------
onSessionEnd(closeActiveModal);                  // any open approve / edit / reject dialog
onSessionEnd(clearCache);                        // cached CRM snapshot + any load still in flight
onSessionEnd(() => auth.disarmIdleTimeout());
onSessionEnd(() => { renderToken++; main = null; pendingFlash = null; }); // drop any render still in progress
onSessionEnd(() => { if (shell) shell.destroy(); });                       // mobile drawer, its listeners, scroll lock
onSessionEnd(() => {                                                        // search text in the address bar
  try {
    const parsed = parseHash(window.location.hash);
    window.history.replaceState(null, '', buildHash(parsed.segments, {}));
  } catch (e) { /* not critical */ }
  document.title = 'Command Center';
});

// ---------- Stark AI (read-only copilot; built ONLY when STARK_AI.enabled is true) ----------
// The panel is a UI state, not a route. It follows the page you are on: renderRoute() tells it the hash and the prospect's
// company name.
// A 401 from Stark AI is only a "could not verify this request" event: the panel shows a neutral message and we ask Supabase
// (through the existing client) whether the Command Center sign-in is still valid. ONLY if Supabase confirms there is no
// valid user do we use the SAME sign-out path as every other expired-session case (which wipes Stark AI through the normal
// session cleanup). If the sign-in is valid, or Supabase cannot be reached to say either way, nothing is signed out.
// No second auth flow.
const aiEnabled = () => STARK_AI.enabled === true;
// Stark AI is shown ONLY to a verified administrator. The check runs once per sign-in, ONLY when the feature is enabled, and
// fails closed (any doubt = hidden). The server still enforces administrator access on every request; this just keeps a
// button nobody else can use out of their sight.
let aiAdmin = false;
const aiActive = () => aiEnabled() && aiAdmin;
onSessionEnd(() => { aiAdmin = false; });
let aiAuthCheck = false;
function supabaseSaysSignedOut(result) {
  const error = result && result.error;
  const user = result && result.data && result.data.user;
  if (user) return false;                                          // valid
  if (error && error.name === 'AuthRetryableFetchError') return false; // could not reach Supabase: no confirmation either way
  return true;                                                     // no user, or Supabase rejected the token
}
setAuthExpiredHandler(async () => {
  if (!aiActive() || !main || signingOut || aiAuthCheck) return;
  aiAuthCheck = true;
  try {
    let result = null;
    try {
      result = await sb.auth.getUser();
    } catch (e) {
      return; // no answer from Supabase: not a confirmation, so nothing is signed out
    }
    if (supabaseSaysSignedOut(result)) await sessionExpired('Your session expired. Please sign in again.');
  } finally {
    aiAuthCheck = false;
  }
});

// ---------- frame guard ----------
// GitHub Pages cannot send frame-ancestors / X-Frame-Options, so refuse to show anything
// if this page is loaded inside another site's frame (clickjacking defense).
function notFramed() {
  if (window.top === window.self) return true;
  try {
    window.top.location = window.self.location;
  } catch (e) {
    /* cross-origin top window: stay hidden */
  }
  return false;
}

// ---------- routing ----------
function resolveRoute() {
  const parsed = parseHash(window.location.hash);
  const known = Object.prototype.hasOwnProperty.call(ROUTES, parsed.segments[0]);
  const segments = known ? parsed.segments : [DEFAULT_ROUTE];
  return { name: segments[0], segments: segments, params: parsed.params };
}

// ---------- gate / app mounting ----------
async function route() {
  const state = await auth.getGateState();
  if (state.stage === 'ready') {
    // Only when Stark AI is enabled: ask the database (as the signed-in user) whether this is an administrator.
    aiAdmin = aiEnabled() ? await checkAdminAccess((name) => sb.rpc(name)) : false;
    mountApp(state);
  } else mountGate(state);
}

function mountGate(state) {
  endSession(); // BEFORE the sign-in screen is drawn
  shell = null;
  main = null;
  pendingFlash = null;
  lastPathKey = '';
  renderToken++;
  auth.renderGate(root, state, () => route());
}

function mountApp(state) {
  shell = createShell({
    root: root,
    email: state.email || '',
    onSignOut: () => signOutAndGate(),
    onRefresh: () => reload(),
    aiPanel: aiActive() ? createStarkAiPanel({ ai: starkAi }) : null
  });
  main = shell.main;
  lastPathKey = '';

  auth.armIdleTimeout(() => signOutAndGate('You were signed out after a period of inactivity.'));

  if (!hashHandlerAttached) {
    window.addEventListener('hashchange', () => {
      if (main) renderRoute();
    });
    hashHandlerAttached = true;
  }
  renderRoute();
}

async function renderRoute() {
  if (!main || !shell) return;
  const r = resolveRoute();

  // Old links: #/pipeline/<id> now lives at #/prospects/<id>.
  if (r.name === 'pipeline' && r.segments[1]) {
    window.location.replace(buildHash(['prospects', r.segments[1]], {}));
    return;
  }

  if (aiActive()) starkAi.setContextFromHash(window.location.hash); // Stark AI follows the page (and forgets the last prospect's name)

  const entry = navEntry(r.name);
  shell.setRoute({ name: r.name, title: entry.label, crumbs: [{ label: entry.group }, { label: entry.label }] });

  const token = ++renderToken;
  clear(main);
  main.setAttribute('aria-busy', 'true');
  main.appendChild(loadingState());

  try {
    const snap = await getSnapshot();
    if (token !== renderToken || !main || !shell) return; // a newer navigation, or the session ended

    const route = ROUTES[r.name];
    const view = (r.name === 'prospects' || r.name === 'discovery') && r.segments[1] ? route.detail : route.view;
    const ctx = {
      snap: snap,
      route: r,
      param: r.segments[1] || null,
      reload: reload,
      flash: flash,
      sessionExpired: sessionExpired
    };
    // Discovery data is loaded only on its own screen (read-only; a problem there never blocks the rest of the app).
    if (r.name === 'discovery') {
      ctx.discovery = await getDiscovery();
      if (r.segments[1] && ctx.discovery.available) ctx.discoveryFindings = await getDiscoveryFindings(r.segments[1]);
      if (token !== renderToken || !main || !shell) return;
    }

    // System Status also shows the discovery job health (heartbeat rows only; a problem there never blocks the page).
    if (r.name === 'status') {
      ctx.discoveryHealth = await getDiscoveryHealth();
      if (token !== renderToken || !main || !shell) return;
    }

    clear(main);
    main.removeAttribute('aria-busy');
    view.render(main, ctx);

    if (aiActive() && view === route.detail) {
      // Display-only company name for the panel header. Never sent anywhere; the server reads the prospect itself.
      const found = snap.prospectsById && snap.prospectsById.get(String(r.segments[1]));
      starkAi.setProspectLabel(found ? found.company_name : '');
    }

    shell.setRoute({
      name: r.name,
      title: view.title || entry.label,
      crumbs: typeof view.crumbs === 'function' ? view.crumbs(ctx) : [{ label: entry.group }, { label: entry.label }]
    });
    shell.setUpdated(snap.loadedAt);
    shell.setBadges({ queue: snap.messages.filter(isAwaitingApproval).length, status: statusBadgeCount(snap), discovery: discoveryBadgeCount() });

    if (pendingFlash) {
      main.insertBefore(notice(pendingFlash.kind, pendingFlash.text), main.firstChild);
      pendingFlash = null;
    }

    // Moving to a different page: start at the top and put keyboard focus on the page. Filter changes and
    // refreshes on the same page keep their place. On the very first draw after loading or signing in, focus
    // stays at the top of the document so the first Tab reaches "Skip to content".
    const key = r.segments.join('/');
    if (key !== lastPathKey) {
      const firstDraw = lastPathKey === '';
      lastPathKey = key;
      window.scrollTo(0, 0);
      if (!firstDraw) shell.focusMain();
    }
  } catch (err) {
    if (token !== renderToken) return;
    handleLoadError(err);
  }
}

/**
 * The System Status badge counts true machinery exceptions ONLY (failed messages and scheduled messages stuck past the
 * threshold). It is not a to-do count: ordinary drafts, overdue follow-ups, reviews and expected waiting never light it.
 */
function statusBadgeCount(snap) {
  try {
    return getInsights(snap).systemHealth.badgeCount;
  } catch (e) {
    return 0; // a problem computing the badge must never stop a page from drawing
  }
}

/** Businesses awaiting YOUR verification. Uses only what discovery has already loaded; it never triggers a load of its own. */
function discoveryBadgeCount() {
  try {
    const d = peekDiscovery();
    return d && d.available ? d.rows.filter(isAwaitingVerification).length : 0;
  } catch (e) {
    return 0;
  }
}

function flash(kind, text) {
  pendingFlash = { kind: kind, text: text };
}

/** Re-read the database and redraw the current screen (Refresh button, and after an action completes). */
async function reload() {
  if (!main || !shell) return;
  shell.setRefreshing(true);
  try {
    await getSnapshot({ force: true });
  } catch (err) {
    if (shell) shell.setRefreshing(false);
    handleLoadError(err);
    return;
  }
  if (shell) shell.setRefreshing(false);
  renderRoute();
}

function handleLoadError(err) {
  if (err && err.authExpired) {
    sessionExpired('Your session expired. Please sign in again.');
    return;
  }
  if (!main) return;
  clear(main);
  main.removeAttribute('aria-busy');
  main.appendChild(errorState(
    (err && err.message) ? err.message : 'Something went wrong while loading data.',
    () => renderRoute()
  ));
}

// ---------- signing out (every path) ----------
async function signOutAndGate(noticeText) {
  if (signingOut) return;
  signingOut = true;
  try {
    endSession();                    // dialogs, drawer, cached data and search state are gone immediately
    await auth.signOut(noticeText);  // then the server-side sign-out
    await route();                   // then the sign-in screen
  } finally {
    signingOut = false;
  }
}

/** Passed to views: an action (or load) discovered the session is no longer valid. */
function sessionExpired(text) {
  return signOutAndGate(text || 'Your session expired. Please sign in again.');
}

// ---------- boot ----------
function boot() {
  if (!notFramed()) return; // stay hidden
  root.classList.add('ready');

  if (!sb) {
    root.appendChild(h('div', { class: 'cc-gate' },
      h('section', { class: 'cc-gate-card' },
        h('h1', { class: 'cc-gate-title', text: 'Command Center' }),
        notice('error', startupError || 'Startup failed.')
      )
    ));
    return;
  }

  sb.auth.onAuthStateChange((event) => {
    // Deferred on purpose: do not call Supabase from inside this callback.
    if (event !== 'SIGNED_OUT') return;
    const wasShowingApp = !!main;
    endSession();
    if (wasShowingApp && !signingOut) setTimeout(() => route(), 0);
  });

  // Back/forward cache could resurrect an old screen; reload so the gate re-checks the session.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });

  route();
}

boot();
