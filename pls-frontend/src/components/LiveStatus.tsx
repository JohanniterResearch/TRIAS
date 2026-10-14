import type { ConnectionState } from '../realtime/sceneRealtime';

const TEXT: Record<ConnectionState, string> = {
  connecting: 'Live-Verbindung wird aufgebaut…',
  connected: 'Live',
  polling: 'Keine Live-Verbindung – Aktualisierung alle 10 Sekunden',
};

/** Connection state for screen readers and sighted users alike (WP 5.1). */
export default function LiveStatus({ state }: { state: ConnectionState }) {
  return (
    <p aria-live="polite" role="status" data-state={state} style={{ margin: '8px 0', fontWeight: 'bold', color: state === 'connected' ? '#2f855a' : '#b7791f' }}>
      {TEXT[state]}
    </p>
  );
}
