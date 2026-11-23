/**
 * M447 — Barrierefreiheit (WCAG 2.1 AA): die Kern-Oberfläche per Tastatur und Vorlese-Programm bedienbar.
 *
 * Geprüft wird automatisch – in Hell UND Dunkel – über Kopfleiste, Seitenleiste, Dock, Auswahl-Leiste,
 * Kontextmenü, Einstellungen, Hilfe, Suche (Strg+K), Aufgaben-Zentrale, Übersicht, Karten-Fokus und Fenster:
 *
 *   A  Namen: Jeder Knopf, Verweis und Menüeintrag hat einen zugänglichen Namen (Text, aria-label, title);
 *      jedes Eingabefeld eine Beschriftung (label, aria-label, title, Platzhalter).           WCAG 4.1.2, 1.3.1
 *   B  Kontrast: Schrift steht mit ≥ 4,5:1 (große Schrift ≥ 3:1) auf dem tatsächlich darunterliegenden Grund
 *      (durchscheinende Schichten zusammengerechnet, Deckkraft der Vorfahren mitgerechnet).   WCAG 1.4.3
 *   C  Fokus sichtbar: Tab durch die Oberfläche – jedes angewählte Element zeigt Rahmen oder Schatten, und Tab
 *      erreicht die Bedienelemente der Leisten.                                               WCAG 2.4.7, 2.1.1
 *   D  Fenster: role=dialog + aria-modal, Fokus hinein, Tab bleibt drin, Esc schließt, Fokus zurück. WCAG 2.4.3
 *   E  Bewegung: prefers-reduced-motion schaltet Übergänge und Animationen ab.                  WCAG 2.3.3
 *   F  Finger: Tippziele der Leisten am Tablet ≥ 40 Punkte.                                    WCAG 2.5.5
 *   G  Doku.
 *
 * Gemessen wird Verhalten im gebauten Programm (dist/), keine Klassennamen-Listen. Die Kontraste der Karten selbst
 * prüft m284, Pfeiltasten m345, die Farbstufen der Akzente m389 – hier nur die Bedien-Oberfläche drumherum.
 */
// Läuft aus dem Repository: `node pruefungen/m447-barrierefreiheit.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5447;
const ERKUNDEN = process.env.ERKUNDEN === '1';
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

/** Prüfwerkzeug im Browser: Namen, Kontrast (aus getComputedStyle selbst gerechnet), Fokusring, Tippziele. */
const werkzeug = () => {
  const farbe = (s) => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.clearRect(0, 0, 1, 1); g.fillStyle = 'rgba(0,0,0,0)'; g.fillStyle = s; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const hell = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
  const ueber = (o, u) => [0, 1, 2].map((i) => o[i] * o[3] + u[i] * (1 - o[3])).concat(1);
  const kontrast = (a, b) => { const x = hell(a); const y = hell(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const deckung = (el) => { let a = 1; for (let e = el; e; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity); return a; };
  const sichtbar = (el) => {
    if (!el.getClientRects().length) return false;
    // Inhalt eines zugeklappten <details> hat in Chrome Maße, ist aber nicht zu sehen (content-visibility: hidden)
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) return false;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden') return false;
    if (deckung(el) < 0.05) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  /** Grund hinter el: zuerst die eigenen Vorfahren, dann was an dieser Stelle darunter liegt (feste Leisten liegen
   *  über der Fläche, nicht in ihr). Alles übereinander gelegt; null bei Verlauf oder Bild darunter. */
  const grund = (el) => {
    const schichten = []; const kette = [];
    const nimm = (e) => { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'bild'; const f = farbe(cs.backgroundColor); if (f[3] > 0) { schichten.push(f); if (f[3] >= 0.999) return 'voll'; } return ''; };
    for (let e = el; e; e = e.parentElement) { kette.push(e); const r = nimm(e); if (r === 'bild') return null; if (r === 'voll') break; }
    if (!schichten.length || schichten[schichten.length - 1][3] < 0.999) {
      const r = el.getBoundingClientRect();
      const stapel = document.elementsFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      const ab = Math.max(-1, ...kette.map((k) => stapel.indexOf(k)));
      for (const e of stapel.slice(ab + 1)) {
        if (kette.includes(e) || el.contains(e)) continue;
        const z = nimm(e); if (z === 'bild') { if (e.closest('.react-flow__background, .react-flow__pane, .react-flow')) continue; return null; } if (z === 'voll') break;
      }
    }
    let g = schichten.length && schichten[schichten.length - 1][3] >= 0.999 ? schichten.pop() : farbe(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff');
    while (schichten.length) g = ueber(schichten.pop(), g);
    return g;
  };
  const pfad = (el) => { const t = el.getAttribute('data-taste'); const k = (typeof el.className === 'string' ? el.className : (el.className?.baseVal ?? '')).split(' ').filter(Boolean).slice(0, 2).join('.'); return `${el.tagName.toLowerCase()}${k ? '.' + k : ''}${t ? `[${t}]` : ''}`; };
  const name = (el) => {
    const al = el.getAttribute('aria-label'); if (al?.trim()) return al.trim();
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim(); if (t) return t; }
    if (el.labels?.length) { const t = [...el.labels].map((l) => l.textContent).join(' ').trim(); if (t) return t; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      if (['button', 'submit', 'reset'].includes(el.type) && el.value) return el.value;
      return el.getAttribute('title') || el.getAttribute('placeholder') || '';
    }
    const txt = (el.innerText ?? el.textContent ?? '').trim(); if (txt) return txt;
    const bild = el.querySelector('img[alt]'); if (bild?.alt.trim()) return bild.alt.trim();
    return el.getAttribute('title') || '';   // data-tip (Sprechblase) ist KEIN Name
  };
  const BEDIEN = 'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=checkbox], [role=switch], [role=option], [role=link]';
  // Karten-Inhalte (Editor, Tabellen-Zellen, Diagramme) prüfen die Reihen der Karten selbst.
  const AUSSER = '[aria-hidden=true], .react-flow__node .bn-container, .ProseMirror, .react-flow__node .sheet-grid, .mermaid-svg, .react-flow__minimap';
  window.__a11y = {
    pfad, name, sichtbar,
    namenlos(w = document) {
      return [...w.querySelectorAll(BEDIEN)].filter((el) => sichtbar(el) && !el.disabled && !el.closest(AUSSER) && !name(el)).map(pfad);
    },
    kontraste(w = document) {
      const aus = []; const gesehen = new Set();
      const tw = document.createTreeWalker(w === document ? document.body : w, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement; if (!el || gesehen.has(el)) continue; gesehen.add(el);
        if (!sichtbar(el)) continue;
        // ausgenommen: Karten-Inhalte (m284), gesperrte Bedienelemente (WCAG nimmt inaktive aus), Schaubilder
        if (el.closest(`${AUSSER}, .react-flow__node, .ov-canvas, svg, :disabled, [aria-disabled=true], .presenter-slide, .bild-editor`)) continue;
        const cs = getComputedStyle(el); const bg = grund(el); if (!bg) continue;
        const fg = farbe(cs.color);
        const schrift = ueber([fg[0], fg[1], fg[2], fg[3] * deckung(el)], bg);
        const k = kontrast(schrift, bg); const gr = parseFloat(cs.fontSize); const fett = parseInt(cs.fontWeight, 10) >= 700;
        const soll = gr >= 24 || (fett && gr >= 18.66) ? 3 : 4.5;
        if (k < soll - 0.005) aus.push(`${pfad(el)} „${n.textContent.trim().slice(0, 24)}" ${k.toFixed(2)}`);
      }
      return aus;
    },
    /** Fokus sichtbar: Rahmen, Schatten, Randfarbe oder Grund unterscheiden sich vom Zustand ohne Fokus */
    fokus(el = document.activeElement) {
      if (!el || el === document.body || el === document.documentElement) return { ok: false, el: 'body' };
      const merk = () => { const cs = getComputedStyle(el); return [cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1 ? cs.outlineColor + cs.outlineWidth : '', cs.boxShadow, cs.borderTopColor + cs.borderBottomColor, cs.backgroundColor].join('|'); };
      const mit = merk();
      const ring = getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 1;
      let ok = ring;
      if (!ok) {
        // ohne Ring: einmal ohne Fokus ansehen und vergleichen (Übergänge aus, damit der Wert sofort gilt)
        const alt = el.style.transition; el.style.transition = 'none';
        el.blur(); const ohne = merk(); el.focus({ preventScroll: true }); el.style.transition = alt;
        ok = ohne !== mit;
      }
      return { ok, el: pfad(el), name: name(el).slice(0, 30), imFenster: !!el.closest('[role=dialog], .modal-backdrop, .search-backdrop') };
    },
    ziele(w = document, min = 40) {
      return [...w.querySelectorAll(BEDIEN)].filter((el) => sichtbar(el) && !el.disabled && !el.closest(`${AUSSER}, .react-flow__node, .ov-canvas`) && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
        .map((el) => { const r = el.getBoundingClientRect(); return { el: pfad(el), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter((x) => x.w < min || x.h < min).map((x) => `${x.el} ${x.w}×${x.h}`);
    },
  };
};

const neu = async (opt = {}, thema = 'light') => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: thema, ...opt });
  await ctx.addInitScript(werkzeug);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => { fehler.push(e.message); console.log('    PAGEERROR:', e.message); });
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(700);
  return { ctx, P };
};
/** Beispiel-Umgebung laden und ein Board öffnen (wie m389) */
const insBoard = async (P, name, beruehrung = false) => {
  const knopf = P.locator('[data-taste="onb-beispiele"]');
  if (await knopf.count()) { if (beruehrung) await knopf.tap(); else await knopf.click(); await P.waitForTimeout(1300); }
  await P.evaluate((n) => { const j = JSON.parse(localStorage.getItem('pixinotes-board')); const b = j.state.boards.find((x) => x.name.includes(n)); j.state.view = 'board'; j.state.activeId = b.id; localStorage.setItem('pixinotes-board', JSON.stringify(j)); Storage.prototype.setItem = () => {}; }, name);
  await P.reload({ waitUntil: 'networkidle' }); await P.waitForTimeout(1500);
};

/** Eine Oberfläche: Namen und Kontraste in ihrem Bereich */
const oberflaeche = async (P, titel, wurzel, thema) => {
  const w = await P.evaluate((s) => {
    const el = s ? document.querySelector(s) : document;
    if (!el) return null;
    return { namen: window.__a11y.namenlos(el), kontr: window.__a11y.kontraste(el) };
  }, wurzel);
  if (!w) { pruefe(`${thema} ${titel}: geöffnet`, false, wurzel); return; }
  if (ERKUNDEN) console.log(`    [${thema} ${titel}]`, JSON.stringify(w, null, 1));
  pruefe(`A ${thema} ${titel}: alle Bedienelemente und Felder haben einen Namen`, w.namen.length === 0, w.namen.join(' · '));
  pruefe(`B ${thema} ${titel}: Schrift mit genug Kontrast (≥ 4,5:1, groß ≥ 3:1)`, w.kontr.length === 0, w.kontr.join(' · '));
};

/** Fenster: role/aria-modal, Fokus hinein, Tab im Kreis, Esc, Fokus zurück */
const fensterPruefen = async (P, titel, oeffnen, kasten, zurueck) => {
  await oeffnen(); await P.waitForSelector(kasten); await P.waitForTimeout(300);
  const rolle = await P.evaluate((s) => { const k = document.querySelector(s); const d = k.closest('[role=dialog]') ?? k.querySelector('[role=dialog]'); return { rolle: !!d, modal: d?.getAttribute('aria-modal'), name: d ? window.__a11y.name(d) || d.getAttribute('aria-label') : '' }; }, kasten);
  pruefe(`D ${titel}: role=dialog mit aria-modal und Namen`, rolle.rolle && rolle.modal === 'true' && !!rolle.name, JSON.stringify(rolle));
  pruefe(`D ${titel}: Fokus liegt nach dem Öffnen im Fenster`, await P.evaluate(() => !!document.activeElement?.closest('[role=dialog], .modal-backdrop, .search-backdrop')));
  let drin = true; let ringlos = [];
  for (let i = 0; i < 25; i++) {
    await P.keyboard.press('Tab');
    const f = await P.evaluate(() => window.__a11y.fokus());
    if (!f.imFenster) drin = false;
    if (!f.ok) ringlos.push(`${f.el} „${f.name}"`);
  }
  ringlos = [...new Set(ringlos)];
  pruefe(`D ${titel}: Tab bleibt im Fenster (25 Schritte)`, drin);
  pruefe(`C ${titel}: jedes per Tab angewählte Element zeigt einen Fokusring`, ringlos.length === 0, ringlos.join(' · '));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  const nachher = await P.evaluate((s) => ({ zu: !document.querySelector(s), fokus: document.activeElement?.getAttribute('data-taste') ?? document.activeElement?.className ?? '' }), kasten);
  pruefe(`D ${titel}: Esc schließt, der Fokus kehrt zurück`, nachher.zu && (!zurueck || nachher.fokus === zurueck), JSON.stringify(nachher));
};

for (const thema of ['light', 'dark']) {
  const T = thema === 'light' ? 'hell' : 'dunkel';
  console.log(`\n════ ${T}: Oberflächen ════`);
  const { ctx, P } = await neu({}, thema);
  await insBoard(P, 'Schreibtisch');
  await oberflaeche(P, 'Board (Kopfleiste, Seitenleiste, Dock)', null, T);

  // Auswahl-Leiste
  const g = await P.evaluate(() => { const r = document.querySelector('.react-flow__node-note').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 6]; });
  await P.mouse.click(g[0], g[1]); await P.waitForSelector('.sel-toolbar'); await P.waitForTimeout(300);
  await oberflaeche(P, 'Auswahl-Leiste', '.sel-toolbar', T);
  // Kontextmenü: auf der Karte (das „Mehr"-Menü am Zeiger) und auf der freien Fläche
  await P.mouse.click(g[0], g[1], { button: 'right' }); await P.waitForTimeout(400);
  const km = await P.evaluate(() => { const m = document.querySelector('.sel-menu-fixed'); return m ? { rolle: m.getAttribute('role'), eintraege: [...m.querySelectorAll('button')].filter((b) => window.__a11y.sichtbar(b)).every((b) => /^menuitem/.test(b.getAttribute('role') ?? '')) } : null; });
  pruefe(`A ${T} Kontextmenü der Karte: role=menu, Einträge als menuitem`, km?.rolle === 'menu' && km.eintraege, JSON.stringify(km));
  if (km) await oberflaeche(P, 'Kontextmenü der Karte', '.sel-menu-fixed', T);
  await P.keyboard.press('Escape'); await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  const frei = await P.evaluate(() => { const p = document.querySelector('.react-flow__pane').getBoundingClientRect(); return [p.right - 260, p.bottom - 160]; });
  await P.mouse.click(frei[0], frei[1], { button: 'right' }); await P.waitForTimeout(400);
  const kf = await P.evaluate(() => { const m = document.querySelector('.kontext-menue'); return m ? { rolle: m.getAttribute('role'), eintraege: [...m.querySelectorAll('button')].filter((b) => window.__a11y.sichtbar(b)).every((b) => /^menuitem/.test(b.getAttribute('role') ?? '')) } : null; });
  pruefe(`A ${T} Kontextmenü der Fläche: role=menu, Einträge als menuitem`, kf?.rolle === 'menu' && kf.eintraege, JSON.stringify(kf));
  if (kf) await oberflaeche(P, 'Kontextmenü der Fläche', '.kontext-menue', T);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  // Fenster und Überlagerungen
  for (const [titel, taste, wurzel] of [
    ['Einstellungen', 'Alt+e', '.modal-backdrop'],
    ['Hilfe', 'Alt+h', '.modal-backdrop'],
    ['Suche', 'Control+k', '.search-backdrop'],
    ['Aufgaben-Zentrale', 'Alt+t', '.taskhub'],
  ]) {
    await P.keyboard.press(taste); await P.waitForSelector(wurzel); await P.waitForTimeout(500);
    await oberflaeche(P, titel, wurzel, T);
    await P.keyboard.press('Escape'); await P.waitForTimeout(400);
    if (await P.locator(wurzel).count()) { await P.keyboard.press(taste); await P.waitForTimeout(300); }
  }
  // Einstellungen: alle Reiter
  await P.keyboard.press('Alt+e'); await P.waitForSelector('.modal-tabs');
  const reiter = await P.locator('.modal-tabs button').count();
  for (let i = 1; i < reiter; i++) {
    await P.locator('.modal-tabs button').nth(i).click(); await P.waitForTimeout(300);
    // auch was hinter „Mehr …"-Aufklappern steht
    await P.evaluate(() => document.querySelectorAll('.modal-backdrop details:not([open])').forEach((d) => { d.open = true; })); await P.waitForTimeout(200);
    const r = await P.locator('.modal-tabs button').nth(i).innerText();
    await oberflaeche(P, `Einstellungen › ${r.trim()}`, '.modal-backdrop', T);
  }
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);

  // Karten-Fokus
  await P.mouse.click(g[0], g[1]); await P.waitForTimeout(200);
  await P.keyboard.press('Alt+f'); await P.waitForSelector('.focus-head'); await P.waitForTimeout(800);
  await oberflaeche(P, 'Karten-Fokus (Kopf und Leiste)', '.focus-head', T);
  await P.keyboard.press('Escape'); await P.waitForTimeout(400); await P.keyboard.press('Escape'); await P.waitForTimeout(300);

  // Übersicht
  await P.evaluate(() => document.querySelector('.logo')?.click()); await P.waitForTimeout(1200);
  await oberflaeche(P, 'Übersicht', null, T);
  await ctx.close();
}

// ══ C/D: Tastatur ═══════════════════════════════════════════════════
console.log('\n════ Tastatur: Fokus sichtbar, Fenster ════');
{
  const { ctx, P } = await neu();
  await insBoard(P, 'Schreibtisch');
  await P.evaluate(() => document.activeElement?.blur());
  const ringlos = new Set(); const stationen = new Set();
  for (let i = 0; i < 75; i++) {
    await P.keyboard.press('Tab');
    const f = await P.evaluate(() => window.__a11y.fokus());
    stationen.add(f.el + f.name); if (ERKUNDEN) console.log("      tab", i, f.el, f.name);
    if (!f.ok && f.el !== 'body' && !/react-flow__(node|pane|renderer)/.test(f.el)) ringlos.add(`${f.el} „${f.name}"`);
  }
  pruefe('C Board: jedes per Tab angewählte Element zeigt einen Fokusring (75 Schritte)', ringlos.size === 0, [...ringlos].join(' · '));
  const dockKnoepfe = await P.evaluate(() => [...document.querySelectorAll('.dock > button, .dock .dock-add-wrap > button')].filter((b) => window.__a11y.sichtbar(b)).map((b) => window.__a11y.pfad(b) + window.__a11y.name(b).slice(0, 30)));
  const nichtErreicht = dockKnoepfe.filter((k) => !stationen.has(k));
  pruefe('C Tab erreicht jeden Knopf des Docks (und mehr als zehn Stationen insgesamt)', stationen.size > 10 && dockKnoepfe.length >= 3 && nichtErreicht.length === 0, JSON.stringify({ zahl: stationen.size, nichtErreicht }));

  // Aufklapp-Knöpfe sagen, ob ihr Menü offen ist (WCAG 4.1.2: Zustand)
  const aufklapp = async (sel, titel) => {
    const k = P.locator(sel).first();
    const vor = await k.getAttribute('aria-expanded');
    await k.click(); await P.waitForTimeout(300);
    const nach = await k.getAttribute('aria-expanded');
    await P.keyboard.press('Escape'); await P.waitForTimeout(250);
    if ((await k.getAttribute('aria-expanded')) === 'true') { await k.click(); await P.waitForTimeout(250); }
    pruefe(`A ${titel}: aria-expanded meldet zu/offen`, vor === 'false' && nach === 'true', JSON.stringify([vor, nach]));
  };
  await aufklapp('.dock button[aria-label="Objekt hinzufügen"]', 'Dock „Objekt hinzufügen"');
  await aufklapp('.dock [data-taste="zeichnen"]', 'Dock „Zeichnen"');
  await aufklapp('.dock button[aria-label="Mehr"]', 'Dock „Mehr"');
  const g = await P.evaluate(() => { const r = document.querySelector('.react-flow__node-note').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 6]; });
  await P.mouse.click(g[0], g[1]); await P.waitForSelector('.sel-toolbar');
  await aufklapp('[data-taste="auswahl-mehr"]', 'Auswahl-Leiste „Mehr"');
  await P.keyboard.press('Escape'); await P.waitForTimeout(250);

  await fensterPruefen(P, 'Einstellungen', () => P.locator('[data-taste="einstellungen"]').first().focus().then(() => P.keyboard.press('Enter')), '.modal-tabs', 'einstellungen');
  await fensterPruefen(P, 'Hilfe', () => P.locator('[data-taste="hilfe"]').first().focus().then(() => P.keyboard.press('Enter')), '.help-modal', 'hilfe');
  await fensterPruefen(P, 'Suche', () => P.keyboard.press('Control+k'), '.search-box', null);
  // Aufgaben-Zentrale (eigene Ansicht über dem Board): Fokus hinein, Esc, Fokus zurück
  await P.locator('[data-taste="aufgaben"]').first().focus(); await P.keyboard.press('Enter'); await P.waitForSelector('.taskhub'); await P.waitForTimeout(400);
  let hinein = await P.evaluate(() => !!document.activeElement?.closest('.taskhub'));
  if (!hinein) { await P.keyboard.press('Tab'); hinein = await P.evaluate(() => !!document.activeElement?.closest('.taskhub')); }
  pruefe('D Aufgaben-Zentrale: der Fokus ist nach dem Öffnen (spätestens nach einem Tab) in der Zentrale', hinein, await P.evaluate(() => window.__a11y.pfad(document.activeElement)));
  await P.keyboard.press('Escape'); await P.waitForTimeout(400);
  const tz = await P.evaluate(() => ({ zu: !document.querySelector('.taskhub'), fokus: document.activeElement?.getAttribute('data-taste') }));
  pruefe('D Aufgaben-Zentrale: Esc schließt, der Fokus kehrt auf den Knopf zurück', tz.zu && tz.fokus === 'aufgaben', JSON.stringify(tz));
  await ctx.close();
}

// Jedes Fenster im Quelltext (Hintergrund-Ebene der Fenster-Führung, lib/fensterFokus.ts) trägt role=dialog,
// aria-modal und einen Namen — auch die, die diese Reihe nicht öffnet (Kanban-Ticket, Bild-Lupe, Nachschlagen …).
{
  const dateien = [];
  const lauf = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) lauf(path.join(d, f.name)); else if (f.name.endsWith('.tsx')) dateien.push(path.join(d, f.name)); } };
  lauf(path.join(__repo, 'src/components'));
  const fenster = readFileSync(path.join(__repo, 'src/lib/fensterFokus.ts'), 'utf8').match(/const FENSTER = '([^']+)'/)[1].split(',').map((x) => x.trim().slice(1));
  const ohne = [];
  for (const d of dateien) {
    const zeilen = readFileSync(d, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      const k = z.match(/className=(?:"([^"]*)"|\{`([^`]*)`\})/);
      if (!k || !fenster.some((f) => (k[1] ?? k[2]).split(/\s+/).includes(f))) return;
      const block = zeilen.slice(i, i + 12).join(' ');
      if (!/role="dialog"/.test(block) || !/aria-modal="true"/.test(block) || !/aria-label/.test(block)) ohne.push(`${path.basename(d)}:${i + 1}`);
    });
  }
  pruefe('D jedes Fenster im Quelltext: role=dialog + aria-modal + aria-label', ohne.length === 0, ohne.join(' · '));
}

// ══ E: Bewegung ═════════════════════════════════════════════════════
console.log('\n════ Bewegung ════');
{
  const { ctx, P } = await neu({ reducedMotion: 'reduce' });
  await insBoard(P, 'Schreibtisch');
  const b = await P.evaluate(() => {
    const alle = [...document.querySelectorAll('body *')].filter((e) => window.__a11y.sichtbar(e));
    const bewegt = alle.filter((e) => { const cs = getComputedStyle(e); const t = cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0.01); const a = cs.animationName !== 'none' && cs.animationDuration.split(',').some((d) => parseFloat(d) > 0.01); return t || a; });
    return { zahl: alle.length, bewegt: bewegt.slice(0, 8).map(window.__a11y.pfad) };
  });
  pruefe('E mit „Bewegung reduzieren" hat kein sichtbares Element einen Übergang oder eine Animation', b.zahl > 50 && b.bewegt.length === 0, b.bewegt.join(' · '));
  await ctx.close();
}

// ══ F: Finger ═══════════════════════════════════════════════════════
console.log('\n════ Finger (Tablet) ════');
{
  const { ctx, P } = await neu({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  await insBoard(P, 'Schreibtisch', true);
  const leisten = await P.evaluate(() => { const w = [...document.querySelectorAll('.topbar, .tabs, .dock')]; return { zahl: w.flatMap((x) => [...x.querySelectorAll('button')].filter(window.__a11y.sichtbar)).length, klein: w.flatMap((x) => window.__a11y.ziele(x, 40)) }; });
  pruefe('F Kopfleiste und Dock: Tippziele am Finger ≥ 40 Punkte', leisten.zahl >= 6 && leisten.klein.length === 0, JSON.stringify({ zahl: leisten.zahl, klein: [...new Set(leisten.klein)] }));
  await P.locator('.dock button[aria-label="Mehr"]').tap(); await P.waitForSelector('.dock-menu-more'); await P.waitForTimeout(300);
  const mehr = await P.evaluate(() => window.__a11y.ziele(document.querySelector('.dock-menu-more'), 40));
  pruefe('F Dock-Menü „Mehr": Einträge am Finger ≥ 40 Punkte hoch', mehr.length === 0, [...new Set(mehr)].join(' · '));
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  const g = await P.evaluate(() => { const r = document.querySelector('.react-flow__node-note').getBoundingClientRect(); return [r.left + r.width / 2, r.top + 8]; });
  await P.touchscreen.tap(g[0], g[1]); await P.waitForTimeout(600);
  const sel = await P.evaluate(() => { const s = document.querySelector('.sel-toolbar'); return s ? window.__a11y.ziele(s, 40) : ['keine Leiste']; });
  pruefe('F Auswahl-Leiste: Tippziele am Finger ≥ 40 Punkte', sel.length === 0, [...new Set(sel)].join(' · '));
  await ctx.close();
}

// ══ G ═══════════════════════════════════════════════════════════════
console.log('\n════ Doku ════');
const quelle = (p) => readFileSync(path.join(__repo, p), 'utf8');
pruefe('G docs/AUDIT.md führt den Abschnitt Barrierefreiheit (M447) mit Befunden', /Barrierefreiheit \(M447\)/.test(quelle('docs/AUDIT.md')) && /\| B1 \|/.test(quelle('docs/AUDIT.md')));
pruefe('G Meilenstein-Datei liegt vor', existsSync(path.join(__repo, 'docs/meilensteine/M447-barrierefreiheit.md')));
pruefe('G keine Fehler der Seite', fehler.length === 0, fehler.join(' | '));

await browser.close(); app.close();
console.log(`\nm447-barrierefreiheit: ${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
