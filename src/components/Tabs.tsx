import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { selectActiveBoard, useBoard } from '../store';
import { boardToShareUrl, downloadBoardFile, SHARE_URL_LIMIT } from '../lib/share';
import { useRandZiehen } from '../lib/randZiehen';
import { useOutsideClose } from '../lib/useOutsideClose';
import { InlineName } from './InlineName';
import { NavTree } from './Navigation';
import { IChevronR, IHome, IPlus, IShare, IX } from './Icons';

/**
 * Die Navigation der App.
 *
 * Ab Tablet-Breite (861 Punkte) und mit „Navigation links" (Voreinstellung
 * seit M263) ist sie die linke SPALTE: 🏠 Übersicht, darunter der ganze Baum
 * (Bereich › Projekt › Board › Karte, Navigation.tsx), am Fuß Teilen und ＋.
 * Die Fläche beginnt rechts davon — nichts rutscht mehr unter die Spalte.
 *
 * Am Telefon (und ohne die Spalte) bleibt die Kopfleiste: 🏠, Brotkrume
 * „Bereich › Projekt", die Boards des Projekts als Reiter oder — wenn kein
 * Reiter mehr ganz hineinpasst — als Board-Wähler. Die Brotkrume öffnet
 * denselben Baum als Ausstülpung von links.
 *
 * M297: Vorher gab es die Hierarchie dreimal (Spalte, Navigator-Popup, rechte
 * Seitenleiste) und das Netz zweimal. Jetzt: ein Baum, zwei Orte; das Netz
 * nur noch in der Übersicht.
 */
export function Tabs() {
  const boards = useBoard((s) => s.boards);
  const spaces = useBoard((s) => s.spaces);
  const activeId = useBoard((s) => s.activeId);
  const view = useBoard((s) => s.view);
  const setView = useBoard((s) => s.setView);
  const setOverviewMode = useBoard((s) => s.setOverviewMode);
  const openBoard = useBoard((s) => s.openBoard);
  const addBoard = useBoard((s) => s.addBoard);
  const renameBoard = useBoard((s) => s.renameBoard);
  const removeBoard = useBoard((s) => s.removeBoard);
  const showToast = useBoard((s) => s.showToast);
  const showArchived = useBoard((s) => s.showArchived);
  const activeBoard = useBoard(selectActiveBoard);
  const navLinks = useBoard((s) => s.navLinks);
  const [navOpen, setNavOpen] = useState(false);
  // M245: Die Ausstülpung ist in der Breite ziehbar, die Breite wird gemerkt
  const navBreite = useBoard((s) => s.navBreite);
  const setNavBreite = useBoard((s) => s.setNavBreite);
  const navGriff = useRandZiehen('links', setNavBreite, 380);
  /**
   * M297: Spalte oder Kopfleiste? Dieselbe Grenze wie im Stylesheet (861
   * Punkte) — gemessen per Media-Query, damit JS und CSS nie auseinanderlaufen.
   */
  const [breit, setBreit] = useState(() => window.matchMedia('(min-width: 861px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 861px)');
    const on = () => setBreit(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const spalte = navLinks && breit;
  /**
   * M236: Beim Board-Wechsel den aktiven Tab ins Bild holen.
   *
   * Das Kleben (CSS `position: sticky`) sorgt dafür, dass er nie ganz
   * verschwindet — aber wer über die Suche auf ein Board springt, das weit
   * rechts in der Reihe liegt, soll auch die NACHBARN sehen.
   */
  const reiheRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = reiheRef.current?.querySelector('.tab.active') as HTMLElement | null;
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeId, view]);

  /**
   * M261: Reihe oder Wähler? Das entscheidet der PLATZ, nicht die Fenstergröße.
   *
   * Eine Media-Query wäre hier falsch: Sie kennt weder die Anzeigegröße
   * (A− / A+ skaliert per CSS-Zoom, M236) noch die linke Navigation, die der
   * Reihe Platz wegnimmt. Gemessen wird deshalb, was wirklich übrig bleibt.
   * Unter der Schwelle passt kein einziger Reiter vollständig hinein — dort
   * ist eine Scrollreihe keine Bedienung, sondern ein Rätsel.
   */
  const SCHWELLE = 300;
  const leisteRef = useRef<HTMLDivElement | null>(null);
  const [kompakt, setKompakt] = useState(false);
  /**
   * M261: Auf schmalen Leisten weicht der Bereichsname aus der Brotkrume.
   * Bewusst NICHT an `kompakt` gekoppelt: Das Einklappen schafft Platz, und
   * Platz entscheidet über `kompakt` — die beiden würden sich gegenseitig
   * aufschaukeln. Beide hängen deshalb an derselben Obergrenze der Leiste.
   */
  const [krumeKurz, setKrumeKurz] = useState(false);
  useEffect(() => {
    const el = leisteRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const messen = () => {
      const stil = getComputedStyle(el);
      /* In der linken Spalte stehen die Boards untereinander — dort ist Höhe
         da und Breite egal, der Wähler wäre ein Rückschritt. */
      if (stil.flexDirection === 'column') { setKompakt(false); setKrumeKurz(false); return; }
      /**
       * Gemessen wird der ERLAUBTE Platz, nicht der belegte: `.tabs` ist
       * fixiert positioniert und damit inhaltsbreit. Nach dem Umschalten auf
       * den Wähler schrumpfte sie mit, die Messung blieb unter der Schwelle
       * hängen. Die Obergrenze (--kopf-rest bzw. --kopf-voll) kennt den Modus
       * dagegen nicht.
       */
      const grenze = parseFloat(stil.maxWidth);
      const voll = Number.isFinite(grenze) ? grenze : el.clientWidth;
      setKrumeKurz(voll < 560);
      const fest = [...el.children]
        .filter((c) => !c.classList.contains('tabs-scroll') && !c.classList.contains('tab-picker-wrap'))
        .reduce((n, c) => n + (c as HTMLElement).offsetWidth + 4, 0);
      const frei = voll - fest - 10; // Innenabstand der Leiste
      /* Hysterese gegen Flattern genau an der Kante */
      setKompakt((war) => (war ? frei < SCHWELLE + 40 : frei < SCHWELLE));
    };
    // Nach dem Layout messen: --kopf-rest schreibt lib/kopfmass.ts in seinem
    // eigenen Beobachter, und dessen Reihenfolge ist nicht zugesichert.
    let warten = 0;
    const spaeter = () => { cancelAnimationFrame(warten); warten = requestAnimationFrame(messen); };
    spaeter();
    const ro = new ResizeObserver(spaeter);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener('resize', spaeter);
    return () => {
      cancelAnimationFrame(warten);
      ro.disconnect();
      window.removeEventListener('resize', spaeter);
    };
  }, []);

  /**
   * M252: Wie viel Platz die linke Navigation gerade belegt — als `--nav-offen`
   * an der Wurzel. Dock, Toast, Zeichen-Palette und die Filterleiste der
   * Netz-Ansicht rücken damit in die Mitte der FREIEN Fläche.
   * GEMESSEN, nicht geraten: In der Spalte hängt die Breite an Schrift und
   * Text-Zoom, die Ausstülpung ist frei ziehbar.
   */
  useEffect(() => {
    const wurzel = document.documentElement;
    const messen = () => {
      const el = !breit ? null
        : navOpen ? document.querySelector('.nav-panel')
          : navLinks ? document.querySelector('.tabs') : null;
      /* offsetLeft/offsetWidth statt getBoundingClientRect: Das Panel fährt
         mit einer Transformation ein, der Layout-Wert steht sofort richtig
         und ist schon in Layoutpunkten, wie das Stylesheet sie erwartet. */
      const box = el as HTMLElement | null;
      wurzel.style.setProperty('--nav-offen',
        box ? `${Math.round(box.offsetLeft + box.offsetWidth)}px` : '0px');
    };
    const id = requestAnimationFrame(messen);
    window.addEventListener('resize', messen);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', messen);
      wurzel.style.setProperty('--nav-offen', '0px');
    };
  }, [navOpen, navLinks, navBreite, view, breit]);

  // M251/M297: Alt+W — in der Spalte springt es in die Suche des Baums, sonst
  // klappt es die Ausstülpung auf und zu.
  useEffect(() => {
    const um = () => {
      if (navLinks && window.matchMedia('(min-width: 861px)').matches) {
        (document.querySelector('.tabs .side-tree-find') as HTMLInputElement | null)?.focus();
        return;
      }
      setNavOpen((o) => !o);
    };
    window.addEventListener('pixinotes:navigator', um);
    return () => window.removeEventListener('pixinotes:navigator', um);
  }, [navLinks]);
  // Esc schließt die Ausstülpung (der Backdrop fängt Klicks ohnehin ab)
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  // In der Spalte gibt es keine Ausstülpung — wer das Fenster verbreitert, hat sie nicht mehr offen
  useEffect(() => { if (spalte) setNavOpen(false); }, [spalte]);

  const byId = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);

  // Aktiven Kontext (Bereich + Projekt) zum aktiven Board ermitteln
  const context = useMemo(() => {
    for (const sp of spaces) {
      for (const proj of sp.projects) {
        if (proj.boardIds.includes(activeId)) return { space: sp, project: proj };
      }
    }
    const first = spaces[0]?.projects[0];
    return first ? { space: spaces[0], project: first } : null;
  }, [spaces, activeId]);

  // Boards des aktiven Projekts (in Projekt-Reihenfolge) — nur DIE als Tabs
  const projectBoards = useMemo(() => {
    const ids = context?.project.boardIds ?? [];
    const list = ids.map((id) => byId.get(id))
      .filter((b): b is NonNullable<typeof b> => !!b)
      // M288: Archivierte Boards belegen keinen Reiter mehr — genau dafür
      // archiviert man sie. Sichtbar bleiben sie mit „Archiv einblenden"
      // (Dock → ⋯ „Mehr") und natürlich, solange man auf einem steht.
      .filter((b) => showArchived || !b.archived || b.id === activeId);
    // Waisen-Board aktiv? Dann wenigstens dieses zeigen.
    if (!list.some((b) => b.id === activeId) && byId.has(activeId)) list.push(byId.get(activeId)!);
    return list;
  }, [context, byId, activeId, showArchived]);

  /** Board-Wähler auf schmalen Schirmen (M261) */
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [pickerOffen, setPickerOffen] = useState(false);
  useOutsideClose(pickerOffen, pickerRef, () => setPickerOffen(false));
  const aktivesBoard = useMemo(
    () => projectBoards.find((b) => b.id === activeId) ?? projectBoards[0],
    [projectBoards, activeId],
  );

  /** Aktives Board serverlos teilen: Link in die Zwischenablage (Fallback: Datei) */
  const shareActive = async () => {
    try {
      const url = await boardToShareUrl(activeBoard);
      if (url.length > SHARE_URL_LIMIT) {
        downloadBoardFile(activeBoard);
        showToast('Das Board ist zu groß für einen Link und wurde als Datei gesichert.');
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast('Teilen-Link kopiert. Er enthält das komplette Board.');
    } catch {
      downloadBoardFile(activeBoard);
      showToast('Der Link ließ sich nicht kopieren, das Board wurde als Datei gesichert.');
    }
  };

  const close = (id: string) => {
    if (boards.length <= 1) {
      showToast('Das letzte Board bleibt offen 🙂');
      return;
    }
    const board = boards.find((b) => b.id === id);
    if (board && board.nodes.length > 0) {
      if (!window.confirm(`Board „${board.name}" mit ${board.nodes.length} Karten wirklich löschen?`)) return;
    }
    removeBoard(id);
  };

  return (
    <div className={`tabs ${kompakt ? 'kompakt' : ''} ${krumeKurz ? 'krume-kurz' : ''} ${spalte ? 'spalte' : ''}`} ref={leisteRef}>
      <button
        className={`tab-home ${view === 'overview' ? 'active' : ''}`}
        title="Übersicht"
        aria-label="Übersicht"
        onClick={() => { setOverviewMode('hierarchie'); setView('overview'); }}
      >
        <IHome size={15} />
        <span className="tab-home-label">Übersicht</span>
      </button>
      {!spalte && (
        /* Brotkrume „Bereich › Projekt" öffnet den Baum als Ausstülpung von links */
        <button
          className={`tab-nav ${navOpen ? 'active' : ''}`}
          data-taste="navigator"
          title={`${context?.space.name ?? '—'} › ${context?.project.name ?? '—'} — Navigation öffnen`}
          onClick={() => setNavOpen((o) => !o)}
        >
          <span className="tab-nav-space">{context?.space.name ?? '—'}</span>
          <IChevronR size={11} />
          <span className="tab-nav-proj">{context?.project.name ?? '—'}</span>
        </button>
      )}
      {navOpen && createPortal(
        <div className="nav-backdrop" onClick={() => setNavOpen(false)}>
          {/* M245: Ausstülpung am linken Rand — angedockt, in der Breite ziehbar, deckend. */}
          <div className="nav-panel slideout nodrag" style={{ width: navBreite }} role="dialog" aria-label="Navigation" onClick={(e) => e.stopPropagation()}>
            <div className="nav-grip" {...navGriff}><span /></div>
            <div className="nav-head">
              <b>Navigation</b>
              <button
                className="nav-overview"
                title="Übersicht"
                onClick={() => { setOverviewMode('hierarchie'); setView('overview'); setNavOpen(false); }}
              ><IHome size={13} /> Übersicht</button>
              <button className="nav-x" title="Schließen (Esc)" aria-label="Schließen" onClick={() => setNavOpen(false)}><IX size={13} /></button>
            </div>
            <NavTree onNavigate={() => setNavOpen(false)} />
          </div>
        </div>,
        document.body,
      )}
      {spalte ? (
        /* M297: Der Baum sitzt fest in der Spalte */
        <NavTree />
      ) : kompakt ? (
        /* M261: Unterhalb einer gemessenen Breite trägt der Streifen keinen
           einzigen Reiter mehr. Dort steht statt der Reihe ein Board-Wähler. */
        <div className="tab-picker-wrap" ref={pickerRef}>
          <button
            className={`tab-picker ${pickerOffen ? 'auf' : ''}`}
            onClick={() => setPickerOffen((o) => !o)}
            /* Der Name kann auf 390 Punkten breiten Schirmen abgekürzt sein —
               dann steht er hier vollständig (Tippen und Halten zeigt ihn,
               M175) und in der Liste ohnehin. */
            title={`${aktivesBoard?.name ?? '—'} — Board wechseln`}
            aria-haspopup="listbox"
            aria-expanded={pickerOffen}
          >
            <span className="tab-picker-name">{aktivesBoard?.name ?? '—'}</span>
            {!krumeKurz && <span className="tab-count">{aktivesBoard?.nodes.length ?? 0}</span>}
            <IChevronR size={11} className="tab-picker-pfeil" />
          </button>
          {pickerOffen && (
            <div className="tab-picker-liste" role="listbox">
              {projectBoards.map((b) => (
                <button
                  key={b.id}
                  role="option"
                  aria-selected={b.id === activeId && view === 'board'}
                  className={`tab-picker-eintrag ${b.id === activeId && view === 'board' ? 'aktiv' : ''}`}
                  onClick={() => { openBoard(b.id); setPickerOffen(false); }}
                >
                  <span className="tab-picker-eintrag-name">{b.name}</span>
                  <span className="tab-count">{b.nodes.length}</span>
                  <span
                    className="tab-x"
                    role="button"
                    tabIndex={0}
                    aria-label={`Board ${b.name} schließen`}
                    title="Board schließen"
                    onClick={(e) => { e.stopPropagation(); close(b.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); close(b.id); } }}
                  >
                    <IX size={11} />
                  </span>
                </button>
              ))}
              <div className="tab-picker-fuss">
                {projectBoards.length} Board{projectBoards.length === 1 ? '' : 's'} in
                {' '}„{context?.project.name ?? '—'}"
              </div>
            </div>
          )}
        </div>
      ) : (
      /* Nur die Board-Tabs des AKTIVEN Projekts — scrollen bei Bedarf */
      <div className="tabs-scroll" ref={reiheRef}>
        {projectBoards.map((b) => (
          <div
            key={b.id}
            className={`tab ${b.id === activeId && view === 'board' ? 'active' : ''}`}
            onClick={() => openBoard(b.id)}
            title="Klick = wechseln · Doppelklick auf den Namen = umbenennen"
          >
            <InlineName value={b.name} className="tab-name" onRename={(name) => renameBoard(b.id, name)} />
            <span className="tab-count">{b.nodes.length}</span>
            <button
              className="tab-x"
              title="Board schließen"
              aria-label={`Board ${b.name} schließen`}
              onClick={(e) => {
                e.stopPropagation();
                close(b.id);
              }}
            >
              <IX size={11} />
            </button>
          </div>
        ))}
      </div>
      )}
      {/* M238: Teilen und ＋ als eigene Gruppe — in der Reihe eine Flex-Zeile in
          der Flex-Zeile, in der Spalte der Fuß der Liste. */}
      <div className="tabs-foot">
      <button
        className="tab-share"
        title="Board teilen"
        aria-label="Board teilen"
        onClick={shareActive}
      >
        <IShare size={13} />
      </button>
      <button
        className="tab-add"
        title={`Neues Board in „${context?.project.name ?? 'Allgemein'}"`}
        aria-label="Neues Board"
        onClick={() => {
          addBoard(undefined, context?.project.id);
          showToast(`Neues Board in „${context?.project.name ?? 'Allgemein'}".`);
        }}
      >
        <IPlus size={14} />
      </button>
      </div>
    </div>
  );
}
