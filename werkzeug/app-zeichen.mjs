// App-Zeichen flach und einfarbig: dunkler Grund, weißes P, ein Zettel – ohne Verlauf und Schatten
import { chromium } from 'playwright-core'; import fs from 'node:fs';
const ZIEL = process.argv[2];
const zeichen = (rund, rand) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="${rund}" fill="#1b1e24"/>
<g transform="translate(50 50) scale(${1 - rand}) translate(-50 -50)">
<path d="M33 77V25h19a16.500 16.500 0 0 1 0 33H33" fill="none" stroke="#fff" stroke-width="10.500" stroke-linejoin="miter"/>
<rect x="62" y="61" width="18" height="18" rx="2.500" fill="#f4c84a"/>
</g></svg>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const mal = async (name, px, rund, rand) => {
  const p = await b.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${px}px;height:${px}px}</style>${zeichen(rund, rand)}`);
  await p.screenshot({ path: `${ZIEL}/${name}`, omitBackground: true }); await p.close();
};
await mal('icon-180.png', 180, 0, 0);
await mal('icon-192.png', 192, 22, 0);
await mal('icon-512.png', 512, 22, 0);
await mal('icon-maskable-512.png', 512, 0, 0.22);
fs.writeFileSync(`${ZIEL}/favicon.svg`, zeichen(22, 0).replace(/\n/g, ''));
await b.close();
