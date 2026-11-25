/**
 * M516 — „Als App installieren" in der App, mit Diagnose.
 *
 *   A  Manifest: feste id „/pixinotes/" (gleich der bisher abgeleiteten), Symbole mit purpose, Bildschirmfotos
 *      (wide + narrow) erreichbar und in der angegebenen Größe, related_applications (webapp → eigenes Manifest).
 *   B  Installierbar (echtes Profil, kein Inkognito): Page.getInstallabilityErrors leer, Manifest ohne Fehler,
 *      Page.getAppId = Start-Adresse (die Kennung bestehender Installationen ändert sich nicht).
 *   C  Mit Angebot des Browsers (synthetisches beforeinstallprompt): ⋯ der Leiste → „Als App installieren" ruft
 *      prompt() – kein Diagnose-Fenster; appinstalled → kurze Bestätigung.
 *   D  Ohne Angebot: Diagnose mit Chrome-Weg, Hinweis auf Firmen-Richtlinie (chrome://policy), Ausweg
 *      „Verknüpfung erstellen … / Als Fenster öffnen"; derselbe Eintrag in der Suche (Strg+K).
 *   E  display-mode: standalone → „Läuft bereits als App"; andere Browser (Edge, iPhone, Firefox) → passende Anleitung.
 *   F  Das Fenster lädt nach: Diagnose-Texte nicht im Start-Paket.
 */
// Läuft aus dem Repository: `node pruefungen/m516-app-installieren.mjs` (braucht `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const PORT = 5516;
const BASIS = `http://localhost:${PORT}/pixinotes/`;
const TYP = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Wie GitHub Pages: die App liegt unter /pixinotes/ — so stimmt die Kennung der Prüfung mit der echten überein
const app = http.createServer((q, r) => {
  const pfad = q.url.split('?')[0];
  if (!pfad.startsWith('/pixinotes/')) { r.writeHead(404); r.end(); return; }
  const rel = pfad.slice('/pixinotes/'.length);
  let f = join(DIST, rel === '' ? 'index.html' : rel);
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': TYP[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => { if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${info}`); } };
const warteBis = async (P, fn, ms = 15000, arg) => { try { await P.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } };

const startStand = () => {
  if (localStorage.getItem('pixinotes-onboarded')) return;
  localStorage.setItem('pixinotes-onboarded', '1');
};

// ══ A: Manifest ══════════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ A: Manifest ════');
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
pruefe('A1 feste id „/pixinotes/" (Pages: gleich der aus start_url abgeleiteten Kennung)', manifest.id === '/pixinotes/', manifest.id);
pruefe('A2 start_url und scope unverändert „./"', manifest.start_url === './' && manifest.scope === './');
pruefe('A3 jedes Symbol hat purpose; 192 und 512 als „any", maskable extra',
  manifest.icons.every((i) => i.purpose) && ['192x192', '512x512'].every((s) => manifest.icons.some((i) => i.sizes === s && i.purpose === 'any'))
  && manifest.icons.some((i) => i.purpose === 'maskable'));
const breit = manifest.screenshots?.find((s) => s.form_factor === 'wide');
const schmal = manifest.screenshots?.find((s) => s.form_factor === 'narrow');
pruefe('A4 Bildschirmfotos wide und narrow mit Beschriftung', !!breit && !!schmal && !!breit.label && !!schmal.label);
pruefe('A5 related_applications nennt das eigene Manifest (für getInstalledRelatedApps)',
  manifest.related_applications?.some((a) => a.platform === 'webapp' && a.url === 'https://hannespix.github.io/pixinotes/manifest.webmanifest') && manifest.prefer_related_applications === false);
pruefe('A6 kein display_override (Kopfleiste kennt kein window-controls-overlay)', !('display_override' in manifest));

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
{
  const ctx = await browser.newContext();
  const P = await ctx.newPage();
  await P.goto(BASIS);
  const masse = await P.evaluate(async (liste) => Promise.all(liste.map(async (s) => {
    const img = new Image(); img.src = new URL(s.src, location.href).href;
    try { await img.decode(); } catch { return null; }
    return `${img.naturalWidth}x${img.naturalHeight}`;
  })), manifest.screenshots);
  pruefe('A7 Bildschirmfotos laden und haben die angegebene Größe', masse.every((m, i) => m === manifest.screenshots[i].sizes), JSON.stringify(masse));
  const groesse = manifest.screenshots.reduce((n, s) => n + readFileSync(join(DIST, s.src)).length, 0);
  pruefe('A8 Bildschirmfotos zusammen klein (< 80 KB)', groesse < 80_000, String(groesse));
  await ctx.close();
}

// ══ B: Installierbar ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ B: Installierbar (echtes Profil) ════');
{
  const ordner = mkdtempSync(join(tmpdir(), 'pn-m516-'));
  const ctx = await chromium.launchPersistentContext(ordner, { executablePath: CHROMIUM, args: ['--no-sandbox'] });
  await ctx.addInitScript(startStand);
  const P = ctx.pages()[0] ?? await ctx.newPage();
  await P.goto(BASIS);
  const sw = await warteBis(P, () => navigator.serviceWorker?.ready.then(() => true), 20000);
  await P.reload();
  const kontrolliert = await warteBis(P, () => !!navigator.serviceWorker?.controller, 20000);
  pruefe('B1 Service Worker aktiv und kontrolliert die Seite', sw && kontrolliert);
  const cdp = await ctx.newCDPSession(P);
  let fehler = null;
  for (let i = 0; i < 20; i += 1) {
    fehler = (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors;
    if (fehler.length === 0) break;
    await P.waitForTimeout(500);
  }
  pruefe('B2 Page.getInstallabilityErrors leer', fehler.length === 0, JSON.stringify(fehler));
  const man = await cdp.send('Page.getAppManifest');
  pruefe('B3 Manifest ohne Fehler', man.errors.length === 0, JSON.stringify(man.errors));
  const id = await cdp.send('Page.getAppId');
  pruefe('B4 App-Kennung = Start-Adresse; Chromium empfiehlt genau unsere id', id.appId === BASIS && id.recommendedId === manifest.id, JSON.stringify(id));
  await ctx.close();
  rmSync(ordner, { recursive: true, force: true });
}
// Gegenprobe: Ohne „id" leitet Chromium die Kennung aus start_url ab — sie muss dieselbe sein (keine Doppel-Installation).
// Eigener Kontext ohne Service Worker, damit das abgefangene Manifest wirklich ankommt.
{
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/manifest.webmanifest', (route) => {
    const ohne = { ...manifest }; delete ohne.id;
    return route.fulfill({ status: 200, contentType: 'application/manifest+json', body: JSON.stringify(ohne) });
  });
  await ctx.addInitScript(startStand);
  const P = await ctx.newPage();
  await P.goto(BASIS);
  const cdp = await ctx.newCDPSession(P);
  let ohneId = null; let ohneManifest = null;
  for (let i = 0; i < 30; i += 1) {
    ohneManifest = await cdp.send('Page.getAppManifest').catch(() => null);
    ohneId = await cdp.send('Page.getAppId').catch(() => null);
    if (ohneId?.appId && ohneManifest?.data) break;
    await P.waitForTimeout(300);
  }
  const wirklichOhne = !!ohneManifest?.data && !('id' in JSON.parse(ohneManifest.data));
  pruefe('B5 Gegenprobe: ohne id wäre die Kennung dieselbe (bisherige Installationen bleiben gültig)', wirklichOhne && ohneId?.appId === BASIS, `${wirklichOhne} ${JSON.stringify(ohneId)}`);
  await ctx.close();
}

// Hilfen für C–E: Inkognito-Kontext (dort bietet der Browser nie von selbst an — das Angebot spielen wir nach)
async function neueSeite(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  await ctx.addInitScript(startStand);
  const P = await ctx.newPage();
  await P.goto(BASIS);
  await P.waitForSelector('.dock button[aria-label="Mehr"]', { timeout: 20000 });
  return { ctx, P };
}
const eintragImDock = async (P) => {
  await P.locator('.dock button[aria-label="Mehr"]').click();
  const e = P.locator('[data-taste="dock-app-installieren"]');
  await e.waitFor({ timeout: 5000 });
  return e;
};

// ══ C: Mit Angebot ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ C: Der Browser bietet an → prompt() ════');
{
  const { ctx, P } = await neueSeite();
  await P.evaluate(() => {
    window.__prompt = 0;
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__prompt += 1; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(e);
  });
  const e = await eintragImDock(P);
  pruefe('C1 ⋯ der Leiste: „Als App installieren …"', (await e.textContent()).includes('Als App installieren'));
  await e.click();
  pruefe('C2 der Eintrag ruft prompt() des Browsers', await warteBis(P, () => window.__prompt === 1, 5000));
  await P.waitForTimeout(800);
  pruefe('C3 kein Diagnose-Fenster, wenn der Browser anbietet', (await P.locator('[data-taste="app-installieren"]').count()) === 0);
  await P.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  pruefe('C4 appinstalled → kurze Bestätigung', await warteBis(P, () => [...document.querySelectorAll('.toast')].some((t) => /ist installiert/.test(t.textContent ?? '')), 5000));
  // Das Angebot ist verbraucht: Ein zweiter Klick zeigt die Diagnose statt eines zweiten prompt()
  await (await eintragImDock(P)).click();
  pruefe('C5 verbrauchtes Angebot → zweiter Klick öffnet die Diagnose (kein zweites prompt())',
    (await warteBis(P, () => !!document.querySelector('[data-taste="app-installieren"]'), 8000)) && (await P.evaluate(() => window.__prompt)) === 1);
  await ctx.close();
}

// ══ D: Ohne Angebot ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ D: Kein Angebot → Diagnose ════');
{
  const { ctx, P } = await neueSeite();
  await (await eintragImDock(P)).click();
  const f = P.locator('[data-taste="app-installieren"]');
  await f.waitFor({ timeout: 8000 });
  pruefe('D1 Diagnose-Fenster öffnet (Lage „nicht", Chrome erkannt)', (await f.getAttribute('data-lage')) === 'nicht' && (await f.getAttribute('data-browser')) === 'chrome',
    `${await f.getAttribute('data-lage')} ${await f.getAttribute('data-browser')}`);
  const text = await f.innerText();
  pruefe('D2 Chrome-Weg: ⋮ → „Speichern und teilen" → „Seite als App installieren …"', /Speichern und teilen/.test(text) && /Seite als App installieren/.test(text));
  pruefe('D3 Hinweis auf Firmen-Richtlinie mit chrome://policy', /Von deiner Organisation verwaltet/.test(text) && /chrome:\/\/policy/.test(text) && (await f.locator('[data-grund="richtlinie"]').count()) === 1);
  pruefe('D4 „schon installiert" und „privates Fenster" als Gründe', (await f.locator('[data-grund="schon"]').count()) === 1 && (await f.locator('[data-grund="privat"]').count()) === 1);
  pruefe('D5 Ausweg: „Verknüpfung erstellen …" mit „Als Fenster öffnen"', /Verknüpfung erstellen/.test(text) && /Als Fenster öffnen/.test(text));
  pruefe('D6 nach Wartezeit: „hat der Browser keine Installation angeboten"', await (async () => {
    await P.keyboard.press('Escape');
    await warteBis(P, () => !document.querySelector('[data-taste="app-installieren"]'), 3000);
    await P.waitForFunction(() => performance.now() > 8500, null, { timeout: 15000 });
    await (await eintragImDock(P)).click();
    return warteBis(P, () => !!document.querySelector('[data-taste="app-installieren-nie"]'), 5000);
  })());
  pruefe('D7 Esc schließt das Fenster', await (async () => { await P.keyboard.press('Escape'); return warteBis(P, () => !document.querySelector('[data-taste="app-installieren"]'), 3000); })());
  await P.keyboard.press('Control+k'); await P.waitForSelector('.search-backdrop', { timeout: 4000 });
  await P.keyboard.type('als app', { delay: 15 }); await P.waitForTimeout(300);
  const befehl = P.locator('.search-backdrop button', { hasText: 'Als App installieren' }).first();
  pruefe('D8 die Suche kennt „Als App installieren"', (await befehl.count()) === 1);
  await befehl.click();
  pruefe('D9 … und öffnet die Diagnose', await warteBis(P, () => !!document.querySelector('[data-taste="app-installieren"]') && !document.querySelector('.search-backdrop'), 6000));
  // Kommt das Angebot, während das Fenster offen ist, steht der Knopf „Jetzt installieren" da
  await P.evaluate(() => {
    window.__prompt = 0;
    const e = new Event('beforeinstallprompt');
    e.prompt = () => { window.__prompt += 1; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    window.dispatchEvent(e);
  });
  const jetzt = P.locator('[data-taste="app-installieren-jetzt"]');
  pruefe('D10 Angebot während das Fenster offen ist → „Jetzt installieren"', await jetzt.waitFor({ timeout: 4000 }).then(() => true, () => false));
  await jetzt.click();
  pruefe('D11 … ruft prompt()', await warteBis(P, () => window.__prompt === 1, 4000));
  await ctx.close();
}

// ══ E: Läuft als App · andere Browser ════════════════════════════════════════════════════════════════════
console.log('\n════ E: Als App · andere Browser ════');
{
  // Chromium emuliert „display-mode" über CDP nicht — die Abfrage wird so beantwortet, wie eine installierte App es tut
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    const echt = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (!/display-mode:\s*standalone/.test(q)) return echt(q);
      const m = echt(q);
      return { matches: true, media: q, onchange: null, addEventListener: m.addEventListener.bind(m), removeEventListener: m.removeEventListener.bind(m), addListener: m.addListener.bind(m), removeListener: m.removeListener.bind(m), dispatchEvent: m.dispatchEvent.bind(m) };
    };
  });
  await ctx.addInitScript(startStand);
  const P = await ctx.newPage();
  await P.goto(BASIS);
  await P.waitForSelector('.dock button[aria-label="Mehr"]', { timeout: 20000 });
  const emuliert = await P.evaluate(() => matchMedia('(display-mode: standalone)').matches);
  await (await eintragImDock(P)).click();
  const f = P.locator('[data-taste="app-installieren"]');
  await f.waitFor({ timeout: 8000 });
  pruefe('E1 display-mode: standalone → „PixiNotes läuft bereits als App."', emuliert && (await f.getAttribute('data-lage')) === 'app' && /läuft bereits als App/.test(await f.innerText()), String(emuliert));
  await ctx.close();
}
const UA = {
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
};
for (const [name, ua, muster, grund] of [
  ['edge', UA.edge, /Diese Website als App installieren/, /edge:\/\/policy/],
  ['iphone', UA.iphone, /Zum Home-Bildschirm/, null],
  // M534: Firefox unter Windows heftet Web-Apps an die Taskleiste (neuere Fassungen) — Linux/Mac weiter „installiert nicht"
  ['firefox', UA.firefox, /Zur Taskleiste hinzufügen/, null],
  ['firefox-linux', UA.firefox.replace('Windows NT 10.0; Win64; x64', 'X11; Linux x86_64'), /Firefox installiert Web-Apps am Computer nicht/, null],
]) {
  const { ctx, P } = await neueSeite({ userAgent: ua });
  await (await eintragImDock(P)).click();
  const f = P.locator('[data-taste="app-installieren"]');
  await f.waitFor({ timeout: 8000 });
  const text = await f.innerText();
  pruefe(`E-${name} passende Anleitung${grund ? ' und Richtlinie' : ''}`, muster.test(text) && (!grund || grund.test(text)) && (grund || (await f.locator('[data-grund="richtlinie"]').count()) === 0), text.slice(0, 200));
  await ctx.close();
}

// ══ F: nachgeladen ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n════ F: Diagnose lädt nach ════');
{
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const start = [...html.matchAll(/src="\.\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
  const startText = start.map((f) => readFileSync(join(DIST, 'assets', f), 'utf8')).join('\n');
  pruefe('F1 Diagnose-Texte nicht im Start-Paket', start.length > 0 && !startText.includes('Mögliche Gründe') && !startText.includes('WebAppInstallByUserEnabled'));
  pruefe('F2 eigenes Teil-Paket AppInstallierenFenster', readdirSync(join(DIST, 'assets')).some((f) => /^AppInstallierenFenster-.*\.js$/.test(f)));
}

await browser.close();
app.close();
console.log(`\n${ok} ✓  ${bad} ✗`);
process.exit(bad ? 1 : 0);
