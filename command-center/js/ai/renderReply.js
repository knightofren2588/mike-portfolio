// Stark AI: show an AI reply as PLAIN TEXT.
//
// An AI reply is untrusted text. It may contain "<script>", "<img onerror=...>", Markdown links, "javascript:" URLs or
// anything else. This file never interprets any of it:
//   - text only reaches the page through text nodes (document.createTextNode / textContent via the safe h() helper)
//   - there is no innerHTML, no outerHTML, no insertAdjacentHTML, no document.write, no DOMParser, no eval
//   - there is NO Markdown-to-HTML conversion and no HTML sanitiser library (Step 2 deliberately has none)
//   - there are no links and no images: a URL in a reply is just visible characters, it is not clickable
//   - the only structure recognised is what the AI was told to write: blank-line paragraphs and "- " bullet lines
//
// splitReply() is pure (testable without a browser). renderReply() builds DOM from its result.

import { h } from '../dom.js';

export const REPLY_MAX_CHARS = 12000;

// Control characters (except tab / newline) and invisible text-direction tricks are removed before display.
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

/** Clean untrusted text for display: normalised line endings, no control or hidden characters, capped length. */
export function cleanReplyText(value, max) {
  const limit = max === undefined ? REPLY_MAX_CHARS : max;
  const text = String(value === undefined || value === null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_RE, '')
    .trim();
  return text.length > limit ? text.slice(0, limit) : text;
}

/**
 * Split a reply into display blocks:
 *   [{ type: 'p', text }]                paragraph (lines joined with single newlines kept)
 *   [{ type: 'ul', items: [text, ...] }] consecutive "- " (or "* ") lines
 */
export function splitReply(value) {
  const text = cleanReplyText(value);
  if (!text) return [];
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join('\n') });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.length) blocks.push({ type: 'ul', items: list });
    list = null;
  };

  text.split('\n').forEach((raw) => {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') { flushParagraph(); flushList(); return; }
    const bullet = /^\s{0,3}[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list) list = [];
      list.push(bullet[1]);
      return;
    }
    flushList();
    paragraph.push(line.trim());
  });
  flushParagraph();
  flushList();
  return blocks;
}

// ----- drafts -----
// The server tells the model to start every draft with exactly this line (it is a label for Mike, not part of the email).
export const DRAFT_REVIEW_LINE = 'Draft (for your review; nothing has been sent)';

/** True when the reply is a draft: it begins with the review line. (Pure text check; nothing is ever sent from here.) */
export function isDraftReply(value) {
  return cleanReplyText(value).startsWith(DRAFT_REVIEW_LINE);
}

/**
 * The email only: everything after the review line (the "Subject:" line, the body and the signature).
 * Returns '' unless the reply has the expected shape (review line, then a "Subject:" line), so a reply that does not look
 * like a draft never offers a copy button.
 */
export function extractEmail(value) {
  const text = cleanReplyText(value);
  if (!text.startsWith(DRAFT_REVIEW_LINE)) return '';
  const rest = text.slice(DRAFT_REVIEW_LINE.length).replace(/^\s+/, '');
  if (!/^Subject:[ \t]*\S/.test(rest)) return '';
  return rest.trim();
}

/** A DocumentFragment of <p> and <ul><li> elements whose content is text nodes only. */
export function renderReply(value) {
  const fragment = document.createDocumentFragment();
  splitReply(value).forEach((block) => {
    if (block.type === 'ul') {
      fragment.appendChild(h('ul', { class: 'cc-ai-reply-list' }, block.items.map((item) => h('li', { text: item }))));
    } else {
      fragment.appendChild(h('p', { class: 'cc-ai-reply-text', text: block.text }));
    }
  });
  return fragment;
}
