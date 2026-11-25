/**
 * M524 — Konto-Abgleich: Ein älterer Stand vom Server setzt die eigene Arbeit nicht mehr zurück.
 *
 * Fehlerbericht: „Ich arbeite, verändere, verschiebe … dann wird plötzlich ein älterer Stand vom Server abgerufen
 * und meine Änderung zurückgesetzt." Mehrere Geräte desselben Kontos haben dasselbe Board offen (rund 35 Karten,
 * einige davon eigene HTML-Tools).
 *
 * Supabase ist im Node-Prozess nachgebaut (Gerüst aus m383): Tabelle konto_dateien, konto_schreiben, board_aendern,
 * Dateispeicher, Realtime. Neu ist die STEUERUNG: je Gerät und Art der Anfrage lassen sich Antworten verzögern
 * (vor oder nach dem Schreiben), verlieren oder mit einem Fehler beantworten, Realtime lässt sich je Gerät
 * anhalten — und jede Anfrage steht mit Zeit im Protokoll.
 *
 * Aufruf: `node pruefungen/m524-konto-ruecksetzer.mjs [Abschnitt …]` — ohne Angabe alle Abschnitte.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5524;
const NUR = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.toUpperCase());
const will = (abschnitt) => NUR.length === 0 || NUR.includes(abschnitt);
const LAUT = process.argv.includes('--laut');
const SAAT = Number(process.env.M524_SAAT ?? 524);
const RUNDEN = Number(process.env.M524_RUNDEN ?? 40);

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
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const zeit = () => ((Date.now() - T0) / 1000).toFixed(2).padStart(7);

// ---------- Nachgebautes Supabase (ein Konto, mehrere Geräte) ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = { nutzer: new Map(), tokens: new Map(), refresh: new Map(), zeilen: new Map(), sockets: [], objekte: new Map(), n: 0 };
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
        return gesteuert(route, 'datei-auf', `${schluessel} ${inhalt.length} B`, () => { sb.objekte.set(schluessel, { body: inhalt, mime: req.headers()['content-type'] ?? 'application/octet-stream' }); return [200, { Key: `pixinotes/${schluessel}` }]; });
      }
      if (m === 'GET') {
        if (steuer.offline.has(geraet)) return route.abort('internetdisconnected').catch(() => {});
        const o = sb.objekte.get(schluessel);
        log(geraet, 'datei-ab', `${schluessel} ${o ? o.body.length : '–'} B`, o ? 200 : 400);
        return o ? route.fulfill({ status: 200, contentType: o.mime, headers: cors, body: o.body }) : json(route, 400, { error: 'not found' });
      }
      if (m === 'DELETE') { sb.objekte.delete(schluessel); log(geraet, 'datei-weg', schluessel); return json(route, 200, {}); }
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
        return [200, { version: neu.version, vor, umgebung: umNeu, umgebung_vor: umVor }, `Board v${neu.version}, Umgebung v${umVor}→v${umNeu}`];
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
const standA = () => ({
  boards: [board('bx', 'Planung', structuredClone(KARTEN)), board('by', 'Ideen', [note('y1', 'Ideen Notiz')])],
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
const serverBoard = (id = BID) => { try { return JSON.parse(zeileText(uid, `board-${id}.json`)); } catch { return null; } };
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
const A = await geraet('A', standA());
await anmelden(A.P, 'anna@example.de', 'geheim123', true);
uid = sb.nutzer.get('anna@example.de')?.id ?? '';
await warteBis(A.P, () => !!zeile(uid, 'umgebung.json') && !!zeile(uid, 'board-bx.json'), 10000);
/** Das Board, an dem gearbeitet wird — das eingebaute oder (nur von Hand, M524_BOARD=<Datei>) ein exportiertes */
let BID = 'bx'; let BNAME = 'Planung';
if (process.env.M524_BOARD) {
  await A.P.locator('input[type="file"]:not([accept])').last().setInputFiles(process.env.M524_BOARD);
  await warteBis(A.P, async () => (await zustand(A.P)).activeId !== 'bx', 20000);
  const st = await zustand(A.P);
  BID = st.activeId; BNAME = st.boards.find((b) => b.id === BID).name;
  await warteBis(A.P, () => !!zeile(uid, `board-${BID}.json`), 60000);
  await serverRuhig(5000, 120000);
  await A.P.keyboard.press('f'); await warte(900);
  console.log(`    (Board aus Datei: ${st.boards.find((b) => b.id === BID).nodes.length} Karten, ${Math.round(zeileText(uid, `board-${BID}.json`).length / 1024)} kB, ${sb.objekte.size} Dateien im Speicher)`);
}
const B = await geraet('B', standLeer(1));
await anmelden(B.P, 'anna@example.de', 'geheim123', false);
await warteBis(B.P, async () => !!(await boardVon(B.P, BID)), 30000);
await boardWechseln(B.P, BNAME, 'Allgemein');
const C = await geraet('C', standLeer(2));
await anmelden(C.P, 'anna@example.de', 'geheim123', false);
await warteBis(C.P, async () => !!(await boardVon(C.P, BID)), 30000);
await boardWechseln(C.P, BNAME, 'Allgemein');
await serverRuhig(3000);
if (process.env.M524_BOARD) { for (const g of [B, C]) { await g.P.keyboard.press('f'); await warte(600); } await serverRuhig(5000, 120000); }
const ANZAHL = (await boardVon(A.P, BID)).nodes.length;
const IDS = (await boardVon(A.P, BID)).nodes.map((n) => n.id);
pruefe(`0.1 alle drei Geräte zeigen das Board mit ${ANZAHL} Karten`, (await A.P.locator('.react-flow__node').count()) === ANZAHL && (await B.P.locator('.react-flow__node').count()) === ANZAHL && (await C.P.locator('.react-flow__node').count()) === ANZAHL,
  `${await A.P.locator('.react-flow__node').count()}/${await B.P.locator('.react-flow__node').count()}/${await C.P.locator('.react-flow__node').count()}`);
const GERAETE = [A, B, C];

/** Was Anna zuletzt gewollt hat: Karte → Lage. Jede Abweichung auf ihrem Gerät ist ein Rücksetzer. */
const soll = await lagenVon(A.P);
const ruecksetzer = [];
async function pruefeSoll(wo) {
  const ist = await lagenVon(A.P);
  for (const [id, lage] of Object.entries(soll)) {
    if (ist[id] !== lage) { ruecksetzer.push({ t: Date.now() - T0, wo, id, soll: lage, ist: ist[id] }); if (LAUT) console.log(`    ${zeit()} RÜCKSETZER ${wo}: ${id} soll ${lage}, ist ${ist[id]}`); soll[id] = ist[id]; }
  }
}

// ══ D: Dauerlauf ═══════════════════════════════════════════════════════
if (will('D')) {
  console.log(`\n════ D: Dauerlauf – Anna arbeitet, zwei Geräte ruhen und wachen auf (Saat ${SAAT}, ${RUNDEN} Runden) ════`);
  const m0 = protokoll.length;
  // Antworten kommen unterschiedlich schnell, manche gehen verloren; die ruhenden Geräte hören zeitweise nichts
  steuer.verzug = (g, art) => {
    const z = zufall();
    if (art === 'patch' || art === 'stapel') return { vor: z < 0.3 ? wuerfel(900) : 0, nach: z > 0.6 ? wuerfel(1800) : 0 };
    if (art === 'lesen') return { vor: 0, nach: z < 0.4 ? wuerfel(1200) : 0 };
    return { vor: 0, nach: z < 0.2 ? wuerfel(500) : 0 };
  };
  steuer.fehler = (g, art) => ((art === 'patch' || art === 'stapel') && zufall() < 0.08 ? (zufall() < 0.5 ? 'weg' : 503) : null);
  steuer.rtVerzug = () => wuerfel(700);
  for (let r = 0; r < RUNDEN; r += 1) {
    // Die ruhenden Geräte: mal im Hintergrund, mal stumm (Schlaf), mal wieder da
    for (const g of [B, C]) {
      const z = zufall();
      if (z < 0.15) await sichtbar(g.P, false);
      else if (z < 0.3) await sichtbar(g.P, true);
      else if (z < 0.4) steuer.stumm.add(g.name);
      else if (z < 0.5) steuer.stumm.delete(g.name);
    }
    await pruefeSoll(`vor Runde ${r}`);
    if (LAUT) for (const g of GERAETE) console.log(`    ${zeit()} ${g.name.padEnd(2)} WISSEN    ${await kontoWissen(g.P)}`);
    const id = IDS[wuerfel(IDS.length)];
    const dx = (wuerfel(5) - 2) * 12 || 12; const dy = (wuerfel(5) - 2) * 10;
    const neu = await ziehen(A.P, id, dx, dy, { pauseMs: zufall() < 0.3 ? 300 + wuerfel(900) : 0 });
    if (neu) soll[id] = neu;
    await leerKlick(A.P);
    await warte(zufall() < 0.5 ? wuerfel(400) : 600 + wuerfel(2200));
  }
  await pruefeSoll('nach der letzten Runde');
  // Ruhe: alles normal, alle Geräte wach
  steuerZurueck();
  for (const g of [B, C]) await sichtbar(g.P, true);
  await warte(4000);
  await serverRuhig(6000, 90000);
  await warte(12000);     // ein Takt der ruhenden Geräte
  await serverRuhig(4000, 60000);
  await pruefeSoll('nach der Ruhe');
  if (LAUT) for (const g of GERAETE) console.log(`    ${zeit()} ${g.name.padEnd(2)} WISSEN    ${await kontoWissen(g.P)}`);
  pruefe('D1 auf Annas Gerät wurde keine eigene Änderung zurückgesetzt', ruecksetzer.length === 0, `\n      ${ruecksetzer.slice(0, 6).map((x) => `${(x.t / 1000).toFixed(1)} s ${x.wo}: ${x.id} soll ${x.soll}, ist ${x.ist}`).join('\n      ')}`);
  const srv = lagen(serverBoard());
  const abw = (ist) => Object.keys(soll).filter((id) => ist[id] !== soll[id]);
  pruefe('D2 der Server hat Annas Stand', abw(srv).length === 0, abw(srv).map((id) => `${id}: soll ${soll[id]}, Server ${srv[id]}`).slice(0, 6).join(' · '));
  for (const g of [B, C]) {
    const ist = await lagenVon(g.P);
    pruefe(`D3 Gerät ${g.name} hat Annas Stand`, abw(ist).length === 0, abw(ist).map((id) => `${id}: soll ${soll[id]}, hier ${ist[id]}`).slice(0, 6).join(' · '));
  }
  const fremd = seit(m0, (e) => e.geraet !== 'A' && ['patch', 'stapel'].includes(e.art) && e.status === 200);
  pruefe('D4 die ruhenden Geräte haben nichts geschrieben', fremd.length === 0, `\n${zeigeProtokoll(fremd, 12)}`);
  pruefe('D5 keine Fehler in den Seiten', GERAETE.every((g) => g.fehler.length === 0), GERAETE.map((g) => g.fehler.join(' | ')).join(' · '));
  if (bad > 0 && !LAUT) console.log(`    Hinweise auf A: ${A.toasts.map((x) => `${(x.t / 1000).toFixed(1)} s „${x.text}"`).join(' · ')}`);
}

await browser.close();
app.close();
console.log(`\n${bad === 0 ? '✓' : '✗'} M524: ${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad === 0 ? 0 : 1);
