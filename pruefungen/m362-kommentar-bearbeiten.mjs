/**
 * M362 — Kommentare lassen sich bearbeiten (und einzelne Beiträge löschen).
 *
 *   A  Jeder Beitrag im Gespräch hat „Bearbeiten" und „Löschen".
 *   B  Bearbeiten: Feld mit dem bisherigen Text, Enter speichert; Vermerk „bearbeitet"; Verfasser/Zeit bleiben.
 *   C  Esc bricht ab (nichts geändert, das Gespräch bleibt offen); leerer Text lässt sich nicht speichern.
 *   D  Doppelklick auf den Text beginnt das Bearbeiten; Umschalt+Enter = Zeilenumbruch; Knopf „Speichern".
 *   E  Blase am Pin und Liste unter der PDF-Seite zeigen den neuen Text.
 *   F  Einzelnen Beitrag löschen; der letzte Beitrag nimmt den Thread mit.
 *   G  Abgleich (syncMerge, ohne Browser): bearbeitet ≠ doppelt; neuere Fassung gilt; gelöscht bleibt gelöscht;
 *      Bearbeitung schlägt Löschung; neue Beiträge beider Seiten bleiben.
 *   H  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m362-kommentar-bearbeiten.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import os from 'node:os';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4580;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
function pdfErzeugen(n) {
  const objekte = [];
  objekte.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objekte.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  for (let i = 0; i < n; i++) {
    const inhalt = `${(i % 3) / 2} 0.2 ${1 - (i % 3) / 2} rg 80 ${600 - i * 120} 300 80 re f`;
    objekte.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R >>`);
    objekte.push(`<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
  }
  let aus = '%PDF-1.4\n';
  const offsets = [];
  objekte.forEach((o, i) => { offsets.push(aus.length); aus += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = aus.length;
  aus += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) aus += `${String(o).padStart(10, '0')} 00000 n \n`;
  aus += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return aus;
}
const pdf = pdfErzeugen(2);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const T1 = '2026-11-10T09:00:00.000Z'; const T2 = '2026-11-10T09:05:00.000Z'; const T3 = '2026-11-10T09:10:00.000Z';
const stand = {
  boards: [{ id: 'b1', name: 'Skript', edges: [], drawings: [], nodes: [
    { id: 'f1', type: 'file', width: 520, position: { x: 60, y: 40 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
  ], comments: [
    { id: 'c1', nodeId: 'f1', seite: 1, px: 200, py: 260, msgs: [
      { author: 'Anna', text: 'Hier fehlt eine Qelle.', at: T1 },
      { author: 'Bernd', text: 'Trage ich nach.', at: T2 },
      { author: 'Anna', text: 'Danke!', at: T3 },
    ] },
  ] }],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: false }));
  localStorage.setItem('pixinotes:author', 'Anna');
  localStorage.setItem('pixinotes-pdf-auf', JSON.stringify({ f1: true }));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, stand);
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
P.on('dialog', (d) => d.accept());
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(2200);
const thread = async () => { await P.waitForTimeout(900); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].comments?.[0] ?? null); };
const panel = P.locator('.comment-panel');
const beitraege = () => panel.locator('.comment-msg');

console.log('════ A: Knöpfe ════');
await P.locator('.comment-pin').first().click(); await P.waitForTimeout(500);
pruefe('A1 das Gespräch zeigt drei Beiträge', (await beitraege().count()) === 3);
pruefe('A2 jeder Beitrag hat „Bearbeiten" und „Löschen"', (await panel.locator('[data-taste="kommentar-bearbeiten"]').count()) === 3 && (await panel.locator('[data-taste="kommentar-beitrag-loeschen"]').count()) === 3);

console.log('\n════ B: Bearbeiten mit Enter ════');
await beitraege().nth(0).locator('[data-taste="kommentar-bearbeiten"]').click(); await P.waitForTimeout(300);
const feld = panel.locator('[data-taste="kommentar-entwurf"]');
pruefe('B1 ein Feld mit dem bisherigen Text, der Zeiger steht darin', (await feld.inputValue()) === 'Hier fehlt eine Qelle.' && await feld.evaluate((el) => document.activeElement === el));
await feld.fill('Hier fehlt eine Quelle (S. 12).');
await P.keyboard.press('Enter'); await P.waitForTimeout(400);
let t = await thread();
pruefe('B2 Enter speichert: neuer Text im Gespräch und im Board', /Quelle \(S\. 12\)/.test(await beitraege().nth(0).textContent()) && t.msgs[0].text === 'Hier fehlt eine Quelle (S. 12).', t.msgs[0].text);
pruefe('B3 Verfasser und Zeitpunkt bleiben, „bearbeitet" ist vermerkt', t.msgs[0].author === 'Anna' && t.msgs[0].at === T1 && !!t.msgs[0].bearbeitet && /bearbeitet/.test(await beitraege().nth(0).locator('.comment-msg-meta').textContent()));
pruefe('B4 die anderen Beiträge sind unberührt', t.msgs.length === 3 && t.msgs[1].text === 'Trage ich nach.' && !t.msgs[1].bearbeitet && !/bearbeitet/.test(await beitraege().nth(1).locator('.comment-msg-meta').textContent()));
pruefe('B5 das Feld ist wieder zu', (await feld.count()) === 0);

console.log('\n════ C: Abbrechen, leerer Text ════');
await beitraege().nth(1).locator('[data-taste="kommentar-bearbeiten"]').click(); await P.waitForTimeout(250);
await feld.fill('Ganz anderer Text');
await P.keyboard.press('Escape'); await P.waitForTimeout(400);
t = await thread();
pruefe('C1 Esc bricht ab: Text unverändert, das Gespräch bleibt offen', t.msgs[1].text === 'Trage ich nach.' && (await feld.count()) === 0 && (await panel.count()) === 1);
await beitraege().nth(1).locator('[data-taste="kommentar-bearbeiten"]').click(); await P.waitForTimeout(250);
await feld.fill('   ');
pruefe('C2 ein leerer Text lässt sich nicht speichern', await panel.locator('[data-taste="kommentar-speichern"]').isDisabled());
await P.keyboard.press('Enter'); await P.waitForTimeout(300);
t = await thread();
pruefe('C3 … auch nicht mit Enter', t.msgs[1].text === 'Trage ich nach.');
await panel.locator('.comment-msg-knoepfe button', { hasText: 'Abbrechen' }).click().catch(() => {}); await P.waitForTimeout(250);

console.log('\n════ D: Doppelklick, Umschalt+Enter, Knopf ════');
await beitraege().nth(1).locator('.comment-msg-text').dblclick(); await P.waitForTimeout(300);
pruefe('D1 Doppelklick auf den Text öffnet das Feld', (await feld.count()) === 1 && (await feld.inputValue()) === 'Trage ich nach.');
await feld.press('End'); await P.keyboard.press('Shift+Enter'); await P.keyboard.type('Bis Freitag.');
pruefe('D2 Umschalt+Enter macht einen Zeilenumbruch (speichert nicht)', (await feld.inputValue()) === 'Trage ich nach.\nBis Freitag.');
await P.screenshot({ path: path.join(SD, 'm362-bearbeiten.png') });
await panel.locator('[data-taste="kommentar-speichern"]').click(); await P.waitForTimeout(400);
t = await thread();
pruefe('D3 „Speichern" übernimmt den zweizeiligen Text', t.msgs[1].text === 'Trage ich nach.\nBis Freitag.' && !!t.msgs[1].bearbeitet);

console.log('\n════ E: Blase und Liste ════');
pruefe('E1 die Blase am Pin zeigt den neuen Text', /Quelle \(S\. 12\)/.test(await P.locator('.comment-blase').first().textContent()));
const liste = await P.locator('.pdf-kommentar-text').first().textContent().catch(() => '');
pruefe('E2 die Liste unter der Seite ebenso', /Quelle \(S\. 12\)/.test(liste), liste);

console.log('\n════ F: Löschen ════');
await beitraege().nth(2).locator('[data-taste="kommentar-beitrag-loeschen"]').click(); await P.waitForTimeout(400);
t = await thread();
pruefe('F1 ein einzelner Beitrag ist weg, die anderen bleiben', t.msgs.length === 2 && (await beitraege().count()) === 2 && t.msgs.every((m) => m.text !== 'Danke!'));
await beitraege().nth(1).locator('[data-taste="kommentar-beitrag-loeschen"]').click(); await P.waitForTimeout(300);
await beitraege().nth(0).locator('[data-taste="kommentar-beitrag-loeschen"]').click(); await P.waitForTimeout(400);
t = await thread();
pruefe('F2 der letzte Beitrag nimmt den Thread mit: Pin weg, Gespräch zu', t === null && (await P.locator('.comment-pin').count()) === 0 && (await panel.count()) === 0);
await P.keyboard.press('Control+z'); await P.waitForTimeout(500);
await browser.close(); app.close();

console.log('\n════ G: Abgleich ════');
{
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pn-m362-'));
  const datei = path.join(tmp, 'merge.mjs');
  execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(__repo, 'src/lib/syncMerge.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${datei}`, '--log-level=error']);
  const { dreiWegeMerge } = await import(pathToFileURL(datei).href);
  const karte = { id: 'k', type: 'note', position: { x: 0, y: 0 }, data: { blocks: [] } };
  const m = (author, at, text, bearbeitet) => ({ author, at, text, ...(bearbeitet ? { bearbeitet } : {}) });
  const brd = (msgs) => ({ id: 'bx', name: 'bx', nodes: [karte], edges: [], drawings: [], comments: msgs ? [{ id: 'c', nodeId: 'k', msgs }] : [] });
  const st = (msgs) => ({ boards: [brd(msgs)], spaces: [{ id: 's1', name: 'A', projects: [{ id: 'p1', name: 'P', boardIds: ['bx'] }] }] });
  const texte = (erg) => erg.boards[0].comments?.[0]?.msgs.map((x) => x.text) ?? [];
  const a = m('Anna', T1, 'alt'); const b = m('Bernd', T2, 'zwei');
  // 1) lokal bearbeitet, drüben eine Antwort dazu
  let e = dreiWegeMerge(st([a, b]), st([m('Anna', T1, 'neu', '2026-11-11T10:00:00.000Z'), b]), st([a, b, m('Clara', T3, 'drei')]));
  pruefe('G1 lokal bearbeitet + fremde Antwort: eine Fassung, keine Dublette', JSON.stringify(texte(e)) === JSON.stringify(['neu', 'zwei', 'drei']), texte(e));
  // 2) drüben bearbeitet, lokal eine Antwort
  e = dreiWegeMerge(st([a, b]), st([a, b, m('Clara', T3, 'drei')]), st([m('Anna', T1, 'neu', '2026-11-11T10:00:00.000Z'), b]));
  pruefe('G2 fremd bearbeitet + eigene Antwort: die neue Fassung kommt an', JSON.stringify(texte(e)) === JSON.stringify(['neu', 'zwei', 'drei']), texte(e));
  // 3) beide bearbeitet: die spätere gilt
  e = dreiWegeMerge(st([a, b]), st([m('Anna', T1, 'hier', '2026-11-11T10:00:00.000Z'), b, m('X', T3, 'x')]), st([m('Anna', T1, 'drüben', '2026-11-11T11:00:00.000Z'), b]));
  pruefe('G3 beide bearbeitet: die zuletzt bearbeitete Fassung gilt', texte(e)[0] === 'drüben' && texte(e).length === 3, texte(e));
  // 4) lokal gelöscht, drüben unverändert (plus neue Antwort) → bleibt gelöscht
  e = dreiWegeMerge(st([a, b]), st([b]), st([a, b, m('Clara', T3, 'drei')]));
  pruefe('G4 lokal gelöscht: der Beitrag kommt nicht zurück', JSON.stringify(texte(e)) === JSON.stringify(['zwei', 'drei']), texte(e));
  // 5) drüben gelöscht, lokal unverändert (plus eigene Antwort) → verschwindet
  e = dreiWegeMerge(st([a, b]), st([a, b, m('Clara', T3, 'drei')]), st([b]));
  pruefe('G5 drüben gelöscht: der Beitrag verschwindet hier', JSON.stringify(texte(e)) === JSON.stringify(['zwei', 'drei']), texte(e));
  // 6) drüben gelöscht, lokal bearbeitet → Bearbeitung bleibt
  e = dreiWegeMerge(st([a, b]), st([m('Anna', T1, 'neu', '2026-11-11T10:00:00.000Z'), b]), st([b, m('Clara', T3, 'drei')]));
  pruefe('G6 Bearbeitung schlägt Löschung', JSON.stringify(texte(e)) === JSON.stringify(['neu', 'zwei', 'drei']), texte(e));
  // 7) ohne Vorfahren: Vereinigung
  e = dreiWegeMerge(null, st([a]), st([a, b]));
  pruefe('G7 ohne gemeinsamen Vorfahren: nichts geht verloren', texte(e).includes('alt') && texte(e).includes('zwei'), texte(e));
}

console.log('\n════ H: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('H1 „Was ist neu" nennt M362', js.includes('(M362)'));
}
console.log(`\nm362-kommentar-bearbeiten: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
