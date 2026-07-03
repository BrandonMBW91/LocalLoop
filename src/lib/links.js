// Public links for the app itself (share sheets, prompts).
// The write-review variant lives in src/lib/review.js.
export const APP_STORE_URL = 'https://apps.apple.com/app/id6780306721';
export const SITE = 'https://localloop.io';

// Deep link for a specific listing. Opens the app directly when installed
// (Universal Links), else falls back to the App Store via a site redirect.
// kind: 'event' | 'garage-sale' | 'food-truck'
export function shareUrl(kind, id) {
  return id ? `${SITE}/${kind}/${id}` : APP_STORE_URL;
}

// Suffix appended to a share message. Pass the listing's deep link.
export function shareFooter(url) {
  return `\n\nFound on Local Loop, the free local events app:\n${url}`;
}

// Static footer (no specific listing) — used where there's no id to link to.
export const SHARE_FOOTER = shareFooter(APP_STORE_URL);
