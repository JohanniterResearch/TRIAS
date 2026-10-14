import BodyPartsFront from './BodyPartsFront';
import BodyPartsBack from './BodyPartsBack';
import { decodeBodyParts, markedWithoutPlsRegion, PLS_BACK_KEYS, PLS_FRONT_KEYS, type PlsBodyKey } from '../api/codecs/bodyMap';

interface Props {
  /** Server regions (Ambulanzsystem keys), translated through the codec for the drawing. */
  server: Record<string, number>;
  /** Omitted: read-only (Lagebild, WP 5.4). */
  onToggle?: (plsKey: PlsBodyKey, isClicked: boolean) => void;
  label: string;
}

// Front and back drawing side by side. Regions the PLS drawing cannot show (ferse_*) are listed
// as text, so nothing marked on the server is hidden (parity plan Section 5.2).
export default function BodyMapDrawing({ server, onToggle, label }: Props) {
  const marked = decodeBodyParts(server);
  const undrawable = markedWithoutPlsRegion(server);
  const sides = [
    { keys: PLS_FRONT_KEYS, Part: BodyPartsFront, viewBox: '0 0 105 201', title: 'Vorderseite' },
    { keys: PLS_BACK_KEYS, Part: BodyPartsBack, viewBox: '0 0 103 202', title: 'Rückseite' },
  ] as const;

  return (
    <figure aria-label={label} style={{ margin: 0 }}>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        {sides.map(({ keys, Part, viewBox, title }) => (
          <svg
            key={title}
            role={onToggle ? 'group' : 'img'}
            aria-label={`${title}: ${keys.filter((key) => marked[key]).join(', ') || 'keine Markierung'}`}
            viewBox={viewBox}
            width="160"
            style={onToggle ? undefined : { pointerEvents: 'none' }}
          >
            <g>
              {(keys as readonly PlsBodyKey[]).map((key) => (
                <Part key={key} id={key} initialClickedState={marked[key]} onClick={onToggle && ((id, isClicked) => onToggle(id as PlsBodyKey, isClicked))} />
              ))}
            </g>
          </svg>
        ))}
      </div>
      {undrawable.length > 0 && <figcaption>Weitere markierte Regionen (nicht in der Zeichnung): {undrawable.join(', ')}</figcaption>}
    </figure>
  );
}
