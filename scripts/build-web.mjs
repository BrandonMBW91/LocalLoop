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
// IMPORTANT: `eas update` ALSO writes a raw expo export into dist/ (its default
// export dir), silently clobbering this merged build — deploying dist after an
// OTA without re-running this script shipped a site with no legal pages, no
// universal-link JSON, and an empty sitemap (2026-07-14). ALWAYS `npm run
// deploy:web` (which rebuilds first); never `netlify deploy --dir dist` alone.
// IMPORTANT: deploy with --no-build. Plain `netlify deploy` re-runs the Netlify
// site's configured `expo export -p web` (a RAW export) and overwrites this merged
// dist, dropping the legal/deep-link/SEO files. --no-build ships dist as-is.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildSeo, loadEnv } from './build-seo.mjs';

const OUT = 'dist';
const SITE = 'site';

// Find a built asset by pattern (filenames are content-hashed at export time).
// Returns a path relative to OUT, or '' if absent.
function findFile(dir, re) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(full, re);
      if (hit) return hit;
    } else if (re.test(entry.name)) {
      return path.relative(OUT, full);
    }
  }
  return '';
}

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
    <meta property="og:image" content="https://localloop.io/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="Local Loop — everything happening in your town" />
    <meta property="og:site_name" content="Local Loop" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="https://localloop.io/og-image.png" />
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Local Loop","url":"https://localloop.io/","description":"Local events, garage sales, and food trucks across 130+ Ohio towns."}</script>`;
html = html.replace(/<title>[^<]*<\/title>/, HEAD_SEO);
const BODY_SEO = `<noscript><h1>Local Loop</h1><p>Local events, garage sales, and food trucks near you across 130+ Ohio towns. Free and updated daily.</p><p>Browse events by town: <a href="/events/columbus.html">Columbus</a>, <a href="/events/cleveland.html">Cleveland</a>, <a href="/events/cincinnati.html">Cincinnati</a>, <a href="/events/akron.html">Akron</a>, <a href="/events/toledo.html">Toledo</a>, <a href="/events/findlay.html">Findlay</a>.</p></noscript>`;
// The app is one ~693KB-gzipped bundle and #root ships EMPTY, so a phone on 4G
// stared at a blank white page for seconds before anything appeared — the worst
// possible first impression for a paid ad click. This splash is plain HTML/CSS
// inside #root, so it paints on the very first frame; React's createRoot wipes
// it the moment the app mounts. Keep it tiny and dependency-free.
const SPLASH = `<div id="ll-splash" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#15315B;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
      <div style="width:64px;height:64px;border-radius:16px;background:#D64545;display:flex;align-items:center;justify-content:center">
        <div style="width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#FBF7F0"></div>
      </div>
      <div style="margin-top:18px;color:#FBF7F0;font-size:20px;font-weight:700;letter-spacing:.2px">Local Loop</div>
      <div style="margin-top:6px;color:#8FA6C4;font-size:14px">Finding what's happening near you...</div>
    </div>`;
html = html.replace(/<div id="root">/, `${BODY_SEO}\n<div id="root">${SPLASH}`);

// Warm the connections the app needs the instant JS boots: the data API (every
// screen's first fetch) and the icon font (icons otherwise pop in late).
loadEnv();
const SUPA = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const ionicons = (fs.existsSync(path.join(OUT, 'assets')) ? findFile(path.join(OUT, 'assets'), /^Ionicons\..*\.ttf$/) : '') || '';
const HINTS = [
  SUPA ? `<link rel="preconnect" href="${SUPA}" crossorigin />` : '',
  SUPA ? `<link rel="dns-prefetch" href="${SUPA}" />` : '',
  ionicons ? `<link rel="preload" as="font" type="font/ttf" href="/${ionicons.replace(/\\/g, '/')}" crossorigin />` : '',
].filter(Boolean).join('\n    ');
if (HINTS) html = html.replace('</head>', `  ${HINTS}\n  </head>`);
fs.writeFileSync(idxPath, html);

// Netlify headers. The /_expo/static/** filenames are CONTENT-HASHED, so they can
// be cached forever — they were being served max-age=0,must-revalidate, making
// every repeat visitor revalidate a 2.6MB bundle. index.html must stay uncached
// or deploys would never reach anyone.
fs.writeFileSync(
  path.join(OUT, '_headers'),
  [
    '/_expo/static/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/og-image.png',
    '  Cache-Control: public, max-age=86400',
    '/index.html',
    '  Cache-Control: public, max-age=0, must-revalidate',
    '',
  ].join('\n'),
);

// 5. Per-event SEO landing pages + a fresh sitemap (best-effort; see build-seo.mjs).
await buildSeo(OUT);

console.log(`\nweb build ready in ${OUT}/ (app + preserved files + homepage SEO + event pages)`);
