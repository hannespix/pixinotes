/**
 * M509 — Der Look des Boards reist beim Teilen mit.
 *
 * Gewünscht: „der style des boards soll sich bei sharing (gemeinsame freigabe) mit übertragen. also wenn ich z. B.
 * spezielle look einstellungen (dark mode, pix-el grafik etc.) eingestellt habe, sollen die follower eines qr codes
 * die selben grundeinstellungen für das board übermittelt bekommen."
 *
 *   A  Anna (Dunkel, Grün, Klassisch) legt den Einladungslink an: „Look mitgeben" ist an, das Vorschau-Wort nennt den
 *      Look, der Look steht am Board und beim Server (im Board-Inhalt, kein neues Server-Feld).
 *   B  Gerd (Hell, Orange, „Besser lesbar") folgt dem Link ohne Konto: auf dem Board Annas Look (Attribute und
 *      gezeichnete Farben), seine Lesbarkeit bleibt, seine Einstellungen bleiben unverändert, ein Hinweis sagt es.
 *   C  Auf seinem eigenen Board gilt sein Look; zurück auf dem geteilten wieder Annas.
 *   D  Anna stellt auf pix·el → Gerd sieht es live.
 *   E  Gerd: Hinweis in den Einstellungen; „Eigenen Look verwenden" im Board-Dialog wirkt (Lesbarkeit bleibt) und lässt
 *      sich zurücknehmen; eine eigene Änderung seines Erscheinungsbilds rührt das geteilte Board nicht an.
 *   F  Anna schaltet „Look mitgeben" aus → Gerd hat wieder seinen Look; Annas spätere Änderungen schreiben nichts.
 *   G  Ein Look von außen mit fremden Werten: nur bekannte Werte bleiben. Texte, keine Seitenfehler.
 *
 * Das nachgebaute Supabase (Konten, Freigabe per Link, Live-Kanal) stammt aus m503 (Gerüst aus m387/m371).
 */
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
const PORT = 5509;
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


// ---------- M509: Board, Geräte, Hilfen ----------
const note = (id, text, x, y) => ({ id, type: 'note', width: 240, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const stand = { boards: [{ id: 'bx', name: 'Planung', edges: [], drawings: [], comments: [], nodes: [note('k1', 'Gemeinsam', 60, 60)] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }], activeId: 'bx', view: 'board' };
const standGast = { boards: [{ id: 'bz', name: 'Nur hier', edges: [], drawings: [], comments: [], nodes: [note('z1', 'Z Notiz', 60, 60)] }],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }], activeId: 'bz', view: 'board' };
const ANNA_UI = { theme: 'dark', accent: 'gruen', design: 'klassisch' };
const GERD_UI = { theme: 'light', accent: 'orange', design: 'klassisch' };
const seitenfehler = [];
async function geraet(name, st, ui, { anker = '', lesbar = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: 'light' });
  await dienste(ctx);
  await ctx.addInitScript(({ s, konfig, ui, lesbar }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    sessionStorage.setItem('pixinotes-hint-shown', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2, ui, ...(lesbar ? { lesbareSchrift: true } : {}) }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: s }));
  }, { s: st, konfig: { url: SB_URL, key: SB_KEY }, ui, lesbar });
  // Hinweise (Toasts) mitschreiben — sie verschwinden von selbst
  await ctx.addInitScript(() => {
    if (window !== window.top) return;
    window.__toasts = [];
    new MutationObserver(() => { document.querySelectorAll('.toast').forEach((t) => { const x = t.textContent ?? ''; if (!window.__toasts.includes(x)) window.__toasts.push(x); }); })
      .observe(document, { subtree: true, childList: true, characterData: true });
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
/** Was die Oberfläche gerade zeigt: Attribute am <html> und die gezeichneten Farben */
const look = (P) => P.evaluate(() => {
  const h = document.documentElement;
  const rf = document.querySelector('.react-flow');
  return { theme: h.dataset.theme ?? null, accent: h.dataset.accent ?? null, design: h.dataset.design ?? null, von: h.dataset.lookVon ?? null,
    lesbar: h.dataset.lesbar ?? null, grund: rf ? getComputedStyle(rf).backgroundColor : null,
    akzent: getComputedStyle(h).getPropertyValue('--accent').trim(), ink: getComputedStyle(h).getPropertyValue('--ink').trim() };
});
const vorlieben = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-einstellungen') || '{}').ui ?? {});
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
  await P.waitForSelector('[data-taste="einladung-optionen"], [data-taste="freigabe-ohne-konto"], [data-taste="freigabe-verlassen"]', { timeout: 4000 }).catch(() => {});
}
async function boardWechseln(P, name) {
  await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click();
  await P.waitForTimeout(600);
}
async function darstellung(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Darstellung' }).click(); await P.waitForTimeout(300);
}

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Anna teilt – ihr Look geht mit ════');
const A = await geraet('A', stand, ANNA_UI);
await anmelden(A.P, 'anna@example.de', 'geheim123');
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'board-bx.json'), 8000);
const annaLook = await look(A.P);
pruefe('A0 Anna arbeitet in Dunkel, Grün, Klassisch', annaLook.theme === 'dark' && annaLook.accent === 'gruen' && annaLook.design === null && annaLook.von === null, JSON.stringify(annaLook));
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
pruefe('A1 der Einladungslink steht', token.length > 8, token);
pruefe('A2 im Dialog: „Look mitgeben" ist an', await A.P.locator('[data-taste="look-mitgeben-schalter"]').isChecked().catch(() => false));
const wort = (await A.P.locator('[data-taste="look-wort"]').textContent().catch(() => '')).trim();
pruefe('A3 Vorschau-Wort nennt den Look', wort === 'Dunkel · Klassisch · Grün', wort);
await schliessen(A.P);
const bxA = await boardVon(A.P, 'bx');
pruefe('A4 der Look steht am Board', JSON.stringify(bxA?.look) === JSON.stringify({ theme: 'dark', design: 'klassisch', accent: 'gruen' }), JSON.stringify(bxA?.look));
pruefe('A5 … und kommt beim Server an (im Board, kein neues Feld)', await warteBis(A.P, async () => /"look":\{"theme":"dark"/.test(zeileText(uidA, 'board-bx.json')), 10000));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Gerd folgt dem Link – sieht Annas Look, behält seine Lesbarkeit ════');
const G = await geraet('G', standGast, GERD_UI, { anker: `#e=${token}`, lesbar: true });
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await warteBis(G.P, async () => (await G.P.locator('[data-taste="gast-name"]').count()) === 1, 8000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => (await look(G.P)).von === 'board', 10000);
let gl = await look(G.P);
pruefe('B1 Gerd sieht das Board in Annas Look (Dunkel, Grün)', gl.theme === 'dark' && gl.accent === 'gruen' && gl.design === null && gl.von === 'board', JSON.stringify(gl));
const al = await look(A.P);
pruefe('B2 gezeichnete Farben wie bei Anna (Grund, Akzent)', gl.grund === al.grund && gl.akzent === al.akzent, `${gl.grund} ${gl.akzent} / ${al.grund} ${al.akzent}`);
pruefe('B3 „Besser lesbar" von Gerd bleibt', gl.lesbar === 'an', gl.lesbar);
pruefe('B4 Gerds eigene Einstellungen sind unverändert', JSON.stringify(await vorlieben(G.P)) === JSON.stringify(GERD_UI), JSON.stringify(await vorlieben(G.P)));
await warteBis(G.P, async () => (await G.P.evaluate(() => window.__toasts)).some((t) => /Look des Teilenden/.test(t)), 6000);
pruefe('B5 ein Hinweis sagt es – mit „Eigenen Look verwenden"', (await G.P.evaluate(() => window.__toasts)).some((t) => /Look des Teilenden.*Eigenen Look verwenden/.test(t)), JSON.stringify(await G.P.evaluate(() => window.__toasts)));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Anderes Board – Gerds eigener Look ════');
await boardWechseln(G.P, 'Nur hier');
await warteBis(G.P, async () => (await look(G.P)).von === null, 6000);
gl = await look(G.P);
pruefe('C1 auf seinem eigenen Board: Hell, Orange, kein fremder Look', gl.theme === 'light' && gl.accent === 'orange' && gl.von === null, JSON.stringify(gl));
pruefe('C2 Grund ist ein anderer als auf dem geteilten Board', gl.grund !== al.grund, `${gl.grund} / ${al.grund}`);
await boardWechseln(G.P, 'Planung');
await warteBis(G.P, async () => (await look(G.P)).von === 'board', 6000);
gl = await look(G.P);
pruefe('C3 zurück auf dem geteilten Board: wieder Annas Look', gl.theme === 'dark' && gl.accent === 'gruen', JSON.stringify(gl));

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Anna stellt auf pix·el – Gerd sieht es live ════');
await darstellung(A.P);
await A.P.locator('[data-design-wahl="pixel"]').click();
await schliessen(A.P);
pruefe('D1 Anna ist in pix·el', (await look(A.P)).design === 'pixel');
const live = await warteBis(G.P, async () => (await look(G.P)).design === 'pixel', 30000);
gl = await look(G.P);
pruefe('D2 bei Gerd kommt pix·el an (ohne Neuladen)', live && gl.theme === 'dark', JSON.stringify(gl));
const al2 = await look(A.P);
pruefe('D3 gezeichnete Farben gleich (pix·el dunkel)', gl.grund === al2.grund && gl.ink === al2.ink, `${gl.grund} ${gl.ink} / ${al2.grund} ${al2.ink}`);
pruefe('D4 Gerds Einstellungen weiter unverändert', JSON.stringify(await vorlieben(G.P)) === JSON.stringify(GERD_UI));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Gerd nimmt seinen eigenen Look ════');
await darstellung(G.P);
pruefe('E1 Einstellungen sagen, dass hier der Look des Teilenden gilt', (await G.P.locator('[data-taste="look-hinweis"]').count()) === 1);
await schliessen(G.P);
await dialogOeffnen(G.P, 'Planung');
pruefe('E2 im Board-Dialog: Zeile zum Look des Boards', /pix·el/.test(await G.P.locator('[data-taste="look-gast"]').textContent().catch(() => '')));
await G.P.locator('[data-taste="look-eigen"]').click();
await warteBis(G.P, async () => (await look(G.P)).von === null, 6000);
gl = await look(G.P);
pruefe('E3 „Eigenen Look verwenden" → Hell, Orange, Klassisch', gl.theme === 'light' && gl.accent === 'orange' && gl.design === null && gl.von === null, JSON.stringify(gl));
pruefe('E4 „Besser lesbar" bleibt', gl.lesbar === 'an');
await G.P.locator('[data-taste="look-eigen"]').click();
await warteBis(G.P, async () => (await look(G.P)).von === 'board', 6000);
pruefe('E5 „Look des Boards verwenden" → wieder Annas Look', (await look(G.P)).design === 'pixel');
await schliessen(G.P);
// Gerd stellt in seinen Einstellungen um: wirkt auf seine Boards, nicht auf das geteilte
await darstellung(G.P);
await G.P.locator('.seg[aria-label="Erscheinungsbild"] button', { hasText: 'Dunkel' }).click();
await schliessen(G.P);
pruefe('E6 Gerds eigene Wahl landet in seinen Einstellungen', (await vorlieben(G.P)).theme === 'dark');
pruefe('E7 … aber am geteilten Board ändert sich nichts', JSON.stringify((await boardVon(G.P, 'bx'))?.look) === JSON.stringify({ theme: 'dark', design: 'pixel', accent: 'gruen' }), JSON.stringify((await boardVon(G.P, 'bx'))?.look));
await darstellung(G.P);
await G.P.locator('.seg[aria-label="Erscheinungsbild"] button', { hasText: 'Hell' }).click();
await schliessen(G.P);

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Anna schaltet „Look mitgeben" aus ════');
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="look-mitgeben-schalter"]').click();
await A.P.waitForTimeout(300);
pruefe('F1 Schalter ist aus', !(await A.P.locator('[data-taste="look-mitgeben-schalter"]').isChecked()));
await schliessen(A.P);
pruefe('F2 am Board steht „aus"', JSON.stringify((await boardVon(A.P, 'bx'))?.look) === '{"aus":true}', JSON.stringify((await boardVon(A.P, 'bx'))?.look));
const zurueck = await warteBis(G.P, async () => (await look(G.P)).von === null, 30000);
gl = await look(G.P);
pruefe('F3 Gerd hat wieder seinen eigenen Look', zurueck && gl.theme === 'light' && gl.accent === 'orange' && gl.design === null, JSON.stringify(gl));
pruefe('F4 Annas eigener Look bleibt pix·el', (await look(A.P)).design === 'pixel');
// Danach ändert Anna ihren Look – das Board zieht nicht nach (abgeschaltet)
await darstellung(A.P);
await A.P.locator('[data-design-wahl="klassisch"]').click();
await schliessen(A.P);
pruefe('F5 abgeschaltet: Annas Änderung schreibt keinen Look ans Board', JSON.stringify((await boardVon(A.P, 'bx'))?.look) === '{"aus":true}');

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Sicherheit und Texte ════');
{
  // Ein Look von außen mit fremden Werten: nur bekannte Werte kommen ins Board (lib/sicher.ts → lookVonAussen)
  const z = zeile(uidA, 'board-bx.json');
  const roh = JSON.parse(z.inhalt);
  roh.look = { theme: 'dark', design: 'kaputt', accent: '</style><b>', boese: 1, aus: 'ja' };
  const text = JSON.stringify(roh);
  schreib(uidA, 'board-bx.json', text, z.mime, text.length);
  const topic = sb.live.find((l) => l.topic.startsWith('realtime:pn-'))?.topic;
  if (topic) fakeSenden(topic, 'stand', {});
  const gut = await warteBis(G.P, async () => JSON.stringify((await boardVon(G.P, 'bx'))?.look) === '{"theme":"dark"}', 30000);
  pruefe('G1 fremde Werte im Look fallen weg, bekannte bleiben', gut, JSON.stringify((await boardVon(G.P, 'bx'))?.look));
  pruefe('G2 … und wirken (Dunkel), nichts Unbekanntes am <html>', await warteBis(G.P, async () => { const l = await look(G.P); return l.theme === 'dark' && l.accent === 'orange' && l.design === null; }, 6000), JSON.stringify(await look(G.P)));
  const hilfe = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const hilfeEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  pruefe('G3 Hilfe „Was ist neu" nennt M509', /M509/.test(hilfe));
  pruefe('G4 englische Hilfe nennt M509', /M509/.test(hilfeEn));
  pruefe('G5 englische Texte vorhanden', Object.keys(en).some((k) => /Look mitgeben/.test(k)) && Object.keys(en).some((k) => /Eigenen Look verwenden/.test(k)));
  pruefe('G6 Meilenstein-Datei', existsSync(path.join(__repo, 'docs/meilensteine/M509-look-teilen.md')));
  pruefe('G7 keine Seitenfehler', seitenfehler.length === 0, seitenfehler.slice(0, 3).join(' | '));
}
await browser.close(); app.close();
console.log(`\nM509: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
