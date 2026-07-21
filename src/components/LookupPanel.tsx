import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBoard } from '../store';
import { IExternal, ISearch, IX } from './Icons';

/**
 * Nachschlagen (M168) — bewusst zweistufig:
 * - WIKIPEDIA FEIN: echte Such-API (opensearch, CORS-offen) mit mehreren
 *   Treffern samt Beschreibung — die Artikel-Links sind stabil.
 * - ANDERE QUELLEN NUR GROB: ausschließlich Links auf deren SUCHSEITEN mit
 *   dem Begriff. Konstruierte Tief-Links („raten, wie die Ziel-URL wohl
 *   aussieht") enden zu oft in 404 — deshalb gibt es sie hier nicht.
 */
interface WikiHit {
  title: string;
  desc: string;
  url: string;
}

/** Grobe Quellen: nur wohldefinierte, stabile Suchseiten-Muster */
const COARSE_SOURCES: Array<{ name: string; hint: string; url: (q: string) => string }> = [
  { name: 'DuckDuckGo', hint: 'Websuche (datensparsam)', url: (q) => `https://duckduckgo.com/?q=${q}` },
  { name: 'Google', hint: 'Websuche', url: (q) => `https://www.google.com/search?q=${q}` },
  { name: 'Bing', hint: 'Websuche', url: (q) => `https://www.bing.com/search?q=${q}` },
  { name: 'Wikipedia-Volltext', hint: 'Suche IN den Artikeln', url: (q) => `https://de.wikipedia.org/w/index.php?search=${q}` },
  { name: 'OpenStreetMap', hint: 'Orte & Adressen', url: (q) => `https://www.openstreetmap.org/search?query=${q}` },
];

export function LookupPanel() {
  const lookup = useBoard((s) => s.lookup);
  const setLookup = useBoard((s) => s.setLookup);
  const [q, setQ] = useState('');
  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [hits, setHits] = useState<WikiHit[]>([]);
  const [state, setState] = useState<'leer' | 'lädt' | 'ok' | 'fehler'>('leer');
  const abortRef = useRef<AbortController | null>(null);

  // Öffnen: Begriff übernehmen und direkt suchen
  useEffect(() => {
    if (lookup === null) return;
    setQ(lookup);
    if (lookup.trim()) void search(lookup, lang);
    else { setHits([]); setState('leer'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookup]);

  const search = async (term: string, language: 'de' | 'en') => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setState('lädt');
    try {
      // opensearch: CORS-offen (origin=*), liefert Titel + Beschreibung + URL
      const res = await fetch(
        `https://${language}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(term)}&limit=8&namespace=0&format=json&origin=*`,
        { signal: ctl.signal },
      );
      if (!res.ok) throw new Error(String(res.status));
      const [, titles, descs, urls] = (await res.json()) as [string, string[], string[], string[]];
      setHits((titles ?? []).map((t, i) => ({ title: t, desc: descs?.[i] ?? '', url: urls?.[i] ?? '' })).filter((h) => h.url));
      setState('ok');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setHits([]);
      setState('fehler');
    }
  };

  if (lookup === null) return null;
  const enc = encodeURIComponent(q.trim());

  return createPortal(
    <div className="lookup-backdrop nodrag" onClick={() => setLookup(null)}>
      <div className="lookup-panel" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setLookup(null)}>
        <div className="lookup-head">
          <ISearch size={15} />
          <input
            autoFocus
            className="lookup-input"
            value={q}
            placeholder="Begriff nachschlagen …"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) void search(q, lang); }}
          />
          <select
            className="lookup-lang"
            value={lang}
            title="Wikipedia-Sprache"
            onChange={(e) => { const l = e.target.value as 'de' | 'en'; setLang(l); if (q.trim()) void search(q, l); }}
          >
            <option value="de">DE</option>
            <option value="en">EN</option>
          </select>
          <button className="lookup-go" disabled={!q.trim()} onClick={() => void search(q, lang)}>Suchen</button>
          <button className="lookup-x" title="Schließen (Esc)" onClick={() => setLookup(null)}><IX size={13} /></button>
        </div>

        <div className="lookup-section">Wikipedia ({lang.toUpperCase()}) — feine Treffer</div>
        <div className="lookup-hits">
          {state === 'lädt' && <div className="lookup-note">Sucht …</div>}
          {state === 'fehler' && <div className="lookup-note">Wikipedia nicht erreichbar (offline?) — die groben Quellen unten funktionieren als Links trotzdem.</div>}
          {state === 'ok' && hits.length === 0 && <div className="lookup-note">Keine Artikel gefunden — Begriff anpassen oder unten grob suchen.</div>}
          {hits.map((h) => (
            <a key={h.url} className="lookup-hit" href={h.url} target="_blank" rel="noopener noreferrer" title={h.url}>
              <b>{h.title}</b>
              {h.desc && <span>{h.desc}</span>}
            </a>
          ))}
        </div>

        <div className="lookup-section">Weitere Quellen — bewusst grob (öffnet deren Suchseite)</div>
        <div className="lookup-coarse">
          {COARSE_SOURCES.map((s) => (
            <a
              key={s.name}
              className={`lookup-src ${enc ? '' : 'off'}`}
              href={enc ? s.url(enc) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              title={`${s.hint} — öffnet die Suchseite mit deinem Begriff (keine geratenen Tief-Links, die in 404 enden)`}
            >
              <IExternal size={12} /> {s.name}
            </a>
          ))}
        </div>
        <div className="lookup-foot">Wikipedia liefert stabile Artikel-Links · andere Quellen absichtlich nur als Suche — Tief-Links wären zu oft 404 · Esc schließt</div>
      </div>
    </div>,
    document.body,
  );
}
