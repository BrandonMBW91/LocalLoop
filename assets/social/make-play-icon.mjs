import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

// Google Play hi-res icon: exactly 512 x 512, matches the app launcher icon
// (white pin + orange calendar on Local Loop green).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#15315B"/>
<g transform="scale(0.5)">
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
</svg>`;

const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 }, background: '#15315B' }).render().asPng();
writeFileSync('assets/social/play-icon-512.png', png);
try { writeFileSync('C:/Users/micha/Downloads/localloop-play-icon-512.png', png); } catch (e) {}
console.log('wrote play-icon-512.png', png.length, 'bytes');
