import { TestBed } from '@angular/core/testing';
import jsQR from 'jsqr';

import { normalizeScannedQrCode, QrScanner } from './qr-scanner';

vi.mock('jsqr', () => ({
  default: vi.fn(),
}));

describe('normalizeScannedQrCode', () => {
  it('handles empty and whitespace-only inputs', () => {
    expect(normalizeScannedQrCode('')).toBe('');
    expect(normalizeScannedQrCode('   \n\t  ')).toBe('');
    expect(normalizeScannedQrCode(null)).toBe('');
    expect(normalizeScannedQrCode(undefined)).toBe('');
  });

  it('normalizes uppercase hex tokens to lowercase and trims surrounding whitespace', () => {
    const raw = '  A1B2C3D4E5F67890A1B2C3D4E5F67890A1B2C3D4E5F67890A1B2C3D4E5F67890  \n';
    const expected = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    expect(normalizeScannedQrCode(raw)).toBe(expected);
  });

  it('extracts query parameters from URL formatted QR codes', () => {
    const token = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    expect(
      normalizeScannedQrCode(`https://trias.app/scan-patient?qr_code=${token.toUpperCase()}`),
    ).toBe(token);
    expect(normalizeScannedQrCode(`https://trias.app/login?code=${token}`)).toBe(token);
    expect(normalizeScannedQrCode(`trias://intake?token=${token}`)).toBe(token);
  });

  it('extracts last path segment or hash from URLs without query params', () => {
    const token = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    expect(normalizeScannedQrCode(`https://trias.app/patient/${token}`)).toBe(token);
    expect(normalizeScannedQrCode(`https://trias.app/#${token}`)).toBe(token);
  });

  it('preserves generic non-URL, non-hex code values with trimming', () => {
    expect(normalizeScannedQrCode('  MANUAL-TAG-42  ')).toBe('MANUAL-TAG-42');
  });
});

describe('QrScanner', () => {
  const track = {
    stop: vi.fn(),
    getCapabilities: vi.fn(() => ({ focusMode: ['continuous'] })),
    applyConstraints: vi.fn(async () => undefined),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  const getUserMedia = vi.fn(async () => stream);

  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    getUserMedia.mockClear();
    track.stop.mockClear();
    track.applyConstraints.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function tap(fixture: ReturnType<typeof TestBed.createComponent<QrScanner>>) {
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('reports the camera as active only after playback starts, and retries a blocked preview', async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
      .mockResolvedValueOnce(undefined);
    const fixture = TestBed.createComponent(QrScanner);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    await tap(fixture);
    expect(element.textContent).not.toContain('Kamera aktiv');
    expect(element.querySelector('button')?.textContent?.trim()).toBe('Vorschau starten');
    expect(element.querySelector('video')?.muted).toBe(true);
    expect(track.stop).not.toHaveBeenCalled();

    await tap(fixture);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
    expect(element.textContent).toContain('Kamera aktiv');
    fixture.destroy();
  });

  it('displays an error message when camera access fails', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
    const fixture = TestBed.createComponent(QrScanner);
    fixture.detectChanges();

    await tap(fixture);
    const element: HTMLElement = fixture.nativeElement;
    expect(element.textContent).toContain('Kamera konnte nicht gestartet werden');
    fixture.destroy();
  });

  it('scans with native BarcodeDetector when available and stops stream on detection', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const token = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    const detect = vi.fn().mockResolvedValue([{ rawValue: token.toUpperCase() }]);
    (window as any).BarcodeDetector = class {
      detect = detect;
    };

    const fixture = TestBed.createComponent(QrScanner);
    fixture.detectChanges();

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

    const scanned = vi.fn();
    fixture.componentInstance.scanned.subscribe(scanned);

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(300);

    expect(detect).toHaveBeenCalled();
    expect(scanned).toHaveBeenCalledWith(token);
    expect(track.stop).toHaveBeenCalled();

    delete (window as any).BarcodeDetector;
    fixture.destroy();
  });

  it('falls back to jsQR when BarcodeDetector is not available', async () => {
    vi.useFakeTimers();
    delete (window as any).BarcodeDetector;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const token = 'a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890';
    vi.mocked(jsQR).mockReturnValue({ data: token } as any);

    const fixture = TestBed.createComponent(QrScanner);
    fixture.detectChanges();

    const video = fixture.nativeElement.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 640, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 480, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 4, configurable: true });

    // Mock canvas context drawImage / getImageData
    const mockContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(640 * 480 * 4) })),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockContext as any);

    const scanned = vi.fn();
    fixture.componentInstance.scanned.subscribe(scanned);

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(300);

    expect(jsQR).toHaveBeenCalled();
    expect(scanned).toHaveBeenCalledWith(token);
    expect(track.stop).toHaveBeenCalled();

    fixture.destroy();
  });

  it.each(['permission', 'playback'] as const)(
    'stays stopped when destroyed while %s is pending',
    async (pending) => {
      vi.useFakeTimers();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      if (pending === 'permission') {
        getUserMedia.mockImplementationOnce(async () => {
          await gate;
          return stream;
        });
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      } else {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValueOnce(gate);
      }
      const fixture = TestBed.createComponent(QrScanner);
      fixture.detectChanges();
      const scanned = vi.fn();
      fixture.componentInstance.scanned.subscribe(scanned);

      (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
      await vi.advanceTimersByTimeAsync(0);
      fixture.destroy();
      release();
      await vi.advanceTimersByTimeAsync(2000);

      expect(track.stop).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(scanned).not.toHaveBeenCalled();
    },
  );
});
