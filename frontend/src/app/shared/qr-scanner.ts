import { Component, ElementRef, input, OnDestroy, output, signal, viewChild } from '@angular/core';
import jsQR from 'jsqr';

export function normalizeScannedQrCode(raw: string | null | undefined): string {
  if (!raw) {
    return '';
  }
  let value = raw.trim();
  if (!value) {
    return '';
  }

  // Handle URL encodings / URI schemes (e.g. https://, http://, trias://)
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
      const url = new URL(value);
      const queryCandidate =
        url.searchParams.get('code') ||
        url.searchParams.get('qr_code') ||
        url.searchParams.get('qrCode') ||
        url.searchParams.get('token') ||
        url.searchParams.get('qr') ||
        url.searchParams.get('c');
      if (queryCandidate) {
        value = queryCandidate.trim();
      } else {
        const hashVal = url.hash.replace(/^#\/?/, '').trim();
        const segments = url.pathname.split('/').filter(Boolean);
        const lastSegment = segments.length > 0 ? segments[segments.length - 1] : '';

        if (hashVal && /^[0-9a-fA-F]{32,128}$/.test(hashVal)) {
          value = hashVal;
        } else if (lastSegment) {
          value = decodeURIComponent(lastSegment).trim();
        }
      }
    }
  } catch {
    // Keep trimmed string if URL parsing fails
  }

  // Normalize hex strings (such as TRIAS standard 64-char lowercase tokens)
  if (/^[0-9a-fA-F]{32,128}$/.test(value)) {
    value = value.toLowerCase();
  }

  return value;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(image: ImageBitmapSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

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
  private barcodeDetector: BarcodeDetectorInstance | null = null;
  // start() awaits camera permission and playback; teardown in between must not be undone.
  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stop();
  }

  protected async start(): Promise<void> {
    const video = this.video()?.nativeElement;
    if (!video || this.scanning() || this.starting() || this.destroyed) {
      return;
    }
    this.starting.set(true);
    this.error.set('');
    try {
      if (!this.stream) {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (this.destroyed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        this.stream = stream;

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          try {
            const capabilities = (
              videoTrack as { getCapabilities?: () => { focusMode?: string[] } }
            ).getCapabilities?.();
            if (capabilities?.focusMode?.includes('continuous')) {
              await (
                videoTrack as { applyConstraints?: (c: unknown) => Promise<void> }
              ).applyConstraints?.({
                advanced: [{ focusMode: 'continuous' }],
              });
            }
          } catch {
            // Ignore optional focus constraint failures
          }
        }
      }
      // Angular adds the muted attribute after element creation, which leaves the property false.
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.srcObject = this.stream;
    } catch {
      if (this.destroyed) return;
      this.stop();
      this.error.set('Kamera konnte nicht gestartet werden. QR Code bitte eintippen.');
      return;
    }

    try {
      await video.play();
    } catch {
      if (this.destroyed) return;
      // Keep the stream so the next tap only has to start playback.
      this.starting.set(false);
      this.previewBlocked.set(true);
      return;
    }
    if (this.destroyed) return;

    this.starting.set(false);
    this.previewBlocked.set(false);
    this.scanning.set(true);

    if (!this.barcodeDetector && typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        this.barcodeDetector = new window.BarcodeDetector!({ formats: ['qr_code'] });
      } catch {
        this.barcodeDetector = null;
      }
    }

    const scan = async () => {
      if (this.destroyed || !this.scanning()) {
        return;
      }
      const code = await this.decodeFrame(video);
      if (code) {
        this.stop();
        this.scanned.emit(code);
        return;
      }
      if (!this.destroyed && this.scanning()) {
        this.scanTimer = window.setTimeout(scan, 200);
      }
    };
    this.scanTimer = window.setTimeout(scan, 200);
  }

  private async decodeFrame(video: HTMLVideoElement): Promise<string | null> {
    const { videoWidth: width, videoHeight: height, readyState } = video;
    if (
      !width ||
      !height ||
      (typeof HTMLMediaElement !== 'undefined' && readyState < HTMLMediaElement.HAVE_CURRENT_DATA)
    ) {
      return null;
    }

    if (this.barcodeDetector) {
      try {
        const barcodes = await this.barcodeDetector.detect(video);
        if (barcodes.length > 0 && barcodes[0]?.rawValue) {
          return normalizeScannedQrCode(barcodes[0].rawValue);
        }
      } catch {
        // Fall back to jsQR
      }
    }

    return this.decodeWithJsQr(video, width, height);
  }

  private decodeWithJsQr(video: HTMLVideoElement, width: number, height: number): string | null {
    this.canvas ??= document.createElement('canvas');
    this.canvasContext ??= this.canvas.getContext('2d', { willReadFrequently: true });
    if (!this.canvasContext) {
      return null;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.canvasContext.drawImage(video, 0, 0, width, height);
    const { data } = this.canvasContext.getImageData(0, 0, width, height);
    const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
    return result?.data ? normalizeScannedQrCode(result.data) : null;
  }

  private stop(): void {
    window.clearTimeout(this.scanTimer);
    this.scanTimer = 0;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    const video = this.video()?.nativeElement;
    if (video) {
      try {
        video.pause();
      } catch {
        // Ignore
      }
      video.srcObject = null;
    }
    this.scanning.set(false);
    this.starting.set(false);
    this.previewBlocked.set(false);
  }
}
