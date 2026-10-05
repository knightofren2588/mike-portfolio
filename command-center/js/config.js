// Command Center configuration.
//
// PUBLIC VALUES ONLY. This folder is served from a public GitHub repository.
// NEVER put a service_role key, an sb_secret_ key, an SMTP/IMAP password, an n8n
// credential, or any other privileged secret in this file (or anywhere in this folder).
//
// The publishable key is safe to publish: on its own it can do nothing, because every CRM
// table has Row Level Security enabled and only a signed-in user on the admin allowlist can read.

export const SUPABASE_URL = 'https://nunrppmwdhlcopcugfnj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_7PDtoyDBRHw1S1Lt1R8eHQ_n_lTiigi';

// Where the login session is kept. sessionStorage = cleared when the tab is closed.
export const STORAGE_KEY = 'stark-cc-auth';

// Automatic sign-out after this much inactivity.
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

// Safety limits for the read-only data loader (see api.js).
export const PAGE_SIZE = 1000;
export const MAX_ROWS_PER_TABLE = 5000;

// Mirrors the limits enforced inside the database functions (the database is the real check).
export const LIMITS = { subject: 300, body: 20000, reason: 1000 };

// Which message types have an n8n SENDER workflow, and whether YOU have marked it as published.
//
// Command Center cannot see n8n. It does not detect whether any workflow is built, published or running.
// This table is manual information that you maintain, and the screens word it that way ("according to
// config.js"). It is used ONLY to warn that an approved message may wait because nothing is set up to send it.
//
//   workflow   the name shown in warnings
//   published  true once you have published that workflow in n8n (set it yourself)
//   note       optional extra sentence shown in the warning
//
// A message type with no entry (or null) means "no sender workflow configured for this type".
export const SENDER_WORKFLOWS = {
  initial: {
    workflow: 'Initial Approved Sender',
    published: false,
    note: 'It passed QA but is not published yet (the production opt-out footer is still to be added).'
  },
  followup_1: {
    workflow: 'Follow-Up Sender',
    published: false
  }
  // followup_2: no sender workflow configured yet
};

// Lead score colour bands for the score badge (0-100). Display only.
export const LEAD_SCORE_BANDS = { high: 70, medium: 40 };

// Prospects page: rows rendered at a time before "Show more".
export const PROSPECT_PAGE_SIZE = 50;
