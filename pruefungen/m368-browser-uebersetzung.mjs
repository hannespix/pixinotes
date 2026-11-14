/**
 * M368 — Die Seite verträgt die Übersetzung des Browsers.
 *
 * PixiNotes ist deutsch. Wer eine andere Sprache spricht, lässt die Seite vom Browser übersetzen. Dabei
 * ersetzen die Übersetzer (Chrome, Edge) Textknoten durch <font>-Elemente — React-Seiten stürzen davon ab
 * oder zeigen veraltete Texte. Hier wird ein solcher Übersetzer nachgebaut (beide Bauarten: Textknoten
 * ersetzen / Textknoten verpacken) und die App damit bedient.
 *
 * Der Maßstab ist streng und allgemein: Dieselbe Bedienfolge läuft einmal ohne und einmal mit Übersetzung;
 * nach jedem Schritt muss der sichtbare Text der Seite (ohne die Marken des Übersetzers) derselbe sein —
 * kein stehengebliebener, kein doppelter, kein fehlender Text. Der Gegenversuch ohne Schutz zeigt, dass
 * die Folge die gefährlichen Stellen wirklich trifft.
 *
 *   A  Grundlagen: Die Seite weist sich als deutsch aus; Inhalte tragen translate="no", die Oberfläche nicht.
 *   B  Übersetzer „ersetzt": Bedienfolge ohne Absturz, Text deckungsgleich mit dem unübersetzten Lauf.
 *   C  Übersetzer „verpackt": dasselbe.
 *   D  Inhalte bleiben, wie sie sind: nichts Übersetztes im Gespeicherten, Namen und Notizen unberührt.
 *   E  Gegenversuch ohne Schutz: Dieselbe Folge geht schief.
 *   F  Hinweis in der Sprache des Browsers — einmal, nicht für Deutschsprachige, weg sobald übersetzt wird.
 *   G  Texte.
 */
// Läuft aus dem Repository: `node pruefungen/m368-browser-uebersetzung.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
import { readFileSync, existsSync } from 'node:fs';
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 4586;
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

const stand = {
  boards: [
    { id: 'b1', name: 'Sitzung Montag', edges: [], drawings: [], comments: [], nodes: [
      { id: 'n1', type: 'note', width: 240, position: { x: 0, y: 40 }, data: { color: 'sky', title: 'Tagesordnung', blocks: [{ type: 'paragraph', content: 'Hallo Welt, das ist meine Notiz' }] } },
      { id: 'n2', type: 'note', width: 240, position: { x: 300, y: 40 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Zweite Karte mit Text' }] } },
    ] },
    { id: 'b2', name: 'Einkauf', edges: [], drawings: [], comments: [], nodes: [
      { id: 'n3', type: 'note', width: 240, position: { x: 0, y: 0 }, data: { color: 'green', blocks: [{ type: 'paragraph', content: 'Milch und Brot' }] } },
    ] },
  ],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['b1', 'b2'] }] }],
  activeId: 'b1', view: 'board',
};

/** Der nachgebaute Übersetzer: läuft in der Seite, übersetzt alles Übersetzbare und alles, was später dazukommt */
const UEBERSETZER = (bauart) => {
  const fertig = new WeakSet();
  const darf = (t) => {
    const el = t.parentElement;
    if (!el || !t.nodeValue || !t.nodeValue.trim()) return false;
    if (el.closest('script, style, noscript, textarea')) return false;
    if (el.tagName === 'FONT' && el.dataset.tr) return false;
    return el.translate !== false; // translate="no" vererbt sich — wie beim echten Übersetzer
  };
  const einer = (t) => {
    if (fertig.has(t) || !t.isConnected || !darf(t)) return 0;
    const aussen = document.createElement('font'); aussen.dataset.tr = '1'; aussen.style.verticalAlign = 'inherit';
    const innen = document.createElement('font'); innen.dataset.tr = '1'; innen.style.verticalAlign = 'inherit';
    aussen.appendChild(innen);
    const eltern = t.parentNode;
    if (bauart === 'ersetzt') {
      const neu = document.createTextNode(`⟦${t.nodeValue}⟧`); fertig.add(neu);
      innen.appendChild(neu);
      eltern.replaceChild(aussen, t);
    } else {
      eltern.insertBefore(aussen, t);
      innen.appendChild(t); fertig.add(t);
      t.data = `⟦${t.data}⟧`;
    }
    return 1;
  };
  const alle = (wurzel) => {
    let n = 0;
    const lauf = document.createTreeWalker(wurzel, NodeFilter.SHOW_TEXT);
    const liste = []; while (lauf.nextNode()) liste.push(lauf.currentNode);
    for (const t of liste) n += einer(t);
    return n;
  };
  let offen = false;
  const bald = () => { if (offen) return; offen = true; setTimeout(() => { offen = false; alle(document.body); }, 25); };
  new MutationObserver((liste) => {
    for (const m of liste) {
      // „verpackt": React hat den Text geändert → der Knoten gilt wieder als unübersetzt
      if (m.type === 'characterData' && !String(m.target.nodeValue).startsWith('⟦')) fertig.delete(m.target);
    }
    bald();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.documentElement.classList.add('translated-ltr');
  return alle(document.body);
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const seite = async ({ locale = 'de-DE', sprachen = null, ohneSchutz = false } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1, locale });
  await ctx.addInitScript(([st, sp, os]) => {
    if (os) window.__pnOhneUebersetzungsschutz = true;
    // Der Hinweis hält sich in ferngesteuerten Browsern zurück — hier soll er sich zeigen wie bei einem Menschen
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    if (sp) Object.defineProperty(navigator, 'languages', { get: () => sp });
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, [stand, sprachen, ohneSchutz]);
  const P = await ctx.newPage();
  P.fehler = [];
  P.on('pageerror', (e) => P.fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1800);
  return P;
};

/** Sichtbarer Text ohne Leerraum und ohne die Marken des Übersetzers */
const text = (P) => P.evaluate(() => document.body.innerText.replace(/[⟦⟧]/g, '').replace(/\s+/g, ''));
const kaputt = (P) => P.locator('.err-box').count();
const frei = async (P) => {
  // freie Stelle der Fläche, rechts unten von den Karten
  const r = await P.locator('.react-flow').boundingBox();
  return { x: r.x + r.width - 220, y: r.y + r.height * 0.3 };
};

/** Die Bedienfolge: [Name, Aktion]. Nach jeder Aktion wird verglichen. */
const FOLGE = [
  ['Palette „Objekt hinzufügen" auf', async (P) => { await P.click('button[aria-label="Objekt hinzufügen"]'); }],
  ['Palette zu', async (P) => { await P.keyboard.press('Escape'); }],
  ['Einstellungen auf', async (P) => { await P.click('[data-taste="einstellungen"]'); }],
  ['Einstellungen zu', async (P) => { await P.keyboard.press('Escape'); }],
  ['Hilfe auf', async (P) => { await P.click('[data-taste="hilfe"]'); }],
  ['Hilfe zu', async (P) => { await P.keyboard.press('Escape'); }],
  ['Suche auf, „Zweite"', async (P) => { await P.click('.side-tree-find'); await P.waitForTimeout(250); await P.keyboard.type('Zweite', { delay: 40 }); }],
  ['Suche: anderes Wort', async (P) => { for (let i = 0; i < 6; i++) await P.keyboard.press('Backspace'); await P.keyboard.type('Milch', { delay: 40 }); }],
  ['Suche: kein Treffer', async (P) => { await P.keyboard.type('xyzq', { delay: 40 }); }],
  ['Suche zu', async (P) => { await P.keyboard.press('Escape'); }],
  ['Menü „Mehr" auf', async (P) => { await P.click('button[aria-label="Mehr"]'); }],
  ['Menü „Mehr" zu', async (P) => { await P.keyboard.press('Escape'); }],
  ['Karte wählen', async (P) => { const b = await P.locator('.react-flow__node[data-id="n2"]').boundingBox(); await P.mouse.click(b.x + b.width - 12, b.y + b.height - 10); }],
  ['zweite Karte dazu wählen', async (P) => { const b = await P.locator('.react-flow__node[data-id="n1"]').boundingBox(); await P.keyboard.down('Shift'); await P.mouse.click(b.x + b.width - 12, b.y + b.height - 10); await P.keyboard.up('Shift'); }],
  ['Auswahl löschen', async (P) => { await P.keyboard.press('Delete'); }],
  ['Rückgängig', async (P) => { await P.keyboard.press('Control+z'); }],
  ['Auswahl aufheben', async (P) => { const f = await frei(P); await P.mouse.click(f.x, f.y); await P.locator('.toast').waitFor({ state: 'detached', timeout: 9000 }).catch(() => {}); }],
  ['Rechtsklick-Menü auf', async (P) => { const f = await frei(P); await P.mouse.click(f.x, f.y, { button: 'right' }); }],
  ['Rechtsklick-Menü zu', async (P) => { await P.keyboard.press('Escape'); }],
  ['neue Notiz', async (P) => { const f = await frei(P); await P.mouse.dblclick(f.x, f.y); await P.waitForTimeout(500); await P.keyboard.type('Neue Notiz mit Inhalt', { delay: 25 }); }],
  // die Meldung „Notiz erstellt …" steht drei Sekunden — abwarten, sonst ist sie beim Vergleich mal da, mal weg
  ['Notiz verlassen', async (P) => { const f = await frei(P); await P.mouse.click(f.x - 320, f.y + 380); await P.locator('.toast').waitFor({ state: 'detached', timeout: 9000 }).catch(() => {}); }],
  ['Zeichnen an', async (P) => { await P.click('[data-taste="zeichnen"]'); }],
  ['Zeichnen aus', async (P) => { await P.keyboard.press('Escape'); }],
  ['anderes Board', async (P) => { await P.click('.side-board-name:has-text("Einkauf")'); }],
  ['zurück', async (P) => { await P.click('.side-board-name:has-text("Sitzung Montag")'); }],
  ['Übersicht', async (P) => { await P.click('.tab-home'); }],
  ['Aufgaben', async (P) => { await P.click('[data-taste="aufgaben"]'); }],
  ['zurück ins Board', async (P) => { await P.click('.side-board-name:has-text("Sitzung Montag")'); }],
  ['Board-Menü auf', async (P) => { await P.locator('.side-board-name:has-text("Einkauf")').hover(); await P.click('button[aria-label^="Board „Einkauf"]'); }],
  ['Board-Menü zu', async (P) => { await P.keyboard.press('Escape'); }],
];
const lauf = async (P) => {
  const aus = [];
  for (const [name, tu] of FOLGE) {
    let fehler = '';
    try { await tu(P); } catch (e) { fehler = String(e.message).split('\n')[0].slice(0, 90); }
    await P.waitForTimeout(550);
    aus.push({ name, text: await text(P), fehler });
  }
  return aus;
};
const vergleich = (soll, ist) => {
  const ab = [];
  soll.forEach((s, i) => {
    if (ist[i].fehler || s.text !== ist[i].text) {
      let k = 0; while (k < s.text.length && s.text[k] === ist[i].text[k]) k += 1;
      ab.push(`${s.name}${ist[i].fehler ? ` [${ist[i].fehler}]` : ''}: soll „…${s.text.slice(Math.max(0, k - 20), k + 30)}" ist „…${ist[i].text.slice(Math.max(0, k - 20), k + 30)}"`);
    }
  });
  return ab;
};

console.log('════ A: Grundlagen ════');
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
pruefe('A1 die Seite weist sich als deutsch aus (html lang="de")', /<html[^>]*\blang="de"/.test(html));
pruefe('A2 die Übersetzung ist nicht abbestellt (kein notranslate für die ganze Seite)', !/name="google"[^>]*notranslate/.test(html) && !/<html[^>]*translate="no"/.test(html));
const N = await seite();
const flaggen = await N.evaluate(() => {
  const t = (sel) => { const el = document.querySelector(sel); return el ? el.translate : null; };
  const mitText = (wort) => {
    const lauf = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const aus = [];
    while (lauf.nextNode()) { const n = lauf.currentNode; if (n.nodeValue.includes(wort) && n.parentElement?.getClientRects().length) aus.push(n.parentElement.translate); }
    return aus;
  };
  return {
    notiz: mitText('Hallo Welt, das ist meine Notiz'), board: mitText('Sitzung Montag'), board2: mitText('Einkauf'),
    projekt: mitText('Allgemein'), bereich: mitText('Arbeit'),
    einst: t('[data-taste="einstellungen"]'), uebersicht: mitText('Übersicht'), aufgaben: mitText('Aufgaben'), recht: mitText('Impressum'),
  };
});
const alleNein = (l) => l.length > 0 && l.every((x) => x === false);
const alleJa = (l) => l.length > 0 && l.every((x) => x === true);
pruefe('A3 Notiztext wird nicht übersetzt — auf der Karte und in der Seitenleiste', alleNein(flaggen.notiz) && flaggen.notiz.length >= 2, JSON.stringify(flaggen.notiz));
pruefe('A4 Board-Namen werden nicht übersetzt', alleNein(flaggen.board) && alleNein(flaggen.board2), JSON.stringify([flaggen.board, flaggen.board2]));
pruefe('A5 Projekt- und Bereichsnamen werden nicht übersetzt', alleNein(flaggen.projekt) && alleNein(flaggen.bereich), JSON.stringify([flaggen.projekt, flaggen.bereich]));
pruefe('A6 die Oberfläche bleibt übersetzbar (Übersicht, Aufgaben, Impressum, Knöpfe)', alleJa(flaggen.uebersicht) && alleJa(flaggen.aufgaben) && alleJa(flaggen.recht) && flaggen.einst === true, JSON.stringify(flaggen));
pruefe('A7 Deutschsprachige sehen keinen Sprachhinweis', await N.locator('[data-taste="sprach-hinweis"]').count() === 0);

console.log('════ Vergleichslauf ohne Übersetzung ════');
const soll = await lauf(N);
const sollFehler = soll.filter((s) => s.fehler).map((s) => `${s.name}: ${s.fehler}`);
pruefe(`V1 die Bedienfolge läuft durch (${FOLGE.length} Schritte)`, sollFehler.length === 0 && N.fehler.length === 0, JSON.stringify([sollFehler, N.fehler]).slice(0, 400));
pruefe('V2 sie bewegt etwas: die neue Notiz ist da, der Text ändert sich von Schritt zu Schritt', soll.at(-1).text.includes('NeueNotizmitInhalt') && new Set(soll.map((s) => s.text)).size >= 15, String(new Set(soll.map((s) => s.text)).size));

for (const [kenn, bauart] of [['B', 'ersetzt'], ['C', 'verpackt']]) {
  console.log(`════ ${kenn}: Übersetzer „${bauart}" ════`);
  const P = await seite();
  const n = await P.evaluate(UEBERSETZER, bauart);
  await P.waitForTimeout(300);
  pruefe(`${kenn}1 die Oberfläche ist übersetzt (${n} Textstellen)`, n >= 8 && (await P.evaluate(() => document.body.innerText)).includes('⟦Übersicht⟧'), String(n));
  const ist = await lauf(P);
  const ab = vergleich(soll, ist);
  pruefe(`${kenn}2 kein Absturz: keine Fehler der Seite, kein „lässt sich gerade nicht anzeigen"`, P.fehler.length === 0 && await kaputt(P) === 0, JSON.stringify(P.fehler).slice(0, 300));
  pruefe(`${kenn}3 nach jedem der ${FOLGE.length} Schritte steht derselbe Text da wie ohne Übersetzung`, ab.length === 0, `\n      ${ab.slice(0, 6).join('\n      ')}`);
  const sicht = await P.evaluate(() => document.body.innerText);
  pruefe(`${kenn}4 auch Neues wird übersetzt (Menüs, Meldungen kamen übersetzt an)`, (sicht.match(/⟦/g) ?? []).length >= 8, String((sicht.match(/⟦/g) ?? []).length));
  if (kenn === 'B') {
    console.log('════ D: Inhalte bleiben, wie sie sind ════');
    pruefe('D1 Notizen und Namen stehen unübersetzt da', ['Hallo Welt, das ist meine Notiz', 'Zweite Karte mit Text', 'Sitzung Montag', 'Einkauf', 'Allgemein', 'Neue Notiz mit Inhalt'].every((w) => sicht.includes(w) && !sicht.includes(`⟦${w}`)), sicht.replace(/\s+/g, ' ').slice(0, 300));
    await P.waitForTimeout(1500);
    const gespeichert = await P.evaluate(() => localStorage.getItem('pixinotes-board'));
    const st = JSON.parse(gespeichert).state;
    const b1 = st.boards.find((b) => b.id === 'b1');
    pruefe('D2 im Gespeicherten steht nichts Übersetztes', !gespeichert.includes('⟦'));
    pruefe('D3 die Notizen sind unverändert, die neue ist mit ihrem Text gespeichert', JSON.stringify(b1.nodes.find((k) => k.id === 'n1').data.blocks).includes('Hallo Welt, das ist meine Notiz') && b1.nodes.length === 3 && JSON.stringify(b1.nodes).includes('Neue Notiz mit Inhalt'), String(b1.nodes.length));
    // in einer übersetzten Seite weiterschreiben
    const k = P.locator('.react-flow__node[data-id="n2"] .note-editor');
    await k.click({ position: { x: 24, y: 12 } }); await P.waitForTimeout(500);
    await P.keyboard.press('Control+End'); await P.keyboard.type(' — ergänzt', { delay: 25 });
    await P.waitForTimeout(400);
    const f = await frei(P); await P.mouse.click(f.x - 320, f.y + 380); await P.waitForTimeout(1600);
    const n2 = await P.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('pixinotes-board')).state.boards.find((b) => b.id === 'b1').nodes.find((x) => x.id === 'n2').data.blocks));
    pruefe('D4 Schreiben in der übersetzten Seite speichert genau das Getippte', n2.includes('Zweite Karte mit Text — ergänzt') && !n2.includes('⟦'), n2.slice(0, 200));
    pruefe('D5 weiterhin kein Fehler', P.fehler.length === 0 && await kaputt(P) === 0, JSON.stringify(P.fehler).slice(0, 200));
  }
  await P.context().close();
}

console.log('════ E: Gegenversuch ohne Schutz ════');
{
  const P = await seite({ ohneSchutz: true });
  // Ohne Schutz kann die ganze Oberfläche wegbrechen — dann nicht bei jedem Schritt eine halbe Minute warten
  P.setDefaultTimeout(3000);
  await P.evaluate(UEBERSETZER, 'ersetzt');
  await P.waitForTimeout(300);
  const ist = await lauf(P);
  const ab = vergleich(soll, ist);
  const zahl = ab.length + P.fehler.length + await kaputt(P);
  console.log(`    ohne Schutz: ${ab.length} Schritte mit falschem Text, ${P.fehler.length} Fehler der Seite, ${await kaputt(P)} abgestürzte Bereiche`);
  if (ab[0]) console.log(`    z. B. ${ab[0].slice(0, 220)}`);
  if (P.fehler[0]) console.log(`    z. B. ${P.fehler[0].slice(0, 160)}`);
  pruefe('E1 ohne den Schutz geht dieselbe Folge schief — die Prüfung trifft die gefährlichen Stellen', zahl > 0, String(zahl));
  await P.context().close();
}

console.log('════ F: Hinweis in der Sprache des Browsers ════');
{
  const P = await seite({ locale: 'en-US' });
  const h = P.locator('[data-taste="sprach-hinweis"]');
  pruefe('F1 englischer Browser: Hinweis auf Englisch', (await h.innerText().catch(() => '')).includes('Your browser can translate it'));
  pruefe('F2 der Hinweis selbst wird nicht übersetzt und nennt seine Sprache', await h.evaluate((el) => el.translate === false && el.lang === 'en'));
  const r = await h.boundingBox(); const d = await P.locator('button[aria-label="Objekt hinzufügen"]').boundingBox();
  pruefe('F3 er liegt im Fenster und nicht auf der Werkzeugleiste', r.x >= 0 && r.x + r.width <= 1400 && r.y + r.height <= d.y, JSON.stringify([r, d]));
  await P.click('[data-taste="sprach-ok"]'); await P.waitForTimeout(300);
  pruefe('F4 „OK" schließt ihn', await h.count() === 0);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1200);
  pruefe('F5 er kommt nicht wieder', await h.count() === 0);
  await P.context().close();
  const Q = await seite({ locale: 'fr-FR' });
  pruefe('F6 französischer Browser: Hinweis auf Französisch', (await Q.locator('[data-taste="sprach-hinweis"]').innerText().catch(() => '')).includes('Votre navigateur peut le traduire'));
  await Q.evaluate(UEBERSETZER, 'ersetzt'); await Q.waitForTimeout(2600);
  pruefe('F7 sobald übersetzt wird, verschwindet er', await Q.locator('[data-taste="sprach-hinweis"]').count() === 0);
  await Q.reload({ waitUntil: 'networkidle' }); await Q.waitForTimeout(1200);
  pruefe('F8 … und bleibt weg', await Q.locator('[data-taste="sprach-hinweis"]').count() === 0);
  await Q.context().close();
  const R = await seite({ locale: 'ar-EG' });
  pruefe('F9 arabischer Browser: Hinweis auf Arabisch, von rechts nach links', await R.locator('[data-taste="sprach-hinweis"]').evaluate((el) => el.dir === 'rtl' && el.lang === 'ar' && el.textContent.includes('ترجمة')).catch(() => false));
  await R.context().close();
  const U = await seite({ locale: 'sv-SE' });
  pruefe('F10 Sprache ohne eigenen Text (Schwedisch): Englisch', (await U.locator('[data-taste="sprach-hinweis"]').innerText().catch(() => '')).includes('Your browser can translate it'));
  await U.context().close();
  const V = await seite({ locale: 'en-GB', sprachen: ['en-GB', 'de-DE'] });
  pruefe('F11 wer Deutsch unter seinen Sprachen führt, bekommt keinen Hinweis', await V.locator('[data-taste="sprach-hinweis"]').count() === 0);
  await V.context().close();
}

console.log('════ G: Texte ════');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('G1 Hilfe erklärt die Übersetzung (M368)', quelle('src/components/HelpOverlay.tsx').includes('(M368)'));
pruefe('G2 docs/UMBAU.md führt M368', quelle('docs/UMBAU.md').includes('M368'));

await browser.close(); app.close();
console.log(`\nm368-browser-uebersetzung: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
