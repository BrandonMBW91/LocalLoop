// Tiny bridge so the imperative Alert.alert(...) API (called from anywhere, not
// inside React) can reach a mounted React modal host on web. See webPatches.js
// (publisher) and components/WebAlertHost.js (subscriber).
let handler = null;

export function setAlertHandler(fn) {
  handler = typeof fn === 'function' ? fn : null;
}

// Returns true if a host consumed it; false means nothing is mounted to show it.
export function emitAlert(payload) {
  if (!handler) return false;
  handler(payload);
  return true;
}
