/**
 * M379 — Vorlagen beim Anlegen eines Boards.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m364–m371).
 *
 *   A  ＋ Neu → „Board aus Vorlage …": Dialog mit allen Vorlagen; eine Vorlage legt ein neues Board im Projekt an,
 *      mit ihren Karten, eingepasst; „Leeres Board" legt ein leeres an; Esc schließt ohne Folgen.
 *   B  Jede Vorlage: baut ohne Fehler, alle Karten erscheinen, nichts überlappt, kein Beispiel-Inhalt.
 *   C  Leeres Board: „Mit Vorlage beginnen" füllt das Board, vor dem man steht; Name; Strg+Z nimmt sie zurück.
 *   D  Die Karten arbeiten: Notiz beschreibbar, Bubbles nehmen Ideen, Kanban nimmt Aufgaben.
 *   E  Gruppe: Eine Vorlage im geteilten Board kommt beim Gast an.
 *   F  Telefon, Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m379-vorlagen.mjs`
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
const PORT = 4688;
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


const standEins = {
  boards: [board('b1', 'Alt', [note('n1', 'Schon da', 60, 60)])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1'] }, { id: 'p2', name: 'Kunde', boardIds: [] }] }],
  activeId: 'b1', view: 'board',
};
const standLeer = {
  boards: [board('b1', '✨ Board', []), board('b2', 'Jahresplanung', [])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board',
};
const standGruppe = {
  boards: [board('bx', 'Planung', [])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const DLG = '[data-taste="vorlagen-dialog"]';
const stand379 = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const aktiv = async (P) => { const s = await stand379(P); return s.boards.find((b) => b.id === s.activeId); };
const neuMenue = async (P) => { await P.locator('.tabs-foot .tab-add').click(); await P.waitForTimeout(250); };
const dialogAuf = async (P) => { await neuMenue(P); await P.locator('[data-taste="neu-vorlage"]').click(); await P.locator(DLG).waitFor({ timeout: 6000 }); await P.waitForTimeout(200); };
const vWaehlen = async (P, id) => { await P.locator(`${DLG} [data-taste="vorlage"][data-vorlage="${id}"]`).click(); await P.waitForTimeout(900); };
/** Alle Karten des Boards, wie sie auf dem Bildschirm liegen */
const vKarten = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.dataset.id, art: [...el.classList].find((c) => c.startsWith('react-flow__node-'))?.slice(17), l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
}));
const imBild = (ks) => ks.length > 0 && ks.every((k) => k.l >= 0 && k.t >= 0 && k.r <= 1440 && k.b <= 900 && k.w > 20 && k.h > 20);
/** Überlappen sich zwei Karten (Rahmen ausgenommen — sie liegen hinter ihrem Inhalt)? */
const ueberlappung = (ks) => {
  const k = ks.filter((x) => x.art !== 'frame');
  for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) {
    const a = k[i], c = k[j];
    if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 2 && Math.min(a.b, c.b) - Math.max(a.t, c.t) > 2) return `${a.art}/${c.art}`;
  }
  return '';
};
/** Liegt jede Karte, die in einem Rahmen beginnt, ganz in diesem Rahmen? */
const ausRahmen = (ks) => {
  const rahmen = ks.filter((x) => x.art === 'frame');
  for (const k of ks.filter((x) => x.art !== 'frame')) {
    const r = rahmen.find((f) => k.l >= f.l - 1 && k.t >= f.t - 1 && k.l < f.r && k.t < f.b);
    if (r && (k.r > r.r + 1 || k.b > r.b + 1)) return `${k.art} ragt aus dem Rahmen (${Math.round(k.r - r.r)}/${Math.round(k.b - r.b)})`;
  }
  return '';
};

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: ＋ Neu → Board aus Vorlage ════');
const S1 = await geraet2('S', standEins);
await neuMenue(S1.P);
const eintraege = (await S1.P.locator('.neu-menu [role="menuitem"]').allTextContents()).map((t) => t.trim());
pruefe('A1 ＋ Neu bietet „Board aus Vorlage …" gleich unter „Board"', /^Board/.test(eintraege[0]) && /^Board aus Vorlage/.test(eintraege[1]) && /^Projekt/.test(eintraege[2]), JSON.stringify(eintraege));
await S1.P.locator('[data-taste="neu-vorlage"]').click();
await S1.P.locator(DLG).waitFor({ timeout: 6000 }); await S1.P.waitForTimeout(250);
const kacheln = await S1.P.locator(`${DLG} [data-taste="vorlage"]`).evaluateAll((els) => els.map((e) => ({ id: e.dataset.vorlage, name: e.querySelector('b').textContent, text: e.querySelector('small').textContent, skizze: e.querySelectorAll('svg rect, svg circle').length, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height })));
console.log('    Vorlagen:', kacheln.map((k) => k.name).join(' · '));
pruefe('A2 der Dialog zeigt „Leeres Board" und neun Vorlagen', kacheln.length === 10 && kacheln[0].id === 'leer' && ['besprechung', 'rueckblick', 'projektplan', 'brainstorming', 'aufgaben', 'woche', 'entscheidung', 'swot', 'workshop'].every((id) => kacheln.some((k) => k.id === id)), kacheln.map((k) => k.id).join(','));
pruefe('A3 jede Vorlage hat Namen, einen Satz und eine Skizze ihrer Karten', kacheln.slice(1).every((k) => k.name.length > 3 && k.text.length > 20 && k.skizze >= 2), JSON.stringify(kacheln.filter((k) => k.id !== 'leer' && !(k.name.length > 3 && k.text.length > 20 && k.skizze >= 2))));
pruefe('A4 der Dialog nennt das Projekt, in dem das Board entsteht', /Neues Board/.test(await S1.P.locator(`${DLG} h2`).textContent()) && /Allgemein/.test(await S1.P.locator(`${DLG} h2`).textContent()), await S1.P.locator(`${DLG} h2`).textContent());
const dlgMass = await S1.P.locator(DLG).evaluate((d) => { const r = d.getBoundingClientRect(); const g = d.querySelector('.vorlagen-gitter'); return { l: r.left, r: r.right, t: r.top, b: r.bottom, quer: g.scrollWidth - g.clientWidth }; });
pruefe('A5 der Dialog liegt ganz im Bild, nichts läuft quer über', dlgMass.l >= 0 && dlgMass.r <= 1440 && dlgMass.t >= 0 && dlgMass.b <= 900 && dlgMass.quer <= 1, JSON.stringify(dlgMass));
pruefe('A6 die erste Kachel hat den Fokus (Tastatur)', await S1.P.evaluate(() => document.activeElement?.getAttribute('data-vorlage') === 'leer'));
await S1.P.screenshot({ path: `${SD}/m379-a-dialog.png` });
await S1.P.keyboard.press('Escape'); await S1.P.waitForTimeout(300);
pruefe('A7 Esc schließt den Dialog, ohne etwas anzulegen', (await S1.P.locator(DLG).count()) === 0 && (await stand379(S1.P)).boards.length === 1);
await dialogAuf(S1.P);
await S1.P.mouse.click(20, 450); await S1.P.waitForTimeout(300);
pruefe('A8 ein Klick daneben schließt ihn ebenso', (await S1.P.locator(DLG).count()) === 0 && (await stand379(S1.P)).boards.length === 1);
await dialogAuf(S1.P);
await vWaehlen(S1.P, 'besprechung');
await warteBis(S1.P, async () => (await stand379(S1.P)).boards.length === 2, 4000);
let st = await stand379(S1.P); let neu = st.boards.find((b) => b.id !== 'b1');
pruefe('A9 „Besprechung" legt ein neues Board an und öffnet es', st.boards.length === 2 && st.activeId === neu.id && st.view === 'board' && /Besprechung/.test(neu.name), JSON.stringify([st.boards.map((b) => b.name), st.view]));
pruefe('A10 das Board liegt im aktuellen Projekt', st.spaces[0].projects[0].boardIds.includes(neu.id), JSON.stringify(st.spaces[0].projects.map((p) => p.boardIds)));
pruefe('A11 es trägt Notizen, Protokoll und Kanban', ['note', 'minutes', 'kanban'].every((t) => neu.nodes.some((n) => n.type === t)) && neu.nodes.length === 4, neu.nodes.map((n) => n.type).join(','));
pruefe('A12 das alte Board ist unberührt', st.boards.find((b) => b.id === 'b1').nodes.length === 1);
await S1.P.waitForTimeout(600);
let ks = await vKarten(S1.P);
pruefe('A13 alle Karten sind zu sehen — das Board ist eingepasst', ks.length === 4 && imBild(ks), JSON.stringify(ks.map((k) => [k.art, Math.round(k.l), Math.round(k.t), Math.round(k.r), Math.round(k.b)])));
pruefe('A14 eine Meldung sagt, was geschah', /Besprechung/.test(await toast(S1.P)) && /Vorlage/.test(await toast(S1.P)), await toast(S1.P));
await S1.P.screenshot({ path: `${SD}/m379-a-besprechung.png` });
await dialogAuf(S1.P); await vWaehlen(S1.P, 'besprechung');
await warteBis(S1.P, async () => (await stand379(S1.P)).boards.length === 3, 4000);
st = await stand379(S1.P);
pruefe('A15 dieselbe Vorlage noch einmal: zweites Board mit eigenem Namen und eigenen Karten', st.boards.length === 3 && new Set(st.boards.map((b) => b.name)).size === 3 && new Set(st.boards.flatMap((b) => b.nodes.map((n) => n.id))).size === 9, JSON.stringify(st.boards.map((b) => b.name)));
await dialogAuf(S1.P); await vWaehlen(S1.P, 'leer');
await warteBis(S1.P, async () => (await stand379(S1.P)).boards.length === 4, 4000);
st = await stand379(S1.P);
pruefe('A16 „Leeres Board" legt ein leeres Board an', st.boards.length === 4 && (await aktiv(S1.P)).nodes.length === 0, JSON.stringify(st.boards.map((b) => [b.name, b.nodes.length])));
// Strg+K findet die Vorlagen
await S1.P.keyboard.press('Control+k'); await S1.P.waitForTimeout(300);
await S1.P.keyboard.type('retro'); await S1.P.waitForTimeout(400);
const befehl = S1.P.locator('.search-overlay, .search-backdrop').locator('text=Board aus Vorlage').first();
const befehlDa = (await befehl.count()) === 1;
if (befehlDa) { await befehl.click(); await S1.P.waitForTimeout(500); }
pruefe('A16b Strg+K „retro" bietet „Board aus Vorlage" an und öffnet den Dialog', befehlDa && (await S1.P.locator(DLG).count()) === 1, String(befehlDa));
await S1.P.keyboard.press('Escape'); await S1.P.waitForTimeout(300);
if (await S1.P.locator('.search-backdrop').count()) { await S1.P.keyboard.press('Escape'); await S1.P.waitForTimeout(200); }
pruefe('A17 keine Skriptfehler', S1.P.fehler.length === 0, JSON.stringify(S1.P.fehler).slice(0, 300));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: jede Vorlage ════');
const erwartet = {
  besprechung: { karten: 4, arten: ['note', 'minutes', 'kanban'] },
  rueckblick: { karten: 11, arten: ['frame', 'note', 'bubbles', 'kanban'] },
  projektplan: { karten: 5, arten: ['note', 'gantt', 'kanban'] },
  brainstorming: { karten: 3, arten: ['bubbles', 'note', 'frame'] },
  aufgaben: { karten: 2, arten: ['kanban', 'note'] },
  woche: { karten: 3, arten: ['week', 'note', 'kanban'] },
  entscheidung: { karten: 7, arten: ['note', 'frame', 'bubbles'] },
  swot: { karten: 8, arten: ['frame', 'note'] },
  workshop: { karten: 7, arten: ['note', 'frame', 'bubbles', 'kanban'] },
};
let nr = 0;
for (const [id, e] of Object.entries(erwartet)) {
  nr += 1;
  const vorher = (await stand379(S1.P)).boards.length;
  await dialogAuf(S1.P); await vWaehlen(S1.P, id);
  await warteBis(S1.P, async () => (await stand379(S1.P)).boards.length === vorher + 1, 4000);
  await S1.P.waitForTimeout(900);
  const b = await aktiv(S1.P);
  const ks2 = await vKarten(S1.P);
  const ueber = ueberlappung(ks2), raus = ausRahmen(ks2);
  // Beispiel-Inhalte: Notizen tragen nur Überschriften und Listen-Anfänge, Kanban/Bubbles/Protokoll sind leer
  const voll = b.nodes.filter((n) => (n.type === 'kanban' && n.data.items.length) || (n.type === 'bubbles' && Object.keys(n.data.ideen).length) || (n.type === 'minutes' && n.data.entries.length) || (n.type === 'week' && n.data.entries.length)).map((n) => n.type);
  const gut = b.nodes.length === e.karten && e.arten.every((t) => b.nodes.some((n) => n.type === t)) && ks2.length === e.karten && imBild(ks2) && !ueber && !raus && !voll.length;
  pruefe(`B${nr} „${b.name}": ${e.karten} Karten, alle im Bild, nichts überlappt, nichts ragt aus einem Rahmen, keine Beispiel-Inhalte`, gut,
    JSON.stringify({ n: b.nodes.length, gezeigt: ks2.length, imBild: imBild(ks2), ueber, raus, voll }));
  await S1.P.screenshot({ path: `${SD}/m379-b-${id}.png` });
}
pruefe('B10 keine Skriptfehler beim Bauen aller Vorlagen', S1.P.fehler.length === 0, JSON.stringify(S1.P.fehler).slice(0, 300));
st = await stand379(S1.P);
pruefe('B11 alle Karten-Ids über alle Boards hinweg sind eindeutig', new Set(st.boards.flatMap((b) => b.nodes.map((n) => n.id))).size === st.boards.reduce((s, b) => s + b.nodes.length, 0));
// Daten des Zeitplans: beginnt heute
const plan = st.boards.find((b) => /Projektplan/.test(b.name)).nodes.find((n) => n.type === 'gantt');
pruefe('B12 der Zeitplan der Projekt-Vorlage beginnt heute', plan.data.rows[0].start === new Date().toISOString().slice(0, 10) && plan.data.rows.length === 4, JSON.stringify(plan.data.rows.map((r) => [r.name, r.start, r.end])));
const proto = st.boards.find((b) => /Besprechung/.test(b.name)).nodes.find((n) => n.type === 'minutes');
pruefe('B13 das Protokoll der Besprechung bringt die Tagesordnung mit', proto.data.agenda.length === 4 && proto.data.agenda.includes('Beschlüsse'), JSON.stringify(proto.data.agenda));
const auf = st.boards.find((b) => /Aufgaben-Board/.test(b.name)).nodes.find((n) => n.type === 'kanban');
pruefe('B14 das Aufgaben-Board hat vier Spalten', JSON.stringify(auf.data.cols) === JSON.stringify(['Offen', 'In Arbeit', 'Prüfen', 'Erledigt']), JSON.stringify(auf.data.cols));
await S1.ctx.close();

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: leeres Board füllen ════');
const S2 = await geraet2('L', standLeer);
pruefe('C1 auf dem leeren Board steht „Mit Vorlage beginnen"', (await S2.P.locator('[data-taste="leer-vorlage"]').count()) === 1 && /Vorlage/.test(await S2.P.locator('[data-taste="leer-vorlage"]').textContent()));
await S2.P.locator('[data-taste="leer-vorlage"]').click();
await S2.P.locator(DLG).waitFor({ timeout: 6000 }); await S2.P.waitForTimeout(250);
pruefe('C2 der Dialog spricht vom Board, vor dem man steht', /Vorlage für dieses Board/.test(await S2.P.locator(`${DLG} h2`).textContent()) && /Leer lassen/.test(await S2.P.locator(`${DLG} [data-vorlage="leer"] b`).textContent()), await S2.P.locator(`${DLG} h2`).textContent());
await vWaehlen(S2.P, 'rueckblick');
await warteBis(S2.P, async () => (await boardVon(S2.P, 'b1')).nodes.length === 11, 4000);
st = await stand379(S2.P);
pruefe('C3 die Vorlage füllt dieses Board — es entsteht kein neues', st.boards.length === 2 && st.activeId === 'b1' && st.boards[0].nodes.length === 11, JSON.stringify(st.boards.map((b) => [b.id, b.name, b.nodes.length])));
pruefe('C4 das unbenannte Board heißt jetzt wie die Vorlage', /Rückblick/.test(st.boards[0].name), st.boards[0].name);
await S2.P.waitForTimeout(700);
ks = await vKarten(S2.P);
pruefe('C5 alle Karten sind zu sehen', ks.length === 11 && imBild(ks), JSON.stringify(ks.map((k) => [k.art, Math.round(k.l), Math.round(k.t), Math.round(k.r), Math.round(k.b)])).slice(0, 400));
pruefe('C6 der Hinweis des leeren Boards ist weg', (await S2.P.locator('.empty-board-hint').count()) === 0);
pruefe('C7 die Meldung nennt Strg+Z', /Strg\+Z/.test(await toast(S2.P)), await toast(S2.P));
await S2.P.screenshot({ path: `${SD}/m379-c-rueckblick.png` });
await S2.P.mouse.click(1400, 870); await S2.P.waitForTimeout(200);
await S2.P.keyboard.press('Control+z');
await warteBis(S2.P, async () => (await boardVon(S2.P, 'b1')).nodes.length === 0, 4000);
pruefe('C8 Strg+Z nimmt die Vorlage zurück — das Board ist wieder leer', (await boardVon(S2.P, 'b1')).nodes.length === 0 && (await S2.P.locator('.react-flow__node').count()) === 0, String((await boardVon(S2.P, 'b1')).nodes.length));
pruefe('C9 … und bietet die Vorlagen wieder an', (await S2.P.locator('[data-taste="leer-vorlage"]').count()) === 1);
// benanntes Board behält seinen Namen
await S2.P.locator('.side-board-name, .tab', { hasText: 'Jahresplanung' }).first().click();
await warteBis(S2.P, async () => (await stand379(S2.P)).activeId === 'b2', 4000);
await S2.P.waitForTimeout(400);
await S2.P.locator('[data-taste="leer-vorlage"]').click();
await S2.P.locator(DLG).waitFor({ timeout: 6000 }); await vWaehlen(S2.P, 'swot');
await warteBis(S2.P, async () => (await boardVon(S2.P, 'b2')).nodes.length === 8, 4000);
pruefe('C10 ein Board mit eigenem Namen behält ihn', (await boardVon(S2.P, 'b2')).name === 'Jahresplanung' && (await boardVon(S2.P, 'b2')).nodes.length === 8, (await boardVon(S2.P, 'b2')).name);
await S2.P.locator('[data-taste="leer-vorlage"]').count();
pruefe('C11 keine Skriptfehler', S2.P.fehler.length === 0, JSON.stringify(S2.P.fehler).slice(0, 300));

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: die Karten arbeiten ════');
// zurück auf b1, Brainstorming einsetzen
await S2.P.locator('.side-board-name, .tab', { hasText: 'Rückblick' }).first().click();
await warteBis(S2.P, async () => (await stand379(S2.P)).activeId === 'b1', 4000);
await S2.P.waitForTimeout(400);
await S2.P.locator('[data-taste="leer-vorlage"]').click();
await S2.P.locator(DLG).waitFor({ timeout: 6000 }); await vWaehlen(S2.P, 'brainstorming');
await warteBis(S2.P, async () => (await boardVon(S2.P, 'b1')).nodes.length === 3, 4000);
await S2.P.waitForTimeout(700);
const BW = '.react-flow__node-bubbles';
ks = await vKarten(S2.P);
pruefe('D0 nach dem Zurücknehmen eine andere Vorlage: wieder alles im Bild', ks.length === 3 && imBild(ks), JSON.stringify(ks.map((k) => [k.art, Math.round(k.l), Math.round(k.t), Math.round(k.r), Math.round(k.b)])));
pruefe('D0b „So läuft es" gilt nicht als Termin (kein Datums-Chip an der Notiz)', (await S2.P.locator('.react-flow__node-note .due-chip').count()) === 0, String(await S2.P.locator('.react-flow__node-note .due-chip').count()));
pruefe('D1 die Bubbles-Karte zeigt die Frage der Vorlage', /Wie könnten wir/.test(await S2.P.locator(`${BW} [data-taste="bub-frage"]`).inputValue()), await S2.P.locator(`${BW} [data-taste="bub-frage"]`).inputValue());
await S2.P.locator(`${BW} [data-taste="bub-eingabe"]`).fill('Erste Idee'); await S2.P.keyboard.press('Enter'); await S2.P.waitForTimeout(500);
pruefe('D2 … und nimmt Ideen an', (await S2.P.locator(`${BW} [data-taste="bub-blase"]`).count()) === 1);
const anleitung = await S2.P.locator('.react-flow__node-note').first().textContent();
pruefe('D3 die Notiz daneben erklärt den Ablauf in vier Schritten', /So läuft es/.test(anleitung) && /Punkte vergeben/.test(anleitung), anleitung.slice(0, 160));
const nid = (await boardVon(S2.P, 'b1')).nodes.find((n) => n.type === 'note').id;
await inKarte(S2.P, 'So läuft es');
await S2.P.keyboard.press('Control+End'); await S2.P.keyboard.type(' — klappt'); await S2.P.waitForTimeout(300);
await heraus(S2.P);
await warteBis(S2.P, async () => /klappt/.test(JSON.stringify((await boardVon(S2.P, 'b1')).nodes.find((n) => n.id === nid).data.blocks)), 5000);
pruefe('D4 die Notiz der Vorlage lässt sich beschreiben', /klappt/.test(JSON.stringify((await boardVon(S2.P, 'b1')).nodes.find((n) => n.id === nid).data.blocks)));
pruefe('D5 keine Skriptfehler', S2.P.fehler.length === 0, JSON.stringify(S2.P.fehler).slice(0, 300));
await S2.ctx.close();

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Gruppe ════');
const A = await geraet2('A', standGruppe);
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
await A.P.locator('[data-taste="leer-vorlage"]').click();
await A.P.locator(DLG).waitFor({ timeout: 6000 }); await vWaehlen(A.P, 'entscheidung');
await warteBis(A.P, async () => (await boardVon(A.P, 'bx')).nodes.length === 7, 4000);
const angekommen = await warteBis(G.P, async () => ((await boardVon(G.P, 'bx'))?.nodes.length ?? 0) === 7, 15000);
pruefe('E1 Anna setzt im geteilten Board eine Vorlage ein — beim Gast erscheinen alle sieben Karten', angekommen && (await G.P.locator('.react-flow__node').count()) === 7, String((await boardVon(G.P, 'bx'))?.nodes.length));
pruefe('E2 der Name des geteilten Boards bleibt', (await boardVon(A.P, 'bx')).name === 'Planung', (await boardVon(A.P, 'bx')).name);
const GB = '.react-flow__node-bubbles';
await G.P.locator(`${GB} [data-taste="bub-eingabe"]`).fill('Weg A'); await G.P.keyboard.press('Enter');
const zurueck = await warteBis(A.P, async () => (await A.P.locator(`${GB} [data-taste="bub-blase"]`).count()) === 1, 12000);
pruefe('E3 der Gast trägt in die Bubbles der Vorlage ein — Anna sieht es', zurueck);
pruefe('E4 kein „doppelt bearbeitet", keine Skriptfehler', !/doppelt bearbeitet/.test(await toast(A.P)) && !/doppelt bearbeitet/.test(await toast(G.P)) && A.P.fehler.length === 0 && G.P.fehler.length === 0, JSON.stringify([A.P.fehler, G.P.fehler]).slice(0, 300));
await A.ctx.close(); await G.ctx.close();

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Telefon, Texte ════');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'de-DE' });
  await dienste(ctx);
  await ctx.addInitScript(({ st }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: standLeer });
  const T = await ctx.newPage(); const fehler = [];
  T.on('pageerror', (e) => fehler.push(e.message));
  await T.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' }); await T.waitForTimeout(1500);
  await T.locator('[data-taste="leer-vorlage"]').tap();
  await T.locator(DLG).waitFor({ timeout: 6000 }); await T.waitForTimeout(300);
  const m = await T.locator(DLG).evaluate((d) => { const r = d.getBoundingClientRect(); const g = d.querySelector('.vorlagen-gitter'); const k = [...d.querySelectorAll('[data-taste="vorlage"]')].map((e) => e.getBoundingClientRect()); return { l: r.left, r: r.right, b: r.bottom, quer: g.scrollWidth - g.clientWidth, spalten: new Set(k.map((x) => Math.round(x.left))).size, klein: Math.min(...k.map((x) => x.width)) }; });
  pruefe('F1 Telefon: der Dialog passt in die Breite, zwei Spalten, Kacheln gut zu treffen', m.l >= 0 && m.r <= 390 && m.quer <= 1 && m.spalten === 2 && m.klein >= 140, JSON.stringify(m));
  await T.screenshot({ path: `${SD}/m379-f-telefon.png` });
  await T.locator(`${DLG} [data-vorlage="aufgaben"]`).scrollIntoViewIfNeeded();
  await T.locator(`${DLG} [data-vorlage="aufgaben"]`).tap(); await T.waitForTimeout(1200);
  const n = await T.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.length);
  pruefe('F2 Telefon: Antippen setzt die Vorlage ein', n === 2 && (await T.locator('.react-flow__node').count()) === 2 && fehler.length === 0, `${n} ${JSON.stringify(fehler).slice(0, 200)}`);
  await ctx.close();
}
const quelle = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
pruefe('F3 „Was ist neu" nennt die Vorlagen (M379), neueste zuerst', /\(M379\)/.test(quelle) && /Board aus Vorlage/.test(quelle) && quelle.indexOf('(M379)') < quelle.indexOf('(M378)'));
const haupt = readFileSync(path.join(DIST, 'index.html'), 'utf-8');
const hauptJs = /assets\/(index-[^"]+\.js)/.exec(haupt)?.[1];
pruefe('F4 die Vorlagen reisen nicht mit dem Start — eigenes Paket, erst beim Öffnen geladen', !!hauptJs && !/Gut gelaufen/.test(readFileSync(path.join(DIST, 'assets', hauptJs), 'utf-8')), String(hauptJs));

console.log(`\n  m379-vorlagen: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
