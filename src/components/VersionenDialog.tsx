// M449: Versionen eines Boards — frühere Stände ansehen und zurückholen (lib/boardVersionen.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { escDarueber } from '../lib/fensterEsc';
import { useBoard, type Stroke } from '../store';
import { GRUND_TEXT, kartenVergleich, versionenVon, versionLaden, versionLoeschen, versionSichern, type VersionInfo, type VersionStand } from '../lib/boardVersionen';
import { nodeToText } from '../lib/serialize';
import { vorWann, zeitLang, zeitVon } from '../lib/kartenZeit';
import { KartenSymbol } from './KartenSymbol';
import { skizzeVon } from '../lib/vorlagen';
import { sprache, t, zahlWort } from '../lib/sprache';
import type { AppNode } from '../types';
import type { Edge } from '@xyflow/react';
import { IHighlighter, ILink, IPen, IUhr, IX } from './Icons';

/** Menschliche Namen der Kartenarten — für Karten ohne eigene Beschriftung */
const ART_NAME: Record<string, string> = {
  note: 'Notiz', email: 'E-Mail', kanban: 'Kanban', gantt: 'Zeitplan', calendar: 'Kalender', sheet: 'Rechen-Tabelle', file: 'Datei',
  image: 'Bild', frame: 'Rahmen', minutes: 'Protokoll', week: 'Wochenplan', time: 'Zeiterfassung', mermaid: 'Diagramm', portal: 'Portal',
  shape: 'Form', htmlapp: 'App', bubbles: 'Bubbles', kontakt: 'Kontakt', fluessig: 'Flüssige Schrift', pixi: 'Pixi', pdf: 'PDF',
};
/** M460: Titel oder erste Zeile einer Karte (für den Vergleich Karte für Karte) */
function kartenName(n: AppNode): string {
  const d = (n.data ?? {}) as Record<string, unknown>;
  const direkt = ['title', 'name', 'subject', 'text', 'label'].map((k) => (typeof d[k] === 'string' ? (d[k] as string) : '')).find((v) => v.trim());
  if (direkt) return direkt.trim().slice(0, 70);
  let text = '';
  try { text = nodeToText(n).split('\n').find((z) => z.trim()) ?? ''; } catch { /* unbekannte Karte */ }
  return (text.trim() || ART_NAME[n.type ?? ''] || 'Karte').slice(0, 70);
}

/** M470: Name einer Verbindung — „A → B" und ihre Beschriftung */
function pfeilName(e: Edge, karten: Map<string, AppNode>): string {
  const ende = (id: string) => { const n = karten.get(id); return n ? kartenName(n).slice(0, 30) : t('Karte'); };
  const label = String((e.data as { label?: unknown } | undefined)?.label ?? e.label ?? '').trim();
  return `${ende(e.source)} → ${ende(e.target)}${label ? ` (${label.slice(0, 30)})` : ''}`;
}
/** M470: Name eines Strichs — Werkzeug und, falls an einer Karte, deren Name */
function strichName(s: Stroke, karten: Map<string, AppNode>): string {
  const art = t(s.tool === 'marker' ? 'Marker-Strich' : 'Stift-Strich');
  const an = s.anchor ? karten.get(s.anchor) : undefined;
  return an ? `${art} an „${kartenName(an).slice(0, 30)}“` : art;
}

const zeitFormat = () => new Intl.DateTimeFormat(sprache() === 'en' ? 'en-GB' : 'de-DE', {
  weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const kurzFormat = () => new Intl.DateTimeFormat(sprache() === 'en' ? 'en-GB' : 'de-DE', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** Karten in Rahmen liegen relativ zum Rahmen — für die Skizze auf die Fläche umrechnen */
function absolut(nodes: AppNode[]): AppNode[] {
  const nach = new Map(nodes.map((n) => [n.id, n]));
  const lage = (n: AppNode, tiefe = 0): { x: number; y: number } => {
    const p = n.parentId ? nach.get(n.parentId) : undefined;
    if (!p || tiefe > 8) return n.position;
    const o = lage(p, tiefe + 1);
    return { x: o.x + n.position.x, y: o.y + n.position.y };
  };
  return nodes.filter((n) => !n.hidden).map((n) => ({ ...n, position: lage(n) }));
}

function Skizze({ stand }: { stand: VersionStand }) {
  const { teile, verhaeltnis } = useMemo(() => skizzeVon({ nodes: absolut(stand.nodes), edges: stand.edges }), [stand]);
  const B = 320, H = 200, R = 10;
  const b = Math.min(B - 2 * R, (H - 2 * R) * verhaeltnis), hh = b / verhaeltnis;
  const x0 = (B - b) / 2, y0 = (H - hh) / 2;
  return (
    <svg className="vorlage-skizze versionen-skizze" viewBox={`0 0 ${B} ${H}`} role="img" aria-label="Vorschau des Standes" data-taste="versionen-skizze" data-teile={teile.length}>
      {teile.map((t, i) => (
        <rect key={i} x={x0 + t.x * b} y={y0 + t.y * hh} width={Math.max(3, t.w * b)} height={Math.max(3, t.h * hh)} rx={3}
          fill={t.farbe} className={t.art === 'frame' ? 'sk-rahmen' : 'sk-karte'} />
      ))}
    </svg>
  );
}

export function VersionenDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const board = useBoard((s) => s.boards.find((b) => b.id === boardId));
  const [liste, setListe] = useState<VersionInfo[] | null>(null);
  const [wahl, setWahl] = useState<string | null>(null);
  const [stand, setStand] = useState<VersionStand | null>(null);
  const [frage, setFrage] = useState<false | 'ersetzen' | 'loeschen'>(false);
  const [busy, setBusy] = useState(false);
  /** M470: Auswahl in „Seitdem" — Schlüssel `k:<Karte>`, `p:<Verbindung>`, `s:<Strich>` */
  const [auswahl, setAuswahl] = useState<Set<string>>(() => new Set());
  const zu = useRef<HTMLButtonElement>(null);
  const lesen = board?.geteiltRolle === 'lesen';

  const laden = async (waehle?: string) => {
    const l = await versionenVon(boardId);
    setListe(l);
    setWahl((alt) => waehle ?? (alt && l.some((v) => v.id === alt) ? alt : l[0]?.id ?? null));
  };
  useEffect(() => { void laden(); }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFrage(false);
    setStand(null);
    setAuswahl(new Set());
    if (!wahl) return;
    let aktiv = true;
    void versionLaden(wahl).then((s) => { if (aktiv) setStand(s); });
    return () => { aktiv = false; };
  }, [wahl]);

  useEffect(() => {
    zu.current?.focus();
    // M534: Liegt ein anderes Fenster darüber (Alt+H, Alt+E, Strg+K), gehört Esc ihm
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !escDarueber(zu.current, e)) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const info = liste?.find((v) => v.id === wahl);
  /** Was sich gegenüber jetzt ändern würde: Karten, die zurückkämen bzw. verschwänden */
  const unterschied = useMemo(() => {
    if (!stand || !board) return null;
    const jetzt = new Set(board.nodes.map((n) => n.id));
    const dann = new Set(stand.nodes.map((n) => n.id));
    return {
      zurueck: stand.nodes.filter((n) => !jetzt.has(n.id)).length,
      weg: board.nodes.filter((n) => !dann.has(n.id)).length,
    };
  }, [stand, board]);
  /** M460: Karte für Karte — was ist seitdem neu, gelöscht, geändert */
  const vergleich = useMemo(() => (stand && board ? kartenVergleich(stand, board.nodes, board.edges, board.drawings ?? []) : null), [stand, board]);
  /** M470: Namen der Karten für Pfeile und Striche — jetzt oder damals */
  const kartenNach = useMemo(() => new Map([...(stand?.nodes ?? []), ...(board?.nodes ?? [])].map((n) => [n.id, n])), [stand, board]);
  const jetztDa = useMemo(() => new Set((board?.nodes ?? []).map((n) => n.id)), [board]);
  /** M470: Wählbares in „Seitdem" (gelöscht oder geändert), für „alle" und zum Aufräumen der Auswahl */
  const waehlbar = useMemo(() => {
    if (!vergleich) return [] as string[];
    return [
      ...vergleich.geloescht.map((n) => `k:${n.id}`), ...vergleich.geaendert.map((x) => `k:${x.dann.id}`),
      ...vergleich.pfeileGeloescht.map((e) => `p:${e.id}`), ...vergleich.pfeileGeaendert.map((x) => `p:${x.dann.id}`),
      ...vergleich.stricheGeloescht.map((s) => `s:${s.id}`), ...vergleich.stricheGeaendert.map((x) => `s:${x.dann.id}`),
    ];
  }, [vergleich]);
  // Was nach dem Zurückholen nicht mehr in der Liste steht, fällt aus der Auswahl
  useEffect(() => {
    setAuswahl((alt) => {
      const da = new Set(waehlbar);
      const neu = new Set([...alt].filter((k) => da.has(k)));
      return neu.size === alt.size ? alt : neu;
    });
  }, [waehlbar]);
  /** M470: Eine Verbindung geht nur zurück, wenn beide Karten da sind oder mit zurückgeholt werden */
  const endeDa = (id: string, mit: Set<string>) => jetztDa.has(id) || mit.has(`k:${id}`);
  const pfeilGeht = (e: Edge, mit: Set<string> = auswahl) => endeDa(e.source, mit) && endeDa(e.target, mit);
  const strichGeht = (s: Stroke, mit: Set<string> = auswahl) => !s.anchor || endeDa(s.anchor, mit);
  const umschalten = (k: string) => setAuswahl((alt) => {
    const neu = new Set(alt);
    if (neu.has(k)) neu.delete(k); else neu.add(k);
    return neu;
  });

  /** M470: Karten, Verbindungen und Striche in EINEM Schritt zurückholen (ein Strg+Z) */
  const zurueckholen = (schluessel: string[], name?: string) => {
    if (!stand || !board) return;
    const st = useBoard.getState();
    const von = (art: string) => schluessel.filter((k) => k.startsWith(`${art}:`)).map((k) => k.slice(2));
    const erg = st.kartenZurueckholen(boardId, von('k'), stand, { pfeile: von('p'), striche: von('s') });
    const summe = erg.karten + erg.pfeile + erg.striche;
    if (!summe) { st.showToast(t('Nichts zurückgeholt – die Karten an den Enden fehlen.')); return; }
    setAuswahl(new Set());
    if (summe === 1 && name) { st.showToast(`„${name}" zurückgeholt – Strg+Z nimmt es zurück.`, false, 6000); return; }
    if (summe === erg.karten) { st.showToast(`${erg.karten} Karten zurückgeholt – Strg+Z nimmt es zurück.`, false, 6000); return; }
    const teile = [
      erg.karten ? zahlWort(erg.karten, 'Karte', 'Karten') : '',
      erg.pfeile ? zahlWort(erg.pfeile, 'Verbindung', 'Verbindungen') : '',
      erg.striche ? zahlWort(erg.striche, 'Strich', 'Striche') : '',
    ].filter(Boolean).join(', ');
    st.showToast(t('{0} zurückgeholt – Strg+Z nimmt es zurück.').replace('{0}', teile), false, 6000);
  };
  /** M470: Häkchen vor einer Zeile (nur, wo sich etwas zurückholen lässt) */
  const haken = (k: string, geht = true) => (lesen ? null : (
    <input type="checkbox" className="vv-wahl" data-taste="vergleich-wahl" checked={auswahl.has(k)} disabled={busy || (!geht && !auswahl.has(k))}
      aria-label={t('Für „Auswahl zurückholen" vormerken')} onChange={() => umschalten(k)} />
  ));
  const auswahlGeht = [...auswahl].filter((k) => {
    if (k.startsWith('p:')) { const e = [...(vergleich?.pfeileGeloescht ?? []), ...(vergleich?.pfeileGeaendert.map((x) => x.dann) ?? [])].find((x) => x.id === k.slice(2)); return !!e && pfeilGeht(e); }
    if (k.startsWith('s:')) { const s = [...(vergleich?.stricheGeloescht ?? []), ...(vergleich?.stricheGeaendert.map((x) => x.dann) ?? [])].find((x) => x.id === k.slice(2)); return !!s && strichGeht(s); }
    return true;
  });
  const OHNE_ENDE = 'Erst die Karten an den Enden zurückholen (oder mit auswählen)';

  const loeschen = async () => {
    if (!info) return;
    setBusy(true);
    const weg = await versionLoeschen(boardId, info.id);
    setBusy(false);
    setFrage(false);
    if (weg) useBoard.getState().showToast(`Version vom ${kurzFormat().format(info.at)} gelöscht.`);
    const l = await versionenVon(boardId);
    setListe(l);
    setWahl(l[0]?.id ?? null);
  };

  const sichernJetzt = async () => {
    if (!board) return;
    setBusy(true);
    const v = await versionSichern(board, 'manuell');
    setBusy(false);
    const st = useBoard.getState();
    if (v === 'gleich') st.showToast('Dieser Stand ist schon gesichert.');
    else if (v) st.showToast('Stand gesichert.');
    else st.showToast('Ein leeres Board wird nicht gesichert.');
    await laden(v && v !== 'gleich' ? v.id : undefined);
  };

  const wiederherstellen = async () => {
    if (!board || !stand || !info) return;
    setBusy(true);
    // Der jetzige Stand geht nicht verloren: erst sichern, dann einsetzen (zusätzlich ein Strg+Z-Schritt)
    await versionSichern(useBoard.getState().boards.find((b) => b.id === boardId), 'wiederherstellen');
    const st = useBoard.getState();
    if (st.standEinsetzen(boardId, stand)) {
      st.showToast(`Stand vom ${kurzFormat().format(info.at)} wiederhergestellt – Strg+Z nimmt es zurück.`, false, 7000);
      window.dispatchEvent(new CustomEvent('pixinotes:einpassen'));
      onClose();
    }
    setBusy(false);
  };

  const alsKopie = () => {
    if (!board || !stand || !info) return;
    const st = useBoard.getState();
    const name = `${board.name} (Stand ${kurzFormat().format(info.at)})`;
    if (st.standEinsetzen(boardId, stand, name)) {
      st.showToast(`Kopie „${name}" angelegt – das Original bleibt, wie es ist.`, false, 6000);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal versionen-dialog" role="dialog" aria-modal="true" aria-label="Versionen" data-taste="versionen-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Versionen {board && <small translate="no">„{board.name}"</small>}</h2>
          <button ref={zu} className="modal-x" onClick={onClose} aria-label="Schließen"><IX size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="versionen-text">
            PixiNotes sichert dieses Board selbst: beim Verlassen, alle 10 Minuten, wenn sich etwas geändert hat, und vor Abgleich, Import, KI-Umbau und großen Änderungen anderer. Ältere Stände werden ausgedünnt (einer je Stunde, später einer je Tag).
          </p>
          {liste && !liste.length ? (
            <p className="versionen-leer" data-taste="versionen-leer">Noch keine Versionen. Die erste entsteht, sobald du das Board änderst.</p>
          ) : (
            <div className="versionen-teile">
              <ul className="versionen-liste" role="listbox" aria-label="Gesicherte Stände" data-taste="versionen-liste">
                {(liste ?? []).map((v) => (
                  <li key={v.id}>
                    <button role="option" aria-selected={v.id === wahl} className={v.id === wahl ? 'aktiv' : ''}
                      data-taste="version" data-karten={v.karten} data-grund={v.grund} onClick={() => setWahl(v.id)}>
                      <b translate="no">{zeitFormat().format(v.at)}</b>
                      <small>{v.karten === 1 ? '1 Karte' : `${v.karten} Karten`} · {GRUND_TEXT[v.grund] ?? v.grund}</small>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="versionen-vorschau">
                {stand && info ? (
                  <>
                    <Skizze stand={stand} />
                    <p className="versionen-zahlen" data-taste="versionen-zahlen">
                      {info.karten === 1 ? '1 Karte' : `${info.karten} Karten`}, {info.pfeile === 1 ? '1 Verbindung' : `${info.pfeile} Verbindungen`}
                      {unterschied && (unterschied.zurueck || unterschied.weg) ? (
                        <> · gegenüber jetzt: {unterschied.zurueck ? `${unterschied.zurueck} kämen zurück` : ''}{unterschied.zurueck && unterschied.weg ? ', ' : ''}{unterschied.weg ? `${unterschied.weg} fielen weg` : ''}</>
                      ) : null}
                    </p>
                    {vergleich && (vergleich.neu.length + waehlbar.length) > 0 && (
                      <div className="versionen-vergleich" data-taste="versionen-vergleich">
                        <div className="vv-kopf">
                          <h3>Seitdem</h3>
                          {!lesen && waehlbar.length > 1 && (
                            <label className="vv-alle">
                              <input type="checkbox" data-taste="vergleich-alle" disabled={busy} checked={waehlbar.every((k) => auswahl.has(k))}
                                onChange={(e) => setAuswahl(e.target.checked ? new Set(waehlbar) : new Set())} /> alle
                            </label>
                          )}
                          {!lesen && auswahl.size > 0 && (
                            <button className="versionen-haupt" disabled={busy || !auswahlGeht.length} onClick={() => zurueckholen(auswahlGeht)} data-taste="auswahl-zurueckholen"
                              data-anzahl={auswahlGeht.length} title="Alles Angehakte in einem Schritt zurückholen – ein Strg+Z nimmt es zurück">
                              {t('Auswahl zurückholen ({0})').replace('{0}', String(auswahlGeht.length))}
                            </button>
                          )}
                        </div>
                        <ul>
                          {vergleich.geloescht.map((n) => (
                            <li key={`g-${n.id}`} data-taste="vergleich-karte" data-art="geloescht" data-id={n.id}>
                              {haken(`k:${n.id}`)}
                              <KartenSymbol art={n.type} size={14} aria-hidden="true" />
                              <span className="vv-titel" translate="no">{kartenName(n)}</span>
                              <small>gelöscht</small>
                              {!lesen && <button disabled={busy} onClick={() => zurueckholen([`k:${n.id}`], kartenName(n))} data-taste="karte-zurueckholen"
                                title="Diese Karte aus dem Stand zurück aufs Board legen">Zurückholen</button>}
                            </li>
                          ))}
                          {vergleich.geaendert.map(({ dann, jetzt }) => {
                            const z = zeitVon(jetzt);
                            return (
                              <li key={`a-${dann.id}`} data-taste="vergleich-karte" data-art="geaendert" data-id={dann.id}>
                                {haken(`k:${dann.id}`)}
                                <KartenSymbol art={jetzt.type} size={14} aria-hidden="true" />
                                <span className="vv-titel" translate="no">{kartenName(jetzt)}</span>
                                <small title={z ? zeitLang(z) : undefined}>{z ? `geändert ${vorWann(z)}` : 'geändert'}</small>
                                {!lesen && <button disabled={busy} onClick={() => zurueckholen([`k:${dann.id}`], kartenName(dann))} data-taste="karte-zurueckholen"
                                  title="Den Inhalt von damals zurückholen – Lage und Größe bleiben">Zurückholen</button>}
                              </li>
                            );
                          })}
                          {[...vergleich.pfeileGeloescht.map((e) => ({ e, art: 'geloescht' as const })), ...vergleich.pfeileGeaendert.map((x) => ({ e: x.dann, art: 'geaendert' as const }))].map(({ e, art }) => {
                            const geht = pfeilGeht(e);
                            const name = pfeilName(e, kartenNach);
                            return (
                              <li key={`p-${e.id}`} data-taste="vergleich-pfeil" data-art={art} data-id={e.id} data-geht={geht ? '1' : '0'}>
                                {haken(`p:${e.id}`, geht)}
                                <ILink size={14} aria-hidden="true" />
                                <span className="vv-titel" translate="no">{name}</span>
                                <small>{art === 'geloescht' ? 'Verbindung gelöscht' : 'Verbindung geändert'}</small>
                                {!lesen && <button disabled={busy || !pfeilGeht(e, new Set())} onClick={() => zurueckholen([`p:${e.id}`], name)} data-taste="pfeil-zurueckholen"
                                  title={pfeilGeht(e, new Set()) ? 'Diese Verbindung aus dem Stand zurückholen' : t(OHNE_ENDE)}>Zurückholen</button>}
                              </li>
                            );
                          })}
                          {[...vergleich.stricheGeloescht.map((s) => ({ s, art: 'geloescht' as const })), ...vergleich.stricheGeaendert.map((x) => ({ s: x.dann, art: 'geaendert' as const }))].map(({ s, art }) => {
                            const geht = strichGeht(s);
                            const name = strichName(s, kartenNach);
                            return (
                              <li key={`s-${s.id}`} data-taste="vergleich-strich" data-art={art} data-id={s.id} data-geht={geht ? '1' : '0'}>
                                {haken(`s:${s.id}`, geht)}
                                {s.tool === 'marker' ? <IHighlighter size={14} aria-hidden="true" /> : <IPen size={14} aria-hidden="true" />}
                                <span className="vv-titel" translate="no">{name}</span>
                                <small>{art === 'geloescht' ? 'gelöscht' : 'geändert'}</small>
                                {!lesen && <button disabled={busy || !strichGeht(s, new Set())} onClick={() => zurueckholen([`s:${s.id}`], name)} data-taste="strich-zurueckholen"
                                  title={strichGeht(s, new Set()) ? 'Diesen Strich aus dem Stand zurückholen' : 'Erst die Karte zurückholen, an der der Strich hängt (oder mit auswählen)'}>Zurückholen</button>}
                              </li>
                            );
                          })}
                          {vergleich.neu.map((n) => (
                            <li key={`n-${n.id}`} data-taste="vergleich-karte" data-art="neu" data-id={n.id}>
                              <KartenSymbol art={n.type} size={14} aria-hidden="true" />
                              <span className="vv-titel" translate="no">{kartenName(n)}</span>
                              <small>neu</small>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {frage === 'loeschen' ? (
                      <div className="versionen-frage" role="alert">
                        <p>Diese Version wird gelöscht. Das Board und die anderen Versionen bleiben, wie sie sind.</p>
                        <div className="versionen-knoepfe">
                          <button className="versionen-haupt" disabled={busy} onClick={() => void loeschen()} data-taste="version-loeschen-ja">Ja, löschen</button>
                          <button disabled={busy} onClick={() => setFrage(false)}>Abbrechen</button>
                        </div>
                      </div>
                    ) : frage ? (
                      <div className="versionen-frage" role="alert">
                        <p>Das Board bekommt diesen Stand. Der jetzige wird vorher als Version gesichert, und Strg+Z nimmt es zurück.</p>
                        <div className="versionen-knoepfe">
                          <button className="versionen-haupt" disabled={busy} onClick={() => void wiederherstellen()} data-taste="version-ersetzen-ja">Ja, wiederherstellen</button>
                          <button disabled={busy} onClick={() => setFrage(false)}>Abbrechen</button>
                        </div>
                      </div>
                    ) : (
                      <div className="versionen-knoepfe">
                        <button className="versionen-haupt" disabled={busy || lesen} onClick={() => setFrage('ersetzen')} data-taste="version-wiederherstellen"
                          title={lesen ? 'Nur zum Lesen freigegeben – als Kopie öffnen geht' : 'Dieses Board auf den Stand zurücksetzen'}>Wiederherstellen …</button>
                        <button disabled={busy} onClick={alsKopie} data-taste="version-kopie" title="Den Stand als neues Board daneben öffnen">Als Kopie öffnen</button>
                        <button className="versionen-leise" disabled={busy} onClick={() => setFrage('loeschen')} data-taste="version-loeschen"
                          title="Diese Version aus der Liste löschen">Löschen …</button>
                      </div>
                    )}
                  </>
                ) : wahl ? <p className="versionen-leer">Lädt …</p> : null}
              </div>
            </div>
          )}
          <div className="versionen-fuss">
            <button disabled={busy || !board} onClick={() => void sichernJetzt()} data-taste="version-sichern"><IUhr size={14} /> Stand jetzt sichern</button>
            {liste && <small>{liste.length === 1 ? '1 Version' : `${liste.length} Versionen`} · nur auf diesem Gerät</small>}
          </div>
        </div>
      </div>
    </div>
  );
}
