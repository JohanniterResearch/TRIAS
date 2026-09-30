import { Component, input, output } from '@angular/core';

import { PreviewModal } from './preview-modal';
import { QrCodeImage } from './qr-code-image';

export type QrPreviewItem = { token: string; label: string };

@Component({
  selector: 'app-qr-preview-modal',
  imports: [PreviewModal, QrCodeImage],
  template: `
    <app-preview-modal title="QR Code Vorschau" [open]="open()" (close)="close.emit()">
      <p class="qr-modal-count">{{ items().length }} Code(s)</p>
      <div class="qr-modal-grid">
        @for (item of items(); track item.token) {
          <div class="qr-modal-card">
            <app-qr-code-image [token]="item.token" [label]="item.label" />
            <code class="qr-modal-token">{{ item.token }}</code>
          </div>
        }
      </div>
    </app-preview-modal>
  `,
})
export class QrPreviewModal {
  readonly items = input.required<QrPreviewItem[]>();
  readonly open = input.required<boolean>();
  readonly close = output<void>();
}
