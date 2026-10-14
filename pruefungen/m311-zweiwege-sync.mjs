/**
 * M311 — Sync in beide Richtungen über den (Nextcloud-)Ordner.
 *
 * Zwei Browser-Kontexte spielen zwei Rechner; dazwischen liegt ein Ordner im
 * Node-Prozess, der den Cloud-Client spielt (sofortige Spiegelung). Beide
 * Geräte verbinden denselben Ordner über eine nachgebaute Ordner-API.
 *
 *   A  Verbinden: A schreibt, B lädt (Dialog), beide sehen dieselben Boards.
 *   B  Fremde Änderung kommt OHNE Interaktion an (Ordner-Überwachung).
 *   C  Beide ändern gleichzeitig verschiedene Boards → nichts geht verloren.
 *   D  Beide ändern gleichzeitig DASSELBE Board (verschiedene Karten) → beide Karten.
 *   E  Löschen folgt: B entfernt eine Karte, A verliert sie auch.
 *   F  Konfliktkopie des Cloud-Clients wird eingearbeitet und entfernt.
 *   G  Texte: Einstellungen sagen „in beide Richtungen", das Bündel kennt M311.
 *   H  Ruhe: Ohne Änderung schreibt kein Gerät mehr (kein Ping-Pong der Stände).
 */
// Läuft aus dem Repository: `node pruefungen/m311-zweiwege-sync.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4531;
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

// ---- Der „Nextcloud-Ordner": lebt im Node-Prozess, beide Geräte sehen ihn sofort
const ordner = new Map(); // name → { text, lastModified }
const HAUPT = 'pixinotes-daten.json';
const lies = (name) => { const e = ordner.get(name); return e ? JSON.parse(e.text) : null; };
const schreib = (name, obj) => ordner.set(name, { text: JSON.stringify(obj), lastModified: Date.now() });

const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Planung', [note('x1', 'Planung Notiz')]), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
  spaces: [{ id: 's1', name: '🏢 Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'by'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};

/** Ein Gerät: eigener Kontext, eigener Speicher, aber derselbe Ordner */
async function geraet(name, stand) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.exposeFunction('__fsLesen', (n) => ordner.get(n) ?? null);
  await ctx.exposeFunction('__fsSchreiben', (n, text) => { ordner.set(n, { text, lastModified: Date.now() }); });
  await ctx.exposeFunction('__fsListe', () => [...ordner.keys()]);
  await ctx.exposeFunction('__fsEntfernen', (n) => { ordner.delete(n); });
  await ctx.addInitScript((st) => {
    // Nachgebaute File-System-Access-API über den Node-Ordner
    const datei = (n) => ({
      kind: 'file', name: n,
      async getFile() {
        const e = await window.__fsLesen(n);
        if (!e) throw new DOMException('weg', 'NotFoundError');
        return new File([e.text], n, { lastModified: e.lastModified, type: 'application/json' });
      },
      async createWritable() {
        let buf = '';
        return {
          async write(d) { buf += typeof d === 'string' ? d : await new Response(d).text(); },
          async close() { await window.__fsSchreiben(n, buf); },
        };
      },
    });
    const dir = {
      kind: 'directory', name: 'Nextcloud/PixiNotes',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      async getFileHandle(n, o) {
        if (!(await window.__fsLesen(n)) && !o?.create) throw new DOMException('weg', 'NotFoundError');
        return datei(n);
      },
      async *values() { for (const n of await window.__fsListe()) yield { kind: 'file', name: n }; },
      async removeEntry(n) { await window.__fsEntfernen(n); },
    };
    window.showDirectoryPicker = async () => dir;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, stand);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`    PAGEERROR[${name}]:`, e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}

const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const texte = (P) => zustand(P).then((s) => JSON.stringify(s.boards));
const boardNamen = (P) => zustand(P).then((s) => s.boards.map((b) => b.name));
/** Wartet, bis die Bedingung auf dem Gerät gilt (Ordner-Überwachung alle 10 s) */
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (await fn()) return true;
    await P.waitForTimeout(500);
  }
  return fn();
}
async function verbinden(P) {
  await P.locator('button[title^="Einstellungen"]').click();
  await P.waitForTimeout(600);
  await P.locator('.modal button', { hasText: 'Synchronisation' }).first().click();
  await P.waitForTimeout(500);
  await P.locator('.modal button', { hasText: 'Sync-Ordner verbinden' }).click();
  await P.waitForTimeout(1500);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function boardWechseln(P, name) {
  await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click();
  await P.waitForTimeout(700);
}
/** Notiz per Doppelklick anlegen und Text tippen */
async function notiz(P, text, x = 900, y = 500) {
  const vorher = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(x, y);
  await P.waitForTimeout(700);
  const aktiv = await P.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true');
  if (!aktiv) {
    await P.locator('.react-flow__node').last().locator('[contenteditable="true"]').first().click();
    await P.waitForTimeout(300);
  }
  await P.keyboard.type(text, { delay: 20 });
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  return (await P.locator('.react-flow__node').count()) === vorher + 1;
}
const knoten = (P) => P.locator('.react-flow__node').count();

// ══ A: Verbinden ═══════════════════════════════════════════════════════
console.log('\n════ A: Zwei Geräte, ein Ordner ════');
const A = await geraet('A', standA);
const B = await geraet('B', standB);
pruefe('A0 beide Seiten gelten als sichtbar (Ordner-Überwachung läuft)',
  (await A.P.evaluate(() => document.visibilityState)) === 'visible' && (await B.P.evaluate(() => document.visibilityState)) === 'visible');
await verbinden(A.P);
pruefe('A1 Gerät A schreibt die Sync-Datei in den Ordner', !!lies(HAUPT) && lies(HAUPT).boards.length === 2, [...ordner.keys()].join());
await schliessen(A.P);
await verbinden(B.P); // Dialog „Stand laden?" wird angenommen
pruefe('A2 Gerät B übernimmt die Boards aus dem Ordner', (await boardNamen(B.P)).join() === 'Planung,Ideen', (await boardNamen(B.P)).join());
await schliessen(B.P);
await A.P.screenshot({ path: `${SD}/m311-a-verbunden.png` });

// ══ B: Fremde Änderung kommt von allein ═══════════════════════════════
console.log('\n════ B: Fremde Änderung ohne Interaktion ════');
{
  const angelegt = await notiz(B.P, 'Hallo von B');
  pruefe('B1 B legt eine Karte auf „Planung" an', angelegt, `Karten: ${await knoten(B.P)}`);
  const geschrieben = await warteBis(B.P, () => (ordner.get(HAUPT)?.text ?? '').includes('Hallo von B'), 6000);
  pruefe('B2 der Ordner trägt die Karte nach dem Auto-Save', geschrieben);
  const da = await warteBis(A.P, async () => (await texte(A.P)).includes('Hallo von B'));
  pruefe('B3 Gerät A hat die Karte ohne Klick übernommen', da);
  pruefe('B4 … und zeigt sie auf dem offenen Board', (await knoten(A.P)) === 2, `Karten: ${await knoten(A.P)}`);
  const stempel = await A.P.evaluate(() => localStorage.getItem('pixinotes:sync-stamp'));
  pruefe('B5 A gilt als synchron (Stempel = Ordner-Stand)', stempel === lies(HAUPT).savedAt, `${stempel} vs ${lies(HAUPT).savedAt}`);
  pruefe('B6 kein Dirty-Rest auf A', !(await A.P.evaluate(() => localStorage.getItem('pixinotes:sync-dirty'))));
}

// ══ C: Beide ändern gleichzeitig verschiedene Boards ══════════════════
console.log('\n════ C: Gleichzeitig auf verschiedenen Boards ════');
{
  await boardWechseln(B.P, 'Ideen');
  const [a1, b1] = await Promise.all([notiz(A.P, 'Von A auf Planung', 700, 650), notiz(B.P, 'Von B auf Ideen', 700, 650)]);
  pruefe('C1 beide legen zugleich je eine Karte an', a1 && b1);
  const beideA = await warteBis(A.P, async () => { const t = await texte(A.P); return t.includes('Von A auf Planung') && t.includes('Von B auf Ideen'); }, 30000);
  const beideB = await warteBis(B.P, async () => { const t = await texte(B.P); return t.includes('Von A auf Planung') && t.includes('Von B auf Ideen'); }, 30000);
  pruefe('C2 Gerät A hat beide Änderungen', beideA);
  pruefe('C3 Gerät B hat beide Änderungen', beideB);
  const datei = ordner.get(HAUPT)?.text ?? '';
  pruefe('C4 der Ordner trägt beide Anteile', datei.includes('Von A auf Planung') && datei.includes('Von B auf Ideen'));
  const zA = await zustand(A.P); const zB = await zustand(B.P);
  pruefe('C5 beide Geräte haben dieselbe Kartenzahl je Board',
    zA.boards.map((b) => `${b.id}:${b.nodes.length}`).join() === zB.boards.map((b) => `${b.id}:${b.nodes.length}`).join(),
    `${zA.boards.map((b) => `${b.id}:${b.nodes.length}`).join()} vs ${zB.boards.map((b) => `${b.id}:${b.nodes.length}`).join()}`);
  pruefe('C6 Planung: 3 Karten, Ideen: 2 Karten', zA.boards.find((b) => b.id === 'bx').nodes.length === 3 && zA.boards.find((b) => b.id === 'by').nodes.length === 2);
}

// ══ D: Gleichzeitig auf DEMSELBEN Board ═══════════════════════════════
console.log('\n════ D: Gleichzeitig auf demselben Board ════');
{
  await boardWechseln(B.P, 'Planung');
  const [a1, b1] = await Promise.all([notiz(A.P, 'A-gleichzeitig', 500, 750), notiz(B.P, 'B-gleichzeitig', 1100, 750)]);
  pruefe('D1 beide legen zugleich eine Karte auf „Planung" an', a1 && b1);
  const beideA = await warteBis(A.P, async () => { const t = await texte(A.P); return t.includes('A-gleichzeitig') && t.includes('B-gleichzeitig'); }, 30000);
  const beideB = await warteBis(B.P, async () => { const t = await texte(B.P); return t.includes('A-gleichzeitig') && t.includes('B-gleichzeitig'); }, 30000);
  pruefe('D2 Gerät A hat beide Karten', beideA);
  pruefe('D3 Gerät B hat beide Karten', beideB);
  pruefe('D4 beide zeigen 5 Karten auf „Planung"', (await knoten(A.P)) === 5 && (await knoten(B.P)) === 5, `${await knoten(A.P)} / ${await knoten(B.P)}`);
  await A.P.screenshot({ path: `${SD}/m311-d-gerät-a.png` });
  await B.P.screenshot({ path: `${SD}/m311-d-gerät-b.png` });
}

// ══ E: Löschen folgt ══════════════════════════════════════════════════
console.log('\n════ E: Löschen auf B, A folgt ════');
{
  const vorher = await knoten(B.P);
  // Die Karte „Hallo von B" auf B auswählen (Kopfzeile) und löschen
  const id = await B.P.evaluate(() => {
    const n = [...document.querySelectorAll('.react-flow__node')].find((el) => el.textContent.includes('Hallo von B'));
    return n?.getAttribute('data-id') ?? null;
  });
  if (id) {
    await B.P.locator(`.react-flow__node[data-id="${id}"]`).click({ position: { x: 4, y: 4 } });
    await B.P.waitForTimeout(400);
    await B.P.keyboard.press('Delete');
    await B.P.waitForTimeout(500);
    if ((await knoten(B.P)) === vorher) { await B.P.keyboard.press('Backspace'); await B.P.waitForTimeout(500); }
  }
  pruefe('E1 B hat die Karte gelöscht', (await knoten(B.P)) === vorher - 1, `Karten: ${await knoten(B.P)} (vorher ${vorher})`);
  const weg = await warteBis(A.P, async () => !(await texte(A.P)).includes('Hallo von B'));
  pruefe('E2 Gerät A verliert die Karte ebenfalls', weg);
  pruefe('E3 A zeigt 4 Karten', (await knoten(A.P)) === 4, `Karten: ${await knoten(A.P)}`);
}

// ══ F: Konfliktkopie des Cloud-Clients ════════════════════════════════
console.log('\n════ F: Konfliktkopie wird eingearbeitet ════');
{
  const haupt = lies(HAUPT);
  const kopie = { ...haupt, savedAt: new Date(Date.now() - 5000).toISOString() };
  kopie.boards = [...haupt.boards, board('bk', 'Aus der Kopie', [note('k1', 'Kopie Notiz')])];
  kopie.spaces = haupt.spaces.map((sp) => ({ ...sp, projects: sp.projects.map((p, i) => (i === 0 ? { ...p, boardIds: [...p.boardIds, 'bk'] } : p)) }));
  const KOPIE = 'pixinotes-daten (conflicted copy 2026-10-14 101010).json';
  schreib(KOPIE, kopie);
  schreib(HAUPT, haupt); // der Client hat die Hauptdatei frisch abgelegt (neue Signatur, gleicher Inhalt)
  const daA = await warteBis(A.P, async () => (await boardNamen(A.P)).includes('Aus der Kopie'), 20000);
  pruefe('F1 Gerät A arbeitet die Konfliktkopie ein (Board erscheint)', daA, (await boardNamen(A.P)).join());
  pruefe('F2 die Kopie ist aus dem Ordner entfernt', !ordner.has(KOPIE), [...ordner.keys()].join());
  pruefe('F3 die Hauptdatei trägt das Board jetzt', (ordner.get(HAUPT)?.text ?? '').includes('Aus der Kopie'));
  const daB = await warteBis(B.P, async () => (await boardNamen(B.P)).includes('Aus der Kopie'), 20000);
  pruefe('F4 Gerät B bekommt das Board über die Hauptdatei', daB, (await boardNamen(B.P)).join());
  pruefe('F5 die übrigen Karten sind unversehrt (beide Geräte gleich)',
    JSON.stringify((await zustand(A.P)).boards.map((b) => [b.id, b.nodes.length])) === JSON.stringify((await zustand(B.P)).boards.map((b) => [b.id, b.nodes.length])));
}

// ══ G: Texte ══════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
{
  await A.P.locator('button[title^="Einstellungen"]').click();
  await A.P.waitForTimeout(600);
  await A.P.locator('.modal button', { hasText: 'Synchronisation' }).first().click();
  await A.P.waitForTimeout(500);
  const t = await A.P.locator('.modal').innerText();
  pruefe('G1 Einstellungen: Ordner-Weg sagt „in beide Richtungen"', t.includes('in beide Richtungen'));
  pruefe('G2 … und „zusammengeführt" statt „warnt"', t.includes('zusammengeführt') && !t.includes('warnt PixiNotes statt zu überschreiben'));
  await A.P.screenshot({ path: `${SD}/m311-g-einstellungen.png` });
  await schliessen(A.P);
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G3 „Was ist neu" nennt M311', js.includes('Sync in beide Richtungen (M311)'));
}

// ══ H: Ruhe — kein Ping-Pong ══════════════════════════════════════════
console.log('\n════ H: Ruhe ohne Änderung ════');
{
  const vorher = ordner.get(HAUPT)?.lastModified;
  await A.P.waitForTimeout(25000);
  pruefe('H1 ohne Änderung bleibt die Datei 25 s unangetastet', ordner.get(HAUPT)?.lastModified === vorher,
    `geschrieben um ${ordner.get(HAUPT)?.lastModified} (vorher ${vorher})`);
  const zA = await zustand(A.P); const zB = await zustand(B.P);
  pruefe('H2 beide Geräte zeigen denselben Stand', JSON.stringify(zA.boards) === JSON.stringify(zB.boards) && JSON.stringify(zA.spaces) === JSON.stringify(zB.spaces));
  pruefe('H3 beide gelten als synchron (kein Dirty-Rest)',
    !(await A.P.evaluate(() => localStorage.getItem('pixinotes:sync-dirty'))) && !(await B.P.evaluate(() => localStorage.getItem('pixinotes:sync-dirty'))));
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
