// Single source of truth for the visible app revision. Shown in Settings as
// "rev N" — deliberately NOT called "build" so it doesn't get confused with the
// App Store / Play binary build number. BUMP `BUILD` on every release (each OTA
// update or new binary). The store version (app.json `version`) only changes on
// a full rebuild.
export const APP_VERSION = '1.0.4';
export const BUILD = 118;

// One-line "what's new" shown once in a dismissible banner after an update (see
// WhatsNewBanner). Update it alongside BUILD each release so returning users get a
// gentle heads-up about what changed. Keep it short and user-facing.
export const WHATS_NEW = "The town picker now shows each town's nickname alongside its event count.";
