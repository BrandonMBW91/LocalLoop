// Public links for the app itself (share sheets, prompts).
// The write-review variant lives in src/lib/review.js.
export const APP_STORE_URL = 'https://apps.apple.com/app/id6780306721';

// Suffix appended to every share message so the recipient gets a tappable
// install link (iMessage renders it as an App Store card).
export const SHARE_FOOTER = `\n\nFound on Local Loop, the free local events app:\n${APP_STORE_URL}`;
