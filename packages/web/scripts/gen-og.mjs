// Rasterize public/og.svg into public/og.png. Social platforms (iMessage, Slack, X, WhatsApp)
// don't render an SVG og:image, so the shipped share card must be a PNG. Output is committed;
// re-run with `pnpm --filter @owewell/web gen:og` after editing og.svg.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const pub = resolve(import.meta.dirname, '..', 'public');
const svg = readFileSync(resolve(pub, 'og.svg'), 'utf8');

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  // The wordmark declares Inter with a system sans-serif fallback; load system fonts so the
  // fallback resolves when Inter isn't installed on the build machine.
  font: { loadSystemFonts: true, defaultFontFamily: 'sans-serif' },
})
  .render()
  .asPng();

writeFileSync(resolve(pub, 'og.png'), png);
console.log(`wrote og.png (${png.length.toLocaleString()} bytes)`);
