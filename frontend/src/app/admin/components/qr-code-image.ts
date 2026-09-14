import { Component, effect, input, signal } from '@angular/core';
import QRCode from 'qrcode';

@Component({
  selector: 'app-qr-code-image',
  template: `
    @if (source()) {
      <img class="qr-code-image" [src]="source()" [alt]="label()" />
    }
  `,
})
export class QrCodeImage {
  readonly token = input.required<string>();
  readonly label = input('QR Code');
  protected readonly source = signal('');

  constructor() {
    effect(() => {
      QRCode.toDataURL(this.token(), { errorCorrectionLevel: 'M', margin: 4, width: 320 }).then(
        (source) => this.source.set(source),
      );
    });
  }
}
