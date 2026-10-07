import * as L from 'leaflet';

export const DEFAULT_MAP_CENTER: L.LatLngTuple = [48.2082, 16.3738];

export function osmMap(element: HTMLElement, center: L.LatLngTuple, zoom: number): L.Map {
  const map = L.map(element).setView(center, zoom);
  // OSM's tile policy asks browser apps for a Referer; the page-wide no-referrer header would
  // suppress it, so tiles alone send the origin (never the path, which may hold patient IDs).
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(map);
  return map;
}
