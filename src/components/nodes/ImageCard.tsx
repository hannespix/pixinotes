import { useEffect, useState, type SyntheticEvent } from 'react';
import type { NodeProps } from '@xyflow/react';
import { runDerived, selectActiveBoard, useBoard, useKarteFest } from '../../store';
import { triggerDownload } from '../../lib/download';
import type { ImageNode } from '../../types';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { BildLupe, BildTextChips, bildTeileVorladen } from './bildSpaet';   // M519: nachgeladen
import { bildBearbeiten } from '../BildEditorHost';
import { ICrop, IImage } from '../Icons';

/**
 * Screenshot / Bild als Karte (per Strg+V, Drag&Drop oder aus E-Mail-Anhang).
 *
 * M263: Mit eigenem Titel. „Bildschirmfoto 2026-08-12 um 10.14.32.png" ist
 * kein Name, sondern ein Zeitstempel — die Karte lässt sich per Doppelklick
 * benennen. Die Zeile erscheint, sobald es etwas zu zeigen gibt oder die Karte
 * ausgewählt ist; ein unbenannter Screenshot bleibt sonst ein reines Bild.
 *
 * M264: Und sie lässt sich groß ansehen. ⤢ öffnet die Lupe — bewusst ein
 * eigener Knopf statt „Klick aufs Bild": Ein Klick wählt die Karte aus und
 * fliegt sie (M74) an; das darf eine Vorschau nicht kapern.
 *
 * M374: Rahmenlos. Ein Bild ist kein Formular — die Karte IST das Bild: kein Rand, keine Fläche, kein
 * Schatten, Durchsichtiges bleibt durchsichtig. Rahmen, Griffe, Lupe und Name erscheinen erst, wenn das
 * Bild markiert ist; ein selbst vergebener Name steht als Bildunterschrift darunter (außerhalb der
 * Karte, er verändert ihre Maße nicht). An den Griffen bleibt das Seitenverhältnis. Wer die Karte mit
 * Rand zurückwill: ⋯ → „Mit Rahmen".
 */
export function ImageCard({ id, data, selected }: NodeProps<ImageNode>) {
  const img = data;
  const titel = img.titel?.trim() || img.name || '';
  const [lupe, setLupe] = useState(false);
  useEffect(() => bildTeileVorladen(), []);
  const fest = useKarteFest((img as { von?: string }).von);
  const rahmen = img.rahmen === true;
  /* Ältere Bild-Karten tragen eine von Hand gezogene Höhe, in der noch Rand und Namenszeile stecken —
     rahmenlos stünde das Bild dann mit leeren Streifen in seiner Auswahl. Einmal an das Bild anlegen. */
  const anlegen = (e: SyntheticEvent<HTMLImageElement>) => {
    if (rahmen) return;
    const el = e.currentTarget;
    if (!(el.naturalWidth > 0 && el.naturalHeight > 0)) return;
    const s = useBoard.getState();
    if (s.focusCard === id) return;
    const n = selectActiveBoard(s)?.nodes.find((k) => k.id === id);
    if (!n || typeof n.height !== 'number' || typeof n.width !== 'number') return;
    const ziel = Math.max(8, Math.round(n.width * el.naturalHeight / el.naturalWidth));
    if (Math.abs(ziel - n.height) > 2) runDerived(() => s.setNodeHeight(id, ziel));
  };
  const name = (
    <div className={`meta img-name${rahmen ? '' : ' unterschrift'}`}>
      <IImage size={13} />
      <DragTitle
        className="img-titel"
        value={titel}
        placeholder="Bild benennen"
        onChange={(v) => {
          const neu = v.trim();
          useBoard.getState().updateNodeData(id, { titel: neu && neu !== img.name ? neu : undefined });
        }}
      />
    </div>
  );
  /* M465: Angaben aus dem Text im Bild (Telefon, Mail, Link, Frist) — nur am markierten Bild, unter ihm. */
  const ocr = selected && typeof img.ocrText === 'string' ? img.ocrText : '';
  const chips = ocr ? <BildTextChips nodeId={id} ocr={ocr} titel={titel} /> : null;
  const unterName = !rahmen && (img.titel?.trim() || selected) ? name : undefined;
  return (
    <CardShell
      id={id}
      /* Rahmenlos steht der Name UNTER dem Bild und außerhalb des Kartenkörpers — sonst hielte ihn die
         Auto-Größe für Inhalt, der nicht hineinpasst, und zöge die Karte in die Länge. */
      aussen={chips ? <div className="bild-unten">{unterName}{chips}</div> : unterName}
      selected={selected}
      minWidth={rahmen ? 120 : 24}
      minHeight={rahmen ? 90 : 24}
      seitenverhaeltnis={!rahmen}
      ruhig={!rahmen}
      className={`image-card ${rahmen ? 'mit-rahmen' : 'rahmenlos'}`}
    >
      <img src={img.src} alt={titel || 'Bild'} draggable={false} onLoad={anlegen} />
      {/* M395: zuschneiden, drehen, … — erscheint wie die Lupe erst am markierten Bild */}
      {!fest && (
        <button
          className="bild-bearbeiten-auf nodrag"
          data-taste="bild-bearbeiten-auf"
          title="Bild bearbeiten – zuschneiden, drehen, gerade richten"
          aria-label="Bild bearbeiten"
          onClick={(e) => { e.stopPropagation(); bildBearbeiten(id); }}
        ><ICrop size={14} /></button>
      )}
      <button
        className="bild-lupe-auf nodrag"
        title="Groß ansehen und zoomen"
        aria-label="Bild groß ansehen"
        onClick={(e) => { e.stopPropagation(); setLupe(true); }}
      >⤢</button>
      {rahmen && (titel || selected) && name}
      {lupe && (
        <BildLupe
          quelle={img.src}
          name={titel || 'Bild'}
          onClose={() => setLupe(false)}
          onDownload={() => triggerDownload(img.src, img.name || `${titel || 'bild'}.png`)}
        />
      )}
    </CardShell>
  );
}
