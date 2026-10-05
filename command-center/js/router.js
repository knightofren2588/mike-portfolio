// Entry point: frame guard -> authentication gate -> app shell with hash routing.
//
// SESSION END: every path that leads to the sign-in screen goes through endSession() FIRST:
//   idle logout, manual sign-out, expired session (load or action), auth failure, and a SIGNED_OUT event.
// endSession() closes any open write dialog, the mobile drawer and (later) the command palette, clears cached CRM
// data and search/index state, stops the idle timer and scrubs search text from the address bar, all before the
// sign-in screen is drawn.

import { sb, startupError } from './supabaseClient.js';
import * as auth from './auth.js';
import { getSnapshot, clearCache, isAwaitingApproval } from './api.js';
import { h, clear, notice } from './dom.js';
import { closeActiveModal } from './modal.js';
import { endSession, onSessionEnd } from './utilities/session.js';
import { parseHash, buildHash } from './utilities/query.js';
import { createShell, navEntry } from './components/shell.js';
import { errorState, loadingState } from './components/ui.js';
import * as overview from './views/overview.js';
import * as queue from './views/queue.js';
import * as pipeline from './views/pipeline.js';
import * as prospects from './views/prospects.js';
import * as prospectDetail from './views/prospectDetail.js';
import * as activity from './views/activity.js';
import * as status from './views/status.js';

const ROUTES = {
  overview: { view: overview },
  queue: { view: queue },
  pipeline: { view: pipeline },
  prospects: { view: prospects, detail: prospectDetail },
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
  if (state.stage === 'ready') mountApp(state);
  else mountGate(state);
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
    onRefresh: () => reload()
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
    const view = r.name === 'prospects' && r.segments[1] ? route.detail : route.view;
    const ctx = {
      snap: snap,
      route: r,
      param: r.segments[1] || null,
      reload: reload,
      flash: flash,
      sessionExpired: sessionExpired
    };

    clear(main);
    main.removeAttribute('aria-busy');
    view.render(main, ctx);

    shell.setRoute({
      name: r.name,
      title: view.title || entry.label,
      crumbs: typeof view.crumbs === 'function' ? view.crumbs(ctx) : [{ label: entry.group }, { label: entry.label }]
    });
    shell.setUpdated(snap.loadedAt);
    shell.setBadges({ queue: snap.messages.filter(isAwaitingApproval).length });

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
