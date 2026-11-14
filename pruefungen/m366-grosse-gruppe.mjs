/**
 * M366 — Gruppenarbeit für viele: 50 Teilnehmer in einem Board, Änderungen kartenweise.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m364/m365), dazu 50 simulierte Teilnehmer: Sie stehen in
 * der Anwesenheit, ändern das Board über denselben Weg wie echte Gäste (gast_aendern) und geben ihre Änderungen
 * in den Live-Kanal.
 *
 *   A  Anna legt den Link an, Gerd (echtes Gerät, ohne Konto) wählt sich ein.
 *   B  50 weitere kommen dazu: Leiste zeigt „52 dabei", wenige Kürzel + „+N", die Liste klappt auf und rollt.
 *   C  Sturm: 240 Änderungen in 12 Sekunden. Gerd und Anna haben am Ende genau den Stand des Servers; Gerd hat
 *      das ganze Board dabei höchstens zweimal neu geladen; die Oberfläche bleibt flüssig; Annas Gerät schreibt
 *      das Board nicht zurück.
 *   D  Gerd schreibt währenddessen selbst: alles kommt an, nichts wird wiederholt (keine Vorbedingung).
 *   E  Eine Nachricht geht verloren → die Lücke fällt auf, ein voller Abgleich schließt sie.
 *   F  20 halten gleichzeitig eine Karte → 20 Rahmen, danach keiner.
 *   G  Zu große Änderung (kommt ohne Inhalt durch den Kanal) → ein Abgleich holt sie.
 *   H  Anna (mit Konto) ändert etwas → bei Gerd in unter drei Sekunden, ohne das Board neu zu laden.
 *   I  Server ohne gast_aendern: Das Gerät schreibt wie bisher das ganze Board.
 *   K  Texte, Migration.
 */
// Läuft aus dem Repository: `node pruefungen/m366-grosse-gruppe.mjs`
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
const PORT = 4584;
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
  boards: [board('bx', 'Planung', [note('x1', 'Planung Notiz')]), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'by'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [note('z1', 'Z Notiz')])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
async function geraet(name, stand, anker = '') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
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
  await P.waitForTimeout(700);
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
const leer = async (P) => { await heraus(P); await P.mouse.click(1400, 870); await P.waitForTimeout(300); };
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

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Link, Gerd wählt sich ein ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-ohne-konto"]').check();
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
await warteBis(A.P, () => sb.live.length >= 1, 8000);
const topic = `realtime:pn-${kanalVon(uidA, 'bx')}`;
const G = await geraet('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
pruefe('A1 Gerd ist dabei', /2 dabei/.test(await zahl(G.P)));
pruefe('A2 Gerd legt eine Karte an — sie geht kartenweise hinaus (gast_aendern), nicht als ganzes Board', (await notizPlatz(G.P, 'Gerd eins')) && (await warteBis(G.P, () => /Gerd eins/.test(bxServer()), 8000)) && sb.aufrufe.gastAendern >= 1 && sb.aufrufe.gastSchreiben === 0, JSON.stringify(sb.aufrufe));
await warteBis(A.P, async () => /Gerd eins/.test(JSON.stringify(await boardVon(A.P, 'bx'))), 12000);
pruefe('A3 Anna sieht sie', /Gerd eins/.test(JSON.stringify(await boardVon(A.P, 'bx'))));
await G.P.waitForTimeout(1500);
pruefe('A4 Gerds Stand trägt die Version des Servers', (await gastEintrag(G.P)).bx?.version === zeile(uidA, 'board-bx.json').version, `${(await gastEintrag(G.P)).bx?.version} / ${zeile(uidA, 'board-bx.json').version}`);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: 50 weitere Teilnehmer ════');
const leute = Array.from({ length: 50 }, (_, i) => ({ id: `f${String(i + 1).padStart(2, '0')}`, name: `Teilnehmerin ${String(i + 1).padStart(2, '0')}`, farbe: ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed'][i % 5], karte: null, seit: null }));
for (const t of leute) fakeDa(topic, t.id, t);
await warteBis(G.P, async () => /52 dabei/.test(await zahl(G.P)), 8000);
pruefe('B1 Gerd: „52 dabei"', /52 dabei/.test(await zahl(G.P)), await zahl(G.P));
pruefe('B2 Anna: „52 dabei"', await warteBis(A.P, async () => /52 dabei/.test(await zahl(A.P)), 8000), await zahl(A.P));
{
  const chips = await G.P.locator('[data-taste="live-chip"]').count();
  const rest = await G.P.locator('[data-taste="live-rest"]').textContent().catch(() => '');
  const box = await G.P.locator('[data-taste="live-leiste"]').boundingBox();
  pruefe('B3 die Leiste bleibt schmal: wenige Kürzel und „+N"', chips <= 4 && /^\+4[78]$/.test(rest) && box.width < 330 && box.x + box.width <= 1440, `${chips} ${rest} ${Math.round(box.width)}`);
  await G.P.locator('[data-taste="live-auf"]').click(); await G.P.waitForTimeout(300);
  const zeilen = await G.P.locator('[data-taste="live-liste"] .live-liste-zeile').count();
  const lb = await G.P.locator('[data-taste="live-liste"]').boundingBox();
  const rollt = await G.P.locator('[data-taste="live-liste"]').evaluate((el) => el.scrollHeight > el.clientHeight + 10);
  pruefe('B4 die Liste klappt auf: 52 Namen, rollt, bleibt im Fenster', zeilen === 52 && rollt && lb.y + lb.height <= 900 && lb.x >= 0, `${zeilen} ${rollt} ${Math.round(lb.height)}`);
  await G.P.screenshot({ path: path.join(SD, 'm366-liste.png') });
  await G.P.keyboard.press('Escape'); await G.P.waitForTimeout(200);
  pruefe('B5 Esc schließt sie', (await G.P.locator('[data-taste="live-liste"]').count()) === 0);
}

// ══ C + D ═══════════════════════════════════════════════════════════
console.log('\n════ C/D: Sturm — 240 Änderungen in 12 Sekunden, Gerd schreibt mit ════');
await G.P.evaluate(() => { window.__luecken = []; let t = performance.now(); const f = () => { const n = performance.now(); window.__luecken.push(n - t); t = n; window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
const vorher = { ...sb.aufrufe };
let sturmN = 0;
const sturm = (async () => {
  for (let runde = 0; runde < 60; runde += 1) {
    for (let j = 0; j < 4; j += 1) {
      const wer = leute[(runde * 4 + j) % 50];
      const i = sturmN; sturmN += 1;
      // drei von vier legen eine Karte an, jede vierte ändert eine frühere (ihre eigene)
      if (i % 4 === 3) fakeAendern({ nodes: { set: [karteF(`s${i - 3}`, `Sturm ${i - 3} geändert`, i - 3, `g:${wer.id}`)] } });
      else fakeAendern({ nodes: { set: [karteF(`s${i}`, `Sturm ${i}`, i, `g:${wer.id}`)] } });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
})();
// Gerd schreibt währenddessen selbst: fünf Karten und Text in eine davon
await G.P.waitForTimeout(1500);
let gerdOk = true;
for (let i = 1; i <= 5; i += 1) { gerdOk = (await notizPlatz(G.P, `Gerd im Sturm ${i}`)) && gerdOk; await G.P.waitForTimeout(600); }
await sturm;
await warteBis(G.P, () => [1, 2, 3, 4, 5].every((i) => new RegExp(`Gerd im Sturm ${i}`).test(bxServer())), 12000);
void gerdOk;   // (die Zählung im Helfer stimmt im Sturm nicht — es kommen ja laufend Karten dazu)
pruefe('D1 Gerds fünf Karten liegen auf dem Server — ohne Wiederholungen (keine Vorbedingung, kein ganzes Board)', [1, 2, 3, 4, 5].every((i) => new RegExp(`Gerd im Sturm ${i}`).test(bxServer())) && sb.aufrufe.vorbedingung === vorher.vorbedingung && sb.aufrufe.gastSchreiben === 0, `server: ${[1, 2, 3, 4, 5].map((i) => new RegExp(`Gerd im Sturm ${i}`).test(bxServer())).join(',')} | lokal: ${(await Promise.all([1, 2, 3, 4, 5].map(async (i) => new RegExp(`Gerd im Sturm ${i}`).test(JSON.stringify(await boardVon(G.P, 'bx')))))).join(',')} | ${JSON.stringify(sb.aufrufe)}`);
await warteBis(G.P, () => gleichServer(G.P), 15000);
{
  const srv = JSON.parse(bxServer());
  pruefe('C1 der Server trägt alle Karten des Sturms (180 neue, 60 geändert)', srv.nodes.filter((n) => /^s\d+$/.test(n.id)).length === 180 && srv.nodes.filter((n) => /geändert/.test(JSON.stringify(n.data))).length === 60, `${srv.nodes.length}`);
  pruefe('C2 Gerd hat genau den Stand des Servers', await gleichServer(G.P), `${(await boardVon(G.P, 'bx')).nodes.length} / ${srv.nodes.length}`);
  const gInhalt = JSON.stringify((await boardVon(G.P, 'bx')).nodes.filter((n) => /^s\d+$/.test(n.id)).map((n) => [n.id, n.data.blocks]).sort());
  const sInhalt = JSON.stringify(srv.nodes.filter((n) => /^s\d+$/.test(n.id)).map((n) => [n.id, n.data.blocks]).sort());
  pruefe('C3 … auch im Inhalt (die 60 geänderten Karten)', gInhalt === sInhalt);
  const geladen = sb.aufrufe.gastLesen - vorher.gastLesen;
  pruefe('C4 Gerd hat das ganze Board dabei höchstens zweimal neu geladen', geladen <= 2, `${geladen}×`);
  await G.P.waitForTimeout(1600);
  pruefe('C5 Gerds Version ist die des Servers (die Kette ist geschlossen)', (await gastEintrag(G.P)).bx?.version === zeile(uidA, 'board-bx.json').version, `${(await gastEintrag(G.P)).bx?.version} / ${zeile(uidA, 'board-bx.json').version}`);
  const l = await G.P.evaluate(() => { cancelAnimationFrame(window.__raf); const x = window.__luecken.slice(5).sort((a, b) => a - b); return { n: x.length, p50: x[Math.floor(x.length * 0.5)], p95: x[Math.floor(x.length * 0.95)], max: x[x.length - 1], lang: x.filter((v) => v > 250).length }; });
  console.log(`    Bildabstand bei Gerd im Sturm: Mitte ${Math.round(l.p50)} ms, 95 % ${Math.round(l.p95)} ms, längster ${Math.round(l.max)} ms, über 250 ms: ${l.lang}× (${l.n} Bilder)`);
  pruefe('C6 die Oberfläche bleibt flüssig (95 % der Bilder unter 120 ms, keine Hänger über 1,2 s)', l.p95 < 120 && l.max < 1200, JSON.stringify(l));
}
await warteBis(A.P, () => gleichServer(A.P), 25000);
pruefe('C7 Anna hat ebenfalls genau den Stand des Servers', await gleichServer(A.P), `${(await boardVon(A.P, 'bx')).nodes.length}`);
await A.P.waitForTimeout(4000);
pruefe('C8 Annas Gerät hat das Board im Sturm nicht zurückgeschrieben', sb.aufrufe.besitzerBoard - vorher.besitzerBoard === 0 && idsVon(bxServer()) === (await idsLokal(A.P)), `${sb.aufrufe.besitzerBoard - vorher.besitzerBoard}×`);
await G.P.screenshot({ path: path.join(SD, 'm366-sturm.png') });

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Eine Nachricht geht verloren ════');
{
  const lesenVor = sb.aufrufe.gastLesen;
  fakeAendern({ nodes: { set: [karteF('verloren', 'Ging verloren', 200, 'g:f01')] } }, { senden: false });
  fakeAendern({ nodes: { set: [karteF('danach', 'Kam an', 201, 'g:f02')] } });
  await warteBis(G.P, () => gleichServer(G.P), 15000);
  pruefe('E1 die Lücke fällt auf: Beide Karten sind bei Gerd', /Ging verloren/.test(JSON.stringify(await boardVon(G.P, 'bx'))) && /Kam an/.test(JSON.stringify(await boardVon(G.P, 'bx'))));
  pruefe('E2 dafür genügte ein voller Abgleich', sb.aufrufe.gastLesen - lesenVor === 1, `${sb.aufrufe.gastLesen - lesenVor}×`);
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: 20 halten gleichzeitig eine Karte ════');
{
  const jetzt = Date.now();
  for (let i = 0; i < 20; i += 1) { const alt = leute[i]; const neu = { ...alt, karte: `s${i * 4}`, seit: jetzt + i }; fakeWeg(topic, alt.id, alt); fakeDa(topic, alt.id, neu); leute[i] = neu; }
  await warteBis(G.P, async () => (await G.P.locator('[data-taste="live-sperre"]').count()) === 20, 6000);
  pruefe('F1 Gerd sieht 20 Rahmen mit Namen', (await G.P.locator('[data-taste="live-sperre"]').count()) === 20 && /Teilnehmerin/.test(await G.P.locator('[data-taste="live-sperre"]').first().textContent()));
  await G.P.locator('[data-taste="live-auf"]').click(); await G.P.waitForTimeout(300);
  pruefe('F2 die Liste nennt, wer gerade schreibt — sie stehen vorn', /20 schreiben gerade/.test(await G.P.locator('.live-liste-kopf').textContent()) && /schreibt/.test(await G.P.locator('[data-taste="live-liste"] .live-liste-zeile').nth(1).textContent()));
  await G.P.keyboard.press('Escape');
  pruefe('F3 Gerd kann daneben weiterarbeiten', await notizPlatz(G.P, 'Gerd neben den Rahmen'));
  for (let i = 0; i < 20; i += 1) { const alt = leute[i]; const neu = { ...alt, karte: null, seit: null }; fakeWeg(topic, alt.id, alt); fakeDa(topic, alt.id, neu); leute[i] = neu; }
  await warteBis(G.P, async () => (await G.P.locator('[data-taste="live-sperre"]').count()) === 0, 6000);
  pruefe('F4 losgelassen: kein Rahmen mehr', (await G.P.locator('[data-taste="live-sperre"]').count()) === 0);
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Zu groß für den Kanal ════');
{
  await warteBis(G.P, () => gleichServer(G.P), 12000);
  await G.P.waitForTimeout(1500);
  const lesenVor = sb.aufrufe.gastLesen;
  fakeAendern({ nodes: { set: [karteF('gross', 'Sehr große Karte', 210, 'g:f03')] } }, { mitInhalt: false });
  await warteBis(G.P, async () => /Sehr große Karte/.test(JSON.stringify(await boardVon(G.P, 'bx'))), 12000);
  pruefe('G1 die Änderung kommt ohne Inhalt durch den Kanal — ein Abgleich holt sie', /Sehr große Karte/.test(JSON.stringify(await boardVon(G.P, 'bx'))) && sb.aufrufe.gastLesen - lesenVor === 1, `${sb.aufrufe.gastLesen - lesenVor}×`);
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Anna (mit Konto) ändert etwas ════');
{
  await A.P.waitForTimeout(2700);
  const lesenVor = sb.aufrufe.gastLesen;
  const t0 = Date.now();
  pruefe('H1 Anna legt eine Karte an', await notizPlatz(A.P, 'Von der Besitzerin'));
  const t1 = Date.now();
  const da = await warteBis(G.P, async () => /Von der Besitzerin/.test(JSON.stringify(await boardVon(G.P, 'bx'))), 8000);
  const dauer = Date.now() - t1;
  console.log(`    bei Gerd nach ${dauer} ms (ab Ende der Eingabe)`);
  pruefe('H2 sie ist bei Gerd in unter drei Sekunden', da && dauer < 3000, `${dauer} ms`);
  pruefe('H3 … ohne dass Gerd das Board neu geladen hat (die Änderung kam durch den Kanal)', sb.aufrufe.gastLesen - lesenVor === 0, `${sb.aufrufe.gastLesen - lesenVor}×`);
  // Danach schreibt ein Gast: Die Kette schließt über Annas nummernlose Änderung hinweg an
  fakeAendern({ nodes: { set: [karteF('nachAnna', 'Nach Anna', 220, 'g:f04')] } });
  await warteBis(G.P, async () => /Nach Anna/.test(JSON.stringify(await boardVon(G.P, 'bx'))), 6000);
  await G.P.waitForTimeout(2500);
  pruefe('H4 die nächste Änderung eines Gasts schließt an — weiter ohne Neuladen', /Nach Anna/.test(JSON.stringify(await boardVon(G.P, 'bx'))) && sb.aufrufe.gastLesen - lesenVor === 0 && (await gleichServer(G.P)), `${sb.aufrufe.gastLesen - lesenVor}×`);
  void t0;
}

// ══ I ═══════════════════════════════════════════════════════════════
console.log('\n════ I: Server ohne gast_aendern ════');
{
  sb.ohneAendern = true;
  const K = await geraet('K', standB, `#e=${token}`);
  await warteBis(K.P, async () => !!(await boardVon(K.P, 'bx')), 12000);
  if (await K.P.locator('[data-taste="gast-name"]').count()) { await K.P.locator('[data-taste="gast-name"]').fill('Karla'); await K.P.locator('[data-taste="gast-name-ok"]').click(); await K.P.waitForTimeout(400); }
  const ganzVor = sb.aufrufe.gastSchreiben;
  pruefe('I1 Karla legt eine Karte an', await notizPlatz(K.P, 'Von Karla'));
  await warteBis(K.P, () => /Von Karla/.test(bxServer()), 12000);
  pruefe('I2 sie kommt an — über den bisherigen Weg (ganzes Board mit Vorbedingung)', /Von Karla/.test(bxServer()) && sb.aufrufe.gastSchreiben > ganzVor);
  sb.ohneAendern = false;
  await K.ctx.close();
}

// ══ K ═══════════════════════════════════════════════════════════════
console.log('\n════ K: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('K1 „Was ist neu" nennt M366', js.includes('(M366)'));
  const mig = path.join(__repo, 'supabase', 'migrations', '20261114200000_gast_aendern.sql');
  pruefe('K2 die Migration liegt im Repository', existsSync(mig) && /gast_aendern/.test(readFileSync(mig, 'utf8')));
}

await A.ctx.close(); await G.ctx.close();
await browser.close();
app.close();
console.log(`\nm366-grosse-gruppe: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
