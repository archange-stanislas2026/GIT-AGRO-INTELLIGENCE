import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { findSudKivuTerritory } from './src/utils/sudKivuGeo.ts';
import {
  buildEconomicEstimateForProfile,
  evaluateAgronomicSuitability,
  findCropProfileByName,
} from './src/utils/agronomyEngine.ts';
import {
  MAX_GPS_ACCURACY_METERS,
  validateGpsSubmission,
} from './src/utils/gpsValidation.ts';
import {
  verifyLandEligibility,
  type LandEligibilityDataProvider,
} from './src/utils/landEligibility.ts';
import { runLocalModelIfPresent } from './src/utils/localModelRunner.ts';
import type { CropCandidate, DonneesSatellitesLive } from './src/types/agri.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_CONCURRENT_GEMINI_CALLS = 2;
let activeGeminiCalls = 0;

interface CachedEntry<T> {
  expiresAt: number;
  value: T;
}

const envCache = new Map<string, CachedEntry<EnvironmentalFetchResult>>();
const CACHE_TTL_MS = 15 * 60 * 1000;

interface EnvironmentalFetchResult {
  donnees_satellitaires: DonneesSatellitesLive;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function computeSlopeDegFromThreePoints(
  e0: number,
  eNorth: number,
  eEast: number,
  latDeg: number,
  deltaDeg = 0.001
): number {
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((latDeg * Math.PI) / 180);
  const dy = deltaDeg * metersPerDegLat;
  const dx = deltaDeg * metersPerDegLon;
  const dzDy = (eNorth - e0) / dy;
  const dzDx = (eEast - e0) / dx;
  const slopeRad = Math.atan(Math.sqrt(dzDx * dzDx + dzDy * dzDy));
  return Number(((slopeRad * 180) / Math.PI).toFixed(2));
}

async function fetchLiveEnvironmentalData(
  lat: number,
  lon: number
): Promise<EnvironmentalFetchResult> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = envCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const sourcesActives: string[] = [];
  const erreursSources: Record<string, string> = {};

  let pluieAnnuelleMm: number | null = null;
  let tempMaxMoyenneC: number | null = null;
  let tempMoyenneC: number | null = null;
  let altitudeM: number | null = null;
  let penteDeg: number | null = null;
  let phSol: number | null = null;
  let azoteSol: number | null = null;
  let argilePct: number | null = null;

  const delta = 0.001;
  const latN = Number((lat + delta).toFixed(5));
  const lonE = Number((lon + delta).toFixed(5));

  // 1. NASA POWER Climatology (pluie + températures)
  const nasaPromise = (async () => {
    try {
      const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR,T2M_MAX,T2M_MIN,T2M&community=AG&longitude=${lon.toFixed(
        4
      )}&latitude=${lat.toFixed(4)}&format=JSON`;
      const res = await fetchWithTimeout(url, 12000);
      if (!res.ok) {
        erreursSources['NASA POWER'] = `HTTP ${res.status}`;
        return;
      }
      const data = (await res.json()) as {
        properties?: {
          parameter?: {
            PRECTOTCORR?: Record<string, number>;
            T2M_MAX?: Record<string, number>;
            T2M?: Record<string, number>;
          };
        };
      };
      const params = data.properties?.parameter;
      const precAnnDay = params?.PRECTOTCORR?.ANN;
      const tmaxAnn = params?.T2M_MAX?.ANN;
      const tmeanAnn = params?.T2M?.ANN;

      if (typeof precAnnDay === 'number' && precAnnDay >= 0 && precAnnDay < 900) {
        pluieAnnuelleMm = Number((precAnnDay * 365).toFixed(1));
      }
      if (typeof tmaxAnn === 'number' && tmaxAnn > -50 && tmaxAnn < 70) {
        tempMaxMoyenneC = Number(tmaxAnn.toFixed(1));
      }
      if (typeof tmeanAnn === 'number' && tmeanAnn > -50 && tmeanAnn < 70) {
        tempMoyenneC = Number(tmeanAnn.toFixed(1));
      }
      if (pluieAnnuelleMm !== null || tempMaxMoyenneC !== null) {
        sourcesActives.push('NASA POWER (Climatologie)');
      }
    } catch (err) {
      erreursSources['NASA POWER'] =
        err instanceof Error ? err.message : 'Erreur réseau NASA POWER';
    }
  })();

  // 2. Elevation & DEM Slope (OpenTopoData SRTM30m primary, Open-Meteo Elevation fallback)
  const elevationPromise = (async () => {
    try {
      const srtmUrl = `https://api.opentopodata.org/v1/srtm30m?locations=${lat.toFixed(
        5
      )},${lon.toFixed(5)}|${latN},${lon.toFixed(5)}|${lat.toFixed(5)},${lonE}`;
      const res = await fetchWithTimeout(srtmUrl, 10000);
      if (res.ok) {
        const json = (await res.json()) as {
          results?: Array<{ elevation: number | null }>;
        };
        const r = json.results;
        if (
          r &&
          r.length >= 3 &&
          typeof r[0].elevation === 'number' &&
          typeof r[1].elevation === 'number' &&
          typeof r[2].elevation === 'number'
        ) {
          altitudeM = Number(r[0].elevation.toFixed(1));
          penteDeg = computeSlopeDegFromThreePoints(
            r[0].elevation,
            r[1].elevation,
            r[2].elevation,
            lat,
            delta
          );
          sourcesActives.push('SRTM 30m (OpenTopoData)');
          return;
        }
      }
      erreursSources['OpenTopoData SRTM30m'] = `HTTP ${res.status}`;
    } catch (err) {
      erreursSources['OpenTopoData SRTM30m'] =
        err instanceof Error ? err.message : 'Indisponible';
    }

    // Fallback to Open-Meteo Elevation
    try {
      const omUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(
        5
      )},${latN},${lat.toFixed(5)}&longitude=${lon.toFixed(5)},${lon.toFixed(5)},${lonE}`;
      const res = await fetchWithTimeout(omUrl, 8000);
      if (!res.ok) {
        erreursSources['Open-Meteo Elevation'] = `HTTP ${res.status}`;
        return;
      }
      const json = (await res.json()) as { elevation?: number[] };
      const e = json.elevation;
      if (
        e &&
        e.length >= 3 &&
        typeof e[0] === 'number' &&
        typeof e[1] === 'number' &&
        typeof e[2] === 'number'
      ) {
        altitudeM = Number(e[0].toFixed(1));
        penteDeg = computeSlopeDegFromThreePoints(e[0], e[1], e[2], lat, delta);
        sourcesActives.push('Open-Meteo Elevation');
      }
    } catch (err) {
      erreursSources['Open-Meteo Elevation'] =
        err instanceof Error ? err.message : 'Indisponible';
    }
  })();

  // 3. ISRIC SoilGrids v2.0 (real pedological query with short timeout, never fabricated)
  const soilPromise = (async () => {
    try {
      const sgUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon.toFixed(
        4
      )}&lat=${lat.toFixed(
        4
      )}&property=phh2o&property=nitrogen&property=clay&depth=0-5cm&value=mean`;
      const res = await fetchWithTimeout(sgUrl, 5500);
      if (!res.ok) {
        erreursSources['SoilGrids v2.0'] = `HTTP ${res.status}`;
        return;
      }
      const json = (await res.json()) as {
        properties?: {
          layers?: Array<{
            name: string;
            depths?: Array<{ values?: { mean?: number | null } }>;
          }>;
        };
      };
      const layers = json.properties?.layers ?? [];
      let gotAny = false;
      for (const layer of layers) {
        const meanVal = layer.depths?.[0]?.values?.mean;
        if (typeof meanVal !== 'number') continue;
        if (layer.name === 'phh2o') {
          phSol = Number((meanVal / 10).toFixed(2));
          gotAny = true;
        } else if (layer.name === 'nitrogen') {
          // cg/kg -> g/kg
          azoteSol = Number((meanVal / 100).toFixed(2));
          gotAny = true;
        } else if (layer.name === 'clay') {
          // g/kg -> %
          argilePct = Number((meanVal / 10).toFixed(1));
          gotAny = true;
        }
      }
      if (gotAny) {
        sourcesActives.push('ISRIC SoilGrids v2.0');
      } else {
        erreursSources['SoilGrids v2.0'] = 'Aucune valeur pédologique retournée pour ce point.';
      }
    } catch (err) {
      erreursSources['SoilGrids v2.0'] =
        err instanceof Error && err.name === 'AbortError'
          ? 'Délai dépassé (>5,5 s) sur rest.isric.org'
          : err instanceof Error
          ? err.message
          : 'Indisponible';
    }
  })();

  await Promise.all([nasaPromise, elevationPromise, soilPromise]);

  const result: EnvironmentalFetchResult = {
    donnees_satellitaires: {
      sources_actives: sourcesActives,
      pluie_annuelle_mm: pluieAnnuelleMm,
      pluie_mm: pluieAnnuelleMm,
      temp_max_moyenne_c: tempMaxMoyenneC,
      temp_max_c: tempMaxMoyenneC,
      temp_moyenne_c: tempMoyenneC,
      altitude_m: altitudeM,
      pente_deg: penteDeg,
      ph_sol: phSol,
      azote_sol: azoteSol,
      argile_pct: argilePct,
      ndvi: null,
      historique_ndvi: null,
      mode_secours: false,
      erreurs_sources: Object.keys(erreursSources).length > 0 ? erreursSources : undefined,
      nature_donnees: {
        NASA_POWER: 'Climatologie pluriannuelle NASA POWER (précipitations et températures)',
        altitude_pente: 'Modèle numérique de terrain 30 m (SRTM / Open-Meteo)',
        sol: 'Estimations issues de bases pédologiques (ISRIC SoilGrids v2.0 / HWSD v1.2) — distinctes d’une analyse physique en laboratoire',
      },
    },
  };

  if (sourcesActives.length > 0) {
    envCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  }

  return result;
}

async function generateFarmerExplanationWithGemini(params: {
  territory: string;
  lat: number;
  lon: number;
  gpsAccuracyMeters: number;
  budgetUsd: number;
  surfaceAres: number;
  satellite: DonneesSatellitesLive;
  classement: ReturnType<typeof evaluateAgronomicSuitability>['classement'];
  observations: string[];
}): Promise<{ explication_cultivateur: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const top = params.classement[0];
  const alternatives = params.classement.slice(1, 3);

  const deterministicExplanation = [
    `Pour votre parcelle située à ${params.territory} (Sud-Kivu, précision GPS : ${params.gpsAccuracyMeters.toFixed(1)} m), la culture la plus adaptée selon les mesures et bases environnementales disponibles est : ${top.nom} (compatibilité ${top.score_compatibilite}/100).`,
    `Justification par les données : ${top.raisons_agronomiques.join(' ; ')}.`,
    alternatives.length > 0
      ? `Autres options classées selon votre terrain : ${alternatives
          .map((c) => `${c.nom} (${c.score_compatibilite}/100)`)
          .join(', ')}.`
      : '',
    top.points_vigilance.length > 0
      ? `Points d'attention : ${top.points_vigilance.join(' ; ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!apiKey || activeGeminiCalls >= MAX_CONCURRENT_GEMINI_CALLS) {
    return {
      explication_cultivateur: deterministicExplanation,
    };
  }

  activeGeminiCalls += 1;
  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = `Tu es un conseiller agronome bienveillant pour les petits cultivateurs du Sud-Kivu (RDC).
RÈGLES STRICTES :
1. Zéro biais vers le manioc : ne privilégie jamais le manioc s'il n'est pas en tête du classement agronomique ci-dessous.
2. Justifie ta recommandation UNIQUEMENT à partir des données climatiques, topographiques, des estimations pédologiques et du classement fournis ci-dessous. Interdiction d'inventer des chiffres.
3. Distingue clairement les estimations de bases pédologiques (SoilGrids / HWSD) d'une analyse physique en laboratoire. Si une donnée est null, dis clairement qu'elle n'a pas été mesurée.
4. Parle dans un français simple, chaleureux, sans jargon technique excessif.

Données de la parcelle :
- Territoire / Ville (Sud-Kivu) : ${params.territory} (${params.lat.toFixed(5)}, ${params.lon.toFixed(5)} · précision GPS déclarée : ${params.gpsAccuracyMeters.toFixed(1)} m)
- Surface : ${params.surfaceAres} ares | Budget : ${params.budgetUsd} USD
- Pluie annuelle : ${params.satellite.pluie_annuelle_mm ?? 'non mesurée'} mm
- Température max moyenne : ${params.satellite.temp_max_moyenne_c ?? 'non mesurée'} °C
- Altitude : ${params.satellite.altitude_m ?? 'non mesurée'} m
- Pente : ${params.satellite.pente_deg ?? 'non mesurée'} °
- pH du sol (estimation base pédologique) : ${params.satellite.ph_sol ?? 'non mesuré'}
- Azote du sol (estimation) : ${params.satellite.azote_sol ?? 'non mesuré'} | Argile (estimation) : ${params.satellite.argile_pct ?? 'non mesurée'} %

Classement agronomique calculé (ordre de compatibilité) :
${params.classement
  .map(
    (c, idx) =>
      `${idx + 1}. ${c.nom} (${c.score_compatibilite}/100) — Raisons: ${c.raisons_agronomiques.join(
        '; '
      )}${c.points_vigilance.length ? ` | Vigilance: ${c.points_vigilance.join('; ')}` : ''}`
  )
  .join('\n')}

Observations agroécologiques : ${params.observations.join(' ')}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Réponds en JSON strict contenant uniquement la clé explication_cultivateur (3 à 5 phrases simples justifiant la culture #1 avec les chiffres fournis, mentionnant les 2 cultures suivantes du classement et des conseils pratiques adaptés au terrain).',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explication_cultivateur: {
              type: Type.STRING,
              description:
                'Conseil agronomique clair et bienveillant en français simple pour le cultivateur.',
            },
          },
          required: ['explication_cultivateur'],
        },
      },
    });

    const rawText = response.text?.trim();
    if (rawText) {
      const parsed = JSON.parse(rawText) as {
        explication_cultivateur?: string;
      };
      return {
        explication_cultivateur:
          parsed.explication_cultivateur?.trim() || deterministicExplanation,
      };
    }
  } catch {
    // Fallback cleanly to deterministic grounded explanation without hallucinating
  } finally {
    activeGeminiCalls = Math.max(0, activeGeminiCalls - 1);
  }

  return {
    explication_cultivateur: deterministicExplanation,
  };
}

export interface CreateAppOptions {
  eligibilityProvider?: LandEligibilityDataProvider;
}

export function createApp(options?: CreateAppOptions) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      statut: 'En ligne',
      application: 'GITAgroIntelligence — Sud-Kivu',
      zone_autorisee: 'Province du Sud-Kivu (RDC)',
      seuil_precision_gps_metres: MAX_GPS_ACCURACY_METERS,
      verification_eligibilite_active: true,
    });
  });

  // Land eligibility verification endpoint (GPS < 10m -> Land-use OSM -> Protected-area WDPA/OSM)
  const handleVerifyEligibility = async (
    rawInput: Record<string, unknown>,
    res: express.Response
  ) => {
    const gpsCheck = validateGpsSubmission({
      lat: rawInput.lat,
      lon: rawInput.lon,
      accuracyMeters: rawInput.gps_accuracy_m ?? rawInput.accuracy ?? rawInput.accuracy_m,
      timestamp: rawInput.gps_timestamp,
      sampleCount: rawInput.gps_sample_count,
      measurements: rawInput.gps_measurements,
    });

    if (
      !gpsCheck.valid ||
      gpsCheck.lat === undefined ||
      gpsCheck.lon === undefined ||
      gpsCheck.accuracyMeters === undefined
    ) {
      res.status(400).json({
        detail: gpsCheck.error || 'Paramètres GPS invalides ou précision >= 10 m.',
        code: gpsCheck.code,
        hors_zone: gpsCheck.code === 'OUTSIDE_SUD_KIVU',
        note_fiabilite: gpsCheck.noteFiabilite,
      });
      return;
    }

    const territory = findSudKivuTerritory(gpsCheck.lat, gpsCheck.lon) ?? 'Sud-Kivu';
    const eligibilite = await verifyLandEligibility({
      lat: gpsCheck.lat,
      lon: gpsCheck.lon,
      gpsAccuracyMeters: gpsCheck.accuracyMeters,
      territoire: territory,
      provider: options?.eligibilityProvider,
    });

    res.json({
      territoire: territory,
      coordonnees: { lat: gpsCheck.lat, lon: gpsCheck.lon },
      gps_validation: {
        seuil_strict_metres: MAX_GPS_ACCURACY_METERS,
        precision_declaree_metres: gpsCheck.accuracyMeters,
        note_fiabilite: gpsCheck.noteFiabilite,
      },
      eligibilite,
    });
  };

  app.get('/api/verifier-eligibilite', async (req, res) => {
    try {
      await handleVerifyEligibility(req.query as Record<string, unknown>, res);
    } catch (err) {
      res.status(500).json({
        detail:
          err instanceof Error
            ? `Erreur lors de la vérification d’éligibilité : ${err.message}`
            : 'Erreur interne lors de la vérification d’éligibilité.',
      });
    }
  });

  app.post('/api/verifier-eligibilite', async (req, res) => {
    try {
      await handleVerifyEligibility((req.body ?? {}) as Record<string, unknown>, res);
    } catch (err) {
      res.status(500).json({
        detail:
          err instanceof Error
            ? `Erreur lors de la vérification d’éligibilité : ${err.message}`
            : 'Erreur interne lors de la vérification d’éligibilité.',
      });
    }
  });

  // Live satellite & pedological endpoint with strict < 10m GPS accuracy + Sud-Kivu + Land eligibility gate
  app.get('/api/analyser-satellites', async (req, res) => {
    const gpsCheck = validateGpsSubmission({
      lat: req.query.lat,
      lon: req.query.lon,
      accuracyMeters: req.query.gps_accuracy_m ?? req.query.accuracy ?? req.query.accuracy_m,
      timestamp: req.query.gps_timestamp,
      sampleCount: req.query.gps_sample_count,
    });

    if (!gpsCheck.valid || gpsCheck.lat === undefined || gpsCheck.lon === undefined || gpsCheck.accuracyMeters === undefined) {
      res.status(400).json({
        detail: gpsCheck.error || 'Paramètres GPS invalides.',
        code: gpsCheck.code,
        hors_zone: gpsCheck.code === 'OUTSIDE_SUD_KIVU',
        note_fiabilite: gpsCheck.noteFiabilite,
      });
      return;
    }

    const territory = findSudKivuTerritory(gpsCheck.lat, gpsCheck.lon) ?? 'Sud-Kivu';
    const eligibilite = await verifyLandEligibility({
      lat: gpsCheck.lat,
      lon: gpsCheck.lon,
      gpsAccuracyMeters: gpsCheck.accuracyMeters,
      territoire: territory,
      provider: options?.eligibilityProvider,
    });

    if (!eligibilite.eligibleForAnalysis) {
      const statusCode = eligibilite.reasonCode === 'DATA_UNAVAILABLE' ? 503 : 422;
      res.status(statusCode).json({
        detail: eligibilite.userMessage,
        code: eligibilite.status,
        reason_code: eligibilite.reasonCode,
        eligibilite,
      });
      return;
    }

    const envData = await fetchLiveEnvironmentalData(gpsCheck.lat, gpsCheck.lon);
    res.json({
      territoire: territory,
      lat: gpsCheck.lat,
      lon: gpsCheck.lon,
      gps_validation: {
        seuil_strict_metres: MAX_GPS_ACCURACY_METERS,
        precision_declaree_metres: gpsCheck.accuracyMeters,
        note_fiabilite: gpsCheck.noteFiabilite,
      },
      eligibilite,
      ...envData.donnees_satellitaires,
    });
  });

  // Main recommendation endpoint (JSON / URL-encoded only, zero photo parameters)
  app.post('/api/recommander', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;

      const gpsCheck = validateGpsSubmission({
        lat: body.lat,
        lon: body.lon,
        accuracyMeters: body.gps_accuracy_m ?? body.accuracy ?? body.accuracy_m,
        timestamp: body.gps_timestamp,
        sampleCount: body.gps_sample_count,
        measurements: body.gps_measurements,
      });

      if (!gpsCheck.valid || gpsCheck.lat === undefined || gpsCheck.lon === undefined || gpsCheck.accuracyMeters === undefined) {
        res.status(400).json({
          detail: gpsCheck.error || 'Paramètres GPS invalides ou précision >= 10 m.',
          code: gpsCheck.code,
          hors_zone: gpsCheck.code === 'OUTSIDE_SUD_KIVU',
          note_fiabilite: gpsCheck.noteFiabilite,
        });
        return;
      }

      const lat = gpsCheck.lat;
      const lon = gpsCheck.lon;
      const gpsAccuracyMeters = gpsCheck.accuracyMeters;
      const territory = findSudKivuTerritory(lat, lon) ?? 'Sud-Kivu';

      // MANDATORY BACKEND GATE: Never trust frontend eligibility flags; verify independently here
      const eligibilite = await verifyLandEligibility({
        lat,
        lon,
        gpsAccuracyMeters,
        territoire: territory,
        provider: options?.eligibilityProvider,
      });

      if (!eligibilite.eligibleForAnalysis) {
        const statusCode = eligibilite.reasonCode === 'DATA_UNAVAILABLE' ? 503 : 422;
        res.status(statusCode).json({
          detail: eligibilite.userMessage,
          code: eligibilite.status,
          reason_code: eligibilite.reasonCode,
          eligibilite,
        });
        return;
      }

      const budgetUsd = Math.max(0, Number(String(body.budget_usd ?? '25').replace(',', '.')) || 0);
      const surfaceAres = Math.max(
        0.5,
        Math.min(1000, Number(String(body.surface_ares ?? '5').replace(',', '.')) || 5)
      );
      const saisonRaw = Number(body.saison ?? 1);
      const saison: 1 | 2 | 3 = saisonRaw === 2 ? 2 : saisonRaw === 3 ? 3 : 1;
      const dureeJours = Number(body.duree_jours_disponible ?? 120) || 120;

      // Fetch real live climate, DEM elevation/slope, and SoilGrids pedology
      const envData = await fetchLiveEnvironmentalData(lat, lon);
      const evaluation = evaluateAgronomicSuitability({
        satellite: envData.donnees_satellitaires,
        budgetUsd,
        surfaceAres,
        saison,
        dureeJoursDisponible: dureeJours,
        territory,
      });

      if (evaluation.donneesInsuffisantes || !evaluation.topCrop) {
        res.status(503).json({
          detail:
            evaluation.raisonInsuffisance ||
            'Données satellites insuffisantes pour recommander une culture de manière fiable.',
          donnees_insuffisantes: true,
          donnees_satellitaires: envData.donnees_satellitaires,
        });
        return;
      }

      // Check for user's local trained model inside /models/
      const localModel = await runLocalModelIfPresent({
        rootDir: __dirname,
        satellite: envData.donnees_satellitaires,
        lat,
        lon,
        budgetUsd,
        surfaceAres,
      });

      if (localModel.found && !localModel.ok) {
        res.status(500).json({
          detail: localModel.detail,
          erreur_modele: localModel.error,
          fichier_modele: localModel.modelFile,
        });
        return;
      }

      let finalCropName = evaluation.topCrop.nom.toUpperCase();
      let finalCropCode = evaluation.topCrop.code;
      let finalClassement: CropCandidate[] = evaluation.classement;
      let finalEconomic = evaluation.estimationEconomique;
      let engineLabel = 'Score agronomique multicritère local (aucun fichier .joblib/.json dans /models/)';
      let finalObservations = evaluation.observations;

      if (localModel.found && localModel.ok) {
        const matchedProfile = findCropProfileByName(localModel.culture);
        finalCropName = localModel.culture.toUpperCase();
        finalCropCode = matchedProfile ? matchedProfile.code : localModel.culture.toLowerCase();
        engineLabel = localModel.engineLabel;

        if (localModel.classementDetaille && localModel.classementDetaille.length > 0) {
          finalClassement = localModel.classementDetaille.slice(0, 5).map((item) => ({
            code: item.code,
            nom: item.nom,
            score_compatibilite: Math.round(item.score_final > 0 ? item.score_final : item.score_ahp),
            raisons_agronomiques: [
              `Classe FAO : ${item.classe_aptitude} (AHP ${item.score_ahp}/100)`,
              ...item.raisons_agronomiques,
            ],
            points_vigilance: item.points_vigilance,
          }));
        } else {
          const probEntries = Object.entries(localModel.probabilites).sort((a, b) => b[1] - a[1]);
          if (probEntries.length > 0) {
            finalClassement = probEntries.slice(0, 5).map(([label, prob], idx) => {
              const prof = findCropProfileByName(label);
              return {
                code: prof ? prof.code : label.toLowerCase().replace(/\s+/g, '_'),
                nom: prof ? prof.nom : label,
                score_compatibilite: Math.round(prob * 100),
                raisons_agronomiques: [
                  idx === 0
                    ? `Choix principal du modèle local ${localModel.modelFile} (probabilité ${(prob * 100).toFixed(1)} %)`
                    : `Probabilité du modèle local : ${(prob * 100).toFixed(1)} %`,
                ],
                points_vigilance: [],
              };
            });
          } else {
            finalClassement = [
              {
                code: finalCropCode,
                nom: matchedProfile ? matchedProfile.nom : localModel.culture,
                score_compatibilite: 100,
                raisons_agronomiques: [`Culture prédite directement par ${localModel.modelFile}`],
                points_vigilance: [],
              },
            ];
          }
        }

        if (matchedProfile) {
          finalEconomic = buildEconomicEstimateForProfile(matchedProfile, surfaceAres, budgetUsd);
        }
        const gridNote = localModel.celluleGrille
          ? ` Couche grille modèle : T=${localModel.celluleGrille.T_c ?? '?'} °C, P=${localModel.celluleGrille.P_mm ?? '?'} mm, ALT=${localModel.celluleGrille.ALT_m ?? '?'} m, pH=${localModel.celluleGrille.pH ?? '?'}, CEC=${localModel.celluleGrille.CEC ?? '?'}, COS=${localModel.celluleGrille.COS_pct ?? '?'} %.`
          : '';
        finalObservations = [
          `Prédiction générée localement par ${localModel.modelFile} à partir des mesures de ${territory}.${gridNote}`,
          ...evaluation.observations,
        ];
      }

      const aiText = await generateFarmerExplanationWithGemini({
        territory,
        lat,
        lon,
        gpsAccuracyMeters,
        budgetUsd,
        surfaceAres,
        satellite: envData.donnees_satellitaires,
        classement: finalClassement,
        observations: finalObservations,
      });

      res.json({
        projet: 'GITAgroIntelligence',
        territoire: territory,
        coordonnees: { lat, lon },
        gps_validation: {
          seuil_strict_metres: MAX_GPS_ACCURACY_METERS,
          precision_declaree_metres: gpsAccuracyMeters,
          note_fiabilite: gpsCheck.noteFiabilite,
        },
        eligibilite,
        culture_recommandee: finalCropName,
        explication_cultivateur: aiText.explication_cultivateur,
        classement_cultures: finalClassement,
        estimation_economique: finalEconomic,
        donnees_satellitaires: envData.donnees_satellitaires,
        prediction_agronomique: {
          culture: finalCropCode,
          moteur: engineLabel,
          donnees_entree_modele: {
            pluie_mm: envData.donnees_satellitaires.pluie_annuelle_mm,
            temp_max_c: envData.donnees_satellitaires.temp_max_moyenne_c,
            altitude_m: envData.donnees_satellitaires.altitude_m,
            pente_deg: envData.donnees_satellitaires.pente_deg,
            ph_sol: envData.donnees_satellitaires.ph_sol,
            azote_sol: envData.donnees_satellitaires.azote_sol,
            argile_pct: envData.donnees_satellitaires.argile_pct,
            historique_ndvi: envData.donnees_satellitaires.ndvi,
          },
          analyse_agroecologique: {
            observations: finalObservations,
            cultures_a_examiner: finalClassement.map((c) => c.nom),
          },
        },
      });
    } catch (err) {
      res.status(500).json({
        detail:
          err instanceof Error
            ? `Erreur interne du serveur local : ${err.message}`
            : 'Erreur interne inattendue sur /api/recommander.',
      });
    }
  });

  // Ensure any unhandled /api/* error returns JSON rather than Express HTML
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({
      detail: err instanceof Error ? err.message : 'Erreur API interne.',
    });
  });

  return app;
}

export async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app.listen(PORT, '0.0.0.0', () => {
    console.log(`GITAgroIntelligence server running on http://0.0.0.0:${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
