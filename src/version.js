// Single source of truth for the visible app revision. Shown in Settings as
// "rev N" — deliberately NOT called "build" so it doesn't get confused with the
// App Store / Play binary build number. BUMP `BUILD` on every release (each OTA
// update or new binary). The store version (app.json `version`) only changes on
// a full rebuild.
export const APP_VERSION = '1.0.4';
export const BUILD = 127;

// One-line "what's new" shown once in a dismissible banner after an update (see
// WhatsNewBanner). Update it alongside BUILD each release so returning users get a
// gentle heads-up about what changed. Keep it short and user-facing.
//
// Empty for revs 121-126 (admin-only Metrics + advertiser-facing changes — nothing a
// reader would notice, so the banner stayed quiet). Rev 127 puts a line back: posting
// your own event/truck/sale from the app now actually reaches the backend (it used to
// fail silently for anyone not signed in), so returning users get the heads-up.
export const WHATS_NEW = 'You can now post your own events, food trucks, and garage sales right from the app.';
