import type { Edge } from '@xyflow/react';
import type { AppNode } from './types';

// Startinhalt beim ersten Öffnen: erklärt das Tool durch Benutzung (keine Anleitung nötig)
export const seedNodes: AppNode[] = [
  {
    id: 'welcome',
    type: 'note',
    width: 270,
    position: { x: 80, y: 120 },
    data: {
      color: 'yellow',
      blocks: [
        { type: 'heading', props: { level: 3 }, content: '👋 Willkommen bei PixiNotes!' },
        { type: 'paragraph', content: 'Das hier ist eine Haftnotiz — klick rein und tipp los. Mit „/" öffnest du das Block-Menü (Checklisten, Tabellen, …).' },
        { type: 'checkListItem', content: 'Karte mit Schwung übers Board werfen 🚀' },
        { type: 'checkListItem', content: 'Doppelklick auf die Fläche = neue Notiz' },
        { type: 'checkListItem', content: 'Screenshot mit Strg+V einfügen' },
        { type: 'checkListItem', content: 'E-Mail (.eml/.msg) aus Outlook hierher ziehen' },
      ],
    },
  },
  {
    id: 'demo-email',
    type: 'email',
    width: 320,
    position: { x: 520, y: 100 },
    data: {
      subject: 'Angebot Q3 — bitte Freigabe',
      fromName: 'Sandra Meier',
      fromAddress: 'sandra.meier@example.com',
      date: new Date('2026-07-10T10:32:00').toISOString(),
      text:
        'Hi,\n\nanbei das finale Angebot. Kannst du bis Freitag freigeben?\nBei Fragen ruf mich einfach an: +49 170 1234567.\n\nViele Grüße\nSandra',
      attachments: [
        { name: 'Angebot_Q3.pdf', mime: 'application/pdf', size: 245760 },
        { name: 'Kalkulation.xlsx', mime: 'application/vnd.ms-excel', size: 88064 },
      ],
    },
  },
  {
    id: 'demo-kanban',
    type: 'kanban',
    width: 430,
    position: { x: 520, y: 470 },
    data: {
      title: '📋 Projekt Atlas',
      items: [
        { id: 'k1', text: 'Landingpage-Texte', col: 0 },
        { id: 'k2', text: 'Budget prüfen', col: 0 },
        { id: 'k3', text: 'Angebot Q3 freigeben ⚡', col: 1 },
        { id: 'k4', text: 'Kickoff', col: 2 },
      ],
    },
  },
  {
    id: 'demo-idea',
    type: 'note',
    width: 270,
    position: { x: 130, y: 520 },
    data: {
      color: 'pink',
      blocks: [
        { type: 'heading', props: { level: 3 }, content: '💡 Idee' },
        { type: 'paragraph', content: 'Telefonnummern werden automatisch klickbar — probier es in der E-Mail-Karte rechts!' },
      ],
    },
  },
];

export const seedEdges: Edge[] = [
  { id: 'e1', source: 'demo-email', target: 'demo-kanban', type: 'labeled', data: { label: 'gehört zu' } },
];
