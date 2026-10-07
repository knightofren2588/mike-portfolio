// The app shell: persistent sidebar on desktop, slide-in drawer on mobile, top bar with breadcrumb,
// "Updated" time and a Refresh button.
//
// This file only builds navigation and layout. It has no access to data and makes no network calls.
// On sign-out the router calls endSession(), which runs this shell's cleanup (closes the drawer, removes its
// listeners and the scroll lock) before the sign-in screen is shown.

import { h, clear } from '../dom.js';
import { fmtTime, fmtFull } from '../utilities/format.js';
import { onSessionEnd, offSessionEnd } from '../utilities/session.js';

export const NAV = [
  { group: 'Dashboard', items: [{ route: 'overview', label: 'Overview' }] },
  {
    group: 'Sales',
    items: [
      { route: 'queue', label: 'Approval Queue', badge: 'queue' },
      { route: 'pipeline', label: 'Pipeline' },
      { route: 'prospects', label: 'Prospects' }
    ]
  },
  { group: 'Activity', items: [{ route: 'activity', label: 'Activity Feed' }] },
  { group: 'Automation', items: [{ route: 'status', label: 'System Status', badge: 'status', alert: true }] }
];

export function navEntry(route) {
  for (const group of NAV) {
    for (const item of group.items) {
      if (item.route === route) return { group: group.group, label: item.label };
    }
  }
  return { group: '', label: '' };
}

const BADGE_TITLES = { queue: ' awaiting approval', status: ' system exceptions' };

export function createShell(options) {
  const root = options.root;
  const links = new Map();
  const badges = new Map();
  let drawerOpen = false;

  // ----- sidebar -----
  const navGroups = NAV.map((group) =>
    h('div', { class: 'cc-nav-group' },
      h('div', { class: 'cc-nav-heading', text: group.group }),
      group.items.map((item) => {
        const badgeEl = item.badge ? h('span', { class: 'cc-nav-badge' + (item.alert ? ' cc-nav-badge-alert' : ''), hidden: true }) : null;
        const link = h('a', { class: 'cc-nav-link', href: '#/' + item.route, 'data-route': item.route },
          h('span', { text: item.label }), badgeEl);
        link.addEventListener('click', () => closeDrawer(false));
        links.set(item.route, link);
        if (badgeEl) badges.set(item.badge, badgeEl);
        return link;
      })
    )
  );

  const closeBtn = h('button', { type: 'button', class: 'cc-btn cc-drawer-close', text: 'Close' });
  const signOutBtn = h('button', { type: 'button', class: 'cc-btn cc-signout', text: 'Sign out' });
  signOutBtn.addEventListener('click', () => options.onSignOut());
  closeBtn.addEventListener('click', () => closeDrawer(true));

  const sidebar = h('aside', { class: 'cc-sidebar', id: 'cc-sidebar', 'aria-label': 'Command Center' },
    h('div', { class: 'cc-side-top' },
      h('div', { class: 'cc-brand' },
        h('span', { class: 'cc-brand-name', text: 'Stark Tech Studios' }),
        h('span', { class: 'cc-brand-sub', text: 'Command Center' })
      ),
      closeBtn
    ),
    h('nav', { class: 'cc-nav', 'aria-label': 'Main' }, navGroups),
    h('div', { class: 'cc-side-foot' },
      h('span', { class: 'cc-badge cc-badge-controlled', text: 'Controlled writes' }),
      h('div', { class: 'cc-user', text: options.email || '', title: options.email || '' }),
      signOutBtn
    )
  );

  // ----- top bar -----
  const menuBtn = h('button', {
    type: 'button', class: 'cc-btn cc-menu-btn', text: 'Menu',
    'aria-label': 'Open navigation', 'aria-controls': 'cc-sidebar', 'aria-expanded': 'false'
  });
  const crumbs = h('nav', { class: 'cc-crumbs', 'aria-label': 'Breadcrumb' });
  const updated = h('span', { class: 'cc-updated' });
  const refreshBtn = h('button', { type: 'button', class: 'cc-btn cc-refresh', text: 'Refresh' });
  refreshBtn.addEventListener('click', () => options.onRefresh());
  menuBtn.addEventListener('click', () => (drawerOpen ? closeDrawer(true) : openDrawer()));

  const topbar = h('header', { class: 'cc-topbar' },
    menuBtn, crumbs,
    h('div', { class: 'cc-topbar-right' }, updated, refreshBtn)
  );

  const main = h('main', { class: 'cc-main', id: 'cc-main', tabindex: '-1' });

  const skip = h('button', { type: 'button', class: 'cc-skip', text: 'Skip to content' });
  skip.addEventListener('click', () => main.focus());

  const scrim = h('div', { class: 'cc-scrim' });
  scrim.addEventListener('click', () => closeDrawer(true));

  const shell = h('div', { class: 'cc-shell' },
    skip, sidebar, scrim,
    h('div', { class: 'cc-content' }, topbar, main)
  );
  clear(root);
  root.appendChild(shell);

  // ----- mobile drawer -----
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer(true);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(sidebar.querySelectorAll('a[href], button')).filter((el) => !el.disabled);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;
    shell.classList.add('cc-drawer-open');
    document.body.classList.add('cc-drawer-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.setAttribute('aria-label', 'Close navigation');
    document.addEventListener('keydown', onKeydown, true);
    const first = sidebar.querySelector('a[href]');
    if (first) first.focus();
  }

  function closeDrawer(returnFocus) {
    // Always safe to call, including when it is already closed (sign-out cleanup calls it unconditionally).
    document.removeEventListener('keydown', onKeydown, true);
    document.body.classList.remove('cc-drawer-open');
    shell.classList.remove('cc-drawer-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Open navigation');
    const wasOpen = drawerOpen;
    drawerOpen = false;
    if (wasOpen && returnFocus && document.contains(menuBtn)) menuBtn.focus();
  }

  // If the window is widened to desktop size while the drawer is open, close it.
  const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 961px)') : null;
  const onWide = (event) => { if (event.matches) closeDrawer(false); };
  if (wide) {
    if (typeof wide.addEventListener === 'function') wide.addEventListener('change', onWide);
    else if (typeof wide.addListener === 'function') wide.addListener(onWide);
  }

  const cleanup = () => closeDrawer(false);
  onSessionEnd(cleanup);

  // ----- public API -----
  return {
    main: main,

    /** Mark the active nav item, draw the breadcrumb, and set a generic tab title (never a company name). */
    setRoute(info) {
      links.forEach((link, route) => {
        if (route === info.name) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      clear(crumbs);
      const list = h('ol', { class: 'cc-crumb-list' });
      info.crumbs.forEach((crumb, index) => {
        const last = index === info.crumbs.length - 1;
        const node = crumb.href && !last
          ? h('a', { href: crumb.href, text: crumb.label })
          : h('span', { text: crumb.label, 'aria-current': last ? 'page' : false });
        list.appendChild(h('li', {}, node));
      });
      crumbs.appendChild(list);
      document.title = (info.title ? info.title + ' · ' : '') + 'Command Center';
    },

    setUpdated(date) {
      updated.textContent = 'Updated ' + fmtTime(date);
      updated.setAttribute('title', fmtFull(date));
    },

    /** counts = { queue: 3 } -> shows a small number on that nav item (hidden when 0). */
    setBadges(counts) {
      badges.forEach((el, key) => {
        const n = counts[key] || 0;
        clear(el);
        if (n > 0) {
          el.appendChild(document.createTextNode(String(n)));
          el.appendChild(h('span', { class: 'cc-sr-only', text: BADGE_TITLES[key] || '' }));
          el.hidden = false;
        } else {
          el.hidden = true;
        }
      });
    },

    setRefreshing(busy) {
      refreshBtn.disabled = !!busy;
      refreshBtn.textContent = busy ? 'Refreshing…' : 'Refresh';
    },

    focusMain() {
      main.focus({ preventScroll: true });
    },

    closeDrawer: closeDrawer,

    destroy() {
      closeDrawer(false);
      if (wide) {
        if (typeof wide.removeEventListener === 'function') wide.removeEventListener('change', onWide);
        else if (typeof wide.removeListener === 'function') wide.removeListener(onWide);
      }
      offSessionEnd(cleanup);
    }
  };
}
