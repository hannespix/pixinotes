/**
 * M482: Die Rechtschreibprüfung des Browsers in Karten und Modulen.
 *
 * Gemeldet: „Was auch noch fehlt ist die Standard-Browser-Rechtschreibkorrektur in den Cards und Modulen!"
 *
 * Die App hat die Prüfung nirgends abgeschaltet — sie hat sie aber auch nirgends verlangt. Ob ein Feld geprüft
 * wird, entschied damit der Browser nach seiner Voreinstellung: Firefox prüft einzeilige Felder (Ticket,
 * Gantt-Vorgang, Titel, Tabellenzelle, Kontakt) von sich aus gar nicht, Safari und Chromium je nach Feldart
 * und Einstellung des Geräts. Deshalb steht die Prüfung jetzt ausdrücklich an jedem Feld für freien Text:
 * die Wurzel `<html spellcheck>` gibt die Grundhaltung vor (alles erbt sie), und beim Fokus bekommt das Feld
 * seinen eigenen Wert — so gilt er auch dort, wo ein Element sonst nicht erbt.
 *
 * Bewusst AUS bleibt sie, wo Wellenlinien nur stören: Formel- und Zahlenzellen („=SUMME(…)", „1.200"),
 * Quelltext (Mermaid), Suchfelder, Adressen (URL, E-Mail, Telefon), Datum/Zeit, Zahlen, Passwörter. Wer sie
 * gar nicht will, schaltet sie unter Einstellungen → Darstellung → „Rechtschreibung prüfen" ab (je Gerät).
 *
 * Ruhende Karten (M421, NotizRuhend) sind nicht bearbeitbar — dort zeichnet kein Browser Wellenlinien; die
 * Prüfung wirkt erst beim Bearbeiten.
 *
 * Markierung im Markup: `data-rechtschreibung="aus"` (Feld oder ein Vorfahre) schaltet ab,
 * `data-rechtschreibung="formel"` prüft nur, solange der Inhalt keine Formel und keine Zahl ist.
 */

const OPTION = 'pixinotes-rechtschreibung';

/** Rechtschreibung prüfen? Je Gerät, Vorgabe: an */
export function rechtschreibungAn(): boolean {
  try { return localStorage.getItem(OPTION) !== '0'; } catch { return true; }
}

export function setRechtschreibung(an: boolean): void {
  try { localStorage.setItem(OPTION, an ? '1' : '0'); } catch { /* privates Fenster: dann eben nur für jetzt */ }
  wurzelSetzen(an);
  const a = document.activeElement;
  if (a instanceof HTMLElement && istTextfeld(a)) anwenden(a);
}

/** Feldarten, in denen Wellenlinien nichts zu suchen haben */
const AUS_TYPEN = new Set(['url', 'email', 'tel', 'search', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week', 'color', 'range']);
const AUS_MODI = new Set(['url', 'email', 'tel', 'numeric', 'decimal', 'search']);
/** Suchfelder ohne type="search" erkennt man an ihrer Beschriftung („Suchen …", „Hilfe durchsuchen …") */
const SUCHE = /(^|[^a-zäöüß])(such|durchsuch|search)/i;
/** Adressen und Zugangsschlüssel als schlichtes Textfeld („https://…", „eyJ… (öffentlicher Schlüssel)", „sk-…") */
const ADRESSE = /:\/\/|^\s*(eyJ|sk-)|schlüssel|api-?key|\btoken/i;
/** Formel oder Zahl (auch „1.200,50 €", „-3 %") */
const FORMEL_ODER_ZAHL = /^\s*(=|[-+]?[\d.,'\s]+\s*(%|€|\$)?\s*$)/;
const TEXT_TYPEN = new Set(['text', '', 'search', 'url', 'email', 'tel', 'password', 'number']);

/** Ein Feld, in das man Text tippt? (Eingabe, Textbereich, Wurzel eines bearbeitbaren Bereichs) */
export function istTextfeld(el: Element): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_TYPEN.has(el.type) || AUS_TYPEN.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Soll dieses Feld geprüft werden? */
export function pruefungGewuenscht(el: HTMLElement): boolean {
  if (!rechtschreibungAn()) return false;
  if (el.closest('[data-rechtschreibung="aus"]')) return false;
  if (el instanceof HTMLInputElement) {
    if (AUS_TYPEN.has(el.type)) return false;
    if (AUS_MODI.has(el.inputMode)) return false;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const beschriftung = `${el.placeholder ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
    if (SUCHE.test(beschriftung) || ADRESSE.test(beschriftung) || el.getAttribute('role') === 'searchbox') return false;
    if (el.closest('[data-rechtschreibung="formel"]') && FORMEL_ODER_ZAHL.test(el.value)) return false;
  }
  return true;
}

/** Wert setzen — beim Abschalten auch die Autokorrektur der Telefone (in Adressen und Formeln stört sie nur) */
function anwenden(el: HTMLElement): void {
  const soll = pruefungGewuenscht(el);
  // ausdrücklich als Attribut, nicht nur geerbt: manche Felder erben die Haltung der Wurzel nicht
  if (el.getAttribute('spellcheck') !== String(soll)) el.setAttribute('spellcheck', String(soll));
  const ausnahme = !soll && rechtschreibungAn();
  if (ausnahme && el.dataset.rsAus !== '1') {
    el.dataset.rsAus = '1';
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
  } else if (!ausnahme && el.dataset.rsAus === '1') {
    // nur zurücknehmen, was hier gesetzt wurde (eine Zelle wird von der Formel wieder zu Text)
    delete el.dataset.rsAus;
    el.removeAttribute('autocorrect');
    el.removeAttribute('autocapitalize');
  }
}

function wurzelSetzen(an: boolean): void {
  document.documentElement.spellcheck = an;
}

let bereit = false;

export function initRechtschreibung(): void {
  if (bereit || typeof document === 'undefined') return;
  bereit = true;
  wurzelSetzen(rechtschreibungAn());
  const beimFokus = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLElement && istTextfeld(t)) anwenden(t);
  };
  // Fokus: das Feld bekommt seinen Wert, bevor getippt wird
  document.addEventListener('focusin', beimFokus, true);
  // Tabellenzelle: wird aus Text eine Formel (oder umgekehrt), folgt die Prüfung beim Tippen
  document.addEventListener('input', (e) => {
    const t = e.target;
    if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && t.closest('[data-rechtschreibung="formel"]')) anwenden(t);
  }, true);
  // Ein anderes Fenster hat die Vorliebe geändert
  window.addEventListener('storage', (e) => { if (e.key === OPTION) wurzelSetzen(rechtschreibungAn()); });
}
