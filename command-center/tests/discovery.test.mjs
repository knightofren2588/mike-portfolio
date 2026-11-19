// Step 620: the Discovery screen. Pure logic + the read-only guarantees. No network, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JS_DIR, load } from './helpers.mjs';

const D = await load('utilities/discovery.js');
const read = (rel) => fs.readFileSync(JS_DIR + rel, 'utf8');
const code = (rel) => read(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const base = { id: 'a', name: 'Acme Auto', city: 'Chillicothe', domain: 'acme.example', category: 'auto_repair', category_group: 'auto', region_label: 'ross-chillicothe', score: 70, shortlisted: false, crm_status: 'clear', research_status: 'none', prospect_id: null, first_seen_at: '2026-11-18T10:00:00Z' };
const rows = [
  { ...base, id: '1', name: 'Alpha', score: 82, shortlisted: true, shortlist_rank: 2, research_status: 'done' },
  { ...base, id: '2', name: 'Bravo', score: 78, region_label: 'pike-waverly', category_group: 'professional', shortlisted: true, shortlist_rank: 1 },
  { ...base, id: '3', name: 'Charlie', score: 60, crm_status: 'suppressed', research_status: 'not_eligible' },
  { ...base, id: '4', name: 'Delta', score: 55, crm_status: 'in_crm', prospect_id: 'p1', research_status: 'done' },
  { ...base, id: '5', name: 'Echo', score: 50, research_status: 'failed' },
  { ...base, id: '6', name: 'Foxtrot', score: 45, research_status: 'queued' }
];

test('the step of a business comes from its facts: human verification is never inferred', () => {
  const stages = Object.fromEntries(rows.map((r) => [r.name, D.stageOf(r)]));
  assert.deepEqual(stages, { Alpha: 'awaiting_verification', Bravo: 'ready_for_research', Charlie: 'blocked', Delta: 'in_crm', Echo: 'research_failed', Foxtrot: 'researching' });
  assert.equal(D.stageOf({ ...rows[0], research_status: 'done', crm_status: 'possible_duplicate' }), 'blocked', 'research never overrides a duplicate or suppression block');
  assert.ok(D.STAGES.every((s) => D.STAGE_TEXT[s]), 'every step has wording');
  assert.ok(!Object.keys(D.STAGE_TEXT).some((k) => /verified|approved|contacted$/.test(k)), 'no step claims a person is verified, approved or contacted');
});

test('filters, search and sort', () => {
  const f = (o) => D.filterCandidates(rows, { ...D.FILTER_DEFAULTS, ...o }).map((r) => r.name);
  assert.deepEqual(f({ region: 'pike-waverly' }), ['Bravo']);
  assert.deepEqual(f({ group: 'professional' }), ['Bravo']);
  assert.deepEqual(f({ stage: 'awaiting_verification' }), ['Alpha']);
  assert.deepEqual(f({ crm: 'suppressed' }), ['Charlie']);
  assert.deepEqual(f({ research: 'failed' }), ['Echo']);
  assert.deepEqual(f({ shortlist: 'yes' }), ['Alpha', 'Bravo']);
  assert.deepEqual(f({ q: 'ALPHA' }), ['Alpha']);
  assert.deepEqual(D.sortCandidates(rows, 'rank').slice(0, 2).map((r) => r.name), ['Bravo', 'Alpha']);
  assert.deepEqual(D.sortCandidates(rows, 'score').map((r) => r.name).slice(0, 3), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(D.sortCandidates(rows, 'not-a-key').map((r) => r.name).slice(0, 1), ['Alpha'], 'an unknown sort falls back to score');
  assert.ok(D.isDefaultFilters(D.FILTER_DEFAULTS));
});

test('the summary counts steps, shortlisted and the run\'s rejected total', () => {
  const s = D.summarize(rows, { overture_release: '2026-10-21.0', rules_version: '620.1', executor: 'local', stats: { rejected: 1247, records_scanned_in_region_boxes: 213653, rejected_by_reason: { national_brand_domain: 215 } } });
  assert.equal(s.qualified, 6); assert.equal(s.shortlisted, 2); assert.equal(s.rejected, 1247); assert.equal(s.scanned, 213653);
  assert.deepEqual(s.stages, { awaiting_verification: 1, ready_for_research: 1, researching: 1, research_failed: 1, in_crm: 1, blocked: 1 });
  assert.equal(D.summarize([], null).rejected, null, 'an unknown rejected count is "not recorded", not 0');
});

test('category ideas are ALWAYS hypotheses; research facts show only what was stored; unknowns are not turned into results', () => {
  const h = D.hypothesesOf({ hypotheses: [{ service: 'Web design & development', status: 'confirmed', basis: 'category' }, { nope: 1 }] });
  assert.deepEqual(h, [{ service: 'Web design & development', basis: 'category' }], 'a stored status can never promote a hypothesis to a finding');
  assert.equal(D.researchFacts({}), null);
  const f = D.researchFacts({ research_summary: { identity: { verdict: 'match' }, counts: { confirmed: 2, potential: 1, unknown: 3 }, opportunity: { ok: false, reason: 'No confirmed finding reached the minimum score.', held_back_for_authorized_assessment: ['security_headers'] } } });
  assert.equal(f.opportunity, null); assert.match(f.noOpportunityReason, /No confirmed/); assert.deepEqual(f.heldBack, ['security_headers']);
  assert.match(D.scoreLines({ score_parts: { identity: 30, fit: 40, contact: 5, penalty: 10, independent_baseline: 2 } }).join(' | '), /penalty -10.*beyond the 2/);
  assert.equal(D.regionLabel('ross-chillicothe'), 'Ross / Chillicothe'); assert.equal(D.regionLabel('columbus-metro'), 'Columbus metro');
});

test('Discovery is wired in: navigation entry with a verification badge, route with a detail screen, and all of it parses', () => {
  const shell = code('components/shell.js'), router = code('router.js');
  assert.match(shell, /route: 'discovery', label: 'Discovery', badge: 'discovery'/);
  assert.match(router, /discovery: \{ view: discovery, detail: discoveryDetail \}/);
  assert.match(router, /ctx\.discovery = await getDiscovery\(\)/);
  for (const f of ['api.js', 'router.js', 'views/discovery.js', 'views/discoveryDetail.js', 'utilities/discovery.js', 'components/shell.js']) execFileSync(process.execPath, ['--check', JS_DIR + f], { stdio: 'pipe' });
});

test('READ-ONLY: the discovery code has no writes, no RPC, no HTML sinks, no external links, no storage; the three write RPCs are unchanged', () => {
  for (const f of ['views/discovery.js', 'views/discoveryDetail.js', 'utilities/discovery.js', 'utilities/discoveryLink.js', 'components/discoveryHealth.js']) {
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|sessionStorage|fetch\(|XMLHttpRequest|\.rpc\(|\.from\(\s*['"]|\bsb\b|supabase|mailto:|window\.open|import .*\/(actions|auth|modal)\.js/.test(code(f)), f);
    assert.ok(!/href: *['"`]|href: *[a-z]+\.(website|domain|evidence)/i.test(code(f)), f + ': links only to in-app routes');
  }
  const api = read('api.js');
  assert.deepEqual([...api.matchAll(/\.(insert|update|upsert|delete)\(/g)], [], 'api.js has no write calls');
  assert.deepEqual([...api.matchAll(/\.rpc\(/g)], [], 'api.js has no rpc calls');
  assert.match(api, /selectAll\('discovery_candidates', DISCOVERY_COLUMNS, 'score', \(q\) => q\.eq\('qualification', 'qualified'\)\)/);
  const cols = (/const DISCOVERY_COLUMNS = \[([\s\S]*?)\]\.join/.exec(api) || [])[1] || '';
  assert.ok(cols.includes("'has_email'") && cols.includes("'has_phone'"));
  assert.ok(!/contact_email|'email'|'phone'|contact_phone/.test(cols), 'no email or phone VALUE is ever requested');
  const actions = read('actions.js');
  assert.match(actions, /const ALLOWED_RPCS = Object\.freeze\(\[\s*'approve_outreach_message',\s*'reject_outreach_message',\s*'edit_outreach_draft'\s*\]\);/);
  assert.equal((actions.match(/\bcallRpc\(\s*'/g) || []).length, 3, 'exactly three call sites');
});

test('the Discovery screen never offers to verify, approve, contact or send', () => {
  const text = code('views/discovery.js') + code('views/discoveryDetail.js');
  assert.ok(!/type: 'button'[^)]*text: '(Verify|Approve|Send|Contact|Add to CRM)/i.test(text));
  assert.ok(!/\bhuman_verified\b|approved_to_contact\s*[:=]\s*true|\.upsert|createProspect/.test(text));
});


// ------------------------------------------------------------------------------------------------ Step 624
const MARK = D.HUMAN_VERIFIED_MARK;
const prospect = (o) => ({ id: 'p1', contact_email: 'owner@acme.example', source_url: 'https://acme.example/contact', do_not_contact: false, status: 'new', evidence: MARK + 'Checked the site and the address myself.', ...o });
const draft = { id: 'm1', prospect_id: 'p1', message_type: 'initial', status: 'draft', approved: false };
const channel = (best) => ({ research_status: 'done', research_summary: { identity: { verdict: 'match' }, contact_channel: { best, pages_examined: 3, channels: best === 'none_found' ? [] : [{ type: best, evidence_source_url: 'https://acme.example/contact', evidence_snippet: 'A contact form is on the page.', domain: 'acme.example', own_domain: true }] } } });
const ready = { ...base, id: 'r', prospect_id: 'p1', crm_status: 'in_crm', ...channel('form') };
const goodLink = { prospect: prospect(), messages: [draft], suppressed: false };

test('PHASES: discovered, researched, human-verified and outreach-ready are kept apart; verification is only what intake wrote', () => {
  const phase = (c, link) => D.phaseOf(c, link || null);
  assert.equal(phase({ ...base }), 'discovered');
  assert.equal(phase({ ...base, research_status: 'done' }), 'researched');
  assert.equal(phase({ ...base, research_status: 'failed' }), 'discovered', 'a failed read is not "researched"');
  assert.equal(phase(ready, goodLink), 'outreach_ready');
  assert.equal(phase(ready, { ...goodLink, messages: [] }), 'verified', 'no draft waiting: verified, not outreach-ready');
  assert.equal(phase(ready, { ...goodLink, prospect: prospect({ evidence: 'Human-verified before intake' }) }), 'in_crm', 'the marker must be exact (first line, followed by a newline)');
  assert.equal(phase(ready, { ...goodLink, prospect: prospect({ evidence: 'Notes\n' + MARK }) }), 'in_crm', 'a marker pasted later in the text does not count');
  assert.equal(phase(ready, { ...goodLink, prospect: prospect({ evidence: null }) }), 'in_crm');
  assert.equal(phase(ready, null), 'in_crm', 'a business that is in the CRM but whose prospect is not loaded is never called verified');
  assert.equal(phase({ ...ready, crm_status: 'suppressed' }, goodLink), 'blocked', 'a block overrides everything');
  assert.equal(phase({ ...ready, crm_status: 'possible_duplicate' }, goodLink), 'blocked');
  assert.deepEqual(D.PHASES, ['discovered', 'researched', 'verified', 'outreach_ready']);
  assert.ok(D.PHASE_FILTERS.filter(Boolean).every((k) => D.PHASE_TEXT[k]));
});

test('OUTREACH-READY needs every check: not do-not-contact, not suppressed, contact email and source recorded, a documented channel, an unapproved draft', () => {
  const p = (link, c) => D.phaseOf(c || ready, link);
  assert.equal(p({ ...goodLink, prospect: prospect({ do_not_contact: true }) }), 'verified');
  assert.equal(p({ ...goodLink, prospect: prospect({ do_not_contact: null }) }), 'verified', 'an unknown do-not-contact flag is treated as blocked');
  assert.equal(p({ ...goodLink, prospect: prospect({ status: 'do_not_contact' }) }), 'verified');
  assert.equal(p({ ...goodLink, suppressed: true }), 'verified');
  assert.equal(p({ ...goodLink, suppressed: null }), 'verified', 'an unchecked suppression is not a pass');
  assert.equal(p({ ...goodLink, prospect: prospect({ contact_email: '' }) }), 'verified');
  assert.equal(p({ ...goodLink, prospect: prospect({ source_url: '  ' }) }), 'verified', 'an address without its source page is not enough');
  assert.equal(p(goodLink, { ...ready, ...channel('none_found') }), 'verified', 'no documented channel: not outreach-ready');
  assert.equal(p(goodLink, { ...ready, research_summary: null }), 'verified', 'no recorded contact result: not outreach-ready');
  for (const kind of ['email', 'form', 'phone']) assert.equal(p(goodLink, { ...ready, ...channel(kind) }), 'outreach_ready', kind);
  assert.equal(p({ ...goodLink, messages: [{ ...draft, approved: true, status: 'approved' }] }), 'verified', 'an approved message is not a draft waiting for review');
  assert.equal(p({ ...goodLink, messages: [{ ...draft, message_type: 'followup_1' }] }), 'verified', 'only the first message counts');
  const checks = D.outreachChecks(ready, goodLink);
  assert.equal(checks.length, 6); assert.ok(checks.every((x) => x.ok && x.label && x.detail));
  assert.ok(!/approved to send|ready to send|cleared to send|consent given/i.test(JSON.stringify(checks) + JSON.stringify(D.PHASE_TEXT)), 'wording never says approved, cleared or consented');
  assert.match(D.PHASE_TEXT.outreach_ready.help, /Nothing is approved or sent/);
});

test('CONTACT CHANNEL: a kind plus the page it was seen on; no address or number; "none found" is not "none exists"; never consent', () => {
  const c = D.contactOf(channel('form'));
  assert.equal(c.best, 'form'); assert.equal(c.documented, true); assert.equal(c.channels[0].source, 'https://acme.example/contact');
  assert.equal(D.contactOf(channel('none_found')).documented, false);
  assert.equal(D.contactOf(channel('none_found')).known, true);
  assert.equal(D.contactOf({}).known, false); assert.equal(D.contactOf(null).documented, false);
  assert.equal(D.contactOf({ research_summary: { contact_channel: { best: 'carrier_pigeon' } } }).known, false, 'an unknown kind is not trusted');
  const messy = D.contactOf({ research_summary: { identity: { verdict: 'match' }, contact_channel: { best: 'email', channels: [{ type: 'sms', evidence_source_url: 'x' }, { type: 'email' }, { type: 'email', evidence_source_url: 'https://a.example/', evidence_snippet: 's', domain: 'a.example', own_domain: true }] } } });
  assert.equal(messy.channels.length, 1, 'channels without a known type and a page URL are dropped');
  assert.match(D.CONTACT_NOT_CONSENT, /not consent/);
  assert.ok(!/\bconsent(ed)?\b(?!\s+to be contacted|\.)/i.test(JSON.stringify(D.CONTACT_TEXT)));
});

test('SCOPE BANDS: small fixes and larger projects both show, only with evidence, never priced', () => {
  const item = (id) => ({ check_id: id, title: id, status: 'confirmed', service: 'Web', solution: 'Fix it.', evidence_snippet: 'seen', evidence_source_url: 'https://acme.example/' });
  const t = D.tiersOf({ small_fixes: [item('a'), item('b'), item('c'), item('d'), { check_id: 'no_evidence', title: 'x' }], larger_projects: [item('z')] });
  assert.equal(t.smallFixes.length, 3, 'at most 3 per band'); assert.equal(t.largerProjects.length, 1);
  assert.ok(!t.smallFixes.some((o) => o.checkId === 'no_evidence'), 'an item without evidence is dropped');
  assert.deepEqual(D.tiersOf(null), { smallFixes: [], largerProjects: [] });
  assert.deepEqual(D.researchFacts({ research_summary: { counts: {} } }).tiers, { smallFixes: [], largerProjects: [] }, 'older research without bands shows empty bands');
  assert.ok(!/\$\s?\d|per month|budget|afford|ROI|revenue/i.test(code('views/discoveryDetail.js') + code('views/discovery.js')), 'no price or budget wording on the screens');
});

test('HEALTH: green, amber (stale), red (3 failures in a row), not started; partial is healthy; matches the runner\'s rules', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const hb = (kind, status, ago, extra) => ({ kind, status, started_at: new Date(now.getTime() - ago * 3600000).toISOString(), ...(extra || {}) });
  const H = (runs, rows) => D.healthOf(runs, rows || [], now);
  assert.equal(H([]).status, 'not_started');
  assert.equal(H([hb('pull', 'ok', 24 * 3), hb('research', 'ok', 10)]).status, 'green');
  assert.equal(H([hb('pull', 'ok', 24 * 3), hb('research', 'partial', 10)]).status, 'green', 'partial is healthy');
  assert.equal(H([hb('pull', 'ok', 24 * 10), hb('research', 'ok', 10)]).status, 'amber', 'pull older than 9 days');
  assert.equal(H([hb('pull', 'ok', 24 * 8), hb('research', 'ok', 49)]).status, 'green');
  assert.equal(H([hb('pull', 'ok', 24 * 8), hb('research', 'ok', 51)]).status, 'amber', 'research older than 50 hours');
  const fails = [hb('pull', 'ok', 24 * 3), hb('research', 'ok', 100), hb('research', 'failed', 70), hb('research', 'failed', 46), hb('research', 'failed', 22, { error: 'research job failed, see the Actions run' })];
  const red = H(fails);
  assert.equal(red.status, 'red'); assert.equal(red.research.failuresSinceOk, 3); assert.match(red.research.lastError, /see the Actions run/);
  assert.equal(H([hb('pull', 'ok', 24 * 3), hb('research', 'failed', 30), hb('research', 'failed', 20), hb('research', 'ok', 5)]).status, 'green', 'a good run resets the count');
  assert.equal(H([hb('pull', 'ok', 24 * 3), hb('research', 'failed', 30), hb('research', 'failed', 20), hb('research', 'ok', 60)]).status, 'amber', 'stale beats a short failure streak');
  assert.equal(H([hb('pull', 'failed', 5)]).status, 'amber', 'a first failed pull with no good run yet needs attention');
  const stuck = H([hb('pull', 'ok', 24), hb('research', 'ok', 10)], [{ research_status: 'claimed', research_claimed_at: new Date(now.getTime() - 3600000).toISOString() }]);
  assert.equal(stuck.status, 'green'); assert.equal(stuck.stuckClaims, 1, 'a stuck claim is shown but is not an alarm (it is released automatically)');
  assert.deepEqual({ ...D.HEALTH_LIMITS }, { maxPullAgeDays: 9, maxResearchAgeHours: 50, maxConsecutiveFailures: 3 });
});

test('Step 624 wiring: batch statistics are never taken from a heartbeat; health is read-only and fail-soft; System Status shows it', () => {
  const api = read('api.js'), router = code('router.js'), status = code('views/status.js');
  assert.match(api, /\.from\('discovery_runs'\)\.select\(DISCOVERY_RUN_COLUMNS\)\.eq\('kind', 'batch'\)/);
  assert.match(api, /\.in\('kind', \['pull', 'research'\]\)/);
  assert.match(api, /export async function getDiscoveryHealth/);
  assert.match(router, /ctx\.discoveryHealth = await getDiscoveryHealth\(\)/);
  assert.match(status, /discoveryHealthCard\(ctx\.discoveryHealth, now\)/);
  assert.match(code('views/discovery.js'), /discoveryHealthCard\(d, new Date\(\)\)/);
  const hbCols = (/const DISCOVERY_HEARTBEAT_COLUMNS = \[([\s\S]*?)\]\.join/.exec(api) || [])[1] || '';
  assert.ok(hbCols.includes("'status'") && hbCols.includes("'error'") && hbCols.includes("'kind'"));
  for (const f of ['components/discoveryHealth.js', 'utilities/discoveryLink.js', 'utilities/discovery.js', 'views/status.js']) execFileSync(process.execPath, ['--check', JS_DIR + f], { stdio: 'pipe' });
  const css = fs.readFileSync(JS_DIR + '../assets/cc.css', 'utf8');
  for (const k of ['cc-phase-grid', 'cc-phase-n', 'cc-check-ok', 'cc-check-no', 'cc-hcard-green', 'cc-hcard-amber', 'cc-hcard-red']) assert.ok(css.includes('.' + k) || css.includes(k), k + ' has no CSS rule');
});

test('an installed but empty Discovery says so plainly and still shows job health', () => {
  const src = read('views/discovery.js');
  assert.match(src, /if \(!d\.rows\.length\)/);
  assert.match(src, /Discovery is installed and empty/);
  assert.ok(src.indexOf('Discovery is installed and empty') < src.indexOf('annotate(d.rows'), 'the empty state comes before any list is built');
});


// ------------------------------------------------------------------------------------------------ Step 650: website identity
// The first live pilot read a repurposed domain (another brand's products, a foreign sign-in form, gambling spam) and the screens presented it as the
// business's own website, with the sign-in form as a "published contact form". These tests pin the rule: only an explicit identity match is usable.
const withIdentity = (identity, extra) => ({ ...base, id: 'w', research_status: 'done', research_summary: { identity, counts: { confirmed: 2, potential: 1, unknown: 1 },
  opportunity: { ok: true, primary: { check_id: 'viewport_missing', title: 'Not mobile friendly', service: 'Web', recommended_solution: 'Add a viewport.', evidence_snippet: 'No viewport', evidence_source_url: 'https://acme.example/' } },
  tiers: { small_fixes: [{ check_id: 'viewport_missing', title: 't', status: 'confirmed', service: 'Web', solution: 's', evidence_snippet: 'e', evidence_source_url: 'https://acme.example/' }], larger_projects: [] },
  contact_channel: { best: 'form', pages_examined: 2, channels: [{ type: 'form', evidence_source_url: 'https://acme.example/', evidence_snippet: 'A form' }] } }, ...(extra || {}) });
const corrected = { ...base, id: 'k', research_status: 'skipped', research_error: 'identity:mismatch:repurposed_domain', qualification: 'qualified', shortlisted: true, shortlist_rank: 3,
  research_summary: { untrusted: true, identity: { verdict: 'mismatch' }, counts: { confirmed: 3, potential: 4, unknown: 3 },
    opportunity: { ok: true, primary: { check_id: 'viewport_missing', title: 'x', service: 'Web', recommended_solution: 's', evidence_snippet: 'e', evidence_source_url: 'https://acme.example/' } },
    contact_channel: { best: 'form', pages_examined: 2, channels: [{ type: 'form', evidence_source_url: 'https://acme.example/', evidence_snippet: 'A form' }] } } };

test('WEBSITE IDENTITY (Step 650): only an explicit "match" is usable; a mismatch, an unconfirmed site and legacy research are never trusted', () => {
  assert.equal(D.identityOf(withIdentity({ verdict: 'match' })).state, 'confirmed');
  assert.equal(D.identityOf(withIdentity({ verdict: 'match' })).usable, true);
  for (const v of ['mismatch', 'unconfirmed', '', undefined, 'MATCH']) assert.equal(D.identityOf(withIdentity({ verdict: v })).usable, false, 'verdict ' + v);
  assert.equal(D.identityOf(withIdentity({})).state, 'untrusted', 'an identity record without a verdict fails closed');
  assert.equal(D.identityOf(corrected).state, 'untrusted');
  assert.equal(D.identityOf({ ...base, research_status: 'skipped', research_error: 'identity:unconfirmed:business_name_not_on_page' }).state, 'untrusted', 'the engine\'s own skip reason is enough, no summary needed');
  assert.equal(D.identityOf({ ...base, research_status: 'done', research_summary: { counts: {} } }).state, 'unchecked', 'research stored before the identity check is not trusted');
  assert.equal(D.identityOf({ ...base, research_status: 'skipped', research_error: 'capture:robots_disallow' }).state, 'none', 'an ordinary skip is not an identity problem');
  assert.equal(D.identityOf(null).state, 'none');
  assert.ok(D.IDENTITY_TEXT.untrusted.help.includes('still a candidate'), 'the business itself is not written off');
});

test('WEBSITE IDENTITY: an untrusted or unchecked website yields NO opportunity, NO bands, NO contact channel and never "researched" or "awaiting verification"', () => {
  for (const c of [corrected, withIdentity({ verdict: 'mismatch' }), withIdentity({ verdict: 'unconfirmed' })]) {
    assert.equal(D.stageOf(c), 'research_failed', 'not "awaiting your verification"');
    assert.notEqual(D.phaseOf(c, null), 'researched');
    assert.equal(D.isAwaitingVerification(c), false);
    assert.equal(D.researchFacts(c), null, 'nothing from that website is surfaced');
    const ct = D.contactOf(c); assert.deepEqual([ct.known, ct.documented, ct.channels.length], [false, false, 0]); assert.equal(ct.blockedByIdentity, true);
    assert.equal(D.researchBadgeOf(c).kind, 'danger');
  }
  const legacy = withIdentity(undefined); delete legacy.research_summary.identity;
  assert.equal(D.stageOf(legacy), 'awaiting_verification', 'legacy research can still be looked at by a person');
  const f = D.researchFacts(legacy);
  assert.equal(f.opportunity, null); assert.match(f.noOpportunityReason, /not confirmed/); assert.deepEqual(f.tiers, { smallFixes: [], largerProjects: [] });
  assert.equal(D.contactOf(legacy).documented, false, 'a contact channel from unchecked research does not count');
  assert.match(D.researchBadgeOf(legacy).label, /identity not checked/);
  // a confirmed match is shown as before
  const good = withIdentity({ verdict: 'match' });
  assert.equal(D.researchFacts(good).opportunity.checkId, 'viewport_missing'); assert.equal(D.researchFacts(good).tiers.smallFixes.length, 1);
  assert.equal(D.contactOf(good).documented, true); assert.equal(D.phaseOf(good, null), 'researched');
});

test('WEBSITE IDENTITY: a mismatch never makes a business outreach-ready, and never removes the business from the candidate list', () => {
  const link = { prospect: prospect(), messages: [draft], suppressed: false };
  const bad = { ...corrected, prospect_id: 'p1', crm_status: 'in_crm' };
  assert.notEqual(D.phaseOf(bad, link), 'outreach_ready', 'a documented channel from the wrong website cannot satisfy the readiness check');
  assert.equal(D.outreachChecks(bad, link).find((x) => x.id === 'channel_documented').ok, false);
  assert.equal(corrected.qualification, 'qualified'); assert.equal(corrected.shortlisted, true);
  const list = D.filterCandidates([corrected, { ...base, id: 'z', name: 'Zed' }], { ...D.FILTER_DEFAULTS, shortlist: 'yes' });
  assert.deepEqual(list.map((c) => c.id), ['k'], 'the business is still on the shortlist');
  assert.equal(D.stageOf({ ...corrected, crm_status: 'suppressed' }), 'blocked', 'a block still overrides');
  const text = code('views/discoveryDetail.js') + code('views/discovery.js');
  assert.ok(/identityOf/.test(text) && /Website research \(not used\)/.test(text) && /idn\.usable/.test(text), 'the screens use the identity guard');
});
