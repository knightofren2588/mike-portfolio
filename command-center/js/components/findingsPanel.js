// Display pieces for website research (Step 612). READ-ONLY: no buttons, no actions, no network.
//
// All text from the database (including evidence snippets copied from third-party web pages) goes through textContent only
// (via h() / factList()), never innerHTML. Evidence URLs are shown as plain text, never as links.
//
//   launchPathPanel   Prospect -> Research Findings -> Recommended Solution -> AI Draft -> My Approval -> Secure Sender
//   findingsPanels    the evidence, grouped confirmed / potential / unknown
//   recommendedPanel  the one recommended service (hidden for do-not-contact / suppressed prospects)
//   researchBrief     a compact version for the Approval Queue, next to the draft

import { h, badge, notice, emptyState, factList, fmtDateTime } from '../dom.js';
import { panel } from './ui.js';
import {
  STATUS_TEXT, CATEGORY_TEXT, groupByStatus, latestRun, recommendation, launchPath, countByStatus
} from '../utilities/findings.js';

const STEP_BADGE = { done: ['Done', 'ok'], waiting: ['Waiting for you', 'warn'], todo: ['Not yet', 'neutral'], blocked: ['Stopped', 'danger'] };

export function launchPathPanel(input) {
  const steps = launchPath(input);
  return panel('Launch path', h('div', {},
    h('p', { class: 'cc-muted', text: 'Prospect → Research findings → Recommended solution → AI draft → your approval → secure sender. Nothing moves past "My approval" until you click Approve in the Approval Queue.' }),
    h('ol', { class: 'cc-mini-timeline' }, steps.map((s) => {
      const b = STEP_BADGE[s.state] || STEP_BADGE.todo;
      return h('li', {}, badge(b[0], b[1]), ' ', h('strong', { text: s.label }), ' ', h('span', { class: 'cc-muted', text: s.note }));
    }))
  ));
}

function findingNode(f) {
  const st = STATUS_TEXT[f.status] || STATUS_TEXT.unknown;
  const facts = [
    ['What we saw', f.observation],
    ['Source', [f.evidence_source_type, f.evidence_source_url].filter(Boolean).join(' · ') || '—'],
    ['Observed', fmtDateTime(f.observed_at)],
    ['Confidence', f.confidence],
    ['Evidence', f.evidence_snippet ? f.evidence_snippet : (f.status === 'unknown' ? 'None (not determined)' : '—')],
    ['Recommended fix', f.recommended_solution],
    ['Service', f.service]
  ];
  return h('details', { class: 'cc-details' },
    h('summary', {},
      badge(st.label, st.kind), ' ', f.title || f.check_id, f.is_primary ? ' ' : null, f.is_primary ? badge('Strongest', 'info') : null
    ),
    h('p', { class: 'cc-muted', text: st.help }),
    factList(facts)
  );
}

/** One panel per status group that has rows. Returns an array (possibly empty). */
export function findingsPanels(rows) {
  const run = latestRun(rows);
  const g = groupByStatus(run);
  const out = [];
  for (const key of ['confirmed', 'potential', 'unknown']) {
    if (!g[key].length) continue;
    const byCat = new Map();
    for (const f of g[key]) {
      if (!byCat.has(f.category)) byCat.set(f.category, []);
      byCat.get(f.category).push(f);
    }
    const body = h('div', { class: 'cc-stack' });
    for (const [cat, list] of byCat) {
      body.appendChild(h('h3', { class: 'cc-h3', text: CATEGORY_TEXT[cat] || String(cat) }));
      list.forEach((f) => body.appendChild(findingNode(f)));
    }
    out.push(panel(STATUS_TEXT[key].label + ' (' + g[key].length + ')', body));
  }
  return out;
}

export function recommendedPanel(rows, blocked) {
  const rec = recommendation(rows, blocked);
  if (rec.state === 'blocked') return panel('Recommended solution', notice('error', 'Contact is blocked for this prospect (do-not-contact or suppressed). No outreach recommendation is shown.'));
  if (rec.state === 'none') return panel('Recommended solution', emptyState(rec.reason));
  return panel('Recommended solution', h('div', {},
    factList([
      ['Service', rec.service],
      ['Why', rec.primary.observation],
      ['What we would do', rec.solution],
      ['Why it matters', rec.impact]
    ]),
    h('p', { class: 'cc-muted', text: 'No results are promised or estimated. The draft is stored as unapproved; only you can approve it.' })
  ));
}

/** Compact block for the Approval Queue: what the draft is based on. Returns null when there is nothing to say. */
export function researchBrief(rows, findingsAvailable, blocked) {
  if (findingsAvailable === false) return null;
  const run = latestRun(rows);
  if (!run.length) return h('p', { class: 'cc-muted', text: 'No research findings are stored for this prospect. Check the draft against the website yourself.' });
  const rec = recommendation(rows, blocked);
  const c = countByStatus(run);
  const facts = [['Findings', c.confirmed + ' confirmed, ' + c.potential + ' potential, ' + c.unknown + ' unknown']];
  if (rec.state === 'ready') {
    facts.push(['Recommended service', rec.service], ['Based on', rec.primary.title + ' (' + rec.primary.confidence + ' confidence, observed ' + fmtDateTime(rec.primary.observed_at) + ')'], ['Evidence', rec.primary.evidence_snippet || '—']);
  } else if (rec.state === 'blocked') {
    facts.push(['Recommendation', 'None: contact is blocked']);
  } else {
    facts.push(['Recommendation', 'None: no confirmed opportunity']);
  }
  return factList(facts);
}
