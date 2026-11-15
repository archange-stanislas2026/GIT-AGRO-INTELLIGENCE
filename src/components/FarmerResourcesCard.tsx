import { Coins, Ruler, Minus, Plus } from 'lucide-react';
import { USD_TO_CDF_RATE, formatCdf } from '../utils/formatters';

interface FarmerResourcesCardProps {
  budgetUsd: string;
  onBudgetChange: (value: string) => void;
  surfaceAres: number;
  onSurfaceChange: (ares: number) => void;
}

const BUDGET_PRESETS = [10, 25, 50, 100];
const SURFACE_PRESETS = [2, 5, 10, 20];

export function FarmerResourcesCard({
  budgetUsd,
  onBudgetChange,
  surfaceAres,
  onSurfaceChange,
}: FarmerResourcesCardProps) {
  const numericBudget = Math.max(0, Number(budgetUsd.replace(',', '.')) || 0);
  const equivalentCdf = numericBudget * USD_TO_CDF_RATE;

  const handleDecrementAres = () => {
    if (surfaceAres > 1) onSurfaceChange(surfaceAres - 1);
  };

  const handleIncrementAres = () => {
    if (surfaceAres < 20) onSurfaceChange(surfaceAres + 1);
  };

  return (
    <section
      id="moyens"
      aria-labelledby="resources-heading"
      className="bg-white border border-stone-200 rounded-2xl p-5 sm:p-6 space-y-6"
    >
      <div>
        <h2
          id="resources-heading"
          className="text-lg sm:text-xl font-bold text-[#1A241E] tracking-tight"
        >
          3. Vos moyens pour cette saison
        </h2>
        <p className="mt-1 text-sm text-stone-600 leading-relaxed">
          Indiquez l'argent disponible pour les semences et la taille de votre terrain.
        </p>
      </div>

      {/* Budget USD + Live CDF */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="budget-usd-input"
            className="text-sm font-semibold text-[#1A241E] flex items-center gap-2"
          >
            <Coins className="w-4 h-4 text-[#C05621] shrink-0" aria-hidden="true" />
            <span>Budget disponible (USD)</span>
          </label>
          <span className="text-xs text-stone-500 tabular-nums">1 USD = 2 350 FC</span>
        </div>

        <div className="relative">
          <input
            id="budget-usd-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={budgetUsd}
            onChange={(e) => onBudgetChange(e.target.value)}
            placeholder="Ex: 25"
            className="w-full min-h-[54px] pl-4 pr-14 py-3 text-xl font-bold tabular-nums text-[#1A241E] bg-[#F7F8F5] border border-stone-300 rounded-xl focus:outline-none focus:border-[#1B4D3E] focus:ring-2 focus:ring-[#1B4D3E]/20"
          />
          <span
            aria-hidden="true"
            className="absolute right-4 top-1/2 -translate-y-1/2 text-base font-bold text-stone-500"
          >
            USD
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Montants rapides en dollars">
          {BUDGET_PRESETS.map((preset) => {
            const isActive = numericBudget === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onBudgetChange(String(preset))}
                className={`min-h-[44px] rounded-xl text-sm font-semibold tabular-nums transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E] ${
                  isActive
                    ? 'bg-[#1B4D3E] text-white'
                    : 'bg-stone-100 text-[#1A241E] hover:bg-stone-200'
                }`}
              >
                {preset} $
              </button>
            );
          })}
        </div>

        <div className="rounded-xl bg-[#F7F8F5] border border-stone-200/80 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-sm text-stone-600">Équivalent en Francs</span>
          <span className="text-base sm:text-lg font-bold tabular-nums text-[#1B4D3E]">
            {formatCdf(equivalentCdf)}
          </span>
        </div>
      </div>

      <hr className="border-stone-200" />

      {/* Surface en ares (1 à 20 ares) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="surface-ares-range"
            className="text-sm font-semibold text-[#1A241E] flex items-center gap-2"
          >
            <Ruler className="w-4 h-4 text-[#1B4D3E] shrink-0" aria-hidden="true" />
            <span>Taille du champ (en ares)</span>
          </label>
          <span className="text-xs text-stone-500 tabular-nums">1 are = 100 m²</span>
        </div>

        <div className="flex items-center justify-between gap-3 bg-[#F7F8F5] border border-stone-200/80 rounded-xl p-2">
          <button
            type="button"
            onClick={handleDecrementAres}
            disabled={surfaceAres <= 1}
            aria-label="Diminuer la taille d'un are"
            className="min-w-[52px] min-h-[52px] rounded-xl bg-white border border-stone-200 hover:bg-stone-100 active:scale-95 flex items-center justify-center text-[#1A241E] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
          >
            <Minus className="w-5 h-5" />
          </button>

          <div className="text-center">
            <div className="text-2xl font-bold tabular-nums text-[#1A241E]">
              {surfaceAres} {surfaceAres > 1 ? 'ares' : 'are'}
            </div>
            <div className="text-xs text-stone-500 tabular-nums">
              soit {(surfaceAres * 100).toLocaleString('fr-FR')} m²
            </div>
          </div>

          <button
            type="button"
            onClick={handleIncrementAres}
            disabled={surfaceAres >= 20}
            aria-label="Augmenter la taille d'un are"
            className="min-w-[52px] min-h-[52px] rounded-xl bg-white border border-stone-200 hover:bg-stone-100 active:scale-95 flex items-center justify-center text-[#1A241E] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        <input
          id="surface-ares-range"
          type="range"
          min={1}
          max={20}
          step={1}
          value={surfaceAres}
          onChange={(e) => onSurfaceChange(Number(e.target.value))}
          className="w-full h-3 accent-[#1B4D3E] cursor-pointer"
        />

        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Tailles rapides en ares">
          {SURFACE_PRESETS.map((preset) => {
            const isActive = surfaceAres === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onSurfaceChange(preset)}
                className={`min-h-[44px] rounded-xl text-sm font-semibold tabular-nums transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E] ${
                  isActive
                    ? 'bg-[#1B4D3E] text-white'
                    : 'bg-stone-100 text-[#1A241E] hover:bg-stone-200'
                }`}
              >
                {preset} ares
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
