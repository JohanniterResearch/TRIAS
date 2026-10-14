import type { FieldPath } from 'react-hook-form';
import {
  page1FooterGroups,
  page1GcsSections,
  page1HistorySections,
  page1MeasureSections,
  page1PulseRhythmOptions,
  page1PupillenRows,
} from './page1LayoutSpec';
import type { Page1State } from './page1State';
import { SignatureCanvas } from './page1CanvasFields';
import {
  CheckboxGroup,
  CheckboxLabel,
  LinedTextarea,
  PaperField,
  RadioStack,
  UnderlineInput,
  Zone,
  type Page1Form,
} from './page1FormControls';

function PupillenMatrix({ form }: { form: Page1Form }) {
  const value = form.getValues().vitals.pupillen;
  return <div className="ambd-pupillen">
    <div className="ambd-pupillen__title">Pupillen</div>
    <div className="ambd-pupillen__head"><span /><span>R</span><span>L</span></div>
    {page1PupillenRows.map((row) => <div key={row} className="ambd-pupillen__row">
      <span className="ambd-pupillen__label">{row}</span>
      {(['R', 'L'] as const).map((eye) => {
        const checked = value[eye].includes(row);
        return <button
          key={eye}
          className={checked ? 'ambd-matrix-box ambd-matrix-box--checked' : 'ambd-matrix-box'}
          onClick={() => {
            const nextValues = checked ? value[eye].filter((entry) => entry !== row) : [...value[eye], row];
            form.setValue('vitals.pupillen', { ...value, [eye]: nextValues }, { shouldDirty: true, shouldTouch: true });
          }}
          type="button"
        />;
      })}
    </div>)}
  </div>;
}

function SchmerzScale({ form }: { form: Page1Form }) {
  const current = form.getValues().vitals.schmerz;
  const notAssessable = form.getValues().vitals.schmerz_nicht_beurteilbar;
  return <div className="ambd-schmerz">
    <div className="ambd-schmerz__title">Schmerz</div>
    <div className="ambd-schmerz__ticks">
      {Array.from({ length: 11 }, (_, index) => <button
        key={index}
        className={current === index ? 'ambd-scale-point ambd-scale-point--active' : 'ambd-scale-point'}
        onClick={() => form.setValue('vitals.schmerz', current === index ? null : index, { shouldDirty: true, shouldTouch: true })}
        type="button"
      ><span className="ambd-scale-point__tick" /><span>{index}</span></button>)}
    </div>
    <CheckboxLabel
      checked={notAssessable}
      inline
      label="nicht beurteilbar"
      onChange={(checked) => form.setValue('vitals.schmerz_nicht_beurteilbar', checked, { shouldDirty: true, shouldTouch: true })}
    />
  </div>;
}

function Measurements({ form }: { form: Page1Form }) {
  const pulseRhythm = form.getValues().vitals.puls_rhythmus;
  return <div className="ambd-messwerte">
    <div className="ambd-messwerte__title">Messwerte</div>
    <div className="ambd-messwerte__grid">
      <CheckboxLabel checked={form.getValues().vitals.keine} className="ambd-messwerte__keine" inline label="keine" onChange={(checked) => form.setValue('vitals.keine', checked, { shouldDirty: true, shouldTouch: true })} />
      <PaperField label="RR"><UnderlineInput placeholder="sys / dia" registration={form.register('vitals.rr')} /></PaperField>
      <PaperField label="Puls"><UnderlineInput registration={form.register('vitals.puls')} /></PaperField>
      <div className="ambd-checkbox-pair">
        {page1PulseRhythmOptions.map((option) => <CheckboxLabel
          key={option.value}
          checked={pulseRhythm.includes(option.value)}
          inline
          label={option.label}
          onChange={(checked) => form.setValue(
            'vitals.puls_rhythmus',
            checked ? [...pulseRhythm, option.value] : pulseRhythm.filter((value) => value !== option.value),
            { shouldDirty: true, shouldTouch: true },
          )}
        />)}
      </div>
      <PaperField label="AF"><UnderlineInput registration={form.register('vitals.af')} /></PaperField>
      <PaperField label="Temp."><UnderlineInput registration={form.register('vitals.temp')} /></PaperField>
      <PaperField label="BZ"><UnderlineInput registration={form.register('vitals.bz')} /></PaperField>
      <PaperField label="etCO2"><UnderlineInput registration={form.register('vitals.etco2')} /></PaperField>
      <PaperField label="SpO2"><UnderlineInput registration={form.register('vitals.spo2')} /></PaperField>
      <PaperField label="O2 l/min"><UnderlineInput registration={form.register('vitals.o2_l_min')} /></PaperField>
      <PaperField label="O2 l/min"><UnderlineInput registration={form.register('vitals.o2_beatmung_l_min')} /></PaperField>
    </div>
  </div>;
}

function GcsPanel({ draft, form }: { draft: Page1State; form: Page1Form }) {
  // Same rule as the server, which stores the authoritative sum (WP 4.2): only when all three
  // components are set; a partial sum would read like a (very low) total.
  const parts = [draft.vitals.gcs_augenoeffnen, draft.vitals.gcs_verbale_reaktion, draft.vitals.gcs_motorische_reaktion];
  const gcsSum = parts.every((part) => part != null && String(part) !== '') ? parts.reduce<number>((sum, part) => sum + Number(part), 0) : 0;
  return <div className="ambd-gcs">
    <div className="ambd-gcs__title">Glasgow Coma Scale</div>
    <div className="ambd-gcs__columns">
      {page1GcsSections.map((section) => <div key={section.bind} className="ambd-gcs__section">
        <div className="ambd-gcs__section-title">{section.label}</div>
        <RadioStack bind={section.bind} form={form} options={section.options} />
      </div>)}
    </div>
    <div className="ambd-gcs__summe"><span>GCS-Summe:</span><span className="ambd-gcs__summe-box">{gcsSum > 0 ? gcsSum : ''}</span></div>
  </div>;
}

export function FindingsZone({ draft, form }: { draft: Page1State; form: Page1Form }) {
  return <Zone className="ambd-zone--banded" rail="ERST- / ENDBEFUND" zoneId="erst_endbefund">
    <div className="ambd-findings">
      <div className="ambd-findings__left"><PupillenMatrix form={form} /><SchmerzScale form={form} /></div>
      <div className="ambd-findings__middle"><GcsPanel draft={draft} form={form} /></div>
      <div className="ambd-findings__right"><Measurements form={form} /></div>
    </div>
  </Zone>;
}

export function MeasuresZone({ form }: { form: Page1Form }) {
  return <Zone className="ambd-zone--paper" rail="MASSNAHMEN" railRight="AMPLE-SCHEMA" zoneId="massnahmen_ample">
    <div className="ambd-measures">
      <div className="ambd-measures__left">
        <div className="ambd-measures__section">
          <div className="ambd-measures__title">{page1MeasureSections[0].label}</div>
          <CheckboxGroup bind={page1MeasureSections[0].bind} form={form} options={page1MeasureSections[0].options} />
          <div className="ambd-measures__subline">
            <PaperField label="DNr:"><UnderlineInput registration={form.register('measures.herz_kreislauf.dnr')} /></PaperField>
            <PaperField label="Anz.:"><UnderlineInput registration={form.register('measures.herz_kreislauf.anzahl')} /></PaperField>
            <PaperField label="letzte Joule:"><UnderlineInput registration={form.register('measures.herz_kreislauf.letzte_joule')} /></PaperField>
            <PaperField label="Freq.:"><UnderlineInput registration={form.register('measures.herz_kreislauf.freq')} /></PaperField>
            <PaperField label="mV:"><UnderlineInput registration={form.register('measures.herz_kreislauf.mv')} /></PaperField>
          </div>
        </div>
        <div className="ambd-measures__section">
          <div className="ambd-measures__title">{page1MeasureSections[1].label}</div>
          <CheckboxGroup bind={page1MeasureSections[1].bind} form={form} options={page1MeasureSections[1].options} />
          <div className="ambd-measures__subline ambd-measures__subline--4">
            <PaperField label="DNr:"><UnderlineInput registration={form.register('measures.atmung.dnr')} /></PaperField>
            <PaperField label="AF"><UnderlineInput registration={form.register('measures.atmung.af')} /></PaperField>
            <PaperField label="AMV"><UnderlineInput registration={form.register('measures.atmung.amv')} /></PaperField>
            <PaperField label="PEEP"><UnderlineInput registration={form.register('measures.atmung.peep')} /></PaperField>
          </div>
        </div>
        <div className="ambd-measures__section">
          <div className="ambd-measures__title">{page1MeasureSections[2].label}</div>
          <CheckboxGroup bind={page1MeasureSections[2].bind} form={form} options={page1MeasureSections[2].options} />
          <div className="ambd-measures__subline ambd-measures__subline--2">
            <PaperField label=""><UnderlineInput placeholder="__:__" registration={form.register('measures.weitere_massnahmen.abbinden_zeit')} /></PaperField>
            <PaperField label=""><UnderlineInput registration={form.register('measures.weitere_massnahmen.lagerung_art')} /></PaperField>
          </div>
        </div>
      </div>
      <div className="ambd-measures__right">
        {page1HistorySections.map((section) => <LinedTextarea key={section.bind} bind={section.bind as FieldPath<Page1State>} form={form} label={section.label} lines={2} />)}
      </div>
    </div>
  </Zone>;
}

export function FooterZone({
  draft,
  form,
  onSignatureChange,
}: {
  draft: Page1State;
  form: Page1Form;
  onSignatureChange: (value: string | null) => void;
}) {
  return <Zone className="ambd-zone--section" zoneId="footer_disposition">
    <div className="ambd-footer">
      <div className="ambd-footer__top">
        <PaperField className="ambd-footer__abschluss" label="Übergabe/Belassung/Revers"><CheckboxGroup bind="disposition.abschlussart" form={form} inline options={page1FooterGroups.abschlussart} /></PaperField>
        <PaperField className="ambd-footer__zustand" label="Klinischer Zustand"><CheckboxGroup bind="disposition.klinischer_zustand" form={form} inline options={page1FooterGroups.klinischer_zustand} single /></PaperField>
        <PaperField label="Uhrzeit-Ende"><UnderlineInput placeholder="__:__" registration={form.register('disposition.uhrzeit_ende')} /></PaperField>
        <PaperField label="Org.:"><UnderlineInput registration={form.register('disposition.org')} /></PaperField>
        <PaperField label="Typ:"><UnderlineInput registration={form.register('disposition.typ')} /></PaperField>
        <PaperField label="Kennung:"><UnderlineInput registration={form.register('disposition.kennung')} /></PaperField>
      </div>
      <div className="ambd-footer__bottom">
        <PaperField className="ambd-footer__angehoerige" label="Angehörige in Kenntnis"><CheckboxGroup bind="disposition.angehoerige_in_kenntnis" form={form} inline options={page1FooterGroups.angehoerige_in_kenntnis} /></PaperField>
        <PaperField className="ambd-footer__kontakt" label="Kontaktdaten"><UnderlineInput registration={form.register('disposition.kontaktdaten')} /></PaperField>
        <PaperField className="ambd-footer__signature" label="Unterschrift - Entlass. San/NA"><SignatureCanvas onChange={onSignatureChange} value={draft.signatures.entlass_san_na} /></PaperField>
      </div>
    </div>
  </Zone>;
}
