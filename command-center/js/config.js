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

// message_type values the n8n approved-sender currently picks up. From the verified n8n setup:
// approved = true AND status = 'approved' AND message_type = 'followup_1'.
// The UI uses this ONLY to warn that an approved message of another type will wait.
// Update this list if the n8n sender is extended.
export const N8N_SENDER_MESSAGE_TYPES = ['followup_1'];
