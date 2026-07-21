// Starter-Umgebung „Verwaltung" (z. B. Regierungspräsidium): eine sinnvolle
// Vorbelegung aus Bereichen → Projekten → Boards, mit der man sofort arbeiten
// kann — und die nebenbei jedes Modul im echten Einsatz erklärt.
// Alle IDs werden pro Aufruf frisch vergeben (mehrfach hinzufügbar, kollisionsfrei).
import type { Edge } from '@xyflow/react';
import type { BoardDoc, Space } from '../store';
import { uid, type AppNode } from '../types';

const DAY = 864e5;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

type Pos = { x: number; y: number };
type Block = Record<string, unknown>;

const h = (text: string): Block => ({ type: 'heading', props: { level: 3 }, content: text });
const p = (text: string): Block => ({ type: 'paragraph', content: text });
const li = (text: string): Block => ({ type: 'bulletListItem', content: text });
const check = (text: string, checked = false): Block => ({ type: 'checkListItem', props: { checked }, content: text });

const note = (pos: Pos, color: string, blocks: Block[], attrs?: Record<string, string>, width = 280): AppNode =>
  ({ id: uid(), type: 'note', width, position: pos, data: { color, blocks, ...(attrs ? { attrs } : {}) } } as AppNode);

const shape = (pos: Pos, kind: string, text: string, color = '#eef2ff', w = 170, hgt = 64): AppNode =>
  ({ id: uid(), type: 'shape', width: w, height: hgt, position: pos, data: { shape: kind, text, color } } as AppNode);

const edge = (source: AppNode, target: AppNode, label = ''): Edge =>
  ({ id: `e-${uid()}`, source: source.id, target: target.id, type: 'labeled', data: { label, kind: 'arrow' } } as Edge);

// Neue Modultypen (M165): Wochenplan, Zeiterfassung, Rahmen
const week = (pos: Pos, data: Record<string, unknown>, w = 620, hgt = 440): AppNode =>
  ({ id: uid(), type: 'week', width: w, height: hgt, position: pos, data } as AppNode);
const timecard = (pos: Pos, title: string, segs: Array<Record<string, unknown>>): AppNode =>
  ({ id: uid(), type: 'time', width: 500, height: 420, position: pos, data: { title, segs } } as unknown as AppNode);
const frame = (pos: Pos, w: number, hgt: number, name: string, color?: string): AppNode =>
  ({ id: uid(), type: 'frame', width: w, height: hgt, position: pos, dragHandle: '.frame-head', data: { name, ...(color ? { color } : {}) } } as AppNode);
const wentry = (day: number, start: number, dur: number, text: string, color = 0, who?: string): Record<string, unknown> =>
  ({ id: uid(), day, start, dur, text, color, ...(who ? { who } : {}) });

export interface Starter {
  spaces: Space[];
  boards: BoardDoc[];
  firstBoardId: string;
}

/** Baut die komplette Starter-Umgebung mit frischen IDs. */
export function buildStarter(): Starter {
  const boards: BoardDoc[] = [];
  const board = (name: string, nodes: AppNode[], edges: Edge[] = []): string => {
    const id = uid();
    boards.push({ id, name, nodes, edges });
    return id;
  };

  /* ================= Bereich 1: Arbeitsplatz ================= */

  // --- 🏠 Schreibtisch: Ankommen & Grundbedienung ---
  const deskNotes = [
    note({ x: 60, y: 100 }, 'yellow', [
      h('👋 Willkommen!'),
      p('Das ist dein Schreibtisch — für alles Schnelle. Klick in eine Notiz und tipp los; „/" öffnet das Block-Menü (Checklisten, Tabellen …).'),
      check('Karte mit Schwung übers Board werfen 🚀'),
      check('Doppelklick auf die Fläche = neue Notiz'),
      check('E-Mail (.eml/.msg) aus Outlook hierher ziehen'),
      check('Strg+K: alles durchsuchen'),
    ]),
    note({ x: 400, y: 100 }, 'sky', [
      h('🧭 So ist alles sortiert'),
      p('Oben links 🏠 öffnet die Übersicht: Bereiche → Projekte → Boards.'),
      li('Bereich = Lebensbereich (Arbeitsplatz, Wissen, Zusammenarbeit — und 🏡 Privat für Familie & Selbstorganisation)'),
      li('Projekt = Themenbündel'),
      li('Board = eine Arbeitsfläche'),
      p('Doppelte eckige Klammern verlinken Boards: [[Wissen]] oder [[Jour fixe]] — Chips unten an der Notiz springen hin.'),
    ]),
    note({ x: 740, y: 100 }, 'mint', [
      h('⚡ Schnelle Notizen'),
      p('Diese Fläche gehört dir. Wegwerf-Gedanken, Telefonnotizen, Zwischenstände — einfach hier ablegen und später einsortieren.'),
      p('Tipp: ➕ → Tagesnotiz legt eine Notiz mit heutigem Datum an.'),
    ]),
    note({ x: 400, y: 430 }, 'pink', [
      h('📞 Telefonnotiz (Beispiel)'),
      p('Fr. Weber, LRA Musterkreis, 0721 926-0: bittet um Rückruf wegen Az. 12-0815 bis Freitag.'),
    ], { status: 'offen', prio: 'hoch' }),
  ];
  const idDesk = board('🏠 Schreibtisch', deskNotes);

  // --- ✅ Aufgaben-Zentrale: Auto-Sammel-Kanban ---
  const centralKanban: AppNode = {
    id: uid(), type: 'kanban', width: 480, position: { x: 420, y: 120 },
    data: {
      title: '✅ Alles auf einen Blick', autoCollect: true,
      cols: ['Eingang', 'In Arbeit', 'Erledigt'],
      items: [],
    },
  } as AppNode;
  const idTasks = board('✅ Aufgaben-Zentrale', [
    note({ x: 80, y: 120 }, 'sky', [
      h('⟳ Dieses Board füllt sich selbst'),
      p('Das Kanban rechts hat Auto-Einsammeln aktiv (⟳ im Kopf): offene Aufgaben aus ALLEN Boards erscheinen hier automatisch — aus Kanbans, Notiz-Checklisten und Zeitplänen.'),
      li('↗ am Ticket springt zur Quelle'),
      li('Wird die Quelle erledigt, hakt sich das Ticket selbst ab'),
      li('Ticket anklicken = Details (Person, Frist, Beschreibung)'),
      p('Die ✅-Zentrale im Dock zeigt dieselben Aufgaben als Liste mit Erinnerungen.'),
    ]),
    centralKanban,
  ]);
  // Portal-Demo auf dem Schreibtisch: Klick springt in die Aufgaben-Zentrale
  boards.find((b) => b.id === idDesk)!.nodes.push(
    { id: uid(), type: 'portal', width: 200, position: { x: 60, y: 470 }, data: { boardId: idTasks } } as AppNode,
  );

  // --- ⏱️ Zeiterfassung & Abwesenheit (M165: mit echter Zeiterfassungs-Karte) ---
  const idTime = board('⏱️ Zeiterfassung & Abwesenheit', [
    note({ x: 70, y: 110 }, 'sky', [
      h('⏱️ So erfasst du Arbeitszeit'),
      p('Die Karte rechts ist eine echte Zeiterfassung: Ein Klick auf Arbeit/Pause/Fahrzeit/Dienstgeschäft startet — ein Klick auf eine andere Art wechselt nahtlos, Stop beendet.'),
      li('Zeilen sind direkt editierbar = unkompliziertes Nacherfassen'),
      li('Ansichten: Tag / Woche / Monat / Jahr — Klick springt tiefer'),
      li('Summen immer ohne Pausen (Fahrzeit + Dienstgeschäft zählen mit)'),
      p('Gestern ist als Beispiel vorbefüllt — einfach löschen (✕ an der Zeile).'),
    ], { kategorie: 'zeiterfassung' }),
    timecard({ x: 430, y: 110 }, 'Meine Arbeitszeit', [
      { id: uid(), date: iso(-1), start: 465, end: 480, kind: 'fahrt' },
      { id: uid(), date: iso(-1), start: 480, end: 720, kind: 'arbeit' },
      { id: uid(), date: iso(-1), start: 720, end: 750, kind: 'pause' },
      { id: uid(), date: iso(-1), start: 750, end: 870, kind: 'dienst', note: 'Ortstermin (Beispiel)' },
      { id: uid(), date: iso(-1), start: 870, end: 980, kind: 'arbeit' },
    ]),
    note({ x: 70, y: 470 }, 'yellow', [
      h('🗓️ Monatsende-Checkliste'),
      check('Alle Tage gebucht? (Monats-Ansicht der Karte zeigt Lücken)'),
      check('Dienstreisen als Fahrzeit + Dienstgeschäft erfasst?'),
      check('Gleitzeitsaldo im Rahmen?'),
      check('Abwesenheiten stimmen mit Kalender überein?'),
    ]),
    week({ x: 990, y: 110 }, {
      title: 'Dienstplan Referat (Beispiel)', days: 5, from: 8 * 60, to: 17 * 60,
      entries: [
        wentry(0, 9 * 60, 60, 'Jour fixe', 1),
        wentry(1, 10 * 60, 90, 'Sprechstunde', 3, 'Fr. K.'),
        wentry(3, 14 * 60, 60, 'Telefonbereitschaft', 4, 'Hr. M.'),
        wentry(4, 8 * 60 + 30, 60, 'Wochenabschluss', 0),
      ],
    }),
  ]);

  // --- ✈️ Dienstreise: Prozess + Kanban + Checkliste ---
  const drStart = shape({ x: 60, y: 90 }, 'terminator', 'Reise nötig', '#e6f7ec');
  const drAntrag = shape({ x: 290, y: 90 }, 'process', 'Dienstreiseantrag stellen');
  const drOk = shape({ x: 530, y: 90 }, 'decision', 'Genehmigt?', '#fff4e0', 160, 90);
  const drBuchen = shape({ x: 760, y: 90 }, 'process', 'Buchen (Bahn/Hotel)');
  const drAbrechnen = shape({ x: 760, y: 230 }, 'process', 'Abrechnung ≤ 6 Monate!', '#ffe9ef');
  const drEnde = shape({ x: 530, y: 230 }, 'terminator', 'Erledigt', '#e6f7ec');
  const idTravel = board('✈️ Dienstreise', [
    drStart, drAntrag, drOk, drBuchen, drAbrechnen, drEnde,
    {
      id: uid(), type: 'kanban', width: 440, position: { x: 60, y: 380 },
      data: {
        title: '✈️ Meine Dienstreisen',
        cols: ['Beantragt', 'Gebucht', 'Abgerechnet'],
        items: [
          { id: uid(), text: 'Fortbildung E-Akte, Stuttgart', col: 1, due: iso(12) },
          { id: uid(), text: 'Dienstbesprechung RP, Karlsruhe', col: 0, due: iso(25) },
        ],
      },
    } as AppNode,
    note({ x: 560, y: 380 }, 'yellow', [
      h('🧾 Nicht vergessen (Abrechnung)'),
      check('Fahrkarten/Belege gesammelt?'),
      check('Tagegeld: Abwesenheitszeiten notiert?'),
      check('Hotelrechnung auf Dienststelle ausgestellt?'),
      check('Antrag im Portal eingereicht?'),
    ]),
  ], [
    edge(drStart, drAntrag), edge(drAntrag, drOk),
    edge(drOk, drBuchen, 'ja'), edge(drOk, drEnde, 'nein'),
    edge(drBuchen, drAbrechnen, 'nach der Reise'), edge(drAbrechnen, drEnde),
  ]);

  // --- 🚗 Dienstwagen ---
  const idCar = board('🚗 Dienstwagen', [
    note({ x: 70, y: 110 }, 'white', [
      h('🚗 Spielregeln Fuhrpark'),
      li('Führerscheinkontrolle: halbjährlich im Sekretariat'),
      li('Fahrtenbuch VOR Abfahrt beginnen, nach Rückkehr abschließen'),
      li('Tanken mit Flottenkarte (im Handschuhfach)'),
      li('Schäden sofort melden — nicht erst bei Rückgabe'),
    ]),
    {
      id: uid(), type: 'kanban', width: 440, position: { x: 400, y: 110 },
      data: {
        title: '🔑 Reservierungen',
        cols: ['Angefragt', 'Reserviert', 'Zurückgegeben'],
        items: [
          { id: uid(), text: 'KA-RP 123 — Außentermin Pforzheim', col: 1, due: iso(3) },
        ],
      },
    } as AppNode,
    note({ x: 70, y: 420 }, 'sky', [
      h('👤 Fuhrparkverwaltung'),
      p('Hr. Schneider · Raum U 012 · Tel. -2140'),
      p('Vertretung: Fr. Öztürk · Tel. -2141'),
    ], { zimmer: 'U 012', telefon: '-2140' }),
  ]);

  /* ================= Bereich 2: Wissen & Nachschlagen ================= */

  // --- 💡 Wissen ---
  const idKnow = board('💡 Wissen', [
    note({ x: 60, y: 100 }, 'sky', [
      h('💡 So baust du deine Wissensbasis'),
      li('#tags in den Text schreiben — Strg+K und „#" zeigt alle Themen'),
      li('[[Ansprechpartner]] verlinkt Boards, das ↩-Panel zeigt Rückverweise'),
      li('🏷 (Karte auswählen): Eigenschaften wie stand = 2026 — durchsuchbar'),
      li('🔖 macht jede Karte zur Vorlage fürs ➕-Menü'),
    ]),
    note({ x: 400, y: 100 }, 'white', [
      h('📁 E-Akte — so funktioniert es'),
      p('#wissen #eakte · Stand: Juli 2026'),
      li('Neues Schriftstück: immer über „Dokument importieren", nie per Mail-Anhang weiterleiten'),
      li('Aktenzeichen-Systematik: [Referat]-[Jahr]-[laufende Nr.]'),
      li('Verfügungen digital zeichnen — Papierumlauf nur noch bei Ausnahmen'),
      li('Aussonderung/Archiv: Frist 5 Jahre, dann Angebot ans Landesarchiv'),
    ], { stand: '2026-07', quelle: 'Orga-Verfügung 4/26' }),
    note({ x: 740, y: 100 }, 'white', [
      h('🔁 Vertretungsregelung'),
      p('#wissen'),
      li('Abwesenheitsnotiz in Outlook UND Telefon umleiten'),
      li('Vertretung braucht Zugriff auf Funktionspostfach'),
      li('Laufende Fristen an Vertretung übergeben (Liste!)'),
    ]),
    note({ x: 400, y: 440 }, 'mint', [
      h('🖨️ Wie funktioniert…? (Sammler)'),
      p('Lege hier für jedes „Wie ging das nochmal?" eine eigene Notiz an — Scanner-Codes, Raumbuchung, Beflaggungskalender, Formularschrank …'),
    ]),
  ]);

  // --- 🖥️ Software & Tipps ---
  const idSoft = board('🖥️ Software & Tipps', [
    note({ x: 60, y: 100 }, 'white', [
      h('📧 Outlook-Tipps'),
      p('#software'),
      li('Strg+Umschalt+M: neue Mail von überall'),
      li('QuickSteps für „an Registratur weiterleiten"'),
      li('Regeln: Newsletter automatisch in Unterordner'),
    ]),
    note({ x: 380, y: 100 }, 'white', [
      h('📊 Excel-Tipps'),
      p('#software'),
      li('Strg+T: Bereich als Tabelle (Filter inklusive)'),
      li('SVERWEIS ist tot — XVERWEIS nutzen'),
      li('Daten → Text in Spalten rettet CSV-Chaos'),
    ]),
    note({ x: 700, y: 100 }, 'white', [
      h('🗂️ Fachverfahren (Platzhalter)'),
      p('#software · Notiere hier die Kniffe eurer Fachverfahren — Anmeldung, Stapelverarbeitung, wer hilft bei Fehlern.'),
    ]),
    {
      id: uid(), type: 'kanban', width: 430, position: { x: 60, y: 400 },
      data: {
        title: '🎓 Lern-Liste',
        cols: ['Will ich lernen', 'Dran', 'Kann ich'],
        items: [
          { id: uid(), text: 'Serienbrief mit Word', col: 0 },
          { id: uid(), text: 'PixiNotes-Präsentationsmodus ▶', col: 1 },
        ],
      },
    } as AppNode,
  ]);

  // --- 🔐 Datenschutz & IT-Sicherheit ---
  const dsVerdacht = shape({ x: 60, y: 420 }, 'terminator', 'Datenpanne vermutet', '#ffe9ef');
  const dsMelden = shape({ x: 300, y: 420 }, 'process', 'Sofort DSB + Vorgesetzte informieren');
  const dsPflicht = shape({ x: 560, y: 420 }, 'decision', 'Meldepflichtig?', '#fff4e0', 160, 90);
  const dsBehoerde = shape({ x: 800, y: 420 }, 'process', 'Aufsichtsbehörde ≤ 72 h!', '#ffe9ef');
  const dsDoku = shape({ x: 560, y: 560 }, 'process', 'Intern dokumentieren');
  const idSec = board('🔐 Datenschutz & IT-Sicherheit', [
    note({ x: 60, y: 100 }, 'yellow', [
      h('🔐 Tägliche Basics'),
      check('Bildschirm sperren beim Verlassen (Win+L)'),
      check('Clean Desk: keine Akten offen liegen lassen'),
      check('USB-Sticks: nur dienstliche, verschlüsselt'),
      check('Verdächtige Mail? NICHT klicken — IT-Support melden'),
    ]),
    note({ x: 400, y: 100 }, 'white', [
      h('🎣 Phishing erkennen'),
      li('Absenderadresse GENAU lesen (rp-karlsruhe.de ≠ rp-karlsruhe-portal.de)'),
      li('Druck („sofort!", „Konto gesperrt") = Alarmzeichen'),
      li('Links: erst hovern, dann (nicht) klicken'),
      li('Im Zweifel: anrufen statt antworten'),
    ]),
    dsVerdacht, dsMelden, dsPflicht, dsBehoerde, dsDoku,
  ], [
    edge(dsVerdacht, dsMelden), edge(dsMelden, dsPflicht),
    edge(dsPflicht, dsBehoerde, 'ja'), edge(dsPflicht, dsDoku, 'nein'),
  ]);

  // --- 👥 Ansprechpartner ---
  const idPeople = board('👥 Ansprechpartner', [
    note({ x: 60, y: 100 }, 'sky', [
      h('👥 Kontakt-Karten'),
      p('Eine Notiz pro Kontakt, Eigenschaften über 🏷 (z. B. telefon, zimmer, zustaendig) — Strg+K findet dann „wer macht Reisekosten?" sofort.'),
    ]),
    note({ x: 380, y: 100 }, 'white', [h('🛠️ IT-Support'), p('Hotline -4444 · it-support@rp.example'), p('Mo–Fr 7:30–16:30')], { telefon: '-4444', zustaendig: 'Hardware, Software, Passwörter' }),
    note({ x: 680, y: 100 }, 'white', [h('🧑‍💼 Personalreferat'), p('Fr. Brandt · Zi. 234 · Tel. -2010'), p('Urlaub, Teilzeit, Mitarbeitergespräche')], { zimmer: '234', telefon: '-2010', zustaendig: 'Personal' }),
    note({ x: 380, y: 340 }, 'white', [h('📮 Poststelle & Registratur'), p('EG, Zi. 011 · Leerung 10:00 / 14:30'), p('E-Akte-Scannen: Fr. Klein, -3050')], { zimmer: '011', telefon: '-3050' }),
    note({ x: 680, y: 340 }, 'white', [h('🛡️ Datenschutzbeauftragte'), p('Hr. Roth · Tel. -1900 · dsb@rp.example'), p('Datenpannen SOFORT melden — siehe [[Datenschutz & IT-Sicherheit]]')], { telefon: '-1900', zustaendig: 'Datenschutz' }),
  ]);

  /* ================= Bereich 3: Zusammenarbeit & Projekte ================= */

  // --- 📝 Jour fixe ---
  const idJf = board('📝 Jour fixe', [
    note({ x: 60, y: 100 }, 'sky', [
      h('📝 Protokoll-Vorlage'),
      p('Datum: … · Teilnehmende: …'),
      li('TOP 1: '),
      li('TOP 2: '),
      p('Beschlüsse:'),
      check('… (Verantwortlich, Frist)'),
      p('Tipp: Karte auswählen → 🔖 „Als Vorlage" — dann steckt sie im ➕-Menü.'),
    ]),
    note({ x: 380, y: 100 }, 'white', [
      h(`🗓️ Jour fixe ${new Date(Date.now() - 2 * DAY).toLocaleDateString('de-DE')}`),
      p('Teilnehmende: Ref. 12 komplett'),
      li('TOP 1: E-Akte-Rollout — Schulungstermine stehen'),
      li('TOP 2: Urlaubsplanung August abgestimmt'),
      check('Hr. M.: Schulungsraum buchen', true),
      check('Fr. K.: Leitfaden an alle verteilen'),
    ]),
    {
      id: uid(), type: 'kanban', width: 430, position: { x: 700, y: 100 },
      data: {
        title: '📌 Offene Punkte Jour fixe',
        items: [
          { id: uid(), text: 'Leitfaden E-Akte verteilen', col: 0, due: iso(4), who: 'Fr. K.' },
          { id: uid(), text: 'Beamer im Sitzungssaal prüfen lassen', col: 1 },
        ],
      },
    } as AppNode,
  ]);

  // --- 🗣️ Mitarbeitergespräche ---
  const idMag = board('🗣️ Mitarbeitergespräche', [
    note({ x: 60, y: 100 }, 'yellow', [
      h('🗣️ Vorbereitung (Führungskraft)'),
      check('Letztjährige Vereinbarungen rauslegen'),
      check('Konkrete Beispiele für Rückmeldung sammeln'),
      check('Fortbildungswünsche des Vorjahres prüfen'),
      check('Raum ohne Störungen reservieren, 60–90 min'),
    ]),
    note({ x: 400, y: 100 }, 'white', [
      h('📄 Gesprächsnotiz-Vorlage'),
      p('Name: … · Datum: …'),
      li('Rückblick: Was lief gut / schwierig?'),
      li('Zusammenarbeit & Führung'),
      li('Ziele & Aufgaben fürs nächste Jahr'),
      li('Fortbildung / Entwicklung'),
      p('Vereinbarungen (wer, was, bis wann):'),
      check('…'),
    ]),
    note({ x: 740, y: 100 }, 'pink', [
      h('🔒 Vertraulich!'),
      p('Gesprächsnotizen gehören NICHT in geteilte Ordner. PixiNotes speichert lokal — beim Sync-Ordner bewusst entscheiden, ob dieses Board mit synchronisiert werden soll.'),
    ]),
  ]);

  // --- 🚀 Beispielprojekt: alle Module verbunden ---
  const gRow1 = uid(), gRow2 = uid(), gRow3 = uid(), gRow4 = uid();
  const projGantt: AppNode = {
    id: uid(), type: 'gantt', width: 620, height: 250, position: { x: 60, y: 90 },
    data: {
      title: '📅 Zeitplan E-Akte-Einführung', dayWidth: 22,
      rows: [
        { id: gRow1, name: 'Ist-Analyse Aktenbestand', start: iso(-7), end: iso(3), color: '#4f7cff', progress: 60, who: 'Fr. Klein' },
        { id: gRow2, name: 'Schulungen Referat', start: iso(4), end: iso(14), color: '#3fa564', who: 'Hr. Roth', dep: gRow1 },
        { id: gRow3, name: 'Pilotbetrieb', start: iso(15), end: iso(29), color: '#a05fd4', dep: gRow2 },
        { id: gRow4, name: 'Go-Live 🎉', start: iso(30), end: iso(30), color: '#e07a3f', dep: gRow3 },
      ],
    },
  } as AppNode;
  const projKanban: AppNode = {
    id: uid(), type: 'kanban', width: 440, position: { x: 60, y: 400 },
    data: {
      title: '🚀 Projekt-Aufgaben',
      items: [
        { id: uid(), text: 'Scanner für Poststelle bestellen', col: 1, due: iso(6), who: 'Hr. Schneider' },
        { id: uid(), text: 'Schulungsunterlagen aktualisieren', col: 0, due: iso(9) },
        { id: uid(), text: 'Kick-off durchgeführt', col: 2 },
      ],
    },
  } as AppNode;
  const projMermaid: AppNode = {
    id: uid(), type: 'mermaid', width: 400, height: 260, position: { x: 540, y: 400 },
    data: {
      code: 'flowchart TD\n  A[Posteingang Papier] --> B[Scannen & Signieren]\n  B --> C{lesbar & vollständig?}\n  C -->|ja| D[In E-Akte ablegen]\n  C -->|nein| E[Nachscannen]\n  E --> B\n  D --> F[Papier 8 Wochen Zwischenlager]',
    },
  } as AppNode;
  const projNote = note({ x: 720, y: 90 }, 'sky', [
    h('🚀 So liest du dieses Board'),
    li('Zeitplan: Balken ziehen/resizen, ◆ = Meilenstein, Pfeile = Abhängigkeiten; Skala oben: Tage/Wochen/Monate'),
    li('Der blaue RAHMEN „Umsetzung" hält Kanban + Prozess zusammen: Zieh ihn an der Titel-Leiste — der Inhalt wandert mit'),
    li('Verbindungen zwischen Karten: vom Rand einer Karte ziehen'),
    li('▶ startet die Präsentation — Folienreihenfolge folgt den Verbindungen'),
    li('Der Kalender rechts zeigt NUR dieses Board (Zahnrad → Quelle)'),
  ]);
  const projCal: AppNode = { id: uid(), type: 'calendar', width: 460, height: 340, position: { x: 980, y: 380 }, data: { scope: 'board' } } as AppNode;
  // M165: Rahmen als Struktur-Ebene zeigen — er fängt Kanban + Prozess ein
  const projFrame = frame({ x: 30, y: 340 }, 960, 400, 'Umsetzung', '#dbe7f6');
  const idProj = board('🚀 Beispielprojekt: E-Akte', [projFrame, projGantt, projKanban, projMermaid, projNote, projCal], [
    edge(projGantt, projKanban, 'liefert Aufgaben'),
    edge(projKanban, projMermaid, 'Prozess dazu'),
    edge(projNote, projGantt, 'erklärt'),
  ]);

  // --- 🧭 Onboarding ---
  const idOnb = board('🧭 Onboarding neue Kolleg:innen', [
    note({ x: 60, y: 100 }, 'yellow', [
      h('📋 Tag 1'),
      check('Begrüßung, Rundgang, Notausgänge'),
      check('Dienstausweis + Schlüssel/Transponder'),
      check('IT: Account, E-Mail, Fachverfahren beantragt?'),
      check('Sicherheitsunterweisung + Datenschutzerklärung'),
      p('Wichtige Kontakte: [[Ansprechpartner]]'),
    ]),
    note({ x: 400, y: 100 }, 'mint', [
      h('📋 Woche 1'),
      check('Zeiterfassung erklärt — siehe [[Zeiterfassung & Abwesenheit]]'),
      check('E-Akte-Grundschulung — siehe [[Wissen]]'),
      check('Vorstellungsrunde Nachbarreferate'),
      check('Erste eigene Vorgänge unter Begleitung'),
    ]),
    note({ x: 740, y: 100 }, 'white', [
      h('🎯 Nach 4 Wochen'),
      check('Feedbackgespräch mit Führungskraft'),
      check('Fortbildungsbedarf notieren'),
      check('Onboarding-Checkliste an Personal zurück'),
    ]),
  ]);

  // --- 🧠 Prozesse & Mindmap ---
  const idMind = board('🧠 Prozesse & Mindmap', [
    {
      id: uid(), type: 'mermaid', width: 460, height: 340, position: { x: 60, y: 100 },
      data: {
        code: 'mindmap\n  root((Referat 12))\n    Aufgaben\n      Förderanträge\n      Aufsicht\n      Berichtswesen\n    Team\n      4 Sachbearbeitung\n      2 Sekretariat\n    Dauerbrenner\n      E-Akte\n      Personalgewinnung',
      },
    } as AppNode,
    {
      id: uid(), type: 'mermaid', width: 420, height: 300, position: { x: 580, y: 100 },
      data: {
        code: 'flowchart LR\n  A[Antrag geht ein] --> B[Vollständigkeit prüfen]\n  B --> C{vollständig?}\n  C -->|nein| D[Nachforderung, Frist 2 Wochen]\n  D --> B\n  C -->|ja| E[Fachliche Prüfung]\n  E --> F[Bescheid]',
      },
    } as AppNode,
    note({ x: 60, y: 500 }, 'sky', [
      h('🧠 Eigene Abläufe modellieren'),
      li('Schnell & präzise: Mermaid-Karte (Text → Diagramm)'),
      li('Frei & visuell: ➕ → Prozess-Formen aufs Board, dann verbinden'),
      li('Handschriftlich: ✎ zeichnen — nach kurzem Halten werden Formen erkannt'),
      li('Oder die KI fragen: ✨ → „Workflow als Diagramm ableiten"'),
    ]),
  ]);

  // --- 🧩 Eigene Apps & Dateien (M165) ---
  const idApps = board('🧩 Eigene Apps & Dateien', [
    note({ x: 60, y: 100 }, 'sky', [
      h('🧩 Eigene HTML-Tools einbetten'),
      p('Selbst gebaute Ein-Datei-Tools (HTML) laufen als eigene, abgeschottete App direkt auf dem Board — mit Start/Stop, Vollbild und eigenem Speicherstand.'),
      li('➕ → „Eigene App (HTML)" oder die Datei einfach aufs Board ziehen'),
      li('➕ → „App von URL": direkt von GitHub & Co. holen'),
      li('⋮-Menü der App: eigener Browser-Tab, Herunterladen, Speicherstand sichern'),
      li('Im Team-Projekt wandern App + Speicherstand automatisch in den Sync-Ordner'),
    ]),
    note({ x: 400, y: 100 }, 'mint', [
      h('📎 Dateien aufs Board'),
      li('➕ → „Datei einfügen" (auch mehrere) — oder Drag & Drop'),
      li('Bilder, PDFs (mit Vorschau), E-Mails (.eml/.msg), Kalender (.ics)'),
      li('Team-Projekt verbunden? Dann landet automatisch eine Kopie unter pixinotes-anlagen/<Board>/… im Sync-Ordner'),
      li('Zu groß fürs Einbetten? „Aus Team-Ordner laden" holt sie bei Bedarf'),
    ]),
    note({ x: 740, y: 100 }, 'white', [
      h('🛡️ Sicherheit in einem Satz'),
      p('Eingebettete Apps laufen in einer Browser-Sandbox: Sie können rechnen, speichern und bedient werden — aber nie an deine PixiNotes-Daten, Sync-Zugangsdaten oder KI-Schlüssel.'),
    ]),
  ]);

  /* ================= Bereich 4: Privat (M165) ================= */

  // --- 👨‍👩‍👧 Familie & Haushalt ---
  const idFam = board('👨‍👩‍👧 Familienplan', [
    week({ x: 60, y: 100 }, {
      title: 'Familienwoche', days: 7, from: 7 * 60, to: 21 * 60,
      entries: [
        wentry(0, 17 * 60, 90, 'Fußballtraining', 2, 'Kind'),
        wentry(1, 18 * 60, 60, 'Musikschule', 4, 'Kind'),
        wentry(2, 17 * 60 + 30, 60, 'Großeinkauf', 1),
        wentry(4, 19 * 60, 120, 'Spieleabend', 3),
        wentry(5, 10 * 60, 180, 'Ausflug', 0),
        wentry(6, 12 * 60, 90, 'Mittag bei Oma', 5),
      ],
    }, 660, 460),
    {
      id: uid(), type: 'kanban', width: 400, position: { x: 770, y: 100 },
      data: {
        title: '🛒 Einkauf & Erledigungen',
        cols: ['Besorgen', 'Dran', 'Erledigt'],
        items: [
          { id: uid(), text: 'Geschenk Geburtstag Mia', col: 0, due: iso(9) },
          { id: uid(), text: 'Reifen wechseln lassen', col: 1 },
          { id: uid(), text: 'Getränkekisten', col: 0 },
        ],
      },
    } as AppNode,
    note({ x: 770, y: 480 }, 'yellow', [
      h('🏡 So nutzt ihr das privat'),
      li('Wochenplan: Klick in eine Zelle = neuer Block, Personen über das Feld „Wer"'),
      li('Spalten lassen sich frei umbenennen (z. B. Namen statt Wochentage)'),
      li('Dieses Board bleibt privat, solange du es keinem Team-Projekt zuordnest'),
    ]),
  ]);

  // --- 🎯 Selbstorganisation privat ---
  const idSelf = board('🎯 Routinen & Ziele', [
    week({ x: 60, y: 100 }, {
      title: 'Meine Routinen', days: 7, axis: 'slots',
      slots: ['Morgen', 'Nachmittag', 'Abend'],
      from: 0, to: 180,
      entries: [
        wentry(0, 0, 60, 'Joggen', 2),
        wentry(2, 0, 60, 'Joggen', 2),
        wentry(4, 0, 60, 'Joggen', 2),
        wentry(1, 120, 60, 'Sprachkurs-Lektion', 4),
        wentry(3, 120, 60, 'Lesen statt Handy', 0),
        wentry(6, 60, 60, 'Wochenplanung', 1),
      ],
    }, 620, 380),
    {
      id: uid(), type: 'kanban', width: 400, position: { x: 730, y: 100 },
      data: {
        title: '🎯 Ziele dieses Quartal',
        cols: ['Idee', 'In Arbeit', 'Geschafft'],
        items: [
          { id: uid(), text: '10-km-Lauf unter 60 min', col: 1 },
          { id: uid(), text: 'Keller entrümpeln', col: 0 },
          { id: uid(), text: 'Erste-Hilfe-Kurs auffrischen', col: 0, due: iso(45) },
        ],
      },
    } as AppNode,
    note({ x: 730, y: 460 }, 'mint', [
      h('💡 Idee'),
      p('Die Zeiterfassungs-Karte (➕ → Zeiterfassung) funktioniert auch privat — z. B. für Lern- oder Sportzeiten mit Wochen-/Monatssummen.'),
    ]),
  ]);

  // --- 📄 Verträge & Fristen ---
  const idContracts = board('📄 Verträge & Fristen', [
    note({ x: 60, y: 100 }, 'sky', [
      h('📄 Vertrags-Karten'),
      p('Eine Notiz pro Vertrag, Eigenschaften über 🏷 (anbieter, kuendigungsfrist, betrag) — Strg+K findet „welche Verträge laufen bei X?" sofort.'),
    ]),
    note({ x: 380, y: 100 }, 'white', [h('📱 Mobilfunk'), p('Anbieter: Beispiel-Tel · 24,99 €/Monat'), p('Laufzeit bis 03/2027 · 3 Monate Kündigungsfrist')], { anbieter: 'Beispiel-Tel', kuendigungsfrist: '3 Monate', betrag: '24,99' }),
    note({ x: 680, y: 100 }, 'white', [h('⚡ Strom'), p('Anbieter: Stadtwerke · Abschlag 95 €'), p('Preisgarantie bis 12/2026 — danach vergleichen!')], { anbieter: 'Stadtwerke', betrag: '95' }),
    {
      id: uid(), type: 'kanban', width: 430, position: { x: 380, y: 360 },
      data: {
        title: '⏰ Fristen',
        cols: ['Ansteht', 'In Arbeit', 'Erledigt'],
        items: [
          { id: uid(), text: 'Kfz-Versicherung vergleichen (Stichtag 30.11.)', col: 0, due: iso(40) },
          { id: uid(), text: 'Stromtarif prüfen', col: 0, due: iso(80) },
        ],
      },
    } as AppNode,
  ]);

  /* ================= Hierarchie ================= */

  const spaces: Space[] = [
    {
      id: uid(), name: '🏢 Arbeitsplatz',
      projects: [
        { id: uid(), name: 'Täglicher Einstieg', boardIds: [idDesk, idTasks] },
        { id: uid(), name: 'Selbstorganisation', boardIds: [idTime, idTravel, idCar] },
        { id: uid(), name: 'Werkzeugkasten', boardIds: [idApps] },
      ],
    },
    {
      id: uid(), name: '📚 Wissen & Nachschlagen',
      projects: [
        { id: uid(), name: 'Wissensbasis', boardIds: [idKnow, idSoft, idSec] },
        { id: uid(), name: 'Kontakte', boardIds: [idPeople] },
      ],
    },
    {
      id: uid(), name: '🤝 Zusammenarbeit & Projekte',
      projects: [
        { id: uid(), name: 'Besprechungen', boardIds: [idJf, idMag] },
        { id: uid(), name: 'Projekte & Abläufe', boardIds: [idProj, idOnb, idMind] },
      ],
    },
    {
      id: uid(), name: '🏡 Privat',
      projects: [
        { id: uid(), name: 'Familie & Haushalt', boardIds: [idFam] },
        { id: uid(), name: 'Selbstorganisation', boardIds: [idSelf, idContracts] },
      ],
    },
  ];

  return { spaces, boards, firstBoardId: idDesk };
}
