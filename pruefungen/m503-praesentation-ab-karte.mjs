/**
 * M503 — Die Präsentation startet bei der gewählten Karte.
 *
 * Gemeldet: „wenn ich bei einem modul präsentieren klicke soll die präsentation an dieser stelle öffnen. momentan
 * öffnet es immer das erste modul nicht das ausgewählte."
 *
 * Ein Board mit fünf Karten in einer Reihe (Lesefolge Eins … Fünf). Geprüft wird der INHALT der Folie und die Zahl
 * „n / 5" – und dass vorher nie Folie 1 aufblitzte (ein Beobachter schreibt jede gezeigte Zahl mit).
 *
 *   A  Fokus der 4. Karte → „Ab dieser Karte präsentieren" → Folie 4; Weiter → 5, Zurück → 3.
 *   B  Kontextmenü (Rechtsklick) der 2. Karte → „Ab hier präsentieren" → Folie 2; ⋯ der Auswahl-Leiste bei der 3. → 3.
 *   C  Dock „Präsentieren" ohne Auswahl → Folie 1; mit markierter 5. Karte → 5; Alt+P mit markierter 2. → 2;
 *      alle markiert → Folie 1 (mehrere markierte sind keine Stelle); Menü des Boards mit markierter 4. → 4.
 *   D  Ein Rahmen markiert → seine Abschnitts-Folie (der Rahmen-Name), danach seine erste Karte.
 *   E  Live-Board: Anna präsentiert aus dem Fokus der 4. Karte → Gerd sieht als ERSTE Folie die 4.; sie blättert,
 *      er folgt; mit markierter 2. Karte und Alt+P → bei Gerd Folie 2. Nie Folie 1 dazwischen.
 *   F  Hilfe, englische Hilfe, Meilenstein; keine Seitenfehler.
 *
 * Das nachgebaute Supabase (Konten, Freigabe per Link, Live-Kanal) stammt aus m387 (Gerüst aus m371).
 */
// Läuft aus dem Repository: `node pruefungen/m503-praesentation-ab-karte.mjs`
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
const PORT = 5503;
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

// ---------- M503: Board, Geräte, Hilfen ----------
const WORTE = ['Erste', 'Zweite', 'Dritte', 'Vierte', 'Fuenfte'];
const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
// Fünf Karten in einer Reihe → Lesefolge 1 … 5
const KARTEN = WORTE.map((w, i) => note(`k${i + 1}`, `${w} Folie`, 40 + i * 300, 80));
const standMit = (nodes) => ({ boards: [{ id: 'bx', name: 'Planung', edges: [], drawings: [], comments: [], nodes }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }], activeId: 'bx', view: 'board' });
const stand = standMit(KARTEN);
// D: Ein Rahmen „Schluss" umspannt die 4. und 5. Karte – er ist eine Abschnitts-Folie vor ihnen (1, 2, 3, Schluss, 4, 5)
const standRahmen = standMit([...KARTEN, { id: 'r1', type: 'frame', position: { x: 920, y: 20 }, width: 600, height: 260, data: { name: 'Schluss' } }]);
const standGast = { boards: [{ id: 'bz', name: 'Nur hier', edges: [], drawings: [], comments: [], nodes: [note('z1', 'Z Notiz', 60, 60)] }],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }], activeId: 'bz', view: 'board' };
const seitenfehler = [];
async function geraet(name, st, anker = '', mitKonto = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  if (mitKonto) await dienste(ctx);
  await ctx.addInitScript(({ s, konfig }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    if (konfig) localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, { s: st, konfig: mitKonto ? { url: SB_URL, key: SB_KEY } : null });
  // Jede Zahl „n / 5", die je in der Präsentation stand, mitschreiben – auch eine, die nur einen Augenblick da war
  await ctx.addInitScript(() => {
    if (window !== window.top) return;
    window.__folien = [];
    const merke = () => { const t = document.querySelector('.presenter .presenter-count')?.textContent?.replace(/\s+/g, ' ').trim(); if (t && window.__folien[window.__folien.length - 1] !== t) window.__folien.push(t); };
    new MutationObserver(merke).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { seitenfehler.push(`${name}: ${e.message}`); console.log(`    PAGEERROR[${name}]:`, e.message); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(200); }
  return fn();
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
const imVortrag = (P) => P.locator('.presenter').count();
const zaehler = (P) => P.locator('.presenter .presenter-count').textContent().then((t) => t.replace(/\s+/g, ' ').trim()).catch(() => '');
const folienText = (P) => P.locator('.presenter').innerText().catch(() => '');
/** Was zeigt die Präsentation? Nummer aus der Zahl und welches Wort auf der Folie steht */
const folie = async (P) => {
  const z = await zaehler(P); const t = await folienText(P);
  return { z, wort: WORTE.find((w) => t.includes(`${w} Folie`)) ?? '' };
};
const istFolie = async (P, n) => { const f = await folie(P); return f.z === `${n} / 5` && f.wort === WORTE[n - 1]; };
const gesehen = (P) => P.evaluate(() => window.__folien.slice());
const gesehenLeeren = (P) => P.evaluate(() => { window.__folien = []; });
const zu = async (P) => {
  if (await imVortrag(P)) { await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await warteBis(P, async () => (await imVortrag(P)) === 0, 6000); }
  await P.waitForTimeout(400);
};
const heraus = async (P) => { await P.keyboard.press('Escape'); await P.waitForTimeout(150); await P.evaluate(() => document.activeElement?.blur?.()); await P.waitForTimeout(250); };
/** Ein Klick ins Leere (hebt die Auswahl auf) – wirklich ins Leere, das Board steht nach einer Präsentation woanders */
const frei = async (P) => {
  await heraus(P);
  const pkt = await P.evaluate(() => {
    for (const [x, y] of [[1380, 760], [1380, 640], [80, 760], [720, 760], [1380, 120], [80, 140]]) {
      const el = document.elementFromPoint(x, y);
      if (el?.classList.contains('react-flow__pane')) return [x, y];
    }
    return [1380, 760];
  });
  await P.mouse.click(pkt[0], pkt[1]); await P.waitForTimeout(300);
};
/** Das ganze Board einpassen, damit jede Karte zu greifen ist */
const einpassen = async (P) => { await frei(P); await P.keyboard.press('f'); await P.waitForTimeout(700); };
/** Ein Punkt, an dem man genau DIESE Karte greift (nicht ihren Text, keinen Knopf) */
const greifpunkt = (P, id) => P.evaluate((i) => {
  const karte = document.querySelector(`.react-flow__node[data-id="${i}"]`);
  if (!karte) return null;
  const r = karte.getBoundingClientRect();
  for (const dy of [7, 9, 5, 11, r.height - 7]) {
    for (let dx = 14; dx < r.width - 14; dx += 12) {
      const el = document.elementFromPoint(r.left + dx, r.top + dy);
      if (el && el.closest('.react-flow__node') === karte && !el.closest('.nodrag, button, input, [contenteditable="true"], .react-flow__resize-control')) return [r.left + dx, r.top + dy];
    }
  }
  return null;
}, id);
const markiert = (P) => P.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.dataset.id).sort().join(','));
const waehlen = async (P, id) => {
  const g = await greifpunkt(P, id);
  await P.mouse.click(g[0], g[1]);
  await warteBis(P, async () => (await markiert(P)) === id, 3000);
};
/** Die Präsentation ist offen und zeigt Folie n (Inhalt und Zahl) */
const offenAuf = (P, n) => warteBis(P, async () => (await imVortrag(P)) === 1 && (await istFolie(P, n)), 15000);
const dockPraesentieren = async (P) => {
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click();
  await P.waitForSelector('.presenter', { timeout: 15000 }).catch(() => {});
};
const fokusAuf = async (P, id) => {
  await frei(P); await waehlen(P, id); await P.keyboard.press('Alt+f');
  await warteBis(P, async () => (await P.locator('.focus-nav button[aria-label="Ab dieser Karte präsentieren"]').count()) === 1, 8000);
};
const ohneEins = (liste) => !liste.includes('1 / 5');

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Aus dem Fokus der 4. Karte ════');
const L = await geraet('L', stand);
await einpassen(L.P);
await fokusAuf(L.P, 'k4');
pruefe('A0 der Fokus der 4. Karte ist offen', await L.P.evaluate(() => !!document.querySelector('.app.focus-mode')));
await gesehenLeeren(L.P);
await L.P.locator('.focus-nav button[aria-label="Ab dieser Karte präsentieren"]').click();
pruefe('A1 die Präsentation öffnet auf der 4. Karte („Vierte Folie", 4 / 5)', await offenAuf(L.P, 4), JSON.stringify(await folie(L.P)));
pruefe('A2 vorher stand nie Folie 1 auf dem Schirm', ohneEins(await gesehen(L.P)), JSON.stringify(await gesehen(L.P)));
await L.P.keyboard.press('ArrowRight');
pruefe('A3 Weiter → 5. Karte', await offenAuf(L.P, 5), JSON.stringify(await folie(L.P)));
await L.P.locator('[data-taste="vortrag-zurueck"]').click().catch(async () => { await L.P.keyboard.press('ArrowLeft'); });
pruefe('A4 Zurück → 4. Karte', await offenAuf(L.P, 4), JSON.stringify(await folie(L.P)));
await L.P.keyboard.press('ArrowLeft');
pruefe('A5 noch einmal zurück → 3. Karte', await offenAuf(L.P, 3), JSON.stringify(await folie(L.P)));
await zu(L.P);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Kontextmenü und Auswahl-Leiste ════');
await einpassen(L.P);
{
  const g = await greifpunkt(L.P, 'k2');
  await L.P.mouse.click(g[0], g[1], { button: 'right' });
  const eintrag = L.P.locator('[data-taste="auswahl-praesentieren"]');
  await warteBis(L.P, async () => (await eintrag.count()) === 1, 4000);
  pruefe('B1 Rechtsklick auf die 2. Karte: „Ab hier präsentieren" steht im Kontextmenü', (await eintrag.count()) === 1 && /Ab hier präsentieren/.test(await eintrag.textContent()));
  await gesehenLeeren(L.P);
  await eintrag.click();
  pruefe('B2 die Präsentation öffnet auf der 2. Karte', await offenAuf(L.P, 2), JSON.stringify(await folie(L.P)));
  pruefe('B3 ohne Folie 1 davor', ohneEins(await gesehen(L.P)), JSON.stringify(await gesehen(L.P)));
  await L.P.keyboard.press('ArrowRight');
  pruefe('B4 Weiter → 3. Karte', await offenAuf(L.P, 3), JSON.stringify(await folie(L.P)));
  await zu(L.P);
}
await einpassen(L.P);
await waehlen(L.P, 'k3');
await L.P.locator('[data-taste="auswahl-mehr"]').click();
await warteBis(L.P, async () => (await L.P.locator('[data-taste="auswahl-praesentieren"]').count()) === 1, 4000);
await gesehenLeeren(L.P);
await L.P.locator('[data-taste="auswahl-praesentieren"]').click();
pruefe('B5 ⋯ der Auswahl-Leiste bei der 3. Karte → Folie 3', await offenAuf(L.P, 3), JSON.stringify(await folie(L.P)));
pruefe('B6 ohne Folie 1 davor', ohneEins(await gesehen(L.P)), JSON.stringify(await gesehen(L.P)));
await zu(L.P);

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Dock, Alt+P, Menü des Boards ════');
await einpassen(L.P);
pruefe('C0 nichts markiert', (await markiert(L.P)) === '', await markiert(L.P));
await dockPraesentieren(L.P);
pruefe('C1 Dock „Präsentieren" ohne Auswahl → von vorn (Folie 1)', await offenAuf(L.P, 1), JSON.stringify(await folie(L.P)));
await zu(L.P);
await einpassen(L.P);
await waehlen(L.P, 'k5');
await gesehenLeeren(L.P);
await dockPraesentieren(L.P);
pruefe('C2 Dock „Präsentieren" mit markierter 5. Karte → Folie 5', await offenAuf(L.P, 5), JSON.stringify(await folie(L.P)));
pruefe('C3 ohne Folie 1 davor', ohneEins(await gesehen(L.P)), JSON.stringify(await gesehen(L.P)));
await L.P.keyboard.press('ArrowLeft');
pruefe('C4 Zurück → 4. Karte', await offenAuf(L.P, 4), JSON.stringify(await folie(L.P)));
await zu(L.P);
await einpassen(L.P);
await waehlen(L.P, 'k2');
await gesehenLeeren(L.P);
await L.P.keyboard.press('Alt+p');
pruefe('C5 Alt+P mit markierter 2. Karte → Folie 2', await offenAuf(L.P, 2), JSON.stringify(await folie(L.P)));
pruefe('C6 ohne Folie 1 davor', ohneEins(await gesehen(L.P)), JSON.stringify(await gesehen(L.P)));
await zu(L.P);
await einpassen(L.P);
await L.P.keyboard.press('Control+a'); await L.P.waitForTimeout(400);
await dockPraesentieren(L.P);
pruefe('C7 alle Karten markiert → von vorn (Folie 1)', await offenAuf(L.P, 1), `${await markiert(L.P)} ${JSON.stringify(await folie(L.P))}`);
await zu(L.P);
await einpassen(L.P);
await waehlen(L.P, 'k4');
{
  const z = L.P.locator('.tabs.spalte .side-board', { hasText: 'Planung' }).first();
  await z.hover(); await L.P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await L.P.waitForTimeout(300);
  await gesehenLeeren(L.P);
  await L.P.locator('.ebenen-menu [role="menuitem"]', { hasText: 'Präsentieren' }).first().click();
  pruefe('C8 Menü des Boards (dieses Board) mit markierter 4. Karte → Folie 4', await offenAuf(L.P, 4), JSON.stringify(await folie(L.P)));
  pruefe('C9 ohne Folie 1 davor', ohneEins(await gesehen(L.P)), JSON.stringify(await gesehen(L.P)));
  await zu(L.P);
}

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Ein Rahmen ════');
await L.ctx.close();
{
  const R = await geraet('R', standRahmen);
  await einpassen(R.P);
  await R.P.locator('.react-flow__node[data-id="r1"] .frame-name').click();
  let getroffen = await warteBis(R.P, async () => (await markiert(R.P)) === 'r1', 3000);
  if (!getroffen) {
    // Rahmen am Rand greifen (dort liegt keine Karte)
    const r = await R.P.evaluate(() => { const e = document.querySelector('.react-flow__node[data-id="r1"]')?.getBoundingClientRect(); return e ? [e.left, e.top, e.width, e.height] : null; });
    for (const [dx, dy] of r ? [[r[2] / 2, 6], [6, r[3] / 2], [r[2] - 6, r[3] / 2], [r[2] / 2, r[3] - 6]] : []) {
      await R.P.mouse.click(r[0] + dx, r[1] + dy);
      if (await warteBis(R.P, async () => (await markiert(R.P)) === 'r1', 1500)) { getroffen = true; break; }
    }
  }
  pruefe('D0 der Rahmen ist markiert (allein)', getroffen, await markiert(R.P));
  await gesehenLeeren(R.P);
  await dockPraesentieren(R.P);
  const ab = await warteBis(R.P, async () => (await zaehler(R.P)) === '4 / 6' && /Schluss/.test(await folienText(R.P)), 15000);
  pruefe('D1 Rahmen markiert → die Präsentation beginnt mit seiner Abschnitts-Folie „Schluss" (4 / 6)', ab, `${await zaehler(R.P)} ${(await folienText(R.P)).slice(0, 80)}`);
  pruefe('D2 ohne Folie 1 davor', !(await gesehen(R.P)).includes('1 / 6'), JSON.stringify(await gesehen(R.P)));
  await R.P.keyboard.press('ArrowRight');
  pruefe('D3 Weiter → die 4. Karte (erste im Rahmen)', await warteBis(R.P, async () => (await zaehler(R.P)) === '5 / 6' && /Vierte Folie/.test(await folienText(R.P)), 8000), await zaehler(R.P));
  await zu(R.P);
  await R.ctx.close();
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Live-Board – Gäste sehen dieselbe Startfolie ════');
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
const A = await geraet('A', stand, '', true);
await anmelden(A.P, 'anna@example.de', 'geheim123');
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'board-bx.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
pruefe('E0 der Einladungslink steht', token.length > 8, token);
const G = await geraet('G', standGast, `#e=${token}`, true);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await warteBis(G.P, async () => (await G.P.locator('[data-taste="gast-name"]').count()) === 1, 8000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(A.P, async () => (await A.P.locator('[data-taste="live-auf"]').count()) > 0, 10000);
await A.P.waitForTimeout(1200);   // Gerd ist im Kanal angekommen
// Gerd hat selbst eine Karte markiert – seine Auswahl darf Annas Startfolie nicht verdrängen
await einpassen(G.P);
await waehlen(G.P, 'k1').catch(() => {});
await gesehenLeeren(G.P);
await einpassen(A.P);
await fokusAuf(A.P, 'k4');
await A.P.locator('.focus-nav button[aria-label="Ab dieser Karte präsentieren"]').click();
pruefe('E1 Anna präsentiert aus dem Fokus der 4. Karte → bei ihr Folie 4', await offenAuf(A.P, 4), JSON.stringify(await folie(A.P)));
pruefe('E2 bei Gerd öffnet sich die Präsentation auf derselben Folie (4)', await offenAuf(G.P, 4), `${JSON.stringify(await folie(G.P))} | ${await zband(G.P)}`);
pruefe('E3 Gerd sah als erste Folie die 4. – nie Folie 1', (await gesehen(G.P))[0] === '4 / 5' && ohneEins(await gesehen(G.P)), JSON.stringify(await gesehen(G.P)));
pruefe('E4 Gerd folgt', /du folgst/.test(await zband(G.P)), await zband(G.P));
await A.P.keyboard.press('ArrowRight');
pruefe('E5 Anna blättert weiter → Gerd sieht Folie 5', await offenAuf(G.P, 5), JSON.stringify(await folie(G.P)));
await A.P.keyboard.press('Escape'); await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => (await imVortrag(G.P)) === 0, 10000);
pruefe('E6 Anna beendet → bei Gerd schließt sich die Präsentation', (await imVortrag(A.P)) === 0 && (await imVortrag(G.P)) === 0);
await warteBis(A.P, async () => (await A.P.locator('[data-taste="zeig-band"]').count()) === 0, 8000);
await einpassen(A.P);
await waehlen(A.P, 'k2');
await gesehenLeeren(G.P);
await A.P.keyboard.press('Alt+p');
pruefe('E7 Anna: Karte 2 markiert, Alt+P → Folie 2', await offenAuf(A.P, 2), JSON.stringify(await folie(A.P)));
pruefe('E8 Gerd sieht ebenfalls Folie 2 – als erste, nie Folie 1', (await offenAuf(G.P, 2)) && (await gesehen(G.P))[0] === '2 / 5' && ohneEins(await gesehen(G.P)), `${JSON.stringify(await folie(G.P))} ${JSON.stringify(await gesehen(G.P))}`);
await zu(A.P);

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Texte ════');
{
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('F1 Hilfe „Was ist neu" nennt M503', /M503/.test(hilfe));
  pruefe('F2 englische Hilfe nennt M503', /M503/.test(hilfeEn));
  pruefe('F3 Meilenstein-Datei', existsSync(path.join(__repo, 'docs/meilensteine/M503-praesentation-ab-karte.md')));
  pruefe('F4 keine Seitenfehler', seitenfehler.length === 0, seitenfehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM503: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
