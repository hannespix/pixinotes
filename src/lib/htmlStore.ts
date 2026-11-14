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
/** Zeitstempel des lokalen Speicherstands (M162) — Vergleichsbasis, um beim
 *  Start zu entscheiden, ob der Team-Speicherstand neuer ist */
const STATE_AT = (id: string) => `happ-state-at:${id}`;

export const saveHtml = (id: string, html: string) => idbSet(SRC(id), html);
export const loadHtml = (id: string) => idbGet<string>(SRC(id));
/**
 * M371: Der Quelltext eines eigenen Tools reist mit dem Board (Konto, Gäste per Link, kurzer Link) — über
 * denselben Weg wie die Anhänge der Datei-Karten und landet dort unter `file:<id>`. Hier wird er in die
 * Ablage der Tools übernommen; liegt er schon dort, bleibt alles, wie es ist.
 */
export async function htmlUebernehmen(id: string): Promise<boolean> {
  if (await loadHtml(id)) return true;
  const blob = await idbGet<Blob | ArrayBuffer>(`file:${id}`);
  if (!blob) return false;
  const text = await (blob instanceof Blob ? blob : new Blob([blob])).text();
  if (!text) return false;
  await saveHtml(id, text);
  return true;
}
/** Größe des Inhalts auf diesem Gerät in Bytes (Tool-Quelltext vor Datei-Anhang) — −1, wenn nichts da ist */
export async function anhangGroesse(id: string): Promise<number> {
  try {
    const text = await idbGet<string>(SRC(id));
    if (text) return new Blob([text]).size;
    const blob = await idbGet<Blob | ArrayBuffer>(`file:${id}`);
    if (!blob) return -1;
    return blob instanceof Blob ? blob.size : blob.byteLength;
  } catch { return -1; }
}
/** Liegt der Inhalt dieser Karte auf dem Gerät — als Datei-Anhang oder als Tool-Quelltext? */
export async function anhangLokal(id: string): Promise<boolean> {
  try { return !!(await idbGet(`file:${id}`)) || !!(await idbGet(SRC(id))); } catch { return false; }
}

export async function saveAppState(id: string, data: Record<string, string>, at?: string): Promise<void> {
  await idbSet(STATE(id), data);
  await idbSet(STATE_AT(id), at ?? new Date().toISOString());
}
export const loadAppState = (id: string) => idbGet<Record<string, string>>(STATE(id));
export const loadAppStateAt = (id: string) => idbGet<string>(STATE_AT(id));

export async function deleteHtmlApp(id: string): Promise<void> {
  await idbDel(SRC(id));
  await idbDel(STATE(id));
  await idbDel(STATE_AT(id));
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
      const m = /^happ(?:-state(?:-at)?)?:(.+)$/.exec(key);
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
  /* M371: Mitrollen. Das Tool meldet, wohin gerollt wurde (als Anteil des Rollwegs — ein Telefon ist anders
     hoch als ein Beamer), und rollt dorthin, wohin PixiNotes es schickt. Mehr kann die Brücke nicht: kein
     Zugriff auf Inhalte, nur Rollstände; welches Element rollt, steht als Weg von <body> aus dabei. */
  var rollAus=0,rollT=null,rollOffen={},rollZiel={},rollLauf=false;
  function wurzel(){return document.scrollingElement||document.documentElement;}
  function weg(el){
    if(!el||el===document||el===document.documentElement||el===document.body)return '';
    var p=[];
    while(el&&el!==document.body&&el.parentNode){var i=0,k=el;while((k=k.previousElementSibling))i++;p.unshift(i);el=el.parentNode;if(p.length>40)return null;}
    return el===document.body?p.join('.'):null;
  }
  function finde(p){
    if(p==='')return wurzel();
    var el=document.body,t=String(p).split('.');
    for(var i=0;i<t.length&&el;i++)el=el.children[+t[i]];
    return el||null;
  }
  document.addEventListener('scroll',function(e){
    if(Date.now()<rollAus)return;
    var p=weg(e.target);if(p===null)return;
    var el=p===''?wurzel():e.target;
    var my=el.scrollHeight-el.clientHeight,mx=el.scrollWidth-el.clientWidth;
    rollOffen[p]={p:p,x:mx>0?el.scrollLeft/mx:0,y:my>0?el.scrollTop/my:0};
    if(rollT)return;
    rollT=setTimeout(function(){rollT=null;var l=rollOffen;rollOffen={};for(var k in l){try{parent.postMessage({__pixiHapp:APP_ID,roll:l[k]},'*');}catch(_){}}},90);
  },true);
  function rollSchritt(){
    var offen=false;
    for(var p in rollZiel){
      var el=finde(p),z=rollZiel[p];
      if(!el){delete rollZiel[p];continue;}
      var zy=z.y*(el.scrollHeight-el.clientHeight),zx=z.x*(el.scrollWidth-el.clientWidth);
      var dy=zy-el.scrollTop,dx=zx-el.scrollLeft;
      if(Math.abs(dy)<1.5&&Math.abs(dx)<1.5){el.scrollTop=zy;el.scrollLeft=zx;delete rollZiel[p];continue;}
      el.scrollTop+=dy*0.3;el.scrollLeft+=dx*0.3;offen=true;
    }
    rollAus=Date.now()+300;
    if(offen)requestAnimationFrame(rollSchritt);else rollLauf=false;
  }
  window.addEventListener('message',function(e){
    var d=e.data;if(!d||d.__pixiRoll!==APP_ID||!d.roll)return;
    var x=+d.roll.x,y=+d.roll.y;if(!(x>=0&&x<=1&&y>=0&&y<=1))return;
    rollZiel[String(d.roll.p||'')]={x:x,y:y};rollAus=Date.now()+300;
    if(!rollLauf){rollLauf=true;requestAnimationFrame(rollSchritt);}
  });
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
