import { useMemo } from 'react';
import { extractEntities, type EntityHit } from '../../lib/entities';
import { detectDates, downloadIcs, formatDue, useFristenStand, type DetectedDate } from '../../lib/dates';
import { useRufnummernStand } from '../../lib/rufnummer';
import { sichererVerweis } from '../../lib/sicher';
import { fristAlsAufgabe } from '../../lib/bildTextAufgabe';
import { useBoard } from '../../store';
import { ICalendar, ILink, IMail, ITelefon, ITasks } from '../Icons';

/**
 * M465: Angaben aus dem Text im Bild (M452) — Telefonnummern, E-Mail-Adressen, Web-Adressen, Fristen — als dezente
 * Chips unter dem markierten Bild. Dieselben Helfer wie bei Notizen (Smart Layer: entities.tsx, dates.ts), damit
 * eine Rufnummer im Screenshot genauso erkannt wird wie im Notiztext.
 *
 * Ruhig: Die Chips erscheinen nur am markierten Bild (die Karten rendern sie nur mit `selected`), in Ruhe steht
 * nichts zusätzlich da. Außerdem stehen sie in den Listen „Bedienung nur im Fokus" (index.css, M421).
 *
 * Fristen aus Bildern kommen bewusst NICHT von selbst in die Aufgaben-Zentrale — die Erkennung ist dafür zu
 * unsicher (ein Rechnungsdatum ist keine Frist). Erst der Klick „als Aufgabe" legt ein Ticket an.
 */

/** Höchstens so viele Chips — mehr wäre unter einem Bild unruhig */
const MAX_ANGABEN = 4;
const MAX_FRISTEN = 2;

/** „www.beispiel.de" ohne Schema ist auf Screenshots häufig — für die Erkennung als Web-Adresse ergänzen */
const mitSchema = (text: string): string => text.replace(/(^|[\s(<"„])(www\.[\w-]+\.[\w.-]+)/gi, '$1https://$2');

export interface BildAngaben { angaben: EntityHit[]; fristen: DetectedDate[] }

export function bildAngaben(ocr: string, jetzt = new Date()): BildAngaben {
  if (!ocr.trim()) return { angaben: [], fristen: [] };
  const angaben = extractEntities(mitSchema(ocr))
    // Web-Adressen und Mails nur, wenn die sichere Link-Logik sie durchlässt (http/https/mailto/tel)
    .filter((e) => sichererVerweis(e.href) !== null)
    .slice(0, MAX_ANGABEN);
  // Ein Termin, der schon vorbei ist, wird keine Frist mehr — auf alten Belegen stünde sonst „überfällig!"
  const fristen = detectDates(ocr, jetzt).filter((d) => d.urgency !== 'overdue').slice(0, MAX_FRISTEN);
  return { angaben, fristen };
}

export function BildTextChips({ nodeId, ocr, titel }: { nodeId: string; ocr: string; titel: string }) {
  const boardId = useBoard((s) => s.activeId);
  const showToast = useBoard((s) => s.showToast);
  // M459: Fristen- und Rufnummern-Erkennung laden bei Bedarf — danach neu lesen
  const fristenStand = useFristenStand();
  const rufStand = useRufnummernStand();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { angaben, fristen } = useMemo(() => bildAngaben(ocr), [ocr, fristenStand, rufStand]);
  if (angaben.length === 0 && fristen.length === 0) return null;
  const ICON = { tel: ITelefon, mail: IMail, url: ILink } as const;
  return (
    <div className="due-chips bildtext-chips nodrag nopan" onPointerDown={(e) => e.stopPropagation()}>
      {angaben.map((e) => {
        const Icon = ICON[e.kind];
        const ziel = sichererVerweis(e.href);
        if (!ziel) return null;
        return (
          <a
            key={e.href}
            className={`due-chip ent-chip ent-chip-${e.kind}`}
            translate="no"
            href={ziel}
            target={e.kind === 'url' ? '_blank' : undefined}
            rel="noopener noreferrer"
            title={e.kind === 'tel' ? `${e.display} anrufen` : e.kind === 'mail' ? `E-Mail an ${e.display}` : `${e.href} öffnen`}
          >
            <Icon size={11} /> {e.display}
          </a>
        );
      })}
      {fristen.map((d, i) => (
        <span key={`f${i}`} className="bildtext-frist">
          <button
            className={`due-chip due-${d.urgency}`}
            title={`„${d.label}" im Bild erkannt – Klick erstellt Kalendereintrag (.ics)`}
            onClick={() => {
              downloadIcs(titel || 'Frist aus Bild', d.date);
              showToast('Kalendereintrag erstellt – in Outlook öffnen und speichern');
            }}
          >
            <ICalendar size={11} /> {formatDue(d)}
          </button>
          <button
            className="due-chip bildtext-aufgabe"
            data-taste="bildtext-aufgabe"
            title="Diese Frist als Aufgabe anlegen – erscheint dann in der Aufgaben-Zentrale"
            onClick={() => showToast(fristAlsAufgabe(boardId, nodeId, ocr, d))}
          >
            <ITasks size={11} /> als Aufgabe
          </button>
        </span>
      ))}
    </div>
  );
}
