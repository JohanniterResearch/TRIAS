import { TestBed } from '@angular/core/testing';

import { QrScanner } from './qr-scanner';

describe('QrScanner', () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async () => stream);

  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    getUserMedia.mockClear();
    track.stop.mockClear();
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
