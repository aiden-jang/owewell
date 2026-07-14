// Rasterize public/icon.svg into the PNG sizes iOS, Android, and PWA installs
// expect (SVG icons are ignored on several of those surfaces). Output PNGs are
// committed; re-run with `pnpm --filter @owewell/web gen:icons` after editing the SVG.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const pub = resolve(import.meta.dirname, '..', 'public');
const svg = readFileSync(resolve(pub, 'icon.svg'), 'utf8');
// iOS (apple-touch-icon) and Android (maskable) apply their OWN rounded mask and composite any
// transparency to black — a pre-rounded, transparent-cornered icon renders with black corners or
// goes missing (e.g. in the iOS share sheet). Those surfaces need a full-bleed opaque square, so
// drop the corner radius for them. The plain favicon (icon-192) keeps the rounded look.
const fullBleedSvg = svg.replace('rx="120"', 'rx="0"');

const targets = [
  ['apple-touch-icon.png', 180, fullBleedSvg],
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, fullBleedSvg],
];

for (const [name, size, source] of targets) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(pub, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length.toLocaleString()} bytes)`);
}
