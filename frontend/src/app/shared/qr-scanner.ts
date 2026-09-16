import { Component, ElementRef, input, OnDestroy, output, signal, viewChild } from '@angular/core';
import jsQR from 'jsqr';

@Component({
  selector: 'app-qr-scanner',
  template: `
    <div class="camera-panel">
      <video #video autoplay muted playsinline></video>
      <button type="button" (click)="start()" [disabled]="scanning()">{{ buttonLabel() }}</button>
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

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private stream: MediaStream | null = null;
  private scanTimer = 0;
  private canvas: HTMLCanvasElement | null = null;
  private canvasContext: CanvasRenderingContext2D | null = null;

  ngOnDestroy(): void {
    this.stop();
  }

  protected async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      const video = this.video()?.nativeElement;
      if (!video) {
        this.stop();
        return;
      }

      video.srcObject = this.stream;
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
    } catch {
      this.stop();
      this.error.set('Kamera konnte nicht gestartet werden. QR Code bitte eintippen.');
    }
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
  }
}
