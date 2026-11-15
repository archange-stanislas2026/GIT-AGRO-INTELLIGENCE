import { useState } from 'react';
import { ChevronDown, Satellite, Settings2 } from 'lucide-react';
import { DonneesSatellitesLive } from '../types/agri';
import { DEFAULT_API_URL } from '../utils/formatters';

interface SatelliteJuryAccordionProps {
  data: DonneesSatellitesLive | null | undefined;
  modelInputs?: DonneesSatellitesLive | null | undefined;
  isGpsValidated: boolean;
  apiUrl: string;
  onApiUrlChange: (url: string) => void;
}

function pickFirst(
  objects: Array<DonneesSatellitesLive | null | undefined>,
  keys: string[]
): unknown {
  for (const obj of objects) {
    if (!obj) continue;
    for (const key of keys) {
      const val = obj[key];
      if (val !== undefined && val !== null && val !== '') {
        return val;
      }
    }
  }
  return undefined;
}

function parseSourcesList(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          return String(obj.nom ?? obj.name ?? obj.source ?? JSON.stringify(item)).trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
  }
  return [String(value)];
}

function formatSatelliteValue(value: unknown, unit = ''): string {
  if (value === undefined || value === null || value === '') return 'Non disponible';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Aucune';
    return value
      .map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)))
      .join(', ');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    return entries.length > 0 ? entries.join(' · ') : 'Non disponible';
  }
  const str = String(value);
  return unit && !str.includes(unit.trim()) ? `${str}${unit}` : str;
}

const KNOWN_KEYS = new Set([
  'sources_actives',
  'sources',
  'pluie_mm',
  'pluie_annuelle_mm',
  'pluie',
  'precipitation',
  'temp_max_c',
  'temp_max_moyenne_c',
  'temperature',
  'temperature_c',
  'temp_c',
  'altitude_m',
  'altitude',
  'elevation',
  'pente_deg',
  'pente',
  'pente_pourcent',
  'ph_sol',
  'ph',
  'pH',
  'azote_sol',
  'argile_pct',
  'historique_ndvi',
  'ndvi',
  'valeurs_secours',
  'nasa_power',
]);

export function SatelliteJuryAccordion({
  data,
  modelInputs,
  isGpsValidated,
  apiUrl,
  onApiUrlChange,
}: SatelliteJuryAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);

  const fallbackObj = (data?.valeurs_secours as DonneesSatellitesLive | null | undefined) ?? undefined;
  const searchOrder = [data, modelInputs];

  const sourcesRaw = pickFirst(searchOrder, ['sources_actives', 'sources']);
  const sourcesList = parseSourcesList(sourcesRaw);

  const pluie = pickFirst(searchOrder, ['pluie_mm', 'pluie_annuelle_mm', 'pluie', 'precipitation']);
  const tempMax = pickFirst(searchOrder, [
    'temp_max_c',
    'temp_max_moyenne_c',
    'temperature_c',
    'temp_c',
    'temperature',
  ]);
  const altitude = pickFirst(searchOrder, ['altitude_m', 'altitude', 'elevation']);
  const pente = pickFirst(searchOrder, ['pente_deg', 'pente', 'pente_pourcent']);

  const phLive = pickFirst([data], ['ph_sol', 'ph', 'pH']);
  const phFallback = pickFirst([fallbackObj, modelInputs], ['ph_sol', 'ph', 'pH']);
  const phDisplay =
    phLive !== undefined
      ? formatSatelliteValue(phLive)
      : phFallback !== undefined
      ? `${formatSatelliteValue(phFallback)} (estimation modèle)`
      : 'Non disponible';

  const azoteLive = pickFirst([data], ['azote_sol']);
  const azoteFallback = pickFirst([fallbackObj, modelInputs], ['azote_sol']);
  const azoteDisplay =
    azoteLive !== undefined
      ? formatSatelliteValue(azoteLive)
      : azoteFallback !== undefined
      ? `${formatSatelliteValue(azoteFallback)} (estimation modèle)`
      : 'Non disponible';

  const argileLive = pickFirst([data], ['argile_pct']);
  const argileFallback = pickFirst([fallbackObj, modelInputs], ['argile_pct']);
  const argileDisplay =
    argileLive !== undefined
      ? formatSatelliteValue(argileLive, ' %')
      : argileFallback !== undefined
      ? `${formatSatelliteValue(argileFallback, ' %')} (estimation modèle)`
      : 'Non disponible';

  const ndvi = pickFirst([data, fallbackObj, modelInputs], ['historique_ndvi', 'ndvi']);

  const hasSatelliteData = isGpsValidated && Boolean(data || modelInputs);

  const extraEntries = data
    ? Object.entries(data).filter(
        ([k, v]) => !KNOWN_KEYS.has(k) && v !== undefined && v !== null && v !== ''
      )
    : [];

  return (
    <section className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls="jury-satellite-panel"
        className="w-full min-h-[56px] px-5 sm:px-6 py-4 flex items-center justify-between gap-3 text-left hover:bg-[#F7F8F5] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
      >
        <span className="flex items-center gap-3 min-w-0">
          <Satellite className="w-5 h-5 text-[#1B4D3E] shrink-0" aria-hidden="true" />
          <span className="text-sm sm:text-base font-bold text-[#1A241E] truncate">
            Détails Satellites NASA (Jury)
          </span>
        </span>
        <ChevronDown
          className={`w-5 h-5 text-stone-500 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          id="jury-satellite-panel"
          className="border-t border-stone-200 px-5 sm:px-6 py-5 space-y-5 bg-[#F7F8F5]/60"
        >
          {hasSatelliteData ? (
            <div className="space-y-3">
              {/* 1. Sources actives (badges) */}
              <div className="rounded-xl bg-white border border-stone-200 p-4">
                <div className="text-xs font-medium text-stone-500">1. Sources actives</div>
                {sourcesList.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sourcesList.map((source, idx) => (
                      <span
                        key={`${source}-${idx}`}
                        className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium bg-[#1B4D3E]/10 text-[#1B4D3E] border border-[#1B4D3E]/20"
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-sm font-mono text-stone-500">Non disponible</div>
                )}
              </div>

              {/* Grille 2 à 8 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">2. Précipitations</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#1A241E]">
                    {formatSatelliteValue(pluie, ' mm')}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">3. Température max</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#1A241E]">
                    {formatSatelliteValue(tempMax, ' °C')}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">4. Altitude</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#1A241E]">
                    {formatSatelliteValue(altitude, ' m')}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">5. Pente du terrain</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#1A241E]">
                    {formatSatelliteValue(pente, ' °')}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">6. pH du sol (base pédologique)</div>
                  <div className="mt-1 text-base font-bold font-mono tabular-nums text-[#1A241E]">
                    {phDisplay}
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">7. Azote &amp; Argile (estimés)</div>
                  <div className="mt-1 text-sm font-bold font-mono tabular-nums text-[#1A241E] space-y-0.5">
                    <div>Azote : {azoteDisplay}</div>
                    <div>Argile : {argileDisplay}</div>
                  </div>
                </div>

                <div className="col-span-2 rounded-xl bg-white border border-stone-200 p-3.5">
                  <div className="text-xs text-stone-500">8. Historique végétation (NDVI)</div>
                  <div className="mt-1 text-sm sm:text-base font-bold font-mono tabular-nums text-[#1A241E] break-words">
                    {formatSatelliteValue(ndvi)}
                  </div>
                </div>
              </div>

              {extraEntries.length > 0 && (
                <div className="rounded-xl bg-white border border-stone-200 p-4 space-y-2">
                  <div className="text-xs font-medium text-stone-500">
                    Métadonnées &amp; provenance des sources
                  </div>
                  <dl className="space-y-2 text-xs">
                    {extraEntries.map(([key, value]) => (
                      <div
                        key={key}
                        className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 border-b border-stone-100 pb-1.5"
                      >
                        <dt className="font-mono text-stone-500 shrink-0">{key}</dt>
                        <dd className="font-mono tabular-nums text-[#1A241E] sm:text-right break-words">
                          {typeof value === 'boolean'
                            ? value
                              ? 'oui'
                              : 'non'
                            : formatSatelliteValue(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-stone-600 leading-relaxed">
              {isGpsValidated
                ? 'Aucune donnée satellite reçue pour le moment. Lancez une analyse avec « Que dois-je planter ? » pour afficher ici les mesures NASA et estimations pédologiques.'
                : 'Données satellites et pédologiques verrouillées : validez d’abord une position GPS avec une précision strictement inférieure à 10 mètres.'}
            </p>
          )}

          {/* Local backend info (no external Render call) */}
          <div className="pt-2 border-t border-stone-200/80">
            <button
              type="button"
              onClick={() => setShowServerConfig((prev) => !prev)}
              className="text-xs text-stone-500 hover:text-[#1A241E] flex items-center gap-1.5 cursor-pointer py-1"
            >
              <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Moteur local actif ({apiUrl || DEFAULT_API_URL})</span>
            </button>

            {showServerConfig && (
              <p className="mt-2 text-xs text-stone-600 leading-relaxed">
                Les décisions agronomiques s’exécutent localement sur{' '}
                <code className="font-mono text-[#1A241E]">/api/recommander</code> à partir du
                modèle placé dans le dossier <code className="font-mono text-[#1A241E]">/models/</code>{' '}
                (aucun appel vers Render).
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
