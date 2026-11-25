/**
 * M532 — Browser-Speicher voll: Bilder liegen im Datei-Speicher, nichts geht verloren.
 *
 * Fehlerbericht: Beim Konto-Abgleich erscheint „Der Stand aus dem Konto konnte nicht gespeichert werden
 * (Browser-Speicher voll?)". Der ganze Stand lag in EINEM localStorage-Eintrag (rund 5 Mio. Zeichen je Herkunft), und
 * eingebettete Bilder (data-URLs) steckten darin. Scheiterte das Speichern, lebte der Stand nur noch im Arbeitsspeicher
 * — beim Neuladen war die Arbeit weg, und der Abgleich brach immer wieder ab.
 *
 * Damit die Reihe schnell und auf jeder Maschine gleich läuft, ist die Grenze des localStorage künstlich klein
 * (Attrappe vor dem App-Start: `setItem` wirft QuotaExceededError, sobald alle Einträge zusammen die Grenze
 * überschreiten). Die Bilder sind erfunden (SVG-Grafiken von rund 100 000 Zeichen, wie im gemeldeten Fall).
 *
 *   A  Ein alter Stand mit eingebetteten Bildern zieht beim Start in den Datei-Speicher um (im Text nur Verweise);
 *      nach dem Neuladen sind alle Bilder da — Zeichen für Zeichen dieselben. Neu eingefügte Bilder, die den
 *      localStorage sprengen würden, sind nach dem Neuladen ebenfalls da. Der Prüfbetrieb aus M525 meldet keine
 *      Abweichung des gespeicherten Texts. Ein zweites Fenster (Mitleser) zeigt neue Bilder des Schreibers.
 *   B  Volles Gerät: dreimal eine .pixiboard.json mit acht Bildern einlesen (zusammen dreimal mehr als der
 *      localStorage fasst) — nach dem Neuladen sind alle drei Boards mit allen Bildern da. Rundreise: Die Sicherung
 *      eines Boards (.pixinotes) enthält die Bilder unverändert, und eingespielt auf einem frischen Gerät sind sie
 *      wieder Zeichen für Zeichen dieselben.
 *   C  Konto-Abgleich: Gerät B (kleiner Speicher) meldet sich am Konto an, in dem Gerät A ein Board mit Bildern
 *      liegt, die zusammen größer sind als B's localStorage. Kein „konnte nicht gespeichert werden", B hat nach dem
 *      Neuladen alle Bilder, und ein weiteres Bild von A kommt bei B an.
 *   D  Meldung: Ist der Speicher wirklich voll (großer Text, kein Bild), nennt der Abgleich den Grund und den Ausweg
 *      („Alles sichern"), statt zu raten.
 *   E  Ersatzspeicher: Voll durch Text — der Stand geht in die IndexedDB, nach dem Neuladen ist alles da (auch die
 *      letzte Änderung); ist wieder Platz, steht der Stand im localStorage und der Ersatz ist weg (kommt nicht zurück).
 *
 * Aufruf: `node pruefungen/m532-speicher-voll.mjs [A] [B] [C] [D] [E]`; `PN_DIST=<alter Build>` zeigt den Stand davor.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import http from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5532;
const NUR = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());
const will = (x) => NUR.length === 0 || NUR.includes(x);
const LAUT = process.argv.includes('--laut');

const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const zeit = () => ((Date.now() - T0) / 1000).toFixed(2).padStart(7);

// ---------- Erfundene Bilder: SVG-Grafiken von rund 100 000 Zeichen ----------
function zufall(saat) { let a = saat >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const svgBild = (saat, punkte = 6000) => {
  const z = zufall(saat); let p = '';
  for (let k = 0; k < punkte; k++) p += `${(z() * 400).toFixed(1)},${(z() * 300).toFixed(1)} `;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="hsl(${(saat * 47) % 360},55%,75%)"/><polyline points="${p}" fill="none" stroke="#333" stroke-width="0.4"/><text x="20" y="50" font-size="36" font-family="sans-serif">Grafik ${saat}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};
const bildKarte = (id, src, x, y) => ({ id, type: 'image', width: 220, position: { x, y }, data: { src, name: `${id}.svg` } });
const notiz = (id, text, x = 0, y = 0) => ({ id, type: 'note', width: 200, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}p`, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const bilderBoard = (id, name, saat0, anzahl = 8) => board(id, name, Array.from({ length: anzahl }, (_, i) => bildKarte(`${id}i${i}`, svgBild(saat0 + i), (i % 4) * 240, Math.floor(i / 4) * 200)));
const RUHIG = { ziehBewegung: false, fangLinien: false, gridSnap: false };

/** Ein Profil (Browser-Kontext) mit künstlich kleinem localStorage. `stand` wird nur beim allerersten Start gesetzt. */
async function profil({ grenze, stand, konto, pruefbetrieb = true }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  if (konto) await dienste(ctx, konto);
  await ctx.addInitScript(({ grenze, st, sb, pruefbetrieb }) => {
    const roh = Storage.prototype.setItem;
    if (!localStorage.getItem('pixinotes-onboarded')) {
      roh.call(localStorage, 'pixinotes-onboarded', '1');
      roh.call(localStorage, 'pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
      if (pruefbetrieb) roh.call(localStorage, 'pixinotes-speicher-pruefen', '1');
      if (sb) roh.call(localStorage, 'pixinotes-supabase', JSON.stringify(sb));
      if (st) roh.call(localStorage, 'pixinotes-board', JSON.stringify({ version: 5, state: st }));
    }
    // Die Attrappe: wie ein echter, nur kleinerer Speicher (alle Schlüssel und Werte zusammen)
    Storage.prototype.setItem = function setItem(k, v) {
      if (this === window.localStorage) {
        let summe = String(k).length + String(v).length;
        for (let i = 0; i < this.length; i++) { const kk = this.key(i); if (kk !== String(k)) summe += kk.length + (this.getItem(kk)?.length ?? 0); }
        if (summe > grenze) throw new DOMException(`Setting the value of '${k}' exceeded the quota.`, 'QuotaExceededError');
      }
      return roh.call(this, k, v);
    };
  }, { grenze, st: stand ?? null, sb: konto ? { url: SB_URL, key: SB_KEY } : null, pruefbetrieb });
  const P = await ctx.newPage();
  const g = { ctx, P, toasts: [], fehler: [] };
  await seiteVorbereiten(g, P);
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow', { timeout: 30000 });
  await toastsMitschreiben(P);
  return g;
}
async function seiteVorbereiten(g, P) {
  P.on('pageerror', (e) => { g.fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  await P.exposeFunction('__m532Toast', (text) => { g.toasts.push(text); if (LAUT) console.log(`    ${zeit()} TOAST ${text}`); });
}
const toastsMitschreiben = (P) => P.evaluate(() => {
  const gesehen = new WeakSet(); let letzter = '';
  // was schon steht (ein Hinweis vom Start), zählt mit
  const schon = document.querySelector('.toast.show');
  if (schon) { gesehen.add(schon); letzter = schon.textContent ?? ''; window.__m532Toast(letzter); }
  new MutationObserver(() => {
    for (const el of document.querySelectorAll('.toast.show')) {
      const t = el.textContent ?? '';
      if (gesehen.has(el) && t === letzter) continue;
      gesehen.add(el); letzter = t;
      setTimeout(() => window.__m532Toast(t), 30);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
});
async function neuLaden(g) {
  await g.P.reload({ waitUntil: 'networkidle' });
  await g.P.waitForSelector('.react-flow', { timeout: 30000 });
  await toastsMitschreiben(g.P);
}
async function warteBis(fn, ms = 20000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await warte(200); }
  return fn();
}
const rohText = (P) => P.evaluate(() => localStorage.getItem('pixinotes-board') ?? '');
/** Großer eingebetteter Inhalt im gespeicherten Text? */
const grosseDaten = (text) => (text.match(/"data:[^"]{10000,}"/g) ?? []).length;
/** Die Bilder, die auf dem Board zu sehen sind: geladen (natürliche Breite) und ihre Quelle */
const bilderAufDemBoard = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node-image img')].map((i) => ({ geladen: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') ?? '' })));
const ablageSchluessel = (P) => P.evaluate(() => new Promise((ok) => {
  const q = indexedDB.open('pixinotes-sync', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv');
  q.onsuccess = () => { const r = q.result.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => ok(r.result.map(String)); };
}));
async function boardOeffnen(P, name) {
  await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click();
  await P.waitForTimeout(600);
}
/** Ein Bild mit Rauschen (lässt sich nicht kleinrechnen) auf der Fläche einfügen */
const einfuegen = async (P, saat, w = 520, h = 400) => {
  await P.locator('.react-flow__pane').click({ position: { x: 1100, y: 650 } });
  await P.waitForTimeout(200);
  return P.evaluate(async ([saat, w, h]) => {
    let a = saat;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); const bild = x.createImageData(w, h);
    for (let i = 0; i < bild.data.length; i++) { a = (a * 1103515245 + 12345) & 0x7fffffff; bild.data[i] = i % 4 === 3 ? 255 : a & 255; }
    x.putImageData(bild, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], `rauschen-${saat}.png`, { type: 'image/png' }));
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
    return blob.size;
  }, [saat, w, h]);
};
const kartenStand = (P) => P.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('pixinotes-board') ?? '{}').state;
  return (s?.boards ?? []).map((b) => ({ id: b.id, name: b.name, bilder: b.nodes.filter((n) => n.type === 'image').length, karten: b.nodes.length }));
});

// ---------- ZIP lesen (wie m476) ----------
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

// ---------- Nachgebautes Supabase (Gerüst aus m524, ohne Störsteuerung) ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = { nutzer: new Map(), tokens: new Map(), refresh: new Map(), zeilen: new Map(), sockets: [], objekte: new Map(), n: 0 };
const patchAuf = (brett, p) => {
  for (const art of ['nodes', 'edges', 'drawings', 'comments']) {
    const t = p[art]; if (!t) continue;
    const set = new Map((t.set ?? []).map((o) => [o.id, o])); const del = new Set(t.del ?? []);
    const neu = [];
    for (const o of brett[art] ?? []) { if (del.has(o.id)) continue; if (set.has(o.id)) { neu.push(set.get(o.id)); set.delete(o.id); } else neu.push(o); }
    for (const o of set.values()) if (!del.has(o.id)) neu.push(o);
    brett[art] = neu;
  }
  return brett;
};
const sortiert = (x) => Array.isArray(x) ? x.map(sortiert) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort((p, q) => p.length - q.length || (p < q ? -1 : 1)).map((k) => [k, sortiert(x[k])])) : x;
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const sitzungFuer = (u) => {
  const bis = Date.now() + 3600 * 1000;
  const t = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: u.id, email: u.email, exp: Math.floor(bis / 1000) }))}.sig${++sb.n}`;
  const r = `rt-${++sb.n}`;
  sb.tokens.set(t, { uid: u.id, bis }); sb.refresh.set(r, u.id);
  return { access_token: t, refresh_token: r, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email: u.email } };
};
const uidAus = (req) => { const t = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1]; const e = t && sb.tokens.get(t); return e && e.bis >= Date.now() ? e.uid : null; };
const nutzerVon = (uid) => [...sb.nutzer.values()].find((x) => x.id === uid);
const zeile = (uid, name) => sb.zeilen.get(`${uid}/${name}`);
const melden = (uid, name, type) => {
  for (const s of sb.sockets) {
    if (!s.uid || s.uid !== uid) continue;
    if (!(s.filter ?? []).some((f) => f.table === 'konto_dateien' && f.filter === `user_id=eq.${uid}`)) continue;
    try { s.ws.send(JSON.stringify({ topic: 'realtime:konto', event: 'postgres_changes', payload: { ids: [1], data: { type, schema: 'public', table: 'konto_dateien', record: { name, user_id: uid }, old_record: { name, user_id: uid } } }, ref: null })); } catch { /* zu */ }
  }
};
const schreib = (uid, name, inhalt, mime, groesse) => {
  const z = zeile(uid, name);
  const neu = z ? Object.assign(z, { inhalt, mime, groesse, version: z.version + 1, updated_at: new Date().toISOString() })
    : { user_id: uid, name, inhalt, mime, groesse, version: 1, updated_at: new Date().toISOString() };
  sb.zeilen.set(`${uid}/${name}`, neu);
  melden(uid, name, z ? 'UPDATE' : 'INSERT');
  return neu;
};
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function dienste(ctx, geraet) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) }).catch(() => {});
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const m = req.method(); const pfad = decodeURIComponent(url.pathname);
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    const eq = (k) => /^eq\.(.+)$/.exec(url.searchParams.get(k) ?? '')?.[1];
    if (LAUT && !pfad.startsWith('/auth')) console.log(`    ${zeit()} ${geraet} ${m} ${pfad}`);
    if (pfad === '/auth/v1/signup' && m === 'POST') { const { email, password } = body(); const u = { id: sb.nutzer.get(email)?.id ?? `uid-${++sb.n}`, email, passwort: password }; sb.nutzer.set(email, u); return json(route, 200, sitzungFuer(u)); }
    if (pfad === '/auth/v1/token' && m === 'POST') {
      const art = url.searchParams.get('grant_type');
      if (art === 'password') { const { email, password } = body(); const u = sb.nutzer.get(email); if (!u || u.passwort !== password) return json(route, 400, { error: 'invalid_grant' }); return json(route, 200, sitzungFuer(u)); }
      if (art === 'refresh_token') { const uid = sb.refresh.get(body().refresh_token); if (!uid) return json(route, 400, { error: 'invalid_grant' }); return json(route, 200, sitzungFuer(nutzerVon(uid))); }
    }
    if (pfad === '/auth/v1/user' && m === 'GET') { const uid = uidAus(req); return uid ? json(route, 200, { id: uid, email: nutzerVon(uid)?.email }) : json(route, 401, {}); }
    if (pfad === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    const uid = uidAus(req);
    if (!uid) return json(route, 401, { message: 'JWT expired' });
    const t = /^\/storage\/v1\/object\/(?:authenticated\/)?pixinotes\/(.+)$/.exec(pfad);
    if (t) {
      if (m === 'POST' || m === 'PUT') { sb.objekte.set(t[1], { body: req.postDataBuffer() ?? Buffer.alloc(0), mime: req.headers()['content-type'] ?? 'application/octet-stream' }); return json(route, 200, { Key: `pixinotes/${t[1]}` }); }
      if (m === 'GET') { const o = sb.objekte.get(t[1]); return o ? route.fulfill({ status: 200, contentType: o.mime, headers: cors, body: o.body }) : json(route, 400, { error: 'not found' }); }
      if (m === 'DELETE') { sb.objekte.delete(t[1]); return json(route, 200, {}); }
    }
    if (pfad.startsWith('/storage/v1/')) return json(route, 200, []);
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      const b = body(); const alt = zeile(uid, 'umgebung.json'); const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) return json(route, 400, { code: 'P0001', message: 'vorbedingung' });
      for (const d of b.p_dateien ?? []) schreib(uid, d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0);
      return json(route, 200, schreib(uid, 'umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length).version);
    }
    if (pfad === '/rest/v1/rpc/board_aendern' && m === 'POST') {
      const b = body(); const p = b.p_patch ?? {}; const name = `board-${b.p_board_id}.json`;
      const z = zeile(b.p_besitzer, name);
      if (b.p_besitzer !== uid || !z) return json(route, 400, { code: 'P0002', message: 'kein board' });
      const vor = z.version;
      const neu = schreib(uid, name, JSON.stringify(patchAuf(JSON.parse(z.inhalt), p)), 'application/json', 0);
      const um = zeile(uid, 'umgebung.json'); let umVor = null; let umNeu = null;
      if (um) { umVor = um.version; const u = JSON.parse(um.inhalt); u.boards[b.p_board_id] = `v${neu.version}`; u.savedAt = b.p_saved_at || new Date().toISOString(); u.basisEtag = String(um.version); umNeu = schreib(uid, 'umgebung.json', JSON.stringify(sortiert(u)), 'application/json', 0).version; }
      return json(route, 200, { version: neu.version, vor, umgebung: umNeu, umgebung_vor: umVor });
    }
    if (pfad === '/rest/v1/rpc/freigaben_annehmen' && m === 'POST') return json(route, 200, 0);
    if (pfad === '/rest/v1/rpc/freigaben_fuer_mich' && m === 'POST') return json(route, 200, []);
    if (pfad === '/rest/v1/rpc/board_kanal' && m === 'POST') return json(route, 200, null);
    if (pfad === '/rest/v1/board_freigaben' || pfad === '/rest/v1/board_einladungen') return json(route, 200, []);
    if (pfad === '/rest/v1/konto_dateien') {
      const fName = eq('name'); const select = (url.searchParams.get('select') ?? '*').split(',');
      const projiziere = (z) => (select.includes('*') ? z : Object.fromEntries(select.map((k) => [k, z[k]])));
      const treffer = () => { let x = [...sb.zeilen.values()].filter((z) => z.user_id === uid); if (fName !== undefined) x = x.filter((z) => z.name === fName); return x; };
      if (m === 'GET') return json(route, 200, treffer().map(projiziere));
      if (m === 'DELETE') { for (const z of treffer()) sb.zeilen.delete(`${uid}/${z.name}`); return route.fulfill({ status: 204, headers: cors, body: '' }); }
    }
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const eintrag = { ws, uid: null, filter: [] };
    sb.sockets.push(eintrag);
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (typeof j.topic === 'string' && j.topic.startsWith('realtime:pn-')) return;
      if (j.event === 'phx_join') {
        eintrag.uid = sb.tokens.get(j.payload?.access_token)?.uid ?? null;
        eintrag.filter = j.payload?.config?.postgres_changes ?? [];
        ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: eintrag.filter.map((_, i) => ({ id: i + 1 })) } }, ref: j.ref }));
      } else if (j.event === 'heartbeat') {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
      } else if (j.event === 'access_token') { const e = sb.tokens.get(j.payload?.access_token); if (e) eintrag.uid = e.uid; }
    });
    ws.onClose(() => { sb.sockets = sb.sockets.filter((s) => s !== eintrag); });
  });
}
async function anmelden(P, email, pass, neu) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator(`[data-taste="${neu ? 'konto-neu' : 'konto-passwort'}"]`).click();
  await warteBis(async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0, 15000);
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
}
const SPEICHER_FEHLER = /konnte nicht gespeichert werden|Speicher voll/;

// ══ A: Alter Stand zieht um, neue Bilder sprengen nichts ══════════════════
if (will('A')) {
  console.log('\n════ A: Alter Stand mit eingebetteten Bildern, kleiner localStorage ════');
  const GRENZE = 1_300_000;
  const stand = { boards: [bilderBoard('ba', 'Grafiken', 100), board('bb', 'Notizen', [notiz('nb', 'Zweites Board')])],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['ba', 'bb'] }] }], activeId: 'ba', view: 'board', ...RUHIG };
  const SOLL = new Set(stand.boards[0].nodes.map((n) => n.data.src));
  const vorher = JSON.stringify({ version: 5, state: stand }).length;
  console.log(`    (Stand vorher ${vorher} Zeichen, Grenze ${GRENZE})`);
  const g = await profil({ grenze: GRENZE, stand });
  const umgezogen = await warteBis(async () => grosseDaten(await rohText(g.P)) === 0, 25000);
  const roh = await rohText(g.P);
  pruefe('A1 der gespeicherte Stand trägt keine großen data-URLs mehr (umgezogen in den Datei-Speicher)', umgezogen, `${grosseDaten(roh)} große data-URLs, ${roh.length} Zeichen`);
  pruefe('A2 … und ist klein (unter 5 % des alten Stands)', roh.length < vorher * 0.05, `${roh.length} von ${vorher}`);
  const verweise = (roh.match(/"pixinotes-ablage:[^"]+"/g) ?? []).length;
  const schluessel = (await ablageSchluessel(g.P)).filter((k) => k.startsWith('pixinotes-ablage:'));
  pruefe('A3 je Bild ein Verweis im Text und ein Eintrag im Datei-Speicher', verweise === 8 && schluessel.length === 8, `${verweise} Verweise, ${schluessel.length} Einträge`);
  await neuLaden(g);
  const nach = await bilderAufDemBoard(g.P);
  pruefe('A4 nach dem Neuladen sind alle acht Bilder zu sehen …', nach.length === 8 && nach.every((b) => b.geladen), nach.map((b) => b.geladen));
  pruefe('A5 … Zeichen für Zeichen dieselben (data-URL wie vorher)', nach.length === 8 && nach.every((b) => SOLL.has(b.src)), nach.map((b) => b.src.slice(0, 40)));
  // Ein zweites Fenster liest mit
  const zwei = await g.ctx.newPage();
  await seiteVorbereiten({ toasts: [], fehler: g.fehler }, zwei);
  await zwei.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await zwei.waitForSelector('.react-flow', { timeout: 30000 });
  const zweiBilder = await bilderAufDemBoard(zwei);
  pruefe('A6 ein zweites Fenster zeigt dieselben acht Bilder', zweiBilder.length === 8 && zweiBilder.every((b) => b.geladen && SOLL.has(b.src)), zweiBilder.length);
  await g.P.bringToFront();
  // Neue Bilder: zusammen mehr, als der localStorage fasst
  const groessen = [];
  for (let i = 0; i < 3; i++) {
    groessen.push(await einfuegen(g.P, 900 + i));
    await warteBis(async () => (await bilderAufDemBoard(g.P)).length === 9 + i, 10000);
  }
  console.log(`    (eingefügt: ${groessen.map((x) => `${Math.round(x / 1024)} kB`).join(', ')})`);
  const gespeichert = await warteBis(async () => { const st = await kartenStand(g.P); return st.find((b) => b.id === 'ba')?.bilder === 11 && grosseDaten(await rohText(g.P)) === 0; }, 25000);
  pruefe('A7 die drei neuen Bilder stehen im gespeicherten Stand (als Verweise)', gespeichert, await kartenStand(g.P));
  const zweiNeu = await warteBis(async () => { const b = await bilderAufDemBoard(zwei); return b.length === 11 && b.every((x) => x.geladen && x.src.startsWith('data:')); }, 20000);
  pruefe('A8 das zweite Fenster zeigt die neuen Bilder (aus dem Datei-Speicher, nicht als Verweis)', zweiNeu, (await bilderAufDemBoard(zwei)).map((b) => b.src.slice(0, 22)));
  await zwei.close();
  const neuSrc = new Set((await bilderAufDemBoard(g.P)).map((b) => b.src));
  await neuLaden(g);
  const zuletzt = await bilderAufDemBoard(g.P);
  pruefe('A9 nach dem Neuladen sind alle elf Bilder da – nichts verloren', zuletzt.length === 11 && zuletzt.every((b) => b.geladen && neuSrc.has(b.src)), `${zuletzt.length} Bilder, ${zuletzt.filter((b) => b.geladen).length} geladen`);
  pruefe('A10 kein Hinweis „Speicher voll" unterwegs', !g.toasts.some((t) => SPEICHER_FEHLER.test(t)), g.toasts.filter((t) => SPEICHER_FEHLER.test(t)));
  const zaehler = await g.P.evaluate(() => window.pixinotesSpeicher);
  pruefe('A11 Prüfbetrieb (M525): der gespeicherte Text weicht nie vom Stand ab', zaehler?.abweichungen === 0 && !g.fehler.some((f) => /M525/.test(f)), zaehler);
  pruefe('A12 keine Seitenfehler', g.fehler.length === 0, g.fehler);
  await g.P.screenshot({ path: `${SD}/m532-a-bilder.png` });
  await g.ctx.close();
}

// ══ B: Volles Gerät — dreimal ein Board mit Bildern einlesen ═════════════
if (will('B')) {
  console.log('\n════ B: Dreimal eine .pixiboard.json mit acht Bildern einlesen, Rundreise ════');
  const GRENZE = 1_000_000;
  const datei = path.join(SD, 'm532-board.pixiboard.json');
  const quelle = bilderBoard('bq', 'Campus', 300);
  writeFileSync(datei, JSON.stringify({ app: 'pixinotes-board', version: 2, savedAt: new Date().toISOString(), board: quelle, dateien: {} }));
  const SOLL = new Set(quelle.nodes.map((n) => n.data.src));
  const g = await profil({ grenze: GRENZE, stand: { boards: [board('b0', 'Start', [notiz('n0', 'Start')])], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board', ...RUHIG } });
  for (let i = 0; i < 3; i++) {
    await g.P.locator('input[type="file"]:not([accept])').last().setInputFiles(datei);
    await warteBis(async () => (await g.P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.length)) === 2 + i, 15000);
    await g.P.waitForTimeout(400);
  }
  const voll = await warteBis(async () => { const st = await kartenStand(g.P); return st.filter((b) => b.bilder === 8).length === 3 && grosseDaten(await rohText(g.P)) === 0; }, 30000);
  pruefe('B1 alle drei eingelesenen Boards stehen im gespeicherten Stand (drei mal mehr Bilder, als der localStorage fasst)', voll, await kartenStand(g.P));
  await neuLaden(g);
  let alle = true; let gesamt = 0;
  if (LAUT) console.log('    Seitenleiste:', await g.P.locator('.tabs.spalte .side-board, .tabs.spalte .side-proj-head').allTextContents());
  for (let i = 0; i < 3; i++) {
    const kopf = g.P.locator('.tabs.spalte .side-proj:not(.auf) .side-proj-head').first();
    if (await kopf.count()) { await kopf.click(); await g.P.waitForTimeout(300); }
    await g.P.locator('.tabs.spalte .side-board', { hasText: 'Campus' }).nth(i).click();
    await g.P.waitForTimeout(500);
    await warteBis(async () => (await bilderAufDemBoard(g.P)).filter((x) => x.geladen).length === 8, 10000);
    const bl = await bilderAufDemBoard(g.P);
    gesamt += bl.length;
    if (!(bl.length === 8 && bl.every((x) => x.geladen && SOLL.has(x.src)))) alle = false;
  }
  pruefe('B2 nach dem Neuladen zeigen alle drei Boards ihre acht Bilder – unverändert', alle && gesamt === 24, `${gesamt} Bilder`);
  pruefe('B3 kein Hinweis „Speicher voll"', !g.toasts.some((t) => SPEICHER_FEHLER.test(t)), g.toasts.filter((t) => SPEICHER_FEHLER.test(t)));
  // Rundreise: Sicherung des offenen Boards herunterladen und auf einem frischen Gerät einspielen
  const aktiv = await g.P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.activeId);
  const zeileB = g.P.locator('.side-board.aktiv, .side-board[aria-current="page"]').first();
  const menue = (await zeileB.count()) ? zeileB : g.P.locator('.side-board').filter({ hasText: 'Campus' }).last();
  await menue.locator('.ebenen-menu-knopf').click({ force: true }); await g.P.waitForTimeout(400);
  const [d] = await Promise.all([g.P.waitForEvent('download', { timeout: 20000 }), g.P.locator('[data-taste="board-sicherung"]').click()]);
  const ziel = path.join(SD, 'm532-sicherung.pixinotes'); await d.saveAs(ziel);
  const z = unzip(readFileSync(ziel));
  const m = JSON.parse(z.get('pixinotes.json').toString('utf8'));
  const ausZip = (m.bilder ?? []).map((x) => `${x.kopf},${z.get(x.pfad).toString('base64')}`);
  pruefe('B4 die Sicherung enthält die acht Bilder Byte für Byte (kein Verweis)', ausZip.length === 8 && ausZip.every((s) => SOLL.has(s)) && !readFileSync(ziel).includes('pixinotes-ablage:'), `${ausZip.length} Bilder, Board ${aktiv}`);
  const h = await profil({ grenze: GRENZE, stand: { boards: [board('c0', 'Leer', [])], spaces: [{ id: 's2', name: 'Privat', projects: [{ id: 'p2', name: 'Eigenes', boardIds: ['c0'] }] }], activeId: 'c0', view: 'board', ...RUHIG } });
  await h.P.keyboard.press('Alt+e'); await h.P.waitForSelector('.modal-tabs');
  await h.P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await h.P.waitForTimeout(300);
  await h.P.locator('.modal input[type="file"][accept*="pixinotes"]').first().setInputFiles(ziel);
  await h.P.waitForSelector('[data-taste="sicherung-zahlen"]', { timeout: 10000 });
  await h.P.locator('[data-taste="sicherung-einspielen"]').click();
  await warteBis(async () => (await kartenStand(h.P)).some((b) => b.bilder === 8), 15000);
  await h.P.keyboard.press('Escape');
  await warteBis(async () => grosseDaten(await rohText(h.P)) === 0, 20000);
  await neuLaden(h);
  const ziel2 = (await kartenStand(h.P)).find((b) => b.bilder === 8);
  if (ziel2) await boardOeffnen(h.P, ziel2.name);
  await warteBis(async () => (await bilderAufDemBoard(h.P)).filter((x) => x.geladen).length === 8, 10000);
  const hb = await bilderAufDemBoard(h.P);
  pruefe('B5 eingespielt auf einem frischen Gerät und neu geladen: dieselben acht Bilder', hb.length === 8 && hb.every((x) => x.geladen && SOLL.has(x.src)), hb.length);
  pruefe('B6 keine Seitenfehler', g.fehler.length === 0 && h.fehler.length === 0, [...g.fehler, ...h.fehler]);
  await h.ctx.close();
  await g.ctx.close();
}

// ══ C: Konto-Abgleich auf ein Gerät mit kleinem Speicher ═════════════════
if (will('C')) {
  console.log('\n════ C: Konto-Abgleich – Gerät B fasst die Bilder nicht im localStorage ════');
  const standA = { boards: [bilderBoard('bk', 'Konto-Grafiken', 500, 10)], spaces: [{ id: 'sk', name: 'Arbeit', projects: [{ id: 'pk', name: 'Allgemein', boardIds: ['bk'] }] }], activeId: 'bk', view: 'board', ...RUHIG };
  const SOLL = new Set(standA.boards[0].nodes.map((n) => n.data.src));
  const A = await profil({ grenze: 50_000_000, stand: standA, konto: 'A' });
  await anmelden(A.P, 'anna@example.de', 'geheim123', true);
  const uid = sb.nutzer.get('anna@example.de')?.id ?? '';
  await warteBis(() => !!zeile(uid, 'board-bk.json'), 20000);
  const B = await profil({ grenze: 700_000, konto: 'B', stand: { boards: [board('leer1', 'Neu', [])], spaces: [{ id: 'sl', name: 'Privat', projects: [{ id: 'pl', name: 'Eigenes', boardIds: ['leer1'] }] }], activeId: 'leer1', view: 'board', ...RUHIG } });
  await anmelden(B.P, 'anna@example.de', 'geheim123', false);
  const da = await warteBis(async () => (await kartenStand(B.P)).some((b) => b.id === 'bk' && b.bilder === 10) && grosseDaten(await rohText(B.P)) === 0, 30000);
  pruefe('C1 Gerät B hat das Board mit zehn Bildern gespeichert (Bilder im Datei-Speicher)', da, await kartenStand(B.P));
  pruefe('C2 kein „konnte nicht gespeichert werden" beim Abgleich', !B.toasts.some((t) => SPEICHER_FEHLER.test(t)), B.toasts.filter((t) => SPEICHER_FEHLER.test(t)));
  await neuLaden(B);
  await boardOeffnen(B.P, 'Konto-Grafiken');
  await warteBis(async () => (await bilderAufDemBoard(B.P)).filter((x) => x.geladen).length === 10, 15000);
  const bb = await bilderAufDemBoard(B.P);
  pruefe('C3 nach dem Neuladen zeigt B alle zehn Bilder – unverändert', bb.length === 10 && bb.every((x) => x.geladen && SOLL.has(x.src)), bb.length);
  // Der Abgleich läuft weiter: ein neues Bild von A kommt bei B an
  await einfuegen(A.P, 4711, 480, 360);
  const angekommen = await warteBis(async () => (await bilderAufDemBoard(B.P)).length === 11 && (await bilderAufDemBoard(B.P)).every((x) => x.geladen), 30000);
  pruefe('C4 ein weiteres Bild von A kommt bei B an', angekommen, (await bilderAufDemBoard(B.P)).length);
  const gespeichert = await warteBis(async () => (await kartenStand(B.P)).find((b) => b.id === 'bk')?.bilder === 11 && grosseDaten(await rohText(B.P)) === 0, 20000);
  pruefe('C5 … und steht in B gespeichert (als Verweis)', gespeichert, await kartenStand(B.P));
  const server = JSON.parse(zeile(uid, 'board-bk.json')?.inhalt ?? '{}');
  pruefe('C6 im Konto liegen weiter die ganzen Bilder (ältere Geräte kennen keine Verweise)', (server.nodes ?? []).filter((n) => n.type === 'image').length === 11 && !JSON.stringify(server).includes('pixinotes-ablage:'), (server.nodes ?? []).length);
  pruefe('C7 kein Hinweis „Speicher voll" auf beiden Geräten', ![...A.toasts, ...B.toasts].some((t) => SPEICHER_FEHLER.test(t)), [...A.toasts, ...B.toasts].filter((t) => SPEICHER_FEHLER.test(t)));
  pruefe('C8 keine Seitenfehler', A.fehler.length === 0 && B.fehler.length === 0, [...A.fehler, ...B.fehler]);
  await B.P.screenshot({ path: `${SD}/m532-c-konto.png` });
  await A.ctx.close(); await B.ctx.close();
}

// ══ D: Wirklich voll — die Meldung nennt Grund und Ausweg ═══════════════
if (will('D')) {
  console.log('\n════ D: Speicher wirklich voll (Text, kein Bild) ════');
  const GRENZE = 600_000;
  // ein Board mit viel Text, knapp unter der Grenze
  const stand = { boards: [board('bt', 'Text', [notiz('nt', 'x'.repeat(560_000))])], spaces: [{ id: 'st', name: 'Arbeit', projects: [{ id: 'pt', name: 'Allgemein', boardIds: ['bt'] }] }], activeId: 'bt', view: 'board', ...RUHIG };
  const g = await profil({ grenze: GRENZE, stand, pruefbetrieb: false });
  // mehr Text dazu (über die Grenze): Notizen aus der Zwischenablage (je höchstens 20 000 Zeichen)
  await g.P.locator('.react-flow__pane').click({ position: { x: 900, y: 600 } });
  for (let i = 0; i < 4; i++) {
    await g.P.evaluate((i) => {
      const dt = new DataTransfer(); dt.setData('text/plain', `Absatz ${i} ${'y'.repeat(19_000)}`);
      document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
    }, i);
    await g.P.waitForTimeout(700);
  }
  const gemeldet = await warteBis(() => g.toasts.some((t) => /Speicher voll/.test(t)), 10000);
  pruefe('D1 ein Hinweis sagt, dass der Speicher voll ist', gemeldet, g.toasts);
  pruefe('D2 … und nennt den Ausweg „Alles sichern"', g.toasts.some((t) => /Speicher voll/.test(t) && /Alles sichern/.test(t)), g.toasts.filter((t) => /Speicher/.test(t)));
  await g.ctx.close();
}

// ══ E: Ersatzspeicher — voll durch Text, trotzdem nichts verloren ═══════
if (will('E')) {
  console.log('\n════ E: Ersatzspeicher (IndexedDB), wenn der localStorage voll ist ════');
  const GRENZE = 600_000;
  const stand = { boards: [board('br', 'Text', [notiz('ng', 'x'.repeat(560_000))])], spaces: [{ id: 'sr', name: 'Arbeit', projects: [{ id: 'pr', name: 'Allgemein', boardIds: ['br'] }] }], activeId: 'br', view: 'board', ...RUHIG };
  const g = await profil({ grenze: GRENZE, stand });
  await g.P.locator('.react-flow__pane').click({ position: { x: 900, y: 600 } });
  for (let i = 0; i < 4; i++) {
    await g.P.evaluate((i) => {
      const dt = new DataTransfer(); dt.setData('text/plain', `Absatz ${i} ${'z'.repeat(19_000)}`);
      document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
    }, i);
    await g.P.waitForTimeout(700);
  }
  const karten = () => g.P.locator('.react-flow__node').count();
  pruefe('E0 fünf Karten auf dem Board (eine große, vier eingefügte)', (await karten()) === 5, await karten());
  const gesichert = await warteBis(() => g.toasts.some((t) => /Ersatzspeicher/.test(t)), 15000);
  pruefe('E1 ein Hinweis sagt: voll, aber die Arbeit liegt sicher im Ersatzspeicher – mit den größten Boards', gesichert && g.toasts.some((t) => /Ersatzspeicher/.test(t) && /Größte Boards: Text \(/.test(t)), g.toasts);
  // Noch eine Änderung, während der Speicher voll ist: auch sie landet im Ersatz
  await g.P.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'Nachzügler');
    document.body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
  });
  await warteBis(async () => (await karten()) === 6, 5000);
  await g.P.waitForTimeout(1500);
  if (LAUT) console.log('    vor dem Neuladen:', await g.P.evaluate(() => ({ marke: localStorage.getItem('pixinotes-reserve'), laenge: localStorage.getItem('pixinotes-board').length })), await ablageSchluessel(g.P));
  const vorNeuladen = g.toasts.length;
  await neuLaden(g);
  await warteBis(async () => (await karten()) === 6, 15000);
  pruefe('E2 nach dem Neuladen sind alle sechs Karten da (Stand aus dem Ersatzspeicher)', (await karten()) === 6, await karten());
  // (der Speicher ist weiter voll: der Hinweis „liegt sicher im Ersatzspeicher" kann den Start-Hinweis gleich ablösen)
  pruefe('E3 … und ein Hinweis sagt, dass der Stand aus dem Ersatzspeicher kommt bzw. dort liegt', await warteBis(() => g.toasts.slice(vorNeuladen).some((t) => /Ersatzspeicher/.test(t)), 8000), g.toasts.slice(vorNeuladen));
  pruefe('E4 der Text der letzten Änderung ist da', (await g.P.locator('.react-flow__node', { hasText: 'Nachzügler' }).count()) === 1);
  // Platz schaffen: die große Karte löschen → der localStorage nimmt den Stand wieder, der Ersatz wird überflüssig
  await g.P.locator('.react-flow__node[data-id="ng"] .card-grip').click({ force: true }); await g.P.waitForTimeout(300);
  await g.P.keyboard.press('Delete');
  const frei = await warteBis(async () => { const r = await rohText(g.P); return r.length < GRENZE && !r.includes('"ng"'); }, 15000);
  pruefe('E5 nach dem Löschen steht der Stand wieder im localStorage', frei, (await rohText(g.P)).length);
  const weg = await warteBis(async () => !(await ablageSchluessel(g.P)).includes('pixinotes-stand-reserve') && (await g.P.evaluate(() => localStorage.getItem('pixinotes-reserve'))) !== '1', 10000);
  pruefe('E6 … und der Ersatzspeicher ist geräumt', weg, await ablageSchluessel(g.P));
  await neuLaden(g);
  await g.P.waitForTimeout(1500);
  pruefe('E7 nach dem Neuladen bleibt die gelöschte Karte gelöscht (kein alter Ersatz kommt zurück)', (await karten()) === 5 && (await g.P.locator('.react-flow__node[data-id="ng"]').count()) === 0, await karten());
  const zaehler = await g.P.evaluate(() => window.pixinotesSpeicher);
  pruefe('E8 Prüfbetrieb (M525): keine Abweichung', zaehler?.abweichungen === 0, zaehler);
  pruefe('E9 keine Seitenfehler', g.fehler.length === 0, g.fehler);
  await g.ctx.close();
}

console.log(`\nM532: ${ok} ✓, ${bad} ✗`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
