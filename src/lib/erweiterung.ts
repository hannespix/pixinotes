/**
 * M458: Der EINE Eingang für die Browser-Erweiterung „An PixiNotes senden" (Ordner `erweiterung/`).
 *
 * PixiNotes hat keinen Server — die Erweiterung kann also nichts „hochladen". Sie reicht das Gesendete direkt an
 * den geöffneten PixiNotes-Tab weiter, auf zwei Wegen, die hier zusammenlaufen:
 *  - postMessage: Die Erweiterung spritzt ein kleines Skript in den PixiNotes-Tab (Berechtigung nur für die
 *    PixiNotes-Adresse), das wartet, bis dieser Eingang „bereit" meldet, und dann eine Nachricht an das EIGENE
 *    Fenster schickt. Nur so kommen auch Bilder und Bildschirmfotos an (zu groß für eine Adresse).
 *  - Adress-Fragment `#pixinotes-senden=…`: Rückfallweg, wenn die Erweiterung für eine selbst eingestellte Adresse
 *    keine Berechtigung hat — nur Text und Links.
 *
 * Beide Wege enden in `sendungPruefen` (Säubern über lib/sicher.ts) und dann im Empfangs-Dialog des Android-
 * Teilens (M290, GeteiltDialog) — dieselbe Zielwahl, dieselben Karten. Was nicht passt, wird verworfen:
 * Nachrichten aus eingebetteten Rahmen (HTML-App-Karten) oder von fremder Herkunft, Adressen außer http(s),
 * Bilder außer eingebetteten Rasterbildern.
 */
import { rasterBildVonAussen, textVonAussen, webAdresseVonAussen } from './sicher';
import { dataUrlZuBlob } from './download';
import type { Geteiltes } from './geteilt';

export const NACHRICHT = 'pixinotes-erweiterung';
export const QUITTUNG = 'pixinotes-erweiterung-ok';
const FRAGMENT = 'pixinotes-senden=';
const ARTEN = new Set(['auswahl', 'seite', 'link', 'bild', 'bildschirm']);

export interface Sendung {
  /** Inhalt, wie ihn der Empfangs-Dialog kennt */
  gabe: Geteiltes;
  /** Ohne Rückfrage auf das geöffnete Board (Einstellung der Erweiterung; nur über postMessage, nie per Link) */
  direkt: boolean;
}

/** Dateiname aus dem Seitentitel — ohne Zeichen, die in Dateinamen stören */
const dateiName = (roh: string, endung: string): string =>
  `${(roh.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Bild')}.${endung}`;

/**
 * Was die Erweiterung schickt, geprüft und gesäubert — oder null, wenn es keine Sendung ist.
 * `mitBild` ist nur beim postMessage-Weg erlaubt; über das Adress-Fragment kommen keine Bilder.
 */
export function sendungPruefen(roh: unknown, mitBild: boolean): Sendung | null {
  const s = roh as Record<string, unknown> | null;
  if (!s || typeof s !== 'object' || Array.isArray(s) || s.v !== 1 || !ARTEN.has(String(s.art))) return null;
  const titel = textVonAussen(s.titel, 300);
  const text = textVonAussen(s.text, 20_000);
  const adresse = webAdresseVonAussen(s.adresse) ?? '';
  const dateien: Geteiltes['dateien'] = [];
  if (mitBild && s.bild && typeof s.bild === 'object') {
    const b = s.bild as Record<string, unknown>;
    const daten = rasterBildVonAussen(b.daten);
    const blob = daten ? dataUrlZuBlob(daten) : null;
    if (blob && blob.size > 0) {
      const endung = (blob.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
      dateien.push({ name: dateiName(textVonAussen(b.name, 120) || titel, endung), typ: blob.type, blob });
    }
  }
  // Bild-Sendungen tragen den Seitentitel nur als Dateinamen — sonst entstünde neben dem Bild eine zweite Karte
  const nurBild = s.art === 'bild' || s.art === 'bildschirm';
  const gabe: Geteiltes = {
    titel: nurBild && dateien.length ? '' : titel,
    text: nurBild && dateien.length ? '' : text,
    adresse: nurBild && dateien.length ? '' : adresse,
    dateien,
    wann: new Date().toISOString(),
    herkunft: 'erweiterung',
  };
  if (!gabe.titel && !gabe.text && !gabe.adresse && !gabe.dateien.length) return null;
  return { gabe, direkt: mitBild && s.direkt === true };
}

/** base64url → Text (UTF-8) */
function ausBase64Url(roh: string): string {
  const b64 = roh.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (z) => z.charCodeAt(0)));
}

/**
 * Liegt eine Sendung im Adress-Fragment? Sie wird sofort aus der Adresse genommen — ein Neuladen oder ein
 * Lesezeichen soll sie nicht ein zweites Mal bringen.
 */
export function fragmentAbholen(): Sendung | null {
  const h = location.hash;
  const i = h.indexOf(FRAGMENT);
  if (i < 0) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    return sendungPruefen(JSON.parse(ausBase64Url(h.slice(i + FRAGMENT.length))), false);
  } catch {
    return null;
  }
}

/**
 * Eingang öffnen: hört auf Nachrichten der Erweiterung und auf das Adress-Fragment. Meldet sich am Dokument als
 * „bereit" — darauf wartet das Skript der Erweiterung, bevor es sendet (der Tab kann gerade erst laden).
 * Gibt eine Funktion zum Schließen zurück.
 */
export function erweiterungEingang(annehmen: (s: Sendung) => void): () => void {
  const nachricht = (e: MessageEvent) => {
    // Nur das eigene Fenster (dort spricht das Skript der Erweiterung) — nicht eingebettete Rahmen, nicht fremde Herkunft
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data as { typ?: unknown; id?: unknown; sendung?: unknown } | null;
    if (!d || typeof d !== 'object' || d.typ !== NACHRICHT) return;
    const s = sendungPruefen(d.sendung, true);
    window.postMessage({ typ: QUITTUNG, id: typeof d.id === 'string' ? d.id.slice(0, 80) : '', angenommen: !!s }, location.origin);
    if (s) annehmen(s);
  };
  const fragment = () => { const s = fragmentAbholen(); if (s) annehmen(s); };
  window.addEventListener('message', nachricht);
  window.addEventListener('hashchange', fragment);
  document.documentElement.dataset.pixinotesEingang = 'bereit';
  fragment();
  return () => {
    window.removeEventListener('message', nachricht);
    window.removeEventListener('hashchange', fragment);
    delete document.documentElement.dataset.pixinotesEingang;
  };
}
