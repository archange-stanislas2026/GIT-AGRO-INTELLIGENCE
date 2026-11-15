import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MAX_GPS_ACCURACY_METERS,
  formatAccuracyMeters,
  isGpsAccuracyAcceptable,
  validateGpsSubmission,
} from '../src/utils/gpsValidation.ts';
import { evaluateModeleCulturesClient } from '../src/utils/modeleCulturesLocal.ts';
import { evaluateAgronomicSuitability } from '../src/utils/agronomyEngine.ts';
import { createApp } from '../server.ts';

test('GPS accuracy threshold (<= 15 meters)', () => {
  assert.equal(MAX_GPS_ACCURACY_METERS, 15);

  // Accepted values <= 15 m
  assert.equal(isGpsAccuracyAcceptable(5), true);
  assert.equal(isGpsAccuracyAcceptable(10), true);
  assert.equal(isGpsAccuracyAcceptable(14), true);
  assert.equal(isGpsAccuracyAcceptable(15), true, 'Exact 15m MUST be accepted');
  assert.equal(isGpsAccuracyAcceptable(15.0), true, 'Exact 15.0m MUST be accepted');

  // Rejected values > 15 m or invalid
  assert.equal(isGpsAccuracyAcceptable(15.1), false, '15.1m MUST be rejected');
  assert.equal(isGpsAccuracyAcceptable(20), false);
  assert.equal(isGpsAccuracyAcceptable(30), false);
  assert.equal(isGpsAccuracyAcceptable(0), false);
  assert.equal(isGpsAccuracyAcceptable(-3), false);
  assert.equal(isGpsAccuracyAcceptable(Number.NaN), false);
  assert.equal(isGpsAccuracyAcceptable(Number.POSITIVE_INFINITY), false);
  assert.equal(isGpsAccuracyAcceptable(null), false);
  assert.equal(isGpsAccuracyAcceptable(undefined), false);

  assert.equal(formatAccuracyMeters(14.9), '14,9');
  assert.equal(formatAccuracyMeters(15.0), '15');
});

test('GPS submission validation enforces threshold, plausibility, and Sud-Kivu bounds', () => {
  const bukavu = { lat: -2.5, lon: 28.85 };

  // Missing accuracy
  const missing = validateGpsSubmission({ ...bukavu, accuracyMeters: undefined });
  assert.equal(missing.valid, false);
  assert.equal(missing.code, 'MISSING_ACCURACY');

  // 15.1m rejected (> 15m)
  const tooInaccurate = validateGpsSubmission({ ...bukavu, accuracyMeters: 15.1 });
  assert.equal(tooInaccurate.valid, false);
  assert.equal(tooInaccurate.code, 'INSUFFICIENT_ACCURACY');

  // 14m accepted inside Sud-Kivu
  const validFourteen = validateGpsSubmission({ ...bukavu, accuracyMeters: 14 });
  assert.equal(validFourteen.valid, true);
  assert.equal(validFourteen.accuracyMeters, 14);

  // Claiming better accuracy than actual device measurements rejected
  const spoofedBetter = validateGpsSubmission({
    ...bukavu,
    accuracyMeters: 6.0,
    measurements: [
      { lat: -2.5, lon: 28.85, accuracyMeters: 18.0, timestamp: Date.now() - 2000 },
      { lat: -2.50001, lon: 28.85001, accuracyMeters: 12.5, timestamp: Date.now() },
    ],
  });
  assert.equal(spoofedBetter.valid, false);
  assert.equal(spoofedBetter.code, 'IMPLAUSIBLE_GPS_METADATA');

  // Outside Sud-Kivu rejected even with 4m accuracy
  const goma = validateGpsSubmission({ lat: -1.65, lon: 29.22, accuracyMeters: 4.0 });
  assert.equal(goma.valid, false);
  assert.equal(goma.code, 'OUTSIDE_SUD_KIVU');
});

test('Recommendation engines require <=15m GPS and contain zero photo weights or fields', () => {
  // 15.1m throws error in embedded client model
  assert.throws(() =>
    evaluateModeleCulturesClient({
      lat: -2.5,
      lon: 28.85,
      gpsAccuracyMeters: 15.1,
      budgetUsd: 25,
      surfaceAres: 5,
    })
  );

  // Valid 14m succeeds across Sud-Kivu without any photo properties
  const bukavu = evaluateModeleCulturesClient({
    lat: -2.5,
    lon: 28.85,
    gpsAccuracyMeters: 14.0,
    budgetUsd: 25,
    surfaceAres: 5,
  });
  assert.equal(bukavu.culture_recommandee, 'PATATE DOUCE');
  assert.equal('analyse_photo' in bukavu, false);
  assert.equal(bukavu.gps_validation?.precision_declaree_metres, 14.0);

  const kabare = evaluateModeleCulturesClient({
    lat: -2.4,
    lon: 28.75,
    gpsAccuracyMeters: 7.5,
    budgetUsd: 25,
    surfaceAres: 5,
  });
  assert.equal(kabare.culture_recommandee, 'POMME DE TERRE');

  const fizi = evaluateModeleCulturesClient({
    lat: -4.3,
    lon: 28.95,
    gpsAccuracyMeters: 8.2,
    budgetUsd: 25,
    surfaceAres: 5,
  });
  assert.equal(fizi.culture_recommandee, 'MANIOC');

  const uvira = evaluateModeleCulturesClient({
    lat: -3.4,
    lon: 29.1,
    gpsAccuracyMeters: 6.1,
    budgetUsd: 25,
    surfaceAres: 5,
  });
  assert.equal(uvira.culture_recommandee, 'SORGHO');

  // Multicriteria agronomy engine preserves scientific criteria without photo mentions
  const agro = evaluateAgronomicSuitability({
    satellite: {
      pluie_annuelle_mm: 1350,
      temp_max_moyenne_c: 24,
      altitude_m: 1900,
      pente_deg: 6,
      ph_sol: null,
    },
    budgetUsd: 40,
    surfaceAres: 5,
    territory: 'Kabare',
  });
  assert.equal(agro.donneesInsuffisantes, false);
  assert.ok(agro.topCrop);
  assert.equal(
    agro.observations.some((obs) => obs.toLowerCase().includes('photo')),
    false
  );
});

test('Backend API enforces strict <=15m GPS accuracy and removes photo outputs', async () => {
  const app = createApp({
    eligibilityProvider: {
      fetchLandUseData: async () => ({
        ok: true,
        provider: 'Test OSM',
        polygons: [],
        polylines: [],
        points: [],
        enclosingAreas: [],
      }),
      fetchProtectedAreaData: async () => ({
        ok: true,
        provider: 'Test WDPA',
        polygons: [],
        pointSites: [],
        enclosingAreas: [],
      }),
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. GET /api/analyser-satellites without accuracy -> 400
    const satMissing = await fetch(`${baseUrl}/api/analyser-satellites?lat=-2.5&lon=28.85`);
    assert.equal(satMissing.status, 400);

    // 2. GET /api/analyser-satellites with accuracy=15.1 -> 400
    const satTooInaccurate = await fetch(
      `${baseUrl}/api/analyser-satellites?lat=-2.5&lon=28.85&gps_accuracy_m=15.1`
    );
    assert.equal(satTooInaccurate.status, 400);

    // 3. POST /api/recommander without accuracy -> 400
    const recMissing = await fetch(`${baseUrl}/api/recommander`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: -2.5, lon: 28.85, budget_usd: 25, surface_ares: 5 }),
    });
    assert.equal(recMissing.status, 400);

    // 4. POST /api/recommander with 15.1m -> 400
    const recTooInaccurate = await fetch(`${baseUrl}/api/recommander`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: -2.5,
        lon: 28.85,
        gps_accuracy_m: 15.1,
        budget_usd: 25,
        surface_ares: 5,
      }),
    });
    assert.equal(recTooInaccurate.status, 400);

    // 5. POST /api/recommander with 14m in Bukavu -> 200 JSON, no analyse_photo
    const recValid = await fetch(`${baseUrl}/api/recommander`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: -2.5,
        lon: 28.85,
        gps_accuracy_m: 14.0,
        gps_timestamp: Date.now(),
        gps_sample_count: 2,
        budget_usd: 25,
        surface_ares: 5,
      }),
    });
    assert.equal(recValid.status, 200);
    const json = (await recValid.json()) as Record<string, unknown>;
    assert.equal(json.culture_recommandee, 'PATATE DOUCE');
    assert.equal('analyse_photo' in json, false);
    assert.ok(json.gps_validation);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
