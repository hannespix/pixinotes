import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { mutedHistory, useBoard } from '../../store';
import type { FileNode } from '../../types';
import { formatBytes, MAX_EMBED_BYTES } from '../../lib/parseEmail';
import { triggerDownload } from '../../lib/download';
import { readFileAsDataUrl } from '../../lib/image';
import { canEmbed } from '../../lib/nodes';
import { loadAttachment } from '../../lib/attachments';
import { renderPdfPage } from '../../lib/pdf';
import { CardShell } from './CardShell';
import { IDownload } from '../Icons';

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
  const showToast = useBoard((s) => s.showToast);
  const file = data;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const icon = ICONS[ext] ?? '📎';
  const isPdf = ext === 'pdf' && !!file.dataUrl;
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const download = () => {
    if (file.dataUrl) triggerDownload(file.dataUrl, file.name);
  };

  /** M159: Datei liegt (nur) als Kopie im Team-Ordner — von dort holen.
   *  Passt sie ins Speicher-Budget, wird sie dauerhaft eingebettet (PDF-
   *  Vorschau!), sonst wird sie direkt heruntergeladen. */
  const loadFromTeam = async () => {
    if (!file.ref || loading) return;
    setLoading(true);
    try {
      const f = await loadAttachment(file.ref);
      if (!f) {
        showToast('Im Team-Ordner nicht gefunden — ist der Ordner verbunden und synchronisiert (⚙️ → Synchronisation)?');
        return;
      }
      if (f.size <= MAX_EMBED_BYTES) {
        const dataUrl = await readFileAsDataUrl(f);
        if (canEmbed(dataUrl.length)) {
          // ohne Undo-Schritt — das Nachladen ist keine inhaltliche Bearbeitung
          mutedHistory(() => useBoard.getState().updateNodeData(id, { dataUrl, size: f.size }));
          showToast(`„${file.name}" aus dem Team-Ordner geladen.`);
          return;
        }
      }
      const url = URL.createObjectURL(f);
      triggerDownload(url, file.name);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CardShell id={id} selected={selected} minWidth={170} minHeight={50} className="file-card">
      <button className="file-body nodrag" onClick={isPdf ? () => setViewerOpen(true) : file.dataUrl ? download : loadFromTeam}
        title={isPdf ? 'Vorschau öffnen' : file.dataUrl ? 'Herunterladen' : file.ref ? 'Aus dem Team-Ordner laden' : undefined}>
        <span className="file-icon">{icon}</span>
        <span>
          <b>{file.name}</b>
          <span className="meta"> {formatBytes(file.size)}</span>
        </span>
      </button>
      {!file.dataUrl && file.ref && (
        <button className="file-teamload nodrag" disabled={loading} onClick={loadFromTeam}
          title={`Kopie liegt im Team-Ordner: ${file.ref}`}>
          {loading ? 'Lädt …' : 'Aus Team-Ordner laden'}
        </button>
      )}
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
    if (!ref.current) return;
    const h = renderPdfPage(dataUrl, 1, ref.current, 220);
    h.promise.catch(() => setFailed(true));
    return () => h.cancel();
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
    if (!ref.current) return;
    const h = renderPdfPage(dataUrl, page, ref.current, Math.min(900, window.innerWidth - 80));
    h.promise.then(setPages).catch(() => {});
    return () => h.cancel();
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
            <button onClick={onDownload} title="Herunterladen"><IDownload size={14} /></button>
            <button onClick={onClose} aria-label="Schließen">✕</button>
          </span>
        </div>
        <div className="pdf-page"><canvas ref={ref} /></div>
      </div>
    </div>,
    document.body,
  );
}
