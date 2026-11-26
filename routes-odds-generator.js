// C:\Me\AppMoney\MeParisPortifs\routes-odds-generator.js
const express = require('express');
const { authenticateToken } = require('./utils');

const router = express.Router();

/** Loi de Poisson : P(X = k) = (λ^k × e^-λ) / k! */
function poisson(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

/** Convertit une probabilité en cote (marge 5 % par défaut) */
function probToCote(p, marge = 1.05) {
  const cote = marge / Math.max(p, 0.005);
  return Number(cote.toFixed(2));
}

/** POST /api/odds/generate — cotes 1N2 à partir de λ domicile/extérieur */
router.post('/odds/generate', authenticateToken, (req, res) => {
  try {
    const {
      lambdaHome = 1.6,
      lambdaAway = 1.1,
      maxGoals = 6,
      marge = 1.05
    } = req.body || {};

    let pH = 0, pD = 0, pA = 0;
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        const p = poisson(lambdaHome, h) * poisson(lambdaAway, a);
        if (h > a) pH += p;
        else if (h === a) pD += p;
        else pA += p;
      }
    }

    const total = pH + pD + pA;
    pH /= total; pD /= total; pA /= total;

    res.json({
      cotes: {
        '1': probToCote(pH, marge),
        'N': probToCote(pD, marge),
        '2': probToCote(pA, marge)
      },
      probs: {
        pH: Number(pH.toFixed(4)),
        pD: Number(pD.toFixed(4)),
        pA: Number(pA.toFixed(4))
      }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** GET /api/ia/search-by-discipline — placeholder Phase 6 */
router.get('/ia/search-by-discipline', authenticateToken, (_req, res) => {
  res.json({ ok: true, matches: [], note: 'Disponible en Phase 6' });
});

module.exports = router;