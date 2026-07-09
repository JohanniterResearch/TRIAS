import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { MyAccess } from '../auth/components/my-access';

@Component({
  selector: 'app-page-placeholder',
  imports: [MyAccess, RouterLink],
  template: `
    <section class="placeholder">
      <app-my-access />
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
