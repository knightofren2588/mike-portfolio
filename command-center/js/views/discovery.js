// Discovery: businesses found in a public directory, ranked and staged by the research engine (Step 620).
// Filter state lives in the URL (#/discovery?region=ross-chillicothe&stage=awaiting_verification), like Prospects.
//
// READ-ONLY. These are NOT prospects and NOT human-verified. Nothing on this screen verifies, approves, contacts or stores anything;
// a business becomes a prospect only when you run the existing intake step after checking it yourself.
// Every value is database text placed on the page with textContent only. The URL is untrusted: each parameter is allowlisted.

import { h, clear, notice, badge } from '../dom.js';
import { buildHash, pickEnum, pickText, hrefDiscovery, hrefProspect } from '../utilities/query.js';
import { fmtDate, fmtFull } from '../utilities/format.js';
import { scorePill, emptyBlock, panel, stat } from '../components/ui.js';
import { discoveryHealthCard } from '../components/discoveryHealth.js';
import { annotate } from '../utilities/discoveryLink.js';
import { PROSPECT_PAGE_SIZE } from '../config.js';
import {
  STAGE_TEXT, CRM_TEXT, RESEARCH_TEXT, PHASE_TEXT, PHASES, PHASE_FILTERS, STAGE_FILTERS, CRM_FILTERS, RESEARCH_FILTERS, SHORTLIST_FILTERS, SORT_KEYS, FILTER_DEFAULTS,
  contactOf, stageOf, filterCandidates, sortCandidates, isDefaultFilters, facets, summarize, regionLabel, groupLabel, isAwaitingVerification
} from '../utilities/discovery.js';

export const title = 'Discovery';

function readFilters(params, fx) {
  return {
    q: pickText(params.q, 100),
    region: pickEnum(params.region, ['', ...fx.regions.map((r) => r[0])], ''),
    group: pickEnum(params.group, ['', ...fx.groups.map((g) => g[0])], ''),
    phase: pickEnum(params.phase, PHASE_FILTERS, ''),
    stage: pickEnum(params.stage, STAGE_FILTERS, ''),
    crm: pickEnum(params.crm, CRM_FILTERS, ''),
    research: pickEnum(params.research, RESEARCH_FILTERS, ''),
    shortlist: pickEnum(params.shortlist, SHORTLIST_FILTERS, 'any'),
    sort: pickEnum(params.sort, SORT_KEYS, 'score')
  };
}

const toParams = (f) => Object.fromEntries(Object.keys(FILTER_DEFAULTS).filter((k) => f[k] !== FILTER_DEFAULTS[k]).map((k) => [k, f[k]]));

function makeSelect(id, options, value) {
  const el = h('select', { id: id });
  options.forEach((o) => el.appendChild(h('option', { value: o[0], text: o[1] })));
  el.value = value;
  return el;
}
const field = (id, label, control, extra) => h('div', { class: 'cc-field' + (extra ? ' ' + extra : '') }, h('label', { for: id, text: label }), control);

export function render(container, ctx) {
  const d = ctx.discovery;
  container.appendChild(h('h1', { class: 'cc-h1', text: 'Discovery' }));
  container.appendChild(notice('info',
    'Businesses found in a public directory (Overture Maps) and checked against your CRM. Discovered and Researched businesses are NOT prospects and NOT verified. ' +
    'Research here reads at most 3 public pages per site. Nothing on this screen verifies, approves, contacts or stores anything: ' +
    'a business becomes a prospect only when you run intake after checking it yourself.'));

  if (!d || !d.available) {
    container.appendChild(emptyBlock(
      d && d.missing ? 'Discovery is not installed yet.' : 'Discovery data could not be read.',
      d && d.missing
        ? 'The staging tables (migration 33-discovery-staging) have not been applied to this database. Nothing is wrong; the rest of the Command Center is unaffected.'
        : 'This session may not be an allowlisted admin, or the database could not be reached. Try Refresh.'
    ));
    return;
  }
  if (d.truncated) container.appendChild(notice('warn', 'Only the first ' + d.rows.length + ' businesses were loaded, so this list may be incomplete.'));

  if (!d.rows.length) {   // installed, nothing staged yet (the schedule is off until it is switched on on purpose)
    container.appendChild(h('div', { class: 'cc-health-grid' }, discoveryHealthCard(d, new Date())));
    container.appendChild(emptyBlock('Discovery is installed and empty.', 'No businesses have been staged yet. The weekly pull fills this page, and until that schedule is switched on (a separate step) it stays empty. Nothing is wrong.'));
    return;
  }
  const rows = annotate(d.rows, ctx.snap);   // adds `phase` to copies; the loaded data is never modified
  const sum = summarize(rows, d.run);
  const fx = facets(rows);
  const initial = readFilters(ctx.route.params, fx);
  let visible = PROSPECT_PAGE_SIZE;
  let searchTimer = null;

  // ----- headline numbers -----
  const runText = sum.run ? [sum.run.release ? 'Overture ' + sum.run.release : null, sum.run.rulesVersion ? 'rules ' + sum.run.rulesVersion : null, sum.run.executor].filter(Boolean).join(' · ') : 'no run recorded';
  // ----- the four phases: who did the work and how far along it is -----
  container.appendChild(h('div', { class: 'cc-phase-grid', role: 'list', 'aria-label': 'Where businesses are in the process' }, PHASES.map((k) => {
    const t = PHASE_TEXT[k];
    return h('div', { class: 'cc-phase cc-phase-' + t.kind, role: 'listitem' },
      h('div', { class: 'cc-phase-n', text: String(sum.phases[k]) }), h('div', { class: 'cc-phase-label', text: t.label }), h('p', { class: 'cc-phase-help', text: t.help }));
  })));
  container.appendChild(h('div', { class: 'cc-stats' },
    stat('Qualified businesses', String(sum.qualified)),
    stat('Shortlisted', String(sum.shortlisted)),
    stat('Blocked (duplicate / suppressed)', String(sum.phases.blocked)),
    stat('In CRM, not verified by intake', String(sum.phases.in_crm)),
    stat('Rejected by the rules', sum.rejected === null ? 'not recorded' : String(sum.rejected)),
    stat('Last discovery run', sum.run && sum.run.startedAt ? fmtDate(sum.run.startedAt, new Date()) + ' · ' + runText : runText)
  ));
  container.appendChild(h('div', { class: 'cc-health-grid' }, discoveryHealthCard(d, new Date())));

  // ----- outreach-ready: the only place a draft is waiting for you -----
  const ready = sortCandidates(rows.filter((c) => c.phase === 'outreach_ready'), 'score').slice(0, 8);
  container.appendChild(panel('Outreach-ready (' + sum.phases.outreach_ready + ')', ready.length
    ? h('div', {},
      h('p', { class: 'cc-muted', text: 'You verified these, a contact channel is documented, and a first message is waiting for YOUR review in the Approval Queue. Nothing is approved or sent, and a published contact method is never treated as consent.' }),
      h('ul', { class: 'cc-list' }, ready.map((c) => h('li', {}, h('a', { class: 'cc-link-strong', href: hrefDiscovery(c.id), text: c.name }), ' ', h('span', { class: 'cc-muted', text: [c.city, contactOf(c).label].filter(Boolean).join(' · ') }), ' ', h('a', { class: 'cc-link', href: hrefProspect(c.prospect_id), text: 'Prospect →' })))))
    : h('p', { class: 'cc-muted', text: 'None yet. A business gets here after you verify it, run intake, and a first draft exists.' })));

  // ----- awaiting verification (the thing to act on) -----
  const awaiting = sortCandidates(rows.filter(isAwaitingVerification), 'score').slice(0, 8);
  container.appendChild(panel('Researched, awaiting your verification (' + sum.stages.awaiting_verification + ')', awaiting.length
    ? h('div', {},
      h('p', { class: 'cc-muted', text: 'Public-website research is finished for these. Check each business yourself (own site, address, a public contact address), then run intake. Until you do, nothing about them is verified.' }),
      h('ul', { class: 'cc-list' }, awaiting.map((c) => h('li', {}, h('a', { class: 'cc-link-strong', href: hrefDiscovery(c.id), text: c.name }), ' ', h('span', { class: 'cc-muted', text: [c.city, regionLabel(c.region_label)].filter(Boolean).join(' · ') })))))
    : h('p', { class: 'cc-muted', text: 'None yet. Research runs automatically on shortlisted businesses once the scheduled job is turned on, or on businesses you queue.' })));

  // ----- controls -----
  const search = h('input', { id: 'cc-d-q', type: 'search', maxlength: '100', placeholder: 'Business, city, website or category', autocomplete: 'off', spellcheck: 'false' });
  search.value = initial.q;
  const regionSel = makeSelect('cc-d-region', [['', 'All regions']].concat(fx.regions.map(([k, n]) => [k, regionLabel(k) + ' (' + n + ')'])), initial.region);
  const phaseSel = makeSelect('cc-d-phase', [['', 'Any phase']].concat(PHASE_FILTERS.filter(Boolean).map((s) => [s, PHASE_TEXT[s].label + ' (' + sum.phases[s] + ')'])), initial.phase);
  const groupSel = makeSelect('cc-d-group', [['', 'All industries']].concat(fx.groups.map(([k, n]) => [k, groupLabel(k) + ' (' + n + ')'])), initial.group);
  const stageSel = makeSelect('cc-d-stage', [['', 'Any step']].concat(STAGE_FILTERS.filter(Boolean).map((s) => [s, STAGE_TEXT[s].label + ' (' + sum.stages[s] + ')'])), initial.stage);
  const crmSel = makeSelect('cc-d-crm', [['', 'Any']].concat(CRM_FILTERS.filter(Boolean).map((s) => [s, CRM_TEXT[s].label])), initial.crm);
  const researchSel = makeSelect('cc-d-research', [['', 'Any']].concat(RESEARCH_FILTERS.filter(Boolean).map((s) => [s, RESEARCH_TEXT[s].label])), initial.research);
  const shortSel = makeSelect('cc-d-short', [['any', 'All'], ['yes', 'Shortlisted only']], initial.shortlist);
  const sortSel = makeSelect('cc-d-sort', [['score', 'Score (high first)'], ['rank', 'Shortlist rank'], ['name', 'Name (A to Z)'], ['region', 'Region'], ['newest', 'Newest first']], initial.sort);
  const resetBtn = h('button', { type: 'button', class: 'cc-btn', text: 'Reset filters' });
  const summary = h('p', { class: 'cc-muted cc-results-summary', role: 'status', 'aria-live': 'polite' });
  const results = h('div', { class: 'cc-results' });

  container.appendChild(h('div', { class: 'cc-filters', role: 'search', 'aria-label': 'Filter discovered businesses' },
    field('cc-d-q', 'Search', search, 'cc-field-wide'),
    field('cc-d-region', 'Region', regionSel), field('cc-d-group', 'Industry', groupSel), field('cc-d-phase', 'Phase', phaseSel), field('cc-d-stage', 'Step', stageSel),
    field('cc-d-crm', 'Duplicate / suppression', crmSel), field('cc-d-research', 'Research', researchSel),
    field('cc-d-short', 'Shortlist', shortSel), field('cc-d-sort', 'Sort by', sortSel),
    h('div', { class: 'cc-field cc-field-action' }, resetBtn)));
  container.appendChild(summary);
  container.appendChild(results);

  const collect = () => ({
    q: pickText(search.value, 100), region: pickEnum(regionSel.value, ['', ...fx.regions.map((r) => r[0])], ''), group: pickEnum(groupSel.value, ['', ...fx.groups.map((g) => g[0])], ''),
    phase: pickEnum(phaseSel.value, PHASE_FILTERS, ''),
    stage: pickEnum(stageSel.value, STAGE_FILTERS, ''), crm: pickEnum(crmSel.value, CRM_FILTERS, ''), research: pickEnum(researchSel.value, RESEARCH_FILTERS, ''),
    shortlist: pickEnum(shortSel.value, SHORTLIST_FILTERS, 'any'), sort: pickEnum(sortSel.value, SORT_KEYS, 'score')
  });

  function syncUrl(current) {
    if (!results.isConnected) return;
    try { window.history.replaceState(null, '', buildHash(['discovery'], toParams(current))); } catch (e) { /* the filters still work */ }
  }

  function buildRow(c) {
    const ph = PHASE_TEXT[c.phase] || PHASE_TEXT.discovered, ct = contactOf(c), rs = RESEARCH_TEXT[c.research_status] || RESEARCH_TEXT.none;
    const row = h('tr', { class: 'cc-row-click' },
      h('td', { class: 'cc-cell-company', 'data-label': 'Business' },
        h('a', { class: 'cc-link-strong', href: hrefDiscovery(c.id), text: c.name || '(unnamed)' }),
        c.shortlisted ? ' ' : null, c.shortlisted ? badge('Shortlist #' + c.shortlist_rank, 'info') : null,
        h('div', { class: 'cc-muted cc-cell-sub', text: [c.city, c.domain].filter(Boolean).join(' · ') })),
      h('td', { 'data-label': 'Region', text: regionLabel(c.region_label) }),
      h('td', { 'data-label': 'Industry', text: groupLabel(c.category_group) + (c.category ? ' · ' + c.category.replace(/_/g, ' ') : '') }),
      h('td', { 'data-label': 'Score' }, scorePill(c.score)),
      h('td', { 'data-label': 'Phase' }, badge(ph.label, ph.kind)),
      h('td', { 'data-label': 'Contact channel' }, c.research_status === 'done' ? badge(ct.label, ct.kind) : h('span', { class: 'cc-muted', text: 'Not researched' })),
      h('td', { 'data-label': 'Research' }, badge(rs.label, rs.kind)));
    row.addEventListener('click', (event) => {
      if (event.target && event.target.closest && event.target.closest('a')) return;
      window.location.hash = hrefDiscovery(c.id);
    });
    return row;
  }

  function resetAll() {
    search.value = '';
    [[regionSel, ''], [groupSel, ''], [phaseSel, ''], [stageSel, ''], [crmSel, ''], [researchSel, ''], [shortSel, 'any'], [sortSel, 'score']].forEach(([el, v]) => { el.value = v; });
    redraw(true);
    search.focus();
  }
  resetBtn.addEventListener('click', resetAll);

  function redraw(resetPaging) {
    if (resetPaging) visible = PROSPECT_PAGE_SIZE;
    const current = collect();
    const list = sortCandidates(filterCandidates(rows, current), current.sort);
    summary.textContent = 'Showing ' + Math.min(visible, list.length) + ' of ' + list.length + (list.length === rows.length ? '' : ' matching') + ' businesses' + (list.length === rows.length ? '' : ' (' + rows.length + ' qualified in total)');
    resetBtn.disabled = isDefaultFilters(current);
    clear(results);
    if (!list.length) {
      const again = h('button', { type: 'button', class: 'cc-btn', text: 'Reset filters' });
      again.addEventListener('click', resetAll);
      results.appendChild(emptyBlock('No businesses match these filters.', 'Try a different search, or clear the filters.', again));
    } else {
      const body = h('tbody', {});
      list.slice(0, visible).forEach((c) => body.appendChild(buildRow(c)));
      results.appendChild(h('div', { class: 'cc-table-wrap' }, h('table', { class: 'cc-table cc-ptable' },
        h('caption', { class: 'cc-sr-only', text: 'Discovered businesses' }),
        h('thead', {}, h('tr', {}, ['Business', 'Region', 'Industry', 'Score', 'Phase', 'Contact channel', 'Research'].map((t) => h('th', { scope: 'col', text: t })))),
        body)));
      if (list.length > visible) {
        const remaining = list.length - visible;
        const more = h('button', { type: 'button', class: 'cc-btn cc-show-more', text: 'Show ' + Math.min(PROSPECT_PAGE_SIZE, remaining) + ' more (' + remaining + ' remaining)' });
        more.addEventListener('click', () => { visible += PROSPECT_PAGE_SIZE; redraw(false); });
        results.appendChild(h('div', { class: 'cc-more-row' }, more));
      }
    }
    syncUrl(current);
  }

  [regionSel, groupSel, phaseSel, stageSel, crmSel, researchSel, shortSel, sortSel].forEach((el) => el.addEventListener('change', () => redraw(true)));
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (results.isConnected) redraw(true); }, 150); });

  // why businesses were rejected: counted from the run, not loaded
  const reasons = Object.entries(sum.rejectedByReason).sort((a, b) => b[1] - a[1]);
  if (reasons.length) {
    container.appendChild(panel('Why other businesses were rejected (' + sum.rejected + ')', h('div', {},
      h('p', { class: 'cc-muted', text: 'Rejected by the written rules before ranking. Rejected businesses are not shown above and are never researched. Edit the rules in research/config/discovery-rules.json.' }),
      h('ul', { class: 'cc-list' }, reasons.map(([k, n]) => h('li', { text: k.replace(/_/g, ' ') + ': ' + n }))))));
  }

  redraw(true);
}
