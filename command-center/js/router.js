// Entry point: frame guard -> authentication gate -> app shell with hash routing.

import { sb, startupError } from './supabaseClient.js';
import * as auth from './auth.js';
import { getSnapshot, clearCache } from './api.js';
import { h, clear, notice, fmtDateTime } from './dom.js';
import * as overview from './views/overview.js';
import * as queue from './views/queue.js';
import * as pipeline from './views/pipeline.js';
import * as activity from './views/activity.js';
import * as status from './views/status.js';

const ROUTES = {
  overview: { label: 'Overview', view: overview },
  queue: { label: 'Approval Queue', view: queue },
  pipeline: { label: 'Pipeline', view: pipeline },
  activity: { label: 'Activity Feed', view: activity },
  status: { label: 'System Status', view: status }
};
const DEFAULT_ROUTE = 'overview';

const root = document.getElementById('app');
let main = null;
let navLinks = [];
let renderToken = 0;
let hashHandlerAttached = false;
let pendingFlash = null; // one-time banner shown after an action (e.g. "Approved ...")

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

// ---------- routing helpers ----------
function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/');
  const name = Object.prototype.hasOwnProperty.call(ROUTES, parts[0]) ? parts[0] : DEFAULT_ROUTE;
  let param = null;
  if (parts[1]) {
    try {
      param = decodeURIComponent(parts[1]);
    } catch (e) {
      param = null;
    }
  }
  return { name: name, param: param };
}

// ---------- gate / app mounting ----------
async function route() {
  const state = await auth.getGateState();
  if (state.stage === 'ready') mountApp(state);
  else mountGate(state);
}

function mountGate(state) {
  auth.disarmIdleTimeout();
  clearCache();
  main = null;
  pendingFlash = null;
  renderToken++;
  auth.renderGate(root, state, () => route());
}

function mountApp(state) {
  clear(root);

  navLinks = Object.keys(ROUTES).map((name) =>
    h('a', { class: 'cc-nav-link', href: '#/' + name, 'data-route': name, text: ROUTES[name].label })
  );

  const refreshBtn = h('button', { type: 'button', class: 'cc-btn', text: 'Refresh data' });
  const signOutBtn = h('button', { type: 'button', class: 'cc-btn', text: 'Sign out' });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      await getSnapshot({ force: true });
    } catch (err) {
      handleLoadError(err);
      refreshBtn.disabled = false;
      return;
    }
    refreshBtn.disabled = false;
    renderRoute();
  });

  signOutBtn.addEventListener('click', async () => {
    await auth.signOut();
    route();
  });

  main = h('main', { class: 'cc-main', id: 'cc-main' });

  root.appendChild(h('header', { class: 'cc-header' },
    h('div', { class: 'cc-brand' },
      h('span', { class: 'cc-brand-name', text: 'Stark Tech Studios' }),
      h('span', { class: 'cc-brand-sub', text: 'Command Center' })
    ),
    h('span', { class: 'cc-badge cc-badge-controlled', text: 'Phase 2 · controlled writes' }),
    h('nav', { class: 'cc-nav', 'aria-label': 'Command Center sections' }, navLinks),
    h('div', { class: 'cc-header-actions' },
      h('span', { class: 'cc-user', text: state.email || '' }),
      refreshBtn, signOutBtn
    )
  ));
  root.appendChild(main);

  auth.armIdleTimeout(async () => {
    await auth.signOut('You were signed out after a period of inactivity.');
    route();
  });

  if (!hashHandlerAttached) {
    window.addEventListener('hashchange', () => {
      if (main) renderRoute();
    });
    hashHandlerAttached = true;
  }
  renderRoute();
}

async function renderRoute() {
  if (!main) return;
  const current = parseHash();
  navLinks.forEach((link) => {
    if (link.getAttribute('data-route') === current.name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const token = ++renderToken;
  clear(main);
  main.appendChild(h('p', { class: 'cc-muted', text: 'Loading…' }));

  try {
    const snap = await getSnapshot();
    if (token !== renderToken || !main) return; // a newer navigation replaced this one
    clear(main);
    ROUTES[current.name].view.render(main, { snap: snap, param: current.param, reload: reload, flash: flash });
    if (pendingFlash) {
      main.insertBefore(notice(pendingFlash.kind, pendingFlash.text), main.firstChild);
      pendingFlash = null;
    }
    main.appendChild(h('p', { class: 'cc-footnote', text: 'Data loaded ' + fmtDateTime(snap.loadedAt) }));
  } catch (err) {
    if (token !== renderToken) return;
    handleLoadError(err);
  }
}

function flash(kind, text) {
  pendingFlash = { kind: kind, text: text };
}

/** Re-read the database and redraw the current screen (used after an action completes). */
async function reload() {
  if (!main) return;
  try {
    await getSnapshot({ force: true });
  } catch (err) {
    handleLoadError(err);
    return;
  }
  renderRoute();
}

function handleLoadError(err) {
  if (err && err.authExpired) {
    auth.signOut('Your session expired. Please sign in again.').then(() => route());
    return;
  }
  if (!main) return;
  clear(main);
  main.appendChild(notice('error', (err && err.message) ? err.message : 'Something went wrong while loading data.'));
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
    if (event === 'SIGNED_OUT') setTimeout(() => { if (main) route(); }, 0);
  });

  // Back/forward cache could resurrect an old screen; reload so the gate re-checks the session.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });

  route();
}

boot();
