/**
 * M501: Ein gemeinsamer Zeiger-Beobachter für alle Pixis auf dem Board.
 *
 * Ein Listener am Fenster (nicht je Karte), die letzten Punkte in einem kleinen Ring. Ein requestAnimationFrame wird
 * NUR bei Bewegung geplant und nur, wenn mindestens ein Pixi gerade wach im Sichtfeld steht und der Tab sichtbar ist —
 * keine Dauer-Schleife, kein Takt, solange sich nichts bewegt. Mehrere Pixis teilen sich denselben Rahmen.
 */
import type { ZeigerPunkt } from './pixiVerhalten';

export interface ZeigerAbo {
  /** steht im Sichtfeld und darf rechnen */
  aktiv: () => boolean;
  /** einmal je Bild nach einer Bewegung: alle letzten Punkte, der neueste zuletzt */
  rahmen: (punkte: readonly ZeigerPunkt[]) => void;
}

const RING = 128;   // reicht für zwei schnelle Runden um Pixi (Schwindel) auch bei 120 Hz
const punkte: ZeigerPunkt[] = [];
const abos = new Set<ZeigerAbo>();
let geplant = 0;

function bild() {
  geplant = 0;
  for (const a of abos) if (a.aktiv()) a.rahmen(punkte);
}

function bewegung(e: PointerEvent) {
  punkte.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  if (punkte.length > RING) punkte.shift();
  if (geplant || document.hidden) return;
  for (const a of abos) {
    if (a.aktiv()) { geplant = requestAnimationFrame(bild); return; }
  }
}

const OPT = { passive: true, capture: true } as const;

export function zeigerAbonnieren(abo: ZeigerAbo): () => void {
  if (!abos.size) {
    window.addEventListener('pointermove', bewegung, OPT);
    // Touch: kein Zeiger, der schwebt — Pixi schaut zum letzten Berührpunkt
    window.addEventListener('pointerdown', bewegung, OPT);
  }
  abos.add(abo);
  return () => {
    abos.delete(abo);
    if (abos.size) return;
    window.removeEventListener('pointermove', bewegung, OPT);
    window.removeEventListener('pointerdown', bewegung, OPT);
    if (geplant) { cancelAnimationFrame(geplant); geplant = 0; }
  };
}
