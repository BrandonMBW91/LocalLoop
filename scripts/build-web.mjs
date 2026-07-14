// Builds the Local Loop web app for localloop.io.
//
// localloop.io serves the Expo web export AS the site, but it must ALSO keep
// serving the marketing/legal/deep-link files (privacy, delete-account, the
// universal-link JSON, the SEO /events pages). A raw `expo export -p web` drops
// all of those. This script produces the COMPLETE output so a Netlify rebuild
// (or a manual deploy) can never ship an app that breaks App Store legal links
// or native universal links.
//
//   npm run deploy:web                # build + `netlify deploy --prod --dir dist --no-build`
// IMPORTANT: deploy with --no-build. Plain `netlify deploy` re-runs the Netlify
// site's configured `expo export -p web` (a RAW export) and overwrites this merged
// dist, dropping the legal/deep-link/SEO files. --no-build ships dist as-is.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'dist';
const SITE = 'site';

// 1. Expo web export (the app itself).
execSync(`npx expo export --platform web --output-dir ${OUT}`, { stdio: 'inherit' });

// 2. Merge every site/ file EXCEPT the marketing homepage and its _redirects —
//    so the app's index.html stays the homepage and we write our own redirects.
for (const entry of fs.readdirSync(SITE)) {
  if (entry === 'index.html' || entry === '_redirects') continue;
  fs.cpSync(path.join(SITE, entry), path.join(OUT, entry), { recursive: true });
}

// 3. Redirects: universal-link rewrites (dot-dirs get dropped by Netlify, so serve
//    the JSON via a 200 rewrite), then a SPA fallback. Netlify serves real files
//    (privacy.html, events/*, aasa.json) BEFORE the catch-all, so only app routes
//    with no file (e.g. /event/123) fall through to the web app shell.
fs.writeFileSync(
  path.join(OUT, '_redirects'),
  [
    '/.well-known/apple-app-site-association  /aasa.json  200',
    '/.well-known/assetlinks.json             /assetlinks.json  200',
    '/*  /index.html  200',
    '',
  ].join('\n'),
);

console.log(`\nweb build ready in ${OUT}/ (app + preserved legal/deep-link/SEO files)`);
