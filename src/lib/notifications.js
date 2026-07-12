import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parse } from '../utils/dates.js';

// Show a banner even if the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const REMINDER_KEY = '@fe/eventReminders'; // { [eventId]: notificationId }
const HOURS_BEFORE = 3;

async function getMap() {
  try {
    return JSON.parse(await AsyncStorage.getItem(REMINDER_KEY)) || {};
  } catch {
    return {};
  }
}
async function setMap(m) {
  try {
    await AsyncStorage.setItem(REMINDER_KEY, JSON.stringify(m));
  } catch {}
}

// Silent check — does NOT prompt. Use to refresh a token only if already allowed.
export async function hasPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function ensurePermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === 'granted';
  } catch {
    return false;
  }
}

// Schedule a local reminder a few hours before a saved event. Works in Expo Go.
export async function scheduleEventReminder(event) {
  try {
    if (!event?.start || !event?.id) return;
    // parse() handles date-only strings (garage sales like "2026-07-15") as local
    // midnight; a bare new Date() would read them as UTC and fire a day early in ET.
    const fireAt = parse(event.start).getTime() - HOURS_BEFORE * 3600 * 1000;
    if (fireAt < Date.now() + 60 * 1000) return; // too soon or already passed
    // Silent: schedule ONLY if already granted. The priming modal owns the ask, so
    // saving an event never fires a cold OS prompt here. Reminders for events saved
    // before granting get set when permission is granted (see AppContext).
    if (!(await hasPermission())) return;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: event.title,
        body: `Coming up soon${event.venue ? ` · ${event.venue}` : ''}`,
        data: { eventId: event.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(fireAt) },
    });
    const m = await getMap();
    m[event.id] = id;
    await setMap(m);
  } catch {}
}

export async function cancelEventReminder(eventId) {
  try {
    const m = await getMap();
    if (m[eventId]) {
      await Notifications.cancelScheduledNotificationAsync(m[eventId]);
      delete m[eventId];
      await setMap(m);
    }
  } catch {}
}

// Create the Android notification channel up front. On Android (API 26+) EVERY
// notification — local reminders AND remote push — needs a channel to actually
// appear; without it they're silently dropped. No-op on iOS. Call once at app
// startup, independent of the permission/token flow. Idempotent.
export async function setupAndroidChannel() {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {}
}

// Get a remote Expo push token (for the weekend digest). Returns null in Expo Go
// or the simulator — that's expected; remote push needs a real dev/standalone build.
export async function getPushToken(projectId) {
  try {
    if (!Device.isDevice) return null;
    if (!(await ensurePermission())) return null;
    await setupAndroidChannel();
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return resp?.data || null;
  } catch {
    return null;
  }
}
