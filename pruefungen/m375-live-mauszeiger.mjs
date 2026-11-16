/**
 * M375 — Live-Mauszeiger und Laserpointer in gemeinsamen Boards.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m364–m371).
 *
 *   A  Zeiger auf dem Board: Jeder sieht die Zeiger der anderen — an derselben Stelle des Boards, mit Namen,
 *      in der Farbe der Person, in gleichbleibender Größe; den eigenen nicht. Abschaltbar je Gerät.
 *   B  Drosselung: zu zweit flüssig, in großer Runde selten — die Summe bleibt klein.
 *   C  Vorführen: Der Zeiger des Vorführenden ist ein Laserpunkt.
 *   D  Folien-Präsentation: Laser mit L; führt man vor, steht er bei allen an derselben Stelle der Folie.
 *   E  Allein: Der Laser geht auch ohne Team. Wer geht, nimmt seinen Zeiger mit.
 *   F  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m375-live-mauszeiger.mjs`
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
const PORT = 4593;
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
          // M391: Für die Drosselung zählen nur gemeldete STELLEN — das „weg" eines anderen, der gerade stillhält, ist keine
          if (j.payload?.event === 'maus' && !j.payload?.payload?.weg) sb.aufrufe.mausStelle = (sb.aufrufe.mausStelle ?? 0) + 1;
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
/** M391: Die Werkzeuge der Gruppe (Vorführen, Timer, QR-Code, Mauszeiger, Name) stehen in der Liste hinter der Leiste */
const gruppeAuf = async (P) => { if (!(await P.locator('[data-taste="live-liste"]').count()) && (await P.locator('[data-taste="live-auf"]').count())) { await P.locator('[data-taste="live-auf"]').click(); await P.waitForTimeout(250); } };
const gruppeZu = async (P) => { if (await P.locator('[data-taste="live-liste"]').count()) { await P.locator('[data-taste="live-auf"]').click(); await P.waitForTimeout(150); } };
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


const standTeam = {
  boards: [board('bx', 'Planung', [note('x1', 'Erste Folie', 40, 60), note('x2', 'Zweite Folie', 420, 60)])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
/** Die Zeiger der anderen, wie dieses Gerät sie zeigt */
const zeiger = (P) => P.evaluate(() => [...document.querySelectorAll('[data-taste="live-zeiger"]')].map((el) => {
  const t = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(el.style.transform) ?? [];
  const spitze = el.getBoundingClientRect();
  const pfeil = el.querySelector('.live-zeiger-pfeil')?.getBoundingClientRect();
  return {
    name: el.dataset.name, laser: el.hasAttribute('data-laser'), farbe: el.style.getPropertyValue('--farbe'),
    x: Number(t[1]), y: Number(t[2]), k: Number(t[3]), sx: spitze.left, sy: spitze.top,
    pfeilBreite: pfeil ? pfeil.width : null, punkt: !!el.querySelector('.laser-punkt'), schild: el.querySelector('.live-zeiger-name')?.textContent ?? '',
    gleiten: el.style.transitionDuration,
  };
}));
/** Bildschirmpunkt ↔ Board-Koordinaten auf diesem Gerät */
const flow = (P, sx, sy) => P.evaluate(([sx, sy]) => {
  const el = document.querySelector('.react-flow'); const r = el.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
  return { x: (sx - r.left - m.e) / m.a, y: (sy - r.top - m.f) / m.d, zoom: m.a };
}, [sx, sy]);
const schirm = (P, fx, fy) => P.evaluate(([fx, fy]) => {
  const el = document.querySelector('.react-flow'); const r = el.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform);
  return { x: fx * m.a + m.e + r.left, y: fy * m.d + m.f + r.top };
}, [fx, fy]);
/** Über die freie Fläche fahren (ohne zu drücken) */
const fahren = async (P, von, nach, schritte = 6, pause = 25) => {
  for (let i = 1; i <= schritte; i++) { await P.mouse.move(von[0] + (nach[0] - von[0]) * i / schritte, von[1] + (nach[1] - von[1]) * i / schritte); await P.waitForTimeout(pause); }
};
const nahe = (a, b, t = 3) => Math.abs(a - b) <= t;
const chipFarbe = (P, name) => P.evaluate((n) => [...document.querySelectorAll('[data-taste="live-chip"]')].find((c) => c.dataset.name === n)?.style.getPropertyValue('--farbe') ?? null, name);

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Zeiger auf dem Board ════');
const A = await geraet2('A', standTeam);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
await warteBis(A.P, () => sb.live.length >= 1, 8000);
const topic = `realtime:pn-${kanalVon(uidA, 'bx')}`;

// allein im Board: nichts geht hinaus
await fahren(A.P, [800, 600], [900, 650]);
await A.P.waitForTimeout(400);
pruefe('A1 allein im Board sendet niemand seine Stelle', (sb.aufrufe.maus ?? 0) === 0, String(sb.aufrufe.maus));

const G = await geraet2('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 8000);
const annaName = await G.P.evaluate(() => document.querySelector('[data-taste="live-chip"]')?.dataset.name ?? '');
pruefe('A2 vor der ersten Bewegung ist kein Zeiger zu sehen', (await zeiger(A.P)).length === 0 && (await zeiger(G.P)).length === 0);
await gruppeAuf(A.P);
pruefe('A3 der Schalter für die Mauszeiger ist da und an', (await A.P.locator('[data-taste="live-maus"]').getAttribute('aria-pressed')) === 'true');
await gruppeZu(A.P);

await fahren(A.P, [820, 600], [900, 640]);
await warteBis(G.P, async () => (await zeiger(G.P)).length === 1, 5000);
await G.P.waitForTimeout(900);
let zg = await zeiger(G.P);
const zielA = await flow(A.P, 900, 640);
console.log('    Anna zeigt auf', JSON.stringify(zielA), '· Gerd sieht', JSON.stringify(zg));
pruefe('A4 Gerd sieht einen Zeiger — mit Annas Namen', zg.length === 1 && zg[0].name === annaName && zg[0].schild === annaName && !!annaName, JSON.stringify(zg));
pruefe('A5 … an derselben Stelle des Boards', zg[0] && nahe(zg[0].x, zielA.x, 2) && nahe(zg[0].y, zielA.y, 2), `${zg[0]?.x},${zg[0]?.y} gegen ${zielA.x},${zielA.y}`);
const aufG = await schirm(G.P, zielA.x, zielA.y);
pruefe('A6 … also auch auf Gerds Bildschirm dort, wo diese Stelle bei ihm liegt', zg[0] && nahe(zg[0].sx, aufG.x, 3) && nahe(zg[0].sy, aufG.y, 3), `${zg[0]?.sx},${zg[0]?.sy} gegen ${aufG.x},${aufG.y}`);
pruefe('A7 … in Annas Farbe (wie ihr Kürzel)', zg[0] && !!zg[0].farbe && zg[0].farbe === (await chipFarbe(G.P, annaName)), `${zg[0]?.farbe} / ${await chipFarbe(G.P, annaName)}`);
pruefe('A8 … als Pfeil in fester Größe (unabhängig vom Zoom)', zg[0] && !zg[0].laser && nahe(zg[0].pfeilBreite, 18, 1) && nahe(zg[0].k * (await flow(G.P, 0, 0)).zoom, 1, 0.02), JSON.stringify({ b: zg[0]?.pfeilBreite, k: zg[0]?.k }));
pruefe('A9 Anna sieht ihren eigenen Zeiger nicht', (await zeiger(A.P)).length === 0);
await G.P.screenshot({ path: `${SD}/m375-a-zeiger.png` });

// Gerd zoomt heraus: Der Zeiger bleibt an seiner Stelle und gleich groß
await G.P.mouse.move(1100, 700);
await G.P.keyboard.down('Control'); await G.P.mouse.wheel(0, 400); await G.P.keyboard.up('Control');
await G.P.waitForTimeout(700);
const zoomG = (await flow(G.P, 0, 0)).zoom;
zg = await zeiger(G.P);
const aufG2 = await schirm(G.P, zielA.x, zielA.y);
pruefe('A10 nach Gerds Zoomen steht der Zeiger weiter auf derselben Board-Stelle, gleich groß', zg[0] && nahe(zg[0].sx, aufG2.x, 3) && nahe(zg[0].sy, aufG2.y, 3) && nahe(zg[0].pfeilBreite, 18, 1),
  JSON.stringify({ zoom: zoomG, z: zg[0], soll: aufG2 }));

await fahren(G.P, [1000, 620], [1080, 700]);
await warteBis(A.P, async () => (await zeiger(A.P)).length === 1, 5000);
await A.P.waitForTimeout(700);
const za = await zeiger(A.P);
const zielG = await flow(G.P, 1080, 700);
pruefe('A11 Anna sieht Gerds Zeiger — „Gerd", an seiner Stelle', za.length === 1 && za[0].name === 'Gerd' && nahe(za[0].x, zielG.x, 2) && nahe(za[0].y, zielG.y, 2), JSON.stringify({ za, zielG }));
pruefe('A12 die beiden haben verschiedene Farben', za[0] && zg[0] && za[0].farbe !== zg[0].farbe, `${za[0]?.farbe} / ${zg[0]?.farbe}`);

// Abschalten: Anna blendet die Zeiger aus
await gruppeAuf(A.P);
await A.P.locator('[data-taste="live-maus"]').click();
await gruppeZu(A.P);
await warteBis(G.P, async () => (await zeiger(G.P)).length === 0, 4000);
pruefe('A13 Anna schaltet ab: Ihr Zeiger verschwindet bei Gerd sofort', (await zeiger(G.P)).length === 0);
const t14 = Date.now();
await warteBis(A.P, async () => (await zeiger(A.P)).length === 0, 4000);
console.log(`    Gerds Zeiger war bei Anna nach ${Date.now() - t14} ms weg`);
await gruppeAuf(A.P);
pruefe('A14 … und sie sieht Gerds Zeiger nicht mehr', (await zeiger(A.P)).length === 0 && (await A.P.locator('[data-taste="live-maus"]').getAttribute('aria-pressed')) === 'false',
  JSON.stringify({ z: await zeiger(A.P), an: await A.P.locator('[data-taste="live-maus"]').getAttribute('aria-pressed') }));
await gruppeZu(A.P);
const vorAus = sb.aufrufe.maus;
await fahren(A.P, [820, 600], [700, 560]);
await fahren(G.P, [1080, 700], [1000, 640]);
await A.P.waitForTimeout(700);
pruefe('A15 abgeschaltet sendet Anna nichts und zeigt nichts — Gerd sendet weiter', (await zeiger(A.P)).length === 0 && (await zeiger(G.P)).length === 0 && sb.aufrufe.maus > vorAus, `${vorAus} → ${sb.aufrufe.maus}`);
await A.P.reload({ waitUntil: 'domcontentloaded' });
await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 12000);
await gruppeAuf(A.P);
pruefe('A16 die Wahl bleibt nach dem Neuladen', (await A.P.locator('[data-taste="live-maus"]').getAttribute('aria-pressed')) === 'false');
await gruppeZu(A.P);
await gruppeAuf(A.P);
await A.P.locator('[data-taste="live-maus"]').click();
await gruppeZu(A.P);
await fahren(A.P, [700, 560], [820, 600]);
await warteBis(G.P, async () => (await zeiger(G.P)).length === 1, 5000);
pruefe('A17 wieder eingeschaltet ist Annas Zeiger wieder da', (await zeiger(G.P)).length === 1);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Drosselung ════');
await A.P.waitForTimeout(900);
let vor = sb.aufrufe.maus;
let t0 = Date.now();
await fahren(A.P, [700, 500], [1000, 700], 80, 25);     // rund zwei Sekunden Dauerbewegung
let dauer = Date.now() - t0;
await A.P.waitForTimeout(300);
const zuZweit = sb.aufrufe.maus - vor;
console.log(`    zu zweit: ${zuZweit} Meldungen in ${dauer} ms`);
pruefe('B1 zu zweit: flüssig, aber gedrosselt (höchstens rund elf Meldungen je Sekunde)', zuZweit >= dauer / 250 && zuZweit <= dauer / 90 + 3, `${zuZweit} in ${dauer} ms`);
await warteBis(G.P, async () => { const z = (await zeiger(G.P))[0]; return !!z && nahe(z.x, (await flow(A.P, 1000, 700)).x, 2); }, 4000);
const letzte = (await zeiger(G.P))[0]; const endeA = await flow(A.P, 1000, 700);
pruefe('B2 die letzte Stelle kommt immer an', letzte && nahe(letzte.x, endeA.x, 2) && nahe(letzte.y, endeA.y, 2), `${letzte?.x},${letzte?.y} gegen ${endeA.x},${endeA.y}`);
pruefe('B3 zwischen zwei Meldungen gleitet der Zeiger', letzte && parseFloat(letzte.gleiten) >= 60, String(letzte?.gleiten));

// 48 weitere Teilnehmer: jeder meldet nur noch selten
const leute = Array.from({ length: 48 }, (_, i) => ({ id: `f${String(i + 1).padStart(2, '0')}`, name: `Teilnehmerin ${String(i + 1).padStart(2, '0')}`, farbe: ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed'][i % 5], karte: null, seit: null }));
for (const t of leute) fakeDa(topic, t.id, t);
await warteBis(A.P, async () => /50 dabei/.test(await zahl(A.P)), 8000);
await A.P.waitForTimeout(800);
vor = sb.aufrufe.mausStelle ?? 0; t0 = Date.now();
await fahren(A.P, [1000, 700], [700, 500], 100, 25);    // gut zweieinhalb Sekunden
dauer = Date.now() - t0;
await A.P.waitForTimeout(900);
const inGruppe = (sb.aufrufe.mausStelle ?? 0) - vor;
console.log(`    zu fünfzigst: ${inGruppe} Meldungen in ${dauer} ms`);
pruefe('B4 zu fünfzigst: höchstens alle 0,7 Sekunden eine Meldung je Person', inGruppe >= 2 && inGruppe <= dauer / 700 + 2, `${inGruppe} in ${dauer} ms`);
// alle fünfzig bewegen sich: Gerd zeigt höchstens vierzig Zeiger — und bleibt bedienbar
for (let r = 0; r < 3; r++) { leute.forEach((t, i) => fakeSenden(topic, 'maus', { v: t.id, x: 100 + (i % 10) * 90 + r * 12, y: 200 + Math.floor(i / 10) * 80 + r * 9 })); await G.P.waitForTimeout(220); }
await G.P.waitForTimeout(400);
const viele = await zeiger(G.P);
pruefe('B5 fünfzig Zeiger in Bewegung: gezeigt werden höchstens vierzig', viele.length === 40, String(viele.length));
pruefe('B6 jeder mit seinem Namen und seiner Farbe', viele.every((z) => /Teilnehmerin \d\d|anna/i.test(z.name) || z.name === annaName) && new Set(viele.map((z) => z.farbe)).size >= 4, JSON.stringify(viele.slice(0, 2)));
// Unsinn von außen richtet nichts an
fakeSenden(topic, 'maus', { v: 'fremd', x: 1, y: 1 });
fakeSenden(topic, 'maus', { v: 'f01', x: 'a', y: 2 });
fakeSenden(topic, 'maus', { v: 'f01', x: 2, y: 2, f: 'x1' });        // Folien-Stelle außerhalb 0…1
fakeSenden(topic, 'maus', null);
await G.P.waitForTimeout(400);
const nachUnsinn = await zeiger(G.P);
pruefe('B7 Meldungen von Unbekannten oder mit unsinnigen Werten werden verworfen', nachUnsinn.length === 40 && !nachUnsinn.some((z) => z.name === 'fremd') && nachUnsinn.every((z) => Number.isFinite(z.x)), String(nachUnsinn.length));
for (const t of leute) fakeWeg(topic, t.id, t);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
await warteBis(G.P, async () => (await zeiger(G.P)).length <= 1, 5000);
pruefe('B8 wer geht, nimmt seinen Zeiger mit', (await zeiger(G.P)).length <= 1, String((await zeiger(G.P)).length));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Vorführen — Laser auf dem Board ════');
await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 8000);
await gruppeAuf(A.P);
await A.P.locator('[data-taste="vorfuehren"]').click();
await warteBis(G.P, async () => /führt vor/.test(await zband(G.P)), 6000);
await G.P.waitForTimeout(900);          // Gerds Ansicht fährt mit
await fahren(A.P, [760, 520], [880, 600]);
await warteBis(G.P, async () => (await zeiger(G.P)).some((z) => z.laser), 5000);
await G.P.waitForTimeout(700);
const laser = (await zeiger(G.P)).find((z) => z.laser);
const zielL = await flow(A.P, 880, 600);
const aufGL = await schirm(G.P, zielL.x, zielL.y);
console.log('    Laser bei Gerd:', JSON.stringify(laser));
pruefe('C1 Annas Zeiger ist bei Gerd jetzt ein Laserpunkt (kein Pfeil)', !!laser && laser.punkt && laser.pfeilBreite === null, JSON.stringify(laser));
pruefe('C2 … mit „📣" und ihrem Namen', !!laser && laser.schild.includes('📣') && laser.schild.includes(annaName), laser?.schild);
pruefe('C3 … an der Stelle, auf die Anna zeigt', !!laser && nahe(laser.x, zielL.x, 2) && nahe(laser.y, zielL.y, 2) && nahe(laser.sx, aufGL.x, 4) && nahe(laser.sy, aufGL.y, 4), JSON.stringify({ laser, zielL, aufGL }));
await G.P.screenshot({ path: `${SD}/m375-c-laser-board.png` });

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Laser in der Folien-Präsentation ════');
await vortragStart(A.P);
await warteBis(G.P, async () => (await imVortrag(G.P)) === 1, 8000);
pruefe('D1 Annas Präsentation öffnet sich auch bei Gerd', (await imVortrag(G.P)) === 1 && (await folie(G.P)) === (await folie(A.P)), `${await folie(G.P)} / ${await folie(A.P)}`);
pruefe('D2 es gibt den Laser-Knopf, aus', (await A.P.locator('[data-taste="vortrag-laser"]').getAttribute('aria-pressed')) === 'false' && (await A.P.locator('[data-taste="folien-laser"]').count()) === 0);
await A.P.keyboard.press('l');
await A.P.waitForTimeout(300);
pruefe('D3 Taste L schaltet den Laser ein', (await A.P.locator('[data-taste="vortrag-laser"]').getAttribute('aria-pressed')) === 'true' && (await A.P.locator('.folien-laser.an').count()) === 1);
/** Lage der Folie und des Lasers darin */
const blatt = (P) => P.evaluate(() => {
  const r = document.querySelector('.presenter .presenter-slide').getBoundingClientRect();
  const l = document.querySelector('[data-taste="folien-laser"]')?.getBoundingClientRect();
  const mitte = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, sichtbar: getComputedStyle(el).opacity, name: el.textContent }; };
  return { x: r.left, y: r.top, w: r.width, h: r.height, schicht: l ? { x: l.left, y: l.top, w: l.width, h: l.height } : null,
    mein: mitte(document.querySelector('[data-taste="laser-mein"]')), fern: mitte(document.querySelector('[data-taste="laser-fern"]')) };
});
let ba = await blatt(A.P);
pruefe('D4 die Laser-Schicht liegt genau über der Folie', ba.schicht && nahe(ba.schicht.x, ba.x, 1) && nahe(ba.schicht.y, ba.y, 1) && nahe(ba.schicht.w, ba.w, 1) && nahe(ba.schicht.h, ba.h, 1), JSON.stringify(ba));
const ax = ba.x + ba.w * 0.3; const ay = ba.y + ba.h * 0.4;
await fahren(A.P, [ax - 80, ay - 40], [ax, ay]);
await A.P.waitForTimeout(300);
ba = await blatt(A.P);
pruefe('D5 Annas Punkt folgt ihrem Zeiger', ba.mein && ba.mein.sichtbar === '1' && nahe(ba.mein.x, ax, 2) && nahe(ba.mein.y, ay, 2), JSON.stringify(ba.mein));
pruefe('D6 der Mauszeiger selbst ist über der Folie ausgeblendet', (await A.P.evaluate(() => getComputedStyle(document.querySelector('.folien-laser.an')).cursor)) === 'none');
await warteBis(G.P, async () => !!(await blatt(G.P)).fern, 5000);
await G.P.waitForTimeout(700);
let bg = await blatt(G.P);
console.log('    Folie Anna', JSON.stringify({ w: ba.w, h: ba.h }), '· Gerd', JSON.stringify({ w: bg.w, h: bg.h, fern: bg.fern }));
pruefe('D7 Gerd sieht Annas Laser — an derselben Stelle der Folie (30 % / 40 %)', bg.fern && nahe(bg.fern.x, bg.x + bg.w * 0.3, 3) && nahe(bg.fern.y, bg.y + bg.h * 0.4, 3), JSON.stringify(bg));
pruefe('D8 … mit ihrem Namen', bg.fern && bg.fern.name.includes(annaName), bg.fern?.name);
pruefe('D9 Gerd selbst hat keinen eigenen Laser an (seine Folie bleibt bedienbar)', (await G.P.locator('.folien-laser.an').count()) === 0 && (await G.P.evaluate(() => getComputedStyle(document.querySelector('[data-taste="folien-laser"]')).pointerEvents)) === 'none');
await G.P.screenshot({ path: `${SD}/m375-d-laser-folie.png` });

// nächste Folie: Der Laser der alten Folie steht dort nicht herum
const vorFolie = await folie(A.P);
await A.P.keyboard.press('ArrowRight');
await warteBis(G.P, async () => (await folie(G.P)) !== vorFolie, 6000);
await G.P.waitForTimeout(500);
pruefe('D10 mit eingeschaltetem Laser lässt sich weiterblättern — Gerd blättert mit', (await folie(A.P)) !== vorFolie && (await folie(G.P)) === (await folie(A.P)), `${await folie(A.P)} / ${await folie(G.P)}`);
pruefe('D11 auf der neuen Folie steht kein alter Laserpunkt', !(await blatt(G.P)).fern);
ba = await blatt(A.P);
await fahren(A.P, [ba.x + ba.w * 0.5, ba.y + ba.h * 0.5], [ba.x + ba.w * 0.7, ba.y + ba.h * 0.6]);
await warteBis(G.P, async () => !!(await blatt(G.P)).fern, 5000);
await G.P.waitForTimeout(600);
bg = await blatt(G.P);
pruefe('D12 … bis Anna dort zeigt (70 % / 60 %)', bg.fern && nahe(bg.fern.x, bg.x + bg.w * 0.7, 3) && nahe(bg.fern.y, bg.y + bg.h * 0.6, 3), JSON.stringify(bg.fern));
await A.P.locator('[data-taste="vortrag-laser"]').click();
await warteBis(G.P, async () => !(await blatt(G.P)).fern, 4000);
pruefe('D13 Laser aus: Der Punkt verschwindet bei Gerd', !(await blatt(G.P)).fern && (await A.P.locator('[data-taste="folien-laser"]').count()) === 0);
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => (await imVortrag(G.P)) === 0, 6000);
await A.P.locator('[data-taste="zeig-ende"]').click().catch(() => {});

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Allein; wer geht ════');
// Gerd allein in der Präsentation (führt nicht vor): Der Laser ist nur für ihn
await vortragStart(G.P);
await G.P.locator('[data-taste="vortrag-laser"]').click();
const be = await blatt(G.P);
vor = sb.aufrufe.maus;
await fahren(G.P, [be.x + be.w * 0.2, be.y + be.h * 0.2], [be.x + be.w * 0.6, be.y + be.h * 0.5]);
await G.P.waitForTimeout(400);
const bm = await blatt(G.P);
pruefe('E1 ohne Vorführen: Der Laser folgt dem Zeiger', bm.mein && bm.mein.sichtbar === '1' && nahe(bm.mein.x, be.x + be.w * 0.6, 2) && nahe(bm.mein.y, be.y + be.h * 0.5, 2), JSON.stringify(bm.mein));
pruefe('E2 … und geht an niemanden hinaus', sb.aufrufe.maus === vor, `${vor} → ${sb.aufrufe.maus}`);
await G.P.keyboard.press('Escape'); await G.P.waitForTimeout(400);
pruefe('E3 nach dem Schließen ist der Laser beim nächsten Mal wieder aus', (await imVortrag(G.P)) === 0);
await vortragStart(G.P);
pruefe('E3b … wirklich aus', (await G.P.locator('[data-taste="vortrag-laser"]').getAttribute('aria-pressed')) === 'false');
await G.P.keyboard.press('Escape'); await G.P.waitForTimeout(300);

await fahren(G.P, [1000, 620], [1060, 660]);
await warteBis(A.P, async () => (await zeiger(A.P)).some((z) => z.name === 'Gerd'), 5000);
pruefe('E4 Gerds Zeiger steht wieder bei Anna', (await zeiger(A.P)).some((z) => z.name === 'Gerd' && !z.laser));
await G.ctx.close();
await warteBis(A.P, async () => (await zeiger(A.P)).length === 0, 9000);
pruefe('E5 Gerd schließt das Fenster: Sein Zeiger verschwindet bei Anna', (await zeiger(A.P)).length === 0);

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
const quelle = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf-8');
pruefe('F1 „Was ist neu" nennt die Mauszeiger (M375)', /\(M375\)/.test(quelle) && /Mauszeiger/.test(quelle) && /Laser/.test(quelle));
pruefe('F2 keine Skriptfehler', A.P.fehler.length === 0 && G.P.fehler.length === 0, JSON.stringify([A.P.fehler, G.P.fehler]).slice(0, 400));

console.log(`\n  m375-live-mauszeiger: ${ok} bestanden, ${bad} fehlgeschlagen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
