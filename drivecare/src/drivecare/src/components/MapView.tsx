import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  text?: string;
  kind?: 'stop' | 'home' | 'end';
}

export interface MapLine {
  points: [number, number][];
  color?: string;
  dashed?: boolean;
}

const VANCOUVER: [number, number] = [49.2827, -123.1207];

/**
 * OpenStreetMap tiles (tile.openstreetmap.org). Usage policy: light personal use is fine,
 * attribution is required and shown, and tiles are not bulk-downloaded or cached offline.
 */
export default function MapView({
  markers = [],
  lines = [],
  onPick,
  height = 240,
  className = '',
}: {
  markers?: MapMarker[];
  lines?: MapLine[];
  onPick?: (lat: number, lng: number) => void;
  height?: number;
  className?: string;
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(VANCOUVER, 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => pickRef.current?.(e.latlng.lat, e.latlng.lng));
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  const sig = JSON.stringify([markers, lines.map((l) => [l.points.length, l.points[0], l.points[l.points.length - 1], l.color, l.dashed])]);
  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const ln of lines) {
      if (ln.points.length < 2) continue;
      L.polyline(ln.points, { color: ln.color ?? '#007aff', weight: 5, opacity: 0.85, dashArray: ln.dashed ? '6 8' : undefined }).addTo(g);
      bounds.push(...ln.points);
    }
    for (const mk of markers) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="dc-pin ${mk.kind ?? ''}">${escapeHtml(mk.text ?? '')}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([mk.lat, mk.lng], { icon, keyboard: false }).addTo(g);
      if (mk.label) marker.bindTooltip(escapeHtml(mk.label), { direction: 'top', offset: [0, -12] });
      bounds.push([mk.lat, mk.lng]);
    }
    if (bounds.length === 1) m.setView(bounds[0], 15);
    else if (bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return <div ref={el} className={`overflow-hidden rounded-2xl ${className}`} style={{ height, zIndex: 0, position: 'relative' }} />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
