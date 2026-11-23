/**
 * M488 — Eingang: in eine Notiz einfügen.
 *
 * M478 kannte für einen Eingangs-Eintrag nur „Aufs Board". Jetzt lässt er sich direkt in eine bestehende Notiz geben:
 * per Ziehen auf die Notiz (offen: an die Stelle, an der man loslässt; ruhend: ans Ende) und über „⋯ → In Notiz
 * einfügen …" mit Suche über die Titel, zuletzt bearbeitete oben. Der Eintrag verschwindet aus dem Eingang; EIN
 * Strg+Z holt Notiz-Inhalt und Eintrag zurück.
 *
 * Die Erweiterung wird wie in m478 nachgestellt (postMessage ans eigene Fenster nach der Bereit-Marke).
 *
 *   A  Text: auf eine ruhende Notiz ziehen → ans Ende; Eintrag weg; Strg+Z holt beides; per Menü erneut; Neuladen.
 *   B  Link: per Menü in eine Notiz auf einem ANDEREN Board (Suche); echter Verweis; zuletzt bearbeitete oben;
 *      Strg+Z; erneut; Neuladen.
 *   C  Bild: in die OFFENE Notiz zwischen zwei Absätze ziehen → genau dort; als Bild im Text; Strg+Z; per Menü in
 *      eine andere Notiz; Neuladen.
 *   D  Ruhe: das ⋯ steht erst beim Zeigen, die Notiz-Wahl schließt mit Esc zurück in die Liste; aufs freie Board
 *      gezogen bleibt es eine Karte (wie M478); die Markierung beim Ziehen verschwindet wieder.
 *   K  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m488-eingang-notiz.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5488;
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

const absatz = (id, text) => ({ id, type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] });
const notiz = (id, absaetze, x, y, geaendert) => ({
  id, type: 'note', width: 300, position: { x, y }, geaendert,
  data: { color: 'yellow', blocks: absaetze.map((t, i) => absatz(`${id}-p${i}`, t)) },
});
const START = {
  boards: [
    { id: 'b0', name: 'Schreibtisch', edges: [], drawings: [], comments: [], nodes: [
      notiz('n1', ['Sammelnotiz'], 60, 60, 1000),
      notiz('n2', ['Leseliste', 'Ende der Liste'], 60, 340, 3000),
    ] },
    { id: 'b1', name: 'Urlaub', edges: [], drawings: [], comments: [], nodes: [notiz('n3', ['Urlaubsideen'], 80, 80, 2000)] },
  ],
  spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'Alltag', boardIds: ['b0', 'b1'] }] }],
  activeId: 'b0', view: 'board',
};

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript((st) => {
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
}, START);
const P = await ctx.newPage();
P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
P.on('dialog', (d) => d.accept());
await P.goto(APP, { waitUntil: 'networkidle' });
await P.waitForTimeout(1500);

const senden = (sendung) => P.evaluate(async (s) => {
  for (let i = 0; i < 100 && document.documentElement.dataset.pixinotesEingang !== 'bereit'; i += 1) await new Promise((r) => setTimeout(r, 50));
  window.postMessage({ typ: 'pixinotes-erweiterung', id: `t-${Math.random()}`, sendung: { v: 1, ...s } }, location.origin);
  await new Promise((r) => setTimeout(r, 900));
}, sendung);
const zustand = () => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state);
const knoten = async (id) => (await zustand()).boards.flatMap((b) => b.nodes).find((n) => n.id === id);
const inhalt = async (id) => JSON.stringify((await knoten(id))?.data.blocks ?? []);
const eingangZahl = async () => {
  const eb = (await zustand()).boards.find((b) => b.id === 'pixinotes-eingang');
  return new Set((eb?.nodes ?? []).map((n) => n.data?.eingang?.gruppe ?? n.id)).size;
};
const liste = () => P.locator('[data-taste="eingang-liste"]');
const oeffnen = async () => {
  if (await liste().count()) return;
  await P.locator('.tabs.spalte [data-taste="eingang"]').click(); await P.waitForTimeout(500);
};
const eintrag = (text) => P.locator('.eingang-eintrag', { hasText: text });
const notizDom = (id) => P.locator(`.react-flow__node[data-id="${id}"]`);
const ruhig = async () => { await P.locator('.react-flow__pane').click({ position: { x: 700, y: 760 } }); await P.waitForTimeout(250); };
const zurueck = async () => { await ruhig(); await P.keyboard.press('Control+z'); await P.waitForTimeout(1100); };
const brett = async (id) => { await P.locator('.tabs.spalte .side-board', { hasText: id }).first().click(); await P.waitForTimeout(900); };
/** Über das Menü: ⋯ → „In Notiz einfügen …" → suchen → wählen */
async function perMenue(text, suche, notizId) {
  await oeffnen();
  await eintrag(text).hover();
  await eintrag(text).locator('[data-taste="eingang-mehr"]').click();
  await P.locator('[data-taste="eingang-in-notiz"]').click();
  await P.waitForTimeout(300);
  if (suche) { await P.locator('[data-taste="eingang-notiz-suche"]').fill(suche); await P.waitForTimeout(200); }
  await P.locator(`[data-taste="eingang-notiz"][data-notiz="${notizId}"]`).click();
  await P.waitForTimeout(1100);
}
const bildDaten = await P.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 240; c.height = 160;
  const x = c.getContext('2d'); x.fillStyle = '#0a7d40'; x.fillRect(0, 0, 240, 160); x.fillStyle = '#ffd400'; x.fillRect(40, 40, 80, 80);
  return c.toDataURL('image/png');
});

// ══ A: Text ══════════════════════════════════════════════════════════
console.log('════ A: Text auf eine ruhende Notiz ziehen ════');
{
  await senden({ art: 'auswahl', titel: '', text: 'Weniger ist mehr.', adresse: '' });
  pruefe('A0 der Text wartet im Eingang', (await eingangZahl()) === 1);
  await oeffnen();
  pruefe('A1 die Notiz ruht (kein Editor)', (await notizDom('n1').locator('.ProseMirror[contenteditable="true"]').count()) === 0);
  await eintrag('Weniger ist mehr').dragTo(notizDom('n1'), { targetPosition: { x: 150, y: 20 } });
  await P.waitForTimeout(1200);
  const n1 = await knoten('n1');
  const texte = (n1?.data.blocks ?? []).map((b) => (b.content ?? []).map((c) => c.text ?? '').join(''));
  pruefe('A2 der Text steht in der Notiz – am Ende', texte.length === 2 && texte[0] === 'Sammelnotiz' && texte[1] === 'Weniger ist mehr.', JSON.stringify(texte));
  pruefe('A3 … sichtbar auf der Karte', /Weniger ist mehr/.test(await notizDom('n1').innerText()));
  pruefe('A4 der Eintrag ist aus dem Eingang verschwunden (Liste zu, kein Zähler)', (await eingangZahl()) === 0 && (await liste().count()) === 0);
  pruefe('A5 keine neue Karte auf dem Board', (await zustand()).boards.find((b) => b.id === 'b0').nodes.length === 2);
  pruefe('A6 die Markierung beim Ziehen ist wieder weg', (await P.locator('[data-eingang-ziel]').count()) === 0);
  const toast = await P.locator('.toast').first().textContent().catch(() => '');
  pruefe('A7 ein Hinweis nennt die Notiz und Strg+Z', /Sammelnotiz/.test(toast ?? '') && /Strg\+Z/.test(toast ?? ''), toast);
  await zurueck();
  pruefe('A8 Strg+Z: die Notiz ist wie vorher …', !/Weniger ist mehr/.test(await inhalt('n1')) && !/Weniger ist mehr/.test(await notizDom('n1').innerText()));
  pruefe('A9 … und der Eintrag wartet wieder im Eingang (ein Schritt)', (await eingangZahl()) === 1);
  await perMenue('Weniger ist mehr', '', 'n1');
  pruefe('A10 per Menü: der Text steht wieder in der Notiz, der Eintrag ist weg', /Weniger ist mehr/.test(await inhalt('n1')) && (await eingangZahl()) === 0);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  pruefe('A11 übersteht das Neuladen', /Weniger ist mehr/.test(await notizDom('n1').innerText()) && (await eingangZahl()) === 0);
}

// ══ B: Link ══════════════════════════════════════════════════════════
console.log('\n════ B: Link per Menü in eine Notiz auf einem anderen Board ════');
{
  await senden({ art: 'seite', titel: 'Gärten am Meer', text: '', adresse: 'https://example.org/gaerten' });
  await oeffnen();
  await eintrag('Gärten am Meer').hover();
  await P.waitForTimeout(200);
  pruefe('B0 das ⋯ steht beim Zeigen am Eintrag', await eintrag('Gärten am Meer').locator('[data-taste="eingang-mehr"]').isVisible());
  await eintrag('Gärten am Meer').locator('[data-taste="eingang-mehr"]').click();
  await P.locator('[data-taste="eingang-in-notiz"]').click(); await P.waitForTimeout(300);
  const reihe = await P.locator('[data-taste="eingang-notiz"]').evaluateAll((els) => els.map((e) => e.dataset.notiz));
  pruefe('B1 alle Notizen zur Wahl, zuletzt bearbeitete oben', reihe.length === 3 && reihe[0] === 'n1' && reihe[1] === 'n2' && reihe[2] === 'n3', JSON.stringify(reihe));
  await P.locator('[data-taste="eingang-notiz-suche"]').fill('urlaubsideen');
  await P.waitForTimeout(200);
  const gefunden = await P.locator('[data-taste="eingang-notiz"]').evaluateAll((els) => els.map((e) => e.dataset.notiz));
  pruefe('B2 die Suche über den Titel findet die Notiz auf „Urlaub"', gefunden.length === 1 && gefunden[0] === 'n3', JSON.stringify(gefunden));
  await P.screenshot({ path: `${SD}/m488-notizwahl.png` });
  await P.keyboard.press('Enter'); await P.waitForTimeout(1200);
  const st = await zustand();
  const n3 = JSON.stringify(st.boards.find((b) => b.id === 'b1').nodes.find((n) => n.id === 'n3').data.blocks);
  pruefe('B3 Titel und Verweis stehen in der Notiz', /Gärten am Meer/.test(n3) && /"href":"https:\/\/example.org\/gaerten"/.test(n3), n3.slice(0, 300));
  pruefe('B4 man steht danach auf „Urlaub", der Eintrag ist weg', st.activeId === 'b1' && (await eingangZahl()) === 0);
  pruefe('B5 der Verweis ist auf der Karte ein echter Link', (await notizDom('n3').locator('.note-editor a[href="https://example.org/gaerten"]').count()) === 1);
  await zurueck();
  pruefe('B6 Strg+Z holt Notiz und Eintrag zurück', !/gaerten/.test(await inhalt('n3')) && (await eingangZahl()) === 1 && (await zustand()).activeId === 'b1');
  await perMenue('Gärten am Meer', 'urlaub', 'n3');
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  pruefe('B7 erneut eingefügt – übersteht das Neuladen', /"href":"https:\/\/example.org\/gaerten"/.test(await inhalt('n3')) && (await eingangZahl()) === 0);
  await brett('Schreibtisch');
}

// ══ C: Bild ══════════════════════════════════════════════════════════
console.log('\n════ C: Bild in die offene Notiz ziehen ════');
{
  await senden({ art: 'bild', titel: 'Strandfoto', text: '', adresse: '', bild: { daten: bildDaten, name: 'Strand' } });
  pruefe('C0 das Bild wartet im Eingang', (await eingangZahl()) === 1);
  // Die Notiz aufwecken (Klick in den Text) — dann ist sie „offen"
  await notizDom('n2').locator('.note-editor').click({ position: { x: 40, y: 10 } });
  await P.waitForTimeout(800);
  pruefe('C1 die Notiz ist offen (Editor da)', (await notizDom('n2').locator('.ProseMirror[contenteditable="true"]').count()) === 1);
  await ruhig();
  await oeffnen();
  const zweiter = await notizDom('n2').locator('.bn-block-outer[data-id="n2-p1"]').boundingBox();
  const karte = await notizDom('n2').boundingBox();
  await eintrag('Strand').dragTo(notizDom('n2'), { targetPosition: { x: 120, y: Math.round(zweiter.y - karte.y + 3) } });
  await P.waitForTimeout(1400);
  const bl = (await knoten('n2')).data.blocks;
  pruefe('C2 das Bild steht genau dort, wo losgelassen wurde (zwischen den Absätzen)', bl.length === 3 && bl[0].id === 'n2-p0' && bl[1].type === 'image' && bl[2].id === 'n2-p1', JSON.stringify(bl.map((b) => b.type + ':' + b.id)));
  pruefe('C3 als eingebettetes Bild (data:image/png)', /^data:image\/png;base64,/.test(bl[1]?.props?.url ?? ''));
  pruefe('C4 im Text der Karte zu sehen', (await notizDom('n2').locator('img').count()) >= 1);
  pruefe('C5 Eintrag weg, keine neue Karte', (await eingangZahl()) === 0 && (await zustand()).boards.find((b) => b.id === 'b0').nodes.length === 2);
  await P.screenshot({ path: `${SD}/m488-bild-in-notiz.png` });
  await zurueck();
  const blZ = (await knoten('n2')).data.blocks;
  pruefe('C6 Strg+Z: Bild aus der Notiz, Eintrag zurück im Eingang', blZ.length === 2 && !blZ.some((b) => b.type === 'image') && (await eingangZahl()) === 1
    && (await notizDom('n2').locator('img').count()) === 0, JSON.stringify(blZ.map((b) => b.type)));
  await perMenue('Strand', 'samm', 'n1');
  pruefe('C7 per Menü in die andere Notiz: Bild am Ende', (await knoten('n1')).data.blocks.at(-1)?.type === 'image' && (await eingangZahl()) === 0);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
  pruefe('C8 übersteht das Neuladen (auch auf der Karte)', (await knoten('n1')).data.blocks.at(-1)?.type === 'image' && (await notizDom('n1').locator('img').count()) >= 1);
}

// ══ D: Ruhe, Esc, freie Fläche ═══════════════════════════════════════
console.log('\n════ D: Ruhige Bedienung ════');
{
  await senden({ art: 'auswahl', titel: '', text: 'Für die freie Fläche', adresse: '' });
  await oeffnen();
  await P.mouse.move(10, 10); await P.waitForTimeout(250);
  const leise = await eintrag('freie Fläche').locator('[data-taste="eingang-mehr"]').evaluate((b) => getComputedStyle(b).opacity);
  pruefe('D1 in Ruhe ist das ⋯ unsichtbar (kein neuer Dauer-Knopf)', leise === '0', leise);
  await eintrag('freie Fläche').hover();
  await eintrag('freie Fläche').locator('[data-taste="eingang-mehr"]').click();
  await P.locator('[data-taste="eingang-in-notiz"]').click(); await P.waitForTimeout(300);
  pruefe('D2 die Notiz-Wahl steht an der Stelle der Liste', (await P.locator('[data-taste="eingang-notizwahl"]').count()) === 1 && (await liste().count()) === 0);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  pruefe('D3 Esc führt zurück in die Liste (nichts eingefügt)', (await liste().count()) === 1 && (await eingangZahl()) === 1);
  const fl = await P.locator('.react-flow').boundingBox();
  await eintrag('freie Fläche').dragTo(P.locator('.react-flow__pane'), { targetPosition: { x: 700, y: Math.round(fl.height - 160) } });
  await P.waitForTimeout(1200);
  const b0 = (await zustand()).boards.find((b) => b.id === 'b0');
  pruefe('D4 aufs freie Board gezogen bleibt es eine Karte (wie M478)', b0.nodes.length === 3 && b0.nodes.some((n) => /freie Fläche/.test(JSON.stringify(n.data.blocks))) && (await eingangZahl()) === 0);
}

console.log('\n════ K: Fehlerfrei ════');
pruefe('K1 keine Fehler auf der Seite', fehler.length === 0, fehler.join(' | '));

await ctx.close();
await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
