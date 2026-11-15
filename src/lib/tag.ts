// M388: „Heute" nach der Uhr des Geräts.
//
// new Date().toISOString() rechnet in Weltzeit: In Deutschland zeigt sie bis 1 Uhr (im Sommer bis 2 Uhr) nachts
// noch das Datum von gestern. Aufgaben „für heute", die Zeiterfassung, HEUTE() in der Rechen-Tabelle und die
// Vorlagen setzten in dieser Zeit den falschen Tag.

/** Tag als JJJJ-MM-TT in der Zeitzone des Geräts */
export function tagLokal(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
