import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JS_DIR, load } from './helpers.mjs';

const read = (rel) => fs.readFileSync(JS_DIR + rel, 'utf8');
const AI_FILES = fs.readdirSync(JS_DIR + 'ai').filter((f) => f.endsWith('.js')).map((f) => 'ai/' + f);
// Code lines only: whole-line comments are ignored (the files explain what they do NOT do).
const codeLines = (rel) => read(rel).split('\n').map((text, i) => ({ text, n: i + 1 })).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.text));
const find = (files, re) => files.flatMap((f) => codeLines(f).filter((l) => re.test(l.text)).map((l) => f + ':' + l.n + ' ' + l.text.trim()));

test('SHIPS DISABLED (tripwire: update this one test in the same change that deliberately enables Stark AI)', async () => {
  const { STARK_AI } = await load('config.js');
  assert.equal(STARK_AI.enabled, false);
  assert.ok(Object.isFrozen(STARK_AI));
  assert.equal(STARK_AI.functionName, 'stark-ai');
});

test('no HTML sinks, eval or browser storage in the Stark AI code, the shell or the router', () => {
  const files = AI_FILES.concat(['components/shell.js', 'router.js']);
  assert.deepEqual(find(files, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|\beval\(|new Function|localStorage|sessionStorage|indexedDB|document\.cookie|execCommand/), []);
});

test('the only network use in ai/ is the Supabase client\'s functions.invoke; nothing can write to the CRM', () => {
  const hits = find(AI_FILES, /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|\.rpc\(|\.from\(\s*['"]|\bsb\b|supabase/);
  assert.deepEqual(hits.map((h) => h.split(' ')[0].split(':')[0]).filter((f, i, a) => a.indexOf(f) === i), ['ai/starkAi.js']);
  assert.ok(hits.every((h) => /import \{ sb \}|!sb|sb\.functions/.test(h)), hits.join('\n'));
  assert.deepEqual(find(AI_FILES, /^import .*\/(auth|actions|modal)\.js/), []);
});

test('the administrator check runs only when Stark AI is enabled, and only asks is_admin', () => {
  const router = codeLines('router.js').map((l) => l.text).join('\n');
  assert.match(router, /aiAdmin = aiEnabled\(\) \? await checkAdminAccess\(\(name\) => sb\.rpc\(name\)\) : false;/);
  assert.equal((router.match(/\.rpc\(/g) || []).length, 1, 'the router makes exactly one rpc call');
  assert.match(router, /aiPanel: aiActive\(\) \?/);
  assert.ok(!/aiPanel: aiEnabled\(\)/.test(router), 'the panel is never built from the flag alone');
});

test('the shell builds Stark AI buttons only when it is handed a panel', () => {
  const shell = codeLines('components/shell.js').map((l) => l.text).join('\n');
  assert.match(shell, /if \(aiPanel\) \{\s*aiNavBtn = /);
  assert.match(shell, /if \(aiPanel\) \{\s*aiTopBtn = /);
});

test('no send, approve or other write wording leaked into the Stark AI controls', () => {
  const ui = ['ai/starkAiMessages.js', 'ai/starkAiPanel.js', 'ai/starkAiComposer.js'];
  assert.deepEqual(find(ui, /sendEmail|sendMessage|\.from\(|\.(insert|upsert)\(|mailto:|\bsend\(.*(email|prospect)/i), []);
  const labels = ['Copy email', 'Draft, not sent'];
  const messages = read('ai/starkAiMessages.js');
  labels.forEach((l) => assert.ok(messages.includes(l), l));
});

test('the privacy note says what is shared, and makes no promise the backend does not keep', () => {
  const panel = read('ai/starkAiPanel.js');
  const note = (/const WELCOME_NOTE = '((?:[^'\\]|\\.)*)'/.exec(panel) || [])[1] || '';
  assert.ok(note.length > 200, 'WELCOME_NOTE not found');
  for (const must of ['read-only', 'Anthropic', 'your question', 'earlier messages', 'contact\\\'s name', '2 newest messages', 'company names', 'can miss', 'names, signatures and street addresses are not filtered']) {
    assert.ok(note.includes(must), 'note is missing: ' + must);
  }
  // no absolute promise about removing personal details
  assert.ok(!/removed first|always removed|never sent|completely|guarantee|no personal/i.test(note), 'note promises too much');
});
