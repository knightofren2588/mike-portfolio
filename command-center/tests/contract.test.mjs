// Compares this frontend with the Stark AI backend SOURCE (no network). Skips itself if the backend folder is not beside this repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { JS_DIR, load, PID_A } from './helpers.mjs';

const BACKEND = process.env.STARK_BACKEND_DIR
  ? path.resolve(process.env.STARK_BACKEND_DIR)
  : path.resolve(JS_DIR, '../../../stark-tech-backend');
const FN = path.join(BACKEND, 'supabase/functions/stark-ai') + path.sep;
const present = fs.existsSync(FN + 'config.ts') && fs.existsSync(FN + 'digest.ts') && fs.existsSync(FN + 'validate.ts');

async function backend() {
  try {
    return {
      cfg: await import(pathToFileURL(FN + 'config.ts').href),
      dig: await import(pathToFileURL(FN + 'digest.ts').href),
      val: await import(pathToFileURL(FN + 'validate.ts').href)
    };
  } catch (e) { return null; }
}
const skipReason = !present ? 'backend folder not found (set STARK_BACKEND_DIR)' : false;

test('limits, pages, intents and summary sections match the backend', { skip: skipReason }, async (t) => {
  const be = await backend();
  if (!be) return t.skip('this Node cannot load TypeScript (run with --experimental-strip-types)');
  const { STARK_AI } = await load('config.js');
  const ctx = await load('ai/starkAiContext.js');
  const prm = await load('ai/starkAiPrompts.js');
  const L = be.cfg.LIMITS;
  assert.equal(STARK_AI.maxMessageChars, L.maxMessageChars);
  assert.equal(STARK_AI.historyMaxEntries, L.maxHistoryEntries);
  assert.equal(STARK_AI.historyEntryChars, L.maxHistoryEntryChars);
  assert.equal(STARK_AI.historyTotalChars, L.maxHistoryTotalChars);
  assert.equal(STARK_AI.replyMaxChars, L.maxReplyChars);
  assert.ok(STARK_AI.requestTimeoutMs > L.anthropicTimeoutMs, 'the browser waits longer than the server\'s own model timeout');
  assert.equal(ctx.SUMMARY_MAX_CHARS, L.maxDigestChars);
  assert.deepEqual([...prm.PAGES].sort(), [...be.cfg.PAGES].sort());
  assert.deepEqual(Object.keys(ctx.SECTIONS_BY_INTENT).sort(), [...be.cfg.INTENTS].sort());
  assert.deepEqual(ctx.SECTIONS_BY_INTENT, JSON.parse(JSON.stringify(be.cfg.DIGEST_SECTIONS)));
  assert.deepEqual(ctx.FREE_SECTIONS_BY_PAGE, JSON.parse(JSON.stringify(be.cfg.FREE_PAGE_SECTIONS)));
  assert.deepEqual([...prm.PROSPECT_INTENTS].sort(), [...be.cfg.PROSPECT_INTENTS].sort());
  const spec = (s) => JSON.parse(JSON.stringify(s));
  assert.deepEqual(spec(ctx.SUMMARY_SCHEMA), spec(be.dig.DIGEST_SCHEMA), 'summary schema is identical to the server\'s');
});

test('every quick prompt is accepted by the real backend validator', { skip: skipReason }, async (t) => {
  const be = await backend();
  if (!be) return t.skip('this Node cannot load TypeScript (run with --experimental-strip-types)');
  const { createStarkAi } = await load('ai/starkAiController.js');
  const { STARK_AI } = await load('config.js');
  const prm = await load('ai/starkAiPrompts.js');
  const ON = Object.freeze({ ...STARK_AI, enabled: true, minSecondsBetweenRequests: 0 });
  for (const page of prm.PAGES) {
    for (const q of prm.promptsForPage(page)) {
      let body = null;
      const ai = createStarkAi({ config: ON, uuid: () => crypto.randomUUID(), invoke: async (n, o) => { body = JSON.parse(JSON.stringify(o.body)); return { data: { ok: true, reply: 'ok', requestId: 'r' }, error: null }; } });
      ai.setContext({ page, prospectId: page === 'prospect' ? PID_A : null });
      await ai.sendQuickPrompt(q.id);
      const parsed = be.val.parseRequest(body);
      assert.equal(parsed.ok, true, page + ':' + q.id + ' ' + (parsed.message || ''));
    }
  }
});

test('free text with history is accepted by the real backend validator', { skip: skipReason }, async (t) => {
  const be = await backend();
  if (!be) return t.skip('this Node cannot load TypeScript (run with --experimental-strip-types)');
  const { createStarkAi } = await load('ai/starkAiController.js');
  const { STARK_AI } = await load('config.js');
  const ON = Object.freeze({ ...STARK_AI, enabled: true, minSecondsBetweenRequests: 0 });
  const bodies = [];
  const ai = createStarkAi({ config: ON, uuid: () => crypto.randomUUID(), invoke: async (n, o) => { bodies.push(JSON.parse(JSON.stringify(o.body))); return { data: { ok: true, reply: 'an answer', requestId: 'r' }, error: null }; } });
  ai.setContext({ page: 'prospect', prospectId: PID_A });
  await ai.send('What would you recommend as my next step with this prospect?');
  await ai.send('Draft a professional follow-up based on our previous contact.');
  assert.equal(bodies[1].history.length, 2);
  bodies.forEach((b) => assert.equal(be.val.parseRequest(b).ok, true));
});

test('the privacy note matches what the backend sends (contact name and message bodies only for drafts, call prep, open questions)', { skip: skipReason }, async (t) => {
  const be = await backend();
  if (!be) return t.skip('this Node cannot load TypeScript (run with --experimental-strip-types)');
  const tiers = be.cfg.PROSPECT_TIERS;
  const withBodies = Object.keys(tiers).filter((k) => tiers[k].messageBodies > 0).sort();
  const withName = Object.keys(tiers).filter((k) => tiers[k].contactName).sort();
  assert.deepEqual(withBodies, ['call_prep', 'free', 'prospect_followup']);
  assert.deepEqual(withName, ['call_prep', 'free', 'prospect_followup']);
  assert.ok(withBodies.every((k) => tiers[k].messageBodies === 2), 'the note says "2 newest messages"');
  // the backend itself says the filter is not a guarantee: keep the note honest about that
  const scrub = fs.readFileSync(FN + 'scrub.ts', 'utf8');
  assert.ok(/not a promise that no personal detail/i.test(scrub), 'scrub.ts no longer says the filter is best-effort: re-check the note');
});
