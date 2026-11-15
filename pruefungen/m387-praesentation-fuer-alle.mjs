/**
 * M387 — Die Präsentation nimmt das Publikum mit; Ausschnitt, Karten-Fokus und PDF-Seiten gehören zur Ansicht.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m371). Anna (Besitzerin) am Laptop, Gerd (Gast per Link)
 * am Telefon — beide Schirme haben ein anderes Format.
 *
 *   A  Anna meldet sich an und legt den Einladungslink an.
 *   B  Anna präsentiert allein, das Publikum kommt später: Gerd tritt bei (die Frage nach dem Namen liegt über der
 *      Präsentation) → Annas Präsentation öffnet sich bei ihm, ohne dass sie „Vorführen" gedrückt hat; er blättert mit,
 *      auch durch die Seiten der PDF.
 *   C  Ausschnitt in der Folie: Seitenbreite, Zoom, Rollstand der PDF — und der Rollstand einer langen Notiz.
 *   D  Während des Vortrags legt jemand eine Karte an → niemand springt auf Folie 1 zurück.
 *   E  Anna beendet die Präsentation → sie schließt sich bei Gerd, die Vorführung endet mit.
 *   F  Aus dem Karten-Fokus: „Ab dieser Karte präsentieren" → bei Gerd öffnet sich dieselbe Folie, dieselbe Seite.
 *   G  „Team folgt" abwählen → Anna präsentiert für sich, das bleibt gemerkt; „Team mitnehmen" stellt es zurück.
 *   H  Ein Gast, der selbst präsentiert, reißt niemanden mit (er hat den Knopf).
 *   I  Auf dem Board (Anna führt vor): Karte im Fokus öffnet und schließt sich auch bei Gerd; die PDF-Karte klappt
 *      auf und blättert mit — im Fokus und auf dem Board; schließt Gerd den Fokus selbst, ist er gelöst.
 *   J  Wer mitten in der Präsentation dazukommt, landet auf derselben Folie, Seite und Vergrößerung.
 *   K  Fehlerfrei; Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m387-praesentation-fuer-alle.mjs`
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
const PORT = 4699;
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
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600);
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
async function geraet2(name, stand, anker = '', opt = {}) {
  const ctx = await browser.newContext({ viewport: opt.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', ...(opt.telefon ? { isMobile: true, hasTouch: true } : {}) });
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

// ---------- M387: Board mit Notiz, PDF (4 Seiten), langer Notiz, Notiz ----------
function pdfText(n) {
  const obj = [];
  obj.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: n }, (_, i) => `${4 + i * 2} 0 R`).join(' ');
  obj.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 0; i < n; i++) {
    let s = `BT /F1 22 Tf 60 770 Td (Kapitel ${i + 1}: Grundlagen der Kostenrechnung) Tj ET\n`;
    for (let z = 0; z < 34; z++) s += `BT /F1 11 Tf 60 ${735 - z * 19} Td (Zeile ${z + 1} auf Seite ${i + 1}: Die Deckungsbeitragsrechnung trennt fixe und variable Kosten sauber.) Tj ET\n`;
    obj.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    obj.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  }
  let aus = '%PDF-1.4\n'; const off = [];
  obj.forEach((o, i) => { off.push(aus.length); aus += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = aus.length;
  aus += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n`;
  for (const o of off) aus += `${String(o).padStart(10, '0')} 00000 n \n`;
  aus += `trailer\n<< /Size ${obj.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return aus;
}
const pdf = pdfText(4);
const pdfUrl = `data:application/pdf;base64,${Buffer.from(pdf, 'latin1').toString('base64')}`;
const lang = { id: 'x2', type: 'note', width: 260, position: { x: 820, y: 60 }, data: { color: 'yellow', blocks: Array.from({ length: 70 }, (_, i) => ({ type: 'paragraph', content: `Absatz ${i + 1} der langen Notiz mit etwas Text, damit die Folie rollt.` })) } };
const stand387 = {
  boards: [board('bx', 'Planung', [
    note('x1', 'Planung Notiz', 40, 60),
    { id: 'f1', type: 'file', width: 420, position: { x: 330, y: 60 }, data: { name: 'skript.pdf', mime: 'application/pdf', size: pdf.length, dataUrl: pdfUrl } },
    lang,
    note('x3', 'Schluss Notiz', 40, 420),
  ])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const TELEFON = { viewport: { width: 430, height: 880 }, telefon: true };
/** Lage der Dokument-Folie in der Präsentation */
const dok = (P) => P.evaluate(() => {
  const d = document.querySelector('.presenter .folie-dok'); const f = d?.querySelector('.folie-dok-flaeche');
  if (!d || !f) return null;
  return { seite: Number(d.dataset.seite), seiten: Number(d.dataset.seiten), zoom: Number(d.dataset.zoom), modus: d.dataset.modus,
    x: f.scrollLeft / Math.max(1, f.scrollWidth - f.clientWidth), y: f.scrollTop / Math.max(1, f.scrollHeight - f.clientHeight), weg: f.scrollHeight - f.clientHeight };
});
/** Rollstand einer gewöhnlichen Folie */
const folieRoll = (P) => P.evaluate(() => { const f = document.querySelector('.presenter .slide-note'); return f ? { y: f.scrollTop / Math.max(1, f.scrollHeight - f.clientHeight), weg: f.scrollHeight - f.clientHeight } : null; });
/** Lage einer Karte auf dem Board: im Fokus? aufgeklappt? welche Seite? */
const karteLage = (P, id) => P.evaluate((i) => {
  const k = document.querySelector(`.react-flow__node[data-id="${i}"]`); const s = k?.querySelector('.pdf-seite');
  return { fokus: !!document.querySelector('.app.focus-mode') && !!k?.classList.contains('pn-focused'), auf: !!s, seite: Number(s?.getAttribute('data-seite') ?? 0) };
}, id);
const fokusAn = (P) => P.evaluate(() => !!document.querySelector('.app.focus-mode'));
const frei = async (P) => { await heraus(P); await P.mouse.click(1380, 640); await P.waitForTimeout(300); };
const fokusAuf = async (P, text) => { await frei(P); await waehlen(P, text); await P.keyboard.press('Alt+f'); await P.waitForTimeout(700); };
const nah = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Anna und der Einladungslink ════');
const A = await geraet2('A', stand387);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'board-bx.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-ohne-konto"]').check();
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
await schliessen(A.P);
const topic = `realtime:pn-${kanalVon(uidA, 'bx')}`;
pruefe('A1 der Einladungslink steht', token.length > 8, token);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Anna präsentiert, das Publikum kommt dazu ════');
await frei(A.P);
await vortragStart(A.P);
pruefe('B1 Anna präsentiert allein: vier Folien, kein Band', /1 \/ 4/.test(await folie(A.P)) && (await hatBand(A.P)) === 0, `${await folie(A.P)} | ${await zband(A.P)}`);
const G = await geraet2('G', standB, `#e=${token}`, TELEFON);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await warteBis(G.P, async () => (await G.P.locator('[data-taste="gast-name"]').count()) === 1, 8000);
await warteBis(G.P, async () => (await imVortrag(G.P)) === 1, 8000);
pruefe('B2 die Frage nach dem Namen liegt über der Präsentation, die sich bei Gerd schon geöffnet hat',
  (await imVortrag(G.P)) === 1 && await G.P.evaluate(() => { const i = document.querySelector('[data-taste="gast-name"]'); const r = i.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === i; }));
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(A.P, async () => /Du führst vor/.test(await zband(A.P)), 8000);
pruefe('B3 ohne „Vorführen" zu drücken führt Anna vor — das Band sagt es', /Du führst vor/.test(await zband(A.P)) && /alle sehen deine Folien/.test(await zband(A.P)), await zband(A.P));
pruefe('B4 bei Gerd ist die Präsentation offen, erste Folie, er folgt', (await imVortrag(G.P)) === 1 && /1 \/ 4/.test(await folie(G.P)) && /du folgst/.test(await zband(G.P)), `${await folie(G.P)} | ${await zband(G.P)}`);
await A.P.locator('[data-taste="vortrag-weiter"]').click();
await warteBis(G.P, async () => (await dok(G.P))?.seite === 1 && /2 \/ 4/.test(await folie(G.P)), 8000);
let dg = await dok(G.P);
pruefe('B5 Anna blättert zur PDF → Gerd sieht die PDF, Seite 1 von 4', /2 \/ 4/.test(await folie(G.P)) && dg?.seite === 1 && dg?.seiten === 4, JSON.stringify(dg));
pruefe('B5b Gerd sieht die Seite in Annas Ansicht (am Laptop: Seitenbreite)', (await warteBis(G.P, async () => (await dok(G.P))?.modus === (await dok(A.P)).modus, 6000)) && (await dok(A.P)).modus === 'breite', JSON.stringify([await dok(A.P), await dok(G.P)]));
await A.P.keyboard.press('ArrowRight');
await warteBis(A.P, async () => (await dok(A.P)).y > 0.5, 4000);
const yA = (await dok(A.P)).y;
await G.P.waitForTimeout(800);
pruefe('B5c Pfeiltaste rollt erst die Seite zu Ende → Gerd bleibt auf Seite 1 (am Telefon passt das Blatt ganz, dort gibt es nichts zu rollen)', yA > 0.5 && (await dok(G.P)).seite === 1 && ((await dok(G.P)).weg < 4 || nah((await dok(G.P)).y, yA)), JSON.stringify([await dok(A.P), await dok(G.P)]));
await A.P.locator('[data-taste="folie-vor"]').click(); await A.P.waitForTimeout(200);
await A.P.locator('[data-taste="folie-vor"]').click();
await warteBis(G.P, async () => (await dok(G.P))?.seite === 3, 8000);
pruefe('B6 Anna blättert in der PDF weiter → Gerd ist auf Seite 3, oben am Blatt', (await dok(G.P))?.seite === 3 && (await dok(A.P))?.seite === 3 && (await warteBis(G.P, async () => (await dok(G.P)).y < 0.05, 4000)), JSON.stringify([await dok(A.P), await dok(G.P)]));
await A.P.locator('[data-taste="folie-zurueck"]').click();
await warteBis(G.P, async () => (await dok(G.P))?.seite === 2, 8000);
pruefe('B7 zurück per Knopf der Dokument-Leiste → Gerd ist auf Seite 2', (await dok(G.P))?.seite === 2);
await G.P.screenshot({ path: path.join(SD, 'm387-telefon-pdf.png') });

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Der Ausschnitt in der Folie ════');
const modusVor = (await dok(A.P)).modus;
await A.P.keyboard.press('b');
await warteBis(A.P, async () => (await dok(A.P)).modus !== modusVor, 3000);
const modusA = (await dok(A.P)).modus;
await warteBis(G.P, async () => (await dok(G.P))?.modus === modusA, 6000);
pruefe('C1 Anna wechselt die Ansicht (B) → Gerd hat dieselbe', modusA !== modusVor && (await dok(G.P))?.modus === modusA, `${modusVor} → ${modusA} | ${(await dok(G.P))?.modus}`);
await A.P.keyboard.press('+'); await A.P.waitForTimeout(150); await A.P.keyboard.press('+');
await warteBis(G.P, async () => nah((await dok(G.P))?.zoom ?? 0, 1.56, 0.02), 6000);
pruefe('C2 Anna vergrößert zweimal (+) → Gerd steht auf derselben Vergrößerung', nah((await dok(A.P)).zoom, 1.56, 0.02) && nah((await dok(G.P)).zoom, 1.56, 0.02), `${(await dok(A.P)).zoom} | ${(await dok(G.P)).zoom}`);
await A.P.evaluate(() => { const f = document.querySelector('.presenter .folie-dok-flaeche'); f.scrollTop = (f.scrollHeight - f.clientHeight) * 0.6; f.scrollLeft = (f.scrollWidth - f.clientWidth) * 0.5; });
await warteBis(G.P, async () => nah((await dok(G.P))?.y ?? 0, 0.6), 6000);
const da = await dok(A.P); dg = await dok(G.P);
pruefe('C3 Anna rollt im vergrößerten Blatt → Gerd steht an derselben Stelle (Anteil des Rollwegs)', nah(da.y, 0.6, 0.02) && nah(dg.y, da.y) && dg.weg > 40 && nah(dg.x, da.x, 0.08), JSON.stringify([da, dg]));
await A.P.keyboard.press('0');
await warteBis(G.P, async () => { const d = await dok(G.P); return d?.modus === 'seite' && nah(d.zoom, 1, 0.01); }, 6000);
dg = await dok(G.P);
pruefe('C4 Anna stellt zurück (0) → auch Gerd sieht wieder die ganze Seite', dg.modus === 'seite' && nah(dg.zoom, 1, 0.01), JSON.stringify(dg));
await A.P.keyboard.press('End'); await A.P.waitForTimeout(300);
await A.P.locator('[data-taste="vortrag-zurueck"]').click();
await warteBis(G.P, async () => /3 \/ 4/.test(await folie(G.P)), 8000);
pruefe('C5 beide sind auf der langen Notiz', /3 \/ 4/.test(await folie(A.P)) && /3 \/ 4/.test(await folie(G.P)), `${await folie(A.P)} | ${await folie(G.P)}`);
await A.P.evaluate(() => { const f = document.querySelector('.presenter .slide-note'); f.scrollTop = (f.scrollHeight - f.clientHeight) * 0.7; });
await warteBis(G.P, async () => nah((await folieRoll(G.P))?.y ?? 0, 0.7), 6000);
const ra = await folieRoll(A.P); const rg = await folieRoll(G.P);
pruefe('C6 Anna rollt die lange Notiz → Gerds Folie rollt an dieselbe Stelle', ra.weg > 100 && nah(ra.y, 0.7, 0.02) && rg.weg > 100 && nah(rg.y, 0.7), JSON.stringify([ra, rg]));

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Eine Karte kommt während des Vortrags dazu ════');
fakeAendern({ nodes: { set: [{ id: 'neu1', type: 'note', width: 200, position: { x: 10, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Neu davor' }] } }], del: [] } });
await warteBis(A.P, async () => /\/ 5/.test(await folie(A.P)), 8000);
await warteBis(G.P, async () => /\/ 5/.test(await folie(G.P)), 8000);
pruefe('D1 es sind jetzt fünf Folien — Anna bleibt auf der langen Notiz (vorher: Sprung auf Folie 1)', /4 \/ 5/.test(await folie(A.P)) && (await A.P.locator('.presenter .slide-note').textContent()).includes('Absatz 1 der langen'), await folie(A.P));
pruefe('D2 Gerd ebenso', /4 \/ 5/.test(await folie(G.P)) && (await G.P.locator('.presenter .slide-note').textContent()).includes('Absatz 1 der langen'), await folie(G.P));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Ende ════');
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => (await imVortrag(G.P)) === 0, 8000);
pruefe('E1 Anna beendet die Präsentation → bei Gerd schließt sie sich', (await imVortrag(A.P)) === 0 && (await imVortrag(G.P)) === 0);
await warteBis(G.P, async () => (await hatBand(G.P)) === 0, 6000);
pruefe('E2 die Vorführung, die mit der Präsentation begann, endet mit ihr — kein Band mehr', (await hatBand(A.P)) === 0 && (await hatBand(G.P)) === 0, `${await zband(A.P)} | ${await zband(G.P)}`);

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Aus dem Karten-Fokus präsentieren ════');
await fokusAuf(A.P, 'skript.pdf');
let ka = await karteLage(A.P, 'f1');
pruefe('F1 Anna hat die PDF im Fokus — Gerd nicht (niemand führt vor)', ka.fokus && ka.auf && !(await fokusAn(G.P)), JSON.stringify(ka));
await A.P.locator('[data-taste="fokus-seite-nr"]').click(); await A.P.keyboard.type('3'); await A.P.keyboard.press('Enter'); await A.P.waitForTimeout(700);
pruefe('F2 sie blättert im Fokus auf Seite 3', (await karteLage(A.P, 'f1')).seite === 3, JSON.stringify(await karteLage(A.P, 'f1')));
await A.P.locator('.focus-nav button[aria-label="Ab dieser Karte präsentieren"]').click();
await warteBis(G.P, async () => (await dok(G.P))?.seite === 3, 8000);
pruefe('F3 „Ab dieser Karte präsentieren" → bei Gerd öffnet sich die Präsentation auf der PDF, Seite 3', (await imVortrag(G.P)) === 1 && (await dok(G.P))?.seite === 3 && (await dok(A.P))?.seite === 3 && /du folgst/.test(await zband(G.P)), JSON.stringify([await dok(A.P), await dok(G.P), await zband(G.P)]));
await A.P.locator('[data-taste="folie-vor"]').click();
await warteBis(G.P, async () => (await dok(G.P))?.seite === 4, 8000);
pruefe('F4 Anna blättert weiter → Gerd ist auf Seite 4', (await dok(G.P))?.seite === 4);
await A.P.locator('[data-taste="folie-seite-nr"]').click(); await A.P.keyboard.press('Control+a'); await A.P.keyboard.type('2'); await A.P.keyboard.press('Enter');
await warteBis(G.P, async () => (await dok(G.P))?.seite === 2, 8000);
pruefe('F5 Anna springt per Seitenzahl auf Seite 2 → Gerd auch', (await dok(G.P))?.seite === 2 && (await dok(A.P))?.seite === 2);

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Für sich präsentieren ════');
pruefe('G0 der Knopf zeigt „Team folgt"', /Team folgt/.test(await A.P.locator('[data-taste="vortrag-team"]').textContent()));
await A.P.locator('[data-taste="vortrag-team"]').click();
await warteBis(G.P, async () => (await imVortrag(G.P)) === 0, 8000);
pruefe('G1 Anna wählt „Team folgt" ab → bei Gerd schließt sich die Präsentation, Anna bleibt drin', (await imVortrag(G.P)) === 0 && (await imVortrag(A.P)) === 1 && /Team mitnehmen/.test(await A.P.locator('[data-taste="vortrag-team"]').textContent()));
await A.P.keyboard.press('Escape'); await A.P.waitForTimeout(500);
await frei(A.P);
await vortragStart(A.P); await G.P.waitForTimeout(2500);
pruefe('G2 beim nächsten Start bleibt es dabei: Anna präsentiert für sich', (await imVortrag(A.P)) === 1 && (await imVortrag(G.P)) === 0 && (await hatBand(A.P)) === 0);
await A.P.locator('[data-taste="vortrag-team"]').click();
await warteBis(G.P, async () => (await imVortrag(G.P)) === 1, 8000);
pruefe('G3 „Team mitnehmen" → Gerd ist wieder dabei', (await imVortrag(G.P)) === 1);
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => (await imVortrag(G.P)) === 0, 8000);
await A.P.waitForTimeout(500);
await vortragStart(A.P);
await warteBis(G.P, async () => (await imVortrag(G.P)) === 1, 8000);
pruefe('G4 … und der nächste Start nimmt das Publikum wieder von selbst mit', (await imVortrag(G.P)) === 1 && /Du führst vor/.test(await zband(A.P)));
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => (await imVortrag(G.P)) === 0, 8000);
await warteBis(G.P, async () => (await hatBand(G.P)) === 0, 6000);

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: Ein Gast präsentiert für sich ════');
await G.P.keyboard.press('Alt+p'); await G.P.waitForTimeout(2500);
pruefe('H1 Gerd startet die Präsentation → Anna bleibt auf ihrem Board', (await imVortrag(G.P)) === 1 && (await imVortrag(A.P)) === 0 && (await hatBand(A.P)) === 0);
pruefe('H2 Gerd hat den Knopf „Team mitnehmen" (er entscheidet selbst)', /Team mitnehmen/.test(await G.P.locator('[data-taste="vortrag-team"]').textContent().catch(() => '')));
await G.P.keyboard.press('Escape'); await G.P.waitForTimeout(600);

// ══ I ═══════════════════════════════════════════════════════════════
console.log('\n════ I: Auf dem Board — Fokus und PDF-Seiten ════');
await frei(A.P);
await A.P.locator('[data-taste="vorfuehren"]').click(); await A.P.waitForTimeout(600);
await warteBis(G.P, async () => /du folgst/.test(await zband(G.P)), 8000);
pruefe('I0 Anna führt vor, Gerd folgt', /du folgst/.test(await zband(G.P)), await zband(G.P));
await fokusAuf(A.P, 'Planung Notiz');
await warteBis(G.P, async () => (await karteLage(G.P, 'x1')).fokus, 8000);
pruefe('I1 Anna öffnet eine Notiz im Fokus → sie öffnet sich auch bei Gerd', (await karteLage(A.P, 'x1')).fokus && (await karteLage(G.P, 'x1')).fokus);
const breiteG = await G.P.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="x1"]').getBoundingClientRect(); return { b: r.width, schirm: innerWidth, l: r.left, r: r.right }; });
pruefe('I2 am Telefon füllt die Karte die Breite (jedes Gerät richtet sie für seinen Schirm ein)', breiteG.b > breiteG.schirm * 0.7 && breiteG.l >= -2 && breiteG.r <= breiteG.schirm + 2, JSON.stringify(breiteG));
await G.P.screenshot({ path: path.join(SD, 'm387-telefon-fokus.png') });
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => !(await fokusAn(G.P)), 8000);
pruefe('I3 Anna schließt den Fokus → er schließt sich bei Gerd, er folgt weiter', !(await fokusAn(G.P)) && /du folgst/.test(await zband(G.P)), await zband(G.P));
pruefe('I4 … und Gerds Ansicht zeigt wieder Annas Ausschnitt', await folgt(G.P, A.P), JSON.stringify([await sichtVon(A.P), await sichtVon(G.P)]));
await fokusAuf(A.P, 'skript.pdf');
await warteBis(G.P, async () => { const k = await karteLage(G.P, 'f1'); return k.fokus && k.auf; }, 8000);
ka = await karteLage(A.P, 'f1'); let kg = await karteLage(G.P, 'f1');
pruefe('I5 Anna öffnet die PDF im Fokus → bei Gerd ebenso, dieselbe Seite', ka.fokus && kg.fokus && kg.auf && kg.seite === ka.seite && ka.seite >= 1, JSON.stringify([ka, kg]));
await A.P.locator('[data-taste="fokus-seite-vor"]').click();
await warteBis(G.P, async () => (await karteLage(G.P, 'f1')).seite === ka.seite + 1, 8000);
pruefe('I6 Anna blättert im Fokus weiter → Gerds Karte blättert mit', (await karteLage(G.P, 'f1')).seite === ka.seite + 1 && (await karteLage(A.P, 'f1')).seite === ka.seite + 1, JSON.stringify([await karteLage(A.P, 'f1'), await karteLage(G.P, 'f1')]));
await A.P.locator('[data-taste="fokus-seite-nr"]').click(); await A.P.keyboard.type('1'); await A.P.keyboard.press('Enter');
await warteBis(G.P, async () => (await karteLage(G.P, 'f1')).seite === 1, 8000);
pruefe('I7 … und per Seitenzahl zurück auf Seite 1', (await karteLage(G.P, 'f1')).seite === 1);
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => !(await fokusAn(G.P)) && !(await karteLage(G.P, 'f1')).auf, 8000);
pruefe('I8 Anna schließt den Fokus → bei Gerd ist die Karte wieder zugeklappt wie zuvor', !(await fokusAn(G.P)) && !(await karteLage(G.P, 'f1')).auf && !(await karteLage(A.P, 'f1')).auf, JSON.stringify([await karteLage(A.P, 'f1'), await karteLage(G.P, 'f1')]));
await frei(A.P);
await A.P.locator('.react-flow__node[data-id="f1"] .file-body').click();
await warteBis(G.P, async () => (await karteLage(G.P, 'f1')).auf, 8000);
pruefe('I9 Anna klappt die PDF auf dem Board auf → sie klappt bei Gerd auf', (await karteLage(A.P, 'f1')).auf && (await karteLage(G.P, 'f1')).auf && !(await fokusAn(G.P)));
await A.P.locator('.react-flow__node[data-id="f1"] [data-taste="pdf-zurueck"]').waitFor({ timeout: 5000 });
const vorBoard = (await karteLage(A.P, 'f1')).seite;
await A.P.locator('.react-flow__node[data-id="f1"] .pdf-seite-bar button[aria-label="Nächste Seite"]').click(); await A.P.waitForTimeout(300);
await A.P.locator('.react-flow__node[data-id="f1"] .pdf-seite-bar button[aria-label="Nächste Seite"]').click();
await warteBis(G.P, async () => (await karteLage(G.P, 'f1')).seite === vorBoard + 2, 8000);
pruefe('I10 Anna blättert auf dem Board zwei Seiten weiter → Gerds Karte auch', (await karteLage(A.P, 'f1')).seite === vorBoard + 2 && (await karteLage(G.P, 'f1')).seite === vorBoard + 2, JSON.stringify([vorBoard, await karteLage(A.P, 'f1'), await karteLage(G.P, 'f1')]));
await frei(A.P);
await A.P.locator('.react-flow__node[data-id="f1"] .file-body').click();
await warteBis(G.P, async () => !(await karteLage(G.P, 'f1')).auf, 8000);
pruefe('I11 Anna klappt zu → bei Gerd klappt sie zu', !(await karteLage(A.P, 'f1')).auf && !(await karteLage(G.P, 'f1')).auf);
await fokusAuf(A.P, 'Planung Notiz');
await warteBis(G.P, async () => (await karteLage(G.P, 'x1')).fokus, 8000);
await G.P.keyboard.press('Escape'); await G.P.waitForTimeout(1500);
pruefe('I12 Gerd schließt den Fokus selbst → er ist gelöst („Wieder folgen"), Anna bleibt im Fokus', !(await fokusAn(G.P)) && (await G.P.locator('[data-taste="zeig-folgen"]').count()) === 1 && (await karteLage(A.P, 'x1')).fokus, await zband(G.P));
await G.P.locator('[data-taste="zeig-folgen"]').tap();
await warteBis(G.P, async () => (await karteLage(G.P, 'x1')).fokus, 8000);
pruefe('I13 „Wieder folgen" → die Karte ist bei Gerd wieder im Fokus', (await karteLage(G.P, 'x1')).fokus && /du folgst/.test(await zband(G.P)));
await A.P.keyboard.press('Escape');
await warteBis(G.P, async () => !(await fokusAn(G.P)), 8000);

// ══ J ═══════════════════════════════════════════════════════════════
console.log('\n════ J: Mitten in der Präsentation dazukommen ════');
await frei(A.P);
await vortragStart(A.P);
await A.P.keyboard.press('ArrowRight'); await A.P.waitForTimeout(300);     // neu1 → x1
await A.P.keyboard.press('ArrowRight'); await A.P.waitForTimeout(300);     // → PDF
await warteBis(A.P, async () => !!(await dok(A.P)), 6000);
await A.P.locator('[data-taste="folie-seite-nr"]').click(); await A.P.keyboard.press('Control+a'); await A.P.keyboard.type('2'); await A.P.keyboard.press('Enter'); await A.P.waitForTimeout(400);
await A.P.keyboard.press('+'); await A.P.waitForTimeout(600);
const H = await geraet2('H', standB, `#e=${token}`, { viewport: { width: 1100, height: 720 } });
await warteBis(H.P, async () => (await H.P.locator('[data-taste="gast-name"]').count()) === 1, 12000);
await H.P.locator('[data-taste="gast-name"]').fill('Hanna');
await H.P.locator('[data-taste="gast-name-ok"]').click();
await warteBis(H.P, async () => { const d = await dok(H.P); return d?.seite === 2 && nah(d.zoom, 1.25, 0.02); }, 12000);
const dh = await dok(H.P);
pruefe('J1 Hanna kommt dazu → dieselbe Folie, Seite 2, dieselbe Vergrößerung', (await imVortrag(H.P)) === 1 && dh?.seite === 2 && nah(dh.zoom, 1.25, 0.02) && dh.modus === (await dok(A.P)).modus, JSON.stringify([await dok(A.P), dh]));
pruefe('J2 Gerd ist ebenfalls dort (Vorführen lief schon, die Präsentation kam dazu)', (await dok(G.P))?.seite === 2 && nah((await dok(G.P)).zoom, 1.25, 0.02), JSON.stringify(await dok(G.P)));
await A.P.keyboard.press('Escape');
await warteBis(H.P, async () => (await imVortrag(H.P)) === 0, 8000);
pruefe('J3 Anna beendet die Präsentation → sie schließt sich bei beiden; Anna führt auf dem Board weiter vor (sie hatte es vorher selbst begonnen)',
  (await imVortrag(H.P)) === 0 && (await imVortrag(G.P)) === 0 && /Du führst vor/.test(await zband(A.P)) && /du folgst/.test(await zband(H.P)), `${await zband(A.P)} | ${await zband(H.P)}`);

// ══ K ═══════════════════════════════════════════════════════════════
console.log('\n════ K: Fehlerfrei; Texte ════');
pruefe('K1 keine Fehler der Seite auf allen drei Geräten', A.P.fehler.length === 0 && G.P.fehler.length === 0 && H.P.fehler.length === 0, JSON.stringify([A.P.fehler, G.P.fehler, H.P.fehler]).slice(0, 400));
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('K2 Hilfe nennt M387 — deutsch und englisch', quelle('src/components/HelpOverlay.tsx').includes('(M387)') && quelle('src/components/HelpOverlayEn.tsx').includes('(M387)'));
pruefe('K3 docs/UMBAU.md führt M387', quelle('docs/UMBAU.md').includes('M387'));

await browser.close(); app.close();
console.log(`\nm387-praesentation-fuer-alle: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
