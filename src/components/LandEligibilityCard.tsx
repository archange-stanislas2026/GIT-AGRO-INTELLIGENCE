import {
  ShieldCheck,
  ShieldAlert,
  Ban,
  HelpCircle,
  Loader2,
  RotateCcw,
  LocateFixed,
  Info,
  CheckSquare,
  Square,
} from 'lucide-react';
import type { LandEligibilityReport } from '../types/agri';

interface LandEligibilityCardProps {
  isGpsValidated: boolean;
  insideSudKivu: boolean;
  isChecking: boolean;
  report: LandEligibilityReport | null;
  checkError: string | null;
  legalConfirmed: boolean;
  onLegalConfirmedChange: (confirmed: boolean) => void;
  onRetryCheck: () => void;
  onRefreshGps: () => void;
}

export function LandEligibilityCard({
  isGpsValidated,
  insideSudKivu,
  isChecking,
  report,
  checkError,
  legalConfirmed,
  onLegalConfirmedChange,
  onRetryCheck,
  onRefreshGps,
}: LandEligibilityCardProps) {
  const readyForVerification = isGpsValidated && insideSudKivu;

  const toneClasses = (() => {
    if (!readyForVerification) {
      return 'bg-[#F7F8F5] border-stone-200 text-stone-700';
    }
    if (isChecking) {
      return 'bg-[#F7F8F5] border-stone-200 text-[#1A241E]';
    }
    if (checkError || !report || report.status === 'UNKNOWN') {
      return 'bg-amber-50 border-amber-300 text-amber-950';
    }
    if (report.status === 'NOT_SUITABLE' || report.status === 'PROTECTED_OR_RESTRICTED') {
      return 'bg-[#C05621]/10 border-[#C05621]/40 text-[#7C2D12]';
    }
    return 'bg-[#1B4D3E]/[0.07] border-[#1B4D3E]/30 text-[#1B4D3E]';
  })();

  const statusIcon = (() => {
    if (isChecking) return <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />;
    if (!readyForVerification) return <HelpCircle className="w-5 h-5 shrink-0 text-stone-500" aria-hidden="true" />;
    if (checkError || !report || report.status === 'UNKNOWN') {
      return <HelpCircle className="w-5 h-5 shrink-0 text-amber-700" aria-hidden="true" />;
    }
    if (report.status === 'PROTECTED_OR_RESTRICTED') {
      return <ShieldAlert className="w-5 h-5 shrink-0 text-[#C05621]" aria-hidden="true" />;
    }
    if (report.status === 'NOT_SUITABLE') {
      return <Ban className="w-5 h-5 shrink-0 text-[#C05621]" aria-hidden="true" />;
    }
    return <ShieldCheck className="w-5 h-5 shrink-0 text-[#1B4D3E]" aria-hidden="true" />;
  })();

  return (
    <section
      id="eligibilite"
      aria-labelledby="eligibility-heading"
      className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2
            id="eligibility-heading"
            className="text-lg sm:text-xl font-bold text-[#1A241E] tracking-tight"
          >
            2. Vérification du terrain et zones protégées
          </h2>
          <p className="mt-1 text-sm text-stone-600 leading-relaxed">
            Avant toute analyse agricole, nous vérifions que les coordonnées ne correspondent pas à
            un bâtiment, une route, une zone urbaine ou une aire protégée (OpenStreetMap &amp;
            WDPA).
          </p>
        </div>
      </div>

      {/* Main Verification Panel */}
      <div
        role={
          report?.status === 'NOT_SUITABLE' ||
          report?.status === 'PROTECTED_OR_RESTRICTED' ||
          report?.status === 'UNKNOWN' ||
          checkError
            ? 'alert'
            : 'status'
        }
        aria-live="polite"
        className={`rounded-xl border p-4 space-y-3 ${toneClasses}`}
      >
        {!readyForVerification ? (
          <div className="flex items-start gap-2.5 text-sm">
            {statusIcon}
            <p className="leading-relaxed">
              En attente d’une position GPS validée (&lt; 10 m) à l’intérieur du Sud-Kivu pour
              lancer la vérification d’occupation du sol et des aires protégées.
            </p>
          </div>
        ) : isChecking ? (
          <div className="flex items-start gap-2.5 text-sm">
            {statusIcon}
            <div className="space-y-1">
              <div className="font-bold">Vérification cartographique en cours...</div>
              <p className="text-stone-600 leading-relaxed">
                Contrôle de l’occupation du sol (OpenStreetMap) et des aires protégées (WDPA /
                Protected Planet) autour de votre position GPS.
              </p>
            </div>
          </div>
        ) : checkError || !report ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2.5">
              {statusIcon}
              <div className="space-y-1">
                <div className="font-bold text-sm">Données insuffisantes / À vérifier</div>
                <p className="text-sm leading-relaxed">
                  {checkError ||
                    'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onRetryCheck}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>Réessayer la vérification du terrain</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-sm sm:text-base">
                {statusIcon}
                <span>{report.statusLabel}</span>
              </div>
              <span className="text-xs font-mono tabular-nums opacity-80">
                Rayon GPS : ±{report.gpsAccuracyMeters.toFixed(1)} m
              </span>
            </div>

            <p className="text-sm leading-relaxed font-medium">{report.userMessage}</p>

            {report.authorityGuidance && (
              <p className="text-xs sm:text-sm leading-relaxed bg-white/70 rounded-lg border border-current/15 p-3">
                {report.authorityGuidance}
              </p>
            )}

            {/* Matched geographic features */}
            {report.matchedFeatures.length > 0 && (
              <div className="rounded-lg bg-white/80 border border-stone-200/80 p-3 space-y-2 text-[#1A241E]">
                <div className="text-xs font-semibold text-stone-600">
                  Éléments cartographiques détectés à cette position :
                </div>
                <ul className="space-y-1.5 text-xs">
                  {report.matchedFeatures.slice(0, 5).map((feat, idx) => (
                    <li
                      key={`${feat.label}-${idx}`}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-stone-100 last:border-0 pb-1 last:pb-0"
                    >
                      <span className="font-semibold">
                        {feat.label}
                        {feat.name ? ` — ${feat.name}` : ''}
                        {feat.iucnCategory ? ` (UICN ${feat.iucnCategory})` : ''}
                        {feat.legalStatus ? ` [${feat.legalStatus}]` : ''}
                      </span>
                      <span className="font-mono text-stone-600 tabular-nums">
                        {feat.overlapsCenterPoint
                          ? 'Point inclus'
                          : `À ${feat.distanceMeters} m (dans rayon GPS)`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Sources provenance */}
            <div className="text-xs text-stone-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Occupation du sol :{' '}
                <strong className="font-semibold text-[#1A241E]">
                  {report.sources.landUseProvider}
                </strong>
              </span>
              <span>
                Aires protégées :{' '}
                <strong className="font-semibold text-[#1A241E]">
                  {report.sources.protectedAreaProvider}
                </strong>
              </span>
            </div>

            {/* Legal authorization confirmation when POTENTIALLY_SUITABLE */}
            {report.status === 'POTENTIALLY_SUITABLE' && (
              <button
                type="button"
                role="checkbox"
                aria-checked={legalConfirmed}
                onClick={() => onLegalConfirmedChange(!legalConfirmed)}
                className={`w-full min-h-[50px] px-4 py-3 rounded-xl border text-left flex items-center gap-3 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E] ${
                  legalConfirmed
                    ? 'bg-[#1B4D3E] text-white border-[#1B4D3E]'
                    : 'bg-white text-[#1A241E] border-[#1B4D3E]/40 hover:bg-[#1B4D3E]/5'
                }`}
              >
                {legalConfirmed ? (
                  <CheckSquare className="w-5 h-5 shrink-0" aria-hidden="true" />
                ) : (
                  <Square className="w-5 h-5 shrink-0 text-[#1B4D3E]" aria-hidden="true" />
                )}
                <span className="text-sm font-semibold leading-snug">
                  Je confirme être légalement autorisé(e) à cultiver cette parcelle
                </span>
              </button>
            )}

            {/* Action buttons for blocked or unknown status */}
            {report.status === 'UNKNOWN' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={onRetryCheck}
                  className="flex-1 min-h-[46px] px-4 py-2.5 rounded-xl bg-amber-800 hover:bg-amber-900 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 shrink-0" />
                  <span>Réessayer la vérification</span>
                </button>
                <button
                  type="button"
                  onClick={onRefreshGps}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <LocateFixed className="w-4 h-4 shrink-0" />
                  <span>Actualiser GPS</span>
                </button>
              </div>
            )}

            {(report.status === 'NOT_SUITABLE' || report.status === 'PROTECTED_OR_RESTRICTED') && (
              <button
                type="button"
                onClick={onRefreshGps}
                className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-[#C05621] hover:bg-[#A6481A] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <LocateFixed className="w-4 h-4 shrink-0" />
                <span>Me déplacer sur la parcelle et actualiser le GPS</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Explicit geographic data limitations note */}
      <div className="flex items-start gap-2.5 text-xs text-stone-600 leading-relaxed">
        <Info className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" aria-hidden="true" />
        <p>{report?.limitationsNote || 'Les données cartographiques OpenStreetMap et WDPA constituent un filtrage préliminaire et ne remplacent pas une vérification foncière locale.'}</p>
      </div>
    </section>
  );
}
