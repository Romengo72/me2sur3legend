// C:\Me\AppMoney\MeParisPortifs\odds-generator-v2.js
// ═══════════════════════════════════════════════════════════════════
// v2.0 — Générateur hybride
//   • Utilise le VRAI classement Football-Data.org si dispo
//   • Fallback sur le hash temporel v1.1 sinon
//   • Toujours borné : [1.60, 8.00]
// ═══════════════════════════════════════════════════════════════════

const base = require('./odds-generator');
const footballData = require('./football-data');
const logger = require('./logger');

/* ─────────────────────────────────────────────────────────────── */
/* ESTIMATION HYBRIDE DE λ                                            */
/* ─────────────────────────────────────────────────────────────── */
async function estimerLambdaHybride(nomEquipe, competitionId, dateRef, estDomicile) {
  /* 1. Essayer le classement réel */
  if (footballData.isAvailable() && competitionId) {
    try {
      const forceReelle = await footballData.getForceReelle(nomEquipe, competitionId);
      if (forceReelle !== null) {
        /* ⭐ MODULATION TEMPORELLE même avec classement réel :
           70% force réelle + 30% variation temporelle */
        const semaine = Math.floor(new Date(dateRef).getTime() / (7 * 24 * 3600 * 1000));
        const tempSeed = base.forceEquipe(nomEquipe, `temp-${semaine}`);
        const variation = (tempSeed - 0.5) * 0.2; // ±0.1 max

        let forceMixee = forceReelle + variation;
        forceMixee = Math.max(0.2, Math.min(0.95, forceMixee));

        let lambda = 0.8 + forceMixee * 1.6;
        if (estDomicile) lambda *= 1.15;

        return {
          lambda: Math.max(0.5, Math.min(3.0, lambda)),
          source: 'classement_reel',
          force: forceMixee
        };
      }
    } catch (e) {
      logger.warn(`[OddsV2] Classement ${nomEquipe} échoué: ${e.message}`);
    }
  }

  /* 2. Fallback : hash temporel pur */
  const force = base.forceEquipe(nomEquipe, dateRef);
  let lambda = 0.8 + force * 1.6;
  if (estDomicile) lambda *= 1.15;
  return {
    lambda: Math.max(0.5, Math.min(3.0, lambda)),
    source: 'hash_temporal',
    force
  };
}

/* ─────────────────────────────────────────────────────────────── */
/* GÉNÉRATION HYBRIDE                                                 */
/* ─────────────────────────────────────────────────────────────── */
async function genererCotesHybride({
  equipe1,
  equipe2,
  competitionId,
  dateMatch,
  maxButs = 6,
  marge = 1.06
}) {
  if (!equipe1 || !equipe2) {
    throw new Error('Les deux noms d\'équipes sont requis');
  }

  const dateRef = dateMatch || new Date().toISOString().slice(0, 10);

  /* Estimation des λ avec la meilleure source disponible */
  const h = await estimerLambdaHybride(equipe1, competitionId, dateRef, true);
  const a = await estimerLambdaHybride(equipe2, competitionId, dateRef, false);

  const lambdaHome = h.lambda;
  const lambdaAway = a.lambda;

  /* Calcul des probabilités (Poisson) */
  let pH = 0, pD = 0, pA = 0;
  for (let hh = 0; hh <= maxButs; hh++) {
    for (let aa = 0; aa <= maxButs; aa++) {
      const p = base.poisson(lambdaHome, hh) * base.poisson(lambdaAway, aa);
      if (hh > aa) pH += p;
      else if (hh === aa) pD += p;
      else pA += p;
    }
  }

  const total = pH + pD + pA;
  pH /= total; pD /= total; pA /= total;

  const cotes = {
    '1': base.probToCote(pH, marge),
    'N': base.probToCote(pD, marge),
    '2': base.probToCote(pA, marge)
  };

  /* Garde-fous */
  const minCote = Math.min(cotes['1'], cotes['N'], cotes['2']);
  if (minCote < 1.60) {
    const f = 1.60 / minCote;
    cotes['1'] = Number((cotes['1'] * f).toFixed(2));
    cotes['N'] = Number((cotes['N'] * f).toFixed(2));
    cotes['2'] = Number((cotes['2'] * f).toFixed(2));
  }
  const maxCote = Math.max(cotes['1'], cotes['N'], cotes['2']);
  if (maxCote > 8.00) {
    const f = 8.00 / maxCote;
    cotes['1'] = Number((cotes['1'] * f).toFixed(2));
    cotes['N'] = Number((cotes['N'] * f).toFixed(2));
    cotes['2'] = Number((cotes['2'] * f).toFixed(2));
  }

  return {
    cotes,
    probs: {
      pH: Number(pH.toFixed(4)),
      pD: Number(pD.toFixed(4)),
      pA: Number(pA.toFixed(4))
    },
    lambdas: {
      home: Number(lambdaHome.toFixed(2)),
      away: Number(lambdaAway.toFixed(2))
    },
    sources: {
      equipe1: h.source,
      equipe2: a.source
    },
    forces: {
      equipe1: Number(h.force.toFixed(3)),
      equipe2: Number(a.force.toFixed(3))
    }
  };
}

module.exports = {
  genererCotesHybride,
  estimerLambdaHybride
};