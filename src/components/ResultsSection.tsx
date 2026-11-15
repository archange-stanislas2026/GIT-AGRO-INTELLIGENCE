import { Sprout, AlertCircle, Loader2, RotateCcw, Scale, TrendingUp, Info } from 'lucide-react';
import { RecommendationResponse } from '../types/agri';
import { USD_TO_CDF_RATE, formatCdf, formatNumberFr, formatUsd, parseNumeric } from '../utils/formatters';

function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const joined = value.map(safeString).filter(Boolean).join(', ');
    return joined || null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const preferred = obj.texte ?? obj.text ?? obj.description ?? obj.nom ?? obj.name ?? obj.message;
    if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
    const parts = Object.values(obj).map(safeString).filter(Boolean);
    return parts.length > 0 ? parts.join(' — ') : null;
  }
  return null;
}

interface ResultsSectionProps {
  result: RecommendationResponse | null;
  isLoading: boolean;
  elapsedSeconds: number;
  errorMessage: string | null;
  isGpsValidated: boolean;
  isLandEligible: boolean;
  onRetry: () => void;
}

export function ResultsSection({
  result,
  isLoading,
  elapsedSeconds,
  errorMessage,
  isGpsValidated,
  isLandEligible,
  onRetry,
}: ResultsSectionProps) {
  if (isLoading) {
    return (
      <section
        id="resultats"
        aria-live="polite"
        className="bg-white border border-stone-200 rounded-2xl p-6 sm:p-8 text-center"
      >
        <div className="w-14 h-14 mx-auto rounded-2xl bg-[#1B4D3E]/10 text-[#1B4D3E] flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin" />
        </div>
        <h2 className="mt-4 text-xl font-bold text-[#1A241E]">
          Analyse des satellites NASA en cours...
        </h2>
        <p className="mt-2 text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
          {elapsedSeconds >= 5
            ? 'Lecture des données pluie, altitude, pente et base pédologique de votre parcelle en cours. Merci de patienter quelques secondes.'
            : 'Lecture des mesures climatiques, topographiques et pédologiques pour votre position GPS validée au Sud-Kivu.'}
        </p>
        <p className="mt-4 text-xs font-mono tabular-nums text-stone-500">
          Temps écoulé : {elapsedSeconds} s
        </p>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section
        id="resultats"
        role="alert"
        className="bg-white border border-[#C05621]/40 rounded-2xl p-6 space-y-4"
      >
        <div className="flex items-start gap-3.5">
          <div className="shrink-0 w-11 h-11 rounded-xl bg-[#C05621]/10 text-[#C05621] flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#1A241E]">
              Impossible d'obtenir le conseil pour le moment
            </h2>
            <p className="mt-1 text-sm text-stone-700 leading-relaxed break-words">
              {errorMessage}
            </p>
          </div>
        </div>
        {isGpsValidated && isLandEligible && (
          <button
            type="button"
            onClick={onRetry}
            className="w-full min-h-[50px] px-5 py-3 rounded-xl bg-[#C05621] hover:bg-[#A6481A] text-white font-semibold text-base flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C05621]"
          >
            <RotateCcw className="w-5 h-5 shrink-0" />
            <span>Réessayer l'analyse</span>
          </button>
        )}
      </section>
    );
  }

  // Strictly block displaying any satellite or soil analysis results while GPS or land eligibility is not validated
  if (!result || !isGpsValidated || !isLandEligible) {
    return (
      <section
        id="resultats"
        className="hidden lg:block bg-white border border-stone-200 rounded-2xl p-6"
      >
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-[#1B4D3E]/10 text-[#1B4D3E] flex items-center justify-center shrink-0">
            <Sprout className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#1A241E]">Votre conseil agricole</h2>
            <p className="mt-1 text-sm text-stone-600 leading-relaxed">
              {!isGpsValidated
                ? 'L’analyse agricole et les données satellites restent verrouillées tant que la précision GPS n’est pas strictement inférieure à 10 mètres.'
                : !isLandEligible
                ? 'La parcelle doit passer avec succès la vérification d’occupation du sol et des zones protégées avant de générer des recommandations.'
                : 'Position et éligibilité validées. Indiquez votre budget et votre surface puis appuyez sur « Que dois-je planter ? » pour lancer l’analyse.'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const faostat = result.estimation_faostat;
  const eco = result.estimation_economique;

  const recolteKg = faostat?.recolte_kg ?? eco?.recolte_estimee_kg;
  const coutUsdRaw = faostat?.cout_usd ?? eco?.couts_variables_estimes_usd;
  const beneficeUsdRaw =
    faostat?.benefice_usd ?? eco?.marge_avant_charges_non_comptabilisees_usd;

  const coutUsdNum = parseNumeric(coutUsdRaw);
  const beneficeUsdNum = parseNumeric(beneficeUsdRaw);
  const coutFcDisplay =
    coutUsdNum !== null ? coutUsdNum * USD_TO_CDF_RATE : faostat?.cout_cdf;
  const beneficeFcDisplay =
    beneficeUsdNum !== null
      ? beneficeUsdNum * USD_TO_CDF_RATE
      : faostat?.benefice_cdf ?? eco?.marge_cdf;

  const hasEconomicSection = Boolean(faostat || eco);

  const cultureRecommandeeText = safeString(result.culture_recommandee);
  const territoireText = safeString(result.territoire);
  const explicationText = safeString(result.explication_cultivateur);
  const classement = Array.isArray(result.classement_cultures)
    ? result.classement_cultures
    : [];

  return (
    <section id="resultats" aria-live="polite" className="space-y-4">
      {/* Culture recommandée - dominant anchor */}
      <div className="bg-[#1B4D3E] text-white rounded-2xl p-6 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/80 font-medium">
          <Sprout className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            Culture recommandée{territoireText ? ` · ${territoireText} (Sud-Kivu)` : ''}
          </span>
        </div>
        <h2 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight text-balance">
          {cultureRecommandeeText || 'Recommandation reçue'}
        </h2>
      </div>

      {/* Conseil bienveillant IA */}
      {explicationText && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6">
          <h3 className="text-base font-bold text-[#1A241E]">Conseil pour votre champ</h3>
          <p className="mt-2 text-base text-stone-700 leading-relaxed whitespace-pre-line">
            {explicationText}
          </p>
        </div>
      )}

      {/* Classement des cultures selon les données réelles */}
      {classement.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-[#1A241E]">
              Classement des cultures compatibles
            </h3>
            <span className="text-xs text-stone-500">Selon la parcelle</span>
          </div>

          <ol className="space-y-2.5">
            {classement.map((crop, index) => (
              <li
                key={crop.code}
                className={`rounded-xl border p-3.5 ${
                  index === 0
                    ? 'bg-[#1B4D3E]/[0.05] border-[#1B4D3E]/25'
                    : 'bg-[#F7F8F5] border-stone-200/80'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-[#1A241E]">
                    {index + 1}. {crop.nom}
                  </span>
                  <span className="text-xs font-mono font-bold tabular-nums text-[#1B4D3E]">
                    {crop.score_compatibilite}/100
                  </span>
                </div>
                {crop.raisons_agronomiques.length > 0 && (
                  <p className="mt-1 text-xs text-stone-600 leading-relaxed">
                    {crop.raisons_agronomiques.join(' · ')}
                  </p>
                )}
                {crop.points_vigilance.length > 0 && (
                  <p className="mt-1 text-xs text-[#C05621] leading-relaxed">
                    Vigilance : {crop.points_vigilance.join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Note scientifique sur la nature des données pédologiques */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-5 flex items-start gap-3">
        <Info className="w-4 h-4 text-[#1B4D3E] shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-stone-600 leading-relaxed">
          Les propriétés du sol (pH, azote, argile, CEC, carbone organique) proviennent de bases
          pédologiques et modèles spatiaux (ISRIC SoilGrids v2.0 / HWSD v1.2). Elles constituent
          des estimations régionales utiles pour orienter le choix de culture et ne remplacent pas
          une analyse physique en laboratoire.
        </p>
      </div>

      {/* Estimations économiques */}
      {hasEconomicSection && (
        <div className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-[#1A241E] flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#1B4D3E] shrink-0" aria-hidden="true" />
              <span>Estimations pour votre récolte</span>
            </h3>
            <span className="text-xs text-stone-500">
              {faostat ? 'Données FAOSTAT' : 'Référentiel Sud-Kivu'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Récolte */}
            <div className="rounded-xl bg-[#F7F8F5] border border-stone-200/80 p-4">
              <div className="text-xs font-medium text-stone-600 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-[#1B4D3E]" aria-hidden="true" />
                <span>Récolte attendue</span>
              </div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums text-[#1A241E]">
                {recolteKg !== undefined && recolteKg !== null
                  ? `${formatNumberFr(recolteKg)} kg`
                  : '—'}
              </div>
            </div>

            {/* Coût des semences */}
            <div className="rounded-xl bg-[#F7F8F5] border border-stone-200/80 p-4">
              <div className="text-xs font-medium text-stone-600">Coût des semences</div>
              <div className="mt-1.5 text-xl font-bold tabular-nums text-[#1A241E]">
                {formatUsd(coutUsdRaw)}
              </div>
              <div className="mt-0.5 text-xs font-medium tabular-nums text-stone-600">
                {formatCdf(coutFcDisplay)}
              </div>
            </div>

            {/* Bénéfice net */}
            <div className="rounded-xl bg-[#1B4D3E]/[0.06] border border-[#1B4D3E]/20 p-4">
              <div className="text-xs font-semibold text-[#1B4D3E]">Bénéfice net</div>
              <div className="mt-1.5 text-xl font-bold tabular-nums text-[#1B4D3E]">
                {formatUsd(beneficeUsdRaw)}
              </div>
              <div className="mt-0.5 text-xs font-semibold tabular-nums text-[#1B4D3E]/80">
                {formatCdf(beneficeFcDisplay)}
              </div>
            </div>
          </div>

          {eco?.source_economique && (
            <p className="text-xs text-stone-500 leading-relaxed">{eco.source_economique}</p>
          )}
        </div>
      )}
    </section>
  );
}
