// M158: Speicher-Shim der eigenen HTML-Tools („Eigene Apps") — wird vor den Quelltext gesetzt.
// M535: aus htmlStore.ts herausgelöst. Nur die Tool-Karte (HtmlAppCard, nachgeladen) baut den Rahmen; die Ablage
// (htmlStore.ts) läuft schon beim Start (Aufräumen, Abgleich) und soll den langen Shim-Text nicht mitschleppen.

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
  /* M371: Mitrollen. Das Tool meldet, wohin gerollt wurde (als Anteil des Rollwegs – ein Telefon ist anders
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
  /* M384: Eingaben spiegeln. Das Tool meldet, was der Mensch davor eingibt – Feldwerte, Klicks, Enter, das
     Abschicken eines Formulars – und stellt nach, was PixiNotes ihm schickt (beim Vorführen: die Eingaben des
     Vorführenden). Nur echte Eingaben werden gemeldet (isTrusted), Nachgestelltes nicht – so entsteht kein Echo.
     Verweise, Datei- und Passwortfelder bleiben außen vor; in frei beschreibbare Bereiche kommt nur Text. */
  var submitAus=0;
  function ort(el){
    if(!el||!el.tagName)return null;
    if(el.id&&el.id.length<120&&document.getElementById(el.id)===el)return '#'+el.id;
    var p=weg(el);return p===''?null:p;
  }
  function suche(p){p=String(p);return p.charAt(0)==='#'?document.getElementById(p.slice(1)):(p===''?null:finde(p));}
  function schreibbar(el){return el&&el.closest?el.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]'):null;}
  function istFeld(el){
    if(!el||!el.tagName)return false;
    if(el.tagName==='TEXTAREA'||el.tagName==='SELECT')return true;
    return el.tagName==='INPUT'&&!/^(file|password|button|submit|reset|image|hidden)$/i.test(el.type||'');
  }
  function wert(el){
    if(el.tagName==='INPUT'&&/^(checkbox|radio)$/i.test(el.type||''))return {c:!!el.checked};
    if(el.tagName==='SELECT'&&el.multiple){var a=[];for(var i=0;i<el.options.length;i++)if(el.options[i].selected)a.push(i);return {m:a};}
    if(!istFeld(el))return {t:String(el.textContent||'')};
    return {v:String(el.value==null?'':el.value)};
  }
  function einHinaus(e){try{parent.postMessage({__pixiHapp:APP_ID,ein:e},'*');}catch(_){}}
  function feldMelden(e){
    if(!e.isTrusted)return;
    var el=istFeld(e.target)?e.target:schreibbar(e.target);if(!el)return;
    var p=ort(el),w=wert(el);if(!p)return;
    if((w.v&&w.v.length>4000)||(w.t&&w.t.length>4000))return;
    einHinaus({p:p,a:e.type==='change'?'change':'input',w:w});
  }
  document.addEventListener('input',feldMelden,true);
  document.addEventListener('change',feldMelden,true);
  document.addEventListener('click',function(e){
    if(!e.isTrusted)return;
    var el=e.target;if(!el||!el.tagName||!el.closest)return;
    /* Felder melden sich mit ihrem Wert; Verweise würden bei allen etwas öffnen oder herunterladen */
    if(istFeld(el)||schreibbar(el)||el.closest('a[href],a[download],label,option,input[type=file],input[type=password]'))return;
    var p=ort(el);if(!p)return;
    var r=el.getBoundingClientRect();
    einHinaus({p:p,a:'click',x:r.width>0?Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)):0.5,y:r.height>0?Math.min(1,Math.max(0,(e.clientY-r.top)/r.height)):0.5});
    /* Ein Klick auf den Abschicken-Knopf schickt das Formular ab – bei den anderen tut das der nachgestellte
       Klick. Das Abschicken selbst noch einmal zu melden, schickte dort zweimal ab. */
    var k=el.closest('button,input[type=submit],input[type=image]');
    if(k&&k.form&&(k.tagName==='INPUT'||!k.type||k.type==='submit'))submitAus=Date.now()+150;
  },true);
  document.addEventListener('keydown',function(e){
    if(!e.isTrusted||e.key!=='Enter'||e.isComposing||e.shiftKey||e.ctrlKey||e.metaKey||e.altKey)return;
    var el=e.target;if(!el||!el.tagName||el.tagName==='TEXTAREA'||schreibbar(el))return;
    var p=ort(el);if(p)einHinaus({p:p,a:'taste'});
  },true);
  document.addEventListener('submit',function(e){
    if(!e.isTrusted||Date.now()<submitAus)return;
    var p=ort(e.target);if(p)einHinaus({p:p,a:'submit'});
  },true);
  function setzen(el,w){
    if(!w)return false;
    if(typeof w.c==='boolean'){if(el.tagName!=='INPUT')return false;el.checked=w.c;return true;}
    if(w.m){if(el.tagName!=='SELECT')return false;for(var i=0;i<el.options.length;i++)el.options[i].selected=w.m.indexOf(i)>=0;return true;}
    if(typeof w.t==='string'){if(istFeld(el)||!schreibbar(el))return false;if(el.textContent!==w.t)el.textContent=w.t;return true;}
    if(typeof w.v!=='string'||!istFeld(el)||/^(checkbox|radio)$/i.test(el.type||''))return false;
    /* über den Setzer des Elementtyps – Tools, die ihre Felder selbst verwalten (React u. a.), merken es sonst nicht */
    var pr=el.tagName==='TEXTAREA'?window.HTMLTextAreaElement:el.tagName==='SELECT'?window.HTMLSelectElement:window.HTMLInputElement;
    var d=pr&&Object.getOwnPropertyDescriptor(pr.prototype,'value');
    try{if(d&&d.set)d.set.call(el,w.v);else el.value=w.v;}catch(_){el.value=w.v;}
    return true;
  }
  /* M414: Spiegeln. Führt jemand vor, schaltet PixiNotes das hier ein: Das Tool meldet dann bei jeder Änderung,
     wie es GERADE aussieht – ein Abbild ohne Skripte, mit den Werten der Felder und den Zeichenflächen als Bild.
     Die Zuschauer zeigen dieses Abbild (ohne das Tool selbst laufen zu lassen) und sehen so genau dasselbe,
     auch wo das Tool mit eigenem Speicherstand, Zufall oder Zeit rechnet. Große Stücke (Bilder, lange Stile)
     gehen als Teil mit Prüfsumme hinaus, damit sie nur einmal über die Leitung müssen. */
  var sp=0,spT=null,spMo=null,spAlt='',spLw=[],spLwAm=0,spH={};
  function spHash(v){var c=spH[v];if(c)return c;var h=2166136261,g=5381;for(var i=0;i<v.length;i++){var k=v.charCodeAt(i);h=Math.imul(h^k,16777619);g=(Math.imul(g,33)^k)|0;}c=(h>>>0).toString(36)+(g>>>0).toString(36)+v.length.toString(36);if(Object.keys(spH).length>60)spH={};spH[v]=c;return c;}
  function spPlan(){if(sp&&!spT)spT=setTimeout(function(){spT=null;spBild();},250);}
  function spBild(){
    if(!sp)return;
    var teile={},frisch=Date.now()-spLwAm>=900,lw=0,weg=[];if(frisch)spLwAm=Date.now();
    function teil(v,a){if(v.length<4096)return null;var h=spHash(v);teile[h]=v;return 'pn-teil-'+(a?'a':'t')+':'+h;}
    var o=document.documentElement,k=o.cloneNode(true),wa=document.createTreeWalker(o,1),wb=document.createTreeWalker(k,1),a=o,b=k;
    do{
      var t=a.tagName,i,r;
      if(t==='SCRIPT'){b.textContent='';b.removeAttribute('src');b.setAttribute('type','pn/aus');continue;}
      if(/^(IFRAME|FRAME|OBJECT|EMBED)$/.test(t)){weg.push([b,'div']);continue;}
      if(t==='INPUT'){if(/^(checkbox|radio)$/i.test(a.type)){if(a.checked)b.setAttribute('checked','');else b.removeAttribute('checked');}else if(/^(password|file)$/i.test(a.type))b.removeAttribute('value');else b.setAttribute('value',a.value);}
      else if(t==='TEXTAREA')b.textContent=a.value;
      else if(t==='OPTION'){if(a.selected)b.setAttribute('selected','');else b.removeAttribute('selected');}
      else if(t==='CANVAS'){var u='';try{u=(frisch||!spLw[lw])?a.toDataURL(a.width*a.height>500000?'image/jpeg':'image/png',.85):spLw[lw];}catch(_){}spLw[lw++]=u;weg.push([b,'img',u]);}
      for(i=b.attributes.length-1;i>=0;i--){var at=b.attributes[i];if(/^on/i.test(at.name)){b.removeAttribute(at.name);continue;}r=teil(at.value,1);if(r)b.setAttribute(at.name,r);}
      if(t==='STYLE'){r=teil(b.textContent,0);if(r)b.textContent=r;}
    }while((a=wa.nextNode())&&(b=wb.nextNode()));
    for(var j=0;j<weg.length;j++){var x=weg[j],e2=document.createElement(x[1]);for(var q=0;q<x[0].attributes.length;q++){var at2=x[0].attributes[q];if(!/^(on|src)/i.test(at2.name))e2.setAttribute(at2.name,at2.value);}if(x[1]==='img'){e2.setAttribute('data-pn-leinwand','');if(x[2])e2.setAttribute('src',teil(x[2],1)||x[2]);}x[0].parentNode.replaceChild(e2,x[0]);}
    var kopf=k.querySelector('head'),leib=k.querySelector('body'),ha=[];
    for(var m=0;m<k.attributes.length;m++)ha.push([k.attributes[m].name,k.attributes[m].value]);
    var bild={k:kopf?kopf.innerHTML:'',b:leib?leib.outerHTML:'<body></body>',a:ha,w:innerWidth},txt=JSON.stringify(bild);
    if(txt===spAlt)return;spAlt=txt;
    try{parent.postMessage(txt.length>4e6?{__pixiHapp:APP_ID,bild:null}:{__pixiHapp:APP_ID,bild:bild,teile:teile},'*');}catch(_){}
  }
  function spAn(an){
    sp=an?1:0;
    if(!an){if(spMo){spMo.disconnect();spMo=null;}return;}
    spAlt='';
    if(!spMo){spMo=new MutationObserver(spPlan);spMo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}
    spPlan();
  }
  document.addEventListener('input',spPlan,true);document.addEventListener('change',spPlan,true);
  setInterval(function(){if(sp&&document.querySelector('canvas'))spPlan();},1000);
  window.addEventListener('message',function(e){var d=e.data;if(e.source===parent&&d&&d.__pixiSpiegel===APP_ID)spAn(!!d.an);});
  /* M414: Wo im Tool zeigt der Laser? PixiNotes fragt mit der Stelle im Rahmen; die Antwort nennt das Element darunter
     (Weg ab <body>) und die Stelle darin – bei den Zuschauern hängt der Punkt dann am selben Inhalt. */
  window.addEventListener('message',function(e){
    var d=e.data;if(e.source!==parent||!d||d.__pixiWo!==APP_ID)return;
    var x=+d.x,y=+d.y,el=document.elementFromPoint(x,y),r;
    while(el&&el!==document.body&&el!==document.documentElement){r=el.getBoundingClientRect();if(getComputedStyle(el).display.indexOf('inline')!==0&&r.width>=12&&r.height>=12)break;el=el.parentElement;}
    var p=(!el||el===document.body||el===document.documentElement)?'':weg(el);if(p===null)p='';
    r=p===''?{left:0,top:0,width:innerWidth,height:innerHeight}:el.getBoundingClientRect();
    try{parent.postMessage({__pixiHapp:APP_ID,wo:{n:d.n,p:p,x:r.width?Math.min(1,Math.max(0,(x-r.left)/r.width)):.5,y:r.height?Math.min(1,Math.max(0,(y-r.top)/r.height)):.5}},'*');}catch(_){}
  });
  window.addEventListener('message',function(e){
    var d=e.data;if(e.source!==parent||!d||d.__pixiEin!==APP_ID||!d.ein||!d.ein.length)return;
    for(var i=0;i<d.ein.length&&i<60;i++){
      var x=d.ein[i],el=x&&suche(x.p);if(!el||!el.tagName)continue;
      try{
        if(x.a==='click'){
          if(istFeld(el)||(el.closest&&el.closest('a[href],a[download],input[type=file]')))continue;
          var r=el.getBoundingClientRect();
          el.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:r.left+r.width*(+x.x>=0&&+x.x<=1?+x.x:0.5),clientY:r.top+r.height*(+x.y>=0&&+x.y<=1?+x.y:0.5)}));
        }else if(x.a==='submit'){
          if(el.tagName!=='FORM')continue;
          if(el.requestSubmit)el.requestSubmit();else el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        }else if(x.a==='taste'){
          var k={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};
          el.dispatchEvent(new KeyboardEvent('keydown',k));el.dispatchEvent(new KeyboardEvent('keypress',k));el.dispatchEvent(new KeyboardEvent('keyup',k));
        }else if(setzen(el,x.w)){
          el.dispatchEvent(new Event('input',{bubbles:true}));
          if(x.a==='change')el.dispatchEvent(new Event('change',{bubbles:true}));
        }
      }catch(_){}
    }
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
