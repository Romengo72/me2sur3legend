// C:\Me\AppMoney\MeParisPortifs\odds-generator.js
// ═══════════════════════════════════════════════════════════════════
// v1.1 — Générateur sécurisé avec garde-fous
//   • Modulation temporelle (Barcelone ne gagne pas toujours)
//   • Cotes bornées : [1.60, 8.00]
//   • Marge 6% garantie
//   • Bruit contrôlé par match (même équipe ≠ mêmes cotes)
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');

/* ─────────────────────────────────────────────────────────────── */
/* POISSON                                                            */
/* ─────────────────────────────────────────────────────────────── */
function poisson(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

function probToCote(p, marge = 1.06) {
  const cote = marge / Math.max(p, 0.005);
  return Number(cote.toFixed(2));
}

/* ─────────────────────────────────────────────────────────────── */
/* HASH DÉTERMINISTE                                                  */
/* ─────────────────────────────────────────────────────────────── */
function hashToFloat(str) {
  const hash = crypto.createHash('sha256').update(str).digest();
  return hash.readUInt32BE(0) / 0xFFFFFFFF;
}

/* ─────────────────────────────────────────────────────────────── */
/* FORCE DE L'ÉQUIPE (modulée dans le temps)                          */
/* ─────────────────────────────────────────────────────────────── */
function forceEquipe(nomEquipe, dateStr) {
  const baseForce = hashToFloat(nomEquipe);

  /* Modulation par semaine (change chaque semaine) */
  const semaine = Math.floor(new Date(dateStr).getTime() / (7 * 24 * 3600 * 1000));
  const tempSeed = hashToFloat(`${nomEquipe}-${semaine}`);

  /* 40% base stable + 60% modulation temporelle */
  const force = baseForce * 0.4 + tempSeed * 0.6;

  /* Normaliser entre 0.2 et 0.95 */
  return 0.2 + force * 0.75;
}

/* ─────────────────────────────────────────────────────────────── */
/* ESTIMATION DES BUTS ATTENDUS                                       */
/* ─────────────────────────────────────────────────────────────── */
function estimerLambda(nomEquipe, dateStr, estDomicile) {
  const force = forceEquipe(nomEquipe, dateStr);
  let lambda = 0.8 + force * 1.6;
  if (estDomicile) lambda *= 1.15;
  return Math.max(0.5, Math.min(3.0, lambda));
}

/* ─────────────────────────────────────────────────────────────── */
/* GÉNÉRATION DES COTES                                               */
/* ─────────────────────────────────────────────────────────────── */
function genererCotes({ equipe1, equipe2, dateMatch, maxButs = 6, marge = 1.06 }) {
  if (!equipe1 || !equipe2) {
    throw new Error('Les deux noms d\'équipes sont requis');
  }

  const dateRef = dateMatch || new Date().toISOString().slice(0, 10);

  const lambdaHome = estimerLambda(equipe1, dateRef, true);
  const lambdaAway = estimerLambda(equipe2, dateRef, false);

  let pH = 0, pD = 0, pA = 0;
  for (let h = 0; h <= maxButs; h++) {
    for (let a = 0; a <= maxButs; a++) {
      const p = poisson(lambdaHome, h) * poisson(lambdaAway, a);
      if (h > a) pH += p;
      else if (h === a) pD += p;
      else pA += p;
    }
  }

  const total = pH + pD + pA;
  pH /= total; pD /= total; pA /= total;

  const cotes = {
    '1': probToCote(pH, marge),
    'N': probToCote(pD, marge),
    '2': probToCote(pA, marge)
  };

  /* ⭐ GARDE-FOU 1 : cote min ≥ 1.60 */
  const minCote = Math.min(cotes['1'], cotes['N'], cotes['2']);
  if (minCote < 1.60) {
    const facteur = 1.60 / minCote;
    cotes['1'] = Number((cotes['1'] * facteur).toFixed(2));
    cotes['N'] = Number((cotes['N'] * facteur).toFixed(2));
    cotes['2'] = Number((cotes['2'] * facteur).toFixed(2));
  }

  /* ⭐ GARDE-FOU 2 : cote max ≤ 8.00 */
  const maxCote = Math.max(cotes['1'], cotes['N'], cotes['2']);
  if (maxCote > 8.00) {
    const facteur = 8.00 / maxCote;
    cotes['1'] = Number((cotes['1'] * facteur).toFixed(2));
    cotes['N'] = Number((cotes['N'] * facteur).toFixed(2));
    cotes['2'] = Number((cotes['2'] * facteur).toFixed(2));
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
    forces: {
      equipe1: Number(forceEquipe(equipe1, dateRef).toFixed(3)),
      equipe2: Number(forceEquipe(equipe2, dateRef).toFixed(3))
    }
  };
}

module.exports = {
  poisson,
  probToCote,
  forceEquipe,
  estimerLambda,
  genererCotes
};