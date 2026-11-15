import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { DonneesSatellitesLive } from '../types/agri.ts';

export interface ParcelModelFeatures {
  pluie_mm: number | null;
  temp_max_c: number | null;
  temp_moyenne_c: number | null;
  altitude_m: number | null;
  pente_deg: number | null;
  ph_sol: number | null;
  azote_sol: number | null;
  argile_pct: number | null;
  lat: number;
  lon: number;
  budget_usd: number;
  surface_ares: number;
}

export interface JoblibDetailedCandidate {
  code: string;
  nom: string;
  score_final: number;
  score_ahp: number;
  classe_aptitude: string;
  raisons_agronomiques: string[];
  points_vigilance: string[];
}

export type LocalModelInferenceResult =
  | { found: false }
  | {
      found: true;
      ok: true;
      modelFile: string;
      engineLabel: string;
      culture: string;
      probabilites: Record<string, number>;
      featuresUsed: Record<string, number | null>;
      classementDetaille?: JoblibDetailedCandidate[];
      celluleGrille?: Record<string, unknown>;
    }
  | {
      found: true;
      ok: false;
      modelFile: string;
      error: string;
      detail: string;
    };

interface ExportedTree {
  children_left: number[];
  children_right: number[];
  feature: number[];
  threshold: number[];
  value: number[][];
}

interface ExportedSklearnJson {
  format: 'gitagro_sklearn_export_v1';
  source_joblib?: string;
  estimator_type: string;
  feature_names: string[];
  n_features: number;
  classes: string[];
  preprocessing?: Array<
    | { type: 'SimpleImputer'; statistics: number[] }
    | { type: 'StandardScaler'; mean: number[]; scale: number[] }
  >;
  trees?: ExportedTree[];
  coef?: number[][];
  intercept?: number[];
}

const FEATURE_ALIASES: Record<string, keyof ParcelModelFeatures> = {
  pluie: 'pluie_mm',
  pluie_mm: 'pluie_mm',
  pluie_annuelle: 'pluie_mm',
  pluie_annuelle_mm: 'pluie_mm',
  precipitation: 'pluie_mm',
  precipitations: 'pluie_mm',
  rain: 'pluie_mm',
  rainfall: 'pluie_mm',
  prectotcorr: 'pluie_mm',
  temp: 'temp_max_c',
  temp_c: 'temp_max_c',
  temp_max: 'temp_max_c',
  temp_max_c: 'temp_max_c',
  temp_max_moyenne_c: 'temp_max_c',
  temperature: 'temp_max_c',
  temperature_max: 'temp_max_c',
  t2m_max: 'temp_max_c',
  temp_moy: 'temp_moyenne_c',
  temp_moyenne: 'temp_moyenne_c',
  temp_moyenne_c: 'temp_moyenne_c',
  t2m: 'temp_moyenne_c',
  altitude: 'altitude_m',
  altitude_m: 'altitude_m',
  elevation: 'altitude_m',
  elevation_m: 'altitude_m',
  pente: 'pente_deg',
  pente_deg: 'pente_deg',
  slope: 'pente_deg',
  slope_deg: 'pente_deg',
  ph: 'ph_sol',
  ph_sol: 'ph_sol',
  phh2o: 'ph_sol',
  azote: 'azote_sol',
  azote_sol: 'azote_sol',
  nitrogen: 'azote_sol',
  n: 'azote_sol',
  argile: 'argile_pct',
  argile_pct: 'argile_pct',
  clay: 'argile_pct',
  lat: 'lat',
  latitude: 'lat',
  lon: 'lon',
  lng: 'lon',
  longitude: 'lon',
  budget: 'budget_usd',
  budget_usd: 'budget_usd',
  surface: 'surface_ares',
  surface_ares: 'surface_ares',
};

const DEFAULT_FEATURE_ORDER: Array<keyof ParcelModelFeatures> = [
  'pluie_mm',
  'temp_max_c',
  'altitude_m',
  'pente_deg',
  'ph_sol',
  'azote_sol',
  'argile_pct',
];

function resolveFeature(name: string, features: ParcelModelFeatures): number | null {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  const mappedKey = FEATURE_ALIASES[normalized];
  if (!mappedKey) return null;
  const val = features[mappedKey];
  return typeof val === 'number' && Number.isFinite(val) ? val : null;
}

function runJsonExportedModel(
  modelFile: string,
  spec: ExportedSklearnJson,
  features: ParcelModelFeatures
): LocalModelInferenceResult {
  const orderedNames =
    spec.feature_names.length > 0
      ? spec.feature_names
      : DEFAULT_FEATURE_ORDER.slice(0, spec.n_features || DEFAULT_FEATURE_ORDER.length);

  const featuresUsed: Record<string, number | null> = {};
  const vec: number[] = orderedNames.map((name) => {
    const val = resolveFeature(name, features);
    featuresUsed[name] = val;
    return val === null ? Number.NaN : val;
  });

  // Apply exported scikit-learn Pipeline preprocessing steps
  if (spec.preprocessing) {
    for (const step of spec.preprocessing) {
      if (step.type === 'SimpleImputer') {
        for (let i = 0; i < vec.length; i++) {
          if (!Number.isFinite(vec[i])) {
            vec[i] = step.statistics[i] ?? 0;
          }
        }
      } else if (step.type === 'StandardScaler') {
        for (let i = 0; i < vec.length; i++) {
          const val = Number.isFinite(vec[i]) ? vec[i] : step.mean[i] ?? 0;
          const sc = step.scale[i] || 1;
          vec[i] = (val - (step.mean[i] ?? 0)) / sc;
        }
      }
    }
  }

  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i])) vec[i] = 0;
  }

  const numClasses = spec.classes.length;
  if (numClasses === 0) {
    return {
      found: true,
      ok: false,
      modelFile,
      error: 'INVALID_EXPORTED_MODEL',
      detail: `Le modèle ${modelFile} ne contient aucune classe de culture.`,
    };
  }

  const classProbs = new Array<number>(numClasses).fill(0);

  if (spec.trees && spec.trees.length > 0) {
    for (const tree of spec.trees) {
      let node = 0;
      while (tree.children_left[node] !== -1 && tree.children_right[node] !== -1) {
        const featIdx = tree.feature[node];
        const thr = tree.threshold[node];
        node = (vec[featIdx] ?? 0) <= thr ? tree.children_left[node] : tree.children_right[node];
      }
      const counts = tree.value[node] ?? [];
      const sum = counts.reduce((acc, v) => acc + v, 0) || 1;
      for (let c = 0; c < numClasses; c++) {
        classProbs[c] += (counts[c] ?? 0) / sum;
      }
    }
    for (let c = 0; c < numClasses; c++) {
      classProbs[c] /= spec.trees.length;
    }
  } else if (spec.coef && spec.intercept) {
    const logits = spec.coef.map((weights, idx) => {
      let z = spec.intercept?.[idx] ?? 0;
      for (let i = 0; i < vec.length; i++) z += (weights[i] ?? 0) * vec[i];
      return z;
    });
    if (numClasses === 2 && logits.length === 1) {
      const p1 = 1 / (1 + Math.exp(-logits[0]));
      classProbs[0] = 1 - p1;
      classProbs[1] = p1;
    } else {
      const maxLogit = Math.max(...logits);
      const exps = logits.map((l) => Math.exp(l - maxLogit));
      const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
      for (let c = 0; c < numClasses; c++) {
        classProbs[c] = (exps[c] ?? 0) / sumExp;
      }
    }
  } else {
    return {
      found: true,
      ok: false,
      modelFile,
      error: 'UNSUPPORTED_EXPORT_STRUCTURE',
      detail: `Structure de modèle non reconnue dans ${modelFile}.`,
    };
  }

  let bestIdx = 0;
  for (let c = 1; c < numClasses; c++) {
    if (classProbs[c] > classProbs[bestIdx]) bestIdx = c;
  }

  const probabilites: Record<string, number> = {};
  for (let c = 0; c < numClasses; c++) {
    probabilites[spec.classes[c]] = Number(classProbs[c].toFixed(4));
  }

  return {
    found: true,
    ok: true,
    modelFile,
    engineLabel: `Modèle local ${spec.estimator_type} (${modelFile})`,
    culture: spec.classes[bestIdx],
    probabilites,
    featuresUsed,
  };
}

function runPythonJoblib(
  modelsDir: string,
  joblibPath: string,
  features: ParcelModelFeatures
): Promise<LocalModelInferenceResult> {
  const scriptPath = path.join(modelsDir, 'predict_joblib.py');
  const modelFile = path.basename(joblibPath);

  if (!fs.existsSync(scriptPath)) {
    return Promise.resolve({
      found: true,
      ok: false,
      modelFile,
      error: 'MISSING_SCRIPT',
      detail: 'Le script models/predict_joblib.py est introuvable pour lire le fichier .joblib.',
    });
  }

  return new Promise((resolve) => {
    const child = execFile(
      'python3',
      [scriptPath],
      { timeout: 6000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const trimmed = stdout.trim();
        if (trimmed) {
          try {
            const parsed = JSON.parse(trimmed) as {
              ok: boolean;
              model_type?: string;
              methodologie?: string;
              culture?: string;
              probabilites?: Record<string, number>;
              features_used?: Record<string, number | null>;
              classement_detaille?: JoblibDetailedCandidate[];
              cellule_grille?: Record<string, unknown>;
              error?: string;
              detail?: string;
            };
            if (parsed.ok && parsed.culture) {
              resolve({
                found: true,
                ok: true,
                modelFile,
                engineLabel:
                  parsed.model_type === 'fao_ahp_spatial'
                    ? `Modèle local .joblib (${modelFile} · FAO / AHP)`
                    : `Modèle local .joblib (${modelFile})`,
                culture: parsed.culture,
                probabilites: parsed.probabilites ?? {},
                featuresUsed: parsed.features_used ?? {},
                classementDetaille: parsed.classement_detaille,
                celluleGrille: parsed.cellule_grille,
              });
              return;
            }
            resolve({
              found: true,
              ok: false,
              modelFile,
              error: parsed.error || 'JOBLIB_EXECUTION_ERROR',
              detail:
                parsed.detail ||
                `Impossible d'exécuter ${modelFile} avec Python.`,
            });
            return;
          } catch {
            // fall through to error
          }
        }
        resolve({
          found: true,
          ok: false,
          modelFile,
          error: 'PYTHON_PROCESS_ERROR',
          detail:
            stderr?.trim() ||
            err?.message ||
            `Erreur lors de l'exécution Python de ${modelFile}.`,
        });
      }
    );

    child.stdin?.write(JSON.stringify({ model_path: joblibPath, features }));
    child.stdin?.end();
  });
}

export async function runLocalModelIfPresent(params: {
  rootDir: string;
  satellite: DonneesSatellitesLive;
  lat: number;
  lon: number;
  budgetUsd: number;
  surfaceAres: number;
}): Promise<LocalModelInferenceResult> {
  const modelsDir = path.join(params.rootDir, 'models');
  if (!fs.existsSync(modelsDir)) {
    return { found: false };
  }

  const entries = fs.readdirSync(modelsDir);
  const toNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v.replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const features: ParcelModelFeatures = {
    pluie_mm: toNum(params.satellite.pluie_annuelle_mm ?? params.satellite.pluie_mm),
    temp_max_c: toNum(params.satellite.temp_max_moyenne_c ?? params.satellite.temp_max_c),
    temp_moyenne_c: toNum(params.satellite.temp_moyenne_c),
    altitude_m: toNum(params.satellite.altitude_m),
    pente_deg: toNum(params.satellite.pente_deg),
    ph_sol: toNum(params.satellite.ph_sol),
    azote_sol: toNum(params.satellite.azote_sol),
    argile_pct: toNum(params.satellite.argile_pct),
    lat: params.lat,
    lon: params.lon,
    budget_usd: params.budgetUsd,
    surface_ares: params.surfaceAres,
  };

  // 1. Prefer exported JSON model inside /models/ (runs natively in Node.js with 0 Python ML deps)
  const jsonCandidates = entries.filter((f) => f.toLowerCase().endsWith('.json'));
  const preferredJson =
    jsonCandidates.find((f) => f === 'modele_cultures.json') ?? jsonCandidates[0];
  if (preferredJson) {
    try {
      const raw = fs.readFileSync(path.join(modelsDir, preferredJson), 'utf8');
      const spec = JSON.parse(raw) as ExportedSklearnJson;
      if (spec.format === 'gitagro_sklearn_export_v1') {
        return runJsonExportedModel(preferredJson, spec, features);
      }
    } catch (err) {
      return {
        found: true,
        ok: false,
        modelFile: preferredJson,
        error: 'INVALID_JSON_MODEL',
        detail:
          err instanceof Error
            ? `Erreur de lecture de models/${preferredJson} : ${err.message}`
            : `Impossible de lire models/${preferredJson}.`,
      };
    }
  }

  // 2. Otherwise check for a .joblib model inside /models/ and run via Python
  const joblibCandidates = entries.filter((f) => f.toLowerCase().endsWith('.joblib'));
  const preferredJoblib =
    joblibCandidates.find((f) => f === 'modele_cultures.joblib') ?? joblibCandidates[0];
  if (preferredJoblib) {
    return runPythonJoblib(modelsDir, path.join(modelsDir, preferredJoblib), features);
  }

  return { found: false };
}
