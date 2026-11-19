// Website research findings: pure helpers (no DOM, no network). Step 612.
//
// The findings are written by the research pipeline (stark-tech-backend/research) through a database function that only the
// intake role can run. The Command Center only READS them (through RLS, like every other table) and shows them next to the
// prospect and next to the draft, so you can check the evidence before you approve anything.
//
// Everything here is display logic. It cannot approve, send, change a prospect or contact anyone.

export const FINDING_STATUS = ['confirmed', 'potential', 'unknown'];

export const STATUS_TEXT = {
  confirmed: { label: 'Confirmed', kind: 'ok', help: 'Directly observed on the public site.' },
  potential: { label: 'Potential', kind: 'warn', help: 'An inference. It may be intentional or wrong. Check it before relying on it.' },
  unknown: { label: 'Unknown', kind: 'neutral', help: 'Could not be determined. Nothing is concluded.' }
};

export const CATEGORY_TEXT = {
  design_mobile: 'Design and mobile',
  performance: 'Performance',
  seo: 'Search (SEO)',
  accessibility: 'Accessibility',
  security: 'Observable security configuration',
  lead_capture: 'Lead capture and booking',
  automation: 'Automation and tracking'
};

/** True when the error just means "the findings table is not installed (yet)". Anything else is a real problem. */
export function isMissingTable(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '');
  return code === '42P01' || code === 'PGRST205' || /does not exist|could not find the table|schema cache/i.test(msg);
}

function time(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/** Only the newest research run for a prospect (a run is all rows that share run_sha256). */
export function latestRun(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];
  const newest = list.slice().sort((a, b) => time(b.created_at) - time(a.created_at))[0];
  return list.filter((r) => r.run_sha256 === newest.run_sha256);
}

const byWeight = (a, b) => (Number(b.weight) || 0) - (Number(a.weight) || 0) || String(a.check_id).localeCompare(String(b.check_id));

/** { confirmed: [...], potential: [...], unknown: [...] }, strongest first. Rows with an unexpected status are ignored. */
export function groupByStatus(rows) {
  const out = { confirmed: [], potential: [], unknown: [] };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && FINDING_STATUS.indexOf(r.status) !== -1) out[r.status].push(r);
  }
  for (const k of FINDING_STATUS) out[k].sort(byWeight);
  return out;
}

/**
 * The recommended solution for a prospect.
 *   state 'blocked'  contact is blocked (do-not-contact or suppressed): NO recommendation is shown
 *   state 'none'     no research, or nothing confirmed was strong enough
 *   state 'ready'    the pipeline's chosen opportunity (the row marked is_primary)
 */
export function recommendation(rows, blocked) {
  if (blocked) return { state: 'blocked', primary: null };
  const run = latestRun(rows);
  if (run.length === 0) return { state: 'none', primary: null, reason: 'No research has been stored for this prospect yet.' };
  const primary = run.find((r) => r.is_primary === true && r.status === 'confirmed') || null;
  if (!primary) return { state: 'none', primary: null, reason: 'Research is stored, but no confirmed opportunity was strong enough. Look at the findings by hand before any outreach.' };
  return { state: 'ready', primary, service: primary.service, solution: primary.recommended_solution, impact: primary.impact_note };
}

export function countByStatus(rows) {
  const g = groupByStatus(rows);
  return { confirmed: g.confirmed.length, potential: g.potential.length, unknown: g.unknown.length };
}

/**
 * The six-step path: Prospect -> Research Findings -> Recommended Solution -> AI Draft -> My Approval -> Secure Sender.
 * Each step is { key, label, state, note } with state done | waiting | todo | blocked.
 *   input: { findingsAvailable, findings (rows for this prospect), blocked, initialMessage (or null), senderNote (or null) }
 */
export function launchPath(input) {
  const run = latestRun(input.findings);
  const counts = countByStatus(run);
  const rec = recommendation(input.findings, input.blocked);
  const m = input.initialMessage || null;
  const steps = [];
  const add = (key, label, state, note) => steps.push({ key: key, label: label, state: state, note: note });

  add('prospect', 'Prospect', 'done', 'Human-verified record in the CRM.');

  if (input.findingsAvailable === false) add('research', 'Research findings', 'todo', 'The findings table is not installed yet.');
  else if (run.length) add('research', 'Research findings', 'done', counts.confirmed + ' confirmed, ' + counts.potential + ' potential, ' + counts.unknown + ' unknown.');
  else add('research', 'Research findings', 'todo', 'No research stored yet.');

  if (rec.state === 'blocked') add('recommendation', 'Recommended solution', 'blocked', 'Contact is blocked for this prospect. No recommendation is made.');
  else if (rec.state === 'ready') add('recommendation', 'Recommended solution', 'done', rec.service + '.');
  else add('recommendation', 'Recommended solution', 'todo', rec.reason || 'Waiting for research.');

  if (input.blocked) add('draft', 'AI draft', 'blocked', 'No outreach for a blocked prospect.');
  else if (m) add('draft', 'AI draft', 'done', 'A draft is stored (status: ' + (m.status || 'unknown') + ').');
  else add('draft', 'AI draft', 'todo', 'No draft yet.');

  if (!m) add('approval', 'My approval', 'todo', 'Nothing to approve yet.');
  else if (m.rejected_at || m.status === 'cancelled') add('approval', 'My approval', 'blocked', 'Rejected or cancelled.');
  else if (m.status === 'draft' && !m.approved) add('approval', 'My approval', 'waiting', 'Waiting for you in the Approval Queue. Nothing is approved until you click Approve.');
  else add('approval', 'My approval', 'done', 'Approved.');

  if (!m) add('sender', 'Secure sender', 'todo', 'Not started.');
  else if (m.sent_at || m.status === 'sent') add('sender', 'Secure sender', 'done', 'Sent by the sender workflow.');
  else if (m.status === 'approved' || m.status === 'scheduled') add('sender', 'Secure sender', 'waiting', input.senderNote || 'Approved. Waiting for the sender workflow (n8n) to pick it up.');
  else add('sender', 'Secure sender', 'todo', 'Starts only after you approve.');
  return steps;
}

/**
 * Step 613: a reminder, shown in the Approve dialog, when the message body has no opt-out line or no postal address.
 * It is only a warning (the database stays the authority, and you decide). It checks the SHAPE only (opt-out wording
 * and a US street/ZIP or PO Box), so no business address or private data is stored in this public repo.
 * Returns the list of things that look missing (empty = looks fine).
 */
export function footerWarnings(body) {
  const t = String(body === undefined || body === null ? '' : body);
  const out = [];
  if (!/(unsubscribe|opt[- ]?out|\bSTOP\b|would rather not|do not wish|prefer not to (?:receive|get|hear))/i.test(t)) out.push('an opt-out line (for example: reply "unsubscribe")');
  if (!/(\d{1,6}\s+[A-Za-z0-9 .,'#\n-]{2,}\b[A-Z]{2}\s+\d{5}|P\.?\s?O\.?\s+Box\s+\d+)/.test(t)) out.push('a postal address');
  return out;
}
