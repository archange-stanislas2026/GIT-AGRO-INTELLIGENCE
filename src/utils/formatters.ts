export const BUKAVU_FALLBACK = {
  lat: -2.4908,
  lon: 28.8428,
} as const;

export const USD_TO_CDF_RATE = 2350;

export const DEFAULT_API_URL = '/api';

export function parseNumeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

export function formatNumberFr(value: number | string | null | undefined, maxDecimals = 1): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = parseNumeric(value);
  if (numeric === null) {
    return String(value);
  }
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: maxDecimals,
  }).format(numeric);
}

export function formatUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = parseNumeric(value);
  if (numeric === null) {
    return String(value);
  }
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric)} $`;
}

export function formatCdf(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = parseNumeric(value);
  if (numeric === null) {
    return String(value);
  }
  return `${new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 0,
  }).format(Math.round(numeric))} FC`;
}

export function formatCoord(value: number): string {
  return value.toFixed(4);
}
