import { useState } from 'react';
import { useBoard } from '../store';
import type { AppNode } from '../types';
import { bildFingerabdruck, bildText, bildTextJetzt, istBildKarte, useBildTextAn } from '../lib/textInBildern';
import { ICopy, IFileText } from './Icons';

/**
 * M452: Eintrag im ⋯-Menü (und damit im Rechtsklick-Menü) einer einzelnen Bild-Karte — kein Dauer-Knopf auf
 * dem Bild. Ist der Text schon erkannt, kopiert er ihn; sonst stößt er die Erkennung sofort an (statt auf den
 * Leerlauf zu warten). Findet die Erkennung nichts, sagt der Eintrag das, statt leer zu kopieren.
 */
export function BildTextMenue({ node, schliessen }: { node: AppNode; schliessen: () => void }) {
  const an = useBildTextAn();
  const showToast = useBoard((s) => s.showToast);
  const boardId = useBoard((s) => s.activeId);
  const [laeuft, setLaeuft] = useState(false);
  if (!istBildKarte(node)) return null;
  const text = bildText(node);
  const erkannt = (node.data as { ocrFuer?: string }).ocrFuer === bildFingerabdruck(node);

  const kopieren = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      showToast(`Text aus dem Bild kopiert (${t.length} Zeichen).`);
    } catch {
      // Die Erkennung kann länger dauern, als der Browser das Kopieren nach dem Klick erlaubt
      showToast('Text erkannt – ⋯ → „Text im Bild kopieren" legt ihn in die Zwischenablage.', false, 6000);
    }
  };

  if (erkannt && text) {
    return (
      <button data-taste="bild-text-kopieren" title="Den im Bild erkannten Text in die Zwischenablage legen"
        onClick={() => { schliessen(); void kopieren(text); }}>
        <ICopy size={14} /> Text im Bild kopieren
      </button>
    );
  }
  if (erkannt) {
    return (
      <button data-taste="bild-text-leer" disabled title="Die Texterkennung hat in diesem Bild nichts Lesbares gefunden">
        <IFileText size={14} /> Kein Text im Bild erkannt
      </button>
    );
  }
  if (!an) return null;
  return (
    <button data-taste="bild-text-erkennen" disabled={laeuft} title="Den Text in diesem Bild jetzt erkennen – sonst geschieht das von selbst, wenn der Rechner ruhig ist"
      onClick={async () => {
        setLaeuft(true);
        showToast('Text im Bild wird erkannt …', false, 60000, true);
        const t = await bildTextJetzt(boardId, node.id);
        setLaeuft(false);
        schliessen();
        if (t === null) showToast('Die Texterkennung ließ sich nicht starten – ohne Netz kann die portable Datei sie nicht laden.', false, 7000);
        else if (!t) showToast('Kein Text im Bild gefunden.');
        else await kopieren(t);
      }}>
      <IFileText size={14} /> {laeuft ? 'Text wird erkannt …' : 'Text im Bild erkennen'}
    </button>
  );
}
