import { useEffect, useMemo, useState } from 'react';
import { useBoard } from '../store';
import { alsDateien, geteiltMarkeAbholen, leseGeteiltes, loescheGeteiltes, type Geteiltes } from '../lib/geteilt';
import { importFilesToBoard } from '../lib/importFiles';
import { makeNote } from '../lib/nodes';
import { notizBildHochladen } from '../lib/notizBild';
import { nodeToText } from '../lib/serialize';
import { IX } from './Icons';

/**
 * M290: „Teilen mit … PixiNotes" (Android).
 *
 * Android reicht Geteiltes an den Service Worker weiter (siehe public/sw.js),
 * der es in der Geräte-Ablage hinterlegt und die App öffnet. Hier wird
 * gefragt, WOHIN es soll — genau das war der Wunsch: nicht blind auf dem
 * zuletzt geöffneten Board landen, sondern Ziel und Form selbst bestimmen.
 *
 * Zwei Formen stehen zur Wahl, und beide gibt es in PixiNotes schon:
 *  - als KARTEN auf einem Board (dieselbe Pipeline wie Ablegen per Drag &
 *    Drop: Bilder werden Bild-Karten, PDFs bekommen eine Vorschau, .ics wandert
 *    in den Kalender …),
 *  - in eine bestehende NOTIZ (M289) — Bilder in den Text, Text als Absatz.
 *
 * Auf iPhone und iPad erscheint PixiNotes NICHT im Teilen-Menü: Safari kennt
 * das Web Share Target nicht, und das kann keine Anwendung von sich aus
 * ändern. Dort bleibt der Weg über „Kopieren" in der Fotos-App und das
 * Einfügen hier (Dock → ＋ → „Aus Zwischenablage einfügen" bzw. der Bild-Chip
 * in der Notiz).
 */
export function GeteiltDialog() {
  const [gabe, setGabe] = useState<Geteiltes | null>(null);
  const boards = useBoard((s) => s.boards);
  const spaces = useBoard((s) => s.spaces);
  const activeId = useBoard((s) => s.activeId);
  const openBoard = useBoard((s) => s.openBoard);
  const setView = useBoard((s) => s.setView);
  const addNode = useBoard((s) => s.addNode);
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  const [zielBoard, setZielBoard] = useState(activeId);
  const [form, setForm] = useState<'karten' | 'notiz'>('karten');
  const [zielNotiz, setZielNotiz] = useState<string>('');
  const [laeuft, setLaeuft] = useState(false);

  /* Beim Start nachsehen, ob etwas im Eingang liegt. Der Umweg über die
     Adressmarke („?geteilt=1") ist Absicht: Ohne sie würde ein alter,
     liegengebliebener Eingang bei jedem Start wieder aufpoppen. */
  useEffect(() => {
    const marke = geteiltMarkeAbholen();
    void leseGeteiltes().then((g) => {
      if (!g) return;
      // Ohne Marke nur übernehmen, was frisch ist (max. 5 Minuten alt)
      const frisch = Date.now() - new Date(g.wann).getTime() < 5 * 60_000;
      if (marke || frisch) setGabe(g);
      else void loescheGeteiltes();
    });
  }, []);

  const notizen = useMemo(
    () => (boards.find((b) => b.id === zielBoard)?.nodes ?? []).filter((n) => n.type === 'note'),
    [boards, zielBoard],
  );
  useEffect(() => { setZielNotiz(notizen[0]?.id ?? ''); }, [notizen]);

  if (!gabe) return null;

  const dateien = alsDateien(gabe);
  const nurBilder = dateien.length > 0 && dateien.every((d) => (d.type || '').startsWith('image/'));
  const textTeil = [gabe.titel, gabe.text, gabe.adresse].filter(Boolean).join('\n');

  const schliessen = () => { setGabe(null); void loescheGeteiltes(); };

  /** Freier Platz unter dem, was schon auf dem Board liegt */
  const platz = (boardId: string) => {
    const nodes = boards.find((b) => b.id === boardId)?.nodes ?? [];
    if (nodes.length === 0) return { x: 80, y: 80 };
    const unten = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 200)));
    const links = Math.min(...nodes.map((n) => n.position.x));
    return { x: links, y: unten + 60 };
  };

  const uebernehmen = async () => {
    setLaeuft(true);
    try {
      setView('board');
      openBoard(zielBoard);
      if (form === 'notiz' && zielNotiz) {
        await inNotiz();
      } else {
        await aufsBoard();
      }
      schliessen();
    } finally {
      setLaeuft(false);
    }
  };

  const aufsBoard = async () => {
    const pos = platz(zielBoard);
    let gesetzt = 0;
    if (dateien.length) gesetzt += await importFilesToBoard(dateien, pos);
    if (textTeil) {
      addNode(makeNote({ x: pos.x + (gesetzt ? 300 : 0), y: pos.y }, {
        blocks: textTeil.split('\n').map((zeile) => ({
          type: 'paragraph',
          content: zeile ? [{ type: 'text', text: zeile, styles: {} }] : [],
        })),
      }));
      gesetzt++;
    }
    showToast(gesetzt > 0
      ? `Geteiltes übernommen — ${gesetzt} Karte(n) auf „${boards.find((b) => b.id === zielBoard)?.name}".`
      : 'Es war nichts Übernehmbares dabei.');
  };

  const inNotiz = async () => {
    const notiz = notizen.find((n) => n.id === zielNotiz);
    if (!notiz) return;
    const blocks = [...((notiz.data.blocks as unknown[] | undefined) ?? [])];
    let bilder = 0;
    const abgelehnt: string[] = [];
    for (const d of dateien) {
      if (!(d.type || '').startsWith('image/')) { abgelehnt.push(d.name); continue; }
      try {
        const url = await notizBildHochladen(d);
        blocks.push({ type: 'image', props: { url, name: d.name } });
        bilder++;
      } catch { /* notizBildHochladen hat den Grund schon gesagt */ }
    }
    for (const zeile of textTeil.split('\n').filter(Boolean)) {
      blocks.push({ type: 'paragraph', content: [{ type: 'text', text: zeile, styles: {} }] });
    }
    updateNodeData(notiz.id, {
      blocks,
      // M170: Der lebende Editor liest den Inhalt sonst nur beim Mount
      extEpoch: ((notiz.data.extEpoch as number | undefined) ?? 0) + 1,
    });
    /* Was nicht in eine Notiz gehört, geht nicht verloren — es wird eine Karte
       auf demselben Board (dieselbe Regel wie beim Ablegen, M289). */
    if (abgelehnt.length) {
      await importFilesToBoard(dateien.filter((d) => abgelehnt.includes(d.name)), platz(zielBoard));
      showToast(`${bilder} Bild(er) in die Notiz — ${abgelehnt.length} andere Datei(en) als Karte aufs Board.`);
    } else {
      showToast(`Geteiltes in die Notiz „${(nodeToText(notiz).split('\n')[0] || 'Notiz').slice(0, 30)}" übernommen.`);
    }
  };

  return (
    <div className="modal-backdrop" onClick={schliessen}>
      <div className="modal geteilt-modal" role="dialog" aria-modal="true" aria-label="Geteiltes übernehmen" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Von einer anderen App geteilt</b>
          <button className="modal-x" onClick={schliessen} aria-label="Verwerfen"><IX size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="geteilt-vorschau">
            {dateien.map((d) => (
              <div key={d.name + d.size} className="geteilt-stueck">
                {(d.type || '').startsWith('image/')
                  ? <img src={URL.createObjectURL(d)} alt="" />
                  : <span className="geteilt-symbol" aria-hidden>📄</span>}
                <span className="geteilt-name">{d.name}</span>
              </div>
            ))}
            {textTeil && <div className="geteilt-text">{textTeil}</div>}
            {!dateien.length && !textTeil && <div className="geteilt-text">Es ist nichts angekommen.</div>}
          </div>

          <label className="geteilt-zeile">
            <span>Wohin?</span>
            <select value={zielBoard} onChange={(e) => setZielBoard(e.target.value)}>
              {spaces.flatMap((sp) => sp.projects.map((p) => (
                <optgroup key={p.id} label={`${sp.name} › ${p.name}`}>
                  {p.boardIds
                    .map((id) => boards.find((b) => b.id === id))
                    .filter((b): b is NonNullable<typeof b> => !!b && !b.archived)
                    .map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </optgroup>
              )))}
            </select>
          </label>

          <div className="geteilt-zeile geteilt-form">
            <span>Als was?</span>
            <div className="geteilt-wahl">
              <label>
                <input type="radio" checked={form === 'karten'} onChange={() => setForm('karten')} />
                Karten auf dem Board
              </label>
              <label className={notizen.length === 0 ? 'aus' : ''}>
                <input
                  type="radio"
                  checked={form === 'notiz'}
                  disabled={notizen.length === 0}
                  onChange={() => setForm('notiz')}
                />
                In eine Notiz einfügen
              </label>
            </div>
          </div>

          {form === 'notiz' && (
            <label className="geteilt-zeile">
              <span>Welche Notiz?</span>
              <select value={zielNotiz} onChange={(e) => setZielNotiz(e.target.value)}>
                {notizen.map((n) => (
                  <option key={n.id} value={n.id}>
                    {(nodeToText(n).split('\n').find((z) => z.trim()) ?? 'Leere Notiz').slice(0, 50)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {form === 'notiz' && !nurBilder && dateien.length > 0 && (
            <div className="geteilt-hinweis">
              In die Notiz wandern nur Bilder — alles andere wird eine Datei-Karte auf demselben Board.
            </div>
          )}
        </div>
        <div className="modal-foot geteilt-foot">
          <button className="geteilt-verwerfen" onClick={schliessen}>Verwerfen</button>
          <button className="geteilt-ok" onClick={() => void uebernehmen()} disabled={laeuft}>
            {laeuft ? 'Übernehme …' : 'Übernehmen'}
          </button>
        </div>
      </div>
    </div>
  );
}
