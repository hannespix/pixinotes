/**
 * M529 — Konto-Abgleich und Speicher.
 *
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m524): Tabelle konto_dateien, konto_schreiben, board_aendern
 * — wahlweise MIT der Migration 20261125100000 (Vorbedingung p_wenn_umgebung/p_wenn_version, Antwort `geprueft`) oder
 * OHNE (unbekannte Parameter → 404 wie PostgREST) —, Dateispeicher samt Verzeichnis (object/list) und Auskunft
 * (object/info), fehlende Objekte → 400 wie Supabase, Realtime.
 *
 *   V  Vorbedingung: Ändert ein anderes Gerät dieselbe Karte, während das eigene Schreiben unterwegs ist, schreibt der
 *      Server nichts; das Gerät führt je Feld zusammen (Lage von hier, Text von dort). Ohne Migration wie bisher.
 *   F  Fehlende Dateien (Befund beim Besitzer: HTTP 400 auf datei-…): Ein Gerät ohne die Datei fragt nicht bei jedem
 *      Abgleich wieder und sagt es an der Karte; das Gerät, das sie hat, lädt sie nach; Inhalte, die nach ihren Karten
 *      kommen, gehen ohne weitere Änderung hinaus.
 *   Z  Speicherstand eines Tools reist mit dem Konto (nur bei Änderung, nicht je Tick).
 *   A  „Speicher aufräumen": zeigt nur Verwaistes (älter als 24 h), löscht erst nach Bestätigung.
 *   B  Der Ring der Server-Stände schreibt unveränderte Boards nicht neu.
 *   O  M522 O1 (kein leeres Startboard nach „ersetzen") und O2 (Rettungskopie eines unlesbaren Stands).
 *
 * Aufruf: `node pruefungen/m529-konto-speicher.mjs [Abschnitt …]`. `PN_DIST=<alter Build>` zeigt den Stand davor (rot).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const QUELLE = process.env.PN_QUELLE ?? __repo;
const PORT = 5529;
const NUR = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());
const will = (abschnitt) => NUR.length === 0 || NUR.includes(abschnitt);
const LAUT = process.argv.includes('--laut');
const SAAT = 529;
/** Bildschirmfotos für den Bericht (nur von Hand): M529_BILDER=<Ordner> */
const BILDER = process.env.M529_BILDER ?? '';

// Labor für O1 (Speicher + Sicherung im Browser, wie m522)
const tmp = mkdtempSync(path.join(tmpdir(), 'm529-'));
const q = (p) => JSON.stringify(path.join(QUELLE, p));
writeFileSync(path.join(tmp, 'labor.ts'), `
import * as store from ${q('src/store')};
import * as sicherung from ${q('src/lib/sicherung')};
(window as unknown as Record<string, unknown>).__pn = { ...store, sicherung };
`);
execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(tmp, 'labor.ts'), '--bundle', '--format=iife', '--platform=browser', `--outfile=${path.join(tmp, 'labor.js')}`, '--log-level=error',
  '--define:import.meta.env.VITE_SUPABASE_URL=""', '--define:import.meta.env.VITE_SUPABASE_ANON_KEY=""', '--define:import.meta.env.DEV=false', '--define:import.meta.env.BASE_URL="/"']);

const app = http.createServer((qq, r) => {
  const pfad = qq.url.split('?')[0];
  if (pfad === '/__labor') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<!doctype html><meta charset="utf-8"><title>Labor</title><body><script src="/__labor.js"></script></body>'); return; }
  if (pfad === '/__labor.js') { r.writeHead(200, { 'Content-Type': 'text/javascript' }); r.end(readFileSync(path.join(tmp, 'labor.js'))); return; }
  let f = join(DIST, pfad === '/' ? 'index.html' : pfad.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 1500) : JSON.stringify(info).slice(0, 1500)}`); }
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const zeit = () => ((Date.now() - T0) / 1000).toFixed(2).padStart(7);

// ---------- Nachgebautes Supabase (ein Konto, mehrere Geräte) ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = { nutzer: new Map(), tokens: new Map(), refresh: new Map(), zeilen: new Map(), sockets: [], objekte: new Map(), n: 0, migration: true };
/** Protokoll aller Anfragen: { t, geraet, art, info, status } */
const protokoll = [];
const log = (geraet, art, info = '', status = 200) => {
  protokoll.push({ t: Date.now() - T0, geraet, art, info, status });
  if (LAUT) console.log(`    ${zeit()} ${geraet.padEnd(2)} ${art.padEnd(9)} ${status} ${info}`);
};
/**
 * Die Steuerung. `verzug(geraet, art)` → { vor, nach } in ms: „vor" verzögert die Anfrage, bevor der Server sie
 * ausführt, „nach" die Antwort, nachdem er sie ausgeführt hat (die Antwort auf ein Schreiben trifft spät ein).
 * `fehler(geraet, art)` → null | 'weg' (Antwort geht verloren, der Server hat ausgeführt) | 'vorweg' (Anfrage kommt
 * nie an) | Statuszahl. `stumm` = Geräte, die gerade keine Realtime-Nachrichten bekommen (Schlaf, Funkloch).
 */
const steuer = { verzug: () => ({ vor: 0, nach: 0 }), fehler: () => null, stumm: new Set(), offline: new Set(), rtVerzug: () => 0 };
const steuerZurueck = () => { steuer.verzug = () => ({ vor: 0, nach: 0 }); steuer.fehler = () => null; steuer.stumm = new Set(); steuer.offline = new Set(); steuer.rtVerzug = () => 0; };

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
/** wie jsonb: Schlüssel nach Länge, dann nach Zeichen — der echte Server legt die Umgebung so ab */
const sortiert = (x) => Array.isArray(x) ? x.map(sortiert) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort((p, q) => p.length - q.length || (p < q ? -1 : 1)).map((k) => [k, sortiert(x[k])])) : x;
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (u, bis) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: u.id, email: u.email, exp: Math.floor(bis / 1000) }))}.sig${++sb.n}`;
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
const melden = (uid, name, type) => {
  for (const s of sb.sockets) {
    if (!s.uid || s.uid !== uid) continue;
    if (!(s.filter ?? []).some((f) => f.table === 'konto_dateien' && f.filter === `user_id=eq.${uid}`)) continue;
    if (steuer.stumm.has(s.geraet) || steuer.offline.has(s.geraet)) continue;
    const nachricht = JSON.stringify({ topic: 'realtime:konto', event: 'postgres_changes', payload: { ids: [1], data: { type, schema: 'public', table: 'konto_dateien', record: { name, user_id: uid }, old_record: { name, user_id: uid } } }, ref: null });
    const ms = steuer.rtVerzug(s.geraet);
    const senden = () => { try { s.ws.send(nachricht); } catch { /* zu */ } };
    if (ms > 0) setTimeout(senden, ms); else senden();
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
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function dienste(ctx, geraet) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) }).catch(() => {});
  /** Anfrage unter der Steuerung ausführen: `tun()` führt aus und liefert [status, körper] */
  const gesteuert = async (route, art, info, tun) => {
    if (steuer.offline.has(geraet)) { log(geraet, art, `${info} (offline)`, 0); return route.abort('internetdisconnected').catch(() => {}); }
    const f = steuer.fehler(geraet, art, info);
    const v = steuer.verzug(geraet, art, info) ?? { vor: 0, nach: 0 };
    if (f === 'vorweg') { log(geraet, art, `${info} (kam nie an)`, 0); if (v.vor) await warte(v.vor); return route.abort('failed').catch(() => {}); }
    if (typeof f === 'number') { log(geraet, art, `${info} (Fehler)`, f); if (v.vor) await warte(v.vor); return json(route, f, { message: 'kaputt' }); }
    if (v.vor) await warte(v.vor);
    const [status, obj, text] = tun();
    log(geraet, art, `${info}${text ? ` → ${text}` : ''}${f === 'weg' ? ' (Antwort verloren)' : ''}${v.nach ? ` (Antwort +${v.nach} ms)` : ''}`, status);
    if (v.nach) await warte(v.nach);
    if (f === 'weg') return route.abort('failed').catch(() => {});
    return json(route, status, obj);
  };
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method();
    const pfad = decodeURIComponent(url.pathname);
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
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
        if (steuer.offline.has(geraet)) return route.abort('internetdisconnected').catch(() => {});
        const uid = sb.refresh.get(body().refresh_token);
        log(geraet, 'token', 'erneuern', uid ? 200 : 400);
        if (!uid) return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        return json(route, 200, sitzungFuer(nutzerVon(uid)));
      }
    }
    if (pfad === '/auth/v1/user' && m === 'GET') { const uid = uidAus(req); return uid ? json(route, 200, { id: uid, email: nutzerVon(uid)?.email }) : json(route, 401, {}); }
    if (pfad === '/auth/v1/logout') return route.fulfill({ status: 204, body: '' });
    const uid = uidAus(req);
    if (!uid) { log(geraet, 'auth', pfad, 401); return json(route, 401, { message: 'JWT expired' }); }
    // ---- Dateispeicher ----
    let t = /^\/storage\/v1\/object\/(?:authenticated\/)?pixinotes\/(.+)$/.exec(pfad);
    if (t) {
      const schluessel = t[1];
      if (m === 'POST' || m === 'PUT') {
        const inhalt = req.postDataBuffer() ?? Buffer.alloc(0);
        return gesteuert(route, 'datei-auf', `${schluessel} ${inhalt.length} B`, () => { sb.objekte.set(schluessel, { body: inhalt, mime: req.headers()['content-type'] ?? 'application/octet-stream', am: Date.now() }); return [200, { Key: `pixinotes/${schluessel}` }]; });
      }
      if (m === 'GET') {
        if (steuer.offline.has(geraet)) return route.abort('internetdisconnected').catch(() => {});
        const o = sb.objekte.get(schluessel);
        log(geraet, 'datei-ab', `${schluessel} ${o ? o.body.length : '–'} B`, o ? 200 : 400);
        return o ? route.fulfill({ status: 200, contentType: o.mime, headers: cors, body: o.body }) : json(route, 400, { error: 'not found' });
      }
      if (m === 'DELETE') { sb.objekte.delete(schluessel); log(geraet, 'datei-weg', schluessel); return json(route, 200, {}); }
    }
    if (pfad === '/storage/v1/object/list/pixinotes' && m === 'POST') {
      const pre = `${String(body().prefix ?? '').replace(/\/$/, '')}/`;
      if (!pre.startsWith(`${uid}/`)) return json(route, 200, []);
      const liste = [...sb.objekte.entries()].filter(([k]) => k.startsWith(pre)).map(([k, o]) => ({ name: k.slice(pre.length), id: `o-${k}`, updated_at: new Date(o.am ?? Date.now()).toISOString(), created_at: new Date(o.am ?? Date.now()).toISOString(), metadata: { size: o.body.length } }));
      log(geraet, 'sp-liste', `${liste.length} Objekte`);
      return json(route, 200, liste);
    }
    t = /^\/storage\/v1\/object\/info\/authenticated\/pixinotes\/(.+)$/.exec(pfad);
    if (t && m === 'GET') {
      const o = sb.objekte.get(t[1]);
      log(geraet, 'sp-info', t[1], o ? 200 : 400);
      return o ? json(route, 200, { name: t[1], size: o.body.length }) : json(route, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    }
    if (pfad.startsWith('/storage/v1/')) return json(route, 200, []);
    // ---- RPCs ----
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      const b = body();
      const namen = (b.p_dateien ?? []).map((d) => `${d.name}(${String(d.inhalt ?? '').length})`).join(',');
      return gesteuert(route, 'stapel', `wenn=${b.p_wenn_version} [${namen}]`, () => {
        const alt = zeile(uid, 'umgebung.json');
        const wenn = b.p_wenn_version;
        if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) return [400, { code: 'P0001', message: 'vorbedingung' }, `VORBEDINGUNG (Server ${alt?.version})`];
        for (const d of b.p_dateien ?? []) schreib(uid, d.name, d.inhalt ?? '', d.mime ?? 'application/json', d.groesse ?? 0);
        const u = schreib(uid, 'umgebung.json', b.p_umgebung, 'application/json', String(b.p_umgebung ?? '').length);
        return [200, u.version, `Umgebung v${u.version}`];
      });
    }
    if (pfad === '/rest/v1/rpc/board_aendern' && m === 'POST') {
      const b = body();
      const mitWenn = 'p_wenn_umgebung' in b || 'p_wenn_version' in b;
      log(geraet, 'patch-an', `${b.p_board_id} wenn_umgebung=${b.p_wenn_umgebung ?? '–'} wenn_version=${b.p_wenn_version ?? '–'}`);
      // Ohne Migration kennt PostgREST die Funktion mit diesen Parametern nicht
      if (mitWenn && !sb.migration) { log(geraet, 'patch', 'unbekannte Parameter (PGRST202)', 404); return json(route, 404, { code: 'PGRST202', message: 'Could not find the function public.board_aendern' }); }
      const p = b.p_patch ?? {};
      // je gesetzter Karte: Art und WELCHE Felder sich gegenüber dem Stand des Servers ändern (nur Feldnamen, keine Inhalte)
      const vorher = (() => { try { return new Map(JSON.parse(zeileText(uid, `board-${b.p_board_id}.json`)).nodes.map((n) => [n.id, n])); } catch { return new Map(); } })();
      const anders = (x, y, pfad = '') => {
        if (JSON.stringify(x) === JSON.stringify(y)) return [];
        if (!x || !y || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) || Array.isArray(y)) return [pfad || '.'];
        return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => anders(x[k], y[k], pfad ? `${pfad}.${k}` : k));
      };
      const karte = (o) => `${o.id}[${o.type ?? '?'}${vorher.has(o.id) ? `: ${anders(vorher.get(o.id), o).slice(0, 8).join(',')}` : ': NEU'}]`;
      const kurz = ['nodes', 'edges', 'drawings', 'comments'].filter((a) => p[a]).map((a) => `${a}:${(p[a].set ?? []).map((o) => (a === 'nodes' ? karte(o) : o.id)).join('+')}${(p[a].del ?? []).length ? ` −${p[a].del.join('−')}` : ''}`).join(' ');
      return gesteuert(route, 'patch', `${b.p_board_id} ${kurz}`, () => {
        const name = `board-${b.p_board_id}.json`;
        const z = zeile(b.p_besitzer, name);
        if (b.p_besitzer !== uid) return [400, { code: 'P0002', message: 'keine freigabe' }];
        if (!z) return [400, { code: 'P0002', message: 'kein board' }];
        const umJetzt = zeile(uid, 'umgebung.json');
        if (sb.migration && ((b.p_wenn_version != null && Number(b.p_wenn_version) !== z.version) || (b.p_wenn_umgebung != null && Number(b.p_wenn_umgebung) !== umJetzt?.version))) {
          return [400, { code: 'P0001', message: 'vorbedingung' }, `VORBEDINGUNG (Umgebung v${umJetzt?.version}, Board v${z.version})`];
        }
        const vor = z.version;
        const neu = schreib(uid, name, JSON.stringify(patchAuf(JSON.parse(z.inhalt), p)), 'application/json', 0);
        const um = zeile(uid, 'umgebung.json');
        let umVor = null; let umNeu = null;
        if (um) {
          umVor = um.version;
          const u = JSON.parse(um.inhalt);
          u.boards[b.p_board_id] = `v${neu.version}`; u.savedAt = b.p_saved_at || new Date().toISOString(); u.basisEtag = String(um.version);
          umNeu = schreib(uid, 'umgebung.json', JSON.stringify(sortiert(u)), 'application/json', 0).version;
        }
        return [200, { version: neu.version, vor, umgebung: umNeu, umgebung_vor: umVor, ...(sb.migration ? { geprueft: true } : {}) }, `Board v${neu.version}, Umgebung v${umVor}→v${umNeu}`];
      });
    }
    if (pfad === '/rest/v1/rpc/freigaben_annehmen' && m === 'POST') return json(route, 200, 0);
    if (pfad === '/rest/v1/rpc/freigaben_fuer_mich' && m === 'POST') return json(route, 200, []);
    if (pfad === '/rest/v1/rpc/board_kanal' && m === 'POST') return json(route, 200, null);
    if (pfad === '/rest/v1/board_freigaben' || pfad === '/rest/v1/board_einladungen') return json(route, 200, []);
    // ---- konto_dateien ----
    if (pfad === '/rest/v1/konto_dateien') {
      const fName = eq('name');
      const select = (url.searchParams.get('select') ?? '*').split(',');
      const projiziere = (z) => (select.includes('*') ? z : Object.fromEntries(select.map((k) => [k, z[k]])));
      const treffer = () => { let x = zeilenVon(uid); if (fName !== undefined) x = x.filter((z) => z.name === fName); return x; };
      if (m === 'GET') {
        const art = select.includes('inhalt') || select.includes('*') ? 'lesen' : fName ? 'kopf' : 'liste';
        return gesteuert(route, art, fName ?? '(alle)', () => { const x = treffer(); return [200, x.map(projiziere), art === 'liste' ? '' : `v${x[0]?.version ?? '–'}`]; });
      }
      if (m === 'DELETE') { for (const z of treffer()) sb.zeilen.delete(`${uid}/${z.name}`); log(geraet, 'loeschen', fName ?? ''); return route.fulfill({ status: 204, headers: cors, body: '' }); }
      return json(route, 405, { message: 'nur GET/DELETE im Mock' });
    }
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const eintrag = { ws, uid: null, filter: [], geraet };
    sb.sockets.push(eintrag);
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (typeof j.topic === 'string' && j.topic.startsWith('realtime:pn-')) return;
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
    ws.onClose(() => { sb.sockets = sb.sockets.filter((s) => s !== eintrag); });
  });
}

// ---------- Geräte ----------
const note = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 130, position: { x, y }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: text }] } });
const board = (id, name, nodes) => ({ id, name, edges: [], drawings: [], comments: [], nodes });
const SPALTEN = 7; const ZEILEN = 5;
const KARTEN = Array.from({ length: SPALTEN * ZEILEN }, (_, i) => note(`k${String(i).padStart(2, '0')}`, `K${String(i).padStart(2, '0')}`, (i % SPALTEN) * 165, Math.floor(i / SPALTEN) * 125));
/** Ohne Schwung und Einrasten: Eine gezogene Karte liegt genau dort, wo sie losgelassen wurde, und schiebt keine andere an */
const RUHIG = { ziehBewegung: false, fangLinien: false, gridSnap: false };
/** Quelltext eines eigenen Tools (liegt in der Geräte-Ablage, nicht im Board) — zwei Fassungen verschiedener Länge */
// (mit Umlauten: Die Karte nennt die Länge in Zeichen, die Ablage misst Bytes — daran hing das ständige Neuladen)
const tool = (fassung, fuell) => `<!doctype html><html><head><meta charset="utf-8"><title>Größenrechner</title></head><body><h1 id="fassung">${fassung}</h1><p>Übersicht für Maße – ${'ä'.repeat(40)}${'x'.repeat(fuell)}</p></body></html>`;
const TOOL_1 = tool('Fassung eins', 4000);
const TOOL_2 = tool('Fassung zwei', 9000);
const TOOL_KARTE = { id: 'h1', type: 'htmlapp', width: 360, height: 280, position: { x: 1180, y: 0 }, data: { name: 'Rechner.html', size: TOOL_1.length } };
const standA = () => ({
  boards: [board('bx', 'Planung', [...structuredClone(KARTEN), structuredClone(TOOL_KARTE)]), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bx', 'by'] }] }],
  activeId: 'bx', view: 'board', ...RUHIG,
});
const standLeer = (n) => ({
  boards: [board(`leer${n}`, 'Neu', [])],
  spaces: [{ id: `sl${n}`, name: 'Privat', projects: [{ id: `pl${n}`, name: 'Eigenes', boardIds: [`leer${n}`] }] }],
  activeId: `leer${n}`, view: 'board', ...RUHIG,
});
async function geraet(name, stand) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await dienste(ctx, name);
  await ctx.addInitScript(({ st, konfig }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  const P = await ctx.newPage();
  const g = { ctx, P, name, toasts: [], fehler: [] };
  P.on('pageerror', (e) => { g.fehler.push(e.message); console.log(`    PAGEERROR[${name}]:`, e.message); });
  P.on('dialog', (d) => d.accept());
  if (LAUT) P.on('console', (m) => { const t = m.text(); if (t.startsWith('[m524]')) console.log(`    ${zeit()} ${name.padEnd(2)} APP       ${t.slice(7)}`); });
  await P.exposeFunction('__m524Toast', (text) => { g.toasts.push({ t: Date.now() - T0, text }); if (LAUT) console.log(`    ${zeit()} ${name.padEnd(2)} TOAST     ${text}`); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.evaluate(() => {
    // Hinweise (Toasts) mitschreiben, statt hinterher abzufragen
    const gesehen = new WeakSet();
    new MutationObserver(() => { for (const el of document.querySelectorAll('.toast')) { if (gesehen.has(el)) continue; gesehen.add(el); setTimeout(() => window.__m524Toast(el.textContent ?? ''), 60); } }).observe(document.body, { childList: true, subtree: true });
  });
  if (LAUT) {
    // Wohin jede Karte auf dem Bildschirm wandert (nach 120 ms Ruhe je Karte eine Zeile)
    await P.exposeFunction('__m524Lage', (id, lage) => console.log(`    ${zeit()} ${name.padEnd(2)} LAGE      ${id} → ${lage}`));
    await P.evaluate(() => {
      const warten = new Map();
      new MutationObserver((ms) => {
        for (const m of ms) {
          const el = m.target;
          if (!(el instanceof HTMLElement) || !el.classList.contains('react-flow__node')) continue;
          clearTimeout(warten.get(el.dataset.id));
          warten.set(el.dataset.id, setTimeout(() => window.__m524Lage(el.dataset.id, (el.style.transform.match(/translate\(([^)]+)\)/)?.[1] ?? '').replace(/px/g, '')), 120));
        }
      }).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
    });
  }
  await P.waitForTimeout(1200);
  return g;
}
const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const boardVon = (P, id) => zustand(P).then((s) => s.boards.find((b) => b.id === id));
async function warteBis(P, fn, ms = 16000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await warte(150); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(300);
}
async function anmelden(P, email, pass, neu) {
  await kontoPanel(P);
  await P.locator('[data-taste="konto-email"]').fill(email);
  if ((await P.locator('[data-taste="konto-mail"] details[open]').count()) === 0) { await P.locator('[data-taste="konto-mail"] details summary').click(); await P.waitForTimeout(150); }
  await P.locator('[data-taste="konto-pass"]').fill(pass);
  await P.locator(`[data-taste="${neu ? 'konto-neu' : 'konto-passwort'}"]`).click();
  await warteBis(P, async () => (await P.locator('[data-taste="konto-stand"]').count()) > 0, 10000);
  await P.waitForTimeout(400);
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
}
async function boardWechseln(P, name, projekt) {
  const kopf = P.locator('.tabs.spalte .side-proj:not(.auf) .side-proj-head', { hasText: projekt }).first();
  if (await kopf.count()) { await kopf.click(); await P.waitForTimeout(400); }
  await P.locator('.tabs.spalte .side-board', { hasText: name }).first().click(); await P.waitForTimeout(700);
}
let uid = '';
const serverBoard = (id = 'bx') => { try { return JSON.parse(zeileText(uid, `board-${id}.json`)); } catch { return null; } };
const serverUmgebung = () => { try { return JSON.parse(zeileText(uid, 'umgebung.json')); } catch { return null; } };
const lagen = (b) => Object.fromEntries((b?.nodes ?? []).map((n) => [n.id, `${Math.round(n.position.x)},${Math.round(n.position.y)}`]));
/** Lage jeder Karte, wie sie gerade auf dem Bildschirm liegt (der Speicher auf der Platte hinkt bis zu 400 ms nach) */
const lagenVon = (P) => P.evaluate(() => Object.fromEntries([...document.querySelectorAll('.react-flow__node')].map((el) => {
  const m = /translate\(\s*(-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px/.exec(el.style.transform) ?? [];
  return [el.dataset.id, `${Math.round(Number(m[1]))},${Math.round(Number(m[2]))}`];
})));
/** Ein Punkt, an dem man genau DIESE Karte greift (nicht ihren Text, keine Nachbarkarte, die darüber liegt) */
const greifpunkt = (P, id) => P.evaluate((kid) => {
  const karte = document.querySelector(`.react-flow__node[data-id="${kid}"]`);
  if (!karte) return null;
  const r = karte.getBoundingClientRect();
  for (const dy of [7, 9, 5, 11, r.height - 7]) {
    for (let dx = 14; dx < r.width - 14; dx += 12) {
      const x = r.left + dx; const y = r.top + dy;
      if (x < 330 || x > 1380 || y < 110 || y > 840) continue;
      const el = document.elementFromPoint(x, y);
      if (el && el.closest('.react-flow__node') === karte && !el.closest('.nodrag, button, input, [contenteditable="true"], .react-flow__resize-control')) return [x, y];
    }
  }
  return null;
}, id);
/** Karte ziehen; liefert ihre neue Lage aus dem Speicher (oder null, wenn sie sich nicht greifen ließ) */
async function ziehen(P, id, dx, dy, { schritte = 5, pauseMs = 0 } = {}) {
  const g = await greifpunkt(P, id);
  if (!g) { if (LAUT) console.log(`    ${zeit()} (kein Greifpunkt für ${id}: ${await P.evaluate((k) => { const r = document.querySelector(`.react-flow__node[data-id="${k}"]`)?.getBoundingClientRect(); const el = r ? document.elementFromPoint(r.left + 20, r.top + 7) : null; return r ? `${Math.round(r.left)},${Math.round(r.top)} darüber ${el?.className}` : 'fehlt'; }, id)})`); return null; }
  const vorher = (await lagenVon(P))[id];
  await P.mouse.move(g[0], g[1]); await P.mouse.down();
  await P.mouse.move(g[0] + dx / 2, g[1] + dy / 2, { steps: schritte });
  if (pauseMs) await warte(pauseMs);
  await P.mouse.move(g[0] + dx, g[1] + dy, { steps: schritte }); await P.mouse.up();
  await warte(60);
  const neu = (await lagenVon(P))[id];
  if (neu === vorher && LAUT) console.log(`    ${zeit()} (Zug an ${id} ohne Wirkung)`);
  return neu === vorher ? null : neu;
}
/** Auswahl aufheben: Klick auf eine freie Stelle der Leinwand (nie auf Karte, Übersichtskarte oder Bedienelement) */
const leerKlick = async (P) => {
  const p = await P.evaluate(() => {
    for (let y = 150; y <= 760; y += 26) for (let x = 1400; x >= 360; x -= 26) { if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return [x, y]; }
    return null;
  });
  if (p) await P.mouse.click(p[0], p[1]);
  await warte(120);
};
/** Sichtbarkeit des Fensters umschalten (Tab im Hintergrund / wieder vorn) */
const sichtbar = (P, an) => P.evaluate((v) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'visible' : 'hidden') });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !v });
  document.dispatchEvent(new Event('visibilitychange'));
}, an);
/** Der Server bekommt eine Weile nichts mehr geschrieben */
async function serverRuhig(ms = 3500, hoechstens = 40000) {
  const ende = Date.now() + hoechstens;
  const schreibt = (e) => ['patch', 'stapel', 'datei-auf'].includes(e.art);
  while (Date.now() < ende) {
    const letzter = [...protokoll].reverse().find(schreibt);
    if (!letzter || Date.now() - T0 - letzter.t > ms) return true;
    await warte(250);
  }
  return false;
}
/** Was das Gerät vom Konto weiß (Kenntnis, gemerkte Server-Stände, Stempel, „hier liegt Ungesichertes") — für die Fehlersuche */
const kontoWissen = (P) => P.evaluate(() => new Promise((fertig) => {
  const q = indexedDB.open('pixinotes-sync');
  q.onerror = () => fertig('?');
  q.onsuccess = () => {
    const os = q.result.transaction('kv').objectStore('kv');
    const hole = (k) => new Promise((ok) => { const g = os.get(k); g.onsuccess = () => ok(g.result); g.onerror = () => ok(undefined); });
    void Promise.all([hole('konto:kenn'), hole('konto:basen')]).then(([kenn, basen]) => fertig(
      `etag=${kenn?.etag} basen=[${(basen ?? []).map((b) => `${b.etag}${b.drin ? '✓' : '·'}`).join(' ')}] stempel=${(localStorage.getItem('pixinotes:konto-stamp') ?? '').slice(11, 26)} ungesichert=${localStorage.getItem('pixinotes:konto-dirty') ?? '–'}`));
  };
}));
const seit = (marke, filter = () => true) => protokoll.slice(marke).filter(filter);
const zeigeProtokoll = (eintraege, max = 60) => eintraege.slice(-max).map((e) => `      ${(e.t / 1000).toFixed(2).padStart(7)} ${e.geraet.padEnd(2)} ${e.art.padEnd(9)} ${e.status} ${e.info}`).join('\n');
/** Zufall mit Saat — ein roter Lauf lässt sich genau so wiederholen */
let saat = SAAT;
const zufall = () => { saat = (saat * 1664525 + 1013904223) >>> 0; return saat / 4294967296; };
const wuerfel = (n) => Math.floor(zufall() * n);

// ══ Aufbau: drei Geräte desselben Kontos ═══════════════════════════════
console.log('\n════ Aufbau: drei Geräte, ein Konto, ein Board mit 35 Karten ════');
/** Ein Eintrag der Geräte-Ablage (IndexedDB) lesen oder schreiben */
const ablage = (P, schluessel, wert) => P.evaluate(([k, v]) => new Promise((fertig, fehler) => {
  const q = indexedDB.open('pixinotes-sync', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv');
  q.onerror = () => fehler(q.error);
  q.onsuccess = () => {
    const tx = q.result.transaction('kv', v === undefined ? 'readonly' : 'readwrite');
    const os = tx.objectStore('kv');
    if (v === undefined) { const g = os.get(k); g.onsuccess = async () => fertig(g.result instanceof Blob ? await g.result.text() : g.result ?? null); g.onerror = () => fehler(g.error); return; }
    os.put(v, k); tx.oncomplete = () => fertig(true); tx.onerror = () => fehler(tx.error);
  };
}), [schluessel, wert]);

// ══ Aufbau ═══════════════════════════════════════════════════════════════
const ZAEHL_TOOL = '<!doctype html><html><head><meta charset="utf-8"><title>Zähler</title></head><body><b id="w"></b><script>var n=+(localStorage.getItem("zaehler")||0);document.getElementById("w").textContent=n;var i=0;var t=setInterval(function(){n++;localStorage.setItem("zaehler",String(n));document.getElementById("w").textContent=n;if(++i>=15)clearInterval(t);},200);</script></body></html>';
const ZAEHL_KARTE = { id: 'h3', type: 'htmlapp', width: 300, height: 220, position: { x: 1180, y: 330 }, data: { name: 'Zaehler.html', size: ZAEHL_TOOL.length } };
const toolHier = async (P, id) => (await ablage(P, `happ:${id}`)) ?? (await ablage(P, `file:${id}`));
const standM = () => { const s = standA(); s.boards[0].nodes.push(structuredClone(ZAEHL_KARTE)); return s; };
const A = await geraet('A', standM());
await ablage(A.P, 'happ:h1', TOOL_1);
await ablage(A.P, 'happ:h3', ZAEHL_TOOL);
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
uid = sb.nutzer.get('anna@example.de')?.id ?? '';
await warteBis(A.P, () => !!zeile(uid, 'umgebung.json') && !!zeile(uid, 'board-bx.json') && sb.objekte.has(`${uid}/datei-h3`), 15000);
const BID = 'bx';
/** Zeitpunkt (ms seit T0), an dem Annas Gerät zuletzt geladen wurde */
let aGeladen = 0;
await serverRuhig(3000);
pruefe('0.1 Anna ist angemeldet, Board und Tools liegen im Konto', !!serverBoard() && sb.objekte.has(`${uid}/datei-h1`) && sb.objekte.has(`${uid}/datei-h3`));

/** Ein anderes Gerät ändert eine Karte auf dem Server (wie board_aendern): Board und Umgebung zählen hoch, Realtime meldet es */
function fremdAendern(id, fn) {
  const name = `board-${BID}.json`;
  const b = JSON.parse(zeileText(uid, name));
  const n = b.nodes.find((x) => x.id === id);
  if (n) fn(n); else fn(null, b);
  const z = schreib(uid, name, JSON.stringify(b), 'application/json', 0);
  const um = zeile(uid, 'umgebung.json');
  const u = JSON.parse(um.inhalt);
  u.boards[BID] = `v${z.version}`; u.savedAt = new Date().toISOString(); u.basisEtag = String(um.version);
  schreib(uid, 'umgebung.json', JSON.stringify(sortiert(u)), 'application/json', 0);
}
const textVon = (n) => JSON.stringify(n?.data?.blocks ?? '');

// ══ V: Vorbedingung beim kartenweisen Schreiben ══════════════════════════
if (will('V')) {
  console.log('\n════ V: Ein anderes Gerät ändert dieselbe Karte, während das eigene Schreiben unterwegs ist ════');
  sb.migration = true;
  const K = 'k03';
  const m = protokoll.length;
  // Annas Schreiben braucht unterwegs 2,5 s — in der Zeit ändert ein anderes Gerät den Text derselben Karte
  let einmal = true;
  steuer.verzug = (g, art) => (g === 'A' && art === 'patch' && einmal ? (einmal = false, { vor: 2500, nach: 0 }) : { vor: 0, nach: 0 });
  const x1 = await ziehen(A.P, K, 30, 18); await leerKlick(A.P);
  await warteBis(A.P, () => protokoll.slice(m).some((e) => e.geraet === 'A' && e.art === 'patch-an'), 12000);
  fremdAendern(K, (n) => { n.data = { ...n.data, blocks: [{ type: 'paragraph', content: 'Text vom Telefon' }] }; });
  await warteBis(A.P, () => lagen(serverBoard())[K] === x1 && textVon(serverBoard().nodes.find((n) => n.id === K)).includes('Telefon'), 25000);
  await serverRuhig(3000);
  steuerZurueck();
  const karte = serverBoard().nodes.find((n) => n.id === K);
  const abgelehnt = protokoll.slice(m).filter((e) => e.geraet === 'A' && e.art === 'patch' && e.status === 400 && /VORBEDINGUNG/.test(e.info));
  pruefe('V1.1 der Server hat Annas veraltetes Schreiben abgelehnt (nichts geschrieben)', abgelehnt.length >= 1, `\n${zeigeProtokoll(protokoll.slice(m).filter((e) => e.geraet === 'A'), 14)}`);
  pruefe('V1.2 auf dem Server: Annas Lage UND der Text des anderen Geräts', lagen(serverBoard())[K] === x1 && textVon(karte).includes('Telefon'), `Lage ${lagen(serverBoard())[K]} (soll ${x1}), Text ${textVon(karte)}`);
  const hier = (await boardVon(A.P, BID)).nodes.find((n) => n.id === K);
  pruefe('V1.3 bei Anna: ihre Lage bleibt, der fremde Text ist da', (await lagenVon(A.P))[K] === x1 && textVon(hier).includes('Telefon'), `${(await lagenVon(A.P))[K]} ${textVon(hier)}`);
  const mitWenn = protokoll.slice(m).filter((e) => e.geraet === 'A' && e.art === 'patch-an' && /wenn_umgebung=\d/.test(e.info));
  pruefe('V1.4 Anna schickt die Version mit, auf der sie aufbaut', mitWenn.length >= 2, `\n${zeigeProtokoll(protokoll.slice(m).filter((e) => e.art === 'patch-an'), 6)}`);
  // Mit bestätigter Vorbedingung entfällt der Mini-Abruf direkt vor dem Schreiben
  await serverRuhig(2500);
  const m2 = protokoll.length;
  await ziehen(A.P, 'k05', 20, 10); await leerKlick(A.P);
  await warteBis(A.P, () => protokoll.slice(m2).some((e) => e.geraet === 'A' && e.art === 'patch' && e.status === 200), 12000);
  const vorPatch = protokoll.slice(m2, protokoll.slice(m2).findIndex((e) => e.art === 'patch') + m2).filter((e) => e.geraet === 'A' && e.art === 'kopf');
  pruefe('V1.5 mit Migration: ein Blick auf den Server vor dem Schreiben genügt (keiner doppelt)', vorPatch.length <= 1, `${vorPatch.length} Mini-Abrufe`);

  console.log('\n════ V2: ohne Migration – wie bisher ════');
  sb.migration = false;
  aGeladen = Date.now() - T0; await A.P.reload({ waitUntil: 'networkidle' }); await A.P.waitForTimeout(2500);
  await serverRuhig(2500);
  const m3 = protokoll.length;
  const x2 = await ziehen(A.P, 'k06', 26, 12); await leerKlick(A.P);
  await warteBis(A.P, () => lagen(serverBoard())['k06'] === x2, 15000);
  const x3 = await ziehen(A.P, 'k06', 20, 10); await leerKlick(A.P);
  await warteBis(A.P, () => lagen(serverBoard())['k06'] === x3, 15000);
  const v2 = protokoll.slice(m3).filter((e) => e.geraet === 'A' && (e.art === 'patch' || e.art === 'patch-an'));
  pruefe('V2.1 ohne Migration kommt Annas Änderung trotzdem an', lagen(serverBoard())['k06'] === x3, `${lagen(serverBoard())['k06']} soll ${x3}`);
  pruefe('V2.2 die unbekannten Parameter werden einmal versucht (404), danach nicht mehr geschickt', v2.filter((e) => e.status === 404).length === 1 && v2.filter((e) => e.art === 'patch-an' && /wenn_umgebung=\d/.test(e.info)).length === 1, `\n${zeigeProtokoll(v2, 10)}`);
  sb.migration = true;
}

// ══ F: Dateien, die im Konto fehlen ═══════════════════════════════════════
let B = null;
if (will('F') || will('Z')) {
  console.log('\n════ F: Eine Datei fehlt im Konto (HTTP 400) – nicht endlos fragen, nachreichen, an der Karte sagen ════');
  // Die Datei des Tools h1 ist im Dateispeicher verloren gegangen (die Umgebung nennt sie weiter)
  // (erst, wenn Annas Gerät seine Prüfung nach dem letzten Start hinter sich hat — sie läuft dann sechs Stunden nicht wieder)
  await warteBis(A.P, () => protokoll.some((e) => e.geraet === 'A' && e.art === 'sp-liste' && e.t > aGeladen), 45000);
  sb.objekte.delete(`${uid}/datei-h1`);
  B = await geraet('B', standLeer(1));
  await anmelden(B.P, 'anna@example.de', 'geheim123', false);
  await warteBis(B.P, async () => !!(await boardVon(B.P, BID)), 30000);
  await boardWechseln(B.P, 'Planung', 'Allgemein');
  await warte(2500);
  const m = protokoll.length;
  // Anna arbeitet weiter: B liest jedes Mal neu
  const bLiest = () => protokoll.slice(m).filter((e) => e.geraet === 'B' && e.art === 'lesen' && e.info.startsWith('umgebung')).length;
  for (let i = 0; i < 3; i += 1) {
    await ziehen(A.P, `k1${i}`, 18, 10); await leerKlick(A.P);
    await warteBis(B.P, () => bLiest() >= i + 1, 15000);
  }
  await warte(2000);
  const anfragen = protokoll.filter((e) => e.geraet === 'B' && e.art === 'datei-ab' && e.info.includes('datei-h1'));
  const lesen = protokoll.slice(m).filter((e) => e.geraet === 'B' && e.art === 'lesen' && e.info.startsWith('umgebung')).length;
  pruefe(`F1 B fragt die fehlende Datei nicht bei jedem Abgleich wieder (${lesen} Lesevorgänge seit dem ersten Mal)`, lesen >= 2 && anfragen.length <= 2, `${anfragen.length} Anfragen\n${zeigeProtokoll(anfragen, 6)}`);
  const hinweis = await B.P.locator('.react-flow__node[data-id="h1"]').innerText().catch(() => '');
  pruefe('F2 die Karte sagt, dass der Inhalt auch im Konto fehlt', /fehlt auf diesem Gerät und im Konto/.test(hinweis), hinweis.slice(0, 200));
  if (BILDER) await B.P.locator('.react-flow__node[data-id="h1"]').screenshot({ path: join(BILDER, 'm529-karte-fehlt.png') }).catch(() => {});
  // Anna öffnet PixiNotes neu: ihr Gerät hat die Datei und reicht sie nach
  const m2 = protokoll.length;
  await A.P.reload({ waitUntil: 'networkidle' });
  const hoch = await warteBis(A.P, () => protokoll.slice(m2).some((e) => e.geraet === 'A' && e.art === 'datei-auf' && e.status === 200 && e.info.includes('datei-h1')), 45000);
  pruefe('F3 Annas Gerät hat die Datei und lädt sie nach', hoch && sb.objekte.has(`${uid}/datei-h1`), `\n${zeigeProtokoll(protokoll.slice(m2).filter((e) => e.geraet === 'A'), 12)}`);
  const da = await warteBis(B.P, async () => (await toolHier(B.P, 'h1')) === TOOL_1, 30000);
  pruefe('F4 B bekommt die nachgereichte Datei, ohne auf die nächste Pause zu warten', da);
  const hinweis2 = await warteBis(B.P, async () => !/fehlt auf diesem Gerät/.test(await B.P.locator('.react-flow__node[data-id="h1"]').innerText().catch(() => '')), 8000);
  pruefe('F5 … und der Hinweis an der Karte ist weg', hinweis2);

  // Ein Inhalt kommt NACH seiner Karte an (Import, Kopie) und dieses Gerät ändert danach nichts mehr
  await serverRuhig(2500);
  const m3 = protokoll.length;
  fremdAendern(null, (_n, b) => { b.nodes.push({ id: 'h9', type: 'htmlapp', width: 300, height: 200, position: { x: 1180, y: 600 }, data: { name: 'Nachzuegler.html', size: TOOL_2.length } }); });
  await warteBis(A.P, async () => !!(await boardVon(A.P, BID)).nodes.find((n) => n.id === 'h9'), 15000);
  await serverRuhig(2500);
  await ablage(A.P, 'happ:h9', TOOL_2);
  await A.P.evaluate(() => window.dispatchEvent(new CustomEvent('pixinotes:dateien-da')));
  const h9 = await warteBis(A.P, () => sb.objekte.has(`${uid}/datei-h9`), 20000);
  pruefe('F6 ein Inhalt, der nach seiner Karte ankommt, geht ohne weitere Änderung ins Konto', h9, `\n${zeigeProtokoll(protokoll.slice(m3).filter((e) => e.geraet === 'A'), 8)}`);
}

// ══ Z: Speicherstand eines Tools ══════════════════════════════════════════
if (will('Z') && B) {
  console.log('\n════ Z: Was ein Tool selbst speichert, sieht das zweite Gerät ════');
  await serverRuhig(2500);
  const m = protokoll.length;
  await A.P.locator('.react-flow__node[data-id="h3"] .happ-go').click();
  const fertigA = await warteBis(A.P, async () => (await ablage(A.P, 'happ-state:h3'))?.zaehler === '15', 15000);
  const oben = await warteBis(A.P, () => { const o = sb.objekte.get(`${uid}/zustand-h3`); try { return JSON.parse(o.body.toString()).data.zaehler === '15'; } catch { return false; } }, 25000);
  await warte(3000);
  const auf = protokoll.slice(m).filter((e) => e.art === 'datei-auf' && e.info.includes('zustand-h3'));
  pruefe('Z1 Annas Tool zählt bis 15 und der Stand liegt im Konto', fertigA && oben, `${JSON.stringify(await ablage(A.P, 'happ-state:h3'))}`);
  pruefe('Z2 hochgeladen wird nicht je Speichern (15 Mal gespeichert)', auf.length >= 1 && auf.length <= 3, `${auf.length} Mal`);
  // B startet dasselbe Tool: es zählt von Annas Stand weiter
  await warteBis(B.P, async () => !!(await toolHier(B.P, 'h3')), 20000);
  await B.P.locator('.react-flow__node[data-id="h3"] .happ-go').click();
  const weiter = await warteBis(B.P, async () => (await ablage(B.P, 'happ-state:h3'))?.zaehler === '30', 20000);
  pruefe('Z3 auf dem zweiten Gerät zählt das Tool von Annas Stand weiter (15 → 30)', weiter, JSON.stringify(await ablage(B.P, 'happ-state:h3')));
  const zurueck = await warteBis(A.P, () => { const o = sb.objekte.get(`${uid}/zustand-h3`); try { return JSON.parse(o.body.toString()).data.zaehler === '30'; } catch { return false; } }, 25000);
  pruefe('Z4 … und dieser Stand liegt danach im Konto', zurueck);
}

// ══ A: Speicher aufräumen ═════════════════════════════════════════════════
if (will('A')) {
  console.log('\n════ A: Speicher aufräumen – nur Verwaistes, erst nach Bestätigung ════');
  const alt = Date.now() - 3 * 24 * 3600_000;
  const leg = (name, alter) => sb.objekte.set(`${uid}/${name}`, { body: Buffer.from('x'.repeat(2048)), mime: 'application/octet-stream', am: alter });
  leg('datei-weg1', alt); leg('zustand-weg2', alt); leg('datei-neu3', Date.now() - 3600_000); leg('anderes-x', alt);
  const vorher = [...sb.objekte.keys()].length;
  await kontoPanel(A.P);
  await A.P.locator('[data-taste="konto-aufraeumen"] summary').click();
  await A.P.locator('[data-taste="konto-aufraeumen-pruefen"]').click();
  await warteBis(A.P, async () => (await A.P.locator('[data-taste="konto-aufraeumen-stand"]').count()) > 0, 15000);
  const stand = await A.P.locator('[data-taste="konto-aufraeumen-stand"]').innerText();
  pruefe('A1 gezeigt: zwei verwaiste Dateien, eine jüngere bleibt', /2 Dateien ohne Verweis/.test(stand) && /1 jüngere Datei bleibt/.test(stand), stand);
  if (BILDER) await A.P.locator('[data-taste="konto-aufraeumen"]').screenshot({ path: join(BILDER, 'm529-speicher-aufraeumen.png') }).catch(() => {});
  pruefe('A2 vor der Bestätigung ist nichts gelöscht', [...sb.objekte.keys()].length === vorher);
  let gefragt = '';
  A.P.once('dialog', (d) => { gefragt = d.message(); });
  await A.P.locator('[data-taste="konto-aufraeumen-loeschen"]').click();
  await warteBis(A.P, () => !sb.objekte.has(`${uid}/datei-weg1`), 10000);
  await warte(800);
  pruefe('A3 nach der Bestätigung: genau die zwei verwaisten sind weg', !sb.objekte.has(`${uid}/datei-weg1`) && !sb.objekte.has(`${uid}/zustand-weg2`) && /löschen\?/.test(gefragt), gefragt);
  pruefe('A4 Jüngeres, Unbekanntes und alles, worauf eine Karte verweist, bleibt', sb.objekte.has(`${uid}/datei-neu3`) && sb.objekte.has(`${uid}/anderes-x`) && sb.objekte.has(`${uid}/datei-h1`) && sb.objekte.has(`${uid}/datei-h3`) && (!B || sb.objekte.has(`${uid}/zustand-h3`)), [...sb.objekte.keys()].join(' '));
  await A.P.keyboard.press('Escape'); await warte(400);
}

// ══ B: Ring der Server-Stände ═════════════════════════════════════════════
if (will('B')) {
  console.log('\n════ B: Der Ring der Server-Stände schreibt Unverändertes nicht neu ════');
  const idb = (P) => P.evaluate(() => new Promise((fertig) => {
    const r = indexedDB.open('pixinotes-sync');
    r.onsuccess = () => { const os = r.result.transaction('kv').objectStore('kv'); const k = os.getAllKeys(); k.onsuccess = () => { const g = os.get('konto:basen'); g.onsuccess = () => fertig({ keys: k.result.map(String), basen: g.result }); }; };
  }));
  await serverRuhig(2500);
  for (let i = 0; i < 3; i += 1) { await ziehen(A.P, `k2${i}`, 16, 8); await leerKlick(A.P); await serverRuhig(2000); }
  const r = await idb(A.P);
  const byKeys = r.keys.filter((k) => k.startsWith('konto:bb:by:'));
  pruefe('B1 das Verzeichnis nennt Schlüssel, keine ganzen Stände', Array.isArray(r.basen) && r.basen.length > 0 && r.basen.every((e) => e.boards.every((b) => typeof b === 'string')), JSON.stringify(r.basen ?? null).slice(0, 200));
  pruefe('B2 das unveränderte zweite Board liegt nur einmal in der Ablage', byKeys.length === 1, byKeys.join(','));
  const z = await A.P.evaluate(() => window.pixinotesKontoBasen);
  pruefe('B3 je Schreibvorgang wird höchstens das geänderte Board neu abgelegt', !!z && z.boardsGeschrieben <= z.verzeichnisGeschrieben + 2, JSON.stringify(z));
}

// ══ O: M522 O1 und O2 ═════════════════════════════════════════════════════
if (will('O')) {
  console.log('\n════ O1: „Alles leeren", dann Gesamt-Sicherung „ersetzen" – kein leeres Startboard übrig ════');
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const L = await ctx.newPage();
  await L.goto(`http://localhost:${PORT}/__labor`);
  const o1 = await L.evaluate(async () => {
    const { useBoard, sicherung } = window.__pn; const S = () => useBoard.getState();
    const b = (id, name) => ({ id, name, nodes: [{ id: `${id}n`, type: 'note', position: { x: 0, y: 0 }, data: { blocks: [{ type: 'paragraph', content: name }] } }], edges: [], drawings: [] });
    useBoard.setState({ boards: [b('q1', 'Eins'), b('q2', 'Zwei')], spaces: [{ id: 'sq', name: 'Projekte', projects: [{ id: 'pq', name: 'A', boardIds: ['q1', 'q2'] }] }], activeId: 'q1' });
    const s = await sicherung.sicherungLesen((await sicherung.sicherungBauen('alles')).blob);
    S().resetAll();
    await sicherung.sicherungEinspielen(s, 'ersetzen');
    return { namen: S().boards.map((x) => x.name), spaces: S().spaces.map((x) => x.name), aktiv: S().activeId };
  });
  pruefe('O1.1 nach dem Einspielen: nur die Boards der Sicherung, kein leeres „Mein Board"', o1.namen.join(',') === 'Eins,Zwei', o1.namen);
  pruefe('O1.2 … der leere Start-Bereich ist mit weg, ein Board der Sicherung ist offen', o1.spaces.join(',') === 'Projekte' && ['q1', 'q2'].includes(o1.aktiv), o1);
  await ctx.close();

  console.log('\n════ O2: Unlesbarer gespeicherter Stand – Rettungskopie vor dem Überschreiben ════');
  const ROH = '{"version":5,"state":{"boards":[{"id":"x","name":"Wichtig","nodes":[{"id":"n1"'.padEnd(400, ' ');
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await c2.addInitScript((roh) => {
    if (sessionStorage.getItem('m529-einmal')) return;
    sessionStorage.setItem('m529-einmal', '1');
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', roh);
  }, ROH);
  const P = await c2.newPage();
  const fehler = [];
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  const gesichert = await warteBis(P, async () => (await ablage(P, 'pixinotes:rettung'))?.[0]?.text === ROH, 30000);
  pruefe('O2.1 der unlesbare Stand liegt als Rettungskopie in der Geräte-Ablage', gesichert);
  const ueberschrieben = await warteBis(P, () => P.evaluate(() => { try { JSON.parse(localStorage.getItem('pixinotes-board')); return true; } catch { return false; } }), 10000);
  pruefe('O2.2 erst danach wird neu gespeichert (die App läuft weiter)', ueberschrieben && fehler.length === 0, fehler.join(' | '));
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(400);
  const knopf = P.locator('[data-taste="rettung-laden"]');
  pruefe('O2.3 unter Einstellungen → Daten steht die Rettungskopie', (await knopf.count()) === 1);
  if (await knopf.count()) {
    const [dl] = await Promise.all([P.waitForEvent('download', { timeout: 10000 }), knopf.click()]);
    const text = readFileSync(await dl.path(), 'utf8');
    pruefe('O2.4 Herunterladen liefert genau den alten Text', text === ROH, `${text.length} Zeichen`);
  }
  await c2.close();
}

await browser.close();
app.close();
console.log(`\n${bad === 0 ? '✓' : '✗'} M529: ${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad === 0 ? 0 : 1);
