// M393: Eine Leiste, die sich an den oberen Rand zurückzieht — für Ansichten, in denen der Schirm dem Inhalt gehört
// (ein Tool im Vollbild, ein Tool als Folie).
//
// Sie zeigt sich beim Eintritt kurz (man sieht, wo sie ist), dann erst wieder, wenn der Zeiger sie am Rand berührt.
// Bewusst nicht nur mit CSS `:hover`: Wandert der Zeiger von der Leiste in ein eingebettetes Tool (fremder Rahmen),
// erfährt die Seite das nicht verlässlich — die Leiste bliebe stehen. Darum zählt hier die Zeit seit der letzten
// Bewegung AUF der Leiste; bleibt sie aus, geht die Leiste von selbst.
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

export function useRandLeiste(aktiv: boolean, anfang = 1800) {
  const [offen, setOffen] = useState(false);
  const uhr = useRef<number | undefined>(undefined);
  const zeigen = useCallback((ms: number) => {
    setOffen(true);
    window.clearTimeout(uhr.current);
    uhr.current = window.setTimeout(() => setOffen(false), ms);
  }, []);
  useEffect(() => {
    if (aktiv) zeigen(anfang);
    else { window.clearTimeout(uhr.current); setOffen(false); }
    return () => window.clearTimeout(uhr.current);
  }, [aktiv, anfang, zeigen]);
  const griff = aktiv ? {
    onPointerEnter: () => zeigen(3200),
    onPointerMove: () => zeigen(3200),
    onPointerDown: () => zeigen(3200),
    // Maus weg: gleich gehen. Finger: Das „Verlassen" kommt direkt nach dem Tippen — dann bleibt sie zum Bedienen.
    onPointerLeave: (e: PointerEvent) => zeigen(e.pointerType === 'mouse' ? 350 : 3200),
  } : {};
  return { da: aktiv && offen, griff };
}
