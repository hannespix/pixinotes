import { useBoard } from '../store';
import { imageFileToDataUrl } from './image';
import { canEmbed } from './nodes';

/**
 * M289: Bilder gehören auch IN die Notiz — nicht nur als eigene Karte daneben.
 *
 * Bisher endete jeder Weg für ein Bild auf dem Board: Strg+V legte eine
 * Bild-KARTE an, und der Zeiger im Notiztext ignorierte das Einfügen komplett
 * (gemessen: Blocktypen vorher/nachher identisch, kein Bild im DOM). Am
 * Telefon gab es gar keinen Weg — dort ist Strg+V keine Geste, und das
 * Zwischenablage-Menü im Dock erzeugt wieder nur eine Karte.
 *
 * Diese Funktion ist der Anschluss, den der Editor (BlockNote) dafür braucht:
 * Er reicht die Datei herein — vom Einfügen, vom Ablegen per Drag & Drop und
 * vom Dateiwähler des Bild-Blocks (am Handy also die Fotomediathek oder die
 * Kamera) — und bekommt eine Adresse zurück, die er in den Block schreibt.
 *
 * Drei Regeln, alle aus dem lokalen Betrieb heraus begründet:
 *
 * 1. NUR BILDER. Videos, Tonspuren und beliebige Dateien würden als Base64 im
 *    Text stecken und den Speicher der Anwendung (localStorage, ~5 MB)
 *    sprengen. Für sie gibt es die Datei-Karte auf dem Board — die liegt in
 *    der Geräte-Ablage (IndexedDB, M269) und kennt diese Grenze nicht.
 * 2. VERKLEINERN. Ein Handyfoto hat gern 4000 Punkte Kantenlänge; die
 *    gemeinsame Bild-Pipeline (M254) skaliert auf 1600 und wandelt Formate um,
 *    die nicht jeder Browser zeigt (HEIC vom iPhone).
 * 3. SPEICHER PRÜFEN. Passt das Bild nicht mehr ins Budget, wird es NICHT
 *    eingebettet — sonst scheiterte ab da jeder Schreibvorgang und der ganze
 *    Board-Stand ginge beim nächsten Laden verloren.
 */
export async function notizBildHochladen(file: File): Promise<string> {
  const { showToast } = useBoard.getState();
  if (!file.type.startsWith('image/')) {
    showToast('In eine Notiz passen Bilder. Andere Dateien einfach aufs Board ziehen — sie werden dort eine Datei-Karte.');
    throw new Error('kein Bild');
  }
  const src = await imageFileToDataUrl(file);
  if (src === null) {
    showToast('⚠️ Dieses Bildformat kann der Browser nicht lesen — als Datei-Karte aufs Board ziehen.');
    throw new Error('Format nicht lesbar');
  }
  if (!canEmbed(src.length)) {
    showToast('⚠️ Speicher fast voll — Bild nicht eingebettet. Exportiere in den Datenordner (⚙️).');
    throw new Error('Speicherbudget');
  }
  return src;
}

/**
 * Bilder aus der Zwischenablage holen — der Weg für Geräte OHNE Strg+V.
 *
 * iOS nimmt Web-Anwendungen nicht in sein Teilen-Menü auf (M254); der Weg
 * dorthin führt über „Kopieren" in der Fotos-App und einen Knopf hier. Gibt
 * der Browser die Zwischenablage nicht frei, sagt der Rückgabewert das —
 * der Aufrufer kann dann den Dateiwähler anbieten, statt nur zu meckern.
 */
export async function bilderAusZwischenablage(): Promise<File[] | 'verweigert'> {
  try {
    const eintraege = await navigator.clipboard.read();
    const dateien: File[] = [];
    for (const e of eintraege) {
      const typ = e.types.find((t) => t.startsWith('image/'));
      if (!typ) continue;
      const blob = await e.getType(typ);
      dateien.push(new File([blob], `Einfügen.${typ.split('/')[1] || 'png'}`, { type: typ }));
    }
    return dateien;
  } catch {
    return 'verweigert';
  }
}
