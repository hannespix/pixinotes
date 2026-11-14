/**
 * M365 — Gruppenarbeit ohne Chaos: Rechte der Gäste, eigenes Rückgängig, Sicherung.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m364).
 *
 *   A  Anna legt den Link „ohne Konto" an — Gäste dürfen „alles bearbeiten, nur Eigenes löschen".
 *   B  Jede neue Karte trägt ihren Ersteller (Gast „g:…", Konto „k:…"); Altes trägt nichts.
 *   C  „Nur Eigenes löschen": Gerd bearbeitet Annas Karte, löschen kann er sie nicht — seine eigene schon.
 *   D  Anna stellt auf „nur eigene Karten ändern": Annas Karten stehen für Gerd fest (Text, Lage, Löschen),
 *      seine eigenen bearbeitet er weiter; Anna darf alles.
 *   E  Rückgängig nimmt nur Eigenes zurück: fremde Karten bleiben; von anderen Geändertes wird übersprungen;
 *      Wiederholen geht; Annas gelöschte Karte kommt zurück, ohne Gerds neue zu verlieren.
 *   F  Sicherung: „Stand von vor der Gruppenarbeit" im Dialog, Wiederherstellen und Strg+Z.
 *   G  Texte, Migration.
 */
// Läuft aus dem Repository: `node pruefungen/m365-gruppe-rechte-rueckgaengig.mjs`
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
const PORT = 4583;
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
  aufrufe: { freigabeSchreiben: 0, vorbedingung: 0, keineFreigabe: 0, stapel: 0, gastLesen: 0, gastStand: 0, gastSchreiben: 0, gastAbgelehnt: 0, nichtErlaubt: 0, karte: 0, stand: 0 },
  // M364
  kanaele: new Map(),     // `${besitzer}/${board}` → Kanalname
  live: [],               // { ws, topic, key, meta } — Broadcast + Presence
  ohneGast: false,        // Server ohne gast_*-Funktionen (Migration fehlt)
  ohneLive: false,        // Der Live-Kanal antwortet nicht (neue Verbindungen)
};
const kanalVon = (besitzer, boardId) => { const k = `${besitzer}/${boardId}`; if (!sb.kanaele.has(k)) sb.kanaele.set(k, `k${++sb.n}${Math.random().toString(36).slice(2, 12)}`); return sb.kanaele.get(k); };
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
    for (let yy = 200; yy <= 700; yy += 30) {
      for (let xx = 1150; xx >= 480; xx -= 30) {
        if (karten.some((r) => xx + 300 > r.left && xx - 60 < r.right && yy + 150 > r.top && yy - 50 < r.bottom)) continue;
        const el = document.elementFromPoint(xx, yy);
        if (el?.classList.contains('react-flow__pane')) return [xx, yy];
      }
    }
    return [1150, 220];
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

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Link mit „nur Eigenes löschen" ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
pruefe('A1 der Dialog bietet die Wahl „Gäste dürfen …" mit drei Stufen', (await A.P.locator('[data-taste="einladung-recht"] option').count()) === 3);
await A.P.locator('[data-taste="einladung-ohne-konto"]').check();
await A.P.locator('[data-taste="einladung-recht"]').selectOption('eigenes-loeschen');
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const token = /#e=(.+)$/.exec(await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => ''))?.[1] ?? '';
pruefe('A2 der Link trägt die Rechte der Gäste', !!token && sb.einladungen[0]?.optionen?.gastRecht === 'eigenes-loeschen' && sb.einladungen[0]?.ohne_konto === true, JSON.stringify(sb.einladungen[0]));
await A.P.screenshot({ path: path.join(SD, 'm365-dialog.png') });
await schliessen(A.P);
const G = await geraet('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
pruefe('A3 Gerd ist ohne Konto dabei', /2 dabei/.test(await zahl(G.P)) && (await boardVon(G.P, 'bx'))?.gastLink === token);

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Jede neue Karte trägt ihren Ersteller ════');
pruefe('B1 Gerd legt eine Karte an', await notizPlatz(G.P, 'Gerd eins'));
await warteBis(G.P, () => !!serverKarte('Gerd eins'), 10000);
pruefe('B2 auf dem Server trägt sie die Kennung eines Gasts („g:…")', /^g:.+/.test(serverKarte('Gerd eins')?.data?.von ?? ''), JSON.stringify(serverKarte('Gerd eins')?.data?.von));
await warteBis(A.P, async () => hat(A.P, 'Gerd eins'), 16000);
await ruhe(A.P);
pruefe('B3 Anna legt eine Karte an', await notizPlatz(A.P, 'Anna neu'));
await warteBis(A.P, () => !!serverKarte('Anna neu'), 12000);
pruefe('B4 Annas Karte trägt ihre Konto-Kennung („k:…"), die alte Karte nichts', serverKarte('Anna neu')?.data?.von === `k:${uidA}` && serverKarte('Planung Notiz')?.data?.von === undefined, JSON.stringify([serverKarte('Anna neu')?.data?.von, serverKarte('Planung Notiz')?.data?.von]));
await warteBis(G.P, async () => hat(G.P, 'Anna neu'), 16000);
pruefe('B5 Annas Karte ist bei Gerd', await hat(G.P, 'Anna neu'));

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Alles bearbeiten, nur Eigenes löschen ════');
await inKarte(G.P, 'Planung Notiz'); await G.P.keyboard.press('End'); await G.P.keyboard.type(' GERD-SCHREIBT', { delay: 30 });
await heraus(G.P);
await warteBis(G.P, () => /GERD-SCHREIBT/.test(bxServer()), 10000);
pruefe('C1 Gerd bearbeitet Annas alte Karte — das ist erlaubt und landet auf dem Server', /GERD-SCHREIBT/.test(bxServer()));
await waehlen(G.P, 'Planung Notiz');
await G.P.keyboard.press('Delete'); await G.P.waitForTimeout(600);
pruefe('C2 löschen kann er sie nicht', (await boardVon(G.P, 'bx')).nodes.some((n) => n.id === 'x1'));
pruefe('C3 ein Hinweis erklärt es', /nur, was du selbst angelegt hast/.test(await toast(G.P)), await toast(G.P));
await leer(G.P);
await waehlen(G.P, 'Anna neu');
await G.P.keyboard.press('Delete'); await G.P.waitForTimeout(600);
pruefe('C4 auch Annas neue Karte bleibt', await hat(G.P, 'Anna neu'));
await leer(G.P);
await G.P.waitForTimeout(4200);
await waehlen(G.P, 'Gerd eins');
await G.P.keyboard.press('Delete'); await G.P.waitForTimeout(600);
pruefe('C5 seine eigene Karte löscht Gerd', !(await hat(G.P, 'Gerd eins')));
await warteBis(G.P, () => !serverKarte('Gerd eins'), 10000);
pruefe('C6 … auch auf dem Server; der Server hat nichts abgelehnt', !serverKarte('Gerd eins') && !!serverKarte('Planung Notiz') && sb.aufrufe.nichtErlaubt === 0, `${sb.aufrufe.nichtErlaubt}`);
await warteBis(A.P, async () => !(await hat(A.P, 'Gerd eins')), 16000);

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Nur eigene Karten ändern ════');
await ruhe(A.P);
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-recht"]').selectOption('eigenes');
await warteBis(A.P, () => sb.einladungen[0]?.optionen?.gastRecht === 'eigenes', 6000);
pruefe('D1 Anna stellt um: „nur eigene Karten ändern und löschen"', sb.einladungen[0]?.optionen?.gastRecht === 'eigenes');
await schliessen(A.P);
await warteBis(G.P, async () => (await gastEintragRecht(G.P)) === 'eigenes', 10000);
pruefe('D2 bei Gerd gilt es sofort', (await gastEintragRecht(G.P)) === 'eigenes', await gastEintragRecht(G.P));
{
  const vorher = JSON.stringify((await boardVon(G.P, 'bx')).nodes.find((n) => n.id === 'x1'));
  const drin = await inKarte(G.P, 'Planung Notiz');
  if (drin) { await G.P.keyboard.type('XXFREMDXX', { delay: 20 }); await G.P.waitForTimeout(500); }   // sonst träfen die Buchstaben Tastenkürzel
  pruefe('D3 Annas Karte nimmt von Gerd nichts mehr an (kein Schreib-Cursor, kein beschreibbares Feld, Text unverändert)', !drin && (await karteEl(G.P, 'Planung Notiz').locator('[contenteditable="true"]').count()) === 0 && !(await hat(G.P, 'XXFREMDXX')));
  await leer(G.P);
  const bewegt = await ziehen(G.P, 'Planung Notiz', 170, 190);
  const danach = (await boardVon(G.P, 'bx')).nodes.find((n) => n.id === 'x1');
  pruefe('D4 verschieben lässt sie sich auch nicht', !bewegt && JSON.stringify(danach.position) === JSON.stringify(JSON.parse(vorher).position), JSON.stringify(danach.position));
  pruefe('D5 ein Hinweis erklärt es', /nur deine eigenen Karten/.test(await toast(G.P)), await toast(G.P));
  await leer(G.P);
}
pruefe('D6 Gerd legt eine eigene Karte an', await notizPlatz(G.P, 'Gerd zwei'));
await inKarte(G.P, 'Gerd zwei'); await G.P.keyboard.press('End'); await G.P.keyboard.type(' MEINS', { delay: 30 }); await heraus(G.P);
await warteBis(G.P, () => /MEINS/.test(bxServer()), 10000);
pruefe('D7 … und bearbeitet sie; der Server nimmt es an, nichts abgelehnt', /MEINS/.test(bxServer()) && sb.aufrufe.nichtErlaubt === 0);
await warteBis(A.P, async () => hat(A.P, 'MEINS'), 16000);
await ruhe(A.P);
await inKarte(A.P, 'Gerd zwei'); await A.P.keyboard.press('End'); await A.P.keyboard.type(' ANNA-DARF', { delay: 30 }); await heraus(A.P);
await warteBis(A.P, () => /ANNA-DARF/.test(bxServer()), 12000);
pruefe('D8 Anna (Besitzerin) darf Gerds Karte bearbeiten', /ANNA-DARF/.test(bxServer()));
await warteBis(G.P, async () => hat(G.P, 'ANNA-DARF'), 16000);
pruefe('D9 die Karte bleibt Gerds (Ersteller unverändert)', /^g:/.test(serverKarte('Gerd zwei')?.data?.von ?? ''));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Rückgängig nimmt nur Eigenes zurück ════');
await leer(G.P);
pruefe('E1 Gerd legt „Gerd drei" an', await notizPlatz(G.P, 'Gerd drei'));
await warteBis(A.P, async () => hat(A.P, 'Gerd drei'), 16000);
await ruhe(A.P);
pruefe('E2 Anna legt „Anna drei" an', await notizPlatz(A.P, 'Anna drei'));
await warteBis(G.P, async () => hat(G.P, 'Anna drei'), 16000);
await leer(G.P);
await G.P.keyboard.press('Control+z'); await G.P.waitForTimeout(700);
pruefe('E3 Gerds Strg+Z nimmt „Gerd drei" zurück — „Anna drei" bleibt', !(await hat(G.P, 'Gerd drei')) && (await hat(G.P, 'Anna drei')) && (await hat(G.P, 'Gerd zwei')));
await warteBis(G.P, () => !serverKarte('Gerd drei'), 10000);
pruefe('E4 auf dem Server ebenso', !serverKarte('Gerd drei') && !!serverKarte('Anna drei'));
await G.P.keyboard.press('Control+Shift+z'); await G.P.waitForTimeout(700);
pruefe('E5 Wiederholen bringt „Gerd drei" zurück, als Gerds Karte', (await hat(G.P, 'Gerd drei')) && (await hat(G.P, 'Anna drei')));
await warteBis(G.P, () => /^g:/.test(serverKarte('Gerd drei')?.data?.von ?? ''), 10000);
await warteBis(A.P, async () => hat(A.P, 'Gerd drei'), 16000);
// Gerd verschiebt seine Karte, danach ändert Anna sie → Gerds Rückgängig überspringt sie
{
  pruefe('E5b Gerd verschiebt seine Karte', await ziehen(G.P, 'Gerd drei', 150, 210));
  await leer(G.P);
  const pos = (await boardVon(G.P, 'bx')).nodes.find((n) => JSON.stringify(n.data).includes('Gerd drei')).position;
  await warteBis(A.P, async () => JSON.stringify((await boardVon(A.P, 'bx')).nodes.find((n) => JSON.stringify(n.data).includes('Gerd drei'))?.position) === JSON.stringify(pos), 16000);
  await ruhe(A.P);
  await inKarte(A.P, 'Gerd drei'); await A.P.keyboard.press('End'); await A.P.keyboard.type(' VON-ANNA-GEAENDERT', { delay: 30 }); await heraus(A.P);
  await warteBis(G.P, async () => hat(G.P, 'VON-ANNA-GEAENDERT'), 20000);
  await leer(G.P);
  await G.P.keyboard.press('Control+z'); await G.P.waitForTimeout(700);
  const n = (await boardVon(G.P, 'bx')).nodes.find((x) => JSON.stringify(x.data).includes('Gerd drei'));
  pruefe('E6 hat jemand die Karte inzwischen geändert, bleibt sie, wie sie ist (Text und Lage)', !!n && JSON.stringify(n.data).includes('VON-ANNA-GEAENDERT') && JSON.stringify(n.position) === JSON.stringify(pos), JSON.stringify(n?.position));
  pruefe('E7 ein Hinweis sagt es', /inzwischen jemand anderes geändert|Jemand anderes hat sie inzwischen geändert/.test(await toast(G.P)), await toast(G.P));
}
// Anna löscht eine eigene Karte, Gerd legt etwas an, Anna nimmt zurück
await ruhe(A.P);
await waehlen(A.P, 'Anna neu');
await A.P.keyboard.press('Delete'); await A.P.waitForTimeout(600);
pruefe('E8 Anna löscht „Anna neu"', !(await hat(A.P, 'Anna neu')));
await warteBis(G.P, async () => !(await hat(G.P, 'Anna neu')), 16000);
pruefe('E9 Gerd legt „Gerd vier" an', await notizPlatz(G.P, 'Gerd vier'));
await warteBis(A.P, async () => hat(A.P, 'Gerd vier'), 20000);
await leer(A.P);
await A.P.keyboard.press('Control+z'); await A.P.waitForTimeout(700);
pruefe('E10 Annas Strg+Z holt „Anna neu" zurück — „Gerd vier" bleibt', (await hat(A.P, 'Anna neu')) && (await hat(A.P, 'Gerd vier')));
await warteBis(G.P, async () => (await hat(G.P, 'Anna neu')) && (await hat(G.P, 'Gerd vier')), 20000);
pruefe('E11 bei Gerd und auf dem Server ebenso', (await hat(G.P, 'Anna neu')) && (await hat(G.P, 'Gerd vier')) && !!serverKarte('Anna neu') && !!serverKarte('Gerd vier'));

// Gerd verschiebt eine eigene Karte; während der Schritt noch „offen" ist, legt Anna etwas an
{
  await leer(G.P);
  pruefe('E12 Gerd legt „Gerd fuenf" an (freie Stelle)', await notizPlatz(G.P, 'Gerd fuenf'));
  await warteBis(A.P, async () => hat(A.P, 'Gerd fuenf'), 20000);
  await leer(G.P); await G.P.waitForTimeout(1500);
  const lageVon = async (P) => JSON.stringify((await boardVon(P, 'bx')).nodes.find((n) => JSON.stringify(n.data).includes('Gerd fuenf'))?.position);
  const alt = await lageVon(G.P);
  pruefe('E13 Gerd verschiebt sie', await ziehen(G.P, 'Gerd fuenf', 30, 60));
  await leer(G.P);
  await warteBis(A.P, async () => (await lageVon(A.P)) === (await lageVon(G.P)), 20000);
  await ruhe(A.P);
  pruefe('E14 Anna legt „Anna sechs" an', await notizPlatz(A.P, 'Anna sechs'));
  await warteBis(G.P, async () => hat(G.P, 'Anna sechs'), 20000);
  await leer(G.P);
  await G.P.keyboard.press('Control+z'); await G.P.waitForTimeout(800);
  pruefe('E15 Gerds Strg+Z holt seine Karte an den alten Platz — „Anna sechs" bleibt, ohne Hinweis', (await lageVon(G.P)) === alt && (await hat(G.P, 'Anna sechs')) && !/jemand anderes/i.test(await toast(G.P)), `${alt} → ${await lageVon(G.P)} | ${await toast(G.P)}`);
  await warteBis(A.P, async () => (await lageVon(A.P)) === alt, 20000);
  pruefe('E16 bei Anna steht die Karte ebenfalls wieder am alten Platz', (await lageVon(A.P)) === alt && (await hat(A.P, 'Anna sechs')));
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Sicherung — der Stand von vor der Gruppenarbeit ════');
await ruhe(A.P);
await dialogOeffnen(A.P, 'Planung');
await warteBis(A.P, async () => (await A.P.locator('[data-taste="sicherung"]').count()) === 1, 6000);
pruefe('F1 der Dialog bietet den Stand von vor der Gruppenarbeit an', (await A.P.locator('[data-taste="sicherung"]').count()) === 1 && /vor der Gruppenarbeit/.test(await A.P.locator('[data-taste="sicherung"]').textContent()));
await A.P.locator('[data-taste="sicherung-zurueck"]').click(); await A.P.waitForTimeout(900);
{
  const b = await boardVon(A.P, 'bx');
  pruefe('F2 Wiederherstellen: Das Board ist wie vor der Gruppenarbeit (eine Karte, alter Text)', b.nodes.length === 1 && b.nodes[0].id === 'x1' && !JSON.stringify(b).includes('GERD-SCHREIBT'), `${b.nodes.length}`);
}
await leer(A.P);
await A.P.keyboard.press('Control+z'); await A.P.waitForTimeout(900);
pruefe('F3 Strg+Z nimmt das Wiederherstellen zurück', (await hat(A.P, 'Gerd vier')) && (await hat(A.P, 'Anna sechs')) && (await hat(A.P, 'GERD-SCHREIBT')));

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('G1 „Was ist neu" nennt M365', js.includes('(M365)'));
  const mig = path.join(__repo, 'supabase', 'migrations', '20261114160000_gast_rechte.sql');
  const sql = existsSync(mig) ? readFileSync(mig, 'utf8') : '';
  pruefe('G2 die Migration liegt im Repository und prüft die Rechte in gast_schreiben', /gastRecht/.test(sql) && /nicht erlaubt/.test(sql) && /optionen/.test(sql));
}

await A.ctx.close(); await G.ctx.close();
await browser.close();
app.close();
console.log(`\nm365-gruppe-rechte-rueckgaengig: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
