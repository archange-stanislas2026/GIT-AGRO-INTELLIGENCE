import { useCallback, useEffect, useRef, useState } from 'react';
import { Sprout, Loader2 } from 'lucide-react';
import { LocationCard } from './components/LocationCard';
import { LandEligibilityCard } from './components/LandEligibilityCard';
import { FarmerResourcesCard } from './components/FarmerResourcesCard';
import { ResultsSection } from './components/ResultsSection';
import { SatelliteJuryAccordion } from './components/SatelliteJuryAccordion';
import {
  GpsReading,
  LandEligibilityReport,
  LocationState,
  RecommendationResponse,
} from './types/agri';
import {
  DEFAULT_API_URL,
  USD_TO_CDF_RATE,
  formatCdf,
} from './utils/formatters';
import {
  GPS_MESSAGES,
  MAX_GPS_ACCURACY_METERS,
  formatAccuracyMeters,
  formatGpsValidatedMessage,
  isGpsAccuracyAcceptable,
  validateGpsSubmission,
} from './utils/gpsValidation';
import {
  OUTSIDE_SUD_KIVU_MESSAGE,
  findSudKivuTerritory,
  isInsideSudKivu,
} from './utils/sudKivuGeo';
import { evaluateModeleCulturesClient } from './utils/modeleCulturesLocal';

const INITIAL_LOCATION: LocationState = {
  status: 'searching',
  lat: null,
  lon: null,
  accuracyMeters: null,
  sampleCount: 0,
  samples: [],
  message: GPS_MESSAGES.searching,
};

const GPS_WATCH_MAX_DURATION_MS = 120_000;
const GPS_STABILIZATION_CONFIRM_MS = 2_500;
const MAX_CONSECUTIVE_TIMEOUTS = 3;

export default function App() {
  const [location, setLocation] = useState<LocationState>(INITIAL_LOCATION);

  const [budgetUsd, setBudgetUsd] = useState<string>('25');
  const [surfaceAres, setSurfaceAres] = useState<number>(5);

  const [apiUrl, setApiUrl] = useState<string>(DEFAULT_API_URL);
  const [eligibility, setEligibility] = useState<LandEligibilityReport | null>(null);
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [legalConfirmed, setLegalConfirmed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [heroImageError, setHeroImageError] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const watchTimeoutRef = useRef<number | null>(null);
  const stabilizationTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<number>(0);
  const eligibilityAbortRef = useRef<AbortController | null>(null);
  const samplesRef = useRef<GpsReading[]>([]);
  const consecutiveTimeoutsRef = useRef<number>(0);

  const clearGpsTimersAndWatch = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (watchTimeoutRef.current !== null) {
      window.clearTimeout(watchTimeoutRef.current);
      watchTimeoutRef.current = null;
    }
    if (stabilizationTimerRef.current !== null) {
      window.clearTimeout(stabilizationTimerRef.current);
      stabilizationTimerRef.current = null;
    }
  }, []);

  const stopGpsAcquisition = useCallback(() => {
    sessionIdRef.current += 1;
    clearGpsTimersAndWatch();
    setLocation((prev) => ({
      ...prev,
      status: prev.status === 'validated' ? 'validated' : 'error',
      message: prev.status === 'validated' ? prev.message : GPS_MESSAGES.cancelled,
    }));
  }, [clearGpsTimersAndWatch]);

  const startGpsAcquisition = useCallback(() => {
    const sessionId = ++sessionIdRef.current;
    clearGpsTimersAndWatch();
    samplesRef.current = [];
    consecutiveTimeoutsRef.current = 0;

    // Immediately block/clear any previous eligibility & results while acquiring a validated GPS fix
    eligibilityAbortRef.current?.abort();
    setEligibility(null);
    setEligibilityError(null);
    setLegalConfirmed(false);
    setIsCheckingEligibility(false);
    setResult(null);
    setErrorMessage(null);

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setLocation({
        status: 'error',
        lat: null,
        lon: null,
        accuracyMeters: null,
        sampleCount: 0,
        samples: [],
        message: GPS_MESSAGES.unsupported,
      });
      return;
    }

    setLocation({
      status: 'searching',
      lat: null,
      lon: null,
      accuracyMeters: null,
      sampleCount: 0,
      samples: [],
      message: GPS_MESSAGES.searching,
    });

    const handlePositionSample = (position: GeolocationPosition) => {
      if (sessionIdRef.current !== sessionId) return;

      consecutiveTimeoutsRef.current = 0;
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const accuracyMeters = position.coords.accuracy;
      const timestamp = position.timestamp || Date.now();

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        !Number.isFinite(accuracyMeters) ||
        accuracyMeters <= 0
      ) {
        return;
      }

      // Do not treat repeated identical cached readings as proof of improved accuracy
      const prevSample = samplesRef.current[samplesRef.current.length - 1];
      if (
        prevSample &&
        prevSample.timestamp === timestamp &&
        prevSample.lat === lat &&
        prevSample.lon === lon &&
        prevSample.accuracyMeters === accuracyMeters
      ) {
        return;
      }

      const nextSample: GpsReading = { lat, lon, accuracyMeters, timestamp };
      samplesRef.current = [...samplesRef.current.slice(-19), nextSample];
      const collected = samplesRef.current;

      // Strict check: accuracy >= 10 meters (including exact 10.0) MUST NOT be validated
      if (!isGpsAccuracyAcceptable(accuracyMeters)) {
        if (stabilizationTimerRef.current !== null) {
          window.clearTimeout(stabilizationTimerRef.current);
          stabilizationTimerRef.current = null;
        }
        setResult(null);
        setLocation({
          status: 'insufficient_accuracy',
          lat,
          lon,
          accuracyMeters,
          timestamp,
          sampleCount: collected.length,
          samples: collected,
          message: GPS_MESSAGES.insufficientAccuracy,
        });
        return;
      }

      // Accuracy is strictly < 10 meters: require at least 2 measurements for stability
      if (collected.length < 2) {
        setLocation({
          status: 'searching',
          lat,
          lon,
          accuracyMeters,
          timestamp,
          sampleCount: collected.length,
          samples: collected,
          message: `${GPS_MESSAGES.searching} (${GPS_MESSAGES.stabilizing} : ${formatAccuracyMeters(
            accuracyMeters
          )} m)`,
        });

        // If device OS throttles watchPosition while stationary, confirm with one fresh uncached reading
        if (stabilizationTimerRef.current === null) {
          stabilizationTimerRef.current = window.setTimeout(() => {
            stabilizationTimerRef.current = null;
            if (sessionIdRef.current !== sessionId) return;
            navigator.geolocation.getCurrentPosition(
              (confirmPos) => {
                // Ensure the fresh confirmation has a distinct timestamp so it is treated as a 2nd reading
                const patchedPos =
                  confirmPos.timestamp === timestamp
                    ? ({
                        coords: confirmPos.coords,
                        timestamp: Date.now(),
                      } as GeolocationPosition)
                    : confirmPos;
                handlePositionSample(patchedPos);
              },
              () => {
                // Keep watcher active if confirmation call fails transiently
              },
              { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 }
            );
          }, GPS_STABILIZATION_CONFIRM_MS);
        }
        return;
      }

      // Validated: >= 2 distinct measurements collected and current accuracy < 10 m
      clearGpsTimersAndWatch();
      setLocation({
        status: 'validated',
        lat,
        lon,
        accuracyMeters,
        timestamp,
        sampleCount: collected.length,
        samples: collected,
        message: formatGpsValidatedMessage(accuracyMeters),
      });
    };

    const handleWatchError = (err: GeolocationPositionError) => {
      if (sessionIdRef.current !== sessionId) return;

      if (err.code === err.PERMISSION_DENIED) {
        clearGpsTimersAndWatch();
        setResult(null);
        setLocation({
          status: 'permission_denied',
          lat: null,
          lon: null,
          accuracyMeters: null,
          sampleCount: samplesRef.current.length,
          samples: samplesRef.current,
          message: GPS_MESSAGES.permissionDenied,
        });
        return;
      }

      if (err.code === err.TIMEOUT) {
        consecutiveTimeoutsRef.current += 1;
        if (consecutiveTimeoutsRef.current < MAX_CONSECUTIVE_TIMEOUTS) {
          return;
        }
        clearGpsTimersAndWatch();
        setResult(null);
        setLocation((prev) => ({
          ...prev,
          status: 'error',
          message: GPS_MESSAGES.timeout,
        }));
        return;
      }

      clearGpsTimersAndWatch();
      setResult(null);
      setLocation((prev) => ({
        ...prev,
        status: 'error',
        message: GPS_MESSAGES.unavailable,
      }));
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      handlePositionSample,
      handleWatchError,
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );

    watchTimeoutRef.current = window.setTimeout(() => {
      if (sessionIdRef.current !== sessionId) return;
      clearGpsTimersAndWatch();
      setResult(null);
      setLocation((prev) => ({
        ...prev,
        status: 'error',
        message: GPS_MESSAGES.timeout,
      }));
    }, GPS_WATCH_MAX_DURATION_MS);
  }, [clearGpsTimersAndWatch]);

  useEffect(() => {
    startGpsAcquisition();
    return () => {
      sessionIdRef.current += 1;
      clearGpsTimersAndWatch();
    };
  }, [startGpsAcquisition, clearGpsTimersAndWatch]);

  useEffect(() => {
    if (!isSubmitting) {
      setElapsedSeconds(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isSubmitting]);

  const verifyLandEligibilityForLocation = useCallback(
    async (loc: LocationState) => {
      if (
        loc.status !== 'validated' ||
        loc.lat === null ||
        loc.lon === null ||
        !isGpsAccuracyAcceptable(loc.accuracyMeters) ||
        !isInsideSudKivu(loc.lat, loc.lon)
      ) {
        return;
      }

      eligibilityAbortRef.current?.abort();
      const controller = new AbortController();
      eligibilityAbortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), 16_000);

      setIsCheckingEligibility(true);
      setEligibilityError(null);
      setLegalConfirmed(false);
      setResult(null);
      setErrorMessage(null);

      const baseUrl = (apiUrl.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
      const eligibilityEndpoint = `${baseUrl}/verifier-eligibilite`;

      try {
        const response = await fetch(eligibilityEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: loc.lat,
            lon: loc.lon,
            gps_accuracy_m: loc.accuracyMeters,
            gps_timestamp: loc.timestamp,
            gps_sample_count: loc.sampleCount,
            gps_measurements: loc.samples,
          }),
          signal: controller.signal,
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(
            'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'
          );
        }

        const payload = (await response.json()) as {
          detail?: string;
          eligibilite?: LandEligibilityReport;
        };

        if (!response.ok || !payload.eligibilite) {
          throw new Error(
            payload.detail ||
              'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'
          );
        }

        if (!controller.signal.aborted) {
          setEligibility(payload.eligibilite);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setEligibility(null);
        setEligibilityError(
          err instanceof Error
            ? err.message
            : 'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'
        );
      } finally {
        window.clearTimeout(timeoutId);
        if (!controller.signal.aborted) {
          setIsCheckingEligibility(false);
        }
      }
    },
    [apiUrl]
  );

  useEffect(() => {
    if (
      location.status === 'validated' &&
      location.lat !== null &&
      location.lon !== null &&
      isGpsAccuracyAcceptable(location.accuracyMeters) &&
      isInsideSudKivu(location.lat, location.lon)
    ) {
      verifyLandEligibilityForLocation(location);
    } else {
      eligibilityAbortRef.current?.abort();
      setEligibility(null);
      setEligibilityError(null);
      setLegalConfirmed(false);
      setIsCheckingEligibility(false);
    }
  }, [
    location.status,
    location.lat,
    location.lon,
    location.accuracyMeters,
    location.timestamp,
    verifyLandEligibilityForLocation,
  ]);

  const handleResetAll = () => {
    setErrorMessage(null);
    setResult(null);
    setEligibility(null);
    setEligibilityError(null);
    setLegalConfirmed(false);
    setBudgetUsd('25');
    setSurfaceAres(5);
    startGpsAcquisition();
  };

  const handleSubmitAnalysis = async () => {
    setErrorMessage(null);

    // STRICT GPS GATE: Never start analysis if GPS is not validated (< 10 m)
    if (
      location.status !== 'validated' ||
      location.lat === null ||
      location.lon === null ||
      !isGpsAccuracyAcceptable(location.accuracyMeters)
    ) {
      setResult(null);
      setErrorMessage(GPS_MESSAGES.insufficientAccuracy);
      document.getElementById('champ')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const gpsValidation = validateGpsSubmission({
      lat: location.lat,
      lon: location.lon,
      accuracyMeters: location.accuracyMeters,
      timestamp: location.timestamp,
      sampleCount: location.sampleCount,
      measurements: location.samples,
    });

    if (!gpsValidation.valid) {
      setResult(null);
      setErrorMessage(gpsValidation.error || OUTSIDE_SUD_KIVU_MESSAGE);
      document.getElementById('champ')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // STRICT LAND ELIGIBILITY GATE: Never start analysis unless land eligibility is POTENTIALLY_SUITABLE & confirmed
    if (!eligibility || eligibility.status !== 'POTENTIALLY_SUITABLE' || !eligibility.eligibleForAnalysis) {
      setResult(null);
      setErrorMessage(
        eligibility?.userMessage ||
          eligibilityError ||
          'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'
      );
      document.getElementById('eligibilite')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (!legalConfirmed) {
      setResult(null);
      setErrorMessage(
        'Veuillez d’abord confirmer que vous êtes autorisé(e) à cultiver cette parcelle dans la section de vérification du terrain.'
      );
      document.getElementById('eligibilite')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const validLat = location.lat;
    const validLon = location.lon;
    const validAccuracy = location.accuracyMeters;
    const numericBudget = Math.max(0, Number(budgetUsd.replace(',', '.')) || 0);
    const baseUrl = (apiUrl.trim() || DEFAULT_API_URL).replace(/\/+$/, '');
    const endpointUrl = baseUrl.endsWith('/recommander') ? baseUrl : `${baseUrl}/recommander`;

    setIsSubmitting(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 95000);

    const runLocalEmbeddedModel = () => {
      const localData = evaluateModeleCulturesClient({
        lat: validLat,
        lon: validLon,
        gpsAccuracyMeters: validAccuracy,
        gpsTimestamp: location.timestamp,
        gpsSampleCount: location.sampleCount,
        budgetUsd: numericBudget,
        surfaceAres,
      });
      setResult(localData);
      window.setTimeout(() => {
        document.getElementById('resultats')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    };

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: validLat,
          lon: validLon,
          gps_accuracy_m: validAccuracy,
          gps_timestamp: location.timestamp,
          gps_sample_count: location.sampleCount,
          gps_measurements: location.samples,
          budget_usd: numericBudget,
          surface_ares: surfaceAres,
        }),
        signal: controller.signal,
      });

      const contentType = response.headers.get('content-type') || '';

      // If server explicitly returned a JSON validation or land-eligibility block (400/403/422/503), surface it and NEVER fall back
      if (
        (response.status === 400 ||
          response.status === 403 ||
          response.status === 422 ||
          response.status === 503) &&
        contentType.includes('application/json')
      ) {
        const errJson = (await response.json()) as {
          detail?: string;
          eligibilite?: LandEligibilityReport;
        };
        if (errJson.eligibilite) {
          setEligibility(errJson.eligibilite);
        }
        throw new Error(errJson.detail || 'Parcelle non éligible ou paramètres invalides pour l’analyse.');
      }

      // If static/shared preview returned HTML (non-JSON) or endpoint is 404/405/5xx, execute embedded modele_cultures ONLY if eligibility is already verified POTENTIALLY_SUITABLE
      if (!response.ok || !contentType.includes('application/json')) {
        if (eligibility.status === 'POTENTIALLY_SUITABLE' && eligibility.eligibleForAnalysis) {
          runLocalEmbeddedModel();
          return;
        }
        throw new Error(
          'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'
        );
      }

      const data = (await response.json()) as RecommendationResponse;
      if (data.eligibilite) {
        setEligibility(data.eligibilite);
      }
      setResult(data);

      window.setTimeout(() => {
        document.getElementById('resultats')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      if (
        err instanceof Error &&
        !(err instanceof DOMException && err.name === 'AbortError') &&
        !(err instanceof TypeError) &&
        !err.message.includes('JSON')
      ) {
        setResult(null);
        setErrorMessage(err.message);
      } else if (eligibility.status === 'POTENTIALLY_SUITABLE' && eligibility.eligibleForAnalysis) {
        runLocalEmbeddedModel();
      } else {
        setResult(null);
        setErrorMessage(
          'Impossible de vérifier le statut de cette parcelle avec les données disponibles. Aucune recommandation agricole ne sera générée pour le moment.'
        );
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  };

  const numericBudget = Math.max(0, Number(budgetUsd.replace(',', '.')) || 0);
  const hasCoords = location.lat !== null && location.lon !== null;
  const insideSudKivu = hasCoords && location.lat !== null && location.lon !== null
    ? isInsideSudKivu(location.lat, location.lon)
    : false;
  const activeTerritory =
    insideSudKivu && location.lat !== null && location.lon !== null
      ? findSudKivuTerritory(location.lat, location.lon)
      : null;
  const isGpsValidated =
    location.status === 'validated' && isGpsAccuracyAcceptable(location.accuracyMeters);
  const isLandEligible =
    eligibility?.status === 'POTENTIALLY_SUITABLE' && eligibility.eligibleForAnalysis === true;
  const canSubmit =
    isGpsValidated &&
    insideSudKivu &&
    isLandEligible &&
    legalConfirmed &&
    !isCheckingEligibility &&
    !isSubmitting;

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F8F5] text-[#1A241E] pb-24 lg:pb-12">
      {/* Top Bar: Clean 3-zone contract */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4 sm:gap-8">
          <a
            href="#top"
            className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#1B4D3E] whitespace-nowrap shrink-0"
          >
            GITAgroIntelligence
          </a>

          <nav
            aria-label="Navigation principale"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-600"
          >
            <a
              href="#champ"
              className="hover:text-[#1B4D3E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Position GPS
            </a>
            <a
              href="#eligibilite"
              className="hover:text-[#1B4D3E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Éligibilité
            </a>
            <a
              href="#moyens"
              className="hover:text-[#1B4D3E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Moyens
            </a>
            <a
              href="#resultats"
              className="hover:text-[#1B4D3E] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Résultats
            </a>
          </nav>

          <button
            type="button"
            onClick={handleResetAll}
            className="min-h-[40px] px-4 py-2 text-xs sm:text-sm font-semibold text-[#1B4D3E] bg-[#1B4D3E]/8 hover:bg-[#1B4D3E]/14 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
          >
            Nouvelle analyse
          </button>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-5 sm:pt-7 space-y-6">
        {/* Hero Visual Banner + Intro */}
        <section className="space-y-4">
          <div className="overflow-hidden rounded-2xl shadow-sm border border-stone-200/80 bg-[#1B4D3E]/10">
            {!heroImageError ? (
              <img
                src="/assets/aistudio/WhatsApp-Image-2025-04-18-at-14.00.06-e1744980703784_c4d3212f.jpeg"
                alt="Cultivatrices récoltant sur les collines verdoyantes du Sud-Kivu"
                className="w-full h-44 sm:h-60 lg:h-72 object-cover object-[center_35%]"
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setHeroImageError(true)}
              />
            ) : (
              <div className="w-full h-44 sm:h-60 lg:h-72 bg-gradient-to-br from-[#1B4D3E]/15 via-[#1B4D3E]/5 to-[#C05621]/15 flex items-center justify-center p-6 text-center">
                <div className="flex flex-col items-center gap-2 text-[#1B4D3E]">
                  <Sprout className="w-8 h-8" aria-hidden="true" />
                  <span className="text-sm font-semibold">Agriculture des collines du Sud-Kivu</span>
                </div>
              </div>
            )}
          </div>

          <div className="max-w-2xl">
            <p className="text-xs sm:text-sm font-medium text-[#C05621]">
              Sud-Kivu · NASA Space Apps Challenge
            </p>
            <h1 className="mt-1.5 text-2xl sm:text-4xl font-bold tracking-tight text-[#1A241E] text-balance">
              Savoir quoi planter selon votre terre et votre budget
            </h1>
            <p className="mt-2 text-sm sm:text-base text-stone-600 leading-relaxed">
              Validez d’abord votre position GPS haute précision (erreur &lt; 10 mètres) dans le
              Sud-Kivu, puis indiquez vos moyens. Nous analysons le climat, l’altitude, la pente et
              les bases pédologiques réelles de votre parcelle.
            </p>
          </div>
        </section>

        {/* Responsive 2-column desktop / 1-column mobile layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Farmer Inputs */}
          <div className="lg:col-span-7 space-y-5">
            <LocationCard
              location={location}
              onStartGps={startGpsAcquisition}
              onStopGps={stopGpsAcquisition}
              onAnalyzeParcel={handleSubmitAnalysis}
              isSubmitting={isSubmitting}
              isEligibleForAnalysis={isLandEligible && legalConfirmed}
            />

            <LandEligibilityCard
              isGpsValidated={isGpsValidated}
              insideSudKivu={insideSudKivu}
              isChecking={isCheckingEligibility}
              report={eligibility}
              checkError={eligibilityError}
              legalConfirmed={legalConfirmed}
              onLegalConfirmedChange={setLegalConfirmed}
              onRetryCheck={() => verifyLandEligibilityForLocation(location)}
              onRefreshGps={startGpsAcquisition}
            />

            <FarmerResourcesCard
              budgetUsd={budgetUsd}
              onBudgetChange={setBudgetUsd}
              surfaceAres={surfaceAres}
              onSurfaceChange={setSurfaceAres}
            />

            {/* Desktop inline primary CTA */}
            <div className="hidden lg:block pt-1">
              <button
                type="button"
                onClick={handleSubmitAnalysis}
                disabled={!canSubmit}
                className="w-full min-h-[58px] px-6 py-4 rounded-2xl bg-[#1B4D3E] hover:bg-[#153D31] active:scale-[0.99] text-white font-bold text-lg flex items-center justify-center gap-3 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin shrink-0" />
                    <span>Analyse des satellites NASA en cours...</span>
                  </>
                ) : (
                  <>
                    <Sprout className="w-6 h-6 shrink-0" />
                    <span>
                      {!isGpsValidated
                        ? `En attente de précision GPS (< ${MAX_GPS_ACCURACY_METERS} m)`
                        : isCheckingEligibility
                        ? 'Vérification du terrain en cours...'
                        : !isLandEligible
                        ? 'Parcelle non éligible ou à vérifier'
                        : !legalConfirmed
                        ? 'Confirmez votre autorisation de culture'
                        : 'Que dois-je planter ?'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Summary + Results + Jury Accordion */}
          <div className="lg:col-span-5 space-y-5">
            {/* Compact Desktop Recap */}
            <div className="hidden lg:block bg-white border border-stone-200 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-[#1A241E]">Résumé de votre parcelle</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-stone-600">Zone</dt>
                  <dd
                    className={`font-semibold ${
                      !hasCoords
                        ? 'text-stone-600'
                        : insideSudKivu
                        ? 'text-[#1B4D3E]'
                        : 'text-[#C05621]'
                    }`}
                  >
                    {!hasCoords
                      ? 'En attente du GPS'
                      : insideSudKivu
                      ? `${activeTerritory ?? 'Sud-Kivu'} (Sud-Kivu)`
                      : 'Hors Sud-Kivu'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-stone-600">Précision GPS</dt>
                  <dd
                    className={`font-mono font-semibold tabular-nums ${
                      isGpsValidated ? 'text-[#1B4D3E]' : 'text-amber-700'
                    }`}
                  >
                    {location.accuracyMeters !== null
                      ? `${formatAccuracyMeters(location.accuracyMeters)} m (${
                          isGpsValidated ? 'validée' : '≥ 10 m requis'
                        })`
                      : 'Recherche...'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-stone-600">Éligibilité terrain</dt>
                  <dd
                    className={`font-semibold text-right ${
                      !isGpsValidated || !insideSudKivu
                        ? 'text-stone-500'
                        : isCheckingEligibility
                        ? 'text-stone-600'
                        : isLandEligible
                        ? 'text-[#1B4D3E]'
                        : eligibility?.status === 'UNKNOWN' || eligibilityError
                        ? 'text-amber-700'
                        : 'text-[#C05621]'
                    }`}
                  >
                    {!isGpsValidated || !insideSudKivu
                      ? 'En attente du GPS'
                      : isCheckingEligibility
                      ? 'Vérification...'
                      : eligibility?.statusLabel || 'À vérifier'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-stone-600">Terrain</dt>
                  <dd className="font-semibold tabular-nums text-[#1A241E]">
                    {surfaceAres} {surfaceAres > 1 ? 'ares' : 'are'} ({surfaceAres * 100} m²)
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-stone-600">Budget</dt>
                  <dd className="font-semibold tabular-nums text-[#1A241E]">
                    {numericBudget} USD · {formatCdf(numericBudget * USD_TO_CDF_RATE)}
                  </dd>
                </div>
              </dl>
            </div>

            <ResultsSection
              result={result}
              isLoading={isSubmitting}
              elapsedSeconds={elapsedSeconds}
              errorMessage={errorMessage}
              isGpsValidated={isGpsValidated}
              isLandEligible={isLandEligible}
              onRetry={handleSubmitAnalysis}
            />

            <SatelliteJuryAccordion
              data={
                isGpsValidated && isLandEligible
                  ? result?.donnees_satellitaires ||
                    result?.donnees_satellites_live ||
                    result?.donnees_satellites ||
                    result?.donnees_nasa_temps_reel
                  : null
              }
              modelInputs={
                isGpsValidated && isLandEligible
                  ? result?.prediction_agronomique?.donnees_entree_modele
                  : null
              }
              isGpsValidated={isGpsValidated && isLandEligible}
              apiUrl={apiUrl}
              onApiUrlChange={setApiUrl}
            />
          </div>
        </div>
      </main>

      {/* Mobile Sticky Bottom Primary Action (under 15% mobile viewport height) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#F7F8F5]/95 backdrop-blur-sm border-t border-stone-200 px-4 py-2.5">
        <button
          type="button"
          onClick={handleSubmitAnalysis}
          disabled={!canSubmit}
          className="w-full min-h-[52px] px-5 py-3 rounded-xl bg-[#1B4D3E] hover:bg-[#153D31] active:scale-[0.98] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1B4D3E]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin shrink-0" />
              <span className="truncate">Analyse NASA ({elapsedSeconds} s)...</span>
            </>
          ) : (
            <>
              <Sprout className="w-5 h-5 shrink-0" />
              <span className="truncate">
                {!isGpsValidated
                  ? `GPS requis (< ${MAX_GPS_ACCURACY_METERS} m)`
                  : isCheckingEligibility
                  ? 'Vérification du terrain...'
                  : !isLandEligible
                  ? 'Terrain non éligible / À vérifier'
                  : !legalConfirmed
                  ? 'Confirmer l’autorisation de culture'
                  : 'Que dois-je planter ?'}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
