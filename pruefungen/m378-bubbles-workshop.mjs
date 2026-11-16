/**
 * M378 — Ideen-Bubbles für Workshops: bessere Physik, Gruppieren mit der Hand, Moderation.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m364–m371).
 *
 *   A  Ablauf: vier Schritte, für alle sichtbar; wer leitet, schaltet.
 *   B  Gruppieren mit der Hand: leere Gruppe anlegen und benennen; Blase auf Gruppe, auf Blase in Gruppe, auf
 *      freie Blase (Gruppe aus beiden / Verschmelzen), ins Freie; Gruppe verschieben, auflösen.
 *   C  Physik: Gruppen stehen in eigenen Feldern, freie Ideen außerhalb; nichts überlappt; alles kommt zur Ruhe;
 *      eine geworfene Blase fliegt weiter.
 *   D  Liste statt Blasen; Ergebnis als Notiz.
 *   E  Gruppe: verdeckt sammeln, anonym, Zwischenstand verbergen, Timer aus der Karte.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m378-bubbles-workshop.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium, devices } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4597;
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
          if (j.payload?.event === 'maus') sb.aufrufe.maus = (sb.aufrufe.maus ?? 0) + 1;
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
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600); await P.waitForSelector('[data-taste="einladung-optionen"], [data-taste="freigabe-ohne-konto"], [data-taste="freigabe-verlassen"]', { timeout: 2500 }).catch(() => {}); await P.evaluate(() => document.querySelectorAll('.freigabe-dialog details').forEach((d) => { d.open = true; }));
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

/** Der sichtbare Ausschnitt eines Geräts in Board-Koordinaten */
const sichtVon = (P) => P.evaluate(() => {
  const el = document.querySelector('.react-flow'); const vp = document.querySelector('.react-flow__viewport');
  const r = el.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(vp).transform);
  const z = m.a || 1;
  return { x: -m.e / z, y: -m.f / z, w: r.width / z, h: r.height / z };
});
const mitte = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
/** Zeigt `b` (mindestens) den Ausschnitt `a`? Mitte gleich (bis auf 4 % der Breite), und a liegt ganz in b */
const zeigt = (b, a) => {
  const ma = mitte(a); const mb = mitte(b);
  const tol = Math.max(a.w, a.h) * 0.04 + 4;
  return Math.abs(ma.x - mb.x) <= tol && Math.abs(ma.y - mb.y) <= tol && b.x <= a.x + tol && b.y <= a.y + tol && b.x + b.w >= a.x + a.w - tol && b.y + b.h >= a.y + a.h - tol;
};
const folgt = (P, Q) => warteBis(P, async () => zeigt(await sichtVon(P), await sichtVon(Q)), 6000);
const zband = (P) => P.locator('[data-taste="zeig-band"]').textContent().catch(() => '');
const hatBand = (P) => P.locator('[data-taste="zeig-band"]').count();
/** Über die freie Fläche ziehen (schwenken) */
const schwenken = async (P, dx, dy) => { await P.mouse.move(1300, 760); await P.mouse.down(); await P.mouse.move(1300 + dx / 2, 760 + dy / 2, { steps: 5 }); await P.mouse.move(1300 + dx, 760 + dy, { steps: 5 }); await P.mouse.up(); await P.waitForTimeout(500); };


// ---------- M371: Dateispeicher, fremde Webseite, Geräte mit beidem ----------
const speicherAbrufe = [];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const antwort = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) });
async function speicher(ctx) {
  await ctx.route(`${SB_URL}/storage/v1/**`, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const m = req.method();
    const pfad = decodeURIComponent(url.pathname);
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    let t = /^\/storage\/v1\/object\/sign\/pixinotes\/(.+)$/.exec(pfad);
    if (t && m === 'GET') {
      const o = sb.objekte.get(t[1]);
      if (!o) return antwort(route, 400, { error: 'not found' });
      speicherAbrufe.push(t[1]);
      return route.fulfill({ status: 200, contentType: o.mime, headers: cors, body: o.body });
    }
    if (t && m === 'POST') {
      if (!sb.objekte.has(t[1])) return antwort(route, 400, { error: 'not found' });
      return antwort(route, 200, { signedURL: `/object/sign/pixinotes/${t[1].split('/').map(encodeURIComponent).join('/')}?token=sig` });
    }
    t = /^\/storage\/v1\/object\/(?:authenticated\/)?pixinotes\/(.+)$/.exec(pfad);
    if (t) {
      if (m === 'POST' || m === 'PUT') { sb.objekte.set(t[1], { body: req.postDataBuffer() ?? Buffer.alloc(0), mime: req.headers()['content-type'] ?? 'application/octet-stream' }); return antwort(route, 200, { Key: `pixinotes/${t[1]}` }); }
      if (m === 'GET') { const o = sb.objekte.get(t[1]); return o ? route.fulfill({ status: 200, contentType: o.mime, headers: cors, body: o.body }) : antwort(route, 400, { error: 'not found' }); }
      if (m === 'DELETE') { sb.objekte.delete(t[1]); return antwort(route, 200, {}); }
    }
    return antwort(route, 200, []);
  });
  await ctx.route('https://extern.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Fremd</title></head><body style="margin:0;height:3000px"><h1 id="fremd">Fremde Seite</h1></body></html>' }));
}
const TOOL = `<!doctype html><html><head><meta charset="utf-8"><title>Rechner</title><style>body{margin:0;font-family:sans-serif}#lang{height:4000px;background:linear-gradient(#fff,#9cf)}#kasten{position:fixed;top:10px;right:10px;width:200px;height:120px;overflow:auto;border:1px solid #333;background:#fff}#kasten div{height:900px}</style></head><body><h1 id="titel">Mein Rechner</h1><div id="kasten"><div>innen</div></div><div id="lang">lang</div><script>localStorage.setItem('gestartet','ja');</script></body></html>`;
const stand371 = {
  boards: [board('bx', 'Planung', [
    note('x1', 'Planung Notiz', 40, 60),
    { id: 'h1', type: 'htmlapp', width: 380, height: 300, position: { x: 330, y: 60 }, data: { name: 'Rechner', size: 0 } },
    { id: 'w1', type: 'htmlapp', width: 380, height: 300, position: { x: 760, y: 60 }, data: { name: 'Wiki', size: 0, live: true, url: 'https://extern.test/seite' } },
  ])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
async function geraet2(name, stand, anker = '') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await dienste(ctx);
  await speicher(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (window !== window.top) return;   // nicht in den Rahmen der Tools (abgeschottet, kein Speicher)
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  P.fehler = [];
  P.on("pageerror", (e) => { P.fehler.push(e.message); console.log(`    PAGEERROR[${name}]:`, e.message, String(e.stack).split("\n").slice(0, 4).join(" | ")); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
/** Der Rahmen (iframe) mit dieser Klasse, in dem das Element #id steht — oder null */
async function rahmen(P, klasse, id) {
  for (const f of P.frames()) {
    if (f === P.mainFrame()) continue;
    try {
      const el = await f.frameElement();
      if (!(await el.evaluate((e, k) => e.classList.contains(k), klasse))) continue;
      if (await f.evaluate((i) => !!document.getElementById(i), id)) return f;
    } catch { /* Rahmen ist gerade weg */ }
  }
  return null;
}
const anteil = (f, sel = null) => f.evaluate((s) => { const e = s ? document.querySelector(s) : document.scrollingElement; return e.scrollTop / Math.max(1, e.scrollHeight - e.clientHeight); }, sel);
const folie = (P) => P.locator('.presenter .presenter-count').textContent().catch(() => '');
const imVortrag = (P) => P.locator('.presenter').count();
const vortragStart = async (P) => { await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250); await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click(); await P.waitForTimeout(700); };


const bub = (id, title = 'Ideen') => ({ id, type: 'bubbles', width: 680, height: 540, position: { x: 320, y: 40 }, data: { title, frage: 'Was fehlt im Büro?', ideen: {}, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } });
const standSolo = {
  boards: [board('b1', 'Workshop', [bub('k1', 'Büro')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
  activeId: 'b1', view: 'board',
};
const standTeam = {
  boards: [board('bx', 'Planung', [bub('k1', 'Was verbessern wir?')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const W = '.react-flow__node-bubbles';
/** Was die Karte zeigt: je Blase Text, Mitte (in Bildschirmpunkten und relativ zur Bühne), Radius, Farbe, Gruppe */
const blasen = (P, wurzel = W) => P.evaluate((w) => {
  const buehne = document.querySelector(`${w} .bub-buehne`);
  if (!buehne) return null;
  const r0 = buehne.getBoundingClientRect();
  return [...buehne.querySelectorAll('[data-taste="bub-blase"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.id, text: el.querySelector('.bub-text').textContent, mal: Number(el.dataset.mal), punkte: Number(el.dataset.punkte), verdeckt: el.hasAttribute('data-verdeckt'), titel: el.getAttribute('title'),
      sx: r.left + r.width / 2, sy: r.top + r.height / 2, x: r.left + r.width / 2 - r0.left, y: r.top + r.height / 2 - r0.top, r: r.width / 2, farbe: getComputedStyle(el).backgroundColor, w: r0.width, h: r0.height, l: r0.left, t: r0.top };
  });
}, wurzel);
const ringe = (P) => P.evaluate((w) => {
  const buehne = document.querySelector(`${w} .bub-buehne`); const r0 = buehne.getBoundingClientRect();
  const namen = Object.fromEntries([...buehne.querySelectorAll('[data-taste="bub-ring-name"]')].map((n) => { const r = n.getBoundingClientRect(); return [n.dataset.gruppe, { name: n.textContent, sx: r.left + r.width / 2, sy: r.top + r.height / 2 }]; }));
  return [...buehne.querySelectorAll('[data-taste="bub-ring"]')].map((el) => { const r = el.getBoundingClientRect(); return { g: el.dataset.gruppe, name: namen[el.dataset.gruppe]?.name, nx: namen[el.dataset.gruppe]?.sx, ny: namen[el.dataset.gruppe]?.sy, sx: r.left + r.width / 2, sy: r.top + r.height / 2, x: r.left + r.width / 2 - r0.left, y: r.top + r.height / 2 - r0.top, r: r.width / 2 }; });
}, W);
const ruhen = async (P, wurzel = W) => {
  let vor = '';
  for (let i = 0; i < 36; i++) {
    const jetzt = JSON.stringify(((await blasen(P, wurzel)) ?? []).map((b) => [b.id, Math.round(b.x), Math.round(b.y), Math.round(b.r)]));
    if (jetzt === vor) return true;
    vor = jetzt; await P.waitForTimeout(250);
  }
  return false;
};
const idee = async (P, text) => { await P.locator(`${W} [data-taste="bub-eingabe"]`).fill(text); await P.keyboard.press('Enter'); await P.waitForTimeout(120); };
const von = async (P, text) => (await blasen(P)).find((b) => b.text === text);
const daten = (P, boardId = 'b1') => P.evaluate((b) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((x) => x.id === b)?.nodes.find((n) => n.id === 'k1')?.data ?? null, boardId);
const gruppeVonIdee = async (P, text, boardId = 'b1') => {
  // liest die Gruppe aus der Anzeige: Farbe der Blase ↔ Farbe des Rings wäre indirekt — darum aus dem Speicher, mit kurzem Warten
  let letzte = null;
  for (let n = 0; n < 8; n++) {
    const d = await daten(P, boardId); const i = Object.values(d.ideen).find((x) => !x.weg && x.text === text);
    const jetzt = i?.g && d.gruppen[i.g] && !d.gruppen[i.g].weg ? d.gruppen[i.g].name : null;
    if (n > 2 && jetzt === letzte) return jetzt;
    letzte = jetzt; await P.waitForTimeout(200);
  }
  return letzte;
};
/** Warten, bis der gespeicherte Stand der Karte die Bedingung erfüllt (gespeichert wird mit kurzer Verzögerung) */
const bisDaten = async (P, pruef, boardId = 'b1') => { for (let i = 0; i < 25; i++) { const d = await daten(P, boardId); if (d && pruef(d)) return true; await P.waitForTimeout(200); } return false; };
const schrittJetzt = (P) => P.locator(`${W} [data-taste="bub-schritt"][aria-current="step"]`).getAttribute('data-schritt');
const zuSchritt = async (P, k) => { await P.locator(`${W} [data-taste="bub-schritt"][data-schritt="${k}"]`).click(); await P.waitForTimeout(300); };
/** Eine Blase an eine Stelle des Bildschirms ziehen (langsam genug, dass es kein Wurf wird) */
const bZiehen = async (P, text, zx, zy) => {
  const b = await von(P, text);
  await P.mouse.move(b.sx, b.sy); await P.mouse.down();
  await P.mouse.move(b.sx + (zx - b.sx) * 0.3, b.sy + (zy - b.sy) * 0.3, { steps: 4 }); await P.waitForTimeout(60);
  await P.mouse.move(zx, zy, { steps: 8 }); await P.waitForTimeout(220);
  await P.mouse.up(); await P.waitForTimeout(350);
};
const ueberlappt = (liste) => liste.some((a, i) => liste.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 1.5));
const bLeer = async (P) => { const b = (await blasen(P))[0]; await P.mouse.click(b.l + 5, b.t + b.h - 5); await P.waitForTimeout(200); };

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Ablauf ════');
const S1 = await geraet2('S', standSolo);
for (const t of ['Kaffeemaschine', 'Mehr Fenster', 'Ruheraum', 'Stehtische', 'Pflanzen', 'Obst', 'Obstkorb', 'Besseres WLAN']) await idee(S1.P, t);
await ruhen(S1.P);
const schritte = await S1.P.locator(`${W} [data-taste="bub-schritt"]`).allTextContents();
pruefe('A1 vier Schritte: Sammeln · Gruppieren · Abstimmen · Ergebnis', schritte.map((s) => s.replace(/^\d/, '')).join(' · ') === 'Sammeln · Gruppieren · Abstimmen · Ergebnis', schritte.join('|'));
pruefe('A2 am Anfang steht die Runde auf „Sammeln"', (await schrittJetzt(S1.P)) === 'sammeln');
await zuSchritt(S1.P, 'gruppieren');
pruefe('A3 „Gruppieren" schließt die Sammlung', (await schrittJetzt(S1.P)) === 'gruppieren' && (await bisDaten(S1.P, (d) => d.regeln?.zu === true && d.abstimmung.phase === 'aus')), JSON.stringify((await daten(S1.P)).regeln));
await zuSchritt(S1.P, 'abstimmen');
pruefe('A4 „Abstimmen" öffnet die Punkte', (await schrittJetzt(S1.P)) === 'abstimmen' && /3 von 3 Punkten/.test(await S1.P.locator(`${W} [data-taste="bub-rest"]`).textContent()));
await zuSchritt(S1.P, 'ergebnis');
pruefe('A5 „Ergebnis" wertet aus', (await schrittJetzt(S1.P)) === 'ergebnis' && (await bisDaten(S1.P, (d) => d.abstimmung.phase === 'fertig')));
await zuSchritt(S1.P, 'sammeln');
pruefe('A6 zurück zu „Sammeln": Sammlung wieder offen, keine Abstimmung', (await schrittJetzt(S1.P)) === 'sammeln' && (await bisDaten(S1.P, (d) => d.regeln?.zu === false && d.abstimmung.phase === 'aus')));
await S1.P.locator(`${W} [data-taste="bub-abstimmen"]`).click(); await S1.P.waitForTimeout(300);
pruefe('A7 der Knopf „Abstimmen" unten und die Schritte oben zeigen dasselbe', (await schrittJetzt(S1.P)) === 'abstimmen');
await zuSchritt(S1.P, 'gruppieren');
pruefe('A8 die Zahl nennt Ideen (allein: ohne Personen)', /^8 Ideen$/.test((await S1.P.locator(`${W} [data-taste="bub-zahl"]`).textContent()).trim()), await S1.P.locator(`${W} [data-taste="bub-zahl"]`).textContent());

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Gruppieren mit der Hand ════');
await S1.P.locator(`${W} [data-taste="bub-gruppe-neu"]`).click(); await S1.P.waitForTimeout(300);
pruefe('B1 „＋ Gruppe" legt eine leere Gruppe an und fragt gleich nach dem Namen', (await S1.P.locator(`${W} [data-taste="bub-gruppen-pille"]`).count()) === 1 && (await S1.P.locator(`${W} [data-taste="bub-gruppe-name"]`).inputValue()) === 'Gruppe 1');
await S1.P.locator(`${W} [data-taste="bub-gruppe-name"]`).fill('Räume'); await S1.P.keyboard.press('Enter'); await S1.P.waitForTimeout(300);
await ruhen(S1.P);
let rg = await ringe(S1.P);
pruefe('B2 die leere Gruppe steht als Feld da — mit ihrem neuen Namen', rg.length === 1 && rg[0].name === 'Räume' && rg[0].r >= 25, JSON.stringify(rg));
await bZiehen(S1.P, 'Ruheraum', rg[0].sx, rg[0].sy);
pruefe('B3 eine Blase auf die Gruppe gezogen: Sie gehört dazu', (await gruppeVonIdee(S1.P, 'Ruheraum')) === 'Räume');
await ruhen(S1.P);
let ziel = await von(S1.P, 'Ruheraum');
await bZiehen(S1.P, 'Mehr Fenster', ziel.sx, ziel.sy);
pruefe('B4 auf eine Blase gezogen, die in einer Gruppe steckt: in dieselbe Gruppe, ohne Nachfrage', (await gruppeVonIdee(S1.P, 'Mehr Fenster')) === 'Räume' && (await S1.P.locator(`${W} [data-taste="bub-fallen"]`).count()) === 0);
await ruhen(S1.P);
ziel = await von(S1.P, 'Kaffeemaschine');
await bZiehen(S1.P, 'Stehtische', ziel.sx, ziel.sy);
pruefe('B5 auf eine freie Blase gezogen: die Karte fragt, was gemeint ist', (await S1.P.locator(`${W} [data-taste="bub-fallen"]`).count()) === 1 && /Stehtische.*Kaffeemaschine/.test(await S1.P.locator(`${W} [data-taste="bub-fallen"]`).textContent()));
await S1.P.locator(`${W} [data-taste="bub-fallen-gruppe"]`).click(); await S1.P.waitForTimeout(350);
await S1.P.locator(`${W} [data-taste="bub-gruppe-name"]`).fill('Möbel'); await S1.P.keyboard.press('Enter'); await S1.P.waitForTimeout(300);
pruefe('B6 „Gruppe aus beiden": Beide stecken in der neuen Gruppe', (await gruppeVonIdee(S1.P, 'Stehtische')) === 'Möbel' && (await gruppeVonIdee(S1.P, 'Kaffeemaschine')) === 'Möbel', `${await gruppeVonIdee(S1.P, 'Stehtische')} / ${await gruppeVonIdee(S1.P, 'Kaffeemaschine')}`);
await ruhen(S1.P);
ziel = await von(S1.P, 'Obstkorb');
await bZiehen(S1.P, 'Obst', ziel.sx, ziel.sy);
await S1.P.locator(`${W} [data-taste="bub-fallen-eins"]`).click(); await S1.P.waitForTimeout(400);
await ruhen(S1.P);
let bl = await blasen(S1.P);
pruefe('B7 „Verschmelzen": aus zwei Ideen wird eine, die doppelt zählt', bl.length === 7 && !bl.some((b) => b.text === 'Obst') && bl.find((b) => b.text === 'Obstkorb')?.mal === 2, JSON.stringify(bl.map((b) => [b.text, b.mal])));
await S1.P.screenshot({ path: `${SD}/m378-b-gruppen.png` });

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Physik und Anordnung ════');
await bLeer(S1.P); await ruhen(S1.P);
bl = await blasen(S1.P); rg = await ringe(S1.P);
const gName = Object.fromEntries(rg.map((r) => [r.name, r]));
console.log('    Felder:', JSON.stringify(rg.map((r) => [r.name, Math.round(r.x), Math.round(r.y), Math.round(r.r)])));
pruefe('C1 keine zwei Blasen überlappen', !ueberlappt(bl), JSON.stringify(bl.map((b) => [b.text, Math.round(b.x), Math.round(b.y), Math.round(b.r)])));
pruefe('C2 alle liegen ganz in der Bühne', bl.every((b) => b.x - b.r >= -1 && b.y - b.r >= -1 && b.x + b.r <= b.w + 1 && b.y + b.r <= b.h + 1));
const abstand = Math.hypot(gName['Räume'].x - gName['Möbel'].x, gName['Räume'].y - gName['Möbel'].y);
pruefe('C3 die beiden Gruppen stehen in eigenen Feldern: Ihre Ringe überlappen nicht', abstand >= gName['Räume'].r + gName['Möbel'].r - 4, `${Math.round(abstand)} gegen ${Math.round(gName['Räume'].r + gName['Möbel'].r)}`);
const inRing = (b, r) => Math.hypot(b.x - r.x, b.y - r.y) < r.r - b.r * 0.5;
const freie = bl.filter((b) => ['Pflanzen', 'Obstkorb', 'Besseres WLAN'].includes(b.text));
pruefe('C4 die freien Ideen liegen in keinem Gruppenfeld', freie.length === 3 && freie.every((b) => !rg.some((r) => inRing(b, r))), JSON.stringify(freie.map((b) => [b.text, Math.round(b.x), Math.round(b.y)])));
const drin = (t, g) => { const b = bl.find((x) => x.text === t); return Math.hypot(b.x - gName[g].x, b.y - gName[g].y) <= gName[g].r + 1; };
pruefe('C5 jede Gruppe umschließt ihre Blasen', drin('Ruheraum', 'Räume') && drin('Mehr Fenster', 'Räume') && drin('Stehtische', 'Möbel') && drin('Kaffeemaschine', 'Möbel'));
pruefe('C6 Blasen einer Gruppe tragen dieselbe Farbe, freie sind neutral', bl.find((b) => b.text === 'Ruheraum').farbe === bl.find((b) => b.text === 'Mehr Fenster').farbe && bl.find((b) => b.text === 'Ruheraum').farbe !== bl.find((b) => b.text === 'Stehtische').farbe && freie.every((b) => b.farbe === freie[0].farbe));
pruefe('C7 alles kommt zur Ruhe (kein Dauerlauf)', await ruhen(S1.P));
// Wurf: schnell ziehen und loslassen — die Blase fliegt weiter. Auf einer eigenen Karte mit einer einzigen Blase
// (nichts im Weg) und VOM Anker weg: Weiter als der Punkt des Loslassens kommt sie nur mit eigenem Schwung.
{
  const standWurf = {
    boards: [board('b1', 'Wurf', [{ ...bub('k1', 'Wurf'), data: { title: 'Wurf', frage: '', ideen: { i1: { text: 'Solo', von: 'k:x', t: 1 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } }])],
    spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }] }],
    activeId: 'b1', view: 'board',
  };
  const Wu = await geraet2('W', standWurf);
  await ruhen(Wu.P);
  const wurf = await von(Wu.P, 'Solo');
  await Wu.P.mouse.move(wurf.sx, wurf.sy); await Wu.P.mouse.down();
  for (let i = 1; i <= 6; i++) { await Wu.P.mouse.move(wurf.sx - i * 14, wurf.sy); await Wu.P.waitForTimeout(16); }
  await Wu.P.mouse.up();
  const losX = wurf.x - 6 * 14;
  // am weitesten Punkt messen (der Anker holt sie gleich zurück; wie schnell gerechnet wird, hängt vom Rechner ab)
  let weit = losX;
  for (let i = 0; i < 12; i++) { await Wu.P.waitForTimeout(30); weit = Math.min(weit, (await von(Wu.P, 'Solo')).x); }
  console.log(`    Wurf: Mitte x=${Math.round(wurf.x)}, losgelassen bei x=${Math.round(losX)}, am weitesten x=${Math.round(weit)}`);
  pruefe('C8 eine geworfene Blase fliegt nach dem Loslassen weiter (vom Anker weg)', losX - weit > 8, `${Math.round(weit)} gegen ${Math.round(losX)}`);
  await ruhen(Wu.P);
  const zurueck = await von(Wu.P, 'Solo');
  pruefe('C9 … und kommt danach zur Ruhe — zurück in der Mitte, in der Bühne', (await ruhen(Wu.P)) && Math.abs(zurueck.x - wurf.x) < 6 && Math.abs(zurueck.y - wurf.y) < 6 && Wu.P.fehler.length === 0, JSON.stringify([Math.round(zurueck.x), Math.round(wurf.x)]));
  await Wu.ctx.close();
}
// aus der Gruppe heraus ins Freie
/** Eine Stelle der Bühne, an der nichts liegt: weit genug von jeder Blase und außerhalb aller Gruppenfelder */
const freierPunkt = async (P) => {
  const bs = await blasen(P); const rs = await ringe(P); const b0 = bs[0];
  let beste = null; let weit = -1;
  for (let y = 30; y < b0.h - 30; y += 14) for (let x = 30; x < b0.w - 30; x += 14) {
    if (rs.some((r) => Math.hypot(x - r.x, y - r.y) < r.r + 26)) continue;
    const ab = Math.min(...bs.map((b) => Math.hypot(x - b.x, y - b.y) - b.r));
    if (ab > weit) { weit = ab; beste = { x: b0.l + x, y: b0.t + y }; }
  }
  return beste;
};
const frei0 = await freierPunkt(S1.P);
await bZiehen(S1.P, 'Mehr Fenster', frei0.x, frei0.y);
pruefe('C10 aus der Gruppe ins Freie gezogen: Die Idee ist wieder frei', (await gruppeVonIdee(S1.P, 'Mehr Fenster')) === null, String(await gruppeVonIdee(S1.P, 'Mehr Fenster')));
// Gruppe an ihrem Namen verschieben
await ruhen(S1.P);
rg = await ringe(S1.P);
const mg = rg.find((r) => r.name === 'Möbel');
const dx = mg.x > 340 ? -110 : 110;
await S1.P.mouse.move(mg.nx, mg.ny); await S1.P.mouse.down(); await S1.P.mouse.move(mg.nx + dx / 2, mg.ny + 30, { steps: 5 }); await S1.P.mouse.move(mg.nx + dx, mg.ny + 60, { steps: 5 }); await S1.P.mouse.up();
await ruhen(S1.P);
const mg2 = (await ringe(S1.P)).find((r) => r.name === 'Möbel');
pruefe('C11 eine Gruppe lässt sich an ihrem Namen verschieben — sie bleibt, wo man sie hinlegt', Math.abs(mg2.x - mg.x) > 45 && Math.sign(mg2.x - mg.x) === Math.sign(dx), `${Math.round(mg.x)} → ${Math.round(mg2.x)}`);
pruefe('C12 das Verschieben ändert nichts an den Daten (die Lage gehört dem Gerät)', (await gruppeVonIdee(S1.P, 'Stehtische')) === 'Möbel' && (await S1.P.locator(`${W} [data-taste="bub-gruppen-pille"]`).count()) === 0);
// auflösen
await S1.P.mouse.click(mg2.nx, mg2.ny); await S1.P.waitForTimeout(300);
pruefe('C13 ein Tipp auf den Namen öffnet die Möglichkeiten der Gruppe', (await S1.P.locator(`${W} [data-taste="bub-gruppen-pille"]`).count()) === 1 && (await S1.P.locator(`${W} [data-taste="bub-gruppe-name"]`).inputValue()) === 'Möbel');
await S1.P.locator(`${W} [data-taste="bub-gruppe-weg"]`).click(); await S1.P.waitForTimeout(400);
pruefe('C14 „Auflösen": Die Gruppe ist weg, ihre Ideen sind frei', (await ringe(S1.P)).length === 1 && (await gruppeVonIdee(S1.P, 'Stehtische')) === null && (await blasen(S1.P)).length === 7);

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Liste und Ergebnis ════');
await zuSchritt(S1.P, 'abstimmen');
for (const t of ['Ruheraum', 'Ruheraum', 'Obstkorb']) { await S1.P.locator(`${W} [data-taste="bub-blase"]`, { hasText: t }).first().click(); await S1.P.waitForTimeout(200); }
await zuSchritt(S1.P, 'ergebnis');
// Platz und Punkte an den Blasen (Nutzerhinweis: „die Auswahl mit den meisten sollte Platz 1 sein")
const plaetze = (P) => P.evaluate((w) => Object.fromEntries([...document.querySelectorAll(`${w} [data-taste="bub-blase"]`)].map((el) => [el.querySelector('.bub-text').textContent, { platz: el.querySelector('[data-taste="bub-platz"]')?.textContent ?? null, punkte: el.querySelector('[data-taste="bub-punkte"]')?.textContent ?? null }])), W);
const pl = await plaetze(S1.P);
console.log('    Plätze:', JSON.stringify(pl));
pruefe('D0a nach dem Auswerten trägt die Blase mit den meisten Punkten „1." — und nennt ihre Punkte ausdrücklich', pl['Ruheraum'].platz === '1.' && pl['Ruheraum'].punkte === '2 Punkte', JSON.stringify(pl['Ruheraum']));
pruefe('D0b die nächste „2." mit „1 Punkt"; ohne Punkte kein Platz', pl['Obstkorb'].platz === '2.' && pl['Obstkorb'].punkte === '1 Punkt' && pl['Pflanzen'].platz === null && pl['Pflanzen'].punkte === null, JSON.stringify([pl['Obstkorb'], pl['Pflanzen']]));
const ergZeile = await S1.P.locator(`${W} [data-taste="bub-ergebnis"]`).textContent();
pruefe('D0c die Ergebniszeile liest sich als Rangfolge: „1. Ruheraum 2 Punkte", „2. Obstkorb 1 Punkt"', /^1\.\s*Ruheraum\s*2 Punkte\s*2\.\s*Obstkorb\s*1 Punkt$/.test(ergZeile.trim()), ergZeile);
await S1.P.locator(`${W} [data-taste="bub-ansicht"]`).click(); await S1.P.waitForTimeout(300);
const zeilen = await S1.P.evaluate((w) => [...document.querySelectorAll(`${w} [data-taste="bub-liste"] section`)].map((s) => ({ kopf: s.querySelector('h5')?.textContent.trim() ?? '', ideen: [...s.querySelectorAll('[data-taste="bub-zeile"]')].map((z) => z.textContent.trim()) })), W);
console.log('    Liste:', JSON.stringify(zeilen));
pruefe('D1 ☰ zeigt die Ideen als Liste — je Gruppe ein Abschnitt, zuletzt „Ohne Gruppe"', zeilen.length === 2 && /^Räume/.test(zeilen[0].kopf) && /^Ohne Gruppe/.test(zeilen[1].kopf) && zeilen[0].ideen.length + zeilen[1].ideen.length === 7, JSON.stringify(zeilen.map((z) => z.kopf)));
pruefe('D2 in jedem Abschnitt nach Punkten geordnet — mit Platz und Punkten', /^Ruheraum.*1\.2 Punkte$/.test(zeilen[0].ideen[0]) && /^Obstkorb.*×2.*2\.1 Punkt$/.test(zeilen[1].ideen[0]), JSON.stringify([zeilen[0].ideen[0], zeilen[1].ideen[0]]));
await S1.P.locator(`${W} [data-taste="bub-ansicht"]`).click(); await S1.P.waitForTimeout(300);
pruefe('D3 noch ein Klick: zurück zu den Blasen', (await S1.P.locator(`${W} [data-taste="bub-liste"]`).count()) === 0 && (await blasen(S1.P)).length === 7);
const vorNotiz = await S1.P.locator('.react-flow__node-note').count();
await S1.P.locator(`${W} [data-taste="bub-mehr"]`).click(); await S1.P.waitForTimeout(200);
await S1.P.locator(`${W} [data-taste="bub-als-notiz"]`).click(); await S1.P.waitForTimeout(900);
const ergNotiz = await S1.P.evaluate(() => document.querySelector('.react-flow__node-note')?.textContent ?? '');
pruefe('D4 „Ergebnis als Notiz": eine Notiz mit Frage, Gruppen und Punkten liegt neben der Karte', (await S1.P.locator('.react-flow__node-note').count()) === vorNotiz + 1 && /Was fehlt im Büro\?/.test(ergNotiz) && /Räume/.test(ergNotiz) && /Ruheraum — 2 Punkte/.test(ergNotiz) && /Obstkorb \(2×\) — 1 Punkt/.test(ergNotiz), ergNotiz.slice(0, 300));
const ergLage = await S1.P.evaluate(() => { const n = document.querySelector('.react-flow__node-note').getBoundingClientRect(); const k = document.querySelector('.react-flow__node-bubbles').getBoundingClientRect(); return { n: n.left, k: k.right }; });
pruefe('D5 … rechts daneben, nicht darauf', ergLage.n >= ergLage.k - 2, JSON.stringify(ergLage));
pruefe('D6 keine Skriptfehler', S1.P.fehler.length === 0, S1.P.fehler.join(' | '));
await S1.ctx.close();

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Gruppe ════');
const A = await geraet2('A', standTeam);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
const G = await geraet2('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
const bRegel = async (P, k) => { await P.locator(`${W} [data-taste="bub-mehr"]`).click(); await P.waitForTimeout(200); await P.locator(`${W} [data-taste="bub-regel-${k}"]`).click(); await P.waitForTimeout(200); await P.locator(`${W} [data-taste="bub-mehr"]`).click(); await P.waitForTimeout(200); };
await bRegel(A.P, 'verdeckt');
await warteBis(G.P, async () => /verdeckt/.test(await G.P.locator(`${W} [data-taste="bub-regeln"]`).textContent().catch(() => '')), 12000);
pruefe('E1 Anna stellt „Verdeckt sammeln" ein — bei Gerd steht es in der Karte', /verdeckt/.test(await G.P.locator(`${W} [data-taste="bub-regeln"]`).textContent().catch(() => '')));
await idee(A.P, 'Annas Idee'); await idee(G.P, 'Gerds Idee'); await idee(A.P, 'Gleich'); await idee(G.P, 'Gleich');
const bSicht = async (P) => ((await blasen(P)) ?? []).map((b) => (b.verdeckt ? '?' : b.text)).sort().join(',');
await warteBis(A.P, async () => (await bSicht(A.P)) === '?,?,Annas Idee,Gleich' && (await bSicht(G.P)) === '?,?,Gerds Idee,Gleich', 25000);
console.log('    Anna sieht:', await bSicht(A.P), '· Gerd sieht:', await bSicht(G.P));
pruefe('E2 Anna sieht ihre Ideen im Wortlaut, Gerds nur verdeckt', (await bSicht(A.P)) === '?,?,Annas Idee,Gleich', await bSicht(A.P));
pruefe('E3 Gerd sieht seine im Wortlaut, Annas nur verdeckt', (await bSicht(G.P)) === '?,?,Gerds Idee,Gleich', await bSicht(G.P));
const verd = (await blasen(A.P)).filter((b) => b.verdeckt);
pruefe('E4 verdeckte Blasen verraten weder Text noch Namen — und gleiche Ideen verschmelzen noch nicht', verd.length === 2 && verd.every((b) => b.text === '•••' && !/Gerd|Gleich/.test(b.titel ?? '') && b.mal === 1), JSON.stringify(verd.map((b) => [b.text, b.titel, b.mal])));
await A.P.mouse.click(verd[0].sx, verd[0].sy); await A.P.waitForTimeout(300);
pruefe('E5 ein Tipp auf eine verdeckte Blase öffnet nichts und sagt, warum', (await A.P.locator(`${W} [data-taste="bub-pille"]`).count()) === 0 && /noch verdeckt/.test(await toast(A.P)), await toast(A.P));
await A.P.screenshot({ path: `${SD}/m378-e-verdeckt.png` });
await zuSchritt(A.P, 'gruppieren');
await warteBis(G.P, async () => (await bSicht(G.P)) === 'Annas Idee,Gerds Idee,Gleich' && (await bSicht(A.P)) === 'Annas Idee,Gerds Idee,Gleich', 20000);
pruefe('E6 Anna schaltet auf „Gruppieren": Bei beiden liegt alles offen, Gleiches ist verschmolzen', (await bSicht(G.P)) === 'Annas Idee,Gerds Idee,Gleich' && (await bSicht(A.P)) === 'Annas Idee,Gerds Idee,Gleich' && (await von(G.P, 'Gleich')).mal === 2, `${await bSicht(A.P)} / ${await bSicht(G.P)}`);
pruefe('E7 Gerd sieht den Schritt „Gruppieren"', (await schrittJetzt(G.P)) === 'gruppieren');
pruefe('E8 zu zweit nennt die Karte auch die Personen: „4 Ideen"… genauer: 3 Blasen · 2 Personen', /3 Ideen · 2 Personen/.test(await A.P.locator(`${W} [data-taste="bub-zahl"]`).textContent()), await A.P.locator(`${W} [data-taste="bub-zahl"]`).textContent());
// anonym
await bRegel(A.P, 'anonym');
await warteBis(G.P, async () => /anonym/.test(await G.P.locator(`${W} [data-taste="bub-regeln"]`).textContent().catch(() => '')), 12000);
await zuSchritt(A.P, 'sammeln');
await warteBis(G.P, async () => (await schrittJetzt(G.P)) === 'sammeln', 12000);
await bRegel(A.P, 'verdeckt');     // wieder offen sammeln
await warteBis(G.P, async () => !/verdeckt/.test(await G.P.locator(`${W} [data-taste="bub-regeln"]`).textContent().catch(() => '')), 12000);
await idee(G.P, 'Geheimer Wunsch');
await warteBis(A.P, async () => !!(await von(A.P, 'Geheimer Wunsch')), 20000);
const geheim = Object.values((await daten(A.P, 'bx')).ideen).find((i) => i.text === 'Geheimer Wunsch');
pruefe('E9 „Namen ausblenden": Gerds neue Idee trägt keinen Namen — auch nicht in den Daten', !!geheim && geheim.name === undefined && (await von(A.P, 'Geheimer Wunsch')).titel === 'Geheimer Wunsch', JSON.stringify(geheim));
pruefe('E10 … und ältere Namen werden nicht mehr gezeigt', (await von(A.P, 'Gerds Idee')).titel === 'Gerds Idee', (await von(A.P, 'Gerds Idee')).titel);
// Zwischenstand verbergen
await bRegel(A.P, 'still');
await zuSchritt(A.P, 'abstimmen');
await warteBis(G.P, async () => (await schrittJetzt(G.P)) === 'abstimmen', 12000);
const bTipp = async (P, t) => { await P.locator(`${W} [data-taste="bub-blase"]`, { hasText: t }).first().click(); await P.waitForTimeout(200); };
await bTipp(G.P, 'Annas Idee'); await bTipp(G.P, 'Annas Idee'); await bTipp(A.P, 'Annas Idee');
await bTipp(A.P, 'Gleich'); await bTipp(G.P, 'Gerds Idee');      // je ein Punkt: diese beiden liegen am Ende gleichauf
const stimmenAufServer = () => { try { const d = JSON.parse(zeile(uidA, 'board-bx.json').inhalt).nodes.find((n) => n.id === 'k1').data; return Object.values(d.stimmen).reduce((s, x) => s + x.n, 0); } catch { return -1; } };
await warteBis(A.P, () => stimmenAufServer() === 5, 20000);
await A.P.waitForTimeout(1500);
pruefe('E11 „Zwischenstand verbergen": Beim Abstimmen sieht jeder nur seine eigenen Punkte (Anna 1, Gerd 2) — auf dem Server liegen 5', (await von(A.P, 'Annas Idee')).punkte === 1 && (await von(G.P, 'Annas Idee')).punkte === 2 && (await von(G.P, 'Gleich')).punkte === 0 && stimmenAufServer() === 5, `${(await von(A.P, 'Annas Idee')).punkte} / ${(await von(G.P, 'Annas Idee')).punkte} / ${stimmenAufServer()}`);
await zuSchritt(A.P, 'ergebnis');
await warteBis(G.P, async () => (await von(G.P, 'Annas Idee')).punkte === 3 && (await von(A.P, 'Annas Idee')).punkte === 3, 15000);
pruefe('E12 mit dem Auswerten sehen beide den ganzen Stand (3)', (await von(G.P, 'Annas Idee')).punkte === 3 && (await von(A.P, 'Annas Idee')).punkte === 3);
const plA = await plaetze(A.P); const plG = await plaetze(G.P);
console.log('    Plätze bei Anna:', JSON.stringify(plA));
pruefe('E12b Plätze bei beiden gleich: „Annas Idee" ist 1. (3 Punkte)', plA['Annas Idee'].platz === '1.' && plA['Annas Idee'].punkte === '3 Punkte' && JSON.stringify(plA) === JSON.stringify(plG), JSON.stringify(plG));
pruefe('E12c gleiche Punktzahl teilt sich den Platz: „Gleich" und „Gerds Idee" sind beide 2.', plA['Gleich'].platz === '2.' && plA['Gerds Idee'].platz === '2.' && plA['Geheimer Wunsch'].platz === null, JSON.stringify(plA));
// Timer aus der Karte
await A.P.locator(`${W} [data-taste="bub-mehr"]`).click(); await A.P.waitForTimeout(200);
await A.P.locator(`${W} [data-taste="bub-timer"] button[data-min="3"]`).click();
await warteBis(G.P, async () => (await G.P.locator('[data-taste="timer-chip"]').count()) === 1, 6000);
pruefe('E13 „Timer für alle" aus der Karte: Die Uhr läuft bei beiden', (await G.P.locator('[data-taste="timer-chip"]').count()) === 1 && /^2:5\d|^3:00/.test(await G.P.locator('[data-taste="timer-zeit"]').textContent()), await G.P.locator('[data-taste="timer-zeit"]').textContent().catch(() => ''));
pruefe('E14 kein „doppelt bearbeitet", keine Skriptfehler', !/doppelt bearbeitet/.test(await toast(A.P)) && !/doppelt bearbeitet/.test(await toast(G.P)) && A.P.fehler.length === 0 && G.P.fehler.length === 0, JSON.stringify([A.P.fehler, G.P.fehler]).slice(0, 300));

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
const quelle = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
pruefe('F1 „Was ist neu" nennt den Ausbau der Bubbles (M378)', /\(M378\)/.test(quelle) && /Gruppieren/.test(quelle) && /verdeckt/i.test(quelle));

console.log(`\n  m378-bubbles-workshop: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
