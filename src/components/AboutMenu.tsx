import { useBoard } from '../store';

/**
 * M312: Das Logo öffnet die Hilfe.
 *
 * Bis M311 hing hier ein Menü mit A−/A+, „Sehen & Bedienen", „Was ist neu",
 * Hilfe, Impressum und Datenschutz — jeder Eintrag ein zweiter Weg zu etwas,
 * das schon einen Ort hatte (Anzeigegröße: ⚙ → Darstellung; Impressum und
 * Datenschutz: die Ecke unten rechts und die Hilfe; „Was ist neu": der Fuß der
 * Hilfe). Jetzt ist das Logo der eine Zugang zur Hilfe, und die Fassung steht
 * dort im Fuß.
 */
export function AboutMenu() {
  const setHelpOpen = useBoard((s) => s.setHelpOpen);
  return (
    <div className="logo-wrap">
      <button
        className="logo"
        onClick={() => setHelpOpen(true)}
        data-taste="hilfe"
        title="Hilfe · Was ist neu · Impressum"
        aria-label="Hilfe"
      >
        Pixi<span>Notes</span>
      </button>
    </div>
  );
}
