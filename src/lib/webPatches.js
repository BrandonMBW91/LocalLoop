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

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  // ---- Alert.alert -> window.confirm/alert, firing the right button ----------
  if (Alert && !Alert.__llPatched) {
    Alert.__llPatched = true;
    Alert.alert = (title, message, buttons) => {
      const text = [title, message].filter(Boolean).join('\n\n');
      const btns = Array.isArray(buttons) ? buttons : [];
      const cancelBtn = btns.find((b) => b && b.style === 'cancel');
      const actionable = btns.filter((b) => b && b.style !== 'cancel');
      // The affirmative action is the last non-cancel button (RN convention).
      const primary = actionable[actionable.length - 1] || btns[btns.length - 1];
      const fire = (b) => { if (b && typeof b.onPress === 'function') b.onPress(); };

      // No cancel button => a notice or an all-paths-proceed dialog (e.g. the
      // post-submit "Tell a friend / View Events"). window.confirm's Cancel would
      // strand the user, so just show the message and run the primary action.
      if (!cancelBtn) {
        window.alert(text);
        fire(primary);
        return;
      }
      // Real confirm: OK runs the action, Cancel runs the cancel handler (if any).
      if (window.confirm(text)) fire(primary);
      else fire(cancelBtn);
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
