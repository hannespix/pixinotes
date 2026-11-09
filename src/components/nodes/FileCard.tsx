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
import { blasenAn, blasenSetzen, pdfAufgeklappt, pdfAufklappen, seiteMelden, seitenKommentare } from '../../lib/pdfSeiten';
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
  /** M337: Word-Dokument — Seitenkarte wie die PDF (docx-preview rendert Seiten im Browser) */
  const isWord = ext === 'docx' && !!quelle;
  const istDokument = isPdf || isWord;
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
      <button className="file-body nodrag" onClick={istDokument ? () => aufklappen(!(auf || imFokus)) : quelle ? download : loadFromTeam}
        title={istDokument ? (auf || imFokus ? 'Zuklappen' : 'Aufklappen — Seite für Seite lesen und anmerken') : quelle ? 'Herunterladen' : file.ref ? 'Aus dem Team-Ordner laden' : undefined}>
        <span className="meta">
          {eigenerTitel && <>{file.name} · </>}{formatBytes(file.size)}
          {istDokument && seitenZahl > 0 && <> · {seitenZahl} Seite{seitenZahl === 1 ? '' : 'n'}</>}
          {istDokument && seitenStriche > 0 && <> · ✎ {seitenStriche}</>}
          {istDokument && seitenKommentare > 0 && <> · 💬 {seitenKommentare}</>}
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
      {istDokument && !(auf || imFokus) && (
        <>
          {isPdf && <PdfThumb dataUrl={quelle!} onOpen={() => aufklappen(true)} onSeiten={setSeitenZahl} />}
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
      {isWord && (auf || imFokus) && (
        <WordSeite id={id} quelle={quelle!} onSeiten={setSeitenZahl} onDownload={download}
          zuklappen={imFokus ? undefined : () => aufklappen(false)} />
      )}
      {/* M259: Ton und Bewegtbild kann der Browser selbst — dann soll er auch */}
      {art === 'audio' && quelle && <audio className="file-media nodrag" src={quelle} controls preload="metadata" />}
      {art === 'video' && quelle && <video className="file-media nodrag" src={quelle} controls preload="metadata" />}
      {art === 'text' && quelle && <TextVorschau quelle={quelle} />}
      {/* Ehrlich sagen, WARUM hier nichts zu sehen ist */}
      {art === 'keine' && quelle && !isWord && (
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
 * M336/M337: Gemeinsame Bausteine der Dokument-Karten (PDF und Word).
 * Blätterleiste (‹ Seite / n ›, 💬 Kommentar an Stelle, Herunterladen,
 * Zuklappen) und die Kommentarliste unter der Seite — nummeriert wie die
 * Pins, mit Sprung zu anderen Seiten mit Kommentaren.
 */
function SeitenLeiste({ seite, seiten, blaettern, pinModus, setPinModus, anzahlHier, onDownload, zuklappen }: {
  seite: number; seiten: number; blaettern: (zu: number) => void; pinModus: boolean; setPinModus: (f: (p: boolean) => boolean) => void;
  anzahlHier: number; onDownload: () => void; zuklappen?: () => void;
}) {
  const [eingabe, setEingabe] = useState('');
  return (
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
        title={pinModus ? 'Abbrechen' : 'Kommentar an eine Stelle der Seite setzen — danach auf die Stelle tippen'} aria-pressed={pinModus} aria-label="Kommentar an Stelle">
        💬{anzahlHier > 0 && <span className="pdf-kommentar-zahl" data-taste="pdf-seite-kommentare">{anzahlHier}</span>}
      </button>
      <button onClick={onDownload} title="Herunterladen" aria-label="Herunterladen"><IDownload size={13} /></button>
      {zuklappen && <button onClick={zuklappen} title="Zuklappen" aria-label="Zuklappen" data-taste="pdf-zuklappen"><IX size={13} /></button>}
    </div>
  );
}

function SeitenKommentare({ id, seite, blaettern }: { id: string; seite: number; blaettern: (zu: number) => void }) {
  // Stabile Referenz aus dem Store (ein neues Array je Aufruf ließe die Karte endlos neu rendern)
  const alleKommentare = useBoard((s) => selectActiveBoard(s).comments);
  const kommentare = (alleKommentare ?? []).filter((c) => c.nodeId === id);
  const aufDieserSeite = seitenKommentare(kommentare, id, seite);
  const anderSeiten = [...new Set(kommentare.filter((c) => c.seite != null && c.seite !== seite).map((c) => c.seite as number))].sort((a, b) => a - b);
  const ohneSeite = kommentare.filter((c) => c.seite == null);
  const [blasen, setBlasen] = useState(() => blasenAn());
  const setCommentOpen = useBoard((s) => s.setCommentOpen);
  const offenerThread = useBoard((s) => s.commentOpen);
  if (aufDieserSeite.length === 0 && anderSeiten.length === 0 && ohneSeite.length === 0) return null;
  return (
    <div className="pdf-kommentare nowheel" data-taste="pdf-kommentare">
      <div className="pdf-kommentare-kopf">
        <span>{aufDieserSeite.length === 0 ? 'Keine Kommentare auf dieser Seite' : `Kommentare auf Seite ${seite} (${aufDieserSeite.length})`}</span>
        <button className={blasen ? 'on' : ''} onClick={() => { blasenSetzen(!blasen); setBlasen(!blasen); }} aria-pressed={blasen}
          title="Textblasen neben den Pins auf der Seite ein- oder ausblenden" data-taste="pdf-blasen">Blasen</button>
      </div>
      {aufDieserSeite.map((c, i) => (
        <button key={c.id} className={`pdf-kommentar ${c.resolved ? 'resolved' : ''} ${offenerThread === c.id ? 'open' : ''}`}
          onClick={() => setCommentOpen(c.id)} title="Kommentar öffnen" data-taste="pdf-kommentar-eintrag">
          <span className="pdf-kommentar-nr">{c.resolved ? '✓' : i + 1}</span>
          <span className="pdf-kommentar-text"><b>{c.msgs[0]?.author}</b> {c.msgs[0]?.text}{c.msgs.length > 1 ? ` · ${c.msgs.length} Beiträge` : ''}</span>
        </button>
      ))}
      {anderSeiten.length > 0 && (
        <div className="pdf-kommentare-andere">
          Weitere auf Seite{anderSeiten.length > 1 ? 'n' : ''}{' '}
          {anderSeiten.map((n) => (
            <button key={n} onClick={() => blaettern(n)} title={`Zu Seite ${n} blättern`} data-taste="pdf-kommentar-seite">{n}</button>
          ))}
        </div>
      )}
      {ohneSeite.length > 0 && (
        <div className="pdf-kommentare-andere">
          {ohneSeite.length} an der Karte (ohne Seite){' '}
          <button onClick={() => setCommentOpen(ohneSeite[0].id)} title="Kommentar an der Karte öffnen">öffnen</button>
        </div>
      )}
    </div>
  );
}

/** Anzahl Kommentare der Karte auf dieser Seite — für den Zähler in der Leiste */
function useKommentareAufSeite(id: string, seite: number): number {
  const alle = useBoard((s) => selectActiveBoard(s).comments);
  return seitenKommentare(alle, id, seite).length;
}

/** Lage eines Seiten-Elements in der Karte melden: Versatz über die offsetParent-Kette bis zum Knoten */
function seitenLageMelden(id: string, el: HTMLElement, seite: number, seiten: number, breitePt: number, hoehePt: number, breitePx: number): void {
  const knoten = el.closest('.react-flow__node') as HTMLElement | null;
  if (!knoten || breitePx <= 0 || breitePt <= 0) return;
  let dx = 0; let dy = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== knoten) { dx += cur.offsetLeft; dy += cur.offsetTop; cur = cur.offsetParent as HTMLElement | null; }
  seiteMelden(id, { seite, seiten, dx, dy, k: breitePx / breitePt, breite: breitePt, hoehe: hoehePt });
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
  const [failed, setFailed] = useState(false);
  const anzahlHier = useKommentareAufSeite(id, seite);

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

  const melden = useCallback(() => {
    const canvas = ref.current;
    if (!canvas || !masse) return;
    seitenLageMelden(id, canvas, seite, seiten, masse.breite, masse.hoehe, canvas.clientWidth || breite);
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
      <SeitenLeiste seite={seite} seiten={seiten} blaettern={blaettern} pinModus={pinModus} setPinModus={setPinModus}
        anzahlHier={anzahlHier} onDownload={onDownload} zuklappen={zuklappen} />
      {pinModus && <div className="pdf-pin-hinweis">Auf die Stelle tippen, zu der der Kommentar gehört</div>}
      <div className={`pdf-seite ${pinModus ? 'pin-modus' : ''}`} onClick={aufSeiteTippen} data-seite={seite}>
        <canvas ref={ref} />
      </div>
      <SeitenKommentare id={id} seite={seite} blaettern={blaettern} />
    </div>
  );
}

/**
 * M337: Ein Word-Dokument als Seitenkarte — wie die PDF, nur gerendert aus
 * dem .docx selbst (docx-preview, im Browser). Alle Seiten werden einmal
 * aufgebaut, sichtbar ist genau eine; Seitenpunkte sind die CSS-Punkte (pt)
 * der Word-Seite, so dass Striche und Pins wie bei der PDF an der Stelle
 * bleiben. Ein Dokument ohne Seitenumbrüche ist eine lange Seite.
 */
function WordSeite({ id, quelle, zuklappen, onSeiten, onDownload }: {
  id: string; quelle: string; zuklappen?: () => void; onSeiten?: (n: number) => void; onDownload: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inhaltRef = useRef<HTMLDivElement>(null);
  const stilRef = useRef<HTMLDivElement>(null);
  const [seite, setSeite] = useState(1);
  const [seiten, setSeiten] = useState(1);
  const [status, setStatus] = useState<'laedt' | 'fertig' | 'fehler'>('laedt');
  const [breite, setBreite] = useState(300);
  const [pinModus, setPinModus] = useState(false);
  const [masse, setMasse] = useState<{ breitePt: number; hoehePt: number; breitePx: number } | null>(null);
  const anzahlHier = useKommentareAufSeite(id, seite);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(() => { const w = Math.round(el.clientWidth); if (w > 0) setBreite((alt) => (Math.abs(alt - w) > 6 ? w : alt)); }, 60);
    });
    ro.observe(el);
    const w = Math.round(el.clientWidth);
    if (w > 0) setBreite(w);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  // Dokument einmal rendern (alle Abschnitte/Seiten), danach nur noch blättern
  useEffect(() => {
    let weg = false;
    (async () => {
      try {
        const [{ renderAsync }, blob] = await Promise.all([import('docx-preview'), (await fetch(quelle)).blob()]);
        if (weg || !inhaltRef.current) return;
        inhaltRef.current.innerHTML = '';
        await renderAsync(blob, inhaltRef.current, stilRef.current ?? undefined, {
          inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, useBase64URL: true,
          renderHeaders: true, renderFooters: true, renderFootnotes: true, renderComments: false, className: 'docx',
        });
        if (weg) return;
        const abschnitte = inhaltRef.current.querySelectorAll<HTMLElement>('section.docx');
        setSeiten(Math.max(1, abschnitte.length)); onSeiten?.(Math.max(1, abschnitte.length));
        setStatus('fertig');
      } catch (e) {
        console.warn('Word-Dokument lässt sich nicht darstellen:', e);
        if (!weg) setStatus('fehler');
      }
    })();
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quelle]);

  // Sichtbare Seite setzen, Maßstab an die Kartenbreite anpassen, Lage melden
  const auslegen = useCallback(() => {
    const inhalt = inhaltRef.current;
    if (!inhalt || status !== 'fertig') return;
    const abschnitte = [...inhalt.querySelectorAll<HTMLElement>('section.docx')];
    if (abschnitte.length === 0) return;
    const nr = Math.min(seite, abschnitte.length);
    abschnitte.forEach((a, i) => { a.style.display = i === nr - 1 ? '' : 'none'; });
    const akt = abschnitte[nr - 1];
    // Seitenbreite in CSS-Punkten (Word-Seitenmaß) — ohne Angabe A4
    const breitePt = parseFloat(akt.style.width) || 595.3;
    inhalt.style.transform = 'none';
    const roh = akt.offsetWidth || breitePt * (96 / 72);
    // Die Seite ist mindestens so hoch wie ihr Seitenmaß (min-height in pt) — auch wenn der
    // Browser den Abschnitt gerade erst aufbaut und noch zu klein meldet
    const minHoehePx = (parseFloat(akt.style.minHeight) || 0) * (96 / 72);
    const rohHoehe = Math.max(akt.offsetHeight || 0, minHoehePx) || breitePt * (96 / 72) * 1.414;
    const s = breite / roh;
    inhalt.style.transform = `scale(${s})`;
    inhalt.style.transformOrigin = '0 0';
    inhalt.style.width = `${roh}px`;
    if (wrapRef.current) {
      const seiteEl = wrapRef.current.querySelector<HTMLElement>('.pdf-seite');
      if (seiteEl) seiteEl.style.height = `${Math.round(rohHoehe * s)}px`;
    }
    const hoehePt = rohHoehe * (breitePt / roh);
    setMasse({ breitePt, hoehePt, breitePx: breite });
    const seiteEl = wrapRef.current?.querySelector<HTMLElement>('.pdf-seite');
    if (seiteEl) seitenLageMelden(id, seiteEl, nr, abschnitte.length, breitePt, hoehePt, breite);
  }, [id, seite, status, breite]);
  useEffect(() => {
    auslegen();
    // Zweiter Durchgang, sobald Layout und Schriften stehen — die erste Messung kann zu früh kommen
    const raf = requestAnimationFrame(() => requestAnimationFrame(auslegen));
    const schriften = typeof document !== 'undefined' && 'fonts' in document ? document.fonts.ready.then(() => auslegen()).catch(() => {}) : null;
    void schriften;
    return () => cancelAnimationFrame(raf);
  }, [auslegen]);
  useEffect(() => () => seiteMelden(id, null), [id]);
  useEffect(() => {
    const knoten = wrapRef.current?.closest('.react-flow__node');
    if (!knoten || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => auslegen());
    ro.observe(knoten);
    return () => ro.disconnect();
  }, [auslegen]);

  const blaettern = (zu: number) => { setSeite(Math.min(seiten, Math.max(1, zu))); setPinModus(false); };
  const aufSeiteTippen = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinModus || !masse) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * masse.breitePt;
    const py = ((e.clientY - r.top) / r.height) * masse.hoehePt;
    setPinModus(false);
    useBoard.getState().setCommentOpen(`new:${id}`, { seite, px: Math.round(px * 10) / 10, py: Math.round(py * 10) / 10 });
  };

  if (status === 'fehler') return <div className="file-nopreview">Dieses Word-Dokument lässt sich nicht darstellen — „Als Notiz übernehmen" (Auswahl → ⋯) holt den Text.</div>;
  return (
    <div className="pdf-seite-wrap nodrag" ref={wrapRef} data-taste="pdf-seite-wrap" data-art="word">
      <SeitenLeiste seite={seite} seiten={seiten} blaettern={blaettern} pinModus={pinModus} setPinModus={setPinModus}
        anzahlHier={anzahlHier} onDownload={onDownload} zuklappen={zuklappen} />
      {pinModus && <div className="pdf-pin-hinweis">Auf die Stelle tippen, zu der der Kommentar gehört</div>}
      <div className={`pdf-seite word-seite ${pinModus ? 'pin-modus' : ''}`} onClick={aufSeiteTippen} data-seite={seite}>
        {status === 'laedt' && <div className="word-laedt">Dokument wird aufgebaut …</div>}
        <div ref={stilRef} className="word-stile" />
        <div ref={inhaltRef} className="word-inhalt" />
      </div>
      <SeitenKommentare id={id} seite={seite} blaettern={blaettern} />
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
