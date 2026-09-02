import { Injectable } from '@angular/core';

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyMeters?: number;
}

@Injectable({ providedIn: 'root' })
export class GeolocationService {
  currentPosition(): Promise<LocationFix | null> {
    if (!navigator.geolocation) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 30000, timeout: 5000 },
      );
    });
  }
}
