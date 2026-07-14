// Shared text cleanup. Scraped calendars hand us HTML-encoded junk like
// "Ohio&#8217;s", double-encoded "&amp;#8217;", literal "&lt;p&gt;" tags, curly
// quotes and em-dashes. This module is the single place that turns any of that
// into clean, plain text. Imported by the app (render defense), the aggregator
// (clean on ingest), and the SEO page generator.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', sbquo: '‚',
  ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', ndash: '–', mdash: '—',
  deg: '°', copy: '©', reg: '®', trade: '™',
  eacute: 'é', middot: '·', bull: '•',
};

function safeChar(code) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch (e) { return ''; }
}

// &amp; &#8217; &#x2019; &rsquo; -> real characters. Loops to unwind
// double-encoding such as "&amp;#8217;" -> "&#8217;" -> "’".
export function decodeEntities(input) {
  if (typeof input !== 'string') return '';
  if (!input || input.indexOf('&') === -1) return input;
  let s = input;
  for (let i = 0; i < 4 && s.indexOf('&') !== -1; i++) {
    const before = s;
    s = s
      .replace(/&#(\d+);/g, (_, n) => safeChar(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => safeChar(parseInt(n, 16)))
      .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
        const k = name.toLowerCase();
        return Object.prototype.hasOwnProperty.call(NAMED, k) ? NAMED[k] : m;
      });
    if (s === before) break;
  }
  return s;
}

// Decode, then flatten smart punctuation to plain ASCII. Keeps copy free of
// curly quotes, em-dashes, and stray non-breaking / zero-width spaces.
export function normalizeText(input) {
  const s = decodeEntities(input);
  if (!s) return '';
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/[‒–]/g, '-')
    .replace(/—/g, ' - ')
    .replace(/[   ]/g, ' ')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Titles, host names, item lists: decode + normalize, nothing removed.
export function cleanText(input) {
  return normalizeText(input);
}

// Venue / address: also strip trailing/leading separators (" -", stray commas
// and periods) that scraped location fields tend to carry, plus two classes of
// pure feed noise: room-capacity annotations ("(Capacity : 65)") no user needs
// (they also break geocoding), and a trailing ", USA" / ", United States"
// country suffix (every listing here is in the US).
export function cleanLocation(input) {
  let s = normalizeText(input);
  if (!s) return '';
  s = s
    .replace(/\(\s*capacity\s*:?\s*\d+\s*\)/gi, ' ')
    .replace(/,?\s*(?:USA|U\.S\.A\.|United States(?: of America)?)\s*$/i, '')
    .replace(/[ \t]{2,}/g, ' ');
  // Strip stray separators (" -", trailing commas/semicolons) but keep legit
  // trailing periods on abbreviations like "Ind." or "Blvd.".
  return s.replace(/^[\s,;:\-]+/, '').replace(/[\s,;:\-]+$/, '').trim();
}

// Descriptions can contain real HTML once decoded ("<p>...</p>"). Turn block
// tags into line breaks, drop the rest, then normalize.
export function cleanDescription(input) {
  if (!input) return '';
  let s = decodeEntities(String(input));
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li\s*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  s = normalizeText(s);
  s = s.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  // Trailing feed-plumbing URLs (WhoFi appends its own '?method=ical' link;
  // some feeds end with a bare URL line) are noise everywhere they render —
  // the app, share sheets, and the SEO pages' meta/og descriptions.
  while (/\s*https?:\/\/\S+$/i.test(s)) s = s.replace(/\s*https?:\/\/\S+$/i, '').trim();
  return s;
}
