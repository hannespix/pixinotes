/**
 * M514 — Rahmen für Rahmen präsentieren, direkt auf dem Board (Rahmen-Reise).
 *
 * Gewünscht: „Rahmen auch mit speziellen Rahmenpfeilen verbinden, und dann bekommt ein Rahmen bei Doppelklick auf den
 * Titel einen bildschirmfüllenden Rahmenfokus, und dann kann man mit typischer Weiter-Geste und Shortcuts etc. zum
 * nächsten Rahmen springen! Dieser wird dann automatisch so reingezoomt, dass er auch wieder bildschirmfüllend ist."
 *
 * Ein Board mit drei Rahmen: „Start" (breit, oben links), „Mitte" (hoch, oben rechts), „Ende" (unten links). Ohne
 * Pfeile reist man in der Lesefolge Start → Mitte → Ende; mit den Rahmenpfeilen Start → Ende → Mitte.
 *
 *   A  Rahmenpfeile über das Rahmen-Menü („Weiter zu Rahmen"): gestrichelt, mit der Nummer ihres Ziels (2, 3).
 *   B  Doppelklick auf den Titel: Der Rahmen füllt das Fenster (gemessen am Kasten), die Oberfläche ist weg,
 *      die Leiste zeigt „1 / 3 Start" und verblasst in Ruhe.
 *   C  Weiter/Zurück entlang der Pfeile: →, Leertaste, Bild↓, Wischen (Trackpad und Finger), ←, Umschalt+Leertaste,
 *      Bild↑, Pos1/Ende, Knöpfe der Leiste — jeder Rahmen eingepasst.
 *   D  Fenster anders groß: neu eingepasst. E  Tippen in einer Notiz im Rahmen blättert nicht.
 *   F  Esc stellt die Ansicht von vorher her. G  Reduzierte Bewegung: kein Flug, sofort da.
 *   H  Alt+Umschalt+P am gewählten Rahmen, Rahmen-Menü „Rahmen präsentieren", F2 benennt um, Alt+P unberührt.
 *   K  Leistung: Bildzeit während des Flugs mit 200 Karten (Median ≤ 20 ms).
 *   L  Live: Gerd folgt Annas Reise (gleicher Rahmen, bei ihm eingepasst), Ende bei ihr = Ende bei ihm.
 *   M  Texte (Hilfe DE/EN, Englisch, Meilenstein), keine Seitenfehler. Bildfolge nach PN_BILDER (falls gesetzt).
 *
 * Das nachgebaute Supabase (Konten, Freigabe per Link, Live-Kanal) stammt aus m503 (Gerüst aus m371/m387).
 */
// Läuft aus dem Repository: `node pruefungen/m514-rahmen-reise.mjs`
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
const PORT = 5514;
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

// ---------- M514: Board, Geräte, Hilfen ----------
const BILDER = process.env.PN_BILDER ?? '';
if (BILDER) mkdirSync(BILDER, { recursive: true });
const note = (id, text, x, y, w = 240) => ({ id, type: 'note', width: w, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `${id}b`, type: 'paragraph', content: text }] } });
const frame = (id, name, x, y, w, h) => ({ id, type: 'frame', position: { x, y }, width: w, height: h, data: { name } });
const RAHMEN = [
  frame('r1', 'Start', 0, 0, 800, 450),
  frame('r2', 'Mitte', 1000, 0, 400, 600),
  frame('r3', 'Ende', 0, 700, 600, 400),
];
const NOTIZEN = [note('n1', 'Begruessung', 60, 60), note('n2', 'Zahlen', 1060, 80), note('n3', 'Ausblick', 60, 760)];
const PFEILE = [
  { id: 'e13', source: 'r1', target: 'r3', type: 'labeled', data: { label: '', kind: 'arrow' } },
  { id: 'e32', source: 'r3', target: 'r2', type: 'labeled', data: { label: '', kind: 'arrow' } },
];
const standMit = (nodes, edges = []) => ({ boards: [{ id: 'bx', name: 'Vortrag', edges, drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }], activeId: 'bx', view: 'board' });
const stand = standMit([...RAHMEN, ...NOTIZEN]);
const standGast = { boards: [{ id: 'bz', name: 'Nur hier', edges: [], drawings: [], comments: [], nodes: [note('z1', 'Z Notiz', 60, 60)] }],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }], activeId: 'bz', view: 'board' };
const seitenfehler = [];
async function geraet(name, st, { anker = '', mitKonto = false, ruhig = false, gross = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport: gross, deviceScaleFactor: 1, locale: 'de-DE', reducedMotion: ruhig ? 'reduce' : 'no-preference' });
  if (mitKonto) await dienste(ctx);
  await ctx.addInitScript(({ s, konfig }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    if (konfig) localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, { s: st, konfig: mitKonto ? { url: SB_URL, key: SB_KEY } : null });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { seitenfehler.push(`${name}: ${e.message}`); console.log(`    PAGEERROR[${name}]:`, e.message); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(150); }
  return fn();
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
const inReise = (P) => P.evaluate(() => document.documentElement.hasAttribute('data-rahmen-reise'));
const zahl = (P) => P.locator('[data-taste="reise-zahl"]').textContent({ timeout: 500 }).then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => '');
const titel = (P) => P.locator('.rahmen-reise-leiste .rr-titel').textContent({ timeout: 500 }).catch(() => '');
const ansicht = (P) => P.evaluate(() => document.querySelector('.react-flow__viewport')?.style.transform ?? '');
/** Wie liegt der Rahmen im Fenster? Ganz drin, füllt es (Breite oder Höhe bis auf den Rand), waagerecht mittig */
const lage = (P, id) => P.evaluate((id) => {
  const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect();
  if (!r) return null;
  const W = innerWidth, H = innerHeight;
  return {
    drin: r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1,
    voll: r.width >= W * 0.88 || r.height >= H * 0.82,
    mittig: Math.abs((r.left + r.right) / 2 - W / 2) < 4,
    r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], W, H,
  };
}, id);
const eingepasst = async (P, id) => { const l = await lage(P, id); return !!l && l.drin && l.voll && l.mittig; };
/** Steht die Reise bei Rahmen `id` (Zahl „n / 3"), ist der Flug vorbei und der Rahmen eingepasst? */
const stehtBei = (P, id, n, ms = 8000) => warteBis(P, async () => (await zahl(P)) === `${n} / 3`
  && !(await P.evaluate(() => document.documentElement.hasAttribute('data-reise-flug'))) && (await eingepasst(P, id)), ms);
const sichtbar = (P, sel) => P.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0), sel);
/** Ein Klick ins Leere (Auswahl weg) */
const frei = async (P) => {
  await P.keyboard.press('Escape'); await P.waitForTimeout(150);
  await P.evaluate(() => document.activeElement?.blur?.());
  const pkt = await P.evaluate(() => {
    for (const [x, y] of [[1380, 760], [1380, 640], [80, 860], [720, 860], [1380, 120]]) {
      const el = document.elementFromPoint(x, y);
      if (el?.classList.contains('react-flow__pane')) return [x, y];
    }
    return [1380, 760];
  });
  await P.mouse.click(pkt[0], pkt[1]); await P.waitForTimeout(250);
};
const einpassen = async (P) => { await frei(P); await P.keyboard.press('f'); await P.waitForTimeout(800); };
const kopf = (P, id) => P.locator(`.react-flow__node[data-id="${id}"] .frame-head`);
const bild = async (P, name) => { if (BILDER) await P.screenshot({ path: path.join(BILDER, name) }); };
/** Freier Punkt auf der Fläche (kein Knoten, keine Leiste) – für Wischen */
const freiePunkt = (P) => P.evaluate(() => {
  for (const [x, y] of [[720, 120], [200, 450], [1300, 450], [720, 800], [60, 60]]) {
    const el = document.elementFromPoint(x, y);
    if (el?.classList.contains('react-flow__pane') || el?.closest('.react-flow__node-frame')) return [x, y];
  }
  return [720, 120];
});
const fingerWisch = (P, dx) => P.evaluate(async (dx) => {
  const pane = document.querySelector('.react-flow__pane');
  const x = innerWidth / 2, y = 40;
  const opt = (cx) => ({ pointerType: 'touch', isPrimary: true, pointerId: 77, clientX: cx, clientY: y, bubbles: true, cancelable: true });
  pane.dispatchEvent(new PointerEvent('pointerdown', opt(x)));
  await new Promise((r) => setTimeout(r, 80));
  pane.dispatchEvent(new PointerEvent('pointerup', opt(x + dx)));
}, dx);

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Rahmenpfeile ════');
const B = await geraet('B', stand);
await einpassen(B.P);
await bild(B.P, '1-uebersicht-ohne-pfeile.png');
async function pfeilUeberMenue(P, von, zuName) {
  await frei(P);
  await kopf(P, von).click({ button: 'right' });
  await P.waitForSelector('.sel-frame-menu', { timeout: 8000 }).catch(() => {});
  await P.locator('.sel-frame-menu button[data-taste="rahmenpfeil-zu"]', { hasText: zuName }).click();
  await P.waitForTimeout(400);
}
await pfeilUeberMenue(B.P, 'r1', 'Ende');
await pfeilUeberMenue(B.P, 'r3', 'Mitte');
const kanten = async () => (await boardVon(B.P, 'bx'))?.edges ?? [];
pruefe('A1 „Weiter zu Rahmen" legt Rahmenpfeile an (Start → Ende, Ende → Mitte)',
  await warteBis(B.P, async () => { const e = await kanten(); return e.some((k) => k.source === 'r1' && k.target === 'r3') && e.some((k) => k.source === 'r3' && k.target === 'r2'); }, 6000),
  JSON.stringify((await kanten()).map((k) => `${k.source}>${k.target}`)));
await einpassen(B.P);
const marke = (src, tgt) => B.P.evaluate(([s, t]) => {
  const st = JSON.parse(localStorage.getItem('pixinotes-board')).state;
  const e = st.boards[0].edges.find((k) => k.source === s && k.target === t);
  const l = e && document.querySelector(`.edge-label[data-edge-id="${e.id}"]`);
  return l ? { nr: l.getAttribute('data-reise-nr'), text: l.querySelector('.rahmenpfeil-nr')?.textContent ?? '', rp: l.classList.contains('rahmenpfeil') } : null;
}, [src, tgt]);
const m13 = await marke('r1', 'r3'); const m32 = await marke('r3', 'r2');
pruefe('A2 Rahmenpfeil Start → Ende trägt die Nummer 2', m13?.rp && m13.nr === '2' && m13.text === '2', JSON.stringify(m13));
pruefe('A3 Rahmenpfeil Ende → Mitte trägt die Nummer 3', m32?.rp && m32.nr === '3' && m32.text === '3', JSON.stringify(m32));
const strich = await B.P.evaluate(() => { const p = document.querySelector('path.pn-rahmenpfeil'); return p ? { dash: getComputedStyle(p).strokeDasharray, breite: parseFloat(getComputedStyle(p).strokeWidth) } : null; });
pruefe('A4 der Rahmenpfeil ist gestrichelt und kräftiger als eine normale Verbindung', !!strich && strich.dash !== 'none' && strich.breite >= 2.8, JSON.stringify(strich));
await bild(B.P, '2-uebersicht-rahmenpfeile.png');
// Ein weiterer Pfeil vom selben Rahmen ist ein Abzweig (die Reise folgt dem zuerst gezogenen)
await pfeilUeberMenue(B.P, 'r1', 'Mitte');
const m12 = await warteBis(B.P, async () => (await marke('r1', 'r2'))?.nr === '0', 4000);
pruefe('A5 ein zweiter Pfeil vom selben Rahmen ist ein Abzweig (ohne Nummer), die Reise bleibt Start → Ende → Mitte', m12 && (await marke('r1', 'r3'))?.nr === '2', JSON.stringify(await marke('r1', 'r2')));
await B.P.keyboard.press('Control+z'); await B.P.waitForTimeout(400);
pruefe('A6 Rückgängig nimmt den Abzweig wieder weg', !(await kanten()).some((k) => k.source === 'r1' && k.target === 'r2'));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Doppelklick auf den Titel ════');
await einpassen(B.P);
const vorReise = await ansicht(B.P);
await kopf(B.P, 'r1').dblclick();
pruefe('B1 Doppelklick auf den Titel startet die Rahmen-Reise beim ersten Rahmen (1 / 3)', await stehtBei(B.P, 'r1', 1), `${await zahl(B.P)} ${JSON.stringify(await lage(B.P, 'r1'))}`);
const l1 = await lage(B.P, 'r1');
pruefe('B2 der Rahmen füllt das Fenster (Kasten ganz drin, Breite oder Höhe bis auf den Rand, mittig)', l1.drin && l1.voll && l1.mittig, JSON.stringify(l1));
pruefe('B3 die Oberfläche ist weg (Kopfleiste, Dock, Navigation) – über „Oberfläche ausblenden" (M510)', !(await sichtbar(B.P, '.topbar')) && !(await sichtbar(B.P, '.dock')) && !(await sichtbar(B.P, '.tabs'))
  && (await B.P.evaluate(() => document.documentElement.hasAttribute('data-nur-board'))) && !(await sichtbar(B.P, '.nur-board-knopf')));
pruefe('B4 die Leiste nennt den Rahmen', (await titel(B.P)) === 'Start', await titel(B.P));
pruefe('B5 kein Umbenennen-Feld (der Doppelklick benennt nicht mehr um)', (await B.P.locator('.frame-name-input').count()) === 0);
await bild(B.P, '3-rahmen-1-start.png');
// verblasst in Ruhe, kommt mit dem Zeiger wieder
const blass = await warteBis(B.P, async () => B.P.evaluate(() => Number(getComputedStyle(document.querySelector('.rahmen-reise-leiste')).opacity) < 0.3), 5000);
await B.P.mouse.move(700, 500); await B.P.mouse.move(720, 520);
const wach = await warteBis(B.P, async () => B.P.evaluate(() => Number(getComputedStyle(document.querySelector('.rahmen-reise-leiste')).opacity) > 0.9), 3000);
pruefe('B6 die Leiste verblasst in Ruhe und kommt mit dem Zeiger wieder', blass && wach);

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Weiter und zurück ════');
await B.P.keyboard.press('ArrowRight');
pruefe('C1 → fährt entlang des Pfeils zu „Ende" (2 / 3) und passt ihn ein', await stehtBei(B.P, 'r3', 2), `${await zahl(B.P)} ${JSON.stringify(await lage(B.P, 'r3'))}`);
await bild(B.P, '4-rahmen-2-ende.png');
await B.P.keyboard.press(' ');
pruefe('C2 Leertaste → „Mitte" (3 / 3), hoch eingepasst', await stehtBei(B.P, 'r2', 3), `${await zahl(B.P)} ${JSON.stringify(await lage(B.P, 'r2'))}`);
await bild(B.P, '5-rahmen-3-mitte.png');
await B.P.keyboard.press('ArrowLeft');
pruefe('C3 ← zurück zu „Ende"', await stehtBei(B.P, 'r3', 2), await zahl(B.P));
await B.P.keyboard.press('PageDown');
pruefe('C4 Bild↓ (Klicker) → „Mitte"', await stehtBei(B.P, 'r2', 3), await zahl(B.P));
await B.P.keyboard.press('PageUp');
pruefe('C5 Bild↑ → „Ende"', await stehtBei(B.P, 'r3', 2), await zahl(B.P));
await B.P.keyboard.press('Shift+Space');
pruefe('C6 Umschalt+Leertaste → „Start"', await stehtBei(B.P, 'r1', 1), await zahl(B.P));
await B.P.keyboard.press('End');
pruefe('C7 Ende → letzter Rahmen', await stehtBei(B.P, 'r2', 3), await zahl(B.P));
await B.P.keyboard.press('Home');
pruefe('C8 Pos1 → erster Rahmen', await stehtBei(B.P, 'r1', 1), await zahl(B.P));
const [wx, wy] = await freiePunkt(B.P);
await B.P.mouse.move(wx, wy);
await B.P.mouse.wheel(140, 0);
pruefe('C9 Wischen nach links auf dem Trackpad (waagerechtes Rad) → nächster Rahmen', await stehtBei(B.P, 'r3', 2), await zahl(B.P));
await B.P.waitForTimeout(800);
await B.P.mouse.wheel(-140, 0);
pruefe('C10 Wischen nach rechts → voriger Rahmen', await stehtBei(B.P, 'r1', 1), await zahl(B.P));
await fingerWisch(B.P, -160);
pruefe('C11 Finger wischt nach links → nächster Rahmen', await stehtBei(B.P, 'r3', 2), await zahl(B.P));
await fingerWisch(B.P, 160);
pruefe('C12 Finger wischt nach rechts → voriger Rahmen', await stehtBei(B.P, 'r1', 1), await zahl(B.P));
await B.P.locator('[data-taste="reise-weiter"]').click();
pruefe('C13 Knopf › in der Leiste → nächster Rahmen', await stehtBei(B.P, 'r3', 2), await zahl(B.P));
await B.P.locator('[data-taste="reise-zurueck"]').click();
pruefe('C14 Knopf ‹ → voriger Rahmen', await stehtBei(B.P, 'r1', 1), await zahl(B.P));
pruefe('C15 am Anfang ist ‹ gesperrt', await B.P.locator('[data-taste="reise-zurueck"]').isDisabled());
const knotenVorher = JSON.stringify((await boardVon(B.P, 'bx')).nodes.map((n) => [n.id, n.position.x, n.position.y]));
pruefe('C16 die Pfeiltasten verschieben dabei keine Karte', JSON.stringify((await boardVon(B.P, 'bx')).nodes.map((n) => [n.id, n.position.x, n.position.y])) === knotenVorher);

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Fenstergröße ════');
await B.P.setViewportSize({ width: 820, height: 1000 });
pruefe('D1 schmales hohes Fenster: der Rahmen wird neu eingepasst', await stehtBei(B.P, 'r1', 1), JSON.stringify(await lage(B.P, 'r1')));
await B.P.setViewportSize({ width: 1440, height: 900 });
pruefe('D2 zurück auf breit: wieder eingepasst', await stehtBei(B.P, 'r1', 1), JSON.stringify(await lage(B.P, 'r1')));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Tippen in einer Karte im Rahmen ════');
// Ein Klick in den Text weckt den Editor (M338), der zweite setzt den Cursor
await B.P.locator('.react-flow__node[data-id="n1"] .note-editor').first().click();
const ed = B.P.locator('.react-flow__node[data-id="n1"] [contenteditable="true"]').first();
await ed.waitFor({ timeout: 10000 });
await ed.click();
await B.P.keyboard.press('End');
await B.P.keyboard.type(' und mehr');
await B.P.keyboard.press('ArrowRight'); await B.P.keyboard.press('ArrowLeft');
await B.P.keyboard.press('PageDown');
await B.P.waitForTimeout(900);
const notizText = await B.P.locator('.react-flow__node[data-id="n1"]').innerText();
pruefe('E1 Tippen (Leertaste, Pfeile, Bild↓) in der Notiz blättert nicht – die Reise bleibt bei „Start"', (await zahl(B.P)) === '1 / 3' && (await eingepasst(B.P, 'r1')), await zahl(B.P));
pruefe('E2 der Text kam in der Notiz an (die Karte ist bedienbar)', /Begruessung und mehr/.test(notizText), notizText);
// Esc verlässt erst den Text, danach gehören die Tasten wieder der Reise
await B.P.keyboard.press('Escape'); await B.P.waitForTimeout(250);
await B.P.evaluate(() => document.activeElement?.blur?.());
await B.P.keyboard.press('ArrowRight');
pruefe('E3 außerhalb des Texts blättert → wieder', await stehtBei(B.P, 'r3', 2), await zahl(B.P));

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Esc ════');
await B.P.keyboard.press('Escape');
const raus = await warteBis(B.P, async () => !(await inReise(B.P)), 4000);
await B.P.waitForTimeout(700);
const nachReise = await ansicht(B.P);
const zahlen = (t) => (t.match(/-?[\d.]+/g) ?? []).map(Number);
const gleich = zahlen(vorReise).length === 3 && zahlen(vorReise).every((v, i) => Math.abs(v - zahlen(nachReise)[i]) < 1.5);
pruefe('F1 Esc beendet die Reise', raus && (await B.P.locator('.rahmen-reise-leiste').count()) === 0);
pruefe('F2 … und stellt die Ansicht von vorher wieder her', gleich, `${vorReise} → ${nachReise}`);
pruefe('F3 die Oberfläche ist zurück', await sichtbar(B.P, '.dock') && !(await B.P.evaluate(() => document.documentElement.hasAttribute('data-nur-board'))));

{
  await einpassen(B.P);
  await B.P.keyboard.press('Alt+b');
  await warteBis(B.P, () => B.P.evaluate(() => document.documentElement.hasAttribute('data-nur-board')), 3000);
  await kopf(B.P, 'r3').dblclick();
  await stehtBei(B.P, 'r3', 2);
  await B.P.keyboard.press('Escape');
  const reiseZu = await warteBis(B.P, async () => !(await inReise(B.P)), 4000);
  pruefe('F4 war die Oberfläche schon ausgeblendet (Alt+B), beendet Esc die Reise – und die Oberfläche bleibt aus', reiseZu && (await B.P.evaluate(() => document.documentElement.hasAttribute('data-nur-board'))));
  await B.P.keyboard.press('Escape');
  pruefe('F5 das nächste Esc holt die Oberfläche zurück', await warteBis(B.P, async () => !(await B.P.evaluate(() => document.documentElement.hasAttribute('data-nur-board'))), 3000));
  await B.P.waitForTimeout(500);
}

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Kürzel, Menü, Umbenennen ════');
await einpassen(B.P);
await kopf(B.P, 'r2').click(); await B.P.waitForTimeout(300);
await B.P.keyboard.press('Alt+Shift+P');
pruefe('H1 Alt+Umschalt+P am gewählten Rahmen „Mitte" → Reise ab dort (3 / 3)', await stehtBei(B.P, 'r2', 3), await zahl(B.P));
pruefe('H2 die Präsentation (Alt+P) hat sich nicht geöffnet', (await B.P.locator('.presenter').count()) === 0);
await B.P.keyboard.press('Alt+Shift+P');
pruefe('H3 Alt+Umschalt+P noch einmal beendet die Reise', await warteBis(B.P, async () => !(await inReise(B.P)), 4000));
await B.P.waitForTimeout(600);
await frei(B.P);
await kopf(B.P, 'r3').click({ button: 'right' });
await B.P.waitForSelector('.sel-frame-menu', { timeout: 8000 }).catch(() => {});
await B.P.locator('.sel-frame-menu [data-taste="rahmen-praesentieren"]').click();
pruefe('H4 Rahmen-Menü „Rahmen präsentieren" → Reise ab diesem Rahmen (2 / 3)', await stehtBei(B.P, 'r3', 2), await zahl(B.P));
await B.P.keyboard.press('Escape');
await warteBis(B.P, async () => !(await inReise(B.P)), 4000);
await B.P.waitForTimeout(600);
await frei(B.P);
await kopf(B.P, 'r1').click(); await B.P.waitForTimeout(300);
await B.P.keyboard.press('F2');
const feld = await warteBis(B.P, async () => (await B.P.locator('.frame-name-input').count()) === 1, 3000);
if (feld) { await B.P.locator('.frame-name-input').fill('Anfang'); await B.P.keyboard.press('Enter'); }
pruefe('H5 F2 am gewählten Rahmen benennt ihn am Titel um', feld && (await warteBis(B.P, async () => (await boardVon(B.P, 'bx')).nodes.find((n) => n.id === 'r1')?.data.name === 'Anfang', 4000)));
await B.ctx.close();

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Reduzierte Bewegung ════');
{
  const R = await geraet('R', standMit([...RAHMEN, ...NOTIZEN], PFEILE), { ruhig: true });
  await einpassen(R.P);
  await R.P.evaluate(() => { window.__flug = false; new MutationObserver(() => { if (document.documentElement.hasAttribute('data-reise-flug')) window.__flug = true; }).observe(document.documentElement, { attributes: true }); });
  await kopf(R.P, 'r1').dblclick();
  const schnell = await warteBis(R.P, () => eingepasst(R.P, 'r1'), 1500);
  pruefe('G1 mit reduzierter Bewegung steht der Rahmen sofort (ohne Flug)', schnell && !(await R.P.evaluate(() => window.__flug)), JSON.stringify(await lage(R.P, 'r1')));
  await R.P.keyboard.press('ArrowRight');
  pruefe('G2 auch der nächste Rahmen ist sofort da', await warteBis(R.P, () => eingepasst(R.P, 'r3'), 1500) && !(await R.P.evaluate(() => window.__flug)));
  pruefe('G3 die Leiste blendet nicht weich über', await R.P.evaluate(() => getComputedStyle(document.querySelector('.rahmen-reise-leiste')).transitionDuration.split(',').every((d) => parseFloat(d) === 0)));
  await R.ctx.close();
}

// ══ K ═══════════════════════════════════════════════════════════════
console.log('\n════ K: Leistung beim Flug (200 Karten) ════');
{
  const viele = [];
  for (let i = 0; i < 200; i += 1) viele.push({ id: `k${i}`, type: 'note', width: 200, height: 120, autoFit: false, position: { x: (i % 20) * 230 - 200, y: Math.floor(i / 20) * 150 + 1300 }, data: { color: i % 3 ? 'yellow' : 'sky', blocks: [{ id: `k${i}t`, type: 'paragraph', content: `k${i}` }] } });
  const K = await geraet('K', standMit([...RAHMEN, ...NOTIZEN, ...viele], PFEILE));
  await einpassen(K.P);
  await kopf(K.P, 'r1').dblclick();
  await stehtBei(K.P, 'r1', 1);
  const messe = async (taste, id, n) => {
    // Gemessen wird von dem Bild an, in dem der Flug beginnt, bis zu dem, in dem er endet
    await K.P.evaluate(() => {
      window.__takt = new Promise((res) => {
        const z = []; let l = 0; let warten = 0;
        const f = (t) => {
          const fliegt = document.documentElement.hasAttribute('data-reise-flug');
          if (!fliegt && !l) { if (++warten < 120) requestAnimationFrame(f); else res(z); return; }
          if (l) z.push(t - l);
          l = t;
          if (fliegt && z.length < 200) requestAnimationFrame(f); else res(z);
        };
        requestAnimationFrame(f);
      });
    });
    await K.P.keyboard.press(taste);
    const takt = K.P.evaluate(() => window.__takt);
    const z = (await takt).sort((a, b) => a - b);
    await stehtBei(K.P, id, n);
    return z;
  };
  const alle = [...await messe('ArrowRight', 'r3', 2), ...await messe('ArrowRight', 'r2', 3), ...await messe('Home', 'r1', 1)].sort((a, b) => a - b);
  const med = alle[Math.floor(alle.length / 2)]; const p90 = alle[Math.floor(alle.length * 0.9)];
  console.log(`  (Flug: ${alle.length} Bilder, Median ${med?.toFixed(1)} ms, 90 % ${p90?.toFixed(1)} ms)`);
  pruefe('K1 Bildzeit während des Flugs mit 200 Karten: Median ≤ 20 ms', alle.length >= 10 && med <= 20, JSON.stringify({ n: alle.length, med, p90 }));
  await K.ctx.close();
}

// ══ L ═══════════════════════════════════════════════════════════════
console.log('\n════ L: Live – Gäste folgen der Reise ════');
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function schliessen(P) { await P.keyboard.press('Escape'); await P.waitForTimeout(500); }
async function anmelden(P, email, pass) {
  await kontoPanel(P);
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator('[data-taste="konto-neu"]').click();
  await warteBis(P, async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0, 10000);
  await P.waitForTimeout(400);
  await schliessen(P);
}
async function dialogOeffnen(P, name) {
  const z = P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  await z.hover(); await P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600);
  await P.waitForSelector('[data-taste="einladung-optionen"], [data-taste="freigabe-ohne-konto"], [data-taste="freigabe-verlassen"]', { timeout: 2500 }).catch(() => {});
  await P.evaluate(() => document.querySelectorAll('.freigabe-dialog details').forEach((d) => { d.open = true; }));
}
const zband = (P) => P.locator('[data-taste="zeig-band"]').textContent().catch(() => '');
{
  const A = await geraet('A', standMit([...RAHMEN, ...NOTIZEN], PFEILE), { mitKonto: true });
  await anmelden(A.P, 'anna@example.de', 'geheim123');
  const uidA = nutzerId('anna@example.de');
  await warteBis(A.P, () => !!zeile(uidA, 'board-bx.json'), 8000);
  await dialogOeffnen(A.P, 'Vortrag');
  await A.P.locator('[data-taste="einladung-anlegen"]').click();
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
  const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
  await schliessen(A.P);
  pruefe('L0 der Einladungslink steht', token.length > 8, token);
  // Gerd sieht auf einem kleineren Schirm zu – „bei ihm eingepasst"
  const G = await geraet('G', standGast, { anker: `#e=${token}`, mitKonto: true, gross: { width: 1000, height: 760 } });
  await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
  await warteBis(G.P, async () => (await G.P.locator('[data-taste="gast-name"]').count()) === 1, 8000);
  await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
  await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="live-auf"]').count()) > 0, 10000);
  await A.P.waitForTimeout(1200);
  await einpassen(A.P);
  await kopf(A.P, 'r1').dblclick();
  pruefe('L1 Anna startet die Reise bei „Start"', await stehtBei(A.P, 'r1', 1), await zahl(A.P));
  pruefe('L2 Gerd folgt: bei ihm „Start" (1 / 3), auf seinem Schirm eingepasst', await stehtBei(G.P, 'r1', 1, 15000), `${await zahl(G.P)} ${JSON.stringify(await lage(G.P, 'r1'))} | ${await zband(G.P)}`);
  pruefe('L3 Gerd sieht „du folgst"', /du folgst/.test(await zband(G.P)), await zband(G.P));
  await A.P.keyboard.press('ArrowRight');
  pruefe('L4 Anna blättert → Gerd ist bei „Ende" (2 / 3)', await stehtBei(G.P, 'r3', 2, 15000), `${await zahl(G.P)} ${JSON.stringify(await lage(G.P, 'r3'))}`);
  await A.P.keyboard.press(' ');
  pruefe('L5 … und bei „Mitte" (3 / 3)', await stehtBei(G.P, 'r2', 3, 15000), await zahl(G.P));
  await A.P.keyboard.press('Escape');
  pruefe('L6 Anna beendet → bei Gerd endet die Reise', await warteBis(G.P, async () => !(await inReise(G.P)), 12000));
  pruefe('L7 die von selbst begonnene Vorführung endet mit der Reise', await warteBis(A.P, async () => (await A.P.locator('[data-taste="zeig-band"]').count()) === 0, 10000), await zband(A.P));
  await A.ctx.close(); await G.ctx.close();
}

// ══ M ═══════════════════════════════════════════════════════════════
console.log('\n════ M: Texte ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  pruefe('M1 Hilfe „Was ist neu" nennt M514 und die Rahmen-Reise', /M514/.test(hilfe) && /Rahmen-Reise|Rahmen für Rahmen/.test(hilfe));
  pruefe('M2 englische Hilfe nennt M514', /M514/.test(hilfeEn));
  pruefe('M3 englische Oberfläche: Leiste und Menü übersetzt', ['Rahmen präsentieren', 'Nächster Rahmen', 'Vorheriger Rahmen', 'Rahmen-Reise beenden', 'Weiter zu Rahmen'].every((k) => typeof en[k] === 'string' && en[k].length > 0));
  pruefe('M4 Meilenstein-Datei', existsSync(path.join(__repo, 'docs/meilensteine/M514-rahmen-reise.md')));
  pruefe('M5 keine Seitenfehler', seitenfehler.length === 0, seitenfehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM514: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
