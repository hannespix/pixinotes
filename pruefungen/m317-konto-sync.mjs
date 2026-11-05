/**
 * M317 — Konto-Sync: Anmelden mit Google oder Microsoft, Daten im App-Ordner
 * des eigenen Drive/OneDrive. Google Drive (GIS + Drive v3 samt Multipart-
 * Upload) und Microsoft Graph (Authorize-Redirect, Token, approot mit If-Match)
 * sind im Node-Prozess nachgebaut; alle Geräte sehen denselben Speicher.
 *
 *   A  Gerät A meldet sich bei Google an: Sitzung gespeichert, umgebung.json
 *      und je Board eine Datei im App-Ordner, Wolke „ok", Anzeige „Angemeldet".
 *   B  Gerät B meldet sich an und übernimmt den Stand (ohne eigene Änderungen).
 *   C  B legt eine Karte an → Drive trägt sie, A übernimmt sie ohne Klick.
 *   D  Beide zugleich auf demselben Board → beide haben beide Karten.
 *   E  B löscht eine Karte → A folgt; ein neues Board auf A erscheint auf B.
 *   F  Ein Anhang auf A reist als datei-<id> und kommt auf B an.
 *   G  Gerät C meldet sich bei Microsoft an (Popup-Weg) → approot trägt den Stand.
 *   H  Abmelden; „Was ist neu" und Hilfe nennen den Konto-Sync.
 */
// Läuft aus dem Repository: `node pruefungen/m317-konto-sync.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4539;
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

// ---------- Nachgebaute Dienste (ein Nutzer, mehrere Geräte) ----------
const drive = { files: new Map(), n: 0 };   // id → { id, name, content: Buffer, mime, version, modifiedTime }
const graph = { items: new Map(), n: 0 };   // name → { name, id, content: Buffer, mime, eTag }
const driveDatei = (name) => [...drive.files.values()].filter((f) => f.name === name).sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1))[0];
const driveText = (name) => driveDatei(name)?.content.toString('utf8') ?? '';
const driveNamen = () => [...drive.files.values()].map((f) => f.name).sort();
const GIS_JS = `window.google = { accounts: { oauth2: { initTokenClient(cfg) { return { requestAccessToken() { setTimeout(() => cfg.callback({ access_token: 'g-tok-' + Date.now(), expires_in: 3600 }), 20); } }; } } } };`;

function multipart(buf, contentType) {
  const grenze = /boundary=([^;]+)/.exec(contentType)?.[1];
  const s = buf.toString('latin1');
  const teile = s.split(`--${grenze}`).slice(1, -1).map((t) => {
    const i = t.indexOf('\r\n\r\n');
    const kopf = t.slice(0, i); let body = t.slice(i + 4);
    if (body.endsWith('\r\n')) body = body.slice(0, -2);
    return { kopf, body };
  });
  const meta = JSON.parse(Buffer.from(teile[0].body, 'latin1').toString('utf8'));
  const mime = /Content-Type: ([^\r\n]+)/i.exec(teile[1].kopf)?.[1] ?? 'application/octet-stream';
  return { meta, mime, content: Buffer.from(teile[1].body, 'latin1') };
}

async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  await ctx.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_JS }));
  await ctx.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const m = req.method(); const p = url.pathname;
    if (!(req.headers().authorization ?? '').startsWith('Bearer g-')) return json(route, 401, { error: { code: 401 } });
    if (p === '/drive/v3/about') return json(route, 200, { user: { emailAddress: 'test@example.org' } });
    if (p === '/drive/v3/files' && m === 'GET') {
      return json(route, 200, { files: [...drive.files.values()].map((f) => ({ id: f.id, name: f.name, version: String(f.version), size: String(f.content.length), modifiedTime: f.modifiedTime })) });
    }
    if (p === '/upload/drive/v3/files' && m === 'POST') {
      const { meta, mime, content } = multipart(req.postDataBuffer(), req.headers()['content-type'] ?? '');
      const id = `f${++drive.n}`;
      drive.files.set(id, { id, name: meta.name, content, mime, version: 1, modifiedTime: new Date().toISOString() });
      return json(route, 200, { id, version: '1' });
    }
    let mm = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (mm && m === 'PATCH') {
      const f = drive.files.get(mm[1]); if (!f) return json(route, 404, {});
      f.content = req.postDataBuffer() ?? Buffer.from(req.postData() ?? ''); f.version += 1; f.modifiedTime = new Date().toISOString();
      f.mime = req.headers()['content-type'] ?? f.mime;
      return json(route, 200, { id: f.id, version: String(f.version) });
    }
    mm = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (mm) {
      const f = drive.files.get(mm[1]); if (!f) return json(route, 404, { error: { code: 404 } });
      if (m === 'DELETE') { drive.files.delete(mm[1]); return route.fulfill({ status: 204, body: '' }); }
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: f.mime, body: f.content });
      return json(route, 200, { id: f.id, version: String(f.version) });
    }
    return json(route, 404, { error: { code: 404, message: `unbekannt: ${m} ${p}` } });
  });
  await ctx.route('https://login.microsoftonline.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/authorize')) {
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'code-1'); back.searchParams.set('state', url.searchParams.get('state'));
      return route.fulfill({ status: 302, headers: { location: back.toString() }, body: '' });
    }
    if (url.pathname.endsWith('/token')) return json(route, 200, { access_token: `ms-tok-${Date.now()}`, refresh_token: 'ms-ref', expires_in: 3600, scope: 'Files.ReadWrite.AppFolder User.Read offline_access' });
    return json(route, 404, {});
  });
  await ctx.route('https://graph.microsoft.com/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const m = req.method(); const p = decodeURIComponent(url.pathname);
    if (!(req.headers().authorization ?? '').startsWith('Bearer ms-')) return json(route, 401, {});
    if (p === '/v1.0/me') return json(route, 200, { userPrincipalName: 'test@contoso.com' });
    if (p === '/v1.0/me/drive/special/approot/children') return json(route, 200, { value: [...graph.items.values()].map((i) => ({ name: i.name, id: i.id, eTag: i.eTag, size: i.content.length })) });
    const mm = /^\/v1\.0\/me\/drive\/special\/approot:\/([^:]+)(:\/content)?$/.exec(p);
    if (!mm) return json(route, 404, { error: { message: `unbekannt: ${m} ${p}` } });
    const name = mm[1]; const inhalt = !!mm[2]; const it = graph.items.get(name);
    if (inhalt && m === 'GET') return it ? route.fulfill({ status: 200, contentType: it.mime, body: it.content }) : json(route, 404, {});
    if (inhalt && m === 'PUT') {
      const ifm = req.headers()['if-match'];
      if (ifm && (!it || it.eTag !== ifm)) return json(route, 412, { error: { code: 'resourceModified' } });
      const eTag = `"${Date.now()}-${++graph.n}"`;
      graph.items.set(name, { name, id: it?.id ?? `i${graph.n}`, content: req.postDataBuffer() ?? Buffer.from(req.postData() ?? ''), mime: req.headers()['content-type'] ?? 'application/octet-stream', eTag });
      return json(route, it ? 200 : 201, { eTag, name });
    }
    if (!inhalt && m === 'GET') return it ? json(route, 200, { eTag: it.eTag, name }) : json(route, 404, {});
    if (!inhalt && m === 'DELETE') { graph.items.delete(name); return route.fulfill({ status: 204, body: '' }); }
    return json(route, 405, {});
  });
}

// ---------- Geräte ----------
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Planung', [note('x1', 'Planung Notiz')]), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'by'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
const standC = {
  boards: [board('bc', 'Microsoft-Board', [note('c1', 'C Notiz')])],
  spaces: [{ id: 's5', name: 'Büro', projects: [{ id: 'p5', name: 'Team', boardIds: ['bc'] }] }],
  activeId: 'bc', view: 'board',
};
async function geraet(name, stand) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await dienste(ctx);
  await ctx.addInitScript((st) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    // Client-IDs wie sie der Betreiber hinterlegt (hier über die Kalender-Konten)
    localStorage.setItem('pixinotes-cal-accounts', JSON.stringify({ google: { clientId: 'cid.apps.googleusercontent.com' }, ms: { clientId: 'ms-app-id', tenant: 'common' } }));
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
const sitzung = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-konto-sync') ?? 'null'));
const knoten = (P) => P.locator('.react-flow__node').count();
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(500); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function boardWechseln(P, name) { await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click(); await P.waitForTimeout(700); }
async function notiz(P, text, x = 900, y = 500) {
  const vorher = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(x, y);
  await P.waitForTimeout(700);
  const aktiv = await P.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true');
  if (!aktiv) { await P.locator('.react-flow__node').last().locator('[contenteditable="true"]').first().click(); await P.waitForTimeout(300); }
  await P.keyboard.type(text, { delay: 20 });
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(300);
  return (await P.locator('.react-flow__node').count()) === vorher + 1;
}

// ══ A: Google anmelden ══════════════════════════════════════════════
console.log('\n════ A: Gerät A meldet sich bei Google an ════');
const A = await geraet('A', standA);
await kontoPanel(A.P);
const segTexte = await A.P.locator('.seg-weg button').allTextContents();
pruefe('A1 „Konto" steht als erster Weg, beide Anmelde-Knöpfe sind aktiv', segTexte[0].startsWith('Konto') && (await A.P.locator('[data-taste="konto-google"]').isEnabled()) && (await A.P.locator('[data-taste="konto-ms"]').isEnabled()), segTexte.join(' | '));
await A.P.locator('[data-taste="konto-google"]').click();
await warteBis(A.P, async () => !!(await sitzung(A.P)), 8000);
const sA = await sitzung(A.P);
pruefe('A2 Sitzung gespeichert (Google, Token, Name)', sA?.anbieter === 'google' && !!sA?.token && sA?.name === 'test@example.org', JSON.stringify(sA));
await warteBis(A.P, () => driveNamen().includes('umgebung.json'), 8000);
pruefe('A3 App-Ordner: umgebung.json + je Board eine Datei', driveNamen().join() === 'board-bx.json,board-by.json,umgebung.json', driveNamen().join());
const u = JSON.parse(driveText('umgebung.json') || '{}');
pruefe('A4 Umgebung trägt Bereiche, Reihenfolge und Stempel je Board', u.app === 'pixinotes' && u.reihe?.join() === 'bx,by' && Object.keys(u.boards ?? {}).length === 2 && u.spaces?.[0]?.name === 'Arbeit', JSON.stringify({ reihe: u.reihe, boards: u.boards }));
pruefe('A5 Stempel gesetzt, kein Dirty-Rest', (await A.P.evaluate(() => localStorage.getItem('pixinotes:konto-stamp'))) === u.savedAt && !(await A.P.evaluate(() => localStorage.getItem('pixinotes:konto-dirty'))));
const anzeige = await A.P.locator('.modal-note', { hasText: 'Angemeldet bei' }).textContent().catch(() => '');
pruefe('A6 Anzeige: Angemeldet bei Google Drive als test@example.org', /Angemeldet bei Google Drive als „test@example.org"/.test(anzeige), anzeige.slice(0, 120));
await A.P.screenshot({ path: `${SD}/m317-a-konto.png` });
await schliessen(A.P);
const chip = await A.P.locator('.sync-status').getAttribute('data-tip').catch(() => null);
pruefe('A7 die Wolke zeigt Google Drive als Quelle', /Google Drive/.test(chip ?? ''), String(chip));

// ══ B: Zweites Gerät übernimmt ══════════════════════════════════════
console.log('\n════ B: Gerät B meldet sich an und übernimmt ════');
const B = await geraet('B', standB);
await kontoPanel(B.P);
await B.P.locator('[data-taste="konto-google"]').click();
await warteBis(B.P, async () => (await boardNamen(B.P)).join() === 'Planung,Ideen', 10000);
pruefe('B1 Gerät B übernimmt Planung und Ideen aus dem Konto', (await boardNamen(B.P)).join() === 'Planung,Ideen', (await boardNamen(B.P)).join());
pruefe('B2 B ist synchron (Stempel = Konto-Stand)', (await B.P.evaluate(() => localStorage.getItem('pixinotes:konto-stamp'))) === JSON.parse(driveText('umgebung.json')).savedAt);
await schliessen(B.P);

// ══ C: Änderung ohne Klick ══════════════════════════════════════════
console.log('\n════ C: Fremde Änderung kommt von allein ════');
{
  const angelegt = await notiz(B.P, 'Hallo von B');
  pruefe('C1 B legt eine Karte auf „Planung" an', angelegt, `Karten: ${await knoten(B.P)}`);
  const geschrieben = await warteBis(B.P, () => driveText('board-bx.json').includes('Hallo von B'), 8000);
  pruefe('C2 Drive trägt die Karte nach dem Auto-Sync (nur board-bx.json ändert sich)', geschrieben && !driveText('board-by.json').includes('Hallo von B'));
  const da = await warteBis(A.P, async () => (await texte(A.P)).includes('Hallo von B'));
  pruefe('C3 Gerät A hat die Karte ohne Klick übernommen', da);
  pruefe('C4 … und zeigt sie auf dem offenen Board', (await knoten(A.P)) === 2, `Karten: ${await knoten(A.P)}`);
}

// ══ D: Gleichzeitig auf demselben Board ═════════════════════════════
console.log('\n════ D: Gleichzeitig auf demselben Board ════');
{
  const [a1, b1] = await Promise.all([notiz(A.P, 'A-gleichzeitig', 500, 750), notiz(B.P, 'B-gleichzeitig', 1100, 750)]);
  pruefe('D1 beide legen zugleich eine Karte auf „Planung" an', a1 && b1);
  const beideA = await warteBis(A.P, async () => { const t = await texte(A.P); return t.includes('A-gleichzeitig') && t.includes('B-gleichzeitig'); }, 35000);
  const beideB = await warteBis(B.P, async () => { const t = await texte(B.P); return t.includes('A-gleichzeitig') && t.includes('B-gleichzeitig'); }, 35000);
  pruefe('D2 Gerät A hat beide Karten', beideA);
  pruefe('D3 Gerät B hat beide Karten', beideB);
  pruefe('D4 beide zeigen 4 Karten auf „Planung"', (await knoten(A.P)) === 4 && (await knoten(B.P)) === 4, `${await knoten(A.P)} / ${await knoten(B.P)}`);
  const d = driveText('board-bx.json');
  pruefe('D5 Drive trägt beide Anteile', d.includes('A-gleichzeitig') && d.includes('B-gleichzeitig'));
}

// ══ E: Löschen ══════════════════════════════════════════════════════
console.log('\n════ E: Löschen auf B, A folgt ════');
{
  const ziel = B.P.locator('.react-flow__node', { hasText: 'B-gleichzeitig' }).first();
  if (await ziel.count()) {
    await ziel.click({ position: { x: 8, y: 8 } }); await B.P.waitForTimeout(300);
    await B.P.keyboard.press('Delete'); await B.P.waitForTimeout(500);
  }
  pruefe('E1 B hat die Karte gelöscht', !(await texte(B.P)).includes('B-gleichzeitig'));
  const weg = await warteBis(A.P, async () => !(await texte(A.P)).includes('B-gleichzeitig'), 30000);
  pruefe('E2 Gerät A verliert die Karte ebenfalls', weg);
  pruefe('E3 A zeigt 3 Karten', (await knoten(A.P)) === 3, `Karten: ${await knoten(A.P)}`);
}

// ══ E2: Neues Board auf A — eine Datei, die B noch nicht kennt ═════
console.log('\n════ E2: Neues Board ════');
{
  await A.P.locator('.tabs [aria-label="Neu"]').click(); await A.P.waitForTimeout(300);
  await A.P.locator('.neu-menu button', { hasText: 'Board' }).first().click(); await A.P.waitForTimeout(900);
  const namenA = await boardNamen(A.P);
  pruefe('E4 A hat ein drittes Board', namenA.length === 3, namenA.join());
  const bei = await warteBis(B.P, async () => (await boardNamen(B.P)).length === 3, 20000);
  pruefe('E5 B bekommt das neue Board (neue Datei im App-Ordner)', bei, (await boardNamen(B.P)).join());
}

// ══ F: Anhang reist mit ═════════════════════════════════════════════
console.log('\n════ F: Anhang ════');
{
  // Kein Bild (das würde eingebettet), sondern eine „fremde" Datei: sie wird zur
  // Datei-Karte mit Inhalt in der lokalen Ablage — und reist so als datei-<id>
  const inhalt = Buffer.alloc(2048, 7);
  const pfad = `${SD}/m317-anhang.bin`; writeFileSync(pfad, inhalt);
  await A.P.locator('.dock [aria-label="Objekt hinzufügen"]').click(); await A.P.waitForSelector('.modul-palette');
  const [chooser] = await Promise.all([A.P.waitForEvent('filechooser'), A.P.locator('.modul-kachel[data-modul="datei"]').click()]);
  await chooser.setFiles(pfad);
  await A.P.waitForTimeout(1500);
  const dateiId = await warteBis(A.P, async () => { const z = await zustand(A.P); return z.boards.flatMap((b) => b.nodes).find((n) => n.type === 'file')?.id; }, 8000);
  const z = await zustand(A.P); const dId = z.boards.flatMap((b) => b.nodes).find((n) => n.type === 'file')?.id;
  pruefe('F1 A hat eine Datei-Karte', !!dId && dateiId, String(dId));
  const hochgeladen = await warteBis(A.P, () => driveNamen().includes(`datei-${dId}`), 10000);
  pruefe('F2 der Anhang liegt als datei-<id> im App-Ordner', hochgeladen, driveNamen().join());
  const bei = await warteBis(B.P, async () => (await texte(B.P)).includes(`"${dId}"`), 20000);
  pruefe('F3 B bekommt die Datei-Karte', bei);
  const lokal = await warteBis(B.P, () => B.P.evaluate((id) => new Promise((res) => {
    const r = indexedDB.open('pixinotes-sync');
    r.onsuccess = () => { const db = r.result; const st = db.objectStoreNames[0]; const g = db.transaction(st).objectStore(st).get(`file:${id}`); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false); };
    r.onerror = () => res(false);
  }), dId), 10000);
  pruefe('F4 … und den Inhalt in der lokalen Ablage', lokal);
}

// ══ G: Microsoft ════════════════════════════════════════════════════
console.log('\n════ G: Gerät C meldet sich bei Microsoft an ════');
const C = await geraet('C', standC);
await kontoPanel(C.P);
await C.P.locator('[data-taste="konto-ms"]').click();
await warteBis(C.P, async () => !!(await sitzung(C.P)), 10000);
const sC = await sitzung(C.P);
pruefe('G1 Microsoft-Sitzung mit Refresh-Token und Name', sC?.anbieter === 'ms' && !!sC?.refreshToken && sC?.name === 'test@contoso.com', JSON.stringify(sC));
await warteBis(C.P, () => graph.items.has('umgebung.json'), 8000);
pruefe('G2 approot trägt umgebung.json und board-bc.json', graph.items.has('umgebung.json') && graph.items.has('board-bc.json'), [...graph.items.keys()].join());
const anzeigeC = await C.P.locator('.modal-note', { hasText: 'Angemeldet bei' }).textContent().catch(() => '');
pruefe('G3 Anzeige: Angemeldet bei OneDrive', /Angemeldet bei OneDrive/.test(anzeigeC), anzeigeC.slice(0, 100));
{
  // Fremder Stand mit If-Match: Jemand schreibt die Umgebung dazwischen → C arbeitet ein und schreibt erneut
  const alt = graph.items.get('umgebung.json');
  const fremd = JSON.parse(alt.content.toString('utf8'));
  fremd.savedAt = new Date(Date.now() + 1000).toISOString();
  fremd.spaces[0].name = 'Büro (umbenannt)';
  alt.content = Buffer.from(JSON.stringify(fremd)); alt.eTag = `"fremd-${Date.now()}"`;
  await schliessen(C.P);
  const umbenannt = await warteBis(C.P, async () => (await zustand(C.P)).spaces[0].name === 'Büro (umbenannt)', 16000);
  pruefe('G4 C übernimmt eine fremde Umbenennung aus OneDrive (eTag-Takt)', umbenannt);
}

// ══ H: Abmelden & Texte ═════════════════════════════════════════════
console.log('\n════ H: Abmelden & Texte ════');
await kontoPanel(C.P);
await C.P.locator('.modal button', { hasText: 'Abmelden' }).click(); await C.P.waitForTimeout(400);
pruefe('H1 Abmelden löscht die Sitzung, die Daten bleiben', !(await sitzung(C.P)) && (await boardNamen(C.P)).includes('Microsoft-Board') && graph.items.has('umgebung.json'));
pruefe('H2 danach stehen die Anmelde-Knöpfe wieder da', (await C.P.locator('[data-taste="konto-google"]').count()) === 1);
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('H3 „Was ist neu" nennt M317', js.includes('Konto-Sync — anmelden, fertig (M317)'));
pruefe('H4 die Hilfe erklärt den Konto-Weg', js.includes('Konto (Google Drive / OneDrive):'));

await A.ctx.close(); await B.ctx.close(); await C.ctx.close();
await browser.close(); app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
