/**
 * M497 — Protokoll: Beschlüsse gehören zu ihrem TOP.
 *
 *   A  Allein: „§ Beschluss" merkt sich den TOP, unter dem die Zeile stand (auch wenn der Beschluss kein Wort des TOPs
 *      nennt); die Zuordnung lässt sich in der Beschluss-Liste ändern und lösen; ein getippter Beschluss, der genau
 *      einen TOP nennt, gehört dazu; „nur Info" nimmt einen TOP aus der Übergabe; die Übergabe schlägt nur TOPs ohne
 *      zugeordneten Beschluss vor; die Übersicht nennt den TOP beim Beschluss; alles übersteht das Neuladen.
 *   P  Personen: ein abgelehnter Vorschlag („Mia zur Runde hinzufügen?" → ×) bleibt nach dem Neuladen weg; kommt Mia
 *      doch in die Runde, fällt sie aus der Liste (wieder aus der Runde genommen, fragt die Karte wieder).
 *   K  Kontraste der neuen Teile hell/dunkel (Schrift ≥ 4,5:1, Ränder ≥ 3:1).
 *   L  Live-Board (Anna und Gerd, zwei Kontexte, Yjs): Gerds „§ Beschluss" kommt mit TOP bei Anna an, Annas neue
 *      Zuordnung und ihr „nur Info" bei Gerd — und gespeichert auf dem Server.
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m487).
 */
// Läuft aus dem Repository: `node pruefungen/m497-beschluss-top.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';
import { kontrastScan, randScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5497;
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
const KERN_AUS = 'export async function sitzungOeffnen() { throw new Error("M497: Yjs-Teil abgeschaltet"); }';

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
          if (j.payload?.event === 'notiz-y') sb.aufrufe.notizY = (sb.aufrufe.notizY ?? 0) + 1;
          if (j.payload?.event === 'maus') sb.aufrufe.maus = (sb.aufrufe.maus ?? 0) + 1;
          // M391: Für die Drosselung zählen nur gemeldete STELLEN — das „weg" eines anderen, der gerade stillhält, ist keine
          if (j.payload?.event === 'maus' && !j.payload?.payload?.weg) sb.aufrufe.mausStelle = (sb.aufrufe.mausStelle ?? 0) + 1;
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

const geladen = new Map();   // Gerät → nachgeladene Dateien
async function geraet(name, stand, anker = '', port = PORT, ohneKern = false) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE' });
  await dienste(ctx);
  // M487: Rückweg — der Yjs-Kern lehnt ab (vor dem ersten Laden, sonst käme er aus dem Service Worker)
  if (ohneKern) await ctx.route(/\/assets\/notizGemeinsamKern-[^/]*\.js$/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: KERN_AUS }));
  await ctx.addInitScript(({ st, konfig }) => {
    if (window !== window.top) return;
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    if (konfig) localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: port === PORT ? { url: SB_URL, key: SB_KEY } : null });
  const P = await ctx.newPage();
  P.fehler = [];
  geladen.set(name, []);
  P.on('request', (r) => { if (/\/assets\//.test(r.url())) geladen.get(name).push(r.url()); });
  P.on('pageerror', (e) => { P.fehler.push(e.message); console.log(`    PAGEERROR[${name}]:`, e.message, String(e.stack).split('\n').slice(0, 4).join(' | ')); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${port}/${anker}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, name };
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
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
async function dialogOeffnen(P, name) {
  const z = P.locator('.tabs.spalte .side-board', { hasText: name }).first();
  await z.hover(); await P.waitForTimeout(200);
  await z.locator('.ebenen-menu-knopf').click(); await P.waitForTimeout(300);
  await P.locator('[data-taste="board-freigeben"]').click(); await P.waitForTimeout(600); await P.waitForSelector('[data-taste="einladung-optionen"], [data-taste="freigabe-ohne-konto"], [data-taste="freigabe-verlassen"]', { timeout: 2500 }).catch(() => {}); await P.evaluate(() => document.querySelectorAll('.freigabe-dialog details').forEach((d) => { d.open = true; }));
}
const zahl = (P) => P.locator('[data-taste="live-zahl"]').textContent().catch(() => '');

// ══ Allein (ohne Live-Kanal) ════════════════════════════════════════
const TAG = 86_400_000;
const iso = (n) => { const d = new Date(Date.now() + n * TAG); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fehlerAllein = [];
const warteFn = async (P, fn, arg, ms = 15000) => P.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);
const H = (text) => ({ type: 'heading', props: { level: 3 }, content: text });
const reihe = (zusatz = {}) => ({
  title: 'Lenkungskreis', color: 'white', carryOpen: true, entries: [
    { id: 'n1', date: iso(-1), attendees: 'Anna Berg, Gerd Huber', blocks: [
      { id: 'h1', ...H('TOP 1: Haushalt') },
      { id: 'q1', type: 'paragraph', content: 'Die Zahlen liegen vor.' },
      { id: 'h2', ...H('TOP 2: Sommerfest') },
      { id: 'q2', type: 'paragraph', content: 'Wir feiern am 12. Juli im Hof.' },
      { id: 'h3', ...H('TOP 3: Bericht der Leitung') },
      { id: 'q3', type: 'paragraph', content: 'Alles läuft nach Plan.' },
      { id: 'a1', type: 'checkListItem', props: { checked: false }, content: 'Mia: Raum buchen' },
      { id: 'q4', type: 'paragraph', content: '' },
    ], decisions: [], ...zusatz },
    { id: 'n0', date: iso(-8), attendees: 'Anna Berg', blocks: [{ id: 'c1', type: 'paragraph', content: 'Erste Runde.' }], decisions: [] },
  ],
});
const karteSolo = (id, d) => ({ id, type: 'minutes', position: { x: 40, y: 40 }, width: 560, height: 760, data: d });
async function seite({ dunkel = false, nodes }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: dunkel ? 'dark' : 'light' });
  await ctx.addInitScript(([nodes]) => {
    if (sessionStorage.getItem('m497-geladen')) return;
    sessionStorage.setItem('m497-geladen', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    const state = { boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], comments: [], nodes }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Einstieg', boardIds: ['b0'] }] }], activeId: 'b0', view: 'board' };
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state }));
  }, [nodes]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehlerAllein.push(e.message); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForSelector('.minutes-card .minutes-body', { timeout: 30000 });
  await P.waitForTimeout(600);
  return { ctx, P };
}
const sitzungVon = async (P, eid = 'n1') => P.evaluate((eid) => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'm').data.entries.find((e) => e.id === eid), eid);
const datenVon = async (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'm').data);
const warteGespeichert = async (P, fn, ms = 15000) => P.waitForFunction((fs) => {
  const d = JSON.parse(localStorage.getItem('pixinotes-board') || '{}')?.state?.boards?.[0]?.nodes?.find((x) => x.id === 'm')?.data;
  // eslint-disable-next-line no-new-func
  return d && new Function('d', `return (${fs})(d)`)(d);
}, fn.toString(), { timeout: ms, polling: 150 }).then(() => true, () => false);
const M = '.react-flow__node[data-id="m"]';
const waehle = async (P, id = 'm') => { await P.locator(`.react-flow__node[data-id="${id}"] .card-grip`).click({ force: true }); await P.waitForTimeout(300); };
/** Die Auswahl „TOP des Beschlusses" je Beschluss: Text und gewählter TOP */
const zuordnungen = (P, sel = M) => P.locator(`${sel} .minutes-decision`).evaluateAll((ds) => ds.map((d) => ({
  text: d.querySelector('.pr-beschluss-text')?.value, top: d.querySelector('.pr-beschluss-top')?.selectedOptions?.[0]?.textContent ?? null,
})));
const ohneBeschluss = (P, sel = M) => P.locator(`${sel} .pr-top-offen`).evaluateAll((xs) => xs.map((x) => ({ text: x.querySelector('span').textContent, info: x.querySelector('.pr-info-knopf').getAttribute('aria-pressed') === 'true' })));
const inZeile = async (P, sel, text) => {
  await P.locator(`${sel} .minutes-body [data-content-type="paragraph"]`, { hasText: text }).first().click();
  await P.keyboard.press('End');
  await P.waitForTimeout(150);
};

console.log('════ A: Beschlüsse gehören zu ihrem TOP (allein) ════');
{
  const { ctx, P } = await seite({ nodes: [karteSolo('m', reihe())] });
  await waehle(P);
  // A1 — „§ Beschluss" in einer Zeile unter TOP 2, die kein Wort des TOPs nennt (die Wortregel ginge leer aus)
  await inZeile(P, M, 'Wir feiern am 12. Juli');
  await P.locator(`${M} [data-taste="pr-beschluss"]`).click();
  const a1 = await warteGespeichert(P, (d) => {
    const e = d.entries.find((x) => x.id === 'n1');
    return e.decisions?.length === 1 && e.decisions[0].topText === 'TOP 2: Sommerfest' && !!e.decisions[0].top && !JSON.stringify(e.blocks).includes('Wir feiern');
  });
  const z1 = await zuordnungen(P);
  pruefe('A1 „§ Beschluss" merkt sich den TOP, unter dem die Zeile stand – gespeichert und in der Liste gewählt', a1 && z1.length === 1 && z1[0].top === 'TOP 2: Sommerfest' && /Wir feiern/.test(z1[0].text),
    JSON.stringify({ z1, d: (await sitzungVon(P)).decisions }));
  // A2 — Zuordnung ändern und zurück
  await P.locator(`${M} .minutes-decision .pr-beschluss-top`).first().selectOption({ label: 'TOP 1: Haushalt' });
  const a2a = await warteGespeichert(P, (d) => d.entries.find((x) => x.id === 'n1').decisions[0].topText === 'TOP 1: Haushalt');
  const z2 = await zuordnungen(P);
  await P.locator(`${M} .minutes-decision .pr-beschluss-top`).first().selectOption({ label: 'TOP 2: Sommerfest' });
  const a2b = await warteGespeichert(P, (d) => d.entries.find((x) => x.id === 'n1').decisions[0].topText === 'TOP 2: Sommerfest');
  pruefe('A2 die Zuordnung lässt sich in der Beschluss-Liste ändern (und zurück); der Text bleibt', a2a && a2b && z2[0].top === 'TOP 1: Haushalt' && /Wir feiern/.test(z2[0].text), JSON.stringify(z2));
  // A3 — getippter Beschluss: nennt genau einen TOP → gehört dazu; „ohne TOP" löst ihn
  await P.locator(`${M} .minutes-decision-add`).click();
  await P.keyboard.insertText('Der Haushalt wird im Januar beraten');
  await P.keyboard.press('Enter');
  const a3a = await warteGespeichert(P, (d) => d.entries.find((x) => x.id === 'n1').decisions[1]?.topText === 'TOP 1: Haushalt');
  await P.locator(`${M} .minutes-decision .pr-beschluss-top`).nth(1).selectOption({ label: 'ohne TOP' });
  const a3b = await warteGespeichert(P, (d) => { const b = d.entries.find((x) => x.id === 'n1').decisions[1]; return b?.top === '' && b.topText === undefined; });
  pruefe('A3 ein getippter Beschluss, der einen TOP nennt, gehört dazu; „ohne TOP" löst ihn (bewusst, ohne Wortregel)', a3a && a3b, JSON.stringify((await sitzungVon(P)).decisions));
  // A4 — „nur Info"
  const ob = await ohneBeschluss(P);
  pruefe('A4 unter den Beschlüssen stehen die TOPs ohne Beschluss (TOP 1 – gelöst – und TOP 3, nicht TOP 2)', ob.map((x) => x.text).join('|') === 'TOP 1: Haushalt|TOP 3: Bericht der Leitung' && ob.every((x) => !x.info), JSON.stringify(ob));
  await P.locator(`${M} .pr-top-offen`, { hasText: 'TOP 3' }).locator('.pr-info-knopf').click();
  const a5 = await warteGespeichert(P, (d) => (d.entries.find((x) => x.id === 'n1').infoTops ?? []).length === 1);
  const ob2 = await ohneBeschluss(P);
  pruefe('A5 „nur Info" markiert TOP 3 (gespeichert, Knopf gedrückt)', a5 && ob2.find((x) => /TOP 3/.test(x.text))?.info === true, JSON.stringify({ ob2, info: (await sitzungVon(P)).infoTops }));
  await P.locator(M).screenshot({ path: `${SD}/m497-a-beschluesse.png` });
  // Neuladen: alles bleibt
  await P.waitForTimeout(800);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector(`${M} .minutes-body`, { timeout: 30000 });
  await waehle(P);
  const nachLaden = { z: await zuordnungen(P), ob: await ohneBeschluss(P) };
  pruefe('A6 nach dem Neuladen: Zuordnungen und „nur Info" stehen noch', nachLaden.z[0]?.top === 'TOP 2: Sommerfest' && nachLaden.z[1]?.top === 'ohne TOP' && nachLaden.ob.find((x) => /TOP 3/.test(x.text))?.info === true, JSON.stringify(nachLaden));
  // A7 — Übergabe: nur TOP 1 (TOP 2 hat einen Beschluss, TOP 3 ist nur Info)
  await P.locator(`${M} [data-taste="pr-neu"]`).click();
  await P.waitForSelector(`${M} .pr-uebergabe`, { timeout: 10000 });
  const punkte = await P.locator(`${M} .pr-uebergabe-punkt`).evaluateAll((ls) => ls.map((l) => ({ art: l.querySelector('.pr-art').textContent, text: l.querySelector('.pr-uebergabe-text').textContent })));
  const tops = punkte.filter((p) => /TOP/.test(p.art)).map((p) => p.text);
  pruefe('A7 die Übergabe schlägt nur den TOP ohne zugeordneten Beschluss vor – nicht den mit Beschluss, nicht den Info-TOP', tops.join('|') === 'TOP 1: Haushalt' && punkte.some((p) => /Raum buchen/.test(p.text)), JSON.stringify(punkte));
  await P.locator(`${M} .pr-uebergabe .pr-knopf`, { hasText: 'Abbrechen' }).click();
  // A8 — „nur Info" zurücknehmen: TOP 3 kommt wieder in die Übergabe
  await P.locator(`${M} .pr-top-offen`, { hasText: 'TOP 3' }).locator('.pr-info-knopf').click();
  const zurueck = await warteGespeichert(P, (d) => !(d.entries.find((x) => x.id === 'n1').infoTops ?? []).length);
  await P.locator(`${M} [data-taste="pr-neu"]`).click();
  await P.waitForSelector(`${M} .pr-uebergabe`, { timeout: 10000 });
  const tops2 = await P.locator(`${M} .pr-uebergabe-punkt`).evaluateAll((ls) => ls.filter((l) => /TOP/.test(l.querySelector('.pr-art').textContent)).map((l) => l.querySelector('.pr-uebergabe-text').textContent));
  pruefe('A8 „nur Info" lässt sich zurücknehmen – der TOP kommt wieder in die Übergabe', zurueck && tops2.join('|') === 'TOP 1: Haushalt|TOP 3: Bericht der Leitung', JSON.stringify(tops2));
  await P.locator(`${M} .pr-uebergabe .pr-knopf`, { hasText: 'Abbrechen' }).click();
  // A9 — Übersicht nennt den TOP beim Beschluss
  await P.locator(`${M} [data-taste="pr-uebersicht"]`).click();
  const lage = await P.locator(`${M} .pr-beschluss`).evaluateAll((xs) => xs.map((x) => ({ text: x.querySelector('span')?.textContent, top: x.querySelector('.pr-beschluss-zu')?.textContent ?? null })));
  pruefe('A9 die Übersicht nennt beim Beschluss seinen TOP (gelöste ohne)', lage.find((x) => /Wir feiern/.test(x.text))?.top === 'TOP 2: Sommerfest' && lage.find((x) => /Januar/.test(x.text))?.top === null, JSON.stringify(lage));
  await P.locator(`${M} [data-taste="pr-sitzung"]`).click();
  // A10 — Ruhe (M421): ohne Fokus ist die Liste „ohne Beschluss" ausgeblendet, eine gesetzte Zuordnung bleibt sichtbar
  await P.mouse.click(1300, 860);
  await P.mouse.move(1350, 880);
  await P.waitForTimeout(600);
  const ruhe = await P.evaluate((M) => ({
    stand: getComputedStyle(document.querySelector(`${M} .pr-top-stand`)).opacity,
    gesetzt: getComputedStyle(document.querySelector(`${M} .pr-beschluss-top:not(.leer)`)).opacity,
    leer: getComputedStyle(document.querySelector(`${M} .pr-beschluss-top.leer`)).opacity,
  }), M);
  pruefe('A10 in Ruhe: „Ohne Beschluss" und leere Auswahl ausgeblendet, der gewählte TOP bleibt sichtbar', ruhe.stand === '0' && ruhe.leer === '0' && ruhe.gesetzt === '1', JSON.stringify(ruhe));
  await ctx.close();
}

console.log('════ P: abgelehnte Personen-Vorschläge merkt sich die Reihe ════');
{
  const { ctx, P } = await seite({ nodes: [karteSolo('m', reihe())] });
  await waehle(P);
  const vorher = await P.locator(`${M} .pr-vorschlag-text`).allTextContents();
  await P.locator(`${M} .pr-vorschlag-nein`).click();
  const gemerkt = await warteGespeichert(P, (d) => (d.personenAbgelehnt ?? []).includes('mia'));
  pruefe('P1 „Mia zur Runde hinzufügen?" → × merkt sich die Reihe', vorher.join('|') === 'Mia zur Runde hinzufügen?' && gemerkt, JSON.stringify({ vorher, d: (await datenVon(P)).personenAbgelehnt }));
  await P.waitForTimeout(600);
  await P.reload({ waitUntil: 'networkidle' });
  await P.waitForSelector(`${M} .pr-runde`, { timeout: 30000 });
  await waehle(P);
  await P.waitForTimeout(500);
  pruefe('P2 nach dem Neuladen bleibt der Vorschlag weg', (await P.locator(`${M} .pr-vorschlag`).count()) === 0);
  await P.locator(`${M} .pr-person-neu`).click();
  await P.keyboard.insertText('Mia');
  await P.keyboard.press('Enter');
  const inRunde = await warteGespeichert(P, (d) => /Mia/.test(d.entries.find((x) => x.id === 'n1').attendees) && !(d.personenAbgelehnt ?? []).length);
  pruefe('P3 kommt Mia doch in die Runde, fällt sie aus den abgelehnten', inRunde, JSON.stringify((await datenVon(P)).personenAbgelehnt));
  await P.locator(`${M} .pr-person-weg[aria-label="Mia entfernen"]`).click();
  const wieder = await warteFn(P, (M) => [...document.querySelectorAll(`${M} .pr-vorschlag-text`)].some((x) => x.textContent === 'Mia zur Runde hinzufügen?'), M);
  pruefe('P4 wieder aus der Runde genommen, fragt die Karte wieder', wieder);
  await ctx.close();
}

console.log('════ K: Kontraste der neuen Teile ════');
for (const dunkel of [false, true]) {
  const name = dunkel ? 'dunkel' : 'hell';
  for (const farbe of ['white', 'yellow']) {
    const d = reihe({ decisions: [{ id: 'd1', text: 'Wir feiern im Hof.', top: 'h2', topText: 'TOP 2: Sommerfest' }, { id: 'd2', text: 'Ohne Zuordnung.', top: '' }], infoTops: ['h3'] });
    d.color = farbe;
    const { ctx, P } = await seite({ dunkel, nodes: [karteSolo('m', d)] });
    await waehle(P);
    const s = await kontrastScan(P, `${M} .minutes-decisions`);
    const r = (await randScan(P, `${M} .minutes-decisions`)).filter((x) => !/minutes-decision-add|pr-beschluss-text/.test(`${x.klasse ?? ''} ${x.pfad ?? ''}`));
    pruefe(`K ${name}/${farbe}: Beschlüsse mit TOP-Auswahl und „nur Info" lesbar (Schrift ≥ 4,5:1, Ränder ≥ 3:1)`, s.length === 0 && r.length === 0, [...s, ...r].slice(0, 5).map(trefferZeile).join('\n'));
    if (farbe === 'white') await P.locator(`${M} .minutes-decisions`).screenshot({ path: `${SD}/m497-k-${name}.png` });
    await ctx.close();
  }
}
pruefe('Z1 allein: keine Seitenfehler', fehlerAllein.length === 0, JSON.stringify(fehlerAllein.slice(0, 3)));

// ══ L: Live-Board ═══════════════════════════════════════════════════
console.log('\n════ L: Live-Board – Zuordnung kommt beim anderen an ════');
const protokoll = (id, x, y) => ({ id, type: 'minutes', width: 520, height: 640, position: { x, y }, data: {
  title: 'Jour fixe', current: 'e1', entries: [{ id: 'e1', date: '2026-11-23', blocks: [
    { id: 'l1', ...H('TOP 1: Haushalt') },
    { id: 'l2', type: 'paragraph', content: 'Zahlen liegen vor' },
    { id: 'l3', ...H('TOP 2: Sommerfest') },
    { id: 'l4', type: 'paragraph', content: 'Wir feiern im Juli' },
  ], decisions: [] }],
} });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const standA = {
  boards: [board('bx', 'Besprechung', [protokoll('p1', 40, 60)])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1x', name: 'Allgemein', boardIds: ['bx'] }] }],
  activeId: 'bx', view: 'board',
};
const standB = {
  boards: [board('bz', 'Nur hier', [])],
  spaces: [{ id: 's9', name: 'Privat', projects: [{ id: 'p9', name: 'Eigenes', boardIds: ['bz'] }] }],
  activeId: 'bz', view: 'board',
};
const K = '.react-flow__node[data-id="p1"]';
const protokollGemeinsam = (P) => P.locator(`${K} .protokoll-wahl.note-gemeinsam`).count();
const serverBoard = () => { try { return JSON.parse(zeileText(uidA, 'board-bx.json')); } catch { return null; } };
const serverSitzung = () => serverBoard()?.nodes.find((n) => n.id === 'p1')?.data.entries?.find((e) => e.id === 'e1');

const A = await geraet('A', standA);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
const uidA = nutzerId('anna@example.de');
await warteBis(A.P, () => !!zeile(uidA, 'umgebung.json'), 8000);
await dialogOeffnen(A.P, 'Besprechung');
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
await warteBis(A.P, async () => /2 dabei/.test(await zahl(A.P)), 8000);
await warteBis(A.P, async () => (await protokollGemeinsam(A.P)) === 1 && (await protokollGemeinsam(G.P)) === 1, 15000);
pruefe('L1 zwei im Live-Board, das Protokoll läuft bei beiden gemeinsam', /2 dabei/.test(await zahl(A.P)) && (await protokollGemeinsam(A.P)) === 1 && (await protokollGemeinsam(G.P)) === 1);

// L2 — Gerd macht seine Zeile unter TOP 2 zum Beschluss
await inZeile(G.P, K, 'Wir feiern im Juli');
await G.P.locator(`${K} [data-taste="pr-beschluss"]`).click();
const beiBeiden = (soll) => async () => {
  const [a, g] = [await zuordnungen(A.P, K), await zuordnungen(G.P, K)];
  return a.length === 1 && g.length === 1 && a[0].top === soll && g[0].top === soll;
};
await warteBis(A.P, beiBeiden('TOP 2: Sommerfest'), 15000);
pruefe('L2 Gerds „§ Beschluss" kommt bei Anna mit seinem TOP an', await beiBeiden('TOP 2: Sommerfest')(), JSON.stringify([await zuordnungen(A.P, K), await zuordnungen(G.P, K)]));
await warteBis(A.P, () => serverSitzung()?.decisions?.[0]?.topText === 'TOP 2: Sommerfest', 15000);
pruefe('L3 … und auf dem Server: Beschluss mit TOP, Zeile nicht mehr im Text', serverSitzung()?.decisions?.[0]?.topText === 'TOP 2: Sommerfest' && !JSON.stringify(serverSitzung()?.blocks).includes('Wir feiern'),
  JSON.stringify(serverSitzung()?.decisions));
// L4 — Anna ordnet um
await A.P.locator(`${K} .minutes-decision .pr-beschluss-top`).first().selectOption({ label: 'TOP 1: Haushalt' });
await warteBis(G.P, beiBeiden('TOP 1: Haushalt'), 15000);
pruefe('L4 Annas neue Zuordnung kommt bei Gerd an', await beiBeiden('TOP 1: Haushalt')(), JSON.stringify(await zuordnungen(G.P, K)));
// L5 — Anna: TOP 2 ist jetzt ohne Beschluss → „nur Info"
await warteBis(A.P, async () => (await ohneBeschluss(A.P, K)).some((x) => /TOP 2/.test(x.text)), 8000);
await A.P.locator(`${K} .pr-top-offen`, { hasText: 'TOP 2' }).locator('.pr-info-knopf').click();
const infoBeiGerd = async () => (await ohneBeschluss(G.P, K)).find((x) => /TOP 2/.test(x.text))?.info === true;
await warteBis(G.P, infoBeiGerd, 15000);
pruefe('L5 Annas „nur Info" kommt bei Gerd an', await infoBeiGerd(), JSON.stringify(await ohneBeschluss(G.P, K)));
await warteBis(A.P, () => serverSitzung()?.decisions?.[0]?.topText === 'TOP 1: Haushalt' && (serverSitzung()?.infoTops ?? []).length === 1, 15000);
pruefe('L6 auf dem Server: neue Zuordnung und „nur Info" gespeichert', serverSitzung()?.decisions?.[0]?.topText === 'TOP 1: Haushalt' && (serverSitzung()?.infoTops ?? []).length === 1,
  JSON.stringify({ d: serverSitzung()?.decisions, i: serverSitzung()?.infoTops }));
await warteBis(G.P, async () => { const e = (await boardVon(G.P, 'bx'))?.nodes.find((n) => n.id === 'p1')?.data.entries?.[0]; return e?.decisions?.[0]?.topText === 'TOP 1: Haushalt' && (e?.infoTops ?? []).length === 1; }, 15000);
const beiG = (await boardVon(G.P, 'bx'))?.nodes.find((n) => n.id === 'p1')?.data.entries?.[0];
pruefe('L7 … und in Gerds Speicher', beiG?.decisions?.[0]?.topText === 'TOP 1: Haushalt' && (beiG?.infoTops ?? []).length === 1, JSON.stringify({ d: beiG?.decisions, i: beiG?.infoTops }));
await A.P.screenshot({ path: `${SD}/m497-l-live.png` });
pruefe('Z2 live: keine Seitenfehler', A.P.fehler.length === 0 && G.P.fehler.length === 0, JSON.stringify([...A.P.fehler, ...G.P.fehler].slice(0, 3)));
void KERN_AUS;

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad ? 1 : 0);
