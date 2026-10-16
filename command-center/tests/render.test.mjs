import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';

const { splitReply, cleanReplyText, isDraftReply, extractEmail, DRAFT_REVIEW_LINE, REPLY_MAX_CHARS } = await load('ai/renderReply.js');

const DRAFT = DRAFT_REVIEW_LINE + '\n\nSubject: Quick question\n\nHi Pat,\n\nI help small shops keep track of requests.\n\nMike Butcher, Stark Tech Studios';

test('replies are plain paragraphs and "- " bullets only; markup stays as visible text', () => {
  const blocks = splitReply('Intro <b>bold</b> <img src=x onerror=alert(1)>\n\n- one <script>alert(1)</script>\n- two\n\n[link](javascript:alert(1))');
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'ul', 'p']);
  assert.match(blocks[0].text, /<img src=x onerror=alert\(1\)>/);
  assert.equal(blocks[1].items.length, 2);
  assert.equal(blocks[2].text, '[link](javascript:alert(1))');
});

test('control characters and hidden text-direction characters are removed; length is capped', () => {
  assert.equal(cleanReplyText('a\u0000b‮c​d\u0007e'), 'abcde');
  assert.equal(cleanReplyText('x'.repeat(REPLY_MAX_CHARS + 50)).length, REPLY_MAX_CHARS);
  assert.deepEqual(splitReply(''), []);
  assert.deepEqual(splitReply(null), []);
});

test('a draft is recognised only when the review line comes first', () => {
  assert.equal(isDraftReply(DRAFT), true);
  assert.equal(isDraftReply('  \n' + DRAFT), true, 'leading whitespace is ignored');
  assert.equal(isDraftReply('Here is my analysis.\n\n' + DRAFT), false, 'anything before the line: not a draft');
  assert.equal(isDraftReply('Outreach is blocked for this prospect.'), false);
  assert.equal(isDraftReply(''), false);
});

test('Copy email = subject, body and signature, WITHOUT the review line', () => {
  const email = extractEmail(DRAFT);
  assert.ok(email.startsWith('Subject: Quick question'));
  assert.ok(email.includes('I help small shops keep track of requests.'));
  assert.ok(email.endsWith('Mike Butcher, Stark Tech Studios'));
  assert.ok(!email.includes('Draft (for your review'));
  assert.ok(!email.includes('nothing has been sent'));
});

test('no email is offered for anything that is not the expected draft shape', () => {
  assert.equal(extractEmail('Outreach is blocked for this prospect.'), '');
  assert.equal(extractEmail(DRAFT_REVIEW_LINE), '');
  assert.equal(extractEmail(DRAFT_REVIEW_LINE + '\n\nHi Pat, no subject line here.'), '');
  assert.equal(extractEmail(DRAFT_REVIEW_LINE + '\n\nSubject:\n\nbody'), '');
  assert.equal(extractEmail('Note first.\n\n' + DRAFT), '');
});

test('line endings are normalised and hidden characters never reach the clipboard text', () => {
  const email = extractEmail(DRAFT.replace(/\n/g, '\r\n').replace('Hi Pat', 'Hi‮ Pat\u0000'));
  assert.ok(!email.includes('\r'));
  assert.ok(!/[‮\u0000]/.test(email));
});

test('the reply classes match the stylesheet (so line breaks and bullets are styled)', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync(new URL('../assets/cc.css', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../js/ai/renderReply.js', import.meta.url), 'utf8');
  for (const name of src.match(/cc-ai-reply-[a-z]+/g) || []) assert.ok(css.includes('.' + name), name + ' has no CSS rule');
  assert.ok(/class: 'cc-ai-reply-text'/.test(src) && /class: 'cc-ai-reply-list'/.test(src));
});
