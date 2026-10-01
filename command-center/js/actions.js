// The ONLY place the Command Center can change data.
//
// It can call exactly three database functions (RPCs), nothing else:
//   approve_outreach_message, reject_outreach_message, edit_outreach_draft
// There is no generic "update a row" helper, no delete, no direct table write, and no call to n8n,
// SMTP or any email service. Approving only changes database state; n8n does the sending.
//
// The database functions are the security boundary: each one re-checks that you are the allowlisted
// admin, that the message is still an unapproved draft, and (for approval) the do-not-contact,
// missing-email and suppression rules. The checks in this file and in the UI only give fast feedback.

import { sb } from './supabaseClient.js';
import { clearCache } from './api.js';
import { LIMITS } from './config.js';

const ALLOWED_RPCS = Object.freeze([
  'approve_outreach_message',
  'reject_outreach_message',
  'edit_outreach_draft'
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ActionError extends Error {
  constructor(message, flags) {
    super(message);
    this.name = 'ActionError';
    this.authExpired = !!(flags && flags.authExpired); // session is gone: sign in again
    this.stale = !!(flags && flags.stale);             // the data on screen is out of date: refresh
  }
}

function friendly(error) {
  const code = String(error.code || '');
  const message = String(error.message || '');

  if (error.status === 401 || code === 'PGRST301' || code === 'PGRST303' || /jwt/i.test(message)) {
    return new ActionError('Your session has expired. Please sign in again.', { authExpired: true });
  }
  if (code === 'PGRST202' || (error.status === 404 && /function/i.test(message))) {
    return new ActionError('This action is not available yet: the Phase 2 database migration has not been applied.');
  }
  if (code === '22P02') {
    return new ActionError('That message id is not valid.');
  }
  // Messages written by our own functions (business rules, "not found", "not authorized").
  if (code === 'P0001' || code === 'P0002') {
    return new ActionError(message, { stale: true });
  }
  if (code === '42501') {
    return new ActionError(/not authorized/i.test(message) ? 'You are not authorized to do this.' : 'The database refused this action (permission denied).');
  }
  return new ActionError('The database rejected the request (code ' + (code || 'unknown') + ').');
}

async function callRpc(name, args) {
  if (ALLOWED_RPCS.indexOf(name) === -1) throw new Error('Blocked: not an allowed database function.');

  let result;
  try {
    result = await sb.rpc(name, args);
  } catch (e) {
    throw new ActionError('Could not reach the server. Check your connection and try again.');
  }
  if (result.error) throw friendly(result.error);

  clearCache(); // force the next read to fetch fresh data
  return result.data;
}

function requireId(id) {
  const value = String(id === null || id === undefined ? '' : id);
  if (!UUID_RE.test(value)) throw new ActionError('That message id is not valid.');
  return value;
}

export async function approveMessage(messageId) {
  return callRpc('approve_outreach_message', { message_id: requireId(messageId) });
}

export async function rejectMessage(messageId, reason) {
  const text = String(reason === null || reason === undefined ? '' : reason).trim();
  if (text.length > LIMITS.reason) {
    throw new ActionError('The reason is too long (' + LIMITS.reason + ' characters maximum).');
  }
  return callRpc('reject_outreach_message', { message_id: requireId(messageId), reason: text === '' ? null : text });
}

export async function editDraft(messageId, newSubject, newBody) {
  const subject = String(newSubject === null || newSubject === undefined ? '' : newSubject);
  const body = String(newBody === null || newBody === undefined ? '' : newBody);
  if (body.trim() === '') throw new ActionError('The message body cannot be empty.');
  if (subject.trim().length > LIMITS.subject) throw new ActionError('The subject is too long (' + LIMITS.subject + ' characters maximum).');
  if (body.trim().length > LIMITS.body) throw new ActionError('The body is too long (' + LIMITS.body + ' characters maximum).');
  return callRpc('edit_outreach_draft', { message_id: requireId(messageId), new_subject: subject, new_body: body });
}
