import {
  page1GenderOptions,
  page1MedicationColumns,
  page1NacaOptions,
  page1PrimaryAssessmentGroups,
} from './page1LayoutSpec';
import {
  MAX_MEDICATION_ROWS,
  createMedicationAdministration,
  normalizeMedicationAdministrations,
  type Page1State,
} from './page1State';
import { BodyMapField } from './page1CanvasFields';
import {
  CheckboxGroup,
  LinedTextarea,
  PaperField,
  RadioInline,
  SegmentedInput,
  TimeOrFlagsField,
  UnderlineInput,
  Zone,
  type Page1Form,
} from './page1FormControls';

export function BrandHeader() {
  return <Zone className="ambd-zone--branding" zoneId="brand_header">
    <div className="ambd-branding">
      <div className="ambd-branding__mark">✚</div>
      <div className="ambd-branding__wordmark">JOHANNITER</div>
    </div>
    <div className="ambd-branding__title">AMBULANZPROTOKOLL</div>
  </Zone>;
}

export function IncidentHeader({ form }: { form: Page1Form }) {
  return <Zone className="ambd-zone--section" zoneId="incident_header">
    <div className="ambd-grid ambd-grid--2">
      <PaperField label="Ambulanzort"><UnderlineInput registration={form.register('incident.ambulanzort')} /></PaperField>
      <PaperField label="Protokoll- / PLS-Nummer"><UnderlineInput registration={form.register('incident.pls_nummer')} /></PaperField>
    </div>
    <div className="ambd-header-grid">
      <SegmentedInput className="ambd-header-grid__date" label="Datum" placeholder="TT MM JJ" registration={form.register('incident.datum')} />
      <PaperField label="Uhrzeit-Beginn"><UnderlineInput placeholder="__:__" registration={form.register('incident.uhrzeit_beginn')} /></PaperField>
      <PaperField label="DNr. - San."><UnderlineInput registration={form.register('incident.dnr_san_1')} /></PaperField>
      <PaperField label="DNr. - San."><UnderlineInput registration={form.register('incident.dnr_san_2')} /></PaperField>
      <PaperField label="DNr. - San."><UnderlineInput registration={form.register('incident.dnr_san_3')} /></PaperField>
      <PaperField label="DNr. - NA"><UnderlineInput registration={form.register('incident.dnr_na')} /></PaperField>
      <PaperField label="Funkrufname / Behandlungsplatz"><UnderlineInput registration={form.register('incident.funkrufname')} /></PaperField>
    </div>
  </Zone>;
}

export function PatientBlock({ form }: { form: Page1Form }) {
  return <Zone className="ambd-zone--section" zoneId="patient_block">
    <div className="ambd-patient-grid ambd-patient-grid--row1">
      <PaperField label="Patient - Familienname"><UnderlineInput registration={form.register('patient.familienname')} /></PaperField>
      <PaperField label="Vorname"><UnderlineInput registration={form.register('patient.vorname')} /></PaperField>
      <PaperField label="Ges."><RadioInline bind="patient.geschlecht" form={form} options={page1GenderOptions} /></PaperField>
      <PaperField label="Vers.-Nr."><UnderlineInput registration={form.register('patient.vers_nr')} /></PaperField>
      <PaperField label="Geb.-Datum"><UnderlineInput placeholder="TT.MM.JJ" registration={form.register('patient.geburtsdatum')} /></PaperField>
    </div>
    <div className="ambd-patient-grid ambd-patient-grid--row2">
      <PaperField label="Adresse"><UnderlineInput registration={form.register('patient.adresse')} /></PaperField>
      <PaperField label="Staat"><UnderlineInput registration={form.register('patient.staat')} /></PaperField>
      <PaperField label="Telefon"><UnderlineInput registration={form.register('patient.telefon')} /></PaperField>
    </div>
    <div className="ambd-patient-grid ambd-patient-grid--row3">
      <PaperField label="Arbeitgeber"><UnderlineInput registration={form.register('patient.arbeitgeber')} /></PaperField>
      <PaperField label="Versicherungsträger"><UnderlineInput registration={form.register('patient.versicherungstraeger')} /></PaperField>
      <SegmentedInput label="Familienstand" placeholder="" registration={form.register('patient.familienstand')} />
    </div>
  </Zone>;
}

export function PrimaryAssessment({ form }: { form: Page1Form }) {
  return <Zone className="ambd-zone--banded" rail="ERST.-DIAGN." zoneId="erstdiagnose_allgemein">
    <div className="ambd-naca">
      <div className="ambd-subtitle">NACA-Score</div>
      <CheckboxGroup bind="assessment_primary.naca" form={form} options={page1NacaOptions} single />
    </div>
    <div className="ambd-primary-grid">
      {page1PrimaryAssessmentGroups.map((group) => <div key={group.bind} className="ambd-assessment-card">
        <div className="ambd-assessment-card__title">{group.label}</div>
        <CheckboxGroup bind={group.bind} form={form} options={group.options} />
      </div>)}
    </div>
    <TimeOrFlagsField form={form} />
  </Zone>;
}

export function AnamneseBodyMap({
  draft,
  form,
  onBodyMapChange,
}: {
  draft: Page1State;
  form: Page1Form;
  onBodyMapChange: (value: Page1State['assessment_secondary']['bodymap']) => void;
}) {
  return <Zone className="ambd-zone--paper" rail="ANAMNESE / UNTERSUCHUNG" zoneId="anamnese_bodymap">
    <div className="ambd-anamnese">
      <div className="ambd-anamnese__notes"><LinedTextarea bind="assessment_secondary.anamnese_text" form={form} lines={10} /></div>
      <div className="ambd-anamnese__bodymap"><BodyMapField onChange={onBodyMapChange} value={draft.assessment_secondary.bodymap} /></div>
    </div>
  </Zone>;
}

export function MedicationGrid({ draft, form }: { draft: Page1State; form: Page1Form }) {
  const medications = normalizeMedicationAdministrations(draft.medications_administered);
  const padded = medications.length === 0
    ? Array.from({ length: MAX_MEDICATION_ROWS }, () => createMedicationAdministration())
    : [...medications, ...Array.from({ length: MAX_MEDICATION_ROWS - medications.length }, () => createMedicationAdministration())];

  return <Zone className="ambd-zone--section" zoneId="akutmedikation">
    <div className="ambd-medications__title">Akutmedikation durch RD</div>
    <div className="ambd-medications__sheet">
      {Array.from({ length: 2 }, (_, halfIndex) => <div key={halfIndex} className="ambd-medications__half">
        {page1MedicationColumns.map((column) => <div key={column.key} className="ambd-medications__heading">{column.label}</div>)}
        {padded.slice(halfIndex * 4, halfIndex * 4 + 4).map((row, rowIndex) =>
          page1MedicationColumns.map((column) => {
            const index = halfIndex * 4 + rowIndex;
            return <input
              key={`${index}-${column.key}`}
              className="ambd-medications__input"
              onChange={(event) => {
                const next = padded.map((entry, entryIndex) => entryIndex === index
                  ? { ...entry, [column.key]: event.target.value || null }
                  : entry);
                form.setValue('medications_administered', normalizeMedicationAdministrations(next), { shouldDirty: true, shouldTouch: true });
              }}
              placeholder={column.key === 'uhrzeit' ? '__:__' : ''}
              type="text"
              value={(row[column.key] as string | null | undefined) ?? ''}
            />;
          }),
        )}
      </div>)}
    </div>
  </Zone>;
}
