/**
 * M543 — Ideabubbles: Wirbel, solange die KI gruppiert.
 *
 * Wunsch des Besitzers: „ideen bubbles brauchen noch eine animation wenn sie neu gruppiert werden durch KI (zb alles
 * dreht sich solange KI rechnet oder so". Die KI ist nachgebaut (abgefangene Anfrage an `…/chat/completions`, Antwort
 * nach einigen Sekunden) — kein echter Anbieter. Gemessen wird Verhalten: Ein MutationObserver schreibt jede neue Lage
 * jeder Blase mit der Bildzeit mit (wie m496); Hinweis, Daten im Speicher und Toast werden in der Seite gelesen.
 *
 *   A  Während die KI rechnet: Hinweis „KI gruppiert …" in der Karte (lesbar, Kontrast), die Blasen kreisen sichtbar
 *      um die Mitte (alle bewegen sich, gleicher Drehsinn) — auch noch nach mehr als fünf Sekunden (sonst kommt die
 *      Bühne nach fünf Sekunden zur Ruhe); die alten Gruppennamen treten zurück; „KI gruppiert" steht in der Karte.
 *   B  Ergebnis: Hinweis weg, Wirbel aus, die neuen Gruppen sind da (Daten und Namen); die Blasen erreichen sie über
 *      viele Bilder (kein Satz macht mehr als die Hälfte des Wegs) und kommen zur Ruhe; danach rechnet nichts mehr.
 *      Strg+Z nimmt das Gruppieren zurück, ohne dass der Wirbel wiederkommt.
 *   C  Fehler: Die KI liefert Unbrauchbares → Toast wie bisher, Wirbel aus, die Gruppen bleiben, die Blasen kehren an
 *      ihren Platz zurück (Mitte je Gruppe wie vorher).
 *   D  Bewegung reduzieren: kein Wirbel (die Blasen stehen), nur der Hinweis; das Ergebnis erscheint ohne Flug.
 *   E  Außerhalb des Bildes: Liegt die Karte nicht im Bild, rechnet der Wirbel nicht; zurück im Bild kreist es weiter.
 *   F  Zweites Gerät: Eine Karte mit dem Eintrag „KI gruppiert" eines anderen Geräts kreist auch hier (mit Hinweis)
 *      und hört nach der Höchstdauer von selbst auf; ein alter Eintrag kreist nicht.
 *   L  Logik (esbuild): Der Eintrag reist im Drei-Wege-Abgleich mit (jüngster gewinnt, kein Konflikt), die Gestalt-
 *      Prüfung behält ihn und wirft Kaputtes weg.
 *   H  Hilfe (de/en), Meilenstein-Datei, keine Seitenfehler.
 */
// Läuft aus dem Repository: `node pruefungen/m543-bubbles-ki-wirbel.mjs`
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { kontrastScan, trefferZeile } from '../werkzeug/kontrast-pruefen.mjs';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const SRC = process.env.M543_SRC ?? path.join(__repo, 'src');
const PORT = 5543;
const BILDER = process.env.M543_BILDER ?? '';
const nur = (process.argv[2] ?? '').toUpperCase();
const will = (t) => !nur || nur.includes(t);
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 600) : JSON.stringify(info).slice(0, 600)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

// Zwei Gruppen, neun Ideen — die KI soll sie in drei neue Gruppen ordnen
const IDEEN = [['Pizza', 'g1'], ['Kuchen', 'g1'], ['Apfel', 'g1'], ['Strand', 'g2'], ['Berge', 'g2'], ['Zug fahren', 'g2'], ['Meeting', null], ['Bericht', null], ['Kaffee', null]];
const NEU = ['Essen', 'Reisen', 'Büro'];
const karteVon = (t, mitKi) => {
  const ideen = {};
  IDEEN.forEach(([x, g], i) => { ideen['i' + i] = { text: x, von: 'g:' + (i % 3), name: 'Anna', t, ...(g ? { g } : {}) }; });
  return { id: 'b1', type: 'bubbles', position: { x: 40, y: 40 }, width: 680, height: 470,
    data: { title: 'Ideen', frage: 'Was planen wir?', ideen, stimmen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 },
      gruppen: { g1: { name: 'Allerlei', farbe: 0, t }, g2: { name: 'Draußen', farbe: 1, t } }, ...(mitKi ? { ki: mitKi } : {}) } };
};

/**
 * Seite öffnen. `ki`: Eintrag „KI gruppiert" in der Karte ({ alter: ms } — relativ zur Uhr der Seite);
 * `wirbelMs`: Höchstdauer des fremden Wirbels (kürzer für die Prüfung).
 */
async function auf({ reduziert = false, ki = null, wirbelMs = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', reducedMotion: reduziert ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(([IDEEN0, kiRoh, ms]) => {
    if (ms) window.__pnKiWirbelMs = ms;
    if (localStorage.getItem('pixinotes-board')) return;
    const t = Date.now() - 60_000;
    const ideen = {};
    IDEEN0.forEach(([x, g], i) => { ideen['i' + i] = { text: x, von: 'g:' + (i % 3), name: 'Anna', t, ...(g ? { g } : {}) }; });
    const ki = kiRoh ? { an: true, t: Date.now() - kiRoh.alter, von: 'andere-sitzung' } : null;
    const karte = { id: 'b1', type: 'bubbles', position: { x: 40, y: 40 }, width: 680, height: 470,
      data: { title: 'Ideen', frage: 'Was planen wir?', ideen, stimmen: {}, abstimmung: { phase: 'aus', punkte: 3, t: 0 },
        gruppen: { g1: { name: 'Allerlei', farbe: 0, t }, g2: { name: 'Draußen', farbe: 1, t } }, ...(ki ? { ki } : {}) } };
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'x', name: 'Workshop', edges: [], drawings: [], comments: [], nodes: [karte] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['x'] }] }], activeId: 'x', view: 'board',
      cardFocus: false, navLinks: false, clickZoom: false, physicsEnabled: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' }, brain: { on: false, provider: 'auto' } } }));
  }, [IDEEN, ki, wirbelMs]);
  // Spur: jede neue Lage jeder Blase mit der Bildzeit; Wechsel der Klasse „wirbelt" an der Karte
  await ctx.addInitScript(() => {
    const s = { blasen: {}, wirbelAn: [], wirbelAus: [], an: true };
    window.__m543 = s;
    const tr = /translate\(([-\d.]+)px, ([-\d.]+)px\)/;
    let war = false;
    new MutationObserver((ms) => {
      if (!s.an) return;
      const T = document.timeline.currentTime;
      for (const m of ms) {
        const n = m.target; const cl = n.classList; if (!cl) continue;
        if (m.attributeName === 'class' && cl.contains('bub')) {
          const jetzt = cl.contains('wirbelt');
          if (jetzt && !war) s.wirbelAn.push(T); if (!jetzt && war) s.wirbelAus.push(T);
          war = jetzt; continue;
        }
        if (!cl.contains('bub-blase')) continue;
        const mm = tr.exec(n.style.transform); if (!mm) continue;
        const r = (parseFloat(n.style.width) || 0) / 2;
        const p = (s.blasen[n.dataset.id] ??= []); const x = +mm[1] + r; const y = +mm[2] + r; const l = p.at(-1);
        if (!l || Math.abs(l[0] - x) > 0.01 || Math.abs(l[1] - y) > 0.01) p.push([x, y, T]);   // nur neue Lagen (Breite und Schrift schreiben mit)
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  });
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  const ki0 = { anfragen: 0 };
  return { ctx, P, ki0, starten: async () => {
    await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    await P.waitForSelector('.bub-blase', { timeout: 30000 });
  } };
}
/** Die KI nachbauen: antwortet nach `ms` mit drei Gruppen (oder mit Unbrauchbarem) */
async function kiNachbauen(S, { ms, kaputt = false }) {
  await S.P.route('**/chat/completions', async (route) => {
    S.ki0.anfragen += 1;
    const body = JSON.parse(route.request().postData() ?? '{}');
    const c = body.messages?.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n') ?? '';
    const n = (c.match(/^\d+\. /gm) ?? []).length || IDEEN.length;
    const gruppen = NEU.map((name, gi) => ({ name, ideen: Array.from({ length: n }, (_, i) => i + 1).filter((i) => (i - 1) % 3 === gi) }));
    await new Promise((x) => setTimeout(x, ms));
    const inhalt = kaputt ? 'Tut mir leid, das kann ich nicht.' : JSON.stringify(gruppen);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: inhalt }, finish_reason: 'stop' }] }) }).catch(() => {});
  });
}
const kiStarten = async (P) => P.evaluate(() => {
  document.querySelector('[data-taste="bub-mehr"]')?.click();
  return new Promise((x) => setTimeout(() => {
    const b = [...document.querySelectorAll('.bub-menue button')].find((e) => e.textContent.includes('Mit KI gruppieren'));
    b?.click(); x(!!b);
  }, 120));
});
const jetzt = (P) => P.evaluate(() => document.timeline.currentTime);
const spur = (P) => P.evaluate(() => JSON.parse(JSON.stringify(window.__m543)));
const hinweis = (P) => P.evaluate(() => { const h = document.querySelector('[data-taste="bub-ki-hinweis"]'); return h ? h.textContent.trim() : null; });
const karteDaten = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes.find((n) => n.id === 'b1').data);
const buehne = (P) => P.evaluate(() => { const b = document.querySelector('.bub-buehne'); return { w: b.offsetWidth, h: b.offsetHeight }; });
/** wartet, bis sich `still` ms (Bildzeit) keine Blase bewegt hat — höchstens 25 s */
const stillBis = async (P, still = 1500) => P.waitForFunction((st) => {
  const s = window.__m543; let letzte = 0;
  for (const p of Object.values(s.blasen)) if (p.length) letzte = Math.max(letzte, p.at(-1)[2]);
  return document.timeline.currentTime - letzte > st;
}, still, { timeout: 25000, polling: 200 });
/** Lage jeder Blase zum Zeitpunkt T (die letzte geschriebene davor) */
const lageBei = (s, T) => Object.fromEntries(Object.entries(s.blasen).map(([k, p]) => { const q = [...p].reverse().find((x) => x[2] <= T) ?? p[0]; return [k, q]; }));
/** Weg und Drehung je Blase zwischen T0 und T1 um die Mitte (w/2, h/2) */
function bewegung(s, T0, T1, m) {
  const a = lageBei(s, T0); const b = lageBei(s, T1);
  const aus = [];
  for (const k of Object.keys(a)) {
    const p = s.blasen[k].filter((x) => x[2] >= T0 && x[2] <= T1);
    let weg = 0; let dreh = 0; let vor = a[k];
    for (const q of p) {
      weg += Math.hypot(q[0] - vor[0], q[1] - vor[1]);
      let d = Math.atan2(q[1] - m.y, q[0] - m.x) - Math.atan2(vor[1] - m.y, vor[0] - m.x);
      if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      dreh += d; vor = q;
    }
    aus.push({ k, weg, dreh, n: p.length, ende: b[k] });
  }
  return aus;
}
/** Mitte je Gruppe (aus den Blasen im DOM) */
const gruppenMitte = (P) => P.evaluate(() => {
  const m = {};
  for (const b of document.querySelectorAll('.bub-blase')) {
    const g = b.dataset.gruppe ?? '-'; const r = b.getBoundingClientRect();
    (m[g] ??= { x: 0, y: 0, n: 0 }); m[g].x += r.x + r.width / 2; m[g].y += r.y + r.height / 2; m[g].n += 1;
  }
  return Object.fromEntries(Object.entries(m).map(([g, v]) => [g, { x: v.x / v.n, y: v.y / v.n }]));
});
const bild = async (P, name) => { if (BILDER) await P.locator('.react-flow__node-bubbles').screenshot({ path: path.join(BILDER, name) }).catch(() => {}); };

// ══ A + B: Wirbel, Ergebnis ═══════════════════════════════════════════
if (will('A') || will('B')) {
  console.log('\nA  Während die KI rechnet: Hinweis und Wirbel');
  const S = await auf();
  await kiNachbauen(S, { ms: 7000 });
  await S.starten();
  await stillBis(S.P);
  const m = await buehne(S.P);
  const mitte = { x: m.w / 2, y: m.h / 2 };
  const T0 = await jetzt(S.P);
  pruefe('A0 der Menüpunkt „Mit KI gruppieren" ist da und startet', await kiStarten(S.P));
  const h = await S.P.waitForSelector('[data-taste="bub-ki-hinweis"]', { timeout: 3000 }).then(() => hinweis(S.P)).catch(() => null);
  pruefe('A1 in der Karte steht „KI gruppiert …"', h === 'KI gruppiert …', String(h));
  const kont = await kontrastScan(S.P, '[data-taste="bub-ki-hinweis"]').catch(() => [{ v: 0, farbe: '-', grund: '-', text: 'Hinweis fehlt', pfad: '' }]);
  pruefe('A2 der Hinweis ist lesbar (Kontrast ≥ 4,5:1)', kont.length === 0, kont.map(trefferZeile).join(' | '));
  await S.P.waitForTimeout(2600);
  await bild(S.P, 'm543-wirbel.png');
  const T1 = await jetzt(S.P);
  const bw = bewegung(await spur(S.P), T0 + 1000, T1, mitte);
  const bewegt = bw.filter((x) => x.weg > 25);
  const sinn = bw.filter((x) => x.dreh > 0.12).length; const gegen = bw.filter((x) => x.dreh < -0.12).length;
  pruefe('A3 alle Blasen bewegen sich, während die KI rechnet (je > 25 Punkte in 1,6 s)', bewegt.length === IDEEN.length, bw.map((x) => `${x.k}:${x.weg.toFixed(0)}`).join(' '));
  pruefe('A4 … und kreisen um die Mitte, alle im selben Drehsinn', Math.max(sinn, gegen) >= IDEEN.length - 1 && Math.min(sinn, gegen) === 0, bw.map((x) => `${x.k}:${x.dreh.toFixed(2)}`).join(' '));
  const namenWeg = await S.P.evaluate(() => [...document.querySelectorAll('.bub-ring-name')].every((n) => getComputedStyle(n).opacity === '0'));
  pruefe('A5 die Namen der alten Gruppen treten zurück', namenWeg);
  const kiDaten = await S.P.waitForFunction(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.ki?.an === true, null, { timeout: 5000 }).then(() => true).catch(() => false);
  pruefe('A6 „KI gruppiert" steht in der Karte (für die anderen Geräte)', kiDaten);
  // nach mehr als fünf Sekunden kreist es noch (ohne Wirbel stünde die Bühne dann still)
  await S.P.waitForFunction((t) => document.timeline.currentTime - t > 5600, T0, { timeout: 15000 });
  const T2 = await jetzt(S.P);
  const spaet = bewegung(await spur(S.P), T2 - 500, T2, mitte).filter((x) => x.weg > 4);
  pruefe('A7 nach über fünf Sekunden kreisen die Blasen weiter (die KI rechnet noch)', spaet.length >= IDEEN.length - 1 && (await hinweis(S.P)) !== null, `${spaet.length} bewegt`);

  console.log('\nB  Ergebnis: neue Gruppen, die Blasen fließen hinein');
  await S.P.waitForFunction(() => !document.querySelector('[data-taste="bub-ki-hinweis"]'), null, { timeout: 20000 }).catch(() => {});
  pruefe('B1 der Hinweis verschwindet mit der Antwort', (await hinweis(S.P)) === null);
  await S.P.waitForFunction(() => { const d = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data; return Object.values(d.gruppen).filter((g) => !g.weg).length === 3; }, null, { timeout: 10000 }).catch(() => {});
  const d = await karteDaten(S.P);
  const lebend = Object.entries(d.gruppen).filter(([, g]) => !g.weg);
  const namen = lebend.map(([, g]) => g.name).sort();
  pruefe('B2 drei neue Gruppen mit den Namen der KI, jede Idee in einer davon, die alten aufgelöst', namen.join('|') === [...NEU].sort().join('|') && Object.values(d.ideen).every((i) => lebend.some(([gid]) => gid === i.g)) && d.gruppen.g1?.weg && d.gruppen.g2?.weg, namen);
  pruefe('B3 „KI gruppiert" ist in der Karte wieder aus', d.ki && d.ki.an === false, d.ki);
  await stillBis(S.P);
  await bild(S.P, 'm543-gruppiert.png');
  const s = await spur(S.P);
  const Taus = s.wirbelAus.at(-1);
  pruefe('B4 der Wirbel hört mit der Antwort auf', s.wirbelAn.length >= 1 && typeof Taus === 'number', `${s.wirbelAn.length}/${s.wirbelAus.length}`);
  // Flug: über viele Bilder, kein Satz macht mehr als die Hälfte des Wegs
  const flug = Object.entries(s.blasen).map(([k, p]) => {
    const nach = p.filter((x) => x[2] >= (Taus ?? 0));
    const start = lageBei(s, Taus ?? 0)[k];
    const ende = nach.at(-1) ?? start;
    const weit = Math.hypot(ende[0] - start[0], ende[1] - start[1]);
    let satz = 0; let vor = start;
    // je 16,7 ms (wie m496): Fällt ein Bild aus (die App holt bis 100 ms nach), zählt der Weg anteilig
    let wo = "";
    for (const q of nach) { const st = Math.hypot(q[0] - vor[0], q[1] - vor[1]) / Math.max(1, (q[2] - vor[2]) / 16.7); if (st > satz) { satz = st; wo = `bei +${(q[2] - (Taus ?? 0)).toFixed(0)} ms (${(q[2] - vor[2]).toFixed(0)} ms seit der vorigen Lage, von ${vor[0].toFixed(0)},${vor[1].toFixed(0)} nach ${q[0].toFixed(0)},${q[1].toFixed(0)})`; } vor = q; }
    return { k, weit, satz, n: nach.length, wo };
  });
  const weite = flug.filter((f) => f.weit > 30);
  pruefe('B5 die Blasen ziehen zu ihren neuen Gruppen (mindestens fünf legen über 30 Punkte zurück)', weite.length >= 5, flug.map((f) => `${f.k}:${f.weit.toFixed(0)}`).join(' '));
  const spruenge = weite.filter((f) => f.n < 8 || f.satz > f.weit / 2);
  pruefe('B6 … über viele Bilder, ohne Sprung (je mind. 8 Lagen, kein Bild mehr als die Hälfte des Wegs)', weite.length > 0 && spruenge.length === 0, spruenge.map((f) => `${f.k}: ${f.n} Lagen, Satz ${f.satz.toFixed(0)} von ${f.weit.toFixed(0)} ${f.wo}`).join(' | '));
  const namenDa = await S.P.evaluate(() => [...document.querySelectorAll('.bub-ring-name')].map((n) => [n.textContent, getComputedStyle(n).opacity]));
  pruefe('B7 die Namen der neuen Gruppen stehen sichtbar über ihnen', namenDa.length === 3 && namenDa.every(([, o]) => o === '1'), namenDa);
  // danach rechnet nichts mehr
  const vorRuhe = Object.values((await spur(S.P)).blasen).reduce((a, p) => a + p.length, 0);
  await S.P.waitForTimeout(1500);
  const nachRuhe = Object.values((await spur(S.P)).blasen).reduce((a, p) => a + p.length, 0);
  pruefe('B8 danach steht die Bühne (keine neue Lage in 1,5 s)', nachRuhe === vorRuhe, `${nachRuhe - vorRuhe} neue Lagen`);
  // Strg+Z nimmt das Gruppieren zurück — ohne Wirbel
  await S.P.mouse.click(1200, 820);
  await S.P.keyboard.press('Control+z');
  await S.P.waitForFunction(() => { const d0 = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data; return d0.gruppen.g1 && !d0.gruppen.g1.weg; }, null, { timeout: 6000 }).catch(() => {});
  const zurueck = await karteDaten(S.P);
  await S.P.waitForTimeout(600);
  pruefe('B9 Strg+Z: die alten Gruppen sind zurück, kein Wirbel, kein Hinweis', zurueck.gruppen.g1 && !zurueck.gruppen.g1.weg && (await hinweis(S.P)) === null && (await spur(S.P)).wirbelAn.length === 1 && zurueck.ki?.an !== true, { g1: zurueck.gruppen.g1, ki: zurueck.ki });
  await S.ctx.close();
}

// ══ C: Fehler ═══════════════════════════════════════════════════════
if (will('C')) {
  console.log('\nC  Fehler: Wirbel aus, die Blasen kehren zurück');
  const S = await auf();
  await kiNachbauen(S, { ms: 2500, kaputt: true });
  await S.starten();
  await stillBis(S.P);
  const vorher = await gruppenMitte(S.P);
  const m = await buehne(S.P);
  const T0 = await jetzt(S.P);
  await S.P.evaluate(() => {
    window.__m543toasts = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) window.__m543toasts.push(t.textContent); }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await kiStarten(S.P);
  await S.P.waitForTimeout(2000);
  const T1 = await jetzt(S.P);
  const bw = bewegung(await spur(S.P), T0 + 600, T1, { x: m.w / 2, y: m.h / 2 });
  pruefe('C1 auch hier kreist es, solange die KI rechnet', bw.filter((x) => x.weg > 15).length >= IDEEN.length - 1, bw.map((x) => x.weg.toFixed(0)).join(' '));
  await S.P.waitForFunction(() => (window.__m543toasts ?? []).some((t) => t.includes('keine brauchbaren Gruppen')), null, { timeout: 12000 }).catch(() => {});
  const toasts = await S.P.evaluate(() => window.__m543toasts);
  pruefe('C2 Toast wie bisher', toasts.some((t) => t.includes('keine brauchbaren Gruppen')), toasts.slice(-2));
  await S.P.waitForTimeout(300);
  pruefe('C3 Hinweis weg, Wirbel aus', (await hinweis(S.P)) === null && (await spur(S.P)).wirbelAus.length === 1);
  // der Speicher schreibt verzögert — auf den Stand warten
  await S.P.waitForFunction(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data.ki?.an === false, null, { timeout: 6000 }).catch(() => {});
  const d = await karteDaten(S.P);
  pruefe('C4 die Gruppen bleiben, wie sie waren; „KI gruppiert" ist aus', d.gruppen.g1 && !d.gruppen.g1.weg && d.gruppen.g2 && !d.gruppen.g2.weg && d.ki?.an === false, { g: Object.keys(d.gruppen), ki: d.ki });
  await stillBis(S.P);
  const nachher = await gruppenMitte(S.P);
  const ab = Object.keys(vorher).map((g) => [g, Math.hypot(vorher[g].x - (nachher[g]?.x ?? 1e9), vorher[g].y - (nachher[g]?.y ?? 1e9))]);
  pruefe('C5 die Blasen kehren an ihren Platz zurück (Mitte je Gruppe höchstens 30 Punkte daneben)', ab.every(([, a]) => a < 30), ab.map(([g, a]) => `${g}:${a.toFixed(0)}`).join(' '));
  await S.ctx.close();
}

// ══ D: Bewegung reduzieren ═════════════════════════════════════════
if (will('D')) {
  console.log('\nD  Bewegung reduzieren: nur der Hinweis, kein Flug');
  const S = await auf({ reduziert: true });
  await kiNachbauen(S, { ms: 2500 });
  await S.starten();
  await S.P.waitForTimeout(800);
  const vor = Object.fromEntries(Object.entries((await spur(S.P)).blasen).map(([k, p]) => [k, p.length]));
  await kiStarten(S.P);
  const h = await S.P.waitForSelector('[data-taste="bub-ki-hinweis"]', { timeout: 3000 }).then(() => hinweis(S.P)).catch(() => null);
  pruefe('D1 der Hinweis steht da', h === 'KI gruppiert …', String(h));
  await S.P.waitForTimeout(1500);
  const waehrend = Object.entries((await spur(S.P)).blasen).filter(([k, p]) => p.length !== vor[k]);
  pruefe('D2 kein Wirbel: die Blasen stehen, während die KI rechnet', waehrend.length === 0 && !(await S.P.evaluate(() => !!document.querySelector('.bub.wirbelt'))), waehrend.map(([k]) => k));
  await S.P.waitForFunction(() => { const d = JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0].nodes[0].data; return Object.values(d.gruppen).filter((g) => !g.weg).length === 3; }, null, { timeout: 10000 }).catch(() => {});
  await S.P.waitForTimeout(800);
  const s = await spur(S.P);
  const neu = Object.entries(s.blasen).map(([k, p]) => p.length - vor[k]);
  pruefe('D3 das Ergebnis erscheint ohne Flug (je Blase höchstens zwei neue Lagen)', neu.every((n) => n <= 2) && (await hinweis(S.P)) === null && (await S.P.locator('.bub-ring-name').count()) === 3, neu.join(' '));
  await S.ctx.close();
}

// ══ E: außerhalb des Bildes ═════════════════════════════════════════
if (will('E')) {
  console.log('\nE  Außerhalb des Bildes rechnet der Wirbel nicht');
  const S = await auf();
  await kiNachbauen(S, { ms: 12000 });
  await S.starten();
  await stillBis(S.P);
  await kiStarten(S.P);
  await S.P.waitForSelector('[data-taste="bub-ki-hinweis"]', { timeout: 3000 }).catch(() => {});
  await S.P.waitForTimeout(800);
  // die Fläche wegschieben, bis die Karte ganz aus dem Bild ist
  await S.P.mouse.move(1380, 860); await S.P.mouse.down();
  for (let i = 1; i <= 12; i++) await S.P.mouse.move(1380 - i * 110, 860 - i * 5);
  await S.P.mouse.up();
  const draussen = await S.P.evaluate(() => { const r = document.querySelector('.react-flow__node-bubbles').getBoundingClientRect(); return r.right < -120 || r.left > innerWidth + 120 || r.bottom < -120 || r.top > innerHeight + 120; });
  await S.P.waitForTimeout(500);
  const z0 = Object.values((await spur(S.P)).blasen).reduce((a, p) => a + p.length, 0);
  await S.P.waitForTimeout(1500);
  const z1 = Object.values((await spur(S.P)).blasen).reduce((a, p) => a + p.length, 0);
  pruefe('E1 die Karte ist aus dem Bild, und dort bewegt sich nichts (keine neue Lage in 1,5 s)', draussen && z1 === z0, `draußen=${draussen} ${z1 - z0} neue Lagen`);
  await S.P.mouse.move(60, 815); await S.P.mouse.down();
  for (let i = 1; i <= 12; i++) await S.P.mouse.move(60 + i * 110, 815 + i * 5);
  await S.P.mouse.up();
  await S.P.waitForTimeout(1200);
  const z2 = Object.values((await spur(S.P)).blasen).reduce((a, p) => a + p.length, 0);
  pruefe('E2 zurück im Bild kreist es weiter', z2 - z1 > IDEEN.length * 5 && (await hinweis(S.P)) !== null, `${z2 - z1} neue Lagen`);
  await S.ctx.close();
}

// ══ F: zweites Gerät ═════════════════════════════════════════════════
if (will('F')) {
  console.log('\nF  Ein anderes Gerät gruppiert mit der KI');
  const S = await auf({ ki: { alter: 500 }, wirbelMs: 4000 });
  await S.starten();
  const h = await S.P.waitForSelector('[data-taste="bub-ki-hinweis"]', { timeout: 5000 }).then(() => hinweis(S.P)).catch(() => null);
  pruefe('F1 der Eintrag des anderen Geräts zeigt hier „KI gruppiert …"', h === 'KI gruppiert …', String(h));
  await S.P.waitForTimeout(1500);
  const T = await jetzt(S.P);
  const m = await buehne(S.P);
  const bw = bewegung(await spur(S.P), T - 1000, T, { x: m.w / 2, y: m.h / 2 });
  pruefe('F2 … und die Blasen kreisen auch hier', bw.filter((x) => x.weg > 10).length >= IDEEN.length - 1 && !!(await S.P.evaluate(() => document.querySelector('.bub.wirbelt'))), bw.map((x) => x.weg.toFixed(0)).join(' '));
  await S.P.waitForFunction(() => !document.querySelector('[data-taste="bub-ki-hinweis"]'), null, { timeout: 9000 }).catch(() => {});
  pruefe('F3 nach der Höchstdauer hört es von selbst auf (das andere Gerät könnte abgestürzt sein)', (await hinweis(S.P)) === null && !(await S.P.evaluate(() => document.querySelector('.bub.wirbelt'))));
  await stillBis(S.P);
  pruefe('F4 … und die Bühne kommt zur Ruhe', true);
  await S.ctx.close();
  const S2 = await auf({ ki: { alter: 30 * 60_000 }, wirbelMs: 4000 });
  await S2.starten();
  await S2.P.waitForTimeout(1500);
  pruefe('F5 ein alter Eintrag (vor 30 Minuten) kreist nicht', (await hinweis(S2.P)) === null && !(await S2.P.evaluate(() => document.querySelector('.bub.wirbelt'))));
  await S2.ctx.close();
}

// ══ L: Logik ═════════════════════════════════════════════════════════
if (will('L')) {
  console.log('\nL  Abgleich und Gestalt');
  const ordner = mkdtempSync(path.join(tmpdir(), 'm543-'));
  const bauen = (q, z) => { execFileSync(path.join(__repo, 'node_modules/.bin/esbuild'), [path.join(SRC, q), '--bundle', '--format=esm', '--platform=node', `--outfile=${z}`, '--log-level=error'], { env: { ...process.env, NODE_PATH: path.join(__repo, 'node_modules') } }); return import(pathToFileURL(z).href); };
  const { dreiWegeMerge } = await bauen('lib/syncMerge.ts', path.join(ordner, 'merge.mjs'));
  const { karteGestalt } = await bauen('lib/sicherGestalt.ts', path.join(ordner, 'gestalt.mjs'));
  const spaces = [{ id: 's', name: 'S', projects: [{ id: 'p', name: 'P', boardIds: ['b'] }] }];
  const stand = (nodes) => ({ boards: [{ id: 'b', name: 'B', edges: [], nodes }], spaces });
  const t = 1_000_000;
  const karte = (ki) => karteVon(t, ki);
  {
    const erg = dreiWegeMerge(stand([karte(null)]), stand([karte(null)]), stand([karte({ an: true, t: t + 10, von: 'a' })]));
    const k = erg.boards[0].nodes[0];
    pruefe('L1 drüben gruppiert die KI → hier kommt „KI gruppiert" an, ohne Konflikt', k.data.ki?.an === true && erg.bericht.konflikte === 0, { ki: k.data.ki, konflikte: erg.bericht.konflikte });
  }
  {
    // hier schon fertig (jünger), drüben noch der Start → aus gewinnt, auf beiden Wegen
    const an = { an: true, t: t + 10, von: 'a' }; const aus = { an: false, t: t + 20, von: 'a' };
    const e1 = dreiWegeMerge(stand([karte(null)]), stand([karte(aus)]), stand([karte(an)]));
    const e2 = dreiWegeMerge(stand([karte(null)]), stand([karte(an)]), stand([karte(aus)]));
    pruefe('L2 der jüngere Eintrag gewinnt (aus nach an), gleich in welcher Richtung, ohne Konflikt', e1.boards[0].nodes[0].data.ki?.an === false && e2.boards[0].nodes[0].data.ki?.an === false && !e1.bericht.konflikte && !e2.bericht.konflikte, [e1.boards[0].nodes[0].data.ki, e2.boards[0].nodes[0].data.ki]);
  }
  {
    // hier eine neue Idee, drüben gruppiert die KI → beides
    const hier = karte(null); hier.data.ideen.neu = { text: 'Neue Idee', von: 'g:9', t: t + 5 };
    const erg = dreiWegeMerge(stand([karte(null)]), stand([hier]), stand([karte({ an: true, t: t + 10, von: 'a' })]));
    const k = erg.boards[0].nodes[0];
    pruefe('L3 hier eine Idee, drüben „KI gruppiert" → beides bleibt', !!k.data.ideen.neu && k.data.ki?.an === true && !erg.bericht.konflikte, { ideen: Object.keys(k.data.ideen), ki: k.data.ki });
  }
  {
    const gut = karteGestalt(karte({ an: true, t: t + 10, von: 'a' }));
    const kaputt = karteGestalt({ ...karte(null), data: { ...karte(null).data, ki: 'kaputt' } });
    pruefe('L4 die Gestalt-Prüfung behält den Eintrag und wirft Kaputtes weg', gut.data.ki?.an === true && !('ki' in kaputt.data), { gut: gut.data.ki, kaputt: kaputt.data.ki });
  }
}

// ══ H: Hilfe, Datei, Fehler ═══════════════════════════════════════════
if (will('H')) {
  console.log('\nH  Hilfe, Meilenstein, Seitenfehler');
  const de = readFileSync(path.join(__repo, 'src/components/HelpOverlay.tsx'), 'utf8');
  const en = readFileSync(path.join(__repo, 'src/components/HelpOverlayEn.tsx'), 'utf8');
  pruefe('H1 „Was ist neu" nennt M543 auf Deutsch und Englisch', de.includes('(M543)') && en.includes('(M543)'));
  pruefe('H2 Meilenstein-Datei vorhanden', existsSync(path.join(__repo, 'docs/meilensteine/M543-bubbles-ki-wirbel.md')));
  const sprache = JSON.parse(readFileSync(path.join(__repo, 'src/sprache/en.json'), 'utf8'));
  pruefe('H3 der Hinweis hat eine englische Fassung', !!sprache['KI gruppiert …']);
  pruefe('H4 keine Seitenfehler', fehler.length === 0, fehler.slice(0, 3).join(' | '));
}

await browser.close();
app.close();
console.log(`\n${ok} grün, ${bad} rot`);
process.exit(bad ? 1 : 0);
