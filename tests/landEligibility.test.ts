import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  ELIGIBILITY_MESSAGES,
  evaluateLandEligibilityFromGeoData,
  parseOsmElements,
  type LandEligibilityDataProvider,
  type LandUseFetchResult,
  type ProtectedAreaFetchResult,
} from '../src/utils/landEligibility.ts';
import { createApp } from '../server.ts';

function squareRing(centerLon: number, centerLat: number, halfWidthDeg: number, halfHeightDeg: number) {
  return [
    [centerLon - halfWidthDeg, centerLat - halfHeightDeg] as const,
    [centerLon + halfWidthDeg, centerLat - halfHeightDeg] as const,
    [centerLon + halfWidthDeg, centerLat + halfHeightDeg] as const,
    [centerLon - halfWidthDeg, centerLat + halfHeightDeg] as const,
    [centerLon - halfWidthDeg, centerLat - halfHeightDeg] as const,
  ];
}

function emptyLandUse(): LandUseFetchResult {
  return {
    ok: true,
    provider: 'OpenStreetMap (Mock)',
    polygons: [],
    polylines: [],
    points: [],
    enclosingAreas: [],
  };
}

function emptyProtected(): ProtectedAreaFetchResult {
  return {
    ok: true,
    provider: 'WDPA / UNEP-WCMC (Mock)',
    polygons: [],
    pointSites: [],
    enclosingAreas: [],
  };
}

// Coordinate inside Kabare rural Sud-Kivu
const KABARE_LAT = -2.4333;
const KABARE_LON = 28.8000;

test('Case 1 & 2: Building and Road coordinates classify as NOT_SUITABLE while nearby farmland (> distance) is NOT falsely rejected', () => {
  // Case 1: Building footprint enclosing GPS center point
  const buildingLandUse = emptyLandUse();
  buildingLandUse.polygons.push({
    id: 'way/101',
    source: 'OpenStreetMap (API v0.6)',
    tags: { building: 'yes', name: 'Entrepôt Kabare' },
    outerRings: [squareRing(KABARE_LON, KABARE_LAT, 0.00015, 0.00015)],
    holes: [],
  });

  const buildingRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 5.0,
    landUse: buildingLandUse,
    protectedAreas: emptyProtected(),
  });
  assert.equal(buildingRes.status, 'NOT_SUITABLE');
  assert.equal(buildingRes.reasonCode, 'BUILDING');
  assert.equal(buildingRes.eligibleForAnalysis, false);
  assert.equal(buildingRes.userMessage, ELIGIBILITY_MESSAGES.BUILDING);

  // Nearby building 40 meters away MUST NOT reject an agricultural parcel
  const nearbyBuildingLandUse = emptyLandUse();
  nearbyBuildingLandUse.polygons.push({
    id: 'way/102',
    source: 'OpenStreetMap (API v0.6)',
    tags: { building: 'yes' },
    // ~45 meters north of KABARE_LAT
    outerRings: [squareRing(KABARE_LON, KABARE_LAT + 0.00042, 0.00005, 0.00005)],
    holes: [],
  });
  const nearbyFieldRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 6.0,
    landUse: nearbyBuildingLandUse,
    protectedAreas: emptyProtected(),
  });
  assert.equal(nearbyFieldRes.status, 'POTENTIALLY_SUITABLE');
  assert.equal(nearbyFieldRes.eligibleForAnalysis, true);

  // Case 2: Road polyline passing directly under GPS point
  const roadLandUse = emptyLandUse();
  roadLandUse.polylines.push({
    id: 'way/201',
    source: 'OpenStreetMap (API v0.6)',
    tags: { highway: 'secondary', name: 'RN2' },
    points: [
      [KABARE_LON - 0.001, KABARE_LAT],
      [KABARE_LON + 0.001, KABARE_LAT],
    ],
  });
  const roadRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 4.5,
    landUse: roadLandUse,
    protectedAreas: emptyProtected(),
  });
  assert.equal(roadRes.status, 'NOT_SUITABLE');
  assert.equal(roadRes.reasonCode, 'ROAD_OR_TRANSPORT');
  assert.equal(roadRes.eligibleForAnalysis, false);
  assert.equal(roadRes.userMessage, ELIGIBILITY_MESSAGES.ROAD);
});

test('Case 3 & 4: Protected areas (Kahuzi-Biega) and urban/industrial zones block recommendations', () => {
  // Case 3: Inside Kahuzi-Biega National Park polygon
  const kahuziLat = -2.28;
  const kahuziLon = 28.70;
  const protectedData = emptyProtected();
  protectedData.polygons.push({
    id: 'wdpa/1082',
    source: 'WDPA (Protected Planet / UNEP-WCMC)',
    tags: { boundary: 'national_park', name: 'Kahuzi-Biega' },
    outerRings: [squareRing(kahuziLon, kahuziLat, 0.05, 0.05)],
    holes: [],
    legalDesignation: 'National Park',
    iucnCategory: 'II',
    legalStatus: 'Designated',
  });

  const parkRes = evaluateLandEligibilityFromGeoData({
    lat: kahuziLat,
    lon: kahuziLon,
    gpsAccuracyMeters: 5.5,
    landUse: emptyLandUse(),
    protectedAreas: protectedData,
  });
  assert.equal(parkRes.status, 'PROTECTED_OR_RESTRICTED');
  assert.equal(parkRes.reasonCode, 'PROTECTED_AREA');
  assert.equal(parkRes.eligibleForAnalysis, false);
  assert.equal(parkRes.userMessage, ELIGIBILITY_MESSAGES.PROTECTED);
  assert.ok(parkRes.authorityGuidance);
  assert.equal(parkRes.matchedFeatures[0]?.iucnCategory, 'II');

  // Case 4: Urban / industrial area (landuse=industrial)
  const industrialLandUse = emptyLandUse();
  industrialLandUse.polygons.push({
    id: 'way/301',
    source: 'OpenStreetMap (Overpass)',
    tags: { landuse: 'industrial', name: 'Zone Industrielle de Bagira' },
    outerRings: [squareRing(KABARE_LON, KABARE_LAT, 0.002, 0.002)],
    holes: [],
  });
  const indRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 5.0,
    landUse: industrialLandUse,
    protectedAreas: emptyProtected(),
  });
  assert.equal(indRes.status, 'NOT_SUITABLE');
  assert.equal(indRes.reasonCode, 'URBAN_OR_INDUSTRIAL');
  assert.equal(indRes.eligibleForAnalysis, false);
});

test('Case 5: Suitable agricultural field returns POTENTIALLY_SUITABLE with disclaimer and confirmation prompt', () => {
  const farmLandUse = emptyLandUse();
  farmLandUse.polygons.push({
    id: 'way/401',
    source: 'OpenStreetMap (API v0.6)',
    tags: { landuse: 'farmland' },
    outerRings: [squareRing(KABARE_LON, KABARE_LAT, 0.003, 0.003)],
    holes: [],
  });

  const res = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 4.0,
    landUse: farmLandUse,
    protectedAreas: emptyProtected(),
  });
  assert.equal(res.status, 'POTENTIALLY_SUITABLE');
  assert.equal(res.eligibleForAnalysis, true);
  assert.equal(res.userMessage, ELIGIBILITY_MESSAGES.POTENTIALLY_SUITABLE);
  assert.ok(res.limitationsNote.includes('OpenStreetMap'));
});

test('Case 6 & 7: Unavailable land-use or protected-area service classifies as UNKNOWN and blocks recommendations', () => {
  // Case 6: Land-use service unavailable
  const noOsmRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 4.0,
    landUse: { ...emptyLandUse(), ok: false, error: 'Overpass timeout' },
    protectedAreas: emptyProtected(),
  });
  assert.equal(noOsmRes.status, 'UNKNOWN');
  assert.equal(noOsmRes.reasonCode, 'DATA_UNAVAILABLE');
  assert.equal(noOsmRes.eligibleForAnalysis, false);
  assert.equal(noOsmRes.userMessage, ELIGIBILITY_MESSAGES.UNKNOWN);

  // Case 7: Protected-area service unavailable
  const noWdpaRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 4.0,
    landUse: emptyLandUse(),
    protectedAreas: { ...emptyProtected(), ok: false, error: 'WDPA HTTP 503' },
  });
  assert.equal(noWdpaRes.status, 'UNKNOWN');
  assert.equal(noWdpaRes.reasonCode, 'DATA_UNAVAILABLE');
  assert.equal(noWdpaRes.eligibleForAnalysis, false);
  assert.equal(noWdpaRes.userMessage, ELIGIBILITY_MESSAGES.UNKNOWN);
});

test('Case 10: GPS point near protected boundary with overlapping uncertainty radius requires verification', () => {
  // Protected area ends at KABARE_LAT - 0.00004 (~4.4 m south of our GPS point)
  // GPS accuracy is 8.0 m -> uncertainty circle overlaps the protected boundary!
  const boundaryEdgeLat = KABARE_LAT - 0.00004;
  const protectedData = emptyProtected();
  protectedData.polygons.push({
    id: 'wdpa/1082',
    source: 'WDPA (Protected Planet / UNEP-WCMC)',
    tags: { boundary: 'national_park', name: 'Kahuzi-Biega' },
    outerRings: [
      [
        [KABARE_LON - 0.01, boundaryEdgeLat - 0.01],
        [KABARE_LON + 0.01, boundaryEdgeLat - 0.01],
        [KABARE_LON + 0.01, boundaryEdgeLat],
        [KABARE_LON - 0.01, boundaryEdgeLat],
        [KABARE_LON - 0.01, boundaryEdgeLat - 0.01],
      ],
    ],
    holes: [],
    legalDesignation: 'National Park',
    iucnCategory: 'II',
    legalStatus: 'Designated',
  });

  const nearOverlapRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 8.0,
    landUse: emptyLandUse(),
    protectedAreas: protectedData,
  });
  assert.equal(nearOverlapRes.status, 'UNKNOWN');
  assert.equal(nearOverlapRes.reasonCode, 'BOUNDARY_UNCERTAINTY_OVERLAP');
  assert.equal(nearOverlapRes.requiresVerification, true);
  assert.equal(nearOverlapRes.eligibleForAnalysis, false);

  // When GPS accuracy improves to 2.0 m (less than 4.4 m distance to boundary), no overlap occurs
  const clearMarginRes = evaluateLandEligibilityFromGeoData({
    lat: KABARE_LAT,
    lon: KABARE_LON,
    gpsAccuracyMeters: 2.0,
    landUse: emptyLandUse(),
    protectedAreas: protectedData,
  });
  assert.equal(clearMarginRes.status, 'POTENTIALLY_SUITABLE');
  assert.equal(clearMarginRes.eligibleForAnalysis, true);
});

test('OSM 0.6 parser resolves node coordinates into building polygons and highway polylines', () => {
  const parsed = parseOsmElements(
    [
      { type: 'node', id: 1, lat: -2.5, lon: 28.85 },
      { type: 'node', id: 2, lat: -2.5, lon: 28.8501 },
      { type: 'node', id: 3, lat: -2.5001, lon: 28.8501 },
      { type: 'node', id: 4, lat: -2.5001, lon: 28.85 },
      { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes' } },
      { type: 'node', id: 5, lat: -2.5002, lon: 28.85 },
      { type: 'node', id: 6, lat: -2.5002, lon: 28.8502 },
      { type: 'way', id: 20, nodes: [5, 6], tags: { highway: 'residential' } },
    ],
    'OpenStreetMap (API v0.6)'
  );
  assert.equal(parsed.polygons.length, 1);
  assert.equal(parsed.polygons[0].tags.building, 'yes');
  assert.equal(parsed.polylines.length, 1);
  assert.equal(parsed.polylines[0].tags.highway, 'residential');
});

test('Case 8 & 9: Backend API enforces GPS < 10m first, then blocks ineligible land on /api/verifier-eligibilite, /api/analyser-satellites, and /api/recommander', async () => {
  let mode: 'building' | 'unavailable_wdpa' | 'eligible' = 'building';

  const testProvider: LandEligibilityDataProvider = {
    fetchLandUseData: async () => {
      const lu = emptyLandUse();
      if (mode === 'building') {
        lu.polygons.push({
          id: 'way/999',
          source: 'OpenStreetMap (API v0.6)',
          tags: { building: 'yes' },
          outerRings: [squareRing(KABARE_LON, KABARE_LAT, 0.0002, 0.0002)],
          holes: [],
        });
      }
      return lu;
    },
    fetchProtectedAreaData: async () => {
      if (mode === 'unavailable_wdpa') {
        return { ...emptyProtected(), ok: false, error: 'WDPA indisponible' };
      }
      return emptyProtected();
    },
  };

  const app = createApp({ eligibilityProvider: testProvider });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Case 8: GPS accuracy = 15.1 m rejected before eligibility check
    const tooInaccurateRes = await fetch(`${baseUrl}/api/verifier-eligibilite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: KABARE_LAT, lon: KABARE_LON, gps_accuracy_m: 15.1 }),
    });
    assert.equal(tooInaccurateRes.status, 400);
    const tooInaccurateJson = (await tooInaccurateRes.json()) as { code?: string };
    assert.equal(tooInaccurateJson.code, 'INSUFFICIENT_ACCURACY');

    // Case 9a: GPS < 10 m on building -> /api/verifier-eligibilite returns NOT_SUITABLE, /api/recommander blocks with 422
    mode = 'building';
    const eligBuilding = await fetch(`${baseUrl}/api/verifier-eligibilite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: KABARE_LAT, lon: KABARE_LON, gps_accuracy_m: 6.5 }),
    });
    assert.equal(eligBuilding.status, 200);
    const eligBuildingJson = (await eligBuilding.json()) as {
      eligibilite: { status: string; eligibleForAnalysis: boolean };
    };
    assert.equal(eligBuildingJson.eligibilite.status, 'NOT_SUITABLE');
    assert.equal(eligBuildingJson.eligibilite.eligibleForAnalysis, false);

    const recBlockedBuilding = await fetch(`${baseUrl}/api/recommander`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: KABARE_LAT,
        lon: KABARE_LON,
        gps_accuracy_m: 6.5,
        gps_timestamp: Date.now(),
        gps_sample_count: 2,
        budget_usd: 25,
        surface_ares: 5,
      }),
    });
    assert.equal(recBlockedBuilding.status, 422);
    const recBlockedJson = (await recBlockedBuilding.json()) as {
      code?: string;
      culture_recommandee?: unknown;
    };
    assert.equal(recBlockedJson.code, 'NOT_SUITABLE');
    assert.equal(recBlockedJson.culture_recommandee, undefined);

    const satBlockedBuilding = await fetch(
      `${baseUrl}/api/analyser-satellites?lat=${KABARE_LAT}&lon=${KABARE_LON}&gps_accuracy_m=6.5`
    );
    assert.equal(satBlockedBuilding.status, 422);

    // Case 9b: Protected-area service unavailable -> /api/recommander blocks with 503 UNKNOWN
    mode = 'unavailable_wdpa';
    const recBlockedUnknown = await fetch(`${baseUrl}/api/recommander`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: KABARE_LAT,
        lon: KABARE_LON,
        gps_accuracy_m: 6.5,
        gps_timestamp: Date.now(),
        gps_sample_count: 2,
        budget_usd: 25,
        surface_ares: 5,
      }),
    });
    assert.equal(recBlockedUnknown.status, 503);
    const recUnknownJson = (await recBlockedUnknown.json()) as {
      code?: string;
      culture_recommandee?: unknown;
    };
    assert.equal(recUnknownJson.code, 'UNKNOWN');
    assert.equal(recUnknownJson.culture_recommandee, undefined);

    // Eligible parcel -> /api/recommander succeeds (200) with eligibilite attached
    mode = 'eligible';
    const recOk = await fetch(`${baseUrl}/api/recommander`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: KABARE_LAT,
        lon: KABARE_LON,
        gps_accuracy_m: 6.5,
        gps_timestamp: Date.now(),
        gps_sample_count: 2,
        budget_usd: 25,
        surface_ares: 5,
      }),
    });
    assert.equal(recOk.status, 200);
    const recOkJson = (await recOk.json()) as {
      culture_recommandee?: string;
      eligibilite?: { status: string };
    };
    assert.equal(recOkJson.eligibilite?.status, 'POTENTIALLY_SUITABLE');
    assert.ok(recOkJson.culture_recommandee);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
