import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { HtmlAppNode } from '../../types';
import { composeSrcdoc, htmlUebernehmen, loadAppState, loadAppStateAt, loadHtml, saveAppState, saveHtml } from '../../lib/htmlStore';
import { kontoDateiNachladen } from '../../lib/kontoSync';
import { appMelden, EINGABE_EREIGNIS, eingabeAus, eingabeMelden, eingabenErbitten, folgeIch, ROLL_EREIGNIS, rollMelden, rollVergessen, VORFUEHR_EREIGNIS, werFuehrtVor, type Eingabe, type Roll } from '../../lib/vorfuehren';
import { loadAppStateFromTeam, loadAttachment, saveAppStateToTeam } from '../../lib/attachments';
import { triggerDownload } from '../../lib/download';
import { fremdeWebAdresse } from '../../lib/sicher';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
import { useRandLeiste } from '../../lib/randLeiste';
import { IAppWindow, ICloud, ICopy, IDownload, IMaximize, IMinimize, IMore, IPlay, IReload, IStopSq } from '../Icons';

/**
 * Sandbox OHNE allow-same-origin — die Sicherheits-Grundentscheidung:
 * Die App kann JavaScript, Formulare, Dialoge, Downloads … nutzen, aber sie
 * läuft unter einer fremden („opaken") Herkunft und kommt damit prinzipbedingt
 * NICHT an den PixiNotes-Speicher, die Sync-Zugangsdaten oder das Board-DOM.
 * localStorage stellt der injizierte Shim bereit (htmlStore, pro Karte).
 */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads';
/** Live-Modus (M164): FREMDE URLs dürfen allow-same-origin bekommen — sie
 *  laufen unter IHRER Herkunft, und die Same-Origin-Policy des Browsers hält
 *  sie von PixiNotes fern. So funktioniert deren eigener localStorage normal.
 *  Für Inhalte UNSERER Herkunft wäre das gefährlich — deshalb lehnt der
 *  URL-Import gleichnamige Herkunft ab und die Karte startet sie nicht. */
const SANDBOX_LIVE = `${SANDBOX} allow-same-origin`;
/** M388: Ein Speicherstand ist eine flache Liste aus Texten — höchstens 5 MB */
function speicherGueltig(store: unknown): store is Record<string, string> {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return false;
  let summe = 0;
  for (const [k, v] of Object.entries(store as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
    summe += k.length + v.length;
    if (summe > 5_000_000) return false;
  }
  return true;
}

/**
 * M371: Den Quelltext eines eigenen Tools auf dieses Gerät holen. Er reist seit M371 mit dem Board — über das
 * Konto, über den Link eines Gastes, über den kurzen Link — und liegt dann als Anhang in der Datei-Ablage
 * (oder, wenn er groß ist, noch im Konto). Davor: die Kopie im Team-Ordner (M159).
 */
async function quelleHolen(id: string, teamRef?: string): Promise<boolean> {
  try {
    if (await htmlUebernehmen(id)) return true;
    if (teamRef) {
      const f = await loadAttachment(teamRef);
      if (f) { await saveHtml(id, await f.text()); return true; }
    }
    if (await kontoDateiNachladen(id).catch(() => null)) return htmlUebernehmen(id);
  } catch { /* fehlt */ }
  return false;
}

/** Alle Bauteile, die am Vorführen hängen, zeichnen neu, wenn sich dort etwas tut */
function useVorfuehrTakt(): void {
  const [, takt] = useState(0);
  useEffect(() => {
    const auf = () => takt((n) => n + 1);
    window.addEventListener(VORFUEHR_EREIGNIS, auf);
    return () => window.removeEventListener(VORFUEHR_EREIGNIS, auf);
  }, []);
}

/**
 * M371: Mitrollen. Das laufende Tool meldet (über die Brücke in lib/htmlStore.ts), wohin gerollt wurde — führe
 * ich vor, geht das ans Team; folge ich, rollt mein Tool dorthin, wohin der Vorführende gerollt hat.
 */
function useMitrollen(boardId: string, id: string, frame: RefObject<HTMLIFrameElement | null>, laeuft: boolean): void {
  useEffect(() => {
    if (!laeuft) return;
    const vomTool = (e: MessageEvent) => {
      const d = e.data as { __pixiHapp?: string; roll?: Partial<Roll>; ein?: unknown } | null;
      if (d?.__pixiHapp !== id || e.source !== frame.current?.contentWindow) return;
      // M384: eine Eingabe im Tool — führe ich vor, geht sie ans Team
      if (d.ein) { const ein = eingabeAus(d.ein); if (ein) eingabeMelden(boardId, id, ein); return; }
      const r = d.roll;
      if (!r) return;
      if (typeof r.p !== 'string' || r.p.length > 200 || !(typeof r.x === 'number' && r.x >= 0 && r.x <= 1) || !(typeof r.y === 'number' && r.y >= 0 && r.y <= 1)) return;
      rollMelden(boardId, id, { p: r.p, x: r.x, y: r.y });
    };
    const vomTeam = (e: Event) => {
      const d = (e as CustomEvent<{ boardId: string; karte: string; roll: Roll }>).detail;
      if (d?.boardId !== boardId || d.karte !== id) return;
      frame.current?.contentWindow?.postMessage({ __pixiRoll: id, roll: d.roll }, '*');
    };
    // M384: Eingaben des Vorführenden — mein Tool stellt sie nach
    const eingabenVomTeam = (e: Event) => {
      const d = (e as CustomEvent<{ boardId: string; karte: string; liste: Eingabe[] }>).detail;
      if (d?.boardId !== boardId || d.karte !== id) return;
      frame.current?.contentWindow?.postMessage({ __pixiEin: id, ein: d.liste }, '*');
    };
    // Beginnt jemand vorzuführen, während mein Tool schon läuft: seine Feldwerte holen
    let folgte = folgeIch(boardId);
    const vorfuehrWechsel = () => {
      const f = folgeIch(boardId);
      if (f && !folgte) eingabenErbitten(boardId, id);
      folgte = f;
    };
    window.addEventListener('message', vomTool);
    window.addEventListener(ROLL_EREIGNIS, vomTeam);
    window.addEventListener(EINGABE_EREIGNIS, eingabenVomTeam);
    window.addEventListener(VORFUEHR_EREIGNIS, vorfuehrWechsel);
    return () => { window.removeEventListener('message', vomTool); window.removeEventListener(ROLL_EREIGNIS, vomTeam); window.removeEventListener(EINGABE_EREIGNIS, eingabenVomTeam); window.removeEventListener(VORFUEHR_EREIGNIS, vorfuehrWechsel); };
  }, [boardId, id, frame, laeuft]);
}
/** Wer dazukommt, während schon gerollt ist: Das frisch geladene Tool fährt an die Stelle des Vorführenden */
function rollNachLaden(boardId: string, id: string, frame: HTMLIFrameElement | null): void {
  if (!frame) return;
  // Bei mir (ich führe vor) beginnt ein frisch geladenes Tool oben — der Stand von vorhin gilt nicht mehr
  rollVergessen(boardId, id);
  window.setTimeout(() => {
    // erst jetzt nachsehen: Bis das Tool steht, kann der Vorführende schon weitergerollt haben
    const r = folgeIch(boardId) ? werFuehrtVor(boardId)?.rollen[id] : undefined;
    if (r) frame.contentWindow?.postMessage({ __pixiRoll: id, roll: r }, '*');
    // M384: … und bekommt die Feldwerte, die der Vorführende schon eingegeben hat
    eingabenErbitten(boardId, id);
  }, 350);
}

const fmtSize = (b: number) => (b >= 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1000))} kB`);

/**
 * Eigene App (M158): eine per Drag & Drop abgelegte HTML-Datei läuft als
 * eigene Instanz in der Karte. Bewusst mit Start/Stop statt Autostart —
 * zehn eingebettete Tools, die alle beim Board-Öffnen losrechnen, würden
 * Speicher und Akku fressen. Gestartet wird erst auf Klick.
 */
export function HtmlAppCard({ id, data, selected }: NodeProps<HtmlAppNode>) {
  const updateNodeData = useBoard((s) => s.updateNodeData);
  const showToast = useBoard((s) => s.showToast);
  /** null = lädt noch, false = Inhalt fehlt auf diesem Gerät */
  const [hasSrc, setHasSrc] = useState<boolean | null>(null);
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [full, setFull] = useState(false);
  const rand = useRandLeiste(full);   // M393: im Vollbild zieht sich die Kopfleiste zurück
  const [liveOn, setLiveOn] = useState(false);
  const [liveKey, setLiveKey] = useState(0); // Neustart der Live-Einbettung
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  /* M388: Die Adresse einer Live-Seite stammt aus dem Board — und das kann von anderen kommen. Eingebettet und
     geöffnet wird nur eine fremde http(s)-Adresse (lib/sicher.ts): „javascript:…" liefe im Namen von PixiNotes. */
  const liveAdresse = data.live ? fremdeWebAdresse(data.url) : null;
  const isLive = !!data.live && !!data.url;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** Tabs, die diese Karte selbst geöffnet hat (In neuem Tab) — nur von dort nimmt sie Speicher-Meldungen an */
  const eigeneTabs = useRef(new Set<Window>());
  const boardId = useBoard((st) => st.activeId);
  // App-Name ohne Stale-Closure (Team-Speicherstand wird verzögert geschrieben)
  const nameRef = useRef(data.name);
  nameRef.current = data.name;
  const teamSaveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Funktions-Menü schließt bei Klick irgendwo anders (Muster frame-menu M151)
  useEffect(() => {
    if (!menuPos) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.happ-menu') || t?.closest?.(`[data-hmbtn="${id}"]`)) return;
      setMenuPos(null);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [menuPos, id]);

  useEffect(() => {
    let alive = true;
    if (isLive) { setHasSrc(true); return; } // Live: kein lokaler Quelltext nötig
    // M159: Kopie im Team-Ordner · M371: der Quelltext reist mit dem Board (Konto, Gast-Link, kurzer Link)
    const pruefen = () => { void quelleHolen(id, data.ref).then((da) => { if (alive) setHasSrc(da); }); };
    pruefen();
    // Anhänge trudeln nach dem Board ein — dann noch einmal nachsehen
    window.addEventListener('pixinotes:dateien-da', pruefen);
    return () => { alive = false; window.removeEventListener('pixinotes:dateien-da', pruefen); };
  }, [id, data.ref, isLive]);

  // Speicher-Meldungen der App (localStorage-Shim) entgegennehmen → IndexedDB.
  // Kommt auch aus dem EIGENEN Browser-Tab an (M162): dessen Hüll-Seite
  // leitet die Meldungen per postMessage an dieses Fenster weiter.
  // Zusätzlich (M162): Speicherstand verzögert in den Team-Ordner spiegeln.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __pixiHapp?: string; store?: Record<string, string> } | null;
      if (d?.__pixiHapp !== id || !d.store) return;
      // M388: nur vom Rahmen dieser Karte oder von einem Tab, den sie selbst geöffnet hat — sonst könnte jede
      // eingebettete Seite den Speicherstand eines anderen Tools überschreiben. Und nur, was ein Speicher ist.
      if (e.source !== frameRef.current?.contentWindow && !eigeneTabs.current.has(e.source as Window)) return;
      if (!speicherGueltig(d.store)) return;
      const store = d.store;
      void saveAppState(id, store).then(() => {
        // M170: verbundene Notizen zeigen den Speicherstand als Auszug —
        // Bescheid geben, damit sie live nachladen
        window.dispatchEvent(new CustomEvent('pixinotes:happ-state', { detail: id }));
      });
      clearTimeout(teamSaveT.current);
      teamSaveT.current = setTimeout(() => { void saveAppStateToTeam(id, nameRef.current, store).catch(() => {}); }, 4000);
    };
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(teamSaveT.current); };
  }, [id]);

  // Vollbild-Zustand verfolgen (Esc beendet es am Steuerknopf vorbei)
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /** Aktuellsten Speicherstand wählen: Team-Ordner vs. lokal — der NEUERE
   *  gewinnt (M162); ein übernommener Team-Stand wird lokal mitgeschrieben */
  const freshestState = async (): Promise<Record<string, string>> => {
    const [st, at] = await Promise.all([loadAppState(id), loadAppStateAt(id)]);
    try {
      const team = await loadAppStateFromTeam(id);
      if (team && (!st || !at || team.savedAt > at)) {
        await saveAppState(id, team.data, team.savedAt);
        if (st) showToast(`Neuerer Team-Speicherstand geladen (${new Date(team.savedAt).toLocaleString('de-DE')}).`);
        return team.data;
      }
    } catch { /* Team-Ordner nicht erreichbar → lokaler Stand */ }
    return st ?? {};
  };

  const start = async () => {
    if (isLive) {
      // Sicherheitsnetz: Live nur für eine FREMDE Webadresse (s. SANDBOX_LIVE und lib/sicher.ts)
      if (!liveAdresse) {
        showToast('Diese Adresse lässt sich nicht einbetten — nur fremde Webseiten (https://…).');
        return;
      }
      setLiveOn(true);
      return;
    }
    setStarting(true);
    try {
      const [html, st] = await Promise.all([loadHtml(id), freshestState()]);
      if (!html) { setHasSrc(false); return; }
      setSrcdoc(composeSrcdoc(id, html, st));
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setSrcdoc(null);
    setLiveOn(false);
  };

  // ───── M371: Vorführen — das Tool läuft bei allen, und in eigenen Tools rollt das Team mit ─────
  useVorfuehrTakt();
  const laeuft = srcdoc !== null || liveOn;
  // Ich führe vor: bekanntgeben, dass dieses Tool läuft
  useEffect(() => {
    appMelden(boardId, id, laeuft);
    return () => appMelden(boardId, id, false);
  }, [boardId, id, laeuft]);
  // Ich folge: Startet der Vorführende das Tool, startet es hier; hält er es an, hält es hier an.
  // Wer es selbst anhält, behält das letzte Wort, bis der Vorführende es neu startet.
  const zeigt = werFuehrtVor(boardId);
  const folge = folgeIch(boardId);
  const dortAn = folge && !!zeigt?.apps.includes(id);
  const dortAus = folge && !!zeigt && !zeigt.apps.includes(id);
  const vonFolgen = useRef(false);
  const selbstAus = useRef(false);
  useEffect(() => {
    if (dortAn && !laeuft && hasSrc === true && !starting && !selbstAus.current) { vonFolgen.current = true; void start(); }
    if (dortAus) {
      selbstAus.current = false;
      if (vonFolgen.current) { vonFolgen.current = false; if (laeuft) stop(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dortAn, dortAus, laeuft, hasSrc, starting]);
  const stopSelbst = () => { if (dortAn) selbstAus.current = true; vonFolgen.current = false; stop(); };
  useMitrollen(boardId, id, frameRef, srcdoc !== null);

  /** Neustart lädt auch den zuletzt GESPEICHERTEN App-Zustand frisch */
  const restart = async () => {
    if (isLive) { setLiveKey((k) => k + 1); return; }
    setSrcdoc(null);
    await start();
  };

  /** M164: Kopie-Karten mit gemerkter Quelle frisch von der URL laden */
  const reloadFromUrl = async () => {
    setMenuPos(null);
    const quelle = fremdeWebAdresse(data.url);
    if (!quelle) return;
    try {
      const res = await fetch(quelle, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      await saveHtml(id, text);
      updateNodeData(id, { size: text.length });
      showToast('Frisch von der Quelle geladen.');
      if (srcdoc !== null) { setSrcdoc(null); await start(); }
    } catch {
      showToast('Die Quelle war nicht erreichbar (offline oder CORS) — der lokale Stand bleibt.');
    }
  };

  const toggleFull = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    // Natives Vollbild aufs Karten-Element: die laufende Instanz bleibt
    // dabei ERHALTEN (kein Reparenting, kein Reload) — genau deshalb kein
    // Overlay-Portal. Esc oder der Knopf führen zurück aufs Board.
    wrapRef.current?.requestFullscreen?.().catch(() => showToast('Vollbild wird von diesem Browser hier nicht erlaubt.'));
  };

  /** M162: Im eigenen Browser-Tab öffnen — über eine Hüll-Seite, die die App
   *  in EXAKT DERSELBEN Sandbox laufen lässt wie die Karte (sonst käme das
   *  Tool im neuen Tab an den PixiNotes-Speicher!). Die Hülle leitet die
   *  Speicher-Meldungen des Shims per postMessage an dieses Fenster zurück —
   *  Spielstand/Zustand aus dem Tab landet also weiter in der Karte. */
  const openInTab = async () => {
    setMenuPos(null);
    const [html, st] = await Promise.all([loadHtml(id), freshestState()]);
    if (!html) { showToast('Kein Inhalt auf diesem Gerät — zuerst die HTML-Datei laden.'); return; }
    // „</“ im JSON-Text maskieren, damit kein früher </script> die Hülle sprengt
    const innerJson = JSON.stringify(composeSrcdoc(id, html, st)).replace(/<\//g, '<\\/');
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const wrapper = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${esc(data.name)} – PixiNotes App</title>`
      + '<style>html,body{margin:0;height:100%;background:#fff}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>'
      + `<iframe sandbox="${SANDBOX}"></iframe>`
      + '<script>window.addEventListener("message",function(e){if(e.data&&e.data.__pixiHapp&&window.opener){try{window.opener.postMessage(e.data,"*")}catch(_){}}});'
      + `document.querySelector("iframe").srcdoc=${innerJson};</` + 'script></body></html>';
    const url = URL.createObjectURL(new Blob([wrapper], { type: 'text/html' }));
    const win = window.open(url, '_blank');
    if (!win) showToast('Pop-up blockiert — bitte für diese Seite erlauben.');
    else eigeneTabs.current.add(win);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /** Die Original-HTML-Datei wieder herausgeben (z. B. zum Weitergeben) */
  const downloadHtml = async () => {
    setMenuPos(null);
    const html = await loadHtml(id);
    if (!html) { showToast('Kein Inhalt auf diesem Gerät.'); return; }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    triggerDownload(url, /\.html?$/i.test(data.name) ? data.name : `${data.name}.html`);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  /** Speicherstand SOFORT in den Team-Ordner schreiben (sonst debounced) */
  const teamSaveNow = async () => {
    setMenuPos(null);
    const st = (await loadAppState(id)) ?? {};
    const savedAt = await saveAppStateToTeam(id, data.name, st);
    showToast(savedAt
      ? `Speicherstand im Team-Ordner gesichert (pixinotes-anlagen/…/Apps/).`
      : 'Kein Team-Ordner verbunden — das Board gehört zu keinem Team-Projekt (⚙ → Daten → Synchronisation).');
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const html = await f.text();
    await saveHtml(id, html);
    // M371: ersetzter Quelltext — die Fassung im Konto (und bei den Gästen) ist damit überholt
    window.dispatchEvent(new CustomEvent('pixinotes:anhang-neu', { detail: id }));
    updateNodeData(id, { name: f.name, size: f.size });
    setHasSrc(true);
    setSrcdoc(null);
    showToast(`„${f.name}" geladen — mit Start ausführen.`);
  };

  const runningUi = srcdoc !== null || liveOn;
  return (
    <CardShell id={id} selected={selected} minWidth={340} minHeight={260} className="happ-card">
      {/* M160: kein dragHandle mehr — die ganze Karte zieht normal (Griff,
          Kopfzeile, Poster); nur echte Bedienelemente sind nodrag, und die
          laufende App-Fläche (iframe) schluckt ihre Eingaben selbst */}
      <div className={`happ-wrap ${full ? 'happ-full' : ''}`} ref={wrapRef}>
        <div className={`happ-head ${rand.da ? 'da' : ''}`} {...rand.griff}>
          <IAppWindow size={15} />
          <DragTitle
            className="happ-title"
            value={data.name}
            onChange={(v) => updateNodeData(id, { name: v })}
            placeholder="App"
          />
          <span className="happ-size" title={isLive ? `Live eingebettet von ${data.url}` : undefined}>
            {isLive ? 'live' : fmtSize(data.size)}
          </span>
          {/* M313: Ein Knopf zum Starten/Anhalten, alles andere (Neustart,
              Vollbild, Tab, Herunterladen, Speicherstand) im ⋯ */}
          {runningUi ? (
            <button className="happ-btn happ-stopbtn nodrag" title="App anhalten (gibt Speicher & Rechenzeit frei)" onClick={stopSelbst}><IStopSq size={14} /></button>
          ) : (
            <button className="happ-btn happ-startbtn nodrag" disabled={hasSrc !== true || starting} title="App starten" onClick={start}>
              <IPlay size={14} />
            </button>
          )}
{/* M393: Im Vollbild gibt es kein ⋯ (das Menü läge außerhalb des Vollbilds) — hier führt ein Knopf zurück */}
          {full ? (
            <button className="happ-btn nodrag" data-taste="happ-vollbild-zu" title="Vollbild verlassen (Esc)" aria-label="Vollbild verlassen" onClick={toggleFull}>
              <IMinimize size={14} />
            </button>
          ) : (
                    <button
            className="happ-btn nodrag"
            data-hmbtn={id}
            title="Weitere Funktionen (eigener Tab, Herunterladen, Speicherstand)"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              // M172: Menü immer im Sichtfenster halten (unten/rechts klemmen)
              setMenuPos(menuPos ? null : {
                x: Math.min(Math.max(8, r.right - 250), window.innerWidth - 258),
                y: Math.min(r.bottom + 6, Math.max(8, window.innerHeight - 320)),
              });
            }}
          >
            <IMore size={14} />
          </button>
          )}
        </div>
        <div className="happ-body">
          {runningUi ? (
            <>
              {liveOn && liveAdresse ? (
                /* M164 Live: fremde URL direkt — die Same-Origin-Policy des
                   Browsers hält sie von PixiNotes fern (s. SANDBOX_LIVE) */
                <iframe key={liveKey} className="happ-frame" title={data.name} sandbox={SANDBOX_LIVE} src={liveAdresse} />
              ) : (
                <iframe ref={frameRef} className="happ-frame" title={data.name} sandbox={SANDBOX} srcDoc={srcdoc ?? ''} onLoad={() => rollNachLaden(boardId, id, frameRef.current)} />
              )}
              {/* Nicht ausgewählt: Klicks gehören dem Board (auswählen/ziehen).
                  Erst die AUSGEWÄHLTE Karte reicht Eingaben an die App durch —
                  sonst könnte man das Board über einer App nie mehr schwenken. */}
              {!selected && !full && <div className="happ-guard" title="Zum Bedienen der App zuerst die Karte anklicken" />}
            </>
          ) : (
            <div className="happ-poster">
              {hasSrc === false ? (
                <>
                  <p>Der Inhalt dieser App liegt auf diesem Gerät (noch) nicht vor. Mit dem PixiNotes-Konto und in geteilten Boards reist er mit; sonst die HTML-Datei hier laden.</p>
                  <button className="happ-load nodrag" onClick={() => fileRef.current?.click()}>HTML-Datei wählen</button>
                </>
              ) : (
                <>
                  <IAppWindow size={34} />
                  <p>
                    {hasSrc === null
                      ? 'Inhalt wird geladen …'
                      : isLive
                        ? `Live-App von ${(() => { try { return new URL(data.url!).hostname; } catch { return '?'; } })()} — läuft direkt von der Quelle und braucht dafür Internet.`
                        : 'Bereit — die App startet erst auf Klick und läuft dann als eigene, abgeschottete Instanz.'}
                  </p>
                  <button className="happ-load happ-go nodrag" disabled={hasSrc !== true || starting} onClick={start}>
                    <IPlay size={14} /> Starten
                  </button>
                  {!isLive && <button className="happ-load nodrag" onClick={() => fileRef.current?.click()}>Andere Datei laden</button>}
                </>
              )}
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".html,.htm,text/html"
          style={{ display: 'none' }}
          onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
      {/* Funktions-Menü als Portal (die Karte hat overflow:hidden, M151-Muster) */}
      {menuPos && createPortal(
        <div className="happ-menu nodrag" style={{ left: menuPos.x, top: menuPos.y }}>
          {runningUi && (
            <>
              <button onClick={() => { setMenuPos(null); toggleFull(); }}>
                {full ? <><IMinimize size={14} /> Vollbild verlassen</> : <><IMaximize size={14} /> Vollbild</>}
              </button>
              <button onClick={() => { setMenuPos(null); restart(); }}><IReload size={14} /> Neu starten</button>
            </>
          )}
          <button
            disabled={hasSrc !== true}
            onClick={() => { if (isLive) { setMenuPos(null); if (liveAdresse) window.open(liveAdresse, '_blank', 'noopener'); } else void openInTab(); }}
          >
            <IAppWindow size={14} /> Im eigenen Browser-Tab öffnen
          </button>
          {isLive ? (
            <button onClick={() => { setMenuPos(null); void navigator.clipboard?.writeText(data.url ?? '').then(() => showToast('Adresse kopiert.')); }}>
              <ICopy size={14} /> Adresse (URL) kopieren
            </button>
          ) : (
            <button disabled={hasSrc !== true} onClick={() => void downloadHtml()}>
              <IDownload size={14} /> HTML-Datei herunterladen
            </button>
          )}
          {!isLive && (
            <button onClick={() => void teamSaveNow()}>
              <ICloud size={14} /> Speicherstand im Team-Ordner sichern
            </button>
          )}
          {!isLive && data.url && (
            <button onClick={() => void reloadFromUrl()} title={`Quelle: ${data.url}`}>
              <IReload size={14} /> Von der Quelle neu laden
            </button>
          )}
          {!isLive && (
            <button onClick={() => { setMenuPos(null); fileRef.current?.click(); }}>
              <IReload size={14} /> Andere HTML-Datei laden
            </button>
          )}
        </div>,
        document.body,
      )}
    </CardShell>
  );
}

/**
 * M371: Ein Tool oder eine Webseite als Folie. In der Präsentation läuft die Karte wirklich — nicht mehr als
 * Standbild: Sie startet von selbst, füllt die Folie und lässt sich bedienen. Führt jemand vor, sehen die
 * Folgenden dieselbe Folie; in eigenen Tools rollt ihre Ansicht mit (useMitrollen), eine fremde Webseite rollt
 * jeder selbst — in sie lässt der Browser nicht hineinsehen.
 */
export function HtmlAppSlide({ node }: { node: HtmlAppNode }) {
  const { id, data } = node;
  const boardId = useBoard((st) => st.activeId);
  const isLive = !!data.live && !!data.url;
  const liveAdresse = data.live ? fremdeWebAdresse(data.url) : null;   // M388: nur fremde http(s)-Adressen
  const [srcdoc, setSrcdoc] = useState<string | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  useVorfuehrTakt();
  useEffect(() => {
    if (isLive) return;
    let alive = true;
    void (async () => {
      const html = (await quelleHolen(id, data.ref)) ? await loadHtml(id) : null;
      if (!alive) return;
      if (!html) { setFehlt(true); return; }
      const st = (await loadAppState(id).catch(() => undefined)) ?? {};
      if (alive) setSrcdoc(composeSrcdoc(id, html, st));
    })();
    return () => { alive = false; };
  }, [id, data.ref, isLive]);
  // Was das Tool speichert, landet wie bei der Karte in seiner Schublade
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __pixiHapp?: string; store?: Record<string, string> } | null;
      if (d?.__pixiHapp !== id || !d.store || e.source !== frame.current?.contentWindow || !speicherGueltig(d.store)) return;
      void saveAppState(id, d.store).then(() => window.dispatchEvent(new CustomEvent('pixinotes:happ-state', { detail: id })));
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [id]);
  useMitrollen(boardId, id, frame, srcdoc !== null);
  // Folie zu: der Rollstand dieser Folie gilt nicht weiter (auf dem Board beginnt das Tool wieder oben)
  useEffect(() => () => rollVergessen(boardId, id), [boardId, id]);
  const fremd = !!liveAdresse;
  const adresse = (() => { try { return new URL(liveAdresse ?? '').hostname; } catch { return ''; } })();
  const vorfuehrung = !!werFuehrtVor(boardId);
  return (
    <div className="slide-app" data-taste="folie-app">
      {isLive ? (
        fremd
          ? <iframe ref={frame} className="slide-app-frame" title={data.name} sandbox={SANDBOX_LIVE} src={liveAdresse ?? undefined} />
          : <p className="slide-app-hinweis">Diese Adresse lässt sich nicht einbetten — nur fremde Webseiten (https://…).</p>
      ) : srcdoc !== null ? (
        <iframe ref={frame} className="slide-app-frame" title={data.name} sandbox={SANDBOX} srcDoc={srcdoc} onLoad={() => rollNachLaden(boardId, id, frame.current)} />
      ) : (
        <p className="slide-app-hinweis">{fehlt ? 'Der Inhalt dieses Tools liegt auf diesem Gerät nicht vor.' : 'Tool startet …'}</p>
      )}
      {isLive && fremd && vorfuehrung && (
        <div className="slide-app-fuss" data-taste="folie-app-fremd">Webseite von <span translate="no">{adresse}</span> — sie öffnet sich bei allen; rollen und klicken muss darin jeder selbst.</div>
      )}
    </div>
  );
}
