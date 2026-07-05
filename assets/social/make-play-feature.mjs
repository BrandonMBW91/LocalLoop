import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

// Google Play feature graphic: exactly 1024 x 500. Same brand as the app icon:
// white pin + orange calendar on Local Loop green.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 500">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#217A5B"/><stop offset="1" stop-color="#154634"/>
</linearGradient></defs>
<rect width="1024" height="500" fill="url(#bg)"/>

<!-- app-icon mark -->
<g transform="translate(19.6,45.1) scale(0.40)">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        transform="translate(176 176) scale(28)" fill="#ffffff"/>
  <rect x="432" y="392" width="160" height="150" rx="18" fill="#D9772B"/>
  <rect x="448" y="452" width="128" height="8" fill="#ffffff"/>
  <rect x="462" y="474" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="502" y="474" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="542" y="474" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="462" y="506" width="20" height="20" rx="4" fill="#ffffff"/>
  <rect x="502" y="506" width="20" height="20" rx="4" fill="#ffffff"/>
</g>

<text x="400" y="252" font-family="Arial, Helvetica, sans-serif" font-weight="800"
      font-size="84" letter-spacing="1" fill="#F7F2E7">LOCAL LOOP</text>
<text x="403" y="300" font-family="Arial, Helvetica, sans-serif" font-weight="700"
      font-size="25" letter-spacing="2" fill="#E7B15C">Events &#183; Garage Sales &#183; Food Trucks</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  background: '#1F6F54',
}).render().asPng();

writeFileSync('assets/social/play-feature-graphic.png', png);
try { writeFileSync('C:/Users/micha/Downloads/localloop-play-feature.png', png); } catch (e) {}
console.log('wrote play-feature-graphic.png', png.length, 'bytes');
