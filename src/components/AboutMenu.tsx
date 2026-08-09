import { useEffect, useRef, useState } from 'react';
import { useBoard } from '../store';
import { IExternal, IEye, IHelp, IReload, ISettings } from './Icons';

/**
 * M210: Das Logo ist der Zugang zu „Über PixiNotes".
 *
 * Warum hier und nicht „zur Übersicht"? Für die Übersicht gibt es direkt
 * darunter schon den 🏠-Knopf der Tab-Leiste — ein zweiter Heim-Knopf wäre
 * bloß Verwechslungsgefahr. Das Logo ist stattdessen der Ort, an dem Leute
 * Identität, Version und Rechtliches suchen. Nebenbei erfüllt das die
 * DDG-Pflicht sauberer: Impressum und Datenschutz sind jetzt EIN Klick von
 * überall aus, statt drei Ebenen tief in den Einstellungen.
 */
export function AboutMenu() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const setHelpOpen = useBoard((s) => s.setHelpOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const anzeige = useBoard((s) => s.anzeige);
  const setAnzeige = useBoard((s) => s.setAnzeige);

  // Klick daneben und Esc schließen (gleiches Muster wie die übrigen Menüs)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="logo-wrap" ref={wrapRef}>
      <button
        className={`logo ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Über PixiNotes — Version, Neuerungen, Impressum & Datenschutz"
        aria-label="Über PixiNotes"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Pixi<span>Notes</span>
      </button>
      {open && (
        <div className="about-menu" role="menu" aria-label="Über PixiNotes">
          <div className="about-head">
            <b>PixiNotes {__APP_VERSION__}</b>
            {/* Der Build-Stempel ist beim Support Gold wert: PWA-Caches liefern
                nach einem Deploy manchmal noch tagelang die alte Fassung aus */}
            <span>Stand {__BUILD_STAMP__}</span>
          </div>
          {/* M224: Die Anzeigegröße gehört NACH VORN, nicht in eine Einstellungs-
              Registerkarte. Wer sie braucht, kann die Registerkarte oft gar nicht
              lesen — deshalb steht sie im Logo-Menü, das von jeder Ansicht aus
              mit einem Tipp erreichbar ist, und gleich als erstes. */}
          <div className="about-zoom" role="group" aria-label="Anzeigegröße">
            <span>Anzeige</span>
            <button
              onClick={() => setAnzeige(Number((anzeige - 0.15).toFixed(2)))}
              disabled={anzeige <= 1.001}
              title="Alles kleiner anzeigen"
              aria-label="Alles kleiner anzeigen"
            >
              A<sup>−</sup>
            </button>
            <b>{Math.round(anzeige * 100)} %</b>
            <button
              onClick={() => setAnzeige(Number((anzeige + 0.15).toFixed(2)))}
              disabled={anzeige >= 1.799}
              title="Alles größer anzeigen — Schrift, Knöpfe und Karten"
              aria-label="Alles größer anzeigen"
            >
              A<sup>+</sup>
            </button>
          </div>
          <button role="menuitem" onClick={go(() => setSettingsOpen(true, 'design'))}>
            <IEye size={14} /> Sehen &amp; Bedienen (Schrift, Kontrast)
          </button>
          <div className="about-sep" />
          <button role="menuitem" onClick={go(() => setHelpOpen(true, 'neu'))}>
            <IReload size={14} /> Was ist neu
          </button>
          <button role="menuitem" onClick={go(() => setHelpOpen(true, 'start'))}>
            <IHelp size={14} /> Hilfe & Anleitung
          </button>
          <button role="menuitem" onClick={go(() => setSettingsOpen(true, 'sync'))}>
            <ISettings size={14} /> Deine Daten & Synchronisation
          </button>
          <div className="about-sep" />
          <button role="menuitem" onClick={go(() => setHelpOpen(true, 'impressum'))}>
            <IExternal size={14} /> Impressum
          </button>
          <button role="menuitem" onClick={go(() => setHelpOpen(true, 'datenschutz'))}>
            <IExternal size={14} /> Datenschutz
          </button>
          <div className="about-foot">
            Alles bleibt lokal in diesem Browser — kein Konto, kein Server, keine Anmeldung.
          </div>
        </div>
      )}
    </div>
  );
}
