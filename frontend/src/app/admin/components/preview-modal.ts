import { Component, input, output } from '@angular/core';

// Generic popover shell for admin lists (scenes, users) that can grow large.
// Reuses the qr-modal-* styles already built for QrPreviewModal, so a loaded
// list scrolls inside a fixed-size overlay instead of stretching the page.
@Component({
  selector: 'app-preview-modal',
  template: `
    @if (open()) {
      <div class="qr-modal-backdrop" (click)="close.emit()">
        <div class="qr-modal-content" (click)="$event.stopPropagation()">
          <button class="qr-modal-close" (click)="close.emit()" aria-label="Schließen">✕</button>
          <h2>{{ title() }}</h2>
          <ng-content />
        </div>
      </div>
    }
  `,
})
export class PreviewModal {
  readonly title = input.required<string>();
  readonly open = input.required<boolean>();
  readonly close = output<void>();
}
