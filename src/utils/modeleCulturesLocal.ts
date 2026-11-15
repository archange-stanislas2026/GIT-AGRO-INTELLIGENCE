import modeleDataRaw from '../data/modeleCulturesData.json';
import type { CropCandidate, RecommendationResponse } from '../types/agri.ts';
import {
  buildEconomicEstimateForProfile,
  findCropProfileByName,
} from './agronomyEngine.ts';
import { MAX_GPS_ACCURACY_METERS, validateGpsSubmission } from './gpsValidation.ts';
import { findSudKivuTerritory } from './sudKivuGeo.ts';

interface ModeleCultureEntry {
  code: string;
  nom: string;
  exigences: Record<string, [number, number, number, number]>;
  poids: Record<string, number>;
}

interface ModeleCulturesSpec {
  version: string;
  methodologie: string;
  gradient_c_par_m: number;
  scores: [number, number, number, number, number];
  seuils_classes: { apte: number; moyennement_apte: number };
  facteurs: Record<string, { nom: string; unite: string; type: string }>;
  cultures: ModeleCultureEntry[];
  sources: Record<string, string>;
  grille: {
    lat_min: number;
    lon_min: number;
    pas: number;
    n_lat: number;
    n_lon: number;
    couches: {
      t0: Array<number | null>;
      pluie: Array<number | null>;
      altitude: Array<number | null>;
      ph: Array<number | null>;
      cec: Array<number | null>;
      cos: Array<number | null>;
      lulc: Array<number | null>;
      aire_protegee: Array<number | null>;
    };
  };
}

const modeleData = modeleDataRaw as unknown as ModeleCulturesSpec;

function faoFactorScore(
  val: number | null | undefined,
  bounds: [number, number, number, number],
  scoresArr: [number, number, number, number, number]
): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  if (val < bounds[0]) return scoresArr[0];
  if (val < bounds[1]) return scoresArr[1];
  if (val <= bounds[2]) return scoresArr[2];
  if (val <= bounds[3]) return scoresArr[3];
  return scoresArr[4];
}

export function evaluateModeleCulturesClient(params: {
  lat: number;
  lon: number;
  gpsAccuracyMeters: number;
  gpsTimestamp?: number;
  gpsSampleCount?: number;
  budgetUsd: number;
  surfaceAres: number;
}): RecommendationResponse {
  const {
    lat,
    lon,
    gpsAccuracyMeters,
    gpsTimestamp,
    gpsSampleCount,
    budgetUsd,
    surfaceAres,
  } = params;

  const gpsCheck = validateGpsSubmission({
    lat,
    lon,
    accuracyMeters: gpsAccuracyMeters,
    timestamp: gpsTimestamp,
    sampleCount: gpsSampleCount,
  });

  if (!gpsCheck.valid || gpsCheck.lat === undefined || gpsCheck.lon === undefined || gpsCheck.accuracyMeters === undefined) {
    throw new Error(
      gpsCheck.error ||
        'Précision GPS insuffisante (< 10 m requis) ou localisation hors du Sud-Kivu.'
    );
  }

  const validLat = gpsCheck.lat;
  const validLon = gpsCheck.lon;
  const validAccuracy = gpsCheck.accuracyMeters;

  const g = modeleData.grille;
  const c = g.couches;

  const iLat = Math.max(0, Math.min(g.n_lat - 1, Math.round((validLat - g.lat_min) / g.pas)));
  const iLon = Math.max(0, Math.min(g.n_lon - 1, Math.round((validLon - g.lon_min) / g.pas)));

  const readCell = (r: number, col: number) => {
    const idx = r * g.n_lon + col;
    return {
      t0: c.t0[idx] ?? null,
      pluie: c.pluie[idx] ?? null,
      altitude: c.altitude[idx] ?? null,
      ph: c.ph[idx] ?? null,
      cec: c.cec[idx] ?? null,
      cos: c.cos[idx] ?? null,
      lulc: c.lulc[idx] ?? null,
      aire_protegee: c.aire_protegee[idx] ?? null,
    };
  };

  let cell = readCell(iLat, iLon);
  if (cell.t0 === null && cell.altitude === null) {
    let bestDist = 999;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = iLat + dr;
        const nc = iLon + dc;
        if (nr >= 0 && nr < g.n_lat && nc >= 0 && nc < g.n_lon) {
          const cand = readCell(nr, nc);
          if (cand.t0 !== null || cand.altitude !== null) {
            const d = Math.abs(dr) + Math.abs(dc);
            if (d < bestDist) {
              bestDist = d;
              cell = cand;
            }
          }
        }
      }
    }
  }

  const altVal = cell.altitude;
  const tempVal =
    cell.t0 !== null && altVal !== null
      ? Number((cell.t0 - modeleData.gradient_c_par_m * altVal).toFixed(2))
      : null;
  const pluieVal = cell.pluie;
  const phVal = cell.ph;
  const cecVal = cell.cec;
  const cosVal = cell.cos;

  const factorValues: Record<string, number | null> = {
    T: tempVal,
    P: pluieVal,
    ALT: altVal,
    pH: phVal,
    CEC: cecVal,
    COS: cosVal,
  };

  const ranked = modeleData.cultures.map((cult) => {
    const raisons: string[] = [];
    const vigilances: string[] = [];
    let weightedSum = 0;
    let weightTotal = 0;
    let minScore = 100;

    for (const [fKey, bounds] of Object.entries(cult.exigences)) {
      const v = factorValues[fKey] ?? null;
      const s = faoFactorScore(v, bounds, modeleData.scores);
      const fMeta = modeleData.facteurs[fKey];
      const fLabel = fMeta?.nom ?? fKey;
      const unite = fMeta?.unite ? ` ${fMeta.unite}` : '';

      if (s !== null) {
        const w = cult.poids[fKey] ?? 0;
        weightedSum += w * s;
        weightTotal += w;
        if (s < minScore) minScore = s;

        if (s >= 100 && (fKey === 'T' || fKey === 'P' || fKey === 'ALT' || fKey === 'pH')) {
          raisons.push(`${fLabel.charAt(0).toUpperCase() + fLabel.slice(1)} optimale (${v}${unite})`);
        } else if (s >= 50 && s < 100) {
          vigilances.push(
            `${fLabel.charAt(0).toUpperCase() + fLabel.slice(1)} modérément favorable (${v}${unite})`
          );
        } else if (s === 0) {
          vigilances.push(
            `Facteur limitant (${fLabel} = ${v}${unite}, plage tolérée ${bounds[0]}–${bounds[3]}${unite})`
          );
        }
      }
    }

    const ahpScore = weightTotal > 0 ? Number((weightedSum / weightTotal).toFixed(1)) : 0;
    const finalScore = minScore === 0 ? 0 : ahpScore;
    const classeAptitude =
      finalScore >= modeleData.seuils_classes.apte
        ? 'Apte'
        : finalScore >= modeleData.seuils_classes.moyennement_apte
        ? 'Moyennement apte'
        : 'Inapte / Sous contrainte';

    if (cell.aire_protegee === 1) {
      vigilances.unshift(
        'Parcelle située dans une aire protégée répertoriée (vérifier autorisation locale)'
      );
    }

    return {
      code: cult.code,
      nom: cult.nom,
      finalScore,
      ahpScore,
      classeAptitude,
      raisons: raisons.length > 0 ? raisons : ['Évaluation AHP effectuée sur le modèle local'],
      vigilances,
    };
  });

  ranked.sort((a, b) => b.finalScore - a.finalScore || b.ahpScore - a.ahpScore);
  const top = ranked[0];
  const territory = findSudKivuTerritory(validLat, validLon) ?? 'Sud-Kivu';

  const classement: CropCandidate[] = ranked.slice(0, 5).map((item) => ({
    code: item.code,
    nom: item.nom,
    score_compatibilite: Math.round(item.finalScore > 0 ? item.finalScore : item.ahpScore),
    raisons_agronomiques: [
      `Classe FAO : ${item.classeAptitude} (AHP ${item.ahpScore}/100)`,
      ...item.raisons,
    ],
    points_vigilance: item.vigilances,
  }));

  const matchedProfile = findCropProfileByName(top.nom);
  const estimationEconomique = matchedProfile
    ? buildEconomicEstimateForProfile(matchedProfile, surfaceAres, budgetUsd)
    : undefined;

  const alternatives = ranked
    .slice(1, 3)
    .map((c) => `${c.nom} (${Math.round(c.finalScore > 0 ? c.finalScore : c.ahpScore)}/100)`)
    .join(', ');
  const explication = [
    `Pour votre parcelle située à ${territory} (Sud-Kivu, précision GPS validée : ${validAccuracy.toFixed(1)} m), la culture recommandée par le modèle local (modele_cultures.joblib) est : ${top.nom} (classe FAO : ${top.classeAptitude}, score AHP ${top.ahpScore}/100).`,
    `Données estimées de la cellule (${validLat.toFixed(5)}, ${validLon.toFixed(5)}) : température moyenne ${tempVal ?? '—'} °C, précipitations ${pluieVal ?? '—'} mm/an, altitude ${altVal ?? '—'} m, pH estimé (HWSD v1.2) ${phVal ?? '—'}, CEC ${cecVal ?? '—'} cmol(+)/kg, carbone organique ${cosVal ?? '—'} %. Ces valeurs pédologiques issues de bases de données ne remplacent pas une analyse physique en laboratoire.`,
    alternatives ? `Autres cultures évaluées : ${alternatives}.` : '',
    top.vigilances.length > 0 ? `Points de vigilance : ${top.vigilances.join(' ; ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return {
    projet: 'GITAgroIntelligence',
    territoire: territory,
    coordonnees: { lat: validLat, lon: validLon },
    gps_validation: {
      seuil_strict_metres: MAX_GPS_ACCURACY_METERS,
      precision_declaree_metres: validAccuracy,
      note_fiabilite: gpsCheck.noteFiabilite,
    },
    culture_recommandee: top.nom.toUpperCase(),
    explication_cultivateur: explication,
    classement_cultures: classement,
    estimation_economique: estimationEconomique,
    donnees_satellitaires: {
      sources_actives: [
        'Modèle local modele_cultures.joblib',
        'NASA POWER (T2M 2001-2020)',
        'GPM IMERG v07',
        'NASADEM_HGT v001',
        'HWSD v1.2 (estimations 0-30 cm)',
      ],
      pluie_mm: pluieVal,
      pluie_annuelle_mm: pluieVal,
      temp_max_c: tempVal,
      temp_max_moyenne_c: tempVal,
      temp_moyenne_c: tempVal,
      altitude_m: altVal,
      pente_deg: null,
      ph_sol: phVal,
      azote_sol: null,
      argile_pct: null,
      cec_sol: cecVal,
      cos_pct: cosVal,
      ndvi: null,
      historique_ndvi: null,
      nature_donnees: {
        sol: 'Estimations issues de la base pédologique HWSD v1.2 (non équivalent à une analyse physique en laboratoire).',
      },
    },
    prediction_agronomique: {
      culture: top.code,
      moteur: `Modèle embarqué modele_cultures.joblib (${modeleData.version})`,
      donnees_entree_modele: {
        pluie_mm: pluieVal,
        temp_max_c: tempVal,
        altitude_m: altVal,
        pente_deg: null,
        ph_sol: phVal,
        azote_sol: null,
        argile_pct: null,
        historique_ndvi: null,
      },
      analyse_agroecologique: {
        observations: [modeleData.methodologie],
        cultures_a_examiner: ranked.map((r) => r.nom),
      },
    },
  };
}
