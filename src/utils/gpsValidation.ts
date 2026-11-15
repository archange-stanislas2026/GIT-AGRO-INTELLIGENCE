import { OUTSIDE_SUD_KIVU_MESSAGE, isInsideSudKivu } from './sudKivuGeo.ts';

export const MAX_GPS_ACCURACY_METERS = 15;
export const MAX_PLAUSIBLE_GPS_ACCURACY_METERS = 100_000;
export const MAX_GPS_AGE_MS = 30 * 60 * 1000;
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const GPS_MESSAGES = {
  searching: "Recherche d'une position GPS précise...",
  stabilizing: 'Position précise détectée — confirmation de stabilité en cours...',
  insufficientAccuracy:
    "Précision GPS insuffisante. Veuillez rester immobile dans un endroit dégagé jusqu'à obtenir une précision inférieure ou égale à 15 mètres.",
  permissionDenied:
    'Autorisation de localisation refusée. Veuillez activer la localisation pour continuer.',
  unavailable:
    "Signal GPS indisponible. Vérifiez que le service de localisation (GPS) de l'appareil est activé puis réessayez.",
  timeout:
    "Délai d'acquisition GPS dépassé avant d'obtenir une précision inférieure ou égale à 15 mètres. Placez-vous dans un endroit dégagé et réessayez.",
  cancelled:
    'Recherche GPS arrêtée. Lancez une nouvelle acquisition pour obtenir une précision inférieure ou égale à 15 mètres.',
  unsupported:
    "La géolocalisation haute précision n'est pas prise en charge par ce navigateur ou cet appareil.",
} as const;

export function formatGpsValidatedMessage(accuracyMeters: number): string {
  return `Position GPS validée ! Précision : ${formatAccuracyMeters(accuracyMeters)} mètres.`;
}

export function formatAccuracyMeters(accuracyMeters: number): string {
  if (!Number.isFinite(accuracyMeters)) return '—';
  const flooredToTenth =
    accuracyMeters <= MAX_GPS_ACCURACY_METERS && accuracyMeters >= 15.05
      ? 15.0
      : Number(accuracyMeters.toFixed(1));
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: flooredToTenth % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  }).format(flooredToTenth);
}

/**
 * GPS accuracy rule:
 * Position accepted when device-reported accuracy is <= 15 meters and > 0 meters.
 * Accuracy > 15 meters (e.g. 15.1 m) is rejected.
 */
export function isGpsAccuracyAcceptable(accuracyMeters: unknown): accuracyMeters is number {
  return (
    typeof accuracyMeters === 'number' &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters > 0 &&
    accuracyMeters <= MAX_GPS_ACCURACY_METERS
  );
}

export function parseStrictNumeric(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface GpsMeasurementSampleInput {
  lat: number;
  lon: number;
  accuracyMeters: number;
  timestamp: number;
}

export interface GpsValidationInput {
  lat: unknown;
  lon: unknown;
  accuracyMeters: unknown;
  timestamp?: unknown;
  sampleCount?: unknown;
  measurements?: unknown;
  nowMs?: number;
}

export interface GpsValidationResult {
  valid: boolean;
  code?:
    | 'INVALID_COORDINATES'
    | 'MISSING_ACCURACY'
    | 'INVALID_ACCURACY'
    | 'INSUFFICIENT_ACCURACY'
    | 'IMPLAUSIBLE_GPS_METADATA'
    | 'OUTSIDE_SUD_KIVU';
  error?: string;
  lat?: number;
  lon?: number;
  accuracyMeters?: number;
  noteFiabilite: string;
}

const GPS_METADATA_TRUST_NOTE =
  'Métadonnées GPS fournies par le navigateur vérifiées (format, plausibilité et seuil strict < 10 m). Elles ne constituent pas une preuve cryptographique de localisation physique.';

export function validateGpsSubmission(input: GpsValidationInput): GpsValidationResult {
  const lat = parseStrictNumeric(input.lat);
  const lon = parseStrictNumeric(input.lon);

  if (
    lat === null ||
    lon === null ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6)
  ) {
    return {
      valid: false,
      code: 'INVALID_COORDINATES',
      error: 'Coordonnées GPS invalides ou hors plage géographique.',
      noteFiabilite: GPS_METADATA_TRUST_NOTE,
    };
  }

  if (
    input.accuracyMeters === undefined ||
    input.accuracyMeters === null ||
    String(input.accuracyMeters).trim() === ''
  ) {
    return {
      valid: false,
      code: 'MISSING_ACCURACY',
      error:
        'Précision GPS requise : aucune mesure de précision en mètres n’a été fournie (seuil strict < 10 mètres).',
      noteFiabilite: GPS_METADATA_TRUST_NOTE,
    };
  }

  const accuracy = parseStrictNumeric(input.accuracyMeters);
  if (accuracy === null || accuracy <= 0 || accuracy > MAX_PLAUSIBLE_GPS_ACCURACY_METERS) {
    return {
      valid: false,
      code: 'INVALID_ACCURACY',
      error: 'Valeur de précision GPS invalide ou implausible.',
      noteFiabilite: GPS_METADATA_TRUST_NOTE,
    };
  }

  if (!isGpsAccuracyAcceptable(accuracy)) {
    return {
      valid: false,
      code: 'INSUFFICIENT_ACCURACY',
      error: `Précision GPS insuffisante (${formatAccuracyMeters(accuracy)} m). Une précision strictement inférieure à 10 mètres est exigée avant toute analyse.`,
      noteFiabilite: GPS_METADATA_TRUST_NOTE,
    };
  }

  const nowMs = input.nowMs ?? Date.now();
  if (input.timestamp !== undefined && input.timestamp !== null && String(input.timestamp).trim() !== '') {
    const ts = parseStrictNumeric(input.timestamp);
    if (
      ts === null ||
      ts > nowMs + MAX_FUTURE_CLOCK_SKEW_MS ||
      ts < nowMs - MAX_GPS_AGE_MS
    ) {
      return {
        valid: false,
        code: 'IMPLAUSIBLE_GPS_METADATA',
        error: 'Horodatage de mesure GPS expiré ou incohérent. Veuillez relancer l’acquisition GPS.',
        noteFiabilite: GPS_METADATA_TRUST_NOTE,
      };
    }
  }

  if (input.sampleCount !== undefined && input.sampleCount !== null && String(input.sampleCount).trim() !== '') {
    const count = parseStrictNumeric(input.sampleCount);
    if (count === null || !Number.isInteger(count) || count < 1 || count > 500) {
      return {
        valid: false,
        code: 'IMPLAUSIBLE_GPS_METADATA',
        error: 'Nombre de mesures GPS invalide.',
        noteFiabilite: GPS_METADATA_TRUST_NOTE,
      };
    }
  }

  if (Array.isArray(input.measurements) && input.measurements.length > 0) {
    let minReportedAccuracy = Infinity;
    for (const item of input.measurements) {
      if (!item || typeof item !== 'object') {
        return {
          valid: false,
          code: 'IMPLAUSIBLE_GPS_METADATA',
          error: 'Historique de mesures GPS mal formé.',
          noteFiabilite: GPS_METADATA_TRUST_NOTE,
        };
      }
      const rec = item as Record<string, unknown>;
      const mLat = parseStrictNumeric(rec.lat);
      const mLon = parseStrictNumeric(rec.lon);
      const mAcc = parseStrictNumeric(rec.accuracyMeters ?? rec.accuracy);
      if (
        mLat === null ||
        mLon === null ||
        mAcc === null ||
        mLat < -90 ||
        mLat > 90 ||
        mLon < -180 ||
        mLon > 180 ||
        mAcc <= 0 ||
        mAcc > MAX_PLAUSIBLE_GPS_ACCURACY_METERS
      ) {
        return {
          valid: false,
          code: 'IMPLAUSIBLE_GPS_METADATA',
          error: 'Une mesure GPS transmise contient des valeurs invalides.',
          noteFiabilite: GPS_METADATA_TRUST_NOTE,
        };
      }
      if (mAcc < minReportedAccuracy) {
        minReportedAccuracy = mAcc;
      }
    }

    // Prevent claiming better accuracy than any actual device-reported measurement
    if (accuracy + 1e-6 < minReportedAccuracy) {
      return {
        valid: false,
        code: 'IMPLAUSIBLE_GPS_METADATA',
        error:
          'Incohérence détectée : la précision déclarée ne peut pas être meilleure que la précision réelle renvoyée par le récepteur GPS.',
        noteFiabilite: GPS_METADATA_TRUST_NOTE,
      };
    }
  }

  if (!isInsideSudKivu(lat, lon)) {
    return {
      valid: false,
      code: 'OUTSIDE_SUD_KIVU',
      error: OUTSIDE_SUD_KIVU_MESSAGE,
      lat,
      lon,
      accuracyMeters: accuracy,
      noteFiabilite: GPS_METADATA_TRUST_NOTE,
    };
  }

  return {
    valid: true,
    lat,
    lon,
    accuracyMeters: accuracy,
    noteFiabilite: GPS_METADATA_TRUST_NOTE,
  };
}
