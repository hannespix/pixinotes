/**
 * M479 — Mit Google anmelden (PixiNotes-Konto über Supabase-OAuth).
 * Supabase (GoTrue: settings, authorize, token, user, logout; PostgREST konto_dateien, RPC konto_schreiben;
 * Realtime) ist im Node-Prozess nachgebaut. Die Weiterleitung zu Google ersetzt eine kleine Seite des
 * nachgebauten authorize, die sofort mit ?code=… (PKCE) bzw. #access_token=… (impliziter Ablauf) zurückleitet.
 *
 *   A  Anmeldeschirm: „Mit Google anmelden" steht gleichrangig neben dem E-Mail-Link; die Drive-Knöpfe heißen
 *      nach ihrem Ziel; Microsoft erscheint nur, wenn das Projekt es eingeschaltet hat.
 *   B  Anbieter aus (settings.external.google = false): ein klarer Satz, keine Weiterleitung, „Für Betreiber" zu.
 *   C  PKCE: Klick → authorize mit provider=google, redirect_to = App-Adresse, login_hint = E-Mail, code_challenge;
 *      Rückkehr ?code=… → Tausch mit dem richtigen Verifier → angemeldet (Name/E-Mail sichtbar), Sync schreibt,
 *      Adresse aufgeräumt.
 *   D  Impliziter Ablauf: Rückkehr #access_token=… meldet ohne Rückfrage an.
 *   E  Abbruch bei Google (?error=access_denied) → verständliche Meldung, nicht angemeldet.
 *   F  Fremdes ?code= ohne eigene Anmeldung bleibt unberührt (kein Tausch).
 *   G  Microsoft (azure) eingeschaltet: eigener Knopf, provider=azure mit scopes=email.
 *   H  Abmelden räumt die Sitzung; der Knopf steht wieder da.
 */
// Läuft aus dem Repository: `node pruefungen/m479-google-anmelden.mjs`
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { extname, join } from 'node:path';

const __repo = fileURLToPath(new URL('..', import.meta.url));
const CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const DIST = path.join(__repo, 'dist');
const PORT = 5479;
const APP = `http://localhost:${PORT}/`;
const app = http.createServer((q, r) => {
  let f = join(DIST, q.url.split('?')[0] === '/' ? 'index.html' : q.url.split('?')[0].slice(1));
  if (!existsSync(f)) f = join(DIST, 'index.html');
  r.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(f)] ?? 'application/octet-stream' });
  r.end(readFileSync(f));
});
await new Promise((x) => app.listen(PORT, x));
let ok = 0; let bad = 0;
const pruefe = (n, gut, info = '') => {
  if (gut) { ok += 1; console.log(`  ✓ ${n}`); } else { bad += 1; console.log(`  ✗ ${n} ${typeof info === 'string' ? info : JSON.stringify(info)}`); }
};
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

// ---------- Nachgebautes Supabase ----------
const SB_URL = 'https://test.supabase.co';
const SB_KEY = 'anon-test-key';
const sb = {
  anbieter: { email: true, google: true, azure: false },
  rueckweg: 'code',                // 'code' | 'fragment' | 'abbruch'
  authorize: [],                   // aufgerufene authorize-Adressen
  codes: new Map(),                // code → { challenge, email }
  tausch: [],                      // Token-Tausch-Aufrufe { ok }
  tokens: new Map(),
  zeilen: new Map(),
  n: 0,
};
const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (uid, bis) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: uid, exp: Math.floor(bis / 1000) }))}.sig`;
const uidVon = (email) => `uid-${email.replace(/[^a-z]/g, '')}`;
const sitzungFuer = (email) => {
  const uid = uidVon(email), bis = Date.now() + 3600_000;
  const t = jwt(uid, bis);
  sb.tokens.set(t, { uid, email });
  return { access_token: t, refresh_token: `rt-${++sb.n}`, expires_in: 3600, token_type: 'bearer', user: { id: uid, email } };
};
const uidAus = (req) => sb.tokens.get(/^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1] ?? '')?.uid ?? null;

async function dienste(ctx) {
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });
  await ctx.route(`${SB_URL}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = req.method(), pfad = url.pathname;
    const body = () => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } };
    // Weiterleitung zu Google (Navigation, ohne apikey): sofort zurück in die App
    if (pfad === '/auth/v1/authorize') {
      sb.authorize.push(url.searchParams);
      const ziel = url.searchParams.get('redirect_to') ?? APP;
      const email = url.searchParams.get('login_hint') || 'gast@gmail.com';
      let zurueck;
      if (sb.rueckweg === 'abbruch') zurueck = `${ziel}${ziel.includes('?') ? '&' : '?'}error=access_denied&error_code=403&error_description=User+denied+access`;
      else if (sb.rueckweg === 'fragment') {
        const s = sitzungFuer(email);
        zurueck = `${ziel}#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&token_type=bearer&type=signup`;
      } else {
        const code = `code-${++sb.n}`;
        sb.codes.set(code, { challenge: url.searchParams.get('code_challenge'), email });
        zurueck = `${ziel}${ziel.includes('?') ? '&' : '?'}code=${code}`;
      }
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Google</title><script>location.replace(${JSON.stringify(zurueck)})</script>` });
    }
    if ((req.headers()['apikey'] ?? '') !== SB_KEY) return json(route, 401, { message: 'No API key found in request' });
    if (pfad === '/auth/v1/settings' && m === 'GET') return json(route, 200, { external: sb.anbieter, disable_signup: false });
    if (pfad === '/auth/v1/token' && m === 'POST' && url.searchParams.get('grant_type') === 'pkce') {
      const { auth_code, code_verifier } = body();
      const c = sb.codes.get(auth_code);
      const passt = !!c && createHash('sha256').update(code_verifier ?? '').digest('base64url') === c.challenge;
      sb.tausch.push({ ok: passt });
      if (!passt) return json(route, 400, { code: 400, error_code: 'bad_code_verifier', msg: 'code challenge does not match previously saved code verifier' });
      sb.codes.delete(auth_code);
      return json(route, 200, sitzungFuer(c.email));
    }
    if (pfad === '/auth/v1/user' && m === 'GET') {
      const e = sb.tokens.get(/^Bearer (.+)$/.exec(req.headers()['authorization'] ?? '')?.[1] ?? '');
      return e ? json(route, 200, { id: e.uid, email: e.email }) : json(route, 401, { message: 'invalid JWT' });
    }
    if (pfad === '/auth/v1/logout' && m === 'POST') return route.fulfill({ status: 204, body: '' });
    if (pfad === '/rest/v1/rpc/konto_schreiben' && m === 'POST') {
      const uid = uidAus(req);
      if (!uid) return json(route, 401, { message: 'JWT expired' });
      const b = body();
      const alt = sb.zeilen.get(`${uid}/umgebung.json`);
      const wenn = b.p_wenn_version;
      if ((wenn === null && alt) || (wenn !== null && String(alt?.version ?? '') !== String(wenn))) return json(route, 400, { code: 'P0001', message: 'vorbedingung' });
      const schreib = (name, inhalt) => {
        const z = sb.zeilen.get(`${uid}/${name}`);
        const neu = { user_id: uid, name, inhalt, mime: 'application/json', groesse: String(inhalt ?? '').length, version: (z?.version ?? 0) + 1, updated_at: new Date().toISOString() };
        sb.zeilen.set(`${uid}/${name}`, neu);
        return neu;
      };
      for (const d of b.p_dateien ?? []) schreib(d.name, d.inhalt ?? '');
      return json(route, 200, schreib('umgebung.json', b.p_umgebung).version);
    }
    if (pfad === '/rest/v1/konto_dateien') {
      const uid = uidAus(req);
      if (!uid) return json(route, 401, { message: 'JWT expired' });
      const fName = /^eq\.(.+)$/.exec(url.searchParams.get('name') ?? '')?.[1];
      let treffer = [...sb.zeilen.values()].filter((z) => z.user_id === uid);
      if (fName !== undefined) treffer = treffer.filter((z) => z.name === fName);
      if (m === 'GET') return json(route, 200, treffer);
      if (m === 'POST') {
        const b = body();
        const z = { user_id: uid, name: b.name, inhalt: b.inhalt, mime: b.mime ?? 'application/json', groesse: b.groesse ?? 0, version: 1, updated_at: new Date().toISOString() };
        sb.zeilen.set(`${uid}/${b.name}`, z);
        return json(route, 201, [z]);
      }
      if (m === 'PATCH') {
        const b = body();
        for (const z of treffer) Object.assign(z, { inhalt: b.inhalt, version: z.version + 1 });
        return json(route, 200, treffer);
      }
      if (m === 'DELETE') return route.fulfill({ status: 204, body: '' });
    }
    if (pfad.startsWith('/rest/v1/board_freigaben') || pfad.startsWith('/rest/v1/rpc/')) return json(route, 200, []);
    if (pfad.startsWith('/storage/v1/')) return json(route, 200, []);
    return json(route, 404, { message: `unbekannt: ${m} ${pfad}` });
  });
  await ctx.routeWebSocket(/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((roh) => {
      const j = JSON.parse(String(roh));
      if (j.event === 'phx_join' || j.event === 'heartbeat') ws.send(JSON.stringify({ topic: j.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: j.ref }));
    });
  });
}

const stand = {
  boards: [{ id: 'bg', name: 'Google-Board', edges: [], drawings: [], comments: [], nodes: [{ id: 'g1', type: 'note', width: 240, position: { x: 60, y: 60 }, data: { color: 'yellow', blocks: [{ type: 'paragraph', content: 'Hallo' }] } }] }],
  spaces: [{ id: 's1', name: 'Arbeit', projects: [{ id: 'p1', name: 'Allgemein', boardIds: ['bg'] }] }],
  activeId: 'bg', view: 'board',
};
async function geraet(name, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await dienste(ctx);
  await ctx.addInitScript(({ st, konfig }) => {
    if (localStorage.getItem('pixinotes-board')) return;
    localStorage.setItem('pixinotes-onboarded', '1');
    localStorage.setItem('pixinotes-einstellungen', JSON.stringify({ schliff: 2 }));
    localStorage.setItem('pixinotes-supabase', JSON.stringify(konfig));
    localStorage.setItem('pixinotes-board', JSON.stringify({ version: 5, state: st }));
  }, { st: stand, konfig: { url: SB_URL, key: SB_KEY } });
  // Alle Hinweise mitschreiben — ein Hinweis kann schon wieder weg sein, wenn die Reihe nachsieht
  await ctx.addInitScript(() => {
    window.__hinweise = [];
    new MutationObserver(() => { const t = document.querySelector('.toast')?.textContent; if (t && window.__hinweise.at(-1) !== t) window.__hinweise.push(t); })
      .observe(document, { childList: true, subtree: true, characterData: true });
  });
  const P = await ctx.newPage();
  const g = { ctx, P, name, dialoge: 0, fehler: [] };
  P.on('pageerror', (e) => { g.fehler.push(e.message); console.log(`    PAGEERROR[${name}]:`, e.message); });
  P.on('dialog', (d) => { g.dialoge += 1; void d.accept(); });
  await P.goto(`${APP}${opt.pfad ?? ''}`, { waitUntil: 'networkidle' });
  await P.waitForTimeout(1200);
  return g;
}
const sitzung = (P) => P.evaluate(() => JSON.parse(localStorage.getItem('pixinotes-konto-sync') ?? 'null'));
const toast = (P) => P.evaluate(() => (window.__hinweise ?? []).join(' | '));
async function warteBis(P, fn, ms = 12000) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await fn()) return true; await P.waitForTimeout(200); }
  return fn();
}
async function kontoPanel(P) {
  await P.locator('[data-taste="einstellungen"]').click();
  await P.waitForSelector('.modal-tabs'); await P.waitForTimeout(300);
  await P.locator('.modal-tabs button', { hasText: 'Daten' }).click(); await P.waitForTimeout(300);
  await P.locator('.seg-weg button', { hasText: 'Konto' }).click(); await P.waitForTimeout(500);
}
const zeilenVon = (email) => [...sb.zeilen.values()].filter((z) => z.user_id === uidVon(email));

// ══ A + B: Anmeldeschirm, Anbieter aus ═════════════════════════════
console.log('\n════ A/B: Anmeldeschirm, Google beim Betreiber aus ════');
sb.anbieter = { email: true, google: false, azure: false };
{
  const A = await geraet('A');
  await kontoPanel(A.P);
  const sicht = await A.P.evaluate(() => {
    const t = (s) => document.querySelector(`[data-taste="${s}"]`);
    const g = t('konto-sb-google'), l = t('konto-link');
    return {
      google: g?.textContent ?? '', link: !!l, gleicheZeile: !!g && !!l && g.closest('.konto-mail') === l.closest('.konto-mail'),
      ms: !!t('konto-sb-ms'), drive: t('konto-google')?.textContent ?? '', onedrive: t('konto-ms')?.textContent ?? '',
    };
  });
  pruefe('A1 „Mit Google anmelden" steht im Konto-Block neben dem E-Mail-Link', sicht.google === 'Mit Google anmelden' && sicht.link && sicht.gleicheZeile, sicht);
  pruefe('A2 die Drive-Knöpfe heißen nach ihrem Ziel (kein zweites „Mit Google anmelden")', sicht.drive === 'Stand in Google Drive' && sicht.onedrive === 'Stand in OneDrive', sicht);
  pruefe('A3 Microsoft-Knopf fehlt, solange das Projekt Microsoft nicht eingeschaltet hat', !sicht.ms, sicht);
  await A.P.locator('[data-taste="konto-email"]').fill('anna@gmail.com');
  const vorher = sb.authorize.length;
  await A.P.locator('[data-taste="konto-sb-google"]').click();
  await A.P.waitForTimeout(800);
  const aus = await A.P.evaluate(() => ({
    satz: document.querySelector('[data-taste="konto-google-aus"]')?.textContent ?? '',
    betreiberZu: !document.querySelector('[data-taste="konto-google-betreiber"]')?.hasAttribute('open'),
    betreiber: document.querySelector('[data-taste="konto-google-betreiber"]')?.textContent ?? '',
    fehler: document.querySelector('.modal-error')?.textContent ?? '',
    adresse: location.href,
  }));
  pruefe('B1 Anbieter aus → klarer Satz statt technischem Fehler', aus.satz === 'Google-Anmeldung ist beim Betreiber noch nicht eingeschaltet – bis dahin mit E-Mail-Link anmelden.' && !aus.fehler, aus);
  pruefe('B2 keine Weiterleitung zu Google', sb.authorize.length === vorher && aus.adresse === APP, aus.adresse);
  pruefe('B3 „Für Betreiber" eingeklappt, nennt Callback-URI und Redirect', aus.betreiberZu && aus.betreiber.includes(`${SB_URL}/auth/v1/callback`) && aus.betreiber.includes(APP), aus.betreiber);
  await A.ctx.close();
}

// ══ C: PKCE-Rückkehr ═══════════════════════════════════════════════
console.log('\n════ C: Mit Google anmelden (PKCE, ?code=) ════');
sb.anbieter = { email: true, google: true, azure: false };
sb.rueckweg = 'code';
{
  const C = await geraet('C');
  await kontoPanel(C.P);
  await C.P.locator('[data-taste="konto-email"]').fill('ben.berg@gmail.com');
  await C.P.locator('[data-taste="konto-sb-google"]').click();
  await warteBis(C.P, async () => !!(await sitzung(C.P)), 15000);
  const q = sb.authorize[sb.authorize.length - 1];
  const auf = q ? Object.fromEntries(q.entries()) : {};
  pruefe('C1 Weiterleitung an authorize mit provider=google, redirect_to = App, login_hint = E-Mail', auf.provider === 'google' && auf.redirect_to === APP && auf.login_hint === 'ben.berg@gmail.com', auf);
  pruefe('C2 PKCE: code_challenge (S256) mitgeschickt, Tausch mit passendem Verifier', !!auf.code_challenge && auf.code_challenge_method === 's256' && sb.tausch.length === 1 && sb.tausch[0].ok, { auf, tausch: sb.tausch });
  const s = await sitzung(C.P);
  pruefe('C3 angemeldet am PixiNotes-Konto mit der Google-Adresse', s?.anbieter === 'supabase' && s.name === 'ben.berg@gmail.com' && s.userId === uidVon('ben.berg@gmail.com'), s);
  const adresse = await C.P.evaluate(() => location.href);
  pruefe('C4 Adresse aufgeräumt (kein ?code=)', adresse === APP, adresse);
  const gesynct = await warteBis(C.P, async () => zeilenVon('ben.berg@gmail.com').some((z) => z.name === 'umgebung.json') && zeilenVon('ben.berg@gmail.com').some((z) => /Google-Board/.test(z.inhalt ?? '')), 15000);
  pruefe('C5 Sync startet: Umgebung und Board liegen im Konto', gesynct, zeilenVon('ben.berg@gmail.com').map((z) => z.name));
  pruefe('C6 keine Rückfrage, Meldung „Angemeldet als …"', C.dialoge === 0 && /Angemeldet als „ben\.berg@gmail\.com"/.test(await toast(C.P)), { dialoge: C.dialoge, toast: await toast(C.P) });
  await kontoPanel(C.P);
  const stand = await C.P.locator('[data-taste="konto-stand"]').textContent().catch(() => '');
  pruefe('C7 Einstellungen zeigen „Angemeldet bei PixiNotes-Konto als ben.berg@gmail.com"', /PixiNotes-Konto als „ben\.berg@gmail\.com"/.test(stand ?? ''), stand);

  // ══ H: Abmelden ══
  console.log('\n════ H: Abmelden ════');
  await C.P.locator('button', { hasText: 'Abmelden' }).first().click(); await C.P.waitForTimeout(600);
  const pk = await C.P.evaluate(() => localStorage.getItem('pixinotes-sb-pkce'));
  pruefe('H1 Abmelden: Sitzung weg, kein PKCE-Rest, Knopf wieder da', !(await sitzung(C.P)) && !pk && (await C.P.locator('[data-taste="konto-sb-google"]').count()) === 1);
  pruefe('C8 keine Seitenfehler', C.fehler.length === 0, C.fehler);
  await C.ctx.close();
}

// ══ D: Impliziter Ablauf ═══════════════════════════════════════════
console.log('\n════ D: Rückkehr im Fragment (#access_token=) ════');
sb.rueckweg = 'fragment';
{
  const D = await geraet('D');
  await kontoPanel(D.P);
  await D.P.locator('[data-taste="konto-email"]').fill('cora@gmail.com');
  await D.P.locator('[data-taste="konto-sb-google"]').click();
  const da = await warteBis(D.P, async () => !!(await sitzung(D.P)), 15000);
  const s = await sitzung(D.P);
  pruefe('D1 Fragment-Rückkehr meldet ohne Rückfrage an', da && s?.anbieter === 'supabase' && s.name === 'cora@gmail.com' && D.dialoge === 0, { s, dialoge: D.dialoge });
  pruefe('D2 Adresse aufgeräumt, kein PKCE-Rest', (await D.P.evaluate(() => location.href)) === APP && !(await D.P.evaluate(() => localStorage.getItem('pixinotes-sb-pkce'))));
  await D.ctx.close();
}

// ══ E: Abbruch bei Google ══════════════════════════════════════════
console.log('\n════ E: Abbruch bei Google ════');
sb.rueckweg = 'abbruch';
{
  const E = await geraet('E');
  await kontoPanel(E.P);
  await E.P.locator('[data-taste="konto-sb-google"]').click();
  const kam = await warteBis(E.P, async () => /Anmeldung abgebrochen/.test(await toast(E.P)), 12000);
  pruefe('E1 Abbruch → „Anmeldung abgebrochen", nicht angemeldet, Adresse aufgeräumt', kam && !(await sitzung(E.P)) && (await E.P.evaluate(() => location.href)) === APP, await toast(E.P));
  await E.ctx.close();
}

// ══ F: fremdes ?code= ══════════════════════════════════════════════
console.log('\n════ F: fremdes ?code= ════');
{
  const vorher = sb.tausch.length;
  const F = await geraet('F', { pfad: '?code=fremd-1' });
  await F.P.waitForTimeout(1500);
  pruefe('F1 ein ?code= ohne eigene Anmeldung löst keinen Tausch aus', sb.tausch.length === vorher && !(await sitzung(F.P)));
  await F.ctx.close();
}

// ══ G: Microsoft ═══════════════════════════════════════════════════
console.log('\n════ G: Microsoft eingeschaltet ════');
sb.anbieter = { email: true, google: true, azure: true };
sb.rueckweg = 'code';
{
  const G = await geraet('G');
  await kontoPanel(G.P);
  const ms = G.P.locator('[data-taste="konto-sb-ms"]');
  await warteBis(G.P, async () => (await ms.count()) === 1, 5000);
  pruefe('G1 Microsoft-Knopf erscheint, wenn das Projekt es eingeschaltet hat', (await ms.count()) === 1 && (await ms.textContent()) === 'Mit Microsoft anmelden');
  await G.P.locator('[data-taste="konto-email"]').fill('dora@outlook.com');
  await ms.click();
  await warteBis(G.P, async () => !!(await sitzung(G.P)), 15000);
  const auf = Object.fromEntries(sb.authorize[sb.authorize.length - 1].entries());
  pruefe('G2 provider=azure mit scopes=email und login_hint, danach angemeldet', auf.provider === 'azure' && auf.scopes === 'email' && auf.login_hint === 'dora@outlook.com' && (await sitzung(G.P))?.name === 'dora@outlook.com', auf);
  await G.ctx.close();
}

console.log(`\n${ok} ok, ${bad} fehlgeschlagen`);
await browser.close();
app.close();
process.exit(bad ? 1 : 0);
