import { Component, inject } from '@angular/core';

import { ThemePreferenceService } from './theme-preference.service';

@Component({
  selector: 'app-theme-toggle',
  styleUrl: './theme-toggle.css',
  template: `
    <button
      class="theme-toggle"
      type="button"
      role="switch"
      aria-label="Farbschema: Sonne für Hellmodus, Mond für Dunkelmodus"
      [attr.aria-checked]="theme.darkMode()"
      [class.is-dark]="theme.darkMode()"
      (click)="theme.toggle()"
    >
      <span class="theme-option theme-sun" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"></circle>
          <path
            d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"
          ></path>
        </svg>
      </span>
      <span class="theme-option theme-moon" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z"></path>
        </svg>
      </span>
      <span class="theme-thumb" aria-hidden="true"></span>
    </button>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemePreferenceService);
}
