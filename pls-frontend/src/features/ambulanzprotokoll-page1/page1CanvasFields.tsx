import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { page1BodyMapLegend } from './page1LayoutSpec';
import type { BodyMapMarker } from './page1State';

const MARKER_COLORS: Record<string, string> = {
  wunde: '#c93d3d', fraktur: '#d36d2c', schmerz: '#ad8b2f', prellung: '#4d62a6',
  amputation: '#5f3f8b', verbrennung: '#a54118', luxation: '#2f7d67',
};

function safeCanvasContext(canvas: HTMLCanvasElement | null) {
  if (!canvas) return null;
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

function HumanFigure() {
  return <>
    <circle cx="34" cy="14" r="10" className="ambd-figure-part" />
    <path className="ambd-figure-part" d="M25 28 L43 28 L47 63 L21 63 Z" />
    <path className="ambd-figure-part" d="M20 31 L8 58 L14 61 L28 39 Z" />
    <path className="ambd-figure-part" d="M48 31 L60 58 L54 61 L40 39 Z" />
    <path className="ambd-figure-part" d="M29 63 L22 108 L29 108 L36 63 Z" />
    <path className="ambd-figure-part" d="M39 63 L46 108 L39 108 L32 63 Z" />
  </>;
}

export function BodyMapField({ onChange, value }: { onChange: (value: BodyMapMarker[]) => void; value: BodyMapMarker[] }) {
  const [activeMarker, setActiveMarker] = useState<string>(page1BodyMapLegend[0]?.value ?? 'wunde');

  function handleSvgClick(view: 'front' | 'back', event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * 100);
    onChange([...value, { view, marker: activeMarker as BodyMapMarker['marker'], x, y }]);
  }

  function removeMarker(index: number) {
    onChange(value.filter((_, markerIndex) => markerIndex !== index));
  }

  return <div className="ambd-body-map">
    <div className="ambd-body-map__figures">
      {(['front', 'back'] as const).map((view) => {
        const markers = value.map((marker, index) => ({ ...marker, index })).filter((marker) => marker.view === view);
        return <div key={view} className="ambd-body-map__figure">
          <div className="ambd-body-map__letters">{view === 'front' ? 'R   L' : 'R'}</div>
          <svg aria-label={`Körperkarte ${view}`} className="ambd-body-map__svg" onClick={(event) => handleSvgClick(view, event)} role="img" viewBox="0 0 68 112">
            <HumanFigure />
            {markers.map((marker) => <circle
              key={marker.index}
              cx={marker.x * 0.68}
              cy={marker.y * 1.12}
              fill={MARKER_COLORS[marker.marker] ?? '#555'}
              onClick={(event) => { event.stopPropagation(); removeMarker(marker.index); }}
              r="3.5"
              stroke="#fff"
              strokeWidth="0.8"
            />)}
          </svg>
        </div>;
      })}
    </div>
    <div className="ambd-body-map__legend">
      {page1BodyMapLegend.map((option) => <button
        key={option.value}
        className={activeMarker === option.value ? 'ambd-legend-button ambd-legend-button--active' : 'ambd-legend-button'}
        onClick={() => setActiveMarker(option.value)}
        type="button"
      >
        <span className="ambd-legend-button__dot" style={{ backgroundColor: MARKER_COLORS[option.value] ?? '#555' }} />
        <span>{option.label}</span>
      </button>)}
    </div>
  </div>;
}

export function SignatureCanvas({ onChange, value }: { onChange: (value: string | null) => void; value: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = safeCanvasContext(canvas);
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!value) return;
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [value]);

  function getPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLCanvasElement>) {
    const ctx = safeCanvasContext(canvasRef.current);
    if (!ctx) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#101010';
    isDrawing.current = true;
  }

  function handlePointerMove(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return;
    const ctx = safeCanvasContext(canvasRef.current);
    if (!ctx) return;
    const point = getPoint(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function commitSignature() {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL('image/png'));
  }

  return <div className="ambd-signature">
    <canvas
      ref={canvasRef}
      className="ambd-signature__canvas"
      height={84}
      onPointerDown={handlePointerDown}
      onPointerLeave={commitSignature}
      onPointerMove={handlePointerMove}
      onPointerUp={commitSignature}
      width={280}
    />
    <button className="ambd-signature__clear" onClick={() => onChange(null)} type="button">
      Löschen
    </button>
  </div>;
}
