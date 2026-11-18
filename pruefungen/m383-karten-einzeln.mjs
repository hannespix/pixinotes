/**
 * M383 — Karten einzeln schreiben: auch der Besitzer und Gäste mit Konto schicken nur, was sich geändert hat.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m366), dazu die neue Funktion board_aendern — sie legt die
 * Umgebung wie der echte Server mit umsortierten Schlüsseln ab (jsonb).
 *
 *   A  Anna allein: neue Karte, Text, Lage, Löschen reisen als Patch mit genau dieser Karte — wenige hundert
 *      Zeichen statt des ganzen Boards (hier über 200 kB). Danach Ruhe: kein zweites Schreiben, kein Neuladen.
 *      Ändert sich das Board selbst (Name), reist es wie bisher als Ganzes.
 *   B  Annas zweites Gerät: bekommt die Änderungen, schreibt nichts zurück; beide zugleich → beides bleibt,
 *      ohne dass ein Board als Ganzes reist.
 *   C  Bernd (Gast mit Konto): schreibt kartenweise in Annas Zeile (nicht mehr freigabe_schreiben); beide
 *      zugleich → beides bleibt. Stellt Anna auf „Nur lesen", lehnt der Server ab — Hinweis wie bisher.
 *   D  Gerd (per Link, ohne Konto) und Anna: Änderungen in beide Richtungen, Anna schreibt danach weiter
 *      kartenweise.
 *   E  Server ohne board_aendern: ein Versuch, dann der bisherige Weg (ganzes Board) — nichts geht verloren.
 *   F  Migration, Hilfe.
 */
// Läuft aus dem Repository: `node pruefungen/m383-karten-einzeln.mjs`
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
const PORT = 4695;
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
  ohneBoardAendern: false,   // M383: Server ohne board_aendern
  patches: [],            // M383: { geraet, von, besitzer, board, p, bytes }
  ganz: [],               // M383: { geraet, name, bytes } — Boards, die als Ganzes geschrieben wurden
  fehlt404: 0,
  geholt: [],             // M383: { geraet, name } — Boards, deren Inhalt gelesen wurde
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
/** wie jsonb: Schlüssel nach Länge, dann nach Zeichen — der echte Server legt die Umgebung so ab */
const sortiert = (x) => Array.isArray(x) ? x.map(sortiert) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort((p, q) => p.length - q.length || (p < q ? -1 : 1)).map((k) => [k, sortiert(x[k])])) : x;
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
async function dienste(ctx, geraetName = '?') {
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
      for (const d of b.p_dateien ?? []) { if (/^board-/.test(d.name)) sb.ganz.push({ geraet: geraetName, name: d.name, bytes: String(d.inhalt ?? '').length }); schreib(uid, d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0); }
      const u = schreib(uid, 'umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length);
      return json(route, 200, u.version);
    }
    // ---- M383: kartenweise für Besitzer und Gäste mit Konto ----
    if (pfad === '/rest/v1/rpc/board_aendern' && m === 'POST') {
      if (sb.ohneBoardAendern) { sb.fehlt404 += 1; return json(route, 404, { code: 'PGRST202', message: 'Could not find the function public.board_aendern' }); }
      const b = body();
      const f = b.p_besitzer === uid ? null : freigabeFuer(b.p_besitzer, b.p_board_id, uid);
      if (b.p_besitzer !== uid && (!f || f.rolle !== 'bearbeiten')) { sb.aufrufe.keineFreigabe += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
      const name = `board-${b.p_board_id}.json`;
      const z = zeile(b.p_besitzer, name);
      if (!z) return json(route, 400, { code: 'P0002', message: 'kein board' });
      sb.patches.push({ geraet: geraetName, von: uid, besitzer: b.p_besitzer, board: b.p_board_id, p: b.p_patch, bytes: (req.postData() ?? '').length });
      const vor = z.version;
      const neu = schreib(b.p_besitzer, name, JSON.stringify(patchAuf(JSON.parse(z.inhalt), b.p_patch)), 'application/json', 0);
      const um = zeile(b.p_besitzer, 'umgebung.json');
      let umVor = null; let umNeu = null;
      if (um) {
        umVor = um.version;
        const u = JSON.parse(um.inhalt);
        u.boards[b.p_board_id] = `v${neu.version}`; u.savedAt = (b.p_besitzer === uid && b.p_saved_at) || new Date().toISOString(); u.basisEtag = String(um.version);
        umNeu = schreib(b.p_besitzer, 'umgebung.json', JSON.stringify(sortiert(u)), 'application/json', 0).version;
      }
      return json(route, 200, { version: neu.version, vor, umgebung: umNeu, umgebung_vor: umVor });
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
      if (m === 'GET') { if (fName && /^board-/.test(fName) && (select.includes('inhalt') || select.includes('*'))) sb.geholt.push({ geraet: geraetName, name: fName }); return json(route, 200, treffer.map(projiziere)); }
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
const BALLAST = 'Lorem ipsum dolor sit amet. '.repeat(900);   // ≈ 25 kB je Karte, unsichtbar
const schwer = (i) => ({ ...note(`g${i}`, `Akte ${i}`, 60 + (i % 2) * 150, 240 + Math.floor(i / 2) * 70), width: 130, data: { color: 'blue', ballast: BALLAST, blocks: [{ type: 'paragraph', content: `Akte ${i}` }] } });
const standA = {
  boards: [board('bx', 'Planung', [note('x1', 'Planung Notiz'), ...Array.from({ length: 8 }, (_, i) => schwer(i))]), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
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
  await dienste(ctx, name);
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

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Anna allein – Änderungen reisen kartenweise ════');
const A = await geraet('A1', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json') && !!zeile(uidA, 'board-bx.json'), 10000);
await A.P.waitForTimeout(1500);
const zeilenGroesse = () => zeileText(uidA, 'board-bx.json').length;
const um = () => JSON.parse(zeileText(uidA, 'umgebung.json'));
const marke = () => ({ p: sb.patches.length, g: sb.ganz.length, h: sb.geholt.length, st: sb.aufrufe.stapel, vb: sb.aufrufe.vorbedingung, fs: sb.aufrufe.freigabeSchreiben });
const seit = (m) => ({ patches: sb.patches.slice(m.p), ganz: sb.ganz.slice(m.g), geholt: sb.geholt.slice(m.h), stapel: sb.aufrufe.stapel - m.st, vorbedingung: sb.aufrufe.vorbedingung - m.vb, freigabeSchreiben: sb.aufrufe.freigabeSchreiben - m.fs });
const kurz = (d) => JSON.stringify({ patches: d.patches.map((x) => [x.geraet, x.board, x.bytes, Object.fromEntries(Object.entries(x.p).map(([k, v]) => [k, [(v.set ?? []).map((o) => o.id), v.del ?? []]]))]), ganz: d.ganz.map((x) => [x.geraet, x.name]), stapel: d.stapel, vb: d.vorbedingung, fs: d.freigabeSchreiben });
/** Kennungen aller Karten, die in den Patches seit der Marke vorkommen */
const kartenIn = (d) => [...new Set(d.patches.flatMap((x) => [...(x.p.nodes?.set ?? []).map((o) => o.id), ...(x.p.nodes?.del ?? [])]))];
const idVon = (text) => { try { return JSON.parse(bxServer()).nodes.find((n) => JSON.stringify(n.data.blocks).includes(text))?.id; } catch { return undefined; } };
pruefe('A1 neu im Konto reisen die Boards einmal als Ganzes (über 200 kB)', sb.patches.length === 0 && sb.ganz.some((g) => g.name === 'board-bx.json') && zeilenGroesse() > 200000, `${zeilenGroesse()} ${kurz(seit({ p: 0, g: 0, h: 0, st: 0, vb: 0, fs: 0 }))}`);

let m = marke();
pruefe('A2 Anna legt eine Karte an', await notizPlatz(A.P, 'Karte eins'));
await warteBis(A.P, () => /Karte eins/.test(bxServer()), 10000);
{
  const d = seit(m);
  pruefe('A3 sie geht kartenweise hinaus (board_aendern) – das Board reist nicht als Ganzes', /Karte eins/.test(bxServer()) && d.patches.length >= 1 && d.ganz.length === 0, kurz(d));
  const id = idVon('Karte eins');
  pruefe('A4 der Patch nennt genau diese eine Karte, sonst nichts', !!id && kartenIn(d).join() === id && d.patches.every((x) => Object.keys(x.p).join() === 'nodes' && !(x.p.nodes.del ?? []).length), kurz(d));
  const groesste = Math.max(...d.patches.map((x) => x.bytes));
  pruefe(`A5 unterwegs: ${groesste} Zeichen statt ${zeilenGroesse()} (das ganze Board)`, groesste < 3000 && zeilenGroesse() > 200000);
  const u = um();
  pruefe('A6 die Umgebung trägt den Stempel des Servers („v<Version>")', u.boards.bx === `v${zeile(uidA, 'board-bx.json').version}`, `${u.boards.bx} / v${zeile(uidA, 'board-bx.json').version}`);
  const stamp = await A.P.evaluate(() => localStorage.getItem('pixinotes:konto-stamp'));
  pruefe('A7 … und den Zeitpunkt des Geräts – der eigene Schreibvorgang gilt ihm nicht als fremd', u.savedAt === stamp, `${u.savedAt} / ${stamp}`);
  pruefe('A8 die anderen Karten des Boards sind unverändert da (9 + 1)', JSON.parse(bxServer()).nodes.length === 10 && JSON.parse(bxServer()).nodes.filter((n) => n.data.ballast?.length > 20000).length === 8);
}
m = marke();
await A.P.waitForTimeout(12500);   // ein voller Takt des Abgleichs
{
  const d = seit(m);
  pruefe('A9 danach ist Ruhe: kein weiteres Schreiben, das Board wird nicht neu geladen', d.patches.length === 0 && d.ganz.length === 0 && d.stapel === 0 && d.geholt.filter((g) => g.name === 'board-bx.json').length === 0, `${kurz(d)} geholt ${JSON.stringify(d.geholt)}`);
}

m = marke();
{
  const id = idVon('Karte eins');
  await inKarte(A.P, 'Karte eins'); await A.P.keyboard.press('End'); await A.P.keyboard.type(' ergänzt', { delay: 15 }); await heraus(A.P);
  const da = await warteBis(A.P, () => /Karte eins ergänzt/.test(bxServer()), 10000);
  const d = seit(m);
  pruefe('A10 Text geändert → ein Patch mit genau dieser Karte', da && kartenIn(d).join() === id && d.ganz.length === 0, kurz(d));
}
m = marke();
{
  await leer(A.P);
  const id = idVon('Karte eins');
  const lage = () => JSON.stringify(JSON.parse(bxServer()).nodes.find((n) => n.id === id)?.position);
  const lageVor = lage();
  const gezogen = await ziehen(A.P, 'Karte eins', 60, 90);
  const da = await warteBis(A.P, () => lage() !== lageVor, 10000);
  const d = seit(m);
  pruefe('A11 Karte verschoben → ein Patch mit genau dieser Karte', gezogen && da && kartenIn(d).join() === id && d.ganz.length === 0, kurz(d));
}
m = marke();
{
  const id = idVon('Karte eins');
  await leer(A.P); await waehlen(A.P, 'Karte eins'); await A.P.keyboard.press('Delete'); await A.P.waitForTimeout(600);
  const weg = await warteBis(A.P, () => !/Karte eins/.test(bxServer()), 10000);
  const d = seit(m);
  pruefe('A12 Karte gelöscht → der Patch nennt nur ihre Kennung', weg && d.patches.length >= 1 && d.patches.every((x) => !(x.p.nodes.set ?? []).length && (x.p.nodes.del ?? []).join() === id) && d.ganz.length === 0 && JSON.parse(bxServer()).nodes.length === 9, kurz(d));
}
m = marke();
{
  const z = A.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
  await z.hover(); await A.P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click({ force: true }); await A.P.waitForTimeout(300);
  await A.P.locator('.ebenen-menu button', { hasText: 'Umbenennen' }).first().click(); await A.P.waitForTimeout(400);
  const feld = A.P.locator('.side-board-name input, input.side-board-name').first();
  await feld.fill('Planung 2'); await feld.press('Enter');
  const da = await warteBis(A.P, () => { try { return JSON.parse(bxServer()).name === 'Planung 2'; } catch { return false; } }, 10000);
  const d = seit(m);
  pruefe('A13 das Board umbenannt → es reist wie bisher als Ganzes (kein Patch)', da && d.ganz.some((g) => g.name === 'board-bx.json') && d.patches.length === 0, kurz(d));
}
m = marke();
{
  await leer(A.P);
  const ok1 = await notizPlatz(A.P, 'Karte zwei');
  const da = await warteBis(A.P, () => /Karte zwei/.test(bxServer()), 10000);
  const d = seit(m);
  pruefe('A14 danach wieder kartenweise', ok1 && da && d.patches.length >= 1 && d.ganz.length === 0 && kartenIn(d).join() === idVon('Karte zwei'), kurz(d));
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Annas zweites Gerät ════');
const A2 = await geraet('A2', standB);
await anmelden(A2.P, 'anna@example.de', 'geheim123', false);
await warteBis(A2.P, async () => !!(await boardVon(A2.P, 'bx')), 12000);
await boardWechseln(A2.P, 'Planung 2', 'Allgemein');
pruefe('B1 das zweite Gerät hat den Stand (mit „Karte zwei", ohne „Karte eins")', (await hat(A2.P, 'Karte zwei')) && !(await hat(A2.P, 'Karte eins')));
await A2.P.waitForTimeout(3000);
m = marke();
{
  await leer(A.P);
  const ok1 = await notizPlatz(A.P, 'Von Gerät eins');
  const da = await warteBis(A2.P, () => hat(A2.P, 'Von Gerät eins'), 14000);
  await A2.P.waitForTimeout(4000);
  const d = seit(m);
  pruefe('B2 Gerät eins legt eine Karte an → Gerät zwei zeigt sie', ok1 && da);
  pruefe('B3 Gerät zwei schreibt dafür nichts zurück', d.patches.every((x) => x.geraet === 'A1') && d.ganz.length === 0, kurz(d));
}
m = marke();
{
  const ok2 = await notizPlatz(A2.P, 'Von Gerät zwei');
  const da = await warteBis(A.P, () => hat(A.P, 'Von Gerät zwei'), 14000);
  const d = seit(m);
  pruefe('B4 Gerät zwei legt eine Karte an → kartenweise hinaus, Gerät eins zeigt sie', ok2 && da && d.patches.some((x) => x.geraet === 'A2') && d.ganz.length === 0, kurz(d));
}
await A.P.waitForTimeout(3500);
m = marke();
{
  await leer(A.P); await leer(A2.P);
  const [g1, g2] = await Promise.all([notizPlatz(A.P, 'Zugleich eins'), (async () => { await A2.P.waitForTimeout(150); return notiz(A2.P, 'Zugleich zwei', 760, 760); })()]);
  const server = await warteBis(A.P, () => /Zugleich eins/.test(bxServer()) && /Zugleich zwei/.test(bxServer()), 16000);
  const beide = await warteBis(A.P, async () => (await hat(A.P, 'Zugleich zwei')) && (await hat(A2.P, 'Zugleich eins')) && (await hat(A.P, 'Zugleich eins')) && (await hat(A2.P, 'Zugleich zwei')), 20000);
  await A.P.waitForTimeout(5000);
  const d = seit(m);
  pruefe('B5 beide Geräte schreiben zugleich → beide Karten stehen im Konto', g1 && g2 && server, `${g1} ${g2} ${kurz(d)}`);
  pruefe('B6 … und auf beiden Geräten', beide);
  pruefe('B7 … ohne dass das Board als Ganzes reiste', d.ganz.length === 0 && d.patches.length >= 2, kurz(d));
  const ids = (t) => JSON.parse(t).nodes.map((n) => n.id).sort().join();
  pruefe('B8 beide Geräte und das Konto halten dieselben Karten', ids(bxServer()) === (await boardVon(A.P, 'bx')).nodes.map((n) => n.id).sort().join() && ids(bxServer()) === (await boardVon(A2.P, 'bx')).nodes.map((n) => n.id).sort().join());
}
await A2.ctx.close();

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Bernd, Gast mit Konto ════');
await dialogOeffnen(A.P, 'Planung 2');
await A.P.locator('[data-taste="freigabe-email"]').fill('bernd@example.de');
await A.P.locator('[data-taste="freigabe-einladen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="freigabe-liste"] li').count()) === 1, 6000);
await schliessen(A.P);
const B = await geraet('B', standB);
await anmelden(B.P, 'bernd@example.de', 'geheim456', true);
const uidB = nutzerId('bernd@example.de');
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 15000);
await boardWechseln(B.P, 'Planung 2', 'anna@example.de');
await B.P.waitForTimeout(3000);
m = marke();
{
  const ok1 = await notizPlatz(B.P, 'Gruß von Bernd');
  const da = await warteBis(B.P, () => /Gruß von Bernd/.test(bxServer()), 12000);
  const d = seit(m);
  pruefe('C1 Bernd legt eine Karte an → sie steht in Annas Zeile', ok1 && da && !zeile(uidB, 'board-bx.json'));
  pruefe('C2 … kartenweise (board_aendern), nicht mehr als ganzes Board (freigabe_schreiben)', d.patches.some((x) => x.geraet === 'B' && x.von === uidB && x.besitzer === uidA) && d.freigabeSchreiben === 0, kurz(d));
  pruefe('C3 der Patch nennt nur Bernds Karte', kartenIn({ patches: d.patches.filter((x) => x.geraet === 'B') }).join() === idVon('Gruß von Bernd'), kurz(d));
  const beiAnna = await warteBis(A.P, () => hat(A.P, 'Gruß von Bernd'), 14000);
  await A.P.waitForTimeout(4000);
  const d2 = seit(m);
  pruefe('C4 Anna sieht sie – und schreibt dafür nichts zurück', beiAnna && d2.patches.every((x) => x.geraet === 'B') && d2.ganz.length === 0, kurz(d2));
}
m = marke();
{
  await leer(A.P);
  const ok1 = await notizPlatz(A.P, 'Antwort von Anna');
  const da = await warteBis(B.P, () => hat(B.P, 'Antwort von Anna'), 14000);
  await B.P.waitForTimeout(3500);
  const d = seit(m);
  pruefe('C5 Anna antwortet → Bernd sieht es; er schreibt nichts zurück', ok1 && da && d.patches.every((x) => x.geraet === 'A1') && d.freigabeSchreiben === 0 && d.ganz.length === 0, kurz(d));
}
m = marke();
{
  await leer(A.P); await leer(B.P);
  const [g1, g2] = await Promise.all([notizPlatz(A.P, 'Anna zugleich'), (async () => { await B.P.waitForTimeout(150); return notiz(B.P, 'Bernd zugleich', 800, 780); })()]);
  const server = await warteBis(A.P, () => /Anna zugleich/.test(bxServer()) && /Bernd zugleich/.test(bxServer()), 16000);
  const beide = await warteBis(A.P, async () => (await hat(A.P, 'Bernd zugleich')) && (await hat(B.P, 'Anna zugleich')) && (await hat(A.P, 'Anna zugleich')) && (await hat(B.P, 'Bernd zugleich')), 20000);
  await A.P.waitForTimeout(5000);
  const d = seit(m);
  pruefe('C6 beide schreiben zugleich → beide Karten im Konto und bei beiden', g1 && g2 && server && beide, `${g1} ${g2} ${server} ${beide} ${kurz(d)}`);
  pruefe('C7 … ohne ganzes Board, ohne freigabe_schreiben', d.ganz.length === 0 && d.freigabeSchreiben === 0, kurz(d));
  pruefe('C8 Bernds eigene Umgebung führt das geteilte Board nicht', !JSON.parse(zeileText(uidB, 'umgebung.json')).boards.bx);
}
// Anna stellt die Rolle um, ohne dass Bernds Gerät es schon weiß → der Server lehnt ab, Bernd bekommt den Hinweis
m = marke();
{
  sb.freigaben.find((f) => f.gast_id === uidB).rolle = 'lesen';
  await leer(B.P);
  await notizPlatz(B.P, 'Zu spät');
  const hinweis = await warteBis(B.P, async () => /Nur lesen/.test(await toast(B.P)), 12000);
  pruefe('C9 „Nur lesen" gestellt → der Server nimmt Bernds Änderung nicht an, Hinweis wie bisher', hinweis && !/Zu spät/.test(bxServer()), `${await toast(B.P)}`);
  await warteBis(B.P, async () => !(await hat(B.P, 'Zu spät')), 8000);
  pruefe('C10 … bei Bernd gilt wieder der Stand der Besitzerin', !(await hat(B.P, 'Zu spät')) && (await boardVon(B.P, 'bx'))?.geteiltRolle === 'lesen');
}
await B.ctx.close();
sb.freigaben = [];

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Gerd per Link (ohne Konto) und Anna ════');
await dialogOeffnen(A.P, 'Planung 2');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
await warteBis(A.P, () => sb.live.length >= 1, 8000);
const G = await geraet('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
m = marke();
{
  await leer(A.P);
  const t0 = Date.now();
  const ok1 = await notizPlatz(A.P, 'Anna für Gerd');
  const da = await warteBis(G.P, () => hat(G.P, 'Anna für Gerd'), 12000);
  const d = seit(m);
  pruefe(`D1 Anna legt eine Karte an (kartenweise) → Gerd hat sie nach ${Date.now() - t0} ms`, ok1 && da && d.patches.some((x) => x.geraet === 'A1') && d.ganz.length === 0, kurz(d));
}
m = marke();
{
  const ok1 = await notizPlatz(G.P, 'Gerd für Anna');
  const da = await warteBis(A.P, () => hat(A.P, 'Gerd für Anna'), 14000);
  await A.P.waitForTimeout(4000);
  const d = seit(m);
  pruefe('D2 Gerd legt eine Karte an → Anna hat sie und schreibt nichts zurück', ok1 && da && d.patches.length === 0 && d.ganz.length === 0, kurz(d));
}
m = marke();
{
  await leer(A.P);
  const ok1 = await notizPlatz(A.P, 'Anna noch einmal');
  const da = await warteBis(G.P, () => hat(G.P, 'Anna noch einmal'), 12000);
  const d = seit(m);
  pruefe('D3 Anna schreibt danach weiter kartenweise – nur ihre neue Karte', ok1 && da && d.ganz.length === 0 && kartenIn(d).join() === idVon('Anna noch einmal'), kurz(d));
  const ids = (t) => JSON.parse(t).nodes.map((n) => n.id).sort().join();
  await G.P.waitForTimeout(2500);
  pruefe('D4 Anna, Gerd und das Konto halten dieselben Karten', ids(bxServer()) === (await boardVon(A.P, 'bx')).nodes.map((n) => n.id).sort().join() && ids(bxServer()) === (await boardVon(G.P, 'bx')).nodes.map((n) => n.id).sort().join());
}
await G.ctx.close();

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Server ohne board_aendern ════');
sb.ohneBoardAendern = true;
m = marke();
{
  await leer(A.P);
  const ok1 = await notizPlatz(A.P, 'Alter Server eins');
  const da = await warteBis(A.P, () => /Alter Server eins/.test(bxServer()), 12000);
  const d = seit(m);
  pruefe('E1 der Server kennt die Funktion nicht → die Karte kommt trotzdem an, als ganzes Board', ok1 && da && d.ganz.some((g) => g.name === 'board-bx.json') && d.patches.length === 0, kurz(d));
  const v404 = sb.fehlt404;
  await leer(A.P);
  const ok2 = await notizPlatz(A.P, 'Alter Server zwei');
  const da2 = await warteBis(A.P, () => /Alter Server zwei/.test(bxServer()), 12000);
  pruefe('E2 es wird nur einmal gefragt, danach gilt der bisherige Weg', ok2 && da2 && v404 === 1 && sb.fehlt404 === 1, `${v404} ${sb.fehlt404}`);
}
sb.ohneBoardAendern = false;
await A.P.reload({ waitUntil: 'networkidle' }); await A.P.waitForTimeout(2500);
m = marke();
{
  const ok1 = await notizPlatz(A.P, 'Neuer Server');
  const da = await warteBis(A.P, () => /Neuer Server/.test(bxServer()), 12000);
  const d = seit(m);
  pruefe('E3 nach dem Einspielen der Migration (und neu geladen) wieder kartenweise', ok1 && da && d.patches.length >= 1 && d.ganz.length === 0, kurz(d));
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Migration, Hilfe ════');
{
  const mig = path.join(__repo, 'supabase', 'migrations', '20261115100000_board_aendern.sql');
  const sql = existsSync(mig) ? readFileSync(mig, 'utf8') : '';
  pruefe('F1 die Migration liegt im Repository (board_aendern nur für Angemeldete, mit Freigabe-Prüfung)', /create or replace function public\.board_aendern/.test(sql) && /grant execute on function public\.board_aendern\(uuid, text, json, text\) to authenticated/.test(sql) && /f\.rolle = 'bearbeiten'/.test(sql) && !/board_aendern[^;]*to anon/.test(sql));
  const hilfe = readdirSync(path.join(DIST, 'assets')).filter((f) => /^HelpOverlay/.test(f)).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8'));
  pruefe('F2 „Was ist neu" nennt es – deutsch und englisch', hilfe.filter((t) => t.includes('(M383)')).length === 2, `${hilfe.length}`);
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
