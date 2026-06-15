// Single source of truth for the visible app version + build number.
// BUMP `BUILD` on every release (each OTA update or new binary) so the Settings
// screen always shows which revision is actually live. The store version
// (app.json `version`) only changes on a full rebuild.
export const APP_VERSION = '1.0.0';
export const BUILD = 23;
