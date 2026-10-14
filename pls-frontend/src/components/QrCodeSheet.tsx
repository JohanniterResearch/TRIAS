import { forwardRef, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { sha256Hex } from '../utils/sha256';

export interface QrSheetItem {
  token: string;
  caption: string;
}

// Grid of QR codes with a caption and the token's SHA-256 under each (parity plan WP 2.6). The
// token itself is never printed as text.
const QrCodeSheet = forwardRef<HTMLDivElement, { items: QrSheetItem[] }>(function QrCodeSheet({ items }, ref) {
  const [hashes, setHashes] = useState<Record<string, string>>({});
  const tokenKey = items.map((item) => item.token).join('\n');

  useEffect(() => {
    let active = true;
    if (typeof crypto === 'undefined' || !crypto.subtle || !tokenKey) return; // not a secure context: no labels
    const tokens = tokenKey.split('\n');
    Promise.all(tokens.map(async (token) => [token, await sha256Hex(token)] as const)).then((entries) => {
      if (active) setHashes(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [tokenKey]);

  return (
    <div ref={ref}>
      <div className="qr-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', padding: '20px' }}>
        {items.map((item) => (
          <div key={item.token} className="qr-item" style={{ textAlign: 'center', background: 'white', color: 'black', padding: '12px', borderRadius: '8px' }}>
            <QRCodeSVG value={item.token} size={150} />
            <p style={{ fontSize: '12px', margin: '5px 0 0' }}>{item.caption}</p>
            <code style={{ fontSize: '8px', overflowWrap: 'anywhere' }} data-testid="qr-sha256">{hashes[item.token] ?? ''}</code>
          </div>
        ))}
      </div>
    </div>
  );
});

export default QrCodeSheet;
