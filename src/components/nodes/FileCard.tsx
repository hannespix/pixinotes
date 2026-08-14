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
import { loadFile, saveFile, vorschauArt, warumKeineVorschau } from '../../lib/fileStore';
import { useLupe } from '../../lib/lupe';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { BildLupe, ZoomKnoepfe } from './BildLupe';
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
  /** M263: „DB_Reservierung_762631109316.pdf" sagt niemandem etwas. */
  const eigenerTitel = !!file.titel?.trim();
  const titel = eigenerTitel ? file.titel!.trim() : file.name;
  /**
   * M259: Der Inhalt kommt aus der lokalen Ablage (IndexedDB) — oder, bei
   * kleinen Dateien und alten Ständen, weiterhin aus dem Board.
   *
   * Vorher hing JEDE Vorschau an `dataUrl`, und die gab es ab 1,5 MB nicht
   * mehr. Eine 3-MB-PDF blieb deshalb ein Dateiname mit Größenangabe — genau
   * die gemeldete Beobachtung. Jetzt entscheidet nicht die Größe, sondern
   * ob der Browser den Typ darstellen kann.
   */
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  /**
   * M269: Nach einem Sync trudeln die Dateiinhalte NACH.
   *
   * Der Beipack wird geschrieben, wenn die Boards längst stehen (siehe
   * syncFolder.ts) — ohne diesen Zähler bliebe die Karte beim Platzhalter,
   * obwohl die Datei inzwischen da ist, und man müsste die Seite neu laden.
   */
  const [nachzuegler, setNachzuegler] = useState(0);
  useEffect(() => {
    const auf = () => setNachzuegler((n) => n + 1);
    window.addEventListener('pixinotes:dateien-da', auf);
    return () => window.removeEventListener('pixinotes:dateien-da', auf);
  }, []);
  useEffect(() => {
    if (file.dataUrl) return;
    let url: string | null = null;
    let weg = false;
    void loadFile(id).then((b) => {
      if (!b || weg) return;
      url = URL.createObjectURL(b);
      setBlobUrl(url);
    });
    return () => {
      weg = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, file.dataUrl, file.lokal, nachzuegler]);

  /** Die Quelle für Vorschau und Download — egal, wo sie herkommt */
  const quelle = file.dataUrl ?? blobUrl ?? null;
  const art = vorschauArt(file.name, file.mime);
  const isPdf = art === 'pdf' && !!quelle;
  /**
   * M254: Auch eine Datei-KARTE zeigt ein Bild als Bild.
   *
   * Als Datei landet ein Foto in zwei Fällen: Es ist zu groß fürs Einbetten,
   * oder der Browser kann das Format nicht anzeigen. Im ersten Fall gibt es
   * die Daten trotzdem — dann ist eine Vorschau selbstverständlich. Der
   * gemeldete Fall („wird als Datei eingefügt, aber nicht als Bild angezeigt")
   * ist damit auch dann noch brauchbar, wenn er auftritt.
   */
  const istBild = !!quelle && art === 'bild';
  const [viewerOpen, setViewerOpen] = useState(false);
  const [bildOffen, setBildOffen] = useState(false);
  const [loading, setLoading] = useState(false);

  const download = () => {
    if (quelle) triggerDownload(quelle, file.name);
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
      /**
       * M259: Was aus dem Team-Ordner kommt, bleibt hier — in jeder Größe.
       *
       * Vorher landete nur eine kleine Datei im Board und alles darüber ging
       * direkt in den Download-Ordner: Beim nächsten Öffnen war die Karte
       * wieder leer. Jetzt geht der Inhalt in die lokale Ablage, und die
       * Vorschau steht dauerhaft.
       */
      await saveFile(id, f);
      const dataUrl = f.size <= MAX_EMBED_BYTES ? await readFileAsDataUrl(f) : '';
      // ohne Undo-Schritt — das Nachladen ist keine inhaltliche Bearbeitung
      mutedHistory(() => useBoard.getState().updateNodeData(id, {
        size: f.size, lokal: true,
        ...(dataUrl && canEmbed(dataUrl.length) ? { dataUrl } : {}),
      }));
      setBlobUrl((alt) => { if (alt) URL.revokeObjectURL(alt); return URL.createObjectURL(f); });
      showToast(`„${file.name}" aus dem Team-Ordner geladen.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <CardShell id={id} selected={selected} minWidth={170} minHeight={50} className="file-card">
      {/* M263: Der TITEL steht oben und ist umbenennbar (Doppelklick, wie bei
          Rahmen und Formen). Der Dateiname bleibt daneben stehen, sobald er
          abweicht — er ist die Wahrheit über die Datei, nicht der Titel. */}
      <div className="file-kopf">
        <span className="file-icon">{icon}</span>
        <DragTitle
          className="file-titel"
          value={titel}
          placeholder="Karte benennen"
          onChange={(v) => {
            const neu = v.trim();
            useBoard.getState().updateNodeData(id, { titel: neu && neu !== file.name ? neu : undefined });
          }}
        />
      </div>
      <button className="file-body nodrag" onClick={isPdf ? () => setViewerOpen(true) : quelle ? download : loadFromTeam}
        title={isPdf ? 'Vorschau öffnen' : quelle ? 'Herunterladen' : file.ref ? 'Aus dem Team-Ordner laden' : undefined}>
        <span className="meta">
          {eigenerTitel && <>{file.name} · </>}{formatBytes(file.size)}
        </span>
      </button>
      {/* Nachladen braucht nur, wem der Inhalt fehlt — sonst liegt er schon hier */}
      {!quelle && file.ref && (
        <button className="file-teamload nodrag" disabled={loading} onClick={loadFromTeam}
          title={`Kopie liegt im Team-Ordner: ${file.ref}`}>
          {loading ? 'Lädt …' : 'Aus Team-Ordner laden'}
        </button>
      )}
      {/* M259: Dass eine Team-Kopie existiert, stand vorher NUR auf dem
          Nachlade-Knopf. Der entfällt jetzt, sobald der Inhalt lokal liegt —
          die Auskunft darf dabei nicht mit verschwinden. */}
      {quelle && file.ref && (
        <div className="file-teamnote" title={file.ref}>
          Kopie im Team-Ordner: {file.ref.split('/').slice(-2).join('/')}
        </div>
      )}
      {/* M264: Auch das Bild lässt sich groß ansehen und vergrößern — der
          Klick auf die Vorschau öffnet dieselbe Lupe wie beim PDF. */}
      {istBild && (
        <button className="file-thumb nodrag" onClick={() => setBildOffen(true)} title="Bild groß ansehen (zoombar)">
          <img src={quelle!} alt={titel} draggable={false}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        </button>
      )}
      {bildOffen && quelle && (
        <BildLupe quelle={quelle} name={titel} onClose={() => setBildOffen(false)} onDownload={download} />
      )}
      {isPdf && <PdfThumb dataUrl={quelle!} onOpen={() => setViewerOpen(true)} />}
      {/* M259: Ton und Bewegtbild kann der Browser selbst — dann soll er auch */}
      {art === 'audio' && quelle && <audio className="file-media nodrag" src={quelle} controls preload="metadata" />}
      {art === 'video' && quelle && <video className="file-media nodrag" src={quelle} controls preload="metadata" />}
      {art === 'text' && quelle && <TextVorschau quelle={quelle} />}
      {/* Ehrlich sagen, WARUM hier nichts zu sehen ist */}
      {art === 'keine' && quelle && (
        <div className="file-nopreview">{warumKeineVorschau(file.name)}</div>
      )}
      {!quelle && !file.ref && (
        <div className="file-nopreview">
          {/* M269: Dateien reisen jetzt bis zur eingestellten Obergrenze mit.
              Bleibt eine Karte trotzdem leer, liegt es fast immer an der
              Größe — das gehört hier hin, nicht ins Handbuch. */}
          Der Inhalt liegt nicht auf diesem Gerät. Dateien werden bis zur eingestellten
          Obergrenze mitsynchronisiert (⚙️ → Synchronisation); diese hier ist mit
          {' '}{formatBytes(file.size)} entweder größer oder wurde vor dieser Neuerung eingefügt.
          Auf dem Gerät mit der Datei einmal speichern — oder sie hier erneut einfügen.
        </div>
      )}
      {viewerOpen && <PdfViewer dataUrl={quelle!} name={titel} onClose={() => setViewerOpen(false)} onDownload={download} />}
    </CardShell>
  );
}

/**
 * Erste PDF-Seite als Mini-Vorschau auf der Karte.
 *
 * M242: Gerendert wird in der Breite, in der die Vorschau tatsächlich zu sehen
 * ist — nicht in pauschalen 220 Punkten. Die Datei-Karte ist ja größenveränder-
 * lich; wer sie auf 600 Punkte aufzieht, bekam bisher ein 220 Punkte breites
 * Bitmap auf das Dreifache gestreckt. Das ist genau die Unschärfe aus dem
 * Screenshot.
 */
function PdfThumb({ dataUrl, onOpen }: { dataUrl: string; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [breite, setBreite] = useState(220);

  // Breite der Vorschau verfolgen. Entprellt und mit Totzone: Beim Ziehen an
  // der Kartenecke feuert der Beobachter sonst pro Frame ein volles
  // PDF-Rendering — die Sorte Arbeit, die M223 aus dem Netz verbannt hat.
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const w = Math.round(el.clientWidth);
        if (w > 0) setBreite((alt) => (Math.abs(alt - w) > 12 ? w : alt));
      }, 220);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    // letztes Argument false: Die Miniatur behält `width: 100 %` aus dem
    // Stylesheet und wächst mit der Karte; nur die Auflösung folgt hier nach.
    const h = renderPdfPage(dataUrl, 1, ref.current, breite, false);
    h.promise.catch(() => setFailed(true));
    return () => h.cancel();
  }, [dataUrl, breite]);

  if (failed) return null;
  return (
    <button className="pdf-thumb nodrag" onClick={onOpen} title="PDF-Vorschau öffnen">
      <canvas ref={ref} />
    </button>
  );
}

/**
 * Nutzbare Breite der Viewer-Seite in CSS-Punkten.
 *
 * `window.innerWidth` wäre hier falsch: Das ist ein Schirm-Maß. Die
 * Anzeigegröße (A− / A+, M224) skaliert die Wurzel per CSS `zoom`, damit stehen
 * fürs Layout nur `innerWidth / zoom` Punkte zur Verfügung — bei 175 % auf
 * einem 1920er Schirm also 1097 statt 1920. `document.body.offsetWidth` misst
 * das direkt und ist deshalb die ehrliche Zahl (dieselbe Lehre wie M236).
 * Abgezogen werden die Ränder: 24 Hintergrund- plus 14 Seiten-Polsterung
 * beidseits, dazu etwas Luft für die Bildlaufleiste.
 */
function viewerBreite(): number {
  const voll = document.body.offsetWidth || 900;
  return Math.max(240, Math.min(900, voll - 100));
}

/** Inline-Viewer als Overlay (Portal — React-Flow-Transformationen brechen sonst position:fixed) */
function PdfViewer({ dataUrl, name, onClose, onDownload }: {
  dataUrl: string; name: string; onClose: () => void; onDownload: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const { zoom, rein, raus, einpassen, flaecheRef, griffe, maxZoom } = useLupe();

  const [breite, setBreite] = useState(() => viewerBreite());
  useEffect(() => {
    const nach = () => setBreite(viewerBreite());
    window.addEventListener('resize', nach);
    return () => window.removeEventListener('resize', nach);
  }, []);

  /**
   * M264: Beim Zoomen wird die Seite NEU GERENDERT, nicht gestreckt.
   *
   * Ein Canvas ist ein Bitmap: Zieht man es per CSS auf 300 %, bekommt man
   * dreimal so große Pixel — genau die Unschärfe, gegen die M242 angetreten
   * ist. pdf.js zeichnet die Seite deshalb gleich in der Zielbreite. Die
   * Deckelung bei 5000 Punkten ist die Sicherung nach oben: Mit
   * Geräte-Auflösung und Anzeigezoom (M242) kommen darüber schnell
   * dreistellige Megabyte an Bitmap zusammen.
   */
  const zielBreite = Math.min(5000, Math.round(breite * zoom));
  useEffect(() => {
    if (!ref.current) return;
    const h = renderPdfPage(dataUrl, page, ref.current, zielBreite);
    h.promise.then(setPages).catch(() => {});
    return () => h.cancel();
  }, [dataUrl, page, zielBreite]);

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
            <ZoomKnoepfe {...{ zoom, rein, raus, einpassen, maxZoom }} />
            <button onClick={onDownload} title="Herunterladen"><IDownload size={14} /></button>
            <button onClick={onClose} aria-label="Schließen">✕</button>
          </span>
        </div>
        <div
          className={`pdf-page ${zoom > 1.01 ? 'gezoomt' : ''}`}
          ref={flaecheRef}
          {...griffe}
          title="Doppelklick vergrößert · Strg + Rad zoomt · zwei Finger kneifen"
        ><canvas ref={ref} /></div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Auszug aus einer Textdatei.
 *
 * Bewusst nur der Anfang: Eine 200-MB-Protokolldatei komplett in eine Karte zu
 * legen würde die Ansicht lahmlegen — und beantwortet die Frage „was steckt da
 * drin?" auch nicht besser als die ersten Zeilen. Die ganze Datei gibt es
 * weiterhin per Download.
 */
const AUSZUG_ZEICHEN = 4000;

function TextVorschau({ quelle }: { quelle: string }) {
  const [text, setText] = useState<string | null>(null);
  const [mehr, setMehr] = useState(false);

  useEffect(() => {
    let weg = false;
    void fetch(quelle)
      .then((r) => r.blob())
      .then((b) => b.slice(0, AUSZUG_ZEICHEN * 4).text())
      .then((t) => {
        if (weg) return;
        setText(t.slice(0, AUSZUG_ZEICHEN));
        setMehr(t.length > AUSZUG_ZEICHEN);
      })
      .catch(() => { if (!weg) setText(null); });
    return () => { weg = true; };
  }, [quelle]);

  if (text === null) return null;
  return (
    <div className="file-text nodrag">
      <pre>{text}</pre>
      {mehr && <div className="file-text-mehr">… weiter geht es in der Datei selbst (Download)</div>}
    </div>
  );
}
