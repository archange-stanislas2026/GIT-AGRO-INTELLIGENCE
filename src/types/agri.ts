export type GpsAcquisitionStatus =
  | 'idle'
  | 'searching'
  | 'insufficient_accuracy'
  | 'validated'
  | 'permission_denied'
  | 'error';

export interface GpsReading {
  lat: number;
  lon: number;
  accuracyMeters: number;
  timestamp: number;
}

export interface LocationState {
  status: GpsAcquisitionStatus;
  lat: number | null;
  lon: number | null;
  accuracyMeters: number | null;
  timestamp?: number;
  sampleCount: number;
  samples: GpsReading[];
  message: string;
}

export interface EstimationFaostat {
  recolte_kg?: number | string | null;
  cout_usd?: number | string | null;
  cout_cdf?: number | string | null;
  benefice_usd?: number | string | null;
  benefice_cdf?: number | string | null;
  [key: string]: unknown;
}

export interface EstimationEconomique {
  culture?: string | null;
  surface_demandee_ares?: number | null;
  surface_financable_estimee_ares?: number | null;
  rendement_prudent_kg_are?: number | null;
  recolte_estimee_kg?: number | null;
  prix_bord_champ_usd_kg?: number | null;
  recette_brute_usd?: number | null;
  couts_variables_estimes_usd?: number | null;
  marge_avant_charges_non_comptabilisees_usd?: number | null;
  recette_brute_cdf?: number | null;
  marge_cdf?: number | null;
  taux_usd_cdf?: number | null;
  source_economique?: string | null;
  [key: string]: unknown;
}

export interface DonneesSatellitesLive {
  sources_actives?: string[] | string | null;
  sources?: string[] | string | null;
  pluie_mm?: number | string | null;
  pluie_annuelle_mm?: number | string | null;
  pluie?: number | string | null;
  precipitation?: number | string | null;
  temp_max_c?: number | string | null;
  temp_max_moyenne_c?: number | string | null;
  temperature?: number | string | null;
  temperature_c?: number | string | null;
  temp_c?: number | string | null;
  altitude_m?: number | string | null;
  altitude?: number | string | null;
  elevation?: number | string | null;
  pente_deg?: number | string | null;
  pente?: number | string | null;
  pente_pourcent?: number | string | null;
  ph_sol?: number | string | null;
  ph?: number | string | null;
  pH?: number | string | null;
  azote_sol?: number | string | null;
  argile_pct?: number | string | null;
  historique_ndvi?: unknown;
  ndvi?: unknown;
  valeurs_secours?: Record<string, unknown> | null;
  mode_secours?: boolean | null;
  annee_climatique?: number | string | null;
  [key: string]: unknown;
}

export interface CropCandidate {
  code: string;
  nom: string;
  score_compatibilite: number;
  raisons_agronomiques: string[];
  points_vigilance: string[];
}

export interface PredictionAgronomique {
  culture?: string | null;
  moteur?: string | null;
  donnees_entree_modele?: DonneesSatellitesLive | null;
  analyse_agroecologique?: {
    observations?: string[];
    cultures_a_examiner?: string[];
  };
  [key: string]: unknown;
}

export interface GpsValidationMetadata {
  seuil_strict_metres: number;
  precision_declaree_metres: number;
  note_fiabilite: string;
}

export type LandEligibilityStatus =
  | 'NOT_SUITABLE'
  | 'PROTECTED_OR_RESTRICTED'
  | 'POTENTIALLY_SUITABLE'
  | 'UNKNOWN';

export type LandEligibilityReasonCode =
  | 'BUILDING'
  | 'ROAD_OR_TRANSPORT'
  | 'MONUMENT_OR_HERITAGE'
  | 'URBAN_OR_INDUSTRIAL'
  | 'PUBLIC_FACILITY'
  | 'PROTECTED_AREA'
  | 'BOUNDARY_UNCERTAINTY_OVERLAP'
  | 'MISSING_PROTECTED_BOUNDARY'
  | 'DATA_UNAVAILABLE'
  | 'PRELIMINARY_ELIGIBLE';

export type GeoFeatureCategory =
  | 'building'
  | 'road'
  | 'monument'
  | 'urban'
  | 'public_facility'
  | 'protected_area'
  | 'farmland_context';

export interface MatchedGeoFeature {
  source: string;
  category: GeoFeatureCategory;
  label: string;
  name?: string | null;
  tags?: Record<string, string>;
  legalDesignation?: string | null;
  iucnCategory?: string | null;
  legalStatus?: string | null;
  distanceMeters: number;
  overlapsCenterPoint: boolean;
  overlapsUncertaintyCircle: boolean;
}

export interface LandEligibilityReport {
  status: LandEligibilityStatus;
  statusLabel: string;
  reasonCode: LandEligibilityReasonCode;
  eligibleForAnalysis: boolean;
  requiresVerification: boolean;
  userMessage: string;
  authorityGuidance?: string | null;
  limitationsNote: string;
  gpsAccuracyMeters: number;
  checkedAtIso: string;
  territoire?: string | null;
  matchedFeatures: MatchedGeoFeature[];
  sources: {
    landUseService: 'OK' | 'UNAVAILABLE';
    landUseProvider: string;
    protectedAreaService: 'OK' | 'UNAVAILABLE';
    protectedAreaProvider: string;
    errors?: string[];
  };
}

export interface RecommendationResponse {
  territoire?: string | null;
  coordonnees?: { lat: number; lon: number };
  gps_validation?: GpsValidationMetadata;
  eligibilite?: LandEligibilityReport;
  culture_recommandee?: string | Record<string, unknown> | null;
  explication_cultivateur?: string | Record<string, unknown> | null;
  classement_cultures?: CropCandidate[] | null;
  estimation_faostat?: EstimationFaostat | null;
  estimation_economique?: EstimationEconomique | null;
  prediction_agronomique?: PredictionAgronomique | null;
  donnees_satellitaires?: DonneesSatellitesLive | null;
  donnees_satellites_live?: DonneesSatellitesLive | null;
  donnees_satellites?: DonneesSatellitesLive | null;
  donnees_nasa_temps_reel?: DonneesSatellitesLive | null;
  donnees_insuffisantes?: boolean;
  [key: string]: unknown;
}

