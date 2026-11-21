// M425: Präsentationen mit Vibe Studio direkt auf dem Board.
//
// Gewünscht: „Können wir das Präsentationstool Vibe Studio irgendwie als Modul in PixiNotes integrieren? Dass man
// quasi Vibe-Studio-Präsentationen direkt auf dem PixiNotes-Whiteboard erstellen kann?"
//
// Vibe Studio ist eine Ein-Datei-Anwendung (Reveal.js-Folien mit eingebautem Editor). PixiNotes kann solche Dateien
// schon als „Eigene App" ausführen — abgeschottet in einer Sandbox, der Entwurf des Editors (localStorage) bleibt
// über die Speicher-Brücke an der Karte (htmlStore.ts). Das Modul legt also eine App-Karte mit der leeren Vorlage an
// und startet sie gleich. Die Vorlage liegt neben der App (public/vorlagen, erzeugt von werkzeug/vibestudio-vorlage.mjs)
// und wird erst beim Anlegen geladen — 1,2 MB, die sonst jeder Start mitschleppen müsste.

/** Erkennungszeichen an der Karte (data.vorlage) — schaltet Vollbild aus der Folie heraus frei */
export const VIBE_STUDIO = 'vibestudio';

/** Zuerst neben der App; die Ein-Datei-Fassung (file://) holt sie von der veröffentlichten PixiNotes-Seite */
const ORTE = ['vorlagen/vibestudio.html', 'https://hannespix.github.io/pixinotes/vorlagen/vibestudio.html'];

let geladen: Promise<string> | null = null;

/** Die leere Vibe-Studio-Datei. Schlägt nur fehl, wenn keiner der Orte erreichbar ist (offline in der Ein-Datei-Fassung). */
export function vibeStudioVorlage(): Promise<string> {
  geladen ??= (async () => {
    for (const ort of ORTE) {
      try {
        const res = await fetch(ort);
        if (!res.ok) continue;
        const text = await res.text();
        // nur die echte Vorlage — keine Ersatzseite eines Servers (404 als index.html)
        if (text.includes('editor-present') && text.includes('Reveal')) return text;
      } catch { /* nächster Ort */ }
    }
    throw new Error('Vorlage nicht erreichbar');
  })();
  // ein Fehlschlag soll beim nächsten Versuch neu laden dürfen
  geladen.catch(() => { geladen = null; });
  return geladen;
}

/** Karten, die beim ersten Erscheinen gleich starten sollen (gerade angelegt) — nur in dieser Sitzung */
const sofort = new Set<string>();
export const sofortStartenVormerken = (id: string) => { sofort.add(id); };
/** true genau einmal je vorgemerkter Karte */
export const sofortStarten = (id: string) => sofort.delete(id);
