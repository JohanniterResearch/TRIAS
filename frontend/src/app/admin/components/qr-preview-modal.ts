import { Component, input, output } from '@angular/core';

import { QrCodeImage } from './qr-code-image';

export type QrPreviewItem = { token: string; label: string };

@Component({
  selector: 'app-qr-preview-modal',
  imports: [QrCodeImage],
  template: `
    @if (open()) {
      <div class="qr-modal-backdrop" (click)="close.emit()">
        <div class="qr-modal-content" (click)="$event.stopPropagation()">
          <button class="qr-modal-close" (click)="close.emit()" aria-label="Schließen">✕</button>
          <h2>QR Code Vorschau</h2>
          <p class="qr-modal-count">{{ items().length }} Code(s)</p>
          <div class="qr-modal-grid">
            @for (item of items(); track item.token) {
              <div class="qr-modal-card">
                <app-qr-code-image [token]="item.token" [label]="item.label" />
                <code class="qr-modal-token">{{ item.token }}</code>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class QrPreviewModal {
  readonly items = input.required<QrPreviewItem[]>();
  readonly open = input.required<boolean>();
  readonly close = output<void>();
}
