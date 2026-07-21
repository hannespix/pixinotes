// M158: Ablage für eingebettete HTML-Apps („Eigene Apps").
//
// Die Dateien sind oft mehrere MEGABYTE groß — sie dürfen deshalb NIEMALS in
// den localStorage-Boardstand wandern (5-MB-Limit, siehe canEmbed): ein
// einziges großes Tool würde sonst jeden weiteren Speichervorgang des ganzen
// Boards zum Scheitern bringen. Darum liegen Quelltext UND der von der App
// gespeicherte Zustand (localStorage-Shim) in IndexedDB; im Board selbst
// stehen nur Name und Größe.
import { idbDel, idbGet, idbKeys, idbSet } from './syncFolder';

const SRC = (id: string) => `happ:${id}`;
const STATE = (id: string) => `happ-state:${id}`;

export const saveHtml = (id: string, html: string) => idbSet(SRC(id), html);
export const loadHtml = (id: string) => idbGet<string>(SRC(id));

export const saveAppState = (id: string, data: Record<string, string>) => idbSet(STATE(id), data);
export const loadAppState = (id: string) => idbGet<Record<string, string>>(STATE(id));

export async function deleteHtmlApp(id: string): Promise<void> {
  await idbDel(SRC(id));
  await idbDel(STATE(id));
}

/**
 * Verwaiste Inhalte entsorgen — NUR beim App-Start aufrufen: dann ist der
 * Verlauf leer und kein Undo kann eine gelöschte App-Karte wiederbeleben,
 * deren Inhalt hier gerade aufgeräumt wurde. (Beim Löschen einer Karte wird
 * bewusst NICHT sofort gelöscht, damit Strg+Z die App komplett zurückholt.)
 */
export async function cleanupOrphanHtml(validIds: Set<string>): Promise<void> {
  try {
    const keys = await idbKeys();
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      const m = /^happ(?:-state)?:(.+)$/.exec(key);
      if (m && !validIds.has(m[1])) await idbDel(key);
    }
  } catch {
    // Aufräumen ist Komfort — ein Fehler hier darf den Start nie stören
  }
}

/**
 * Speicher-Shim, der VOR dem App-Quelltext injiziert wird.
 *
 * Hintergrund: Die App läuft in einer Sandbox OHNE allow-same-origin — das
 * ist die Sicherheits-Grundentscheidung von M158, denn mit gleicher Herkunft
 * könnte jedes eingebettete Tool den PixiNotes-Speicher lesen, überschreiben
 * oder per localStorage.clear() komplett löschen. In so einer Sandbox wirft
 * der Browser aber bei jedem localStorage-Zugriff einen Fehler — viele
 * Ein-Datei-Tools würden sofort abstürzen. Der Shim ersetzt local-/
 * sessionStorage durch einen In-Memory-Speicher, der Änderungen per
 * postMessage an PixiNotes meldet; dort landen sie in IndexedDB und werden
 * beim nächsten Start wieder eingespielt. Ergebnis: Die App kann ganz normal
 * speichern — aber nur in ihre EIGENE, pro Karte getrennte Schublade.
 */
export function storageShim(id: string, initial: Record<string, string>): string {
  return `<script>(function(){
  var APP_ID=${JSON.stringify(id)};
  var mem=${JSON.stringify(initial)};
  var t=null;
  function save(){if(t)clearTimeout(t);t=setTimeout(function(){try{parent.postMessage({__pixiHapp:APP_ID,store:mem},'*');}catch(e){}},250);}
  function makeStore(bag,persist){
    var s={
      getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(bag,k)?bag[k]:null;},
      setItem:function(k,v){bag[String(k)]=String(v);if(persist)save();},
      removeItem:function(k){delete bag[String(k)];if(persist)save();},
      clear:function(){for(var k in bag)delete bag[k];if(persist)save();},
      key:function(i){return Object.keys(bag)[i]||null;}
    };
    Object.defineProperty(s,'length',{get:function(){return Object.keys(bag).length;}});
    return s;
  }
  try{Object.defineProperty(window,'localStorage',{value:makeStore(mem,true),configurable:true});}catch(e){}
  try{Object.defineProperty(window,'sessionStorage',{value:makeStore({},false),configurable:true});}catch(e){}
})();</script>`;
}

/** Shim in den Quelltext einsetzen — möglichst früh, aber NIE vor den
 *  Doctype (das würde den Quirks-Mode auslösen und Layouts verändern) */
export function composeSrcdoc(id: string, html: string, initial: Record<string, string>): string {
  const shim = storageShim(id, initial);
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + shim + html.slice(head.index + head[0].length);
  const root = /<html[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + shim + html.slice(root.index + root[0].length);
  return shim + html;
}
