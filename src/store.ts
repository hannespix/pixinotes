// M217: MUSS vor dem persist-Init stehen — danach ist der Speicher belegt
// und „erster Start" nicht mehr feststellbar
import './lib/firstRun';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fristAnkerNachLaden } from './lib/fristAnker';
import type { BoardDoc, BoardState } from './store/typen';
import { gruppen, kartenSperren, leseschutz, leseschutzAus, notizSchutz } from './store/schutz';
import { selectActiveBoard } from './store/selektoren';
import { speicherAblage, speicherAuswahl, speicherMigration } from './store/speicher';
import { strukturScheibe } from './store/struktur';
import { ansichtScheibe } from './store/ansicht';
import { kartenScheibe } from './store/karten';
import { abgleichScheibe } from './store/abgleich';
import { zeichnenScheibe } from './store/zeichnen';
import { verlaufScheibe } from './store/verlauf';
import { kantenScheibe } from './store/kanten';
import { kommentareScheibe } from './store/kommentare';
import { hinweiseScheibe } from './store/hinweise';

/*
 * M480: Der Board-Speicher liegt in Scheiben unter src/store/ (typen, schutz, verlauf, speicher, start, hinweise,
 * selektoren sowie je eine Scheibe für ansicht, struktur, karten, kanten, zeichnen, kommentare, abgleich). Diese Datei
 * bleibt der eine Einstieg: Sie setzt den Speicher zusammen und exportiert dieselben Namen wie zuvor.
 */
export { FOLIEN_SEITE } from './store/typen';
export type { Stroke, BoardDoc, CommentThread, Tool, CardTemplate, AiProvider, AiSettings, Project, BoardSortierung, EbeneLoeschen, Space } from './store/typen';
export { anhaengeMitnehmen } from './store/karten';
export { hinweisMitKnopf, hinweisKnopfDruecken } from './store/hinweise';
export { selectActiveBoard, selectNurLesen, useNurLesen, useKarteFest } from './store/selektoren';
export { ohneLeseschutz, LESE_HINWEIS, persistHaken, vorUmbauHaken, FREMD_SCHUB_AB, setzeKartenSperren, setzeNotizSchutz, GRUPPE_EREIGNIS, setzeGruppe, karteFest, gruppeVon } from './store/schutz';
export type { GastRecht, GruppenInfo } from './store/schutz';
export { verlaufAbgrenzen, mutedHistory, kamVonAussen, NOTIZ_EXTERN } from './store/verlauf';
export { getWriterRole, istZuAlt, singleWriterSupported, flushPersist, adoptPersistedState, claimWriter, takeOverWriter, isImportedState, markImported, runDerived, inDerived, reassertPersist } from './store/speicher';
export type { WriterRole } from './store/speicher';
export { START_BOARD_NAME, START_BOARD_NAME_EN, leeresStartboard, ohneStartboard, alteNamenOhneEmoji, startNamenAufEnglisch } from './store/start';

// M459: Wurde ein Text geschrieben, bevor die Fristen-Erkennung geladen war, trägt der Speicher den Anker danach nach
fristAnkerNachLaden(() => useBoard.getState().fristAnkerNachtragen());

export const useBoard = create<BoardState>()(
  persist(
    (setRoh, get) => {
      // M360: jeder Schreibzugriff der Oberfläche läuft durch den Leseschutz (siehe oben)
      const set: typeof setRoh = ((teil: unknown, ersetzen?: boolean) => {
        if (leseschutzAus > 0) return (setRoh as (t: unknown, e?: boolean) => void)(teil, ersetzen);
        const vor = get();
        if (kartenSperren.size === 0 && notizSchutz.size === 0 && gruppen.size === 0 && !vor.boards.some((b) => b.geteiltRolle === 'lesen')) return (setRoh as (t: unknown, e?: boolean) => void)(teil, ersetzen);
        let neu = (typeof teil === 'function' ? (teil as (s: BoardState) => Partial<BoardState>)(vor) : teil) as Partial<BoardState>;
        if (neu.boards && neu.boards !== vor.boards) neu = { ...neu, boards: leseschutz(vor.boards, neu.boards) };
        return (setRoh as (t: unknown, e?: boolean) => void)(neu, ersetzen);
      }) as typeof setRoh;
      const patchActive = (fn: (b: BoardDoc) => Partial<BoardDoc>) => {
        const active = selectActiveBoard(get());
        if (!active) return;
        set({
          boards: get().boards.map((b) =>
            b.id === active.id ? { ...b, ...fn(b) } : b,
          ),
        });
      };
      return {
        ...strukturScheibe(set, get),
        ...ansichtScheibe(set, get),
        ...kartenScheibe(set, get, patchActive),
        ...abgleichScheibe(set, get),
        ...zeichnenScheibe(set, get, patchActive),
        ...verlaufScheibe(set, get),
        ...kantenScheibe(set, get, patchActive),
        ...kommentareScheibe(set, get, patchActive),
        ...hinweiseScheibe(set, get),
      };
    },
    {
      name: 'pixinotes-board',
      version: 5,
      // M525: eigene Ablage statt createJSONStorage — die schrieb bei JEDER Store-Änderung den ganzen Stand als JSON
      storage: speicherAblage,
      partialize: speicherAuswahl,
      migrate: speicherMigration,
    },
  ),
);
