import { useState, useEffect } from 'react';

export interface GeoPosition {
  loaded: boolean;
  coordinates: { lat: number | string; lng: number | string };
  error: GeolocationPositionError | { message: string } | null;
}

export function useGeolocation(): GeoPosition {
  const [position, setPosition] = useState<GeoPosition>(() => {
    if (typeof navigator !== 'undefined' && !navigator.geolocation) {
      return {
        loaded: true,
        coordinates: { lat: '', lng: '' },
        error: { message: 'Geolocation is not supported by your browser' },
      };
    }

    return {
      loaded: false,
      coordinates: { lat: '', lng: '' },
      error: null,
    };
  });

  useEffect(() => {
    let isMounted = true;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return () => {
        isMounted = false;
      };
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (isMounted)
          setPosition({
            loaded: true,
            coordinates: { lat: pos.coords.latitude, lng: pos.coords.longitude },
            error: null,
          });
      },
      (error) => {
        if (isMounted)
          setPosition((prev) => ({ ...prev, loaded: true, error }));
      }
    );

    return () => {
      isMounted = false;
    };
  }, []);

  return position;
}
