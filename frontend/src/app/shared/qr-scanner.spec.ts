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
  });

  afterEach(() => vi.restoreAllMocks());

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
});
