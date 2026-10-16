import test from 'node:test';
import assert from 'node:assert/strict';
import { load, fakeInvoke, httpError, ok, PID_A, PID_B } from './helpers.mjs';

const { createStarkAi } = await load('ai/starkAiController.js');
const { STARK_AI } = await load('config.js');
const prompts = await load('ai/starkAiPrompts.js');

const ON = Object.freeze({ ...STARK_AI, enabled: true, minSecondsBetweenRequests: 0 });
const build = (answer, extra) => {
  const f = fakeInvoke(answer || (() => ok()));
  const ai = createStarkAi({ config: ON, invoke: f.invoke, uuid: () => crypto.randomUUID(), ...(extra || {}) });
  return { ai, ...f };
};
const onProspect = (ai, id, label) => { ai.setContext({ page: 'prospect', prospectId: id }); if (label) ai.setProspectLabel(label); };
const KEYS = ['clientRequestId', 'history', 'insights', 'intent', 'message', 'op', 'page', 'prospectId', 'v'];

test('while disabled, nothing can make a request', async () => {
  const f = fakeInvoke(() => ok());
  const ai = createStarkAi({ config: STARK_AI, invoke: f.invoke });
  ai.setContext({ page: 'prospect', prospectId: PID_A });
  const results = [await ai.send('hi'), await ai.sendQuickPrompt('prospect_followup'), await ai.checkService(), await ai.retry()];
  assert.ok(results.every((r) => r.code === 'disabled'));
  assert.equal(f.calls.length, 0);
  assert.equal(ai.getState().enabled, false);
  assert.deepEqual(ai.getState().quickPrompts, []);
});

test('every quick prompt on every page sends exactly the accepted fields', async () => {
  let total = 0;
  for (const page of prompts.PAGES) {
    for (const q of prompts.promptsForPage(page)) {
      const { ai, calls } = build();
      ai.setContext({ page, prospectId: page === 'prospect' ? PID_A : null });
      const r = await ai.sendQuickPrompt(q.id);
      assert.equal(r.ok, true, page + ':' + q.id);
      const b = calls[0].body;
      assert.deepEqual(Object.keys(b).sort(), KEYS);
      assert.equal(calls[0].name, 'stark-ai');
      assert.equal(b.intent, q.intent);
      assert.equal(b.message, q.text);
      assert.equal(b.page, page);
      assert.equal(b.prospectId, page === 'prospect' ? PID_A : null);
      if (page === 'prospect') assert.equal(b.insights, null, 'a prospect question never carries a browser summary');
      total++;
    }
  }
  assert.equal(total, 19);
});

test('the panel understands the page and prospect from the address', () => {
  const { ai } = build();
  ai.setContextFromHash('#/prospects/' + PID_A.toUpperCase());
  assert.deepEqual(ai.getState().context, { page: 'prospect', pageLabel: 'Prospect', prospectId: PID_A, prospectLabel: '' });
  ai.setProspectLabel('KP Plumbing');
  assert.equal(ai.getState().context.prospectLabel, 'KP Plumbing');
  ai.setContextFromHash('#/prospects/' + PID_A + '/timeline');
  assert.equal(ai.getState().context.prospectId, PID_A);
  ai.setContextFromHash('#/queue');
  assert.deepEqual([ai.getState().context.page, ai.getState().context.prospectId, ai.getState().context.prospectLabel], ['queue', null, '']);
  ai.setContextFromHash('#/not-a-page');
  assert.equal(ai.getState().context.page, 'overview');
});

test('a prospect page without a valid prospect id asks nothing', async () => {
  const { ai, calls } = build();
  ai.setContextFromHash('#/prospects/not-a-uuid');
  assert.equal(ai.getState().context.page, 'prospect');
  assert.equal(ai.getState().canSend, false);
  const r = await ai.send('hello');
  assert.equal(r.code, 'no_prospect');
  assert.equal(calls.length, 0);
});

test('free-text questions on a prospect page carry that prospect (next step, draft)', async () => {
  const { ai, calls } = build();
  onProspect(ai, PID_A, 'KP Plumbing');
  await ai.send('What would you recommend as my next step with this prospect?');
  await ai.send('Draft a professional follow-up based on our previous contact.');
  for (const c of calls) {
    assert.equal(c.body.intent, 'free');
    assert.equal(c.body.page, 'prospect');
    assert.equal(c.body.prospectId, PID_A);
    assert.equal(c.body.insights, null);
  }
  assert.equal(calls[0].body.message, 'What would you recommend as my next step with this prospect?');
});

test('Prospect A history never reaches Prospect B (and returns only to A)', async () => {
  const { ai, calls } = build((b) => ok({ reply: 'answer about ' + b.prospectId.slice(0, 4) + ' to: ' + b.message }));
  onProspect(ai, PID_A, 'Company A');
  await ai.send('secret question for A');
  await ai.send('second question for A');
  assert.equal(calls[1].body.history.length, 2);

  onProspect(ai, PID_B, 'Company B');
  await ai.send('question for B');
  const toB = JSON.stringify(calls[2].body);
  assert.equal(calls[2].body.history.length, 0);
  assert.ok(!toB.includes('secret question for A') && !toB.includes('Company A') && !toB.includes(PID_A));

  onProspect(ai, PID_A, 'Company A');
  await ai.send('third question for A');
  const backToA = calls[3].body;
  assert.equal(backToA.history.length, 4);
  assert.ok(!JSON.stringify(backToA).includes('question for B'));
  assert.equal(backToA.prospectId, PID_A);
});

test('a question that is not about a prospect never carries a prospect\'s history', async () => {
  const { ai, calls } = build();
  onProspect(ai, PID_A, 'Company A');
  await ai.send('about A');
  ai.setContext({ page: 'overview' });
  await ai.send('general question');
  assert.deepEqual(calls[1].body.history, []);
  assert.equal(calls[1].body.prospectId, null);
});

test('every message remembers which prospect it was about (so a draft is never mistaken for another prospect\'s)', async () => {
  const { ai } = build();
  onProspect(ai, PID_A, 'KP Plumbing');
  await ai.send('hello');
  onProspect(ai, PID_B, 'Other Co');
  await ai.send('hello again');
  assert.deepEqual(ai.getState().messages.map((m) => m.label), ['Other Co', 'Other Co']);   // only the prospect on screen
  onProspect(ai, PID_A, 'KP Plumbing');
  assert.deepEqual(ai.getState().messages.map((m) => m.label), ['KP Plumbing', 'KP Plumbing']);
});

test('the dashboard summary keeps only allow-listed fields and removes emails and phone numbers', async () => {
  const insights = {
    schemaVersion: 1, meta: { generatedAt: '2026-10-16T00:00:00Z' },
    pipelineSummary: { totalProspects: 3, internalNote: 'must not travel', secret: 'x' },
    nextActions: [{ rank: 1, kind: 'reply', label: 'Call pat@example.com on 614-555-0199', count: 1, doNotContact: false, email: 'a@b.co' }],
    needsAttention: [], systemHealth: { exceptionsTotal: 0, evidenceNote: 'ok', unassigned: { failed: 0, stuck: 0 }, systems: [] }
  };
  const { ai, calls } = build(null, { getInsightsData: async () => insights });
  ai.setContext({ page: 'pipeline' });
  await ai.sendQuickPrompt('pipeline_summary');
  const sent = JSON.stringify(calls[0].body.insights);
  assert.ok(!sent.includes('must not travel') && !sent.includes('secret') && !sent.includes('pat@example.com') && !sent.includes('555-0199') && !sent.includes('a@b.co'));
  assert.ok(sent.includes('[removed]'));
  assert.equal(calls[0].body.insights.pipelineSummary.totalProspects, 3);
  assert.equal(calls[0].body.insights.systemHealth, undefined, 'a pipeline question does not carry system health');
});

test('blocked, refused and shortened answers are flagged for the display', async () => {
  const { ai } = build(() => ok({ reply: 'Outreach is blocked for this prospect.', blocked: true, reason: 'do_not_contact' }));
  onProspect(ai, PID_A, 'KP Plumbing');
  const r = await ai.sendQuickPrompt('prospect_followup');
  assert.equal(r.blocked, true);
  assert.equal(ai.getState().messages.at(-1).blocked, true);
});

test('errors: 401 asks the router to verify the session; 403 is admin-only and not retryable; 429 is retryable', async () => {
  let auth = 0;
  const a = build(() => ({ error: httpError(401, 'unauthenticated') }), { onAuthExpired: () => { auth++; } });
  a.ai.setContext({ page: 'overview' });
  await a.ai.send('x');
  assert.equal(auth, 1);
  assert.equal(a.ai.getState().error.code, 'unauthenticated');
  assert.match(a.ai.getState().error.message, /couldn't verify/);

  const b = build(() => ({ error: httpError(403, 'forbidden') }));
  b.ai.setContext({ page: 'overview' });
  await b.ai.send('x');
  assert.equal(b.ai.getState().error.code, 'forbidden');
  assert.equal(b.ai.getState().error.retryable, false);
  assert.match(b.ai.getState().error.message, /administrator/);
  assert.equal(b.ai.getState().retry.errorRetryable, false);

  const c = build(() => ({ error: httpError(429, 'rate_limited') }));
  c.ai.setContext({ page: 'overview' });
  await c.ai.send('x');
  assert.equal(c.ai.getState().error.retryable, true);
});

test('Retry replays the ORIGINAL request even after you moved to another prospect', async () => {
  let fail = true;
  const { ai, calls } = build(() => (fail ? { error: httpError(503, 'ai_overloaded') } : ok()));
  onProspect(ai, PID_A, 'Company A');
  await ai.send('question for A');
  assert.equal(ai.getState().retry.prospectId, PID_A);
  onProspect(ai, PID_B, 'Company B');
  // Prospect A's failed question is not offered (or even mentioned) while Prospect B is on screen
  assert.equal(ai.getState().retry, null);
  assert.equal(ai.getState().canRetry, false);
  assert.equal(ai.getState().messages.length, 0);
  fail = false;
  await ai.retry();   // (the function itself still replays the original request exactly)
  assert.equal(calls.at(-1).body.prospectId, PID_A);
  assert.equal(calls.at(-1).body.message, 'question for A');
  assert.ok(!JSON.stringify(calls.at(-1).body).includes(PID_B));
  assert.equal(ai.getState().messages.length, 0, 'the answer for A appeared under B');
  onProspect(ai, PID_A, 'Company A');
  assert.equal(ai.getState().messages.length, 2);
});

test('one question at a time; a late answer after Cancel, Clear or session end is thrown away', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const invoke = async (name, o) => { calls.push(o.body); await gate; return { data: ok(), error: null }; };
  const ai = createStarkAi({ config: ON, invoke, uuid: () => crypto.randomUUID() });
  ai.setContext({ page: 'overview' });
  const first = ai.send('one');
  const second = await ai.send('two');
  assert.equal(second.code, 'busy');
  assert.equal(calls.length, 1);
  ai.cancel();
  release();
  await first;
  assert.equal(ai.getState().messages.some((m) => m.role === 'assistant'), false, 'the late answer was discarded');
  assert.equal(ai.getState().sending, false);
  ai.reset();
  assert.deepEqual(ai.getState().messages, []);
  assert.equal(ai.getState().context.page, 'overview');
});

test('Clear conversation wipes messages, errors and the retry snapshot', async () => {
  const { ai } = build(() => ({ error: httpError(500, 'internal') }));
  ai.setContext({ page: 'overview' });
  await ai.send('x');
  assert.ok(ai.getState().retry);
  ai.clear();
  assert.deepEqual([ai.getState().messages.length, ai.getState().error, ai.getState().retry], [0, null, null]);
});

test('a request that never answers ends as a friendly timeout', async () => {
  const timers = [];
  const ai = createStarkAi({
    config: ON, invoke: () => new Promise(() => {}), uuid: () => crypto.randomUUID(),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}
  });
  ai.setContext({ page: 'overview' });
  const pending = ai.send('x');
  await new Promise((r) => setImmediate(r));
  const t = timers.find((x) => x.ms === ON.requestTimeoutMs);
  assert.ok(t, 'the request timeout was armed');
  t.fn();
  await pending;
  assert.equal(ai.getState().error.code, 'timeout');
});


// ---------- one visible conversation at a time ----------
const texts = (ai) => ai.getState().messages.map((m) => m.text);

test('switching A → B → dashboard → A: each screen shows only its own conversation, and A is restored', async () => {
  const { ai } = build((b) => ok({ reply: 'Draft for ' + (b.prospectId ? b.prospectId.slice(0, 4) : 'dashboard') }));
  onProspect(ai, PID_A, 'Company A');
  await ai.send('ask A');
  onProspect(ai, PID_B, 'Company B');
  assert.deepEqual(texts(ai), []);
  await ai.send('ask B');
  assert.deepEqual(texts(ai), ['ask B', 'Draft for 9999']);
  ai.setContext({ page: 'overview' });
  assert.deepEqual(texts(ai), []);
  await ai.send('ask dashboard');
  assert.deepEqual(texts(ai), ['ask dashboard', 'Draft for dashboard']);
  ai.setContext({ page: 'pipeline' });
  assert.deepEqual(texts(ai), ['ask dashboard', 'Draft for dashboard'], 'dashboard pages share one conversation (as their history does)');
  onProspect(ai, PID_A, 'Company A');
  assert.deepEqual(texts(ai), ['ask A', 'Draft for 1111']);
  // the draft for A is never visible anywhere else
  onProspect(ai, PID_B, 'Company B');
  assert.ok(!texts(ai).some((t) => t.includes('1111') || t.includes('ask A')));
});

test('a prospect page with an unusable id shows no conversation at all', async () => {
  const { ai } = build();
  onProspect(ai, PID_A, 'A');
  await ai.send('hello');
  ai.setContext({ page: 'prospect', prospectId: 'not-a-uuid' });
  assert.deepEqual(ai.getState().messages, []);
});

test('a slow answer for A arrives while B is on screen: it never appears under B, and is waiting in A', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const calls = [];
  const invoke = async (name, o) => { calls.push(o.body); await gate; return { data: ok({ reply: 'Draft for A' }), error: null }; };
  const ai = createStarkAi({ config: ON, invoke, uuid: () => crypto.randomUUID() });
  onProspect(ai, PID_A, 'Company A');
  const pending = ai.send('draft for A');
  onProspect(ai, PID_B, 'Company B');
  const mid = ai.getState();
  assert.deepEqual(mid.messages, [], 'A\'s pending question is visible under B');
  assert.equal(mid.sending, true);
  assert.equal(mid.workingElsewhere, 'Company A');
  assert.equal(mid.canSend, false);
  assert.equal((await ai.send('question for B')).code, 'busy');
  assert.equal(calls.length, 1);
  release();
  await pending;
  const after = ai.getState();
  assert.deepEqual(after.messages, [], 'the late answer appeared under B');
  assert.equal(after.sending, false);
  assert.equal(after.workingElsewhere, '');
  assert.equal(after.error, null);
  onProspect(ai, PID_A, 'Company A');
  assert.deepEqual(texts(ai), ['draft for A', 'Draft for A']);
  assert.equal(ai.getState().messages[1].label, 'Company A');
});

test('a slow answer for a prospect arrives while the dashboard is on screen, and the other way round', async () => {
  const gates = [];
  const invoke = async (name, o) => { await new Promise((r) => gates.push(r)); return { data: ok({ reply: 'reply to ' + o.body.message }), error: null }; };
  const ai = createStarkAi({ config: ON, invoke, uuid: () => crypto.randomUUID() });
  ai.setContext({ page: 'overview' });
  const first = ai.send('dashboard question');
  onProspect(ai, PID_A, 'Company A');
  assert.equal(ai.getState().workingElsewhere, 'Overview');
  gates.shift()();
  await first;
  assert.deepEqual(ai.getState().messages, []);
  const second = ai.send('A question');
  ai.setContext({ page: 'overview' });
  gates.shift()();
  await second;
  assert.deepEqual(texts(ai), ['dashboard question', 'reply to dashboard question']);
});

test('a failure for A while B is on screen shows no error and no Retry under B; both are waiting in A', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const invoke = async () => { await gate; return { data: null, error: httpError(503, 'ai_overloaded') }; };
  const ai = createStarkAi({ config: ON, invoke, uuid: () => crypto.randomUUID() });
  onProspect(ai, PID_A, 'Company A');
  const pending = ai.send('question for A');
  onProspect(ai, PID_B, 'Company B');
  release();
  await pending;
  const b = ai.getState();
  assert.equal(b.error, null);
  assert.equal(b.retry, null);
  assert.deepEqual(b.messages, []);
  assert.equal(b.canSend, true);
  onProspect(ai, PID_A, 'Company A');
  const a = ai.getState();
  assert.equal(a.retry && a.retry.question, 'question for A');
  assert.equal(a.messages.length, 1);
  assert.equal(a.messages[0].state, 'failed');
});

test('Clear empties only the conversation on screen, and does not stop a question running for another prospect', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  let n = 0;
  const invoke = async (name, o) => { if (++n === 3) await gate; return { data: ok({ reply: 'r:' + o.body.message }), error: null }; };
  const ai = createStarkAi({ config: ON, invoke, uuid: () => crypto.randomUUID() });
  onProspect(ai, PID_A, 'Company A');
  await ai.send('A1');
  onProspect(ai, PID_B, 'Company B');
  await ai.send('B1');
  onProspect(ai, PID_A, 'Company A');
  const slow = ai.send('A2');                 // running for A
  onProspect(ai, PID_B, 'Company B');
  ai.clear();                                  // clears B only
  assert.deepEqual(texts(ai), []);
  assert.equal(ai.getState().sending, true, 'clearing B stopped A\'s question');
  release();
  await slow;
  onProspect(ai, PID_A, 'Company A');
  assert.deepEqual(texts(ai), ['A1', 'r:A1', 'A2', 'r:A2']);
  onProspect(ai, PID_B, 'Company B');
  assert.deepEqual(texts(ai), []);
  onProspect(ai, PID_A, 'Company A');
  ai.clear();
  assert.deepEqual(texts(ai), []);
  onProspect(ai, PID_B, 'Company B');
  await ai.send('B2');
  assert.deepEqual(ai.getState().messages[0].text, 'B2');
});

test('Clear on the screen a question is running for stops that question and discards its late answer', async () => {
  let release = null;
  const gate = new Promise((r) => { release = r; });
  const invoke = async () => { await gate; return { data: ok({ reply: 'late' }), error: null }; };
  const ai = createStarkAi({ config: ON, invoke, uuid: () => crypto.randomUUID() });
  onProspect(ai, PID_A, 'Company A');
  const pending = ai.send('A1');
  ai.clear();
  release();
  await pending;
  assert.deepEqual(ai.getState().messages, []);
  assert.equal(ai.getState().sending, false);
});

test('sign-out wipes every conversation, including ones that are not on screen', async () => {
  const { ai } = build();
  onProspect(ai, PID_A, 'A');
  await ai.send('A1');
  onProspect(ai, PID_B, 'B');
  await ai.send('B1');
  ai.reset();
  onProspect(ai, PID_A, 'A');
  assert.deepEqual(ai.getState().messages, []);
  onProspect(ai, PID_B, 'B');
  assert.deepEqual(ai.getState().messages, []);
});
