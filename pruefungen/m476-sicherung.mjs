/**
 * M476 — Einfache Sicherung: ein Board oder alles als EINE Datei (.pixinotes), wieder einspielbar.
 *
 *   A  Board-⋯ (Seitenleiste) → „Sicherung herunterladen": ZIP mit pixinotes.json, die PDF aus dem Gerätespeicher
 *      und das eingebettete Bild als echte Binärdaten, Kommentar, Strich und Vorlage im JSON, kein KI-Schlüssel.
 *   B  Neues Gerät (frischer Kontext): Einstellungen → „Sicherung einspielen…" → Vorschau (Zahlen) → als Kopie:
 *      Board, Notiz, Bild, PDF-Inhalt (Gerätespeicher), Kommentar und Strich an den NEUEN Karten, Vorlage.
 *   C  „Alles sichern": eine Datei mit allen Boards und Einstellungen, ohne KI-Schlüssel; der Hinweis sagt es.
 *   D  Ablegen aufs Board + „vorhandene ersetzen": vorher eine Version (M449), danach der Stand der Datei,
 *      „Rückgängig" im Hinweis nimmt das Einspielen zurück. Strg+K kennt die Befehle.
 *   E  Manipulierte Datei: ungültige Karten fallen weg, fremde Adressen und Token werden entschärft, fremde
 *      Einträge im Gerätespeicher werden nicht gesetzt; die Vorschau sagt, dass etwas weggelassen wurde.
 *   F  Portable Single-File (file://): Board sichern und in einem frischen Kontext einspielen.
 *   G  Automatisch in einen Ordner (File System Access, hier mit einem Ordner aus dem Origin-Speicher):
 *      eine Datei je Tag, die letzten 7 bleiben, fremde Dateien bleiben unberührt.
 *   H  Erinnerung nach 14 Tagen ohne Sicherung (page.clock): EIN ruhiger Hinweis mit „Jetzt sichern",
 *      danach nicht noch einmal; vor 14 Tagen keiner.
 */
// Läuft aus dem Repository: `node pruefungen/m476-sicherung.mjs` (braucht dist/; F zusätzlich release/pixinotes.html)
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SINGLE = process.env.PN_SINGLE ?? path.join(__repo, 'release', 'pixinotes.html');
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const PORT = 5476;
const TAG = 24 * 60 * 60 * 1000;
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

// ---------- ZIP lesen (in Node) ----------
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e -= 1;
  if (e < 0) throw new Error('kein ZIP');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    const meth = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28); const xl = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8'); const lo = buf.readUInt32LE(p + 42);
    const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const roh = buf.subarray(start, start + csize);
    out.set(name, meth === 8 ? inflateRawSync(roh) : Buffer.from(roh));
    p += 46 + nl + xl + cl;
  }
  return out;
}
// ---------- ZIP schreiben (für die manipulierte Datei) ----------
function crc32(b) { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function zip(eintraege) {
  const teile = []; const zentral = []; let pos = 0;
  for (const [name, daten0] of eintraege) {
    const daten = Buffer.isBuffer(daten0) ? daten0 : Buffer.from(daten0);
    const nb = Buffer.from(name); const crc = crc32(daten);
    const k = Buffer.alloc(30); k.writeUInt32LE(0x04034b50, 0); k.writeUInt16LE(20, 4); k.writeUInt32LE(crc, 14); k.writeUInt32LE(daten.length, 18); k.writeUInt32LE(daten.length, 22); k.writeUInt16LE(nb.length, 26);
    const z = Buffer.alloc(46); z.writeUInt32LE(0x02014b50, 0); z.writeUInt32LE(crc, 16); z.writeUInt32LE(daten.length, 20); z.writeUInt32LE(daten.length, 24); z.writeUInt16LE(nb.length, 28); z.writeUInt32LE(pos, 42);
    teile.push(k, nb, daten); zentral.push(z, nb); pos += 30 + nb.length + daten.length;
  }
  const zg = zentral.reduce((s, b) => s + b.length, 0);
  const ende = Buffer.alloc(22); ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(eintraege.length, 8); ende.writeUInt16LE(eintraege.length, 10); ende.writeUInt32LE(zg, 12); ende.writeUInt32LE(pos, 16);
  return Buffer.concat([...teile, ...zentral, ende]);
}

// ---------- Stand ----------
const PDF = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% M476-Testdatei ' + 'x'.repeat(3000) + '\n%%EOF';
// Ein „Bild" groß genug zum Auslagern (der Inhalt ist zufällig, das Format egal — gemessen wird die Rundreise)
const BILD = 'data:image/png;base64,' + Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 37 + 11) % 256)).toString('base64');
const GEHEIM = 'sk-geheim-M476-123456';
const notiz = (id, x, text) => ({ id, type: 'note', position: { x, y: 40 }, width: 260, height: 160, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] } });
const STAND = {
  boards: [
    { id: 'b1', name: 'Projektboard', edges: [],
      nodes: [notiz('n1', 40, 'Notiz eins'),
        { id: 'i1', type: 'image', position: { x: 360, y: 40 }, width: 200, height: 150, data: { src: BILD, alt: 'Testbild' } },
        { id: 'f1', type: 'file', position: { x: 600, y: 40 }, width: 240, height: 120, data: { name: 'Bericht.pdf', mime: 'application/pdf', size: PDF.length } }],
      drawings: [{ id: 's1', tool: 'pen', color: '#333', width: 3, anchor: 'n1', points: [[5, 5], [60, 40], [120, 20]] }],
      comments: [{ id: 'c1', nodeId: 'n1', msgs: [{ author: 'Ich', text: 'Kommentar zur Notiz', at: '2026-11-20T10:00:00Z' }] }] },
    { id: 'b2', name: 'Zweites', edges: [], drawings: [], comments: [], nodes: [notiz('n2', 40, 'Anderes Board')] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board', cardFocus: false, navLinks: true, clickZoom: false, physicsEnabled: false,
  templates: [{ id: 'v1', name: 'Besprechung', node: notiz('vn', 0, 'Vorlagen-Text') }],
  ai: { provider: 'openai', model: 'gpt-4o', apiKey: GEHEIM, baseUrl: '' },
};
const LEER = { boards: [{ id: 'bx', name: 'Leer', edges: [], drawings: [], nodes: [] }], spaces: [{ id: 'sx', name: 'Ich', projects: [{ id: 'px', name: 'P', boardIds: ['bx'] }] }], activeId: 'bx', view: 'board', cardFocus: false, navLinks: true };

async function profil(st, opt = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(([s, extra]) => {
    try { if (window !== window.top || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: true }));
    for (const [k, v] of Object.entries(extra ?? {})) localStorage.setItem(k, v);
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, [st, opt.ls ?? {}]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  const dialoge = [];
  P.on('dialog', (d) => { dialoge.push(d.message()); void d.accept(); });
  if (opt.uhr) await P.clock.install({ time: opt.uhr });
  await P.goto(opt.url ?? `http://localhost:${PORT}/`, { waitUntil: 'load' });
  await P.waitForSelector('.react-flow', { timeout: 20000 });
  await P.waitForTimeout(opt.warten ?? 2200);
  const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
  const idb = (fn, arg) => P.evaluate(([f, a]) => new Promise((gut, nein) => {
    const r = indexedDB.open('pixinotes-sync', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onerror = () => nein(r.error);
    // eslint-disable-next-line no-new-func
    r.onsuccess = () => new Function('db', 'arg', 'ok', f)(r.result, a, gut);
  }), [fn, arg]);
  const schluessel = () => idb("const q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => ok(q.result.map(String));");
  const textVon = (k) => idb("const q = db.transaction('kv').objectStore('kv').get(arg); q.onsuccess = async () => { const v = q.result; ok(v instanceof Blob ? await v.text() : v === undefined ? null : JSON.stringify(v)); };", k);
  const setze = (k, text, mime) => idb("const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(new Blob([arg[1]], { type: arg[2] }), arg[0]); tx.oncomplete = () => ok(true);", [k, text, mime]);
  const toast = () => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  const bis = async (f, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await P.waitForTimeout(200); } return null; };
  return { ctx, P, dialoge, zustand, idb, schluessel, textVon, setze, toast, bis };
}
const herunter = async (P, klick) => {
  const [d] = await Promise.all([P.waitForEvent('download', { timeout: 15000 }), klick()]);
  const ziel = path.join(SD, `m476-${d.suggestedFilename()}`);
  await d.saveAs(ziel);
  return { name: d.suggestedFilename(), pfad: ziel, inhalt: readFileSync(ziel) };
};
const datenReiter = async (P) => {
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal-tabs');
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
};
const suche = async (P, wort, befehl) => {
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-box', { state: 'visible' });
  await P.keyboard.type(wort); await P.waitForTimeout(350);
  await P.locator('.search-cmd', { hasText: befehl }).first().click(); await P.waitForTimeout(500);
};
/** Eine Datei aufs Board fallen lassen (wie Ziehen aus dem Explorer) */
const ablegen = (P, name, buf) => P.evaluate(([n, b64]) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], n));
  const ziel = document.querySelector('.react-flow');
  const r = ziel.getBoundingClientRect();
  for (const typ of ['dragenter', 'dragover', 'drop']) ziel.dispatchEvent(new DragEvent(typ, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 300 }));
}, [name, buf.toString('base64')]);
const vorschau = (P) => P.evaluate(() => { const z = document.querySelector('[data-taste="sicherung-zahlen"]'); return z ? { boards: Number(z.dataset.boards), karten: Number(z.dataset.karten), dateien: Number(z.dataset.dateien), text: z.textContent } : null; });

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\nA  Ein Board sichern (Board-⋯ in der Seitenleiste)');
let boardDatei;
{
  const h = await profil(STAND);
  await h.setze('file:f1', PDF, 'application/pdf');
  const zeile = h.P.locator('.side-board', { hasText: 'Projektboard' }).first();
  await zeile.locator('.ebenen-menu-knopf').click({ force: true }); await h.P.waitForTimeout(400);
  pruefe('A1 das Board-Menü bietet „Sicherung herunterladen"', (await h.P.locator('[data-taste="board-sicherung"]').count()) === 1);
  boardDatei = await herunter(h.P, () => h.P.locator('[data-taste="board-sicherung"]').click());
  pruefe('A2 Dateiname PixiNotes-<Board>-<Datum>.pixinotes', /^PixiNotes-Projektboard-\d{4}-\d{2}-\d{2}\.pixinotes$/.test(boardDatei.name), boardDatei.name);
  const z = unzip(boardDatei.inhalt);
  const m = JSON.parse(z.get('pixinotes.json').toString('utf8'));
  const b = m.boards?.[0];
  pruefe('A3 ein Board mit Notiz, Bild und Datei, dazu Kommentar, Strich und Vorlage', m.app === 'pixinotes-sicherung' && m.art === 'board' && m.boards.length === 1
    && ['n1', 'i1', 'f1'].every((id) => b.nodes.some((n) => n.id === id)) && b.comments?.[0]?.nodeId === 'n1' && b.drawings?.[0]?.anchor === 'n1' && m.templates?.[0]?.name === 'Besprechung', Object.keys(m));
  const pdf = m.anhaenge.find((a) => a.id === 'f1' && a.vorsilbe === 'file:');
  pruefe('A4 die PDF aus dem Gerätespeicher liegt als Binärdatei im ZIP (nicht als Base64)', !!pdf && z.get(pdf.pfad)?.toString('latin1') === PDF && pdf.mime === 'application/pdf', pdf);
  const bildStelle = b.nodes.find((n) => n.id === 'i1').data.src;
  const bild = m.bilder.find((x) => `pixinotes-zip:${x.pfad}` === bildStelle);
  pruefe('A5 das eingebettete Bild ist ausgelagert und kommt Byte für Byte zurück', !!bild && `${bild.kopf},${z.get(bild.pfad).toString('base64')}` === BILD, bildStelle?.slice(0, 40));
  pruefe('A6 kein KI-Schlüssel in der Datei', !boardDatei.inhalt.includes(GEHEIM));
  pruefe('A7 der Hinweis nennt Karten und Dateien', /Sicherung heruntergeladen: 3 Karten, 2 Dateien/.test(await h.toast()), await h.toast());
  await h.ctx.close();
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\nB  Auf einem frischen Gerät einspielen (als Kopie)');
{
  const h = await profil(LEER);
  await datenReiter(h.P);
  await h.P.locator('.modal input[type="file"][accept*="pixinotes"]').first().setInputFiles(boardDatei.pfad);
  await h.P.waitForSelector('[data-taste="sicherung-zahlen"]', { timeout: 8000 });
  const v = await vorschau(h.P);
  pruefe('B1 die Vorschau sagt, was drin ist: 1 Board, 3 Karten, 2 Dateien', v?.boards === 1 && v.karten === 3 && v.dateien === 2, v);
  pruefe('B2 Standard ist „als Kopie hinzufügen"', await h.P.locator('[data-taste="sicherung-kopie"]').isChecked());
  await h.P.locator('[data-taste="sicherung-einspielen"]').click(); await h.P.waitForTimeout(1500);
  const s = await h.zustand();
  const b = s.boards.find((x) => x.name === 'Projektboard');
  const note = b?.nodes.find((n) => n.type === 'note'); const img = b?.nodes.find((n) => n.type === 'image'); const datei = b?.nodes.find((n) => n.type === 'file');
  pruefe('B3 das Board ist da, mit frischen Kennungen', !!b && b.id !== 'b1' && b.nodes.length === 3 && !b.nodes.some((n) => ['n1', 'i1', 'f1'].includes(n.id)), b?.nodes.map((n) => n.id));
  pruefe('B4 das Bild ist wieder eingebettet (gleicher Inhalt)', img?.data.src === BILD);
  pruefe('B5 Kommentar und Strich hängen an der NEUEN Notiz', b?.comments?.[0]?.nodeId === note?.id && b?.drawings?.[0]?.anchor === note?.id && /Kommentar zur Notiz/.test(JSON.stringify(b?.comments)), [b?.comments, b?.drawings?.map((d) => d.anchor)]);
  pruefe('B6 der Inhalt der PDF liegt im Gerätespeicher unter der neuen Datei-Karte', (await h.textVon(`file:${datei?.id}`)) === PDF);
  pruefe('B7 die Vorlage ist mitgekommen', s.templates?.some((t) => t.name === 'Besprechung'), s.templates);
  pruefe('B8 das alte Board bleibt (nichts ersetzt)', s.boards.some((x) => x.id === 'bx'));
  pruefe('B9 der Hinweis bietet „Rückgängig"', (await h.P.locator('[data-taste="hinweis-knopf"]').count()) === 1 && /als Kopie hinzugefügt/.test(await h.toast()), await h.toast());
  await h.P.screenshot({ path: `${SD}/m476-eingespielt.png` });
  await h.ctx.close();
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\nC  Alles sichern');
let allesDatei;
{
  const h = await profil(STAND);
  await h.setze('file:f1', PDF, 'application/pdf');
  await datenReiter(h.P);
  pruefe('C0 vorher: „Noch keine Sicherung"', /Noch keine Sicherung/.test(await h.P.locator('[data-taste="letzte-sicherung"]').textContent()));
  allesDatei = await herunter(h.P, () => h.P.locator('[data-taste="alles-sichern"]').click());
  pruefe('C1 Dateiname PixiNotes-Alles-<Datum>.pixinotes', /^PixiNotes-Alles-\d{4}-\d{2}-\d{2}\.pixinotes$/.test(allesDatei.name), allesDatei.name);
  const m = JSON.parse(unzip(allesDatei.inhalt).get('pixinotes.json').toString('utf8'));
  pruefe('C2 beide Boards, Bereich, Vorlage und Einstellungen', m.art === 'alles' && m.boards.length === 2 && m.spaces?.[0]?.projects?.[0]?.boardIds?.length === 2 && m.templates.length === 1 && !!m.einstellungen, [m.boards.length, m.spaces, !!m.einstellungen]);
  pruefe('C3 KEIN KI-Schlüssel – und die Datei sagt, was fehlt', !allesDatei.inhalt.includes(GEHEIM) && !('ai' in m) && m.ohne.some((x) => /KI-Schlüssel/.test(x)), m.ohne);
  await h.P.waitForTimeout(300);
  pruefe('C4 der Hinweis sagt es auch', /nicht enthalten/.test(await h.toast()), await h.toast());
  pruefe('C5 „Letzte Sicherung" steht danach in den Einstellungen', /Letzte Sicherung: .*heute/.test(await h.P.locator('[data-taste="letzte-sicherung"]').textContent()), await h.P.locator('[data-taste="letzte-sicherung"]').textContent());
  await h.ctx.close();
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\nD  Ablegen + vorhandene ersetzen, Version, Rückgängig');
{
  const h = await profil(STAND);
  await h.setze('file:f1', PDF, 'application/pdf');
  // Karte n1 löschen — die Sicherung hat sie noch
  await h.P.locator('.react-flow__node[data-id="n1"] .card-grip').click({ force: true }); await h.P.waitForTimeout(250);
  await h.P.keyboard.press('Delete'); await h.P.waitForTimeout(600);
  const nodes = async () => ((await h.zustand()).boards.find((b) => b.id === 'b1')?.nodes ?? []).map((n) => n.id).sort().join(',');
  pruefe('D0 n1 ist gelöscht', (await nodes()) === 'f1,i1', await nodes());
  await h.P.mouse.click(1300, 820); await h.P.waitForTimeout(200);
  await ablegen(h.P, boardDatei.name, boardDatei.inhalt);
  await h.P.waitForSelector('[data-taste="sicherung-zahlen"]', { timeout: 8000 });
  pruefe('D1 Ablegen öffnet die Vorschau (keine Datei-Karte)', (await h.zustand()).boards.find((b) => b.id === 'b1').nodes.length === 2);
  await h.P.locator('[data-taste="sicherung-ersetzen"]').check();
  pruefe('D2 „Ersetzen" sagt, dass der Stand davor unter Versionen liegt', /unter Versionen/.test(await h.P.locator('.sicherung-wahl').textContent()));
  await h.P.locator('[data-taste="sicherung-einspielen"]').click(); await h.P.waitForTimeout(1500);
  pruefe('D3 n1 ist zurück, mit den alten Kennungen', (await nodes()) === 'f1,i1,n1', await nodes());
  pruefe('D4 das andere Board bleibt unverändert', (await h.zustand()).boards.find((b) => b.id === 'b2')?.nodes?.[0]?.id === 'n2');
  const ix = await h.textVon('ver-ix:b1');
  pruefe('D5 vorher wurde eine Version „Vor Import" mit 2 Karten gesichert', !!ix && JSON.parse(ix).some((v) => v.grund === 'import' && v.karten === 2), ix);
  pruefe('D6 sichtbar: die Notiz ist auf der Fläche', (await h.P.locator('.react-flow__node[data-id="n1"]').count()) === 1);
  await h.P.locator('[data-taste="hinweis-knopf"]').click(); await h.P.waitForTimeout(1000);
  pruefe('D7 „Rückgängig" nimmt das Einspielen zurück (n1 wieder weg)', (await nodes()) === 'f1,i1', await nodes());
  pruefe('D8 … und sagt es', /zurückgenommen/.test(await h.toast()), await h.toast());
  // Strg+K
  await h.P.keyboard.press('Control+k'); await h.P.waitForSelector('.search-box'); await h.P.keyboard.type('sicherung'); await h.P.waitForTimeout(400);
  const cmds = await h.P.evaluate(() => [...document.querySelectorAll('.search-cmd')].map((e) => e.textContent));
  pruefe('D9 Strg+K kennt „Alles sichern", „Sicherung dieses Boards" und „Sicherung einspielen"', ['Alles sichern', 'Sicherung dieses Boards', 'Sicherung einspielen'].every((w) => cmds.some((c) => c.includes(w))), cmds);
  await h.P.keyboard.press('Escape'); await h.P.waitForTimeout(300);
  await suche(h.P, 'sicherung einspielen', 'Sicherung einspielen');
  pruefe('D10 „Sicherung einspielen" öffnet den Dialog mit Dateiwahl', (await h.P.locator('[data-taste="sicherung-dialog"]').count()) === 1 && (await h.P.locator('[data-taste="sicherung-dialog"] button', { hasText: 'Datei wählen' }).count()) === 1);
  await h.P.keyboard.press('Escape'); await h.P.waitForTimeout(300);
  pruefe('D11 keine Browser-Rückfrage auf dem ganzen Weg', h.dialoge.length === 0, h.dialoge);
  await h.ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\nE  Manipulierte Datei');
{
  const boese = {
    app: 'pixinotes-sicherung', version: 1, art: 'board', savedAt: '2026-11-01T10:00:00Z',
    boards: [{ id: 'z1', name: 'Fremd', gastLink: 'geheim-token', geteiltVon: 'u-opfer', edges: [], drawings: [],
      nodes: [
        notiz('ok1', 0, 'Bleibt'),
        { id: 'kaputt', type: 'note', data: {} },
        { id: 'web', type: 'htmlapp', position: { x: 300, y: 0 }, data: { name: 'x', url: 'javascript:alert(1)', live: true } },
        { id: 'bild', type: 'image', position: { x: 600, y: 0 }, data: { src: 'javascript:alert(2)' } },
      ] }],
    templates: [], spaces: [],
    anhaenge: [
      { id: 'fremd', vorsilbe: 'file:', pfad: 'anhaenge/0', typ: 'blob' },
      { id: 'ok1', vorsilbe: 'boese:', pfad: 'anhaenge/0', typ: 'blob' },
      { id: 'ok1', vorsilbe: 'file:', pfad: '../../etc/passwd', typ: 'blob' },
    ],
    bilder: [{ pfad: '../x', kopf: 'javascript:alert(3)' }],
  };
  const datei = zip([['pixinotes.json', JSON.stringify(boese)], ['anhaenge/0', 'untergeschoben']]);
  const h = await profil(LEER);
  await ablegen(h.P, 'Fremd.pixinotes', datei);
  await h.P.waitForSelector('[data-taste="sicherung-zahlen"]', { timeout: 8000 });
  const weg = Number(await h.P.locator('[data-taste="sicherung-entschaerft"]').getAttribute('data-anzahl').catch(() => '0'));
  pruefe('E1 die Vorschau sagt, dass Ungültiges weggelassen wurde', weg >= 2, weg);
  await h.P.locator('[data-taste="sicherung-einspielen"]').click(); await h.P.waitForTimeout(1200);
  const b = (await h.zustand()).boards.find((x) => x.name === 'Fremd');
  pruefe('E2 die ungültige Karte fehlt, die gültigen sind da', !!b && b.nodes.length === 3 && !JSON.stringify(b.nodes).includes('"kaputt"'), b?.nodes?.map((n) => n.type));
  pruefe('E3 fremde Adressen sind entschärft', !JSON.stringify(b?.nodes ?? []).includes('javascript:'));
  pruefe('E4 Token und Besitzer sind nicht übernommen', !b?.gastLink && !b?.geteiltVon, [b?.gastLink, b?.geteiltVon]);
  const keys = await h.schluessel();
  pruefe('E5 kein fremder Eintrag im Gerätespeicher', !keys.some((k) => k.includes('fremd') || k.startsWith('boese:')) && !keys.some((k) => k.startsWith('file:')), keys);
  const kaputt = zip([['pixinotes.json', '{ kein json']]);
  await ablegen(h.P, 'Kaputt.pixinotes', kaputt); await h.P.waitForTimeout(1200);
  pruefe('E6 eine kaputte Datei sagt es klar und ändert nichts', (await h.P.locator('[data-taste="sicherung-fehler"]').count()) === 1);
  await h.ctx.close();
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\nF  Portable Single-File (file://)');
if (!existsSync(SINGLE)) {
  pruefe('F0 release/pixinotes.html ist gebaut (npm run build:single)', false, SINGLE);
} else {
  const url = pathToFileURL(SINGLE).href;
  const h = await profil(STAND, { url, warten: 3000 });
  await h.setze('file:f1', PDF, 'application/pdf');
  const d = await herunter(h.P, () => suche(h.P, 'sicherung dieses', 'Sicherung dieses Boards'));
  pruefe('F1 file://: Board-Sicherung wird heruntergeladen', /\.pixinotes$/.test(d.name) && unzip(d.inhalt).has('pixinotes.json'), d.name);
  await h.ctx.close();
  const h2 = await profil(LEER, { url, warten: 3000 });
  await suche(h2.P, 'sicherung einspielen', 'Sicherung einspielen');
  await h2.P.locator('[data-taste="sicherung-datei"]').setInputFiles(d.pfad);
  await h2.P.waitForSelector('[data-taste="sicherung-einspielen"]', { timeout: 8000 });
  await h2.P.locator('[data-taste="sicherung-einspielen"]').click(); await h2.P.waitForTimeout(1500);
  const b = (await h2.zustand()).boards.find((x) => x.name === 'Projektboard');
  const datei = b?.nodes.find((n) => n.type === 'file');
  pruefe('F2 file://: eingespielt, samt PDF-Inhalt', !!b && b.nodes.length === 3 && (await h2.textVon(`file:${datei?.id}`)) === PDF, b?.nodes?.length);
  await h2.ctx.close();
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\nG  Automatisch in einen Ordner');
{
  // Der „gewählte Ordner" ist ein Ordner aus dem Origin-Speicher — dieselbe File-System-Access-Schnittstelle
  // (getFileHandle, createWritable, entries, removeEntry), aber ohne nativen Dialog. Zurückgelesen aus IndexedDB
  // wird er hier nicht: Chromium beendet beim Zurücklesen eines solchen Handles nach einem Neuladen den Prozess.
  const T0 = Date.parse('2026-11-23T09:00:00');
  const h = await profil(STAND, { uhr: T0 });
  await h.P.evaluate(async () => {
    const wurzel = await navigator.storage.getDirectory();
    const dir = await wurzel.getDirectoryHandle('Sicherungen', { create: true });
    for (const n of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
      const w = await (await dir.getFileHandle(`PixiNotes-Alles-${n}.pixinotes`, { create: true })).createWritable(); await w.write('alt'); await w.close();
    }
    const w = await (await dir.getFileHandle('andere.txt', { create: true })).createWritable(); await w.write('fremd'); await w.close();
    window.showDirectoryPicker = async () => dir;
  });
  const liste = async () => h.P.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Sicherungen');
    const out = []; for await (const [n] of dir.entries()) out.push(n); return out.sort();
  });
  await datenReiter(h.P);
  pruefe('G0 Einstellungen bieten „Automatisch sichern" (aus)', (await h.P.locator('[data-taste="auto-sicherung"]').count()) === 1 && !(await h.P.locator('[data-taste="auto-sicherung"]').isChecked()));
  await h.P.locator('[data-taste="auto-sicherung"]').click();
  const HEUTE = 'PixiNotes-Alles-2026-11-23.pixinotes';
  const l1 = await h.bis(async () => { const x = await liste(); return x.includes(HEUTE) ? x : null; }, 10000);
  pruefe('G1 Einschalten: Ordner gewählt, die erste Sicherung liegt sofort darin', !!l1, await liste());
  // M484: Die Datei steht im Ordner, sobald sie angelegt ist; Inhalt und das Aufräumen der alten folgen danach. Unter
  // Last lasen G2/G4 zu früh (8 Dateien bzw. leere Datei) — auf den fertigen Zustand warten, höchstens 10 s.
  const groesse = (n) => h.P.evaluate(async (n) => { try { return (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle('Sicherungen')).getFileHandle(n)).getFile()).size; } catch { return 0; } }, n);
  const l = (await h.bis(async () => { const x = await liste(); return x.filter((n) => /^PixiNotes-Alles-/.test(n)).length <= 7 && (await groesse(HEUTE)) > 0 ? x : null; }, 10000)) ?? (await liste());
  const auto = l.filter((n) => /^PixiNotes-Alles-/.test(n));
  pruefe('G2 die letzten 7 bleiben, ältere sind weg', auto.length === 7 && !auto.includes('PixiNotes-Alles-2026-10-01.pixinotes') && !auto.includes('PixiNotes-Alles-2026-10-02.pixinotes'), auto);
  pruefe('G3 fremde Dateien im Ordner bleiben unberührt', (l ?? []).includes('andere.txt'));
  const inhalt = await h.P.evaluate(async (n) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('Sicherungen');
    const b = new Uint8Array(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer());
    let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s);
  }, HEUTE);
  const roh = Buffer.from(inhalt, 'base64');
  const m = JSON.parse(unzip(roh).get('pixinotes.json').toString('utf8'));
  pruefe('G4 die Datei ist eine vollständige Sicherung ohne Schlüssel', m.art === 'alles' && m.boards.length === 2 && !roh.includes(GEHEIM));
  pruefe('G5 „Letzte Sicherung" ist gestempelt', !!(await h.P.evaluate(() => localStorage.getItem('pixinotes:letzte-sicherung'))));
  pruefe('G6 der Haken bleibt an und nennt den Ordner', await h.P.locator('[data-taste="auto-sicherung"]').isChecked() && /Sicherungen/.test(await h.P.locator('.modal').textContent()));
  await h.P.keyboard.press('Escape'); await h.P.waitForTimeout(300);
  const verdeckt = () => h.P.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await verdeckt(); await h.P.waitForTimeout(1500);
  pruefe('G7 Fenster verdeckt am selben Tag: keine zweite Sicherung', (await liste()).filter((n) => /^PixiNotes-Alles-/.test(n)).length === 7 && !(await liste()).includes('PixiNotes-Alles-2026-11-24.pixinotes'), await liste());
  await h.P.clock.fastForward('25:00:00');
  await verdeckt();
  const l2 = await h.bis(async () => { const x = await liste(); return x.includes('PixiNotes-Alles-2026-11-24.pixinotes') && x.filter((n) => /^PixiNotes-Alles-/.test(n)).length <= 7 ? x : null; }, 10000);   // M484: erst nach dem Aufräumen
  pruefe('G8 einen Tag später beim Verdecken/Schließen: die nächste Sicherung, wieder höchstens 7', !!l2 && l2.filter((n) => /^PixiNotes-Alles-/.test(n)).length === 7 && l2.includes(HEUTE), await liste());
  await h.ctx.close();
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\nH  Erinnerung nach 14 Tagen');
{
  const jetzt = Date.now();
  const seit = new Date(jetzt - 3 * TAG).toISOString();
  const h0 = await profil(STAND, { ls: { 'pixinotes:sicherung-seit': seit } });
  await h0.P.waitForTimeout(6500);
  pruefe('H0 nach 3 Tagen: kein Hinweis', !(await h0.P.locator('[data-taste="hinweis-knopf"]').count()), await h0.toast());
  await h0.ctx.close();
  const h = await profil(STAND, { ls: { 'pixinotes:sicherung-seit': seit }, uhr: jetzt + 15 * TAG });
  const knopf = await h.bis(async () => ((await h.P.locator('[data-taste="hinweis-knopf"]').count()) ? true : null), 12000);
  pruefe('H1 15 Tage später: ein ruhiger Hinweis mit „Jetzt sichern"', !!knopf && /Noch keine Sicherung/.test(await h.toast()) && /Jetzt sichern/.test(await h.toast()), await h.toast());
  const d = await herunter(h.P, () => h.P.locator('[data-taste="hinweis-knopf"]').click());
  pruefe('H2 „Jetzt sichern" lädt die Sicherung von allem herunter', /^PixiNotes-Alles-/.test(d.name), d.name);
  await h.P.reload({ waitUntil: 'load' }); await h.P.waitForTimeout(8000);
  pruefe('H3 nach der Sicherung kein neuer Hinweis', !(await h.P.locator('[data-taste="hinweis-knopf"]').count()), await h.toast());
  await h.ctx.close();
  // Hinweis, aber ohne zu sichern: kommt nur EINMAL
  const h2 = await profil(STAND, { ls: { 'pixinotes:sicherung-seit': seit }, uhr: jetzt + 15 * TAG });
  await h2.bis(async () => ((await h2.P.locator('[data-taste="hinweis-knopf"]').count()) ? true : null), 12000);
  await h2.P.reload({ waitUntil: 'load' }); await h2.P.waitForTimeout(8000);
  pruefe('H4 einmal erinnert = nicht bei jedem Start wieder', !(await h2.P.locator('[data-taste="hinweis-knopf"]').count()), await h2.toast());
  await h2.ctx.close();
}

// ══ Z ═══════════════════════════════════════════════════════════════
{
  const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  pruefe('Z1 englisch: Menü, Einstellungen, Dialog', ['Sicherung herunterladen', 'Alles sichern', 'Sicherung einspielen…', 'Sicherung einspielen', 'Als Kopie hinzufügen', 'Vorhandene ersetzen', 'Einspielen', 'Jetzt sichern'].every((k) => !!en[k]),
    ['Sicherung herunterladen', 'Alles sichern', 'Sicherung einspielen…', 'Sicherung einspielen', 'Als Kopie hinzufügen', 'Vorhandene ersetzen', 'Einspielen', 'Jetzt sichern'].filter((k) => !en[k]));
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('Z2 Hilfe DE und EN erklären die Sicherung', /\.pixinotes/.test(hilfe) && /M476/.test(hilfe) && /\.pixinotes/.test(hilfeEn), '');
  pruefe('Z3 keine Seitenfehler', fehler.length === 0, fehler);
}

await browser.close();
app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
