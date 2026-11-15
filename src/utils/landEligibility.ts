import type {
  GeoFeatureCategory,
  LandEligibilityReasonCode,
  LandEligibilityReport,
  MatchedGeoFeature,
} from '../types/agri.ts';
import { findSudKivuTerritory } from './sudKivuGeo.ts';

export const ELIGIBILITY_MESSAGES = {
  BUILDING:
    "Attention : les coordonnées sélectionnées correspondent à un bâtiment ou à une infrastructure. Veuillez sélectionner l'emplacement réel de votre parcelle agricole.",
  ROAD:
    'Cette position semble correspondre à une route ou à une infrastructure de transport. Veuillez sélectionner votre terrain agricole.',
  PROTECTED:
    'Attention : cette position se trouve dans une zone protégée ou soumise à des restrictions environnementales. Les recommandations de culture sont bloquées.',
  POTENTIALLY_SUITABLE:
    'Vérification préliminaire réussie. Aucune restriction cartographique connue n’a été détectée. Vous pouvez poursuivre l’analyse agricole. Veuillez confirmer que vous êtes autorisé à cultiver cette parcelle.',
  UNKNOWN:
    'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.',
  AUTHORITY_GUIDANCE:
    'Veuillez consulter les services environnementaux compétents (ICCN, coordination provinciale de l’environnement ou autorités foncières locales) avant toute activité agricole.',
  LIMITATIONS_NOTE:
    'Avertissement : les bases OpenStreetMap et WDPA (Protected Planet) peuvent être incomplètes ou ne pas refléter les titres fonciers coutumiers ou récents. Cette vérification constitue un filtrage géographique préliminaire et ne vaut pas autorisation légale de culture ni preuve de propriété.',
} as const;

export type LonLat = readonly [number, number]; // [lon, lat]

export interface VectorPolygonFeature {
  id: string;
  source: string;
  tags: Record<string, string>;
  outerRings: LonLat[][];
  holes: LonLat[][];
  legalDesignation?: string | null;
  iucnCategory?: string | null;
  legalStatus?: string | null;
}

export interface VectorPolylineFeature {
  id: string;
  source: string;
  tags: Record<string, string>;
  points: LonLat[];
}

export interface VectorPointFeature {
  id: string;
  source: string;
  tags: Record<string, string>;
  lon: number;
  lat: number;
  approxRadiusMeters?: number | null;
  legalDesignation?: string | null;
  iucnCategory?: string | null;
  legalStatus?: string | null;
  missingBoundary?: boolean;
}

export interface EnclosingAreaTagFeature {
  id: string;
  source: string;
  tags: Record<string, string>;
  legalDesignation?: string | null;
  iucnCategory?: string | null;
  legalStatus?: string | null;
}

export interface LandUseFetchResult {
  ok: boolean;
  provider: string;
  polygons: VectorPolygonFeature[];
  polylines: VectorPolylineFeature[];
  points: VectorPointFeature[];
  enclosingAreas: EnclosingAreaTagFeature[];
  error?: string;
}

export interface ProtectedAreaFetchResult {
  ok: boolean;
  provider: string;
  polygons: VectorPolygonFeature[];
  pointSites: VectorPointFeature[];
  enclosingAreas: EnclosingAreaTagFeature[];
  error?: string;
}

export interface LandEligibilityDataProvider {
  fetchLandUseData(
    lat: number,
    lon: number,
    accuracyMeters: number
  ): Promise<LandUseFetchResult>;
  fetchProtectedAreaData(
    lat: number,
    lon: number,
    accuracyMeters: number
  ): Promise<ProtectedAreaFetchResult>;
}

const URBAN_LANDUSE_VALUES = new Set([
  'residential',
  'industrial',
  'commercial',
  'retail',
  'construction',
  'quarry',
  'landfill',
  'military',
  'railway',
  'garages',
  'cemetery',
  'brownfield',
  'port',
]);

const AGRICULTURAL_CONTEXT_LANDUSE = new Set([
  'farmland',
  'orchard',
  'vineyard',
  'meadow',
  'allotments',
  'farmyard',
  'greenhouse_horticulture',
  'plant_nursery',
]);

const NON_AG_LEISURE_VALUES = new Set([
  'stadium',
  'playground',
  'park',
  'sports_centre',
  'pitch',
  'swimming_pool',
  'golf_course',
  'track',
  'water_park',
]);

const NON_AG_AMENITY_VALUES = new Set([
  'school',
  'university',
  'college',
  'kindergarten',
  'hospital',
  'clinic',
  'doctors',
  'marketplace',
  'bus_station',
  'ferry_terminal',
  'parking',
  'prison',
  'courthouse',
  'townhall',
  'police',
  'fire_station',
  'fuel',
  'bank',
  'community_centre',
  'social_facility',
  'embassy',
  'public_building',
]);

const IGNORED_HIGHWAY_POINT_NODES = new Set([
  'street_lamp',
  'traffic_signals',
  'milestone',
  'speed_camera',
  'give_way',
  'stop',
  'street_cabinet',
]);

const NON_ROAD_HIGHWAY_VALUES = new Set([
  'street_lamp',
  'traffic_signals',
  'milestone',
  'speed_camera',
  'give_way',
  'stop',
]);

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const OSM_API_06_BASE = 'https://api.openstreetmap.org/api/0.6/map';
const WDPA_FEATURE_SERVER_BASE =
  'https://data-gis.unep-wcmc.org/server/rest/services/ProtectedSites/The_World_Database_of_Protected_Areas/FeatureServer';

const HTTP_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'GITAgroIntelligence/1.0 (Sud-Kivu Agricultural Eligibility Verification)',
};

// ============================================================================
// Pure Spatial Geometry Engine (Local Tangent Plane in Meters)
// ============================================================================

function toMetersOffset(
  lon: number,
  lat: number,
  originLon: number,
  originLat: number
): [number, number] {
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.max(0.1, Math.cos((originLat * Math.PI) / 180));
  return [(lon - originLon) * metersPerDegLon, (lat - originLat) * metersPerDegLat];
}

export function pointInRingLonLat(lon: number, lat: number, ring: readonly LonLat[]): boolean {
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

export function distanceOriginToSegmentMeters(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    return Math.hypot(x1, y1);
  }
  const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lenSq));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(px, py);
}

export function distancePointToPolylineMeters(
  lat: number,
  lon: number,
  points: readonly LonLat[]
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) {
    const [x, y] = toMetersOffset(points[0][0], points[0][1], lon, lat);
    return Math.hypot(x, y);
  }
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = toMetersOffset(points[i][0], points[i][1], lon, lat);
    const [x2, y2] = toMetersOffset(points[i + 1][0], points[i + 1][1], lon, lat);
    const d = distanceOriginToSegmentMeters(x1, y1, x2, y2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

export function analyzePointVsPolygonMeters(
  lat: number,
  lon: number,
  outerRings: readonly (readonly LonLat[])[],
  holes: readonly (readonly LonLat[])[] = []
): { inside: boolean; edgeDistanceMeters: number } {
  let insideOuter = false;
  for (const ring of outerRings) {
    if (ring.length >= 3 && pointInRingLonLat(lon, lat, ring)) {
      insideOuter = true;
      break;
    }
  }

  let insideHole = false;
  if (insideOuter && holes.length > 0) {
    for (const hole of holes) {
      if (hole.length >= 3 && pointInRingLonLat(lon, lat, hole)) {
        insideHole = true;
        break;
      }
    }
  }

  const inside = insideOuter && !insideHole;
  if (inside) {
    return { inside: true, edgeDistanceMeters: 0 };
  }

  let minEdgeDist = Infinity;
  for (const ring of [...outerRings, ...holes]) {
    for (let i = 0; i < ring.length; i++) {
      const nextIdx = (i + 1) % ring.length;
      const [x1, y1] = toMetersOffset(ring[i][0], ring[i][1], lon, lat);
      const [x2, y2] = toMetersOffset(ring[nextIdx][0], ring[nextIdx][1], lon, lat);
      const d = distanceOriginToSegmentMeters(x1, y1, x2, y2);
      if (d < minEdgeDist) minEdgeDist = d;
    }
  }

  return { inside: false, edgeDistanceMeters: minEdgeDist };
}

export function distanceBetweenPointsMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const [x, y] = toMetersOffset(lon2, lat2, lon1, lat1);
  return Math.hypot(x, y);
}

export function getHighwayHalfWidthMeters(tags: Record<string, string>): number {
  if (tags.aeroway) {
    if (tags.aeroway === 'runway') return 22;
    if (tags.aeroway === 'taxiway' || tags.aeroway === 'apron') return 12;
    return 10;
  }
  if (tags.railway) return 4.0;
  const hw = tags.highway ?? '';
  if (hw === 'motorway' || hw === 'trunk' || hw === 'primary') return 5.5;
  if (hw === 'secondary' || hw === 'tertiary') return 4.0;
  if (
    hw === 'residential' ||
    hw === 'unclassified' ||
    hw === 'service' ||
    hw === 'living_street' ||
    hw === 'road' ||
    hw === 'construction'
  ) {
    return 3.0;
  }
  if (hw === 'track') return 2.0;
  if (hw === 'footway' || hw === 'path' || hw === 'pedestrian' || hw === 'cycleway' || hw === 'steps') {
    return 1.5;
  }
  return 3.0;
}

// ============================================================================
// OSM & WDPA Response Parsers
// ============================================================================

function isProtectedTags(tags: Record<string, string>): boolean {
  return (
    tags.boundary === 'protected_area' ||
    tags.boundary === 'national_park' ||
    tags.leisure === 'nature_reserve'
  );
}

function isClosedLonLatRing(pts: readonly LonLat[]): boolean {
  if (pts.length < 4) return false;
  const first = pts[0];
  const last = pts[pts.length - 1];
  return Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7;
}

function shouldTreatWayAsPolygon(tags: Record<string, string>, pts: readonly LonLat[]): boolean {
  if (!isClosedLonLatRing(pts)) return false;
  if (tags.area === 'yes') return true;
  if (tags.area === 'no') return false;
  if (
    tags.building ||
    tags.landuse ||
    tags.amenity ||
    tags.leisure ||
    tags.historic ||
    tags.heritage ||
    tags.boundary ||
    tags.aeroway === 'terminal' ||
    tags.aeroway === 'aerodrome'
  ) {
    return true;
  }
  return false;
}

function stitchOpenWaysToRings(wayNodeArrays: LonLat[][]): LonLat[][] {
  const closed: LonLat[][] = [];
  const open: LonLat[][] = [];

  for (const pts of wayNodeArrays) {
    if (pts.length < 2) continue;
    if (isClosedLonLatRing(pts)) {
      closed.push(pts);
    } else {
      open.push([...pts]);
    }
  }

  // Greedily merge open segments whose endpoints match
  const keyOf = (p: LonLat) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  while (open.length > 0) {
    const current = open.shift()!;
    let merged = true;
    while (merged && !isClosedLonLatRing(current)) {
      merged = false;
      const tailKey = keyOf(current[current.length - 1]);
      const headKey = keyOf(current[0]);
      for (let i = 0; i < open.length; i++) {
        const cand = open[i];
        const cHead = keyOf(cand[0]);
        const cTail = keyOf(cand[cand.length - 1]);
        if (tailKey === cHead) {
          current.push(...cand.slice(1));
          open.splice(i, 1);
          merged = true;
          break;
        }
        if (tailKey === cTail) {
          const rev = [...cand].reverse();
          current.push(...rev.slice(1));
          open.splice(i, 1);
          merged = true;
          break;
        }
        if (headKey === cTail) {
          current.unshift(...cand.slice(0, -1));
          open.splice(i, 1);
          merged = true;
          break;
        }
        if (headKey === cHead) {
          const rev = [...cand].reverse();
          current.unshift(...rev.slice(0, -1));
          open.splice(i, 1);
          merged = true;
          break;
        }
      }
    }
    if (current.length >= 4 && isClosedLonLatRing(current)) {
      closed.push(current);
    }
  }

  return closed;
}

interface OsmRawElement {
  type: 'node' | 'way' | 'relation' | 'area';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number }>;
  members?: Array<{
    type: string;
    ref: number;
    role?: string;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
  tags?: Record<string, string>;
}

export function parseOsmElements(
  elements: OsmRawElement[],
  sourceLabel: string
): {
  polygons: VectorPolygonFeature[];
  polylines: VectorPolylineFeature[];
  points: VectorPointFeature[];
  enclosingAreas: EnclosingAreaTagFeature[];
} {
  const polygons: VectorPolygonFeature[] = [];
  const polylines: VectorPolylineFeature[] = [];
  const points: VectorPointFeature[] = [];
  const enclosingAreas: EnclosingAreaTagFeature[] = [];

  const nodeCoords = new Map<number, LonLat>();
  const wayCoords = new Map<number, LonLat[]>();

  for (const el of elements) {
    if (el.type === 'node' && typeof el.lon === 'number' && typeof el.lat === 'number') {
      nodeCoords.set(el.id, [el.lon, el.lat]);
    }
  }

  for (const el of elements) {
    if (el.type !== 'way') continue;
    let pts: LonLat[] = [];
    if (Array.isArray(el.geometry) && el.geometry.length > 0) {
      pts = el.geometry.map((g) => [g.lon, g.lat] as LonLat);
    } else if (Array.isArray(el.nodes) && el.nodes.length > 0) {
      pts = el.nodes
        .map((nid) => nodeCoords.get(nid))
        .filter((p): p is LonLat => Boolean(p));
    }
    if (pts.length > 0) {
      wayCoords.set(el.id, pts);
    }
  }

  for (const el of elements) {
    const tags = el.tags;
    if (!tags || Object.keys(tags).length === 0) continue;

    if (el.type === 'area') {
      enclosingAreas.push({
        id: `area/${el.id}`,
        source: sourceLabel,
        tags,
        legalDesignation: tags.protection_title ?? tags.designation ?? null,
        iucnCategory: tags.iucn_level ?? tags.protect_class ?? null,
      });
      continue;
    }

    if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
      points.push({
        id: `node/${el.id}`,
        source: sourceLabel,
        tags,
        lon: el.lon,
        lat: el.lat,
      });
      continue;
    }

    if (el.type === 'way') {
      const pts = wayCoords.get(el.id);
      if (!pts || pts.length < 2) continue;

      if (shouldTreatWayAsPolygon(tags, pts)) {
        polygons.push({
          id: `way/${el.id}`,
          source: sourceLabel,
          tags,
          outerRings: [pts],
          holes: [],
          legalDesignation: tags.protection_title ?? tags.designation ?? null,
          iucnCategory: tags.iucn_level ?? tags.protect_class ?? null,
        });
      } else {
        polylines.push({
          id: `way/${el.id}`,
          source: sourceLabel,
          tags,
          points: pts,
        });
      }
      continue;
    }

    if (el.type === 'relation' && Array.isArray(el.members)) {
      const outerSegs: LonLat[][] = [];
      const innerSegs: LonLat[][] = [];

      for (const m of el.members) {
        if (m.type !== 'way') continue;
        let pts: LonLat[] | undefined;
        if (Array.isArray(m.geometry) && m.geometry.length > 0) {
          pts = m.geometry.map((g) => [g.lon, g.lat] as LonLat);
        } else {
          pts = wayCoords.get(m.ref);
        }
        if (!pts || pts.length < 2) continue;
        if (m.role === 'inner') {
          innerSegs.push(pts);
        } else {
          outerSegs.push(pts);
        }
      }

      const outerRings = stitchOpenWaysToRings(outerSegs);
      const holes = stitchOpenWaysToRings(innerSegs);
      if (outerRings.length > 0) {
        polygons.push({
          id: `relation/${el.id}`,
          source: sourceLabel,
          tags,
          outerRings,
          holes,
          legalDesignation: tags.protection_title ?? tags.designation ?? null,
          iucnCategory: tags.iucn_level ?? tags.protect_class ?? null,
        });
      }
    }
  }

  return { polygons, polylines, points, enclosingAreas };
}

// ============================================================================
// Live External Providers (Overpass + OSM v0.6 + UNEP-WCMC WDPA FeatureServer)
// ============================================================================

async function fetchWithTimeoutHeaders(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...HTTP_HEADERS,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

async function queryOverpass(lat: number, lon: number, radiusMeters: number): Promise<{
  ok: boolean;
  elements: OsmRawElement[];
  error?: string;
}> {
  const r = Math.max(25, Math.min(80, Math.round(radiusMeters)));
  const query = `[out:json][timeout:6];(
    is_in(${lat.toFixed(6)},${lon.toFixed(6)})->.a;
    area.a["landuse"];
    area.a["amenity"];
    area.a["leisure"];
    area.a["historic"];
    area.a["boundary"~"protected_area|national_park"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["building"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["highway"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["railway"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["aeroway"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["historic"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["heritage"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["amenity"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["landuse"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["leisure"];
    nwr(around:${r},${lat.toFixed(6)},${lon.toFixed(6)})["boundary"~"protected_area|national_park"];
  );out tags geom;`;

  let lastError = 'Overpass API indisponible';
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeoutHeaders(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        },
        6000
      );
      if (!res.ok) {
        lastError = `Overpass HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { elements?: OsmRawElement[] };
      if (Array.isArray(json.elements)) {
        return { ok: true, elements: json.elements };
      }
      lastError = 'Réponse Overpass mal formée';
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Erreur réseau Overpass';
    }
  }

  return { ok: false, elements: [], error: lastError };
}

async function queryOsmApi06(lat: number, lon: number): Promise<{
  ok: boolean;
  elements: OsmRawElement[];
  error?: string;
}> {
  const dLat = 0.0007; // ~78m radius box
  const dLon = 0.0007;
  const bbox = `${(lon - dLon).toFixed(5)},${(lat - dLat).toFixed(5)},${(lon + dLon).toFixed(
    5
  )},${(lat + dLat).toFixed(5)}`;
  const url = `${OSM_API_06_BASE}?bbox=${bbox}`;

  try {
    const res = await fetchWithTimeoutHeaders(url, { method: 'GET' }, 6500);
    if (!res.ok) {
      return { ok: false, elements: [], error: `OSM API v0.6 HTTP ${res.status}` };
    }
    const json = (await res.json()) as { elements?: OsmRawElement[] };
    if (!Array.isArray(json.elements)) {
      return { ok: false, elements: [], error: 'Réponse OSM API v0.6 sans éléments' };
    }
    return { ok: true, elements: json.elements };
  } catch (err) {
    return {
      ok: false,
      elements: [],
      error: err instanceof Error ? err.message : 'Erreur réseau OSM API v0.6',
    };
  }
}

interface GeoJsonGeometry {
  type: 'Polygon' | 'MultiPolygon' | 'Point' | 'MultiPoint';
  coordinates: unknown;
}

interface GeoJsonFeature {
  type: 'Feature';
  properties?: Record<string, unknown>;
  geometry?: GeoJsonGeometry | null;
}

async function queryWdpaLayer(
  layerId: 0 | 1,
  lat: number,
  lon: number,
  envelopeDeg: number,
  outFields: string
): Promise<{ ok: boolean; features: GeoJsonFeature[]; error?: string }> {
  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({
      xmin: Number((lon - envelopeDeg).toFixed(6)),
      ymin: Number((lat - envelopeDeg).toFixed(6)),
      xmax: Number((lon + envelopeDeg).toFixed(6)),
      ymax: Number((lat + envelopeDeg).toFixed(6)),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });

  const url = `${WDPA_FEATURE_SERVER_BASE}/${layerId}/query?${params.toString()}`;
  try {
    const res = await fetchWithTimeoutHeaders(url, { method: 'GET' }, 7500);
    if (!res.ok) {
      return { ok: false, features: [], error: `WDPA Layer ${layerId} HTTP ${res.status}` };
    }
    const json = (await res.json()) as {
      features?: GeoJsonFeature[];
      error?: { message?: string };
    };
    if (json.error) {
      return {
        ok: false,
        features: [],
        error: json.error.message || `WDPA Layer ${layerId} erreur`,
      };
    }
    return {
      ok: true,
      features: Array.isArray(json.features) ? json.features : [],
    };
  } catch (err) {
    return {
      ok: false,
      features: [],
      error: err instanceof Error ? err.message : `Erreur réseau WDPA Layer ${layerId}`,
    };
  }
}

export class LiveLandEligibilityProvider implements LandEligibilityDataProvider {
  async fetchLandUseData(
    lat: number,
    lon: number,
    accuracyMeters: number
  ): Promise<LandUseFetchResult> {
    const searchRadius = Math.max(35, Math.min(75, Math.ceil(accuracyMeters + 25)));
    const [overpassRes, osm06Res] = await Promise.all([
      queryOverpass(lat, lon, searchRadius),
      queryOsmApi06(lat, lon),
    ]);

    const polygons: VectorPolygonFeature[] = [];
    const polylines: VectorPolylineFeature[] = [];
    const points: VectorPointFeature[] = [];
    const enclosingAreas: EnclosingAreaTagFeature[] = [];
    const providers: string[] = [];
    const errors: string[] = [];

    if (overpassRes.ok) {
      providers.push('OpenStreetMap (Overpass API)');
      const parsed = parseOsmElements(overpassRes.elements, 'OpenStreetMap (Overpass)');
      polygons.push(...parsed.polygons);
      polylines.push(...parsed.polylines);
      points.push(...parsed.points);
      enclosingAreas.push(...parsed.enclosingAreas);
    } else if (overpassRes.error) {
      errors.push(overpassRes.error);
    }

    if (osm06Res.ok) {
      providers.push('OpenStreetMap (API v0.6)');
      const parsed = parseOsmElements(osm06Res.elements, 'OpenStreetMap (API v0.6)');
      polygons.push(...parsed.polygons);
      polylines.push(...parsed.polylines);
      points.push(...parsed.points);
      enclosingAreas.push(...parsed.enclosingAreas);
    } else if (osm06Res.error) {
      errors.push(osm06Res.error);
    }

    if (providers.length === 0) {
      return {
        ok: false,
        provider: 'OpenStreetMap (Indisponible)',
        polygons: [],
        polylines: [],
        points: [],
        enclosingAreas: [],
        error: errors.join(' | ') || 'Services OpenStreetMap inaccessibles.',
      };
    }

    return {
      ok: true,
      provider: providers.join(' + '),
      polygons,
      polylines,
      points,
      enclosingAreas,
    };
  }

  async fetchProtectedAreaData(
    lat: number,
    lon: number,
    _accuracyMeters: number
  ): Promise<ProtectedAreaFetchResult> {
    const [polyRes, pointRes] = await Promise.all([
      queryWdpaLayer(
        1,
        lat,
        lon,
        0.003,
        'site_id,name,name_eng,desig,desig_eng,desig_type,iucn_cat,status,status_yr,gov_type,mang_auth,iso3'
      ),
      queryWdpaLayer(
        0,
        lat,
        lon,
        0.015,
        'site_id,name,name_eng,desig,desig_eng,desig_type,iucn_cat,status,status_yr,rep_area,iso3'
      ),
    ]);

    if (!polyRes.ok) {
      return {
        ok: false,
        provider: 'WDPA / Protected Planet (Indisponible)',
        polygons: [],
        pointSites: [],
        enclosingAreas: [],
        error: polyRes.error || 'Base WDPA inaccessible.',
      };
    }

    const polygons: VectorPolygonFeature[] = [];
    for (const feat of polyRes.features) {
      const props = feat.properties ?? {};
      const geom = feat.geometry;
      if (!geom) continue;

      const name = String(props.name_eng || props.name || 'Aire protégée WDPA');
      const desig = props.desig_eng ? String(props.desig_eng) : props.desig ? String(props.desig) : null;
      const iucn = props.iucn_cat ? String(props.iucn_cat) : null;
      const status = props.status ? String(props.status) : null;
      const tags: Record<string, string> = {
        boundary: 'protected_area',
        name,
      };
      if (desig) tags.designation = desig;
      if (iucn) tags.iucn_cat = iucn;
      if (status) tags.status = status;

      const outerRings: LonLat[][] = [];
      const holes: LonLat[][] = [];

      if (geom.type === 'Polygon') {
        const rings = geom.coordinates as LonLat[][];
        if (rings[0]) outerRings.push(rings[0]);
        for (let h = 1; h < rings.length; h++) holes.push(rings[h]);
      } else if (geom.type === 'MultiPolygon') {
        const polys = geom.coordinates as LonLat[][][];
        for (const poly of polys) {
          if (poly[0]) outerRings.push(poly[0]);
          for (let h = 1; h < poly.length; h++) holes.push(poly[h]);
        }
      }

      if (outerRings.length > 0) {
        polygons.push({
          id: `wdpa/${props.site_id ?? polygons.length}`,
          source: 'WDPA (Protected Planet / UNEP-WCMC)',
          tags,
          outerRings,
          holes,
          legalDesignation: desig,
          iucnCategory: iucn,
          legalStatus: status,
        });
      }
    }

    const pointSites: VectorPointFeature[] = [];
    if (pointRes.ok) {
      for (const feat of pointRes.features) {
        const props = feat.properties ?? {};
        const geom = feat.geometry;
        if (!geom) continue;
        let coords: LonLat | null = null;
        if (geom.type === 'Point') {
          coords = geom.coordinates as LonLat;
        } else if (geom.type === 'MultiPoint') {
          const arr = geom.coordinates as LonLat[];
          coords = arr[0] ?? null;
        }
        if (!coords) continue;

        const name = String(props.name_eng || props.name || 'Site protégé WDPA');
        const repAreaKm2 =
          typeof props.rep_area === 'number' && props.rep_area > 0 ? props.rep_area : null;
        const approxRadiusMeters = repAreaKm2
          ? Math.max(250, Math.min(15_000, Math.sqrt(repAreaKm2 / Math.PI) * 1000))
          : 500;

        pointSites.push({
          id: `wdpa-pt/${props.site_id ?? pointSites.length}`,
          source: 'WDPA (Protected Planet / UNEP-WCMC)',
          tags: {
            boundary: 'protected_area',
            name,
          },
          lon: coords[0],
          lat: coords[1],
          approxRadiusMeters,
          legalDesignation: props.desig_eng
            ? String(props.desig_eng)
            : props.desig
            ? String(props.desig)
            : null,
          iucnCategory: props.iucn_cat ? String(props.iucn_cat) : null,
          legalStatus: props.status ? String(props.status) : null,
          missingBoundary: true,
        });
      }
    }

    return {
      ok: true,
      provider: 'WDPA / UNEP-WCMC (Protected Planet)',
      polygons,
      pointSites,
      enclosingAreas: [],
    };
  }
}

// ============================================================================
// Feature Categorization & Eligibility Classification
// ============================================================================

interface ClassifiedTagMatch {
  category: GeoFeatureCategory;
  reasonCode: LandEligibilityReasonCode;
  label: string;
}

function classifyNonProtectedOsmTags(tags: Record<string, string>): ClassifiedTagMatch | null {
  if (tags.building && tags.building !== 'no') {
    return {
      category: 'building',
      reasonCode: 'BUILDING',
      label: tags.amenity === 'place_of_worship'
        ? 'Lieu de culte / Bâtiment'
        : `Bâtiment (${tags.building === 'yes' ? 'structure bâtie' : tags.building})`,
    };
  }

  if (tags.historic || tags.heritage || tags.amenity === 'place_of_worship') {
    return {
      category: 'monument',
      reasonCode: 'MONUMENT_OR_HERITAGE',
      label:
        tags.amenity === 'place_of_worship'
          ? 'Lieu de culte'
          : `Monument / Patrimoine (${tags.historic || tags.heritage})`,
    };
  }

  if (tags.aeroway && tags.aeroway !== 'no') {
    return {
      category: 'road',
      reasonCode: 'ROAD_OR_TRANSPORT',
      label: `Infrastructure aéronautique (${tags.aeroway})`,
    };
  }

  if (tags.railway && tags.railway !== 'no') {
    return {
      category: 'road',
      reasonCode: 'ROAD_OR_TRANSPORT',
      label: `Voie ferrée (${tags.railway})`,
    };
  }

  if (tags.highway && !NON_ROAD_HIGHWAY_VALUES.has(tags.highway)) {
    return {
      category: 'road',
      reasonCode: 'ROAD_OR_TRANSPORT',
      label: `Route / Voie de transport (${tags.highway})`,
    };
  }

  if (tags.landuse && URBAN_LANDUSE_VALUES.has(tags.landuse)) {
    return {
      category: 'urban',
      reasonCode: 'URBAN_OR_INDUSTRIAL',
      label: `Zone non agricole (${tags.landuse})`,
    };
  }

  if (tags.leisure && NON_AG_LEISURE_VALUES.has(tags.leisure)) {
    return {
      category: 'public_facility',
      reasonCode: 'PUBLIC_FACILITY',
      label: `Équipement de loisir / public (${tags.leisure})`,
    };
  }

  if (tags.amenity && NON_AG_AMENITY_VALUES.has(tags.amenity)) {
    return {
      category: 'public_facility',
      reasonCode: 'PUBLIC_FACILITY',
      label: `Équipement public (${tags.amenity})`,
    };
  }

  if (tags.landuse && AGRICULTURAL_CONTEXT_LANDUSE.has(tags.landuse)) {
    return {
      category: 'farmland_context',
      reasonCode: 'PRELIMINARY_ELIGIBLE',
      label: `Usage agricole cartographié (${tags.landuse})`,
    };
  }

  return null;
}

function getNotSuitableMessage(reasonCode: LandEligibilityReasonCode, feature: MatchedGeoFeature): string {
  if (reasonCode === 'BUILDING') {
    return ELIGIBILITY_MESSAGES.BUILDING;
  }
  if (reasonCode === 'ROAD_OR_TRANSPORT') {
    return ELIGIBILITY_MESSAGES.ROAD;
  }
  const featureName = feature.name ? ` (« ${feature.name} »)` : '';
  if (reasonCode === 'MONUMENT_OR_HERITAGE') {
    return `Attention : les coordonnées sélectionnées correspondent à un monument, un site patrimonial ou un lieu de culte${featureName}. Les cultures agricoles ne sont pas autorisées à cet emplacement.`;
  }
  if (reasonCode === 'URBAN_OR_INDUSTRIAL') {
    return `Attention : cette position se situe dans une zone urbaine, résidentielle, commerciale ou industrielle cartographiée (${feature.label}${featureName}). Veuillez sélectionner votre terrain agricole.`;
  }
  return `Attention : cette position correspond à un équipement public ou une zone non agricole (${feature.label}${featureName}). Veuillez sélectionner votre parcelle agricole.`;
}

function deduplicateMatches(features: MatchedGeoFeature[]): MatchedGeoFeature[] {
  const seen = new Set<string>();
  const out: MatchedGeoFeature[] = [];
  for (const f of features) {
    const key = `${f.category}|${f.label}|${f.name ?? ''}|${Math.round(f.distanceMeters)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function evaluateLandEligibilityFromGeoData(params: {
  lat: number;
  lon: number;
  gpsAccuracyMeters: number;
  landUse: LandUseFetchResult;
  protectedAreas: ProtectedAreaFetchResult;
  territoire?: string | null;
}): LandEligibilityReport {
  const { lat, lon, gpsAccuracyMeters, landUse, protectedAreas } = params;
  const territoire = params.territoire ?? findSudKivuTerritory(lat, lon) ?? 'Sud-Kivu';
  const checkedAtIso = new Date().toISOString();

  const errors: string[] = [];
  if (!landUse.ok && landUse.error) errors.push(landUse.error);
  if (!protectedAreas.ok && protectedAreas.error) errors.push(protectedAreas.error);

  const protectedMatches: MatchedGeoFeature[] = [];
  const notSuitableCenterMatches: Array<{ reasonCode: LandEligibilityReasonCode; feature: MatchedGeoFeature }> = [];
  const uncertaintyOverlapMatches: MatchedGeoFeature[] = [];
  const positiveContextMatches: MatchedGeoFeature[] = [];
  let hasMissingProtectedBoundaryOverlap = false;

  // 1. Evaluate Protected Areas (WDPA polygons + OSM protected polygons + enclosing areas)
  const allProtectedPolygons: VectorPolygonFeature[] = [
    ...protectedAreas.polygons,
    ...landUse.polygons.filter((p) => isProtectedTags(p.tags)),
  ];

  for (const poly of allProtectedPolygons) {
    const { inside, edgeDistanceMeters } = analyzePointVsPolygonMeters(
      lat,
      lon,
      poly.outerRings,
      poly.holes
    );
    const overlapsCircle = inside || edgeDistanceMeters <= gpsAccuracyMeters;
    if (!overlapsCircle) continue;

    protectedMatches.push({
      source: poly.source,
      category: 'protected_area',
      label: poly.legalDesignation || 'Zone protégée / Aire de conservation',
      name: poly.tags.name || poly.tags.name_eng || null,
      tags: poly.tags,
      legalDesignation: poly.legalDesignation ?? null,
      iucnCategory: poly.iucnCategory ?? null,
      legalStatus: poly.legalStatus ?? null,
      distanceMeters: Number(edgeDistanceMeters.toFixed(1)),
      overlapsCenterPoint: inside,
      overlapsUncertaintyCircle: overlapsCircle,
    });
  }

  for (const area of [...protectedAreas.enclosingAreas, ...landUse.enclosingAreas]) {
    if (!isProtectedTags(area.tags)) continue;
    protectedMatches.push({
      source: area.source,
      category: 'protected_area',
      label: area.legalDesignation || 'Zone protégée / Parc national',
      name: area.tags.name || null,
      tags: area.tags,
      legalDesignation: area.legalDesignation ?? null,
      iucnCategory: area.iucnCategory ?? null,
      legalStatus: area.legalStatus ?? null,
      distanceMeters: 0,
      overlapsCenterPoint: true,
      overlapsUncertaintyCircle: true,
    });
  }

  for (const pt of protectedAreas.pointSites) {
    const dist = distanceBetweenPointsMeters(lat, lon, pt.lat, pt.lon);
    const radius = pt.approxRadiusMeters ?? 500;
    if (dist <= radius + gpsAccuracyMeters) {
      hasMissingProtectedBoundaryOverlap = true;
      protectedMatches.push({
        source: pt.source,
        category: 'protected_area',
        label: pt.legalDesignation
          ? `${pt.legalDesignation} (limite exacte non tracée)`
          : 'Aire protégée sans polygone officiel',
        name: pt.tags.name || null,
        tags: pt.tags,
        legalDesignation: pt.legalDesignation ?? null,
        iucnCategory: pt.iucnCategory ?? null,
        legalStatus: pt.legalStatus ?? null,
        distanceMeters: Number(dist.toFixed(1)),
        overlapsCenterPoint: false,
        overlapsUncertaintyCircle: true,
      });
    }
  }

  // 2. Evaluate OSM Polygons (buildings, urban zones, monuments, public facilities, farmland context)
  for (const poly of landUse.polygons) {
    if (isProtectedTags(poly.tags)) continue;
    const classified = classifyNonProtectedOsmTags(poly.tags);
    if (!classified) continue;

    const { inside, edgeDistanceMeters } = analyzePointVsPolygonMeters(
      lat,
      lon,
      poly.outerRings,
      poly.holes
    );
    const overlapsCircle = inside || edgeDistanceMeters <= gpsAccuracyMeters;

    if (classified.category === 'farmland_context') {
      if (overlapsCircle) {
        positiveContextMatches.push({
          source: poly.source,
          category: 'farmland_context',
          label: classified.label,
          name: poly.tags.name || null,
          tags: poly.tags,
          distanceMeters: Number(edgeDistanceMeters.toFixed(1)),
          overlapsCenterPoint: inside,
          overlapsUncertaintyCircle: overlapsCircle,
        });
      }
      continue;
    }

    if (!overlapsCircle) continue;

    const match: MatchedGeoFeature = {
      source: poly.source,
      category: classified.category,
      label: classified.label,
      name: poly.tags.name || null,
      tags: poly.tags,
      distanceMeters: Number(edgeDistanceMeters.toFixed(1)),
      overlapsCenterPoint: inside,
      overlapsUncertaintyCircle: overlapsCircle,
    };

    if (inside) {
      notSuitableCenterMatches.push({ reasonCode: classified.reasonCode, feature: match });
    } else {
      uncertaintyOverlapMatches.push(match);
    }
  }

  // Enclosing OSM areas (from Overpass is_in)
  for (const area of landUse.enclosingAreas) {
    if (isProtectedTags(area.tags)) continue;
    const classified = classifyNonProtectedOsmTags(area.tags);
    if (!classified) continue;

    const match: MatchedGeoFeature = {
      source: area.source,
      category: classified.category,
      label: classified.label,
      name: area.tags.name || null,
      tags: area.tags,
      distanceMeters: 0,
      overlapsCenterPoint: true,
      overlapsUncertaintyCircle: true,
    };

    if (classified.category === 'farmland_context') {
      positiveContextMatches.push(match);
    } else {
      notSuitableCenterMatches.push({ reasonCode: classified.reasonCode, feature: match });
    }
  }

  // 3. Evaluate OSM Polylines (roads, railways, runways)
  for (const line of landUse.polylines) {
    const classified = classifyNonProtectedOsmTags(line.tags);
    if (!classified || classified.category === 'farmland_context') continue;

    const dist = distancePointToPolylineMeters(lat, lon, line.points);
    const halfWidth = getHighwayHalfWidthMeters(line.tags);
    const overlapsCenter = dist <= halfWidth;
    const overlapsCircle = dist <= halfWidth + gpsAccuracyMeters;

    if (!overlapsCircle) continue;

    const match: MatchedGeoFeature = {
      source: line.source,
      category: classified.category,
      label: classified.label,
      name: line.tags.name || line.tags.ref || null,
      tags: line.tags,
      distanceMeters: Number(dist.toFixed(1)),
      overlapsCenterPoint: overlapsCenter,
      overlapsUncertaintyCircle: overlapsCircle,
    };

    if (overlapsCenter) {
      notSuitableCenterMatches.push({ reasonCode: classified.reasonCode, feature: match });
    } else {
      uncertaintyOverlapMatches.push(match);
    }
  }

  // 4. Evaluate OSM Point Nodes (only when point or uncertainty circle genuinely intersects node footprint)
  for (const pt of landUse.points) {
    if (isProtectedTags(pt.tags)) continue;
    if (pt.tags.highway && IGNORED_HIGHWAY_POINT_NODES.has(pt.tags.highway)) continue;
    const classified = classifyNonProtectedOsmTags(pt.tags);
    if (!classified || classified.category === 'farmland_context') continue;

    const dist = distanceBetweenPointsMeters(lat, lon, pt.lat, pt.lon);
    const nodeFootprint =
      pt.tags.highway === 'crossing' || pt.tags.highway === 'bus_stop' ? 2.0 : 4.0;
    const overlapsCenter = dist <= nodeFootprint;
    const overlapsCircle = dist <= nodeFootprint + gpsAccuracyMeters;

    if (!overlapsCircle) continue;

    const match: MatchedGeoFeature = {
      source: pt.source,
      category: classified.category,
      label: classified.label,
      name: pt.tags.name || null,
      tags: pt.tags,
      distanceMeters: Number(dist.toFixed(1)),
      overlapsCenterPoint: overlapsCenter,
      overlapsUncertaintyCircle: overlapsCircle,
    };

    if (overlapsCenter) {
      notSuitableCenterMatches.push({ reasonCode: classified.reasonCode, feature: match });
    } else {
      uncertaintyOverlapMatches.push(match);
    }
  }

  const baseSources = {
    landUseService: landUse.ok ? ('OK' as const) : ('UNAVAILABLE' as const),
    landUseProvider: landUse.provider,
    protectedAreaService: protectedAreas.ok ? ('OK' as const) : ('UNAVAILABLE' as const),
    protectedAreaProvider: protectedAreas.provider,
    errors: errors.length > 0 ? errors : undefined,
  };

  // Priority A: Protected area with center point strictly inside -> PROTECTED_OR_RESTRICTED
  const protectedInside = protectedMatches.find((m) => m.overlapsCenterPoint);
  if (protectedInside) {
    return {
      status: 'PROTECTED_OR_RESTRICTED',
      statusLabel: 'Zone protégée ou restreinte',
      reasonCode: 'PROTECTED_AREA',
      eligibleForAnalysis: false,
      requiresVerification: false,
      userMessage: ELIGIBILITY_MESSAGES.PROTECTED,
      authorityGuidance: ELIGIBILITY_MESSAGES.AUTHORITY_GUIDANCE,
      limitationsNote: ELIGIBILITY_MESSAGES.LIMITATIONS_NOTE,
      gpsAccuracyMeters,
      checkedAtIso,
      territoire,
      matchedFeatures: deduplicateMatches([...protectedMatches, ...uncertaintyOverlapMatches]),
      sources: baseSources,
    };
  }

  // Priority B: Center point falls inside a non-agricultural footprint -> NOT_SUITABLE
  if (notSuitableCenterMatches.length > 0) {
    const priorityOrder: LandEligibilityReasonCode[] = [
      'BUILDING',
      'MONUMENT_OR_HERITAGE',
      'ROAD_OR_TRANSPORT',
      'PUBLIC_FACILITY',
      'URBAN_OR_INDUSTRIAL',
    ];
    notSuitableCenterMatches.sort(
      (a, b) => priorityOrder.indexOf(a.reasonCode) - priorityOrder.indexOf(b.reasonCode)
    );
    const primary = notSuitableCenterMatches[0];

    return {
      status: 'NOT_SUITABLE',
      statusLabel: 'Non adapté à l’agriculture',
      reasonCode: primary.reasonCode,
      eligibleForAnalysis: false,
      requiresVerification: false,
      userMessage: getNotSuitableMessage(primary.reasonCode, primary.feature),
      authorityGuidance: null,
      limitationsNote: ELIGIBILITY_MESSAGES.LIMITATIONS_NOTE,
      gpsAccuracyMeters,
      checkedAtIso,
      territoire,
      matchedFeatures: deduplicateMatches([
        ...notSuitableCenterMatches.map((x) => x.feature),
        ...uncertaintyOverlapMatches,
      ]),
      sources: baseSources,
    };
  }

  // Priority C: Protected boundary uncertainty overlap or missing polygon boundary -> UNKNOWN (requires verification)
  if (protectedMatches.length > 0 || hasMissingProtectedBoundaryOverlap) {
    const nearest = protectedMatches[0];
    const parkLabel = nearest?.name ? `« ${nearest.name} »` : 'une zone protégée';
    const detail = hasMissingProtectedBoundaryOverlap
      ? `Le point GPS se trouve à proximité d’une aire protégée sans polygone délimité (${parkLabel}).`
      : `Le rayon d’incertitude GPS (±${gpsAccuracyMeters.toFixed(
          1
        )} m) chevauche la limite de ${parkLabel} (située à ${nearest.distanceMeters} m).`;

    return {
      status: 'UNKNOWN',
      statusLabel: 'Données insuffisantes / À vérifier',
      reasonCode: hasMissingProtectedBoundaryOverlap
        ? 'MISSING_PROTECTED_BOUNDARY'
        : 'BOUNDARY_UNCERTAINTY_OVERLAP',
      eligibleForAnalysis: false,
      requiresVerification: true,
      userMessage: `${detail} Vérification officielle requise avant toute recommandation agricole.`,
      authorityGuidance: ELIGIBILITY_MESSAGES.AUTHORITY_GUIDANCE,
      limitationsNote: ELIGIBILITY_MESSAGES.LIMITATIONS_NOTE,
      gpsAccuracyMeters,
      checkedAtIso,
      territoire,
      matchedFeatures: deduplicateMatches([...protectedMatches, ...uncertaintyOverlapMatches]),
      sources: baseSources,
    };
  }

  // Priority D: GPS uncertainty circle overlaps non-agricultural infrastructure -> UNKNOWN (requires verification)
  if (uncertaintyOverlapMatches.length > 0) {
    const first = uncertaintyOverlapMatches[0];
    const featureTitle = first.name ? `${first.label} (« ${first.name} »)` : first.label;
    return {
      status: 'UNKNOWN',
      statusLabel: 'Données insuffisantes / À vérifier',
      reasonCode: 'BOUNDARY_UNCERTAINTY_OVERLAP',
      eligibleForAnalysis: false,
      requiresVerification: true,
      userMessage: `Votre cercle d’incertitude GPS (±${gpsAccuracyMeters.toFixed(
        1
      )} m) chevauche une emprise non agricole (${featureTitle} à ${
        first.distanceMeters
      } m). Déplacez-vous à l’intérieur de votre parcelle cultivée et actualisez le GPS.`,
      authorityGuidance: null,
      limitationsNote: ELIGIBILITY_MESSAGES.LIMITATIONS_NOTE,
      gpsAccuracyMeters,
      checkedAtIso,
      territoire,
      matchedFeatures: deduplicateMatches(uncertaintyOverlapMatches),
      sources: baseSources,
    };
  }

  // Priority E: Required external service unavailable -> UNKNOWN (NEVER silently assume suitable!)
  if (!landUse.ok || !protectedAreas.ok) {
    return {
      status: 'UNKNOWN',
      statusLabel: 'Données insuffisantes / À vérifier',
      reasonCode: 'DATA_UNAVAILABLE',
      eligibleForAnalysis: false,
      requiresVerification: true,
      userMessage: ELIGIBILITY_MESSAGES.UNKNOWN,
      authorityGuidance: null,
      limitationsNote: ELIGIBILITY_MESSAGES.LIMITATIONS_NOTE,
      gpsAccuracyMeters,
      checkedAtIso,
      territoire,
      matchedFeatures: deduplicateMatches(positiveContextMatches),
      sources: baseSources,
    };
  }

  // Priority F: Both land-use & protected-area services succeeded with zero conflicts -> POTENTIALLY_SUITABLE
  return {
    status: 'POTENTIALLY_SUITABLE',
    statusLabel: 'Potentiellement adapté à l’agriculture',
    reasonCode: 'PRELIMINARY_ELIGIBLE',
    eligibleForAnalysis: true,
    requiresVerification: false,
    userMessage: ELIGIBILITY_MESSAGES.POTENTIALLY_SUITABLE,
    authorityGuidance: null,
    limitationsNote: ELIGIBILITY_MESSAGES.LIMITATIONS_NOTE,
    gpsAccuracyMeters,
    checkedAtIso,
    territoire,
    matchedFeatures: deduplicateMatches(positiveContextMatches),
    sources: baseSources,
  };
}

// ============================================================================
// Server-side Cached Verification Orchestrator
// ============================================================================

interface CachedGeoBundle {
  expiresAt: number;
  landUse: LandUseFetchResult;
  protectedAreas: ProtectedAreaFetchResult;
}

const geoBundleCache = new Map<string, CachedGeoBundle>();
const GEO_CACHE_TTL_MS = 20 * 60 * 1000;
const defaultProvider = new LiveLandEligibilityProvider();

export async function verifyLandEligibility(params: {
  lat: number;
  lon: number;
  gpsAccuracyMeters: number;
  territoire?: string | null;
  provider?: LandEligibilityDataProvider;
  bypassCache?: boolean;
}): Promise<LandEligibilityReport> {
  const { lat, lon, gpsAccuracyMeters, territoire, provider, bypassCache } = params;
  const activeProvider = provider ?? defaultProvider;

  // Use cache only for default live provider (never pollute cache during test mocks)
  const useCache = !provider && !bypassCache;
  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;

  let landUse: LandUseFetchResult;
  let protectedAreas: ProtectedAreaFetchResult;

  const cached = useCache ? geoBundleCache.get(cacheKey) : undefined;
  if (cached && cached.expiresAt > Date.now()) {
    landUse = cached.landUse;
    protectedAreas = cached.protectedAreas;
  } else {
    [landUse, protectedAreas] = await Promise.all([
      activeProvider.fetchLandUseData(lat, lon, gpsAccuracyMeters),
      activeProvider.fetchProtectedAreaData(lat, lon, gpsAccuracyMeters),
    ]);

    // Only cache when BOTH external verification services responded cleanly
    if (useCache && landUse.ok && protectedAreas.ok) {
      if (geoBundleCache.size > 500) {
        const oldestKey = geoBundleCache.keys().next().value;
        if (oldestKey) geoBundleCache.delete(oldestKey);
      }
      geoBundleCache.set(cacheKey, {
        expiresAt: Date.now() + GEO_CACHE_TTL_MS,
        landUse,
        protectedAreas,
      });
    }
  }

  return evaluateLandEligibilityFromGeoData({
    lat,
    lon,
    gpsAccuracyMeters,
    landUse,
    protectedAreas,
    territoire,
  });
}
