import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface GeofenceMapProps {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

/**
 * Mapa de la geocerca en Ajustes: dibuja un círculo real (radio en metros,
 * no aproximado en píxeles) sobre las coordenadas configuradas, para que el
 * admin vea de un vistazo hasta dónde llega el perímetro que decide si el
 * botón "Ya Llegué" del padre se activa o no — antes solo había un iframe
 * de Google Maps sin API key (sin satélite real) y sin ninguna forma de ver
 * el radio, así que un perímetro demasiado chico para la zona de espera
 * real (como pasó en TCS Albrook, 35m) no se notaba hasta que un padre se
 * quedaba con el botón en gris.
 *
 * Usa Leaflet + tiles de OpenStreetMap (gratis, sin API key) en vez de la
 * Google Maps JavaScript API, que sí requeriría una key paga para poder
 * dibujar overlays — la vista deja de ser satelital, pero si el colegio
 * llega a tener una key de Google Maps más adelante, alcanza con cambiar
 * la capa de tiles acá, sin tocar el resto de esta pantalla.
 */
export function GeofenceMap({ latitude, longitude, radiusMeters }: GeofenceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const centerMarkerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [latitude, longitude],
      zoom: 17,
      attributionControl: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      circleRef.current = null;
      centerMarkerRef.current = null;
    };
    // Se arma una sola vez — la posición/radio se actualizan en el efecto de
    // abajo sin recrear el mapa, para no perder el zoom/paneo manual del
    // admin en cada tecla que escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(radiusMeters)) return;
    const center: L.LatLngExpression = [latitude, longitude];

    if (!circleRef.current) {
      circleRef.current = L.circle(center, {
        radius: radiusMeters,
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(map);
    } else {
      circleRef.current.setLatLng(center);
      circleRef.current.setRadius(radiusMeters);
    }

    if (!centerMarkerRef.current) {
      centerMarkerRef.current = L.circleMarker(center, {
        radius: 6,
        color: '#4f46e5',
        fillColor: '#4f46e5',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
    } else {
      centerMarkerRef.current.setLatLng(center);
    }

    map.fitBounds(circleRef.current.getBounds(), { padding: [24, 24] });
  }, [latitude, longitude, radiusMeters]);

  return <div ref={containerRef} className="w-full h-full" />;
}
