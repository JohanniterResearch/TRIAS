import { TestBed } from '@angular/core/testing';
import QRCode from 'qrcode';

import { QrPreviewModal } from './qr-preview-modal';

describe('QrPreviewModal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders QR images only while open', async () => {
    const toDataURL = vi
      .spyOn(QRCode, 'toDataURL')
      .mockResolvedValue('data:image/png;base64,' as never);
    const fixture = TestBed.createComponent(QrPreviewModal);
    fixture.componentRef.setInput('items', [
      { token: 'a', label: 'A' },
      { token: 'b', label: 'B' },
    ]);
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(toDataURL).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-qr-code-image')).toBeNull();

    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(toDataURL).toHaveBeenCalledTimes(2);

    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-qr-code-image')).toBeNull();
  });
});
