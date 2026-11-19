// Step 612: website research findings in the Command Center. Plain Node tests: no DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { JS_DIR, load } from './helpers.mjs';

const F = await load('utilities/findings.js');
const read = (rel) => fs.readFileSync(JS_DIR + rel, 'utf8');
const row = (o) => ({ prospect_id: 'p1', run_sha256: 'a'.repeat(64), created_at: '2026-11-18T15:00:00Z', check_id: 'viewport_missing', category: 'design_mobile', title: 'No mobile viewport setting', status: 'confirmed', confidence: 'high', observation: 'seen', evidence_source_url: 'https://x.test/', evidence_source_type: 'html', evidence_snippet: 'No <meta name="viewport"> tag found', observed_at: '2026-11-18T15:00:00Z', recommended_solution: 'fix', impact_note: 'matters', service: 'Website modernization', weight: 70, is_primary: false, ...o });

test('only the newest research run is used, grouped confirmed / potential / unknown, strongest first; odd statuses ignored', () => {
  const old = row({ run_sha256: 'b'.repeat(64), created_at: '2026-11-01T00:00:00Z', check_id: 'old' });
  const rows = [old, row({ check_id: 'a', weight: 10 }), row({ check_id: 'b', weight: 90 }), row({ check_id: 'p', status: 'potential' }), row({ check_id: 'u', status: 'unknown', weight: 0 }), row({ check_id: 'weird', status: 'definitely' })];
  assert.deepEqual(F.latestRun(rows).map((r) => r.check_id).sort(), ['a', 'b', 'p', 'u', 'weird']);
  const g = F.groupByStatus(F.latestRun(rows));
  assert.deepEqual(g.confirmed.map((r) => r.check_id), ['b', 'a']);
  assert.deepEqual([g.potential.length, g.unknown.length], [1, 1]);
  assert.deepEqual(F.countByStatus(F.latestRun(rows)), { confirmed: 2, potential: 1, unknown: 1 });
  assert.deepEqual(F.latestRun(null), []);
});

test('the recommendation is the pipeline\'s confirmed primary finding, and is NEVER shown for a blocked prospect', () => {
  const rows = [row({ is_primary: true }), row({ check_id: 'z', is_primary: false })];
  const r = F.recommendation(rows, false);
  assert.equal(r.state, 'ready'); assert.equal(r.service, 'Website modernization');
  assert.equal(F.recommendation(rows, true).state, 'blocked');
  assert.equal(F.recommendation(rows, true).primary, null);
  assert.equal(F.recommendation([], false).state, 'none');
  assert.equal(F.recommendation([row({ is_primary: true, status: 'potential' })], false).state, 'none', 'a potential finding is never the recommendation');
  assert.equal(F.recommendation([row({})], false).state, 'none', 'no primary marked');
});

test('launch path: Prospect -> Findings -> Recommendation -> AI draft -> My approval -> Secure sender', () => {
  const rows = [row({ is_primary: true })];
  const state = (input) => Object.fromEntries(F.launchPath({ findingsAvailable: true, findings: [], blocked: false, initialMessage: null, ...input }).map((s) => [s.key, s.state]));
  assert.deepEqual(F.launchPath({ findingsAvailable: true, findings: [], blocked: false, initialMessage: null }).map((s) => s.key), ['prospect', 'research', 'recommendation', 'draft', 'approval', 'sender']);
  assert.deepEqual(state({}), { prospect: 'done', research: 'todo', recommendation: 'todo', draft: 'todo', approval: 'todo', sender: 'todo' });
  assert.deepEqual(state({ findings: rows, initialMessage: { status: 'draft', approved: false } }), { prospect: 'done', research: 'done', recommendation: 'done', draft: 'done', approval: 'waiting', sender: 'todo' });
  assert.deepEqual(state({ findings: rows, initialMessage: { status: 'approved', approved: true } }), { prospect: 'done', research: 'done', recommendation: 'done', draft: 'done', approval: 'done', sender: 'waiting' });
  assert.equal(state({ findings: rows, initialMessage: { status: 'sent', approved: true, sent_at: 'x' } }).sender, 'done');
  assert.equal(state({ findings: rows, initialMessage: { status: 'draft', approved: false, rejected_at: 'x' } }).approval, 'blocked');
  assert.equal(state({ findingsAvailable: false }).research, 'todo');
  const b = state({ findings: rows, blocked: true, initialMessage: null });
  assert.deepEqual([b.recommendation, b.draft], ['blocked', 'blocked'], 'a blocked prospect gets no recommendation and no draft step');
  const waiting = F.launchPath({ findingsAvailable: true, findings: rows, blocked: false, initialMessage: { status: 'draft', approved: false } }).find((s) => s.key === 'approval');
  assert.match(waiting.note, /Nothing is approved until you click Approve/);
});

test('a missing findings table is recognised; real errors are not hidden', () => {
  for (const e of [{ code: '42P01' }, { code: 'PGRST205' }, { message: 'relation "public.website_findings" does not exist' }, { message: 'Could not find the table in the schema cache' }]) assert.equal(F.isMissingTable(e), true);
  for (const e of [null, { code: '42501', message: 'permission denied' }, { code: 'PGRST301', message: 'JWT expired' }]) assert.equal(F.isMissingTable(e), false);
});

test('the new code can only READ: no writes, no RPCs, no HTML sinks, no links, and the three write RPCs are unchanged', () => {
  const files = ['utilities/findings.js', 'components/findingsPanel.js'];
  for (const f of files) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|localStorage|sessionStorage|fetch\(|XMLHttpRequest|\.rpc\(|\.from\(|\bsb\b|supabase|href:|mailto:|window\.open|import .*\/(actions|auth|modal)\.js/.test(code), f);
  }
  const api = read('api.js');
  assert.deepEqual([...api.matchAll(/\.(insert|update|upsert|delete)\(/g)], [], 'api.js still has no write calls');
  assert.deepEqual([...api.matchAll(/\.rpc\(/g)], [], 'api.js still has no rpc calls');
  assert.match(api, /selectAll\('website_findings', FINDING_COLUMNS\)/);
  const actions = read('actions.js');
  assert.match(actions, /const ALLOWED_RPCS = Object\.freeze\(\[\s*'approve_outreach_message',\s*'reject_outreach_message',\s*'edit_outreach_draft'\s*\]\);/);
  assert.equal((actions.match(/\bcallRpc\(\s*'/g) || []).length, 3, 'exactly three call sites');
});

test('security core files are byte-for-byte unchanged on this branch (skipped outside a git checkout)', (t) => {
  let changed;
  try { changed = execFileSync('git', ['diff', '--name-only', 'main', '--', 'command-center/js/auth.js', 'command-center/js/supabaseClient.js', 'command-center/js/actions.js', 'command-center/vendor'], { cwd: JS_DIR, encoding: 'utf8' }).trim(); }
  catch { t.skip('not a git checkout, or no main branch'); return; }
  assert.equal(changed, '');
});

test('the modified screens still parse (syntax check by import-free compile)', () => {
  for (const f of ['api.js', 'views/prospectDetail.js', 'views/queue.js', 'components/findingsPanel.js']) {
    execFileSync(process.execPath, ['--check', JS_DIR + f], { stdio: 'pipe' });
  }
});


