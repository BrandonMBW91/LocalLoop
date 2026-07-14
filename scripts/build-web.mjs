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

// 4. Homepage SEO. The Expo shell ships only a bare <title> and no description,
// so localloop.io/ is near-invisible to search. Inject real metadata + a WebSite
// schema and a crawlable <noscript> fallback — none of which change the running
// app (JS renders over it).
const idxPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(idxPath, 'utf8');
const HEAD_SEO = `<title>Local Loop — Local events, garage sales and food trucks across Ohio</title>
    <meta name="description" content="Find events, garage sales, and food trucks near you across 130+ Ohio towns. Free, local, and updated daily on Local Loop." />
    <link rel="canonical" href="https://localloop.io/" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://localloop.io/" />
    <meta property="og:title" content="Local Loop — Ohio's local events, all in one place" />
    <meta property="og:description" content="Events, garage sales, and food trucks near you across 130+ Ohio towns. Free." />
    <meta property="og:image" content="https://localloop.io/favicon.ico" />
    <meta name="twitter:card" content="summary" />
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Local Loop","url":"https://localloop.io/","description":"Local events, garage sales, and food trucks across 130+ Ohio towns."}</script>`;
html = html.replace(/<title>[^<]*<\/title>/, HEAD_SEO);
const BODY_SEO = `<noscript><h1>Local Loop</h1><p>Local events, garage sales, and food trucks near you across 130+ Ohio towns. Free and updated daily.</p><p>Browse events by town: <a href="/events/columbus.html">Columbus</a>, <a href="/events/cleveland.html">Cleveland</a>, <a href="/events/cincinnati.html">Cincinnati</a>, <a href="/events/akron.html">Akron</a>, <a href="/events/toledo.html">Toledo</a>, <a href="/events/findlay.html">Findlay</a>.</p></noscript>`;
html = html.replace(/<div id="root">/, `${BODY_SEO}\n<div id="root">`);
fs.writeFileSync(idxPath, html);

console.log(`\nweb build ready in ${OUT}/ (app + preserved legal/deep-link/SEO files + homepage SEO)`);
