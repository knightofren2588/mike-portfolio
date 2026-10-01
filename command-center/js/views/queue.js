// Approval Queue.
//
// Controls (Approve / Edit / Reject) appear ONLY on drafts that are still awaiting approval.
// Approved and other messages are display-only. Nothing here sends email: approving only changes
// database state, and n8n is responsible for sending.
//
// The disabled-Approve rules (do-not-contact, no email, suppressed) are a convenience for fast
// feedback. The database function re-checks every one of them, so the UI is not the security boundary.

import {
  h, notice, section, badge, textBlock, factList, emptyState, fmtRange, fmtDateTime, humanize
} from '../dom.js';
import { isAwaitingApproval, isApprovedWaiting, isHandledBySender, approvalBlocker, isApprovableType } from '../api.js';
import { N8N_SENDER_MESSAGE_TYPES } from '../config.js';
import { openApproveDialog, openEditDialog, openRejectDialog } from './queueDialogs.js';

/** Shared with the pipeline detail view. Everything is shown as plain text. */
export function prospectFacts(p) {
  const location = [p.city, p.state].filter(Boolean).join(', ');
  return factList([
    ['Contact', p.contact_name],
    ['Email', p.contact_email],
    ['Phone', p.contact_phone],
    ['Industry', p.industry],
    ['Location', location || null],
    ['Website', p.website],
    ['Status', humanize(p.status)],
    ['Lead score', p.lead_score],
    ['Estimated value', fmtRange(p.estimated_value_min, p.estimated_value_max)],
    ['Approved to contact', p.approved_to_contact ? 'Yes' : 'No'],
    ['Do not contact', p.do_not_contact ? 'Yes' : 'No'],
    ['Follow-ups sent', p.followup_count],
    ['Next follow-up', fmtDateTime(p.next_followup_at)],
    ['Replied', fmtDateTime(p.replied_at)]
  ]);
}

function labeledBlock(label, value) {
  return h('div', { class: 'cc-labeled' },
    h('h4', { class: 'cc-h4', text: label }),
    textBlock(value)
  );
}

/**
 * Edit / Reject for any DRAFT; Approve only for message types that can be approved at all.
 * A reply (or any unexpected type) never shows an Approve action. For approvable types, Approve is
 * disabled (with the reason shown) when the database would refuse it.
 */
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

/** One message with its prospect's research. `controls` is optional (drafts only). */
export function messageCard(message, prospect, options) {
  const opts = options || {};
  const p = prospect || {};
  const title = prospect ? (p.company_name || '(unnamed company)') : 'Unknown prospect (' + message.prospect_id + ')';

  const badges = [
    badge(humanize(message.message_type), 'type'),
    badge(humanize(message.status), 'status')
  ];
  if (prospect && p.lead_score !== null && p.lead_score !== undefined) badges.push(badge('Score ' + p.lead_score, 'score'));
  if (prospect && p.do_not_contact) badges.push(badge('Do not contact', 'danger'));

  const card = h('article', { class: 'cc-card' },
    h('header', { class: 'cc-card-head' },
      h('h3', { class: 'cc-h3', text: title }),
      h('div', { class: 'cc-badges' }, badges)
    )
  );

  if (prospect && p.do_not_contact) {
    card.appendChild(notice('error', 'DO NOT CONTACT: this prospect is marked do-not-contact. Do not send anything to them.'));
  }

  if (prospect) {
    card.appendChild(prospectFacts(p));
    card.appendChild(labeledBlock('Pain point', p.pain_point));
    card.appendChild(labeledBlock('Evidence', p.evidence));
    card.appendChild(labeledBlock('Proposed offer', p.proposed_offer));
  }

  card.appendChild(h('div', { class: 'cc-labeled' },
    h('h4', { class: 'cc-h4', text: 'Subject' }),
    h('p', { class: 'cc-subject', text: message.subject || '—' })
  ));
  card.appendChild(labeledBlock('Email body', message.body));

  // History of what has been done to this message (columns exist once the Phase 2 migration is applied).
  if (message.rejection_reason) card.appendChild(labeledBlock('Rejection reason', message.rejection_reason));
  const history = [
    'Drafted ' + fmtDateTime(message.created_at),
    message.edited_at ? 'edited ' + fmtDateTime(message.edited_at) : null,
    message.approved_at ? 'approved ' + fmtDateTime(message.approved_at) : null,
    message.rejected_at ? 'rejected ' + fmtDateTime(message.rejected_at) : null,
    message.scheduled_at ? 'scheduled ' + fmtDateTime(message.scheduled_at) : null,
    message.sent_at ? 'sent ' + fmtDateTime(message.sent_at) : null
  ].filter(Boolean).join(' · ');
  card.appendChild(h('p', { class: 'cc-card-foot cc-muted', text: history }));

  if (opts.note) card.appendChild(notice('warn', opts.note));
  if (opts.controls) card.appendChild(opts.controls);
  return card;
}

function byNewest(a, b) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function render(container, ctx) {
  const snap = ctx.snap;

  container.appendChild(h('h1', { class: 'cc-h1', text: 'Approval Queue' }));
  container.appendChild(notice('info',
    'Approving a draft only marks it ready: n8n sends it. Command Center never sends email itself.'));

  const drafts = snap.messages.filter(isAwaitingApproval).sort(byNewest);
  const waiting = snap.messages.filter(isApprovedWaiting).sort(byNewest);
  const others = snap.messages.filter((m) => !isAwaitingApproval(m) && !isApprovedWaiting(m)).sort(byNewest);

  const prospectOf = (m) => snap.prospectsById.get(String(m.prospect_id));

  container.appendChild(section('Awaiting approval (' + drafts.length + ')',
    drafts.length
      ? drafts.map((m) => messageCard(m, prospectOf(m), { controls: draftControls(m, prospectOf(m), snap, ctx) }))
      : emptyState('No drafts are waiting for approval.')
  ));

  container.appendChild(section('Approved, waiting for n8n to send (' + waiting.length + ')',
    waiting.length
      ? waiting.map((m) => messageCard(m, prospectOf(m), {
          note: isHandledBySender(m.message_type)
            ? null
            : 'n8n\'s sender currently only picks up: ' + N8N_SENDER_MESSAGE_TYPES.join(', ') +
              '. This "' + (m.message_type || 'unknown') + '" message will wait until the sender is extended.'
        }))
      : emptyState('Nothing is approved and waiting.')
  ));

  container.appendChild(section('All other messages (' + others.length + ')',
    others.length
      ? others.map((m) => messageCard(m, prospectOf(m)))
      : emptyState('No other messages.')
  ));
}
