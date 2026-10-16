// Quick-prompt definitions for Stark AI.
//
// Every quick prompt sends its text as a REAL question through the Stark AI function. There are no canned or
// hard-coded answers anywhere in the client. `intent` tells the server which kind of question this is, so that it
// can send the model only the data that question needs (data minimisation). The server validates intent against
// page and rejects anything it does not recognise.

export const PAGE_LABELS = Object.freeze({
  overview: 'Overview',
  prospects: 'Prospects',
  pipeline: 'Pipeline',
  queue: 'Approval Queue',
  activity: 'Activity',
  status: 'System Status',
  prospect: 'Prospect'
});

const p = (id, text) => Object.freeze({ id: id, intent: id, text: text });

const OVERVIEW = [
  p('overview_attention', 'What needs my attention?'),
  p('sales_brief', 'Give me a sales brief.'),
  p('work_next', 'What should I work on next?')
];
const PROSPECT = [
  p('prospect_summary', 'Summarize this prospect.'),
  p('prospect_next_step', 'Recommend the next step.'),
  p('prospect_followup', 'Draft a follow-up.'),
  p('call_prep', 'Prepare me for a call.')
];
const PIPELINE = [
  p('pipeline_summary', 'Summarize my pipeline.'),
  p('pipeline_strongest', 'Which opportunities look strongest?'),
  p('pipeline_stuck', 'Where are prospects getting stuck?')
];
const ACTIVITY = [
  p('activity_changed', 'What changed recently?'),
  p('activity_summary', 'Summarize recent CRM activity.')
];
const STATUS = [
  p('status_explain', 'Explain the automation state.'),
  p('status_stuck', 'Is anything failed or stuck?')
];
const QUEUE = [
  p('queue_review', 'What needs review?'),
  p('queue_prioritize', 'Help me prioritize these drafts.')
];

// The Prospects LIST page is a pipeline-style view, so it offers the pipeline questions.
export const QUICK_PROMPTS = Object.freeze({
  overview: Object.freeze(OVERVIEW),
  prospect: Object.freeze(PROSPECT),
  prospects: Object.freeze(PIPELINE),
  pipeline: Object.freeze(PIPELINE),
  activity: Object.freeze(ACTIVITY),
  status: Object.freeze(STATUS),
  queue: Object.freeze(QUEUE)
});

export const PAGES = Object.freeze(Object.keys(PAGE_LABELS));

/** The quick prompts offered on a page (an unknown page gets none). */
export function promptsForPage(page) {
  return Object.prototype.hasOwnProperty.call(QUICK_PROMPTS, page) ? QUICK_PROMPTS[page] : Object.freeze([]);
}

/** A quick prompt by id, but only if it is offered on this page. */
export function findPrompt(page, id) {
  return promptsForPage(page).find((q) => q.id === id) || null;
}

// Questions about ONE prospect: they need a prospect id and are only valid on the prospect page.
export const PROSPECT_INTENTS = Object.freeze(['prospect_summary', 'prospect_next_step', 'prospect_followup', 'call_prep']);

export const FREE_INTENT = 'free';
