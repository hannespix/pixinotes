/**
 * M364 — Gruppenarbeit per Link, auch ohne Konto, in Echtzeit; Karten-Sperre „wer zuerst anfasst".
 * Supabase (Auth, PostgREST, RPCs, Realtime mit Broadcast + Presence) ist im Node-Prozess nachgebaut.
 *
 *   A  Anna (Konto) legt den Einladungslink mit „Auch ohne Konto" an; ihr Live-Kanal geht auf.
 *   B  Gerd (KEIN Konto) öffnet den Link: Board da, keine Anmeldung, Namensfrage, „2 dabei" auf beiden Seiten.
 *   C  Gerds Karte landet in Annas Zeile und bei Anna; Annas Karte bei Gerd — ohne dass sein Board neu aufbaut.
 *   D  Sperre: Anna tippt in eine Karte → Gerd sieht Rahmen + Namen und liest LIVE mit (noch nicht gespeichert);
 *      er kann die Karte weder betreten noch ziehen noch löschen. Mitlesen löst bei ihm kein Schreiben aus.
 *      Anna lässt los → frei; Gerd bearbeitet dieselbe Karte, Anna sieht seinen Rahmen. Parallel an zwei Karten.
 *   E  Sicherheit: Was über den Kanal kommt, ist nur Anzeige — ein gefälschter Teilnehmer bringt nichts in
 *      den gespeicherten Stand; Nachrichten von Nicht-Haltern werden verworfen.
 *   F  Rolle des Links „nur lesen" ↔ „bearbeiten" wirkt beim Gast ohne Konto.
 *   G  Neu laden: Gerd ist weiter dabei. Board-Menü → „Gemeinsames Board …".
 *   H  „Auch ohne Konto" aus → Gerd ist draußen (eigene Kopie); wieder an + Link erneut → wieder dabei, Kopie bleibt.
 *   I  Bernd (mit Konto) nimmt denselben Link an: drei im Kanal, auch er sieht die Sperre.
 *   J  Server ohne Gast-Funktionen: Der Link führt wie bisher zur Anmeldung.
 *   K  Live-Kanal tot: Der Abgleich läuft trotzdem (Blick alle paar Sekunden).
 *   L  Texte, Migration.
 */
// Läuft aus dem Repository: `node pruefungen/m364-gruppenarbeit-ohne-konto.mjs`
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
const PORT = 4582;
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
  aufrufe: { freigabeSchreiben: 0, vorbedingung: 0, keineFreigabe: 0, stapel: 0, gastLesen: 0, gastStand: 0, gastSchreiben: 0, gastAbgelehnt: 0, karte: 0, stand: 0 },
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
        return json(route, 200, { board_id: e.board_id, rolle: e.rolle, besitzer: e.besitzer, inhalt: z.inhalt, version: z.version, dateien: e.dateien ?? [], kanal: kanalVon(e.besitzer, e.board_id) });
      }
      if (pfad.endsWith('/gast_stand')) {
        sb.aufrufe.gastStand += 1;
        return json(route, 200, z ? { version: z.version, rolle: e.rolle } : null);
      }
      if (pfad.endsWith('/gast_schreiben')) {
        if (!z || e.rolle !== 'bearbeiten') { sb.aufrufe.gastAbgelehnt += 1; return json(route, 400, { code: 'P0002', message: 'keine freigabe' }); }
        if (b.p_wenn_version == null || String(z.version) !== String(b.p_wenn_version)) { sb.aufrufe.vorbedingung += 1; return json(route, 400, { code: 'P0001', message: 'vorbedingung' }); }
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
      return json(route, 200, { kanal: kanalVon(b.p_besitzer, b.p_board_id) });
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

// ══ A ═══════════════════════════════════════════════════════════════
console.log('\n════ A: Anna legt den Link „auch ohne Konto" an ════');
const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Planung');
pruefe('A1 der Dialog bietet „Auch ohne Konto" beim Einladungslink', (await A.P.locator('[data-taste="einladung-ohne-konto"]').count()) === 1 && /ohne Konto/.test(await A.P.locator('[data-taste="einladung"]').textContent()));
await A.P.locator('[data-taste="einladung-ohne-konto"]').check();
await A.P.locator('[data-taste="einladung-anlegen"]').click();
await warteBis(A.P, async () => (await A.P.locator('[data-taste="einladung-adresse"]').count()) === 1, 6000);
const adresse = await A.P.locator('[data-taste="einladung-adresse"]').inputValue().catch(() => '');
const token = /#e=(.+)$/.exec(adresse)?.[1] ?? '';
pruefe('A2 der Link ist angelegt und erlaubt Gäste ohne Konto', !!token && sb.einladungen[0]?.ohne_konto === true && sb.einladungen[0]?.rolle === 'bearbeiten', JSON.stringify(sb.einladungen[0]));
pruefe('A3 der Haken bleibt am fertigen Link sichtbar und gesetzt', await A.P.locator('[data-taste="einladung-ohne-konto"]').isChecked());
await A.P.screenshot({ path: path.join(SD, 'm364-dialog.png') });
await schliessen(A.P);
await warteBis(A.P, () => sb.live.length >= 1, 8000);
const topic = `realtime:pn-${kanalVon(uidA, 'bx')}`;
pruefe('A4 Annas Live-Kanal für das Board ist offen (Name vom Server, nicht das Token)', sb.live.some((l) => l.topic === topic) && !topic.includes(token), topic);
await warteBis(A.P, async () => /nur du/.test(await zahl(A.P)), 6000);
pruefe('A5 oben rechts: „nur du"', /nur du/.test(await zahl(A.P)), await zahl(A.P));

// ══ B ═══════════════════════════════════════════════════════════════
console.log('\n════ B: Gerd öffnet den Link — ohne Konto ════');
const G = await geraet('G', standB, `#e=${token}`);
await warteBis(G.P, async () => !!(await boardVon(G.P, 'bx')), 12000);
const bxG = await boardVon(G.P, 'bx');
pruefe('B1 „Planung" ist da — als Board per Link (Token gemerkt), ohne Konto', bxG?.gastLink === token && bxG?.geteiltVon === uidA && !bxG?.geteiltRolle && (await G.P.evaluate(() => !localStorage.getItem('pixinotes-konto'))), JSON.stringify({ l: bxG?.gastLink, v: bxG?.geteiltVon }));
pruefe('B2 keine Anmeldung verlangt (Einstellungen bleiben zu), das Board ist offen', (await G.P.locator('.modal-tabs').count()) === 0 && (await zustand(G.P)).activeId === 'bx' && /Planung Notiz/.test(await texteVon(G.P)));
pruefe('B3 es fragt nach dem Namen', (await G.P.locator('[data-taste="gast-name"]').count()) === 1);
await G.P.screenshot({ path: path.join(SD, 'm364-name.png') });
await G.P.locator('[data-taste="gast-name"]').fill('Gerd');
await G.P.locator('[data-taste="gast-name-ok"]').click(); await G.P.waitForTimeout(500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 8000);
pruefe('B4 Gerd sieht „2 dabei" und Annas Kürzel', /2 dabei/.test(await zahl(G.P)) && (await chipNamen(G.P)).some((n) => /anna/i.test(n)), `${await zahl(G.P)} ${JSON.stringify(await chipNamen(G.P))}`);
await warteBis(A.P, async () => (await chipNamen(A.P)).includes('Gerd'), 8000);
pruefe('B5 Anna sieht „2 dabei" und „Gerd"', /2 dabei/.test(await zahl(A.P)) && (await chipNamen(A.P)).includes('Gerd'), `${await zahl(A.P)} ${JSON.stringify(await chipNamen(A.P))}`);
pruefe('B6 das Board steht bei Gerd unter „Geteilt mit mir"', (await zustand(G.P)).spaces.some((sp) => sp.id === 'geteilt' && sp.projects.some((p) => p.boardIds.includes('bx'))));
await G.P.screenshot({ path: path.join(SD, 'm364-gast.png') });

// ══ C ═══════════════════════════════════════════════════════════════
console.log('\n════ C: Beide schreiben — es kommt jeweils drüben an ════');
await G.P.evaluate(() => { document.querySelector('.react-flow').__marke = 'bleibt'; });
pruefe('C1 Gerd legt eine Karte an', await notizPlatz(G.P, 'Von Gerd'));
await warteBis(G.P, () => /Von Gerd/.test(bxServer()), 10000);
pruefe('C2 sie liegt in Annas Zeile auf dem Server (gast_schreiben)', /Von Gerd/.test(bxServer()) && sb.aufrufe.gastSchreiben >= 1, `${sb.aufrufe.gastSchreiben}`);
pruefe('C3 der Server-Stand trägt keine Geräte-Angaben (Token, Besitzer)', !/gastLink|geteiltVon/.test(bxServer()));
await warteBis(A.P, async () => /Von Gerd/.test(await texteVon(A.P)), 16000);
pruefe('C4 Anna sieht Gerds Karte', /Von Gerd/.test(await texteVon(A.P)), await texteVon(A.P));
await A.P.waitForTimeout(2600);
pruefe('C5 Anna legt eine Karte an', await notizPlatz(A.P, 'Von Anna'));
await warteBis(G.P, async () => /Von Anna/.test(await texteVon(G.P)), 16000);
pruefe('C6 Gerd sieht Annas Karte', /Von Anna/.test(await texteVon(G.P)), await texteVon(G.P));
pruefe('C7 Gerds Board wurde dafür nicht neu aufgebaut', (await G.P.evaluate(() => document.querySelector('.react-flow').__marke)) === 'bleibt');
await G.P.waitForTimeout(1200);
pruefe('C8 beide Stände tragen die drei Karten, nichts doppelt', (await boardVon(G.P, 'bx')).nodes.length === 3 && (await boardVon(A.P, 'bx')).nodes.length === 3, `${(await boardVon(G.P, 'bx')).nodes.length}/${(await boardVon(A.P, 'bx')).nodes.length}`);

// ══ D ═══════════════════════════════════════════════════════════════
console.log('\n════ D: Karten-Sperre — wer zuerst anfasst, hat die Karte ════');
await A.P.waitForTimeout(2600); await G.P.waitForTimeout(500);
const gastSchreibenVor = sb.aufrufe.gastSchreiben;
const serverVorD = bxServer();
await inKarte(A.P, 'Planung Notiz');
await warteBis(G.P, async () => (await sperre(G.P, 'x1').count()) === 1, 6000);
pruefe('D1 Gerd sieht den Rahmen um Annas Karte — mit ihrem Namen', (await sperre(G.P, 'x1').count()) === 1 && /anna/i.test(await sperre(G.P, 'x1').textContent().catch(() => '')), await sperre(G.P, 'x1').textContent().catch(() => '-'));
pruefe('D2 Anna selbst sieht um ihre Karte keinen Sperr-Rahmen', (await sperre(A.P, 'x1').count()) === 0);
// Anna tippt langsam — Gerd liest mit, bevor irgendetwas gespeichert ist
await A.P.keyboard.press('End');
const tippen = A.P.keyboard.type(' MITLESEN-GEHT-LIVE-UND-SOFORT', { delay: 90 });
await G.P.waitForTimeout(1500);
const mittendrin = await texteVon(G.P);
pruefe('D3 Gerd liest beim Tippen live mit (Text da, bevor er auf dem Server liegt)', /MITLES/.test(mittendrin) && !/MITLES/.test(bxServer()), `${mittendrin.slice(0, 120)} | server:${/MITLES/.test(bxServer())}`);
await tippen;
await G.P.waitForTimeout(700);
pruefe('D4 … bis zum letzten Zeichen', /MITLESEN-GEHT-LIVE-UND-SOFORT/.test(await texteVon(G.P)), (await texteVon(G.P)).slice(0, 160));
await G.P.screenshot({ path: path.join(SD, 'm364-sperre.png') });
// Gerd versucht es an der gesperrten Karte
await inKarte(G.P, 'Planung Notiz');
await G.P.waitForTimeout(400);
pruefe('D5 Gerd kommt nicht in die Karte (der Schreib-Cursor bleibt draußen)', !(await G.P.evaluate(() => !!document.activeElement?.closest?.('.react-flow__node[data-id="x1"]') && document.activeElement.isContentEditable)));
const posVor = (await boardVon(G.P, 'bx')).nodes.find((n) => n.id === 'x1').position;
{
  const kb = await karteEl(G.P, 'Planung Notiz').boundingBox();
  await G.P.mouse.move(kb.x + 12, kb.y + 6); await G.P.mouse.down(); await G.P.mouse.move(kb.x + 150, kb.y + 130, { steps: 8 }); await G.P.mouse.up(); await G.P.waitForTimeout(500);
}
const posNach = (await boardVon(G.P, 'bx')).nodes.find((n) => n.id === 'x1').position;
pruefe('D6 Gerd kann die Karte nicht verschieben', posNach.x === posVor.x && posNach.y === posVor.y, JSON.stringify({ posVor, posNach }));
pruefe('D7 ein Hinweis sagt, wer sie gerade hat', /bearbeitet diese Karte gerade/.test(await toast(G.P)) && /anna/i.test(await toast(G.P)), await toast(G.P));
await G.P.keyboard.press('Delete'); await G.P.waitForTimeout(500);
pruefe('D8 Entf löscht die gesperrte Karte nicht', (await boardVon(G.P, 'bx')).nodes.some((n) => n.id === 'x1'));
await G.P.mouse.click(1380, 860); await G.P.waitForTimeout(300);
// Anna lässt los
await heraus(A.P);
await warteBis(G.P, async () => (await sperre(G.P, 'x1').count()) === 0, 6000);
pruefe('D9 Anna verlässt die Karte → der Rahmen bei Gerd ist weg', (await sperre(G.P, 'x1').count()) === 0);
await warteBis(G.P, () => /MITLESEN-GEHT-LIVE-UND-SOFORT/.test(bxServer()), 12000);
await warteBis(G.P, async () => /MITLESEN-GEHT-LIVE-UND-SOFORT/.test(JSON.stringify((await boardVon(G.P, 'bx')).nodes.find((n) => n.id === 'x1'))), 12000);
pruefe('D10 Annas Text liegt auf dem Server und in Gerds Stand', /MITLESEN-GEHT-LIVE-UND-SOFORT/.test(bxServer()) && /MITLESEN-GEHT-LIVE-UND-SOFORT/.test(JSON.stringify(await boardVon(G.P, 'bx'))));
await G.P.waitForTimeout(1500);
pruefe('D11 das Mitlesen hat bei Gerd kein eigenes Schreiben ausgelöst', sb.aufrufe.gastSchreiben === gastSchreibenVor, `${gastSchreibenVor} → ${sb.aufrufe.gastSchreiben} | Reihe ${reihe(serverVorD)} → ${reihe(bxServer())}`);
pruefe('D12 Live-Nachrichten liefen über den Kanal', sb.aufrufe.karte >= 3, `${sb.aufrufe.karte}`);
// Jetzt Gerd an derselben Karte
await inKarte(G.P, 'Planung Notiz');
await G.P.keyboard.press('End');
await G.P.keyboard.type(' UND-GERD', { delay: 40 });
await warteBis(A.P, async () => (await sperre(A.P, 'x1').count()) === 1, 6000);
pruefe('D13 Gerd bearbeitet die freie Karte → Anna sieht seinen Rahmen „Gerd"', (await sperre(A.P, 'x1').count()) === 1 && /Gerd/.test(await sperre(A.P, 'x1').textContent().catch(() => '')));
await warteBis(A.P, async () => /UND-GERD/.test(await texteVon(A.P)), 6000);
pruefe('D14 … und liest live mit', /UND-GERD/.test(await texteVon(A.P)));
await heraus(G.P);
await warteBis(A.P, async () => (await sperre(A.P, 'x1').count()) === 0 && /UND-GERD/.test(bxServer()), 12000);
await warteBis(A.P, async () => /UND-GERD/.test(JSON.stringify(await boardVon(A.P, 'bx'))), 16000);
pruefe('D15 losgelassen: Rahmen weg, Gerds Text auf dem Server und in Annas Stand', (await sperre(A.P, 'x1').count()) === 0 && /UND-GERD/.test(bxServer()) && /UND-GERD/.test(JSON.stringify(await boardVon(A.P, 'bx'))),
  `rahmen:${await sperre(A.P, 'x1').count()} server:${/UND-GERD/.test(bxServer())} anna:${/UND-GERD/.test(JSON.stringify(await boardVon(A.P, 'bx')))} gerd:${/UND-GERD/.test(JSON.stringify(await boardVon(G.P, 'bx')))} toastA:${await toast(A.P)} toastG:${await toast(G.P)}`);
// Gleichzeitig an zwei Karten
await A.P.waitForTimeout(2600);
await inKarte(A.P, 'Von Anna'); await A.P.keyboard.press('End');
await inKarte(G.P, 'Von Gerd'); await G.P.keyboard.press('End');
await Promise.all([A.P.keyboard.type(' AAA-PARALLEL', { delay: 60 }), G.P.keyboard.type(' GGG-PARALLEL', { delay: 60 })]);
await warteBis(A.P, async () => /GGG-PARALLEL/.test(await texteVon(A.P)) && /AAA-PARALLEL/.test(await texteVon(G.P)), 8000);
pruefe('D16 an verschiedenen Karten schreiben beide gleichzeitig und lesen sich gegenseitig', /GGG-PARALLEL/.test(await texteVon(A.P)) && /AAA-PARALLEL/.test(await texteVon(G.P)));
pruefe('D17 dabei hält jeder seine Karte (je ein Rahmen drüben)', (await A.P.locator('[data-taste="live-sperre"]').count()) === 1 && (await G.P.locator('[data-taste="live-sperre"]').count()) === 1);
await heraus(A.P); await heraus(G.P);
await warteBis(A.P, async () => /AAA-PARALLEL/.test(bxServer()) && /GGG-PARALLEL/.test(bxServer()), 20000);
await warteBis(A.P, async () => /GGG-PARALLEL/.test(JSON.stringify(await boardVon(A.P, 'bx'))) && /AAA-PARALLEL/.test(JSON.stringify(await boardVon(G.P, 'bx'))), 20000);
pruefe('D18 beides liegt auf dem Server und in beiden Ständen', /AAA-PARALLEL/.test(bxServer()) && /GGG-PARALLEL/.test(bxServer()) && /GGG-PARALLEL/.test(JSON.stringify(await boardVon(A.P, 'bx'))) && /AAA-PARALLEL/.test(JSON.stringify(await boardVon(G.P, 'bx'))));

// ══ E ═══════════════════════════════════════════════════════════════
console.log('\n════ E: Der Kanal ist nur Anzeige — nichts Gefälschtes wird gespeichert ════');
await A.P.waitForTimeout(2600);
{
  const x1 = JSON.parse(bxServer()).nodes.find((n) => n.id === 'x1');
  const falsch = { ...x1, data: { ...x1.data, blocks: [{ type: 'paragraph', content: 'GEFAELSCHT' }] } };
  const meta = { id: 'boese', name: 'Mallory', farbe: '#000000', karte: 'x1', seit: Date.now() };
  // Nachricht von jemandem, der die Karte nicht hält → verworfen
  fakeSenden(topic, 'karte', { von: 'fremd', node: falsch });
  await G.P.waitForTimeout(600);
  pruefe('E1 eine Karten-Nachricht von jemandem, der die Karte nicht hält, wird verworfen', !/GEFAELSCHT/.test(await texteVon(G.P)) && !/GEFAELSCHT/.test(await texteVon(A.P)));
  fakeDa(topic, 'boese', meta);
  await G.P.waitForTimeout(400);
  fakeSenden(topic, 'karte', { von: 'boese', node: falsch });
  await warteBis(G.P, async () => /GEFAELSCHT/.test(await texteVon(G.P)), 4000);
  pruefe('E2 ein (gefälschter) Halter wird angezeigt — Rahmen und Text', (await sperre(G.P, 'x1').count()) === 1 && /Mallory/.test(await sperre(G.P, 'x1').textContent().catch(() => '')) && /GEFAELSCHT/.test(await texteVon(G.P)));
  // Gerd und Anna ändern etwas anderes → ihr Schreiben trägt das Gefälschte nicht
  pruefe('E3 Gerd legt währenddessen eine Karte an', await notizPlatz(G.P, 'Gerd zwei'));
  await warteBis(G.P, () => /Gerd zwei/.test(bxServer()), 12000);
  pruefe('E4 sein Schreiben trägt das Gefälschte NICHT auf den Server', /Gerd zwei/.test(bxServer()) && !/GEFAELSCHT/.test(bxServer()), bxServer().slice(0, 200));
  pruefe('E5 Anna legt eine Karte an', await notizPlatz(A.P, 'Anna zwei'));
  await warteBis(A.P, () => /Anna zwei/.test(bxServer()), 12000);
  pruefe('E6 auch Annas Schreiben (Konto) trägt es nicht', /Anna zwei/.test(bxServer()) && !/GEFAELSCHT/.test(bxServer()));
  fakeWeg(topic, 'boese', meta);
  await warteBis(G.P, async () => (await sperre(G.P, 'x1').count()) === 0, 4000);
  pruefe('E7 der gefälschte Halter geht → Rahmen weg', (await sperre(G.P, 'x1').count()) === 0);
  console.log('    … 21 s: das Mitlesen ohne gesicherten Stand läuft aus');
  await G.P.waitForTimeout(21500);
  pruefe('E8 ohne gesicherten Stand zeigt die Karte wieder den letzten gesicherten (bei beiden)', !/GEFAELSCHT/.test(await texteVon(G.P)) && !/GEFAELSCHT/.test(await texteVon(A.P)) && /UND-GERD/.test(await texteVon(G.P)), (await texteVon(G.P)).slice(0, 200));
  pruefe('E9 nirgends gespeichert: Server, Gerds Stand, Annas Stand', !/GEFAELSCHT/.test(bxServer()) && !/GEFAELSCHT/.test(JSON.stringify(await boardVon(G.P, 'bx'))) && !/GEFAELSCHT/.test(JSON.stringify(await boardVon(A.P, 'bx'))));
}

// ══ F ═══════════════════════════════════════════════════════════════
console.log('\n════ F: Rolle des Links — nur lesen und zurück ════');
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-rolle"]').selectOption('lesen');
await warteBis(A.P, () => sb.einladungen[0]?.rolle === 'lesen', 6000);
pruefe('F1 der Link steht auf „nur lesen" und bleibt „ohne Konto"', sb.einladungen[0]?.rolle === 'lesen' && sb.einladungen[0]?.ohne_konto === true);
await schliessen(A.P);
await warteBis(G.P, async () => (await band(G.P)) === 1, 12000);
pruefe('F2 Gerd bekommt das Band „Nur lesen"', (await band(G.P)) === 1 && (await boardVon(G.P, 'bx')).geteiltRolle === 'lesen');
{
  const n = (await boardVon(G.P, 'bx')).nodes.length;
  const ab = sb.aufrufe.gastSchreiben;
  await G.P.mouse.dblclick(1000, 700); await G.P.waitForTimeout(900);
  pruefe('F3 Doppelklick legt bei Gerd nichts an, nichts geht zum Server', (await boardVon(G.P, 'bx')).nodes.length === n && sb.aufrufe.gastSchreiben === ab);
}
await A.P.waitForTimeout(2600);
pruefe('F4 Anna legt eine Karte an', await notizPlatz(A.P, 'Anna drei'));
await warteBis(G.P, async () => /Anna drei/.test(await texteVon(G.P)), 16000);
pruefe('F5 Gerd liest sie live mit', /Anna drei/.test(await texteVon(G.P)));
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-rolle"]').selectOption('bearbeiten');
await warteBis(A.P, () => sb.einladungen[0]?.rolle === 'bearbeiten', 6000);
await schliessen(A.P);
await warteBis(G.P, async () => (await band(G.P)) === 0, 12000);
pruefe('F6 zurück auf „bearbeiten": Das Band verschwindet', (await band(G.P)) === 0 && !(await boardVon(G.P, 'bx')).geteiltRolle);

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ G: Neu laden — Gerd bleibt dabei ════');
await G.P.reload({ waitUntil: 'networkidle' }); await G.P.waitForTimeout(1500);
await warteBis(G.P, async () => /2 dabei/.test(await zahl(G.P)), 10000);
pruefe('G1 nach dem Neuladen wieder „2 dabei", mit Namen „Gerd"', /2 dabei/.test(await zahl(G.P)) && (await chipNamen(A.P)).includes('Gerd'), await zahl(G.P));
await A.P.waitForTimeout(2600);
pruefe('G2 Anna legt eine Karte an', await notizPlatz(A.P, 'Anna vier'));
await warteBis(G.P, async () => /Anna vier/.test(await texteVon(G.P)), 16000);
pruefe('G3 sie kommt bei Gerd an', /Anna vier/.test(await texteVon(G.P)));
await dialogOeffnen(G.P, 'Planung');
pruefe('G4 Board-Menü → „Gemeinsames Board …" erklärt die Einwahl per Link und bietet „Board verlassen"', (await G.P.locator('[data-taste="freigabe-per-link"]').count()) === 1 && /Board verlassen/.test(await G.P.locator('[data-taste="freigabe-verlassen"]').textContent().catch(() => '')));
await G.P.screenshot({ path: path.join(SD, 'm364-gast-dialog.png') });
await schliessen(G.P);

// ══ H ═══════════════════════════════════════════════════════════════
console.log('\n════ H: „Auch ohne Konto" aus — und wieder an ════');
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-ohne-konto"]').click();   // der Haken folgt der Antwort des Servers
await warteBis(A.P, () => sb.einladungen[0]?.ohne_konto === false, 6000);
await schliessen(A.P);
await warteBis(G.P, async () => !(await boardVon(G.P, 'bx'))?.gastLink, 12000);
pruefe('H1 Gerd ist draußen: Das Board bleibt als eigene Kopie, mit Hinweis', !(await boardVon(G.P, 'bx')).gastLink && !(await boardVon(G.P, 'bx')).geteiltVon && Object.keys(await gastEintrag(G.P)).length === 0);
pruefe('H2 die Leiste „wer ist dabei" ist bei Gerd weg', (await G.P.locator('[data-taste="live-leiste"]').count()) === 0);
{
  const ab = sb.aufrufe.gastSchreiben; const abl = sb.aufrufe.gastAbgelehnt;
  pruefe('H3 Gerd schreibt in seine Kopie', await notizPlatz(G.P, 'Nur bei Gerd'));
  await G.P.waitForTimeout(3000);
  pruefe('H4 davon geht nichts mehr zum Server', sb.aufrufe.gastSchreiben === ab && sb.aufrufe.gastAbgelehnt === abl && !/Nur bei Gerd/.test(bxServer()));
}
await dialogOeffnen(A.P, 'Planung');
await A.P.locator('[data-taste="einladung-ohne-konto"]').click();
await warteBis(A.P, () => sb.einladungen[0]?.ohne_konto === true, 6000);
await schliessen(A.P);
await G.P.goto(`http://localhost:${PORT}/#e=${token}`); await G.P.reload({ waitUntil: 'networkidle' }); await G.P.waitForTimeout(1500);
await warteBis(G.P, async () => (await boardVon(G.P, 'bx'))?.gastLink === token, 12000);
{
  const st = await zustand(G.P);
  const kopie = st.boards.find((b) => /Planung \(Kopie\)/.test(b.name));
  pruefe('H5 Link erneut geöffnet: wieder dabei — die Kopie von eben steht daneben', st.boards.find((b) => b.id === 'bx')?.gastLink === token && !!kopie && /Nur bei Gerd/.test(JSON.stringify(kopie)) && !/Nur bei Gerd/.test(JSON.stringify(st.boards.find((b) => b.id === 'bx'))), st.boards.map((b) => b.name).join(','));
  pruefe('H6 kein zweites Mal nach dem Namen gefragt', (await G.P.locator('[data-taste="gast-name"]').count()) === 0);
}

// ══ I ═══════════════════════════════════════════════════════════════
console.log('\n════ I: Bernd nimmt denselben Link MIT Konto an ════');
const B = await geraet('B', { ...standB, boards: [board('bq', 'Bernds Board', [note('q1', 'Q Notiz')])], spaces: [{ id: 's8', name: 'Privat', projects: [{ id: 'p8', name: 'Eigenes', boardIds: ['bq'] }] }], activeId: 'bq' });
await anmelden(B.P, 'bernd@example.de', 'geheim456', true);
const uidB = nutzerId('bernd@example.de');
await B.P.evaluate((t) => { location.hash = `#e=${t}`; }, token);
await warteBis(B.P, async () => !!(await boardVon(B.P, 'bx')), 16000);
{
  const b = await boardVon(B.P, 'bx');
  pruefe('I1 Bernd ist Gast mit Konto (Freigabe, kein Link-Token am Board)', b?.geteiltVon === uidA && !b?.gastLink && !!freigabeFuer(uidA, 'bx', uidB));
}
await warteBis(B.P, async () => (await zustand(B.P)).activeId === 'bx', 8000);
await warteBis(B.P, async () => /3 dabei/.test(await zahl(B.P)), 12000);
pruefe('I2 drei im selben Kanal: Bernd sieht „3 dabei"', /3 dabei/.test(await zahl(B.P)) && sb.live.filter((l) => l.topic === topic).length === 3, `${await zahl(B.P)} / ${sb.live.filter((l) => l.topic === topic).length}`);
pruefe('I3 Anna sieht Gerd und Bernd', (await chipNamen(A.P)).includes('Gerd') && (await chipNamen(A.P)).some((n) => /bernd/i.test(n)), JSON.stringify(await chipNamen(A.P)));
await inKarte(G.P, 'Von Gerd');
await warteBis(B.P, async () => (await B.P.locator('[data-taste="live-sperre"]').count()) === 1, 6000);
pruefe('I4 Gerd bearbeitet eine Karte → auch Bernd sieht den Rahmen „Gerd"', /Gerd/.test(await B.P.locator('[data-taste="live-sperre"]').first().textContent().catch(() => '')));
await B.P.screenshot({ path: path.join(SD, 'm364-drei.png') });
await heraus(G.P);
await inKarte(B.P, 'Anna vier'); await B.P.keyboard.press('End'); await B.P.keyboard.type(' BERND-WAR-DA', { delay: 40 });
await warteBis(G.P, async () => /BERND-WAR-DA/.test(await texteVon(G.P)), 6000);
pruefe('I5 Bernd (Konto) tippt → Gerd (ohne Konto) liest live mit', /BERND-WAR-DA/.test(await texteVon(G.P)));
await heraus(B.P);
await warteBis(G.P, async () => /BERND-WAR-DA/.test(bxServer()) && /BERND-WAR-DA/.test(JSON.stringify(await boardVon(G.P, 'bx'))), 20000);
pruefe('I6 Bernds Text liegt auf dem Server und in Gerds Stand', /BERND-WAR-DA/.test(bxServer()) && /BERND-WAR-DA/.test(JSON.stringify(await boardVon(G.P, 'bx'))));

// ══ J ═══════════════════════════════════════════════════════════════
console.log('\n════ J: Server ohne Gast-Funktionen ════');
sb.ohneGast = true;
const J = await geraet('J', standB, `#e=${token}`);
await warteBis(J.P, async () => /Melde dich mit E-Mail an/.test(await toast(J.P)), 8000);
pruefe('J1 der Link führt wie bisher zur Anmeldung (kein Fehler, kein halbes Board)', /Melde dich mit E-Mail an/.test(await toast(J.P)) && !(await boardVon(J.P, 'bx')), await toast(J.P));
sb.ohneGast = false;
await J.ctx.close();

// ══ K ═══════════════════════════════════════════════════════════════
console.log('\n════ K: Live-Kanal tot — der Abgleich läuft trotzdem ════');
sb.ohneLive = true;
const K = await geraet('K', standB, `#e=${token}`);
await warteBis(K.P, async () => !!(await boardVon(K.P, 'bx')), 12000);
if (await K.P.locator('[data-taste="gast-name"]').count()) { await K.P.locator('[data-taste="gast-name"]').fill('Karla'); await K.P.locator('[data-taste="gast-name-ok"]').click(); await K.P.waitForTimeout(400); }
pruefe('K1 eingewählt, die Leiste sagt „verbindet …"', !!(await boardVon(K.P, 'bx')) && /verbindet/.test(await zahl(K.P)), await zahl(K.P));
await A.P.waitForTimeout(2600);
pruefe('K2 Anna legt eine Karte an', await notizPlatz(A.P, 'Anna fuenf'));
await warteBis(K.P, async () => /Anna fuenf/.test(await texteVon(K.P)), 20000);
pruefe('K3 sie kommt ohne Kanal an (Blick alle paar Sekunden)', /Anna fuenf/.test(await texteVon(K.P)));
pruefe('K4 Karla legt eine Karte an', await notizPlatz(K.P, 'Von Karla'));
await warteBis(A.P, async () => /Von Karla/.test(await texteVon(A.P)), 30000);
pruefe('K5 sie kommt bei Anna an', /Von Karla/.test(await texteVon(A.P)));
sb.ohneLive = false;

// ══ L ═══════════════════════════════════════════════════════════════
console.log('\n════ L: Texte ════');
{
  const js = readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('L1 „Was ist neu" nennt M364', js.includes('(M364)'));
  const mig = path.join(__repo, 'supabase', 'migrations', '20261114100000_gast_ohne_konto.sql');
  const sql = existsSync(mig) ? readFileSync(mig, 'utf8') : '';
  pruefe('L2 die Migration liegt im Repository (Funktionen nur über das Token, Tabellen für anon gesperrt)', /gast_lesen/.test(sql) && /gast_schreiben/.test(sql) && /board_kanal/.test(sql) && /revoke all on table public\.board_kanaele from anon/.test(sql));
}

await A.ctx.close(); await G.ctx.close(); await B.ctx.close(); await K.ctx.close();
await browser.close();
app.close();
console.log(`\nm364-gruppenarbeit-ohne-konto: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
