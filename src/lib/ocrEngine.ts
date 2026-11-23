/**
 * M452: Die Texterkennung selbst — NUR über `import()` aus textInBildern.ts laden.
 *
 * Hier hängt tesseract.js dran (Apache-2.0). Das Modul darf nie in den Start-Bundle: Die Engine samt
 * Sprachdaten ist rund 9 MB schwer und wird erst gebraucht, wenn ein Bild ohne erkannten Text auf einem
 * Board liegt und der Rechner gerade nichts zu tun hat.
 *
 * Woher die Dateien kommen:
 *   · Web-App (GitHub Pages): aus `ocr/` neben der App — der Build legt Worker, Kern (WASM) und die
 *     Sprachdaten Deutsch + Englisch dorthin (vite.config.ts, `ocrDateienKopieren`). Kein fremdes CDN.
 *   · Portable Datei (file://): Die 9 MB passen nicht sinnvoll in eine HTML-Datei, die man per Mail
 *     weitergibt. Sie holt die Dateien beim ersten Bedarf von der Web-Adresse der App — die Bilder
 *     selbst verlassen das Gerät nie. Ohne Netz bleibt die Erkennung für diese Sitzung aus.
 * Die Sprachdaten legt tesseract.js nach dem ersten Laden in der IndexedDB ab; danach geht es offline.
 */
import { createWorker, type Worker } from 'tesseract.js';

const WEB_ADRESSE = 'https://hannespix.github.io/pixinotes/ocr/';

export function ocrBasis(): string {
  if (import.meta.env.MODE === 'single') return WEB_ADRESSE;
  return new URL('ocr/', document.baseURI).href;
}

let worker: Promise<Worker> | null = null;
let ruhe: ReturnType<typeof setTimeout> | null = null;

function holeWorker(): Promise<Worker> {
  if (!worker) {
    const basis = ocrBasis();
    worker = createWorker(['deu', 'eng'], 1, {
      workerPath: `${basis}worker.min.js`,
      corePath: basis,
      langPath: basis,
      // Ein Blob-Worker lädt das Skript per importScripts — so klappt es auch aus der portablen Datei
      workerBlobURL: true,
      gzip: true,
    });
    worker.catch(() => { worker = null; });
  }
  return worker;
}

/** Nach einer Minute ohne Bild den Worker beenden — er hält gut 100 MB Speicher */
function ruheEinplanen(): void {
  if (ruhe) clearTimeout(ruhe);
  ruhe = setTimeout(() => {
    const w = worker;
    worker = null;
    void w?.then((x) => x.terminate()).catch(() => { /* schon weg */ });
  }, 60_000);
}

/** Erkannten Rohtext aufräumen: leere Zeilen und Zeilen ohne zwei Buchstaben/Ziffern (Rauschen) raus */
export function textAufraeumen(roh: string): string {
  return roh
    .split('\n')
    .map((z) => z.replace(/\s+/g, ' ').trim())
    .filter((z) => (z.match(/[\p{L}\d]/gu) ?? []).length >= 2)
    .join('\n')
    .trim();
}

export async function erkenne(bild: Blob): Promise<string> {
  if (ruhe) clearTimeout(ruhe);
  try {
    const w = await holeWorker();
    const { data } = await w.recognize(bild);
    return textAufraeumen(data.text ?? '');
  } finally {
    ruheEinplanen();
  }
}
