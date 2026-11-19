// Step 624: joins a discovered business to what the CRM snapshot already holds about it (read-only; no network, no DOM).
// The business -> prospect link comes from the database (set only by refresh_discovery_crm after a human ran intake). This file never
// creates, changes or infers a link and never sets verification: it only reads the prospect, its messages and the suppression list.
import { isSuppressed } from '../api.js';
import { phaseOf } from './discovery.js';

/** { prospect, messages, suppressed } for a business that has a prospect in the loaded snapshot, otherwise null. */
export function linkFor(c, snap) {
  const p = c && c.prospect_id && snap && snap.prospectsById ? snap.prospectsById.get(String(c.prospect_id)) || null : null;
  if (!p) return null;
  const messages = (snap.messagesByProspect && snap.messagesByProspect.get(String(p.id))) || [];
  const email = typeof p.contact_email === 'string' ? p.contact_email.trim() : '';
  return { prospect: p, messages, suppressed: email ? isSuppressed(snap, email) : null };
}

/** The rows with `phase` filled in (copies; the loaded data is never modified). */
export function annotate(rows, snap) {
  return (rows || []).map((c) => ({ ...c, phase: phaseOf(c, linkFor(c, snap)) }));
}
