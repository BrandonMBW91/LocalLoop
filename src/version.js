// Single source of truth for the visible app revision. Shown in Settings as
// "rev N" — deliberately NOT called "build" so it doesn't get confused with the
// App Store / Play binary build number. BUMP `BUILD` on every release (each OTA
// update or new binary). The store version (app.json `version`) only changes on
// a full rebuild.
export const APP_VERSION = '1.0.4';
export const BUILD = 126;

// One-line "what's new" shown once in a dismissible banner after an update (see
// WhatsNewBanner). Update it alongside BUILD each release so returning users get a
// gentle heads-up about what changed. Keep it short and user-facing.
//
// EMPTY ON PURPOSE for revs 121-126. WhatsNewBanner fires whenever the stored rev is
// behind BUILD *and* this string is truthy, so leaving rev 120's text here would
// re-show a message people already dismissed — advertising "twice as many events" a
// second time for a release that changed nothing they can see. Revs 121-122 are the
// admin-only Metrics screen (all-towns total views, then its per-town breakdown), so the rev advances for
// update-adoption tracking and the banner stays quiet. Put a line back the moment a
// release actually changes something for users.
export const WHATS_NEW = '';
