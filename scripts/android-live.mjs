// Flip the app from "Android is in closed testing" to "Android is public".
//
//   node scripts/android-live.mjs          # check readiness, change nothing
//   node scripts/android-live.mjs --apply  # make the changes
//
// WHY A SCRIPT AND NOT A ONE-LINE EDIT: it is not one line. ANDROID_LIVE in
// src/lib/links.js is the obvious half, but site/open.html independently routes
// Android visitors to a mailto ("Join the Android test") because there was no public
// listing to send them to. Flip only the flag and every Android visitor who taps a
// shared /event/<id> link still gets asked to email you to join a test that no longer
// exists. Two files, one moment, easy to half-do — so it is scripted.
//
// It REFUSES to run while the Play listing is still 404. Flipping early is worse than
// flipping late: the banner would start offering Android users a store page that does
// not exist, which is the exact dead end ANDROID_LIVE was created to prevent.
//
// After --apply, IN THIS ORDER. The order is not cosmetic: build-changelog.mjs reads
// COMMITTED git history, and tests/guards.test.mjs fails unless changelog.js already
// lists the rev in src/version.js. So "npm test && build-changelog" — which this
// comment used to say — fails every time by construction. It did, on rev 121.
//   1. bump BUILD in src/version.js
//   2. git commit                                  (build-changelog reads history)
//   3. node scripts/build-changelog.mjs            (writes src/data/changelog.js)
//   4. npm test                                    (the rev guard passes only now)
//   5. git commit --amend  (or a second commit)    then push
//   6. eas update --branch production              -> the app + banner
//   7. npm run deploy:web                          -> open.html
// Both are needed: the banner ships in the JS bundle, open.html is a static page.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const PLAY_WEB = 'https://play.google.com/store/apps/details?id=com.michaelwilliams.localloop';

const LINKS = join(ROOT, 'src', 'lib', 'links.js');
const OPEN = join(ROOT, 'site', 'open.html');

// --- readiness gate ---------------------------------------------------------
let live = false;
try {
  const r = await fetch(PLAY_WEB, { redirect: 'follow' });
  live = r.status === 200;
  console.log(`Play listing: HTTP ${r.status} ${live ? '-> PUBLIC' : '-> not public yet'}`);
} catch (e) {
  console.log(`Play listing: check failed (${e.message})`);
}

const linksSrc = readFileSync(LINKS, 'utf8');
const openSrc = readFileSync(OPEN, 'utf8');
const flagNow = /export const ANDROID_LIVE = (true|false);/.exec(linksSrc)?.[1];
const openHasMailto = /id="android"[^>]*href="mailto:/.test(openSrc);

console.log(`ANDROID_LIVE: ${flagNow}`);
console.log(`open.html Android path: ${openHasMailto ? 'mailto (closed-testing)' : 'store link'}`);

if (flagNow === 'true' && !openHasMailto) { console.log('\nAlready flipped. Nothing to do.'); process.exit(0); }

if (!live) {
  console.log('\nNOT READY: the Play listing still 404s, so Android is not public.');
  console.log('Publishing needs 12 testers opted in for 14 continuous days (Play Console >');
  console.log('Testing > Closed testing). Re-run this once the listing resolves.');
  process.exit(APPLY ? 1 : 0);
}
if (!APPLY) { console.log('\nREADY. Re-run with --apply to make the changes.'); process.exit(0); }

// --- 1. the flag ------------------------------------------------------------
const linksOut = linksSrc.replace(
  /\/\/ Android is still in CLOSED TESTING[\s\S]*?export const ANDROID_LIVE = false;/,
  '// Android is PUBLIC on Play. The web download banner offers Play to Android\n' +
  '// visitors, and open.html sends them to the listing instead of the test-join mailto.\n' +
  'export const ANDROID_LIVE = true;',
).replace(/export const ANDROID_LIVE = false;/, 'export const ANDROID_LIVE = true;'); // fallback if the comment moved
writeFileSync(LINKS, linksOut);

// --- 2. open.html: mailto -> the real listing, and auto-redirect like iOS ----
let openOut = openSrc
  .replace(
    /<a class="btn red hidden" id="android" href="mailto:[^"]*">[^<]*<\/a>/,
    `<a class="btn red hidden" id="android" href="${PLAY_WEB}">Get it on Google Play</a>`,
  )
  .replace(
    /var APPSTORE = 'https:\/\/apps\.apple\.com\/app\/id6780306721';/,
    `var APPSTORE = 'https://apps.apple.com/app/id6780306721';\n  var PLAYSTORE = '${PLAY_WEB}';`,
  )
  .replace(
    /    \/\/ No public Play listing yet \(closed testing\)\.[\s\S]*?try \{ location\.href = appUrl; \} catch \(e\) \{\}/,
    `    // Mirror the iOS path: try the installed app via the scheme, then fall through
    // to the public Play listing if nothing caught it.
    document.getElementById('android').classList.remove('hidden');
    try { location.href = appUrl; } catch (e) {}
    setTimeout(function(){ location.href = PLAYSTORE; }, 1400);`,
  )
  // Leading \s* too: without it the removed div's own indentation is left behind and
  // the next line inherits it, so the back-link ends up double-indented.
  .replace(/\n\s*<div class="note" id="androidNote"[^>]*>[\s\S]*?<\/div>/, '');

writeFileSync(OPEN, openOut);

console.log('\napplied:');
console.log('  src/lib/links.js  ANDROID_LIVE -> true');
console.log('  site/open.html    mailto -> Play listing, + 1.4s fallback redirect like iOS');
console.log('\nnext: bump BUILD, npm test, commit, then BOTH:');
console.log('  npx eas-cli update --branch production   (the app + install banner)');
console.log('  npm run deploy:web                       (open.html)');
