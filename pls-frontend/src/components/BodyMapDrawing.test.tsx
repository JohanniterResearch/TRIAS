import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import BodyMapDrawing from './BodyMapDrawing';

afterEach(cleanup);

it('read-only drawing has no focusable regions; the editable one has checkboxes (WP 7.4)', () => {
  const { unmount } = render(<BodyMapDrawing server={{ kopf_vorne: 1 }} label="Körperregionen" />);
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  expect(document.querySelectorAll('[tabindex]')).toHaveLength(0);
  expect(screen.getByRole('img', { name: /Vorderseite: kopf_vorne/ })).toBeInTheDocument();
  unmount();

  render(<BodyMapDrawing server={{ kopf_vorne: 1 }} onToggle={vi.fn()} label="Körperregionen" />);
  expect(screen.getByRole('checkbox', { name: 'kopf vorne' })).toBeChecked();
});
