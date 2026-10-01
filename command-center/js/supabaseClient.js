// Creates the one Supabase client used by the Command Center.
//
// Requires vendor/supabase.js to have been loaded first (it defines window.supabase).
// Uses ONLY the publishable key. As a safety net this file refuses to start with anything else,
// so pasting a secret key here by mistake will not silently work.

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  STORAGE_KEY
} from './config.js';

function makeClient() {
  if (!SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error(
      'config.js must contain a Supabase PUBLISHABLE key (starts with sb_publishable_). ' +
      'Never put a secret or service_role key in this folder.'
    );
  }

  const lib = window.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    throw new Error(
      'vendor/supabase.js did not load. Download the pinned supabase-js file into ' +
      'command-center/vendor/supabase.js (see the setup steps) and reload.'
    );
  }

  return lib.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: window.sessionStorage, // cleared when the tab closes; not shared with other tabs
      storageKey: STORAGE_KEY,        // separate from any other Supabase session on this origin
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,      // no magic links / OAuth in this app
      flowType: 'pkce'
    }
  });
}

let client = null;
let clientError = null;
try {
  client = makeClient();
} catch (err) {
  clientError = err && err.message ? err.message : String(err);
}

export const sb = client;          // null when startup failed
export const startupError = clientError;
