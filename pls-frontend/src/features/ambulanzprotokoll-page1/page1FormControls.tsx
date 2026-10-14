import type { CSSProperties, ReactNode } from 'react';
import type { FieldPath, UseFormReturn } from 'react-hook-form';
import { page1ZoneRects, type Page1Option } from './page1LayoutSpec';
import type { Page1State } from './page1State';

export type Page1Form = UseFormReturn<Page1State>;

function bindPath(bind: string) {
  return bind as FieldPath<Page1State>;
}

function readBoundValue(source: Page1State, bind: string) {
  return bind.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

function toggleArrayBinding(form: Page1Form, bind: string, optionValue: string, checked: boolean, single = false) {
  const current = readBoundValue(form.getValues(), bind);
  const currentValues = Array.isArray(current) ? current.map(String) : [];
  const nextValues = checked
    ? single ? [optionValue] : Array.from(new Set([...currentValues, optionValue]))
    : currentValues.filter((value) => value !== optionValue);

  form.setValue(bindPath(bind), nextValues as never, { shouldDirty: true, shouldTouch: true });
}

export function Zone({
  className,
  rail,
  railRight,
  zoneId,
  children,
}: {
  className?: string;
  rail?: string;
  railRight?: string;
  zoneId: keyof typeof page1ZoneRects;
  children: ReactNode;
}) {
  const rect = page1ZoneRects[zoneId];
  const style: CSSProperties = {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.w}%`,
    height: `${rect.h}%`,
  };

  return (
    <section className={['ambd-zone', className].filter(Boolean).join(' ')} style={style}>
      {rail ? <div className="ambd-rail">{rail}</div> : null}
      {railRight ? <div className="ambd-rail ambd-rail--right">{railRight}</div> : null}
      <div className="ambd-zone-inner">{children}</div>
    </section>
  );
}

export function PaperField({
  className,
  label,
  children,
}: {
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <label className={['ambd-field', className].filter(Boolean).join(' ')}>
      {label !== undefined ? <span className="ambd-field-label">{label}</span> : null}
      {children}
    </label>
  );
}

export function UnderlineInput({
  className,
  placeholder,
  registration,
}: {
  className?: string;
  placeholder?: string;
  registration: ReturnType<Page1Form['register']>;
}) {
  return <input className={['ambd-input', className].filter(Boolean).join(' ')} placeholder={placeholder} type="text" {...registration} />;
}

export function CheckboxLabel({
  checked,
  className,
  inline = false,
  label,
  onChange,
}: {
  checked: boolean;
  className?: string;
  inline?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={['ambd-option', inline ? 'ambd-option--inline' : '', className].filter(Boolean).join(' ')}>
      <input checked={checked} className="ambd-option-input" onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className={checked ? 'ambd-check ambd-check--checked' : 'ambd-check'} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function CheckboxGroup({
  bind,
  form,
  inline = false,
  options,
  single = false,
}: {
  bind: string;
  form: Page1Form;
  inline?: boolean;
  options: readonly Page1Option[];
  /** At most one box ticked (schema maxItems 1): ticking one clears the others. */
  single?: boolean;
}) {
  const current = readBoundValue(form.getValues(), bind);
  const values = Array.isArray(current) ? current.map(String) : [];

  return (
    <div className={inline ? 'ambd-option-list ambd-option-list--inline' : 'ambd-option-list'}>
      {options.map((option) => (
        <CheckboxLabel
          key={option.value}
          checked={values.includes(option.value)}
          inline={inline}
          label={option.label}
          onChange={(checked) => toggleArrayBinding(form, bind, option.value, checked, single)}
        />
      ))}
    </div>
  );
}

export function RadioInline({ bind, form, options }: { bind: string; form: Page1Form; options: readonly Page1Option[] }) {
  const current = readBoundValue(form.getValues(), bind);
  const selected = current === null || current === undefined ? '' : String(current);

  return (
    <div className="ambd-radio-inline">
      {options.map((option) => (
        <label key={option.value} className="ambd-radio-inline__item">
          <input
            checked={selected === option.value}
            className="ambd-option-input"
            name={bind}
            onChange={() => form.setValue(bindPath(bind), option.value as never, { shouldDirty: true, shouldTouch: true })}
            type="radio"
          />
          <span className={selected === option.value ? 'ambd-check ambd-check--checked' : 'ambd-check'} aria-hidden="true" />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function RadioStack({ bind, form, options }: { bind: string; form: Page1Form; options: readonly Page1Option[] }) {
  const current = readBoundValue(form.getValues(), bind);
  const selected = current === null || current === undefined ? '' : String(current);

  return (
    <div className="ambd-option-stack">
      {options.map((option) => (
        <label key={option.value} className="ambd-option ambd-option--inline">
          <input
            checked={selected === option.value}
            className="ambd-option-input"
            name={bind}
            onChange={() => form.setValue(bindPath(bind), Number(option.value) as never, { shouldDirty: true, shouldTouch: true })}
            type="radio"
          />
          <span className={selected === option.value ? 'ambd-check ambd-check--checked' : 'ambd-check'} aria-hidden="true" />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

export function SegmentedInput({
  className,
  label,
  placeholder,
  registration,
}: {
  className?: string;
  label?: string;
  placeholder?: string;
  registration: ReturnType<Page1Form['register']>;
}) {
  return (
    <PaperField className={className} label={label}>
      <div className="ambd-segmented-shell">
        <UnderlineInput className="ambd-input--segmented" placeholder={placeholder} registration={registration} />
      </div>
    </PaperField>
  );
}

export function LinedTextarea({
  bind,
  form,
  label,
  lines = 4,
}: {
  bind: FieldPath<Page1State>;
  form: Page1Form;
  label?: string;
  lines?: number;
}) {
  return (
    <PaperField className="ambd-textarea-field" label={label}>
      <div className="ambd-lined-textarea">
        <textarea className="ambd-textarea" {...form.register(bind)} />
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className="ambd-lined-textarea__line" aria-hidden="true" />
        ))}
      </div>
    </PaperField>
  );
}

export function TimeOrFlagsField({ form }: { form: Page1Form }) {
  const value = form.getValues().assessment_primary.angen_notfallzeit;

  return (
    <div className="ambd-time-flags">
      <PaperField className="ambd-time-flags__time" label="angen. Notfallzeit">
        <UnderlineInput placeholder="__:__" registration={form.register('assessment_primary.angen_notfallzeit.zeit')} />
      </PaperField>
      <div className="ambd-time-flags__checks">
        <CheckboxLabel
          checked={value.gt24h}
          inline
          label="> als 24 Stunden"
          onChange={(checked) => form.setValue('assessment_primary.angen_notfallzeit.gt24h', checked, { shouldDirty: true, shouldTouch: true })}
        />
        <CheckboxLabel
          checked={value.unbekannt}
          inline
          label="unbekannt"
          onChange={(checked) => form.setValue('assessment_primary.angen_notfallzeit.unbekannt', checked, { shouldDirty: true, shouldTouch: true })}
        />
      </div>
    </div>
  );
}
