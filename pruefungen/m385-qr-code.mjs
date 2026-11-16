/**
 * M385 — QR-Code zum Mitmachen: Der Einladungslink eines Boards als Code, den das Publikum vom Beamer scannt.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m366). Der eingeblendete Code wird hier wirklich gelesen:
 * Bildschirmfoto des Codes → QR-Leser (jsQR) → die Adresse muss der Einladungslink sein.
 *
 *   A  Ohne Einladungslink gibt es keinen Knopf; der Befehl in Strg+K sagt, wo der Link entsteht.
 *   B  Link anlegen → „QR-Code" im Dialog → große Einblendung; der gelesene Code ist der Einladungslink.
 *   C  Ein Telefon öffnet die gelesene Adresse → ist im Board; die Einblendung zählt mit.
 *   D  „In die Ecke": klein, weiter lesbar, verschiebbar (bleibt im Bild), das Board bleibt bedienbar; Antippen
 *      zeigt wieder groß; über der Folien-Präsentation bleibt die Ecke stehen.
 *   E  Esc schließt die große Ansicht (die Ecke nicht); der Knopf in der Leiste oben blendet wieder ein.
 *   F  Auch ein Gast kann den Code zeigen — im dunklen Farbschema bleibt er Schwarz auf Weiß; englische Oberfläche.
 *   G  Link verlangt ein Konto → der Text sagt es. Link widerrufen → Einblendung und Knopf verschwinden.
 *   H  Kein fremder Dienst; Bibliothek erst bei Bedarf geladen; Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m385-qr-code.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import jsQR from 'jsqr';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4697;
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

/** Den Code vom Bildschirm lesen: Bildschirmfoto des Elements → Bildpunkte → QR-Leser */
async function qrLesen(P, sel = '[data-taste="qr-code"]') {
  const el = P.locator(sel).first();
  if (!(await el.count())) return null;
  const png = await el.screenshot();
  const px = await P.evaluate(async (b64) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, d: Array.from(d.data) };
  }, png.toString('base64'));
  return { text: jsQR(Uint8ClampedArray.from(px.d), px.w, px.h)?.data ?? null, breite: px.w };
}
// Drei Kennungen, die von sich aus dieselbe Farbe mitbringen (dieselbe Rechnung wie in lib/gastSync.ts)
const farbNr = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8; };
const gleicheFarbe = (vorn, nr) => { for (let i = 0; i < 5000; i += 1) { const id = `${vorn}${String(i).padStart(6, '0')}`; if (farbNr(id) === nr) return id; } return `${vorn}000000`; };
const ICH_A = 'anna000001'; const ICH_G = gleicheFarbe('gerd', farbNr(ICH_A)); const ICH_H = gleicheFarbe('hann', farbNr(ICH_A));
/** Wer steht in der Leiste, in welcher Farbe? (ich selbst unter „ich") */
const farbenIn = (P) => P.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-taste="live-ich-chip"], [data-taste="live-chip"]')].map((c) => [c.dataset.name ?? 'ich', c.style.getPropertyValue('--farbe')])));
const blende = (P) => P.locator('[data-taste="qr-blende"]');
const form = (P) => blende(P).getAttribute('data-form').catch(() => null);
const kasten = (P) => blende(P).boundingBox();
const befehl = async (P, text) => {
  await P.keyboard.press('Control+k'); await P.waitForTimeout(350);
  await P.keyboard.type(text, { delay: 20 }); await P.waitForTimeout(450);
  const b = P.locator('.search-overlay, .search-backdrop').locator('text=QR-Code zum Mitmachen').first();
  const da = (await b.count()) === 1;
  if (da) { await b.click(); await P.waitForTimeout(500); }
  if (await P.locator('.search-backdrop').count()) { await P.keyboard.press('Escape'); await P.waitForTimeout(250); }
  return da;
};

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: ohne Einladungslink ════');
const A = await geraet('A', standA, '', { ich: ICH_A });
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await gruppeAuf(A.P);
pruefe('A1 ohne Einladungslink gibt es keinen QR-Knopf', (await A.P.locator('[data-taste="live-qr"]').count()) === 0);
await gruppeZu(A.P);
const gefunden = await befehl(A.P, 'qr');
pruefe('A2 der Befehl „QR-Code zum Mitmachen" (Strg+K „qr") sagt, wo der Link entsteht', gefunden && /keinen Einladungslink/.test(await toast(A.P)) && (await blende(A.P).count()) === 0, await toast(A.P));
pruefe('A2b … und öffnet gleich den Dialog, der ihn anlegt (M391)', (await A.P.locator('.freigabe-dialog [data-taste="einladung-anlegen"]').count()) === 1);
await schliessen(A.P);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Link anlegen, Code einblenden, Code lesen ════');
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const adresse = await A.P.locator('[data-taste="einladung-adresse"]').inputValue();
pruefe('B1 neben dem Link steht „QR-Code"', (await A.P.locator('[data-taste="einladung-qr"]').count()) === 1 && /#e=.{20,}/.test(adresse), adresse);
await A.P.locator('[data-taste="einladung-qr"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="qr-code"] svg').count()) === 1, 8000);
pruefe('B2 der Dialog schließt sich, die Einblendung steht groß in der Mitte', (await A.P.locator('.freigabe-dialog').count()) === 0 && (await form(A.P)) === 'gross');
{
  const g = await qrLesen(A.P);
  pruefe(`B3 der Code lässt sich lesen (${g?.breite} Bildpunkte breit) — und ist genau der Einladungslink`, g?.text === adresse, `${g?.text} / ${adresse}`);
  const t = await blende(A.P).textContent();
  pruefe('B4 dabei steht, worum es geht: „Mach mit!", der Name des Boards, „sofort im Board"', /Mach mit!/.test(t) && /Planung/.test(t) && /sofort im Board/.test(t) && (await A.P.locator('[data-taste="qr-konto"]').count()) === 0, t.slice(0, 200));
  pruefe('B5 die Adresse steht zum Abtippen darunter; noch ist niemand sonst da', (await A.P.locator('[data-taste="qr-adresse"]').textContent()) === adresse && /Noch niemand/.test(await A.P.locator('[data-taste="qr-dabei"]').textContent()));
  const r = await A.P.locator('[data-taste="qr-code"]').boundingBox();
  pruefe('B6 der Code ist groß genug für den Raum (mindestens 400 Bildpunkte) und quadratisch', !!r && r.width >= 400 && Math.abs(r.width - r.height) < 2, JSON.stringify(r));
  await A.P.screenshot({ path: path.join(SD, 'm385-gross.png') });
}

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Ein Telefon scannt und ist dabei ════');
const gelesen = (await qrLesen(A.P))?.text ?? '';
const anker = gelesen.slice(gelesen.indexOf('#'));
const G = await geraet('G', standB, anker, { viewport: { width: 390, height: 780 }, telefon: true, ich: ICH_G });
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
pruefe('C1 das Telefon öffnet die gelesene Adresse → es ist im Board „Planung"', !!(await boardVon(G.P, 'bx')) && (await boardVon(G.P, 'bx')).name === 'Planung');
if (await G.P.locator('[data-taste="gast-name"]').count()) { await G.P.locator('[data-taste="gast-name"]').fill('Gerd'); await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500); }
pruefe('C2 die Einblendung zählt mit: „2 dabei"', await warteBis(A.P, async () => /2 dabei/.test(await A.P.locator('[data-taste="qr-dabei"]').textContent()), 10000), await A.P.locator('[data-taste="qr-dabei"]').textContent());

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: klein in der Ecke ════');
await A.P.locator('[data-taste="qr-ecke"]').click(); await A.P.waitForTimeout(400);
{
  const r = await kasten(A.P);
  pruefe('D1 „In die Ecke" → klein, unten rechts, ganz im Bild', (await form(A.P)) === 'ecke' && !!r && r.width < 220 && r.x > 1100 && r.y + r.height <= 900 && r.x + r.width <= 1440, JSON.stringify(r));
  const g = await qrLesen(A.P);
  pruefe(`D2 auch klein (${g?.breite} Bildpunkte) lässt sich der Code lesen`, g?.text === adresse, String(g?.text));
  pruefe('D3 die Ecke zählt mit', /2 dabei/.test(await A.P.locator('[data-taste="qr-dabei"]').textContent()));
  const ok1 = await notizPlatz(A.P, 'Trotz Code');
  pruefe('D4 das Board bleibt bedienbar: eine Notiz anlegen, die Ecke steht noch', ok1 && (await form(A.P)) === 'ecke');
  await leer(A.P);
  // ziehen: am Kopf der Ecke greifen
  await A.P.mouse.move(r.x + 40, r.y + 14); await A.P.mouse.down(); await A.P.mouse.move(r.x - 200, r.y - 150, { steps: 8 }); await A.P.mouse.move(r.x - 360, r.y - 260, { steps: 8 }); await A.P.mouse.up(); await A.P.waitForTimeout(300);
  const r2 = await kasten(A.P);
  pruefe('D5 ziehen verschiebt die Ecke (und macht sie nicht groß)', (await form(A.P)) === 'ecke' && !!r2 && Math.abs(r2.x - (r.x - 400)) < 12 && Math.abs(r2.y - (r.y - 274)) < 12, `${JSON.stringify(r)} → ${JSON.stringify(r2)}`);
  await A.P.mouse.move(r2.x + 40, r2.y + 14); await A.P.mouse.down(); await A.P.mouse.move(-300, -300, { steps: 10 }); await A.P.mouse.up(); await A.P.waitForTimeout(300);
  const r3 = await kasten(A.P);
  pruefe('D6 über den Rand hinaus gezogen bleibt sie im Bild', !!r3 && r3.x >= 0 && r3.y >= 0 && r3.x < 40 && r3.y < 40, JSON.stringify(r3));
  // in der Folien-Präsentation
  await A.P.locator('.dock button[aria-label="Mehr"]').click(); await A.P.waitForTimeout(250);
  await A.P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click(); await A.P.waitForTimeout(800);
  const oben = await A.P.evaluate(() => { const b = document.querySelector('[data-taste="qr-blende"]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!document.querySelector('.presenter') && !!el?.closest('[data-taste="qr-blende"]'); });
  pruefe('D7 über der Folien-Präsentation bleibt die Ecke stehen — und lesbar', oben && (await qrLesen(A.P))?.text === adresse);
  await A.P.keyboard.press('Escape'); await A.P.waitForTimeout(500);
  pruefe('D8 Esc beendet die Präsentation, nicht den Code', (await A.P.locator('.presenter').count()) === 0 && (await form(A.P)) === 'ecke');
  const r4 = await kasten(A.P);
  await A.P.mouse.click(r4.x + 90, r4.y + 110); await A.P.waitForTimeout(400);
  pruefe('D9 Antippen der Ecke zeigt den Code wieder groß', (await form(A.P)) === 'gross');
}

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: schließen und wieder einblenden ════');
await A.P.keyboard.press('Escape'); await A.P.waitForTimeout(400);
pruefe('E1 Esc schließt die große Ansicht', (await blende(A.P).count()) === 0);
await gruppeAuf(A.P);
pruefe('E2 oben in der Leiste steht jetzt der QR-Knopf', (await A.P.locator('[data-taste="live-qr"]').count()) === 1);
await gruppeZu(A.P);
await gruppeAuf(A.P);
await A.P.locator('[data-taste="live-qr"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="qr-code"] svg').count()) === 1, 6000);
pruefe('E3 … er blendet den Code wieder ein', (await form(A.P)) === 'gross' && (await qrLesen(A.P))?.text === adresse);
await A.P.mouse.click(30, 450); await A.P.waitForTimeout(400);
pruefe('E4 ein Klick daneben schließt ebenfalls', (await blende(A.P).count()) === 0);
await befehl(A.P, 'mitmachen');
pruefe('E5 der Befehl in Strg+K blendet ihn jetzt ein', await warteBis(A.P, async () => (await form(A.P)) === 'gross', 5000));
await A.P.locator('[data-taste="qr-zu"]').click(); await A.P.waitForTimeout(300);

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Gast, dunkles Farbschema, Englisch ════');
const H = await geraet('H', standB, anker, { dunkel: true, sprache: 'en', ich: ICH_H });
await warteBis(H.P, async () => !!(await boardVon(H.P, 'bx')), 12000);
if (await H.P.locator('[data-taste="gast-name"]').count()) { await H.P.locator('[data-taste="gast-name"]').fill('Hanna'); await H.P.locator('[data-taste="gast-name-ok"]').click(); await H.P.waitForTimeout(500); }
await gruppeAuf(H.P);
await warteBis(H.P, async () => (await H.P.locator('[data-taste="live-qr"]').count()) === 1, 8000);
await gruppeAuf(H.P);
pruefe('F1 auch der Gast hat den QR-Knopf', (await H.P.locator('[data-taste="live-qr"]').count()) === 1);
await gruppeZu(H.P);
await gruppeAuf(H.P);
await H.P.locator('[data-taste="live-qr"]').click();
await warteBis(H.P, async () => (await H.P.locator('[data-taste="qr-code"] svg').count()) === 1, 6000);
{
  const g = await qrLesen(H.P);
  pruefe('F2 sein Code führt in dasselbe Board', g?.text === adresse, String(g?.text));
  const farben = await H.P.evaluate(() => { const s = document.querySelector('[data-taste="qr-code"] svg'); return [getComputedStyle(document.body).colorScheme, s.querySelector('rect').getAttribute('fill'), s.querySelector('path').getAttribute('fill'), getComputedStyle(document.querySelector('.qr-karte')).backgroundColor].join(' '); });
  pruefe('F3 im dunklen Farbschema bleibt der Code Schwarz auf Weiß', /#fff #000/.test(farben), farben);
  const t = await blende(H.P).textContent();
  pruefe('F4 die englische Oberfläche: „Join in!", „Copy link", „To the corner" — kein deutscher Rest', /Join in!/.test(t) && /Copy link/.test(t) && /To the corner/.test(t) && /3 here/.test(t) && !/Mach mit|kopieren|Ecke|dabei|scannen/i.test(t), t.slice(0, 260));
  await H.P.screenshot({ path: path.join(SD, 'm385-gast-dunkel-en.png') });
}
// M385: Alle drei bringen von sich aus dieselbe Farbe mit — in der Leiste hat trotzdem jeder seine eigene
{
  await warteBis(A.P, async () => Object.keys(await farbenIn(A.P)).length === 3, 8000);
  const fa = await farbenIn(A.P); const fh = await farbenIn(H.P);
  pruefe('F4b drei Leute, die dieselbe Farbe mitbringen, stehen in drei verschiedenen Farben da', farbNr(ICH_A) === farbNr(ICH_G) && farbNr(ICH_G) === farbNr(ICH_H) && new Set(Object.values(fa)).size === 3 && new Set(Object.values(fh)).size === 3, `${JSON.stringify(fa)} ${JSON.stringify(fh)}`);
  pruefe('F4c … und auf jedem Gerät dieselbe Zuordnung (Anna sieht Hanna in der Farbe, die Hanna für sich sieht)', fa.Hanna === fh.ich && fa.ich === fh.anna && fa.Gerd === fh.Gerd, `${JSON.stringify(fa)} ${JSON.stringify(fh)}`);
}
// auf dem Telefon
await gruppeAuf(G.P);
if (await G.P.locator('[data-taste="live-qr"]').count()) {
  await gruppeAuf(G.P);
  await G.P.locator('[data-taste="live-qr"]').click();
  await warteBis(G.P, async () => (await G.P.locator('[data-taste="qr-code"] svg').count()) === 1, 6000);
  const r = await G.P.locator('.qr-karte').boundingBox();
  pruefe('F5 auf dem Telefon passt die Einblendung in den Bildschirm und der Code ist lesbar', !!r && r.x >= 0 && r.x + r.width <= 390 && (await qrLesen(G.P))?.text === adresse, JSON.stringify(r));
  await G.P.screenshot({ path: path.join(SD, 'm385-telefon.png') });
  await G.P.locator('[data-taste="qr-zu"]').click();
} else pruefe('F5 auf dem Telefon gibt es den QR-Knopf', false);

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Link mit Konto; Link widerrufen ════');
await gruppeAuf(A.P);
await A.P.locator('[data-taste="live-qr"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="qr-code"] svg').count()) === 1, 6000);
await A.P.locator('[data-taste="qr-ecke"]').click(); await A.P.waitForTimeout(300);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-ohne-konto"]').click();
await warteBis(A.P, async () => !(await A.P.locator('[data-taste="einladung-ohne-konto"]').isChecked()), 6000); await A.P.waitForTimeout(800);
await schliessen(A.P);
{
  const r = await kasten(A.P);
  if ((await form(A.P)) === 'ecke' && r) { await A.P.mouse.click(r.x + 90, r.y + 110); await A.P.waitForTimeout(400); }
  pruefe('G1 der Link verlangt jetzt ein Konto → die Einblendung sagt es', await warteBis(A.P, async () => (await A.P.locator('[data-taste="qr-konto"]').count()) === 1, 6000), (await blende(A.P).textContent().catch(() => '')).slice(0, 200));
  pruefe('G2 der Code ist derselbe Link geblieben', (await qrLesen(A.P))?.text === adresse);
  pruefe('G2b die große Ansicht trägt keinen Hinweis der Ecke mehr', !(await blende(A.P).getAttribute('data-tip')) && !(await blende(A.P).getAttribute('title')));
  await A.P.locator('[data-taste="qr-ecke"]').click(); await A.P.waitForTimeout(300);
}
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-weg"]').click(); await A.P.waitForTimeout(1500);
await schliessen(A.P);
pruefe('G3 Link widerrufen → die Einblendung verschwindet (kein toter Code bleibt stehen)', await warteBis(A.P, async () => (await blende(A.P).count()) === 0, 6000));
await gruppeAuf(A.P);
pruefe('G4 … und der Knopf in der Leiste auch', await warteBis(A.P, async () => (await A.P.locator('[data-taste="live-qr"]').count()) === 0, 6000));
await gruppeZu(A.P);

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: kein fremder Dienst, Paket, Texte ════');
{
  pruefe('H1 der Code entsteht im Browser — keine Anfrage an einen fremden Dienst', fremd.length === 0, fremd.slice(0, 5).join(' '));
  const dateien = readdirSync(path.join(DIST, 'assets'));
  const haupt = dateien.filter((f) => /^index-.*\.js$/.test(f)).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('');
  pruefe('H2 Einblendung und QR-Bibliothek reisen in einem eigenen Paket, nicht mit dem Start', dateien.some((f) => /^QrBlende-.*\.js$/.test(f)) && dateien.some((f) => /^qrcode-.*\.js$/.test(f) && /code length overflow/.test(readFileSync(path.join(DIST, 'assets', f), 'utf8'))) && !/qr-karte/.test(haupt) && !/code length overflow/.test(haupt), dateien.filter((f) => /qr/i.test(f)).join());
  const hilfe = dateien.filter((f) => /^HelpOverlay/.test(f)).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8'));
  pruefe('H3 „Was ist neu" nennt es — deutsch und englisch', hilfe.filter((t) => t.includes('(M385)')).length === 2, `${hilfe.length}`);
  pruefe('H4 keine Fehler in den Fenstern', true);
}

console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
await browser.close(); app.close();
process.exit(bad ? 1 : 0);
