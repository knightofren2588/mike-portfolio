// Approval Queue.
//
// Four sections: Awaiting approval, Approved / waiting to send, Failed, Sent / historical.
//
// PHONE LAYOUT (<= 960px) is built for fast decisions. A card shows only who it is, what the message is, and the
// buttons. Everything else sits behind real disclosure buttons ("Preview message", "More details", "View details")
// and each section can be collapsed. Above 960px nothing is hidden: the toggles disappear and every body is
// visible, so the desktop card keeps its full detail. Which parts are collapsed is decided by cc.css, not here.
//
// SAFETY: a do-not-contact warning is never behind a disclosure. Approve / Edit / Reject are never behind one either.
// Approve is disabled (with the reason shown) when the database would refuse it; the database re-checks every rule.
// Controls appear ONLY on drafts awaiting approval. Nothing here sends email: approving only changes database
// state, and n8n is responsible for sending. All text from the database is placed with textContent only.

import { h, notice, badge, textBlock, emptyState, fmtRange, fmtDateTime } from '../dom.js';
import {
  isAwaitingApproval, isApprovedWaiting, senderWarning, approvalBlocker, isApprovableType, isDoNotContact, isSuppressed
} from '../api.js';
import { hrefProspect } from '../utilities/query.js';
import { messageTypeLabel } from '../utilities/labels.js';
import { onSessionEnd } from '../utilities/session.js';
import { messageStatusBadge, statusBadge, renderValue } from '../components/ui.js';
import { disclosure, collapsibleSection } from '../components/disclosure.js';
import { openApproveDialog, openEditDialog, openRejectDialog } from './queueDialogs.js';

// ---------- remembered open/closed state (this signed-in session only; wiped on sign-out) ----------
let ui = { sections: Object.create(null), cards: Object.create(null) };
onSessionEnd(() => {
  ui = { sections: Object.create(null), cards: Object.create(null) };
});

function cardState(id) {
  const key = String(id);
  if (!ui.cards[key]) ui.cards[key] = { preview: false, details: false, view: false };
  return ui.cards[key];
}

// ---------- small helpers ----------
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Label / value rows. Rows with no value are OMITTED (no large empty "—" rows). Returns null when nothing is left. */
function kv(rows) {
  const shown = rows.filter((row) => row && hasValue(row[1]));
  if (shown.length === 0) return null;
  const dl = h('dl', { class: 'cc-qkv' });
  shown.forEach((row) => {
    dl.appendChild(h('dt', { text: row[0] }));
    const dd = h('dd');
    if (row[1] instanceof Node) dd.appendChild(row[1]);
    else dd.textContent = String(row[1]);
    dl.appendChild(dd);
  });
  return dl;
}

function sub(title, node) {
  if (!node) return null;
  return h('div', { class: 'cc-qsub' }, h('h4', { class: 'cc-h4', text: title }), node);
}

function labeled(label, node) {
  return h('div', { class: 'cc-labeled' }, h('h4', { class: 'cc-h4', text: label }), node);
}

/** Approve / Edit / Reject for one DRAFT. Never behind a disclosure. (Unchanged behaviour.) */
function draftControls(message, prospect, snap, ctx) {
  const approvable = isApprovableType(message.message_type);
  const blocker = approvable ? approvalBlocker(snap, message, prospect) : null;

  const edit = h('button', { type: 'button', class: 'cc-btn', text: 'Edit' });
  const reject = h('button', { type: 'button', class: 'cc-btn cc-btn-danger', text: 'Reject' });
  edit.addEventListener('click', () => openEditDialog(message, prospect, ctx));
  reject.addEventListener('click', () => openRejectDialog(message, prospect, ctx));

  const buttons = [];
  if (approvable) {
    const approve = h('button', {
      type: 'button', class: 'cc-btn cc-btn-primary', text: 'Approve',
      disabled: blocker !== null, title: blocker
    });
    approve.addEventListener('click', () => {
      if (blocker === null) openApproveDialog(message, prospect, ctx);
    });
    buttons.push(approve);
  }
  buttons.push(edit, reject);

  return h('div', { class: 'cc-actions' },
    h('div', { class: 'cc-actions-row' }, buttons),
    blocker ? h('p', { class: 'cc-blocked-note', text: 'Approve is disabled: ' + blocker }) : null,
    approvable ? null : h('p', { class: 'cc-muted', text:
      message.message_type === 'reply'
        ? 'Reply drafts cannot be approved from Command Center. You can still edit or reject this draft.'
        : 'This message type cannot be approved from Command Center. You can still edit or reject this draft.' })
  );
}

// ---------- the parts that sit behind disclosures ----------

/** Full subject + full email body + what has happened to the message. */
function previewBody(message) {
  const history = [
    'Drafted ' + fmtDateTime(message.created_at),
    message.edited_at ? 'edited ' + fmtDateTime(message.edited_at) : null,
    message.approved_at ? 'approved ' + fmtDateTime(message.approved_at) : null,
    message.rejected_at ? 'rejected ' + fmtDateTime(message.rejected_at) : null,
    message.scheduled_at ? 'scheduled ' + fmtDateTime(message.scheduled_at) : null,
    message.sent_at ? 'sent ' + fmtDateTime(message.sent_at) : null
  ].filter(Boolean).join(' · ');

  return h('div', { class: 'cc-qprev' },
    h('p', { class: 'cc-subject cc-qprev-subject', text: message.subject || '(no subject)' }),
    textBlock(message.body),
    hasValue(message.rejection_reason) ? labeled('Rejection reason', textBlock(message.rejection_reason)) : null,
    h('p', { class: 'cc-card-foot cc-muted', text: history })
  );
}

/** Prospect / Research / Contact state, compact, with empty fields left out. */
function detailSections(prospect, snap) {
  if (!prospect) return h('p', { class: 'cc-muted', text: 'The prospect record could not be found.' });
  const p = prospect;
  const location = [p.city, p.state].filter(Boolean).join(', ');
  const estimated = fmtRange(p.estimated_value_min, p.estimated_value_max);

  const prospectRows = kv([
    ['Phone', p.contact_phone],
    ['Industry', p.industry],
    ['Location', location],
    ['Website', p.website],
    ['Status', statusBadge(p.status)],
    ['Est. value', estimated === '—' ? null : estimated],
    ['Next follow-up', p.next_followup_at ? fmtDateTime(p.next_followup_at) : null],
    ['Last contact', p.last_contact_at ? fmtDateTime(p.last_contact_at) : null]
  ]);

  const research = [
    ['Pain point', p.pain_point, textBlock],
    ['Evidence', p.evidence, renderValue],
    ['Proposed offer', p.proposed_offer, textBlock]
  ].filter((r) => hasValue(r[1]));
  const researchNode = research.length
    ? h('div', {}, research.map((r) => labeled(r[0], r[2](r[1]))))
    : null;

  const contactRows = kv([
    ['Approved to contact', p.approved_to_contact ? 'Yes' : 'No'],
    ['Do not contact', isDoNotContact(p) ? 'Yes' : 'No'],
    ['On suppression list', isSuppressed(snap, p.contact_email) ? 'Yes' : 'No'],
    ['Replied', p.replied_at ? fmtDateTime(p.replied_at) : null],
    ['Follow-ups sent', Number(p.followup_count) > 0 ? String(p.followup_count) : null]
  ]);

  return h('div', { class: 'cc-qdetails' },
    sub('Prospect', prospectRows),
    sub('Research', researchNode),
    sub('Contact state', contactRows)
  );
}

/** The one-line "what happened and when" under the subject. */
function whenLine(message, kind) {
  if (message.status === 'sent' && message.sent_at) return 'Sent ' + fmtDateTime(message.sent_at);
  if (message.status === 'cancelled') return 'Cancelled ' + fmtDateTime(message.rejected_at || message.created_at);
  if (message.status === 'scheduled' && message.scheduled_at) return 'Scheduled ' + fmtDateTime(message.scheduled_at);
  if (kind === 'waiting' && message.approved_at) return 'Approved ' + fmtDateTime(message.approved_at);
  return 'Drafted ' + fmtDateTime(message.created_at);
}

// ---------- one card ----------
// kind: 'awaiting' | 'waiting' | 'failed' | 'history'
function queueCard(message, prospect, snap, ctx, kind) {
  const p = prospect || {};
  const dnc = !!prospect && isDoNotContact(p);
  const actionable = kind === 'awaiting' || kind === 'waiting';
  const title = prospect ? (p.company_name || '(unnamed company)') : 'Unknown prospect (' + message.prospect_id + ')';
  const state = cardState(message.id);
  const cid = 'cc-q-' + String(message.id).replace(/[^A-Za-z0-9_-]/g, '');

  const badges = [badge(messageTypeLabel(message.message_type), 'type'), messageStatusBadge(message.status)];
  if (actionable && prospect && p.lead_score !== null && p.lead_score !== undefined) badges.push(badge('Score ' + p.lead_score, 'score'));
  if (dnc) badges.push(badge('Do not contact', 'danger'));

  const card = h('article', { class: 'cc-card cc-qcard cc-qcard-' + kind },
    h('header', { class: 'cc-qhead' },
      // The company name opens the full prospect page (the whole history in one place).
      prospect
        ? h('h3', { class: 'cc-h3' }, h('a', { class: 'cc-link-strong', href: hrefProspect(p.id), text: title }))
        : h('h3', { class: 'cc-h3', text: title }),
      h('div', { class: 'cc-badges' }, badges)
    )
  );

  // Safety warning: always visible, never inside a disclosure.
  if (dnc) {
    card.appendChild(notice('error', 'DO NOT CONTACT: this prospect is marked do-not-contact. Do not send anything to them.'));
  }

  if (actionable && prospect && (hasValue(p.contact_name) || hasValue(p.contact_email))) {
    card.appendChild(h('div', { class: 'cc-qcontact' },
      hasValue(p.contact_name) ? h('span', { class: 'cc-qname', text: p.contact_name }) : null,
      hasValue(p.contact_email) ? h('span', { class: 'cc-qemail cc-muted', text: p.contact_email }) : null
    ));
  }

  card.appendChild(h('p', { class: 'cc-subject cc-qsubject', text: message.subject || '(no subject)' }));
  card.appendChild(h('p', { class: 'cc-qwhen cc-muted', text: whenLine(message, kind) }));

  const warning = kind === 'waiting' ? senderWarning(message.message_type) : null;
  if (warning) card.appendChild(notice('warn', warning));

  // Approve / Edit / Reject: right under the summary, no expanding required.
  if (kind === 'awaiting') card.appendChild(draftControls(message, prospect, snap, ctx));

  if (actionable) {
    card.appendChild(disclosure({
      id: cid + '-preview', label: 'Preview message', open: state.preview,
      onToggle: (open) => { state.preview = open; }, body: previewBody(message)
    }));
    card.appendChild(disclosure({
      id: cid + '-details', label: 'More details', open: state.details,
      onToggle: (open) => { state.details = open; }, body: detailSections(prospect, snap)
    }));
  } else {
    card.appendChild(disclosure({
      id: cid + '-view', label: 'View details', open: state.view,
      onToggle: (open) => { state.view = open; },
      body: h('div', {}, previewBody(message), detailSections(prospect, snap))
    }));
  }
  return card;
}

function byNewest(a, b) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

const SECTIONS = [
  ['awaiting', 'Awaiting approval', 'No drafts are waiting for approval.'],
  ['waiting', 'Approved / waiting to send', 'Nothing is approved and waiting.'],
  ['failed', 'Failed', 'No failed messages.'],
  ['history', 'Sent / historical', 'No sent or cancelled messages.']
];

export function render(container, ctx) {
  const snap = ctx.snap;

  container.appendChild(h('h1', { class: 'cc-h1', text: 'Approval Queue' }));
  container.appendChild(notice('info',
    'Approving a draft only marks it ready: n8n sends it. Command Center never sends email itself.'));

  const groups = { awaiting: [], waiting: [], failed: [], history: [] };
  snap.messages.slice().sort(byNewest).forEach((m) => {
    if (isAwaitingApproval(m)) groups.awaiting.push(m);
    else if (isApprovedWaiting(m) || m.status === 'scheduled') groups.waiting.push(m);
    else if (m.status === 'failed') groups.failed.push(m);
    else groups.history.push(m);
  });

  const prospectOf = (m) => snap.prospectsById.get(String(m.prospect_id));

  SECTIONS.forEach((def) => {
    const key = def[0];
    const items = groups[key];
    const body = items.length
      ? items.map((m) => queueCard(m, prospectOf(m), snap, ctx, key))
      : emptyState(def[2]);
    // Phone defaults: open when there is something in it, except history, which starts closed.
    // Once you open or close a section, that choice is kept while you stay signed in.
    const open = Object.prototype.hasOwnProperty.call(ui.sections, key) ? ui.sections[key] : (key !== 'history' && items.length > 0);
    container.appendChild(collapsibleSection({
      id: 'cc-qs-' + key, title: def[1], count: items.length, body: body, open: open,
      onToggle: (isOpen) => { ui.sections[key] = isOpen; }
    }));
  });
}
