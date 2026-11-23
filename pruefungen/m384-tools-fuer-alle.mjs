/**
 * M384 — Lücken beim Teilen: Gäste mit Konto bekommen Tool-Quelltexte und Dateien; Eingaben in Tools reisen mit.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m371). Der nachgebaute Dateispeicher gibt Angemeldeten —
 * wie der echte — nur den eigenen Ordner heraus; an fremde Dateien kommt man nur über eine signierte Adresse.
 *
 *   A  Server ohne die neue Spalte: Freigeben geht wie bisher, es wird einmal gefragt und dann nicht mehr.
 *   B  Anna gibt ein Board mit eigenem Tool und einer Datei für Bernds Konto frei → die Adressen stehen an der
 *      Freigabe; bei Bernd ist das Tool startbereit und die Datei da — über die signierte Adresse.
 *      Ein zweites Tool, das Anna später anlegt, kommt bei Bernd ohne Neuladen an.
 *   C  Anna führt vor und gibt im Tool etwas ein: Text, Zahlen und Knopf, Häkchen, Auswahl, Formular (Knopf und
 *      Enter), Enter-Taste, langer Text, frei beschreibbarer Bereich, Klick auf eine Fläche — bei Bernd geschieht
 *      dasselbe. Nicht gespiegelt: Passwortfeld, Verweis. Bernds eigene Eingaben gehen nicht zu Anna.
 *      M414: Wer folgt, sieht dabei Annas Abbild (lib/spiegel.ts) statt seines eigenen Tools — dieselben Werte;
 *      selbst eingeben kann Bernd, nachdem er sich gelöst hat (dann geht nichts zu Anna).
 *   D  Bernd lädt neu → sein Tool startet und zeigt die Feldwerte, die Anna schon eingegeben hat.
 *      Ohne Vorführung wird nichts gespiegelt.
 *   E  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m384-tools-fuer-alle.mjs`
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
const PORT = 4696;
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
      if (sb.ohneFreigabeDateien && (/dateien/.test(url.searchParams.get('select') ?? '') || (m === 'PATCH' && 'dateien' in body()))) { sb.spalteFehlt = (sb.spalteFehlt ?? 0) + 1; return json(route, 400, { code: '42703', message: 'column board_freigaben.dateien does not exist' }); }
      if (m === 'GET') return json(route, 200, filt(sichtbar));
      if (m === 'POST') {
        const b = body();
        let f = sb.freigaben.find((x) => x.besitzer === uid && x.board_id === b.board_id && x.gast_email === b.gast_email);
        if (!f) { f = { id: `fg-${++sb.n}`, besitzer: uid, board_id: b.board_id, gast_email: b.gast_email, gast_id: null, rolle: b.rolle ?? 'bearbeiten', created_at: new Date().toISOString() }; sb.freigaben.push(f); melden(uid, '', 'INSERT', 'board_freigaben', f); }
        return json(route, 201, [f]);
      }
      if (m === 'PATCH') {
        for (const f of filt(sb.freigaben.filter((x) => x.besitzer === uid))) { Object.assign(f, body()); melden(uid, '', 'UPDATE', 'board_freigaben', f); }
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
      if (m === 'GET') { const o = sb.objekte.get(t[1]); if (o && t[1].split('/')[0] !== uidAus(req)) { sb.fremdOrdner = (sb.fremdOrdner ?? 0) + 1; return antwort(route, 400, { error: 'not found' }); } return o ? route.fulfill({ status: 200, contentType: o.mime, headers: cors, body: o.body }) : antwort(route, 400, { error: 'not found' }); }
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
/** M414: Annas Abbild bei dem, der folgt (frisch gesucht — Klasse „spiegel", ohne Skripte) */
async function abbild(P, klasse = 'happ-frame') {
  for (const f of P.frames()) {
    if (f === P.mainFrame()) continue;
    try {
      const el = await f.frameElement();
      if (!(await el.evaluate((e, k) => e.classList.contains(k) && e.classList.contains('spiegel'), klasse))) continue;
      if (await f.evaluate(() => !!document.getElementById('titel'))) return f;
    } catch { /* Rahmen ist gerade weg */ }
  }
  return null;
}
const anteil = (f, sel = null) => f.evaluate((s) => { const e = s ? document.querySelector(s) : document.scrollingElement; return e.scrollTop / Math.max(1, e.scrollHeight - e.clientHeight); }, sel);
const folie = (P) => P.locator('.presenter .presenter-count').textContent().catch(() => '');
const imVortrag = (P) => P.locator('.presenter').count();
const vortragStart = async (P) => { await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250); await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click(); await P.waitForTimeout(700); };

const TOOL384 = `<!doctype html><html><head><meta charset="utf-8"><title>Werkzeug</title><style>body{font-family:sans-serif;margin:8px}input,select,textarea{font:inherit}#flaeche{width:200px;height:60px;background:#dde}#frei{border:1px solid #999;min-height:24px;width:200px}</style></head><body>
<h1 id="titel">Mein Werkzeug</h1>
<input id="name" placeholder="Name">
<p><input type="number" value="0" style="width:60px"> + <input type="number" value="0" style="width:60px"> <button id="rechnen" type="button">Rechnen</button> = <output id="erg">?</output></p>
<p><label id="hakenLabel"><input type="checkbox" id="haken"> fertig</label> <span id="hakenText">offen</span>
<select id="wahl"><option>rot</option><option>gruen</option><option>blau</option></select> <span id="wahlText">rot</span></p>
<form id="liste"><input id="neu" placeholder="Punkt"><button id="dazu">Dazu</button></form><ul id="punkte"></ul>
<input id="schnell" placeholder="Enter"><ul id="schnellListe"></ul>
<textarea id="lang" rows="2" cols="24"></textarea>
<div id="frei" contenteditable="true"></div>
<input type="password" id="geheim" placeholder="Passwort">
<a id="verweis" href="https://extern.test/seite" target="_blank">Verweis</a> <span id="klicks">0</span>
<div id="flaeche"></div><span id="stelle">-</span>
<script>
var $=function(i){return document.getElementById(i);};
$('rechnen').onclick=function(){var z=document.querySelectorAll('input[type=number]');$('erg').textContent=String(+z[0].value+ +z[1].value);};
$('haken').onchange=function(){$('hakenText').textContent=$('haken').checked?'fertig':'offen';};
$('wahl').onchange=function(){$('wahlText').textContent=$('wahl').value;};
$('liste').onsubmit=function(e){e.preventDefault();var li=document.createElement('li');li.textContent=$('neu').value;$('punkte').appendChild(li);$('neu').value='';};
$('schnell').onkeydown=function(e){if(e.key==='Enter'){var li=document.createElement('li');li.textContent=$('schnell').value;$('schnellListe').appendChild(li);$('schnell').value='';}};
$('verweis').onclick=function(){$('klicks').textContent=String(+$('klicks').textContent+1);};
$('flaeche').onclick=function(e){var r=$('flaeche').getBoundingClientRect();$('stelle').textContent=Math.round((e.clientX-r.left)/r.width*10)+'/'+Math.round((e.clientY-r.top)/r.height*10);};
</script></body></html>`;
const stand384 = {
  boards: [board('bx', 'Planung', [
    note('x1', 'Planung Notiz', 40, 60),
    { id: 'h1', type: 'htmlapp', width: 440, height: 620, position: { x: 330, y: 40 }, data: { name: 'Werkzeug', size: 0 } },
  ])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
/** Liegt unter diesem Schlüssel etwas in der Ablage des Geräts? */
const inAblage = (P, key) => P.evaluate((k) => new Promise((ok) => { const q = indexedDB.open('pixinotes-sync'); q.onsuccess = () => { try { const db = q.result; const os = db.objectStoreNames[0]; const g = db.transaction(os).objectStore(os).get(k); g.onsuccess = () => ok(!!g.result); g.onerror = () => ok(false); } catch { ok(false); } }; q.onerror = () => ok(false); }), key);
const dateienAn = () => sb.freigaben.map((f) => (f.dateien ?? []).map((d) => d.id).sort().join(',')).join(' | ');
const im = (f, sel, was = 'textContent') => f.evaluate(({ s, w }) => { const e = document.querySelector(s); return e ? (w === 'checked' ? e.checked : e[w]) : null; }, { s: sel, w: was });
const liste = (f, sel) => f.evaluate((s) => [...document.querySelectorAll(`${s} li`)].map((l) => l.textContent).join('|'), sel);
/** Wie ein Mensch: ins Feld klicken und tippen (nur echte Eingaben werden gespiegelt) */
const tippen = async (P, f, sel, text) => { await f.locator(sel).click(); await P.keyboard.type(text, { delay: 25 }); await P.waitForTimeout(120); };

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Server ohne die Spalte für Anhänge an der Freigabe ════');
sb.ohneFreigabeDateien = true;
const A = await geraet2('A', stand384);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await A.P.locator('.react-flow__node[data-id="h1"] input[type="file"]').setInputFiles({ name: 'werkzeug.html', mimeType: 'text/html', buffer: Buffer.from(TOOL384) });
await warteBis(A.P, () => sb.objekte.has(`${uidA}/datei-h1`), 20000);
await A.P.locator('.dock input[type="file"]:not([accept])').setInputFiles({ name: 'daten.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(1_900_000, 7) });   // zu groß, um im Board selbst mitzureisen
let dateiId = '';
await warteBis(A.P, async () => { dateiId = (await boardVon(A.P, 'bx')).nodes.find((n) => n.type === 'file')?.id ?? ''; return !!dateiId && sb.objekte.has(`${uidA}/datei-${dateiId}`); }, 20000);
pruefe('A0 Tool-Quelltext und Datei liegen in Annas Konto', sb.objekte.has(`${uidA}/datei-h1`) && !!dateiId && sb.objekte.has(`${uidA}/datei-${dateiId}`), [...sb.objekte.keys()].join());
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="freigabe-email"]').fill('bernd@example.de');
await A.P.locator('[data-taste="freigabe-einladen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="freigabe-liste"] li').count()) === 1, 6000);
await schliessen(A.P);
await A.P.waitForTimeout(3000);
pruefe('A1 die Freigabe steht – wie bisher, ohne Anhänge', sb.freigaben.length === 1 && !sb.freigaben[0].dateien, JSON.stringify(sb.freigaben));
{
  const vor = sb.spalteFehlt ?? 0;
  await notizPlatz(A.P, 'Noch eine Karte'); await A.P.waitForTimeout(5000);
  pruefe('A2 nach dem ersten Fehlschlag wird nicht weiter gefragt', vor === 1 && (sb.spalteFehlt ?? 0) === 1 && A.P.fehler.length === 0, `${vor} ${sb.spalteFehlt} ${A.P.fehler.join()}`);
}

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Gast mit Konto bekommt Tool und Datei ════');
sb.ohneFreigabeDateien = false;
await A.P.reload({ waitUntil: 'networkidle' }); await A.P.waitForTimeout(2500);
await warteBis(A.P, () => (sb.freigaben[0]?.dateien ?? []).length === 2, 20000);
pruefe('B1 nach dem Einspielen der Migration (neu geladen) stehen beide Adressen an der Freigabe', dateienAn() === ['h1', dateiId].sort().join(','), dateienAn());
pruefe('B2 … als signierte Adressen, mit Name, Typ und Größe', (sb.freigaben[0].dateien ?? []).every((d) => /^https:\/\/.+\/object\/sign\/pixinotes\/.+token=/.test(d.url) && d.name && d.groesse > 0) && sb.freigaben[0].dateien.find((d) => d.id === 'h1')?.mime === 'text/html', JSON.stringify(sb.freigaben[0].dateien));
const B = await geraet2('B', standB);
await anmelden(B.P, 'bernd@example.de', 'geheim456', true);
const uidB = nutzerId('bernd@example.de');
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 15000);
await boardWechseln(B.P, 'Planung', 'anna@example.de');
const startbereit = (P, id) => P.locator(`.react-flow__node[data-id="${id}"] .happ-go:not([disabled])`).count();
await warteBis(B.P, async () => (await startbereit(B.P, 'h1')) === 1, 20000);
pruefe('B3 bei Bernd ist das Tool startbereit – der Quelltext kam mit', (await startbereit(B.P, 'h1')) === 1 && (await inAblage(B.P, 'happ:h1')));
pruefe('B4 … über die signierte Adresse (der Dateispeicher gibt Angemeldeten nur den eigenen Ordner)', speicherAbrufe.includes(`${uidA}/datei-h1`), `${speicherAbrufe.join()} fremdOrdner=${sb.fremdOrdner ?? 0}`);
await warteBis(B.P, () => inAblage(B.P, `file:${dateiId}`), 15000);
pruefe('B5 auch die Datei ist bei Bernd angekommen', (await inAblage(B.P, `file:${dateiId}`)) && speicherAbrufe.includes(`${uidA}/datei-${dateiId}`), speicherAbrufe.join());
// ein zweites Tool, später angelegt
await A.P.locator('.dock input[type="file"][accept*="html"]').setInputFiles({ name: 'zweites.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><html><body><h1 id="zwei">Zweites Tool</h1></body></html>') });
let zweitesId = '';
await warteBis(A.P, async () => { zweitesId = (await boardVon(A.P, 'bx')).nodes.find((n) => n.type === 'htmlapp' && n.id !== 'h1')?.id ?? ''; return !!zweitesId && sb.objekte.has(`${uidA}/datei-${zweitesId}`); }, 20000);
await warteBis(B.P, async () => !!zweitesId && (await inAblage(B.P, `happ:${zweitesId}`)), 40000);
pruefe('B6 ein später angelegtes Tool kommt bei Bernd an – Karte und Quelltext, ohne Neuladen', !!zweitesId && (await inAblage(B.P, `happ:${zweitesId}`)) && (await startbereit(B.P, zweitesId)) === 1, `${zweitesId} ${dateienAn()}`);

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Anna führt vor – Eingaben im Tool kommen bei Bernd an ════');
// Beide haben das Tool schon offen, Anna hat schon etwas eingetragen — dann erst beginnt sie vorzuführen
const karteA0 = A.P.locator('.react-flow__node[data-id="h1"]');
const karteB0 = B.P.locator('.react-flow__node[data-id="h1"]');
await karteA0.locator('.happ-startbtn, .happ-go').first().click();
await karteB0.locator('.happ-startbtn, .happ-go').first().click();
let fa0 = null; let fb0 = null;
await warteBis(A.P, async () => { fa0 = await rahmen(A.P, 'happ-frame', 'titel'); return !!fa0; }, 8000);
await warteBis(B.P, async () => { fb0 = await rahmen(B.P, 'happ-frame', 'titel'); return !!fb0; }, 8000);
await tippen(A.P, fa0, '#lang', 'vorher notiert'); await A.P.waitForTimeout(1200);
pruefe('C-1 ohne Vorführung: Annas Eingabe bleibt bei ihr', (await im(fb0, '#lang', 'value')) === '');
await gruppeAuf(A.P);
await A.P.locator('[data-taste="vorfuehren"]').click(); await A.P.waitForTimeout(600);
await warteBis(B.P, async () => /du folgst/.test(await zband(B.P)), 8000);
pruefe('C-0 Anna beginnt vorzuführen → bei Bernd steht Annas Tool (ihr Abbild) mit dem, was sie vorher eingetragen hat', await warteBis(B.P, async () => { const f = await abbild(B.P); return !!f && (await im(f, '#lang', 'value')) === 'vorher notiert'; }, 8000), String(await abbild(B.P).then((f) => f && im(f, '#lang', 'value'))));
await fa0.locator('#lang').click(); await A.P.keyboard.press('Control+A'); await A.P.keyboard.press('Delete'); await A.P.waitForTimeout(400);
const karteA = A.P.locator('.react-flow__node[data-id="h1"]');
const karteB = B.P.locator('.react-flow__node[data-id="h1"]');
let fa = null; let fb = null;
await warteBis(A.P, async () => { fa = await rahmen(A.P, 'happ-frame', 'titel'); return !!fa; }, 8000);
await warteBis(B.P, async () => { fb = await abbild(B.P); return !!fb; }, 10000);
pruefe('C0 das Tool läuft bei Anna, Bernd sieht es', !!fa && !!fb && /du folgst/.test(await zband(B.P)), await zband(B.P));
await B.P.waitForTimeout(800);
await tippen(A.P, fa, '#name', 'Hallo Team');
pruefe('C1 Text in ein Feld → steht bei Bernd', await warteBis(B.P, async () => (await im(fb, '#name', 'value')) === 'Hallo Team', 6000), String(await im(fb, '#name', 'value')));
{
  const z = fa.locator('input[type=number]');
  await z.nth(0).click(); await A.P.keyboard.press('Control+A'); await A.P.keyboard.type('2');
  await z.nth(1).click(); await A.P.keyboard.press('Control+A'); await A.P.keyboard.type('3');
  await fa.locator('#rechnen').click();
  pruefe('C2 zwei Zahlen (Felder ohne Kennung) und der Knopf „Rechnen" → Bernd sieht dasselbe Ergebnis', (await im(fa, '#erg')) === '5' && (await warteBis(B.P, async () => (await im(fb, '#erg')) === '5', 6000)), `${await im(fa, '#erg')} / ${await im(fb, '#erg')}`);
}
await fa.locator('#hakenLabel').click({ position: { x: 40, y: 8 } });
pruefe('C3 Häkchen (über die Beschriftung angeklickt) → bei Bernd gesetzt, sein Tool rechnet mit', (await im(fa, '#hakenText')) === 'fertig' && (await warteBis(B.P, async () => (await im(fb, '#hakenText')) === 'fertig' && (await im(fb, '#haken', 'checked')) === true, 6000)), `${await im(fa, '#hakenText')} / ${await im(fb, '#hakenText')}`);
await fa.locator('#wahl').focus(); await A.P.keyboard.press('ArrowDown'); await A.P.keyboard.press('ArrowDown'); await A.P.waitForTimeout(150);
pruefe('C4 Auswahl → bei Bernd dieselbe', (await im(fa, '#wahlText')) === 'blau' && (await warteBis(B.P, async () => (await im(fb, '#wahlText')) === 'blau', 6000)), `${await im(fa, '#wahlText')} / ${await im(fb, '#wahlText')}`);
await tippen(A.P, fa, '#neu', 'Brot'); await fa.locator('#dazu').click(); await A.P.waitForTimeout(200);
await tippen(A.P, fa, '#neu', 'Milch'); await A.P.keyboard.press('Enter');
await warteBis(B.P, async () => (await liste(fb, '#punkte')) === 'Brot|Milch', 6000);
pruefe('C5 Formular: einmal per Knopf, einmal per Enter → bei Bernd genau dieselben zwei Punkte (nichts doppelt, nichts leer)', (await liste(fa, '#punkte')) === 'Brot|Milch' && (await liste(fb, '#punkte')) === 'Brot|Milch' && (await im(fb, '#neu', 'value')) === '', `${await liste(fa, '#punkte')} / ${await liste(fb, '#punkte')}`);
await tippen(A.P, fa, '#schnell', 'eins'); await A.P.keyboard.press('Enter');
await tippen(A.P, fa, '#schnell', 'zwei'); await A.P.keyboard.press('Enter');
await warteBis(B.P, async () => (await liste(fb, '#schnellListe')) === 'eins|zwei', 6000);
pruefe('C6 Feld mit Enter-Taste (ohne Formular) → bei Bernd dieselben Einträge', (await liste(fa, '#schnellListe')) === 'eins|zwei' && (await liste(fb, '#schnellListe')) === 'eins|zwei', `${await liste(fa, '#schnellListe')} / ${await liste(fb, '#schnellListe')}`);
await tippen(A.P, fa, '#lang', 'Erste Zeile'); await A.P.keyboard.press('Enter'); await A.P.keyboard.type('zweite', { delay: 25 });
await tippen(A.P, fa, '#frei', 'frei geschrieben');
pruefe('C7 mehrzeiliger Text und frei beschreibbarer Bereich → bei Bernd', (await warteBis(B.P, async () => (await im(fb, '#lang', 'value')) === 'Erste Zeile\nzweite' && (await im(fb, '#frei')) === 'frei geschrieben', 6000)), `${JSON.stringify(await im(fb, '#lang', 'value'))} / ${await im(fb, '#frei')}`);
await fa.locator('#flaeche').click({ position: { x: 150, y: 20 } });
pruefe('C8 Klick auf eine Fläche → bei Bernd an derselben Stelle', (await im(fa, '#stelle')) !== '-' && (await warteBis(B.P, async () => (await im(fb, '#stelle')) === (await im(fa, '#stelle')), 6000)), `${await im(fa, '#stelle')} / ${await im(fb, '#stelle')}`);
await tippen(A.P, fa, '#geheim', 'streng geheim');
await fa.locator('#verweis').click(); await A.P.waitForTimeout(1200);
for (const p of A.ctx.pages()) if (p !== A.P) await p.close().catch(() => {});
const fensterB = B.ctx.pages().length;
pruefe('C9 nicht gespiegelt: das Passwortfeld; der Verweis öffnet bei Bernd nichts', (await im(fa, '#geheim', 'value')) === 'streng geheim' && (await im(fb, '#geheim', 'value')) === '' && (await im(fa, '#klicks')) === '1' && fensterB === 1, `${await im(fb, '#geheim', 'value')} ${await im(fa, '#klicks')}/${await im(fb, '#klicks')}`);
{
  // M414: Das Abbild lässt sich nicht bedienen — wer selbst eingeben will, löst sich und hat sein eigenes Tool
  pruefe('C10a Bernds Abbild ist nicht bedienbar', (await B.P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="h1"] iframe.spiegel')).pointerEvents)) === 'none');
  const vorA = await im(fa, '#name', 'value');
  await B.P.locator('[data-taste="zeig-loesen"]').click(); await B.P.waitForTimeout(400);
  let eigen = null;
  await warteBis(B.P, async () => { eigen = await rahmen(B.P, 'happ-frame', 'titel'); return !!eigen && !(await abbild(B.P)); }, 10000);
  // der erste Klick wählt bei Bernd die Karte aus, der zweite geht ins Tool
  await eigen.locator('#name').click(); await B.P.waitForTimeout(300); await eigen.locator('#name').click(); await B.P.keyboard.press('End');
  await B.P.keyboard.type(' und Bernd', { delay: 25 }); await B.P.waitForTimeout(1200);
  pruefe('C10 Bernd löst sich und tippt in sein eigenes Tool → bei Anna kommt nichts an', (await im(fa, '#name', 'value')) === vorA && /Bernd/.test(await im(eigen, '#name', 'value')), `${await im(fa, '#name', 'value')} / ${await im(eigen, '#name', 'value')}`);
  await B.P.locator('[data-taste="zeig-folgen"]').click(); await B.P.waitForTimeout(400);
  await tippen(A.P, fa, '#name', '!');
  pruefe('C11 er folgt wieder → er sieht Annas Wert', await warteBis(B.P, async () => { fb = await abbild(B.P); return !!fb && (await im(fb, '#name', 'value')) === (await im(fa, '#name', 'value')); }, 8000), `${await im(fa, '#name', 'value')} / ${fb ? await im(fb, '#name', 'value') : '-'}`);
}
pruefe('C12 keine Fehler in beiden Fenstern', A.P.fehler.length === 0 && B.P.fehler.length === 0, `${A.P.fehler.join()} ${B.P.fehler.join()}`);

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Später dazukommen; ohne Vorführung ════');
const nameA = await im(fa, '#name', 'value');
await B.P.reload({ waitUntil: 'networkidle' }); await B.P.waitForTimeout(2500);
fb = null;
await warteBis(B.P, async () => { fb = await abbild(B.P); return !!fb; }, 20000);
pruefe('D1 Bernd lädt neu → Annas Tool steht bei ihm wieder von selbst (er folgt)', !!fb && /du folgst/.test(await zband(B.P)), await zband(B.P));
pruefe('D2 … und zeigt die Feldwerte, die Anna schon eingegeben hat (Text, Häkchen, Auswahl, langer Text)', !!fb && (await warteBis(B.P, async () => (await im(fb, '#name', 'value')) === nameA && (await im(fb, '#haken', 'checked')) === true && (await im(fb, '#wahl', 'value')) === 'blau' && (await im(fb, '#lang', 'value')) === 'Erste Zeile\nzweite', 8000)), fb ? `${await im(fb, '#name', 'value')} ${await im(fb, '#haken', 'checked')} ${await im(fb, '#wahl', 'value')}` : '');
pruefe('D3 … das Passwort bleibt auch dann bei Anna', !!fb && (await im(fb, '#geheim', 'value')) === '');
// in der Folien-Präsentation: dasselbe Tool als Folie
/** Auf eine freie Stelle der Leinwand klicken — die Auswahl fällt, das Dock ist wieder da */
const freiKlick = async (P) => {
  const [x, y] = await P.evaluate(() => {
    for (let yy = 820; yy >= 120; yy -= 30) for (let xx = 340; xx <= 1200; xx += 30) { const el = document.elementFromPoint(xx, yy); if (el?.classList.contains('react-flow__pane')) return [xx, yy]; }
    return [340, 820];
  });
  await P.mouse.click(x, y); await P.waitForTimeout(400);
};
await freiKlick(A.P);
await vortragStart(A.P);
await warteBis(B.P, async () => (await imVortrag(B.P)) === 1, 8000);
let sa = null; let sbf = null;
for (let i = 0; i < 6 && !sa; i += 1) { sa = await rahmen(A.P, 'slide-app-frame', 'titel'); if (!sa) { await A.P.locator('[data-taste="vortrag-weiter"]').click(); await A.P.waitForTimeout(900); } }
await warteBis(B.P, async () => { sbf = await abbild(B.P, 'slide-app-frame'); return !!sbf; }, 10000);
if (sa && sbf) { await B.P.waitForTimeout(800); await tippen(A.P, sa, '#schnell', 'auf der Folie'); }
pruefe('D3b auch in der Folien-Präsentation: Annas Eingabe im Tool steht bei Bernd auf derselben Folie', !!sa && !!sbf && (await warteBis(B.P, async () => (await im(sbf, '#schnell', 'value')) === 'auf der Folie', 6000)), sbf ? String(await im(sbf, '#schnell', 'value')) : `${!!sa} ${!!sbf} ${await folie(A.P)} ${await folie(B.P)}`);
await A.P.keyboard.press('Escape'); await A.P.waitForTimeout(400);
if (await imVortrag(A.P)) { await A.P.locator('.presenter').click({ position: { x: 5, y: 5 } }).catch(() => {}); await A.P.keyboard.press('Escape'); await A.P.waitForTimeout(400); }
await warteBis(B.P, async () => (await imVortrag(B.P)) === 0, 8000);
await A.P.locator('[data-taste="zeig-ende"]').click(); await A.P.waitForTimeout(600);
await warteBis(B.P, async () => (await hatBand(B.P)) === 0, 6000);
if (!(await rahmen(B.P, 'happ-frame', 'titel'))) { await karteB.locator('.happ-startbtn, .happ-go').first().click(); await warteBis(B.P, async () => { fb = await rahmen(B.P, 'happ-frame', 'titel'); return !!fb; }, 8000); }
fa = await rahmen(A.P, 'happ-frame', 'titel');
if (!fa) { await karteA.locator('.happ-startbtn, .happ-go').first().click(); await warteBis(A.P, async () => { fa = await rahmen(A.P, 'happ-frame', 'titel'); return !!fa; }, 8000); }
{
  const vorB = await im(fb, '#schnell', 'value');
  await tippen(A.P, fa, '#schnell', 'nur bei Anna'); await A.P.waitForTimeout(1500);
  pruefe('D4 ohne Vorführung bleibt jedes Tool für sich', (await im(fa, '#schnell', 'value')) === 'nur bei Anna' && (await im(fb, '#schnell', 'value')) === vorB, `${await im(fb, '#schnell', 'value')}`);
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Texte ════');
{
  const hilfe = readdirSync(path.join(DIST, 'assets')).filter((f) => /^HelpOverlay/.test(f)).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8'));
  pruefe('E1 „Was ist neu" nennt es – deutsch und englisch', hilfe.filter((t) => t.includes('(M384)')).length === 2, `${hilfe.length}`);
  const mig = readFileSync(path.join(__repo, 'supabase', 'migrations', '20261115100000_board_aendern.sql'), 'utf8');
  pruefe('E2 die Spalte für die Anhänge steht in der Migration', /alter table public\.board_freigaben\s+add column if not exists dateien jsonb/.test(mig));
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
