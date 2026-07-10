import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { CITIES } from '../../src/data/cities.js';

// Town count rounded DOWN to the nearest 10 so "N+ OHIO TOWNS" is always true and
// self-updates as the catalog grows (no more hardcoded, drifting counts).
const TOWN_COUNT = Math.floor(CITIES.length / 10) * 10;

// Square boost/feed graphic (1080x1080) for paid FB boosts. Same brand system as
// the cover: navy gradient, white pin + red calendar mark, cream type, faint
// dotted "loop" route. Deliberately NO store name on the image (Android is still
// in closed testing — the post copy carries per-platform instructions).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#15315B"/><stop offset="1" stop-color="#0E2444"/>
  </linearGradient>
</defs>
<rect width="1080" height="1080" fill="url(#bg)"/>

<!-- faint loop routes echoing the name, top-left + bottom-right -->
<g opacity="0.22" stroke="#ffffff" fill="#ffffff">
  <path d="M96 300 L168 204 L102 110 L206 66 L308 134 L344 248 L266 306"
        stroke-width="3" stroke-dasharray="2 11" fill="none" stroke-linecap="round"/>
  <circle cx="96" cy="300" r="7"/><circle cx="168" cy="204" r="7"/>
  <circle cx="102" cy="110" r="7"/><circle cx="206" cy="66" r="7"/>
  <circle cx="308" cy="134" r="7"/><circle cx="344" cy="248" r="7"/>
  <circle cx="266" cy="306" r="7"/>
</g>
<g opacity="0.22" stroke="#ffffff" fill="#ffffff">
  <path d="M760 1000 L832 904 L766 810 L870 766 L972 834 L1008 948 L930 1006"
        stroke-width="3" stroke-dasharray="2 11" fill="none" stroke-linecap="round"/>
  <circle cx="760" cy="1000" r="7"/><circle cx="832" cy="904" r="7"/>
  <circle cx="766" cy="810" r="7"/><circle cx="870" cy="766" r="7"/>
  <circle cx="972" cy="834" r="7"/><circle cx="1008" cy="948" r="7"/>
  <circle cx="930" cy="1006" r="7"/>
</g>

<!-- app-icon mark, centered: white pin + red calendar -->
<g transform="translate(376,96) scale(0.32)">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        transform="translate(176 176) scale(28)" fill="#ffffff"/>
  <rect x="432" y="392" width="160" height="150" rx="18" fill="#B22234"/>
  <rect x="448" y="452" width="128" height="8" fill="#ffffff"/>
  <rect x="462" y="474" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="502" y="474" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="542" y="474" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="462" y="506" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="502" y="506" width="20" height="20" rx="4" fill="#ffffff"/>
</g>

<!-- wordmark -->
<text x="540" y="530" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
      font-weight="800" font-size="88" letter-spacing="2" fill="#F7F2E7">LOCAL LOOP</text>

<!-- headline -->
<text x="540" y="668" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
      font-weight="800" font-size="76" fill="#ffffff">What&#8217;s happening</text>
<text x="540" y="756" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
      font-weight="800" font-size="76" fill="#ffffff">near you?</text>

<!-- what it covers -->
<text x="540" y="850" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
      font-weight="700" font-size="31" letter-spacing="4" fill="#F7F2E7" opacity="0.92">EVENTS &#183; GARAGE SALES &#183; FOOD TRUCKS</text>

<!-- badge -->
<rect x="258" y="912" width="564" height="80" rx="40" fill="#B22234"/>
<text x="540" y="964" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
      font-weight="800" font-size="34" letter-spacing="2" fill="#ffffff">FREE &#183; ${TOWN_COUNT}+ OHIO TOWNS</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1080 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  background: '#15315B',
}).render().asPng();
writeFileSync(new URL('./boost-square.png', import.meta.url), png);
console.log('wrote assets/social/boost-square.png (1080x1080)');
