// Prospects: search, filter, sort. Filter state lives in the URL (#/prospects?q=acme&status=sent) so a view
// can be bookmarked or shared with yourself, and the Reset button clears it.
//
// READ-ONLY. Every value shown is database text, placed on the page with textContent only.
// The URL is untrusted input: each parameter is checked against an allowlist before it is used.

import { h, clear, notice, fmtRange, fmtRelative } from '../dom.js';
import { isFollowupDue, isDoNotContact } from '../api.js';
import { statusLabel, PROSPECT_STATUSES } from '../utilities/labels.js';
import { fmtDate, fmtFull } from '../utilities/format.js';
import { buildHash, pickEnum, pickText, hrefProspect } from '../utilities/query.js';
import {
  FILTER_DEFAULTS, STATUS_OPTIONS, DNC_OPTIONS, APPROVED_OPTIONS, SCOPE_OPTIONS, DUE_OPTIONS, REPLIED_OPTIONS,
  SORT_KEYS, filterProspects, sortProspects, isDefaultFilters
} from '../utilities/derive.js';
import { statusBadge, dncBadge, scorePill, emptyBlock } from '../components/ui.js';
import { PROSPECT_PAGE_SIZE } from '../config.js';

function readFilters(params) {
  return {
    q: pickText(params.q, 100),
    status: pickEnum(params.status, STATUS_OPTIONS, FILTER_DEFAULTS.status),
    dnc: pickEnum(params.dnc, DNC_OPTIONS, FILTER_DEFAULTS.dnc),
    approved: pickEnum(params.approved, APPROVED_OPTIONS, FILTER_DEFAULTS.approved),
    scope: pickEnum(params.scope, SCOPE_OPTIONS, FILTER_DEFAULTS.scope),
    due: pickEnum(params.due, DUE_OPTIONS, FILTER_DEFAULTS.due),
    replied: pickEnum(params.replied, REPLIED_OPTIONS, FILTER_DEFAULTS.replied),
    sort: pickEnum(params.sort, SORT_KEYS, FILTER_DEFAULTS.sort)
  };
}

function toParams(f) {
  const out = {};
  Object.keys(FILTER_DEFAULTS).forEach((key) => {
    if (f[key] !== FILTER_DEFAULTS[key]) out[key] = f[key];
  });
  return out;
}

function makeSelect(id, options, value) {
  const el = h('select', { id: id });
  options.forEach((option) => el.appendChild(h('option', { value: option[0], text: option[1] })));
  el.value = value;
  return el;
}

function field(id, label, control, extraClass) {
  return h('div', { class: 'cc-field' + (extraClass ? ' ' + extraClass : '') }, h('label', { for: id, text: label }), control);
}

export function render(container, ctx) {
  const snap = ctx.snap;
  const now = new Date();
  const initial = readFilters(ctx.route.params);
  let visible = PROSPECT_PAGE_SIZE;
  let searchTimer = null;

  container.appendChild(h('h1', { class: 'cc-h1', text: 'Prospects' }));

  if (snap.truncated.prospects) {
    container.appendChild(notice('warn', 'Only the newest prospects were loaded, so this list may be incomplete.'));
  }
  if (snap.prospects.length === 0) {
    container.appendChild(emptyBlock(
      'No prospects are visible.',
      'Either the CRM is empty, or this session is not authorized to read it (it must be your allowlisted admin account).'
    ));
    return;
  }

  // ----- controls -----
  const countsByStatus = new Map();
  snap.prospects.forEach((p) => countsByStatus.set(p.status, (countsByStatus.get(p.status) || 0) + 1));

  const search = h('input', {
    id: 'cc-p-q', type: 'search', maxlength: '100', placeholder: 'Company, contact or email',
    autocomplete: 'off', spellcheck: 'false'
  });
  search.value = initial.q;

  const statusSel = makeSelect('cc-p-status',
    [['', 'All statuses']].concat(PROSPECT_STATUSES.map((s) => [s, statusLabel(s) + ' (' + (countsByStatus.get(s) || 0) + ')'])),
    initial.status);
  const scopeSel = makeSelect('cc-p-scope', [['all', 'All prospects'], ['active', 'Active only']], initial.scope);
  const dncSel = makeSelect('cc-p-dnc', [['any', 'Any'], ['only', 'Do-not-contact only'], ['exclude', 'Hide do-not-contact']], initial.dnc);
  const approvedSel = makeSelect('cc-p-approved', [['any', 'Any'], ['yes', 'Approved'], ['no', 'Not approved']], initial.approved);
  const dueSel = makeSelect('cc-p-due', [['any', 'Any'], ['yes', 'Due now or overdue (approx.)']], initial.due);
  const repliedSel = makeSelect('cc-p-replied', [['any', 'Any'], ['yes', 'Replied'], ['no', 'Not replied']], initial.replied);
  const sortSel = makeSelect('cc-p-sort', [
    ['newest', 'Newest first'], ['score', 'Lead score (high first)'],
    ['value', 'Estimated value (high first)'], ['followup', 'Next follow-up (soonest first)']
  ], initial.sort);

  const resetBtn = h('button', { type: 'button', class: 'cc-btn', text: 'Reset filters' });
  const summary = h('p', { class: 'cc-muted cc-results-summary', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'cc-results' });

  container.appendChild(h('div', { class: 'cc-filters', role: 'search', 'aria-label': 'Filter prospects' },
    field('cc-p-q', 'Search', search, 'cc-field-wide'),
    field('cc-p-status', 'Status', statusSel),
    field('cc-p-scope', 'Show', scopeSel),
    field('cc-p-dnc', 'Do not contact', dncSel),
    field('cc-p-approved', 'Approved to contact', approvedSel),
    field('cc-p-due', 'Follow-up', dueSel),
    field('cc-p-replied', 'Replies', repliedSel),
    field('cc-p-sort', 'Sort by', sortSel),
    h('div', { class: 'cc-field cc-field-action' }, resetBtn)
  ));
  container.appendChild(summary);
  container.appendChild(results);

  function collect() {
    return {
      q: pickText(search.value, 100),
      status: pickEnum(statusSel.value, STATUS_OPTIONS, ''),
      dnc: pickEnum(dncSel.value, DNC_OPTIONS, 'any'),
      approved: pickEnum(approvedSel.value, APPROVED_OPTIONS, 'any'),
      scope: pickEnum(scopeSel.value, SCOPE_OPTIONS, 'all'),
      due: pickEnum(dueSel.value, DUE_OPTIONS, 'any'),
      replied: pickEnum(repliedSel.value, REPLIED_OPTIONS, 'any'),
      sort: pickEnum(sortSel.value, SORT_KEYS, 'newest')
    };
  }

  // Keep the address bar in step with the filters WITHOUT triggering a re-render (replaceState fires no hashchange).
  function syncUrl(current) {
    if (!results.isConnected) return; // this view has already been replaced by another screen
    try {
      window.history.replaceState(null, '', buildHash(['prospects'], toParams(current)));
    } catch (e) {
      /* some environments disallow it; the filters still work */
    }
  }

  function whenCell(label, value, overdue) {
    if (!value) return h('td', { 'data-label': label, class: 'cc-muted', text: '—' });
    return h('td', { 'data-label': label },
      h('div', { class: 'cc-when' + (overdue ? ' cc-when-overdue' : ''), title: fmtFull(value) },
        h('span', { text: fmtDate(value, now) }),
        h('span', { class: 'cc-muted cc-when-rel', text: fmtRelative(value, now) }),
        overdue ? h('span', { class: 'cc-when-flag', text: 'Due' }) : null
      )
    );
  }

  function buildRow(p) {
    const sub = [p.industry, [p.city, p.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    const row = h('tr', { class: 'cc-row-click' },
      h('td', { class: 'cc-cell-company', 'data-label': 'Company' },
        h('a', { class: 'cc-link-strong', href: hrefProspect(p.id), text: p.company_name || '(unnamed company)' }),
        isDoNotContact(p) ? ' ' : null,
        isDoNotContact(p) ? dncBadge() : null,
        sub ? h('div', { class: 'cc-muted cc-cell-sub', text: sub }) : null
      ),
      h('td', { 'data-label': 'Contact', text: p.contact_name || '—' }),
      h('td', { 'data-label': 'Email', class: 'cc-cell-email', text: p.contact_email || '—' }),
      h('td', { 'data-label': 'Status' }, statusBadge(p.status)),
      h('td', { 'data-label': 'Score' }, scorePill(p.lead_score)),
      h('td', { 'data-label': 'Est. value', text: fmtRange(p.estimated_value_min, p.estimated_value_max) }),
      whenCell('Next follow-up', p.next_followup_at, isFollowupDue(p, now)),
      whenCell('Last contact', p.last_contact_at, false)
    );
    row.addEventListener('click', (event) => {
      if (event.target && event.target.closest && event.target.closest('a')) return; // the link handles itself
      window.location.hash = hrefProspect(p.id);
    });
    return row;
  }

  function buildTable(rows) {
    const body = h('tbody', {});
    rows.slice(0, visible).forEach((p) => body.appendChild(buildRow(p)));
    const headers = ['Company', 'Contact', 'Email', 'Status', 'Score', 'Est. value', 'Next follow-up', 'Last contact'];
    return h('div', { class: 'cc-table-wrap' },
      h('table', { class: 'cc-table cc-ptable' },
        h('caption', { class: 'cc-sr-only', text: 'Prospects' }),
        h('thead', {}, h('tr', {}, headers.map((text) => h('th', { scope: 'col', text: text })))),
        body
      )
    );
  }

  function resetAll() {
    search.value = '';
    statusSel.value = FILTER_DEFAULTS.status;
    scopeSel.value = FILTER_DEFAULTS.scope;
    dncSel.value = FILTER_DEFAULTS.dnc;
    approvedSel.value = FILTER_DEFAULTS.approved;
    dueSel.value = FILTER_DEFAULTS.due;
    repliedSel.value = FILTER_DEFAULTS.replied;
    sortSel.value = FILTER_DEFAULTS.sort;
    redraw(true);
    search.focus();
  }
  resetBtn.addEventListener('click', resetAll);

  function redraw(resetPaging) {
    if (resetPaging) visible = PROSPECT_PAGE_SIZE;
    const current = collect();
    const rows = sortProspects(filterProspects(snap.prospects, current, now), current.sort);

    summary.textContent = rows.length === snap.prospects.length
      ? 'Showing ' + Math.min(visible, rows.length) + ' of ' + rows.length + ' prospects'
      : 'Showing ' + Math.min(visible, rows.length) + ' of ' + rows.length + ' matching prospects (' + snap.prospects.length + ' total)';
    resetBtn.disabled = isDefaultFilters(current);

    clear(results);
    if (rows.length === 0) {
      const again = h('button', { type: 'button', class: 'cc-btn', text: 'Reset filters' });
      again.addEventListener('click', resetAll);
      results.appendChild(emptyBlock('No prospects match these filters.', 'Try a different search, or clear the filters.', again));
    } else {
      results.appendChild(buildTable(rows));
      if (rows.length > visible) {
        const remaining = rows.length - visible;
        const more = h('button', {
          type: 'button', class: 'cc-btn cc-show-more',
          text: 'Show ' + Math.min(PROSPECT_PAGE_SIZE, remaining) + ' more (' + remaining + ' remaining)'
        });
        more.addEventListener('click', () => {
          const firstNew = visible;
          visible += PROSPECT_PAGE_SIZE;
          redraw(false);
          const links = results.querySelectorAll('tbody a.cc-link-strong');
          if (links[firstNew]) links[firstNew].focus();
        });
        results.appendChild(h('div', { class: 'cc-more-row' }, more));
      }
    }
    syncUrl(current);
  }

  // Selects apply immediately; typing waits a moment so every keystroke does not redraw.
  [statusSel, scopeSel, dncSel, approvedSel, dueSel, repliedSel, sortSel].forEach((el) => {
    el.addEventListener('change', () => redraw(true));
  });
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (results.isConnected) redraw(true);
    }, 150);
  });

  redraw(true);
}
