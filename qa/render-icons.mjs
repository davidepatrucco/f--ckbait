// Rende un icon.svg nei PNG richiesti dal manifest, alle dimensioni esatte.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const b = await chromium.launch();
for (const size of [16, 48, 128]) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px">${svg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`)}</body></html>`);
  await p.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true });
  await p.close();
  console.log(`  icon-${size}.png`);
}
await b.close();
