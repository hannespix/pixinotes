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
 *   L   Logik (src/lib/syncMerge.ts, gebündelt mit esbuild): Eine Karte, die zwei Geräte verschieden geändert haben,
 *       wird Feld für Feld zusammengeführt (Lage von dort, erkannter Text von hier); Bubbles-Karten folgen derselben
 *       Regel; was sich nicht geändert hat, bleibt dasselbe Objekt; die Reihenfolge von Schlüsseln ist keine Änderung.
 *   E1  Übernommenes ist nichts Eigenes: Scheitert nach dem Einarbeiten das eigene Schreiben, hält das Gerät den
 *       übernommenen Stand später nicht für seine Änderung — es schreibt die alte Lage nicht zurück.
 *   E3  Ein hier ersetzter Tool-Quelltext wird von der älteren Fassung im Konto nicht überschrieben.
 *   E4  Das Gerät liest seinen eigenen, gerade geschriebenen Stand nicht zurück (späte Antworten).
 *   E6  Wer ohne Pause weiterarbeitet, lädt trotzdem hoch.
 *   D   Dauerlauf: drei Geräte, eines arbeitet, zwei ruhen und wachen auf; Antworten verspätet, verloren, mit
 *       Fehler. Am Ende haben alle drei und der Server denselben Stand, nichts wurde zurückgesetzt, und die
 *       ruhenden Geräte haben weder Lage noch Inhalt geschrieben.
 *
 * Aufruf: `node pruefungen/m524-konto-ruecksetzer.mjs [Abschnitt …]` — ohne Angabe alle Abschnitte.
 * `PN_DIST=<alter Build>` und `M524_SRC=<alter src-Ordner>` zeigen den Stand davor (rot).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
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
// ══ L: Logik der Zusammenführung ═══════════════════════════════════════
if (will('L')) {
  console.log('\n════ L: Zusammenführen – Feld für Feld, dieselben Objekte, keine Schein-Änderungen ════');
  const SRC = process.env.M524_SRC ?? path.join(__repo, 'src');
  const datei = path.join(mkdtempSync(path.join(tmpdir(), 'm524-')), 'merge.mjs');
  execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(SRC, 'lib/syncMerge.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${datei}`, '--log-level=error']);
  const { dreiWegeMerge } = await import(pathToFileURL(datei).href);
  const klon = (x) => structuredClone(x);
  const spaces = [{ id: 's', name: 'S', projects: [{ id: 'p', name: 'P', boardIds: ['b'] }] }];
  const stand = (nodes) => ({ boards: [{ id: 'b', name: 'B', edges: [], nodes }], spaces });
  const karte = (id, type, x, data, mehr = {}) => ({ id, type, position: { x, y: 0 }, width: 200, data, measured: { width: 200, height: 100 }, ...mehr });
  const bild = (x, data = {}) => karte('i', 'image', x, { src: 'data:image/svg+xml;base64,AAAA', ...data });
  const blase = (x, m, data = {}) => karte('u', 'bubbles', x, { titel: 'Ideen', ideen: { a: { text: 'eins', von: 'x', t: 1 }, b: { text: 'zwei', von: 'y', t: 2 } }, stimmen: {}, gruppen: {}, abstimmung: { t: 0 }, ...data }, { measured: { width: 300, height: m } });
  const notiz = (id, x, text) => karte(id, 'note', x, { blocks: [{ type: 'paragraph', content: text }] });
  const von = (erg, id) => erg.boards[0].nodes.find((n) => n.id === id);
  {
    // Gerät A hat die Bubbles-Karte verschoben; hier wurde sie nur anders gemessen (jedes Gerät misst selbst)
    const basis = stand([blase(0, 240), notiz('n', 400, 'x')]);
    const lokal = stand([blase(0, 263), notiz('n', 400, 'x')]);
    const fremd = stand([blase(500, 240), notiz('n', 400, 'x')]);
    const erg = dreiWegeMerge(basis, lokal, fremd);
    pruefe('L1 Bubbles-Karte drüben verschoben, hier nur anders gemessen → die neue Lage gilt', von(erg, 'u').position.x === 500, `x=${von(erg, 'u').position.x}`);
    pruefe('L2 … und dieses Gerät hat dem Konto nichts Eigenes zu melden (schreibt die alte Lage nicht zurück)', JSON.stringify(von(erg, 'u').position) === JSON.stringify(von(fremd, 'u').position) && erg.bericht.konflikte === 0);
  }
  {
    // Hier kam eine Idee dazu, drüben wurde die Karte verschoben → beides
    const basis = stand([blase(0, 240)]);
    const lokal = stand([blase(0, 240, { ideen: { a: { text: 'eins', von: 'x', t: 1 }, b: { text: 'zwei', von: 'y', t: 2 }, c: { text: 'drei', von: 'z', t: 3 } } })]);
    const fremd = stand([blase(500, 240)]);
    const erg = dreiWegeMerge(basis, lokal, fremd);
    pruefe('L3 hier eine Idee mehr, drüben verschoben → neue Lage UND die Idee', von(erg, 'u').position.x === 500 && !!von(erg, 'u').data.ideen.c, `x=${von(erg, 'u').position.x} ideen=${Object.keys(von(erg, 'u').data.ideen)}`);
  }
  {
    // Hier hat die Texterkennung das Bild gelesen, drüben wurde es verschoben
    const basis = stand([bild(0)]);
    const lokal = stand([bild(0, { ocrText: 'Hallo', ocrAm: 1000, ocrFuer: 'f1' })]);
    const fremd = stand([{ ...bild(700), zIndex: 9 }]);
    const erg = dreiWegeMerge(basis, lokal, fremd);
    const k = von(erg, 'i');
    pruefe('L4 hier Text erkannt, drüben verschoben → neue Lage UND der erkannte Text, kein Konflikt', k.position.x === 700 && k.zIndex === 9 && k.data.ocrText === 'Hallo' && erg.bericht.konflikte === 0, `x=${k.position.x} text=${k.data.ocrText} konflikte=${erg.bericht.konflikte}`);
  }
  {
    // Beide haben dieselbe Karte verschoben → die hiesige Lage bleibt, und es zählt als Konflikt; der Text von drüben kommt trotzdem
    const basis = stand([notiz('n', 0, 'alt')]);
    const lokal = stand([notiz('n', 100, 'alt')]);
    const fremd = stand([notiz('n', 900, 'neu')]);
    const erg = dreiWegeMerge(basis, lokal, fremd);
    const k = von(erg, 'n');
    pruefe('L5 beide verschoben, drüben auch der Text geändert → hiesige Lage (ein Konflikt), Text von drüben', k.position.x === 100 && k.data.blocks[0].content === 'neu' && erg.bericht.konflikte === 1, `x=${k.position.x} text=${k.data.blocks[0].content} konflikte=${erg.bericht.konflikte}`);
  }
  {
    // Nur EINE Karte ist drüben anders: alle anderen bleiben dieselben Objekte (nichts zeichnet neu)
    const nodes = Array.from({ length: 30 }, (_, i) => notiz(`n${i}`, i * 10, `T${i}`));
    const lokal = stand(nodes);
    const basis = klon(lokal);
    const fremd = klon(lokal);
    fremd.boards[0].nodes[7].position.x = 999;
    for (const n of fremd.boards[0].nodes) n.measured = { width: 201, height: 99 };   // vom anderen Gerät gemessen
    const erg = dreiWegeMerge(basis, lokal, fremd);
    const gleich = erg.boards[0].nodes.filter((n, i) => n === lokal.boards[0].nodes[i]).length;
    pruefe('L6 eine Karte drüben geändert → die 29 anderen bleiben dieselben Objekte', gleich === 29 && von(erg, 'n7').position.x === 999 && erg.lokalNeu, `${gleich} gleich`);
    const fremd2 = klon(lokal);
    for (const n of fremd2.boards[0].nodes) n.measured = { width: 201, height: 99 };
    const erg2 = dreiWegeMerge(basis, lokal, fremd2);
    pruefe('L7 drüben nur anders gemessen → hier ändert sich nichts (kein Einspielen)', !erg2.lokalNeu && erg2.boards[0] === lokal.boards[0] && erg2.geaendert.length === 0, `lokalNeu=${erg2.lokalNeu} geaendert=${erg2.geaendert}`);
  }
  {
    // Derselbe Inhalt, andere Reihenfolge der Schlüssel (jedes Gerät mischt die Tabellen in seiner Reihenfolge)
    const dateiP = datei.replace('merge.mjs', 'patch.mjs');
    // (ein Quellstand außerhalb des Repositorys findet seine Pakete nicht von selbst — darum der Verweis auf node_modules)
    execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(SRC, 'lib/gastPatch.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${dateiP}`, '--log-level=error'], { env: { ...process.env, NODE_PATH: path.join(__repo, 'node_modules') } });
    const { patchAus } = await import(pathToFileURL(dateiP).href);
    const server = stand([blase(0, 240), notiz('n', 400, 'x')]).boards[0];
    const hier = stand([blase(0, 240, { ideen: { b: { von: 'y', t: 2, text: 'zwei' }, a: { t: 1, text: 'eins', von: 'x' } } }), notiz('n', 400, 'x')]).boards[0];
    const p = patchAus(server, hier);
    pruefe('L8 gleiche Ideen in anderer Schlüsselfolge → es gibt nichts zu schreiben', p === null, JSON.stringify(p)?.slice(0, 120));
    const p2 = patchAus(server, stand([blase(0, 240), notiz('n', 401, 'x')]).boards[0]);
    pruefe('L9 … eine echte Änderung reist weiter als genau diese Karte', p2?.nodes?.set?.length === 1 && p2.nodes.set[0].id === 'n');
  }
}

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
/** Der Quelltext des Tools, wie er auf diesem Gerät liegt (als Tool oder noch als mitgereiste Datei) */
const toolHier = async (P) => (await ablage(P, 'happ:h1')) ?? (await ablage(P, 'file:h1'));
const A = await geraet('A', standA());
await ablage(A.P, 'happ:h1', TOOL_1);
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

const lageServer = (id) => lagen(serverBoard())[id];
const patchesVon = (marke, geraet) => seit(marke, (e) => e.geraet === geraet && e.art === 'patch' && e.status === 200);

// ══ E1: Übernommenes ist nichts Eigenes ════════════════════════════════
if (will('E1') && !process.env.M524_BOARD) {
  console.log('\n════ E1: Nach dem Einarbeiten scheitert das eigene Schreiben – der übernommene Stand gilt trotzdem nicht als eigene Änderung ════');
  await serverRuhig(3000);
  const K = 'k08'; const J = 'k10';
  const m = protokoll.length;
  // Gerät B erreicht das Konto gerade nur lesend (jedes Schreiben scheitert)
  steuer.fehler = (g, art) => (g === 'B' && (art === 'patch' || art === 'stapel') ? 503 : null);
  await ziehen(B.P, J, 24, 14); await leerKlick(B.P);
  await warteBis(B.P, () => seit(m, (e) => e.geraet === 'B' && e.art === 'patch' && e.status === 503).length > 0, 12000);
  // Anna verschiebt K — B übernimmt das (und will danach sein Eigenes schreiben: scheitert)
  const x1 = await ziehen(A.P, K, 22, 12); await leerKlick(A.P);
  const b1 = await warteBis(B.P, async () => (await lagenVon(B.P))[K] === x1, 15000);
  const versuche = seit(m, (e) => e.geraet === 'B' && e.status === 503).length;
  await warteBis(B.P, () => seit(m, (e) => e.geraet === 'B' && e.status === 503).length > versuche, 8000);
  // Anna verschiebt K noch einmal
  const x2 = await ziehen(A.P, K, 22, 12); await leerKlick(A.P);
  soll[K] = x2;
  await warteBis(A.P, () => lageServer(K) === x2, 12000);
  await warteBis(B.P, async () => (await lagenVon(B.P))[K] === x2, 9000);
  // B kommt wieder durch — eine weitere eigene Änderung stößt sein Hochladen an
  steuerZurueck();
  const j2 = await ziehen(B.P, J, 10, 8); await leerKlick(B.P);
  soll[J] = j2;
  await warteBis(B.P, () => lageServer(J) === j2, 15000);
  await serverRuhig(3500); await warte(1500);
  const a = await lagenVon(A.P); const b = await lagenVon(B.P);
  pruefe('E1.1 B hat Annas erste Lage übernommen (Aufbau)', b1 && !!x1 && !!x2 && x1 !== x2, `${x1} → ${x2}`);
  pruefe('E1.2 bei Anna bleibt die Karte, wo sie sie zuletzt hingelegt hat', a[K] === x2, `soll ${x2}, ist ${a[K]}`);
  pruefe('E1.3 der Server hat Annas letzte Lage', lageServer(K) === x2, `soll ${x2}, Server ${lageServer(K)}`);
  pruefe('E1.4 Gerät B zeigt Annas letzte Lage', b[K] === x2, `soll ${x2}, B ${b[K]}`);
  pruefe('E1.5 B hat Annas Karte nie selbst geschrieben', !patchesVon(m, 'B').some((e) => e.info.includes(`${K}[`)), `\n${zeigeProtokoll(patchesVon(m, 'B'), 6)}`);
  pruefe('E1.6 die eigene Änderung von B ist bei Anna und auf dem Server', a[J] === j2 && lageServer(J) === j2, `soll ${j2}, A ${a[J]}, Server ${lageServer(J)}`);
}

// ══ E4: Kein Zurücklesen des eigenen Stands ════════════════════════════
if (will('E4') && !process.env.M524_BOARD) {
  console.log('\n════ E4: Späte Antworten – das Gerät liest seinen eigenen Stand nicht zurück ════');
  await serverRuhig(3000);
  const m = protokoll.length;
  steuer.verzug = (g, art) => (g === 'A' && art === 'patch' ? { vor: 0, nach: 1700 } : { vor: 0, nach: 0 });
  for (let i = 0; i < 6; i += 1) {
    const id = `k${14 + i}`;
    const neu = await ziehen(A.P, id, 18, 10); if (neu) soll[id] = neu;
    await leerKlick(A.P); await warte(900);
  }
  await serverRuhig(4000);
  steuerZurueck();
  const zurueck = seit(m, (e) => e.geraet === 'A' && e.art === 'lesen');
  pruefe('E4.1 Anna liest während ihrer eigenen Schreibvorgänge nichts vom Server zurück', zurueck.length === 0, `\n${zeigeProtokoll(zurueck, 6)}`);
  const srv = lagen(serverBoard());
  pruefe('E4.2 alle sechs Züge sind auf dem Server', [14, 15, 16, 17, 18, 19].every((n) => srv[`k${n}`] === soll[`k${n}`]));
  await pruefeSoll('E4');
}

// ══ E6: Ohne Pause arbeiten ════════════════════════════════════════════
if (will('E6') && !process.env.M524_BOARD) {
  console.log('\n════ E6: Wer ohne Pause weiterarbeitet, lädt trotzdem hoch ════');
  await serverRuhig(3000);
  const m = protokoll.length;
  const start = Date.now() - T0;
  let i = 0;
  while (Date.now() - T0 - start < 13000) {
    const id = `k${21 + (i % 6)}`;
    const neu = await ziehen(A.P, id, i % 2 ? -14 : 14, i % 2 ? -8 : 8, { schritte: 4 }); if (neu) soll[id] = neu;
    i += 1;
    await warte(200);
  }
  const erster = seit(m, (e) => e.geraet === 'A' && e.art === 'patch' && e.status === 200)[0];
  pruefe('E6.1 spätestens nach 9 s ist etwas im Konto, obwohl ohne Pause weitergearbeitet wird', !!erster && erster.t - start <= 9500, erster ? `nach ${((erster.t - start) / 1000).toFixed(1)} s` : `nichts in 13 s (${i} Züge)`);
  await leerKlick(A.P);
  await serverRuhig(3500);
  await pruefeSoll('E6');
}

// ══ E3: Ersetzter Tool-Quelltext ═══════════════════════════════════════
if (will('E3') && !process.env.M524_BOARD) {
  console.log('\n════ E3: Ein hier ersetzter Tool-Quelltext wird von der älteren Fassung im Konto nicht überschrieben ════');
  await serverRuhig(3000);
  const da = await warteBis(B.P, async () => (await toolHier(B.P)) === TOOL_1, 15000);
  pruefe('E3.1 das zweite Gerät hat den Quelltext des Tools (Aufbau)', da && (await toolHier(A.P)) === TOOL_1);
  const m = protokoll.length;
  // Die neue Datei kommt vorerst nicht hinauf (Funkloch beim Hochladen der Datei)
  steuer.fehler = (g, art) => (g === 'A' && art === 'datei-auf' ? 503 : null);
  await A.P.locator('.react-flow__node[data-id="h1"] input[type="file"]').setInputFiles({ name: 'Rechner.html', mimeType: 'text/html', buffer: Buffer.from(TOOL_2) });
  await warteBis(A.P, async () => (await toolHier(A.P)) === TOOL_2, 8000);
  await warteBis(A.P, () => seit(m, (e) => e.geraet === 'A' && e.art === 'datei-auf' && e.status === 503).length > 0, 12000);
  // Das zweite Gerät ändert etwas → Anna liest den Stand des Kontos (dort liegt noch die alte Fassung)
  const j = await ziehen(B.P, 'k12', 16, 10); await leerKlick(B.P);
  soll.k12 = j;
  const angekommen = await warteBis(A.P, async () => (await lagenVon(A.P)).k12 === j, 20000);
  await warte(2500);
  pruefe('E3.2 Anna hat die Änderung des zweiten Geräts bekommen (Aufbau)', angekommen && !!j);
  pruefe('E3.3 Annas neuer Quelltext ist noch da', (await toolHier(A.P)) === TOOL_2, `Länge ${String(await toolHier(A.P)).length}, erwartet ${TOOL_2.length}`);
  pruefe('E3.4 … und die alte Fassung wurde gar nicht erst geholt', seit(m, (e) => e.geraet === 'A' && e.art === 'datei-ab').length === 0, `\n${zeigeProtokoll(seit(m, (e) => e.geraet === 'A' && e.art === 'datei-ab'), 4)}`);
  // Das Hochladen geht wieder — die nächste Änderung nimmt die neue Fassung mit
  steuerZurueck();
  const k = await ziehen(A.P, 'k13', 14, 8); await leerKlick(A.P);
  if (k) soll.k13 = k;
  const oben = await warteBis(A.P, () => seit(m, (e) => e.geraet === 'A' && e.art === 'datei-auf' && e.status === 200).length > 0, 20000);
  const beiB = await warteBis(B.P, async () => (await toolHier(B.P)) === TOOL_2, 25000);
  pruefe('E3.5 danach reist die neue Fassung ins Konto und zum zweiten Gerät', oben && beiB, `oben=${oben} beiB=${beiB}`);
  await serverRuhig(3500);
  await pruefeSoll('E3');
}

// ══ D: Dauerlauf ═══════════════════════════════════════════════════════
if (will('D')) {
  console.log(`\n════ D: Dauerlauf – Anna arbeitet, das zweite Gerät gelegentlich an eigenen Karten, das dritte ruht und wacht auf (Saat ${SAAT}, ${RUNDEN} Runden) ════`);
  const m0 = protokoll.length;
  // Die letzten fünf Karten gehören in diesem Lauf dem zweiten Gerät, alle anderen Anna
  const B_IDS = IDS.filter((id) => id !== 'h1').slice(-5);
  const A_IDS = IDS.filter((id) => !B_IDS.includes(id));
  const sollB = {};
  // Antworten kommen unterschiedlich schnell, manche gehen verloren, manche Schreibvorgänge scheitern
  steuer.verzug = (g, art) => {
    const z = zufall();
    if (art === 'patch' || art === 'stapel') return { vor: z < 0.3 ? wuerfel(900) : 0, nach: z > 0.6 ? wuerfel(1800) : 0 };
    if (art === 'lesen') return { vor: 0, nach: z < 0.4 ? wuerfel(1200) : 0 };
    return { vor: 0, nach: z < 0.2 ? wuerfel(500) : 0 };
  };
  steuer.fehler = (g, art) => ((art === 'patch' || art === 'stapel') && zufall() < 0.12 ? (zufall() < 0.5 ? 'weg' : 503) : null);
  steuer.rtVerzug = () => wuerfel(700);
  for (let r = 0; r < RUNDEN; r += 1) {
    // Das ruhende Gerät: mal im Hintergrund, mal stumm (Schlaf, Funkloch), mal wieder da
    {
      const z = zufall();
      if (z < 0.15) await sichtbar(C.P, false);
      else if (z < 0.3) await sichtbar(C.P, true);
      else if (z < 0.4) steuer.stumm.add('C');
      else if (z < 0.5) steuer.stumm.delete('C');
    }
    if (zufall() < 0.2) { if (steuer.stumm.has('B')) steuer.stumm.delete('B'); else steuer.stumm.add('B'); }
    await pruefeSoll(`vor Runde ${r}`);
    if (LAUT) for (const g of GERAETE) console.log(`    ${zeit()} ${g.name.padEnd(2)} WISSEN    ${await kontoWissen(g.P)}`);
    // Das zweite Gerät arbeitet gelegentlich an seinen Karten
    if (zufall() < 0.3) {
      const id = B_IDS[wuerfel(B_IDS.length)];
      const neu = await ziehen(B.P, id, (wuerfel(3) - 1) * 12 || 12, (wuerfel(3) - 1) * 10);
      if (neu) sollB[id] = neu;
      await leerKlick(B.P);
    }
    const id = A_IDS[wuerfel(A_IDS.length)];
    const dx = (wuerfel(5) - 2) * 12 || 12; const dy = (wuerfel(5) - 2) * 10;
    const neu = await ziehen(A.P, id, dx, dy, { pauseMs: zufall() < 0.3 ? 300 + wuerfel(900) : 0 });
    if (neu) soll[id] = neu;
    await leerKlick(A.P);
    await warte(zufall() < 0.5 ? wuerfel(400) : 600 + wuerfel(2200));
    // was das zweite Gerät verschoben hat, kommt bei Anna an — das ist kein Rücksetzer
    for (const k of B_IDS) delete soll[k];
  }
  await pruefeSoll('nach der letzten Runde');
  // Ruhe: alles normal, alle Geräte wach; wer nach einem Fehler noch Ungesichertes hat, bekommt einen Anstoß
  steuerZurueck();
  for (const g of [B, C]) await sichtbar(g.P, true);
  for (const g of [A, B]) await g.P.evaluate(() => window.dispatchEvent(new Event('online')));
  const ziel = () => ({ ...soll, ...sollB });
  const abw = (ist) => Object.keys(ziel()).filter((id) => ist[id] !== ziel()[id]);
  const einig = async () => abw(lagen(serverBoard())).length === 0 && abw(await lagenVon(A.P)).length === 0 && abw(await lagenVon(B.P)).length === 0 && abw(await lagenVon(C.P)).length === 0;
  await warteBis(A.P, einig, 90000);
  await serverRuhig(4000, 60000);
  await pruefeSoll('nach der Ruhe');
  if (LAUT) for (const g of GERAETE) console.log(`    ${zeit()} ${g.name.padEnd(2)} WISSEN    ${await kontoWissen(g.P)}`);
  pruefe('D1 auf Annas Gerät wurde keine eigene Änderung zurückgesetzt', ruecksetzer.length === 0, `\n      ${ruecksetzer.slice(0, 6).map((x) => `${(x.t / 1000).toFixed(1)} s ${x.wo}: ${x.id} soll ${x.soll}, ist ${x.ist}`).join('\n      ')}`);
  const zeige = (ist) => abw(ist).map((id) => `${id}: soll ${ziel()[id]}, ist ${ist[id]}`).slice(0, 6).join(' · ');
  const srv = lagen(serverBoard());
  pruefe('D2 der Server hat den Stand beider arbeitenden Geräte', abw(srv).length === 0, zeige(srv));
  for (const g of GERAETE) {
    const ist = await lagenVon(g.P);
    pruefe(`D3 Gerät ${g.name} zeigt denselben Stand`, abw(ist).length === 0, zeige(ist));
  }
  // Wer hat welche Karte geschrieben? Ein Gerät schreibt nur, was es selbst geändert hat. Zu fremden Karten reicht
  // es höchstens nach, was auf jedem Gerät von selbst entsteht: Zeit- und Merkfelder (lib/abgleichZeiten.ts) und den
  // Text, den es selbst in einem Bild erkannt hat — nie Lage oder Inhalt.
  const VON_SELBST = ['data.ocrAm', 'data.ocrText', 'data.ocrFuer', 'geaendert'];
  const karten = (info) => [...info.matchAll(/([\w-]+)\[[^:\]]*: ?([^\]]*)\]/g)].map((t) => ({ id: t[1], felder: t[2].split(',').filter(Boolean) }));
  const inhalt = (k) => k.felder.some((f) => !VON_SELBST.includes(f));
  const vonC = seit(m0, (e) => e.geraet === 'C' && e.status === 200 && (e.art === 'stapel' || (e.art === 'patch' && karten(e.info).some(inhalt))));
  pruefe('D4 das ruhende Gerät hat weder Lage noch Inhalt geschrieben', vonC.length === 0, `\n${zeigeProtokoll(vonC, 8)}`);
  const vonB = seit(m0, (e) => e.geraet === 'B' && e.status === 200 && e.art === 'patch' && karten(e.info).some((k) => inhalt(k) && !B_IDS.includes(k.id)));
  pruefe('D5 das zweite Gerät hat nur seine eigenen Karten geschrieben, nie eine von Anna', vonB.length === 0, `\n${zeigeProtokoll(vonB, 8)}`);
  const vonA = seit(m0, (e) => e.geraet === 'A' && e.status === 200 && e.art === 'patch' && karten(e.info).some((k) => inhalt(k) && B_IDS.includes(k.id)));
  pruefe('D6 Anna hat nie eine Karte des zweiten Geräts geschrieben', vonA.length === 0, `\n${zeigeProtokoll(vonA, 8)}`);
  pruefe('D7 keine Fehler in den Seiten', GERAETE.every((g) => g.fehler.length === 0), GERAETE.map((g) => g.fehler.join(' | ')).join(' · '));
}

// ══ Z: Dateien reisen einmal ═══════════════════════════════════════════
if (!process.env.M524_BOARD && NUR.length === 0) {
  console.log('\n════ Z: Über den ganzen Lauf – der Tool-Quelltext wird nicht bei jedem Abgleich neu geladen ════');
  const ab = (g) => protokoll.filter((e) => e.geraet === g && e.art === 'datei-ab' && e.info.includes('datei-h1')).length;
  const auf = protokoll.filter((e) => e.art === 'datei-auf' && e.status === 200 && e.info.includes('datei-h1')).length;
  const lesen = protokoll.filter((e) => e.art === 'lesen' && e.info.startsWith('umgebung')).length;
  // zwei Fassungen: einmal zu Beginn, einmal nach dem Ersetzen (E3) — bei über hundert Lesevorgängen im ganzen Lauf
  pruefe(`Z1 jedes Gerät holt den Quelltext höchstens zweimal (bei ${lesen} Lesevorgängen insgesamt)`, ab('A') === 0 && ab('B') <= 2 && ab('C') <= 2, `A ${ab('A')}, B ${ab('B')}, C ${ab('C')}`);
  pruefe('Z2 hochgeladen wurde er zweimal (beide Fassungen), nicht mit jedem Schreiben', auf === 2, `${auf} Mal`);
}

await browser.close();
app.close();
console.log(`\n${bad === 0 ? '✓' : '✗'} M524: ${ok} bestanden, ${bad} durchgefallen`);
process.exit(bad === 0 ? 0 : 1);
