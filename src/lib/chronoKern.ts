// M459: Was lib/dates.ts nachlädt — nur die deutsche Erkennung. Ein `import('chrono-node')` brächte alle Sprachen
// mit; über diese Datei schüttelt der Build das Übrige ab.
export { de as chronoDe } from 'chrono-node';
