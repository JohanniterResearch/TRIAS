import { Html5Qrcode } from 'html5-qrcode';
import { useEffect, useRef, useState } from 'react';

interface UseQrScannerOptions {
  elementId: string;
  fps?: number;
  qrbox?: { width: number; height: number };
  onSuccess: (decodedText: string) => void;
}

export function useQrScanner({
  elementId,
  fps = 10,
  qrbox = { width: 450, height: 450 },
  onSuccess,
}: UseQrScannerOptions) {
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Use a ref to avoid stale closure in the scanner callback
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    if (!scannerRef.current) {
      const config = { fps, qrbox };
      scannerRef.current = new Html5Qrcode(elementId);
      scannerRef.current
        .start(
          { facingMode: 'environment' },
          config,
          (decodedText) => onSuccessRef.current(decodedText),
          undefined
        )
        .catch((error) => {
          setCameraBlocked(true);
          console.warn(`Code scan error = ${error}`);
        });
    }

    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScanner = () => {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(console.error);
    }
  };

  return { cameraBlocked, stopScanner, scannerRef };
}
