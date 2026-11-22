// M425: Präsentationen mit Vibe Studio direkt auf dem Board.
//
// Gewünscht: „Können wir das Präsentationstool Vibe Studio irgendwie als Modul in PixiNotes integrieren? Dass man
// quasi Vibe-Studio-Präsentationen direkt auf dem PixiNotes-Whiteboard erstellen kann?"
//
// Vibe Studio ist eine Ein-Datei-Anwendung (Reveal.js-Folien mit eingebautem Editor). PixiNotes kann solche Dateien
// schon als „Eigene App" ausführen — abgeschottet in einer Sandbox, der Entwurf des Editors (localStorage) bleibt
// über die Speicher-Brücke an der Karte (htmlStore.ts). Das Modul legt also eine App-Karte mit der leeren Vorlage an
// und startet sie gleich. Die Vorlage liegt neben der App (public/vorlagen, erzeugt von werkzeug/vibestudio-vorlage.mjs)
// und wird erst beim Anlegen geladen — 1,2 MB, die sonst jeder Start mitschleppen müsste.

/** Erkennungszeichen an der Karte (data.vorlage) — schaltet Vollbild aus der Folie heraus frei */
export const VIBE_STUDIO = 'vibestudio';

/** Zuerst neben der App; die Ein-Datei-Fassung (file://) holt sie von der veröffentlichten PixiNotes-Seite */
const ORTE = ['vorlagen/vibestudio.html', 'https://hannespix.github.io/pixinotes/vorlagen/vibestudio.html'];

let geladen: Promise<string> | null = null;

/** Die leere Vibe-Studio-Datei. Schlägt nur fehl, wenn keiner der Orte erreichbar ist (offline in der Ein-Datei-Fassung). */
export function vibeStudioVorlage(): Promise<string> {
  geladen ??= (async () => {
    for (const ort of ORTE) {
      try {
        const res = await fetch(ort);
        if (!res.ok) continue;
        const text = await res.text();
        // nur die echte Vorlage — keine Ersatzseite eines Servers (404 als index.html)
        if (text.includes('editor-present') && text.includes('Reveal')) return text;
      } catch { /* nächster Ort */ }
    }
    throw new Error('Vorlage nicht erreichbar');
  })();
  // ein Fehlschlag soll beim nächsten Versuch neu laden dürfen
  geladen.catch(() => { geladen = null; });
  return geladen;
}

/** Karten, die beim ersten Erscheinen gleich starten sollen (gerade angelegt) — nur in dieser Sitzung */
const sofort = new Set<string>();
export const sofortStartenVormerken = (id: string) => { sofort.add(id); };
/** true genau einmal je vorgemerkter Karte */
export const sofortStarten = (id: string) => sofort.delete(id);

// ───── M428: Präsentation lesen und per KI überarbeiten ─────

/** Ist dieser Quelltext eine Präsentation aus Vibe Studio? (auch eine selbst gespeicherte, importierte) */
export const istVibeStudio = (html: string): boolean => html.includes('window.DeckEditor') && html.includes('editor-present');

/** Eine Folie, wie sie gerade in der laufenden Präsentation steht (samt allen Bearbeitungen im Editor) */
export interface VibeFolieStand {
  klassen: string;
  name: string;
  marke: string;
  titel: string;
  untertitel: string;
  absaetze: string[];
  punkte: { titel: string; text: string }[];
  zahl: string;
  zusatz: string[];
  notiz: string;
}

/**
 * Die Brücke in die laufende Präsentation: Auf Anfrage liest sie die Folien aus dem DOM — in der Reihenfolge und mit
 * allen Änderungen aus dem Editor — und gibt sie als Text heraus. Mehr nicht: kein Schreiben, kein Speicher. Sie wird
 * beim Start der Karte eingesetzt (HtmlAppCard), wirkt also auch für schon angelegte und importierte Präsentationen.
 */
export function vibeBruecke(id: string): string {
  return `<script>(function(){var ID=${JSON.stringify(id)};
function t(e){return e?String(e.textContent||'').replace(/\\s+/g,' ').trim():'';}
function lesen(){var out=[];document.querySelectorAll('.reveal .slides>section').forEach(function(s){
 var q=function(sel){return s.querySelector(sel);},qa=function(sel){return Array.prototype.slice.call(s.querySelectorAll(sel));};
 var punkte=[];qa('.rules>div').forEach(function(d){punkte.push({titel:t(d.querySelector('h3,h4')),text:t(d.querySelector('p'))});});
 qa('.flow-card').forEach(function(d){punkte.push({titel:t(d.querySelector('.small-label')),text:t(d.querySelector('.flow-say,p'))});});
 if(!punkte.length)qa('.git-basics>div,.decision-priorities>div,.intro-facts>p').forEach(function(d){var h=d.querySelector('h3,h4,.git-term,.priority-label');punkte.push({titel:t(h),text:t(d.querySelector('p:not(.git-term)'))||(h?'':t(d))});});
 var abs=[];qa('p.slide-copy,p.statement-sub,p.endnote,p.quote-by,p.story-copy').forEach(function(p){if(p.closest('.rules,.flow-card,.git-basics,.decision-priorities,.foot .x'))return;var x=t(p);if(x&&abs.indexOf(x)<0)abs.push(x);});
 out.push({klassen:s.className,name:s.getAttribute('data-name')||'',marke:t(q('.eyebrow')),titel:t(q('.chapter-title h1'))||t(q('h2')),untertitel:t(q('.chapter-title p'))||t(q('.signature')),
  absaetze:abs.slice(0,6),punkte:punkte.slice(0,6),zahl:t(q('.count')),zusatz:qa('.user-text').map(t).filter(Boolean).slice(0,6),notiz:t(q('aside.notes'))});});
 return out;}
window.addEventListener('message',function(e){var d=e.data;if(!d||d.__pixiVibe!==ID||d.frage!=='lesen')return;
 try{parent.postMessage({__pixiVibe:ID,antwort:'lesen',titel:document.title,folien:lesen()},'*');}catch(_){}});
})();</` + 'script>';
}

/** Die Brücke vor </body> einsetzen (oder ans Ende) */
export function mitBruecke(id: string, html: string): string {
  if (!istVibeStudio(html)) return html;
  const i = html.lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + vibeBruecke(id) + html.slice(i) : html + vibeBruecke(id);
}

/** Ereignis an die Karte: starten (falls sie nicht läuft) — sie antwortet nicht, man wartet auf den Rahmen */
export const HAPP_STARTEN = 'pixinotes:happ-starten';
/** Ereignis an die Karte: der Quelltext wurde ersetzt — läuft sie, neu laden */
export const HAPP_NEU = 'pixinotes:happ-neu';

/**
 * Die Folien einer Präsentations-Karte lesen. Läuft die Karte nicht, wird sie gestartet; dann fragt PixiNotes die
 * Brücke so lange, bis sie antwortet (höchstens `ms`).
 */
export async function vibeLesen(id: string, ms = 20000): Promise<{ titel: string; folien: VibeFolieStand[] }> {
  const rahmen = () => document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"] iframe.happ-frame`) as HTMLIFrameElement | null;
  if (!rahmen()) window.dispatchEvent(new CustomEvent(HAPP_STARTEN, { detail: id }));
  return new Promise((ok, nein) => {
    const ende = Date.now() + ms;
    let uhr = 0;
    const weg = () => { window.removeEventListener('message', antwort); window.clearInterval(uhr); };
    const antwort = (e: MessageEvent) => {
      const d = e.data as { __pixiVibe?: string; antwort?: string; titel?: string; folien?: VibeFolieStand[] } | null;
      const r = rahmen();
      if (!d || d.__pixiVibe !== id || d.antwort !== 'lesen' || !r || e.source !== r.contentWindow || !Array.isArray(d.folien)) return;
      weg();
      ok({ titel: String(d.titel ?? ''), folien: d.folien.slice(0, 60) });
    };
    window.addEventListener('message', antwort);
    const fragen = () => {
      if (Date.now() > ende) { weg(); nein(new Error('Die Präsentation antwortet nicht – bitte die Karte einmal starten (▶) und erneut versuchen.')); return; }
      rahmen()?.contentWindow?.postMessage({ __pixiVibe: id, frage: 'lesen' }, '*');
    };
    uhr = window.setInterval(fragen, 400);
    fragen();
  });
}
