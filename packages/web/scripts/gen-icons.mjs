// Rasterize public/icon.svg into the PNG sizes iOS, Android, and PWA installs
// expect (SVG icons are ignored on several of those surfaces). Output PNGs are
// committed; re-run with `pnpm --filter @owewell/web gen:icons` after editing the SVG.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const pub = resolve(import.meta.dirname, '..', 'public');
const svg = readFileSync(resolve(pub, 'icon.svg'), 'utf8');

const targets = [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

for (const [name, size] of targets) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(pub, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length.toLocaleString()} bytes)`);
}
