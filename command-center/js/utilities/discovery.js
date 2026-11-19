// Business discovery (Step 620): pure display and filter logic. No DOM, no network, no database.
//
// What a "discovery candidate" is: a business found in a PUBLIC directory (Overture Maps) by the research engine and staged in the
// database. It is NOT a prospect, it is NOT human-verified, and nothing here can change that. The only way a candidate becomes a
// prospect is you running the existing intake step after your own verification. This file only decides how candidates are
// grouped, filtered and worded.
//
// Wording rule: category-based service ideas are always "hypotheses". Only findings that carry evidence from a captured public
// page (confirmed / potential / unknown) are "findings".

export const STAGES = ['awaiting_verification', 'ready_for_research', 'researching', 'research_failed', 'in_crm', 'blocked'];

export const STAGE_TEXT = {
  awaiting_verification: { label: 'Awaiting your verification', kind: 'warn', help: 'Public-website research is done. Check the business yourself, then run intake. Nothing has been verified, approved or contacted.' },
  ready_for_research: { label: 'Ready for research', kind: 'info', help: 'Discovered and checked against the CRM. Passive public-website research has not run yet.' },
  researching: { label: 'Research queued', kind: 'info', help: 'Research is queued or running. At most 3 public pages are read.' },
  research_failed: { label: 'Research did not finish', kind: 'neutral', help: 'The site could not be read, or it was not this business\'s own website (robots.txt, redirect, an error, the retry limit or a website identity mismatch). Nothing was concluded.' },
  in_crm: { label: 'Already in CRM', kind: 'ok', help: 'A prospect with this Overture id or website already exists. See the prospect record.' },
  blocked: { label: 'Blocked', kind: 'danger', help: 'Possible duplicate or suppressed. It is not researched and not recommended.' }
};

export const CRM_TEXT = {
  unchecked: { label: 'Not checked yet', kind: 'neutral' },
  clear: { label: 'Clear', kind: 'ok' },
  in_crm: { label: 'In CRM', kind: 'info' },
  possible_duplicate: { label: 'Possible duplicate', kind: 'warn' },
  suppressed: { label: 'Suppressed', kind: 'danger' }
};

export const RESEARCH_TEXT = {
  not_eligible: { label: 'Not eligible', kind: 'neutral' },
  none: { label: 'Not started', kind: 'neutral' },
  queued: { label: 'Queued', kind: 'info' },
  claimed: { label: 'Running', kind: 'info' },
  done: { label: 'Done', kind: 'ok' },
  failed: { label: 'Failed (will retry)', kind: 'warn' },
  skipped: { label: 'Skipped', kind: 'neutral' }
};

export const GROUP_TEXT = {
  trades: 'Home and trade services', auto: 'Automotive and equipment', industrial: 'Industrial, wholesale and B2B',
  professional: 'Professional services', health_practice: 'Private health and wellness practices', appointments: 'Appointment-based personal services',
  retail: 'Local retail and specialty', hospitality: 'Food, lodging and venues', other: 'Other or uncategorized'
};
export const groupLabel = (id) => GROUP_TEXT[id] || String(id || 'Other');

/** "ross-chillicothe" -> "Ross / Chillicothe"; "columbus-metro" -> "Columbus metro". */
export function regionLabel(id) {
  const parts = String(id || '').split('-').filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (!parts.length) return 'Unlabelled';
  return parts[parts.length - 1] === 'Metro' ? parts.slice(0, -1).join(' ') + ' metro' : parts.join(' / ');
}

export const STAGE_FILTERS = ['', ...STAGES];
export const CRM_FILTERS = ['', 'clear', 'in_crm', 'possible_duplicate', 'suppressed', 'unchecked'];
export const RESEARCH_FILTERS = ['', 'none', 'queued', 'claimed', 'done', 'failed', 'skipped', 'not_eligible'];
export const SHORTLIST_FILTERS = ['any', 'yes'];
export const SORT_KEYS = ['score', 'name', 'region', 'newest', 'rank'];
export const FILTER_DEFAULTS = { q: '', region: '', group: '', phase: '', stage: '', crm: '', research: '', shortlist: 'any', sort: 'score' };

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 650: WEBSITE IDENTITY. Research is only usable if the pages it read belonged to THIS business. The first live pilot read a domain that had
// been repurposed (another brand's products, a foreign sign-in form, gambling spam) and the screens showed it as the business's own website. The
// engine now records an identity verdict with every result, and a guarded correction marked the bad result untrusted. This is the ONE place the
// screens ask "can this research be used?":
//   confirmed  the engine compared the pages with the business name and they matched   -> findings, opportunity and contact channel are shown
//   untrusted  mismatch, not confirmed, or marked untrusted                            -> nothing is shown as a finding, recommendation or contact channel
//   unchecked  research stored before the identity check existed                       -> not recommended, and no contact channel is used
//   none       no research stored
// A website mismatch says nothing against the BUSINESS: it stays a qualified candidate; only that website is not trusted.
// ---------------------------------------------------------------------------------------------------------------------------------
export const IDENTITY_TEXT = {
  confirmed: { label: 'Website matches this business', kind: 'ok', help: 'The research compared the pages it read with this business\'s name and they matched.' },
  untrusted: { label: 'Website does not match this business', kind: 'danger', help: 'The website at the listed address is not confirmed as this business\'s own (it may have changed hands or been repurposed). Nothing read from it is used: no finding, opportunity or contact channel. The business itself is still a candidate; check whether it has a different website.' },
  unchecked: { label: 'Website identity not checked', kind: 'warn', help: 'This research was stored before the website identity check existed, so nobody has confirmed the pages belong to this business. It is not used for a recommendation or a contact channel.' },
  none: { label: 'No website research', kind: 'neutral', help: '' }
};

/** { state: confirmed | untrusted | unchecked | none, usable, verdict, label, kind, help }. Fails closed: anything that is not an explicit "match" is not usable. */
export function identityOf(c) {
  const s = c && c.research_summary && typeof c.research_summary === 'object' ? c.research_summary : null;
  const err = c && typeof c.research_error === 'string' ? c.research_error : '';
  const id = s && s.identity && typeof s.identity === 'object' ? s.identity : null;
  let state = 'none';
  if (/^identity:/.test(err) || (s && s.untrusted === true) || (id && id.verdict !== 'match')) state = 'untrusted';
  else if (id) state = 'confirmed';
  else if (s) state = 'unchecked';
  const verdict = id && typeof id.verdict === 'string' ? id.verdict : (/^identity:/.test(err) ? err.split(':')[1] || '' : '');
  return { state, usable: state === 'confirmed', verdict, ...IDENTITY_TEXT[state] };
}

/** The research badge for lists and headers: an untrusted website is shown as such, never as "Done" or a plain "Skipped". */
export function researchBadgeOf(c) {
  const idn = identityOf(c);
  if (idn.state === 'untrusted') return { label: idn.label, kind: 'danger' };
  if (idn.state === 'unchecked' && c && c.research_status === 'done') return { label: 'Done, website identity not checked', kind: 'warn' };
  return RESEARCH_TEXT[c && c.research_status] || RESEARCH_TEXT.none;
}

/** The one place that decides what step a candidate is at. */
export function stageOf(c) {
  if (!c) return 'blocked';
  if (c.prospect_id || c.crm_status === 'in_crm') return 'in_crm';
  if (c.crm_status === 'suppressed' || c.crm_status === 'possible_duplicate') return 'blocked';
  if (identityOf(c).state === 'untrusted') return 'research_failed';   // Step 650: a website that is not the business's own is never "researched"
  if (c.research_status === 'done') return 'awaiting_verification';
  if (c.research_status === 'queued' || c.research_status === 'claimed') return 'researching';
  if (c.research_status === 'failed' || c.research_status === 'skipped') return 'research_failed';
  return 'ready_for_research';
}

export const isAwaitingVerification = (c) => stageOf(c) === 'awaiting_verification';

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 624: the four phases. They answer "how far along is this business, and who did the work?" and they are kept strictly apart:
//   Discovered        found in a public directory by the engine. Nothing has been read from its website.
//   Researched        the engine read up to 3 public pages. Still NOT checked by a person.
//   Human-verified    YOU checked the business and ran intake. The only evidence this screen accepts is the marker intake itself writes
//                     into the prospect record. The Command Center never sets it and nothing here can.
//   Outreach-ready    human-verified AND every readiness check below passes. It means "a draft is waiting for YOUR review". It never means
//                     approved, queued or sent, and a published contact method is never treated as consent.
// ---------------------------------------------------------------------------------------------------------------------------------
export const PHASES = ['discovered', 'researched', 'verified', 'outreach_ready'];
export const PHASE_TEXT = {
  discovered: { label: 'Discovered', kind: 'neutral', help: 'Found in a public directory. Its website has not been read and nobody has checked it.' },
  researched: { label: 'Researched', kind: 'info', help: 'Public pages were read by the engine. Nobody has verified the business yet.' },
  verified: { label: 'Human-verified prospect', kind: 'warn', help: 'You verified this business and ran intake. It is not outreach-ready until every check below passes.' },
  outreach_ready: { label: 'Outreach-ready', kind: 'ok', help: 'Verified, with a documented contact channel, and a draft is waiting for your review. Nothing is approved or sent.' },
  in_crm: { label: 'In CRM (not verified by intake)', kind: 'neutral', help: 'A prospect record exists but it does not carry the human-verification marker that intake writes, so it is not counted as verified here.' },
  blocked: { label: 'Blocked', kind: 'danger', help: 'Possible duplicate or suppressed. It is not researched and not recommended.' }
};
export const PHASE_FILTERS = ['', 'discovered', 'researched', 'verified', 'outreach_ready', 'in_crm', 'blocked'];

/** The exact first line `intake_prospect` writes into prospects.evidence. The database checks the same marker before it will draft or attach research. */
export const HUMAN_VERIFIED_MARK = 'Human-verified before intake\n';
export const isHumanVerifiedProspect = (p) => !!p && typeof p.evidence === 'string' && p.evidence.startsWith(HUMAN_VERIFIED_MARK);
const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * The readiness checklist for one business.
 * `link` = { prospect, messages, suppressed } built by the caller from the CRM snapshot (prospect or null; that prospect's messages;
 * true / false / null for "is its contact email suppressed", null = could not be checked). Pure: nothing is read or written here.
 * Each item is { id, ok, label, detail }.
 */
export function outreachChecks(c, link) {
  const p = (link && link.prospect) || null, msgs = Array.isArray(link && link.messages) ? link.messages : [];
  const contact = contactOf(c);
  const verified = isHumanVerifiedProspect(p);
  const dnc = !!p && (p.do_not_contact !== false || p.status === 'do_not_contact');
  const suppressed = link ? link.suppressed : null;
  const draft = msgs.some((m) => m && m.message_type === 'initial' && m.status === 'draft' && !m.approved);
  return [
    { id: 'verified', ok: verified, label: 'You verified the business and ran intake', detail: verified ? 'The prospect record carries the human-verification marker.' : p ? 'A prospect record exists but without the verification marker.' : 'No prospect record yet. Only you can do this, by running intake.' },
    { id: 'not_dnc', ok: !!p && !dnc, label: 'Not marked do-not-contact', detail: !p ? 'No prospect record yet.' : dnc ? 'The prospect is marked do-not-contact.' : 'Not marked.' },
    { id: 'not_suppressed', ok: suppressed === false, label: 'Contact address not on the suppression list', detail: suppressed === null || suppressed === undefined ? 'Not checked (there is no contact address yet).' : suppressed ? 'The address or its domain is suppressed.' : 'Not suppressed.' },
    { id: 'contact_recorded', ok: !!p && hasText(p.contact_email) && hasText(p.source_url), label: 'Contact email and its source page recorded on the prospect', detail: !p ? 'No prospect record yet.' : hasText(p.contact_email) && hasText(p.source_url) ? 'Both are recorded.' : 'The prospect is missing the contact email or the page it came from.' },
    { id: 'channel_documented', ok: contact.documented, label: 'A published contact channel was documented by research', detail: contact.documented ? contact.label + ' found on a public page.' : contact.known ? 'None found on the pages read (this does not mean none exists).' : 'Research has not recorded a contact channel yet.' },
    { id: 'draft_waiting', ok: draft, label: 'A draft is waiting for your review', detail: draft ? 'An unapproved first message exists. Nothing is approved or sent.' : 'No unapproved first message waiting (it may not exist yet, or may already be handled: see the Approval Queue).' }
  ];
}

/** `link` as in outreachChecks, or null when the business has no prospect. One word: discovered | researched | verified | outreach_ready | in_crm | blocked. */
export function phaseOf(c, link) {
  if (!c) return 'blocked';
  if (c.crm_status === 'suppressed' || c.crm_status === 'possible_duplicate') return 'blocked';
  const p = link && link.prospect;
  if (p || c.prospect_id || c.crm_status === 'in_crm') {
    if (!isHumanVerifiedProspect(p)) return 'in_crm';
    return outreachChecks(c, link).every((x) => x.ok) ? 'outreach_ready' : 'verified';
  }
  return c.research_status === 'done' && identityOf(c).state !== 'untrusted' ? 'researched' : 'discovered';
}

export function filterCandidates(rows, f) {
  const q = String(f.q || '').trim().toLowerCase();
  return (rows || []).filter((c) => {
    if (f.region && c.region_label !== f.region) return false;
    if (f.group && c.category_group !== f.group) return false;
    if (f.phase && c.phase !== f.phase) return false;
    if (f.stage && stageOf(c) !== f.stage) return false;
    if (f.crm && c.crm_status !== f.crm) return false;
    if (f.research && c.research_status !== f.research) return false;
    if (f.shortlist === 'yes' && !c.shortlisted) return false;
    if (q && ![c.name, c.city, c.domain, c.category, c.address].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? 0 : t; };

export function sortCandidates(rows, key) {
  const list = (rows || []).slice();
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  const cmp = {
    score: (a, b) => num(b.score) - num(a.score) || byName(a, b),
    name: byName,
    region: (a, b) => String(a.region_label).localeCompare(String(b.region_label)) || num(b.score) - num(a.score) || byName(a, b),
    newest: (a, b) => time(b.first_seen_at) - time(a.first_seen_at) || byName(a, b),
    rank: (a, b) => (a.shortlist_rank ? 0 : 1) - (b.shortlist_rank ? 0 : 1) || num(a.shortlist_rank) - num(b.shortlist_rank) || num(b.score) - num(a.score) || byName(a, b)
  }[SORT_KEYS.indexOf(key) === -1 ? 'score' : key];
  return list.sort(cmp);
}

export const isDefaultFilters = (f) => Object.keys(FILTER_DEFAULTS).every((k) => f[k] === FILTER_DEFAULTS[k]);

/** Distinct values (with counts) that exist in the data, for the filter drop-downs. */
export function facets(rows) {
  const count = (key) => { const m = new Map(); for (const r of rows || []) m.set(r[key], (m.get(r[key]) || 0) + 1); return m; };
  const sorted = (m) => Array.from(m.entries()).filter(([k]) => k).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { regions: sorted(count('region_label')), groups: sorted(count('category_group')) };
}

/** Headline numbers. `run` is the newest discovery_runs row (or null); rejected rows are not loaded, only counted from the run. */
export function summarize(rows, run) {
  const list = rows || [];
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let shortlisted = 0;
  const phases = Object.fromEntries(PHASE_FILTERS.filter(Boolean).map((k) => [k, 0]));
  for (const c of list) { stages[stageOf(c)]++; phases[c.phase || phaseOf(c, null)]++; if (c.shortlisted) shortlisted++; }
  const st = (run && run.stats) || {};
  return {
    qualified: list.length, shortlisted, stages, phases,
    rejected: Number.isFinite(Number(st.rejected)) ? Number(st.rejected) : null,
    scanned: Number.isFinite(Number(st.records_scanned_in_region_boxes)) ? Number(st.records_scanned_in_region_boxes) : null,
    rejectedByReason: st.rejected_by_reason && typeof st.rejected_by_reason === 'object' ? st.rejected_by_reason : {},
    run: run ? { release: run.overture_release || null, rulesVersion: run.rules_version || null, executor: run.executor || null, startedAt: run.started_at || null } : null
  };
}

/** Category-based ideas. ALWAYS unverified hypotheses, whatever the stored status says. */
export function hypothesesOf(c) {
  const raw = Array.isArray(c && c.hypotheses) ? c.hypotheses : [];
  return raw.filter((h) => h && typeof h.service === 'string').map((h) => ({ service: h.service, basis: typeof h.basis === 'string' ? h.basis : '' }));
}

export function missingOf(c) { return (Array.isArray(c && c.missing) ? c.missing : []).filter((m) => typeof m === 'string'); }

/** What the research recorded about itself (never an invented result). */
export function researchFacts(c) {
  const s = (c && c.research_summary && typeof c.research_summary === 'object') ? c.research_summary : null;
  if (!s) return null;
  const idn = identityOf(c);
  if (idn.state === 'untrusted') return null;   // Step 650: nothing from a website that is not the business's own
  const counts = s.counts || {};
  const opp = s.opportunity && typeof s.opportunity === 'object' ? s.opportunity : null;
  return {
    demoFixture: s.capture_source === 'fixture',
    capturedAt: s.captured_at || null, finalUrl: s.final_url || null, requests: s.requests_made ?? null, pages: s.pages_fetched ?? null,
    counts: { confirmed: num(counts.confirmed), potential: num(counts.potential), unknown: num(counts.unknown) },
    identity: idn,
    opportunity: idn.usable && opp && opp.ok && opp.primary ? { checkId: opp.primary.check_id, title: opp.primary.title, service: opp.primary.service, solution: opp.primary.recommended_solution, evidence: opp.primary.evidence_snippet || '', source: opp.primary.evidence_source_url || '' } : null,
    noOpportunityReason: !idn.usable ? 'The website identity is not confirmed, so no opportunity is recommended.' : opp && !opp.ok ? String(opp.reason || '') : '',
    heldBack: Array.isArray(opp && opp.held_back_for_authorized_assessment) ? opp.held_back_for_authorized_assessment : [],
    tiers: idn.usable ? tiersOf(s.tiers) : { smallFixes: [], largerProjects: [] }
  };
}

const slim = (o) => ({ checkId: String(o.check_id || ''), title: String(o.title || ''), status: String(o.status || ''), service: String(o.service || ''), solution: String(o.solution || ''), evidence: String(o.evidence_snippet || ''), source: String(o.evidence_source_url || '') });
/** Small fixes and larger projects (Step 624). Only items that carry evidence are shown; nothing is priced or promised. */
export function tiersOf(t) {
  const take = (a) => (Array.isArray(a) ? a.filter((o) => o && typeof o.check_id === 'string' && o.evidence_snippet).slice(0, 3).map(slim) : []);
  const x = t && typeof t === 'object' ? t : {};
  return { smallFixes: take(x.small_fixes), largerProjects: take(x.larger_projects) };
}

// Step 624: what the research found about HOW to reach the business, from the public pages it read. A KIND and the page it was seen on, never
// the address or number itself (those are not stored). A published contact method is not consent and does not make a business outreach-ready.
export const CONTACT_TEXT = {
  email: { label: 'Published email address', kind: 'ok' },
  form: { label: 'Contact form', kind: 'ok' },
  phone: { label: 'Phone number only', kind: 'info' },
  none_found: { label: 'None found on the pages read', kind: 'warn' }
};
export const CONTACT_NOT_CONSENT = 'A published contact method is not consent to be contacted. Nothing here approves outreach.';

/** `known` = research recorded a contact result; `documented` = it found at least one channel. */
export function contactOf(c) {
  const s = c && c.research_summary && typeof c.research_summary === 'object' ? c.research_summary : null;
  const cc = s && s.contact_channel && typeof s.contact_channel === 'object' ? s.contact_channel : null;
  if (['untrusted', 'unchecked'].includes(identityOf(c).state)) return { known: false, documented: false, best: null, label: 'Not used (website identity not confirmed)', kind: 'warn', channels: [], pagesExamined: null, blockedByIdentity: true };
  if (!cc || !CONTACT_TEXT[cc.best]) return { known: false, documented: false, best: null, label: 'Not recorded', kind: 'neutral', channels: [], pagesExamined: null };
  const channels = (Array.isArray(cc.channels) ? cc.channels : []).filter((x) => x && ['email', 'form', 'phone'].includes(x.type) && typeof x.evidence_source_url === 'string')
    .slice(0, 8).map((x) => ({ type: x.type, source: x.evidence_source_url, snippet: String(x.evidence_snippet || ''), domain: typeof x.domain === 'string' ? x.domain : '', ownDomain: x.own_domain === true, freeMail: x.free_mail === true, roleAddress: x.role_address === true }));
  return {
    known: true, documented: cc.best !== 'none_found', best: cc.best, label: CONTACT_TEXT[cc.best].label, kind: CONTACT_TEXT[cc.best].kind, channels,
    pagesExamined: Number.isFinite(Number(cc.pages_examined)) ? Number(cc.pages_examined) : null
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Step 624: scheduled-job health, computed in the browser from the heartbeat rows the runner writes (discovery_runs, kind pull / research).
// The same rules as `runner.mjs health` (the daily watchdog); the numbers must match research/config/discovery-policy.json (a backend test
// compares them). The Command Center only READS these rows. Green = nothing to do, amber = stale, red = repeated failures.
// ---------------------------------------------------------------------------------------------------------------------------------
export const HEALTH_LIMITS = Object.freeze({ maxPullAgeDays: 9, maxResearchAgeHours: 50, maxConsecutiveFailures: 3 });

const ageHours = (iso, now) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isNaN(t) ? null : (now.getTime() - t) / 3600000; };

function kindHealth(runs, kind) {
  const mine = (runs || []).filter((r) => r && r.kind === kind && r.started_at).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  const lastOk = mine.find((r) => r.status === 'ok' || r.status === 'partial') || null;
  const failures = mine.filter((r) => r.status === 'failed' && (!lastOk || new Date(r.started_at) > new Date(lastOk.started_at))).length;
  return { last: mine[0] || null, lastOk, failuresSinceOk: failures, lastError: mine[0] && mine[0].status === 'failed' && typeof mine[0].error === 'string' ? mine[0].error : '' };
}

/**
 * @param runs  heartbeat rows ({ kind, status, started_at, error }), any order
 * @param rows  loaded candidates (for the stuck-claim count), or []
 * @returns { status: 'not_started'|'green'|'amber'|'red', label, problems[], pull, research }
 */
export function healthOf(runs, rows, now) {
  const at = now instanceof Date ? now : new Date();
  const pull = kindHealth(runs, 'pull'), research = kindHealth(runs, 'research');
  if (!pull.last && !research.last) return { status: 'not_started', label: 'Not started', problems: [], pull, research };
  const problems = [];
  let red = false;
  const L = HEALTH_LIMITS;
  if (pull.failuresSinceOk >= L.maxConsecutiveFailures) { red = true; problems.push('Weekly pull: ' + pull.failuresSinceOk + ' failed runs in a row.'); }
  if (research.failuresSinceOk >= L.maxConsecutiveFailures) { red = true; problems.push('Research: ' + research.failuresSinceOk + ' failed runs in a row.'); }
  const pa = ageHours(pull.lastOk && pull.lastOk.started_at, at), ra = ageHours(research.lastOk && research.lastOk.started_at, at);
  if (pull.last && (pa === null || pa > L.maxPullAgeDays * 24)) problems.push('Weekly pull: no successful run ' + (pa === null ? 'recorded' : 'for ' + Math.floor(pa / 24) + ' days') + '.');
  if (research.last && (ra === null || ra > L.maxResearchAgeHours)) problems.push('Research: no successful run ' + (ra === null ? 'recorded' : 'for ' + Math.floor(ra) + ' hours') + '.');
  const stuck = (rows || []).filter((c) => c.research_status === 'claimed' && c.research_claimed_at && ageHours(c.research_claimed_at, at) > 0.5).length;
  const status = red ? 'red' : problems.length ? 'amber' : 'green';
  return { status, label: { green: 'Healthy', amber: 'Needs attention', red: 'Failing' }[status], problems, stuckClaims: stuck, pull, research };
}

/** Score parts as readable lines (the score is a triage rank, not a website score). */
export function scoreLines(c) {
  const p = (c && c.score_parts) || {};
  const out = ['Identity ' + num(p.identity) + ' of 35', 'Category fit ' + num(p.fit) + ' of 40', 'Contact data listed ' + num(p.contact) + ' of 10'];
  if (num(p.penalty)) out.push('Shared-website penalty -' + num(p.penalty));
  if (num(p.independent_baseline)) out.push('Independent datasets counted beyond the ' + num(p.independent_baseline) + ' this region\'s pull already required');
  return out;
}
