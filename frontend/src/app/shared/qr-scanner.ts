import { Component, ElementRef, input, OnDestroy, output, signal, viewChild } from '@angular/core';

declare const BarcodeDetector:
  | undefined
  | {
      new (options?: { formats?: string[] }): {
        detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
      };
    };

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

  ngOnDestroy(): void {
    this.stop();
  }

  protected async start(): Promise<void> {
    if (!BarcodeDetector) {
      this.error.set('QR Scan wird von diesem Browser nicht unterstützt. QR Code bitte eintippen.');
      return;
    }

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
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        const [code] = await detector.detect(video);
        if (code?.rawValue) {
          this.stop();
          this.scanned.emit(code.rawValue);
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

  private stop(): void {
    window.clearTimeout(this.scanTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.scanning.set(false);
  }
}
