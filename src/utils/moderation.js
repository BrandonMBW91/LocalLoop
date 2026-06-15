// Lightweight client-side pre-screen for submissions. This is the FIRST gate,
// not the only one — everything still goes to the pending queue for a human.
// The goal is to catch obvious profanity and spam before it wastes your time.

// Kept intentionally small and stem-based. Expand as you see real abuse.
const PROFANITY = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'piss',
  'slut', 'whore', 'nigger', 'faggot', 'retard',
];

const SPAM_PHRASES = [
  'make money', 'work from home', 'click here', 'free money', 'crypto',
  'bitcoin', 'forex', 'viagra', 'casino', 'weight loss', 'get rich',
  'buy now', 'limited offer', 'act now', 'subscribe', 'follow me',
];

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|info|biz|xyz|shop)\b)/i;
const PHONE_RE = /(\+?\d[\s.-]?){10,}/; // long digit runs = likely spam

function normalize(text) {
  return (text || '').toLowerCase();
}

function containsWord(text, list) {
  return list.find((w) => {
    // word-boundary-ish match so "scunthorpe" doesn't trip "cunt", etc.
    const re = new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i');
    return re.test(text);
  });
}

// Returns { ok: true } or { ok: false, reason, message } for a blocked submission.
export function screenContent(parts = []) {
  const text = normalize(parts.filter(Boolean).join('  '));

  const bad = containsWord(text, PROFANITY);
  if (bad) {
    return {
      ok: false,
      reason: 'profanity',
      message:
        'Please keep it family-friendly — your post contains language we can’t allow. Edit it and try again.',
    };
  }

  // Borderline signals (links, phone numbers, spam phrases, shouting) are NOT
  // blocked here anymore — they submit and are auto-held for review server-side
  // (see supabase/moderation.sql), so you can approve borderline posts from the
  // in-app moderation screen instead of rejecting them outright.
  return { ok: true };
}
