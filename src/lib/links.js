// Public links for the app itself (share sheets, prompts).
// The write-review variant lives in src/lib/review.js.
export const APP_STORE_URL = 'https://apps.apple.com/app/id6780306721';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.michaelwilliams.localloop';
// Android is still in CLOSED TESTING — its public Play listing 404s. Flip to true
// the moment it goes public, and the web download banner starts offering Android.
export const ANDROID_LIVE = false;
export const SITE = 'https://localloop.io';

// Normalize a link an ADVERTISER typed, for the paid sponsor/deal forms.
//
// Businesses hand you "joespizza.com", not a URL. Stored raw, that link is dead:
// Linking.openURL rejects it on iOS/Android and the catch swallows the error, while
// on web it resolves relative and opens localloop.io/joespizza.com — a 404. Either
// way the tap still counts, so the CTR reported back to the advertiser includes taps
// that never reached them. That is worse than a broken link: it is a wrong number on
// an invoice.
//
// Returns '' for empty (the field is optional), null when it cannot be salvaged (the
// caller should refuse to save and say so), else the usable URL.
//
// Deliberately regex, not `new URL()`: React Native's URL polyfill is incomplete, and
// this codebase has been bitten twice by engine-dependent built-ins (Hermes Intl).
export function normalizeLinkUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^(tel:|mailto:)/i.test(s)) return s;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  const host = /^https?:\/\/([^\s/?#]+)/i.exec(withScheme);
  // Require a real dotted host, which is also what rejects 'javascript:alert(1)'
  // (it gets an https:// prefix, then fails here) and bare words like 'call us'.
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d{1,5})?$/i.test(host[1])) return null;
  return withScheme;
}

// Deep link for a specific listing. Opens the app directly when installed
// (Universal Links), else falls back to the SITE — never a single store's page:
// a share recipient can be on either platform, and localloop.io pitches both.
// kind: 'event' | 'garage-sale' | 'food-truck'
export function shareUrl(kind, id) {
  return id ? `${SITE}/${kind}/${id}` : SITE;
}

// Suffix appended to a share message. Pass the listing's deep link.
export function shareFooter(url) {
  return `\n\nFound on Local Loop, the free local events app:\n${url}`;
}

// Static footer (no specific listing) — used where there's no id to link to.
export const SHARE_FOOTER = shareFooter(SITE);

// Invite message for sharing the whole app (no specific listing). Uses SITE via
// SHARE_FOOTER — never a single store's page — so it works for a recipient on
// either platform. Wired into the "Tell a friend" actions in Settings and the
// empty Saved state.
export function shareAppMessage() {
  return `Your town's happenings in one place: events, garage sales, and food trucks.${SHARE_FOOTER}`;
}
