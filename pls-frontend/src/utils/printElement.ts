const PRINT_STYLE =
  'body { font-family: Arial, sans-serif; } .qr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 20px; } ' +
  '.qr-item { text-align: center; page-break-inside: avoid; } .qr-item code { display: block; font-size: 8px; overflow-wrap: anywhere; } ' +
  '@media print { .qr-grid { grid-template-columns: repeat(3, 1fr); } }';

/**
 * Prints only the given element in its own window. The QR codes are SVG: a <canvas> loses its
 * drawing when copied through innerHTML, which printed blank codes before.
 */
export function printElement(element: HTMLElement, title: string): boolean {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return false;
  const doc = printWindow.document;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = PRINT_STYLE;
  doc.head.appendChild(style);
  doc.body.innerHTML = element.innerHTML;
  printWindow.print();
  return true;
}
