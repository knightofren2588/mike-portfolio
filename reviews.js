/* =========================================================
   Shared review helpers — used by testimonials.html and massage.html

   SECURITY RULES FOR THIS FILE (please keep them):
   1. Anything a visitor typed (name, service, review text) is only ever
      put on the page with textContent. NEVER use innerHTML / insertAdjacentHTML
      with review data — that is what allows stored XSS.
   2. Ratings are always forced to a whole number from 1 to 5.
   3. Nothing here is the real security boundary. Browser code can be
      edited by anyone. The database (Supabase Row Level Security) must
      enforce: anonymous users can only INSERT rows with approved = false,
      can only SELECT rows with approved = true, and can never UPDATE/DELETE.
   ========================================================= */
(function (global) {
  'use strict';

  var LIMITS = { name: 80, service: 120, review_text: 1500 };
  var ALLOWED_PAGES = { starktech: true, sacredhands: true };
  var MIN_SECONDS_ON_PAGE = 3; // bots submit instantly; people need a few seconds

  /* Turn any value into a whole number 1–5, or return `fallback` when it
     isn't usable (null, undefined, '', 0, NaN, Infinity, objects, etc.). */
  function clampRating(value, fallback) {
    if (typeof value !== 'number' && typeof value !== 'string') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    var n = Number(value);
    if (!isFinite(n) || n === 0) return fallback;
    n = Math.round(n);
    if (n < 1) n = 1;
    if (n > 5) n = 5;
    return n;
  }

  /* Star string for DISPLAY. Invalid ratings show no stars (we never invent one). */
  function starString(rating) {
    var r = clampRating(rating, 0);
    return r > 0 ? '⭐'.repeat(r) : '';
  }

  /* Trim, coerce to string, and cap the length. */
  function cleanText(value, maxLength) {
    if (value === null || value === undefined) return '';
    var s = String(value).trim();
    return maxLength ? s.slice(0, maxLength) : s;
  }

  /* Small DOM helper. `text` is assigned with textContent, so it can never
     be interpreted as HTML. */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /* First visible character of a name (safe for emoji / surrogate pairs). */
  function initialOf(name) {
    var first = Array.from(String(name || ''))[0];
    return first ? first.toUpperCase() : '?';
  }

  /* Load approved reviews for one site page. Returns [] on any problem.
     Only the columns we actually display are requested. */
  async function fetchApproved(sb, page) {
    if (!ALLOWED_PAGES[page]) return [];
    try {
      var res = await sb
        .from('reviews')
        .select('name, service, rating, review_text')
        .eq('page', page)
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(50);
      if (res.error || !Array.isArray(res.data)) return [];
      return res.data.filter(function (row) { return row && typeof row === 'object'; });
    } catch (err) {
      return [];
    }
  }

  /* Submit a new review. Returns { ok: true } or { ok: false, message }.
     - honeypot: a hidden field real visitors never fill in
     - time trap: reject submits that happen within seconds of page load
     - length limits and a forced 1–5 rating
     - `approved: false` is sent for clarity only; the database must enforce it. */
  async function submitReview(sb, page, fields) {
    var genericError = 'Something went wrong. Please try again.';
    if (!ALLOWED_PAGES[page]) return { ok: false, message: genericError };

    // Honeypot filled in => a bot. Pretend it worked so it learns nothing.
    if (fields.honeypot && String(fields.honeypot).trim() !== '') {
      return { ok: true, skipped: true };
    }

    if (typeof fields.loadedAt === 'number' &&
        (Date.now() - fields.loadedAt) < MIN_SECONDS_ON_PAGE * 1000) {
      return { ok: false, message: 'Please take a moment to review your message, then submit again.' };
    }

    var name = cleanText(fields.name, LIMITS.name);
    var service = cleanText(fields.service, LIMITS.service);
    var reviewText = cleanText(fields.review_text, LIMITS.review_text);
    if (!name || !reviewText) {
      return { ok: false, message: 'Please enter your name and your review.' };
    }

    var rating = clampRating(fields.rating, 5); // same default as before: 5 if no star picked

    try {
      var res = await sb.from('reviews').insert([{
        name: name,
        service: service,
        rating: rating,
        review_text: reviewText,
        page: page,
        approved: false
      }]);
      if (res.error) return { ok: false, message: genericError };
      return { ok: true };
    } catch (err) {
      return { ok: false, message: genericError };
    }
  }

  global.StarkReviews = {
    LIMITS: LIMITS,
    clampRating: clampRating,
    starString: starString,
    cleanText: cleanText,
    initialOf: initialOf,
    el: el,
    fetchApproved: fetchApproved,
    submitReview: submitReview
  };
})(window);
