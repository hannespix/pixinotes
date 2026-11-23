// M458: „An PixiNotes senden" – der Hintergrund der Browser-Erweiterung (Chrome/Edge, Manifest V3; Firefox
// liest dieselbe Datei über background.scripts).
//
// PixiNotes ist local-first und hat keinen Server, an den man etwas schicken könnte. Die Erweiterung bringt
// das Gesendete deshalb in den PixiNotes-Tab dieses Browsers: Sie öffnet bzw. fokussiert ihn und spritzt ein
// kleines Skript hinein, das wartet, bis die App ihren Eingang „bereit" meldet (src/lib/erweiterung.ts), und die
// Sendung dann per window.postMessage an das eigene Fenster gibt. Fehlt die Berechtigung für eine selbst
// eingestellte Adresse, geht Text über das Adress-Fragment (#pixinotes-senden=…) – Bilder nicht.
//
// Kein Tracking, kein fremder Server: Netzzugriffe gibt es nur, um ein Bild zu laden, das man selbst gewählt hat.

const VORGABE = { adresse: 'https://hannespix.github.io/pixinotes/', direkt: false };
const t = (schluessel) => chrome.i18n.getMessage(schluessel) || schluessel;
const BILD_HOECHSTENS = 20 * 1024 * 1024;

async function einstellungen() {
  const e = await chrome.storage.local.get(VORGABE);
  return { adresse: String(e.adresse || VORGABE.adresse), direkt: e.direkt === true };
}

// ── Menüs ───────────────────────────────────────────────────────────────
function menuesAnlegen() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'auswahl', title: t('menueAuswahl'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'link', title: t('menueLink'), contexts: ['link'] });
    chrome.contextMenus.create({ id: 'bild', title: t('menueBild'), contexts: ['image'] });
    chrome.contextMenus.create({ id: 'seite', title: t('menueSeite'), contexts: ['page', 'frame'] });
    // Auch am Werkzeugleisten-Knopf (Rechtsklick) – der Knopf selbst sendet die Seite
    chrome.contextMenus.create({ id: 'bildschirm', title: t('menueBildschirm'), contexts: ['page', 'frame', 'action'] });
  });
}
chrome.runtime.onInstalled.addListener(menuesAnlegen);
chrome.runtime.onStartup.addListener(menuesAnlegen);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const auftrag = {
    auswahl: () => senden.auswahl(tab, info.selectionText),
    link: () => senden.link(tab, info.linkUrl, info.selectionText),
    bild: () => senden.bild(tab, info.srcUrl),
    seite: () => senden.seite(tab),
    bildschirm: () => senden.bildschirm(tab),
  }[info.menuItemId];
  if (auftrag) auftrag().catch((e) => fehler(tab.id, String(e?.message || e)));
});

chrome.action.onClicked.addListener((tab) => {
  senden.seite(tab).catch((e) => fehler(tab.id, String(e?.message || e)));
});

// ── Was gesendet wird ───────────────────────────────────────────────────
/** Läuft in der Ausgangsseite: Auswahl und ein kurzer Auszug (Beschreibung oder erster längerer Absatz) */
function seitenAuszug() {
  const auswahl = String(getSelection() || '').trim().slice(0, 20000);
  const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
  let auszug = (meta?.getAttribute('content') || '').trim();
  if (!auszug) {
    const absatz = [...document.querySelectorAll('main p, article p, p')]
      .map((p) => (p.innerText || '').trim()).find((x) => x.length > 60);
    auszug = absatz || '';
  }
  return { auswahl, auszug: auszug.replace(/\s+/g, ' ').slice(0, 600) };
}

/** Läuft in der Ausgangsseite: ein Bild mit den Rechten der Seite holen (gleiche Herkunft, Anmeldung) */
async function bildHolen(adresse, hoechstens) {
  try {
    const antwort = await fetch(adresse);
    if (!antwort.ok) return null;
    const blob = await antwort.blob();
    if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type) || blob.size > hoechstens) return null;
    return await new Promise((ok) => {
      const leser = new FileReader();
      leser.onload = () => ok(String(leser.result));
      leser.onerror = () => ok(null);
      leser.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function inSeite(tab, func, args = []) {
  try {
    const [erg] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
    return erg?.result ?? null;
  } catch { return null; }   // Browser-Seiten, Store, PDF-Betrachter: dort darf niemand hinein
}

const senden = {
  async auswahl(tab, text) {
    // Das Kontextmenü kürzt lange Auswahlen nicht, verliert aber Zeilenumbrüche – die Seite selbst kennt sie
    const aus = await inSeite(tab, seitenAuszug);
    await zuPixiNotes({ v: 1, art: 'auswahl', titel: tab.title || '', text: aus?.auswahl || text || '', adresse: tab.url || '' });
  },
  async link(tab, adresse, text) {
    await zuPixiNotes({ v: 1, art: 'link', titel: text || adresse || '', text: '', adresse: adresse || '' });
  },
  async seite(tab) {
    const aus = await inSeite(tab, seitenAuszug);
    // Ist auf der Seite etwas markiert, kommt es mit (der Knopf in der Werkzeugleiste kennt kein Kontextmenü)
    await zuPixiNotes({ v: 1, art: aus?.auswahl ? 'auswahl' : 'seite', titel: tab.title || '', text: aus?.auswahl || aus?.auszug || '', adresse: tab.url || '' });
  },
  async bild(tab, adresse) {
    let daten = /^data:image\//.test(adresse || '') ? adresse : null;
    if (!daten && adresse) daten = await inSeite(tab, bildHolen, [adresse, BILD_HOECHSTENS]);
    if (!daten && adresse) daten = await bildHolen(adresse, BILD_HOECHSTENS);   // Server, der fremde Abrufe erlaubt
    if (!daten) {
      await zuPixiNotes({ v: 1, art: 'link', titel: tab.title || '', text: t('bildNichtLadbar'), adresse: adresse || '' });
      return;
    }
    await zuPixiNotes({ v: 1, art: 'bild', titel: tab.title || '', text: '', adresse: tab.url || '', bild: { daten, name: tab.title || 'Bild' } });
  },
  async bildschirm(tab) {
    const daten = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await zuPixiNotes({ v: 1, art: 'bildschirm', titel: tab.title || '', text: '', adresse: tab.url || '', bild: { daten, name: tab.title || 'Bildschirm' } });
  },
};

// ── Übergabe an den PixiNotes-Tab ───────────────────────────────────────
/** Läuft im PixiNotes-Tab (eigene Welt der Erweiterung): warten, bis die App bereit ist, dann senden */
async function uebergeben(sendung) {
  const bereit = () => document.documentElement.dataset.pixinotesEingang === 'bereit';
  for (let i = 0; i < 150 && !bereit(); i += 1) await new Promise((w) => setTimeout(w, 200));
  if (!bereit()) return false;
  const id = crypto.randomUUID();
  return new Promise((ok) => {
    const quittung = (e) => {
      if (e.source !== window || e.data?.typ !== 'pixinotes-erweiterung-ok' || e.data.id !== id) return;
      removeEventListener('message', quittung);
      ok(e.data.angenommen === true);
    };
    addEventListener('message', quittung);
    window.postMessage({ typ: 'pixinotes-erweiterung', id, sendung }, location.origin);
    setTimeout(() => { removeEventListener('message', quittung); ok(false); }, 10000);
  });
}

const basisVon = (adresse) => { const u = new URL(adresse); u.hash = ''; u.search = ''; return u.href; };

function geladen(tabId) {
  return new Promise((ok) => {
    const fertig = () => { chrome.tabs.onUpdated.removeListener(hoer); clearTimeout(uhr); ok(); };
    const hoer = (id, info) => { if (id === tabId && info.status === 'complete') fertig(); };
    const uhr = setTimeout(fertig, 30000);
    chrome.tabs.onUpdated.addListener(hoer);
    chrome.tabs.get(tabId).then((tb) => { if (tb.status === 'complete') fertig(); }).catch(fertig);
  });
}

/** Text → base64url (UTF-8), für das Adress-Fragment */
function base64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function zuPixiNotes(sendung) {
  const { adresse, direkt } = await einstellungen();
  const basis = basisVon(adresse);
  const herkunft = new URL(basis).origin;
  const darf = await chrome.permissions.contains({ origins: [`${herkunft}/*`] });

  if (!darf) {
    // Ohne Berechtigung kann die Erweiterung den Tab weder finden noch etwas hineinreichen: neuer Tab mit dem
    // Inhalt im Adress-Fragment (bleibt im Browser, geht nie an einen Server). Bilder passen dort nicht hinein.
    const { bild, ...rest } = sendung;
    if (bild) { await fehler(undefined, t('fehlerKeineBerechtigung')); return false; }
    await chrome.tabs.create({ url: `${basis}#pixinotes-senden=${base64Url(JSON.stringify({ ...rest, text: rest.text.slice(0, 6000) }))}` });
    return true;
  }

  // Den PixiNotes-Tab suchen: Adressen sieht die Erweiterung nur für Seiten, für die sie die Berechtigung hat
  const tabs = await chrome.tabs.query({});
  let ziel = tabs.find((tb) => tb.url && tb.url.startsWith(basis));
  if (ziel) {
    await chrome.tabs.update(ziel.id, { active: true });
    await chrome.windows.update(ziel.windowId, { focused: true }).catch(() => {});
    await geladen(ziel.id);
  } else {
    ziel = await chrome.tabs.create({ url: basis });
    await geladen(ziel.id);
  }
  const [erg] = await chrome.scripting.executeScript({ target: { tabId: ziel.id }, func: uebergeben, args: [{ ...sendung, direkt }] });
  if (erg?.result !== true) { await fehler(ziel.id, t('fehlerNichtAngekommen')); return false; }
  return true;
}

/** Kurz am Knopf zeigen, dass etwas nicht ging (die Erweiterung hat keine eigene Oberfläche dafür) */
async function fehler(tabId, text) {
  console.warn('[PixiNotes]', text);
  const wo = tabId ? { tabId } : {};
  await chrome.action.setBadgeBackgroundColor({ color: '#b3261e', ...wo }).catch(() => {});
  await chrome.action.setBadgeText({ text: '!', ...wo }).catch(() => {});
  await chrome.action.setTitle({ title: text, ...wo }).catch(() => {});
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', ...wo }).catch(() => {});
    chrome.action.setTitle({ title: t('knopf'), ...wo }).catch(() => {});
  }, 8000);
}

// Für die Prüfreihe (pruefungen/m458-erweiterung.mjs): Kontextmenü-Klicks lassen sich im Prüflauf nicht auslösen
globalThis.pixinotesSenden = senden;
