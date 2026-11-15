import type {
  CropCandidate,
  DonneesSatellitesLive,
  EstimationEconomique,
} from '../types/agri.ts';

export interface CropProfile {
  code: string;
  nom: string;
  type: string;
  rendementKgAre: number;
  coutVariableUsdAre: number;
  prixBordChampUsdKg: number;
  cycleJours: number;
  couvertureSol: 'faible' | 'moyenne' | 'forte';
  altMin: number;
  altOptMin: number;
  altOptMax: number;
  altMax: number;
  pluieMin: number;
  pluieOptMin: number;
  pluieOptMax: number;
  pluieMax: number;
  tempMaxToleree: number;
  tempOptMin: number;
  tempOptMax: number;
  penteMaxRecommandee: number;
  phMin: number;
  phOptMin: number;
  phOptMax: number;
  phMax: number;
  besoinHydrique: 'faible' | 'moyen' | 'eleve';
  fixeAzote: boolean;
}

export const SUD_KIVU_CROPS: CropProfile[] = [
  {
    code: 'haricot_nain',
    nom: 'Haricot nain',
    type: 'Légumineuse',
    rendementKgAre: 5.5,
    coutVariableUsdAre: 2.0,
    prixBordChampUsdKg: 0.95,
    cycleJours: 95,
    couvertureSol: 'moyenne',
    altMin: 800,
    altOptMin: 1200,
    altOptMax: 2050,
    altMax: 2350,
    pluieMin: 750,
    pluieOptMin: 1000,
    pluieOptMax: 1750,
    pluieMax: 2150,
    tempMaxToleree: 30.5,
    tempOptMin: 18,
    tempOptMax: 26.5,
    penteMaxRecommandee: 18,
    phMin: 5.0,
    phOptMin: 5.5,
    phOptMax: 6.8,
    phMax: 7.5,
    besoinHydrique: 'moyen',
    fixeAzote: true,
  },
  {
    code: 'mais_haricot_duo',
    nom: 'Maïs + Haricot (Association)',
    type: 'Polyculture céréale-légumineuse',
    rendementKgAre: 14.0,
    coutVariableUsdAre: 3.1,
    prixBordChampUsdKg: 0.5,
    cycleJours: 120,
    couvertureSol: 'moyenne',
    altMin: 700,
    altOptMin: 1100,
    altOptMax: 1900,
    altMax: 2200,
    pluieMin: 850,
    pluieOptMin: 1100,
    pluieOptMax: 1850,
    pluieMax: 2250,
    tempMaxToleree: 31.5,
    tempOptMin: 19,
    tempOptMax: 27.5,
    penteMaxRecommandee: 15,
    phMin: 5.0,
    phOptMin: 5.5,
    phOptMax: 7.0,
    phMax: 7.5,
    besoinHydrique: 'moyen',
    fixeAzote: true,
  },
  {
    code: 'pomme_de_terre',
    nom: 'Pomme de terre',
    type: 'Tubercule d’altitude',
    rendementKgAre: 45.0,
    coutVariableUsdAre: 5.2,
    prixBordChampUsdKg: 0.38,
    cycleJours: 105,
    couvertureSol: 'faible',
    altMin: 1450,
    altOptMin: 1750,
    altOptMax: 2450,
    altMax: 2800,
    pluieMin: 900,
    pluieOptMin: 1150,
    pluieOptMax: 1850,
    pluieMax: 2200,
    tempMaxToleree: 28.5,
    tempOptMin: 15,
    tempOptMax: 26.5,
    penteMaxRecommandee: 14,
    phMin: 4.8,
    phOptMin: 5.2,
    phOptMax: 6.4,
    phMax: 7.0,
    besoinHydrique: 'moyen',
    fixeAzote: false,
  },
  {
    code: 'patate_douce',
    nom: 'Patate douce',
    type: 'Tubercule couvrant',
    rendementKgAre: 35.0,
    coutVariableUsdAre: 1.8,
    prixBordChampUsdKg: 0.24,
    cycleJours: 140,
    couvertureSol: 'forte',
    altMin: 450,
    altOptMin: 900,
    altOptMax: 1950,
    altMax: 2250,
    pluieMin: 750,
    pluieOptMin: 1050,
    pluieOptMax: 2100,
    pluieMax: 2600,
    tempMaxToleree: 33.0,
    tempOptMin: 20,
    tempOptMax: 29.0,
    penteMaxRecommandee: 26,
    phMin: 4.5,
    phOptMin: 5.0,
    phOptMax: 6.5,
    phMax: 7.5,
    besoinHydrique: 'moyen',
    fixeAzote: false,
  },
  {
    code: 'riz',
    nom: 'Riz',
    type: 'Céréale de plaine & bas-fond',
    rendementKgAre: 22.0,
    coutVariableUsdAre: 2.8,
    prixBordChampUsdKg: 0.55,
    cycleJours: 130,
    couvertureSol: 'moyenne',
    altMin: 350,
    altOptMin: 500,
    altOptMax: 1050,
    altMax: 1350,
    pluieMin: 1150,
    pluieOptMin: 1400,
    pluieOptMax: 2450,
    pluieMax: 3000,
    tempMaxToleree: 35.0,
    tempOptMin: 23,
    tempOptMax: 31.5,
    penteMaxRecommandee: 6,
    phMin: 4.6,
    phOptMin: 5.2,
    phOptMax: 6.6,
    phMax: 7.5,
    besoinHydrique: 'eleve',
    fixeAzote: false,
  },
  {
    code: 'soja',
    nom: 'Soja',
    type: 'Légumineuse',
    rendementKgAre: 6.5,
    coutVariableUsdAre: 2.3,
    prixBordChampUsdKg: 0.78,
    cycleJours: 115,
    couvertureSol: 'moyenne',
    altMin: 500,
    altOptMin: 950,
    altOptMax: 1700,
    altMax: 1950,
    pluieMin: 850,
    pluieOptMin: 1100,
    pluieOptMax: 1950,
    pluieMax: 2400,
    tempMaxToleree: 32.5,
    tempOptMin: 21,
    tempOptMax: 29.0,
    penteMaxRecommandee: 16,
    phMin: 5.0,
    phOptMin: 5.6,
    phOptMax: 6.8,
    phMax: 7.4,
    besoinHydrique: 'moyen',
    fixeAzote: true,
  },
  {
    code: 'arachide',
    nom: 'Arachide',
    type: 'Légumineuse oléagineuse',
    rendementKgAre: 6.2,
    coutVariableUsdAre: 2.2,
    prixBordChampUsdKg: 0.88,
    cycleJours: 115,
    couvertureSol: 'forte',
    altMin: 450,
    altOptMin: 600,
    altOptMax: 1350,
    altMax: 1650,
    pluieMin: 650,
    pluieOptMin: 800,
    pluieOptMax: 1650,
    pluieMax: 2050,
    tempMaxToleree: 34.0,
    tempOptMin: 23,
    tempOptMax: 31.5,
    penteMaxRecommandee: 15,
    phMin: 4.8,
    phOptMin: 5.5,
    phOptMax: 6.8,
    phMax: 7.4,
    besoinHydrique: 'faible',
    fixeAzote: true,
  },
  {
    code: 'sorgho',
    nom: 'Sorgho',
    type: 'Céréale résistante à la sécheresse',
    rendementKgAre: 8.5,
    coutVariableUsdAre: 1.7,
    prixBordChampUsdKg: 0.48,
    cycleJours: 115,
    couvertureSol: 'faible',
    altMin: 450,
    altOptMin: 650,
    altOptMax: 1550,
    altMax: 1900,
    pluieMin: 500,
    pluieOptMin: 650,
    pluieOptMax: 1200,
    pluieMax: 1650,
    tempMaxToleree: 35.5,
    tempOptMin: 23,
    tempOptMax: 32.0,
    penteMaxRecommandee: 13,
    phMin: 5.0,
    phOptMin: 5.5,
    phOptMax: 7.5,
    phMax: 8.2,
    besoinHydrique: 'faible',
    fixeAzote: false,
  },
  {
    code: 'mais',
    nom: 'Maïs',
    type: 'Céréale',
    rendementKgAre: 12.5,
    coutVariableUsdAre: 2.4,
    prixBordChampUsdKg: 0.36,
    cycleJours: 120,
    couvertureSol: 'faible',
    altMin: 550,
    altOptMin: 1000,
    altOptMax: 1850,
    altMax: 2150,
    pluieMin: 800,
    pluieOptMin: 1050,
    pluieOptMax: 1800,
    pluieMax: 2200,
    tempMaxToleree: 32.5,
    tempOptMin: 20,
    tempOptMax: 28.5,
    penteMaxRecommandee: 11,
    phMin: 5.0,
    phOptMin: 5.5,
    phOptMax: 7.0,
    phMax: 7.5,
    besoinHydrique: 'moyen',
    fixeAzote: false,
  },
  {
    code: 'manioc',
    nom: 'Manioc',
    type: 'Tubercule pérenne',
    rendementKgAre: 45.0,
    coutVariableUsdAre: 2.2,
    prixBordChampUsdKg: 0.2,
    cycleJours: 300,
    couvertureSol: 'faible',
    altMin: 450,
    altOptMin: 550,
    altOptMax: 1450,
    altMax: 1780,
    pluieMin: 750,
    pluieOptMin: 1050,
    pluieOptMax: 2200,
    pluieMax: 2800,
    tempMaxToleree: 34.5,
    tempOptMin: 23,
    tempOptMax: 31.0,
    penteMaxRecommandee: 12,
    phMin: 4.5,
    phOptMin: 5.0,
    phOptMax: 6.5,
    phMax: 7.5,
    besoinHydrique: 'faible',
    fixeAzote: false,
  },
];

export interface AgronomicEvaluationInput {
  satellite: DonneesSatellitesLive;
  budgetUsd: number;
  surfaceAres: number;
  saison?: 1 | 2 | 3;
  dureeJoursDisponible?: number;
  territory?: string | null;
}

export interface AgronomicEvaluationOutput {
  donneesInsuffisantes: boolean;
  raisonInsuffisance: string | null;
  topCrop: CropProfile | null;
  classement: CropCandidate[];
  estimationEconomique: EstimationEconomique | null;
  observations: string[];
}

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function evaluateAgronomicSuitability(
  input: AgronomicEvaluationInput
): AgronomicEvaluationOutput {
  const { satellite, budgetUsd, surfaceAres } = input;
  const saison = input.saison ?? 1;
  const duree = input.dureeJoursDisponible ?? 120;

  const pluie = asNum(satellite.pluie_annuelle_mm ?? satellite.pluie_mm);
  const tempMax = asNum(satellite.temp_max_moyenne_c ?? satellite.temp_max_c);
  const altitude = asNum(satellite.altitude_m);
  const pente = asNum(satellite.pente_deg);
  const ph = asNum(satellite.ph_sol);
  const azote = asNum(satellite.azote_sol);
  const argile = asNum(satellite.argile_pct);

  const observations: string[] = [];

  // Vérification de suffisance des données réelles
  if (pluie === null && tempMax === null && altitude === null) {
    return {
      donneesInsuffisantes: true,
      raisonInsuffisance:
        'Les sources climatiques (NASA POWER) et topographiques (SRTM / Open-Meteo) n’ont renvoyé aucune mesure exploitable pour ces coordonnées. Aucune culture ne peut être recommandée de manière fiable sans données réelles.',
      topCrop: null,
      classement: [],
      estimationEconomique: null,
      observations: [
        'Données climatiques et altitudinales indisponibles : recommandation suspendue par sécurité agronomique.',
      ],
    };
  }

  if (altitude !== null) {
    if (altitude < 1100) {
      observations.push(
        `Étage de basse altitude (${Math.round(altitude)} m) : climat plus chaud adapté aux cultures de plaine ou cuvette.`
      );
    } else if (altitude <= 1750) {
      observations.push(
        `Étage de moyenne altitude (${Math.round(altitude)} m) : zone favorable aux légumineuses, maïs et tubercules tempérés.`
      );
    } else {
      observations.push(
        `Étage de haute altitude (${Math.round(altitude)} m) : températures plus fraîches favorables aux cultures montagnardes (pomme de terre, haricot).`
      );
    }
  } else {
    observations.push('Altitude non disponible : étage écologique non vérifié.');
  }

  if (pente !== null) {
    if (pente >= 15) {
      observations.push(
        `Pente forte (${pente.toFixed(1)}°) : risque élevé d’érosion hydrique ; privilégier les cultures couvrantes et les courbes de niveau.`
      );
    } else if (pente >= 8) {
      observations.push(
        `Pente modérée (${pente.toFixed(1)}°) : aménagement en bandes enherbées conseillé.`
      );
    } else {
      observations.push(`Terrain peu pentu (${pente.toFixed(1)}°) : faible risque d’érosion.`);
    }
  }

  if (ph === null) {
    observations.push(
      'pH du sol non renseigné par la base pédologique sur ce point : une analyse physique en laboratoire reste nécessaire pour mesurer l’acidité exacte.'
    );
  }

  const budgetPerAre = surfaceAres > 0 ? budgetUsd / surfaceAres : 0;
  const scored: Array<{ profile: CropProfile; candidate: CropCandidate }> = [];

  for (const crop of SUD_KIVU_CROPS) {
    let score = 60;
    const raisons: string[] = [];
    const alertes: string[] = [];

    // 1. Altitude
    if (altitude !== null) {
      if (altitude >= crop.altOptMin && altitude <= crop.altOptMax) {
        score += 18;
        raisons.push(
          `Altitude idéale (${Math.round(altitude)} m dans la plage ${crop.altOptMin}–${crop.altOptMax} m)`
        );
      } else if (altitude >= crop.altMin && altitude <= crop.altMax) {
        score += 6;
        raisons.push(`Altitude acceptable (${Math.round(altitude)} m)`);
      } else {
        score -= 32;
        alertes.push(
          `Altitude hors zone recommandée (${Math.round(altitude)} m vs ${crop.altMin}–${crop.altMax} m)`
        );
      }
    }

    // 2. Température max
    if (tempMax !== null) {
      if (tempMax >= crop.tempOptMin && tempMax <= crop.tempOptMax) {
        score += 14;
        raisons.push(`Température maximale adaptée (${tempMax.toFixed(1)} °C)`);
      } else if (tempMax <= crop.tempMaxToleree) {
        score += 3;
      } else {
        score -= 26;
        alertes.push(
          `Chaleur excessive (${tempMax.toFixed(1)} °C > seuil ${crop.tempMaxToleree} °C)`
        );
      }
    }

    // 3. Pluviométrie & besoins hydriques
    if (pluie !== null) {
      if (pluie >= crop.pluieOptMin && pluie <= crop.pluieOptMax) {
        score += 16;
        raisons.push(
          `Pluviométrie bien adaptée (${Math.round(pluie)} mm/an)`
        );
      } else if (pluie >= crop.pluieMin && pluie <= crop.pluieMax) {
        score += 5;
      } else if (pluie < crop.pluieMin) {
        score -= 28;
        alertes.push(
          `Pluie insuffisante (${Math.round(pluie)} mm < besoin ${crop.pluieMin} mm)`
        );
      } else {
        score -= 18;
        alertes.push(
          `Humidité très élevée (${Math.round(pluie)} mm > optimum ${crop.pluieMax} mm)`
        );
      }
    }

    // 4. Pente & érosion
    if (pente !== null) {
      if (pente > crop.penteMaxRecommandee) {
        const excess = pente - crop.penteMaxRecommandee;
        score -= Math.min(28, 10 + excess * 1.4);
        alertes.push(
          `Risque d’érosion sur pente de ${pente.toFixed(1)}° (couverture ${crop.couvertureSol})`
        );
      } else if (pente >= 10 && crop.couvertureSol === 'forte') {
        score += 12;
        raisons.push(
          `Forte couverture du sol protégeant la pente (${pente.toFixed(1)}°)`
        );
      }
    }

    // 5. Sol (pH, azote, argile) lorsque disponibles
    if (ph !== null) {
      if (ph >= crop.phOptMin && ph <= crop.phOptMax) {
        score += 8;
        raisons.push(`pH du sol compatible (${ph.toFixed(1)})`);
      } else if (ph < crop.phMin || ph > crop.phMax) {
        score -= 15;
        alertes.push(`pH du sol contraignant (${ph.toFixed(1)})`);
      }
    }

    if (azote !== null && azote < 1.5 && crop.fixeAzote) {
      score += 8;
      raisons.push('Fixe l’azote sur sol pauvre en azote');
    }

    if (argile !== null) {
      if (argile > 38 && (crop.code === 'arachide' || crop.code === 'pomme_de_terre' || crop.code === 'manioc')) {
        score -= 12;
        alertes.push(`Sol très argileux (${argile.toFixed(0)} %) défavorable aux tubercules/gousses`);
      } else if (argile > 35 && crop.code === 'riz') {
        score += 8;
        raisons.push(`Texture argileuse (${argile.toFixed(0)} %) favorable à la rétention d’eau`);
      }
    }

    // 6. Budget & viabilité économique pour le petit cultivateur
    if (budgetUsd > 0) {
      const totalCostNeeded = crop.coutVariableUsdAre * surfaceAres;
      if (budgetUsd >= totalCostNeeded) {
        score += 6;
        raisons.push(
          `Budget adapté (${budgetUsd.toFixed(0)} $ pour ~${totalCostNeeded.toFixed(1)} $ d’intrants)`
        );
      } else if (budgetPerAre < crop.coutVariableUsdAre * 0.65) {
        score -= 16;
        alertes.push(
          `Coût élevé (${crop.coutVariableUsdAre.toFixed(1)} $/are vs budget ${budgetPerAre.toFixed(1)} $/are)`
        );
      } else {
        score -= 6;
      }
    }

    // 7. Saison & durée de cycle disponible (sans pénaliser excessivement mais en respectant la saisonnalité)
    if (crop.cycleJours > duree + 40) {
      score -= 12;
      alertes.push(
        `Cycle long (${crop.cycleJours} jours > fenêtre saisonnière de ${duree} jours)`
      );
    } else {
      score += 4;
    }

    if (saison === 3 && crop.besoinHydrique === 'faible') {
      score += 4;
    }

    const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
    scored.push({
      profile: crop,
      candidate: {
        code: crop.code,
        nom: crop.nom,
        score_compatibilite: clampedScore,
        raisons_agronomiques:
          raisons.length > 0
            ? raisons
            : ['Compatibilité générale modérée selon les mesures disponibles'],
        points_vigilance: alertes,
      },
    });
  }

  scored.sort((a, b) => b.candidate.score_compatibilite - a.candidate.score_compatibilite);

  const winner = scored[0];
  const top5 = scored.slice(0, 5).map((item) => item.candidate);

  const prof = winner.profile;
  const estimationEconomique = buildEconomicEstimateForProfile(prof, surfaceAres, budgetUsd);

  return {
    donneesInsuffisantes: false,
    raisonInsuffisance: null,
    topCrop: prof,
    classement: top5,
    estimationEconomique,
    observations,
  };
}

function normalizeCropText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findCropProfileByName(rawLabel: string): CropProfile | null {
  const norm = normalizeCropText(rawLabel);
  if (!norm) return null;
  for (const crop of SUD_KIVU_CROPS) {
    const cNorm = normalizeCropText(crop.nom);
    const codeNorm = normalizeCropText(crop.code);
    if (norm === cNorm || norm === codeNorm || cNorm.includes(norm) || norm.includes(codeNorm)) {
      return crop;
    }
  }
  return null;
}

export function buildEconomicEstimateForProfile(
  prof: CropProfile,
  surfaceAres: number,
  budgetUsd: number
): EstimationEconomique {
  const coutVariablesUsd = Number((prof.coutVariableUsdAre * surfaceAres).toFixed(2));
  const recolteKg = Number((prof.rendementKgAre * surfaceAres).toFixed(1));
  const recetteBruteUsd = Number((recolteKg * prof.prixBordChampUsdKg).toFixed(2));
  const margeUsd = Number((recetteBruteUsd - coutVariablesUsd).toFixed(2));
  const TAUX = 2350;

  return {
    culture: prof.code,
    surface_demandee_ares: surfaceAres,
    surface_financable_estimee_ares:
      prof.coutVariableUsdAre > 0
        ? Number(Math.min(surfaceAres, budgetUsd / prof.coutVariableUsdAre).toFixed(1))
        : surfaceAres,
    rendement_prudent_kg_are: prof.rendementKgAre,
    recolte_estimee_kg: recolteKg,
    prix_bord_champ_usd_kg: prof.prixBordChampUsdKg,
    recette_brute_usd: recetteBruteUsd,
    couts_variables_estimes_usd: coutVariablesUsd,
    marge_avant_charges_non_comptabilisees_usd: margeUsd,
    recette_brute_cdf: Math.round(recetteBruteUsd * TAUX),
    marge_cdf: Math.round(margeUsd * TAUX),
    taux_usd_cdf: TAUX,
    source_economique:
      'Référentiel économique petits producteurs du Sud-Kivu (taux 1 USD = 2 350 FC), valeurs indicatives avant charges de transport et stockage.',
  };
}
