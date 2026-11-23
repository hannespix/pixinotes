/**
 * M478: Die Eingangs-Liste — was von außen kam (Erweiterung, Teilen, Outlook „Später") und noch einsortiert werden
 * will. Eine schmale Leiste am rechten Rand, KEIN Dialog mit Abdunkelung: Das Board bleibt sichtbar und bedienbar,
 * damit man Einträge per Ziehen genau an die richtige Stelle legen kann.
 *
 * Je Eintrag: Vorschau (Bild bzw. erste Zeile), Herkunft und Zeit, „Aufs Board" und Löschen. Mit Häkchen mehrere auf
 * einmal. Ziel ist das offene Board oder eines aus der Auswahl oben. Ist der Eingang leer, schließt die Liste —
 * es gibt nichts zu zeigen. Wird erst beim ersten Öffnen geladen (App.tsx).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBoard } from '../store';
import type { AppNode } from '../types';
import {
  EINGANG_ZIEHEN, eingangBoard, eingangHolen, eingangLoeschen, eingangZielWeg, eintraege, herkunftText, type Eintrag,
} from '../lib/eingang';
import { einfuegbar, eingangInNotiz, notizenZurWahl, notizSuche } from '../lib/eingangNotiz';
import { nodeToText } from '../lib/serialize';
import { zahlWort } from '../lib/sprache';
import { IChevronL, IEingang, IFileText, IMail, IMore, ITrash, IX } from './Icons';

const ART: Record<string, string> = {
  note: 'Notiz', image: 'Bild', file: 'Datei', email: 'E-Mail', sheet: 'Tabelle', kontakt: 'Kontakt', htmlapp: 'App',
};

/** Vorschaubild eines Eintrags (nur eingebettete Bilder — nichts wird nachgeladen) */
function bildVon(e: Eintrag): string | undefined {
  for (const n of e.nodes) {
    const d = n.data as { src?: unknown; dataUrl?: unknown; mime?: unknown };
    if (n.type === 'image' && typeof d.src === 'string' && d.src.startsWith('data:image/')) return d.src;
    if (n.type === 'file' && typeof d.dataUrl === 'string' && d.dataUrl.startsWith('data:image/')) return d.dataUrl;
  }
  return undefined;
}

const zeilen = (n: AppNode) => nodeToText(n).split('\n').map((z) => z.trim()).filter(Boolean);

function texte(e: Eintrag): { titel: string; rest: string } {
  const alle = e.nodes.flatMap((n) => {
    const z = zeilen(n);
    const name = (n.data as { name?: unknown }).name;
    return z.length ? z : typeof name === 'string' ? [name] : [];
  });
  return { titel: (alle[0] ?? ART[e.nodes[0]?.type ?? ''] ?? 'Karte').slice(0, 90), rest: alle.slice(1).join(' · ').slice(0, 140) };
}

function zeitText(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const heute = new Date();
  return d.toDateString() === heute.toDateString()
    ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: d.getFullYear() === heute.getFullYear() ? undefined : '2-digit' });
}

export function EingangFenster({ gruppe, wunsch, onClose }: { gruppe?: string; wunsch: number; onClose: () => void }) {
  const boards = useBoard((s) => s.boards);
  const spaces = useBoard((s) => s.spaces);
  const activeId = useBoard((s) => s.activeId);
  const liste = useMemo(() => eintraege(eingangBoard(boards)), [boards]);
  const [ziel, setZiel] = useState(activeId);
  const [wahl, setWahl] = useState<Set<string>>(new Set());
  const listeRef = useRef<HTMLUListElement | null>(null);
  // M488: „In Notiz einfügen …" — für welche Einträge die Notiz-Wahl offen ist, und welches ⋯-Menü
  const [notizFuer, setNotizFuer] = useState<string[] | null>(null);
  const [menue, setMenue] = useState<string | null>(null);
  const menueRef = useRef(menue);
  menueRef.current = menue;
  const wahlRef = useRef(notizFuer);
  wahlRef.current = notizFuer;
  const kopfRef = useRef<HTMLDivElement | null>(null);

  // Das Ziel folgt dem offenen Board, solange man es nicht selbst umstellt
  const zielVonHand = useRef(false);
  useEffect(() => { if (!zielVonHand.current) setZiel(activeId); }, [activeId]);
  // Gewählte, die es nicht mehr gibt (eingeholt, gelöscht, abgeglichen), fallen aus der Auswahl
  useEffect(() => {
    setWahl((w) => {
      const da = new Set(liste.map((e) => e.id));
      const neu = new Set([...w].filter((id) => da.has(id)));
      return neu.size === w.size ? w : neu;
    });
  }, [liste]);
  // Leer: nichts zu zeigen
  useEffect(() => { if (liste.length === 0) onClose(); }, [liste.length, onClose]);
  // Aus Strg+K: den gesuchten Eintrag ins Bild holen
  useEffect(() => {
    const el = gruppe ? listeRef.current?.querySelector(`[data-gruppe="${CSS.escape(gruppe)}"]`) as HTMLElement | null : null;
    (el ?? kopfRef.current)?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  }, [gruppe, wunsch]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .search-backdrop')) return;
      // M488: Esc schließt zuerst Menü bzw. Notiz-Wahl, erst dann die Liste
      if (menueRef.current) { setMenue(null); return; }
      if (wahlRef.current) { setNotizFuer(null); return; }
      onClose();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  // Ein offenes ⋯-Menü schließt beim Klick daneben
  useEffect(() => {
    if (!menue) return;
    const weg = (e: PointerEvent) => { if (!(e.target as HTMLElement | null)?.closest?.('.eingang-menue, .eingang-mehr')) setMenue(null); };
    window.addEventListener('pointerdown', weg, true);
    return () => window.removeEventListener('pointerdown', weg, true);
  }, [menue]);

  const zielBoards = useMemo(() => spaces.flatMap((sp) => sp.projects.map((p) => ({
    label: `${sp.name} › ${p.name}`,
    boards: p.boardIds.map((id) => boards.find((b) => b.id === id)).filter((b): b is NonNullable<typeof b> => !!b && (!b.archived || b.id === activeId)),
  }))).filter((g) => g.boards.length), [spaces, boards, activeId]);

  const umschalten = (id: string) => setWahl((w) => { const n = new Set(w); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const holen = (ids: string[]) => { if (eingangHolen(ids, ziel)) setWahl(new Set()); };
  const loeschen = (ids: string[]) => { if (eingangLoeschen(ids)) setWahl(new Set()); };
  const alleGewaehlt = wahl.size === liste.length && liste.length > 0;
  const wahlEinfuegbar = liste.some((e) => wahl.has(e.id) && einfuegbar(e));

  if (!liste.length) return null;
  if (notizFuer) {
    return (
      <NotizWahl
        anzahl={notizFuer.length}
        onZurueck={() => setNotizFuer(null)}
        onClose={onClose}
        onWahl={(id) => { if (eingangInNotiz(notizFuer, id)) { setWahl(new Set()); setNotizFuer(null); } }}
      />
    );
  }
  return (
    <aside className="eingang-panel nodrag" role="dialog" aria-label="Eingang" data-taste="eingang-liste">
      <div className="eingang-kopf" ref={kopfRef} tabIndex={-1}>
        <IEingang size={16} />
        <b>Eingang</b>
        <span className="eingang-zahl">{zahlWort(liste.length, 'Eintrag', 'Einträge')}</span>
        <button className="eingang-x" title="Schließen (Esc)" aria-label="Schließen" onClick={onClose}><IX size={14} /></button>
      </div>
      <label className="eingang-ziel">
        <span>Einsortieren in</span>
        <select value={ziel} data-taste="eingang-ziel" onChange={(e) => { zielVonHand.current = true; setZiel(e.target.value); }}>
          {zielBoards.map((g) => (
            <optgroup key={g.label} label={g.label} translate="no">
              {g.boards.map((b) => <option key={b.id} value={b.id}>{b.id === activeId ? `${b.name} (offen)` : b.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <ul className="eingang-liste" ref={listeRef}>
        {liste.map((e) => {
          const { titel, rest } = texte(e);
          const bild = bildVon(e);
          const an = wahl.has(e.id);
          return (
            <li
              key={e.id}
              className={`eingang-eintrag${an ? ' gewaehlt' : ''}${gruppe === e.id ? ' gesucht' : ''}`}
              data-gruppe={e.id}
              tabIndex={-1}
              draggable
              title="Aufs Board ziehen, um es genau dort abzulegen"
              onDragStart={(ev) => {
                const ids = an ? [...wahl] : [e.id];
                ev.dataTransfer.setData(EINGANG_ZIEHEN, JSON.stringify(ids));
                ev.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={eingangZielWeg}
            >
              <input type="checkbox" checked={an} onChange={() => umschalten(e.id)} aria-label={`„${titel}" auswählen`} data-taste="eingang-wahl" />
              <span className="eingang-vorschau" aria-hidden>
                {bild ? <img src={bild} alt="" /> : e.nodes[0]?.type === 'email' ? <IMail size={18} /> : <IFileText size={18} />}
              </span>
              <span className="eingang-text">
                <span className="eingang-titel" translate="no">{titel}</span>
                {rest && <span className="eingang-rest" translate="no">{rest}</span>}
                <span className="eingang-meta">
                  {herkunftText(e.herkunft)} · {zeitText(e.wann)}{e.nodes.length > 1 ? ` · ${zahlWort(e.nodes.length, 'Karte', 'Karten')}` : ''}
                </span>
              </span>
              <span className="eingang-tun">
                <button onClick={() => holen([e.id])} data-taste="eingang-holen" title="Aufs gewählte Board legen">Aufs Board</button>
                <button className="eingang-weg" onClick={() => loeschen([e.id])} data-taste="eingang-loeschen" title="Löschen" aria-label="Löschen"><ITrash size={14} /></button>
                {einfuegbar(e) && (
                  <button className="eingang-mehr" onClick={() => setMenue(menue === e.id ? null : e.id)} data-taste="eingang-mehr"
                    title="Weitere Aktionen" aria-label="Weitere Aktionen" aria-haspopup="menu" aria-expanded={menue === e.id}>
                    <IMore size={14} />
                  </button>
                )}
              </span>
              {menue === e.id && (
                <div className="eingang-menue" role="menu">
                  <button role="menuitem" data-taste="eingang-in-notiz" onClick={() => { setMenue(null); setNotizFuer([e.id]); }}>In Notiz einfügen …</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="eingang-fuss">
        <label className="eingang-alle">
          <input type="checkbox" checked={alleGewaehlt} onChange={() => setWahl(alleGewaehlt ? new Set() : new Set(liste.map((e) => e.id)))} data-taste="eingang-alle" />
          {wahl.size ? `${zahlWort(wahl.size, 'gewählt', 'gewählt')}` : 'Alle'}
        </label>
        {wahl.size > 0 ? (
          <>
            <button onClick={() => holen([...wahl])} data-taste="eingang-holen-wahl">Aufs Board</button>
            {wahlEinfuegbar && (
              <button onClick={() => setNotizFuer(liste.filter((e) => wahl.has(e.id) && einfuegbar(e)).map((e) => e.id))} data-taste="eingang-in-notiz-wahl"
                title="Die gewählten Einträge in eine Notiz einfügen">In Notiz …</button>
            )}
            <button className="eingang-weg" onClick={() => loeschen([...wahl])} data-taste="eingang-loeschen-wahl">Löschen</button>
          </>
        ) : <span className="eingang-tipp">Einträge lassen sich auch aufs Board ziehen.</span>}
      </div>
    </aside>
  );
}

/**
 * M488: Welche Notiz? Suche über Titel (und Board), die zuletzt bearbeiteten oben. Steht an der Stelle der Liste im
 * selben Fenster — kein weiterer Dialog über dem Board.
 */
function NotizWahl({ anzahl, onWahl, onZurueck, onClose }: { anzahl: number; onWahl: (id: string) => void; onZurueck: () => void; onClose: () => void }) {
  const boards = useBoard((s) => s.boards);
  const activeId = useBoard((s) => s.activeId);
  const [q, setQ] = useState('');
  const alle = useMemo(() => notizenZurWahl(boards, activeId), [boards, activeId]);
  const treffer = useMemo(() => notizSuche(alle, q).slice(0, 60), [alle, q]);
  const feld = useRef<HTMLInputElement | null>(null);
  useEffect(() => { feld.current?.focus({ preventScroll: true }); }, []);
  return (
    <aside className="eingang-panel nodrag" role="dialog" aria-label="In Notiz einfügen" data-taste="eingang-notizwahl">
      <div className="eingang-kopf">
        <button className="eingang-x" onClick={onZurueck} title="Zurück zum Eingang" aria-label="Zurück zum Eingang"><IChevronL size={14} /></button>
        <b>In Notiz einfügen</b>
        <span className="eingang-zahl">{zahlWort(anzahl, 'Eintrag', 'Einträge')}</span>
        <button className="eingang-x" title="Schließen (Esc)" aria-label="Schließen" onClick={onClose}><IX size={14} /></button>
      </div>
      <label className="eingang-ziel">
        <span>Notiz suchen</span>
        <input ref={feld} type="search" value={q} onChange={(e) => setQ(e.target.value)} data-taste="eingang-notiz-suche"
          placeholder="Titel oder Board"
          onKeyDown={(e) => { if (e.key === 'Enter' && treffer[0]) onWahl(treffer[0].id); }} />
      </label>
      <ul className="eingang-liste eingang-notizen">
        {treffer.map((n) => (
          <li key={n.id}>
            <button className="eingang-notiz" data-taste="eingang-notiz" data-notiz={n.id} onClick={() => onWahl(n.id)}>
              <IFileText size={16} />
              <span className="eingang-text">
                <span className="eingang-titel" translate="no">{n.titel}</span>
                <span className="eingang-meta" translate="no">{n.boardId === activeId ? `${n.boardName} (offen)` : n.boardName}</span>
              </span>
            </button>
          </li>
        ))}
        {!treffer.length && <li className="eingang-leer">{alle.length ? 'Keine Notiz passt zur Suche.' : 'Es gibt noch keine Notiz.'}</li>}
      </ul>
    </aside>
  );
}
