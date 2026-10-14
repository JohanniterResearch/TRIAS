import { useLocation, useNavigate } from 'react-router-dom';
import BodyPartsFront from './BodyPartsFront';
import BodyPartsBack from './BodyPartsBack';
import { PLS_BACK_KEYS, PLS_FRONT_KEYS, type PlsBodyKey } from '../api/codecs/bodyMap';
import { useBodyMap } from '../hooks/useBodyMap';
import { useWorkContextStore } from '../stores/workContextStore';

interface Props {
  side: 'front' | 'back';
}

// Shared by ShowBodyFront and ShowBodyBack; the drawings and button labels are unchanged.
export default function BodyMapScreen({ side }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const patientId = useWorkContextStore((state) => state.patientId);
  const returnTo = location.state?.returnTo || '/TriagePage1';
  const triageResult = location.state?.triageResult;
  const { loading, marked, undrawable, toggle, error, hint, offlineNote } = useBodyMap(patientId);
  const keys: readonly PlsBodyKey[] = side === 'front' ? PLS_FRONT_KEYS : PLS_BACK_KEYS;
  const BodyPart = side === 'front' ? BodyPartsFront : BodyPartsBack;

  const switchSide = () =>
    navigate(side === 'front' ? '/ShowBodyBack' : '/ShowBodyFront', { state: { returnTo, triageResult } });

  return (
    <div className="bodyparts-container">
      {error && <p className="msg-error" role="alert">{error}</p>}
      {hint && <p className="msg-success" role="status">{hint}</p>}
      {offlineNote && <p role="status">{offlineNote}</p>}
      {loading ? (
        <p role="status">Lädt...</p>
      ) : (
        <>
          <h1>{side === 'front' ? 'Front' : 'Back'}</h1>
          {marked && (
            <svg
              className="body-svg"
              viewBox={side === 'front' ? '0 0 105 201' : '0 0 103 202'}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g className="first-layer">
                {keys.map((part) => (
                  <BodyPart
                    key={part}
                    id={part}
                    onClick={(id, isClicked) => void toggle(id as PlsBodyKey, isClicked)}
                    initialClickedState={marked[part]}
                  />
                ))}
              </g>
            </svg>
          )}
          {undrawable.length > 0 && (
            <p role="status">Weitere markierte Regionen (in dieser Zeichnung nicht darstellbar): {undrawable.join(', ')}</p>
          )}
          <div className="bodyparts-actions">
            <button className="bodyparts-button" onClick={() => navigate(returnTo, { state: { triageResult } })}>
              Zurück zur Triage
            </button>
            <button className="bodyparts-button" onClick={switchSide}>
              {side === 'front' ? 'Rückseite anzeigen' : 'Vorderseite anzeigen'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
