import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ResponderStateStore } from '../responder/services/responder-state';
import { Home } from './home';

describe('Home', () => {
  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('theme-dark');

    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('leaves the shared application header to the app shell', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.app-title')).toBeNull();
    expect(fixture.nativeElement.querySelector('.home-header')).toBeNull();
  });

  it('shows the five primary areas in their intended order', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.feature-link strong') as NodeListOf<HTMLElement>,
    ).map((element) => element.textContent?.trim());

    expect(labels).toEqual([
      'Triage',
      'Patient aufnehmen',
      'Ambulanzprotokoll',
      'Lagebild',
      'Teams',
    ]);
  });

  it('shows login tiles first and all remaining areas in a separate grid', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const links = Array.from(
      fixture.nativeElement.querySelectorAll('.home a') as NodeListOf<HTMLAnchorElement>,
    );

    expect(links).toHaveLength(11);
    expect(links.every((link) => link.classList.contains('menu-tile'))).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.tile-grid')).toHaveLength(2);
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.login-link') as NodeListOf<HTMLAnchorElement>,
      ).map((link) => link.getAttribute('href')),
    ).toEqual(['/login', '/admin/login']);
    expect(fixture.nativeElement.querySelector('.feature-link.triage')?.textContent).toContain(
      'Triage',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Weitere Bereiche');
    expect(fixture.nativeElement.textContent).not.toContain('Bereich antippen, um fortzufahren');
    expect(links.slice(1).length % 2).toBe(0);
  });

  it('shows a large decorative icon on every menu tile', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const tiles = Array.from(
      fixture.nativeElement.querySelectorAll('.menu-tile') as NodeListOf<HTMLElement>,
    );

    expect(tiles.length).toBeGreaterThan(0);
    expect(
      tiles.every((tile) => tile.querySelector('svg.tile-icon[aria-hidden="true"]') !== null),
    ).toBe(true);
  });

  it('uses a QR-code icon for QR login', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const qrTile = fixture.nativeElement.querySelector(
      '.login-link[routerlink="/login"]',
    ) as HTMLElement;

    expect(qrTile.querySelector('svg.tile-icon path')?.getAttribute('d')).toContain('M8 8h20');
  });

  it('leaves the shared connection status to the app shell', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sync-state')).toBeNull();
  });

  it('keeps the existing destination for each menu area', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const destinations = Array.from(
      fixture.nativeElement.querySelectorAll('.feature-link') as NodeListOf<HTMLAnchorElement>,
    ).map((link) => link.getAttribute('href'));

    expect(destinations).toEqual([
      '/triage',
      '/scan-patient',
      '/scan-patient',
      '/situation-room',
      '/teams',
      '/role-selection',
      '/body/front',
      '/body/back',
      '/admin',
    ]);

    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.login-link') as NodeListOf<HTMLAnchorElement>,
      ).map((link) => link.getAttribute('href')),
    ).toEqual(['/login', '/admin/login']);
  });

  it('places Einsatz wählen before the body tiles and Admin at the end of the grid', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    const destinations = Array.from(
      fixture.nativeElement.querySelectorAll('.feature-link') as NodeListOf<HTMLAnchorElement>,
    ).map((link) => link.getAttribute('href'));

    expect(destinations.indexOf('/role-selection')).toBeLessThan(
      destinations.indexOf('/body/front'),
    );
    expect(destinations.at(-1)).toBe('/admin');
  });

  it('opens patient selection for a protocol when no patient is active', () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.feature-link.protocol')?.getAttribute('href'),
    ).toBe('/scan-patient');
  });

  it('shows the active patient above the normal menu without extra action tiles', () => {
    const fixture = TestBed.createComponent(Home);
    TestBed.inject(ResponderStateStore).setPatient({
      id: 42,
      operationSceneId: 7,
      createdAt: '2026-01-01T10:00:00Z',
      updatedAt: '2026-01-01T10:00:00Z',
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.patient-card')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.patient-actions')).toBeNull();
    expect(fixture.nativeElement.querySelector('.patient-action')).toBeNull();
    expect(fixture.nativeElement.querySelector('.feature-link.protocol')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.feature-link[routerlink="/body/front"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.feature-link[routerlink="/body/back"]'),
    ).not.toBeNull();
    expect(
      Array.from(
        fixture.nativeElement.querySelectorAll('.home a') as NodeListOf<HTMLAnchorElement>,
      ).every((link) => link.classList.contains('menu-tile')),
    ).toBe(true);
  });
});
