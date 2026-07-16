// react-native-web ships two shims that silently do nothing, which quietly
// broke real flows on localloop.io:
//   - Alert.alert is a literal no-op, so confirm dialogs never appear, submit
//     flows that gate on a confirm dead-end, action buttons never fire their
//     onPress, and validation/error messages are invisible.
//   - Share.share rejects on desktop browsers (no navigator.share), so every
//     Invite/Share button silently does nothing.
// Patching both at the source fixes all ~77 Alert and 7 Share call sites at once
// without touching them. Native (iOS/Android) is untouched — this only runs on
// web. Imported once, early, from app/_layout.js.
import { Alert, Share, Platform } from 'react-native';
import { emitAlert } from './alertBus';

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  // ---- Alert.alert -> a real branded modal rendering the ACTUAL buttons ------
  // Do NOT map these onto window.confirm: a binary OK/Cancel cannot express the
  // real dialogs, and inferring a "primary" button silently posted sales to the
  // wrong town and created duplicate events. WebAlertHost renders every button
  // with its own label and handler. Fallback below never guesses.
  if (Alert && !Alert.__llPatched) {
    Alert.__llPatched = true;
    Alert.alert = (title, message, buttons) => {
      if (emitAlert({ title, message, buttons })) return;
      // No host mounted (alert fired before the tree rendered): show the text so
      // the user is never left in silence, and only auto-run a single-button
      // dialog's handler — with 2+ buttons there is no safe default to pick.
      const btns = Array.isArray(buttons) ? buttons : [];
      window.alert([title, message].filter(Boolean).join('\n\n'));
      if (btns.length === 1 && typeof btns[0].onPress === 'function') btns[0].onPress();
    };
  }

  // ---- Share.share -> Web Share API, else copy the link to the clipboard -----
  if (Share && !Share.__llPatched) {
    Share.__llPatched = true;
    Share.share = async (content = {}) => {
      const url = content.url || '';
      const message = content.message || '';
      // Mobile browsers have the native share sheet.
      if (navigator.share) {
        try {
          await navigator.share({ title: content.title, text: message, url: url || undefined });
          return { action: 'sharedAction' };
        } catch (e) {
          // User dismissed the sheet, or it failed — fall through to clipboard.
        }
      }
      // Desktop fallback: copy the link (or the message) so the button does
      // something instead of silently failing.
      const toCopy = url || message;
      if (toCopy && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(toCopy);
          window.alert('Link copied to clipboard.');
          return { action: 'sharedAction' };
        } catch (e) { /* clipboard blocked — nothing more we can do */ }
      }
      return { action: 'dismissedAction' };
    };
  }

  // Marker so the fix can be verified on the live site.
  window.__llWebPatches = { alert: true, share: true };
}
