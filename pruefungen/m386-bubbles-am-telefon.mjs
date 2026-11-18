/**
 * M386 — Bubbles am Smartphone bearbeiten: Die Änderung muss sich abschließen lassen.
 * Gemeldet: „Editing von Bubbles funktioniert am Smartphone nicht, weil ein Enter fehlt. Man kann höchstens Tab
 * drücken, und es gibt keinen Absenden-Button im Feld." — Das Feld nahm die Änderung nur mit der Enter-Taste an.
 *
 *   A  Telefon (Finger, schmaler Bildschirm): Blase antippen → ✎ → Text ändern → ✓ übernimmt.
 *   B  … ebenso: Feld verlassen mit „Weiter"/Tab, Tipp daneben. ✕ verwirft. Leerer Text ändert nichts.
 *   C  Die Telefon-Tastatur bekommt den Hinweis „Fertig"/„Senden" statt „Weiter"; Knöpfe sind fingergroß,
 *      die Schrift im Feld 16 px (kein Hineinzoomen).
 *   D  Neue Gruppe ohne Enter: ✓ neben dem Feld legt sie an. Neue Idee: „＋" wie bisher.
 *   E  Am Rechner bleibt alles beim Alten: Enter übernimmt, Esc verwirft; dazu ✓/✕ mit der Maus.
 *   F  Andere einzeilige Felder der App bekommen den Hinweis beim Hineintippen; Texte.
 *
 * Läuft aus dem Repository: node pruefungen/m386-bubbles-am-telefon.mjs   (PN_DIST=… für einen anderen Bau)
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4698;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const app = http.createServer((q, r) => {
  let f = path.join(DIST, decodeURIComponent(q.url.split('?')[0]));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.setHeader('content-type', TYP[path.extname(f)] ?? 'application/octet-stream');
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => { if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); } };
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const ideen = Object.fromEntries(['Kaffeemaschine', 'Mehr Fenster', 'Ruheraum', 'Stehtische'].map((t, i) => [`i${i}`, { text: t, von: 'x', t: i + 1 }]));
const stand = {
  boards: [{ id: 'b1', name: 'Workshop', edges: [], drawings: [], comments: [], nodes: [
    { id: 'k1', type: 'bubbles', width: 366, height: 470, position: { x: 40, y: 40 }, data: { title: 'Ideen', frage: 'Was fehlt im Büro?', ideen, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } },
  ] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
async function geraet(telefon) {
  const ctx = await browser.newContext(telefon
    ? { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'de-DE' }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand);
  const P = await ctx.newPage();
  P.fehler = [];
  P.on('pageerror', (e) => { P.fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}
const W = '.react-flow__node-bubbles';
const blase = (P, text) => P.locator(`${W} [data-taste="bub-blase"]`, { hasText: text }).first();
const texte = (P) => P.evaluate((w) => [...document.querySelectorAll(`${w} [data-taste="bub-blase"] .bub-text`)].map((e) => e.textContent).sort().join('|'), W);
const gespeichert = (P) => P.evaluate(() => Object.values(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.ideen).filter((i) => !i.weg).map((i) => i.text).sort().join('|'));
const feld = (P) => P.locator('[data-taste="bub-idee-feld"]');
async function warteBis(P, fn, ms = 6000) { const ende = Date.now() + ms; while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(150); } return fn(); }
/** Blase wählen und ins Bearbeiten gehen — `tipp`: mit dem Finger (Telefon) oder der Maus */
async function bearbeiten(P, text, tipp) {
  const los = (l) => (tipp ? l.tap() : l.click());
  if (!(await P.locator('[data-taste="bub-pille"]').count()) || !(await P.locator('.bub-pille-text', { hasText: text }).count())) { await los(blase(P, text)); await P.waitForTimeout(350); }
  await los(P.locator('[data-taste="bub-idee-aendern"]')); await P.waitForTimeout(350);
  return (await feld(P).count()) === 1 && (await P.evaluate(() => document.activeElement?.getAttribute('data-taste'))) === 'bub-idee-feld';
}
const schreiben = async (P, text) => { await P.keyboard.press('Control+A'); await P.keyboard.type(text, { delay: 15 }); await P.waitForTimeout(150); };

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Telefon – ✓ übernimmt ════');
const T = await geraet(true);
await warteBis(T.P, async () => (await T.P.locator(`${W} [data-taste="bub-blase"]`).count()) === 4, 10000);
pruefe('A0 auf dem Telefon steht die Karte mit vier Blasen', (await texte(T.P)) === 'Kaffeemaschine|Mehr Fenster|Ruheraum|Stehtische', await texte(T.P));
pruefe('A1 Blase antippen → ✎ → das Feld steht im Fokus, mit dem bisherigen Text', (await bearbeiten(T.P, 'Ruheraum', true)) && (await feld(T.P).inputValue()) === 'Ruheraum');
pruefe('A2 im Feld gibt es jetzt „✓" zum Übernehmen und „✕" zum Verwerfen', (await T.P.locator('[data-taste="bub-idee-ok"]').count()) === 1 && (await T.P.locator('[data-taste="bub-idee-abbruch"]').count()) === 1);
await schreiben(T.P, 'Ruheraum mit Sofa');
await T.P.screenshot({ path: path.join(SD, 'm386-telefon-feld.png') });
await T.P.locator('[data-taste="bub-idee-ok"]').tap(); await T.P.waitForTimeout(400);
pruefe('A3 ein Tipp auf ✓ übernimmt den neuen Text – ohne Enter-Taste', (await feld(T.P).count()) === 0 && /Ruheraum mit Sofa/.test(await texte(T.P)) && !/\|Ruheraum\|/.test(`|${await texte(T.P)}|`), await texte(T.P));
pruefe('A4 … er ist gespeichert', await warteBis(T.P, async () => /Ruheraum mit Sofa/.test(await gespeichert(T.P)), 4000), await gespeichert(T.P));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Telefon – Feld verlassen, verwerfen, leer ════');
await bearbeiten(T.P, 'Stehtische', true); await schreiben(T.P, 'Stehtische am Fenster');
await T.P.keyboard.press('Tab'); await T.P.waitForTimeout(400);
pruefe('B1 „Weiter" auf der Tastatur (Tab) verlässt das Feld – die Änderung gilt', (await feld(T.P).count()) === 0 && /Stehtische am Fenster/.test(await texte(T.P)), await texte(T.P));
await bearbeiten(T.P, 'Mehr Fenster', true); await schreiben(T.P, 'Größere Fenster');
await T.P.locator(`${W} [data-taste="bub-zahl"]`).tap(); await T.P.waitForTimeout(400);   // irgendwo daneben: auf den Zähler der Karte
pruefe('B2 ein Tipp daneben verlässt das Feld – die Änderung gilt', (await feld(T.P).count()) === 0 && /Größere Fenster/.test(await texte(T.P)), await texte(T.P));
await bearbeiten(T.P, 'Kaffeemaschine', true); await schreiben(T.P, 'Teekocher');
await T.P.locator('[data-taste="bub-idee-abbruch"]').tap(); await T.P.waitForTimeout(400);
pruefe('B3 ✕ verwirft: der alte Text bleibt', (await feld(T.P).count()) === 0 && /Kaffeemaschine/.test(await texte(T.P)) && !/Teekocher/.test(await texte(T.P)), await texte(T.P));
await bearbeiten(T.P, 'Kaffeemaschine', true); await T.P.keyboard.press('Control+A'); await T.P.keyboard.press('Delete');
await T.P.locator('[data-taste="bub-idee-ok"]').tap(); await T.P.waitForTimeout(400);
pruefe('B4 ein leerer Text ändert nichts (die Idee verschwindet nicht)', /Kaffeemaschine/.test(await texte(T.P)) && (await texte(T.P)).split('|').length === 4, await texte(T.P));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Tastatur-Hinweis, Fingergröße ════');
await bearbeiten(T.P, 'Kaffeemaschine', true);
{
  const m = await T.P.evaluate((w) => {
    const f = document.querySelector('[data-taste="bub-idee-feld"]'); const okK = document.querySelector('[data-taste="bub-idee-ok"]');
    const r = okK.getBoundingClientRect(); const fr = f.getBoundingClientRect(); const p = document.querySelector('[data-taste="bub-pille"]').getBoundingClientRect();
    return { hinweis: f.getAttribute('enterkeyhint'), okH: Math.round(r.height), okB: Math.round(r.width), schrift: getComputedStyle(f).fontSize, feldB: Math.round(fr.width),
      leiste: [Math.round(p.left), Math.round(p.right), Math.round(p.bottom)], inKarte: !!document.querySelector(`${w} [data-taste="bub-pille"]`), schirm: [innerWidth, innerHeight],
      eingabe: document.querySelector(`${w} [data-taste="bub-eingabe"]`).getAttribute('enterkeyhint'), frage: document.querySelector(`${w} [data-taste="bub-frage"]`).getAttribute('enterkeyhint') };
  }, W);
  pruefe('C1 das Feld sagt der Telefon-Tastatur „Fertig" (statt „Weiter"), die Ideen-Eingabe „Senden"', m.hinweis === 'done' && m.eingabe === 'send' && m.frage === 'done', JSON.stringify(m));
  pruefe('C2 die Leiste steht am Telefon fest am unteren Bildschirmrand, ganz im Bild – nicht in der Karte', !m.inKarte && m.leiste[0] >= 0 && m.leiste[1] <= m.schirm[0] && m.leiste[2] <= m.schirm[1] && m.leiste[2] > m.schirm[1] - 140, JSON.stringify(m));
  pruefe('C3 Knöpfe fingergroß (mind. 40 × 40), Schrift im Feld 16 px (kein Hineinzoomen), das Feld breit genug zum Lesen', m.okH >= 40 && m.okB >= 40 && m.schrift === '16px' && m.feldB >= 150, JSON.stringify(m));
}
await T.P.locator('[data-taste="bub-idee-abbruch"]').tap(); await T.P.waitForTimeout(300);

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Neue Gruppe und neue Idee ohne Enter ════');
if (!(await T.P.locator('[data-taste="bub-neue-gruppe"]').count())) { await blase(T.P, 'Kaffeemaschine').tap(); await T.P.waitForTimeout(350); }
await T.P.locator('[data-taste="bub-neue-gruppe"]').tap(); await T.P.keyboard.type('Küche', { delay: 15 }); await T.P.waitForTimeout(200);
pruefe('D1 sobald ein Gruppenname dasteht, erscheint „✓" daneben', (await T.P.locator('[data-taste="bub-neue-gruppe-ok"]').count()) === 1 && (await T.P.locator('[data-taste="bub-neue-gruppe"]').getAttribute('enterkeyhint')) === 'done');
await T.P.locator('[data-taste="bub-neue-gruppe-ok"]').tap(); await T.P.waitForTimeout(500);
{
  const g = await T.P.evaluate(() => { const d = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data; const gid = Object.entries(d.gruppen).find(([, x]) => x.name === 'Küche' && !x.weg)?.[0]; return { gid: !!gid, drin: Object.values(d.ideen).filter((i) => i.g === gid && !i.weg).map((i) => i.text).join() }; });
  pruefe('D2 ein Tipp darauf legt die Gruppe an – die gewählte Idee steckt darin', g.gid && g.drin === 'Kaffeemaschine', JSON.stringify(g));
}
await T.P.locator(`${W} [data-taste="bub-eingabe"]`).tap(); await T.P.keyboard.type('Pflanzen', { delay: 15 });
await T.P.locator(`${W} [data-taste="bub-dazu"]`).tap(); await T.P.waitForTimeout(500);
pruefe('D3 neue Idee: „＋" neben dem Feld nimmt sie auf (wie bisher)', /Pflanzen/.test(await texte(T.P)) && (await T.P.locator(`${W} [data-taste="bub-eingabe"]`).inputValue()) === '', await texte(T.P));
pruefe('D4 keine Fehler auf dem Telefon', T.P.fehler.length === 0, T.P.fehler.join());
await T.ctx.close();

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: am Rechner ════');
const R = await geraet(false);
await warteBis(R.P, async () => (await R.P.locator(`${W} [data-taste="bub-blase"]`).count()) === 4, 10000);
await bearbeiten(R.P, 'Ruheraum', false); await schreiben(R.P, 'Stiller Raum'); await R.P.keyboard.press('Enter'); await R.P.waitForTimeout(400);
pruefe('E1 Enter übernimmt wie bisher', (await feld(R.P).count()) === 0 && /Stiller Raum/.test(await texte(R.P)), await texte(R.P));
await bearbeiten(R.P, 'Stiller Raum', false); await schreiben(R.P, 'Lauter Raum'); await R.P.keyboard.press('Escape'); await R.P.waitForTimeout(400);
pruefe('E2 Esc verwirft wie bisher', (await feld(R.P).count()) === 0 && /Stiller Raum/.test(await texte(R.P)) && !/Lauter Raum/.test(await texte(R.P)), await texte(R.P));
await bearbeiten(R.P, 'Stehtische', false); await schreiben(R.P, 'Hohe Tische'); await R.P.locator('[data-taste="bub-idee-abbruch"]').click(); await R.P.waitForTimeout(400);
pruefe('E3 ✕ mit der Maus verwirft (das Verlassen des Felds zählt dabei nicht als Übernehmen)', !/Hohe Tische/.test(await texte(R.P)) && /Stehtische/.test(await texte(R.P)), await texte(R.P));
await bearbeiten(R.P, 'Stehtische', false); await schreiben(R.P, 'Hohe Tische'); await R.P.locator('[data-taste="bub-idee-ok"]').click(); await R.P.waitForTimeout(400);
pruefe('E4 ✓ mit der Maus übernimmt', /Hohe Tische/.test(await texte(R.P)), await texte(R.P));
await bearbeiten(R.P, 'Hohe Tische', false); await R.P.keyboard.press('Enter'); await R.P.waitForTimeout(400);
pruefe('E5 unverändert bestätigt: nichts ändert sich, keine doppelte Idee', (await texte(R.P)).split('|').length === 4 && /Hohe Tische/.test(await texte(R.P)), await texte(R.P));

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: andere Felder, Texte ════');
{
  await R.P.keyboard.press('Escape'); await R.P.mouse.click(1300, 700); await R.P.waitForTimeout(300);
  await R.P.keyboard.press('Control+k'); await R.P.waitForTimeout(500);
  const s = await R.P.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, hinweis: a?.getAttribute('enterkeyhint'), form: !!a?.form }; });
  pruefe('F1 auch andere einzeilige Felder (hier: Suche, Strg+K) bekommen beim Hineintippen den Hinweis „Fertig"', s.tag === 'INPUT' && (s.hinweis === 'done' || s.form), JSON.stringify(s));
  await R.P.keyboard.press('Escape');
  const hilfe = readdirSync(path.join(DIST, 'assets')).filter((f) => /^HelpOverlay/.test(f)).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8'));
  pruefe('F2 „Was ist neu" nennt es – deutsch und englisch', hilfe.filter((t) => t.includes('(M386)')).length === 2, `${hilfe.length}`);
  pruefe('F3 keine Fehler am Rechner', R.P.fehler.length === 0, R.P.fehler.join());
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
