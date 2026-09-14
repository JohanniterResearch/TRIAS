import { Component, input } from '@angular/core';

@Component({
  selector: 'app-dev-access',
  template: '',
})
export class DevAccess {
  readonly role = input.required<'admin' | 'user'>();
}
