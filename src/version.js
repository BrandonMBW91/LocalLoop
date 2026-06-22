// Single source of truth for the visible app revision. Shown in Settings as
// "rev N" — deliberately NOT called "build" so it doesn't get confused with the
// App Store / Play binary build number. BUMP `BUILD` on every release (each OTA
// update or new binary). The store version (app.json `version`) only changes on
// a full rebuild.
export const APP_VERSION = '1.0.0';
export const BUILD = 40;
