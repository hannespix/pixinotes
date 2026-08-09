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

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Bewusst nur in die Konsole: keine Fehler-Telemetrie nach außen, das
    // widerspräche dem „alles bleibt lokal"-Versprechen der App.
    console.error('[PixiNotes] Fehler abgefangen:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const what = this.props.what ?? 'Dieser Bereich';
    return (
      <div className={`err-box${this.props.full ? ' err-full' : ''}`} role="alert">
        <b>{what} lässt sich gerade nicht anzeigen.</b>
        <p>
          Deine Daten sind davon <b>nicht</b> betroffen — sie liegen unverändert in
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
