import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const { checkAdminAccess } = await load('ai/starkAiAccess.js');

test('administrator: only an exact boolean true counts', async () => {
  assert.equal(await checkAdminAccess(async () => ({ data: true, error: null })), true);
});

test('fails closed: anything other than a clear true hides Stark AI', async () => {
  const answers = [
    { data: false, error: null }, { data: null, error: null }, { data: 'true', error: null }, { data: 1, error: null },
    { data: {}, error: null }, { data: [true], error: null }, { data: undefined }, { data: true, error: { message: 'x' } },
    { data: null, error: { code: '42501' } }, null, undefined, 'true', 42
  ];
  for (const a of answers) assert.equal(await checkAdminAccess(async () => a), false, JSON.stringify(a));
});

test('fails closed on a rejected or throwing call', async () => {
  assert.equal(await checkAdminAccess(async () => { throw new Error('network'); }), false);
  assert.equal(await checkAdminAccess(() => { throw new Error('sync'); }), false);
  assert.equal(await checkAdminAccess(null), false);
  assert.equal(await checkAdminAccess('is_admin'), false);
});

test('fails closed (and does not hang the app) when the database never answers', async () => {
  let fire = null;
  const result = checkAdminAccess(() => new Promise(() => {}), { setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(typeof fire, 'function', 'a timeout was armed');
  fire();
  assert.equal(await result, false);
});

test('asks only the one read-only question, exactly once', async () => {
  const names = [];
  await checkAdminAccess(async (name) => { names.push(name); return { data: true, error: null }; });
  assert.deepEqual(names, ['is_admin']);
});
