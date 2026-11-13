/**
 * M357 — Ein Board per kurzem Link teilen; der Empfänger öffnet es direkt, ohne Konto.
 * Supabase (PostgREST auf board_links, RPC link_lesen, Dateispeicher mit signierten Adressen) ist im
 * Node-Prozess nachgebaut.
 *
 *   A  Besitzerin (angemeldet): Board-Menü → „Per Link teilen …" → „Link erstellen": Board-Datei und der
 *      PDF-Anhang liegen im Dateispeicher, die Zeile steht in board_links, der Dialog zeigt den kurzen Link.
 *   B  Empfänger OHNE Konto und ohne Daten öffnet den Link: keine Einführung, keine Rückfrage — das Board ist
 *      offen, mit Notiz, Strich und der PDF (Anhang unter der NEUEN Karten-Id in der Geräte-Ablage).
 *   C  Derselbe Link noch einmal: das vorhandene Board wird geöffnet, kein Doppel.
 *   D  Besitzerin ändert das Board und aktualisiert die Fassung (gleiches Token) → der Empfänger bekommt
 *      die Rückfrage und lädt die neue Fassung als weiteres Board.
 *   E  Besitzerin löscht den Link → Zeile und Dateien weg; der Empfänger bekommt eine klare Meldung.
 *   F  Ohne Konto: der Dialog erklärt es und bietet „Board im Link kopieren" (bisheriger Weg).
 *   H  Kennt der Server die Tabelle noch nicht, bietet der Dialog ohne Fehlermeldung den bisherigen Weg.
 *   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m357-link-teilen.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, readdirSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4575;
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
/** Eine kleine, gültige PDF mit n Seiten (612 × 792), je Seite ein farbiges Rechteck an anderer Stelle */
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
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// ---------- Nachgebautes Supabase ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const UID = 'uid-anna';
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const TOKEN = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: UID, email: 'anna@example.de', exp: Math.floor(Date.now() / 1000) + 7200 }))}.sig`;
const sb = { objekte: new Map(), links: new Map(), signiert: new Map(), n: 0, anonRpc: 0, ohneAnmeldung: [], ohneTabelle: false };
async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const pfad = decodeURIComponent(url.pathname);
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: '' });
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    const eq = (k) => /^eq\.(.+)$/.exec(url.searchParams.get(k) ?? '')?.[1];
    // ---- signierte Adresse: OHNE Schlüssel und ohne Anmeldung ----
    let t = /^\/storage\/v1\/object\/sign\/pixinotes\/(.+)$/.exec(pfad);
    if (t && m === 'GET') {
      const o = sb.objekte.get(t[1]);
      if (!o || sb.signiert.get(url.searchParams.get('token')) !== t[1]) return json(route, 400, { error: 'InvalidJWT' });
      sb.ohneAnmeldung.push(t[1]);
      return route.fulfill({ status: 200, contentType: o.mime, headers: { 'access-control-allow-origin': '*' }, body: o.body });
    }
    if ((req.headers()['apikey'] ?? '') !== SB_KEY) return json(route, 401, { message: 'No API key found in request' });
    const auth = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1];
    // ---- anonym: nur link_lesen ----
    if (pfad === '/rest/v1/rpc/link_lesen' && m === 'POST') {
      if (auth === SB_KEY) sb.anonRpc += 1;
      const l = sb.links.get(body().p_token);
      return json(route, 200, l ? { name: l.name, board_url: l.board_url, dateien: l.dateien, stand: l.updated_at } : null);
    }
    if (auth !== TOKEN) return json(route, 401, { message: 'JWT expired' });
    // ---- Dateispeicher ----
    if (t && m === 'POST') {
      if (!sb.objekte.has(t[1])) return json(route, 400, { error: 'not found' });
      const sig = `sig-${++sb.n}`; sb.signiert.set(sig, t[1]);
      return json(route, 200, { signedURL: `/object/sign/pixinotes/${t[1].split('/').map(encodeURIComponent).join('/')}?token=${sig}` });
    }
    t = /^\/storage\/v1\/object\/pixinotes\/(.+)$/.exec(pfad);
    if (t) {
      if (!t[1].startsWith(`${UID}/`)) return json(route, 403, { message: 'new row violates row-level security policy' });
      if (m === 'POST') { sb.objekte.set(t[1], { body: req.postDataBuffer() ?? Buffer.alloc(0), mime: req.headers()['content-type'] ?? 'application/octet-stream' }); return json(route, 200, { Key: `pixinotes/${t[1]}` }); }
      if (m === 'DELETE') { sb.objekte.delete(t[1]); return json(route, 200, {}); }
    }
    // ---- board_links ----
    if (pfad === '/rest/v1/board_links') {
      if (sb.ohneTabelle) return json(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.board_links' in the schema cache" });
      if (m === 'GET') return json(route, 200, [...sb.links.values()].filter((l) => l.besitzer === UID && (!eq('board_id') || l.board_id === eq('board_id'))));
      if (m === 'POST') {
        const b = body();
        if (!/^[A-Za-z0-9_-]{20,64}$/.test(b.token ?? '')) return json(route, 400, { message: 'board_links_token' });
        const alt = sb.links.get(b.token);
        const l = { ...(alt ?? { created_at: new Date().toISOString() }), ...b, besitzer: UID, updated_at: new Date(Date.now() + sb.links.size + (alt ? 1000 : 0)).toISOString() };
        sb.links.set(b.token, l);
        return json(route, 201, [l]);
      }
      if (m === 'DELETE') { sb.links.delete(eq('token')); return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
    }
    // ---- der übrige Konto-Abgleich: leer und zufrieden ----
    if (pfad === '/rest/v1/konto_dateien') return json(route, 200, []);
    if (pfad === '/rest/v1/rpc/konto_schreiben') return json(route, 200, 1);
    if (pfad === '/rest/v1/rpc/freigaben_annehmen') return json(route, 200, 0);
    if (pfad === '/rest/v1/rpc/freigaben_fuer_mich') return json(route, 200, []);
    if (pfad === '/auth/v1/user') return json(route, 200, { id: UID, email: 'anna@example.de' });
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (j.event === 'phx_join') ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [] } }, ref: j.ref }));
      else if (j.event === 'heartbeat') ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
    });
  });
}

// ---------- Geräte ----------
const standAnna = {
  boards: [{ id: 'bx', name: 'Vorlesung 7', edges: [], comments: [], nodes: [
    { id: 'x1', type: 'note', width: 260, position: { x: 60, y: 60 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Mitschrift vom Dienstag' }] } },
    { id: 'f1', type: 'file', width: 300, position: { x: 380, y: 60 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length } },
  ], drawings: [{ id: 's1', tool: 'pen', color: '#e0392b', width: 2, anchor: 'f1', points: [[20, 20], [60, 30], [100, 20], [140, 30], [180, 20], [220, 30], [260, 20]] }] }],
  spaces: [{ id: 's1', name: 'Studium', projects: [{ id: 'p1', name: 'BWL', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
async function geraet({ stand, konto, adresse = '' }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig, konto }) => {
    if (sessionStorage.getItem('pn-test')) return;
    sessionStorage.setItem('pn-test', '1');
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    if (st) {
      localStorage.setItem('pixinotes-onboarded', '1');
      localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
      localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
    }
    if (konto) localStorage.setItem('pixinotes-konto-sync', JSON.stringify(konto));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY }, konto });
  const P = await ctx.newPage();
  const dialoge = [];
  P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
  P.on('dialog', (d) => { dialoge.push(d.message()); void d.accept(); });
  await P.goto(`http://localhost:${PORT}/${adresse}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return { ctx, P, dialoge };
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const ablage = (P, id) => P.evaluate((id) => new Promise((ok) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const q = r.result.transaction('kv', 'readonly').objectStore('kv').get(`file:${id}`); q.onsuccess = () => ok(q.result ? q.result.size ?? q.result.byteLength ?? -1 : 0); q.onerror = () => ok(-2); };
  r.onerror = () => ok(-3);
}), id);
async function warteBis(fn, ms = 12000) { const ende = Date.now() + ms; while (Date.now() < ende) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; }
/** Board-Menü öffnen, bis der Eintrag „Per Link teilen …" zu sehen ist (es gibt mehrere ⋯-Knöpfe: Bereich, Projekt, Board) */
const menue = async (P) => {
  const knoepfe = P.locator('.ebenen-menu-knopf');
  const n = await knoepfe.count();
  for (let i = n - 1; i >= 0; i -= 1) {
    await knoepfe.nth(i).click({ timeout: 3000 }).catch(() => {});
    await P.waitForTimeout(250);
    if (await P.locator('[data-taste="board-link"]').count()) return true;
    await P.keyboard.press('Escape'); await P.waitForTimeout(150);
  }
  return false;
};

console.log('════ A: Besitzerin legt den Link an ════');
const anna = await geraet({ stand: standAnna, konto: { anbieter: 'supabase', clientId: SB_KEY, url: SB_URL, userId: UID, name: 'anna@example.de', token: TOKEN, tokenExp: Date.now() + 3600_000, refreshToken: 'rt-1' } });
// die PDF liegt wie nach dem Hineinziehen in der Geräte-Ablage
await anna.P.evaluate((bytes) => new Promise((ok) => {
  const r = indexedDB.open('pixinotes-sync', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' }), 'file:f1'); tx.oncomplete = () => ok(true); };
}), [...Buffer.from(pdf, 'latin1')]);
await anna.P.evaluate(() => { const st = JSON.parse(localStorage.getItem('pixinotes-board')); return st.state.boards.length; });
await anna.P.locator('.react-flow__pane').click({ position: { x: 900, y: 600 } });
// Board-Menü über den Befehl im Baum/Tab — der Eintrag trägt data-taste
await menue(anna.P);
const eintrag = anna.P.locator('[data-taste="board-link"]');
pruefe('A1 das Board-Menü bietet „Per Link teilen …"', (await eintrag.count()) === 1 && /Per Link teilen/.test(await eintrag.textContent()));
await eintrag.click(); await anna.P.waitForTimeout(600);
pruefe('A2 Dialog: noch kein Link, Knopf „Link erstellen und kopieren"', (await anna.P.locator('[data-taste="link-erstellen"]').count()) === 1);
await anna.P.locator('[data-taste="link-erstellen"]').click();
await warteBis(async () => (await anna.P.locator('[data-taste="link-adresse"]').count()) === 1);
const adresse = await anna.P.locator('[data-taste="link-adresse"]').inputValue().catch(() => '');
const token = /#l=([A-Za-z0-9_-]{20,64})$/.exec(adresse)?.[1];
pruefe('A3 der Dialog zeigt einen kurzen Link (…#l=<Token>, unter 120 Zeichen)', !!token && adresse.length < 120 && adresse.startsWith(`http://localhost:${PORT}/#l=`), adresse);
const zeile = sb.links.get(token);
pruefe('A4 Zeile in board_links: Board-Kennung, Name, ein Anhang', !!zeile && zeile.board_id === 'bx' && zeile.name === 'Vorlesung 7' && zeile.dateien.length === 1 && zeile.dateien[0].id === 'f1' && zeile.dateien[0].name === 'skript.pdf', JSON.stringify(zeile ?? null).slice(0, 300));
const brett = sb.objekte.get(`${UID}/link-${token}/board.json`);
const anhang = sb.objekte.get(`${UID}/link-${token}/f1`);
pruefe('A5 Board-Datei und PDF liegen im Dateispeicher unter <Konto>/link-<Token>/', !!brett && !!anhang && anhang.body.length === pdf.length && /"Mitschrift vom Dienstag"/.test(brett.body.toString('utf8')), JSON.stringify({ brett: brett?.body.length, anhang: anhang?.body.length, soll: pdf.length }));
pruefe('A6 die Fassung trägt keine Auswahl und keine fremden Kennungen', !!brett && !/"selected":true/.test(brett.body.toString('utf8')) && !/geteiltVon/.test(brett.body.toString('utf8')));
const zwischen = await anna.P.evaluate(() => navigator.clipboard.readText()).catch(() => '');
pruefe('A7 der Link liegt in der Zwischenablage', zwischen === adresse, zwischen);

console.log('\n════ B: Empfänger ohne Konto öffnet den Link ════');
const ben = await geraet({ stand: null, konto: null, adresse: `#l=${token}` });
await warteBis(async () => (await zustand(ben.P)).boards.some((b) => /Vorlesung 7/.test(b.name)));
let zb = await zustand(ben.P);
const geteilt = zb.boards.find((b) => /Vorlesung 7/.test(b.name));
pruefe('B1 das Board ist da und offen — ohne Rückfrage, ohne Einführung', !!geteilt && zb.activeId === geteilt.id && zb.view === 'board' && ben.dialoge.length === 0 && (await ben.P.locator('.onboarding, .onb-backdrop').count()) === 0, JSON.stringify({ aktiv: zb.activeId, id: geteilt?.id, dialoge: ben.dialoge }));
pruefe('B2 die Adresse ist wieder sauber (kein #l= mehr)', !/#l=/.test(ben.P.url()), ben.P.url());
const karteNeu = geteilt?.nodes.find((n) => n.type === 'file');
pruefe('B3 Notiz, Datei-Karte und der Strich an der Karte sind dabei (neue Kennungen)', !!geteilt && geteilt.nodes.length === 2 && !!karteNeu && karteNeu.id !== 'f1' && geteilt.drawings.length === 1 && geteilt.drawings[0].anchor === karteNeu.id, JSON.stringify({ n: geteilt?.nodes.length, d: geteilt?.drawings }));
await warteBis(async () => (await ablage(ben.P, karteNeu.id)) === pdf.length);
pruefe('B4 der PDF-Anhang liegt in der Geräte-Ablage — unter der NEUEN Karten-Kennung', (await ablage(ben.P, karteNeu.id)) === pdf.length, String(await ablage(ben.P, karteNeu.id)));
pruefe('B5 geholt ohne Anmeldung: link_lesen mit dem öffentlichen Schlüssel, Dateien über signierte Adressen', sb.anonRpc >= 1 && sb.ohneAnmeldung.includes(`${UID}/link-${token}/board.json`) && sb.ohneAnmeldung.includes(`${UID}/link-${token}/f1`), JSON.stringify(sb.ohneAnmeldung));
await warteBis(async () => (await ben.P.locator('.react-flow__node .pdf-thumb canvas, .react-flow__node .pdf-seite canvas').count()) > 0, 8000);
pruefe('B6 die Karte zeigt die PDF', (await ben.P.locator('.react-flow__node .pdf-thumb canvas, .react-flow__node .pdf-seite canvas').count()) > 0);

console.log('\n════ C: derselbe Link noch einmal ════');
const anzahl = (await zustand(ben.P)).boards.length;
await ben.P.goto(`http://localhost:${PORT}/#l=${token}`); await ben.P.reload({ waitUntil: 'networkidle' }); await ben.P.waitForTimeout(2200);
zb = await zustand(ben.P);
pruefe('C1 kein Doppel: dasselbe Board wird geöffnet', zb.boards.length === anzahl && zb.activeId === geteilt.id && /hattest es schon/.test(await toast(ben.P)), JSON.stringify({ n: zb.boards.length, vorher: anzahl, toast: await toast(ben.P) }));

console.log('\n════ D: Fassung aktualisieren ════');
await anna.P.keyboard.press('Escape'); await anna.P.waitForTimeout(300);
// eine neue Notiz dazu (Taste N: Notiz in der Bildmitte), mit Text
await anna.P.locator('.react-flow__pane').click({ position: { x: 900, y: 700 } });
await anna.P.keyboard.press('n'); await anna.P.waitForTimeout(700);
await anna.P.keyboard.type('Nachtrag ergänzt', { delay: 15 }); await anna.P.waitForTimeout(400);
await anna.P.keyboard.press('Escape'); await anna.P.waitForTimeout(900);
await menue(anna.P);
await anna.P.locator('[data-taste="board-link"]').click(); await anna.P.waitForTimeout(800);
pruefe('D1 der Dialog kennt den Link wieder (gleiches Token)', (await anna.P.locator('[data-taste="link-adresse"]').inputValue().catch(() => '')) === adresse);
const standVorher = sb.links.get(token).updated_at;
await anna.P.locator('[data-taste="link-aktualisieren"]').click();
await warteBis(async () => sb.links.get(token)?.updated_at !== standVorher);
pruefe('D2 aktualisiert: gleiche Zeile, neuer Stand, neue Board-Datei', sb.links.size === 1 && sb.links.get(token).updated_at !== standVorher && /ergänzt/.test(sb.objekte.get(`${UID}/link-${token}/board.json`).body.toString('utf8')));
await ben.P.goto(`http://localhost:${PORT}/#l=${token}`); await ben.P.reload({ waitUntil: 'networkidle' }); await ben.P.waitForTimeout(2600);
zb = await zustand(ben.P);
pruefe('D3 der Empfänger wird gefragt und bekommt die neue Fassung als weiteres Board', ben.dialoge.some((d) => /neuere Fassung/.test(d)) && zb.boards.length === anzahl + 1 && JSON.stringify(zb.boards.find((b) => b.id === zb.activeId)).includes('ergänzt'), JSON.stringify({ dialoge: ben.dialoge, n: zb.boards.length }));

console.log('\n════ E: Link löschen ════');
await anna.P.locator('[data-taste="link-loeschen"]').click();
await warteBis(async () => sb.links.size === 0);
await anna.P.waitForTimeout(600);
pruefe('E1 Zeile und Dateien sind weg', sb.links.size === 0 && ![...sb.objekte.keys()].some((k) => k.includes(`link-${token}`)), JSON.stringify([...sb.objekte.keys()]));
pruefe('E2 der Dialog bietet wieder „Link erstellen"', (await anna.P.locator('[data-taste="link-erstellen"]').count()) === 1);
const vorE = (await zustand(ben.P)).boards.length;
await ben.P.goto(`http://localhost:${PORT}/#l=${token}`); await ben.P.reload({ waitUntil: 'networkidle' }); await ben.P.waitForTimeout(2200);
pruefe('E3 der Empfänger bekommt eine klare Meldung, nichts wird angelegt', /gibt es nicht mehr/.test(await toast(ben.P)) && (await zustand(ben.P)).boards.length === vorE, await toast(ben.P));
await anna.ctx.close(); await ben.ctx.close();

console.log('\n════ F: ohne Konto ════');
const ohne = await geraet({ stand: standAnna, konto: null });
await menue(ohne.P);
await ohne.P.locator('[data-taste="board-link"]').click(); await ohne.P.waitForTimeout(500);
const textF = await ohne.P.locator('.link-dialog').textContent();
pruefe('F1 der Dialog erklärt das Konto und bietet den bisherigen Weg', /PixiNotes-Konto/.test(textF) && (await ohne.P.locator('[data-taste="link-ohne-konto"]').count()) === 1 && (await ohne.P.locator('[data-taste="link-erstellen"]').count()) === 0);
await ohne.P.locator('[data-taste="link-ohne-konto"]').click(); await ohne.P.waitForTimeout(800);
const alt = await ohne.P.evaluate(() => navigator.clipboard.readText()).catch(() => '');
pruefe('F2 „Board im Link kopieren" legt den #b=-Link in die Zwischenablage', /#b=[A-Za-z0-9_-]{50,}$/.test(alt), alt.slice(0, 80));
await ohne.ctx.close();

console.log('\n════ H: Server noch ohne Tabelle (Migration fehlt) ════');
{
  sb.ohneTabelle = true;
  const g = await geraet({ stand: standAnna, konto: { anbieter: 'supabase', clientId: SB_KEY, url: SB_URL, userId: UID, name: 'anna@example.de', token: TOKEN, tokenExp: Date.now() + 3600_000, refreshToken: 'rt-1' } });
  await menue(g.P);
  await g.P.locator('[data-taste="board-link"]').click(); await g.P.waitForTimeout(900);
  pruefe('H1 kein Fehler: der Dialog sagt es und bietet „Board im Link kopieren"', (await g.P.locator('[data-taste="link-fehlt"]').count()) === 1 && (await g.P.locator('[data-taste="link-ohne-konto"]').count()) === 1 && (await g.P.locator('.modal-error').count()) === 0, await g.P.locator('.link-dialog').textContent());
  sb.ohneTabelle = false;
  await g.ctx.close();
}

console.log('\n════ G ════');
const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
pruefe('G1 „Was ist neu" nennt M357', js.includes('(M357)'));

await browser.close(); app.close();
console.log(`\nm357-link-teilen: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
