import { useCallback, useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { mutedHistory, selectActiveBoard, useBoard } from '../../store';
import type { FileNode } from '../../types';
import { formatBytes, MAX_EMBED_BYTES } from '../../lib/parseEmail';
import { triggerDownload } from '../../lib/download';
import { readFileAsDataUrl } from '../../lib/image';
import { canEmbed } from '../../lib/nodes';
import { loadAttachment } from '../../lib/attachments';
import { pdfSeiteMasse, renderPdfPage } from '../../lib/pdf';
import { pdfAufgeklappt, pdfAufklappen, seiteMelden } from '../../lib/pdfSeiten';
import { loadFile, saveFile, vorschauArt, warumKeineVorschau } from '../../lib/fileStore';
import { kontoDateiNachladen } from '../../lib/kontoSync';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { BildLupe } from './BildLupe';
import { IDownload, IX } from '../Icons';

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
  const [kontoLaedt, setKontoLaedt] = useState(false);
  useEffect(() => {
    if (file.dataUrl) return;
    let url: string | null = null;
    let weg = false;
    void loadFile(id).then(async (b) => {
      if (weg) return;
      // M329: Nicht hier, aber im PixiNotes-Konto? Dann jetzt holen (große Anhänge reisen erst beim Öffnen)
      if (!b) {
        setKontoLaedt(true);
        try { b = (await kontoDateiNachladen(id)) ?? undefined; } catch { b = undefined; }
        setKontoLaedt(false);
      }
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
  /**
   * M335: PDF zugeklappt oder aufgeklappt. Zugeklappt (Standard) zeigt die
   * Karte die erste Seite klein, Seitenzahl und Anmerkungszähler; aufgeklappt
   * genau EINE Seite in Kartenbreite mit Blätterleiste — Stift, Textmarker
   * und Kommentar-Pins liegen dann seitenbezogen darauf. Der Zustand ist
   * Geräte-Ansicht (localStorage), kein Inhalt: Er wandert nicht in den Sync.
   * Im Fokus ist die Karte immer aufgeklappt.
   */
  const [auf, setAuf] = useState(() => pdfAufgeklappt(id));
  const imFokus = useBoard((s) => s.focusCard === id);
  const seitenStriche = useBoard((s) => (selectActiveBoard(s).drawings ?? []).reduce((n, d) => n + (d.anchor === id && d.seite != null ? 1 : 0), 0));
  const seitenKommentare = useBoard((s) => (selectActiveBoard(s).comments ?? []).reduce((n, c) => n + (c.nodeId === id ? 1 : 0), 0));
  const [seitenZahl, setSeitenZahl] = useState(0);
  const aufklappen = useCallback((wert: boolean) => {
    setAuf(wert);
    pdfAufklappen(id, wert);
    if (wert) {
      // Eine Seite in 240 Punkten ist zu klein zum Lesen — die Karte wird auf 420 verbreitert (nur, wenn sie schmaler ist)
      mutedHistory(() => useBoard.setState((st) => ({
        boards: st.boards.map((b) => (b.id === st.activeId
          ? { ...b, nodes: b.nodes.map((n) => (n.id === id && ((n.width as number | undefined) ?? 0) < 420 ? { ...n, width: 420 } : n)) }
          : b)),
      })));
    }
  }, [id]);
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
        showToast('Im Team-Ordner nicht gefunden. Ist der Ordner verbunden?');
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
      <button className="file-body nodrag" onClick={isPdf ? () => aufklappen(!(auf || imFokus)) : quelle ? download : loadFromTeam}
        title={isPdf ? (auf || imFokus ? 'Zuklappen' : 'Aufklappen — Seite für Seite lesen und anmerken') : quelle ? 'Herunterladen' : file.ref ? 'Aus dem Team-Ordner laden' : undefined}>
        <span className="meta">
          {eigenerTitel && <>{file.name} · </>}{formatBytes(file.size)}
          {isPdf && seitenZahl > 0 && <> · {seitenZahl} Seite{seitenZahl === 1 ? '' : 'n'}</>}
          {isPdf && seitenStriche > 0 && <> · ✎ {seitenStriche}</>}
          {isPdf && seitenKommentare > 0 && <> · 💬 {seitenKommentare}</>}
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
      {isPdf && !(auf || imFokus) && (
        <>
          <PdfThumb dataUrl={quelle!} onOpen={() => aufklappen(true)} onSeiten={setSeitenZahl} />
          <button className="pdf-aufklappen nodrag" onClick={() => aufklappen(true)} data-taste="pdf-aufklappen"
            title="Aufklappen: eine Seite in Kartenbreite, blättern, mit Stift und Kommentaren anmerken">
            ⤢ Aufklappen{seitenStriche + seitenKommentare > 0 ? ` · ${seitenStriche + seitenKommentare} Anmerkung${seitenStriche + seitenKommentare === 1 ? '' : 'en'}` : ''}
          </button>
        </>
      )}
      {isPdf && (auf || imFokus) && (
        <PdfSeite id={id} dataUrl={quelle!} onSeiten={setSeitenZahl} onDownload={download}
          zuklappen={imFokus ? undefined : () => aufklappen(false)} />
      )}
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
          {kontoLaedt ? 'Wird gerade aus dem PixiNotes-Konto geladen … ' : ''}Der Inhalt liegt nicht auf diesem Gerät. Dateien werden bis zur eingestellten
          Obergrenze mitsynchronisiert (⚙ → Daten → Synchronisation); diese hier ist mit
          {' '}{formatBytes(file.size)} entweder größer oder wurde vor dieser Neuerung eingefügt.
          Auf dem Gerät mit der Datei einmal speichern — oder sie hier erneut einfügen.
        </div>
      )}
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
function PdfThumb({ dataUrl, onOpen, onSeiten }: { dataUrl: string; onOpen: () => void; onSeiten?: (n: number) => void }) {
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
    let aktiv = true;
    const h = renderPdfPage(dataUrl, 1, ref.current, breite, false);
    // Ein abgebrochener Render (neue Breite kam dazwischen) ist kein Fehler
    h.promise.then((n) => { if (aktiv) onSeiten?.(n); }).catch(() => { if (aktiv) setFailed(true); });
    return () => { aktiv = false; h.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl, breite]);

  if (failed) return null;
  return (
    <button className="pdf-thumb nodrag" onClick={onOpen} title="Aufklappen — Seite für Seite lesen und anmerken">
      <canvas ref={ref} />
    </button>
  );
}

/**
 * M335: Eine Seite der PDF in der Karte — aufgeklappt.
 *
 * Gerendert wird genau die aufgeschlagene Seite in Kartenbreite (scharf, s.
 * M242); beim Blättern wechselt nur die Seite, die Karte bleibt so hoch wie
 * eine Seite. Nach jedem Rendern meldet die Karte, wo die Seite in ihr liegt
 * (pdfSeiten.ts) — Zeichen- und Kommentar-Ebene legen die seitenbezogenen
 * Anmerkungen dann exakt darüber. 💬 setzt einen Kommentar an eine STELLE
 * der Seite: nächster Tipp auf die Seite öffnet die Blase dort.
 */
function PdfSeite({ id, dataUrl, zuklappen, onSeiten, onDownload }: {
  id: string; dataUrl: string; zuklappen?: () => void; onSeiten?: (n: number) => void; onDownload: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [seite, setSeite] = useState(1);
  const [seiten, setSeiten] = useState(1);
  const [masse, setMasse] = useState<{ breite: number; hoehe: number } | null>(null);
  const [breite, setBreite] = useState(300);
  const [pinModus, setPinModus] = useState(false);
  const [eingabe, setEingabe] = useState('');
  const [failed, setFailed] = useState(false);

  // Kartenbreite verfolgen — entprellt, wie bei der Miniatur (M242)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const w = Math.round(el.clientWidth);
        if (w > 0) setBreite((alt) => (Math.abs(alt - w) > 6 ? w : alt));
      }, 150);
    });
    ro.observe(el);
    const w = Math.round(el.clientWidth);
    if (w > 0) setBreite(w);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    let weg = false;
    pdfSeiteMasse(dataUrl, seite).then((m) => {
      if (weg) return;
      setSeiten(m.seiten); setMasse({ breite: m.breite, hoehe: m.hoehe }); onSeiten?.(m.seiten);
    }).catch(() => setFailed(true));
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl, seite]);

  /** Lage der Seite in der Karte melden: Versatz über die offsetParent-Kette bis zum Knoten, Maßstab aus der Breite */
  const melden = useCallback(() => {
    const canvas = ref.current;
    if (!canvas || !masse) return;
    const knoten = canvas.closest('.react-flow__node') as HTMLElement | null;
    if (!knoten) return;
    let dx = 0; let dy = 0;
    let el: HTMLElement | null = canvas;
    while (el && el !== knoten) { dx += el.offsetLeft; dy += el.offsetTop; el = el.offsetParent as HTMLElement | null; }
    const w = canvas.clientWidth || breite;
    if (w <= 0) return;
    seiteMelden(id, { seite, seiten, dx, dy, k: w / masse.breite, breite: masse.breite, hoehe: masse.hoehe });
  }, [id, seite, seiten, masse, breite]);

  useEffect(() => {
    if (!ref.current) return;
    let aktiv = true;
    const h = renderPdfPage(dataUrl, seite, ref.current, breite, true);
    // Ein abgebrochener Render (Blättern oder neue Breite kam dazwischen) ist kein Fehler
    h.promise.then(() => { if (aktiv) melden(); }).catch(() => { if (aktiv) setFailed(true); });
    return () => { aktiv = false; h.cancel(); };
  }, [dataUrl, seite, breite, melden]);
  // Beim Zuklappen/Abbauen: keine offene Seite mehr — Anmerkungen verschwinden, der Zähler bleibt
  useEffect(() => () => seiteMelden(id, null), [id]);
  // Kopfzeile oder Titel ändern die Lage der Seite in der Karte — nachmelden
  useEffect(() => {
    const knoten = ref.current?.closest('.react-flow__node');
    if (!knoten || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => melden());
    ro.observe(knoten);
    return () => ro.disconnect();
  }, [melden]);

  const blaettern = (zu: number) => { setSeite(Math.min(seiten, Math.max(1, zu))); setPinModus(false); };
  const aufSeiteTippen = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinModus || !masse || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * masse.breite;
    const py = ((e.clientY - r.top) / r.height) * masse.hoehe;
    setPinModus(false);
    useBoard.getState().setCommentOpen(`new:${id}`, { seite, px: Math.round(px * 10) / 10, py: Math.round(py * 10) / 10 });
  };

  if (failed) return <div className="file-nopreview">Diese PDF lässt sich nicht darstellen.</div>;
  return (
    <div className="pdf-seite-wrap nodrag" ref={wrapRef} data-taste="pdf-seite-wrap">
      <div className="pdf-seite-bar nowheel">
        <button onClick={() => blaettern(seite - 1)} disabled={seite <= 1} aria-label="Vorherige Seite" data-taste="pdf-zurueck">‹</button>
        <input
          className="pdf-seite-nr" inputMode="numeric" aria-label="Seite" data-taste="pdf-seite-nr"
          value={eingabe || String(seite)}
          onFocus={() => setEingabe(String(seite))}
          onChange={(e) => setEingabe(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => { const z = parseInt(eingabe, 10); if (z) blaettern(z); setEingabe(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <span className="pdf-seite-von">/ {seiten}</span>
        <button onClick={() => blaettern(seite + 1)} disabled={seite >= seiten} aria-label="Nächste Seite" data-taste="pdf-vor">›</button>
        <span className="pdf-seite-luft" />
        <button className={pinModus ? 'on' : ''} onClick={() => setPinModus((p) => !p)} data-taste="pdf-kommentar"
          title={pinModus ? 'Abbrechen' : 'Kommentar an eine Stelle der Seite setzen — danach auf die Stelle tippen'} aria-pressed={pinModus} aria-label="Kommentar an Stelle">💬</button>
        <button onClick={onDownload} title="Herunterladen" aria-label="Herunterladen"><IDownload size={13} /></button>
        {zuklappen && <button onClick={zuklappen} title="Zuklappen" aria-label="Zuklappen" data-taste="pdf-zuklappen"><IX size={13} /></button>}
      </div>
      {pinModus && <div className="pdf-pin-hinweis">Auf die Stelle tippen, zu der der Kommentar gehört</div>}
      <div className={`pdf-seite ${pinModus ? 'pin-modus' : ''}`} onClick={aufSeiteTippen} data-seite={seite}>
        <canvas ref={ref} />
      </div>
    </div>
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
