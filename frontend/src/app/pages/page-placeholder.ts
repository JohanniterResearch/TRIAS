import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-page-placeholder',
  imports: [RouterLink],
  template: `
    <section class="placeholder">
      <p class="eyebrow">{{ stage() }}</p>
      <h1>{{ title() }}</h1>
      <p>{{ description() }}</p>
      <a routerLink="/">Zur Übersicht</a>
    </section>
  `,
})
export class PagePlaceholder {
  readonly title = input.required<string>();
  readonly stage = input('F1 route');
  readonly description = input('Diese Route ist für die nächste Ausbaustufe vorbereitet.');
}
