import { TestBed } from '@angular/core/testing';

import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('theme-dark');

    await TestBed.configureTestingModule({
      imports: [ThemeToggle],
    }).compileComponents();
  });

  it('toggles the shared dark theme and persists the selection', () => {
    const fixture = TestBed.createComponent(ThemeToggle);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.theme-toggle') as HTMLButtonElement;

    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.querySelector('.theme-sun svg')).not.toBeNull();
    expect(toggle.querySelector('.theme-moon svg')).not.toBeNull();

    toggle.click();
    fixture.detectChanges();

    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList).toContain('theme-dark');
    expect(localStorage.getItem('ambulanzsystem.home-theme.v1')).toBe('dark');
  });
});
