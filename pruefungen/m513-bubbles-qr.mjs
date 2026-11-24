/**
 * M513 — Ideabubbles einzeln per QR-Code teilen (Mitmachen ohne ganzes Board).
 *
 * Supabase Realtime ist im Node-Prozess nachgebaut (Kanäle mit Broadcast, dazu die REST-Schnittstelle
 * /realtime/v1/api/broadcast). Ein Gastgeber (Board, Rechner) und drei Telefone (eines dunkel). Dazu ein
 * „Angreifer" in Node, der mit echter Kryptografie Wünsche baut (wie ein Telefon, aber ohne dessen Grenzen).
 *
 *   A  Karte → „Mitmachen per QR": Fenster mit Code und Link; der gelesene Code (jsQR) IST der Link auf
 *      mitmachen.html; kein privater Schlüssel in der Karte.
 *   B  Drei Telefone öffnen den Link: schlanke Seite nur dieser Karte (kein Board, kein React-Flow, kein Editor-
 *      oder React-Paket geladen), Titel und Frage der Karte; die Zahl „3 dabei" erscheint beim Gastgeber.
 *   C  Verdeckt sammeln: Ideen der Telefone erscheinen live in der Karte; die anderen Telefone sehen sie nicht
 *      (weder im DOM noch auf der Leitung); Idee zurückziehen geht.
 *   D  Grenzen beim Gastgeber: je Person 10 Ideen, Eimer (8 auf einmal), 140 Zeichen, fremde Idee löschen geht nicht,
 *      gefälschte Absender (fremder Schlüssel) zählen nicht, ein gefälschter Stand (falsche Signatur) erscheint nicht.
 *   E  Gruppieren: Sammlung geschlossen (keine Eingabe, Idee von außen abgelehnt), alle Texte sichtbar.
 *   F  Abstimmen: Punkte vom Telefon kommen in der Karte an, Budget gilt (auch beim Angreifer); Zwischenstand
 *      verborgen → Telefone sehen keine fremden Punkte.
 *   G  Ergebnis: Rangfolge auf dem Telefon.
 *   H  Bühne: Code groß in der Karte (lesbar); Mitmachen beenden → Telefone sehen „beendet", der alte Link meldet
 *      freundlich, dass die Runde nicht offen ist.
 *   I  Keine fremden Inhalte: Board-Notiz und andere Karten nie auf der Leitung zu den Telefonen; Hell/Dunkel; Kontraste;
 *      keine fremden Dienste.
 *   J  Hilfe DE/EN, Englisch-Wörterbuch, Meilenstein-Datei.
 */
// Läuft aus dem Repository: `node werkzeug/alle-pruefungen.mjs m513`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { webcrypto as wc } from 'node:crypto';
import { chromium } from 'playwright-core';
import jsQR from 'jsqr';
import { kontrastScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const BILDER = process.env.PN_BILDER ?? path.join(__repo, 'pruefungen', 'ablage', 'm513');
mkdirSync(BILDER, { recursive: true });
const PORT = 5513;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  const p = q.url.split('?')[0].split('#')[0];
  let f = path.join(DIST, p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f) || statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];
const fremd = [];
async function warteBis(fn, ms = 20000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { try { if (await fn()) return true; } catch { /* weiter */ } await new Promise((x) => setTimeout(x, 200)); }
  try { return !!(await fn()); } catch { return false; }
}

// ---------- Nachgebautes Realtime ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const rt = {
  live: [],              // { ws, topic, wer }
  gesendet: new Map(),   // wer → alle an diesen Teilnehmer gesendeten Texte
  rest: [],              // { topic, event, payload }
  restAus: false,
};
const an = (l, j) => { const s = JSON.stringify(j); try { l.ws.send(s); } catch { /* zu */ } rt.gesendet.set(l.wer, (rt.gesendet.get(l.wer) ?? '') + s); };
const verteilen = (topic, event, payload, ausser = null) => {
  for (const l of rt.live) if (l.topic === topic && l !== ausser) an(l, { topic, event: 'broadcast', payload: { type: 'broadcast', event, payload }, ref: null });
};
async function dienste(ctx, wer) {
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/realtime/v1/api/broadcast' && req.method() === 'POST') {
      if (rt.restAus) return route.fulfill({ status: 404, body: '' });
      const j = JSON.parse(req.postData() ?? '{}');
      for (const m of j.messages ?? []) { rt.rest.push({ wer, ...m }); verteilen(`realtime:${m.topic}`, m.event, m.payload); }
      return route.fulfill({ status: 202, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"unbekannt"}' });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    const meine = [];
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (j.event === 'heartbeat') { ws.send(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref })); return; }
      if (j.event === 'phx_join') {
        const l = { ws, topic: j.topic, wer };
        rt.live.push(l); meine.push(l);
        ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: { postgres_changes: [] } }, ref: j.ref }));
        return;
      }
      const l = meine.find((x) => x.topic === j.topic);
      if (j.event === 'broadcast' && l) verteilen(l.topic, j.payload?.event, j.payload?.payload, l);
    });
    ws.onClose(() => { rt.live = rt.live.filter((l) => !meine.includes(l)); });
  });
}

// ---------- Gastgeber ----------
const GEHEIM = 'GEHEIM-NOTIZ-7f3a';
const t0 = Date.now();
const note = { id: 'n1', type: 'note', width: 240, position: { x: 760, y: 0 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: GEHEIM }] } };
const andereBubbles = { id: 'b2', type: 'bubbles', position: { x: 760, y: 300 }, width: 400, height: 300, data: { title: 'ANDERE-KARTE-9q', ideen: { z1: { text: 'FREMDE-IDEE-4k', von: 'g:x', t: t0 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } };
const karte = { id: 'b1', type: 'bubbles', position: { x: 0, y: 0 }, width: 680, height: 520, data: { title: 'Teamtag', frage: 'Was wünschen wir uns?', ideen: { i0: { text: 'Frühstück', von: 'g:host', name: 'Moderation', t: t0 } }, stimmen: {}, gruppen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 } } };
const stand = { boards: [{ id: 'x', name: 'Vortrag', edges: [], drawings: [], nodes: [karte, note, andereBubbles] }], spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['x'] }] }], activeId: 'x', view: 'board' };

const hctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'de-DE', permissions: ['clipboard-read', 'clipboard-write'] });
hctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith(SB_URL) && !/^(data|blob|about):/.test(u)) fremd.push(u); });
await dienste(hctx, 'host');
await hctx.addInitScript(({ st, konfig }) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
  localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  localStorage.setItem('pixinotes:author', 'Moderation');
}, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
const H = await hctx.newPage();
H.on('pageerror', (e) => { fehler.push(`host: ${e.message}`); console.log('    PAGEERROR[host]:', e.message); });
H.on('dialog', (d) => d.accept());
await H.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
const W = '.react-flow__node[data-id="b1"]';
await H.waitForSelector(`${W} [data-taste="bubbles"]`, { timeout: 30000 });
await H.locator(`${W} .bub-kopf`).click({ position: { x: 200, y: 8 } });
await H.waitForTimeout(400);
const kartenDaten = () => H.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'b1').data);
const blasenTexte = () => H.locator(`${W} [data-taste="bub-blase"] .bub-text`).allTextContents();

/** QR-Code aus einem Element lesen */
async function qrLesen(P, sel) {
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
  return jsQR(Uint8ClampedArray.from(px.d), px.w, px.h)?.data ?? null;
}

// ══ A ══
console.log('\n════ A: QR-Fenster ════');
pruefe('A1 Knopf „Mitmachen per QR" in der Karte', (await H.locator(`${W} [data-taste="bub-mitmachen"]`).count()) === 1);
await H.locator(`${W} [data-taste="bub-mitmachen"]`).click();
const fensterDa = await H.waitForSelector('[data-taste="mit-qr"]', { timeout: 10000 }).then(() => true, () => false);
pruefe('A2 Fenster „Mitmachen per QR" offen', fensterDa);
await H.waitForSelector('[data-taste="mit-qr-code"] svg', { timeout: 10000 });
const adresse = (await H.locator('[data-taste="mit-qr-adresse"]').textContent()) ?? '';
const gelesen = await qrLesen(H, '[data-taste="mit-qr-code"]');
pruefe('A3 Der gelesene Code ist der angezeigte Link', !!gelesen && gelesen === adresse, `${gelesen} / ${adresse}`);
pruefe('A4 Link führt auf die Teilnehmer-Seite (mitmachen.html#m=…&k=…)', /^http:\/\/localhost:5513\/mitmachen\.html#m=[\w-]{22}&k=[\w-]{22}(&|$)/.test(adresse), adresse);
// Ohne eigenen Server (Fassung mit vorgegebenem Server) bleibt der Link kurz — der Code gut lesbar per Bildschirmfreigabe
const kurz = adresse.replace(/&u=.*$/, '');
pruefe('A4b Link kurz (ohne Server-Angabe unter 110 Zeichen an der Web-Adresse, QR-Version 7)', kurz.replace('http://localhost:5513/', 'https://hannespix.github.io/pixinotes/').length < 110, String(kurz.length));
const d0 = await kartenDaten();
pruefe('A5 Karte vermerkt die Runde (Token, öffentlicher Schlüssel), ohne privaten Schlüssel', d0.mitmachen?.an === true && !!d0.mitmachen.token && !JSON.stringify(d0).includes('"d":"'), JSON.stringify(d0.mitmachen));
const gemerkt = await H.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-mitmachen') ?? '{}'));
pruefe('A6 Privater Schlüssel nur auf diesem Gerät gemerkt', !!gemerkt[d0.mitmachen.token]?.jwk?.d);
await H.screenshot({ path: path.join(BILDER, 'qr-fenster.png') });

// ══ B ══
console.log('\n════ B: Drei Telefone ════');
const telefone = [];
async function telefon(name, dunkel = false, url = adresse) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE', colorScheme: dunkel ? 'dark' : 'light' });
  const anfragen = [];
  ctx.on('request', (r) => { const u = r.url(); anfragen.push(u); if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith(SB_URL) && !/^(data|blob|about):/.test(u)) fremd.push(u); });
  await dienste(ctx, name);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(`${name}: ${e.message}`); console.log(`    PAGEERROR[${name}]:`, e.message); });
  await P.goto(url, { waitUntil: 'networkidle' });
  const t = { name, ctx, P, anfragen };
  telefons(t);
  return t;
}
function telefons(t) { telefone.push(t); }
const [T1, T2, T3] = [await telefon('tel1'), await telefon('tel2'), await telefon('tel3', true)];
for (const t of [T1, T2, T3]) await t.P.waitForSelector('[data-taste="mit-titel"]', { timeout: 20000 }).catch(() => {});
pruefe('B1 Telefone zeigen Titel und Frage der Karte', (await T1.P.locator('[data-taste="mit-titel"]').textContent()) === 'Teamtag' && (await T2.P.locator('[data-taste="mit-frage"]').textContent()) === 'Was wünschen wir uns?');
pruefe('B2 Kein Board am Telefon (kein React-Flow, kein Navigator, keine Notiz)', (await T1.P.locator('.react-flow, .tabs, .bn-editor').count()) === 0);
const jsGeladen = T1.anfragen.filter((u) => u.endsWith('.js')).map((u) => u.split('/').pop());
pruefe('B3 Nur die schlanken Teile geladen (kein React, Editor, Fluss)', jsGeladen.length > 0 && !jsGeladen.some((f) => /^(react|editor|fluss|index|main)-/.test(f)), jsGeladen.join(', '));
const jsBytes = jsGeladen.reduce((s, f) => s + statSync(path.join(DIST, 'assets', f)).size, 0);
console.log(`    Teilnehmer-Seite: ${jsBytes} B JS in ${jsGeladen.length} Dateien`);
pruefe('B4 Teilnehmer-Seite unter 300 KB JS', jsBytes < 300_000, String(jsBytes));
const dabei3 = await warteBis(async () => /3 Personen dabei/.test((await H.locator('[data-taste="mit-qr-dabei"]').textContent()) ?? ''), 20000);
pruefe('B5 Gastgeber zählt „3 Personen dabei"', dabei3, await H.locator('[data-taste="mit-qr-dabei"]').textContent());
await H.locator('[data-taste="mit-qr-zu"]').click();
pruefe('B6 Zustand in der Karte bleibt sichtbar („3 dabei")', await warteBis(async () => /3 dabei/.test((await H.locator(`${W} [data-taste="bub-mit-stand"]`).textContent()) ?? ''), 8000));

// ══ C ══
console.log('\n════ C: Verdeckt sammeln ════');
await H.locator(`${W} [data-taste="bub-mehr"]`).click(); await H.waitForTimeout(200);
await H.locator(`${W} [data-taste="bub-regel-verdeckt"]`).click(); await H.waitForTimeout(200);
await H.locator(`${W} [data-taste="bub-mehr"]`).click(); await H.waitForTimeout(200);
await warteBis(async () => /Verdeckt/.test((await T2.P.locator('[data-taste="mit-hinweis"]').textContent()) ?? ''), 10000);
await T1.P.locator('[data-taste="mit-name"]').fill('Ana');
await T1.P.locator('[data-taste="mit-idee"]').fill('Mehr Pausen');
await T1.P.locator('[data-taste="mit-senden"]').click();
await T2.P.locator('[data-taste="mit-idee"]').fill('Kaffee');
await T2.P.locator('[data-taste="mit-senden"]').click();
await T3.P.locator('[data-taste="mit-idee"]').fill('Kuchen');
await T3.P.locator('[data-taste="mit-senden"]').click();
// (verdeckt: auch die Moderation sieht die Texte erst nach dem Sammeln — die Karte zählt sie aber schon)
const ideenTexte = async () => Object.values((await kartenDaten()).ideen).filter((i) => !i.weg).map((i) => i.text);
const live = await warteBis(async () => { const t = await ideenTexte(); return t.includes('Mehr Pausen') && t.includes('Kaffee') && t.includes('Kuchen') && (await blasenTexte()).length === 4; }, 15000);
pruefe('C1 Ideen der Telefone erscheinen live in der Karte', live, (await ideenTexte()).join(' | '));
const d1 = await kartenDaten();
const vonAna = Object.values(d1.ideen).find((i) => i.text === 'Mehr Pausen');
pruefe('C2 Urheber „t:…" (Schlüssel-Abdruck), Name mitgenommen', /^t:[\w-]{16}$/.test(vonAna?.von ?? '') && vonAna?.name === 'Ana', JSON.stringify(vonAna));
await warteBis(async () => (await T1.P.locator('[data-taste="mit-zeile"].eigen').count()) === 1, 10000);
const t1Text = (await T1.P.locator('[data-taste="mit-liste"]').textContent()) ?? '';
const t2Text = (await T2.P.locator('[data-taste="mit-liste"]').textContent()) ?? '';
pruefe('C3 Telefon 1 sieht die eigene Idee', t1Text.includes('Mehr Pausen'));
pruefe('C4 Verdeckt: Telefon 2 sieht fremde Ideen nicht (DOM)', !t2Text.includes('Mehr Pausen') && !t2Text.includes('Kuchen') && t2Text.includes('Kaffee'), t2Text);
pruefe('C5 Verdeckt: fremde Texte gehen gar nicht erst über die Leitung', !(rt.gesendet.get('tel2') ?? '').includes('Mehr Pausen') && !(rt.gesendet.get('tel2') ?? '').includes('Kuchen'));
pruefe('C6 Hinweis „Ideen von anderen (noch verdeckt)"', /Ideen von anderen/.test((await T2.P.locator('[data-taste="mit-verdeckt"]').textContent().catch(() => '')) ?? ''));
await T3.P.screenshot({ path: path.join(BILDER, 'telefon-sammeln-dunkel.png') });
await T1.P.screenshot({ path: path.join(BILDER, 'telefon-sammeln-hell.png') });
// Idee zurückziehen
await T3.P.locator('[data-taste="mit-idee"]').fill('Zurückziehen-Test');
await T3.P.locator('[data-taste="mit-senden"]').click();
await warteBis(async () => (await ideenTexte()).includes('Zurückziehen-Test'), 10000);
await warteBis(async () => (await T3.P.locator('[data-taste="mit-zeile"]', { hasText: 'Zurückziehen-Test' }).locator('[data-taste="mit-weg-idee"]').count()) === 1, 10000);
await T3.P.locator('[data-taste="mit-zeile"]', { hasText: 'Zurückziehen-Test' }).locator('[data-taste="mit-weg-idee"]').click();
pruefe('C7 Eigene Idee zurückziehen: verschwindet aus der Karte', await warteBis(async () => !(await ideenTexte()).includes('Zurückziehen-Test'), 10000));

// ══ D: Angreifer mit echter Kryptografie ══
console.log('\n════ D: Grenzen und Fälschungen ════');
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const ausB64u = (s) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
const token = d0.mitmachen.token;
/** zuletzt gesehener Stand (vom Kanal an Telefon 1) */
const letzterStand = () => {
  const roh = rt.gesendet.get('tel1') ?? '';
  const m = [...roh.matchAll(/"event":"stand","payload":(\{"d":"(?:[^"\\]|\\.)*","s":"[\w-]+")/g)].at(-1);
  return m ? JSON.parse(JSON.parse(`${m[1]}}`).d) : null;
};
async function angreifer() {
  const p = await wc.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const pub = b64u(await wc.subtle.exportKey('raw', p.publicKey));
  const st = letzterStand();
  const host = await wc.subtle.importKey('raw', ausB64u(st.h), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const key = await wc.subtle.deriveKey({ name: 'ECDH', public: host }, p.privateKey, { name: 'AES-GCM', length: 128 }, false, ['encrypt', 'decrypt']);
  const kennung = b64u(await wc.subtle.digest('SHA-256', ausB64u(pub))).slice(0, 16);
  let n = Date.now();
  const senden = async (w, ueberPub = pub) => {
    const iv = wc.getRandomValues(new Uint8Array(12));
    const c = await wc.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ ...w, n: ++n })));
    verteilen(`realtime:pn-mit-${token}-ein`, 'op', { p: ueberPub, i: b64u(iv), c: b64u(c) });
  };
  verteilen(`realtime:pn-mit-${token}-ein`, 'hallo', { p: pub });
  return { pub, kennung, senden, von: `t:${kennung}` };
}
const ideenVon = async (von) => Object.values((await kartenDaten()).ideen).filter((i) => i.von === von && !i.weg);
const A1 = await angreifer();
await new Promise((x) => setTimeout(x, 300));
// 12 Ideen auf einmal: der Eimer lässt 8 durch
for (let i = 0; i < 12; i += 1) await A1.senden({ a: 'idee', id: `angriff${i}xx`, x: `Flut ${i}` });
await warteBis(async () => (await ideenVon(A1.von)).length >= 8, 10000);
await new Promise((x) => setTimeout(x, 1200));
pruefe('D1 Eimer: von 12 Wünschen auf einmal nimmt der Gastgeber 8 an', (await ideenVon(A1.von)).length === 8, String((await ideenVon(A1.von)).length));
// nach einer Pause: höchstens 10 Ideen je Person
await new Promise((x) => setTimeout(x, 5500));
for (let i = 12; i < 16; i += 1) { await A1.senden({ a: 'idee', id: `angriff${i}xx`, x: `Flut ${i}` }); await new Promise((x) => setTimeout(x, 150)); }
await new Promise((x) => setTimeout(x, 1500));
pruefe('D2 Höchstens 10 Ideen je Person', (await ideenVon(A1.von)).length === 10, String((await ideenVon(A1.von)).length));
const A2 = await angreifer();
await new Promise((x) => setTimeout(x, 300));
await A2.senden({ a: 'idee', id: 'langertextxx', x: 'L'.repeat(500) });
await A2.senden({ a: 'idee', id: 'anfuehrung1', x: '<img src=x onerror=alert(1)>' });
const anaId = Object.entries((await kartenDaten()).ideen).find(([, i]) => i.text === 'Mehr Pausen')[0];
await A2.senden({ a: 'weg', id: anaId });
await warteBis(async () => (await ideenVon(A2.von)).length >= 2, 10000);
const lang = (await ideenVon(A2.von)).find((i) => i.text.startsWith('LLL'));
pruefe('D3 Text auf 140 Zeichen gekürzt', lang?.text.length === 140, String(lang?.text.length));
pruefe('D4 Fremde Idee löschen geht nicht', !(await kartenDaten()).ideen[anaId].weg);
await warteBis(async () => (await T1.P.locator('[data-taste="mit-liste"]').count()) === 1, 3000);
pruefe('D5 Spitze Klammern bleiben Text (kein eingefügtes Bild am Gastgeber)', (await H.locator(`${W} img[src="x"]`).count()) === 0);
// Gefälschter Absender: Schlüssel von Telefon 1 vorgeben, aber mit eigenem Geheimnis verschlüsseln
const tel1Pub = rt.rest.find((m) => m.wer === 'tel1' && m.event === 'hallo')?.payload?.p;
const vorher = Object.keys((await kartenDaten()).ideen).length;
await A2.senden({ a: 'idee', id: 'gefaelschtxx', x: 'Untergeschoben' }, tel1Pub);
await new Promise((x) => setTimeout(x, 1500));
pruefe('D6 Wunsch unter fremdem Schlüssel wird verworfen', !!tel1Pub && Object.keys((await kartenDaten()).ideen).length === vorher && !Object.values((await kartenDaten()).ideen).some((i) => i.text === 'Untergeschoben'));
// Gefälschter Stand
verteilen(`realtime:pn-mit-${token}`, 'stand', { d: JSON.stringify({ ...letzterStand(), z: Date.now() + 1e9, ti: 'GEFÄLSCHT' }), s: 'AAAA' });
await new Promise((x) => setTimeout(x, 1200));
pruefe('D7 Gefälschter Stand (falsche Signatur) erscheint nicht', (await T1.P.locator('[data-taste="mit-titel"]').textContent()) === 'Teamtag');

// ══ E ══
console.log('\n════ E: Gruppieren ════');
await H.locator(`${W} [data-taste="bub-schritt"][data-schritt="gruppieren"]`).click();
pruefe('E1 Telefone: Schritt Gruppieren, keine Eingabe', await warteBis(async () => (await T1.P.locator('[data-taste="mit-schritte"]').getAttribute('data-schritt')) === 'gruppieren' && !(await T1.P.locator('[data-taste="mit-eingabe"]').isVisible()), 10000));
pruefe('E2 Nach dem Sammeln sind alle Texte sichtbar', await warteBis(async () => { const t = (await T2.P.locator('[data-taste="mit-liste"]').textContent()) ?? ''; return t.includes('Mehr Pausen') && t.includes('Kuchen'); }, 10000));
const nVorE = Object.keys((await kartenDaten()).ideen).length;
await A2.senden({ a: 'idee', id: 'zuspaetxx1', x: 'Zu spät' });
await new Promise((x) => setTimeout(x, 1500));
pruefe('E3 Idee nach Sammlungsende wird abgelehnt', Object.keys((await kartenDaten()).ideen).length === nVorE);

// ══ F ══
console.log('\n════ F: Abstimmen ════');
await H.locator(`${W} [data-taste="bub-mehr"]`).click(); await H.waitForTimeout(200);
await H.locator(`${W} [data-taste="bub-regel-still"]`).click(); await H.waitForTimeout(200);
await H.locator(`${W} [data-taste="bub-mehr"]`).click(); await H.waitForTimeout(200);
await H.locator(`${W} [data-taste="bub-schritt"][data-schritt="abstimmen"]`).click();
await warteBis(async () => (await T1.P.locator('[data-taste="mit-plus"]').count()) > 0, 10000);
const zeileVon = (P, text) => P.locator('[data-taste="mit-zeile"]', { hasText: text }).first();
await zeileVon(T1.P, 'Kaffee').locator('[data-taste="mit-plus"]').click();
await warteBis(async () => (await zeileVon(T1.P, 'Kaffee').locator('[data-taste="mit-meine"]').textContent()) === '1', 5000);
await zeileVon(T1.P, 'Kaffee').locator('[data-taste="mit-plus"]').click();
await zeileVon(T2.P, 'Kaffee').locator('[data-taste="mit-plus"]').click();
await zeileVon(T3.P, 'Mehr Pausen').locator('[data-taste="mit-plus"]').click();
// (Zwischenstand verborgen: auch die Moderation sieht die Punkte erst beim Auswerten — gezählt wird in den Daten)
const punkteIn = async (text) => { const d = await kartenDaten(); const ids = Object.entries(d.ideen).filter(([, i]) => i.text === text).map(([k]) => k); return Object.entries(d.stimmen).filter(([k]) => ids.includes(k.split('|')[0])).reduce((s, [, v]) => s + v.n, 0); };
pruefe('F1 Punkte der Telefone kommen in der Karte an', await warteBis(async () => (await punkteIn('Kaffee')) === 3 && (await punkteIn('Mehr Pausen')) === 1, 15000), `${await punkteIn('Kaffee')} / ${await punkteIn('Mehr Pausen')}`);
await warteBis(async () => (await zeileVon(T1.P, 'Kaffee').locator('[data-taste="mit-meine"]').textContent()) === '2', 8000);
pruefe('F2 Telefon zeigt eigene Punkte und den Rest', /Noch 1 von 3/.test((await T1.P.locator('[data-taste="mit-hinweis"]').textContent()) ?? ''));
pruefe('F3 Zwischenstand verborgen: Telefon 3 sieht keine fremden Punkte', (await T3.P.locator('[data-taste="mit-punkte"]').count()) === 0 && !/"p":\d/.test((rt.gesendet.get('tel3') ?? '').split('"s":"abstimmen"').slice(1).join('')));
const kaffeeId = Object.entries((await kartenDaten()).ideen).find(([, i]) => i.text === 'Kaffee')[0];
for (let i = 0; i < 5; i += 1) { await A2.senden({ a: 'plus', id: kaffeeId }); await new Promise((x) => setTimeout(x, 150)); }
await new Promise((x) => setTimeout(x, 1500));
const a2Punkte = Object.entries((await kartenDaten()).stimmen).filter(([k]) => k.endsWith(`|${A2.von}`)).reduce((s, [, v]) => s + v.n, 0);
pruefe('F4 Budget gilt beim Gastgeber (3 von 5 Punkten angenommen)', a2Punkte === 3, String(a2Punkte));
await T1.P.screenshot({ path: path.join(BILDER, 'telefon-abstimmen-hell.png') });
await T3.P.screenshot({ path: path.join(BILDER, 'telefon-abstimmen-dunkel.png') });

// ══ G ══
console.log('\n════ G: Ergebnis ════');
await H.locator(`${W} [data-taste="bub-schritt"][data-schritt="ergebnis"]`).click();
pruefe('G1 Ergebnis am Telefon: „Kaffee" auf Platz 1', await warteBis(async () => {
  const z = T2.P.locator('[data-taste="mit-zeile"]').first();
  return (await z.locator('[data-taste="mit-platz"]').textContent().catch(() => '')) === '1.' && /Kaffee/.test((await z.textContent()) ?? '');
}, 10000));
pruefe('G2 Punkte im Ergebnis sichtbar', /6 Punkte/.test((await T2.P.locator('[data-taste="mit-liste"]').textContent()) ?? ''));
await T1.P.screenshot({ path: path.join(BILDER, 'telefon-ergebnis-hell.png') });
await T3.P.screenshot({ path: path.join(BILDER, 'telefon-ergebnis-dunkel.png') });

// ══ H ══
console.log('\n════ H: Bühne und Beenden ════');
await H.locator(`${W} .bub-kopf`).click({ position: { x: 200, y: 8 } });
await H.locator(`${W} [data-taste="bub-mit-stand"]`).click();
await H.waitForSelector('[data-taste="mit-qr"]');
await H.locator('[data-taste="mit-qr-buehne"]').click();
await H.locator('[data-taste="mit-qr-zu"]').click();
await H.waitForSelector(`${W} [data-taste="bub-mit-buehne"] svg`, { timeout: 10000 }).catch(() => {});
const buehneCode = await qrLesen(H, `${W} [data-taste="bub-mit-buehne"] [data-taste="mit-qr-code"]`).catch(() => null);
pruefe('H1 Code groß auf der Bühne der Karte, lesbar', buehneCode === adresse, String(buehneCode));
await H.screenshot({ path: path.join(BILDER, 'buehne.png') });
await H.locator(`${W} [data-taste="bub-mit-stand"]`).click();
await H.waitForSelector('[data-taste="mit-qr"]');
await H.locator('[data-taste="mit-qr-beenden"]').click();
pruefe('H2 Telefone: „Runde beendet"', await warteBis(async () => (await T1.P.locator('[data-taste="mit-ende"]').count()) === 1 && (await T3.P.locator('[data-taste="mit-ende"]').count()) === 1, 10000));
pruefe('H3 Karte: Runde aus, Bühne weg, Schlüssel vergessen', await warteBis(async () => (await kartenDaten()).mitmachen?.an === false && (await H.locator(`${W} [data-taste="bub-mit-buehne"]`).count()) === 0
  && !(await H.evaluate((t) => !!JSON.parse(localStorage.getItem('pixinotes-mitmachen') ?? '{}')[t], token)), 8000));
const T4 = await telefon('tel4');
pruefe('H4 Alter Link: freundliche Meldung („beendet" oder „nicht offen")', await warteBis(async () => (await T4.P.locator('[data-taste="mit-weg"], [data-taste="mit-ende"]').count()) === 1, 25000));
const kaputt = await telefon('tel5', false, `http://localhost:${PORT}/mitmachen.html#m=abc`);
pruefe('H5 Kaputter Link: Hinweis statt Fehler', await warteBis(async () => (await kaputt.P.locator('[data-taste="mit-kaputt"]').count()) === 1, 8000));

// ══ I ══
console.log('\n════ I: Abgrenzung, Aussehen ════');
const alles = [...rt.gesendet.entries()].filter(([w]) => w.startsWith('tel')).map(([, s]) => s).join('');
pruefe('I1 Board-Inhalte nie auf der Leitung zu den Telefonen (Notiz, andere Karte, deren Idee)', alles.length > 0 && !alles.includes(GEHEIM) && !alles.includes('ANDERE-KARTE-9q') && !alles.includes('FREMDE-IDEE-4k'));
const dom = (await Promise.all(telefone.map((t) => t.P.content()))).join('');
pruefe('I2 … und nicht im DOM der Telefone', !dom.includes(GEHEIM) && !dom.includes('ANDERE-KARTE-9q'));
const hell = await T1.P.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
const dunkelT = await T3.P.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
pruefe('I3 Hell und Dunkel folgen dem Gerät', hell[0] === 'light' && dunkelT[0] === 'dark' && lum(hell[1]) > 200 && lum(dunkelT[1]) < 60, JSON.stringify([hell, dunkelT]));
// Kontraste: eine frische Runde, damit Liste, Eingabe und Schritte zu sehen sind
await H.locator(`${W} .bub-kopf`).click({ position: { x: 200, y: 8 } });
await H.locator(`${W} [data-taste="bub-schritt"][data-schritt="sammeln"]`).click();
await H.locator(`${W} [data-taste="bub-mitmachen"]`).click();
await H.waitForSelector('[data-taste="mit-qr-adresse"]');
const adresse2 = (await H.locator('[data-taste="mit-qr-adresse"]').textContent()) ?? '';
pruefe('I4 Neue Runde: neuer Link', adresse2 !== adresse && adresse2.includes('mitmachen.html'));
const qrFenster = await kontrastScan(H, '[data-taste="mit-qr"] .qr-karte');
pruefe('I5 Kontrast im QR-Fenster ≥ 4,5:1', qrFenster.length === 0, qrFenster.map(trefferZeile).join('\n'));
await H.locator('[data-taste="mit-qr-zu"]').click();
for (const [name, dunkel] of [['hell', false], ['dunkel', true]]) {
  const t = await telefon(`kontrast-${name}`, dunkel, adresse2);
  await t.P.waitForSelector('[data-taste="mit-liste"]', { timeout: 15000 }).catch(() => {});
  const k = await kontrastScan(t.P, '.mit');
  pruefe(`I6 Kontrast Teilnehmer-Seite (${name}) ≥ 4,5:1`, k.length === 0, k.map(trefferZeile).join('\n'));
}
// Look des Boards im Link (M509): Thema und pix·el gelten auch auf einem hell eingestellten Telefon
{
  const t = await telefon('look', false, adresse2.replace('#', '#t=dark&d=pixel&'));
  await t.P.waitForSelector('[data-taste="mit-liste"]', { timeout: 15000 }).catch(() => {});
  const [th, de] = await t.P.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.dataset.design]);
  pruefe('I8 Mitgegebener Look (dunkel, pix·el) gilt auf der Teilnehmer-Seite', th === 'dark' && de === 'pixel', `${th} ${de}`);
  const k = await kontrastScan(t.P, '.mit');
  pruefe('I9 Kontrast im Look pix·el dunkel ≥ 4,5:1', k.length === 0, k.map(trefferZeile).join('\n'));
  await t.P.screenshot({ path: path.join(BILDER, 'telefon-pixel-dunkel.png') });
}
pruefe('I7 Keine fremden Dienste', fremd.length === 0, fremd.slice(0, 5).join(', '));

// ══ J ══
console.log('\n════ J: Hilfe, Englisch, Datei ════');
const help = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
const helpEn = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
pruefe('J1 Hilfe DE und EN erklären „Mitmachen per QR"', /Mitmachen per QR/.test(help) && /Join via QR/.test(helpEn));
const en = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
pruefe('J2 Englische Texte für Knopf und Fenster', !!en['Mitmachen per QR'] && !!en['Mitmachen beenden'] && !!en['Groß auf der Bühne zeigen']);
pruefe('J3 Meilenstein-Datei', existsSync(path.join(__repo, 'docs/meilensteine/M513-bubbles-qr.md')));
pruefe('J4 Keine Seitenfehler', fehler.length === 0, fehler.join(' | '));

await browser.close();
app.close();
console.log(`\nM513: ${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
