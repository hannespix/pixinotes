import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import { SuggestionMenuController, useBlockNoteEditor, useCreateBlockNote, useExtension, type DefaultReactSuggestionItem, type SuggestionMenuProps } from '@blocknote/react';
import { SuggestionMenu } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import type { PartialBlock } from '@blocknote/core';
import { de as blockNoteDe, en as blockNoteEn } from '@blocknote/core/locales';
import { sprache, t, zahlWort } from '../../lib/sprache';
import { mutedHistory, useBoard, useNurLesen } from '../../store';
import { STICKY_COLORS, uid, type MinutesData, type MinutesEntry, type MinutesNode } from '../../types';
import {
  allDecisions, anwesenheit, aufgabenStand, currentEntry, entryLabel, fristText, kurzDatum, langDatum,
  nextDate, offeneAufgaben, papierArt, sitzungAlsText, sortEntries, suchNorm, sucheInReihe, tagesordnung, teilnehmende,
  teilnehmendeText, type OffeneAufgabe,
} from '../../lib/minutes';
import {
  dateiName, erwaehnung, mailAdresse, nachMonat, neueSitzung, sitzungAlsHtml, sitzungAlsMarkdown, uebergabeVorschlag,
  unbekanntePersonen, type UebergabePunkt,
} from '../../lib/protokollSchliff';
import { triggerDownload } from '../../lib/download';
import { overlayOffen } from '../../lib/overlay';
import { toggleCheckBlock } from '../../lib/tasks';
import { fristenLaden, useFristenStand } from '../../lib/dates';
import { repairBlocks } from '../../lib/htmlBlocks';
import { useAndroidBackspaceFix } from '../../lib/blocknoteAndroidFix';
import { editorUpload } from '../../lib/notizBild';
import { importFilesToBoard } from '../../lib/importSpaet';
import { NoteSlashMenu, NoteToolbar, noteSchema, useNurBilderInDenText } from '../NoteTypo';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { ICheck, ICopy, IDownload, IDrucker, IMail, IMore, IPlus, ISearch, ISettings, ITrash, IUsers, IX } from '../Icons';
import type { NotizSitzung } from '../../lib/notizGemeinsamKern';
import { liveVerbunden, TEILNEHMER_EREIGNIS } from '../../lib/liveStand';
import { PROTOKOLL_LIVE, protokollLive, type ProtokollLive } from '../../lib/protokollLive';
import { useTakt } from '../LiveLeiste';
import { NotizRuhend } from './NotizRuhend';
import type { RuheBlock } from '../../lib/notizRuhend';

/**
 * Protokoll-Reihe (M186, neu gedacht in M489): eine Karte für eine ganze Besprechungsserie.
 *
 * Zwei Ansichten, umgeschaltet im Kopf:
 *  · „Sitzung" — die Sitzungsleiste (neueste zuerst, „+" legt die nächste an), Kopf der Sitzung (Datum, Titel,
 *    Runde), Tagesordnung als Sprungmarken, der Protokolltext und die Beschlüsse dieser Sitzung. Drei Werkzeuge
 *    markieren die Zeile, in der der Cursor steht: als TOP, als Aufgabe (Checklisten-Punkt), als Beschluss.
 *  · „Übersicht" — was über die ganze Reihe zählt: offene Aufgaben nach Person mit Frist, die Beschlusslage, die
 *    Teilnahme und eine Suche über alle Sitzungen.
 *
 * Das Datenmodell ist unverändert (entries[].blocks/decisions/attendees) — Aufgaben SIND die Checklisten-Punkte
 * im Text, Person („Anna: …", „@Anna") und Frist („bis Freitag") stehen darin. So lesen Zentrale, Wiedervorlage,
 * KI, Export und MCP alles wie bisher, und alte Protokolle brauchen keine Umwandlung.
 *
 * Der Editor wird bei jedem Sitzungswechsel neu aufgebaut (key={entry.id}): BlockNote liest seinen Inhalt nur
 * beim Mount, sonst zeigte das Blättern hartnäckig die vorige Sitzung.
 */
export function MinutesCard({ id, data, selected }: NodeProps<MinutesNode>) {
  const m = data as MinutesData;
  return (
    <CardShell
      id={id}
      selected={selected}
      minWidth={320}
      minHeight={300}
      className={`minutes-card sticky-${m.color ?? 'white'} papier-${papierArt(m)}`}
      style={m.hex ? { background: m.hex } : undefined}
    >
      <MinutesBody id={id} data={data} />
    </CardShell>
  );
}

/** M489: Was die Werkzeuge vom lebenden Editor der angezeigten Sitzung brauchen */
interface EditorBlock { id: string; type: string; content?: unknown; children?: EditorBlock[] }
interface LebenderEditor {
  document: EditorBlock[];
  insertBlocks: (b: unknown[], ref: unknown, pos: 'before' | 'after') => unknown;
  updateBlock: (ref: unknown, upd: unknown) => unknown;
  removeBlocks: (refs: unknown[]) => unknown;
  getTextCursorPosition: () => { block: EditorBlock };
  setTextCursorPosition: (ref: unknown, place?: 'start' | 'end') => void;
  focus: () => void;
}

const inhaltText = (c: unknown): string => (typeof c === 'string'
  ? c
  : Array.isArray(c) ? c.map((s) => (s as { text?: string })?.text ?? '').join('') : '');

type Ansicht = 'sitzung' | 'uebersicht';
/** M495: höchstens so viele Sitzungen stehen in der Leiste, der Rest unter „Ältere …“ */
const LEISTE_MAX = 8;

/**
 * M493: Ist diese Sitzung gerade gemeinsam geöffnet (Live-Board, ProtokollGemeinsam)? Dann laufen die Beschlüsse über
 * das Y-Dokument — gezeigt, geändert und vom Schreiber gesichert —, nicht über den Speicher.
 */
function useProtokollLive(schluessel: string | null): ProtokollLive | null {
  const [, neu] = useReducer((x: number) => x + 1, 0);
  const live = schluessel ? protokollLive(schluessel) : null;
  useEffect(() => {
    const auf = (e: Event) => { if ((e as CustomEvent<string>).detail === schluessel) neu(); };
    window.addEventListener(PROTOKOLL_LIVE, auf);
    return () => window.removeEventListener(PROTOKOLL_LIVE, auf);
  }, [schluessel]);
  useEffect(() => live?.beiBeschluessen(() => neu()), [live]);
  return live;
}

/** M380: Der Inhalt ohne Kartenhülle — derselbe auf dem Board und als Folie in der Präsentation */
export function MinutesBody({ id, data }: { id: string; data: MinutesData }) {
  const m = data as MinutesData;
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const nurLesen = useNurLesen();
  const [ansicht, setAnsicht] = useState<Ansicht>('sitzung');
  const [setupOpen, setSetupOpen] = useState(false);
  const [menueOffen, setMenueOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const [beschlussText, setBeschlussText] = useState('');
  const [personText, setPersonText] = useState('');
  // M495: Übergabe an die nächste Sitzung (null = zu), abgelehnte Personen-Vorschläge („Sitzung:name")
  const [uebergabe, setUebergabe] = useState<{ punkte: UebergabePunkt[]; gewaehlt: Set<string>; datum: string } | null>(null);
  const [abgelehnt, setAbgelehnt] = useState<Set<string>>(() => new Set());
  // M187: Zugriff auf den LEBENDEN Editor der angezeigten Sitzung. Werkzeuge ändern über ihn statt über den
  // Speicher — sonst überholt der Editor beim nächsten Neuaufbau die Änderung mit seinem alten Stand.
  const editorRef = useRef<LebenderEditor | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const beschlussFeld = useRef<HTMLTextAreaElement>(null);
  const leisteRef = useRef<HTMLDivElement>(null);
  const fristen = useFristenStand();
  useEffect(() => { void fristenLaden(); }, []);

  const sorted = useMemo(() => sortEntries(m.entries ?? []), [m.entries]);
  const entry = currentEntry(m);
  const offen = useMemo(() => offeneAufgaben(m), [m, fristen]);   // eslint-disable-line react-hooks/exhaustive-deps
  const beschluesse = useMemo(() => allDecisions(m), [m]);

  const patch = (next: Partial<MinutesData>) => updateNodeData(id, next);
  const patchEntry = (entryId: string, next: Partial<MinutesEntry>) =>
    patch({ entries: (m.entries ?? []).map((e) => (e.id === entryId ? { ...e, ...next } : e)) });
  const boardId = useBoard((s) => s.activeId);
  // M493: Beschlüsse der gezeigten Sitzung — gemeinsam aus dem Y-Dokument, sonst aus dem Speicher
  const live = useProtokollLive(entry ? `${id}:${entry.id}` : null);
  const sitzungsBeschluesse = live ? live.beschluesse() : (entry?.decisions ?? []);
  const beschlussDazu = (text: string) => {
    if (!entry) return;
    if (live) live.beschlussDazu(text);
    else patchEntry(entry.id, { decisions: [...(entry.decisions ?? []), { id: uid(), text }] });
  };
  const beschlussSetzen = (bid: string, text: string | null) => {
    if (!entry) return;
    if (live) { live.beschlussSetzen(bid, text); return; }
    const alt = entry.decisions ?? [];
    patchEntry(entry.id, { decisions: text === null ? alt.filter((x) => x.id !== bid) : alt.map((x) => (x.id === bid ? { ...x, text } : x)) });
  };
  const zeige = (entryId: string) => { patch({ current: entryId }); setAnsicht('sitzung'); setMenueOffen(false); };

  /**
   * Neue Sitzung: Runde, offene Aufgaben und (M495) TOPs ohne Beschluss der letzten übernehmen, Tagesordnung
   * vorstrukturieren. Gibt es etwas zu übernehmen, zeigt „+" erst die Übergabe — alles angehakt, abwählbar.
   */
  const addEntry = () => {
    setMenueOffen(false);
    const vorschlag = uebergabeVorschlag(m);
    if (vorschlag.length === 0) { anlegen(new Set(), nextDate(m)); return; }
    setUebergabe({ punkte: vorschlag, gewaehlt: new Set(vorschlag.map((p) => p.key)), datum: nextDate(m) });
  };
  const anlegen = (gewaehlt: Set<string>, datum: string) => {
    const date = datum || nextDate(m);
    const fresh = neueSitzung(m, date, gewaehlt);
    const vorschlag = uebergabeVorschlag(m).filter((p) => gewaehlt.has(p.key));
    const aufgaben = vorschlag.filter((p) => p.art === 'aufgabe').length;
    const tops = vorschlag.filter((p) => p.art === 'top').length;
    const personen = teilnehmende(fresh.attendees).length;
    patch({ entries: [...(m.entries ?? []), fresh], current: fresh.id });
    setUebergabe(null);
    setAnsicht('sitzung');
    const dazu = [
      personen ? zahlWort(personen, 'Person', 'Personen') : '',
      aufgaben ? zahlWort(aufgaben, 'offene Aufgabe', 'offene Aufgaben') : '',
      tops ? zahlWort(tops, 'offener TOP', 'offene TOPs') : '',
    ].filter(Boolean);
    const liste = dazu.length ? new Intl.ListFormat(sprache() === 'en' ? 'en-GB' : 'de-DE', { type: 'conjunction' }).format(dazu) : '';
    showToast(liste
      ? `Sitzung am ${langDatum(date)} angelegt – übernommen: ${liste}.`
      : `Sitzung am ${langDatum(date)} angelegt.`);
  };

  const removeEntry = (entryId: string) => {
    setMenueOffen(false);
    const e = (m.entries ?? []).find((x) => x.id === entryId);
    if (e && !window.confirm(`Sitzung „${entryLabel(e)}" mit ihrem gesamten Protokoll löschen?`)) return;
    const rest = (m.entries ?? []).filter((x) => x.id !== entryId);
    patch({ entries: rest, current: sortEntries(rest)[0]?.id });
  };

  // ---------- Werkzeuge: die Zeile am Cursor markieren ----------
  const imText = () => !!textRef.current?.contains(document.activeElement);
  /** Block am Cursor — oder null, wenn der Cursor nicht im Protokolltext steht */
  const blockAmCursor = (): EditorBlock | null => {
    const ed = editorRef.current;
    if (!ed || !imText()) return null;
    try { return ed.getTextCursorPosition().block; } catch { return null; }
  };
  /** Neuer Block am Ende, Cursor hinein */
  const anhaengen = (block: Record<string, unknown>) => {
    const ed = editorRef.current;
    if (!ed || !entry) return;
    try {
      const letzter = ed.document[ed.document.length - 1];
      const leer = letzter && letzter.type === 'paragraph' && !inhaltText(letzter.content).trim();
      if (leer) ed.updateBlock(letzter, block);
      else ed.insertBlocks([block], letzter, 'after');
      const ziel = ed.document[ed.document.length - 1];
      ed.setTextCursorPosition(ziel, 'end');
      ed.focus();
    } catch { /* Editor gerade im Umbau */ }
  };
  const alsTop = () => {
    const ed = editorRef.current;
    const b = blockAmCursor();
    if (ed && b) {
      try { ed.updateBlock(b, b.type === 'heading' ? { type: 'paragraph' } : { type: 'heading', props: { level: 3 } }); } catch { /* egal */ }
      return;
    }
    anhaengen({ type: 'heading', props: { level: 3 }, content: '' });
  };
  const alsAufgabe = () => {
    const ed = editorRef.current;
    const b = blockAmCursor();
    if (ed && b) {
      try { ed.updateBlock(b, b.type === 'checkListItem' ? { type: 'paragraph' } : { type: 'checkListItem', props: { checked: false } }); } catch { /* egal */ }
      return;
    }
    anhaengen({ type: 'checkListItem', props: { checked: false }, content: '' });
  };
  const alsBeschluss = () => {
    if (!entry) return;
    const ed = editorRef.current;
    const b = blockAmCursor();
    const text = b ? inhaltText(b.content).trim() : '';
    if (ed && b && text) {
      // Die Zeile WIRD zum Beschluss — sie steht danach nicht doppelt im Text. M493: gemeinsam beides über das
      // Y-Dokument (Beschluss in der Sitzung, Zeile über den Editor), sonst über den Speicher
      beschlussDazu(text);
      try { ed.removeBlocks([b]); } catch { /* egal */ }
      showToast('Als Beschluss festgehalten.');
      return;
    }
    beschlussFeld.current?.focus();
  };
  /** Sprungmarke der Tagesordnung: Cursor an die Überschrift */
  const springeZu = (top: { id?: string; text: string }) => {
    const ed = editorRef.current;
    if (!ed) return;
    const ziel = ed.document.find((b) => (top.id && b.id === top.id) || (b.type === 'heading' && inhaltText(b.content).trim() === top.text));
    if (!ziel) return;
    try { ed.setTextCursorPosition(ziel, 'end'); ed.focus(); } catch { /* egal */ }
    // Nur den Protokolltext rollen — scrollIntoView rollte auch die Arbeitsfläche mit
    const el = textRef.current?.querySelector<HTMLElement>(`[data-id="${ziel.id}"]`);
    const box = textRef.current?.querySelector<HTMLElement>('.minutes-body');
    if (el && box) box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  };

  const addDecision = () => {
    const text = beschlussText.trim();
    if (!text || !entry) return;
    beschlussDazu(text);
    setBeschlussText('');
  };

  // ---------- Runde ----------
  const runde = teilnehmende(entry?.attendees);
  const personDazu = (namen = teilnehmende(personText)) => {
    if (!entry || namen.length === 0) return;
    patchEntry(entry.id, { attendees: teilnehmendeText(teilnehmende([...runde, ...namen].join(','))) });
    setPersonText('');
  };
  // M495: „Mia: …" in einer Aufgabe, Mia aber nicht in der Runde — vorschlagen statt still übergehen
  const personVorschlaege = useMemo(
    () => unbekanntePersonen(entry).filter((n) => !abgelehnt.has(`${entry?.id}:${n.toLowerCase()}`)),
    [entry, abgelehnt],
  );
  const ablehnen = (n: string) => setAbgelehnt((alt) => new Set(alt).add(`${entry?.id}:${n.toLowerCase()}`));
  const personWeg = (name: string) => {
    if (!entry) return;
    patchEntry(entry.id, { attendees: teilnehmendeText(runde.filter((n) => n !== name)) });
  };

  // ---------- Übersicht ----------
  const abhaken = (a: OffeneAufgabe) => {
    const e = (m.entries ?? []).find((x) => x.id === a.entryId);
    if (!e) return;
    // M493: Im Live-Board kann gerade jemand gemeinsam in dieser Sitzung schreiben — dessen Schreiber „heilte" einen
    // Haken über den Speicher wieder weg (M489, offen). Darum dort über das Y-Dokument der Sitzung abhaken.
    if (liveVerbunden(boardId)) {
      showToast(`Erledigt: ${a.text}`);
      void import('../../lib/notizGemeinsamKern')
        .then((k) => k.protokollHaken(boardId, id, e.id, repairBlocks(e.blocks as unknown[]), e.decisions ?? [], noteSchema, a.blockId))
        .then((gut) => { if (!gut) showToast('Der Punkt steht im gemeinsamen Stand nicht mehr – nichts geändert.'); })
        .catch(() => alleinAbhaken(e, a));   // Yjs lädt nicht: über den Speicher wie ohne Live-Kanal
      return;
    }
    alleinAbhaken(e, a);
    showToast(`Erledigt: ${a.text}`);
  };
  const alleinAbhaken = (e: MinutesEntry, a: OffeneAufgabe) => {
    // Der Editor dieser Sitzung ist in der Übersicht abgebaut — der Speicher ist hier die Wahrheit.
    // extEpoch: ein Editor, der dieselbe Sitzung doch zeigt (Präsentation), übernimmt den Stand.
    patch({
      entries: (m.entries ?? []).map((x) => (x.id === e.id ? { ...x, blocks: toggleCheckBlock(x.blocks, a.blockId) } : x)),
      extEpoch: ((m.extEpoch as number | undefined) ?? 0) + 1,
    });
  };
  const nachPerson = useMemo(() => {
    const g = new Map<string, OffeneAufgabe[]>();
    for (const a of offen) {
      const k = a.person ?? '';
      g.set(k, [...(g.get(k) ?? []), a]);
    }
    return [...g.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])));
  }, [offen]);
  const treffer = useMemo(() => (suche.trim() ? sucheInReihe(m, suche) : []), [m, suche]);
  const teilnahme = useMemo(() => anwesenheit(m), [m]);

  // ---------- Versenden ----------
  const alsText = async () => {
    if (!entry) return;
    setMenueOffen(false);
    try { await navigator.clipboard.writeText(sitzungAlsText(m, entry)); showToast('Sitzung als Text kopiert.'); }
    catch { showToast('Kopieren ging nicht – der Browser hat den Zugriff verweigert.'); }
  };
  /**
   * M495: mailto kürzt lange Protokolle (Outlook/Windows schneiden ab etwa 2 000 Zeichen ab, manche Programme öffnen
   * gar nichts). Passt die Sitzung nicht, liegt der volle Text in der Zwischenablage, und das Mailprogramm öffnet mit
   * Betreff und dem Hinweis, ihn einzufügen.
   */
  const perMail = async () => {
    if (!entry) return;
    setMenueOffen(false);
    const text = sitzungAlsText(m, entry);
    const kopiert = mailAdresse(m, entry, text, '').lang
      ? await navigator.clipboard.writeText(text).then(() => true, () => false)
      : false;
    const hinweis = kopiert
      ? t('Der Text des Protokolls liegt in der Zwischenablage – bitte hier einfügen (Strg+V, am Mac Cmd+V).')
      : t('Das Protokoll ist zu lang für eine E-Mail-Verknüpfung. In PixiNotes über ⋯ „Als Text kopieren“ holen und hier einfügen.');
    const { adresse, lang } = mailAdresse(m, entry, text, hinweis);
    window.open(adresse, '_self');
    if (lang) showToast(kopiert
      ? 'Das Protokoll ist lang – der Text liegt in der Zwischenablage. Im Mailprogramm einfügen.'
      : 'Das Protokoll ist zu lang für eine E-Mail-Verknüpfung – bitte „Als Text kopieren“ nutzen.');
  };
  const speichern = (art: 'md' | 'html') => {
    if (!entry) return;
    setMenueOffen(false);
    const inhalt = art === 'md' ? sitzungAlsMarkdown(m, entry) : sitzungAlsHtml(m, entry);
    const url = URL.createObjectURL(new Blob([inhalt], { type: art === 'md' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8' }));
    triggerDownload(url, dateiName(m, entry, art));
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  /** Druckansicht: ruhiges, sauberes Blatt in einem eigenen Fenster — dort bietet jeder Browser auch „Als PDF sichern" */
  const drucken = () => {
    if (!entry) return;
    setMenueOffen(false);
    const win = window.open('', '_blank', 'width=820,height=900');
    if (!win) { speichern('html'); showToast('Das Druckfenster wurde blockiert – die Druckansicht liegt als Datei bei den Downloads.'); return; }
    win.document.write(sitzungAlsHtml(m, entry));
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* Fenster schon zu */ } }, 250);
  };

  /** M187: Farbe wie bei der Notiz-Karte */
  const farbe = (c: (typeof STICKY_COLORS)[number]) => patch({ color: c, hex: undefined });

  const tops = useMemo(() => tagesordnung(entry), [entry]);
  /* M495: Viele Sitzungen. Die Leiste zeigt so viele der neuesten, wie in die Breite passen (die gezeigte immer),
     der Rest steht in „Ältere …", nach Monat gruppiert. Vorher wuchs die Leiste nur waagrecht — bei 50 Sitzungen
     ein langer Rollbalken. Gemessen wird am DOM: zu breit → eine weniger; breiter geworden → neu messen. */
  const [platz, setPlatz] = useState(LEISTE_MAX);
  const sichtbar = useMemo(() => {
    const v = sorted.slice(0, platz);
    if (!entry || v.some((x) => x.id === entry.id)) return v;
    return [...v.slice(0, Math.max(0, platz - 1)), entry];
  }, [sorted, platz, entry]);
  const aeltere = useMemo(() => {
    const ids = new Set(sichtbar.map((x) => x.id));
    return nachMonat(sorted.filter((x) => !ids.has(x.id)));
  }, [sorted, sichtbar]);
  useLayoutEffect(() => {
    const l = leisteRef.current;
    if (l && platz > 1 && l.scrollWidth > l.clientWidth + 1) setPlatz((p) => Math.max(1, p - 1));
  });
  useEffect(() => {
    const l = leisteRef.current;
    if (!l || typeof ResizeObserver === 'undefined') return undefined;
    let breite = l.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(l.clientWidth - breite) < 2) return;
      if (l.clientWidth > breite) setPlatz(LEISTE_MAX);
      breite = l.clientWidth;
    });
    ro.observe(l);
    return () => ro.disconnect();
  }, [ansicht, sorted.length > 0]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ←/→ zwischen den Sitzungen (neueste links) — nur, wenn kein Fenster über dem Board liegt. Pos1/Ende bleiben dem
  // Board (erste/letzte Karte, M345: boardTasten.ts hört sie auf der ganzen Fläche)
  const tasteFolgt = useRef(false);
  const leisteTaste = (ev: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
    if (overlayOffen() || !entry) return;
    const i = sorted.findIndex((x) => x.id === entry.id);
    const ziel = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : -2;
    if (ziel === -2) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ziel < 0 || ziel >= sorted.length || ziel === i) return;
    tasteFolgt.current = true;
    patch({ current: sorted[ziel].id });
  };
  useEffect(() => {
    if (!tasteFolgt.current) return;
    tasteFolgt.current = false;
    leisteRef.current?.querySelector<HTMLElement>('.pr-tag[aria-selected="true"]')?.focus();
  }, [entry?.id]);

  const stand = aufgabenStand(entry);

  return (
    <div className="pr-rahmen">
      <div className="minutes-head">
        <DragTitle
          value={m.title}
          onChange={(title: string) => patch({ title })}
          className="minutes-title"
          placeholder="Besprechungsreihe"
        />
        {sorted.length > 0 && (
          <div className="pr-umschalter nodrag" role="tablist" aria-label="Ansicht der Protokollreihe">
            <button role="tab" aria-selected={ansicht === 'sitzung'} className="pr-reiter" data-taste="pr-sitzung" onClick={() => setAnsicht('sitzung')}>
              Sitzung
            </button>
            <button role="tab" aria-selected={ansicht === 'uebersicht'} className="pr-reiter" data-taste="pr-uebersicht" onClick={() => setAnsicht('uebersicht')} title="Offene Aufgaben, Beschlüsse und Suche über alle Sitzungen">
              Übersicht{offen.length > 0 && <span className="pr-zahl" aria-label={zahlWort(offen.length, 'offene Aufgabe', 'offene Aufgaben')}>{offen.length}</span>}
            </button>
          </div>
        )}
        {!nurLesen && sorted.length > 0 && (
          <button className="minutes-new nodrag" title="Nächste Sitzung anlegen – übernimmt Runde, offene Aufgaben und TOPs ohne Beschluss (abwählbar)" aria-label="Nächste Sitzung anlegen" onClick={addEntry} data-taste="pr-neu">
            <IPlus size={14} />
          </button>
        )}
        <button className="minutes-setup-btn nodrag" aria-expanded={setupOpen} title="Reihe einrichten: Rhythmus, feste Tagesordnung, Farbe" onClick={() => setSetupOpen((o) => !o)}>
          <ISettings size={14} />
        </button>
      </div>

      {setupOpen && (
        <div className="minutes-setup nodrag">
          <label>
            <span>Rhythmus</span>
            <select value={m.rhythm ?? ''} onChange={(e) => patch({ rhythm: e.target.value as MinutesData['rhythm'] })}>
              <option value="">frei</option>
              <option value="woche">wöchentlich</option>
              <option value="zweiwochen">14-tägig</option>
              <option value="monat">monatlich</option>
              <option value="quartal">vierteljährlich</option>
            </select>
          </label>
          <label className="minutes-carry">
            <input type="checkbox" checked={m.carryOpen !== false} onChange={(e) => patch({ carryOpen: e.target.checked })} />
            <span>Offene Aufgaben in die neue Sitzung übernehmen</span>
          </label>
          <div className="minutes-agenda">
            <b>Feste Tagesordnung</b>
            {(m.agenda ?? []).map((top, i) => (
              <div key={i} className="minutes-top">
                <input
                  value={top}
                  placeholder="TOP …"
                  onChange={(e) => patch({ agenda: (m.agenda ?? []).map((t, j) => (j === i ? e.target.value : t)) })}
                />
                <button title="Punkt entfernen" aria-label="Punkt entfernen" onClick={() => patch({ agenda: (m.agenda ?? []).filter((_, j) => j !== i) })}>
                  <IX size={10} />
                </button>
              </div>
            ))}
            <button className="minutes-add-top" onClick={() => patch({ agenda: [...(m.agenda ?? []), ''] })}>
              <IPlus size={10} /> Tagesordnungspunkt
            </button>
          </div>
          <div className="pr-farben">
            <span>Farbe</span>
            {STICKY_COLORS.map((c) => (
              <button
                key={c}
                className={`pr-farbe sticky-${c}`}
                aria-pressed={!m.hex && (m.color ?? 'white') === c}
                title="Kartenfarbe"
                aria-label="Kartenfarbe"
                onClick={() => farbe(c)}
              />
            ))}
            <input
              type="color"
              className="pn-colorpick minutes-colorpick"
              title="Eigene Kartenfarbe wählen"
              value={typeof m.hex === 'string' ? m.hex : '#ffffff'}
              onChange={(e) => patch({ hex: e.target.value })}
            />
          </div>
        </div>
      )}

      {uebergabe && (
        <div
          className="pr-uebergabe nodrag"
          role="group"
          aria-label="Nächste Sitzung anlegen"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setUebergabe(null); } }}
        >
          <div className="pr-uebergabe-kopf">
            <b>Nächste Sitzung</b>
            <input
              type="date"
              className="pr-datum"
              value={uebergabe.datum}
              aria-label="Datum der nächsten Sitzung"
              onChange={(e) => setUebergabe({ ...uebergabe, datum: e.target.value })}
            />
          </div>
          <p className="pr-leer">Aus der letzten Sitzung übernehmen:</p>
          <div className="pr-uebergabe-liste">
            {uebergabe.punkte.map((p) => (
              <label key={p.key} className="pr-uebergabe-punkt">
                <input
                  type="checkbox"
                  checked={uebergabe.gewaehlt.has(p.key)}
                  onChange={(e) => {
                    const g = new Set(uebergabe.gewaehlt);
                    if (e.target.checked) g.add(p.key); else g.delete(p.key);
                    setUebergabe({ ...uebergabe, gewaehlt: g });
                  }}
                />
                <span className="pr-art">{p.art === 'top' ? 'TOP ohne Beschluss' : 'Aufgabe'}</span>
                <span className="pr-uebergabe-text" translate="no">{p.text}</span>
              </label>
            ))}
          </div>
          <div className="pr-uebergabe-fuss">
            <button className="pr-knopf" onClick={() => setUebergabe(null)}>Abbrechen</button>
            <button className="pr-knopf pr-haupt" data-taste="pr-anlegen" onClick={() => anlegen(uebergabe.gewaehlt, uebergabe.datum)}>Sitzung anlegen</button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="minutes-empty">
          Noch keine Sitzung.
          {!nurLesen && <button className="nodrag" onClick={() => anlegen(new Set(), nextDate(m))}>Erste Sitzung anlegen</button>}
        </div>
      ) : ansicht === 'sitzung' ? (
        <>
          <div className="pr-leiste-zeile nodrag">
            <div className="pr-leiste" role="tablist" aria-label="Sitzungen" ref={leisteRef} onKeyDown={leisteTaste}>
              {sichtbar.map((e) => {
                const aktiv = e.id === entry?.id;
                return (
                  <button
                    key={e.id}
                    role="tab"
                    aria-selected={aktiv}
                    tabIndex={aktiv ? 0 : -1}
                    className="pr-tag"
                    title={e.title?.trim() ? `${e.title.trim()} · ${langDatum(e.date)}` : langDatum(e.date)}
                    onClick={() => patch({ current: e.id })}
                  >
                    {kurzDatum(e.date)}
                  </button>
                );
              })}
            </div>
            {aeltere.length > 0 && (
              <select
                className="pr-aeltere"
                value=""
                aria-label="Ältere Sitzungen"
                title="Ältere Sitzungen, nach Monat"
                onChange={(ev) => { if (ev.target.value) patch({ current: ev.target.value }); }}
              >
                <option value="">{`Ältere (${aeltere.reduce((n, g) => n + g.sitzungen.length, 0)})`}</option>
                {aeltere.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.sitzungen.map((e) => (
                      <option key={e.id} value={e.id}>{e.title?.trim() ? `${langDatum(e.date)} · ${e.title.trim()}` : langDatum(e.date)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          {entry && (
            <div className="pr-sitzung-kopf nodrag">
              <input
                type="date"
                className="pr-datum"
                value={entry.date}
                title="Datum der Sitzung"
                aria-label="Datum der Sitzung"
                onChange={(e) => patchEntry(entry.id, { date: e.target.value })}
              />
              <input
                type="text"
                className="pr-sitzung-titel"
                placeholder="Titel (optional)"
                aria-label="Titel der Sitzung"
                value={entry.title ?? ''}
                onChange={(e) => patchEntry(entry.id, { title: e.target.value || undefined })}
              />
              <div className="pr-werkzeuge" role="toolbar" aria-label="Zeile am Cursor markieren">
                <button onMouseDown={(e) => e.preventDefault()} onClick={alsTop} title="Zeile am Cursor als Tagesordnungspunkt (Überschrift)" data-taste="pr-top">TOP</button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={alsAufgabe} title="Zeile am Cursor als Aufgabe – Person mit „Name:“ oder @Name, Frist wie „bis Freitag“" aria-label="Als Aufgabe markieren" data-taste="pr-aufgabe">
                  <ICheck size={12} /><span className="pr-wort">Aufgabe</span>
                </button>
                <button onMouseDown={(e) => e.preventDefault()} onClick={alsBeschluss} title="Zeile am Cursor als Beschluss festhalten" aria-label="Als Beschluss festhalten" data-taste="pr-beschluss">§<span className="pr-wort">Beschluss</span></button>
                <div className="pr-menue-wrap">
                  <button className="pr-mehr" aria-label="Weitere Aktionen der Sitzung" title="Kopieren, versenden, drucken, speichern, löschen" aria-expanded={menueOffen} onClick={() => setMenueOffen((o) => !o)}>
                    <IMore size={14} />
                  </button>
                  {menueOffen && (
                    <div className="pr-menue" role="menu">
                      <button role="menuitem" onClick={() => void alsText()}><ICopy size={13} /> Als Text kopieren</button>
                      <button role="menuitem" onClick={() => void perMail()}><IMail size={13} /> Per E-Mail versenden</button>
                      <button role="menuitem" onClick={drucken} data-taste="pr-drucken"><IDrucker size={13} /> Drucken / als PDF</button>
                      <button role="menuitem" onClick={() => speichern('md')}><IDownload size={13} /> Als Markdown speichern (.md)</button>
                      <button role="menuitem" onClick={() => speichern('html')}><IDownload size={13} /> Als Webseite speichern (.html)</button>
                      {!nurLesen && <button role="menuitem" className="pr-gefahr" onClick={() => removeEntry(entry.id)}><ITrash size={13} /> Sitzung löschen</button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {entry && (
            <div className="pr-runde nodrag" aria-label="Teilnehmende">
              <IUsers size={13} />
              {runde.map((n) => (
                <span key={n} className="pr-person" translate="no">
                  {n}
                  {!nurLesen && <button className="pr-person-weg" title={`${n} entfernen`} aria-label={`${n} entfernen`} onClick={() => personWeg(n)}><IX size={9} /></button>}
                </span>
              ))}
              {!nurLesen && (
                <input
                  className="pr-person-neu"
                  placeholder={runde.length ? '+ Person' : 'Wer ist dabei? Namen mit Komma'}
                  aria-label="Person hinzufügen"
                  value={personText}
                  onChange={(e) => setPersonText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); personDazu(); } }}
                  onBlur={() => personDazu()}
                />
              )}
            </div>
          )}

          {entry && !nurLesen && personVorschlaege.map((n) => (
            <div key={n} className="pr-vorschlag nodrag" role="group" aria-label="Vorschlag für die Runde">
              <span className="pr-vorschlag-text">{`${n} zur Runde hinzufügen?`}</span>
              <button className="pr-vorschlag-ja" onClick={() => personDazu([n])} data-taste="pr-person-ja">Hinzufügen</button>
              <button className="pr-vorschlag-nein" title="Nicht zur Runde" aria-label="Nicht zur Runde" onClick={() => ablehnen(n)}><IX size={10} /></button>
            </div>
          ))}

          {tops.length > 0 && (
            <div className="minutes-tops nodrag" aria-label="Tagesordnung">
              {tops.map((t, i) => (
                <button key={`${t.id ?? i}`} className="minutes-top-chip" translate="no" title="Zum Tagesordnungspunkt springen" onClick={() => springeZu(t)}>
                  {t.text}
                </button>
              ))}
            </div>
          )}

          <div className="pr-text" ref={textRef}>
            {entry && <EntryEditorWahl key={entry.id} nodeId={id} entryId={entry.id} blocks={entry.blocks} editorRef={editorRef} />}
          </div>

          {entry && (
            // M493: gemeinsam laufen die Beschlüsse über das Y-Dokument — Hineinklicken nimmt keine Karten-Sperre
            <div className="minutes-decisions nodrag" {...(live ? { 'data-ohne-sperre': '' } : {})}>
              <div className="pr-abschnitt-kopf">
                <b>Beschlüsse</b>
                {(stand.offen + stand.erledigt) > 0 && (
                  <span className="pr-stand">{zahlWort(stand.offen, 'Aufgabe offen', 'Aufgaben offen')} · {stand.erledigt} erledigt</span>
                )}
              </div>
              {sitzungsBeschluesse.map((d) => (
                <div key={d.id} className="minutes-decision">
                  <span className="pr-para" aria-hidden="true">§</span>
                  <textarea
                    className="pr-beschluss-text"
                    rows={1}
                    translate="no"
                    value={d.text}
                    aria-label="Beschluss"
                    readOnly={nurLesen}
                    onChange={(ev) => beschlussSetzen(d.id, ev.target.value)}
                    onBlur={(ev) => { if (!ev.target.value.trim()) beschlussSetzen(d.id, null); }}
                  />
                  {!nurLesen && (
                    <button title="Beschluss entfernen" aria-label="Beschluss entfernen" onClick={() => beschlussSetzen(d.id, null)}>
                      <IX size={10} />
                    </button>
                  )}
                </div>
              ))}
              {!nurLesen && (
                <textarea
                  ref={beschlussFeld}
                  rows={1}
                  className="minutes-decision-add"
                  placeholder="+ Beschluss festhalten …"
                  value={beschlussText}
                  onChange={(e) => setBeschlussText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addDecision(); } }}
                  onBlur={addDecision}
                />
              )}
            </div>
          )}
        </>
      ) : (
        // M493: Suchen und Abhaken nehmen keine Karten-Sperre — der Haken läuft im Live-Board über das Y-Dokument der
        // Sitzung; hielte der Klick die Karte, nähme der Schutz dem gemeinsamen Schreiber das Sichern ab (m487 B17)
        <div className="pr-uebersicht nodrag" data-ohne-sperre="">
          <label className="pr-suche">
            <ISearch size={13} />
            <input
              type="search"
              placeholder="In allen Sitzungen suchen …"
              aria-label="In allen Sitzungen suchen"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
            />
          </label>
          {suche.trim() ? (
            <section className="pr-abschnitt">
              <h4>{zahlWort(treffer.length, 'Treffer', 'Treffer')}</h4>
              {treffer.map((t, i) => (
                <button key={i} className="pr-treffer" onClick={() => zeige(t.entryId)} title="Sitzung öffnen">
                  <span className="pr-datum-chip">{kurzDatum(t.date)}</span>
                  <span className="pr-treffer-text" translate="no">{t.art === 'beschluss' ? `§ ${t.text}` : t.text}</span>
                </button>
              ))}
            </section>
          ) : (
            <>
              <section className="pr-abschnitt" aria-label="Offene Aufgaben">
                <h4>Offene Aufgaben <span className="pr-zahl">{offen.length}</span></h4>
                {offen.length === 0 && <p className="pr-leer">Keine offenen Aufgaben. Aufgaben entstehen im Protokolltext: Zeile markieren und „Aufgabe“ wählen.</p>}
                {nachPerson.map(([person, liste]) => (
                  <div key={person} className="pr-gruppe">
                    <div className="pr-gruppe-name" translate="no">{person || 'Ohne Person'}</div>
                    {liste.map((a) => (
                      <div key={a.blockId} className="pr-aufgabe">
                        <input
                          type="checkbox"
                          aria-label={`Erledigt: ${a.text}`}
                          disabled={nurLesen}
                          onChange={() => abhaken(a)}
                        />
                        <span className="pr-aufgabe-text" translate="no">{a.text}</span>
                        {a.frist && <span className={`pr-frist${a.ueberfaellig ? ' ueberfaellig' : ''}`} title={a.ueberfaellig ? 'Frist überschritten' : 'Frist'}>bis {fristText(a.frist)}</span>}
                        {a.seit && <span className="pr-seit" title="Offen seit">seit {a.seit}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </section>
              <section className="pr-abschnitt" aria-label="Beschlüsse">
                <h4>Beschlüsse <span className="pr-zahl">{beschluesse.length}</span></h4>
                {beschluesse.length === 0 && <p className="pr-leer">Noch keine Beschlüsse.</p>}
                {beschluesse.map((d, i) => {
                  const e = sorted.find((x) => x.date === d.date);
                  return (
                    <div key={i} className="pr-beschluss">
                      <button className="pr-datum-chip" title="Sitzung öffnen" onClick={() => e && zeige(e.id)}>{kurzDatum(d.date)}</button>
                      <span translate="no">{d.text}</span>
                    </div>
                  );
                })}
              </section>
              {teilnahme.length > 0 && (
                <section className="pr-abschnitt" aria-label="Teilnahme">
                  <h4>Teilnahme</h4>
                  <div className="pr-teilnahme">
                    {teilnahme.map((t) => (
                      <span key={t.name} className="pr-person" translate="no">{t.name} <em>{t.mal}/{sorted.length}</em></span>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** M487: Im Live-Board übernimmt die Hülle für gemeinsames Tippen (nachgeladen, nur wenn ein Kanal steht) */
const ProtokollGemeinsam = lazy(() => import('./ProtokollGemeinsam'));
export interface EntryEditorProps {
  nodeId: string; entryId: string; blocks?: unknown[];
  editorRef?: { current: unknown };
}
function EntryEditorWahl(p: EntryEditorProps) {
  const boardId = useBoard((s) => s.activeId);
  useTakt(TEILNEHMER_EREIGNIS);
  // Einmal live, bleibt die Hülle (sie geht selbst zurück zu „allein", wenn der Kanal fehlt — nie unter dem Cursor)
  const jeLive = useRef(false);
  if (liveVerbunden(boardId)) jeLive.current = true;
  return jeLive.current
    ? <Suspense fallback={<ProtokollRuhend blocks={p.blocks} />}><ProtokollGemeinsam {...p} /></Suspense>
    : <EntryEditor {...p} />;
}
/** M487: Der Protokolltext ohne Editor — kurz, während die Hülle zwischen zwei Editoren wechselt */
export function ProtokollRuhend({ blocks }: { blocks?: unknown[] }) {
  return (
    <div className="minutes-body nodrag">
      <div className="note-editor" translate="no">
        <NotizRuhend blocks={(blocks ?? []) as RuheBlock[]} onHaken={() => { /* gleich wieder ein Editor */ }} />
      </div>
    </div>
  );
}

/** Die Sitzung, die ein Editor zeigt — aus dem Speicher (der Editor liest selbst nur beim Mount) */
function gespeicherteSitzung(nodeId: string, entryId: string): { data?: MinutesData; entry?: MinutesEntry } {
  const st = useBoard.getState();
  const board = st.boards.find((b) => b.nodes.some((n) => n.id === nodeId));
  const data = board?.nodes.find((n) => n.id === nodeId)?.data as MinutesData | undefined;
  return { data, entry: (data?.entries ?? []).find((e) => e.id === entryId) };
}

/**
 * Protokolltext einer Sitzung. Eigene Komponente, damit der `key`-Wechsel
 * beim Blättern den Editor sauber neu aufbaut (BlockNote liest nur beim Mount).
 * M487: `sitzung` — gemeinsam tippen im Live-Board (Yjs, Hülle ./ProtokollGemeinsam.tsx); sonst allein wie bisher.
 */
export function EntryEditor({ nodeId, entryId, blocks, editorRef, sitzung }: EntryEditorProps & { sitzung?: NotizSitzung }) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const [initialContent] = useState<PartialBlock[] | undefined>(() => {
    const safe = repairBlocks(blocks) as PartialBlock[];
    return safe.length > 0 ? safe : undefined;
  });
  const nurLesen = useNurLesen(); // M360
  // M495: die Runde dieser Sitzung — für die @-Liste beim Tippen
  const rundeText = useBoard((s) => {
    const n = s.boards.find((b) => b.id === s.activeId)?.nodes.find((x) => x.id === nodeId);
    return (n?.data as MinutesData | undefined)?.entries?.find((e) => e.id === entryId)?.attendees ?? '';
  });
  const runde = useMemo(() => teilnehmende(rundeText), [rundeText]);
  const basis = {
    schema: noteSchema,
    // M462: Strg+A markiert wie bisher die ganze Notiz (BlockNote 0.57: erst den Block)
    selectAllBehavior: 'document' as const,
    initialContent: initialContent as never,
    dictionary: sprache() === 'en' ? blockNoteEn : blockNoteDe,   // M381
    // M289: Damit Bilder überhaupt in den Text dürfen — Einfügen,
    // Ablegen und der Dateiwähler des Bild-Blocks laufen hier durch
    uploadFile: editorUpload(),   // M303: nie eine abgewiesene Zusage
  };
  // M487: gemeinsam — derselbe Editor, dazu die Yjs-Kollaboration (Inhalt aus dem Y-Dokument statt initialContent)
  const editor = useCreateBlockNote(sitzung ? sitzung.optionen(basis) : basis);
  useAndroidBackspaceFix(editor);
  useEffect(() => sitzung?.anbinden(!nurLesen, () => editor.document), [sitzung, nurLesen, editor]);
  if (editorRef) editorRef.current = editor;

  /* M489: Externer Schreiber (Haken in der Aufgaben-Zentrale oder der Übersicht) zählt extEpoch hoch — der lebende
     Editor übernimmt den Stand seiner Sitzung. Vorher schrieb der nächste Tastendruck den alten Stand zurück und der
     Haken aus der Zentrale war wieder weg. Gemeinsam übernimmt nur der Schreiber (er reicht es über Yjs weiter). */
  const extEpoch = useBoard((s) => {
    const n = s.boards.find((b) => b.id === s.activeId)?.nodes.find((x) => x.id === nodeId);
    return (n?.data as MinutesData | undefined)?.extEpoch as number | undefined;
  });
  const letzteEpoche = useRef(extEpoch);
  useEffect(() => {
    if (extEpoch === letzteEpoche.current) return;
    letzteEpoche.current = extEpoch;
    if (sitzung && !sitzung.istSchreiber()) return;
    const neu = gespeicherteSitzung(nodeId, entryId).entry?.blocks;
    if (!neu?.length || JSON.stringify(neu) === JSON.stringify(editor.document)) return;
    try { editor.replaceBlocks(editor.document, repairBlocks(neu) as never); } catch { /* Editor gerade im Umbau */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extEpoch]);

  // Beim Verlassen der Sitzung (Blättern) den letzten Stand sichern —
  // onChange feuert nicht mehr, wenn die Komponente schon abgebaut wird
  const latest = useRef(editor);
  latest.current = editor;
  /* M493: Stand beim Aufbau — BlockNote ergänzt beim Laden Kennungen und Standardwerte. Wurde nichts getippt, schreibt
     der Abbau nichts zurück: Sonst stand beim Wechsel in den gemeinsamen Modus auf diesem Gerät eine umgeformte
     Fassung, auf den anderen noch die alte — zwei verschiedene Anfänge desselben Textes (m487 B5/B8). */
  const beimAufbau = useRef<string | null>(null);
  if (beimAufbau.current === null) beimAufbau.current = JSON.stringify(editor.document);
  useEffect(() => () => {
    if (sitzung) return;   // M487: gemeinsam sichert die Sitzung (nur der Schreiber, beim Verlassen `abschied`)
    try {
      const st = useBoard.getState();
      const { data, entry: alt } = gespeicherteSitzung(nodeId, entryId);
      if (!alt) return;   // Sitzung wurde gelöscht
      /* M410: Das ist ein Nachsichern, keine Eingabe – also kein eigener Schritt für Rückgängig, und nichts
         schreiben, wenn sich nichts geändert hat. Vorher legte jeder Abbau des Editors einen Schritt an, auch der
         Neuaufbau des Boards nach einer KI-Aktion: „Strg+Z macht alles rückgängig" nahm dann erst diesen leeren
         Schritt zurück, und die eigentliche Änderung blieb stehen. */
      const neu = latest.current.document;
      const neuJson = JSON.stringify(neu);
      if (JSON.stringify(alt.blocks ?? []) === neuJson || neuJson === beimAufbau.current) return;
      mutedHistory(() => st.updateNodeData(nodeId, {
        entries: (data?.entries ?? []).map((e) => (e.id === entryId ? { ...e, blocks: neu } : e)),
      }));
    } catch { /* Karte gerade im Abbau */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* M289: Auch im Protokoll gilt: Bilder in den Text, alles andere aufs Board */
  const huelle = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const aufsBoard = useCallback((dateien: File[], x: number, y: number) => {
    void importFilesToBoard(dateien, screenToFlowPosition({ x, y }));
  }, [screenToFlowPosition]);
  useNurBilderInDenText(huelle, aufsBoard);

  return (
    <div className="minutes-body nodrag" ref={huelle}>
      {/* M267: dieselbe Formatier-Leiste wie in der Notiz-Karte. */}
      <BlockNoteView
        editor={editor}
        editable={!nurLesen}
        theme="light"
        className="note-editor"
        formattingToolbar={false}
        slashMenu={false}   /* M283: eigenes Einfügen-Menü (NoteSlashMenu) */
        onChange={() => {
          // M487: gemeinsam auch Änderungen der anderen — gesichert nur vom Schreiber
          if (sitzung) { sitzung.aenderung(editor.document); return; }
          const cur = gespeicherteSitzung(nodeId, entryId).data?.entries ?? [];
          updateNodeData(nodeId, {
            entries: cur.map((e) => (e.id === entryId ? { ...e, blocks: editor.document } : e)),
          });
        }}
      >
        <NoteToolbar />
        {/* M283: „/" bietet die rechnende Tabelle an */}
        <NoteSlashMenu />
        {/* M495: „@" schlägt die Runde der Sitzung vor */}
        {!nurLesen && runde.length > 0 && <PersonenMenue runde={runde} />}
      </BlockNoteView>
    </div>
  );
}

/**
 * M495: „@" im Protokolltext schlägt die Runde vor (Pfeile, Enter, Klick). Eingefügt wird „@Vorname " (bei zwei
 * gleichen Vornamen der volle Name) — so erkennt die Übersicht die Person (lib/minutes.ts personVon). Öffnet nur am
 * Wortanfang: in „anna@amt.de" stört keine Liste. Passt niemand, schließt die Liste sofort — sonst schluckte sie Enter.
 */
function PersonenMenue({ runde }: { runde: string[] }) {
  const editor = useBlockNoteEditor();
  const amWortanfang = useCallback((tr: { selection: { from: number }; doc: { textBetween: (a: number, b: number, c?: string, d?: string) => string } }) => {
    const von = tr.selection.from;
    const davor = tr.doc.textBetween(Math.max(0, von - 1), von, ' ', ' ');
    return davor === '' || /\s/.test(davor);
  }, []);
  return (
    <SuggestionMenuController
      triggerCharacter="@"
      shouldOpen={amWortanfang as never}
      getItems={async (frage: string): Promise<DefaultReactSuggestionItem[]> => {
        const f = suchNorm(frage.trim());
        return runde
          .filter((r) => !f || suchNorm(r).split(/\s+/).some((w) => w.startsWith(f)) || suchNorm(r).startsWith(f))
          .slice(0, 8)
          .map((r) => ({ title: r, onItemClick: () => editor.insertInlineContent(`@${erwaehnung(r, runde)} `) }));
      }}
      suggestionMenuComponent={PersonenListe}
    />
  );
}
function PersonenListe({ items, selectedIndex, onItemClick, loadingState }: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const menue = useExtension(SuggestionMenu);
  const leer = loadingState === 'loaded' && items.length === 0;
  useEffect(() => { if (leer) menue.closeMenu(); }, [leer, menue]);
  if (items.length === 0) return null;
  return (
    <div className="pr-at-liste" role="listbox" aria-label="Person erwähnen">
      {items.map((it, i) => (
        <div
          key={it.title}
          role="option"
          aria-selected={i === selectedIndex}
          className="pr-at-name"
          translate="no"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onItemClick?.(it)}
        >
          {it.title}
        </div>
      ))}
    </div>
  );
}
