/**
 * M391 — Team-Audit: Zusammenarbeit ist unkompliziert, und in Ruhe ist wenig zu sehen.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m366).
 *
 *   A  Ohne Konto: Der Menüpunkt ist da; der Dialog sagt, was fehlt, und führt mit EINEM Knopf dorthin.
 *   B  Mit Konto: EIN Hauptknopf legt den Link an — „ohne Konto mitmachen" ist die Vorgabe; alles Weitere ist
 *      eingeklappt; ein Satz sagt, was der Link kann, und folgt den Optionen.
 *   C  Die Leiste zeigt in Ruhe, wer da ist (ein Knopf) und „Reagieren" — sonst nichts. Dahinter stehen die
 *      Werkzeuge mit Namen: Einladen, QR-Code, Vorführen, Mauszeiger, Timer, Namen ändern.
 *   D  Telefon: Die Leiste überdeckt die Kopfzeile nicht; die Liste bleibt im Bild.
 *   E  Gast: keine leeren eigenen Bereiche in der Spalte; am fremden Board kein Umbenennen, Archivieren, Löschen —
 *      dafür „Verlassen".
 *   F  „Nur Eigenes": Die Verbindung der Besitzerin bleibt (löschen, umbeschriften); die eigene trägt den Gast und
 *      lässt sich löschen.
 *   G  Lehnt der Server den Beitritt zum Live-Kanal ab, versucht es die App erneut (vorher: „verbindet …" für immer).
 *   H  Strg+K „Gemeinsam bearbeiten"; Board-Menü nennt die Kopie beim Namen; Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m391-team-audit.mjs`
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

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4705;
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

// ---------- Nachgebautes Supabase (zwei Konten) ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = {
  nutzer: new Map(), tokens: new Map(), refresh: new Map(),
  zeilen: new Map(),      // `${uid}/${name}` → Zeile
  freigaben: [],          // { id, besitzer, board_id, gast_email, gast_id, rolle, created_at }
  einladungen: [],        // { token, besitzer, board_id, rolle, created_at }
  ohneEinladung: false,   // Server ohne Tabelle board_einladungen (Migration fehlt)
  sockets: [], objekte: new Map(), n: 0,
  aufrufe: { freigabeSchreiben: 0, vorbedingung: 0, keineFreigabe: 0, stapel: 0, gastLesen: 0, gastStand: 0, gastSchreiben: 0, gastAbgelehnt: 0, nichtErlaubt: 0, karte: 0, stand: 0, gastAendern: 0, besitzerBoard: 0, delta: 0 },
  ohneAendern: false,     // Server ohne gast_aendern
  // M364
  kanaele: new Map(),     // `${besitzer}/${board}` → Kanalname
  live: [],               // { ws, topic, key, meta } — Broadcast + Presence
  ohneGast: false,        // Server ohne gast_*-Funktionen (Migration fehlt)
  ohneLive: false,        // Der Live-Kanal antwortet nicht (neue Verbindungen)
};
const kanalVon = (besitzer, boardId) => { const k = `${besitzer}/${boardId}`; if (!sb.kanaele.has(k)) sb.kanaele.set(k, `k${++sb.n}${Math.random().toString(36).slice(2, 12)}`); return sb.kanaele.get(k); };
// M366: kartenweise Änderung, wie gast_aendern auf dem Server
const patchAuf = (board, p) => {
  for (const art of ['nodes', 'edges', 'drawings', 'comments']) {
    const t = p[art]; if (!t) continue;
    const set = new Map((t.set ?? []).map((o) => [o.id, o])); const del = new Set(t.del ?? []);
    const neu = [];
    for (const o of board[art] ?? []) { if (del.has(o.id)) continue; if (set.has(o.id)) { neu.push(set.get(o.id)); set.delete(o.id); } else neu.push(o); }
    for (const o of set.values()) if (!del.has(o.id)) neu.push(o);
    board[art] = neu;
  }
  return board;
};
const serverAendern = (e, p) => {
  const name = `board-${e.board_id}.json`;
  const z = zeile(e.besitzer, name);
  const vor = z.version;
  const neu = schreib(e.besitzer, name, JSON.stringify(patchAuf(JSON.parse(z.inhalt), p)), 'application/json', 0);
  const um = zeile(e.besitzer, 'umgebung.json');
  if (um) { const u = JSON.parse(um.inhalt); u.boards[e.board_id] = `v${neu.version}`; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version); schreib(e.besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
  return { version: neu.version, vor };
};
const liveAn = (topic, nachricht, ausser = null) => { for (const s of sb.live) if (s.topic === topic && s !== ausser) { try { s.ws.send(JSON.stringify(nachricht)); } catch { /* zu */ } } };
/** Ein Teilnehmer, den es als Gerät nicht gibt (für die Sicherheitsprüfung) */
const fakeDa = (topic, key, meta) => liveAn(topic, { topic, event: 'presence_diff', payload: { joins: { [key]: { metas: [meta] } }, leaves: {} }, ref: null });
const fakeWeg = (topic, key, meta) => liveAn(topic, { topic, event: 'presence_diff', payload: { joins: {}, leaves: { [key]: { metas: [meta] } } }, ref: null });
const fakeSenden = (topic, ereignis, inhalt) => liveAn(topic, { topic, event: 'broadcast', payload: { type: 'broadcast', event: ereignis, payload: inhalt }, ref: null });
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (u, bis) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: u.id, email: u.email, exp: Math.floor(bis / 1000) }))}.sig`;
const sitzungFuer = (u, lebensdauerS = 3600) => {
  const bis = Date.now() + lebensdauerS * 1000;
  const t = jwt(u, bis), r = `rt-${++sb.n}`;
  sb.tokens.set(t, { uid: u.id, bis }); sb.refresh.set(r, u.id);
  return { access_token: t, refresh_token: r, expires_in: lebensdauerS, token_type: 'bearer', user: { id: u.id, email: u.email } };
};
const uidAus = (req) => {
  const t = /^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1];
  const e = t && sb.tokens.get(t);
  return e && e.bis >= Date.now() ? e.uid : null;
};
const nutzerVon = (uid) => [...sb.nutzer.values()].find((x) => x.id === uid);
const zeilenVon = (uid) => [...sb.zeilen.values()].filter((z) => z.user_id === uid);
const zeile = (uid, name) => sb.zeilen.get(`${uid}/${name}`);
const zeileText = (uid, name) => zeile(uid, name)?.inhalt ?? '';
const nutzerId = (email) => sb.nutzer.get(email)?.id;
const freigabeFuer = (besitzer, boardId, gastId) => sb.freigaben.find((f) => f.besitzer === besitzer && f.board_id === boardId && f.gast_id === gastId);
const istGeteiltMit = (besitzer, name, gastId) => { const m = /^board-(.+)\.json$/.exec(name); return !!m && !!freigabeFuer(besitzer, m[1], gastId); };
/** Realtime: an alle Kanäle, deren Filter die Zeile sehen dürfen (RLS nachgestellt) */
const melden = (uid, name, type, tabelle = 'konto_dateien', zeileRoh = null) => {
  for (const s of sb.sockets) {
    if (!s.uid) continue;
    const passt = (s.filter ?? []).some((f) => {
      if (f.table !== tabelle) return false;
      if (tabelle === 'konto_dateien') {
        if (f.filter !== `user_id=eq.${uid}`) return false;
        return s.uid === uid || istGeteiltMit(uid, name, s.uid);
      }
      const [, feld, wert] = /^(\w+)=eq\.(.+)$/.exec(f.filter ?? '') ?? [];
      return !!zeileRoh && zeileRoh[feld] === wert;
    });
    if (!passt) continue;
    const record = tabelle === 'konto_dateien' ? { name, user_id: uid } : zeileRoh;
    s.ws.send(JSON.stringify({ topic: 'realtime:konto', event: 'postgres_changes', payload: { ids: [1], data: { type, schema: 'public', table: tabelle, record, old_record: record } }, ref: null }));
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
async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const pfad = url.pathname;
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    const eq = (k) => /^eq\.(.+)$/.exec(url.searchParams.get(k) ?? '')?.[1];
    if ((req.headers()['apikey'] ?? '') !== SB_KEY) return json(route, 401, { message: 'No API key found in request' });
    // ---- Auth ----
    if (pfad === '/auth/v1/signup' && m === 'POST') {
      const { email, password } = body();
      const u = { id: sb.nutzer.get(email)?.id ?? `uid-${++sb.n}`, email, passwort: password };
      sb.nutzer.set(email, u);
      return json(route, 200, sitzungFuer(u));
    }
    if (pfad === '/auth/v1/token' && m === 'POST') {
      const art = url.searchParams.get('grant_type');
      if (art === 'password') {
        const { email, password } = body();
        const u = sb.nutzer.get(email);
        if (!u || u.passwort !== password) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return json(route, 200, sitzungFuer(u));
      }
      if (art === 'refresh_token') {
        const uid = sb.refresh.get(body().refresh_token);
        if (!uid) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return json(route, 200, sitzungFuer(nutzerVon(uid)));
      }
    }
    if (pfad === '/auth/v1/user' && m === 'GET') { const uid = uidAus(req); return uid ? json(route, 200, { id: uid, email: nutzerVon(uid)?.email }) : json(route, 401, {}); }
    if (pfad === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    // ---- M364: Gäste ohne Konto — nur das Token zählt (öffentlicher Schlüssel genügt) ----
    if (/^\/rest\/v1\/rpc\/gast_/.test(pfad) && m === 'POST') {
      if (sb.ohneGast) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
      const b = body();
      const e = sb.einladungen.find((x) => x.token === b.p_token && x.ohne_konto);
      const name = e && `board-${e.board_id}.json`;
      const z = e && zeile(e.besitzer, name);
      if (pfad.endsWith('/gast_lesen')) {
        sb.aufrufe.gastLesen += 1;
        if (!z) return json(route, 200, null);
        return json(route, 200, { board_id: e.board_id, rolle: e.rolle, besitzer: e.besitzer, inhalt: z.inhalt, version: z.version, dateien: e.dateien ?? [], kanal: kanalVon(e.besitzer, e.board_id), optionen: e.optionen ?? {} });
      }
      if (pfad.endsWith('/gast_stand')) {
        sb.aufrufe.gastStand += 1;
        return json(route, 200, z ? { version: z.version, rolle: e.rolle, optionen: e.optionen ?? {} } : null);
      }
      if (pfad.endsWith('/gast_aendern')) {
        if (sb.ohneAendern) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function' });
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        sb.aufrufe.gastAendern += 1;
        return json(route, 200, serverAendern(e, b.p_patch));
      }
      if (pfad.endsWith('/gast_schreiben')) {
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        if (b.p_wenn_version == null || String(z.version) !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
        {
          // M365: wie gast_schreiben auf dem Server — Karten, die nicht von einem Gast per Link stammen
          const recht = e.optionen?.gastRecht ?? 'alles';
          if (recht !== 'alles') {
            const alt = JSON.parse(z.inhalt).nodes ?? []; const nn = JSON.parse(b.p_inhalt).nodes ?? [];
            const N = new Map(nn.map((n) => [n.id, n])); const A = new Map(alt.map((n) => [n.id, n]));
            const gast = (n) => String(n.data?.von ?? '').startsWith('g:');
            const J = (x) => JSON.stringify(x ?? null);
            const verstoss = alt.some((x) => { if (gast(x)) return false; const n = N.get(x.id); return !n || !!n.archived !== !!x.archived || n.data?.von !== x.data?.von || (recht === 'eigenes' && (J(n.data) !== J(x.data) || J(n.position) !== J(x.position))); })
              || nn.some((n) => !A.has(n.id) && !gast(n));
            if (verstoss) { sb.aufrufe.nichtErlaubt += 1; return json(route, 400, { code: 'P0004', message: 'nicht erlaubt' }); }
          }
        }
        sb.aufrufe.gastSchreiben += 1;
        const neu = schreib(e.besitzer, name, b.p_inhalt, 'application/json', String(b.p_inhalt).length);
        const um = zeile(e.besitzer, 'umgebung.json');
        if (um) { const u = JSON.parse(um.inhalt); u.boards[e.board_id] = b.p_stempel; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version); schreib(e.besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
        return json(route, 200, neu.version);
      }
    }
    const uid = uidAus(req);
    if (!uid) return json(route, 401, { message: 'JWT expired' });
    const ich = nutzerVon(uid);
    if (pfad === '/rest/v1/rpc/board_kanal' && m === 'POST') {
      const b = body();
      if (b.p_besitzer !== uid && !freigabeFuer(b.p_besitzer, b.p_board_id, uid)) return json(route, 200, null);
      return json(route, 200, { kanal: kanalVon(b.p_besitzer, b.p_board_id), optionen: sb.einladungen.find((x) => x.besitzer === b.p_besitzer && x.board_id === b.p_board_id)?.optionen ?? {} });
    }
    // ---- RPCs ----
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      sb.aufrufe.stapel += 1;
      const b = body();
      const alt = zeile(uid, 'umgebung.json');
      const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      if ((b.p_dateien ?? []).some((d) => d.name === 'board-bx.json')) sb.aufrufe.besitzerBoard += 1;
      for (const d of b.p_dateien ?? []) schreib(uid, d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0);
      const u = schreib(uid, 'umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length);
      return json(route, 200, u.version);
    }
    if (pfad === '/rest/v1/rpc/freigaben_annehmen' && m === 'POST') {
      let n = 0;
      for (const f of sb.freigaben) {
        if (!f.gast_id && f.gast_email.toLowerCase() === (ich?.email ?? '').toLowerCase()) { f.gast_id = uid; n += 1; melden(uid, '', 'UPDATE', 'board_freigaben', f); }
      }
      return json(route, 200, n);
    }
    if (pfad === '/rest/v1/rpc/freigaben_fuer_mich' && m === 'POST') {
      return json(route, 200, sb.freigaben.filter((f) => f.gast_id === uid).map((f) => ({ besitzer: f.besitzer, besitzer_email: nutzerVon(f.besitzer)?.email, board_id: f.board_id, rolle: f.rolle })));
    }
    if (pfad === '/rest/v1/rpc/freigabe_schreiben' && m === 'POST') {
      sb.aufrufe.freigabeSchreiben += 1;
      const b = body();
      const f = freigabeFuer(b.p_besitzer, b.p_board_id, uid);
      if (!f || f.rolle !== 'bearbeiten') { sb.aufrufe.keineFreigabe += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
      const name = `board-${b.p_board_id}.json`;
      const alt = zeile(b.p_besitzer, name);
      if (b.p_wenn_version !== null && String(alt?.version ?? '') !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
      const neu = schreib(b.p_besitzer, name, b.p_inhalt, 'application/json', String(b.p_inhalt).length);
      const um = zeile(b.p_besitzer, 'umgebung.json');
      if (um) { const u = JSON.parse(um.inhalt); u.boards[b.p_board_id] = b.p_stempel; u.savedAt = new Date().toISOString(); schreib(b.p_besitzer, 'umgebung.json', JSON.stringify(u), 'application/json', 0); }
      return json(route, 200, neu.version);
    }
    // ---- board_freigaben ----
    if (pfad === '/rest/v1/board_freigaben') {
      const sichtbar = sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid || f.gast_email.toLowerCase() === (ich?.email ?? '').toLowerCase());
      const filt = (liste) => liste.filter((f) => (!eq('board_id') || f.board_id === eq('board_id')) && (!eq('besitzer') || f.besitzer === eq('besitzer')) && (!eq('gast_id') || f.gast_id === eq('gast_id')) && (!eq('id') || f.id === eq('id')));
      if (m === 'GET') return json(route, 200, filt(sichtbar));
      if (m === 'POST') {
        const b = body();
        let f = sb.freigaben.find((x) => x.besitzer === uid && x.board_id === b.board_id && x.gast_email === b.gast_email);
        if (!f) { f = { id: `fg-${++sb.n}`, besitzer: uid, board_id: b.board_id, gast_email: b.gast_email, gast_id: null, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString() }; sb.freigaben.push(f); melden(uid, '', 'INSERT', 'board_freigaben', f); }
        return json(route, 201, [f]);
      }
      if (m === 'PATCH') {
        for (const f of filt(sb.freigaben.filter((x) => x.besitzer === uid))) { Object.assign(f, { rolle: body().rolle }); melden(uid, '', 'UPDATE', 'board_freigaben', f); }
        return route.fulfill({ status: 204, body: '' });
      }
      if (m === 'DELETE') {
        const weg = filt(sb.freigaben.filter((f) => f.besitzer === uid || f.gast_id === uid));
        sb.freigaben = sb.freigaben.filter((f) => !weg.includes(f));
        for (const f of weg) melden(uid, '', 'DELETE', 'board_freigaben', f);
        return route.fulfill({ status: 204, body: '' });
      }
    }
    // ---- board_einladungen (M360) ----
    if (pfad === '/rest/v1/board_einladungen') {
      if (sb.ohneEinladung) return json(route, 404, { code: 'PGRST205', message: "Could not find the table 'public.board_einladungen'" });
      const meine = () => sb.einladungen.filter((e) => e.besitzer === uid && (!eq('board_id') || e.board_id === eq('board_id')));
      if (m === 'GET') return json(route, 200, meine());
      if (m === 'POST') {
        const b = body();
        let e = sb.einladungen.find((x) => x.besitzer === uid && x.board_id === b.board_id);
        if (e) Object.assign(e, { rolle: b.rolle }); else { e = { token: b.token, besitzer: uid, board_id: b.board_id, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString(), ohne_konto: false, dateien: [] }; sb.einladungen.push(e); }
        if ('ohne_konto' in b) e.ohne_konto = !!b.ohne_konto;
        if ('optionen' in b) e.optionen = b.optionen;
        return json(route, 201, [e]);
      }
      if (m === 'PATCH') { for (const e of sb.einladungen.filter((x) => x.besitzer === uid && x.token === eq('token'))) Object.assign(e, body()); return route.fulfill({ status: 204, body: '' }); }
      if (m === 'DELETE') { const weg = meine(); sb.einladungen = sb.einladungen.filter((e) => !weg.includes(e)); return route.fulfill({ status: 204, body: '' }); }
    }
    if (pfad === '/rest/v1/rpc/einladung_annehmen' && m === 'POST') {
      if (sb.ohneEinladung) return json(route, 404, { message: 'Could not find the function' });
      const e = sb.einladungen.find((x) => x.token === body().p_token);
      if (!e) return json(route, 200, null);
      if (e.besitzer === uid) return json(route, 200, { board_id: e.board_id, rolle: e.rolle, eigen: true });
      const mail = (ich?.email ?? '').toLowerCase();
      let f = sb.freigaben.find((x) => x.besitzer === e.besitzer && x.board_id === e.board_id && x.gast_email === mail);
      if (f) f.gast_id = uid; else { f = { id: `fg-${++sb.n}`, besitzer: e.besitzer, board_id: e.board_id, gast_email: mail, gast_id: uid, rolle: e.rolle, created_at: new Date().toISOString() }; sb.freigaben.push(f); }
      melden(uid, '', 'INSERT', 'board_freigaben', f);
      return json(route, 200, { board_id: e.board_id, rolle: f.rolle, eigen: false, besitzer_email: nutzerVon(e.besitzer)?.email });
    }
    // ---- konto_dateien ----
    if (pfad === '/rest/v1/konto_dateien') {
      const fName = eq('name');
      const fUser = eq('user_id');
      const select = (url.searchParams.get('select') ?? '*').split(',');
      const projiziere = (z) => (select.includes('*') ? z : Object.fromEntries(select.map((k) => [k, z[k]])));
      let treffer;
      if (fUser && fUser !== uid) treffer = zeilenVon(fUser).filter((z) => istGeteiltMit(fUser, z.name, uid));
      else treffer = zeilenVon(uid);
      if (fName !== undefined) treffer = treffer.filter((z) => z.name === fName);
      if (m === 'GET') return json(route, 200, treffer.map(projiziere));
      if (m === 'DELETE') { for (const z of treffer) if (z.user_id === uid) sb.zeilen.delete(`${uid}/${z.name}`); return route.fulfill({ status: 204, body: '' }); }
      return json(route, 405, { message: 'nur GET/DELETE im Mock' });
    }
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const eintrag = { ws, uid: null, filter: [] };
    sb.sockets.push(eintrag);
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      // ---- M364: Broadcast + Presence auf den Board-Kanälen ----
      if (typeof j.topic === 'string' && j.topic.startsWith('realtime:pn-')) {
        if (j.event === 'phx_join') {
          if (sb.ohneLive) return;
          if (sb.beitrittAblehnen > 0) { sb.beitrittAblehnen -= 1; sb.abgelehnt = (sb.abgelehnt ?? 0) + 1; ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'error', response: { reason: 'zu viele' } }, ref: j.ref })); return; }
          const l = { ws, topic: j.topic, key: j.payload?.config?.presence?.key ?? `k${++sb.n}`, meta: null };
          sb.live.push(l); eintrag.live = l;
          ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [] } }, ref: j.ref }));
          const state = {};
          for (const s of sb.live) if (s.topic === j.topic && s.meta) state[s.key] = { metas: [s.meta] };
          ws.send(JSON.stringify({ topic: j.topic, event: 'presence_state', payload: state, ref: null }));
        } else if (j.event === 'presence' && j.payload?.event === 'track' && eintrag.live) {
          const l = eintrag.live;
          const alt = l.meta; l.meta = j.payload.payload;
          liveAn(l.topic, { topic: l.topic, event: 'presence_diff', payload: { joins: { [l.key]: { metas: [l.meta] } }, leaves: alt ? { [l.key]: { metas: [alt] } } : {} }, ref: null });
        } else if (j.event === 'broadcast' && eintrag.live) {
          if (j.payload?.event === 'karte') sb.aufrufe.karte += 1;
          if (j.payload?.event === 'stand') sb.aufrufe.stand += 1;
          if (j.payload?.event === 'delta') sb.aufrufe.delta += 1;
          liveAn(eintrag.live.topic, { topic: eintrag.live.topic, event: 'broadcast', payload: j.payload, ref: null }, eintrag.live);
        }
        return;
      }
      if (j.event === 'phx_join') {
        const e = sb.tokens.get(j.payload?.access_token);
        eintrag.uid = e?.uid ?? null;
        eintrag.filter = j.payload?.config?.postgres_changes ?? [];
        ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: eintrag.filter.map((_, i) => ({ id: i + 1 })) } }, ref: j.ref }));
      } else if (j.event === 'heartbeat') {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
      } else if (j.event === 'access_token') {
        const e = sb.tokens.get(j.payload?.access_token); if (e) eintrag.uid = e.uid;
      }
    });
    ws.onClose(() => {
      sb.sockets = sb.sockets.filter((s) => s !== eintrag);
      const l = eintrag.live;
      if (l) { sb.live = sb.live.filter((s) => s !== l); if (l.meta) liveAn(l.topic, { topic: l.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [l.key]: { metas: [l.meta] } } }, ref: null }); }
    });
  });
}

// ---------- Geräte ----------
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [{ ...board('bx', 'Planung', [note('x1', 'Planung Notiz', 80, 120), note('x2', 'Zweite Notiz', 520, 120)]), edges: [{ id: 'e1', source: 'x1', target: 'x2', type: 'labeled', data: { label: 'führt zu', kind: 'arrow' } }] }, board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'by'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
const fremd = [];
async function geraet(name, stand, anker = '', opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: opt.dunkel ? 'dark' : 'light', ...(opt.telefon ? { hasTouch: true, isMobile: true } : {}) });
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith(SB_URL) && !/^(data|blob|about):/.test(u)) fremd.push(u); });
  if (opt.sprache) await ctx.addInitScript((s) => { try { localStorage.setItem('pixinotes-sprache', s); } catch { /* egal */ } }, opt.sprache);
  if (opt.ich) await ctx.addInitScript((i) => { try { if (!localStorage.getItem('pixinotes-gast-ich')) localStorage.setItem('pixinotes-gast-ich', i); } catch { /* egal */ } }, opt.ich);
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => console.log(`    PAGEERROR[${name}]:`, e.message));
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const texte = (P) => zustand(P).then((s) => JSON.stringify(s.boards));
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
const toast = (P) => P.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
const knoten = (P) => P.locator('.react-flow__node').count();
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(200); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function anmelden(P, email, pass, neu) {
  await kontoPanel(P);
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator(`[data-taste="${neu ? 'konto-neu' : 'konto-passwort'}"]`).click();
  await warteBis(P, async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0, 10000);
  await P.waitForTimeout(400);
  await schliessen(P);
}
/** Ein zugeklapptes Projekt in der Spalte öffnen */
async function aufklappen(P, projekt) {
  const kopf = P.locator('.tabs.spalte .side-proj:not(.auf) .side-proj-head', { hasText: projekt }).first();
  if (await kopf.count()) { await kopf.click(); await P.waitForTimeout(400); }
}
async function boardWechseln(P, name, projekt) {
  if (projekt) await aufklappen(P, projekt);
  await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click(); await P.waitForTimeout(700);
}
async function notiz(P, text, x = 900, y = 500) {
  const vorher = await P.locator('.react-flow__node').count();
  await P.mouse.dblclick(x, y);
  // M484: zusätzlich auf den Cursor in der neuen Notiz warten – unter Last kam er nach den 700 ms, der Rückfall-Klick
  // traf dann die Hülle einer anderen Karte und hing 30 s (m366 TimeoutError)
  await P.waitForTimeout(700);
  await P.waitForFunction(() => document.activeElement?.getAttribute('contenteditable') === 'true', null, { timeout: 8000 }).catch(() => {});
  const aktiv = await P.evaluate(() => document.activeElement?.getAttribute('contenteditable') === 'true');
  if (!aktiv) { await P.locator('.react-flow__node').last().locator('[contenteditable="true"]').first().click(); await P.waitForTimeout(300); }
  await P.keyboard.type(text, { delay: 20 });
  await P.waitForTimeout(300);
  await P.keyboard.press('Escape');
  await P.waitForTimeout(200);
  return (await P.locator('.react-flow__node').count()) === vorher + 1;
}


const texteVon = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.textContent).join(' | '));
const band = (P) => P.locator('[data-taste="lese-band"]').count();
/** Eine freie Stelle der Leinwand suchen (keine Karte, kein Bedienelement) und dort eine Notiz anlegen */
async function notizFrei(P, text) {
  const [x, y] = await P.evaluate(() => {
    const karten = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    for (let yy = 220; yy <= 660; yy += 40) {
      for (let xx = 1300; xx >= 520; xx -= 40) {
        if (karten.some((r) => xx > r.left - 30 && xx < r.right + 30 && yy > r.top - 30 && yy < r.bottom + 30)) continue;
        const el = document.elementFromPoint(xx, yy);
        if (el?.classList.contains('react-flow__pane')) return [xx, yy];
      }
    }
    return [1300, 240];
  });
  return notiz(P, text, x, y);
}
async function dialogOeffnen(P, name) {
  const z = P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  await z.hover(); await P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600);
}

const sperre = (P, karte) => P.locator(`[data-taste="live-sperre"][data-karte="${karte}"]`);
const zahl = (P) => P.locator('[data-taste="live-zahl"]').textContent().catch(() => '');
const chipNamen = (P) => P.evaluate(() => [...document.querySelectorAll('[data-taste="live-chip"]')].map((c) => c.dataset.name));
const karteEl = (P, text) => P.locator('.react-flow__node', { hasText: text }).first();
/** In eine Notiz hineinklicken: Der Editor entsteht erst beim Anfassen (vorher steht dort die ruhende Ansicht) */
const inKarte = async (P, text) => {
  const k = karteEl(P, text);
  await k.locator('.note-editor').first().click({ position: { x: 24, y: 12 } }); await P.waitForTimeout(500);
  const ed = k.locator('[contenteditable="true"]').first();
  if ((await ed.count()) && !(await P.evaluate(() => !!document.activeElement?.isContentEditable))) { await ed.click({ position: { x: 24, y: 12 } }).catch(() => {}); await P.waitForTimeout(350); }
  return P.evaluate(() => !!document.activeElement?.isContentEditable && !!document.activeElement.closest('.react-flow__node'));
};
const heraus = async (P) => { await P.keyboard.press('Escape'); await P.waitForTimeout(150); await P.evaluate(() => document.activeElement?.blur?.()); await P.waitForTimeout(350); };
/** Eine Stelle suchen, an der eine ganze neue Karte Platz hat (auch neben Karten, die erst vom anderen Gerät kamen) */
async function notizPlatz(P, text) {
  const [x, y] = await P.evaluate(() => {
    const karten = [...document.querySelectorAll('.react-flow__node')].map((n) => n.getBoundingClientRect());
    for (const [rechts, hoch] of [[300, 150], [60, 60]]) {   // erst mit Platz für die ganze Karte, sonst wenigstens neben den anderen
      for (let yy = 200; yy <= 800; yy += 30) {
        for (let xx = 1150; xx >= 480; xx -= 30) {   // nicht zu weit außen: Auf dem anderen Gerät läge die Karte sonst unter der Spalte
          if (karten.some((r) => xx + rechts > r.left && xx - 60 < r.right && yy + hoch > r.top && yy - 50 < r.bottom)) continue;
          const el = document.elementFromPoint(xx, yy);
          if (el?.classList.contains('react-flow__pane')) return [xx, yy];
        }
      }
    }
    return [1150, 800];
  });
  return notiz(P, text, x, y);
}
const reihe = (text) => { try { return JSON.parse(text).nodes.map((n) => n.id).join(','); } catch { return '?'; } };
const gastEintrag = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-gast') ?? '{}'));
const bxServer = () => zeileText(uidA, 'board-bx.json');

const gastEintragRecht = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-gast') ?? '{}').bx?.recht ?? '');
const serverKarte = (text) => { try { return JSON.parse(bxServer()).nodes.find((n) => JSON.stringify(n.data).includes(text)); } catch { return undefined; } };
const hat = async (P, text) => JSON.stringify(await boardVon(P, 'bx')).includes(text);
/** Ein Punkt, an dem man genau DIESE Karte greift (nicht ihren Text, keine Nachbarkarte, die darüber liegt) */
const greifpunkt = (P, text) => P.evaluate((t) => {
  const karte = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent.includes(t));
  if (!karte) return null;
  const r = karte.getBoundingClientRect();
  for (const dy of [7, 9, 5, 11, r.height - 7]) {
    for (let dx = 14; dx < r.width - 14; dx += 12) {
      const el = document.elementFromPoint(r.left + dx, r.top + dy);
      // nicht der Text, kein Knopf — und kein Größen-Griff (der säße bei gewählter Karte am Rand)
      if (el && el.closest('.react-flow__node') === karte && !el.closest('.nodrag, button, input, [contenteditable="true"], .react-flow__resize-control')) return [r.left + dx, r.top + dy];
    }
  }
  return null;
}, text);
/** Karte auswählen, ohne hineinzuschreiben */
const waehlen = async (P, text) => { const g = await greifpunkt(P, text); await P.mouse.click(g[0], g[1]); await P.waitForTimeout(350); };
/** Karte ziehen; meldet, ob sich ihre Lage im Speicher geändert hat */
const ziehen = async (P, text, dx, dy) => {
  const lage = async () => JSON.stringify((await boardVon(P, 'bx')).nodes.find((n) => JSON.stringify(n.data).includes(text))?.position);
  const vorher = await lage();
  const g = await greifpunkt(P, text);
  await P.mouse.move(g[0], g[1]); await P.mouse.down(); await P.mouse.move(g[0] + dx / 2, g[1] + dy / 2, { steps: 6 }); await P.mouse.move(g[0] + dx, g[1] + dy, { steps: 6 }); await P.mouse.up();
  return warteBis(P, async () => (await lage()) !== vorher, 3000);   // der Speicher schreibt mit kurzer Verzögerung
};
const leer = async (P) => { await heraus(P); await P.mouse.click(1360, 430); await P.waitForTimeout(300); };
const ruhe = (P) => P.waitForTimeout(2700);   // „tippt gerade" verklingt (der Abgleich wartet darauf)

const idsVon = (text) => { try { return JSON.parse(text).nodes.map((n) => n.id).sort().join(','); } catch { return '?'; } };
const idsLokal = async (P) => (await boardVon(P, 'bx')).nodes.map((n) => n.id).sort().join(',');
const karteF = (id, text, i, von) => ({ id, type: 'note', width: 200, position: { x: 500 + (i % 12) * 230, y: 700 + Math.floor(i / 12) * 150 }, data: { color: 'yellow', von, blocks: [{ type: 'paragraph', content: text }] } });
/** Ein simulierter Gast ändert das Board (wie gast_aendern) und sagt es dem Kanal */
const fakeAendern = (p, { senden = true, mitInhalt = true } = {}) => {
  const r = serverAendern(sb.einladungen[0], p);
  if (senden) fakeSenden(topic, 'delta', mitInhalt ? { v: r.version, vor: r.vor, p } : { v: r.version, vor: r.vor });
  return r;
};
const gleichServer = async (P) => (await idsLokal(P)) === idsVon(bxServer());

// Drei Kennungen, die von sich aus dieselbe Farbe mitbringen (dieselbe Rechnung wie in lib/gastSync.ts)
const farbNr = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8; };
const gleicheFarbe = (vorn, nr) => { for (let i = 0; i < 5000; i += 1) { const id = `${vorn}${String(i).padStart(6, '0')}`; if (farbNr(id) === nr) return id; } return `${vorn}000000`; };
const ICH_A = 'anna000001'; const ICH_G = gleicheFarbe('gerd', farbNr(ICH_A)); const ICH_H = gleicheFarbe('hann', farbNr(ICH_A));
/** Wer steht in der Leiste, in welcher Farbe? (ich selbst unter „ich") */
/** Was im Dialog bzw. in der Leiste wirklich zu sehen ist (eingeklappte Optionen zählen nicht) */
const zuSehen = (P, wurzel) => P.evaluate((w) => [...document.querySelectorAll(`${w} button, ${w} input, ${w} select, ${w} summary`)]
  .filter((e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }) : e.getClientRects().length > 0) && !e.closest('details:not([open]) > :not(summary)'))
  .map((e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || e.tagName).trim().slice(0, 40)), wurzel);
const woerter = async (P, sel) => (await P.locator(sel).innerText()).split(/\s+/).filter(Boolean).length;
const satz = (P) => P.locator('[data-taste="einladung-satz"]').innerText();
const listeAuf = async (P, tippen = false) => { if (!(await P.locator('[data-taste="live-liste"]').count())) { if (tippen) await P.locator('[data-taste="live-auf"]').tap(); else await P.locator('[data-taste="live-auf"]').click(); await P.waitForTimeout(300); } };
const listeZu = async (P) => { if (await P.locator('[data-taste="live-liste"]').count()) { await P.locator('[data-taste="live-auf"]').click(); await P.waitForTimeout(200); } };
const eintraege = (P) => P.evaluate(() => [...document.querySelectorAll('[data-taste="live-liste"] .live-liste-aktionen > button, [data-taste="live-liste"] .timer-zeile-titel')].map((e) => e.textContent.trim()));
const kantenServer = () => { try { return JSON.parse(bxServer()).edges ?? []; } catch { return []; } };
const kanten = async (P) => (await boardVon(P, 'bx')).edges;
/** Die Mitte einer Verbindung auf dem Bildschirm — dort wird sie angeklickt */
const kantenMitte = (P, id) => P.evaluate((i) => {
  const p = document.querySelector(`.react-flow__edge[data-id="${i}"] path.react-flow__edge-path, .react-flow__edge[data-id="${i}"] path`);
  if (!p) return null;
  const pt = p.getPointAtLength(p.getTotalLength() / 2).matrixTransform(p.getScreenCTM());
  return [pt.x, pt.y];
}, id);
const kanteLoeschen = async (P, id) => { const m = await kantenMitte(P, id); if (!m) return false; await P.mouse.click(m[0], m[1]); await P.waitForTimeout(300); await P.keyboard.press('Delete'); await P.waitForTimeout(900); return true; };
let uidA = '';

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: ohne Konto ════');
const A = await geraet('A', standA, '', { ich: ICH_A });
{
  const z = A.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
  await z.hover(); await z.locator('.ebenen-menu-knopf').click(); await A.P.waitForTimeout(300);
  const menue = await A.P.evaluate(() => [...document.querySelectorAll('.ebenen-menu button')].map((b) => b.textContent.trim()));
  pruefe('A1 das Board-Menü bietet „Gemeinsam bearbeiten …" – auch ohne Konto (vorher fehlte der Punkt)', menue.some((t) => /Gemeinsam bearbeiten/.test(t)), JSON.stringify(menue));
  pruefe('A2 … und nennt die Kopie beim Namen: „Kopie per Link teilen …"', menue.some((t) => /^Kopie per Link teilen/.test(t)), JSON.stringify(menue));
  await A.P.locator('[data-taste="board-freigeben"]').click(); await A.P.waitForTimeout(500);
  const sicht = await zuSehen(A.P, '.freigabe-dialog');
  pruefe('A3 der Dialog sagt, was fehlt, und hat genau EINEN Knopf (neben Schließen)', JSON.stringify(sicht) === JSON.stringify(['Schließen', 'Anmelden oder Konto anlegen']) && /ohne Konto/.test(await A.P.locator('[data-taste="freigabe-ohne-konto"]').innerText()), JSON.stringify(sicht));
  await A.P.locator('[data-taste="freigabe-anmelden"]').click(); await A.P.waitForTimeout(700);
  pruefe('A4 der Knopf führt zur Anmeldung (Einstellungen → Konto)', (await A.P.locator('.freigabe-dialog').count()) === 0 && await A.P.locator('[data-taste="konto-email"]').isVisible().catch(() => false));
  await schliessen(A.P);
}
{
  await A.P.locator('.dock .dock-add-wrap').last().locator('button').first().click(); await A.P.waitForTimeout(350);
  const da = (await A.P.locator('.dock-menu-more [data-taste="dock-gemeinsam"]').count()) === 1;
  if (da) { await A.P.locator('[data-taste="dock-gemeinsam"]').click(); await A.P.waitForTimeout(500); }
  pruefe('A5 auch vom Board aus: „⋮" im Dock → „Gemeinsam bearbeiten …" öffnet den Dialog', da && (await A.P.locator('.freigabe-dialog').count()) === 1 && (await A.P.locator('.dock-menu-more').count()) === 0);
  await schliessen(A.P);
}
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: einladen ════');
await dialogOeffnen(A.P, 'Planung');
await A.P.waitForSelector('[data-taste="einladung-anlegen"]', { timeout: 6000 });
{
  const sicht = await zuSehen(A.P, '.freigabe-dialog');
  pruefe('B1 vier Dinge zu sehen: Schließen, EIN Hauptknopf, zwei eingeklappte Zeilen', JSON.stringify(sicht) === JSON.stringify(['Schließen', 'Einladungslink erstellen', 'Optionen', 'Einzelne Person per E-Mail einladen']), JSON.stringify(sicht));
  const w = await woerter(A.P, '.freigabe-dialog');
  pruefe('B2 der Dialog kommt mit unter 40 Wörtern aus (vorher 212)', w < 40, String(w));
  await A.P.locator('[data-taste="einladung-anlegen"]').click();
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
  pruefe('B3 ein Klick legt den Link an – Vorgabe: mitmachen ohne Konto, bearbeiten', sb.einladungen[0]?.ohne_konto === true && sb.einladungen[0]?.rolle === 'bearbeiten' && /Einladungslink kopiert/.test(await toast(A.P)), JSON.stringify(sb.einladungen[0]));
  pruefe('B4 ein Satz sagt, was der Link kann', /sofort dabei/.test(await satz(A.P)) && /arbeitet live mit/.test(await satz(A.P)), await satz(A.P));
  const mit = await zuSehen(A.P, '.freigabe-dialog');
  pruefe('B5 mit Link: Adresse, Kopieren, QR-Code – und weiter nur die zwei eingeklappten Zeilen', mit.length <= 7 && ['Einladungslink', 'Kopieren', 'Optionen'].every((t) => mit.includes(t)) && !mit.some((t) => /widerrufen|Was Gäste dürfen|E-Mail$/.test(t)), JSON.stringify(mit));
  await A.P.locator('[data-taste="einladung-optionen"] > summary').click(); await A.P.waitForTimeout(250);
  await A.P.locator('[data-taste="einladung-ohne-konto"]').click();   // der Haken folgt der Antwort des Servers
  await warteBis(A.P, () => sb.einladungen[0]?.ohne_konto === false, 5000); await A.P.waitForTimeout(300);
  pruefe('B6 Optionen: „ohne Konto" aus → der Satz sagt es (PixiNotes-Konto)', /PixiNotes-Konto/.test(await satz(A.P)) && !/sofort dabei/.test(await satz(A.P)), await satz(A.P));
  await A.P.locator('[data-taste="einladung-ohne-konto"]').click();
  await warteBis(A.P, () => sb.einladungen[0]?.ohne_konto === true, 5000); await A.P.waitForTimeout(300);
  await A.P.locator('[data-taste="einladung-recht"]').selectOption('eigenes'); await A.P.waitForTimeout(700);
  pruefe('B7 … und folgt auch dem Recht der Gäste', /sofort dabei/.test(await satz(A.P)) && /ändert nur eigene Karten/.test(await satz(A.P)), await satz(A.P));
  pruefe('B8 in den Optionen stehen Rolle, Recht, „ohne Konto" und „Link widerrufen"', (await A.P.locator('[data-taste="einladung-optionen"] [data-taste="einladung-rolle"]').count()) === 1 && (await A.P.locator('[data-taste="einladung-optionen"] [data-taste="einladung-weg"]').count()) === 1);
}
const adresse = await A.P.locator('[data-taste="einladung-adresse"]').inputValue();
const anker = adresse.slice(adresse.indexOf('#'));
await schliessen(A.P); await A.P.waitForTimeout(800);

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: die Leiste ════');
{
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="live-leiste"]').count()) === 1, 6000);
  const allein = await zuSehen(A.P, '.live-leiste');
  pruefe('C1 allein im Board: EIN Knopf in der Leiste („nur du")', allein.length === 1 && /nur du|verbindet/.test(await zahl(A.P)), JSON.stringify(allein));
  await listeAuf(A.P);
  const e1 = await eintraege(A.P);
  pruefe('C2 dahinter, mit Namen: Einladen, QR-Code, Timer', JSON.stringify(e1) === JSON.stringify(['Einladen …', 'QR-Code zum Mitmachen zeigen', 'Timer für alle']), JSON.stringify(e1));
  await A.P.locator('[data-taste="live-einladen"]').click(); await A.P.waitForTimeout(600);
  pruefe('C3 „Einladen …" öffnet den Dialog mit dem Link; die Liste ist zu', (await A.P.locator('.freigabe-dialog [data-taste="einladung-adresse"]').count()) === 1 && (await A.P.locator('[data-taste="live-liste"]').count()) === 0);
  await schliessen(A.P);
}
const G = await geraet('G', null, anker, { ich: ICH_G });
await G.P.waitForSelector('[data-taste="gast-name"]', { timeout: 8000 });
await G.P.locator('[data-taste="gast-name"]').fill('Gerd Gast'); await G.P.locator('[data-taste="gast-name-ok"]').click();
const T = await geraet('T', null, anker, { ich: ICH_H, telefon: true, viewport: { width: 390, height: 780 } });
await T.P.waitForSelector('[data-taste="gast-name"]', { timeout: 8000 });
await T.P.locator('[data-taste="gast-name"]').fill('Hanna Handy'); await T.P.locator('[data-taste="gast-name-ok"]').tap();
await warteBis(A.P, async () => /3 dabei/.test(await zahl(A.P)), 12000);
{
  const zuDritt = await zuSehen(A.P, '.live-leiste');
  pruefe('C4 zu dritt: ZWEI Knöpfe – wer da ist, und Reagieren (vorher sieben)', zuDritt.length === 2 && /3 dabei/.test(await zahl(A.P)), JSON.stringify(zuDritt));
  await listeAuf(A.P);
  const namen = await A.P.evaluate(() => [...document.querySelectorAll('[data-taste="live-liste"] .live-name')].map((e) => e.textContent));
  const e2 = await eintraege(A.P);
  pruefe('C5 die Liste nennt alle drei und alle Werkzeuge beim Namen', JSON.stringify(namen.slice().sort()) === JSON.stringify(['Gerd Gast', 'Hanna Handy', 'anna']) && e2.length === 5 && e2[0] === 'Einladen …' && e2[1] === 'QR-Code zum Mitmachen zeigen' && /Vorführen – alle folgen dir$/.test(e2[2]) && e2[3] === 'Mauszeiger zeigen' && e2[4] === 'Timer für alle', JSON.stringify([namen, e2]));
  await A.P.locator('[data-taste="vorfuehren"]').click(); await A.P.waitForTimeout(1500);
  const beimVorfuehren = await zuSehen(A.P, '.live-leiste');
  pruefe('C6 Vorführen aus der Liste: Gerd folgt; die Leiste bleibt bei zwei Knöpfen (das Band zeigt es)', /führt vor/.test(await G.P.locator('body').innerText()) && beimVorfuehren.length === 2 && (await A.P.locator('[data-taste="zeig-ende"]').count()) === 1, JSON.stringify(beimVorfuehren));
  await listeAuf(A.P);
  pruefe('C7 in der Liste steht jetzt „Vorführen beenden"', /Vorführen beenden/.test((await eintraege(A.P)).join('|')) && (await A.P.locator('[data-taste="vorfuehren"]').getAttribute('aria-pressed')) === 'true');
  await A.P.locator('[data-taste="vorfuehren"]').click(); await A.P.waitForTimeout(1200);
  pruefe('C8 … und beendet es', (await A.P.locator('[data-taste="zeig-ende"]').count()) === 0 && !/führt vor/.test(await G.P.locator('body').innerText()));
  // Gast: Recht steht als Satz in der Liste; „Einladen" hat nur die Besitzerin; Namen ändern am eigenen Eintrag
  await listeAuf(G.P);
  const eg = await eintraege(G.P);
  pruefe('C9 Gast: dieselbe Liste ohne „Einladen …"; sein Recht steht als ganzer Satz darin', !eg.includes('Einladen …') && eg.includes('QR-Code zum Mitmachen zeigen') && /nur deine eigenen Karten/.test(await G.P.locator('[data-taste="live-recht"]').innerText().catch(() => '')), JSON.stringify(eg));
  await G.P.locator('[data-taste="live-ich"]').click(); await G.P.waitForTimeout(400);
  await G.P.locator('[data-taste="gast-name"]').fill('Gerd G.'); await G.P.locator('[data-taste="gast-name-ok"]').click();
  pruefe('C10 Namen ändern am eigenen Eintrag – bei der Besitzerin kommt er an', await warteBis(A.P, async () => (await chipNamen(A.P)).includes('Gerd G.'), 8000), JSON.stringify(await chipNamen(A.P)));
  await A.P.locator('[data-taste="reakt-auf"]').click(); await A.P.waitForTimeout(300);
  await A.P.locator('[data-taste="reakt"]').first().click();
  pruefe('C11 Reagieren bleibt ein Tipp aus der Leiste', await warteBis(G.P, async () => (await G.P.locator('[data-taste="reakt-flug"]').count()) > 0, 5000));
  await A.P.keyboard.press('Escape'); await A.P.mouse.click(760, 640); await A.P.waitForTimeout(300);
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Telefon ════');
{
  await warteBis(T.P, async () => (await T.P.locator('[data-taste="live-leiste"]').count()) === 1, 8000);
  const lage = await T.P.evaluate(() => {
    const l = document.querySelector('.live-leiste').getBoundingClientRect();
    const schneidet = (r) => r.width > 0 && r.height > 0 && !(r.right <= l.left || r.left >= l.right || r.bottom <= l.top || r.top >= l.bottom);
    const knoepfe = [...document.querySelectorAll('.tabs button, .top-actions button, .logo')].filter((e) => !e.closest('.live-leiste') && e.getClientRects().length);
    return { leiste: [Math.round(l.left), Math.round(l.top), Math.round(l.right), Math.round(l.bottom)], verdeckt: knoepfe.filter((e) => schneidet(e.getBoundingClientRect())).map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)), breit: window.innerWidth };
  });
  pruefe('D1 die Leiste überdeckt keinen Knopf der Kopfzeile (vorher lag sie über dem Board-Namen)', lage.verdeckt.length === 0 && lage.leiste[0] >= 0 && lage.leiste[2] <= lage.breit, JSON.stringify(lage));
  await listeAuf(T.P, true);
  const kasten = await T.P.locator('[data-taste="live-liste"]').boundingBox();
  const ziele = await T.P.evaluate(() => [...document.querySelectorAll('[data-taste="live-liste"] .live-liste-aktionen > button')].map((b) => Math.round(b.getBoundingClientRect().height)));
  pruefe('D2 die Liste bleibt im Bild; ihre Zeilen sind mit dem Finger zu treffen (≥ 44)', !!kasten && kasten.x >= 0 && kasten.x + kasten.width <= 390 && kasten.y + kasten.height <= 780 && ziele.length >= 3 && ziele.every((h) => h >= 44), JSON.stringify([kasten, ziele]));
  // M517: Seit M512 (Timer frei einstellbar) reicht die Liste am Telefon bis etwa y = 625 – der frühere feste Punkt
  // (190, 600) lag im Feld „Eigene Dauer“ IN der Liste. Den Tipp-Punkt deshalb messen: eine Stelle auf der leeren
  // Fläche des Boards, außerhalb von Liste und Leiste, auf der nichts anderes liegt.
  const daneben = await T.P.evaluate(() => {
    for (let y = 760; y >= 120; y -= 20) for (let x = 20; x <= 370; x += 25) {
      const e = document.elementFromPoint(x, y);
      if (e && e.closest('.react-flow__pane') && !e.closest('.live-leiste')) return { x, y };
    }
    return null;
  });
  if (daneben) await T.P.touchscreen.tap(daneben.x, daneben.y);
  const zu = await warteBis(T.P, async () => (await T.P.locator('[data-taste="live-liste"]').count()) === 0, 3000);
  pruefe('D3 ein Tipp daneben schließt sie', !!daneben && zu, JSON.stringify(daneben));
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: als Gast ════');
{
  const bereiche = await G.P.evaluate(() => [...document.querySelectorAll('.tabs.spalte .side-space-name')].map((e) => e.textContent.trim()));
  pruefe('E1 die Spalte des Gasts zeigt keinen leeren eigenen Bereich – nur, worum es geht', bereiche.length === 1 && /Geteilt mit mir/.test(bereiche[0]), JSON.stringify(bereiche));
  const z = G.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
  await z.hover(); await z.locator('.ebenen-menu-knopf').click(); await G.P.waitForTimeout(300);
  const menue = await G.P.evaluate(() => [...document.querySelectorAll('.ebenen-menu button')].map((b) => b.textContent.trim()));
  pruefe('E2 am fremden Board: kein Umbenennen, Archivieren, Löschen – dafür „Verlassen …"', !menue.some((t) => /Umbenennen|Archivieren|Löschen/.test(t)) && menue.includes('Verlassen …') && menue.some((t) => /Gemeinsames Board/.test(t)), JSON.stringify(menue));
  await G.P.locator('[data-taste="board-verlassen"]').click(); await G.P.waitForTimeout(500);
  pruefe('E3 „Verlassen …" führt zum Dialog mit „Board verlassen"', (await G.P.locator('[data-taste="freigabe-verlassen"]').count()) === 1);
  await schliessen(G.P);
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: „nur Eigenes" gilt auch für Verbindungen ════');
{
  await warteBis(G.P, async () => (await gastEintragRecht(G.P)) === 'eigenes', 8000);
  const vorher = (await kanten(G.P)).map((e) => e.id);
  const geklickt = await kanteLoeschen(G.P, 'e1');
  await G.P.waitForTimeout(1500);
  pruefe('F1 Gerd wählt die Verbindung der Besitzerin und drückt Entf – sie bleibt, bei ihm und auf dem Server', geklickt && vorher.includes('e1') && (await kanten(G.P)).some((e) => e.id === 'e1') && kantenServer().some((e) => e.id === 'e1'), JSON.stringify([vorher, (await kanten(G.P)).map((e) => e.id)]));
  // Gerd legt zwei eigene Notizen an und verbindet sie
  await notizPlatz(G.P, 'Gerd eins'); await notizPlatz(G.P, 'Gerd zwei');
  await G.P.mouse.click(760, 800); await G.P.waitForTimeout(300);
  const griff = async (text, seite) => G.P.evaluate(([t, s]) => { const k = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent.includes(t)); const h = k?.querySelector(`.react-flow__handle-${s}`) ?? k?.querySelector('.react-flow__handle'); if (!h) return null; const r = h.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, [text, seite]);
  await karteEl(G.P, 'Gerd eins').hover(); await G.P.waitForTimeout(200);
  const von = await griff('Gerd eins', 'right') ?? await griff('Gerd eins', 'bottom');
  const nach = await G.P.evaluate(() => { const k = [...document.querySelectorAll('.react-flow__node')].find((n) => n.textContent.includes('Gerd zwei')); const r = k.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  if (von) { await G.P.mouse.move(von[0], von[1]); await G.P.mouse.down(); await G.P.mouse.move((von[0] + nach[0]) / 2, (von[1] + nach[1]) / 2, { steps: 6 }); await G.P.mouse.move(nach[0], nach[1], { steps: 6 }); await G.P.mouse.up(); }
  const neu = await (async () => { let k; await warteBis(G.P, async () => { k = (await kanten(G.P)).find((e) => e.id !== 'e1'); return !!k; }, 5000); return k; })();
  pruefe('F2 seine eigene Verbindung trägt, wer sie gezogen hat', !!neu && /^g:/.test(neu.data?.von ?? ''), JSON.stringify(neu ?? { griff: von }));
  if (neu) {
    await warteBis(G.P, () => kantenServer().some((e) => e.id === neu.id), 8000);
    await G.P.mouse.click(760, 800); await G.P.waitForTimeout(200);
    await kanteLoeschen(G.P, neu.id);
    pruefe('F3 … und lässt sich von ihm löschen – bei ihm und auf dem Server', !(await kanten(G.P)).some((e) => e.id === neu.id) && await warteBis(G.P, () => !kantenServer().some((e) => e.id === neu.id), 8000), JSON.stringify((await kanten(G.P)).map((e) => e.id)));
  } else pruefe('F3 … und lässt sich von ihm löschen', false, 'keine eigene Verbindung entstanden');
  pruefe('F4 die Verbindung der Besitzerin steht unverändert da', kantenServer().find((e) => e.id === 'e1')?.data?.label === 'führt zu', JSON.stringify(kantenServer()));
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: abgelehnter Beitritt ════');
{
  sb.beitrittAblehnen = 2; sb.abgelehnt = 0;
  const H = await geraet('H', null, anker, { ich: 'hugo000001' });
  await H.P.waitForSelector('[data-taste="gast-name"]', { timeout: 8000 });
  await H.P.locator('[data-taste="gast-name"]').fill('Hugo'); await H.P.locator('[data-taste="gast-name-ok"]').click();
  const dabei = await warteBis(H.P, async () => /dabei/.test(await zahl(H.P)), 15000);
  pruefe('G1 der Server lehnt den Beitritt zweimal ab – die App versucht es weiter und ist dann dabei', dabei && sb.abgelehnt === 2, JSON.stringify({ zahl: await zahl(H.P), abgelehnt: sb.abgelehnt }));
  await H.ctx.close();
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Befehl und Texte ════');
{
  await A.P.keyboard.press('Control+k'); await A.P.waitForTimeout(350);
  await A.P.keyboard.type('gemeinsam', { delay: 20 }); await A.P.waitForTimeout(450);
  const b = A.P.locator('.search-overlay, .search-backdrop').locator('text=Gemeinsam bearbeiten').first();
  const da = (await b.count()) === 1;
  if (da) { await b.click(); await A.P.waitForTimeout(600); }
  pruefe('H1 Strg+K „gemeinsam" → „Gemeinsam bearbeiten" öffnet den Dialog', da && (await A.P.locator('.freigabe-dialog').count()) === 1);
  await schliessen(A.P);
  const lies = (p) => readFileSync(path.join(__repo, p), 'utf8');
  pruefe('H2 die Hilfe nennt M391 – deutsch und englisch', lies('src/components/HelpOverlay.tsx').includes('(M391)') && lies('src/components/HelpOverlayEn.tsx').includes('(M391)'));
  const audit = lies('docs/AUDIT.md');
  // M448: nur die TEAM-Funde (T…) müssen erledigt sein – spätere Audits (M447 Barrierefreiheit, B…) führen
  // bewusst offene Punkte als „⏳ eigene Aufgabe"; die gehören nicht zu diesem Meilenstein
  const teamOffen = audit.split('\n').filter((z) => /^\| T\d+ \|/.test(z) && /⏳/.test(z));
  pruefe('H3 die Audit-Liste führt die Team-Funde; kein Team-Fund ist mehr offen', /\| T1 \|/.test(audit) && teamOffen.length === 0, teamOffen.map((z) => z.slice(0, 12)).join(' '));
  pruefe('H4 kein fremder Dienst wurde angesprochen', fremd.length === 0, fremd.slice(0, 3).join(' '));
}

await browser.close(); app.close();
console.log(`\nm391-team-audit: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
