import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

// Facebook / social PROFILE picture, 1024x1024. It displays as a CIRCLE, so the
// app-icon mark (white pin + red calendar) is centered with generous padding and
// nothing rides the edges. Navy radial gradient + a faint dotted "loop" ring that
// echoes the name without cluttering the circle crop.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
<defs>
  <radialGradient id="bg" cx="0.5" cy="0.40" r="0.85">
    <stop offset="0" stop-color="#1C3E70"/><stop offset="0.65" stop-color="#15315B"/><stop offset="1" stop-color="#0E2444"/>
  </radialGradient>
</defs>
<rect width="1024" height="1024" fill="url(#bg)"/>

<!-- faint dotted loop ring (well inside the circle crop) -->
<circle cx="512" cy="512" r="392" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="4" stroke-dasharray="2 20" stroke-linecap="round"/>

<!-- app-icon mark, centered -->
<g transform="translate(0,74)">
  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
        transform="translate(176 176) scale(28)" fill="#ffffff"/>
  <rect x="468" y="376" width="16" height="34" rx="7" fill="#ffffff"/>
  <rect x="540" y="376" width="16" height="34" rx="7" fill="#ffffff"/>
  <rect x="432" y="392" width="160" height="150" rx="18" fill="#B22234"/>
  <rect x="448" y="452" width="128" height="8" fill="#ffffff"/>
  <g fill="#ffffff">
    <rect x="462" y="474" width="20" height="20" rx="4"/>
    <rect x="502" y="474" width="20" height="20" rx="4"/>
    <rect x="542" y="474" width="20" height="20" rx="4"/>
    <rect x="462" y="506" width="20" height="20" rx="4"/>
    <rect x="502" y="506" width="20" height="20" rx="4"/>
  </g>
</g>
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 }, background: '#15315B' }).render().asPng();
mkdirSync('assets/social', { recursive: true });
writeFileSync('assets/social/fb-profile.png', png);
try { writeFileSync('C:/Users/micha/Downloads/localloop-fb-profile.png', png); } catch (e) {}
console.log('wrote fb-profile.png', png.length, 'bytes');
