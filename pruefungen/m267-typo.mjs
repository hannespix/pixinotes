/**
 * M267 — „textformatierung läuft noch nicht rund! man kann kleiner oder größer
 * machen... aber nicht zurück auf standart.. zu aufwendig. nicht intuitiv
 * genug.. zu viel unterschiedliche bearbeitungs-orte"
 *
 * Geprüft wird genau das, was der Nutzer beschreibt:
 *  · Kommt man von JEDER Stufe in EINEM Schritt zurück auf Standard?
 *  · Führt der Weg über Standard hindurch statt daran vorbei?
 *  · Ist es EIN Ort statt mehrerer — und heißen die Dinge überall gleich?
 */
// Läuft aus dem Repository: `node pruefungen/m267-typo.mjs`
// Voraussetzung: `npm run build` (die Reihe prüft den dist/-Stand) und ein
// Chromium — Pfad über die Umgebungsvariable PW_CHROMIUM, sonst der
// Standardpfad der Claude-Umgebung.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const SD = path.join(__repo, 'pruefungen', 'ablage');
import { mkdirSync } from 'node:fs';
mkdirSync(SD, { recursive: true });
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = path.join(__repo, 'dist');
const PORT = 4462;
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
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => {
  // NUR beim ersten Laden setzen — sonst überschreibt ein Reload die Arbeit (M256/M263)
  if (localStorage.getItem('pixinotes-board')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
  localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false }));
  const nodes = [{
    id: 'n1', type: 'note', position: { x: 60, y: 60 }, width: 380, height: 240,
    data: { color: 'yellow', blocks: [{ id: 'b1', type: 'paragraph', props: {},
      content: [{ type: 'text', text: 'Hallo Welt, ein Testabsatz.', styles: {} }], children: [] }] },
  }];
  localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
    boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes }],
    spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
    activeId: 'b0', view: 'board', cardFocus: false, navLinks: false } }));
});
const P = await ctx.newPage();
P.on('pageerror', (e) => console.log('    PAGEERROR:', e.message));
await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await P.waitForTimeout(1800);

/** Markierten Text im Notiz-Editor herstellen */
async function markieren() {
  await P.locator('.note-editor p').first().click();
  await P.waitForTimeout(250);
  await P.keyboard.press('Control+A');
  await P.waitForTimeout(500);
}
/** Knopf der Formatier-Leiste über seine Beschriftung drücken */
const leistenKnopf = (t) => P.evaluate((l) => {
  const tb = document.querySelector('.bn-formatting-toolbar');
  const b = [...(tb?.querySelectorAll('button') ?? [])].find((x) => (x.textContent || '').trim() === l);
  if (!b) return 'FEHLT';
  if (b.disabled) return 'GESPERRT';
  b.click();
  return 'ok';
}, t);
const knopfZustand = (t) => P.evaluate((l) => {
  const tb = document.querySelector('.bn-formatting-toolbar');
  const b = [...(tb?.querySelectorAll('button') ?? [])].find((x) => (x.textContent || '').trim() === l);
  return b ? { da: true, gesperrt: !!b.disabled, tip: b.getAttribute('data-tooltip') || b.title || '' } : { da: false };
}, t);
/** Der gesetzte Inline-Stil im ersten formatierten Stück */
const stil = () => P.evaluate(() => {
  const s = document.querySelector('.note-editor p span[style]');
  return s ? s.getAttribute('style').replace(/\s+/g, ' ').trim() : 'STANDARD';
});

// ══ T1: Die Leiter geht DURCH Standard hindurch ═════════════════════
console.log('════ T1: − und ＋ gehen eine Stufe, über Standard hinweg ════');
await markieren();
pruefe('T1a die alten Einzelschalter A₋/A₊/A₊₊ gibt es nicht mehr',
  (await knopfZustand('A₊₊')).da === false);
pruefe('T1b es gibt A− und A+', (await knopfZustand('A−')).da && (await knopfZustand('A+')).da);

console.log('    Start   :', await stil());
await leistenKnopf('A+'); await P.waitForTimeout(350);
const s1 = await stil();
console.log('    A+      :', s1);
pruefe('T1c ＋ von Standard führt auf Groß (1.3em)', s1.includes('1.3em'), s1);

await leistenKnopf('A−'); await P.waitForTimeout(350);
const s2 = await stil();
console.log('    A−      :', s2);
pruefe('T1d − von Groß führt ZURÜCK AUF STANDARD (nicht auf Klein)',
  s2 === 'STANDARD', `war: ${s2}`);

await leistenKnopf('A−'); await P.waitForTimeout(350);
const s3 = await stil();
console.log('    A−      :', s3);
pruefe('T1e eine weitere Stufe nach unten ist Klein (0.85em)', s3.includes('0.85em'), s3);
const zu = await knopfZustand('A−');
pruefe('T1f am unteren Ende ist − gesperrt statt heimlich umzulaufen', zu.gesperrt, JSON.stringify(zu));

await leistenKnopf('A+'); await P.waitForTimeout(350);
pruefe('T1g ＋ von Klein führt zurück auf Standard', (await stil()) === 'STANDARD', await stil());

// Oberes Ende
await leistenKnopf('A+'); await P.waitForTimeout(300);
await leistenKnopf('A+'); await P.waitForTimeout(300);
const oben = await stil();
pruefe('T1h zwei Stufen hoch ergibt Riesig (1.7em)', oben.includes('1.7em'), oben);
pruefe('T1i am oberen Ende ist ＋ gesperrt', (await knopfZustand('A+')).gesperrt);

// ══ T2: Das Aa-Menü — jede Stufe direkt, Standard anklickbar ════════
console.log('\n════ T2: Aa-Menü mit allen Stufen und dem Weg zurück ════');
await leistenKnopf('Aa');
await P.waitForTimeout(500);
const menue = await P.evaluate(() => {
  const d = document.querySelector('.pn-typo-menu');
  if (!d) return null;
  return {
    labels: [...d.querySelectorAll('[class*="Menu-label"]')].map((x) => x.textContent.trim()),
    eintraege: [...d.querySelectorAll('[class*="Menu-item"]')].map((x) => x.textContent.trim()),
  };
});
console.log('   ', JSON.stringify(menue));
pruefe('T2a das Menü öffnet sich', !!menue);
pruefe('T2b es gliedert in Textgröße und Schriftart',
  menue?.labels.join('|') === 'Textgröße|Schriftart', JSON.stringify(menue?.labels));
for (const w of ['Klein', 'Standard', 'Groß', 'Riesig']) {
  pruefe(`T2c „${w}" ist als Größe direkt anklickbar`, !!menue?.eintraege.includes(w));
}
pruefe('T2d „Formatierung entfernen" ist da',
  !!menue?.eintraege.includes('Formatierung entfernen'));
pruefe('T2e die Schriftarten heißen wie im Karten-Menü',
  ['Serifen', 'Sehr gut lesbar', 'Handschrift', 'Monospace'].every((f) => menue?.eintraege.includes(f)),
  JSON.stringify(menue?.eintraege));

// Standard direkt anspringen — aus „Riesig" heraus, in EINEM Klick
const klickeEintrag = (t) => P.evaluate((l) => {
  const d = document.querySelector('.pn-typo-menu');
  const e = [...(d?.querySelectorAll('[class*="Menu-item"]') ?? [])].find((x) => x.textContent.trim() === l);
  if (!e) return 'FEHLT';
  e.click();
  return 'ok';
}, t);
console.log('    vor dem Klick:', await stil());
pruefe('T2f Klick auf „Standard"', (await klickeEintrag('Standard')) === 'ok');
await P.waitForTimeout(500);
const nach = await stil();
console.log('    danach       :', nach);
pruefe('T2g EIN Klick auf „Standard" holt Riesig zurück auf Standard',
  nach === 'STANDARD', `war: ${nach}`);

// ══ T3: Formatierung entfernen räumt ALLES weg ══════════════════════
console.log('\n════ T3: Radiergummi ════');
await markieren();
await leistenKnopf('A+'); await P.waitForTimeout(300);
await P.evaluate(() => {
  const tb = document.querySelector('.bn-formatting-toolbar');
  [...tb.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Fett')?.click();
});
await P.waitForTimeout(400);
const vorher = await P.evaluate(() => document.querySelector('.note-editor p').innerHTML);
pruefe('T3a Text ist jetzt fett UND groß',
  /1\.3em/.test(vorher) && /<strong|font-weight/i.test(vorher), vorher.slice(0, 160));
await leistenKnopf('Aa'); await P.waitForTimeout(450);
await klickeEintrag('Formatierung entfernen');
await P.waitForTimeout(500);
const danach = await P.evaluate(() => document.querySelector('.note-editor p').innerHTML);
console.log('    danach:', danach.slice(0, 140));
pruefe('T3b „Formatierung entfernen" nimmt Größe UND Fett zurück',
  !/1\.3em/.test(danach) && !/<strong/i.test(danach), danach.slice(0, 160));

// ══ T4: Karten-Ebene — EIN Klick statt drei ════════════════════════
console.log('\n════ T4: Schrift & Größe der Karte ════');
await P.keyboard.press('Escape');
await P.mouse.click(1100, 700);
await P.waitForTimeout(400);
await P.locator('.note-card').first().click({ position: { x: 4, y: 4 } });
await P.waitForTimeout(600);
const direkt = await P.evaluate(() => {
  const t = document.querySelector('.sel-toolbar');
  const b = [...(t?.querySelectorAll('button') ?? [])].find((x) => x.getAttribute('aria-label') === 'Schrift & Größe');
  if (!b) return null;
  b.click();
  return true;
});
pruefe('T4a die Auswahl-Leiste hat einen eigenen Knopf „Schrift & Größe"', direkt === true);
await P.waitForTimeout(500);
const kartenMenue = await P.evaluate(() => {
  const m = document.querySelector('.sel-font-menu');
  if (!m) return null;
  return {
    titel: [...m.querySelectorAll('.sel-attr-title')].map((x) => x.textContent.trim()),
    groessen: [...m.querySelectorAll('.sel-font-sizes button')].map((x) => x.textContent.trim()),
    knoepfe: [...m.querySelectorAll('button')].map((x) => x.textContent.trim()),
  };
});
console.log('   ', JSON.stringify(kartenMenue));
pruefe('T4b ein Klick genügt — das Menü ist offen', !!kartenMenue);
pruefe('T4c die Größen heißen wie beim markierten Text',
  JSON.stringify(kartenMenue?.groessen) === JSON.stringify(['Klein', 'Standard', 'Groß', 'Riesig']),
  JSON.stringify(kartenMenue?.groessen));
pruefe('T4d Größe steht vor Schriftart — wie im Aa-Menü',
  JSON.stringify(kartenMenue?.titel) === JSON.stringify(['Textgröße', 'Schriftart']),
  JSON.stringify(kartenMenue?.titel));
pruefe('T4e es gibt „Zurück auf Standard"',
  kartenMenue?.knoepfe.some((k) => k.includes('Zurück auf Standard')));

// Wirkung prüfen: Riesig setzen, dann zurück
const klickKarte = (t) => P.evaluate((l) => {
  const m = document.querySelector('.sel-font-menu');
  const b = [...(m?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === l
    || x.textContent.trim().includes(l));
  if (!b) return 'FEHLT';
  b.click();
  return 'ok';
}, t);
const kartenKlasse = () => P.evaluate(() => {
  const n = document.querySelector('.react-flow__node');
  return [...n.classList].filter((c) => c.startsWith('pn-')).join(' ') || '(keine)';
});
await klickKarte('Riesig'); await P.waitForTimeout(400);
await klickKarte('Handschrift'); await P.waitForTimeout(400);
const gesetzt = await kartenKlasse();
console.log('    gesetzt:', gesetzt);
pruefe('T4f Riesig + Handschrift greifen an der Karte',
  gesetzt.includes('pn-size-xl') && gesetzt.includes('pn-font-hand'), gesetzt);
pruefe('T4g „Zurück auf Standard" klickbar', (await klickKarte('Zurück auf Standard')) === 'ok');
await P.waitForTimeout(500);
const zurueck = await kartenKlasse();
console.log('    danach :', zurueck);
pruefe('T4h EIN Klick räumt Größe UND Schriftart der Karte ab',
  !zurueck.includes('pn-size-') && !zurueck.includes('pn-font-'), zurueck);

// ══ T5: Nur noch EIN Ort — nicht mehr zusätzlich im ⋯-Menü ═════════
console.log('\n════ T5: keine zweite Menü-Stelle mehr ════');
await P.keyboard.press('Escape');
await P.waitForTimeout(300);
await P.evaluate(() => {
  const t = document.querySelector('.sel-toolbar');
  [...(t?.querySelectorAll('button') ?? [])].find((x) => x.getAttribute('aria-label') === 'Mehr')?.click();
});
await P.waitForTimeout(500);
const mehr = await P.evaluate(() => {
  const m = document.querySelector('.sel-more-menu');
  return m ? [...m.querySelectorAll('button')].map((b) => b.textContent.trim()) : null;
});
console.log('    ⋯-Menü:', JSON.stringify(mehr));
pruefe('T5a das ⋯-Menü öffnet', !!mehr);
pruefe('T5b „Schrift & Größe" steht dort NICHT mehr doppelt',
  !mehr?.some((e) => e.includes('Schrift')), JSON.stringify(mehr));

await P.screenshot({ path: `${SD}/m267-karte.png` });

// ══ T6: Die Leiste wird nicht mehr am Kartenrand abgeschnitten ══════
console.log('\n════ T6: nichts liegt hinter dem Kartenrand ════');
await P.keyboard.press('Escape');
await markieren();
const mass = await P.evaluate(() => {
  const tb = document.querySelector('.bn-formatting-toolbar');
  if (!tb) return null;
  const r = tb.getBoundingClientRect();
  const karte = tb.closest('.card-body')?.getBoundingClientRect();
  /* Der ehrliche Test ist nicht „welcher Vorfahre hat overflow:hidden" — die
     Leiste steht `fixed` und hängt damit gar nicht mehr in dessen
     Beschneidungskette. Gefragt ist, ob man die Knöpfe TRIFFT. Also für jeden
     Knopf nachsehen, was an seiner Mitte tatsächlich obenauf liegt. */
  const knoepfe = [...tb.querySelectorAll('button')];
  const daneben = knoepfe.filter((b) => {
    const q = b.getBoundingClientRect();
    const treffer = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return !treffer || !b.contains(treffer) && treffer !== b;
  }).map((b) => (b.textContent || b.getAttribute('aria-label') || '?').trim());
  const letzter = knoepfe[knoepfe.length - 1].getBoundingClientRect();
  return {
    leisteRechts: Math.round(r.right), leisteBreit: Math.round(r.width),
    kartenRechts: karte ? Math.round(karte.right) : null,
    ueberDenRand: karte ? Math.round(r.right - karte.right) : 0,
    nichtTreffbar: daneben,
    lage: getComputedStyle(tb.parentElement).position,
    letzterKnopfRechts: Math.round(letzter.right),
    schirm: window.innerWidth,
  };
});
console.log('   ', JSON.stringify(mass));
pruefe('T6a die Leiste hängt nicht mehr im beschnittenen Kartenkasten',
  mass?.lage === 'fixed', JSON.stringify(mass?.lage));
pruefe('T6b sie ragt über den Kartenrand hinaus — und darf das jetzt',
  (mass?.ueberDenRand ?? 0) > 100, `${mass?.ueberDenRand} Punkte`);
pruefe('T6c JEDER Knopf ist anklickbar (nichts liegt hinter dem Rand)',
  mass?.nichtTreffbar.length === 0, JSON.stringify(mass?.nichtTreffbar));
pruefe('T6d der letzte Knopf (Aa) liegt im Bild',
  mass && mass.letzterKnopfRechts <= mass.schirm, JSON.stringify(mass));

// ══ T7: Karten-Leiste und Formatier-Leiste überlappen nicht ════════
console.log('\n════ T7: zwei Leisten, kein Übereinander ════');
const ueberlappt = await P.evaluate(() => {
  const a = document.querySelector('.sel-toolbar')?.getBoundingClientRect();
  const b = document.querySelector('.bn-formatting-toolbar')?.getBoundingClientRect();
  if (!a || !b) return { fehlt: !a ? 'sel' : 'bn' };
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  return { ueber: y > 1 && x > 1, y: Math.round(y), x: Math.round(x),
    sel: [Math.round(a.top), Math.round(a.bottom)], bn: [Math.round(b.top), Math.round(b.bottom)] };
});
console.log('   ', JSON.stringify(ueberlappt));
pruefe('T7a beide Leisten sind da', !ueberlappt.fehlt, JSON.stringify(ueberlappt));
pruefe('T7b sie liegen nicht übereinander', ueberlappt.ueber === false, JSON.stringify(ueberlappt));
pruefe('T7c die Kennzeichnung am body ist gesetzt',
  await P.evaluate(() => document.body.dataset.formatierleiste === 'an'));
await P.screenshot({ path: `${SD}/m267-zwei-leisten.png` });

// Und sie verschwindet wieder, wenn nicht formatiert wird
await P.keyboard.press('Escape');
await P.mouse.click(1150, 780);
await P.waitForTimeout(700);
pruefe('T7d ohne Formatier-Leiste ist die Kennzeichnung weg',
  await P.evaluate(() => document.body.dataset.formatierleiste === undefined));

// ══ T8: Telefon — angedockte Leisten stapeln sich nicht ════════════
console.log('\n════ T8: Telefon ════');
{
  const tel = await browser.newContext({
    viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  await tel.addInitScript(() => {
    localStorage.setItem('pixinotes-onboarded', '1');
    // fokusEinKlick statt Zeigergerät-Erkennung: Playwright meldet trotz
    // hasTouch kein `pointer: coarse`, und geprüft werden soll der FOKUS-Weg
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ navLinks: false, fokusEinKlick: true }));
    const nodes = [{ id: 'n1', type: 'note', position: { x: 20, y: 20 }, width: 300, height: 200,
      data: { color: 'yellow', blocks: [{ id: 'b1', type: 'paragraph', props: {},
        content: [{ type: 'text', text: 'Text am Telefon.', styles: {} }], children: [] }] } }];
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b0', name: 'Test', edges: [], drawings: [], nodes }],
      spaces: [{ id: 's1', name: 'Privat', projects: [{ id: 'p1', name: 'P', boardIds: ['b0'] }] }],
      activeId: 'b0', view: 'board', cardFocus: true, navLinks: false, fokusEinKlick: true } }));
  });
  const T = await tel.newPage();
  await T.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await T.waitForTimeout(1800);
  /* Am Telefon öffnet EIN Tipper die Karte im Fokus (Board.tsx, isPhoneFocus) —
     das ist der echte Weg zum Schreiben, und nur dort greift M226. */
  await T.locator('.note-card').first().click({ position: { x: 4, y: 40 } });
  await T.waitForTimeout(1200);
  pruefe('T8-0 ein Tipper öffnet die Karte im Fokus',
    await T.evaluate(() => !!document.querySelector('.app.focus-mode')));
  await T.locator('.note-editor p').first().click();
  await T.waitForTimeout(400);
  await T.keyboard.press('Control+A');
  await T.waitForTimeout(900);
  const m = await T.evaluate(() => {
    const a = document.querySelector('.sel-toolbar-dock')?.getBoundingClientRect();
    const b = document.querySelector('.bn-formatting-toolbar')?.getBoundingClientRect();
    if (!a || !b) return { fehlt: !a ? 'sel-dock' : 'bn' };
    const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return { ueber: y > 1, y: Math.round(y),
      sel: [Math.round(a.top), Math.round(a.bottom)], bn: [Math.round(b.top), Math.round(b.bottom)],
      breit: Math.round(b.width), scroll: document.querySelector('.bn-formatting-toolbar').scrollWidth,
      schirm: window.innerWidth,
      // Erreicht man den letzten Knopf durch Wischen?
      knoepfe: [...document.querySelectorAll('.bn-formatting-toolbar button')].length };
  });
  console.log('   ', JSON.stringify(m));
  pruefe('T8a beide Leisten sind am Telefon da', !m.fehlt, JSON.stringify(m));
  pruefe('T8b sie stapeln sich nicht', m.ueber === false, JSON.stringify(m));
  pruefe('T8c die Formatier-Leiste dockt über die volle Schirmbreite an (M226)',
    m.breit >= m.schirm - 1, JSON.stringify(m));
  pruefe('T8d sie ist quer scrollbar — alle Knöpfe erreichbar',
    m.scroll >= m.breit, JSON.stringify(m));
  // Der Aa-Knopf muss auch am Telefon zu erreichen sein
  const erreichbar = await T.evaluate(async () => {
    const tb = document.querySelector('.bn-formatting-toolbar');
    tb.scrollLeft = tb.scrollWidth;
    await new Promise((r) => requestAnimationFrame(r));
    const aa = [...tb.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Aa');
    if (!aa) return 'FEHLT';
    const q = aa.getBoundingClientRect();
    const t = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
    return t && (aa === t || aa.contains(t)) ? 'ok' : 'VERDECKT';
  });
  pruefe('T8e nach dem Wischen ist Aa antippbar', erreichbar === 'ok', erreichbar);
  await T.screenshot({ path: `${SD}/m267-telefon.png` });
  await tel.close();
}

console.log(`\n  ${ok} bestanden, ${bad} durchgefallen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
