import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

// Facebook page cover ratio (820x312 display -> 1640x624 @2x). Content kept in
// the center-safe zone. Mark geometry is the exact app-icon lockup: white pin +
// orange calendar on Local Loop green.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1640 624">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#15315B"/><stop offset="1" stop-color="#0E2444"/>
  </linearGradient>
</defs>
<rect width="1640" height="624" fill="url(#bg)"/>

<!-- faint "loop" route on the right, echoing the name -->
<g opacity="0.28" stroke="#ffffff" fill="#ffffff">
  <path d="M1300 440 L1372 344 L1306 250 L1410 206 L1512 274 L1548 388 L1470 446"
        stroke-width="3" stroke-dasharray="2 11" fill="none" stroke-linecap="round"/>
  <circle cx="1300" cy="440" r="7"/><circle cx="1372" cy="344" r="7"/>
  <circle cx="1306" cy="250" r="7"/><circle cx="1410" cy="206" r="7"/>
  <circle cx="1512" cy="274" r="7"/><circle cx="1548" cy="388" r="7"/>
  <circle cx="1470" cy="446" r="7"/>
</g>

<!-- app-icon mark: white pin + orange calendar -->
<g transform="translate(92,56) scale(0.5)">
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

<!-- wordmark + tagline -->
<text x="562" y="322" font-family="Arial, Helvetica, sans-serif" font-weight="800"
      font-size="132" letter-spacing="2" fill="#F7F2E7">LOCAL LOOP</text>
<text x="566" y="388" font-family="Arial, Helvetica, sans-serif" font-weight="700"
      font-size="33" letter-spacing="7" fill="#F7F2E7">NORTHWEST, CENTRAL &amp; NORTHEAST OHIO</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1640 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  background: '#15315B',
}).render().asPng();

mkdirSync('assets/social', { recursive: true });
writeFileSync('assets/social/fb-cover.png', png);
try { writeFileSync('C:/Users/micha/Downloads/localloop-fb-cover.png', png); } catch (e) {}
console.log('wrote fb-cover.png', png.length, 'bytes');
