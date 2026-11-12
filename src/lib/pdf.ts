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
     * Die Deckelung bei 4 ist eine Sicherung: Ein Retina-Schirm bei 200 %
     * Anzeigegröße käme sonst auf ein Bitmap mit der vierfachen Kantenlänge,
     * also dem Sechzehnfachen an Speicher. Vier reicht fürs Auge.
     */
    const dichte = Math.min(4, Math.max(1, (window.devicePixelRatio || 1) * wurzelZoom()));
    const breite = Math.max(40, Math.round(cssBreite));
    const scale = (breite / base.width) * dichte;
    const viewport = page.getViewport({ scale });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    if (festeGroesse) {
      canvas.style.width = `${breite}px`;
      canvas.style.height = `${Math.round((base.height / base.width) * breite)}px`;
    }
    const ctx = canvas.getContext('2d');
    if (ctx && !cancelled) {
      const task = page.render({ canvasContext: ctx, viewport });
      renderTask = task;
      await task.promise;
    }
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
