/**
 * M460 — Versionen nachgeschärft: vergleichen, löschen, Team.
 *
 *   A  Vergleich Karte für Karte: gegenüber einem Stand stehen neue, gelöschte und geänderte Karten richtig da
 *      (Symbol, Titel, „geändert gerade eben" aus der M453-Zeit).
 *   B  Einzelne Karten zurückholen: eine gelöschte kommt samt Verbindung wieder, eine geänderte bekommt ihren
 *      damaligen Inhalt (Lage bleibt); je Zurückholen genau ein Strg+Z-Schritt, Strg+Y holt es wieder.
 *   C  Stand löschen: nur nach Rückfrage; andere Stände bleiben vollständig (geteilter großer Inhalt), Dateien
 *      bleiben, solange ein anderer Stand sie braucht — und werden erst frei, wenn keiner sie mehr braucht.
 *   D  Team: ein großer Schub von außen (≥ 5 Karten gelöscht/geändert, Sync-Eingang über den Ordner) sichert
 *      vorher einen Stand „Vor Änderungen anderer", obwohl die Abgleich-Sicherung gedrosselt ist; ein kleiner
 *      Schub nicht, ein zweiter großer gleich danach auch nicht (gedrosselt).
 *   E  Texte (englisch, Hilfe), keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m460-versionen-2.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5460;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

// ---- Der Sync-Ordner: lebt im Node-Prozess (wie m311), hier spielt der Test das „andere Gerät"
const ordner = new Map();
const HAUPT = 'pixinotes-daten.json';
const lies = (name) => { const e = ordner.get(name); return e ? JSON.parse(e.text) : null; };
const schreib = (name, obj) => ordner.set(name, { text: JSON.stringify(obj), lastModified: Date.now() });

const GROSS = 'Großer Inhalt '.repeat(2500);
const text = (t) => [{ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] }];
const notiz = (id, i, t) => ({ id, type: 'note', position: { x: (i % 5) * 290, y: Math.floor(i / 5) * 210 }, width: 260, height: 170, autoFit: false, data: { color: 'yellow', blocks: text(t) } });
const startNodes = [
  notiz('n1', 0, GROSS), notiz('n2', 1, 'Zweite Karte'), notiz('n3', 2, 'Dritte im Original'),
  notiz('n4', 3, 'Vierte'), notiz('n5', 4, 'Fünfte'), notiz('n6', 5, 'Sechste'), notiz('n7', 6, 'Siebte'), notiz('n8', 7, 'Achte'), notiz('n9', 8, 'Neunte'),
  { id: 'f', type: 'file', position: { x: 4 * 290, y: 210 }, width: 260, data: { name: 'bericht.txt', size: 5, mime: 'text/plain' } },
];
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
await ctx.exposeFunction('__fsLesen', (n) => ordner.get(n) ?? null);
await ctx.exposeFunction('__fsSchreiben', (n, t) => { ordner.set(n, { text: t, lastModified: Date.now() }); });
await ctx.exposeFunction('__fsListe', () => [...ordner.keys()]);
await ctx.exposeFunction('__fsEntfernen', (n) => { ordner.delete(n); });
await ctx.addInitScript((nodes) => {
  const datei = (n) => ({
    kind: 'file', name: n,
    async getFile() {
      const e = await window.__fsLesen(n);
      if (!e) throw new DOMException('weg', 'NotFoundError');
      return new File([e.text], n, { lastModified: e.lastModified, type: 'application/json' });
    },
    async createWritable() {
      let buf = '';
      return { async write(d) { buf += typeof d === 'string' ? d : await new Response(d).text(); }, async close() { await window.__fsSchreiben(n, buf); } };
    },
  });
  const dir = {
    kind: 'directory', name: 'Team/PixiNotes',
    queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    async getFileHandle(n, o) { if (!(await window.__fsLesen(n)) && !o?.create) throw new DOMException('weg', 'NotFoundError'); return datei(n); },
    async *values() { for (const n of await window.__fsListe()) yield { kind: 'file', name: n }; },
    async removeEntry(n) { await window.__fsEntfernen(n); },
  };
  window.showDirectoryPicker = async () => dir;
  try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
  localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b1', name: 'Team', drawings: [], nodes, edges: [{ id: 'e12', source: 'n1', target: 'n2' }] }],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false } }));
}, startNodes);
const P = await ctx.newPage();
P.on('pageerror', (e) => fehler.push(e.message));
P.on('dialog', (d) => d.accept());
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(3200);

const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const board = async () => (await zustand()).boards.find((b) => b.id === 'b1');
const karten = async () => ((await board())?.nodes ?? []).map((n) => n.id).sort().join(',');
const textVon = async (id) => { const n = (await board()).nodes.find((x) => x.id === id); return (n?.data?.blocks ?? []).map((b) => (b.content ?? []).map((c) => c.text).join('')).join('|'); };
const idb = (fn, arg) => P.evaluate(([f, a]) => new Promise((ok, nein) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => nein(r.error);
  // eslint-disable-next-line no-new-func
  r.onsuccess = () => new Function('db', 'arg', 'ok', f)(r.result, a, ok);
}), [fn, arg]);
const schluessel = () => idb("const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => ok(q.result.map(String));");
const toast = () => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const liste = () => P.evaluate(() => [...document.querySelectorAll('[data-taste="version"]')].map((e) => ({ karten: Number(e.dataset.karten), grund: e.dataset.grund, text: e.textContent })));
const vergleich = () => P.evaluate(() => [...document.querySelectorAll('[data-taste="vergleich-karte"]')].map((e) => ({
  art: e.dataset.art, id: e.dataset.id, text: e.textContent, symbol: !!e.querySelector('svg'), knopf: !!e.querySelector('[data-taste="karte-zurueckholen"]'),
})));
const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(300); };
const dialogAuf = async () => {
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="dock-versionen"]').click(); await P.waitForTimeout(700);
};
const loeschenKarte = async (id) => {
  await P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:einpassen'))); await P.waitForTimeout(600);
  await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true }); await P.waitForTimeout(250);
  await P.keyboard.press('Delete'); await P.waitForTimeout(500);
};
const waehle = async (i) => { await P.locator('[data-taste="version"]').nth(i).click(); await P.waitForTimeout(600); };
async function warteBis(fn, ms = 25000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(500); }
  return fn();
}
// Inhalt der Datei-Karte im Gerätespeicher (wie nach einem Hochladen)
await idb("const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(new Blob(['hallo'], { type: 'text/plain' }), 'file:f'); tx.oncomplete = () => ok(true);");

// ---------- A ----------
console.log('A  Vergleich Karte für Karte');
{
  await loeschenKarte('n2');
  // n3 bearbeiten (wie von Hand: hineinklicken und tippen)
  // Ruhende Notizen bekommen ihren Editor erst beim Hineinklicken (M338)
  await P.locator('.react-flow__node[data-id="n3"]').click({ position: { x: 120, y: 90 } }); await P.waitForTimeout(500);
  const feld = P.locator('.react-flow__node[data-id="n3"] [contenteditable="true"]').first();
  if (!(await feld.count())) { await P.locator('.react-flow__node[data-id="n3"]').dblclick({ position: { x: 120, y: 90 } }); await P.waitForTimeout(500); }
  await feld.click(); await P.waitForTimeout(300);
  await P.keyboard.press('End'); await P.keyboard.type(' und bearbeitet', { delay: 15 }); await P.waitForTimeout(500);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.evaluate(() => document.activeElement?.blur?.());
  // eine neue Karte (Doppelklick auf freie Fläche)
  const vorher = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(720, 620); await P.waitForTimeout(700);
  await P.keyboard.type('Neu dazu', { delay: 15 }); await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  await P.evaluate(() => document.activeElement?.blur?.());
  const st = await board();
  const neuId = st.nodes.find((n) => !startNodes.some((s) => s.id === n.id))?.id;
  pruefe('A0 Ausgangslage: n2 gelöscht, n3 bearbeitet, eine Karte neu', !st.nodes.some((n) => n.id === 'n2') && /bearbeitet/.test(await textVon('n3')) && !!neuId && (await P.locator('.react-flow__node').count()) === vorher + 1, [await karten(), await textVon('n3')]);
  await dialogAuf();
  await P.locator('[data-taste="version-sichern"]').click(); await P.waitForTimeout(900);
  const l = await liste();
  pruefe('A1 zwei Stände: von Hand gesichert und vor der ersten Änderung', l.length === 2 && l[0].grund === 'manuell' && l[1].grund === 'sitzung' && l[1].karten === 10, l);
  await waehle(1);
  const v = await vergleich();
  const art = (a) => v.filter((x) => x.art === a).map((x) => x.id).join(',');
  pruefe('A2 gelöscht: n2', art('geloescht') === 'n2', v);
  pruefe('A3 geändert: n3 – mit „geändert gerade eben" (M453)', art('geaendert') === 'n3' && /geändert gerade eben/.test(v.find((x) => x.id === 'n3')?.text ?? ''), v);
  pruefe('A4 neu: die neue Karte', art('neu') === neuId, v);
  pruefe('A5 jede Zeile mit Symbol und Titel/Auszug', v.every((x) => x.symbol) && /Zweite Karte/.test(v.find((x) => x.id === 'n2')?.text ?? '') && /Dritte im Original und bearbeitet/.test(v.find((x) => x.id === 'n3')?.text ?? ''), v);
  pruefe('A6 Zurückholen nur bei gelöschten und geänderten', v.filter((x) => x.knopf).map((x) => x.art).sort().join() === 'geaendert,geloescht', v);
  await waehle(0);
  pruefe('A7 gegenüber dem jüngsten Stand: keine Unterschiede, keine Liste', (await vergleich()).length === 0);
  await waehle(1);
}

// ---------- B ----------
console.log('B  Einzelne Karten zurückholen');
{
  const lage3 = (await board()).nodes.find((n) => n.id === 'n3').position;
  await P.locator('[data-taste="vergleich-karte"][data-id="n2"] [data-taste="karte-zurueckholen"]').click(); await P.waitForTimeout(700);
  let b = await board();
  pruefe('B1 n2 ist wieder da – samt Verbindung zu n1', b.nodes.some((n) => n.id === 'n2') && b.edges.some((e) => e.source === 'n1' && e.target === 'n2'), [await karten(), b.edges]);
  pruefe('B2 der Hinweis nennt die Karte und Strg+Z', /Zweite Karte/.test(await toast()) && /Strg\+Z/.test(await toast()), await toast());
  pruefe('B3 das übrige Board bleibt: n3 noch bearbeitet, die neue Karte noch da', /bearbeitet/.test(await textVon('n3')) && b.nodes.length === 11, b.nodes.length);
  pruefe('B4 der Vergleich zeigt n2 nicht mehr als gelöscht', !(await vergleich()).some((x) => x.id === 'n2'));
  await P.locator('[data-taste="vergleich-karte"][data-id="n3"] [data-taste="karte-zurueckholen"]').click(); await P.waitForTimeout(700);
  b = await board();
  const n3 = b.nodes.find((n) => n.id === 'n3');
  pruefe('B5 n3 hat wieder den Inhalt von damals, die Lage bleibt', (await textVon('n3')) === 'Dritte im Original' && n3.position.x === lage3.x && n3.position.y === lage3.y, await textVon('n3'));
  pruefe('B6 die Fläche zeigt den alten Text', /Dritte im Original/.test(await P.locator('.react-flow__node[data-id="n3"]').innerText()) && !/bearbeitet/.test(await P.locator('.react-flow__node[data-id="n3"]').innerText()));
  pruefe('B7 Zurückholen zählt als Änderung (M453-Zeit frisch)', Date.now() - (n3.geaendert ?? 0) < 60_000, n3.geaendert);
  await zu();
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  pruefe('B8 Strg+Z nimmt nur das letzte Zurückholen zurück (n3 bearbeitet, n2 bleibt)', /bearbeitet/.test(await textVon('n3')) && (await karten()).includes('n2'), [await textVon('n3'), await karten()]);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  pruefe('B9 noch ein Strg+Z: n2 wieder weg', !(await karten()).split(',').includes('n2'), await karten());
  await P.keyboard.press('Control+y'); await P.waitForTimeout(700);
  pruefe('B10 Strg+Y holt n2 wieder', (await karten()).split(',').includes('n2'), await karten());
}

// ---------- C ----------
console.log('C  Stand löschen');
{
  await loeschenKarte('f');
  pruefe('C0 die Datei-Karte ist vom Board', !(await karten()).split(',').includes('f'), await karten());
  await dialogAuf();
  await P.locator('[data-taste="version-sichern"]').click(); await P.waitForTimeout(900);
  let l = await liste();
  pruefe('C1 drei Stände (neu, von Hand, vor der ersten Änderung)', l.length === 3 && l[0].grund === 'manuell' && l[2].grund === 'sitzung', l);
  const blobsVor = (await schluessel()).filter((k) => k.startsWith('ver-blob:')).length;
  await waehle(1); // der erste „von Hand" — er enthält die Datei-Karte
  await P.locator('[data-taste="version-loeschen"]').click(); await P.waitForTimeout(300);
  pruefe('C2 nichts geschieht ohne Bestätigung', (await liste()).length === 3 && (await P.locator('[data-taste="version-loeschen-ja"]').count()) === 1);
  await P.locator('[data-taste="version-loeschen-ja"]').click(); await P.waitForTimeout(900);
  l = await liste();
  pruefe('C3 der Stand ist weg, die anderen bleiben', l.length === 2 && l[0].grund === 'manuell' && l[1].grund === 'sitzung', l);
  pruefe('C4 der Hinweis bestätigt das Löschen', /gelöscht/.test(await toast()), await toast());
  let keys = await schluessel();
  pruefe('C5 der geteilte große Inhalt bleibt (andere Stände brauchen ihn)', blobsVor === 1 && keys.filter((k) => k.startsWith('ver-blob:')).length === 1, keys.filter((k) => k.startsWith('ver-blob:')));
  await waehle(1);
  pruefe('C6 der ältere Stand lädt vollständig (Skizze mit 10 Karten, Datei-Karte im Vergleich)',
    Number(await P.locator('[data-taste="versionen-skizze"]').getAttribute('data-teile')) === 10 && (await vergleich()).some((x) => x.id === 'f' && x.art === 'geloescht'));
  await zu();
  pruefe('C7 der Datei-Inhalt liegt noch im Speicher', keys.includes('file:f'));
  // Neu laden: Das Aufräumen beim Start lässt die Datei liegen, weil der Stand „vor der ersten Änderung" sie braucht
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(9500);
  keys = await schluessel();
  pruefe('C8 nach dem Neuladen und Aufräumen: Datei noch da', keys.includes('file:f'));
  // Jetzt auch diesen Stand löschen → nach dem nächsten Start ist die Datei frei
  await dialogAuf();
  l = await liste();
  const i = l.findIndex((v) => v.grund === 'sitzung');
  await waehle(i);
  await P.locator('[data-taste="version-loeschen"]').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="version-loeschen-ja"]').click(); await P.waitForTimeout(900);
  const rest = await liste();
  pruefe('C9 der letzte Stand mit der Datei-Karte ist gelöscht', rest.length === l.length - 1 && !rest.some((v) => v.grund === 'sitzung'), rest);
  await zu();
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(9500);
  keys = await schluessel();
  pruefe('C10 jetzt braucht niemand die Datei mehr – sie ist frei', !keys.includes('file:f'));
  pruefe('C11 der große Inhalt bleibt für den übrigen Stand', keys.filter((k) => k.startsWith('ver-blob:')).length === 1);
  await dialogAuf();
  await waehle(0);
  pruefe('C12 der übrige Stand lädt weiter', Number(await P.locator('[data-taste="versionen-skizze"]').getAttribute('data-teile')) >= 10);
  await zu();
}

// ---------- D ----------
console.log('D  Team: großer Schub von außen');
{
  // Eine eigene Änderung seit dem letzten Stand (sonst wäre der Stand vor dem Schub schon gesichert — „gleich")
  const eigene = (await board()).nodes.find((n) => !startNodes.some((x) => x.id === n.id))?.id;
  await loeschenKarte(eigene);
  await P.locator('button[title^="Einstellungen"]').click(); await P.waitForTimeout(600);
  await P.locator('.modal button', { hasText: 'Daten' }).first().click(); await P.waitForTimeout(500);
  await P.locator('.modal button', { hasText: 'Sync-Ordner verbinden' }).click(); await P.waitForTimeout(1500);
  await zu();
  pruefe('D0 der Ordner trägt den Stand', !!lies(HAUPT) && lies(HAUPT).boards.find((b) => b.id === 'b1')?.nodes.length === 9, lies(HAUPT)?.boards?.[0]?.nodes?.length);
  const vorher = await liste().then(async () => { await dialogAuf(); const x = await liste(); await zu(); return x; });
  // Das „andere Gerät" löscht fünf Karten
  const stempel = (s) => { const d = new Date(Date.now() + s); return d.toISOString().replace('Z', '001Z'); };
  {
    const p = lies(HAUPT);
    const b = p.boards.find((x) => x.id === 'b1');
    const weg = ['n5', 'n6', 'n7', 'n8', 'n9'];
    b.nodes = b.nodes.filter((n) => !weg.includes(n.id));
    p.geloescht = { ...(p.geloescht ?? {}), ...Object.fromEntries(weg.map((id) => [id, new Date().toISOString()])) };   // M351: Löschungen reisen als Grabstein
    p.savedAt = stempel(1000);
    schreib(HAUPT, p);
  }
  const da = await warteBis(async () => (await board()).nodes.length === 4);
  pruefe('D1 der Schub kommt ohne Klick an (5 Karten weg)', da, await karten());
  await P.waitForTimeout(800);
  await dialogAuf();
  let l = await liste();
  const team = l.filter((v) => v.grund === 'team');
  pruefe('D2 davor wurde ein Stand „Vor Änderungen anderer" gesichert – mit allen 9 Karten', team.length === 1 && team[0].karten === 9 && /Vor Änderungen anderer/.test(team[0].text) && l.length === vorher.length + 1, l);
  pruefe('D3 … obwohl die gewöhnliche Abgleich-Sicherung gedrosselt war (kein „Vor Abgleich")', !l.some((v) => v.grund === 'abgleich'), l);
  await waehle(l.findIndex((v) => v.grund === 'team'));
  pruefe('D4 der Vergleich zeigt die fünf weggefallenen Karten', (await vergleich()).filter((x) => x.art === 'geloescht').length === 5);
  await zu();
  // Kleiner Schub: eine Karte geändert → keine Sicherung
  {
    const p = lies(HAUPT);
    const b = p.boards.find((x) => x.id === 'b1');
    b.nodes = b.nodes.map((n) => (n.id === 'n4' ? { ...n, data: { ...n.data, blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vierte von drüben', styles: {} }] }] } } : n));
    p.savedAt = stempel(2000);
    schreib(HAUPT, p);
  }
  pruefe('D5 der kleine Schub kommt an', await warteBis(async () => (await textVon('n4')) === 'Vierte von drüben'), await textVon('n4'));
  await P.waitForTimeout(800);
  await dialogAuf();
  pruefe('D6 ein kleiner Schub (1 Karte) sichert nichts', (await liste()).length === l.length, await liste());
  await zu();
  // Gleich noch ein großer Schub: fünf Karten geändert → gedrosselt, keine zweite Sicherung
  {
    const p = lies(HAUPT);
    const b = p.boards.find((x) => x.id === 'b1');
    b.nodes = b.nodes.map((n) => (n.type === 'note' ? { ...n, data: { ...n.data, blocks: [{ type: 'paragraph', content: [{ type: 'text', text: `Umgebaut ${n.id}`, styles: {} }] }] } } : n));
    p.savedAt = stempel(3000);
    schreib(HAUPT, p);
  }
  pruefe('D7 der zweite große Schub kommt an', await warteBis(async () => (await textVon('n2')) === 'Umgebaut n2'), await textVon('n2'));
  await P.waitForTimeout(800);
  await dialogAuf();
  l = await liste();
  pruefe('D8 gedrosselt: keine zweite Sicherung „Vor Änderungen anderer" innerhalb von zwei Minuten', l.filter((v) => v.grund === 'team').length === 1, l);
  await zu();
}

// ---------- E ----------
console.log('E  Texte');
{
  const lies2 = (p) => readFileSync(path.join(__repo, p), 'utf-8');
  const en = JSON.parse(lies2('src/sprache/en.json'));
  pruefe('E1 englisch', !!en['Seitdem'] && !!en['Ja, löschen'] && !!en['Vor Änderungen anderer'] && !!en['Löschen …'] && !!en['geändert {0}'], en['Seitdem']);
  pruefe('E2 die Hilfe nennt M460 – deutsch und englisch', lies2('src/components/HelpOverlay.tsx').includes('(M460)') && lies2('src/components/HelpOverlayEn.tsx').includes('(M460)'));
  pruefe('E3 keine Fehler in der Konsole', fehler.length === 0, fehler.join(' | ').slice(0, 300));
}

console.log(`\nm460-versionen-2: ${ok} bestanden, ${bad} fehlgeschlagen`);
await ctx.close();
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
