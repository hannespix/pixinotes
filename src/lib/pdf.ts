// PDF-Rendering (pdf.js) — lazy geladen, Worker inline gebündelt,
// damit auch die Single-HTML-Version von file:// funktioniert.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

export function getPdfjs() {
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

/** Eine PDF-Seite in ein Canvas rendern; gibt die Seitenzahl des Dokuments zurück. */
export async function renderPdfPage(
  dataUrl: string,
  pageNo: number,
  canvas: HTMLCanvasElement,
  maxWidth: number,
): Promise<number> {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({ url: dataUrl });
  const doc = await task.promise;
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1 });
  const scale = (maxWidth / base.width) * (window.devicePixelRatio > 1 ? 2 : 1.4);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
  const pages = doc.numPages;
  void task.destroy();
  return pages;
}
