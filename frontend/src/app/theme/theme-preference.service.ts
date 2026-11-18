import { DOCUMENT } from '@angular/common';
import { inject, Injectable, OnDestroy, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemePreferenceService implements OnDestroy {
  private readonly preferenceKey = 'ambulanzsystem.home-theme.v1';
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly systemTheme = this.window?.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly followSystemTheme = (event: MediaQueryListEvent) => {
    if (this.window?.localStorage.getItem(this.preferenceKey) === null) {
      this.apply(event.matches);
    }
  };

  readonly darkMode = signal(false);

  constructor() {
    const preference = this.window?.localStorage.getItem(this.preferenceKey);
    this.apply(preference ? preference === 'dark' : (this.systemTheme?.matches ?? false));
    this.systemTheme?.addEventListener('change', this.followSystemTheme);
  }

  ngOnDestroy(): void {
    this.systemTheme?.removeEventListener('change', this.followSystemTheme);
  }

  toggle(): void {
    const darkMode = !this.darkMode();
    this.window?.localStorage.setItem(this.preferenceKey, darkMode ? 'dark' : 'light');
    this.apply(darkMode);
  }

  private apply(darkMode: boolean): void {
    this.darkMode.set(darkMode);
    this.document.documentElement.classList.toggle('theme-dark', darkMode);
  }
}
