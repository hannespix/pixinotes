/**
 * M478 — Eingang: eine Ablage für alles, was von außen kommt.
 *
 * Erweiterung („An PixiNotes senden", M458) und Android-Teilen (M290) legten ihr Gesendetes sofort aufs offene Board
 * bzw. fragten mitten in der Arbeit nach dem Ziel. Jetzt warten sie im Eingang (Einstellung, Vorgabe an), bis man sie
 * einsortiert. Gebaut als verstecktes System-Board — darum prüft die Reihe auch, dass es nirgends als Board auftaucht.
 *
 * Die Erweiterung wird genau so nachgestellt, wie ihr Skript im PixiNotes-Tab spricht: warten auf die Bereit-Marke,
 * dann `postMessage({ typ: 'pixinotes-erweiterung', … })` ans eigene Fenster (m458 prüft die Erweiterung selbst).
 * Teilen läuft echt über den Service Worker (POST an ./teilen-ziel, wie m290).
 *
 *   A  Erweiterung: kein Dialog, Eintrag im Eingang, Zähler „Eingang 1" in der Spalte, offenes Board unberührt.
 *   B  Teilen: Foto + Text = EIN Eintrag mit zwei Karten, Zähler 2, Geräte-Ablage geleert.
 *   C  Unsichtbar als Board: nicht im Baum, nicht in der Übersicht (Kacheln, Netz), nicht in den Reitern,
 *      nicht in der Zielwahl; nie das aktive Board, Präsentieren zeigt nichts daraus.
 *   D  Liste: Vorschau (Bild, Text, Herkunft); Strg+K findet den Eintrag und öffnet die Liste bei ihm.
 *   E  Aufs Board: Karte liegt im sichtbaren Ausschnitt des offenen Boards, ohne Marke; Strg+Z legt sie zurück.
 *   F  Anderes Ziel: „Einsortieren in" Urlaub → Karten dort, man steht danach auf Urlaub.
 *   G  Mehrere: alle wählen → löschen (mit Rückgängig) → zwei wählen → aufs Board; leer = kein Zähler, keine Liste.
 *   H  Ziehen aus der Liste aufs Board: Karte liegt dort, wo losgelassen wurde.
 *   I  Option aus: Empfangs-Dialog wie früher; „ohne Rückfrage" der Erweiterung geht immer direkt aufs Board.
 *   J  Abgleich über den Ordner: Am Telefon gesendet → am PC im Eingang; dort einsortiert → am Telefon leer.
 *      Normale Boards im Sync-Stand ohne neue Felder.
 *   L  „Alles sichern" (M476) nimmt den Eingang mit; Einspielen als Kopie oder Ersetzen hängt ihn in kein Projekt.
 *   K  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m478-eingang.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { extname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5478;
const APP = `http://localhost:${PORT}/`;

const typen = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const app = http.createServer((q, r) => {
  const p = q.url.split('?')[0];
  let f = join(DIST, p === '/' ? 'index.html' : p.slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': typen[extname(f)] ?? 'application/octet-stream', 'Service-Worker-Allowed': '/' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); }
};
const fehler = [];
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

const notiz = (id, text, x = 60, y = 60) => ({ id, type: 'note', width: 300, height: 160, position: { x, y }, data: { color: 'yellow', blocks: [{ id: `p-${id}`, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] }] } });
const START = {
  boards: [
    { id: 'b0', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [notiz('n1', 'Sammelnotiz')] },
    { id: 'b1', name: 'Urlaub', edges: [], drawings: [], comments: [], nodes: [] },
  ],
  spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Alltag', boardIds: ['b0', 'b1'] }] }],
  activeId: 'b0', view: 'board',
};

/** Ein Gerät. `ordner`: Node-seitiger „Cloud-Ordner" (Muster m311) für den Abgleich */
async function geraet({ viewport = { width: 1400, height: 900 }, sammeln = null, stand = START, ordner = null, name = '' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  if (ordner) {
    await ctx.exposeFunction('__fsLesen', (n) => ordner.get(n) ?? null);
    await ctx.exposeFunction('__fsSchreiben', (n, text) => { ordner.set(n, { text, lastModified: Date.now() }); });
    await ctx.exposeFunction('__fsListe', () => [...ordner.keys()]);
    await ctx.exposeFunction('__fsEntfernen', (n) => { ordner.delete(n); });
  }
  await ctx.addInitScript(([st, sammeln, mitOrdner]) => {
    if (mitOrdner) {
      const datei = (n) => ({
        kind: 'file', name: n,
        async getFile() {
          const e = await window.__fsLesen(n);
          if (!e) throw new DOMException('weg', 'NotFoundError');
          return new File([e.text], n, { lastModified: e.lastModified, type: 'application/json' });
        },
        async createWritable() {
          let buf = '';
          return { async write(d) { buf += typeof d === 'string' ? d : await new Response(d).text(); }, async close() { await window.__fsSchreiben(n, buf); } };
        },
      });
      const dir = {
        kind: 'directory', name: 'Nextcloud/PixiNotes',
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        async getFileHandle(n, o) { if (!(await window.__fsLesen(n)) && !o?.create) throw new DOMException('weg', 'NotFoundError'); return datei(n); },
        async *values() { for (const n of await window.__fsListe()) yield { kind: 'file', name: n }; },
        async removeEntry(n) { await window.__fsEntfernen(n); },
      };
      window.showDirectoryPicker = async () => dir;
    }
    if (sammeln !== null) localStorage.setItem('pixinotes-eingang-sammeln', sammeln);
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand, sammeln, !!ordner]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(`${name}: ${e.message}`); console.log('    PAGEERROR:', e.message); });
  P.on('dialog', (d) => d.accept());
  await P.goto(APP, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P };
}

/** Wie das Skript der Erweiterung im PixiNotes-Tab: auf „bereit" warten, dann ans eigene Fenster schicken */
const senden = (P, sendung) => P.evaluate(async (s) => {
  for (let i = 0; i < 100 && document.documentElement.dataset.pixinotesEingang !== 'bereit'; i += 1) await new Promise((r) => setTimeout(r, 50));
  window.postMessage({ typ: 'pixinotes-erweiterung', id: `t-${Math.random()}`, sendung: { v: 1, ...s } }, location.origin);
  await new Promise((r) => setTimeout(r, 900));
}, sendung);
const seite = (titel, text, adresse = 'https://example.org/artikel') => ({ art: 'seite', titel, text, adresse });

/** Genau das, was Android schickt: multipart-POST an ./teilen-ziel (der Service Worker nimmt es an) */
const teilen = (P, text) => P.evaluate(async (text) => {
  await navigator.serviceWorker.ready;
  const fd = new FormData();
  const c = document.createElement('canvas'); c.width = 300; c.height = 200;
  const x = c.getContext('2d'); x.fillStyle = '#0a7d40'; x.fillRect(0, 0, 300, 200);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  fd.append('dateien', new File([blob], 'urlaubsfoto.png', { type: 'image/png' }));
  fd.append('titel', 'Geteilter Titel'); fd.append('text', text);
  const a = await fetch('./teilen-ziel', { method: 'POST', body: fd, redirect: 'follow' });
  return a.url;
}, text);

const zustand = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const eingang = async (P) => (await zustand(P)).boards.find((b) => b.id === 'pixinotes-eingang');
const zaehler = (P) => P.evaluate(() => {
  const k = document.querySelector('.tabs.spalte [data-taste="eingang"]');
  return k ? Number(k.querySelector('.tab-badge')?.textContent ?? 'NaN') : 0;
});
const gruppen = (b) => new Set((b?.nodes ?? []).map((n) => n.data?.eingang?.gruppe ?? n.id)).size;
async function warteBis(P, fn, ms = 6000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(250); }
  return fn();
}
const liste = (P) => P.locator('[data-taste="eingang-liste"]');
const oeffnen = async (P) => { await P.locator('.tabs.spalte [data-taste="eingang"]').click(); await P.waitForTimeout(500); };

const { ctx, P } = await geraet({ name: 'haupt' });

// ══ A: Erweiterung → Eingang ═════════════════════════════════════════
console.log('════ A: Aus dem Browser ════');
{
  pruefe('A0 ohne Eintrag kein Knopf „Eingang" (die Spalte bleibt wie vorher)', (await zaehler(P)) === 0);
  await senden(P, seite('Fährplan Amrum', 'Die Fähre fährt stündlich ab Dagebüll.'));
  pruefe('A1 kein Empfangs-Dialog mitten in der Arbeit', (await P.locator('.geteilt-modal').count()) === 0);
  const toast = await P.locator('.toast').textContent();
  pruefe('A2 eine kurze Meldung sagt, wo es liegt', /Eingang/.test(toast ?? ''), toast);
  await P.waitForTimeout(800);
  const st = await zustand(P);
  const eb = st.boards.find((b) => b.id === 'pixinotes-eingang');
  pruefe('A3 der Eintrag liegt im Eingang (System-Board)', eb?.system === 'eingang' && eb.nodes.length === 1 && eb.nodes[0].type === 'note', JSON.stringify(eb && { system: eb.system, n: eb.nodes.length }));
  pruefe('A4 mit echtem Verweis auf die Seite', JSON.stringify(eb?.nodes[0]?.data.blocks ?? []).includes('"href":"https://example.org/artikel"'));
  pruefe('A5 das offene Board bleibt unberührt', st.activeId === 'b0' && st.boards.find((b) => b.id === 'b0').nodes.length === 1);
  pruefe('A6 der Eingang steht in keinem Projekt', !st.spaces.some((sp) => sp.projects.some((p) => p.boardIds.includes('pixinotes-eingang'))));
  pruefe('A7 Zähler in der Spalte: 1', (await zaehler(P)) === 1, String(await zaehler(P)));
  const lage = await P.evaluate(() => {
    const a = document.querySelector('.tabs.spalte .tab-tasks[data-taste="aufgaben"]')?.getBoundingClientRect();
    const e = document.querySelector('.tabs.spalte [data-taste="eingang"]')?.getBoundingClientRect();
    return a && e ? { a: Math.round(a.bottom), e: Math.round(e.top), l: Math.round(e.left - a.left) } : null;
  });
  pruefe('A8 … direkt unter „Aufgaben"', !!lage && Math.abs(lage.e - lage.a) < 8 && Math.abs(lage.l) < 2, JSON.stringify(lage));
  pruefe('A9 kein neuer Knopf auf dem Board (Dock unverändert)', (await P.locator('.dock [data-taste="eingang"], .react-flow [data-taste="eingang"]').count()) === 0);
}

// ══ B: Teilen → Eingang ═════════════════════════════════════════════
console.log('\n════ B: Android-Teilen ════');
{
  const url = await teilen(P, 'Fotos vom Strand');
  pruefe('B0 der Service Worker leitet in die App', /\?geteilt=1$/.test(url), url);
  await P.goto(`${APP}?geteilt=1`, { waitUntil: 'networkidle' });
  await warteBis(P, async () => gruppen(await eingang(P)) === 2, 6000);
  pruefe('B1 kein Empfangs-Dialog', (await P.locator('.geteilt-modal').count()) === 0);
  const eb = await eingang(P);
  const neu = eb.nodes.filter((n) => n.data.eingang?.herkunft === 'teilen');
  pruefe('B2 Foto und Text = EIN Eintrag mit zwei Karten', neu.length === 2 && new Set(neu.map((n) => n.data.eingang.gruppe)).size === 1
    && neu.some((n) => n.type === 'image') && neu.some((n) => n.type === 'note'), JSON.stringify(neu.map((n) => n.type)));
  pruefe('B3 Zähler: 2', (await zaehler(P)) === 2, String(await zaehler(P)));
  const rest = await P.evaluate(() => new Promise((ok) => {
    const a = indexedDB.open('pixinotes-geteilt', 1);
    a.onsuccess = () => { const g = a.result.transaction('eingang', 'readonly').objectStore('eingang').get('letztes'); g.onsuccess = () => ok(g.result ?? null); g.onerror = () => ok('fehler'); };
    a.onerror = () => ok('fehler');
  }));
  pruefe('B4 die Geräte-Ablage des Teilens ist geleert (kein zweites Mal beim Neuladen)', rest === null);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  pruefe('B5 nach dem Neuladen weiter genau zwei Einträge', gruppen(await eingang(P)) === 2 && (await zaehler(P)) === 2);
}

// ══ C: Nirgends als Board ════════════════════════════════════════════
console.log('\n════ C: Kein Board unter Boards ════');
{
  const baum = await P.evaluate(() => document.querySelector('.tabs.spalte')?.innerText ?? '');
  pruefe('C1 nicht im Baum (auch nicht unter „Ohne Projekt")', !/Ohne Projekt/.test(baum) && (await P.locator('.tabs.spalte .side-board', { hasText: 'Eingang' }).count()) === 0, baum.slice(0, 200));
  await P.locator('.tabs.spalte .tab-home').click(); await P.waitForTimeout(1500);
  const ov = await P.evaluate(() => document.querySelector('.react-flow')?.innerText ?? document.body.innerText);
  pruefe('C2 keine Kachel in der Übersicht', /Schreibtisch/.test(ov) && !/Eingang\s*\n?\s*\d+\s*Karte/.test(ov) && (await P.locator('.ovc-tile', { hasText: 'Eingang' }).count()) === 0, ov.slice(0, 160));
  await P.locator('.ov-mode button', { hasText: 'Netz' }).click(); await P.waitForTimeout(2500);
  const netz = await P.evaluate(() => document.querySelector('.ov-graph')?.textContent ?? '');
  pruefe('C3 keine Kugel im Netz', /Schreibtisch/.test(netz) && !/Eingang/.test(netz), netz.slice(0, 200));
  await P.locator('.tabs.spalte .side-board', { hasText: 'Schreibtisch' }).first().click(); await P.waitForTimeout(900);
  // Reiter gibt es ohne Spalte (schmaler Schirm)
  const schmal = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await schmal.addInitScript((st) => { localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: { ...st, navLinks: false } })); }, await zustand(P));
  const S = await schmal.newPage(); await S.goto(APP, { waitUntil: 'networkidle' }); await S.waitForTimeout(1500);
  const reiter = await S.evaluate(() => [...document.querySelectorAll('.tabs-scroll .tab')].map((t) => t.textContent.trim()));
  pruefe('C4 keine Reiter (Board-Leiste) für den Eingang', reiter.length >= 2 && !reiter.some((r) => /Eingang/.test(r)), JSON.stringify(reiter));
  await schmal.close();
  // Zielwahl „In Board verschieben" der Auswahl-Leiste und Tastatur Strg+Tab
  await P.locator('.react-flow__node').first().click(); await P.waitForTimeout(400);
  const wahlTexte = await P.evaluate(() => document.body.innerText);
  pruefe('C5 Auswahl-Leiste zeigt keinen Eingang', !/Eingang\s+Alltag/.test(wahlTexte));
  await P.keyboard.press('Escape');
  await P.locator('.dock button[aria-label="Mehr"]').click(); await P.waitForTimeout(250);
  await P.locator('.dock-menu button', { hasText: 'Präsentieren' }).first().click(); await P.waitForTimeout(1500);
  const vortrag = await P.evaluate(() => document.body.innerText);
  pruefe('C6 Präsentieren zeigt nichts aus dem Eingang', !/Fährplan|Strand/.test(vortrag), vortrag.slice(0, 120));
  await P.keyboard.press('Escape'); await P.waitForTimeout(800);
  pruefe('C7 nie das aktive Board', (await zustand(P)).activeId !== 'pixinotes-eingang');
}

// ══ D: Liste und Suche ═══════════════════════════════════════════════
console.log('\n════ D: Liste mit Vorschau, Strg+K ════');
{
  await oeffnen(P);
  pruefe('D1 die Liste geht auf, das Board bleibt sichtbar (keine Abdunkelung)', (await liste(P).count()) === 1 && (await P.locator('.modal-backdrop').count()) === 0);
  const eintraegeTexte = await P.locator('.eingang-eintrag').allInnerTexts();
  pruefe('D2 zwei Einträge, neueste zuerst (Teilen vor Browser)', eintraegeTexte.length === 2 && /Geteilt/.test(eintraegeTexte[0]) && /Aus dem Browser/.test(eintraegeTexte[1]), JSON.stringify(eintraegeTexte));
  pruefe('D3 Vorschau: das Foto als Bild, der Text als erste Zeile', (await P.locator('.eingang-eintrag').first().locator('img').count()) === 1 && /Fährplan Amrum/.test(eintraegeTexte[1]));
  pruefe('D4 „2 Karten" am geteilten Eintrag', /2 Karten/.test(eintraegeTexte[0]), eintraegeTexte[0]);
  await P.screenshot({ path: `${SD}/m478-liste.png` });
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  pruefe('D5 Esc schließt die Liste', (await liste(P).count()) === 0);
  await P.keyboard.press('Control+k'); await P.waitForTimeout(400);
  await P.keyboard.type('Dagebüll'); await P.waitForTimeout(600);
  const treffer = await P.evaluate(() => document.querySelector('.search-box')?.innerText ?? '');
  pruefe('D6 Strg+K findet den Eintrag (Board „Eingang")', /Eingang/.test(treffer) && /Fährplan/.test(treffer), treffer.slice(0, 200));
  await P.keyboard.press('Enter'); await P.waitForTimeout(900);
  pruefe('D7 … und öffnet die Liste bei ihm statt das System-Board', (await liste(P).count()) === 1 && (await P.locator('.eingang-eintrag.gesucht', { hasText: 'Fährplan' }).count()) === 1 && (await zustand(P)).activeId === 'b0');
}

// ══ E: Aufs Board, Undo ══════════════════════════════════════════════
console.log('\n════ E: Aufs Board holen ════');
{
  await P.locator('.eingang-eintrag', { hasText: 'Fährplan' }).locator('[data-taste="eingang-holen"]').click();
  await P.waitForTimeout(1200);
  const st = await zustand(P);
  const b0 = st.boards.find((b) => b.id === 'b0');
  const karte = b0.nodes.find((n) => JSON.stringify(n.data.blocks ?? []).includes('Dagebüll'));
  pruefe('E1 die Karte liegt auf dem offenen Board', !!karte && b0.nodes.length === 2);
  pruefe('E2 ohne Eingangs-Marke (eine ganz normale Karte)', !!karte && !('eingang' in karte.data));
  const box = await P.evaluate((id) => {
    const el = [...document.querySelectorAll('.react-flow__node')].find((n) => n.dataset.id === id);
    const f = document.querySelector('.react-flow').getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    return r ? { drin: r.left >= f.left && r.top >= f.top && r.right <= f.right && r.bottom <= f.bottom } : null;
  }, karte?.id);
  pruefe('E3 im sichtbaren Ausschnitt (nicht irgendwo bei 0/0)', !!box?.drin, JSON.stringify(box));
  pruefe('E4 … ohne die vorhandene Karte zu überdecken', !!karte && !(Math.abs(karte.position.x - 60) < 300 && Math.abs(karte.position.y - 60) < 160), JSON.stringify(karte?.position));
  pruefe('E5 Zähler: 1', (await zaehler(P)) === 1);
  await P.locator('.react-flow__pane').click({ position: { x: 600, y: 600 } }); await P.waitForTimeout(200);
  await P.keyboard.press('Control+z'); await P.waitForTimeout(900);
  const st2 = await zustand(P);
  pruefe('E6 Strg+Z: die Karte ist wieder weg vom Board …', st2.boards.find((b) => b.id === 'b0').nodes.length === 1, String(st2.boards.find((b) => b.id === 'b0').nodes.length));
  pruefe('E7 … und zurück im Eingang (Zähler 2), man bleibt auf dem Board', gruppen(st2.boards.find((b) => b.id === 'pixinotes-eingang')) === 2 && (await zaehler(P)) === 2 && st2.activeId === 'b0');
}

// ══ F: Anderes Ziel ══════════════════════════════════════════════════
console.log('\n════ F: Einsortieren in ein anderes Board ════');
{
  if (!(await liste(P).count())) await oeffnen(P);
  await P.locator('[data-taste="eingang-ziel"]').selectOption({ label: 'Urlaub' });
  await P.locator('.eingang-eintrag', { hasText: 'Strand' }).locator('[data-taste="eingang-holen"]').click();
  await P.waitForTimeout(1500);
  const st = await zustand(P);
  const urlaub = st.boards.find((b) => b.id === 'b1');
  pruefe('F1 Foto und Text liegen auf „Urlaub"', urlaub.nodes.some((n) => n.type === 'image') && urlaub.nodes.some((n) => n.type === 'note'), JSON.stringify(urlaub.nodes.map((n) => n.type)));
  pruefe('F2 man steht danach auf „Urlaub"', st.activeId === 'b1', st.activeId);
  pruefe('F3 die Anordnung der Sendung bleibt (Text rechts neben dem Foto)', (() => {
    const bild = urlaub.nodes.find((n) => n.type === 'image'); const t = urlaub.nodes.find((n) => n.type === 'note');
    return bild && t && t.position.x > bild.position.x && Math.abs(t.position.y - bild.position.y) < 5;
  })());
}

// ══ G: Mehrere auf einmal ════════════════════════════════════════════
console.log('\n════ G: Mehrere ════');
{
  for (const [t, x] of [['Rezept Linsensuppe', 'Linsen, Karotten, Lauch'], ['Bahn-Auskunft', 'ICE 597 ab 8:14'], ['Mietvertrag Garage', 'Kündigungsfrist drei Monate']]) {
    await senden(P, seite(t, x));
  }
  await warteBis(P, async () => (await zaehler(P)) === 4);
  pruefe('G1 Zähler: 4 (der Fährplan wartet noch)', (await zaehler(P)) === 4, String(await zaehler(P)));
  if (!(await liste(P).count())) await oeffnen(P);
  await P.locator('[data-taste="eingang-alle"]').check(); await P.waitForTimeout(200);
  pruefe('G2 „Alle" wählt alle vier', (await P.locator('.eingang-eintrag.gewaehlt').count()) === 4);
  await P.locator('[data-taste="eingang-loeschen-wahl"]').click(); await P.waitForTimeout(900);
  pruefe('G3 gelöscht: kein Zähler, keine Liste mehr (leer = nichts anzeigen)', (await zaehler(P)) === 0 && (await liste(P).count()) === 0 && gruppen(await eingang(P)) === 0);
  await P.locator('.toast-undo').click(); await P.waitForTimeout(900);
  pruefe('G4 „Rückgängig" holt alle vier zurück', (await zaehler(P)) === 4 && gruppen(await eingang(P)) === 4, String(await zaehler(P)));
  await oeffnen(P);
  await P.locator('[data-taste="eingang-ziel"]').selectOption({ label: 'Schreibtisch' });
  await P.locator('.eingang-eintrag', { hasText: 'Linsensuppe' }).locator('[data-taste="eingang-wahl"]').check();
  await P.locator('.eingang-eintrag', { hasText: 'Bahn-Auskunft' }).locator('[data-taste="eingang-wahl"]').check();
  await P.locator('[data-taste="eingang-holen-wahl"]').click(); await P.waitForTimeout(1300);
  const st = await zustand(P);
  const b0 = st.boards.find((b) => b.id === 'b0');
  const texte = JSON.stringify(b0.nodes.map((n) => n.data.blocks));
  pruefe('G5 zwei gewählte zusammen aufs Board „Schreibtisch"', st.activeId === 'b0' && /Linsensuppe/.test(texte) && /ICE 597/.test(texte) && !/Garage/.test(texte));
  const [a, b] = b0.nodes.filter((n) => /Linsensuppe|ICE 597/.test(JSON.stringify(n.data.blocks)));
  pruefe('G6 nebeneinander statt übereinander', !!a && !!b && Math.abs(a.position.x - b.position.x) >= 280, JSON.stringify([a?.position, b?.position]));
  pruefe('G7 Zähler: 2', (await zaehler(P)) === 2);
}

// ══ H: Ziehen ════════════════════════════════════════════════════════
console.log('\n════ H: Aus der Liste aufs Board ziehen ════');
{
  if (!(await liste(P).count())) await oeffnen(P);
  const quelle = P.locator('.eingang-eintrag', { hasText: 'Garage' });
  const fl = await P.locator('.react-flow').boundingBox();
  const ziel = { x: Math.round(fl.x + 260), y: Math.round(fl.y + fl.height - 220) };
  await quelle.dragTo(P.locator('.react-flow__pane'), { targetPosition: { x: ziel.x - fl.x, y: ziel.y - fl.y } });
  await P.waitForTimeout(1200);
  const st = await zustand(P);
  const karte = st.boards.find((b) => b.id === 'b0').nodes.find((n) => /Garage/.test(JSON.stringify(n.data.blocks)));
  const r = karte && await P.evaluate((id) => {
    const el = [...document.querySelectorAll('.react-flow__node')].find((n) => n.dataset.id === id);
    const b = el?.getBoundingClientRect(); return b ? { x: Math.round(b.left), y: Math.round(b.top) } : null;
  }, karte.id);
  pruefe('H1 die gezogene Karte liegt auf dem Board', !!karte);
  pruefe('H2 genau dort, wo losgelassen wurde', !!r && Math.abs(r.x - ziel.x) < 12 && Math.abs(r.y - ziel.y) < 12, JSON.stringify({ r, ziel }));
  pruefe('H3 Zähler: 1', (await zaehler(P)) === 1);
  await P.screenshot({ path: `${SD}/m478-gezogen.png` });
}

// ══ I: Option aus / ohne Rückfrage ═══════════════════════════════════
console.log('\n════ I: Einstellung und „ohne Rückfrage" ════');
{
  await senden(P, { art: 'auswahl', titel: '', text: 'Gleich aufs Board bitte', adresse: '', direkt: true });
  await P.waitForTimeout(600);
  let st = await zustand(P);
  pruefe('I1 „ohne Rückfrage" der Erweiterung bleibt direkt aufs offene Board', /Gleich aufs Board/.test(JSON.stringify(st.boards.find((b) => b.id === st.activeId).nodes.map((n) => n.data.blocks))) && (await zaehler(P)) === 1);
  await P.keyboard.press('Escape');
  await P.locator('button[title^="Einstellungen"]').click(); await P.waitForTimeout(600);
  const schalter = P.locator('[data-taste="eingang-sammeln"]');
  pruefe('I2 die Einstellung steht unter Bedienung und ist an', (await schalter.count()) === 1 && (await schalter.isChecked()));
  await schalter.uncheck(); await P.waitForTimeout(200);
  await P.keyboard.press('Escape'); await P.waitForTimeout(500);
  await senden(P, seite('Wetterbericht', 'Morgen Regen.'));
  pruefe('I3 aus: der Empfangs-Dialog fragt wie früher nach dem Ziel', (await P.locator('.geteilt-modal').count()) === 1 && (await zaehler(P)) === 1);
  await P.locator('.geteilt-verwerfen').click(); await P.waitForTimeout(400);
  st = await zustand(P);
  pruefe('I4 Verwerfen lässt im Eingang nichts zurück', gruppen(st.boards.find((b) => b.id === 'pixinotes-eingang')) === 1);
  await P.evaluate(() => localStorage.setItem('pixinotes-eingang-sammeln', '1'));
}

// ══ L: Sicherung (M476) ═════════════════════════════════════════════
console.log('\n════ L: Alles sichern und einspielen ════');
{
  function unzip(buf) {
    let e = buf.length - 22;
    while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e -= 1;
    const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
    const out = new Map();
    for (let i = 0; i < n; i++) {
      const meth = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20);
      const nl = buf.readUInt16LE(p + 28); const xl = buf.readUInt16LE(p + 30); const cl = buf.readUInt16LE(p + 32);
      const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8'); const lo = buf.readUInt32LE(p + 42);
      const start = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
      const roh = buf.subarray(start, start + csize);
      out.set(name, meth === 8 ? inflateRawSync(roh) : Buffer.from(roh));
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  const datenReiter = async (G) => {
    await G.keyboard.press('Escape'); await G.waitForTimeout(200);
    await G.keyboard.press('Alt+e'); await G.waitForSelector('.modal-tabs');
    await G.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await G.waitForTimeout(300);
  };
  await datenReiter(P);
  const [d] = await Promise.all([P.waitForEvent('download', { timeout: 15000 }), P.locator('[data-taste="alles-sichern"]').click()]);
  const pfad = path.join(SD, 'm478-alles.pixinotes');
  await d.saveAs(pfad);
  const m = JSON.parse(unzip(readFileSync(pfad)).get('pixinotes.json').toString('utf8'));
  const eb = (m.boards ?? []).find((b) => b.id === 'pixinotes-eingang');
  pruefe('L1 „Alles sichern" nimmt den Eingang mit', eb?.system === 'eingang' && /Fährplan/.test(JSON.stringify(eb.nodes)), JSON.stringify((m.boards ?? []).map((b) => b.id)));
  pruefe('L2 … ohne ihn in ein Projekt zu stellen', !(m.spaces ?? []).some((sp) => sp.projects.some((p) => p.boardIds.includes('pixinotes-eingang'))));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  for (const modus of ['kopie', 'ersetzen']) {
    const neu = await geraet({ name: `einspielen-${modus}` });
    await datenReiter(neu.P);
    await neu.P.locator('.modal input[type="file"][accept*="pixinotes"]').first().setInputFiles(pfad);
    await neu.P.waitForSelector('[data-taste="sicherung-einspielen"]', { timeout: 8000 });
    if (modus === 'ersetzen') await neu.P.locator('[data-taste="sicherung-ersetzen"]').check();
    await neu.P.locator('[data-taste="sicherung-einspielen"]').click(); await neu.P.waitForTimeout(1500);
    await neu.P.keyboard.press('Escape'); await neu.P.waitForTimeout(400);
    const st = await zustand(neu.P);
    const eingaenge = st.boards.filter((b) => b.system === 'eingang' || b.id === 'pixinotes-eingang');
    pruefe(`L3 ${modus}: genau EIN Eingang mit dem Eintrag, Zähler 1`, eingaenge.length === 1 && /Fährplan/.test(JSON.stringify(eingaenge[0].nodes)) && (await zaehler(neu.P)) === 1,
      JSON.stringify(eingaenge.map((b) => [b.id, b.nodes.length])));
    pruefe(`L4 ${modus}: der Eingang steht in keinem Projekt, nicht im Baum`, !st.spaces.some((sp) => sp.projects.some((p) => p.boardIds.some((id) => eingaenge.some((b) => b.id === id))))
      && (await neu.P.locator('.tabs.spalte .side-board', { hasText: 'Eingang' }).count()) === 0, JSON.stringify(st.spaces.map((sp) => sp.projects.map((p) => p.boardIds))));
    await neu.ctx.close();
  }
}

// ══ J: Abgleich über den Ordner ══════════════════════════════════════
console.log('\n════ J: Telefon → PC über den Sync-Ordner ════');
{
  const ordner = new Map();
  const HAUPT = 'pixinotes-daten.json';
  const verbinden = async (G) => {
    await G.locator('button[title^="Einstellungen"]').click(); await G.waitForTimeout(600);
    await G.locator('.modal button', { hasText: 'Daten' }).first().click(); await G.waitForTimeout(500);
    await G.locator('.modal button', { hasText: 'Sync-Ordner verbinden' }).click(); await G.waitForTimeout(1500);
    await G.keyboard.press('Escape'); await G.waitForTimeout(500);
  };
  const tel = await geraet({ ordner, name: 'telefon' });
  await verbinden(tel.P);
  const pc = await geraet({ ordner, name: 'pc', stand: { ...START, boards: START.boards.map((b) => ({ ...b })) } });
  await verbinden(pc.P);
  await senden(tel.P, seite('Packliste Amrum', 'Regenjacke, Fernglas'));
  const angekommen = await warteBis(pc.P, async () => (await zaehler(pc.P)) === 1, 30000);
  pruefe('J1 am Telefon gesendet → am PC wartet es im Eingang', angekommen, String(await zaehler(pc.P)));
  const datei = JSON.parse(ordner.get(HAUPT)?.text ?? '{}');
  const normal = (datei.boards ?? []).filter((b) => b.id !== 'pixinotes-eingang');
  pruefe('J2 normale Boards im Sync-Stand ohne neue Felder', normal.length === 2 && normal.every((b) => !('system' in b) && b.nodes.every((n) => !('eingang' in (n.data ?? {})))), JSON.stringify(normal.map((b) => Object.keys(b))));
  pruefe('J3 der Eingang reist als System-Board mit derselben Kennung', (datei.boards ?? []).some((b) => b.id === 'pixinotes-eingang' && b.system === 'eingang'));
  pruefe('J4 und steht auch dort in keinem Projekt', !(datei.spaces ?? []).some((sp) => sp.projects.some((p) => p.boardIds.includes('pixinotes-eingang'))), JSON.stringify(datei.spaces));
  await oeffnen(pc.P);
  await pc.P.locator('.eingang-eintrag', { hasText: 'Packliste' }).locator('[data-taste="eingang-holen"]').click();
  await pc.P.waitForTimeout(1000);
  const amPc = (await zustand(pc.P)).boards.find((b) => b.id === 'b0').nodes.some((n) => /Packliste/.test(JSON.stringify(n.data.blocks)));
  pruefe('J5 am PC einsortiert', amPc);
  const leer = await warteBis(tel.P, async () => {
    const st = await zustand(tel.P);
    return gruppen(st.boards.find((b) => b.id === 'pixinotes-eingang')) === 0 && st.boards.find((b) => b.id === 'b0').nodes.some((n) => /Packliste/.test(JSON.stringify(n.data.blocks)));
  }, 30000);
  pruefe('J6 am Telefon ist der Eingang danach leer, die Karte liegt auf dem Board', leer);
  pruefe('J7 kein Zähler mehr am Telefon', (await zaehler(tel.P)) === 0);
  await tel.ctx.close(); await pc.ctx.close();
}

// ══ K ════════════════════════════════════════════════════════════════
console.log('\n════ K: Fehlerfrei ════');
pruefe('K1 keine Fehler auf der Seite', fehler.length === 0, fehler.join(' | '));

await ctx.close();
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
