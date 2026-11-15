import {
  MapPin,
  LocateFixed,
  Loader2,
  Sprout,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Square,
} from 'lucide-react';
import { LocationState } from '../types/agri.ts';
import {
  MAX_GPS_ACCURACY_METERS,
  formatAccuracyMeters,
  isGpsAccuracyAcceptable,
} from '../utils/gpsValidation.ts';
import { findSudKivuTerritory, isInsideSudKivu } from '../utils/sudKivuGeo.ts';
import { SudKivuMap } from './SudKivuMap.tsx';

interface LocationCardProps {
  location: LocationState;
  onStartGps: () => void;
  onStopGps: () => void;
  onAnalyzeParcel?: () => void;
  isSubmitting?: boolean;
  isEligibleForAnalysis?: boolean;
}

export function LocationCard({
  location,
  onStartGps,
  onStopGps,
  onAnalyzeParcel,
  isSubmitting = false,
  isEligibleForAnalysis = false,
}: LocationCardProps) {
  const { status, lat, lon, accuracyMeters, sampleCount, message } = location;

  const isWatching = status === 'searching' || status === 'insufficient_accuracy';
  const isValidated = status === 'validated' && isGpsAccuracyAcceptable(accuracyMeters);
  const hasCoords = lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);
  const inside = hasCoords ? isInsideSudKivu(lat, lon) : false;
  const territory = hasCoords && inside ? findSudKivuTerritory(lat, lon) : null;

  const canAnalyze = isValidated && inside && isEligibleForAnalysis && !isSubmitting;

  const statusTone = (() => {
    switch (status) {
      case 'validated':
        return inside
          ? 'bg-[#1B4D3E]/10 text-[#1B4D3E] border-[#1B4D3E]/30'
          : 'bg-[#C05621]/10 text-[#8F3A11] border-[#C05621]/35';
      case 'insufficient_accuracy':
        return 'bg-amber-50 text-amber-900 border-amber-300';
      case 'permission_denied':
      case 'error':
        return 'bg-[#C05621]/10 text-[#8F3A11] border-[#C05621]/35';
      case 'searching':
      case 'idle':
      default:
        return 'bg-[#F7F8F5] text-[#1A241E] border-stone-200';
    }
  })();

  const statusTitle = (() => {
    switch (status) {
      case 'searching':
        return 'Acquisition GPS en cours';
      case 'insufficient_accuracy':
        return 'Précision GPS insuffisante (≥ 10 m)';
      case 'validated':
        return inside ? 'Position GPS validée' : 'Position GPS validée (hors Sud-Kivu)';
      case 'permission_denied':
        return 'Autorisation de localisation refusée';
      case 'error':
        return 'Erreur d’acquisition GPS';
      case 'idle':
      default:
        return 'Localisation GPS requise (< 10 m)';
    }
  })();

  return (
    <section
      id="champ"
      aria-labelledby="location-heading"
      className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="location-heading"
            className="text-lg sm:text-xl font-bold text-[#1A241E] tracking-tight"
          >
            1. Position GPS de votre parcelle (Sud-Kivu)
          </h2>
          <p className="mt-1 text-sm text-stone-600 leading-relaxed">
            Pour garantir la fiabilité agronomique, l’application attend une position GPS réelle
            avec une erreur strictement inférieure à{' '}
            <strong className="font-semibold text-[#1A241E]">10 mètres</strong>.
          </p>
        </div>
        <div
          className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${
            isValidated && inside
              ? 'bg-[#1B4D3E]/10 text-[#1B4D3E]'
              : status === 'permission_denied' || status === 'error'
              ? 'bg-[#C05621]/10 text-[#C05621]'
              : status === 'insufficient_accuracy'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-stone-100 text-stone-700'
          }`}
          aria-hidden="true"
        >
          {isWatching ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : isValidated ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : status === 'permission_denied' ? (
            <ShieldAlert className="w-5 h-5" />
          ) : status === 'error' ? (
            <AlertTriangle className="w-5 h-5" />
          ) : (
            <MapPin className="w-5 h-5" />
          )}
        </div>
      </div>

      {/* Live GPS Acquisition Status Panel */}
      <div
        role={status === 'permission_denied' || status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
        className={`rounded-xl border p-4 space-y-2.5 ${statusTone}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-sm">
            {isWatching ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            ) : isValidated ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span>{statusTitle}</span>
          </div>

          <div className="text-xs font-mono font-bold tabular-nums">
            {accuracyMeters !== null
              ? `Précision : ${formatAccuracyMeters(accuracyMeters)} m (seuil < ${MAX_GPS_ACCURACY_METERS} m)`
              : `Seuil requis : < ${MAX_GPS_ACCURACY_METERS} m`}
          </div>
        </div>

        <p className="text-sm leading-relaxed">{message}</p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums opacity-85">
          <span>Mesures collectées : {sampleCount}</span>
          {hasCoords && (
            <span>
              Coordonnées : {lat.toFixed(5)}, {lon.toFixed(5)}
            </span>
          )}
          {territory && <span className="font-sans font-semibold">Zone : {territory}</span>}
        </div>
      </div>

      {/* Interactive Sud-Kivu Map */}
      <SudKivuMap
        lat={lat}
        lon={lon}
        accuracyMeters={accuracyMeters}
        gpsStatus={status}
      />

      {/* GPS Controls & Analyze Parcel Action */}
      <div className="space-y-2.5">
        {onAnalyzeParcel && (
          <button
            type="button"
            onClick={onAnalyzeParcel}
            disabled={!canAnalyze}
            className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#1B4D3E] hover:bg-[#153D31] active:scale-[0.99] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>Analyse de la parcelle en cours...</span>
              </>
            ) : (
              <>
                <Sprout className="w-4 h-4 shrink-0" />
                <span>
                  {!isValidated
                    ? 'Analyser (en attente GPS < 10 m)'
                    : !isEligibleForAnalysis
                    ? 'Analyser (vérification du terrain requise)'
                    : 'Analyser cette parcelle'}
                </span>
              </>
            )}
          </button>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onStartGps}
            disabled={isWatching}
            className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-[#1B4D3E]/8 hover:bg-[#1B4D3E]/14 active:scale-[0.99] text-[#1B4D3E] font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
          >
            {isWatching ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <LocateFixed className="w-4 h-4 shrink-0" />
            )}
            <span className="truncate">
              {isWatching
                ? 'Acquisition haute précision active...'
                : isValidated
                ? 'Actualiser la position GPS'
                : 'Lancer / Réessayer le GPS'}
            </span>
          </button>

          {isWatching && (
            <button
              type="button"
              onClick={onStopGps}
              className="min-h-[48px] px-4 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-[#1A241E] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
            >
              <Square className="w-3.5 h-3.5 shrink-0" />
              <span>Arrêter le GPS</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
