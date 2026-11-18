import { FieldConflicts, displayServerValue, fieldLabel } from './field-conflicts';

describe('field conflict feedback', () => {
  it.each([
    [false, 'Nein'],
    [true, 'Ja'],
    [0, '0'],
    [null, 'nicht angegeben'],
  ])('preserves the meaning of %s', (value, label) =>
    expect(displayServerValue(value)).toBe(label),
  );
  it('names rejected fields and distinguishes partial results without duplicate retry notices', () => {
    const feedback = new FieldConflicts();
    const rejected = {
      field: 'transport',
      outcome: 'rejected' as const,
      conflictReason: 'older_edit' as const,
      serverValue: false,
    };
    feedback.report(7, 'order', [
      rejected,
      { field: 'atmung', outcome: 'applied', conflictReason: null, serverValue: true },
    ]);
    expect(feedback.notices()[0].message).toContain('Nur ein Teil');
    expect(feedback.notices()[0].message).toContain(
      'Transport: Neuere Eingabe am Server. Gültiger Wert: Nein',
    );
    feedback.report(7, 'order', [{ ...rejected, serverValue: true }]);
    expect(feedback.notices()).toHaveLength(1);
    expect(feedback.notices()[0].message).toContain('Ja');
    feedback.dismiss('order');
    expect(feedback.notices()).toEqual([]);
  });
  it('keeps legacy unknown decisions silent and displays location zeroes', () => {
    const feedback = new FieldConflicts();
    feedback.report(7, 'legacy', null);
    expect(feedback.notices()).toEqual([]);
    expect(fieldLabel('patient.vorname')).toBe('Vorname');
    expect(fieldLabel('location')).toBe('Patientenstandort');
    expect(
      displayServerValue({ lat: 0, lng: 0, accuracyMeters: 0, indoorLocation: null }),
    ).toContain('0, 0; Quelle: nicht angegeben; Genauigkeit: 0 m; Innenstandort: nicht angegeben');
  });
});
