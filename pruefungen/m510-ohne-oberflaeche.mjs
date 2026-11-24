/**
 * M510 — „Oberfläche ausblenden": nur das Board, für die Arbeit beim Teilen.
 *
 * Gewünscht: „Für die Sharing-Arbeit wäre manchmal praktisch, wenn man live das Board überträgt, aber das UI (Menüs,
 * Rahmen mit Anfassern etc.) ausgeblendet werden kann (mit Shortcut/einem dezenten Umschalter)."
 *
 *   A  Alt+B schaltet ein und aus, Esc beendet; beim Schreiben führt Esc erst aus dem Text; mit offenem Fenster nichts.
 *   B  Weg: Kopfleiste, Navigation, Leiste unten, Auswahl-Leiste, Auswahlrahmen, Griffe, Anschlusspunkte, Knöpfe in
 *      den Karten (Box-Messung: wo die Leisten standen, trifft man das Board). Da: Karteninhalte, Verbindung, Raster.
 *      Die Karten springen nicht, obwohl die Spalte ihren Platz freigibt. Nur Hinweise mit Antwort erscheinen.
 *   C  Verschieben, zoomen, in eine Notiz schreiben — alles ohne Rahmen.
 *   D  Der Umschalter unten rechts: kurz mit Beschriftung, dann unsichtbar, bei Mausbewegung dezent, unter dem Zeiger
 *      ganz; Klick holt die Oberfläche zurück.
 *   E  Eintrag im ⋯ der Leiste und in der Suche; die Präsentation beendet den Modus.
 *   F  Telefon: Tipp in die Ecke zeigt den Umschalter, der zweite schaltet.
 *   G  Weniger Bewegung: ohne Überblendung.
 *   H  pix·el, dunkel.
 *   I  Live-Board: Der Gast sieht sein Board wie immer; Anna arbeitet ohne Oberfläche weiter, Gerd bekommt es.
 *   K  Hilfe, Kürzel, Englisch.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m364–m367).
 */
// Läuft aus dem Repository: `node pruefungen/m510-ohne-oberflaeche.mjs` (Bilder: M510_BILDER=<ordner>)
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
const PORT = 5510;
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


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// M510 — eigene Abschnitte. Ein Gerät ohne Konto, mit angehefteter Navigation, zwei Notizen, einem Kanban und
// einer Verbindung zwischen den Notizen.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
const BILDER = process.env.M510_BILDER ?? SD;
mkdirSync(BILDER, { recursive: true });
const KARTEN = [
  { id: 'n1', type: 'note', position: { x: 0, y: 0 }, width: 300, data: { color: 'yellow', blocks: [{ type: 'heading', props: { level: 2 }, content: 'Quartal' }, { type: 'paragraph', content: 'Umsatz wächst' }] } },
  { id: 'n2', type: 'note', position: { x: 60, y: 300 }, width: 240, height: 110, autoFit: false, data: { color: 'sky', blocks: [{ type: 'paragraph', content: 'Nächster Schritt' }] } },
  { id: 'k1', type: 'kanban', position: { x: 440, y: 40 }, width: 420, height: 300, data: { title: 'Aufgaben', items: [{ id: 'a', text: 'Angebot', col: 0 }, { id: 'b', text: 'Maße', col: 1 }] } },
];
const KANTEN = [{ id: 'e1', source: 'n1', target: 'n2', type: 'labeled', data: { label: '', kind: 'arrow' } }];
const standM = { boards: [{ id: 'b1', name: 'Teilen', comments: [], edges: KANTEN, drawings: [], nodes: KARTEN }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', navLinks: true, cardFocus: false, clickZoom: false };
const fehlerM = [];
async function seite({ breit = 1440, hoch = 900, telefon = false, dunkel = false, design = '', ruhig = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: breit, height: hoch }, deviceScaleFactor: 1, locale: 'de-DE',
    colorScheme: dunkel ? 'dark' : 'light', ...(telefon ? { isMobile: true, hasTouch: true } : {}), ...(ruhig ? { reducedMotion: 'reduce' } : {}) });
  await ctx.addInitScript(([st, telefon, dunkel, design]) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, navLinks: !telefon, ...(dunkel ? { theme: 'dark' } : {}),
      ...(design ? { ui: { theme: dunkel ? 'dark' : 'light', accent: 'blau', design } } : {}) }));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { ...st, navLinks: !telefon } }));
  }, [standM, telefon, dunkel, design]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehlerM.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 15000 });
  await P.waitForTimeout(1200);
  return { ctx, P };
}
const an = (P) => P.evaluate(() => 'nurBoard' in document.documentElement.dataset);
const warteAn = (P, soll, ms = 4000) => warteBis(P, async () => (await an(P)) === soll, ms);
/** Ist irgendein Element dieser Auswahl zu sehen? (Maße, display, visibility, Deckkraft — auch der Eltern) */
const sichtbar = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].some((el) => {
  const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el); if (cs.visibility !== 'hidden' && cs.display !== 'none') {
    for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || +c.opacity < 0.05) return false; }
    return true;
  }
  return false;
}), sel);
/** Box-Messung: Was liegt an den Stellen, an denen die Leiste stand? Nichts von ihr — dort trifft man das Board. */
const flaecheStatt = (P, boxen, sel) => P.evaluate(([bx, s]) => bx.every((b) => {
  for (const [fx, fy] of [[0.2, 0.5], [0.5, 0.5], [0.8, 0.5]]) {
    const el = document.elementFromPoint(b.x + b.width * fx, b.y + b.height * fy);
    if (!el || el.closest(s) || !el.closest('.react-flow')) return false;
  }
  return true;
}), [boxen, sel]);
const boxVon = (P, sel) => P.evaluate((s) => [...document.querySelectorAll(s)].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).filter((r) => r.width > 4 && r.height > 4), sel);
const karteBox = (P, id) => P.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
const vp = (P) => P.evaluate(() => { const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform); return { x: m.e, y: m.f, z: m.a }; });
const knopf = (P) => P.evaluate(() => { const k = document.querySelector('.nur-board-knopf'); if (!k) return null; const r = k.getBoundingClientRect(); const cs = getComputedStyle(k);
  return { op: +cs.opacity, lang: k.classList.contains('lang'), text: k.textContent, x: r.x, y: r.y, w: r.width, h: r.height, tr: cs.transitionDuration }; });
const kopfZeigt = (P) => sichtbar(P, '.app > .topbar');
/** Eine Notiz anklicken, ohne hineinzuschreiben (oberer Rand) */
const anklicken = async (P, id) => { const k = await karteBox(P, id); await P.mouse.click(k.x + k.width / 2, k.y + 6); await P.waitForTimeout(350); };

// ══ M-A: Tastenkürzel und Esc ═══════════════════════════════════════════════════════════════════════════════
console.log('\n════ A: Alt+B schaltet, Esc beendet ════');
const M1 = await seite();
{
  const P = M1.P;
  await P.screenshot({ path: path.join(BILDER, 'm510-vorher.png') });
  pruefe('A0 vorher: Kopfleiste, Navigation und Leiste unten zu sehen', (await kopfZeigt(P)) && (await sichtbar(P, '.app > .tabs')) && (await sichtbar(P, '.app > .dock')));
  await P.mouse.click(1250, 760); await P.keyboard.press('Alt+b');
  pruefe('A1 Alt+B blendet die Oberfläche aus', await warteAn(P, true));
  await P.keyboard.press('Escape');
  pruefe('A2 Esc holt sie zurück', await warteAn(P, false));
  pruefe('A3 … und die Kopfleiste ist wieder da', await warteBis(P, () => kopfZeigt(P), 3000));
  await P.keyboard.press('Alt+b'); await warteAn(P, true);
  await P.keyboard.press('Alt+b');
  pruefe('A4 noch einmal Alt+B schaltet zurück', await warteAn(P, false));
  // Beim Schreiben führt Esc erst aus dem Text — die Oberfläche bleibt aus; das zweite Esc holt sie zurück
  await P.keyboard.press('Alt+b'); await warteAn(P, true);
  const drin = await inKarte(P, 'Umsatz');
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  const nochAus = await an(P);
  await P.evaluate(() => document.activeElement?.blur?.());
  await P.keyboard.press('Escape');
  pruefe('A5 in einer Notiz führt Esc erst aus dem Text, das nächste Esc holt die Oberfläche zurück', drin && nochAus && (await warteAn(P, false)), `${drin} ${nochAus}`);
  // Mit offenem Fenster gehört die Taste dem Fenster
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-backdrop', { timeout: 4000 });
  await P.keyboard.press('Alt+b'); await P.waitForTimeout(400);
  pruefe('A6 mit offener Suche tut Alt+B nichts', !(await an(P)));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
}

// ══ M-B: Was weg ist, was bleibt ═══════════════════════════════════════════════════════════════════════════
console.log('\n════ B: Weg sind Leisten, Rahmen und Anfasser — Karten und Verbindungen bleiben ════');
{
  const P = M1.P;
  await anklicken(P, 'n1');
  const n1 = await karteBox(P, 'n1'); await P.mouse.move(n1.x + n1.width / 2, n1.y + n1.height / 2); await P.waitForTimeout(700);
  pruefe('B0 vorher: Auswahl-Leiste und Größen-Griffe an der gewählten Notiz', (await sichtbar(P, '.sel-toolbar, .sel-toolbar-dock')) && (await sichtbar(P, '.react-flow__node[data-id="n1"] .react-flow__resize-control')));
  await P.screenshot({ path: path.join(BILDER, 'm510-vorher-auswahl.png') });
  const leisten = { kopf: await boxVon(P, '.app > .topbar'), nav: await boxVon(P, '.app > .tabs'), dock: await boxVon(P, '.app > .dock') };
  const vorN1 = await karteBox(P, 'n1'); const vorK1 = await karteBox(P, 'k1');
  await P.keyboard.press('Alt+b'); await warteAn(P, true);
  await P.mouse.move(vorN1.x + vorN1.width / 2, vorN1.y + vorN1.height / 2 + 4); await P.waitForTimeout(700);
  pruefe('B1 Kopfleiste, Navigation, Leiste unten und Impressum-Ecke sind nicht zu sehen',
    !(await sichtbar(P, '.app > .topbar')) && !(await sichtbar(P, '.app > .tabs')) && !(await sichtbar(P, '.app > .dock')) && !(await sichtbar(P, '.app > .legal-corner')));
  pruefe('B2 wo die Leisten standen, trifft man das Board (Box-Messung)', leisten.kopf.length > 0 && leisten.nav.length > 0 && leisten.dock.length > 0
    && (await flaecheStatt(P, [...leisten.kopf, ...leisten.nav, ...leisten.dock], '.topbar, .tabs, .dock')), JSON.stringify(leisten));
  pruefe('B3 keine Auswahl-Leiste, keine Größen-Griffe, Anschlusspunkte, Drehknopf, Griff, Farbpunkt', !(await sichtbar(P, '.sel-toolbar, .sel-toolbar-dock, .sel-toolbar-anker'))
    && !(await sichtbar(P, '.react-flow__resize-control, .pn-handle, .dreh-knopf, .card-grip > *, .color-dot')));
  pruefe('B4 kein Auswahlrahmen um die gewählte Notiz', await P.evaluate(() => { const n = document.querySelector('.react-flow__node[data-id="n1"]'); return n.classList.contains('selected') && getComputedStyle(n).outlineStyle === 'none'; }));
  const k1 = await karteBox(P, 'k1'); await P.mouse.click(k1.x + 40, k1.y + 8); await P.mouse.move(k1.x + 200, k1.y + 120); await P.waitForTimeout(800);
  pruefe('B5 im Kanban keine Knöpfe (⋯, neues Ticket), auch gewählt und mit dem Zeiger darauf', !(await sichtbar(P, '.react-flow__node[data-id="k1"] :is(.kanban-add, .kanban-addcol, button[aria-haspopup])')));
  pruefe('B6 Karteninhalte zu sehen (Notiz, Tickets)', (await sichtbar(P, '.react-flow__node[data-id="n1"] .card-body')) && (await P.locator('.react-flow__node[data-id="n1"]').textContent()).includes('Umsatz')
    && (await P.locator('.react-flow__node[data-id="k1"]').textContent()).includes('Angebot') && (await sichtbar(P, '.react-flow__node[data-id="k1"] .kanban-item')));
  pruefe('B7 die Verbindung ist zu sehen', await sichtbar(P, '.react-flow__edge-path'));
  pruefe('B8 das Board-Raster ist zu sehen', await sichtbar(P, '.react-flow__background'));
  const nN1 = await karteBox(P, 'n1'); const nK1 = await karteBox(P, 'k1');
  pruefe('B9 die Karten bleiben, wo sie waren (die Spalte gibt ihren Platz frei, nichts springt)', Math.abs(nN1.x - vorN1.x) < 2 && Math.abs(nN1.y - vorN1.y) < 2 && Math.abs(nK1.x - vorK1.x) < 2,
    `${vorN1.x}→${nN1.x}`);
  pruefe('B10 das Board reicht bis an den linken Rand', await P.evaluate(() => document.querySelector('.board-wrap').getBoundingClientRect().left < 1));
  await P.mouse.move(700, 700); await P.waitForTimeout(3200);
  await P.screenshot({ path: path.join(BILDER, 'm510-nachher.png') });
  // Hinweise: nur, was eine Antwort braucht
  await P.mouse.click(1250, 120); await P.waitForTimeout(300);
  await P.keyboard.press('Alt+a'); await P.waitForTimeout(300);
  const einfach = await sichtbar(P, '.toast.show');
  await anklicken(P, 'n1'); await P.keyboard.press('Delete');
  await warteBis(P, () => sichtbar(P, '.toast.show.wichtig'), 3000);
  const mitKnopf = await sichtbar(P, '.toast.show .toast-undo');
  pruefe('B11 ein bloßer Hinweis bleibt unsichtbar, „Rückgängig" nach dem Löschen erscheint', !einfach && mitKnopf, `${einfach} ${mitKnopf}`);
  await P.locator('.toast .toast-undo').first().click(); await P.waitForTimeout(500);
  pruefe('B12 … und holt die Notiz zurück', (await P.locator('.react-flow__node[data-id="n1"]').count()) === 1);
}

// ══ M-C: Bedienen ohne Oberfläche ═══════════════════════════════════════════════════════════════════════
console.log('\n════ C: Verschieben, zoomen, schreiben geht weiter ════');
{
  const P = M1.P;
  pruefe('C0 Oberfläche ist noch aus', await an(P));
  const v0 = await vp(P);
  await P.mouse.move(1200, 700); await P.mouse.down(); await P.mouse.move(1100, 640, { steps: 6 }); await P.mouse.move(1000, 600, { steps: 6 }); await P.mouse.up(); await P.waitForTimeout(400);
  const v1 = await vp(P);
  pruefe('C1 Ziehen auf der freien Fläche verschiebt die Ansicht', Math.abs(v1.x - v0.x) > 100 && Math.abs(v1.y - v0.y) > 50, `${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
  await P.mouse.click(1250, 120); await P.keyboard.press('+'); await P.waitForTimeout(500);
  const v2 = await vp(P);
  await P.mouse.move(800, 450); await P.keyboard.down('Control'); await P.mouse.wheel(0, 300); await P.keyboard.up('Control'); await P.waitForTimeout(500);
  const v3 = await vp(P);
  pruefe('C2 Zoomen mit + und mit Strg+Mausrad', v2.z > v1.z * 1.05 && v3.z < v2.z * 0.97, `${v1.z} → ${v2.z} → ${v3.z}`);
  const drin = await inKarte(P, 'Umsatz');
  await P.keyboard.press('End'); await P.keyboard.insertText(' im Herbst'); await P.waitForTimeout(400);
  pruefe('C3 in die Notiz klicken und schreiben', drin && (await P.locator('.react-flow__node[data-id="n1"]').textContent()).includes('im Herbst'));
  pruefe('C4 auch beim Schreiben bleibt der Rahmen weg', await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="n1"]')).outlineStyle === 'none') && !(await sichtbar(P, '.react-flow__node[data-id="n1"] .react-flow__resize-control')));
  await heraus(P);
  pruefe('C5 nach allem ist die Oberfläche noch aus', await an(P));
  await P.keyboard.press('Escape'); await warteAn(P, false);
}

// ══ M-D: Der dezente Umschalter ═════════════════════════════════════════════════════════════════════════
console.log('\n════ D: Der Umschalter unten rechts ════');
{
  const P = M1.P;
  await P.mouse.click(1250, 120);
  await P.keyboard.press('Alt+b'); await warteAn(P, true); await P.waitForTimeout(350);
  const k0 = await knopf(P);
  pruefe('D1 beim Einschalten steht er kurz mit Beschriftung da', !!k0 && k0.lang && k0.op > 0.9 && k0.text.includes('Oberfläche einblenden'), JSON.stringify(k0));
  pruefe('D2 er sitzt unten rechts und ist mindestens 44 × 44 Punkte groß', !!k0 && k0.x > 1000 && k0.y > 780 && k0.w >= 44 && k0.h >= 44, JSON.stringify(k0));
  pruefe('D3 ohne Bewegung verblasst er', await warteBis(P, async () => { const k = await knopf(P); return !!k && !k.lang && k.op < 0.05; }, 6000), JSON.stringify(await knopf(P)));
  await P.mouse.move(600, 400); await P.mouse.move(640, 420, { steps: 4 });
  pruefe('D4 eine Mausbewegung zeigt ihn – dezent, ohne Beschriftung', await warteBis(P, async () => { const k = await knopf(P); return k.op > 0.3 && k.op < 0.9 && !k.lang; }, 3000), JSON.stringify(await knopf(P)));
  pruefe('D5 … und er verblasst wieder', await warteBis(P, async () => { const k = await knopf(P); return !!k && !k.lang && k.op < 0.05; }, 6000));
  const k = await knopf(P);
  await P.mouse.move(k.x + k.w / 2, k.y + k.h / 2, { steps: 4 });
  pruefe('D6 unter dem Zeiger ist er ganz da', await warteBis(P, async () => (await knopf(P)).op > 0.95, 3000));
  await P.mouse.click(k.x + k.w / 2, k.y + k.h / 2);
  pruefe('D7 ein Klick holt die Oberfläche zurück', await warteAn(P, false));
  pruefe('D8 außerhalb des Modus gibt es den Umschalter nicht', (await P.locator('.nur-board-knopf').count()) === 0);
}

// ══ M-E: ⋯ der Leiste und Suche ══════════════════════════════════════════════════════════════════════════
console.log('\n════ E: Eintrag im ⋯ der Leiste und in der Suche ════');
{
  const P = M1.P;
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(300);
  const e = P.locator('[data-taste="dock-nur-board"]');
  pruefe('E1 ⋯ der Leiste bietet „Oberfläche ausblenden" (mit dem Kürzel im Tooltip)', (await e.count()) === 1 && (await e.textContent()).includes('Oberfläche ausblenden') && /Alt\+B/.test(await e.getAttribute('title')));
  await e.click();
  pruefe('E2 … und schaltet ein', await warteAn(P, true));
  await P.keyboard.press('Escape'); await warteAn(P, false);
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-backdrop', { timeout: 4000 });
  await P.keyboard.type('Oberfläche ausbl', { delay: 15 }); await P.waitForTimeout(400);
  const befehl = P.locator('.search-backdrop button', { hasText: 'Oberfläche ausblenden' }).first();
  pruefe('E3 die Suche kennt „Oberfläche ausblenden"', (await befehl.count()) === 1);
  await befehl.click();
  pruefe('E4 … schaltet ein und schließt sich', (await warteAn(P, true)) && (await P.locator('.search-backdrop').count()) === 0);
  await P.keyboard.press('Escape'); await warteAn(P, false);
  pruefe('E5 die Präsentation beendet den Modus; danach ist die Oberfläche wieder da', await (async () => {
    await P.keyboard.press('Alt+b'); await warteAn(P, true);
    await P.keyboard.press('Alt+p'); await P.waitForSelector('.presenter', { timeout: 5000 });
    const ausImVortrag = !(await an(P));
    await P.keyboard.press('Escape'); await P.waitForSelector('.presenter', { state: 'detached', timeout: 5000 }).catch(() => {});
    await P.waitForTimeout(600);
    return ausImVortrag && (await kopfZeigt(P));
  })());
  await M1.ctx.close();
}

// ══ M-F: Telefon ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ F: Telefon ════');
{
  const { ctx, P } = await seite({ breit: 390, hoch: 844, telefon: true });
  await P.screenshot({ path: path.join(BILDER, 'm510-telefon-vorher.png') });
  await P.locator('.dock button[aria-label="Mehr"]').tap(); await P.waitForTimeout(300);
  await P.locator('[data-taste="dock-nur-board"]').tap();
  pruefe('F1 über ⋯ der Leiste ein', await warteAn(P, true));
  pruefe('F2 Kopfleiste und Leiste unten weg, Karten da', !(await sichtbar(P, '.app > .topbar')) && !(await sichtbar(P, '.app > .dock')) && (await sichtbar(P, '.react-flow__node .card-body')));
  pruefe('F3 der Umschalter verblasst – ein Fingerwisch übers Board zeigt ihn nicht', await warteBis(P, async () => { const k = await knopf(P); return !!k && !k.lang && k.op < 0.05; }, 6000));
  await P.screenshot({ path: path.join(BILDER, 'm510-telefon-nachher.png') });
  const k = await knopf(P);
  await P.touchscreen.tap(k.x + k.w / 2, k.y + k.h / 2); await P.waitForTimeout(300);
  pruefe('F4 ein Tipp in die Ecke zeigt ihn, ohne schon umzuschalten', (await an(P)) && (await knopf(P)).op > 0.3, JSON.stringify(await knopf(P)));
  await P.touchscreen.tap(k.x + k.w / 2, k.y + k.h / 2);
  pruefe('F5 der zweite Tipp holt die Oberfläche zurück', await warteAn(P, false));
  await ctx.close();
}

// ══ M-G: Weniger Bewegung ═══════════════════════════════════════════════════════════════════════════════
console.log('\n════ G: Weniger Bewegung ════');
{
  const { ctx, P } = await seite({ ruhig: true });
  await P.mouse.click(1250, 120); await P.keyboard.press('Alt+b'); await warteAn(P, true);
  const k = await knopf(P);
  pruefe('G1 ohne Überblendung (Übergang 0 s)', !!k && /^0s/.test(k.tr), k?.tr);
  pruefe('G2 Esc holt die Oberfläche zurück', await (async () => { await P.keyboard.press('Escape'); return warteAn(P, false); })());
  await ctx.close();
}

// ══ M-H: pix·el, dunkel ═════════════════════════════════════════════════════════════════════════════════
console.log('\n════ H: pix·el und dunkel ════');
for (const [design, dunkel, name] of [['pixel', false, 'pixel'], ['pixel', true, 'pixel-dunkel'], ['', true, 'dunkel']]) {
  const { ctx, P } = await seite({ design, dunkel });
  await anklicken(P, 'n1');
  await P.screenshot({ path: path.join(BILDER, `m510-${name}-vorher.png`) });
  await P.keyboard.press('Alt+b'); await warteAn(P, true);
  await P.mouse.move(700, 700); await P.waitForTimeout(400);
  const ok1 = !(await sichtbar(P, '.app > .topbar')) && !(await sichtbar(P, '.app > .tabs')) && !(await sichtbar(P, '.app > .dock')) && !(await sichtbar(P, '.react-flow__resize-control, .sel-toolbar'))
    && await P.evaluate(() => getComputedStyle(document.querySelector('.react-flow__node[data-id="n1"]')).outlineStyle === 'none');
  const ok2 = (await sichtbar(P, '.react-flow__edge-path')) && (await sichtbar(P, '.react-flow__node[data-id="k1"] .kanban-item'));
  pruefe(`H ${name}: Oberfläche und Rahmen weg, Karten und Verbindung da`, ok1 && ok2, `${ok1} ${ok2}`);
  await P.waitForTimeout(3000);
  await P.screenshot({ path: path.join(BILDER, `m510-${name}-nachher.png`) });
  await ctx.close();
}

// ══ M-I: Live-Board ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ I: Live-Board – der Gast sieht sein Board wie immer ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
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
pruefe('I0 Anna und Gerd sind im selben Board', /2 dabei/.test(await zahl(G.P)) && /2 dabei/.test(await zahl(A.P)));
// Anna führt vor, Gerd folgt — dann blendet Anna ihre Oberfläche aus
await gruppeAuf(A.P);
await A.P.locator('[data-taste="vorfuehren"]').click(); await A.P.waitForTimeout(600);
await warteBis(G.P, async () => /führt vor/.test(await zband(G.P)), 6000);
await A.P.mouse.click(1300, 300); await A.P.keyboard.press('Alt+b');
pruefe('I1 bei Anna ist die Oberfläche aus', await warteAn(A.P, true));
await G.P.waitForTimeout(1500);
pruefe('I2 bei Gerd nicht: keine Markierung, Kopfleiste und Leiste unten zu sehen', !(await an(G.P)) && (await kopfZeigt(G.P)) && (await sichtbar(G.P, '.app > .dock')));
pruefe('I3 Gerd sieht das Band „führt vor" weiter und folgt', /führt vor/.test(await zband(G.P)) && (await folgt(G.P, A.P)), await zband(G.P));
// Anna arbeitet ohne Oberfläche weiter — Gerd bekommt es wie immer
const neu = await notizPlatz(A.P, 'Ohne Rahmen notiert');
pruefe('I4 Anna legt ohne Oberfläche eine Notiz an (Doppelklick, schreiben)', neu && (await an(A.P)));
pruefe('I5 … Gerd sieht sie', await warteBis(G.P, () => hat(G.P, 'Ohne Rahmen notiert'), 15000));
// Zeiger der anderen bleiben bei Anna zu sehen (sie zeigen, wohin jemand zeigt) — hier als Stellvertreter eingehängt
const zeigerDa = await A.P.evaluate(() => {
  const z = document.createElement('div'); z.className = 'live-zeiger'; z.style.cssText = 'position:fixed;left:400px;top:400px;width:20px;height:20px';
  const l = document.createElement('div'); l.className = 'laser-punkt'; l.style.cssText = 'position:fixed;left:500px;top:400px;width:20px;height:20px';
  document.body.append(z, l);
  const ok = [z, l].every((e) => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0.5);
  z.remove(); l.remove(); return ok;
});
pruefe('I6 Zeiger der anderen und Laser bleiben bei ausgeblendeter Oberfläche sichtbar', zeigerDa);
await A.P.screenshot({ path: path.join(BILDER, 'm510-live-anna.png') });
await G.P.screenshot({ path: path.join(BILDER, 'm510-live-gerd.png') });
await A.P.keyboard.press('Escape');
pruefe('I7 Esc: Anna hat ihre Oberfläche zurück, die Vorführung läuft weiter', (await warteAn(A.P, false)) && /führt vor/.test(await zband(G.P)));
await G.ctx.close(); await A.ctx.close();

// ══ M-K: Texte ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ K: Hilfe, Kürzel, Englisch ════');
{
  const q = (p) => readFileSync(path.join(__repo, p), 'utf8');
  pruefe('K1 Hilfe nennt M510 – deutsch und englisch', q('src/components/HelpOverlay.tsx').includes('(M510)') && q('src/components/HelpOverlayEn.tsx').includes('(M510)'));
  pruefe('K2 Alt+B steht in der Kürzel-Liste (lib/tasten.ts)', /id: 'nurBoard', taste: 'Alt\+B'/.test(q('src/lib/tasten.ts')));
  const en = JSON.parse(q('src/sprache/en.json'));
  pruefe('K3 englische Texte', en['Oberfläche ausblenden'] === 'Hide interface' && en['Oberfläche einblenden'] === 'Show interface');
  pruefe('K4 Meilenstein-Datei', existsSync(path.join(__repo, 'docs/meilensteine/M510-ohne-oberflaeche.md')));
  pruefe('K5 keine Seitenfehler', fehlerM.length === 0, fehlerM.slice(0, 3).join(' | '));
}

await browser.close();
app.close();
console.log(`\nm510-ohne-oberflaeche: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
