import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { textScaleOptions } from '../theme/theme';
import {
  getPushToken,
  setupAndroidChannel,
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
  fetchActiveCities,
  fetchActiveCityCounts,
  deleteAccountRpc,
  toggleTruckFollow,
} from '../lib/db';
import { trackEvent } from '../lib/analytics';
import { maybePromptReview } from '../lib/review';
import { isOver } from '../utils/dates';
import { venueCore } from '../utils/place';

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
  excludeStats: '@fe/excludeStats',
  onboarded: '@fe/onboarded',
  interests: '@fe/interests',
  follows: '@fe/follows',
  savedSales: '@fe/savedSales',
};

// A stable, anonymous per-install id (no personal data) for active-user counts.
function makeDeviceId() {
  return 'd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function AppProvider({ children }) {
  const [cityId, setCityId] = useState('findlay');
  const [textScaleKey, setTextScaleKey] = useState('normal');
  const [savedIds, setSavedIds] = useState([]); // event ids the user bookmarked
  const [savedSaleIds, setSavedSaleIds] = useState([]); // garage-sale ids the user saved
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
  const [activeCityIds, setActiveCityIds] = useState(null); // town ids with events (null = unknown → show all)
  const [cityCounts, setCityCounts] = useState(null); // { cityId: upcomingCount } for the picker (null until loaded)
  const [excludeStats, setExcludeStats] = useState(false); // this device opted out of analytics (see ?internal)
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Auth (only meaningful when a backend is configured).
  const [session, setSession] = useState(null);
  const [pendingCount, setPendingCount] = useState(0); // submissions awaiting review (admin)

  // Ad clicks and shared links can name a town: localloop.io/?city=canton lands
  // straight in that town's events instead of the generic town-picker — the
  // difference between a paid click browsing and a paid click bouncing.
  // Validated against the real town list, so a junk value just falls through.
  const urlCity = useMemo(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
    const m = /[?&](?:city|town)=([a-z0-9-]+)/i.exec(window.location.search || '');
    if (!m) return null;
    const slug = m[1].toLowerCase();
    return CITIES.some((c) => c.id === slug) ? slug : null;
  }, []);

  // ---- Load persisted preferences once on startup ----
  useEffect(() => {
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet(Object.values(STORAGE_KEYS));
        const map = Object.fromEntries(entries);
        if (map[STORAGE_KEYS.city]) setCityId(map[STORAGE_KEYS.city]);
        // A ?city= in the URL beats the stored town and skips the picker: the
        // visitor asked for this town by clicking an ad/link for it.
        if (urlCity) {
          setCityId(urlCity);
          setOnboarded(true);
          AsyncStorage.setItem(STORAGE_KEYS.city, urlCity).catch(() => {});
          AsyncStorage.setItem(STORAGE_KEYS.onboarded, 'true').catch(() => {});
        }
        if (map[STORAGE_KEYS.textScale]) setTextScaleKey(map[STORAGE_KEYS.textScale]);
        if (map[STORAGE_KEYS.saved]) setSavedIds(JSON.parse(map[STORAGE_KEYS.saved]));
        if (map[STORAGE_KEYS.savedSales]) setSavedSaleIds(JSON.parse(map[STORAGE_KEYS.savedSales]));
        if (map[STORAGE_KEYS.submitted]) setSubmittedEvents(JSON.parse(map[STORAGE_KEYS.submitted]));
        if (map[STORAGE_KEYS.submittedSales]) setSubmittedSales(JSON.parse(map[STORAGE_KEYS.submittedSales]));
        if (map[STORAGE_KEYS.submittedTrucks]) setSubmittedTrucks(JSON.parse(map[STORAGE_KEYS.submittedTrucks]));
        if (map[STORAGE_KEYS.rulesAccepted] === 'true') setRulesAccepted(true);
        if (map[STORAGE_KEYS.onboarded] === 'true') setOnboarded(true);
        if (map[STORAGE_KEYS.interests]) setInterestsState(JSON.parse(map[STORAGE_KEYS.interests]));
        if (map[STORAGE_KEYS.follows]) setFollows(JSON.parse(map[STORAGE_KEYS.follows]));
        // Load the analytics opt-out HERE (part of hydration) so it is known
        // before the first activity record. Read separately it raced the record
        // effect, so an already-opted-out browser still logged one visit per load
        // (and kept its row's last_seen fresh, never aging out of the 30d window).
        if (map[STORAGE_KEYS.excludeStats]) setExcludeStats(true);
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

  // ---- Which towns currently have upcoming events (drives the picker so empty
  // "ghost" towns are hidden; a town reappears once the daily aggregator finds it
  // an event). null until loaded → the picker shows every town as a safe fallback.
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    fetchActiveCities().then((ids) => {
      if (ids) setActiveCityIds(new Set(ids));
    });
    // Per-town counts (density-aware picker). Purely additive: on failure the
    // picker still renders its list from activeCityIds above.
    fetchActiveCityCounts().then((m) => setCityCounts(m || {}));
  }, []);

  // Analytics opt-out for this device: ?internal sets it for good; the stored flag
  // is read during hydration above so it's ready before the first record. Works on
  // web and native, no sign-in. Setting it also flips state now so this very
  // pageview stops counting (urlInternal already blocks it synchronously too).
  useEffect(() => {
    if (urlInternal) {
      AsyncStorage.setItem(STORAGE_KEYS.excludeStats, '1').catch(() => {});
      setExcludeStats(true);
    }
  }, []);

  // ---- Load events + garage sales for the current city ----
  const loadSeqRef = useRef(0);
  // Guard so we log a single app_open per launch (not on every city switch).
  const openLoggedRef = useRef(false);
  const lastLoadedCityRef = useRef(null);
  const loadData = useCallback(async () => {
    if (!hydrated) return;
    const seq = ++loadSeqRef.current; // ignore results from superseded loads
    // On a TOWN CHANGE (not a same-town refresh), clear the lists so the skeleton
    // shows during the swap instead of the previous town's cards under the new name.
    if (lastLoadedCityRef.current && lastLoadedCityRef.current !== cityId) {
      setEvents([]); setGarageSales([]); setFoodTrucks([]); setSponsors([]); setDeals([]); setEditorPick(null);
    }
    lastLoadedCityRef.current = cityId;
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

  // Refresh on foreground: phones keep the app alive for days, and nothing else
  // re-ran the fetch — a list loaded at 9 AM still showed long-ended events at
  // 10 PM (and yesterday's events after midnight). On every return to the
  // foreground, instantly drop anything now over from the in-memory list; after
  // 15+ minutes away, also refetch from the server (and refresh the picker's
  // active-town counts, frozen since launch for the same reason).
  const lastActiveRef = useRef(Date.now());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { lastActiveRef.current = Date.now(); return; }
      const awayMs = Date.now() - lastActiveRef.current;
      setEvents((prev) => prev.filter((e) => !isOver(e.start, e.end)));
      if (awayMs > 15 * 60 * 1000) {
        loadData();
        if (isSupabaseEnabled) {
          fetchActiveCities().then((ids) => { if (ids) setActiveCityIds(new Set(ids)); });
          fetchActiveCityCounts().then((m) => setCityCounts(m || {}));
        }
      }
    });
    return () => sub.remove();
  }, [loadData]);

  // After the app has settled (and the user has opened it a few times), ask once
  // for an App Store rating. Self-throttling and OTA-safe (see lib/review).
  useEffect(() => {
    if (!hydrated) return undefined;
    const t = setTimeout(() => maybePromptReview(), 4000);
    return () => clearTimeout(t);
  }, [hydrated]);

  // True when the signed-in user is the admin/owner. Their activity is kept out
  // of analytics so the owner's own opens and taps never inflate the metrics.
  const isAdmin = Boolean(
    session?.user?.email && session.user.email.toLowerCase() === ADMIN_EMAIL
  );

  // Web is now PRODUCTION (localloop.io serves this app), so real web visitors
  // MUST count toward metrics + advertiser reach. Only genuine dev/preview is
  // excluded — Expo's __DEV__ builds and localhost — so `expo start --web` and
  // local test builds never pollute the numbers.
  const isDevWeb =
    Platform.OS === 'web' &&
    (__DEV__ || (typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)));
  // Visiting any URL with ?internal (e.g. localloop.io/?internal) opts THIS browser
  // or device out of analytics permanently — how Michael excludes his own desktop
  // without signing in. Synchronous so even the first pageview isn't counted.
  const urlInternal = Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]internal\b/.test(window.location.search);
  // One switch every tracker checks: admin, dev/preview web, or an opted-out device.
  // Automated clients must never count as people. robots.txt now keeps crawlers
  // out of the app routes, but anything that ignores it still boots the app, and
  // because a bot persists no localStorage it mints a NEW anonymous device on
  // EVERY page — 125 fake 'active users' + 144 fake event views appeared in the
  // ad-pricing metric within a day (all sharing one seeded Math.random suffix,
  // all parked on the default town). navigator.webdriver catches headless
  // automation; the UA list catches the honest self-identifying crawlers.
  const isBot = Platform.OS === 'web' && typeof navigator !== 'undefined' && (
    navigator.webdriver === true
    || /bot|crawler|spider|crawling|headless|phantom|puppeteer|playwright|slurp|bingpreview|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|scrap|fetch|curl|wget|python-requests|axios|http-client|facebookexternalhit|whatsapp|telegram|discord|embedly|quora|pinterest|semrush|ahrefs|mj12|dotbot|petal|yandex|baidu|duckduck|applebot|amazonbot|gptbot|ccbot|claudebot|perplexity|bytespider/i.test(navigator.userAgent || '')
  );
  const noTrack = isAdmin || isDevWeb || excludeStats || urlInternal || isBot;

  // Fire-and-forget product analytics, auto-tagged with the anon device + city.
  // No-op for the admin/owner and any opted-out device, so internal use never counts.
  const logEvent = useCallback(
    (event, props = {}) => {
      if (noTrack) return;
      trackEvent({ event, props, deviceId, cityId });
    },
    [deviceId, cityId, noTrack]
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
        // Saving an event sets a local reminder a few hours before it starts (only
        // if notifications are already granted), and at this high-intent moment
        // either registers the device silently or shows the priming modal.
        const ev = eventObj || findEventById(eventId);
        if (ev) {
          scheduleEventReminder(ev); // silent: schedules only if already granted
          maybePrimePush('save');    // registers if granted, else primes (bounded)
        }
        logEvent('save_event', { id: eventId });
      }
      return next;
    });
  };

  // Register this device for the weekend digest. If notifications are already
  // allowed, refresh the token/city/interests silently. If not, ask ONCE after
  // onboarding so EVERY device is reachable (not just those who saved an event) —
  // the big lever on push reach. We never re-prompt (a stored flag guards it), and
  // the digest is opt-out-able by ignoring it.
  useEffect(() => {
    // Wait for hydration (interests is the empty default before it). Once onboarded,
    // maybePrimePush refreshes the token silently if already granted, or shows the
    // value-priming modal instead of the old cold OS prompt (which, once declined,
    // was never re-asked — the root of the ~9% push reach).
    if (!hydrated || !onboarded || loadingData) return; // show content first, not a permission ask on empty cards
    maybePrimePush('onboarding');
  }, [hydrated, cityId, onboarded, interests, loadingData]);

  // Record this device as active in the current town (anonymous) — powers
  // user-based ad pricing.
  useEffect(() => {
    setupAndroidChannel(); // Android needs a channel to display any notification (no-op on iOS)
    // Skip the admin/owner and dev/preview web; real localloop.io web visitors DO
    // count (they record with platform 'web', a distinct bucket from iOS/Android).
    // Gate on `hydrated`: the opt-out flag and deviceId both come from storage, so
    // recording before hydration could log an opted-out browser (this device's own
    // owner) before the flag is read. After hydration, noTrack is trustworthy.
    if (hydrated && isSupabaseEnabled && !noTrack && deviceId && cityId) {
      recordDeviceActivity(deviceId, cityId, Platform.OS);
      // Log one app_open per launch so daily opens are tracked historically in
      // app_events (device_activity is upsert-only and keeps no per-day history).
      if (!openLoggedRef.current) {
        openLoggedRef.current = true;
        trackEvent({ event: 'app_open', deviceId, cityId });
      }
    }
  }, [hydrated, deviceId, cityId, noTrack]);

  // Submit handlers: write to the backend when configured, otherwise keep a
  // local pending copy so the prototype works with no backend. Both throw on
  // failure so the form can show an error.
  const addSubmittedEvent = async (event) => {
    const { _photos = [], ...rest } = event;
    if (isSupabaseEnabled) {
      // Reuse the garage-sale uploader + public 'sale-photos' bucket; an event
      // keeps a single hero image, so take the first uploaded URL.
      const images = _photos.length ? await uploadSalePhotos(_photos) : [];
      await insertEvent({ ...rest, imageUrl: images[0] || rest.imageUrl || null });
      await loadData();
    } else {
      const local = { ...rest, imageUrl: _photos[0]?.uri || rest.imageUrl || null };
      setSubmittedEvents((prev) => {
        const next = [local, ...prev];
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
    const { _photos = [], ...rest } = truck;
    if (isSupabaseEnabled) {
      const images = _photos.length ? await uploadSalePhotos(_photos) : [];
      await insertFoodTruck({ ...rest, imageUrl: images[0] || rest.imageUrl || null });
      await loadData();
    } else {
      const local = { ...rest, imageUrl: _photos[0]?.uri || rest.imageUrl || null };
      setSubmittedTrucks((prev) => {
        const next = [local, ...prev];
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

  // Follow / unfollow a truck or venue by name. The local list powers the
  // "Following" filter; the server sync (best-effort) records the follow with a
  // push token so a followed TRUCK can ping its followers when it posts a new
  // stop. Passing the town + token is what turns this from a local bookmark into
  // the notify flywheel.
  // Follows match on venueCore (the leading place name), not the exact string —
  // feeds reformat venue strings between runs and cleanups rewrite them, which
  // used to orphan existing follows and fragment a venue across its room names.
  const isFollowing = useCallback(
    (venue) => { const c = venueCore(venue); return !!c && follows.some((f) => venueCore(f) === c); },
    [follows]
  );
  const toggleFollow = (venue) => {
    if (!venue) return;
    setFollows((prev) => {
      const c = venueCore(venue);
      const has = prev.some((f) => venueCore(f) === c);
      // Unfollow removes every stored variant of the place (legacy blobs included).
      const next = has ? prev.filter((v) => venueCore(v) !== c) : [...prev, venue];
      AsyncStorage.setItem(STORAGE_KEYS.follows, JSON.stringify(next)).catch(() => {});
      logEvent(has ? 'unfollow_venue' : 'follow_venue', { venue: venue.slice(0, 40) });
      return next;
    });
    // Server sync (fire-and-forget). On a NEW follow, attach the push token so
    // notifications can reach this device; toggling is idempotent server-side.
    if (isSupabaseEnabled && deviceId && Platform.OS !== 'web' && !isAdmin) {
      const wasFollowing = follows.some((f) => venueCore(f) === venueCore(venue));
      (async () => {
        let token = null;
        if (!wasFollowing && (await hasPermission())) token = await getPushToken();
        toggleTruckFollow(deviceId, venue, cityId, token);
      })();
    }
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

  // ---- push-permission priming (the keystone) --------------------------------
  // Show a value-priming modal BEFORE the OS prompt so a not-ready user taps
  // "Not now" here (which never burns the one-shot OS prompt) instead of hard-
  // declining the cold dialog. Only "Turn on" fires the real OS prompt.
  const [pushPrime, setPushPrime] = useState(null); // null | 'onboarding' | 'save' | 'general'
  const primePendingRef = useRef(false);
  const PRIME_KEY = '@fe/pushPrimeState'; // { shows, lastTs, granted, osDenied }

  // If already granted, refresh the token silently; else show the priming modal,
  // bounded: max 3 shows, 2-day cooldown, never after an OS grant/deny (the OS
  // won't re-prompt anyway once decided).
  const maybePrimePush = useCallback(async (reason) => {
    if (!isSupabaseEnabled || isAdmin || Platform.OS === 'web' || !cityId) return;
    if (await hasPermission()) {
      const t = await getPushToken();
      if (t) savePushToken(t, cityId, Platform.OS, interests);
      return;
    }
    if (primePendingRef.current) return;
    let st = {};
    try { st = JSON.parse(await AsyncStorage.getItem(PRIME_KEY)) || {}; } catch { st = {}; }
    if (st.granted || st.osDenied) return;
    if ((st.shows || 0) >= 3) return;
    if (st.lastTs && Date.now() - st.lastTs < 2 * 86400000) return;
    st.shows = (st.shows || 0) + 1;
    st.lastTs = Date.now();
    try { await AsyncStorage.setItem(PRIME_KEY, JSON.stringify(st)); } catch {}
    primePendingRef.current = true;
    setPushPrime(reason || 'general');
  }, [cityId, interests, isAdmin]);

  // User tapped "Turn on" — NOW fire the OS prompt, then register or record the
  // decline. On grant, back-fill reminders for events saved before permission.
  const acceptPushPrime = useCallback(async () => {
    setPushPrime(null);
    primePendingRef.current = false;
    let st = {};
    try { st = JSON.parse(await AsyncStorage.getItem(PRIME_KEY)) || {}; } catch { st = {}; }
    const t = await getPushToken(); // ensurePermission() fires the OS prompt inside
    if (t) {
      st.granted = true;
      savePushToken(t, cityId, Platform.OS, interests);
      savedIds.forEach((id) => { const ev = findEventById(id); if (ev) scheduleEventReminder(ev); });
    } else {
      st.osDenied = true; // OS-level decline: the OS won't prompt again
    }
    try { await AsyncStorage.setItem(PRIME_KEY, JSON.stringify(st)); } catch {}
  }, [cityId, interests, savedIds, findEventById]);

  const dismissPushPrime = useCallback(() => {
    setPushPrime(null);
    primePendingRef.current = false;
  }, []);

  // Save a garage sale (own list, separate from event saves) + set a local reminder
  // before it starts. Saving is high intent, so it also primes push.
  const isSaleSaved = useCallback((saleId) => savedSaleIds.includes(saleId), [savedSaleIds]);
  const toggleSavedSale = (saleId, saleObj) => {
    if (!saleId) return;
    setSavedSaleIds((prev) => {
      const has = prev.includes(saleId);
      const next = has ? prev.filter((s) => s !== saleId) : [...prev, saleId];
      AsyncStorage.setItem(STORAGE_KEYS.savedSales, JSON.stringify(next)).catch(() => {});
      if (has) {
        cancelEventReminder(saleId);
      } else {
        if (saleObj) scheduleEventReminder({ id: saleObj.id, start: saleObj.start, title: saleObj.title, venue: saleObj.address });
        maybePrimePush('save');
        logEvent('save_sale', { id: saleId });
      }
      return next;
    });
  };
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
  // isAdmin is computed earlier (it also gates analytics).

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
    savedSaleIds,
    toggleSavedSale,
    isSaleSaved,
    pushPrime,
    acceptPushPrime,
    dismissPushPrime,
    logEvent,

    // Data
    events,
    garageSales,
    foodTrucks,
    sponsors,
    deals,
    editorPick,
    activeCityIds,
    cityCounts,
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
    noTrack, // admin, dev/preview web, or an opted-out device — callers skip analytics
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
