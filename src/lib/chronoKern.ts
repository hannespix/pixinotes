// M459: Was lib/dates.ts nachlädt — nur die deutsche Erkennung. Ein `import('chrono-node')` brächte alle Sprachen
// mit; über diese Datei schüttelt der Build das Übrige ab.
// M531: dazu Englisch („by Friday") — chrono bringt die englischen Regeln ohnehin mit (Grundeinstellung der Bibliothek)
export { de as chronoDe, en as chronoEn } from 'chrono-node';
