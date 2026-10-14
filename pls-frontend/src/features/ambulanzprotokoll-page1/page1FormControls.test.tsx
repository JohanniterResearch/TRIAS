import { fireEvent, render, screen } from '@testing-library/react';
import { useForm, useWatch } from 'react-hook-form';
import { expect, it } from 'vitest';
import { CheckboxGroup } from './page1FormControls';
import { createPage1Template, type Page1State } from './page1State';
import { page1NacaOptions } from './page1LayoutSpec';

let latest: Page1State | undefined;
const report = (state: Page1State) => {
  latest = state;
};

function Naca({ single, onState }: { single: boolean; onState: (state: Page1State) => void }) {
  const form = useForm<Page1State>({ defaultValues: createPage1Template() });
  onState(useWatch({ control: form.control }) as Page1State);
  return <CheckboxGroup bind="assessment_primary.naca" form={form} options={page1NacaOptions} single={single} />;
}

it('keeps at most one NACA score, as the schema requires (maxItems 1)', () => {
  render(<Naca single onState={report} />);
  fireEvent.click(screen.getByLabelText(page1NacaOptions[1].label));
  fireEvent.click(screen.getByLabelText(page1NacaOptions[3].label));

  expect(latest!.assessment_primary.naca).toEqual([page1NacaOptions[3].value]);
  expect(screen.getByLabelText(page1NacaOptions[1].label)).not.toBeChecked();
});
