import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import type { FileNode } from '../../types';
import { formatBytes } from '../../lib/parseEmail';
import { triggerDownload } from '../../lib/download';
import { renderPdfPage } from '../../lib/pdf';
import { CardShell } from './CardShell';

const ICONS: Record<string, string> = {
  pdf: '📕',
  xlsx: '📊',
  xls: '📊',
  csv: '📊',
  docx: '📄',
  doc: '📄',
  pptx: '📽️',
  zip: '🗜️',
};

/**
 * Datei als Karte. PDFs zeigen die erste Seite als Mini-Vorschau direkt auf
 * der Karte; Klick auf die Vorschau öffnet den Inline-Viewer mit
 * Seiten-Navigation. Andere Dateien: Icon + Name, Klick lädt herunter.
 */
export function FileCard({ id, data, selected }: NodeProps<FileNode>) {
  const file = data;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const icon = ICONS[ext] ?? '📎';
  const isPdf = ext === 'pdf' && !!file.dataUrl;
  const [viewerOpen, setViewerOpen] = useState(false);

  const download = () => {
    if (file.dataUrl) triggerDownload(file.dataUrl, file.name);
  };

  return (
    <CardShell id={id} selected={selected} minWidth={170} minHeight={50} className="file-card">
      <button className="file-body nodrag" onClick={isPdf ? () => setViewerOpen(true) : download}
        title={isPdf ? 'Vorschau öffnen' : file.dataUrl ? 'Herunterladen' : undefined}>
        <span className="file-icon">{icon}</span>
        <span>
          <b>{file.name}</b>
          <span className="meta"> {formatBytes(file.size)}</span>
        </span>
      </button>
      {isPdf && <PdfThumb dataUrl={file.dataUrl!} onOpen={() => setViewerOpen(true)} />}
      {viewerOpen && <PdfViewer dataUrl={file.dataUrl!} name={file.name} onClose={() => setViewerOpen(false)} onDownload={download} />}
    </CardShell>
  );
}

/** Erste PDF-Seite als Mini-Vorschau auf der Karte */
function PdfThumb({ dataUrl, onOpen }: { dataUrl: string; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (ref.current) renderPdfPage(dataUrl, 1, ref.current, 220).catch(() => setFailed(true));
  }, [dataUrl]);
  if (failed) return null;
  return (
    <button className="pdf-thumb nodrag" onClick={onOpen} title="PDF-Vorschau öffnen">
      <canvas ref={ref} />
    </button>
  );
}

/** Inline-Viewer als Overlay (Portal — React-Flow-Transformationen brechen sonst position:fixed) */
function PdfViewer({ dataUrl, name, onClose, onDownload }: {
  dataUrl: string; name: string; onClose: () => void; onDownload: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    if (ref.current) {
      renderPdfPage(dataUrl, page, ref.current, Math.min(900, window.innerWidth - 80))
        .then(setPages)
        .catch(() => {});
    }
  }, [dataUrl, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setPage((p) => Math.min(pages, p + 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages, onClose]);

  return createPortal(
    <div className="pdf-backdrop nodrag" onClick={onClose}>
      <div className="pdf-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-bar">
          <b>{name}</b>
          <span className="pdf-nav">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Vorherige Seite">‹</button>
            <span>{page} / {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Nächste Seite">›</button>
            <button onClick={onDownload} title="Herunterladen">⬇️</button>
            <button onClick={onClose} aria-label="Schließen">✕</button>
          </span>
        </div>
        <div className="pdf-page"><canvas ref={ref} /></div>
      </div>
    </div>,
    document.body,
  );
}
