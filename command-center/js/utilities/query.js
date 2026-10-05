// URL (hash) parsing and building for the Command Center.
//
// SECURITY: everything in the URL is UNTRUSTED input (anyone can hand you a crafted link).
// Rules used throughout the app:
//   - path segments and parameters are only ever used as lookup keys, compared against allowlists,
//     or placed into input.value / textContent. They are never inserted as HTML or used in selectors.
//   - parameter names are restricted to [a-z_], at most 20 are read, each value is capped in length.
//   - the parameter object has no prototype, so a hostile key cannot touch Object.prototype.

const MAX_PARAMS = 20;
const MAX_VALUE_LENGTH = 200;

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch (e) {
    return '';
  }
}

/** "#/prospects/abc/timeline?order=asc" -> { segments: ['prospects','abc','timeline'], params: { order: 'asc' } } */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const q = raw.indexOf('?');
  const pathPart = q === -1 ? raw : raw.slice(0, q);
  const queryPart = q === -1 ? '' : raw.slice(q + 1);

  const segments = pathPart.split('/').map(safeDecode).filter((s) => s !== '');

  const params = Object.create(null);
  let count = 0;
  new URLSearchParams(queryPart).forEach((value, key) => {
    if (count >= MAX_PARAMS) return;
    if (!/^[a-z_]{1,20}$/.test(key)) return;
    if (key in params) return;
    params[key] = String(value).slice(0, MAX_VALUE_LENGTH);
    count++;
  });

  return { segments: segments, params: params };
}

/** Build "#/a/b?x=1" safely (every segment and value is percent-encoded; empty values are dropped). */
export function buildHash(segments, params) {
  const path = (segments || []).map((s) => encodeURIComponent(String(s))).join('/');
  const search = new URLSearchParams();
  Object.keys(params || {}).forEach((key) => {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const qs = search.toString();
  return '#/' + path + (qs ? '?' + qs : '');
}

/** The value if it is on the allowlist, otherwise the fallback. */
export function pickEnum(value, allowed, fallback) {
  return allowed.indexOf(value) !== -1 ? value : fallback;
}

/** Free text from the URL: capped, control characters removed. Only ever shown via value/textContent. */
export function pickText(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .slice(0, max)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
}

export function hrefProspect(id, tab) {
  const segments = ['prospects', String(id)];
  if (tab && tab !== 'summary') segments.push(tab);
  return buildHash(segments, {});
}
