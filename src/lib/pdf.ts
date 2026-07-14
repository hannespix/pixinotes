// PDF-Rendering (pdf.js v4) — lazy geladen, Worker inline gebündelt,
// damit auch die Single-HTML-Version von file:// funktioniert.
import type { PDFDocumentProxy } from 'pdfjs-dist';

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
  maxWidth: number,
): RenderHandle {
  let renderTask: { cancel: () => void } | null = null;
  let cancelled = false;

  const promise = (async () => {
    const doc = await getDoc(dataUrl);
    if (cancelled) return doc.numPages;
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = (maxWidth / base.width) * (window.devicePixelRatio > 1 ? 2 : 1.4);
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
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
