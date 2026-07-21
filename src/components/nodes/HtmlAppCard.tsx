import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { HtmlAppNode } from '../../types';
import { composeSrcdoc, loadAppState, loadAppStateAt, loadHtml, saveAppState, saveHtml } from '../../lib/htmlStore';
import { loadAppStateFromTeam, loadAttachment, saveAppStateToTeam } from '../../lib/attachments';
import { triggerDownload } from '../../lib/download';
import { CardShell } from './CardShell';
import { DragTitle } from './DragTitle';
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
  const [liveOn, setLiveOn] = useState(false);
  const [liveKey, setLiveKey] = useState(0); // Neustart der Live-Einbettung
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const isLive = !!data.live && !!data.url;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
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
    void (async () => {
      try {
        if (await loadHtml(id)) { if (alive) setHasSrc(true); return; }
        // M159: Quelltext fehlt lokal (anderes Gerät) — liegt eine Kopie im
        // Team-Ordner, wird sie still nachgeladen (fragt NIE nach Rechten)
        if (data.ref) {
          const f = await loadAttachment(data.ref);
          if (f) {
            await saveHtml(id, await f.text());
            if (alive) setHasSrc(true);
            return;
          }
        }
        if (alive) setHasSrc(false);
      } catch {
        if (alive) setHasSrc(false);
      }
    })();
    return () => { alive = false; };
  }, [id, data.ref, isLive]);

  // Speicher-Meldungen der App (localStorage-Shim) entgegennehmen → IndexedDB.
  // Kommt auch aus dem EIGENEN Browser-Tab an (M162): dessen Hüll-Seite
  // leitet die Meldungen per postMessage an dieses Fenster weiter.
  // Zusätzlich (M162): Speicherstand verzögert in den Team-Ordner spiegeln.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __pixiHapp?: string; store?: Record<string, string> } | null;
      if (d?.__pixiHapp !== id || !d.store) return;
      const store = d.store;
      void saveAppState(id, store);
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
      // Sicherheitsnetz: Live nur für FREMDE Herkunft (s. SANDBOX_LIVE)
      try {
        if (new URL(data.url!).origin === window.location.origin) {
          showToast('Diese Adresse gehört zu PixiNotes selbst — bitte als Datei laden.');
          return;
        }
      } catch { return; }
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

  /** Neustart lädt auch den zuletzt GESPEICHERTEN App-Zustand frisch */
  const restart = async () => {
    if (isLive) { setLiveKey((k) => k + 1); return; }
    setSrcdoc(null);
    await start();
  };

  /** M164: Kopie-Karten mit gemerkter Quelle frisch von der URL laden */
  const reloadFromUrl = async () => {
    setMenuPos(null);
    if (!data.url) return;
    try {
      const res = await fetch(data.url, { mode: 'cors' });
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
      : 'Kein Team-Ordner verbunden — das Board gehört zu keinem Team-Projekt (⚙️ → Synchronisation).');
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const html = await f.text();
    await saveHtml(id, html);
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
        <div className="happ-head">
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
          {runningUi ? (
            <>
              <button className="happ-btn nodrag" title="Neu starten (lädt die App frisch)" onClick={restart}><IReload size={14} /></button>
              <button className="happ-btn happ-stopbtn nodrag" title="App anhalten (gibt Speicher & Rechenzeit frei)" onClick={stop}><IStopSq size={14} /></button>
            </>
          ) : (
            <button className="happ-btn happ-startbtn nodrag" disabled={hasSrc !== true || starting} title="App starten" onClick={start}>
              <IPlay size={14} />
            </button>
          )}
          <button className="happ-btn nodrag" disabled={!runningUi} title={full ? 'Vollbild verlassen (Esc)' : 'Vollbild — die App läuft dabei weiter'} onClick={toggleFull}>
            {full ? <IMinimize size={14} /> : <IMaximize size={14} />}
          </button>
          <button
            className="happ-btn nodrag"
            data-hmbtn={id}
            title="Weitere Funktionen (eigener Tab, Herunterladen, Speicherstand)"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenuPos(menuPos ? null : { x: Math.max(8, r.right - 250), y: r.bottom + 6 });
            }}
          >
            <IMore size={14} />
          </button>
        </div>
        <div className="happ-body">
          {runningUi ? (
            <>
              {liveOn ? (
                /* M164 Live: fremde URL direkt — die Same-Origin-Policy des
                   Browsers hält sie von PixiNotes fern (s. SANDBOX_LIVE) */
                <iframe key={liveKey} className="happ-frame" title={data.name} sandbox={SANDBOX_LIVE} src={data.url} />
              ) : (
                <iframe className="happ-frame" title={data.name} sandbox={SANDBOX} srcDoc={srcdoc ?? ''} />
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
                  <p>Der Inhalt dieser App liegt auf diesem Gerät nicht vor — HTML-Dateien bleiben lokal (sie wandern nicht in Sync-Dateien oder Team-Pakete).</p>
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
          <button
            disabled={hasSrc !== true}
            onClick={() => { if (isLive) { setMenuPos(null); window.open(data.url, '_blank'); } else void openInTab(); }}
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
