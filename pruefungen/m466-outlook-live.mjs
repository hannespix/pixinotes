/**
 * M466 — Outlook live: Mails und Termine aus Microsoft 365 (nur lesen).
 *
 * Microsoft-Anmeldung (OAuth-PKCE-Popup, Token-Endpunkt) und Graph (/me/mailFolders/inbox/messages, /me/messages,
 * /attachments, /me/calendarview) sind komplett per page.route nachgestellt — kein echter Netzverkehr.
 *
 *   A  OHNE APP-ID: Strg+K „Outlook" öffnet das Fenster – es sagt, dass die Anmeldung noch nicht eingerichtet ist,
 *      die Felder für Betreiber liegen eingeklappt darunter; kein Aufruf an Microsoft.
 *   B  ANMELDEN: ＋ → Outlook → E-Mail eintragen → „Mit Microsoft anmelden": ein Popup mit PKCE, Mail.Read und
 *      Calendars.Read, Konto vorgewählt; danach steht der Posteingang da. Das Token liegt nur im Konten-Speicher.
 *   C  SUCHEN: eine Suche fragt /me/messages?$search= und zeigt die Treffer.
 *   D  AUFS BOARD: eine Mail wird E-Mail-Karte – dieselben Felder wie eine abgelegte .eml, Anhänge auf Wunsch über
 *      /attachments eingebettet; der Destillat-Knopf ist da.
 *   E  BÖSARTIGES HTML: Skripte, Ereignis-Attribute und Styles der Mail laufen nicht und landen nicht auf dem Board.
 *   F  TERMINE: die Outlook-Termine erscheinen in der Kalender-Karte.
 *   G  ABMELDEN: Token und Refresh-Token sind weg, der Kalender zeigt keine Konto-Termine mehr.
 *   H  Keine Fehler.
 */
// Läuft aus dem Repository: `node pruefungen/m466-outlook-live.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = process.env.PN_DIST ?? path.join(__repo, 'dist');
const PORT = 5466;
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info.slice(0, 700) : JSON.stringify(info).slice(0, 700)}`); }
};
const app = http.createServer((q, r) => {
  let f = path.join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = path.join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }[path.extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));

const heute = new Date();
const pad = (n) => String(n).padStart(2, '0');
const heuteIso = `${heute.getFullYear()}-${pad(heute.getMonth() + 1)}-${pad(heute.getDate())}`;
const PDF = Buffer.from('%PDF-1.4\n% Angebot Mueller\n%%EOF\n');

const MAILS = [
  { id: 'AAMk-1', subject: 'Angebot Halle', from: { emailAddress: { name: 'Anna Berg', address: 'anna.berg@beispiel.de' } }, receivedDateTime: '2026-11-20T08:15:00Z', bodyPreview: 'Das Angebot von Müller liegt bei 18.400 Euro.', hasAttachments: true, isRead: false },
  { id: 'AAMk-2', subject: 'Rechnung <img src=x onerror="window.__boese=1">', from: { emailAddress: { name: 'Böse <b>Firma</b>', address: 'boese@example.org' } }, receivedDateTime: '2026-11-19T10:00:00Z', bodyPreview: 'Bitte sofort zahlen', hasAttachments: false, isRead: true },
];
const KOERPER = {
  'AAMk-1': { contentType: 'html', content: '<html><head><style>p{color:red}</style></head><body><p>Hallo zusammen,</p><p>das Angebot von Müller liegt bei 18.400 Euro. Ben, kannst du es bis 04.12. prüfen?</p><p>Viele Grüße<br>Anna Berg<br>Tel. 0761 123456</p></body></html>' },
  'AAMk-2': { contentType: 'html', content: '<div>Sehr geehrte Damen und Herren,</div><script>window.__boese=2</script><img src="https://tracker.example.org/pixel.gif" onerror="window.__boese=3" onload="window.__boese=4"><style>.x{background:url(https://tracker.example.org/s.png)}</style><p>Bitte <b>sofort</b> zahlen.</p><a href="javascript:window.__boese=5">hier</a><iframe src="https://evil.example.org"></iframe>' },
};

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const fehler = [];

/** Neue Seite: leeres Board (mit Kalender-Karte), Chat-KI konfiguriert; `konto` = Inhalt des Konten-Speichers */
const auf = async ({ konto = {} } = {}) => {
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1440, height: 900 } });
  const log = { authorize: [], token: [], graph: [], fremd: [] };
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(obj) });
  await ctx.route('https://login.microsoftonline.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/authorize')) {
      log.authorize.push(Object.fromEntries(url.searchParams));
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', 'code-466'); back.searchParams.set('state', url.searchParams.get('state'));
      return route.fulfill({ status: 302, headers: { location: back.toString() }, body: '' });
    }
    if (url.pathname.endsWith('/token')) {
      log.token.push(Object.fromEntries(new URLSearchParams(route.request().postData() ?? '')));
      return json(route, 200, { access_token: 'ms-tok-466', refresh_token: 'ms-ref-466', expires_in: 3600, scope: 'Calendars.Read Mail.Read User.Read offline_access' });
    }
    return json(route, 404, {});
  });
  await ctx.route('https://graph.microsoft.com/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const p = decodeURIComponent(url.pathname);
    log.graph.push(`${p}${url.search ? `?${decodeURIComponent(url.search.slice(1))}` : ''}`);
    if (req.headers().authorization !== 'Bearer ms-tok-466') return json(route, 401, { error: { code: 'InvalidAuthenticationToken' } });
    if (p === '/v1.0/me') return json(route, 200, { displayName: 'Hanna Muster', userPrincipalName: 'hanna@firma.de' });
    if (p === '/v1.0/me/mailFolders/inbox/messages') return json(route, 200, { value: MAILS });
    if (p === '/v1.0/me/messages' && url.searchParams.get('$search')) return json(route, 200, { value: MAILS.filter((m) => m.subject.includes('Angebot')) });
    let mm = /^\/v1\.0\/me\/messages\/([^/]+)$/.exec(p);
    if (mm) { const m = MAILS.find((x) => x.id === mm[1]); return m ? json(route, 200, { ...m, body: KOERPER[m.id] }) : json(route, 404, {}); }
    if (p === '/v1.0/me/messages/AAMk-1/attachments') {
      return json(route, 200, { value: [
        { '@odata.type': '#microsoft.graph.fileAttachment', id: 'ANH-1', name: 'Angebot.pdf', contentType: 'application/pdf', size: PDF.length, isInline: false },
        { '@odata.type': '#microsoft.graph.fileAttachment', id: 'ANH-2', name: 'logo.png', contentType: 'image/png', size: 100, isInline: true },
      ] });
    }
    mm = /^\/v1\.0\/me\/messages\/AAMk-1\/attachments\/([^/]+)\/\$value$/.exec(p);
    if (mm && mm[1] === 'ANH-1') return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: PDF });
    if (p === '/v1.0/me/calendarview' || p === '/v1.0/me/events') {
      return json(route, 200, { value: [{ subject: 'Abnahme Halle (Outlook)', isAllDay: false, start: { dateTime: `${heuteIso}T10:00:00.0000000` } }] });
    }
    return json(route, 404, { error: { message: `unbekannt: ${p}` } });
  });
  // Alles andere außerhalb von localhost wäre ein Leck (Tracking-Pixel aus der Mail, iframe …)
  await ctx.route(/^https?:\/\/(?!localhost|login\.microsoftonline\.com|graph\.microsoft\.com)/, (route) => { log.fremd.push(route.request().url()); return route.abort(); });
  await ctx.addInitScript(([k]) => {
    try { if (window !== window.top || window.opener || localStorage.getItem('pixinotes-onboarded')) return; } catch { return; }
    localStorage.setItem('pixinotes-onboarded', '1'); localStorage.setItem('pixinotes-ohne-emoji', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-cal-accounts', JSON.stringify(k));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: {
      boards: [{ id: 'b1', name: 'Post', edges: [], drawings: [], comments: [], nodes: [
        { id: 'kal', type: 'calendar', width: 430, height: 340, position: { x: 900, y: 60 }, data: {} },
      ] }],
      spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'P', boardIds: ['b1'] }] }], activeId: 'b1', view: 'board', cardFocus: false, clickZoom: false, physicsEnabled: false,
      ai: { provider: 'openai', model: 'gpt-test', apiKey: 'test', baseUrl: '' }, brain: { on: false, provider: 'auto' } } }));
  }, [konto]);
  const P = await ctx.newPage();
  P.on('pageerror', (e) => fehler.push(e.message));
  await P.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1500);
  return { ctx, P, log };
};
const stand = async (P) => { await P.waitForTimeout(700); return P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-board')).state.boards[0]); };
const konten = (P) => P.evaluate(() => localStorage.getItem('pixinotes-cal-accounts') ?? '');
const fenster = (P) => P.locator('[role="dialog"][aria-label="Outlook"]');
const ueberStrgK = async (P) => {
  await P.keyboard.press('Control+k'); await P.waitForTimeout(500);
  await P.keyboard.type('Outlook'); await P.waitForTimeout(400);
  await P.locator('.search-overlay, [role="dialog"]').getByText('Outlook', { exact: true }).first().click();
  await P.waitForTimeout(900);
};
const ueberPlus = async (P) => {
  await P.locator('.dock [aria-label="Objekt hinzufügen"]').click(); await P.waitForSelector('.modul-palette');
  await P.locator('.modul-kachel[data-modul="outlook"]').click(); await P.waitForTimeout(900);
};
const ablegen = (P, inhalt, name) => P.evaluate(([i, n]) => {
  const dt = new DataTransfer();
  dt.items.add(new File([i], n, { type: 'message/rfc822' }));
  const ziel = document.querySelector('.react-flow__pane');
  for (const art of ['dragover', 'drop']) ziel.dispatchEvent(new DragEvent(art, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 300, clientY: 600 }));
}, [inhalt, name]);

// ---------- A ----------
console.log('A  Ohne App-ID: ehrlicher Hinweis, Betreiber-Felder eingeklappt');
{
  const { ctx, P, log } = await auf();
  await ueberStrgK(P);
  pruefe('A1 Strg+K „Outlook" öffnet das Outlook-Fenster', await fenster(P).isVisible());
  const hinweis = await P.locator('[data-taste="outlook-nicht-eingerichtet"]').textContent().catch(() => '');
  pruefe('A2 der Hinweis sagt: noch nicht eingerichtet, bis dahin .eml/.msg ziehen', /noch nicht eingerichtet/.test(hinweis) && /\.eml/.test(hinweis), hinweis);
  const det = P.locator('[data-taste="outlook-betreiber"]');
  pruefe('A3 „Für Betreiber" liegt eingeklappt darunter und nennt Mail.Read und die Umleitungs-URI', (await det.count()) === 1 && !(await det.evaluate((d) => d.open)) && /Mail\.Read/.test(await det.textContent()) && (await det.textContent()).includes(`localhost:${PORT}/`));
  pruefe('A4 kein Anmelde-Knopf, kein Aufruf an Microsoft', (await P.locator('[data-taste="outlook-anmelden"]').count()) === 0 && log.authorize.length === 0 && log.graph.length === 0);
  await P.keyboard.press('Escape'); await P.waitForTimeout(300);
  pruefe('A5 Escape schließt das Fenster', (await fenster(P).count()) === 0);
  await ctx.close();
}

// ---------- B–G ----------
const { ctx, P, log } = await auf({ konto: { ms: { clientId: 'ms-app-466', tenant: 'common' } } });
console.log('B  Anmelden über ＋ → Outlook');
{
  await ueberPlus(P);
  pruefe('B1 ＋ → Einfügen → Outlook öffnet dasselbe Fenster mit „Mit Microsoft anmelden"', await fenster(P).isVisible() && (await P.locator('[data-taste="outlook-anmelden"]').textContent()).includes('Mit Microsoft anmelden'));
  await P.locator('[data-taste="outlook-mail"]').fill('hanna@firma.de');
  await P.locator('[data-taste="outlook-anmelden"]').click();
  await P.waitForSelector('[data-taste="outlook-liste"] li', { timeout: 15000 }).catch(() => {});
  const a = log.authorize[0] ?? {};
  pruefe('B2 Anmeldung mit PKCE, nur Lese-Rechte für Mail und Kalender, Konto vorgewählt', a.client_id === 'ms-app-466' && a.code_challenge_method === 'S256' && /Mail\.Read/.test(a.scope) && /Calendars\.Read/.test(a.scope) && /offline_access/.test(a.scope) && !/ReadWrite|Send/.test(a.scope) && a.login_hint === 'hanna@firma.de', a);
  pruefe('B3 Code-Tausch mit code_verifier, ohne Client-Secret', log.token[0]?.code_verifier?.length > 40 && !log.token[0]?.client_secret && log.token[0]?.code === 'code-466', log.token[0]);
  const zeilen = await P.locator('[data-taste="outlook-liste"] .outlook-mail').allTextContents();
  pruefe('B4 der Posteingang steht da (neueste zuerst angefragt)', zeilen.length === 2 && zeilen[0].includes('Angebot Halle') && zeilen[0].includes('Anna Berg') && log.graph.some((g) => g.startsWith('/v1.0/me/mailFolders/inbox/messages') && g.replace(/\+/g, ' ').includes('receivedDateTime desc')), { zeilen, graph: log.graph });
  const k = await konten(P);
  const board = await P.evaluate(() => localStorage.getItem('pixinotes-board'));
  pruefe('B5 das Token liegt nur im Konten-Speicher, nie im Board', k.includes('ms-tok-466') && k.includes('Mail.Read') && !board.includes('ms-tok') && !board.includes('ms-ref'));
  pruefe('B6 die bösartige Betreffzeile steht als Text in der Liste, nichts wurde ausgeführt', (await P.locator('[data-taste="outlook-liste"] img').count()) === 0 && (await P.evaluate(() => window.__boese)) === undefined && zeilen[1].includes('<img src=x'), zeilen[1]);
}

console.log('C  Suchen');
{
  await P.locator('[data-taste="outlook-suche"]').fill('Angebot');
  await P.keyboard.press('Enter');
  await P.waitForTimeout(900);
  const zeilen = await P.locator('[data-taste="outlook-liste"] .outlook-mail').allTextContents();
  pruefe('C1 die Suche fragt /me/messages mit $search und zeigt nur die Treffer', log.graph.some((g) => g.startsWith('/v1.0/me/messages?') && g.includes('$search="Angebot"')) && zeilen.length === 1 && zeilen[0].includes('Angebot Halle'), { graph: log.graph.slice(-2), zeilen });
  pruefe('C2 die Kopfzeile nennt die Treffer', /1 Treffer für „Angebot"/.test(await P.locator('.outlook-kopf').textContent()), await P.locator('.outlook-kopf').textContent());
}

console.log('D  Mail aufs Board – wie eine .eml, Anhang auf Wunsch');
let outlookKarte;
{
  await P.locator('[data-taste="outlook-anhaenge"]').check();
  await P.locator('[data-taste="outlook-holen"]').first().click();
  await P.waitForTimeout(1500);
  const b = await stand(P);
  outlookKarte = b.nodes.find((n) => n.type === 'email');
  const d = outlookKarte?.data ?? {};
  pruefe('D1 eine E-Mail-Karte mit Betreff, Absender, Adresse, Datum und Text', d.subject === 'Angebot Halle' && d.fromName === 'Anna Berg' && d.fromAddress === 'anna.berg@beispiel.de' && d.date === '2026-11-20T08:15:00.000Z' && /18\.400 Euro/.test(d.text) && /Viele Grüße\nAnna Berg/.test(d.text) && !/color:red|<p>/.test(d.text), d);
  pruefe('D2 der Anhang kam über /attachments und ist eingebettet; das Inline-Logo nicht', d.attachments?.length === 1 && d.attachments[0].name === 'Angebot.pdf' && d.attachments[0].dataUrl?.startsWith('data:application/pdf;base64,') && Buffer.from(d.attachments[0].dataUrl.split(',')[1], 'base64').equals(PDF) && log.graph.some((g) => g.endsWith('/attachments/ANH-1/$value')), d.attachments);
  await ablegen(P, ['From: Anna Berg <anna.berg@beispiel.de>', 'Subject: Angebot Halle', 'Date: Fri, 20 Nov 2026 09:15:00 +0100', 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Hallo'].join('\r\n'), 'halle.eml');
  await P.waitForTimeout(1500);
  const b2 = await stand(P);
  const eml = b2.nodes.find((n) => n.type === 'email' && n.id !== outlookKarte.id);
  const schluessel = (x) => Object.keys(x ?? {}).filter((s) => s !== 'outlookId').sort().join(',');
  const typen = (x) => ['subject', 'fromName', 'fromAddress', 'date', 'text', 'attachments'].map((s) => (Array.isArray(x?.[s]) ? 'array' : typeof x?.[s])).join(',');
  pruefe('D3 dieselben Felder wie eine abgelegte .eml (nur die Herkunft outlookId kommt hinzu)', !!eml && schluessel(eml.data) === schluessel(d) && typen(eml.data) === typen(d) && d.outlookId === 'AAMk-1', { eml: schluessel(eml?.data), outlook: schluessel(d) });
  const destillat = P.locator(`.react-flow__node[data-id="${outlookKarte.id}"] button`, { hasText: 'Destillat' });
  pruefe('D4 an der Outlook-Karte steht der Destillat-Knopf', (await destillat.count()) === 1);
  pruefe('D5 die Liste merkt sich: diese Mail liegt schon auf dem Board', (await P.locator('[data-taste="outlook-holen"]').first().textContent()).includes('Noch einmal'));
}

console.log('E  Bösartiges HTML wird entschärft');
{
  await P.locator('[data-taste="outlook-suche"]').fill('');
  await P.locator('[aria-label="Posteingang neu laden"]').click(); await P.waitForTimeout(900);
  await P.locator('[data-taste="outlook-anhaenge"]').uncheck();
  await P.locator('[data-taste="outlook-holen"]').nth(1).click();
  await P.waitForTimeout(1600);
  const b = await stand(P);
  const k = b.nodes.find((n) => n.type === 'email' && n.data.outlookId === 'AAMk-2');
  const t = k?.data.text ?? '';
  pruefe('E1 der Text der Mail ist da, ohne Skript, Style, Ereignis-Attribute oder Links', /Sehr geehrte Damen und Herren/.test(t) && /Bitte sofort zahlen\./.test(t) && !/__boese|<script|onerror|\.x\{|tracker|javascript:/.test(t), t);
  pruefe('E2 nichts wurde ausgeführt, kein Pixel und kein iframe geladen', (await P.evaluate(() => window.__boese)) === undefined && log.fremd.length === 0, log.fremd);
  const karte = P.locator(`.react-flow__node[data-id="${k?.id}"]`);
  pruefe('E3 die Karte enthält kein Bild, kein iframe, kein Skript', (await karte.locator('img, iframe, script').count()) === 0 && (await karte.textContent()).includes('Rechnung <img src=x'));
  pruefe('E4 Betreff und Absender stehen als Text', k?.data.subject.startsWith('Rechnung <img') && k?.data.fromName === 'Böse <b>Firma</b>' && k?.data.attachments.length === 0, k?.data);
}

console.log('F  Outlook-Termine in der Kalender-Karte');
{
  await P.locator('[role="dialog"][aria-label="Outlook"] .modal-x').click(); await P.waitForTimeout(1500);
  const kal = P.locator('.react-flow__node[data-id="kal"]');
  const text = await kal.evaluate((el) => `${el.textContent} ${[...el.querySelectorAll('[title]')].map((x) => x.getAttribute('title')).join(' ')}`);
  pruefe('F1 der Termin aus Outlook steht in der Kalender-Karte', /Abnahme Halle \(Outlook\)/.test(text) && log.graph.some((g) => g.startsWith('/v1.0/me/calendarview')), text.slice(0, 400));
}

console.log('G  Abmelden räumt das Token');
{
  await ueberStrgK(P);
  await P.locator('[data-taste="outlook-abmelden"]').click(); await P.waitForTimeout(1200);
  const k = await konten(P);
  pruefe('G1 Token, Refresh-Token und Kontoname sind weg, nur die App-ID bleibt', !k.includes('ms-tok') && !k.includes('ms-ref') && !k.includes('Hanna') && k.includes('ms-app-466'), k);
  pruefe('G2 das Fenster bietet wieder die Anmeldung an, die Liste ist leer', (await P.locator('[data-taste="outlook-anmelden"]').count()) === 1 && (await P.locator('[data-taste="outlook-liste"]').count()) === 0);
  await P.keyboard.press('Escape'); await P.waitForTimeout(1200);
  const text = await P.locator('.react-flow__node[data-id="kal"]').evaluate((el) => `${el.textContent} ${[...el.querySelectorAll('[title]')].map((x) => x.getAttribute('title')).join(' ')}`);
  pruefe('G3 die Kalender-Karte zeigt keine Outlook-Termine mehr', !/Abnahme Halle \(Outlook\)/.test(text), text.slice(0, 300));
  const board = await P.evaluate(() => localStorage.getItem('pixinotes-board'));
  pruefe('G4 die geholten Mail-Karten bleiben auf dem Board', (board.match(/"outlookId"/g) ?? []).length === 2);
}
await ctx.close();

console.log('H  Keine Fehler');
pruefe('H1 keine Seitenfehler', fehler.length === 0, fehler);

await browser.close();
app.close();
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
