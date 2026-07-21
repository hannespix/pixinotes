import { useEffect, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useBoard } from '../../store';
import type { HtmlAppNode } from '../../types';
import { composeSrcdoc, loadAppState, loadHtml, saveAppState, saveHtml } from '../../lib/htmlStore';
import { loadAttachment } from '../../lib/attachments';
import { CardShell } from './CardShell';
import { IAppWindow, IMaximize, IMinimize, IPlay, IReload, IStopSq } from '../Icons';

/**
 * Sandbox OHNE allow-same-origin — die Sicherheits-Grundentscheidung:
 * Die App kann JavaScript, Formulare, Dialoge, Downloads … nutzen, aber sie
 * läuft unter einer fremden („opaken") Herkunft und kommt damit prinzipbedingt
 * NICHT an den PixiNotes-Speicher, die Sync-Zugangsdaten oder das Board-DOM.
 * localStorage stellt der injizierte Shim bereit (htmlStore, pro Karte).
 */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads';

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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let alive = true;
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
  }, [id, data.ref]);

  // Speicher-Meldungen der App (localStorage-Shim) entgegennehmen → IndexedDB
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { __pixiHapp?: string; store?: Record<string, string> } | null;
      if (d?.__pixiHapp === id && d.store) void saveAppState(id, d.store);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [id]);

  // Vollbild-Zustand verfolgen (Esc beendet es am Steuerknopf vorbei)
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const start = async () => {
    setStarting(true);
    try {
      const [html, st] = await Promise.all([loadHtml(id), loadAppState(id)]);
      if (!html) { setHasSrc(false); return; }
      setSrcdoc(composeSrcdoc(id, html, st ?? {}));
    } finally {
      setStarting(false);
    }
  };

  const stop = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    setSrcdoc(null);
  };

  /** Neustart lädt auch den zuletzt GESPEICHERTEN App-Zustand frisch */
  const restart = async () => { setSrcdoc(null); await start(); };

  const toggleFull = () => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    // Natives Vollbild aufs Karten-Element: die laufende Instanz bleibt
    // dabei ERHALTEN (kein Reparenting, kein Reload) — genau deshalb kein
    // Overlay-Portal. Esc oder der Knopf führen zurück aufs Board.
    wrapRef.current?.requestFullscreen?.().catch(() => showToast('Vollbild wird von diesem Browser hier nicht erlaubt.'));
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

  const runningUi = srcdoc !== null;
  return (
    <CardShell id={id} selected={selected} minWidth={340} minHeight={260} className="happ-card">
      {/* KEIN nodrag am Wrapper: die Kopfleiste ist das dragHandle der Karte —
          nodrag auf einem Vorfahren würde genau dieses Ziehen unterbinden.
          Stattdessen sind nur die Bedienelemente in der Leiste nodrag. */}
      <div className={`happ-wrap ${full ? 'happ-full' : ''}`} ref={wrapRef}>
        <div className="happ-head">
          <IAppWindow size={15} />
          <input
            className="happ-title nodrag"
            value={data.name}
            onChange={(e) => updateNodeData(id, { name: e.target.value })}
            title="Name der App (zum Ziehen die Kopfleiste greifen)"
          />
          <span className="happ-size">{fmtSize(data.size)}</span>
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
        </div>
        <div className="happ-body">
          {runningUi ? (
            <>
              <iframe className="happ-frame" title={data.name} sandbox={SANDBOX} srcDoc={srcdoc} />
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
                  <button className="happ-load" onClick={() => fileRef.current?.click()}>HTML-Datei wählen</button>
                </>
              ) : (
                <>
                  <IAppWindow size={34} />
                  <p>{hasSrc === null ? 'Inhalt wird geladen …' : 'Bereit — die App startet erst auf Klick und läuft dann als eigene, abgeschottete Instanz.'}</p>
                  <button className="happ-load happ-go" disabled={hasSrc !== true || starting} onClick={start}>
                    <IPlay size={14} /> Starten
                  </button>
                  <button className="happ-load" onClick={() => fileRef.current?.click()}>Andere Datei laden</button>
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
    </CardShell>
  );
}
