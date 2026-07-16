// Generates site/og-image.png — the 1200x630 social card Facebook/iMessage/X show
// when localloop.io is shared or scraped for an ad.
//
// Run once by hand when the card design changes:
//   npm i sharp --no-save && node scripts/make-og-image.mjs
// sharp is deliberately NOT a dependency: the PNG is committed to site/ and
// merged into dist/ by build-web.mjs, so the nightly CI build never needs image
// tooling. (Before this, og:image pointed at favicon.ico — a 48px .ico, a format
// Facebook rejects outright, so every share and ad-link scrape rendered with no
// image at all.)
import sharp from 'sharp';
import fs from 'node:fs';

const W = 1200;
const H = 630;
const NAVY = '#15315B';
const CREAM = '#FBF7F0';
const RED = '#D64545';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1B3C6B"/>
      <stop offset="100%" stop-color="${NAVY}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <!-- warm accent bar, echoes the app's pin -->
  <rect x="0" y="0" width="14" height="${H}" fill="${RED}"/>
  <text x="90" y="250" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="82" font-weight="bold" fill="${CREAM}">Local Loop</text>
  <text x="90" y="330" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="42" fill="#C9D6E8">Everything happening in your town.</text>
  <text x="90" y="400" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="34" fill="#8FA6C4">Events, garage sales &amp; food trucks</text>
  <text x="90" y="448" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="34" fill="#8FA6C4">across 100+ Ohio towns. Free.</text>
  <text x="90" y="558" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="32" font-weight="bold" fill="${RED}">localloop.io</text>
</svg>`;

const logo = await sharp('assets/icon.png').resize(300, 300, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();

await sharp(Buffer.from(svg))
  .composite([{ input: logo, top: Math.round((H - 300) / 2), left: W - 300 - 90 }])
  .png()
  .toFile('site/og-image.png');

const { size } = fs.statSync('site/og-image.png');
console.log(`site/og-image.png written: ${W}x${H}, ${Math.round(size / 1024)} KB`);
