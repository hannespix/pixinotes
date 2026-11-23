// M458: Optionen der Erweiterung – Adresse von PixiNotes und „ohne Rückfrage".
const VORGABE = { adresse: 'https://hannespix.github.io/pixinotes/', direkt: false };
const t = (k) => chrome.i18n.getMessage(k) || '';
const $ = (id) => document.getElementById(id);

document.documentElement.lang = chrome.i18n.getUILanguage().startsWith('de') ? 'de' : 'en';
for (const el of document.querySelectorAll('[data-text]')) {
  const text = t(el.dataset.text);
  if (text) el.textContent = text;
}

chrome.storage.local.get(VORGABE).then((e) => {
  $('adresse').value = e.adresse || VORGABE.adresse;
  $('direkt').checked = e.direkt === true;
});

$('speichern').addEventListener('click', async () => {
  const status = $('status');
  let u;
  try { u = new URL($('adresse').value.trim()); } catch { u = null; }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) { status.textContent = t('optUngueltig'); return; }
  u.hash = ''; u.search = '';
  if (!u.pathname.endsWith('/') && !/\.html?$/.test(u.pathname)) u.pathname += '/';
  // Eigene Adresse: einmal zustimmen (nur für genau diese Herkunft, nicht „alle Seiten")
  const origins = [`${u.origin}/*`];
  let darf = await chrome.permissions.contains({ origins });
  if (!darf) darf = await chrome.permissions.request({ origins }).catch(() => false);
  await chrome.storage.local.set({ adresse: u.href, direkt: $('direkt').checked });
  $('adresse').value = u.href;
  status.textContent = darf ? t('optGespeichert') : t('optAbgelehnt');
});
