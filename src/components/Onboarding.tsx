import { useEffect, useState } from 'react';
import { useBoard } from '../store';
import { isFirstRun } from '../lib/firstRun';

/**
 * M217: Kurze Begrüßung beim allerersten Start.
 *
 * PixiNotes öffnet sonst eine leere Fläche ohne jeden Hinweis — wer das Tool
 * zum ersten Mal sieht, weiß weder, dass ein Doppelklick eine Notiz anlegt,
 * noch wo die Daten landen. Gerade Letzteres ist bei einem Werkzeug für
 * dienstliche Notizen die erste Frage.
 *
 * Bewusst knapp: drei Sätze, drei Gesten, zwei Knöpfe. Wer sofort loslegen
 * will, ist mit einem Tipp durch. Der Merker liegt in einem EIGENEN
 * localStorage-Schlüssel — nicht im Board-Zustand, damit ein Sync oder
 * Import ihn nicht wieder auslöst.
 */
const SEEN_KEY = 'pixinotes-onboarded';

export function Onboarding() {
  const [open, setOpen] = useState(false);
  const addStarter = useBoard((s) => s.addStarter);
  const setHelpOpen = useBoard((s) => s.setHelpOpen);

  useEffect(() => {
    try {
      // „Hat schon Karten?" taugt NICHT als Maßstab — ein frischer Start legt
      // bereits ein Beispiel-Board an. Maßgeblich ist, ob VOR dem Start etwas
      // gespeichert war (siehe lib/firstRun).
      if (!isFirstRun || localStorage.getItem(SEEN_KEY)) return;
      setOpen(true);
    } catch { /* privates Fenster ohne Speicher */ }
  }, []);

  const close = () => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* egal */ }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="onb-backdrop" onClick={close}>
      <div className="onb" role="dialog" aria-modal="true" aria-label="Willkommen bei PixiNotes" onClick={(e) => e.stopPropagation()}>
        <h2>Willkommen bei Pixi<span>Notes</span></h2>
        <p className="onb-lead">
          Eine unendliche Fläche für Notizen, Aufgaben und Pläne. <b>Alles bleibt in
          diesem Browser</b> — kein Konto, kein Server, keine Anmeldung.
        </p>
        <ul className="onb-steps">
          <li><b>Doppelklick</b> auf die Fläche legt eine Notiz an — <b>＋</b> unten alle anderen Module.</li>
          <li><b>Zwei Finger</b> (oder Mausrad) schieben und zoomen die Fläche.</li>
          <li><b>Strg+K</b> durchsucht alles und führt Befehle aus.</li>
        </ul>
        <div className="onb-acts">
          <button className="onb-primary" onClick={close}>Loslegen</button>
          <button onClick={() => { close(); addStarter(); }}>
            Beispiele ansehen
          </button>
          <button onClick={() => { close(); setHelpOpen(true, 'start'); }}>
            Zur Anleitung
          </button>
        </div>
        <p className="onb-foot">
          Die Einführung erscheint nur einmal. Alles Weitere steht jederzeit in der
          Hilfe — erreichbar über das Logo oben links.
        </p>
      </div>
    </div>
  );
}
