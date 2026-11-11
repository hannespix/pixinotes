// M345: Pfeiltasten in allen Ansichten — Menüs, Leisten, Navigationsbaum, Übersicht, Netz, Aufgaben.
//
// Auf dem Board springt man seit M344 per Tastatur von Karte zu Karte. Überall sonst kam man nur
// mit Tab voran, Knopf für Knopf. Hier steht EINE Regel für alles, was eine Gruppe von Zielen ist:
//
//   · Menüs und Paletten   ↑ ↓ (im Raster auch ← →), Pos1/Ende; ↓ vom Auslöser aus führt hinein
//   · Leisten              ← → (Dock, Auswahl-Leiste, Kopfleiste, Filter)
//   · Navigationsbaum      ↑ ↓, → klappt auf, ← klappt zu bzw. springt zum Übergeordneten
//   · Übersicht und Netz   Pfeile springen zum Board in dieser Richtung, Enter öffnet
//   · Aufgaben-Zentrale    ↑ ↓, Leertaste erledigt, Enter klappt auf, Strg+Enter springt zur Karte
//   · F6 / Umschalt+F6     von Bereich zu Bereich: Navigation → Kopfleiste → Fläche → Leiste unten
//
// Gelesen wird das DOM, wie es gerade ist — die Regel gilt damit auch für Menüs, die später
// dazukommen, ohne dass jedes seinen eigenen Tastatur-Handler braucht.
import { useEffect } from 'react';
import { useBoard } from '../store';

type Ziel = HTMLElement;

const MENUE = '.ebenen-menu, .dock-menu, .sel-menu-fixed, .sel-ai-menu, .sel-attr-menu, .sel-more-menu, .ov-graph-ctx, '
  + '.cal-menu, .week-pop, .happ-menu, .frame-menu, .tab-bg-menu, .mm-pop';
const LEISTE = '.dock, .sel-toolbar, .top-actions, .tabs:not(.spalte), .ov-mode, .taskhub-filters, .taskhub-actions, '
  + '.focus-head, .draw-palette, .ov-graph-zoom, .help-nav';
const GRUPPE = `${MENUE}, ${LEISTE}`;
const KNOPF = 'button:not(:disabled), a[href], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], '
  + 'input:not(:disabled):not([type="hidden"]), select:not(:disabled)';
const BAUM_ZIEL = '.side-tree-find, .side-proj-name, .side-board-name, .side-card, .side-archiv';
const AUFGABE_ZIEL = '.th-group-head, .task-main';
const NETZ_ZIEL = '.ov-graph-svg .ov-graph-node';
const KACHEL_ZIEL = '.ov-canvas .react-flow__node-ovBoard';

const zuSehen = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
};
const alle = (wurzel: ParentNode, sel: string): Ziel[] => (Array.from(wurzel.querySelectorAll(sel)) as Ziel[]).filter(zuSehen);
const fokus = (el: Element | null | undefined): boolean => {
  if (!el) return false;
  (el as Ziel).focus({ preventScroll: true });
  (el as Ziel).scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  return true;
};
const klick = (el: Element): void => {
  if (typeof (el as Ziel).click === 'function') (el as Ziel).click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));   // SVG kennt kein click()
};
const mitte = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Ziele in Zeilen ordnen: Was auf gleicher Höhe liegt, ist eine Zeile (Raster wie Liste) */
function zeilen(ziele: Ziel[]): Ziel[][] {
  const mit = ziele.map((el) => ({ el, r: el.getBoundingClientRect() })).sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
  const out: { oben: number; unten: number; els: { el: Ziel; r: DOMRect }[] }[] = [];
  for (const z of mit) {
    const my = z.r.top + z.r.height / 2;
    const letzte = out[out.length - 1];
    if (letzte && my > letzte.oben && my < letzte.unten) letzte.els.push(z);
    else out.push({ oben: z.r.top, unten: z.r.bottom, els: [z] });
  }
  return out.map((z) => z.els.sort((a, b) => a.r.left - b.r.left).map((e) => e.el));
}

/** Nächstes Ziel in einer Gruppe: ↑ ↓ wechseln die Zeile (umlaufend), ← → gehen in der Zeile weiter */
function inGruppe(ziele: Ziel[], von: Ziel, taste: string): Ziel | null {
  if (!ziele.length) return null;
  if (taste === 'Home') return ziele[0];
  if (taste === 'End') return ziele[ziele.length - 1];
  const z = zeilen(ziele);
  let i = z.findIndex((zeile) => zeile.includes(von));
  if (i < 0) return taste === 'ArrowUp' ? ziele[ziele.length - 1] : ziele[0];
  const j = z[i].indexOf(von);
  if (taste === 'ArrowLeft') return z[i][j - 1] ?? null;
  if (taste === 'ArrowRight') return z[i][j + 1] ?? null;
  i = (i + (taste === 'ArrowDown' ? 1 : -1) + z.length) % z.length;
  const x = mitte(von.getBoundingClientRect()).x;
  let best = z[i][0]; let bestD = Infinity;
  for (const el of z[i]) { const d = Math.abs(mitte(el.getBoundingClientRect()).x - x); if (d < bestD) { bestD = d; best = el; } }
  return best;
}

/** Nächstes Ziel auf freier Fläche: das in Pfeilrichtung, geradeaus zählt mehr als schräg */
function inRichtung(ziele: Ziel[], von: Ziel, taste: string): Ziel | null {
  const [rx, ry] = taste === 'ArrowRight' ? [1, 0] : taste === 'ArrowLeft' ? [-1, 0] : taste === 'ArrowDown' ? [0, 1] : [0, -1];
  const a = mitte(von.getBoundingClientRect());
  let best: Ziel | null = null; let bestWert = Infinity;
  for (const el of ziele) {
    if (el === von) continue;
    const m = mitte(el.getBoundingClientRect());
    const laengs = (m.x - a.x) * rx + (m.y - a.y) * ry;
    const quer = Math.abs((m.x - a.x) * ry) + Math.abs((m.y - a.y) * rx);
    if (laengs <= 4) continue;
    const wert = laengs + quer * 2.2;
    if (wert < bestWert) { bestWert = wert; best = el; }
  }
  return best;
}

/* ---------- F6: von Bereich zu Bereich ---------- */

const BEREICHE: { wurzel: string; start: () => Element | null | undefined }[] = [
  { wurzel: '.nav-tree', start: () => alle(document, '.nav-tree .side-board.active .side-board-name')[0] ?? alle(document, `.nav-tree :is(${BAUM_ZIEL})`)[0] },
  { wurzel: '.tabs:not(.spalte), .top-actions', start: () => alle(document, '.tabs:not(.spalte) .tab.active')[0] ?? alle(document, ':is(.tabs:not(.spalte), .top-actions) button:not(:disabled)')[0] },
  {
    wurzel: '.react-flow, .ov-graph',
    start: () => alle(document, `${NETZ_ZIEL}.here`)[0] ?? alle(document, NETZ_ZIEL)[0]
      ?? alle(document, '.react-flow__node.selected')[0] ?? alle(document, '.react-flow__node')[0],
  },
  { wurzel: '.sel-toolbar, .dock', start: () => alle(document, '.sel-toolbar button:not(:disabled)')[0] ?? alle(document, '.dock button:not(:disabled)')[0] },
];
function bereichWechsel(schritt: 1 | -1): boolean {
  const a = document.activeElement;
  const jetzt = a && a !== document.body ? BEREICHE.findIndex((b) => !!a.closest(b.wurzel)) : -1;
  for (let n = 1; n <= BEREICHE.length; n += 1) {
    const i = jetzt < 0 ? (schritt > 0 ? n - 1 : BEREICHE.length - n) : (jetzt + schritt * n + BEREICHE.length * n) % BEREICHE.length;
    if (i === jetzt) break;
    if (fokus(BEREICHE[i].start())) return true;
  }
  return false;
}

export function usePfeilTasten(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useBoard.getState();
      if (st.presenting) return;
      const taste = e.key;
      const a = (document.activeElement && document.activeElement !== document.body ? document.activeElement : null) as Ziel | null;
      /** Taste verbrauchen — außer es gab nichts zu tun (`false`) */
      const tun = (x?: boolean | void | (() => void)) => {
        if (typeof x === 'function') x(); else if (x === false) return;
        e.preventDefault(); e.stopPropagation();
      };
      const fenster = !!document.querySelector('.modal-backdrop');

      if (taste === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (fenster || st.tasksOpen || st.searchOpen) return;
        return tun(bereichWechsel(e.shiftKey ? -1 : 1));
      }

      const aufgabe = a?.matches('.task-main') ? a : null;
      // Strg+Enter in der Aufgaben-Zentrale: zur Karte der Aufgabe springen
      if ((e.ctrlKey || e.metaKey) && !e.altKey && taste === 'Enter' && aufgabe) {
        return tun(() => {
          const zeile = aufgabe.closest('.task-row');
          const sprung = zeile?.querySelector('.task-jump');
          if (sprung) { klick(sprung); return; }
          klick(aufgabe);
          requestAnimationFrame(() => { const s = zeile?.querySelector('.task-jump'); if (s) klick(s); });
        });
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const pfeil = taste === 'ArrowUp' || taste === 'ArrowDown' || taste === 'ArrowLeft' || taste === 'ArrowRight';
      const rand = taste === 'Home' || taste === 'End';
      const senkrecht = taste === 'ArrowUp' || taste === 'ArrowDown';
      const wahl = taste === 'Enter' || taste === ' ';
      if (!pfeil && !rand && !wahl) return;
      // Felder, in denen die Pfeile selbst etwas bedeuten
      const zeilenFeld = !!a?.matches('input:not([type]), input[type="text"], input[type="search"]');
      const ankreuz = !!a?.matches('input[type="checkbox"], input[type="radio"]');
      const imFeld = !!a?.closest('input, textarea, select, [contenteditable="true"]') && !ankreuz;

      // ── Menüs und Leisten ───────────────────────────────────────────────────────────────
      const gruppe = (a?.closest(GRUPPE) ?? null) as Ziel | null;
      const imMenue = !!gruppe?.matches(MENUE);
      if (gruppe && (pfeil || rand) && !(e.shiftKey && rand)) {
        // im einzeiligen Textfeld eines Menüs führen ↑ ↓ weiter; alles andere gehört dem Feld
        if (imFeld && !(imMenue && zeilenFeld && senkrecht)) return;
        const ziele = alle(gruppe, KNOPF).filter((el) => el.closest(GRUPPE) === gruppe);
        const von = (a && ziele.includes(a) ? a : ziele.find((el) => el.contains(a))) ?? null;
        const ziel = von ? inGruppe(ziele, von, taste) : ziele[0] ?? null;
        // Aufgaben-Zentrale: aus der Filterzeile nach unten geht es in die Liste
        if (taste === 'ArrowDown' && (!ziel || ziel === von) && gruppe.closest('.taskhub')) {
          return tun(fokus(alle(document, `.taskhub-list :is(${AUFGABE_ZIEL})`)[0]));
        }
        if (ziel && ziel !== von) return tun(fokus(ziel));
        if (imMenue) { if (senkrecht) tun(); return; }
        // einzeilige Leiste: ↑ ↓ haben hier kein Ziel — vielleicht aber das Menü, das ihr Knopf geöffnet hat
        if (!senkrecht) return;
      }
      if (imFeld) return;
      // Ein Menü ist offen, der Fokus steht noch auf dem Auslöser (oder nirgends): ↓ ↑ führen hinein
      if (senkrecht && (!a || (a.matches('button') && !a.matches(BAUM_ZIEL)))) {
        const offen = alle(document, MENUE);
        const menue = offen[offen.length - 1];
        if (menue) {
          const ziele = alle(menue, KNOPF).filter((el) => el.closest(GRUPPE) === menue);
          if (ziele.length) return tun(fokus(taste === 'ArrowDown' ? ziele[0] : ziele[ziele.length - 1]));
        }
      }
      if (fenster) return;

      // ── Navigationsbaum ─────────────────────────────────────────────────────────────────
      const baum = a?.closest('.nav-tree');
      if (baum && a && (pfeil || rand)) {
        const ziele = alle(baum, BAUM_ZIEL);
        const kopf = a.closest('.side-board, .side-proj-head');
        const von = ziele.includes(a) ? a : (kopf?.querySelector('.side-board-name, .side-proj-name') as Ziel | null);
        if (!von) return;
        const i = ziele.indexOf(von);
        if (taste === 'Home') return tun(fokus(ziele[0]));
        if (taste === 'End') return tun(fokus(ziele[ziele.length - 1]));
        if (taste === 'ArrowDown') return tun(fokus(ziele[i + 1]) || undefined);
        if (taste === 'ArrowUp') return tun(fokus(ziele[i - 1]) || undefined);
        const zeile = von.closest('.side-board, .side-proj-head');
        const klapp = zeile?.querySelector('.side-board-arrow');
        const auf = !!klapp?.classList.contains('open');
        if (taste === 'ArrowRight') {
          if (klapp && !auf) return tun(klick(klapp));
          return tun(fokus(ziele[i + 1]) || undefined);
        }
        if (klapp && auf) return tun(klick(klapp));
        const eltern = von.matches('.side-card')
          ? von.closest('.side-cards')?.previousElementSibling?.querySelector('.side-board-name')
          : von.matches('.side-board-name') ? von.closest('.side-proj')?.querySelector('.side-proj-head .side-proj-name') : null;
        return tun(fokus(eltern) || undefined);
      }

      // ── Aufgaben-Zentrale ───────────────────────────────────────────────────────────────
      if (st.tasksOpen && (!a || a.closest('.taskhub'))) {
        const ziele = alle(document, `.taskhub-list :is(${AUFGABE_ZIEL})`);
        const von = (a?.closest(AUFGABE_ZIEL) ?? null) as Ziel | null;
        if (aufgabe && wahl) {
          if (taste === 'Enter') return tun(klick(aufgabe));
          // Leertaste: erledigen — der Fokus geht zur nächsten Zeile, diese verschwindet
          return tun(() => {
            const i = ziele.indexOf(aufgabe);
            const naechste = ziele[i + 1] ?? ziele[i - 1];
            const haken = aufgabe.querySelector('input[type="checkbox"]');
            if (haken) klick(haken);
            requestAnimationFrame(() => { if (naechste?.isConnected) fokus(naechste); });
          });
        }
        if (wahl) return;
        if (aufgabe && (taste === 'ArrowRight' || taste === 'ArrowLeft')) {
          const offen = aufgabe.getAttribute('aria-expanded') === 'true';
          if ((taste === 'ArrowRight') !== offen) return tun(klick(aufgabe));
          return;
        }
        if (senkrecht || rand) {
          if (!von) { if (a && a.closest('.task-tools, .taskhub-detail')) return; return tun(fokus(taste === 'ArrowUp' || taste === 'End' ? ziele[ziele.length - 1] : ziele[0])); }
          const i = ziele.indexOf(von);
          const ziel = taste === 'Home' ? ziele[0] : taste === 'End' ? ziele[ziele.length - 1] : ziele[i + (taste === 'ArrowDown' ? 1 : -1)];
          // über der ersten Zeile liegt die Filterleiste
          if (!ziel && taste === 'ArrowUp') return tun(fokus(alle(document, '.taskhub-filters .th-chip.on')[0] ?? alle(document, '.taskhub-filters button')[0]));
          return tun(fokus(ziel) || undefined);
        }
        return;
      }
      if (st.tasksOpen || st.searchOpen) return;

      // ── Übersicht (Kacheln) und Netz ────────────────────────────────────────────────────
      if (st.view === 'overview' && (!a || a.closest('.ov-graph-svg, .ov-canvas'))) {
        const netz = alle(document, NETZ_ZIEL);
        const ziele = netz.length ? netz : alle(document, KACHEL_ZIEL);
        if (!ziele.length) return;
        const von = (a?.closest('.ov-graph-node, .react-flow__node-ovBoard') ?? null) as Ziel | null;
        if (wahl) {
          if (!von || a !== von) return;          // Enter auf einem Knopf IN der Kachel gehört dem Knopf
          return tun(klick(von));
        }
        if (rand) return;
        if (!von) {
          const hier = ziele.find((el) => el.classList.contains('here') || el.querySelector('.ov-board.hier')) ?? ziele[0];
          return tun(fokus(hier));
        }
        return tun(fokus(inRichtung(ziele, von, taste)) || undefined);
      }
    };
    // Capture: vor React Flow (Pfeile verschieben dort die fokussierte Kachel) und vor den Menüs selbst
    window.addEventListener('keydown', onKey, true);
    // Alt+W klappt am Telefon den Baum auf — dann soll die Tastatur auch darin stehen
    const inDenBaum = () => window.setTimeout(() => {
      const feld = alle(document, '.nav-panel .side-board.active .side-board-name')[0];
      if (feld) fokus(feld);
    }, 80);
    window.addEventListener('pixinotes:navigator', inDenBaum);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pixinotes:navigator', inDenBaum); };
  }, []);
}
