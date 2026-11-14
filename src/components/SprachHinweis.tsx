// M368: Wer kein Deutsch spricht, erfährt in der eigenen Sprache, dass der Browser die Oberfläche übersetzen kann.
//
// Der Browser bietet das meist von selbst an (die Seite weist sich als deutsch aus) — aber nicht jeder bemerkt
// das Angebot, und in der installierten App fehlt die Adresszeile. Der Hinweis erscheint einmal, steht selbst
// schon in der Sprache des Browsers und verschwindet, sobald übersetzt wird.
import { useEffect, useState } from 'react';
import { istUebersetzt } from '../lib/uebersetzung';

const MERKER = 'pixinotes-sprachhinweis';

/** Sprache → Hinweis. Fehlt eine Sprache, gilt Englisch. */
const TEXTE: Record<string, string> = {
  en: 'PixiNotes is written in German. Your browser can translate it: choose “Translate” in the browser menu or the address bar. Your notes stay as they are.',
  fr: 'PixiNotes est en allemand. Votre navigateur peut le traduire : choisissez « Traduire » dans le menu ou la barre d’adresse. Vos notes restent inchangées.',
  es: 'PixiNotes está en alemán. Tu navegador puede traducirlo: elige «Traducir» en el menú o en la barra de direcciones. Tus notas no se modifican.',
  it: 'PixiNotes è in tedesco. Il browser può tradurlo: scegli «Traduci» nel menu o nella barra degli indirizzi. Le tue note restano invariate.',
  pt: 'O PixiNotes está em alemão. O navegador pode traduzi-lo: escolha «Traduzir» no menu ou na barra de endereços. As suas notas não são alteradas.',
  nl: 'PixiNotes is in het Duits. Je browser kan het vertalen: kies ‘Vertalen’ in het menu of in de adresbalk. Je notities blijven ongewijzigd.',
  pl: 'PixiNotes jest po niemiecku. Przeglądarka może go przetłumaczyć: wybierz „Przetłumacz” w menu lub na pasku adresu. Twoje notatki pozostają bez zmian.',
  tr: 'PixiNotes Almancadır. Tarayıcınız çevirebilir: menüden veya adres çubuğundan “Çevir”i seçin. Notlarınız değişmez.',
  uk: 'PixiNotes написано німецькою. Браузер може перекласти його: виберіть «Перекласти» в меню або в адресному рядку. Ваші нотатки не змінюються.',
  ru: 'PixiNotes написан на немецком. Браузер может перевести его: выберите «Перевести» в меню или в адресной строке. Ваши заметки не изменяются.',
  ar: 'PixiNotes باللغة الألمانية. يمكن لمتصفحك ترجمته: اختر «ترجمة» من قائمة المتصفح أو شريط العنوان. ملاحظاتك تبقى كما هي.',
  zh: 'PixiNotes 的界面是德语。浏览器可以翻译它：在浏览器菜单或地址栏中选择“翻译”。你的笔记内容不会被改动。',
  ja: 'PixiNotes はドイツ語で書かれています。ブラウザーのメニューまたはアドレスバーの「翻訳」で翻訳できます。ノートの内容は変更されません。',
};

/** Die Sprache, in der der Hinweis erscheint — oder null, wenn der Nutzer Deutsch versteht */
export function hinweisSprache(sprachen: readonly string[]): string | null {
  const liste = sprachen.map((s) => s.toLowerCase().split('-')[0]).filter(Boolean);
  if (!liste.length || liste.includes('de')) return null;
  return liste.find((s) => s in TEXTE) ?? 'en';
}

const gemerkt = (): boolean => { try { return localStorage.getItem(MERKER) === '1'; } catch { return false; } };
const merken = () => { try { localStorage.setItem(MERKER, '1'); } catch { /* privates Fenster */ } };

export function SprachHinweis() {
  const [sprache, setSprache] = useState<string | null>(() => {
    // Ferngesteuerte Browser (Prüfreihen, Vorschau-Dienste) lesen keinen Hinweis — er läge nur im Weg
    if (typeof navigator === 'undefined' || navigator.webdriver || gemerkt()) return null;
    return hinweisSprache(navigator.languages?.length ? navigator.languages : [navigator.language ?? '']);
  });
  // Wird übersetzt, hat sich der Hinweis erledigt — für immer
  useEffect(() => {
    if (!sprache) return;
    const pruefen = () => { if (istUebersetzt()) { merken(); setSprache(null); } };
    pruefen();
    const b = new MutationObserver(pruefen);
    b.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });
    const t = setInterval(pruefen, 2000);
    return () => { b.disconnect(); clearInterval(t); };
  }, [sprache]);
  if (!sprache) return null;
  return (
    <div className="sprach-hinweis" role="status" translate="no" lang={sprache} dir={sprache === 'ar' ? 'rtl' : 'ltr'} data-taste="sprach-hinweis">
      <span aria-hidden="true">🌐</span>
      <span className="sprach-text">{TEXTE[sprache]}</span>
      <button onClick={() => { merken(); setSprache(null); }} data-taste="sprach-ok">OK</button>
    </div>
  );
}
