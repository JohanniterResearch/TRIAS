import { Component, ElementRef, input, OnDestroy, output, signal, viewChild } from '@angular/core';
import jsQR from 'jsqr';

@Component({
  selector: 'app-qr-scanner',
  template: `
    <div class="camera-panel">
      <video #video autoplay muted playsinline></video>
      <button type="button" (click)="start()" [disabled]="scanning() || starting()">
        {{ previewBlocked() ? 'Vorschau starten' : buttonLabel() }}
      </button>
      @if (scanning()) {
        <p class="status-message" role="status" aria-live="polite">Kamera aktiv</p>
      }
      @if (error()) {
        <p class="form-error" role="alert" aria-live="assertive">{{ error() }}</p>
      }
    </div>
  `,
})
export class QrScanner implements OnDestroy {
  readonly buttonLabel = input('Mit Kamera scannen');
  readonly scanned = output<string>();
  protected readonly scanning = signal(false);
  protected readonly error = signal('');
  protected readonly starting = signal(false);
  // Some mobile browsers reject play() once the tap gesture was spent on the permission prompt.
  protected readonly previewBlocked = signal(false);

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private scanTimer = 0;
  private canvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;

  ngOnDestroy(): void {
    this.stop();
  }

  protected async start(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video) {
      return;
    }
    this.starting.set(true);
    this.error.set('');
    try {
      this.stream ??= await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      // Angular adds the muted attribute after element creation, which leaves the property false.
      video.muted = true;
      video.srcObject = this.stream;
    } catch {
      this.stop();
      this.error.set('Kamera konnte nicht gestartet werden. QR Code bitte eintippen.');
      return;
    }

    try {
      await video.play();
    } catch {
      // Keep the stream so the next tap only has to start playback.
      this.starting.set(false);
      this.previewBlocked.set(true);
      return;
    }

    this.starting.set(false);
    this.previewBlocked.set(false);
    this.scanning.set(true);
    const scan = () => {
      const code = this.decodeFrame(video);
      if (code) {
        this.stop();
        this.scanned.emit(code);
        return;
      }
      this.scanTimer = window.setTimeout(scan, 500);
    };
    this.scanTimer = window.setTimeout(scan, 500);
  }

  private decodeFrame(video: HTMLVideoElement): string | null {
    const { videoWidth: width, videoHeight: height } = video;
    if (!width || !height) {
      return null;
    }
    this.canvas ??= document.createElement('canvas');
    this.canvasContext ??= this.canvas.getContext('2d', { willReadFrequently: true });
    if (!this.canvasContext) {
      return null;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvasContext.drawImage(video, 0, 0, width, height);
    const { data } = this.canvasContext.getImageData(0, 0, width, height);
    return jsQR(data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  }

  private stop(): void {
    window.clearTimeout(this.scanTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.scanning.set(false);
    this.starting.set(false);
    this.previewBlocked.set(false);
  }
}
