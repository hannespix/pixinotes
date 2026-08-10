import { useBoard } from '../store';

/**
 * M224: Anzeige-Einstellungen für Augen, die nicht mehr die besten sind.
 *
 * Der Anlass ist ein Praxisbefund: Wer ohne Brille oder mit Sehbehinderung vor
 * der App sitzt, kann sie kaum bedienen. Die Antwort ist bewusst NICHT „nur die
 * Schrift größer": Wer Text schlecht liest, trifft auch kleine Knöpfe schlecht.
 * Deshalb skaliert `zoom` am Wurzelelement die gesamte Oberfläche — Schrift,
 * Knöpfe, Abstände und die Karteninhalte gleichermaßen, genau wie der
 * Browser-Zoom, nur auffindbar und dauerhaft gemerkt.
 *
 * Warum `zoom` und nicht `transform: scale`: `zoom` verkleinert den Auslauf
 * (Viewport) mit, also bleiben `position: fixed`, `100dvh` und die
 * Tastatur-Erkennung (M211) korrekt. Ein `scale` würde die Leisten aus dem
 * Bild schieben.
 *
 * Die beiden Schalter daneben helfen unabhängig davon:
 * - lesbare Schrift = Atkinson Hyperlegible, für Sehschwäche entworfen
 *   (Buchstaben, die sich sonst ähneln, sind bewusst unterscheidbar gebaut)
 * - hoher Kontrast = kräftigere Schrift und Ränder, kein Milchglas, keine
 *   Papiertextur. Genau die Effekte, die eine Oberfläche schick machen,
 *   kosten Kontrast — hier lassen sie sich abschalten.
 */
/**
 * Der aktuell eingestellte Wurzel-Zoom als Zahl (1 = aus).
 *
 * Gelesen wird der Inline-Stil, den `apply()` unten setzt — nicht
 * `getComputedStyle`. Grund: `zoom` ist erst seit kurzem überall eine echte
 * CSS-Eigenschaft; ältere Browser kennen sie zwar beim Rendern, geben sie im
 * berechneten Stil aber nicht zurück. Der Inline-Wert steht dagegen immer da,
 * weil wir ihn selbst geschrieben haben.
 *
 * Gebraucht wird die Zahl überall dort, wo Bildpunkte gezählt werden müssen:
 * Beim PDF-Rendern (M242) entscheidet sie über die Auflösung des Bitmaps, beim
 * Vermessen der Kopfleiste (M236) über die Umrechnung Schirm ↔ Layout.
 */
export function wurzelZoom(): number {
  const z = parseFloat(document.documentElement.style.zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export function initAnzeige(): () => void {
  const root = document.documentElement;
  const apply = (z: number, lesbar: boolean, kontrast: boolean) => {
    // 1 = aus. Die Eigenschaft ganz zu entfernen ist sauberer, als "1" zu
    // setzen: Manche Browser legen sonst grundlos eine eigene Ebene an.
    if (z > 1.001) root.style.setProperty('zoom', String(z));
    else root.style.removeProperty('zoom');
    root.dataset.lesbar = lesbar ? 'an' : 'aus';
    root.dataset.kontrast = kontrast ? 'hoch' : 'normal';
  };
  const s0 = useBoard.getState();
  apply(s0.anzeige ?? 1, !!s0.lesbareSchrift, !!s0.hoherKontrast);
  return useBoard.subscribe((s) => {
    apply(s.anzeige ?? 1, !!s.lesbareSchrift, !!s.hoherKontrast);
  });
}
