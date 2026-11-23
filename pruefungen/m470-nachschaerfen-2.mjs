/**
 * M470 — Nachschärfen Runde 2 (offene Punkte aus M460 und M463).
 *
 *   A  Versionen: in „Seitdem" stehen jetzt auch gelöschte/geänderte Verbindungen und Striche; mehrere Karten,
 *      eine Verbindung und Striche lassen sich anhaken und mit „Auswahl zurückholen" in EINEM Schritt holen
 *      (ein Strg+Z nimmt alles zurück). Eine Verbindung geht nur, wenn beide Karten da sind oder mit zurückkommen;
 *      ein Strich an einer gelöschten Karte ebenso. Einzeln zurückholen geht auch für Verbindungen.
 *   B  Kanban: jedes Ticket merkt sich, seit wann es in seiner Spalte steht – gesetzt beim Spaltenwechsel, nicht
 *      beim Bearbeiten; Strg+Z stellt es mit zurück. Im Ticket steht leise „seit 3 Tagen in „In Arbeit"". Das
 *      Briefing nennt nur das Ticket, das wirklich lange in der Spalte steht – nicht das frisch dorthin gezogene,
 *      obwohl die Kanban-Karte gerade geändert wurde (Uhr per page.clock).
 *   C  Sync-Eingang (Ordner): ein von außen kommender Stempel bleibt, wie er kam (nicht neu gestempelt); ein Stempel
 *      aus der Zukunft fällt weg (lib/sicher.ts).
 *   D  Texte (englisch), keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m470-nachschaerfen-2.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5470;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
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
const TAG = 86_400_000;

const text = (t) => [{ type: 'paragraph', content: [{ type: 'text', text: t, styles: {} }] }];
const notiz = (id, i, t) => ({ id, type: 'note', position: { x: (i % 3) * 300, y: Math.floor(i / 3) * 230 }, width: 260, height: 170, autoFit: false, data: { color: 'yellow', blocks: text(t) } });

/** Sync-Ordner im Node-Prozess (wie m460) – der Test spielt „das andere Gerät" */
const ordner = new Map();
const HAUPT = 'pixinotes-daten.json';
const lies = (name) => { const e = ordner.get(name); return e ? JSON.parse(e.text) : null; };
const schreib = (name, obj) => ordner.set(name, { text: JSON.stringify(obj), lastModified: Date.now() });

async function neueSeite(state, { uhr } = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  await ctx.exposeFunction('__fsLesen', (n) => ordner.get(n) ?? null);
  await ctx.exposeFunction('__fsSchreiben', (n, t) => { ordner.set(n, { text: t, lastModified: Date.now() }); });
  await ctx.exposeFunction('__fsListe', () => [...ordner.keys()]);
  await ctx.exposeFunction('__fsEntfernen', (n) => { ordner.delete(n); });
  await ctx.addInitScript((st) => {
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
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, state);
  const P = await ctx.newPage();
  if (uhr) await P.clock.install({ time: uhr });
  P.on('pageerror', (e) => fehler.push(e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(2500);
  return { ctx, P };
}
const rahmen = (board) => ({
  boards: [board], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: [board.id] }] }],
  activeId: board.id, view: 'board', cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
  ai: { provider: 'none', model: '', apiKey: '', baseUrl: '' },
});
const boardVon = async (P, id = 'b1') => P.evaluate((i) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === i), id);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const idb = (P, fn, arg) => P.evaluate(([f, a]) => new Promise((ok, nein) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => nein(r.error);
  // eslint-disable-next-line no-new-func
  r.onsuccess = () => new Function('db', 'arg', 'ok', f)(r.result, a, ok);
}), [fn, arg]);

// ---------- A: Versionen ----------
console.log('A  Versionen: Auswahl, Verbindungen und Striche zurückholen');
{
  // Damals: fünf Karten, drei Verbindungen, drei Striche. Jetzt: n2 und n3 weg (mit e12), e14 weg, e45 umbenannt,
  // s1 weg, s2 umgefärbt, s3 (an n3) weg.
  const damals = {
    nodes: [notiz('n1', 0, 'Eins'), notiz('n2', 1, 'Zwei weg'), notiz('n3', 2, 'Drei weg'), notiz('n4', 3, 'Vier'), notiz('n5', 4, 'Fünf')],
    edges: [
      { id: 'e12', source: 'n1', target: 'n2', type: 'labeled', data: { label: 'zu zwei', kind: 'arrow' } },
      { id: 'e14', source: 'n1', target: 'n4', type: 'labeled', data: { label: 'zu vier', kind: 'arrow' } },
      { id: 'e45', source: 'n4', target: 'n5', type: 'labeled', data: { label: 'alt', kind: 'arrow' } },
    ],
    drawings: [
      { id: 's1', tool: 'pen', color: '#b42318', width: 3, points: [[100, 600], [300, 700]] },
      { id: 's2', tool: 'marker', color: '#b42318', width: 12, points: [[10, 10], [120, 40]], anchor: 'n4' },
      { id: 's3', tool: 'pen', color: '#1d4ed8', width: 3, points: [[10, 10], [80, 80]], anchor: 'n3' },
    ],
  };
  const jetzt = {
    id: 'b1', name: 'Team', comments: [],
    nodes: [damals.nodes[0], damals.nodes[3], damals.nodes[4]],
    edges: [{ ...damals.edges[2], data: { label: 'neu', kind: 'arrow' } }],
    drawings: [{ ...damals.drawings[1], color: '#1d4ed8' }],
  };
  const { ctx, P } = await neueSeite(rahmen(jetzt));
  const AT = Date.now() - 3600_000;
  await idb(P, `const tx = db.transaction('kv', 'readwrite'); const s = tx.objectStore('kv');
    s.put(arg.stand, 'ver:b1-alt'); s.put([arg.info], 'ver-ix:b1'); tx.oncomplete = () => ok(true);`,
  { stand: damals, info: { id: 'b1-alt', boardId: 'b1', at: AT, grund: 'manuell', name: 'Team', karten: 5, pfeile: 3, sig: 'alt', bytes: 2000, blobs: [], anhaenge: [] } });
  const dialogAuf = async () => {
    await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(300);
    await P.locator('[data-taste="dock-versionen"]').click(); await P.waitForTimeout(900);
  };
  const zeilen = () => P.evaluate(() => [...document.querySelectorAll('.versionen-vergleich li')].map((e) => ({
    taste: e.dataset.taste, art: e.dataset.art, id: e.dataset.id, geht: e.dataset.geht, text: e.textContent,
    haken: !!e.querySelector('[data-taste="vergleich-wahl"]'), hakenAus: !!e.querySelector('[data-taste="vergleich-wahl"]:disabled'),
  })));
  const haken = (id) => P.locator(`.versionen-vergleich li[data-id="${id}"] [data-taste="vergleich-wahl"]`);
  await dialogAuf();
  await P.locator('[data-taste="version"]').first().click(); await P.waitForTimeout(700);
  let z = await zeilen();
  const von = (taste, art) => z.filter((x) => x.taste === taste && x.art === art).map((x) => x.id).sort().join(',');
  pruefe('A1 gelöschte Karten n2, n3 mit Häkchen', von('vergleich-karte', 'geloescht') === 'n2,n3' && z.filter((x) => x.taste === 'vergleich-karte').every((x) => x.haken), z);
  pruefe('A2 Verbindungen: e12, e14 gelöscht, e45 geändert – mit Kartennamen', von('vergleich-pfeil', 'geloescht') === 'e12,e14' && von('vergleich-pfeil', 'geaendert') === 'e45'
    && /Eins → Vier/.test(z.find((x) => x.id === 'e14')?.text ?? ''), z);
  pruefe('A3 Striche: s1, s3 gelöscht, s2 geändert', von('vergleich-strich', 'geloescht') === 's1,s3' && von('vergleich-strich', 'geaendert') === 's2', z);
  pruefe('A4 e12 (Ende n2 fehlt) und s3 (Karte n3 fehlt) sind vorerst nicht wählbar, e14 schon',
    z.find((x) => x.id === 'e12')?.geht === '0' && z.find((x) => x.id === 'e12')?.hakenAus && z.find((x) => x.id === 's3')?.geht === '0' && z.find((x) => x.id === 'e14')?.geht === '1', z);
  pruefe('A5 auch einzeln: „Zurückholen" bei e12 gesperrt', await P.locator('.versionen-vergleich li[data-id="e12"] [data-taste="pfeil-zurueckholen"]').isDisabled());

  await haken('n2').check(); await haken('n3').check(); await P.waitForTimeout(200);
  z = await zeilen();
  pruefe('A6 mit n2 und n3 angehakt werden e12 und s3 wählbar', z.find((x) => x.id === 'e12')?.geht === '1' && z.find((x) => x.id === 's3')?.geht === '1', z);
  for (const id of ['e12', 'e45', 's1', 's2', 's3']) await haken(id).check();
  await P.waitForTimeout(200);
  const knopf = P.locator('[data-taste="auswahl-zurueckholen"]');
  pruefe('A7 „Auswahl zurückholen (7)"', (await knopf.getAttribute('data-anzahl')) === '7' && /Auswahl zurückholen \(7\)/.test(await knopf.innerText()), await knopf.innerText().catch(() => ''));
  await knopf.click(); await P.waitForTimeout(800);
  let b = await boardVon(P);
  const ids = (l) => l.map((x) => x.id).sort().join(',');
  pruefe('A8 Karten n2, n3 zurück', ids(b.nodes) === 'n1,n2,n3,n4,n5', ids(b.nodes));
  pruefe('A9 Verbindungen: e12 (genau einmal) zurück, e45 wieder „alt", e14 bleibt weg', ids(b.edges) === 'e12,e45' && b.edges.find((e) => e.id === 'e45')?.data?.label === 'alt', b.edges);
  pruefe('A10 Striche: s1 und s3 zurück, s2 wieder rot', ids(b.drawings) === 's1,s2,s3' && b.drawings.find((s) => s.id === 's2')?.color === '#b42318', b.drawings);
  pruefe('A11 der Hinweis zählt Karten, Verbindungen, Striche und nennt Strg+Z', /2 Karten/.test(await toast(P)) && /Verbindung/.test(await toast(P)) && /3 Striche/.test(await toast(P)) && /Strg\+Z/.test(await toast(P)), await toast(P));
  z = await zeilen();
  pruefe('A12 in „Seitdem" bleibt nur e14 (und nichts ist mehr angehakt)', z.length === 1 && z[0].id === 'e14' && (await P.locator('[data-taste="auswahl-zurueckholen"]').count()) === 0, z);

  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.keyboard.press('Control+z'); await P.waitForTimeout(800);
  b = await boardVon(P);
  pruefe('A13 EIN Strg+Z nimmt alles zurück', ids(b.nodes) === 'n1,n4,n5' && ids(b.edges) === 'e45' && b.edges[0]?.data?.label === 'neu' && ids(b.drawings) === 's2' && b.drawings[0]?.color === '#1d4ed8', [ids(b.nodes), b.edges, b.drawings]);
  await P.keyboard.press('Control+y'); await P.waitForTimeout(800);
  b = await boardVon(P);
  pruefe('A14 Strg+Y holt alles wieder', ids(b.nodes) === 'n1,n2,n3,n4,n5' && ids(b.drawings) === 's1,s2,s3', [ids(b.nodes), ids(b.drawings)]);

  await dialogAuf();
  // Inzwischen gibt es auch den Stand „vor der ersten Änderung" – gewählt wird der alte von Hand gesicherte
  await P.locator('[data-taste="version"][data-grund="manuell"]').click(); await P.waitForTimeout(700);
  await P.locator('.versionen-vergleich li[data-id="e14"] [data-taste="pfeil-zurueckholen"]').click(); await P.waitForTimeout(700);
  b = await boardVon(P);
  pruefe('A15 einzelne Verbindung zurückholen: e14 ist da', b.edges.some((e) => e.id === 'e14' && e.source === 'n1' && e.target === 'n4'), b.edges);
  pruefe('A16 … und die Liste ist leer', (await zeilen()).length === 0);
  await P.screenshot({ path: '/tmp/m470-a.png' }).catch(() => {});
  await ctx.close();
}

// ---------- B: Ticket-Spaltenzeit ----------
const T0 = Date.parse('2026-11-02T09:00:00+01:00');
console.log('B  Kanban: seit wann ein Ticket in seiner Spalte steht');
let B = null;
{
  const ALT = T0 - 20 * TAG;
  const kanban = { id: 'k1', type: 'kanban', position: { x: 40, y: 40 }, width: 640, angelegt: ALT, geaendert: ALT, data: { title: 'Umbau', cols: ['Offen', 'In Arbeit', 'Erledigt'], items: [
    { id: 't1', text: 'Statik prüfen', col: 1, spalteSeit: ALT },
    { id: 't2', text: 'Bauantrag stellen', col: 0 },
    { id: 't3', text: 'Fassade wählen', col: 0 },
  ] } };
  B = await neueSeite(rahmen({ id: 'b1', name: 'Bau', comments: [], drawings: [], edges: [], nodes: [kanban] }), { uhr: T0 });
  const { P } = B;
  const tickets = async () => Object.fromEntries(((await boardVon(P)).nodes.find((n) => n.id === 'k1')?.data?.items ?? []).map((it) => [it.id, it]));
  const nahe = (a, b, ms = 120_000) => typeof a === 'number' && Math.abs(a - b) <= ms;
  const oeffne = async (id) => { await P.locator(`.kanban-item[data-kid="${id}"] .kanban-item-text`).click(); await P.waitForTimeout(400); };
  const zu = async () => { await P.keyboard.press('Escape'); await P.waitForTimeout(300); await P.evaluate(() => document.activeElement?.blur?.()); };

  await oeffne('t2');
  await P.locator('.ticket-modal .ticket-colsel').selectOption('1'); await P.waitForTimeout(600);
  await zu();
  let t = await tickets();
  pruefe('B1 Spaltenwechsel stempelt das Ticket (jetzt)', t.t2?.col === 1 && nahe(t.t2?.spalteSeit, T0), t.t2);
  pruefe('B2 die anderen Tickets behalten ihren Stand (t1 alt, t3 ohne)', t.t1?.spalteSeit === ALT && t.t3?.spalteSeit === undefined, [t.t1, t.t3]);
  const k = (await boardVon(P)).nodes.find((n) => n.id === 'k1');
  pruefe('B3 die Kanban-Karte selbst gilt als gerade geändert (M453)', nahe(k.geaendert, T0), k.geaendert);

  await P.keyboard.press('Control+z'); await P.waitForTimeout(700);
  t = await tickets();
  pruefe('B4 Strg+Z: t2 wieder in „Offen" und ohne Stempel', t.t2?.col === 0 && t.t2?.spalteSeit === undefined, t.t2);
  await P.keyboard.press('Control+y'); await P.waitForTimeout(700);
  t = await tickets();
  pruefe('B5 Strg+Y: Spalte und Stempel wieder da', t.t2?.col === 1 && nahe(t.t2?.spalteSeit, T0), t.t2);
  const stempel2 = t.t2?.spalteSeit;

  await P.clock.fastForward(3 * TAG);
  await oeffne('t2');
  await P.locator('.ticket-modal .ticket-title').fill('Bauantrag stellen (Entwurf)'); await P.waitForTimeout(600);
  await P.locator('.ticket-modal input[placeholder="Person"]').fill('Anna'); await P.waitForTimeout(600);
  const zeile = await P.locator('.ticket-modal [data-taste="ticket-spaltenzeit"]').innerText().catch(() => '');
  await zu();
  t = await tickets();
  pruefe('B6 Bearbeiten (Titel, Person) stempelt NICHT neu', t.t2?.text === 'Bauantrag stellen (Entwurf)' && t.t2?.who === 'Anna' && t.t2?.spalteSeit === stempel2, t.t2);
  pruefe('B7 im Ticket steht leise „seit 3 Tagen in „In Arbeit""', zeile === 'seit 3 Tagen in „In Arbeit“', zeile);
  await oeffne('t1');
  const zeile1 = await P.locator('.ticket-modal [data-taste="ticket-spaltenzeit"]').innerText().catch(() => '');
  const tipp = await P.locator('.ticket-modal [data-taste="ticket-spaltenzeit"]').getAttribute('title').catch(() => '');
  await zu();
  pruefe('B8 t1: „seit 23 Tagen in „In Arbeit"" mit genauer Zeit im Tooltip', zeile1 === 'seit 23 Tagen in „In Arbeit“' && /2026/.test(tipp ?? ''), [zeile1, tipp]);
  await oeffne('t3');
  pruefe('B9 ein Ticket ohne Stempel zeigt nichts Erfundenes', (await P.locator('.ticket-modal [data-taste="ticket-spaltenzeit"]').count()) === 0);
  await zu();

  // Briefing ohne KI
  const vorher = (await boardVon(P)).nodes.map((n) => n.id);
  await P.evaluate(() => [...document.querySelectorAll('.dock button')].find((b) => b.getAttribute('aria-label') === 'Mehr')?.click());
  await P.waitForTimeout(300);
  await P.evaluate(() => [...document.querySelectorAll('.dock-menu-more button')].find((b) => b.textContent.includes('KI-Assistent'))?.click());
  await P.waitForTimeout(300);
  await P.locator('[data-taste="ki-briefing"]').click();
  await P.waitForFunction(() => /Briefing/.test(document.querySelector('.toast')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  await P.waitForTimeout(1200);
  const neu = (await boardVon(P)).nodes.find((n) => !vorher.includes(n.id));
  const texte = JSON.stringify(neu?.data?.blocks ?? []);
  const risiken = texte.slice(texte.indexOf('Risiken und Blocker'));
  pruefe('B10 das Briefing nennt das alte Ticket – gemessen am Ticket, obwohl die Karte gerade geändert wurde', /Seit 23 Tagen in „In Arbeit“: Statik prüfen/.test(risiken), risiken.slice(0, 500));
  pruefe('B11 … und nicht das vor drei Tagen dorthin gezogene', !/Bauantrag/.test(risiken), risiken.slice(0, 500));
}

// ---------- C: Sync-Eingang ----------
console.log('C  Sync-Eingang stempelt nicht neu');
{
  const { P } = B;
  const tickets = async () => Object.fromEntries(((await boardVon(P)).nodes.find((n) => n.id === 'k1')?.data?.items ?? []).map((it) => [it.id, it]));
  await P.locator('button[title^="Einstellungen"]').click(); await P.waitForTimeout(600);
  await P.locator('.modal button', { hasText: 'Daten' }).first().click(); await P.waitForTimeout(500);
  await P.locator('.modal button', { hasText: 'Sync-Ordner verbinden' }).click(); await P.waitForTimeout(1500);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  pruefe('C0 der Ordner trägt den Stand mit Spaltenzeit', lies(HAUPT)?.boards?.[0]?.nodes?.find((n) => n.id === 'k1')?.data?.items?.some((it) => it.id === 't1' && typeof it.spalteSeit === 'number'), lies(HAUPT)?.boards?.[0]?.nodes?.[0]?.data?.items);
  const jetzt = await P.evaluate(() => Date.now());
  const DRUEBEN = jetzt - 5 * TAG;
  {
    const p = lies(HAUPT);
    const k = p.boards[0].nodes.find((n) => n.id === 'k1');
    k.data.items = [
      ...k.data.items.map((it) => (it.id === 't3' ? { ...it, col: 1, spalteSeit: DRUEBEN } : it)),
      { id: 't9', text: 'Zukunftsticket', col: 1, spalteSeit: jetzt + 40 * TAG },
    ];
    k.geaendert = jetzt - 1000;
    p.savedAt = new Date(jetzt + 1000).toISOString().replace('Z', '001Z');
    schreib(HAUPT, p);
  }
  const ende = Date.now() + 25000;
  let t = await tickets();
  while (Date.now() < ende && !(t.t3?.col === 1 && t.t9)) { await P.waitForTimeout(500); t = await tickets(); }
  pruefe('C1 der Eingang kommt an (t3 verschoben, t9 neu)', t.t3?.col === 1 && !!t.t9, [t.t3, t.t9]);
  pruefe('C2 der fremde Stempel bleibt, wie er kam (nicht „jetzt")', t.t3?.spalteSeit === DRUEBEN, [t.t3?.spalteSeit, DRUEBEN]);
  pruefe('C3 ein Stempel aus der Zukunft fällt weg (lib/sicher.ts)', t.t9 && t.t9.spalteSeit === undefined, t.t9);
  await B.ctx.close();
}

// ---------- D ----------
console.log('D  Texte und Fehler');
{
  const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  const keys = ['seit {0} in „{1}“', 'seit heute in „{0}“', 'Seit {0} in „{1}“: {2}', '{0} zurückgeholt – Strg+Z nimmt es zurück.', '{n} Verbindung', '{n} Verbindungen', '{n} Strich', '{n} Striche',
    'Verbindung gelöscht', 'Verbindung geändert', 'Auswahl zurückholen ({0})', 'Nichts zurückgeholt – die Karten an den Enden fehlen.'];
  const fehlt = keys.filter((k) => !en[k]);
  pruefe('D1 englische Texte vorhanden', !fehlt.length, fehlt);
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('D2 Hilfe DE und EN nennen Auswahl und Spaltenzeit', /Auswahl zurückholen/.test(hilfe) && /seit wann/i.test(hilfe) && /Restore selection/.test(hilfeEn) && /how long/i.test(hilfeEn));
  pruefe('D3 keine Seitenfehler', !fehler.length, fehler);
}

await browser.close();
app.close();
console.log(`\nM470: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
