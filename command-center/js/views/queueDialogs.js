// The three confirmation / edit dialogs for the Approval Queue.
// Everything shown comes from the database and is treated as untrusted: it is only ever placed in
// the page as text (textContent / textarea.value), never as HTML.

import { h, notice, factList, humanize } from '../dom.js';
import { openModal } from '../modal.js';
import { approveMessage, rejectMessage, editDraft } from '../actions.js';
import { senderWarning } from '../api.js';
import { LIMITS } from '../config.js';

function companyOf(prospect) {
  return prospect ? (prospect.company_name || '(unnamed company)') : 'Unknown prospect';
}

function contactOf(prospect) {
  if (!prospect) return null;
  const parts = [prospect.contact_name, prospect.contact_email].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function summary(message, prospect) {
  return factList([
    ['Company', companyOf(prospect)],
    ['Contact', contactOf(prospect)],
    ['Message type', humanize(message.message_type)],
    ['Subject', message.subject || '(blank)']
  ]);
}

/**
 * Runs `work` with the modal locked. On success: closes the dialog, shows a banner, reloads data.
 * On failure: keeps the dialog open with the error, and marks the screen to refresh when it closes
 * if the data on screen may be out of date (someone/something changed the message meanwhile).
 */
async function runAction(modal, ctx, state, work, successText) {
  modal.setError('');
  modal.setBusy(true);
  try {
    await work();
  } catch (err) {
    if (err && err.authExpired) {
      // The session is gone. Close this dialog and go to the sign-in screen; never leave a write dialog on screen.
      modal.close();
      ctx.sessionExpired();
      return;
    }
    modal.setBusy(false);
    modal.setError(err && err.message ? err.message : 'Something went wrong. Nothing was changed.');
    if (err && (err.stale || err.authExpired)) state.reloadOnClose = true;
    return;
  }
  state.reloadOnClose = false;
  ctx.flash('success', successText);
  modal.close();
  ctx.reload();
}

export function openApproveDialog(message, prospect, ctx) {
  const state = { reloadOnClose: false };

  const content = h('div', {},
    h('p', { class: 'cc-muted', text: 'This marks the draft as approved so n8n can pick it up and send it. Nothing is sent from this page.' }),
    summary(message, prospect),
    senderWarning(message.message_type) ? notice('warn', senderWarning(message.message_type)) : null
  );

  openModal({
    title: 'Approve this message?',
    content: content,
    onClose: () => { if (state.reloadOnClose) ctx.reload(); },
    actions: [
      { label: 'Cancel', onClick: (modal) => modal.close() },
      {
        label: 'Approve message',
        kind: 'primary',
        onClick: (modal) => runAction(modal, ctx, state,
          () => approveMessage(message.id),
          'Approved: ' + companyOf(prospect) + ' — "' + (message.subject || '(blank subject)') + '". It is now queued for n8n to send; nothing was sent from this page.')
      }
    ]
  });
}

export function openRejectDialog(message, prospect, ctx) {
  const state = { reloadOnClose: false };
  const reason = h('textarea', { id: 'cc-reject-reason', rows: '3', maxlength: String(LIMITS.reason) });

  const content = h('div', {},
    h('p', { class: 'cc-muted', text: 'The draft is cancelled. The prospect is not changed, closed or deleted.' }),
    summary(message, prospect),
    h('div', { class: 'cc-modal-field' },
      h('label', { for: 'cc-reject-reason', text: 'Reason (optional)' }),
      reason
    )
  );

  openModal({
    title: 'Reject this draft?',
    content: content,
    onClose: () => { if (state.reloadOnClose) ctx.reload(); },
    actions: [
      { label: 'Cancel', onClick: (modal) => modal.close() },
      {
        label: 'Reject draft',
        kind: 'danger',
        onClick: (modal) => runAction(modal, ctx, state,
          () => rejectMessage(message.id, reason.value),
          'Rejected: ' + companyOf(prospect) + ' — "' + (message.subject || '(blank subject)') + '" was cancelled.')
      }
    ]
  });
}

export function openEditDialog(message, prospect, ctx) {
  const state = { reloadOnClose: false };
  const originalSubject = message.subject === null || message.subject === undefined ? '' : String(message.subject);
  const originalBody = message.body === null || message.body === undefined ? '' : String(message.body);

  const subject = h('input', { id: 'cc-edit-subject', type: 'text', maxlength: String(LIMITS.subject), spellcheck: 'true' });
  const body = h('textarea', { id: 'cc-edit-body', rows: '14', maxlength: String(LIMITS.body), spellcheck: 'true' });
  subject.value = originalSubject; // property assignment: the text is never parsed as HTML
  body.value = originalBody;

  const counter = h('p', { class: 'cc-muted cc-counter' });

  const content = h('div', {},
    h('p', { class: 'cc-muted', text: 'Editing does not approve the message. You can still approve or reject it afterwards.' }),
    h('p', { class: 'cc-muted', text: companyOf(prospect) + (contactOf(prospect) ? ' · ' + contactOf(prospect) : '') + ' · ' + humanize(message.message_type) }),
    h('div', { class: 'cc-modal-field' }, h('label', { for: 'cc-edit-subject', text: 'Subject (may be blank)' }), subject),
    h('div', { class: 'cc-modal-field' }, h('label', { for: 'cc-edit-body', text: 'Body (required)' }), body),
    counter
  );

  let saveButton = null;
  function validate() {
    const bodyOk = body.value.trim() !== '';
    const changed = subject.value.trim() !== originalSubject.trim() || body.value.trim() !== originalBody.trim();
    counter.textContent = body.value.length + ' / ' + LIMITS.body + ' characters in the body' +
      (bodyOk ? '' : ' · the body cannot be empty') + (changed ? '' : ' · no changes yet');
    if (saveButton) saveButton.disabled = !(bodyOk && changed);
  }
  subject.addEventListener('input', validate);
  body.addEventListener('input', validate);

  const modal = openModal({
    title: 'Edit draft',
    content: content,
    // Re-apply validation whenever the dialog stops being "busy" (setBusy(false) re-enables everything).
    onIdle: () => validate(),
    onClose: () => { if (state.reloadOnClose) ctx.reload(); },
    actions: [
      { label: 'Cancel', onClick: (m) => m.close() },
      {
        label: 'Save changes',
        kind: 'primary',
        onClick: (m) => runAction(m, ctx, state,
          () => editDraft(message.id, subject.value, body.value),
          'Draft updated for ' + companyOf(prospect) + '. It is still unapproved.')
      }
    ]
  });
  saveButton = modal.buttons[1];
  validate();
}
