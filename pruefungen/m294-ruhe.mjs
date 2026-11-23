/**
 * M294 — Ruhige Voreinstellungen.
 *
 * „Es soll so einfach, unkompliziert und übersichtlich wie möglich sein …
 * Workflow ähnlich wie bei OneNote." Der erste Schritt: Auf der Fläche bewegt
 * sich nichts mehr von selbst. Diese Reihe prüft:
 *   A  Frischer Start: Physik und Klick-Zoom sind aus, kein Start-Toast mehr,
 *      die Vorlieben tragen die Marke `schliff`.
 *   B  Alter Stand mit Physik AN (ohne Marke): wird EINMAL umgestellt, mit
 *      Hinweis-Toast, und die Marke wird gesetzt.
 *   C  Stand MIT Marke und Physik AN: bleibt an — eine bewusste Wahl gilt.
 *   D  Die neuen Schalter (Physik, Klick-Zoom, Konfetti) stehen unter
 *      ⚙ → Design und schreiben in die Vorlieben.
 */
// Läuft aus dem Repository: `node pruefungen/m294-ruhe.mjs`
// Voraussetzung: `npm run build` und ein Chromium (PW_CHROMIUM).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4514;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

/** Seite mit optionalen Vorlieben (localStorage) und optionalem Hauptstand */
async function seite({ vorlieben, physikImHauptstand } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([vorlieben, physikImHauptstand]) => {
    localStorage.setItem('pixinotes-onboarded', '1');
    if (vorlieben) localStorage.setItem('pixinotes-einstellungen', JSON.stringify(vorlieben));
    if (physikImHauptstand) {
      const state = {
        boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes: [] }],
        spaces: [{ id: 's1', name: 'Dienst', projects: [{ id: 'p1', name: 'Beratung', boardIds: ['b0'] }] }],
        activeId: 'b0', view: 'board', physicsEnabled: true, clickZoom: true,
      };
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
    }
  }, [vorlieben ?? null, !!physikImHauptstand]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2600);
  return { ctx, P };
}
const lage = (P) => P.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state ?? {};
  const v = JSON.parse(localStorage.getItem('pixinotes-einstellungen') ?? '{}');
  return {
    physik: st.physicsEnabled ?? null, klickZoom: st.clickZoom ?? null, konfetti: st.konfetti ?? null,
    vPhysik: v.physicsEnabled ?? null, vKlick: v.clickZoom ?? null, vKonfetti: v.konfetti ?? null, schliff: v.schliff ?? null,
    toast: document.querySelector('.toast.show')?.textContent ?? '',
  };
});

console.log('════ A: Frischer Start ════');
{
  const { ctx, P } = await seite();
  const l = await lage(P);
  pruefe('A1 Physik ist aus (M481: es gibt sie nicht mehr, „Bewegung beim Ziehen" ersetzt sie)', l.physik !== true && l.vPhysik !== true, JSON.stringify(l));
  pruefe('A2 Klick-Zoom ist aus (M490: es gibt ihn nicht mehr)', l.klickZoom !== true);
  pruefe('A3 Konfetti ist aus', l.konfetti === false);
  pruefe('A4 die Vorlieben tragen die Marke schliff', l.schliff === 2, String(l.schliff));
  pruefe('A5 kein Spickzettel-Toast mehr beim Start', !/Doppelklick = Notiz/.test(l.toast), l.toast);
  pruefe('A6 kein Umstellungs-Hinweis, es gab nichts umzustellen', !/jetzt aus/.test(l.toast), l.toast);
  await P.screenshot({ path: `${SD}/m294-a-start.png` });
  await ctx.close();
}

console.log('════ B: Alter Stand mit Physik an, ohne Marke ════');
{
  const { ctx, P } = await seite({ vorlieben: { physicsEnabled: true, clickZoom: true, milchglas: true } });
  const l = await lage(P);
  pruefe('B1 Physik wurde ausgeschaltet', l.physik !== true && l.vPhysik !== true, JSON.stringify(l));
  pruefe('B2 Klick-Zoom ist weg (M490: die Option gibt es nicht mehr, der Wert wird verworfen)', l.klickZoom !== true && l.vKlick !== true, JSON.stringify(l));
  pruefe('B3 die Marke ist jetzt gesetzt', l.schliff === 2, String(l.schliff));
  pruefe('B4 der Hinweis sagt, was passiert ist und wo es einzustellen ist', /Physik ist jetzt aus/.test(l.toast) && /Darstellung/.test(l.toast), l.toast);
  await P.screenshot({ path: `${SD}/m294-b-umstellung.png` });
  await ctx.close();
}

console.log('════ B2: Stand von vor M247 (Physik nur im Hauptstand) ════');
{
  const { ctx, P } = await seite({ physikImHauptstand: true });
  const l = await lage(P);
  pruefe('B5 auch dort: Physik aus, Marke gesetzt', l.physik !== true && l.schliff === 2, JSON.stringify(l));
  pruefe('B6 … mit Hinweis', /jetzt aus/.test(l.toast), l.toast);
  await ctx.close();
}

console.log('════ C: Bewusste Wahl mit Marke bleibt ════');
{
  const { ctx, P } = await seite({ vorlieben: { physicsEnabled: true, clickZoom: false, schliff: 1 } });
  const l = await lage(P);
  pruefe('C1 bewusste Wahl mit Marke: kein Zwangs-Hinweis (M481: Physik selbst ist in „Bewegung beim Ziehen" aufgegangen)', l.schliff === 2, JSON.stringify(l));
  pruefe('C2 kein Umstellungs-Hinweis', !/jetzt aus/.test(l.toast), l.toast);
  await ctx.close();
}

console.log('════ D: Der Schalter unter Einstellungen → Darstellung (M490: Konfetti beim Erledigen) ════');
{
  const { ctx, P } = await seite();
  await P.locator('[data-taste="einstellungen"]').click();
  await P.locator('.modal-tabs button', { hasText: 'Darstellung' }).click();
  await P.waitForTimeout(300);
  const zeile = (text) => P.locator('.modal-row-check', { hasText: text }).locator('input[type="checkbox"]');
  // M490: „Lebendige Fläche" ist aufgelöst – Konfetti hat einen eigenen Schalter, Klick-Zoom entfiel
  pruefe('D1 „Konfetti beim Erledigen" steht da und ist aus', (await zeile('Konfetti beim Erledigen').count()) === 1 && !(await zeile('Konfetti beim Erledigen').isChecked()));
  pruefe('D2 keine Schalter für Physik und Klick-Zoom', (await zeile('Physik').count()) === 0 && (await zeile('Klick-Zoom').count()) === 0);
  pruefe('D3 keine „Lebendige Fläche" mehr', (await zeile('Lebendige Fläche').count()) === 0);
  await zeile('Konfetti beim Erledigen').check();
  await P.waitForTimeout(600);
  const l = await lage(P);
  pruefe('D4 das Häkchen schaltet nur Konfetti ein', l.vKonfetti === true && l.vKlick !== true, JSON.stringify(l));
  // Ein Satz je Schalter: keine Erklär-Absätze mit mehr als zwei Sätzen im Reiter Design
  const lang = await P.evaluate(() => [...document.querySelectorAll('.modal-section .modal-hint')]
    .map((el) => el.textContent.trim()).filter((t) => (t.match(/[.!?](\s|$)/g) ?? []).length > 2));
  pruefe('D5 kein Erklärtext im Reiter Design hat mehr als zwei Sätze', lang.length === 0, JSON.stringify(lang).slice(0, 200));
  await P.screenshot({ path: `${SD}/m294-d-design.png` });
  await ctx.close();
}

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
