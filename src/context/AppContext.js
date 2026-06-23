import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { textScaleOptions } from '../theme/theme';
import {
  getPushToken,
  hasPermission,
  scheduleEventReminder,
  cancelEventReminder,
} from '../lib/notifications';
import { CITIES } from '../data/cities';
import { isSupabaseEnabled, supabase } from '../lib/supabase';
import {
  fetchEvents,
  fetchGarageSales,
  fetchFoodTrucks,
  insertEvent,
  insertGarageSale,
  insertFoodTruck,
  insertReport,
  fetchPendingCount,
  uploadSalePhotos,
  fetchSponsors,
  fetchDeals,
  fetchEditorPick,
  savePushToken,
  recordDeviceActivity,
  deleteAccountRpc,
} from '../lib/db';
import { trackEvent } from '../lib/analytics';
import { isOver } from '../utils/dates';

// The email that gets moderator powers (matches is_admin() in the database).
const ADMIN_EMAIL = (process.env.EXPO_PUBLIC_ADMIN_EMAIL || 'michabw91@gmail.com').toLowerCase();
import { getEventsForCity, getEventById } from '../data/events';
import { getGarageSalesForCity, getGarageSaleById } from '../data/garageSales';
import { getFoodTrucksForCity, getFoodTruckById } from '../data/foodTrucks';

const AppContext = createContext(null);

const STORAGE_KEYS = {
  city: '@fe/city',
  textScale: '@fe/textScale',
  saved: '@fe/savedEvents',
  submitted: '@fe/submittedEvents',
  submittedSales: '@fe/submittedGarageSales',
  submittedTrucks: '@fe/submittedFoodTrucks',
  rulesAccepted: '@fe/rulesAccepted',
  deviceId: '@fe/deviceId',
  onboarded: '@fe/onboarded',
  interests: '@fe/interests',
  follows: '@fe/follows',
};

// A stable, anonymous per-install id (no personal data) for active-user counts.
function makeDeviceId() {
  return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function AppProvider({ children }) {
  const [cityId, setCityId] = useState('findlay');
  const [textScaleKey, setTextScaleKey] = useState('normal');
  const [savedIds, setSavedIds] = useState([]); // event ids the user bookmarked
  const [submittedEvents, setSubmittedEvents] = useState([]); // local fallback (no backend)
  const [submittedSales, setSubmittedSales] = useState([]); // local fallback (no backend)
  const [submittedTrucks, setSubmittedTrucks] = useState([]); // local fallback (no backend)
  const [rulesAccepted, setRulesAccepted] = useState(false); // accepted community rules
  const [deviceId, setDeviceId] = useState(null); // anonymous per-install id
  const [onboarded, setOnboarded] = useState(false); // finished first-launch welcome
  const [interests, setInterestsState] = useState([]); // categories the user cares about
  const [follows, setFollows] = useState([]); // venue names the user follows
  const [hydrated, setHydrated] = useState(false);

  // Live data shown in the app (from the backend, or sample data as fallback).
  const [events, setEvents] = useState([]);
  const [garageSales, setGarageSales] = useState([]);
  const [foodTrucks, setFoodTrucks] = useState([]);
  const [sponsors, setSponsors] = useState([]); // live ads for the current city
  const [deals, setDeals] = useState([]); // live local deals for the current city
  const [editorPick, setEditorPick] = useState(null); // admin "This Week's Pick"
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Auth (only meaningful when a backend is configured).
  const [session, setSession] = useState(null);
  const [pendingCount, setPendingCount] = useState(0); // submissions awaiting review (admin)

  // ---- Load persisted preferences once on startup ----
  useEffect(() => {
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet(Object.values(STORAGE_KEYS));
        const map = Object.fromEntries(entries);
        if (map[STORAGE_KEYS.city]) setCityId(map[STORAGE_KEYS.city]);
        if (map[STORAGE_KEYS.textScale]) setTextScaleKey(map[STORAGE_KEYS.textScale]);
        if (map[STORAGE_KEYS.saved]) setSavedIds(JSON.parse(map[STORAGE_KEYS.saved]));
        if (map[STORAGE_KEYS.submitted]) setSubmittedEvents(JSON.parse(map[STORAGE_KEYS.submitted]));
        if (map[STORAGE_KEYS.submittedSales]) setSubmittedSales(JSON.parse(map[STORAGE_KEYS.submittedSales]));
        if (map[STORAGE_KEYS.submittedTrucks]) setSubmittedTrucks(JSON.parse(map[STORAGE_KEYS.submittedTrucks]));
        if (map[STORAGE_KEYS.rulesAccepted] === 'true') setRulesAccepted(true);
        if (map[STORAGE_KEYS.onboarded] === 'true') setOnboarded(true);
        if (map[STORAGE_KEYS.interests]) setInterestsState(JSON.parse(map[STORAGE_KEYS.interests]));
        if (map[STORAGE_KEYS.follows]) setFollows(JSON.parse(map[STORAGE_KEYS.follows]));
        let did = map[STORAGE_KEYS.deviceId];
        if (!did) {
          did = makeDeviceId();
          AsyncStorage.setItem(STORAGE_KEYS.deviceId, did).catch(() => {});
        }
        setDeviceId(did);
      } catch (e) {
        // Non-fatal: fall back to defaults.
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // ---- Track auth session ----
  useEffect(() => {
    if (!isSupabaseEnabled) return undefined;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // ---- Load events + garage sales for the current city ----
  const loadSeqRef = useRef(0);
  const loadData = useCallback(async () => {
    if (!hydrated) return;
    const seq = ++loadSeqRef.current; // ignore results from superseded loads
    setLoadingData(true);
    setLoadError(false);
    try {
      if (isSupabaseEnabled) {
        const [ev, gs, ft, sp, dl, pick] = await Promise.all([
          fetchEvents(cityId),
          fetchGarageSales(cityId),
          fetchFoodTrucks(cityId),
          fetchSponsors(cityId).catch(() => []), // ads are optional; never block the app
          fetchDeals(cityId).catch(() => []), // deals are optional too
          fetchEditorPick(cityId).catch(() => null), // editor's pick is optional
        ]);
        if (seq !== loadSeqRef.current) return; // a newer load started; drop these
        setEvents(ev.filter((e) => !isOver(e.start, e.end))); // hide events that are over
        setGarageSales(gs);
        setFoodTrucks(ft);
        setSponsors(sp);
        setDeals(dl);
        setEditorPick(pick);
      } else {
        setEvents(getEventsForCity(cityId, submittedEvents).filter((e) => !isOver(e.start, e.end)));
        setGarageSales(getGarageSalesForCity(cityId, submittedSales));
        setFoodTrucks(getFoodTrucksForCity(cityId, submittedTrucks));
        setEditorPick(null);
      }
    } catch (e) {
      if (seq !== loadSeqRef.current) return;
      // Never show an empty app — fall back to the bundled sample data.
      setLoadError(true);
      setEvents(getEventsForCity(cityId, submittedEvents).filter((e) => !isOver(e.start, e.end)));
      setGarageSales(getGarageSalesForCity(cityId, submittedSales));
      setFoodTrucks(getFoodTrucksForCity(cityId, submittedTrucks));
      setEditorPick(null);
    } finally {
      if (seq === loadSeqRef.current) setLoadingData(false);
    }
  }, [hydrated, cityId, submittedEvents, submittedSales, submittedTrucks]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fire-and-forget product analytics, auto-tagged with the anon device + city.
  const logEvent = useCallback(
    (event, props = {}) => trackEvent({ event, props, deviceId, cityId }),
    [deviceId, cityId]
  );

  const setCity = (id) => {
    setCityId(id);
    AsyncStorage.setItem(STORAGE_KEYS.city, id).catch(() => {});
    logEvent('change_city', { to: id });
  };

  const setTextScale = (key) => {
    setTextScaleKey(key);
    AsyncStorage.setItem(STORAGE_KEYS.textScale, key).catch(() => {});
  };

  // Pass the event object when you have it (e.g. from a card or detail screen)
  // so the reminder can be scheduled even for an event saved from another city
  // that isn't in the currently-loaded list.
  const toggleSaved = (eventId, eventObj) => {
    setSavedIds((prev) => {
      const wasSaved = prev.includes(eventId);
      const next = wasSaved ? prev.filter((id) => id !== eventId) : [...prev, eventId];
      AsyncStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(next)).catch(() => {});
      if (wasSaved) {
        cancelEventReminder(eventId);
      } else {
        // Saving an event sets a local reminder a few hours before it starts,
        // and (if they allow notifications) registers this device for the
        // weekend digest.
        const ev = eventObj || findEventById(eventId);
        if (ev) {
          scheduleEventReminder(ev);
          if (isSupabaseEnabled) getPushToken().then((t) => t && savePushToken(t, cityId, Platform.OS));
        }
        logEvent('save_event', { id: eventId });
      }
      return next;
    });
  };

  // Silently refresh this device's push token + city if notifications are already
  // allowed (never prompts on its own — saving an event is what asks).
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    (async () => {
      if (await hasPermission()) {
        const t = await getPushToken();
        if (t) savePushToken(t, cityId, Platform.OS);
      }
    })();
  }, [cityId]);

  // Record this device as active in the current town (anonymous) — powers
  // user-based ad pricing.
  useEffect(() => {
    if (isSupabaseEnabled && deviceId && cityId) recordDeviceActivity(deviceId, cityId);
  }, [deviceId, cityId]);

  // Submit handlers: write to the backend when configured, otherwise keep a
  // local pending copy so the prototype works with no backend. Both throw on
  // failure so the form can show an error.
  const addSubmittedEvent = async (event) => {
    if (isSupabaseEnabled) {
      await insertEvent(event);
      await loadData();
    } else {
      setSubmittedEvents((prev) => {
        const next = [event, ...prev];
        AsyncStorage.setItem(STORAGE_KEYS.submitted, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  const addSubmittedGarageSale = async (sale) => {
    const { _photos = [], ...rest } = sale;
    if (isSupabaseEnabled) {
      const images = _photos.length ? await uploadSalePhotos(_photos) : [];
      await insertGarageSale({ ...rest, images });
      await loadData();
    } else {
      // No backend: keep the local preview URIs so the photos still show.
      const local = { ...rest, images: _photos.map((p) => p.uri) };
      setSubmittedSales((prev) => {
        const next = [local, ...prev];
        AsyncStorage.setItem(STORAGE_KEYS.submittedSales, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  const addSubmittedFoodTruck = async (truck) => {
    if (isSupabaseEnabled) {
      await insertFoodTruck(truck);
      await loadData();
    } else {
      setSubmittedTrucks((prev) => {
        const next = [truck, ...prev];
        AsyncStorage.setItem(STORAGE_KEYS.submittedTrucks, JSON.stringify(next)).catch(() => {});
        return next;
      });
    }
  };

  // Report a listing for review. No-op persistence without a backend, but the
  // UI still thanks the user either way.
  const reportListing = async (kind, listingId, reason = '') => {
    if (isSupabaseEnabled) {
      await insertReport(kind, listingId, reason);
    }
  };

  const acceptRules = () => {
    setRulesAccepted(true);
    AsyncStorage.setItem(STORAGE_KEYS.rulesAccepted, 'true').catch(() => {});
  };

  const completeOnboarding = () => {
    setOnboarded(true);
    AsyncStorage.setItem(STORAGE_KEYS.onboarded, 'true').catch(() => {});
  };

  // The categories the user chose during onboarding (or in Settings) — drives
  // the "For You" filter on the events list.
  const setInterests = (cats) => {
    const next = Array.isArray(cats) ? cats : [];
    setInterestsState(next);
    AsyncStorage.setItem(STORAGE_KEYS.interests, JSON.stringify(next)).catch(() => {});
  };

  // Follow / unfollow a venue by name. Followed venues power the "Following"
  // filter so regulars can jump straight to their favorite spots.
  const isFollowing = useCallback((venue) => follows.includes(venue), [follows]);
  const toggleFollow = (venue) => {
    if (!venue) return;
    setFollows((prev) => {
      const has = prev.includes(venue);
      const next = has ? prev.filter((v) => v !== venue) : [...prev, venue];
      AsyncStorage.setItem(STORAGE_KEYS.follows, JSON.stringify(next)).catch(() => {});
      logEvent(has ? 'unfollow_venue' : 'follow_venue', { venue: venue.slice(0, 40) });
      return next;
    });
  };

  // Replay the first-launch welcome (e.g. from Settings). Clears the flag so the
  // (tabs) gate redirects to /welcome until the user picks a town again.
  const resetOnboarding = () => {
    setOnboarded(false);
    AsyncStorage.removeItem(STORAGE_KEYS.onboarded).catch(() => {});
  };

  // Lookups for the detail screens: prefer the loaded list, fall back to seed.
  const findEventById = useCallback(
    (id) => events.find((e) => e.id === id) || getEventById(id, submittedEvents),
    [events, submittedEvents]
  );
  const findGarageSaleById = useCallback(
    (id) => garageSales.find((s) => s.id === id) || getGarageSaleById(id, submittedSales),
    [garageSales, submittedSales]
  );
  const findFoodTruckById = useCallback(
    (id) => foodTrucks.find((t) => t.id === id) || getFoodTruckById(id, submittedTrucks),
    [foodTrucks, submittedTrucks]
  );

  // ---- Auth actions (email one-time code) ----
  // Email avoids needing a paid SMS provider. Supabase sends a 6-digit code
  // (make sure the "Magic Link" email template includes {{ .Token }}).
  //
  // App Review demo login: a passwordless OTP flow can't be exercised by Apple's
  // reviewers (they can't receive our email), so a single hard-coded demo account
  // takes a fixed code and signs in via password instead — no email required.
  // It's a normal, unprivileged user (posts still go through moderation). The
  // credentials are in App Store Connect → App Review Information.
  const REVIEW_EMAIL = 'appreview@localloop.app';
  const REVIEW_CODE = '424242';
  const REVIEW_PASSWORD = 'LL-Review-7Kx92-demo';

  const requestOtp = (email) => {
    // Demo account: skip the real email send so the UI can advance to the code
    // step (the reviewer enters the fixed code from the review notes).
    if (email.trim().toLowerCase() === REVIEW_EMAIL) return Promise.resolve({ data: {}, error: null });
    return supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  };
  const verifyOtp = (email, token) => {
    if (email.trim().toLowerCase() === REVIEW_EMAIL && token.trim() === REVIEW_CODE) {
      return supabase.auth.signInWithPassword({ email: REVIEW_EMAIL, password: REVIEW_PASSWORD });
    }
    return supabase.auth.verifyOtp({ email, token, type: 'email' });
  };
  const signOut = () => supabase.auth.signOut();
  // Permanently delete the account + submitted content, then clear the local
  // session (App Store Guideline 5.1.1(v)).
  const deleteAccount = async () => {
    await deleteAccountRpc();
    await supabase.auth.signOut();
  };

  // ---- Admin / moderation ----
  const isAdmin = Boolean(
    session?.user?.email && session.user.email.toLowerCase() === ADMIN_EMAIL
  );

  const refreshPendingCount = useCallback(async () => {
    if (!isSupabaseEnabled || !isAdmin) {
      setPendingCount(0);
      return;
    }
    try {
      setPendingCount(await fetchPendingCount());
    } catch (e) {
      // non-fatal
    }
  }, [isAdmin]);

  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  const scale = useMemo(() => {
    const opt = textScaleOptions.find((o) => o.key === textScaleKey);
    return opt ? opt.scale : 1.0;
  }, [textScaleKey]);

  const city = useMemo(() => CITIES.find((c) => c.id === cityId) || CITIES[0], [cityId]);

  const value = {
    hydrated,
    city,
    cityId,
    setCity,
    textScaleKey,
    setTextScale,
    scale,
    savedIds,
    toggleSaved,
    logEvent,

    // Data
    events,
    garageSales,
    foodTrucks,
    sponsors,
    deals,
    editorPick,
    loadingData,
    loadError,
    refresh: loadData,
    findEventById,
    findGarageSaleById,
    findFoodTruckById,
    submittedEvents,
    addSubmittedEvent,
    addSubmittedGarageSale,
    addSubmittedFoodTruck,
    reportListing,
    rulesAccepted,
    acceptRules,
    onboarded,
    completeOnboarding,
    resetOnboarding,
    interests,
    setInterests,
    follows,
    isFollowing,
    toggleFollow,

    // Auth / backend
    backendEnabled: isSupabaseEnabled,
    signedIn: Boolean(session),
    session,
    requestOtp,
    verifyOtp,
    signOut,
    deleteAccount,

    // Admin / moderation
    isAdmin,
    pendingCount,
    refreshPendingCount,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
