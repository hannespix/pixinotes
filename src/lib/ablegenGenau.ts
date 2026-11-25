// M535: Eine gezogene Karte landet dort, wo die Maus losgelassen wird — auch ohne Bild Abstand zur letzten Bewegung.
//
// React Flow (XYDrag) setzt die Lage der Karte nur bei Mausbewegungen; das Loslassen nimmt die Lage der letzten
// Bewegung. Kommt das Loslassen an einer anderen Stelle an als die letzte Bewegung (der Browser fasst Bewegungen je
// Bild zusammen; folgt das Loslassen ohne Bild Abstand, wird die letzte Bewegung nie ausgeliefert), lag die Karte an
// der vorletzten Stelle (M518, Befund 3: 48 Punkte neben dem Zeiger). Hier: Kommt während eines Zugs ein Loslassen an
// einer anderen Stelle an, geht vorher eine Bewegung an genau diese Stelle — durch denselben Weg wie jede andere
// (Fanglinien, Raster, Ausweichen, Kanten), danach erst das Loslassen. Der Hörer hängt vor dem von React Flow am
// Fenster (früher angemeldet, Einfang-Phase), sieht also das Loslassen zuerst.
import { zugLaeuft } from './zugAnzeige';

let letzte: { x: number; y: number } | null = null;
let aktiv = 0;

const merken = (e: MouseEvent) => { letzte = { x: e.clientX, y: e.clientY }; };
const losgelassen = (e: MouseEvent) => {
  if (!zugLaeuft() || !letzte || e.button !== 0) return;
  if (letzte.x === e.clientX && letzte.y === e.clientY) return;
  const nach = new MouseEvent('mousemove', {
    bubbles: true, cancelable: true, view: window, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
    buttons: 1, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
  });
  (e.target ?? window).dispatchEvent(nach);
};

/** Einmal anmelden (vom Board); gibt die Abmeldung zurück. Mehrfach angemeldet zählt einmal. */
export function ablegenGenauAn(): () => void {
  if (aktiv++ === 0) {
    window.addEventListener('mousemove', merken, true);
    window.addEventListener('mousedown', merken, true);
    window.addEventListener('mouseup', losgelassen, true);
  }
  return () => {
    if (--aktiv > 0) return;
    window.removeEventListener('mousemove', merken, true);
    window.removeEventListener('mousedown', merken, true);
    window.removeEventListener('mouseup', losgelassen, true);
  };
}
