import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * M213: Fehlergrenze.
 *
 * Ohne sie reißt ein Fehler in EINER Karte den ganzen React-Baum mit — der
 * Nutzer sieht eine weiße Seite und hält das verständlicherweise für
 * Datenverlust. Tatsächlich liegen die Daten unangetastet im Browser-Speicher;
 * kaputt ist nur die Darstellung.
 *
 * Genau das sagt diese Komponente auch: Sie fängt den Fehler, zeigt eine
 * verständliche Meldung statt eines Stacktrace und bietet an, nur den
 * betroffenen Teil neu aufzubauen. Der Rest der App läuft weiter.
 */
interface Props {
  children: ReactNode;
  /** Was ist hier kaputtgegangen? (z. B. „Diese Karte", „Die Aufgaben-Zentrale") */
  what?: string;
  /** Ganzseitig statt als Kachel darstellen (App-Wurzel, Vollbild-Ansichten) */
  full?: boolean;
}
interface State { error: Error | null }

/**
 * M522: Scheitert die Darstellung, kann es am gespeicherten Stand liegen (eine Karte ohne Lage, ein Board ohne
 * Kartenliste — von außen hereingekommen). Dann half weder „Nochmal versuchen" noch „Seite neu laden": Der Stand
 * kommt mit jedem Start wieder. Jetzt wird er beim ersten Fehler gerichtet (lib/sicherGestalt.ts, nachgeladen); war
 * etwas zu richten, baut die Grenze ihren Teil von selbst neu auf. Mehrere Grenzen teilen sich einen Lauf.
 */
let richtLauf: Promise<boolean> | null = null;
const standRichten = (): Promise<boolean> => (richtLauf ??= import('../lib/sicherGestalt').then((m) => m.standRichten(), () => false)
  .finally(() => { setTimeout(() => { richtLauf = null; }, 500); }));

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Bewusst nur in die Konsole: keine Fehler-Telemetrie nach außen, das
    // widerspräche dem „alles bleibt lokal"-Versprechen der App.
    console.error('[PixiNotes] Fehler abgefangen:', error, info.componentStack);
    void standRichten().then((gerichtet) => { if (gerichtet) this.setState({ error: null }); });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const what = this.props.what ?? 'Dieser Bereich';
    return (
      <div className={`err-box${this.props.full ? ' err-full' : ''}`} role="alert">
        <b>{what} lässt sich gerade nicht anzeigen.</b>
        <p>
          Deine Daten sind davon <b>nicht</b> betroffen – sie liegen unverändert in
          diesem Browser. Kaputt ist nur die Darstellung.
        </p>
        <div className="err-acts">
          <button onClick={() => this.setState({ error: null })}>Nochmal versuchen</button>
          <button onClick={() => location.reload()}>Seite neu laden</button>
        </div>
        <details>
          <summary>Technische Einzelheiten</summary>
          <code>{error.message || String(error)}</code>
        </details>
      </div>
    );
  }
}
