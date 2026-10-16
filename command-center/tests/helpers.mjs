// Shared test helpers. No network, no DOM.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export const JS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js') + path.sep;
export const load = (relative) => import(pathToFileURL(JS_DIR + relative).href);

export const PID_A = '11111111-2222-4333-8444-555555555555';
export const PID_B = '99999999-2222-4333-8444-555555555555';

export const ok = (extra) => ({
  ok: true, requestId: 'req-1', reply: 'An answer.', blocked: false, truncated: false, refused: false, ...(extra || {})
});

/** A fake supabase.functions.invoke that records every call and answers with `answer(body)`. */
export function fakeInvoke(answer) {
  const calls = [];
  const invoke = async (name, options) => {
    calls.push({ name, body: JSON.parse(JSON.stringify(options.body)) });
    const out = answer(options.body, calls.length);
    return out && out.error ? { data: null, error: out.error } : { data: out, error: null };
  };
  return { invoke, calls };
}

export const httpError = (status, code) => ({
  name: 'FunctionsHttpError',
  context: { status, headers: { get: () => null }, json: async () => ({ ok: false, code }) }
});
