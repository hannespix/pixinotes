/**
 * M397: PixiNotes vergibt keine Emojis mehr (nachgeladen von alteNamenOhneEmoji in start.ts, M532).
 */
import { mutedHistory } from './verlauf';
import { ohneVorsatz } from './start';
import { useBoard } from '../store';

/**
 * M397: PixiNotes vergibt keine Emojis mehr. Namen, die die App früher selbst vergeben hat („🏠 Mein Board",
 * „🏢 Arbeit", die Beispiel-Boards, „✨ Board 2" …), verlieren ihren Vorsatz – einmal je Gerät. Eigene Namen
 * bleiben unangetastet: Es zählt nur, was nach dem Vorsatz genau einem alten Standardnamen entspricht.
 */
const ALTE_STANDARDNAMEN = new Set(
  'Arbeit|Work|Mein Board|My board|Mein Schreibtisch|My desk|Board|Projekt|Project|Arbeitsplatz|Wissen & Nachschlagen|Zusammenarbeit & Projekte|Privat|Schreibtisch|Aufgaben-Zentrale|Zeiterfassung & Abwesenheit|Dienstreise|Dienstwagen|Wissen|Software & Tipps|Datenschutz & IT-Sicherheit|Ansprechpartner|Jour fixe|Mitarbeitergespräche|Beispielprojekt: E-Akte|Onboarding neue Kolleg:innen|Prozesse & Mindmap|Eigene Apps & Dateien|Familienplan|Routinen & Ziele|Verträge & Fristen|Besprechung|Meeting|Rückblick|Retrospective|Projektplan|Project plan|Brainstorming|Aufgaben-Board|Task board|Wochenplanung|Weekly planning|Entscheidung|Decision|SWOT|Workshop'.split('|'),
);
export function namenOhneEmoji(): void {
  try {
    if (localStorage.getItem('pixinotes-ohne-emoji')) return;
    localStorage.setItem('pixinotes-ohne-emoji', '1');
  } catch { return; }
  const neu = (n: string): string => {
    const kern = ohneVorsatz(n);
    return kern !== n && ALTE_STANDARDNAMEN.has(kern.replace(/ \d+$/, '')) ? kern : n;
  };
  const s = useBoard.getState();
  const boards = s.boards.map((b) => (neu(b.name) === b.name ? b : { ...b, name: neu(b.name) }));
  const spaces = s.spaces.map((sp) => {
    const projects = sp.projects.map((p) => (neu(p.name) === p.name ? p : { ...p, name: neu(p.name) }));
    const gleich = projects.every((p, i) => p === sp.projects[i]) && neu(sp.name) === sp.name;
    return gleich ? sp : { ...sp, name: neu(sp.name), projects };
  });
  if (boards.every((b, i) => b === s.boards[i]) && spaces.every((sp, i) => sp === s.spaces[i])) return;
  mutedHistory(() => useBoard.setState({ boards, spaces }));
}

