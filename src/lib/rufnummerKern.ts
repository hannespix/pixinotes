// M459: Was lib/rufnummer.ts nachlädt — nur die zwei Funktionen, die PixiNotes braucht. Ein
// `import('libphonenumber-js')` brächte alle mit; über diese Datei schüttelt der Build das Übrige ab.
export { findPhoneNumbersInText, parsePhoneNumberFromString } from 'libphonenumber-js';
