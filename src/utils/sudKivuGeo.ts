import { sudKivuGeoData } from '../data/sudKivuGeoData.ts';

export const OUTSIDE_SUD_KIVU_MESSAGE =
  "Cette application est actuellement disponible uniquement pour les parcelles situées dans la province du Sud-Kivu, en République démocratique du Congo. Veuillez sélectionner une localisation située à l'intérieur de cette province.";

export interface SudKivuLocality {
  id: string;
  name: string;
  kind: 'Ville' | 'Territoire';
  lat: number;
  lon: number;
  zoneInfo: string;
}

// Coordonnées vérifiées à l'intérieur des polygones officiels geoBoundaries ADM2 du Sud-Kivu
export const SUD_KIVU_LOCALITIES: SudKivuLocality[] = [
  {
    id: 'bukavu',
    name: 'Bukavu',
    kind: 'Ville',
    lat: -2.5048,
    lon: 28.8453,
    zoneInfo: 'Chef-lieu provincial · Collines périurbaines',
  },
  {
    id: 'kabare',
    name: 'Kabare',
    kind: 'Territoire',
    lat: -2.4333,
    lon: 28.8000,
    zoneInfo: 'Hauts plateaux & versants du lac Kivu',
  },
  {
    id: 'walungu',
    name: 'Walungu',
    kind: 'Territoire',
    lat: -2.7755,
    lon: 28.6725,
    zoneInfo: 'Zone montagneuse · Sols de collines',
  },
  {
    id: 'kalehe',
    name: 'Kalehe',
    kind: 'Territoire',
    lat: -1.9433,
    lon: 28.7215,
    zoneInfo: 'Littoral du lac Kivu & hauts plateaux',
  },
  {
    id: 'idjwi',
    name: 'Idjwi',
    kind: 'Territoire',
    lat: -1.8741,
    lon: 29.1282,
    zoneInfo: 'Île du lac Kivu',
  },
  {
    id: 'uvira',
    name: 'Uvira',
    kind: 'Ville',
    lat: -3.3953,
    lon: 29.1378,
    zoneInfo: 'Plaine de la Ruzizi & littoral Tanganyika',
  },
  {
    id: 'baraka',
    name: 'Baraka',
    kind: 'Ville',
    lat: -4.0887,
    lon: 29.0903,
    zoneInfo: 'Littoral sud du lac Tanganyika',
  },
  {
    id: 'fizi',
    name: 'Fizi',
    kind: 'Territoire',
    lat: -4.1621,
    lon: 28.5081,
    zoneInfo: 'Savanes, plaines côtières & plateaux d’Itombwe',
  },
  {
    id: 'mwenga',
    name: 'Mwenga',
    kind: 'Territoire',
    lat: -3.3425,
    lon: 28.3052,
    zoneInfo: 'Forêt humide & contreforts d’Itombwe',
  },
  {
    id: 'kamituga',
    name: 'Kamituga',
    kind: 'Ville',
    lat: -3.0590,
    lon: 28.1927,
    zoneInfo: 'Zone forestière humide',
  },
  {
    id: 'shabunda',
    name: 'Shabunda',
    kind: 'Territoire',
    lat: -3.1866,
    lon: 27.5608,
    zoneInfo: 'Bassin forestier de basse altitude',
  },
];

export const SUD_KIVU_BOUNDS = {
  minLon: 26.8106,
  maxLon: 29.2645,
  minLat: -5.0103,
  maxLat: -1.5838,
} as const;

type Ring = readonly (readonly [number, number])[];

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(
  lon: number,
  lat: number,
  geometry: { type: string; coordinates: unknown }
): boolean {
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as readonly Ring[]]
      : (geometry.coordinates as readonly (readonly Ring[])[]);

  for (const poly of polys) {
    if (poly.length === 0) continue;
    if (pointInRing(lon, lat, poly[0])) {
      let inHole = false;
      for (let h = 1; h < poly.length; h++) {
        if (pointInRing(lon, lat, poly[h])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }
  return false;
}

export function isInsideSudKivu(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (
    lat < SUD_KIVU_BOUNDS.minLat ||
    lat > SUD_KIVU_BOUNDS.maxLat ||
    lon < SUD_KIVU_BOUNDS.minLon ||
    lon > SUD_KIVU_BOUNDS.maxLon
  ) {
    return false;
  }
  return pointInGeometry(lon, lat, sudKivuGeoData.province.geometry);
}

export function findSudKivuTerritory(lat: number, lon: number): string | null {
  if (!isInsideSudKivu(lat, lon)) return null;
  for (const feature of sudKivuGeoData.territories) {
    if (pointInGeometry(lon, lat, feature.geometry)) {
      return feature.properties.shapeName;
    }
  }
  return 'Sud-Kivu';
}
