// PDF-Rendering (pdf.js v4) — lazy geladen, Worker inline gebündelt,
// damit auch die Single-HTML-Version von file:// funktioniert.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { wurzelZoom } from './anzeige';

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      // ?worker&inline: Vite bündelt den Worker als Base64 in den Chunk
      import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerPort = new worker.default();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

// Geladene Dokumente pro dataUrl cachen — sonst wird die ganze base64-PDF
// bei jedem Seitenwechsel neu geparst (Audit MITTEL).
const docCache = new Map<string, Promise<PDFDocumentProxy>>();

async function getDoc(dataUrl: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(dataUrl);
  if (!p) {
    p = getPdfjs().then((pdfjs) => pdfjs.getDocument({ url: dataUrl }).promise);
    docCache.set(dataUrl, p);
  }
  return p;
}

/** M335: Seitenzahl und Seitengröße (PDF-Punkte, Maßstab 1) — für seitenbezogene Anmerkungen */
export async function pdfSeiteMasse(dataUrl: string, pageNo = 1): Promise<{ seiten: number; breite: number; hoehe: number }> {
  const doc = await getDoc(dataUrl);
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const vp = page.getViewport({ scale: 1 });
  return { seiten: doc.numPages, breite: vp.width, hoehe: vp.height };
}

/**
 * M356: Wo auf der Seite Text steht — Kästen der Textläufe in Seitenpunkten (Ursprung oben links).
 * Der Textmarker rastet darauf ein. Gedrehter Text bleibt außen vor; eine gescannte PDF liefert nichts.
 */
export async function pdfSeiteText(dataUrl: string, pageNo: number): Promise<Array<{ x: number; y: number; w: number; h: number }>> {
  const [pdfjs, doc] = await Promise.all([getPdfjs(), getDoc(dataUrl)]);
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const vp = page.getViewport({ scale: 1 });
  const inhalt = await page.getTextContent();
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const roh of inhalt.items) {
    const it = roh as { str?: string; transform?: number[]; width?: number };
    if (typeof it.str !== 'string' || !it.str.trim() || !it.transform || !it.width) continue;
    const t = pdfjs.Util.transform(vp.transform, it.transform) as number[];
    if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01) continue;   // gedreht
    const h = Math.hypot(t[2], t[3]);
    if (h < 2) continue;
    // t[5] ist die Grundlinie: Oberlänge ~0,82 der Schrifthöhe, Unterlänge ~0,24
    out.push({ x: t[4], y: t[5] - h * 0.82, w: it.width, h: h * 1.06 });
  }
  return out;
}

/** M392: Grenzen fürs Bitmap einer Seite */
const MIN_PIXEL = 700;
const MAX_BREITE = 4096;
const MAX_PIXEL = 8_000_000;

/** Läuft ein Render noch, kann der Aufrufer ihn hierüber abbrechen. */
export interface RenderHandle {
  promise: Promise<number>;
  cancel: () => void;
}

/**
 * Eine PDF-Seite in ein Canvas rendern. Gibt ein Handle mit Abbruch zurück,
 * damit schnelles Blättern keine überlappenden Renders auf demselben Canvas
 * auslöst (pdf.js wirft sonst „Cannot use the same canvas…", Audit).
 */
export function renderPdfPage(
  dataUrl: string,
  pageNo: number,
  canvas: HTMLCanvasElement,
  /** Breite in CSS-Punkten, in der die Seite am Ende erscheinen soll */
  cssBreite: number,
  /**
   * Ob die CSS-Größe fest ans Canvas geschrieben wird.
   *
   * Der Viewer braucht das: Ohne Angabe richtet sich das Layout nach der
   * Bitmap-Breite, und die schwankt jetzt mit Gerät und Zoom — die Seite wäre
   * mal 900, mal 3600 Punkte breit. Die Miniatur auf der Karte braucht das
   * Gegenteil: Sie füllt per `width: 100 %` die Karte und muss beim Ziehen an
   * der Kartenecke mitwachsen. Ein Inline-Maß würde diese Regel schlagen
   * (Inline sticht Stylesheet) und die Vorschau auf einer festen Breite
   * einfrieren. Dort wird `cssBreite` also nur zum Rechnen benutzt.
   */
  festeGroesse = true,
  /**
   * M392: Stufe des Board-Zooms (lib/boardZoom.ts). Mit ihr wird das Bild so fein gemalt, wie es auf dem Schirm
   * erscheint — nicht nur so fein, wie die Karte breit ist. Ohne Angabe gilt die Anzeigegröße der Wurzel (M242).
   */
  stufe?: number,
): RenderHandle {
  let renderTask: { cancel: () => void } | null = null;
  let cancelled = false;

  const promise = (async () => {
    const doc = await getDoc(dataUrl);
    if (cancelled) return doc.numPages;
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    /**
     * M242: Scharf auf JEDEM Schirm und in JEDER Anzeigegröße.
     *
     * Ein PDF wird auf ein Canvas gemalt — also in ein Bitmap. Wird das
     * hinterher gestreckt, wird es unscharf; da hilft kein Nachschärfen. Also
     * muss beim Malen schon feststehen, wie viele echte Bildpunkte am Ende
     * gebraucht werden. Zwei Faktoren gehen ein:
     *
     *  · `devicePixelRatio` — auf Retina-/HiDPI-Schirmen zwei Gerätepunkte je
     *    CSS-Punkt. Vorher stand hier pauschal 2 bzw. 1.4 „für den Fall".
     *  · Die Anzeigegröße (A− / A+, M224) arbeitet mit CSS `zoom` auf der
     *    Wurzel. Bei 150 % streckt der Browser JEDES Bitmap um die Hälfte —
     *    auch dieses. Genau das war im Screenshot zu sehen: Text mit weichen
     *    Rändern. Der Zoom gehört also in die Rechnung.
     *
     * Die Obergrenze steht seit M392 weiter unten (MAX_BREITE, MAX_PIXEL).
     */
    const dpr = window.devicePixelRatio || 1;
    // Auf dem Board steckt die Anzeigegröße schon im Zoom (M268) — dort zählt die Stufe, sonst der Wurzel-Zoom
    const dichte = Math.max(1, dpr * (stufe ?? wurzelZoom()));
    const breite = Math.max(40, Math.round(cssBreite));
    const verhaeltnis = base.height / base.width;
    /**
     * M392: Wie viele Bildpunkte breit?
     *  · gebraucht werden Kartenbreite × Dichte (Schirm × Zoom-Stufe);
     *  · eine kleine Karte bekommt in Ruhe etwas Vorrat (bis zum Doppelten, höchstens MIN_PIXEL breit) — dann ist
     *    auch das erste Stück Hineinzoomen sofort scharf, noch bevor neu gemalt ist. Mehr als das Doppelte wäre
     *    kein Gewinn: Ein Bild, das der Browser stark verkleinern muss, flimmert an feinen Linien;
     *  · gedeckelt bei MAX_BREITE und MAX_PIXEL: Eine A4-Seite hat dann rund 2400 × 3400 Punkte. Mehr sieht
     *    niemand, und ein Bitmap kostet vier Byte je Punkt.
     */
    let pixel = breite * dichte;
    if (!stufe || stufe <= 1) pixel = Math.max(pixel, Math.min(2 * pixel, MIN_PIXEL));
    pixel = Math.min(pixel, MAX_BREITE, Math.sqrt(MAX_PIXEL / verhaeltnis));
    const viewport = page.getViewport({ scale: pixel / base.width });
    if (festeGroesse) {
      canvas.style.width = `${breite}px`;
      canvas.style.height = `${Math.round(verhaeltnis * breite)}px`;
    }
    if (cancelled) return doc.numPages;
    /**
     * M392: Gemalt wird in einen Puffer, getauscht in einem Zug. Vorher wurde das sichtbare Canvas erst geleert
     * und dann bemalt — bei jedem Neumalen (andere Breite, anderer Zoom) blitzte die Seite leer auf. Das alte Bild
     * bleibt jetzt stehen, bis das neue fertig ist. Nebenbei können sich zwei Malvorgänge nicht mehr dasselbe
     * Canvas streitig machen.
     */
    const puffer = document.createElement('canvas');
    puffer.width = Math.max(1, Math.round(viewport.width));
    puffer.height = Math.max(1, Math.round(viewport.height));
    const pctx = puffer.getContext('2d');
    if (pctx) {
      const task = page.render({ canvasContext: pctx, viewport });
      renderTask = task;
      await task.promise;
      if (!cancelled) {
        canvas.width = puffer.width;
        canvas.height = puffer.height;
        canvas.getContext('2d')?.drawImage(puffer, 0, 0);
      }
    }
    puffer.width = 0; puffer.height = 0;   // Speicher gleich freigeben
    return doc.numPages;
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      try { renderTask?.cancel(); } catch { /* schon fertig */ }
    },
  };
}
