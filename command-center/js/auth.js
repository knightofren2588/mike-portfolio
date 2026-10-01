// Authentication: email + password (Supabase Auth), session kept in sessionStorage.
//
// Flow:
//   1. No valid session  -> email + password form
//   2. Valid session     -> the app
//
// This file only decides whether to show the sign-in form or the app. It is NOT the access control:
// the database is. Every CRM table is protected by Row Level Security that calls is_admin(), which is
// true only for users listed in the admin_users allowlist. A signed-in user who is not on that list
// loads the app shell but receives zero rows.
//
// Error messages are deliberately generic so they do not reveal whether an email exists.

import { sb } from './supabaseClient.js';
import { STORAGE_KEY, IDLE_TIMEOUT_MS } from './config.js';
import { h, clear } from './dom.js';

let pendingNotice = null; // one-time message shown on the sign-in screen (e.g. "signed out: idle")

// ---------- session state ----------

export async function getGateState() {
  const notice = pendingNotice;
  pendingNotice = null;

  const { data: sessionData, error: sessionError } = await sb.auth.getSession();
  if (sessionError || !sessionData || !sessionData.session) {
    return { stage: 'signed_out', notice: notice };
  }

  // getSession() only reads what is stored in this tab. getUser() asks the server, so a deleted
  // or revoked account is rejected instead of trusted from storage.
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError || !userData || !userData.user) {
    return { stage: 'signed_out', notice: notice };
  }

  return { stage: 'ready', email: userData.user.email || '' };
}

export async function signOut(notice) {
  pendingNotice = notice || null;
  disarmIdleTimeout();
  try {
    await sb.auth.signOut();
  } catch (e) {
    /* ignore: we clear local state below regardless */
  }
  try {
    const stale = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key && key.indexOf(STORAGE_KEY) === 0) stale.push(key);
    }
    stale.forEach((key) => window.sessionStorage.removeItem(key));
  } catch (e) {
    /* storage unavailable: nothing to clear */
  }
}

// ---------- idle timeout ----------

let idleTimer = null;
let idleReset = null;
const IDLE_EVENTS = ['pointerdown', 'keydown', 'scroll'];

export function armIdleTimeout(onTimeout) {
  disarmIdleTimeout();
  idleReset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(onTimeout, IDLE_TIMEOUT_MS);
  };
  IDLE_EVENTS.forEach((evt) => window.addEventListener(evt, idleReset, { passive: true }));
  idleReset();
}

export function disarmIdleTimeout() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (idleReset) {
    IDLE_EVENTS.forEach((evt) => window.removeEventListener(evt, idleReset));
    idleReset = null;
  }
}

// ---------- sign-in screen ----------

export function renderGate(root, state, onDone) {
  clear(root);
  const card = h('section', { class: 'cc-gate-card' },
    h('p', { class: 'cc-eyebrow', text: 'Stark Tech Studios' }),
    h('h1', { class: 'cc-gate-title', text: 'Command Center' })
  );
  root.appendChild(h('div', { class: 'cc-gate' }, card));
  buildLogin(card, onDone, state.notice);
}

function buildLogin(card, onDone, notice) {
  const status = h('p', { class: 'cc-form-status', role: 'status', 'aria-live': 'polite' });
  if (notice) status.textContent = notice;

  const email = h('input', {
    id: 'cc-email', type: 'email', name: 'email', autocomplete: 'username',
    required: true, spellcheck: 'false', maxlength: '254'
  });
  const password = h('input', {
    id: 'cc-password', type: 'password', name: 'password', autocomplete: 'current-password',
    required: true, maxlength: '256'
  });
  const submit = h('button', { type: 'submit', class: 'cc-btn cc-btn-primary', text: 'Sign in' });

  const form = h('form', { class: 'cc-form' },
    h('label', { for: 'cc-email', text: 'Email' }), email,
    h('label', { for: 'cc-password', text: 'Password' }), password,
    submit, status
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = '';
    try {
      const { error } = await sb.auth.signInWithPassword({
        email: email.value.trim(),
        password: password.value
      });
      password.value = '';
      if (error) {
        status.textContent = error.status === 429
          ? 'Too many attempts. Wait a few minutes and try again.'
          : 'Sign-in failed. Check your email and password.';
        submit.disabled = false;
        return;
      }
      onDone();
    } catch (e) {
      password.value = '';
      status.textContent = 'Could not reach the server. Check your connection and try again.';
      submit.disabled = false;
    }
  });

  card.appendChild(form);
  email.focus();
}
