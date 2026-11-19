// One discovered business: source evidence, duplicate / suppression status, research, and the recommended technology opportunities.
//
// READ-ONLY. The screen keeps two things strictly apart:
//   * HYPOTHESES   ideas derived from the business CATEGORY only. Unverified. Never presented as a finding.
//   * FINDINGS     observations from a captured public page, each with its source, snippet, date and confidence (confirmed / potential / unknown).
// A candidate is not a prospect and is not human-verified. Nothing here verifies, approves, contacts or stores anything.
// All text is placed on the page with textContent only (through h()); web-page evidence is shown as plain text, never as a link.

import { h, badge, notice, factList, fmtDateTime, emptyState } from '../dom.js';
import { hrefDiscovery, hrefProspect, hrefQueue } from '../utilities/query.js';
import { linkFor } from '../utilities/discoveryLink.js';
import { panel, emptyBlock } from '../components/ui.js';
import { findingsPanels } from '../components/findingsPanel.js';
import { recommendation, latestRun, countByStatus } from '../utilities/findings.js';
import {
  STAGE_TEXT, CRM_TEXT, RESEARCH_TEXT, PHASE_TEXT, CONTACT_NOT_CONSENT, contactOf, identityOf, researchBadgeOf, outreachChecks, phaseOf, stageOf, regionLabel, groupLabel, hypothesesOf, missingOf, researchFacts, scoreLines
} from '../utilities/discovery.js';

export const title = 'Discovered business';

export function crumbs(ctx) {
  const c = ctx.discovery && ctx.discovery.rows.find((r) => String(r.id) === String(ctx.param));
  return [{ label: 'Sales' }, { label: 'Discovery', href: hrefDiscovery() }, { label: c ? c.name : 'Business' }];
}

const yesNo = (v) => (v ? 'Yes' : 'No');
const list = (items) => (items && items.length ? h('ul', { class: 'cc-list' }, items.map((t) => h('li', { text: String(t) }))) : h('span', { class: 'cc-muted', text: '—' }));

export function render(container, ctx) {
  const d = ctx.discovery;
  const c = d && d.available ? d.rows.find((r) => String(r.id) === String(ctx.param)) : null;
  container.appendChild(h('p', {}, h('a', { class: 'cc-link', href: hrefDiscovery(), text: '← All discovered businesses' })));
  if (!c) {
    container.appendChild(emptyBlock('This business is not in the loaded discovery list.', 'It may have been rejected by the rules, or the link is old. Go back to the list and use Refresh.'));
    return;
  }
  const link = linkFor(c, ctx.snap), phase = phaseOf(c, link), ph = PHASE_TEXT[phase], checks = outreachChecks(c, link), contact = contactOf(c);
  const stage = stageOf(c), st = STAGE_TEXT[stage], crm = CRM_TEXT[c.crm_status] || CRM_TEXT.unchecked, rs = researchBadgeOf(c), idn = identityOf(c);
  const findings = ctx.discoveryFindings && ctx.discoveryFindings.rows ? ctx.discoveryFindings.rows : [];
  const run = latestRun(findings), counts = countByStatus(run), facts = researchFacts(c), blocked = stage === 'blocked';

  container.appendChild(h('h1', { class: 'cc-h1', text: c.name }));
  container.appendChild(h('p', {}, badge(ph.label, ph.kind), ' ', badge(st.label, st.kind), ' ', badge('Duplicate / suppression: ' + crm.label, crm.kind), ' ', badge('Research: ' + rs.label, rs.kind), c.shortlisted ? ' ' : null, c.shortlisted ? badge('Shortlist #' + c.shortlist_rank, 'info') : null));
  container.appendChild(notice(blocked ? 'error' : 'info', ph.help + ' ' + (link && link.prospect ? '' : 'This business was found in a public directory. It is not a prospect and not human-verified.')));

  // Step 650: research from a website that is not confirmed as this business's own is never shown as a finding, a recommendation or a contact channel
  if (idn.state === 'untrusted' || idn.state === 'unchecked') container.appendChild(notice(idn.state === 'untrusted' ? 'error' : 'warn', idn.label + '. ' + idn.help));

  // ----- where it stands -----
  const standing = [
    ['Phase', ph.label],
    ['Step', st.label],
    ['Duplicate and suppression check', crm.label + (c.crm_reason ? ' (' + c.crm_reason.replace(/_/g, ' ') + ')' : '') + (c.crm_checked_at ? ' · checked ' + fmtDateTime(c.crm_checked_at) : '')],
    ['Research', rs.label + (c.research_attempts ? ' · attempts: ' + c.research_attempts : '') + (c.researched_at ? ' · finished ' + fmtDateTime(c.researched_at) : '')],
    ['Last research problem', c.research_error ? c.research_error.replace(/[_:]/g, ' ') : '—'],
    ['Human verification', phase === 'verified' || phase === 'outreach_ready' ? 'Recorded by intake (the prospect record carries the marker). The Command Center cannot set it.' : c.prospect_id ? 'A prospect record exists, but it does not carry the verification marker that intake writes.' : 'Not done. Only you can do this, by running intake after checking the business.']
  ];
  const standingBody = h('div', {}, factList(standing), c.prospect_id ? h('p', {}, h('a', { class: 'cc-link-strong', href: hrefProspect(c.prospect_id), text: 'Open the prospect record →' })) : null);
  container.appendChild(panel('Where this stands', standingBody));

  // ----- outreach readiness: every check, passed or not -----
  container.appendChild(panel('Outreach readiness', h('div', {},
    h('p', { class: 'cc-muted', text: 'Outreach-ready means all six checks pass. It means a draft is waiting for YOUR review. It never means approved or sent.' }),
    h('ul', { class: 'cc-list' }, checks.map((x) => h('li', { class: x.ok ? 'cc-check-ok' : 'cc-check-no' }, h('strong', { text: x.label }), h('span', { class: 'cc-muted', text: ' · ' + x.detail })))),
    link && link.prospect ? h('p', {}, h('a', { class: 'cc-link-strong', href: hrefProspect(link.prospect.id), text: 'Open the prospect record →' }), ' ', h('a', { class: 'cc-link', href: hrefQueue(), text: 'Approval Queue →' })) : null)));

  // ----- published contact channel (research): a kind and the page it was seen on, never the address -----
  container.appendChild(panel('Published contact channel (from the public pages read)', h('div', {},
    h('p', {}, badge(contact.label, contact.kind), contact.pagesExamined !== null ? h('span', { class: 'cc-muted', text: ' · ' + contact.pagesExamined + ' page(s) examined' }) : null),
    contact.channels.length
      ? h('ul', { class: 'cc-list' }, contact.channels.map((x) => h('li', {}, badge(x.type === 'email' ? 'Email' : x.type === 'form' ? 'Form' : 'Phone', 'neutral'), ' ', x.snippet, h('div', { class: 'cc-muted', text: 'Seen on: ' + x.source + (x.type === 'email' ? ' · ' + (x.ownDomain ? 'the business\'s own domain' : x.freeMail ? 'a free mail provider' : 'another domain') + (x.roleAddress ? ' · a shared role address' : '') : '') }))))
      : h('p', { class: 'cc-muted', text: contact.blockedByIdentity ? 'A contact channel read from that website is not shown, because the website is not confirmed as this business\'s own.' : contact.known ? 'No email, contact form or phone number was found on the pages read. That does not mean none exists: other pages, social profiles and directories were not examined.' : 'Research has not recorded a contact result for this business yet.' }),
    h('p', { class: 'cc-muted', text: 'The address and the number themselves are not stored. Open the page yourself when you verify the business; intake is where the address and its source page are recorded. ' + CONTACT_NOT_CONSENT }))));

  // ----- source evidence -----
  container.appendChild(panel('Source evidence (public directory data)', h('div', {},
    factList([
      ['Address', [c.address, c.city, c.state, c.postcode].filter(Boolean).join(', ') || '—'],
      ['Website (as listed)', c.website],
      ['Region', regionLabel(c.region_label)],
      ['Industry', groupLabel(c.category_group) + (c.category ? ' · ' + c.category.replace(/_/g, ' ') : '')],
      ['Overture id', c.overture_id],
      ['Directory confidence', c.confidence === null || c.confidence === undefined ? '—' : String(c.confidence)],
      ['Identity strength', c.identity_strength],
      ['Datasets that list it', (c.datasets || []).join(', ') || '—'],
      ['Independent datasets', (c.independent_datasets || []).join(', ') || 'none (it rests on one source)'],
      ['Operating status', c.operating_status || 'not stated'],
      ['Phone listed', yesNo(c.has_phone)],
      ['Email listed in the dataset', yesNo(c.has_email) + ' (the address itself is never stored)'],
      ['Seen by discovery', fmtDateTime(c.last_seen_at) + ' · rules ' + c.rules_version]
    ]),
    h('p', { class: 'cc-muted', text: 'Directory data can be out of date: a business may be closed, renamed or listed with an old website. That is why identity stays a human check.' }))));

  // ----- ranking -----
  container.appendChild(panel('Why it ranks where it does', h('div', {},
    factList([['Score', c.score + ' of 85 (a triage rank from identity evidence, business category and contact data listed; NOT a website score)'], ['Parts', list(scoreLines(c))], ['Shortlist', c.shortlisted ? (c.shortlist_reason || 'Shortlisted.') : 'Not shortlisted.']]))));

  // ----- recommended technology opportunities -----
  const hyp = hypothesesOf(c);
  container.appendChild(panel('Ideas from the business category (hypotheses, NOT verified)', h('div', {},
    h('p', { class: 'cc-muted', text: 'These come only from the type of business. Nothing about the website has been measured for them. They are conversation starters, not findings.' }),
    hyp.length ? h('ul', { class: 'cc-list' }, hyp.map((x) => h('li', {}, badge('Hypothesis', 'neutral'), ' ', x.service, x.basis ? h('span', { class: 'cc-muted', text: ' · ' + x.basis }) : null))) : emptyState('No category-based ideas are recorded.'))));

  if (blocked) {
    container.appendChild(panel('Verified findings', notice('error', 'This business is a possible duplicate or suppressed. It is not researched and no recommendation is shown.')));
  } else if (run.length && !idn.usable) {
    container.appendChild(panel('Website research (not used)', h('div', {},
      notice(idn.state === 'untrusted' ? 'error' : 'warn', idn.help),
      factList([['Findings stored as an audit trail', run.length + ' (not shown and not used)'], ['What to do', 'Open the business\'s own website yourself. It may use a different address than the one listed. Nothing here is a recommendation.']]))));
  } else if (!run.length) {
    container.appendChild(panel('Verified findings', emptyBlock(
      c.research_status === 'done' ? 'Research finished but no findings could be loaded.' : 'No website research yet.',
      c.research_status === 'failed' || c.research_status === 'skipped'
        ? 'The site could not be read, so nothing is concluded. No opportunity is invented.'
        : 'Passive research (at most 3 public pages, robots.txt obeyed) runs automatically for shortlisted businesses when the scheduled job is on.')));
  } else {
    if (facts && facts.demoFixture) container.appendChild(notice('error', 'DEMO DATA: this research ran on a synthetic test page, not on this business\'s real website. Ignore the findings below; they exist only to show how the screen works.'));
    const rec = recommendation(findings, false);
    container.appendChild(panel('Recommended opportunity (verified from the public website)', rec.state === 'ready'
      ? h('div', {}, factList([['Service', rec.service], ['Because we saw', rec.primary.observation], ['Evidence', rec.primary.evidence_snippet || '—'], ['Source', rec.primary.evidence_source_url || '—'], ['What we would do', rec.solution], ['Why it matters', rec.impact]]),
        h('p', { class: 'cc-muted', text: 'No results are promised or estimated. Security observations are never used in an email. A draft is made only after you verify the business and run intake, and you approve it yourself.' }))
      : emptyState(rec.reason || 'No confirmed opportunity was strong enough. Nothing is recommended.')));
    const tiers = facts && facts.tiers ? facts.tiers : { smallFixes: [], largerProjects: [] };
    const tierList = (items, none) => (items.length
      ? h('ul', { class: 'cc-list' }, items.map((o) => h('li', {}, h('strong', { text: o.title }), h('span', { class: 'cc-muted', text: ' · ' + o.status + (o.service ? ' · ' + o.service : '') }), o.solution ? h('div', { text: o.solution }) : null, h('div', { class: 'cc-muted', text: 'Evidence: ' + o.evidence + (o.source ? ' (' + o.source + ')' : '') }))))
      : h('p', { class: 'cc-muted', text: none }));
    container.appendChild(panel('Opportunities by size of work', h('div', {},
      h('p', { class: 'cc-muted', text: 'Grouped by how big the work is, not by what a business could spend. Small, well-bounded fixes sit next to larger projects so a genuine small improvement is never buried. Each item has evidence from a page that was read. No price, value or result is estimated.' }),
      h('h3', { class: 'cc-h3', text: 'Small fixes' }), tierList(tiers.smallFixes, 'No evidenced small fix was found.'),
      h('h3', { class: 'cc-h3', text: 'Larger projects' }), tierList(tiers.largerProjects, 'No evidenced larger project was found.'))));
    container.appendChild(panel('Research record', factList([
      ['Findings', counts.confirmed + ' confirmed · ' + counts.potential + ' potential · ' + counts.unknown + ' unknown (unknown means "could not be determined")'],
      ['Captured', facts && facts.capturedAt ? fmtDateTime(facts.capturedAt) : '—'],
      ['Pages read', facts && facts.pages !== null ? facts.pages + ' page(s), ' + facts.requests + ' request(s)' : '—'],
      ['Final address', facts && facts.finalUrl ? facts.finalUrl : '—'],
      ['Held back for an authorized assessment', facts && facts.heldBack.length ? facts.heldBack.join(', ') : 'none']
    ])));
    findingsPanels(findings).forEach((p) => container.appendChild(p));
  }

  // ----- what a human still has to do -----
  const missing = missingOf(c);
  if (phase !== 'verified' && phase !== 'outreach_ready') container.appendChild(panel('What you still need to do', h('div', {},
    h('ol', { class: 'cc-list' },
      h('li', { text: 'Open the business\'s own website: is it current, and this business\'s own site (not a franchise or group page)?' }),
      h('li', { text: 'Confirm the address on the site or in an independent listing, and note that second URL.' }),
      h('li', { text: 'Find a business contact address published on a public page of the site, and note that page.' }),
      h('li', { text: 'Write the verified facts in your own words. Only then run the existing intake step. Intake re-checks duplicates and suppression itself.' })),
    missing.length ? h('div', {}, h('h3', { class: 'cc-h3', text: 'Still missing for intake' }), list(missing)) : null)));
}
