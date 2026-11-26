// C:\Me\AppMoney\MeParisPortifs\calculs-server.js
/**
 * Moteur de calcul Me2/3Legend v6.1.0 — Serveur
 * ⚠️ MIROIR EXACT de js/calculs.js
 *
 * CORRECTIF #6 : marges 6% prélevées à la validation (invisibles user)
 */
const DEFAULTS = {
  CAP: 1000,
  D4: 1.65,
  E3: 175,
  B3: 0.04,
  E4: 0.06,
  G4: 0,
  L7: 0.6,
  MARGE_BOOKMAKER: 0.06,
  MARGE_MISE: 0.06,
  MARGE_GAIN: 0.06
};

const SEUIL_COTE_MIN = 1.6;

function normaliserCote(v) {
  if (typeof v === 'string') {
    v = v.replace(',', '.').trim();
    if (v === '') return 0;
  }
  const n = parseFloat(v);
  return (isNaN(n) || n <= 0) ? 0 : n;
}

function ajusterCotesAvecMarge(cotesBrutes) {
  const c1 = normaliserCote(cotesBrutes['1']);
  const cN = normaliserCote(cotesBrutes['N']);
  const c2 = normaliserCote(cotesBrutes['2']);
  if (!c1 || !cN || !c2) return cotesBrutes;

  const sommeProbas = (1/c1) + (1/cN) + (1/c2);
  const objectif = 1 + DEFAULTS.MARGE_BOOKMAKER;
  if (sommeProbas >= objectif) return cotesBrutes;

  const facteur = sommeProbas / objectif;
  return {
    '1': Number((c1 * facteur).toFixed(2)),
    'N': Number((cN * facteur).toFixed(2)),
    '2': Number((c2 * facteur).toFixed(2))
  };
}

/* CORRECTIF #6 : marge sur mise */
function calculerMiseAvecMarge(miseAffichee) {
  const m = Math.max(0, Number(miseAffichee) || 0);
  const margeMise = Number((m * DEFAULTS.MARGE_MISE).toFixed(2));
  const miseReelle = Number((m - margeMise).toFixed(2));
  return { miseAffichee: m, margeMise, miseReelle };
}

/* CORRECTIF #6 : marge sur gain */
function calculerGainAvecMarge(miseAffichee, cote) {
  const brut = Number(miseAffichee) * Number(cote);
  const margeGain = Number((brut * DEFAULTS.MARGE_GAIN).toFixed(2));
  const gainNet = Number((brut - margeGain).toFixed(2));
  return { gainBrut: Number(brut.toFixed(2)), margeGain, gainNet };
}

function calcMises(cotes, opts = {}) {
  const K = { ...DEFAULTS, ...(opts.constantes || {}) };
  const mult = Number(opts.multiplicateur || 1);

  const triees = [
    { type: '1', cote: normaliserCote(cotes['1']) },
    { type: 'N', cote: normaliserCote(cotes['N']) },
    { type: '2', cote: normaliserCote(cotes['2']) }
  ].sort((a, b) => a.cote - b.cote);

  const c1 = triees[0].cote, cN = triees[1].cote, c2 = triees[2].cote;

  if (!c1 || !cN || !c2) {
    return {
      cotesTriees: triees,
      typeMin: triees[0].type, typeMid: triees[1].type, typeMax: triees[2].type,
      M1: 0, M2: 0, M3: 0, budget: 0, multiplicateur: mult,
      warning: { code: 'COTES_INCOMPLETES',
                 message: 'Les 3 cotes doivent être renseignées.' }
    };
  }

  const D4 = K.D4 || 1.65;
  const E3 = K.E3 || 175;
  const B3 = K.B3 || 0.04;
  const E4 = K.E4 || 0.06;
  const G4 = K.G4 || 0;
  const L7 = K.L7 || 0.6;
  const L7safe = L7 === 0 ? 0.001 : L7;

  const D3 = 9000 * D4;
  const E6 = 0.5822 * c1, G6 = 0.5822 * cN, I6 = 0.5822 * c2;
  const E7 = 0.282  * c1, G7 = 0.282  * cN, I7 = 0.05   * c2;

  const denom    = 1/E6 + 1/G6 + 1/I6 + 0/L7safe;
  const denomI8  = 1/E6 + 1/G6 + 1/I6 + 2/L7safe;
  const denomInv = 1/E7 + 1/G7 + 1/I7 + 0/L7safe;

  const C8 = D3/(E6*denom)   + B3*D3;
  const F8 = D3/(G6*denom)   + E4*D3;
  const I8 = D3/(I6*denomI8) + G4*D3;

  const C9 = E3/(E7*denomInv) + 0.75*E3;
  const F9 = E3/(G7*denomInv) + 0.90*E3;
  const I9 = E3/(E7*denomInv) + 0.80*E3;

  const M1 = ((C8 + I9) / 10) * mult;
  const M2 = ((F8 + F9) / 10) * mult;
  const M3 = ((I8 + C9) / 10) * mult;
  const budget = M1 + M2 + M3;

  let warning = null;
  if (c1 < SEUIL_COTE_MIN) {
    warning = {
      code: 'COTE_MIN_INSUFFISANTE',
      message: `⚠️ La plus petite cote (${c1.toFixed(3)}) est inférieure à ${SEUIL_COTE_MIN}. La garantie « 2 gagnants sur 3 » n'est plus assurée.`,
      coteMin: c1, seuil: SEUIL_COTE_MIN
    };
  }

  return {
    cotesTriees: triees,
    typeMin: triees[0].type, typeMid: triees[1].type, typeMax: triees[2].type,
    M1, M2, M3, budget, multiplicateur: mult, warning
  };
}

function buildTableaux(cotes, M) {
  const displayCols = ['1', 'N', '2'];
  const typeLabels = { '1': 'W1', 'N': 'X', '2': 'W2' };

  const posByType = {
    [M.typeMin]: 0,
    [M.typeMid]: 1,
    [M.typeMax]: 2
  };

  const perms = {
    T1: [M.M1, M.M2, M.M3],
    T2: [M.M1, M.M3, M.M2],
    T3: [M.M3, M.M1, M.M2]
  };

  const out = {};
  for (const [key, misesByPos] of Object.entries(perms)) {
    out[key] = displayCols.map(type => {
      const pos = posByType[type];
      const mise = misesByPos[pos];
      const cote = normaliserCote(cotes[type]);
      const { gainBrut, margeGain, gainNet } = calculerGainAvecMarge(mise, cote);
      const benefice = gainNet - M.budget;

      return {
        col: type,
        label: typeLabels[type],
        position: ['min', 'mid', 'max'][pos],
        cote,
        mise,
        gain: gainNet,
        gainBrut,
        margeGain,
        benefice,
        gagnant: gainNet > M.budget
      };
    });

    out[key].gagnants = out[key].filter(x => x.gagnant).map(x => x.col);
    out[key].perdants = out[key].filter(x => !x.gagnant).map(x => x.col);
    out[key].gainMax = Math.max(...out[key].map(x => x.gain));
    out[key].couverture =
      key === 'T1' ? ['min', 'mid'] :
      key === 'T2' ? ['min', 'max'] :
                     ['mid', 'max'];
    out[key].description =
      key === 'T1' ? 'Couvre petit + moyen (perd grande cote)' :
      key === 'T2' ? 'Couvre petit + grand (perd cote moyenne)' :
                     'Couvre moyen + grand (perd petite cote)';
  }
  return out;
}

function computeRi(budget, miseGagnante, coteGagnante) {
  const { gainNet } = calculerGainAvecMarge(miseGagnante, coteGagnante);
  return { gain: gainNet, Ri: gainNet - budget };
}

module.exports = {
  calcMises,
  buildTableaux,
  computeRi,
  normaliserCote,
  ajusterCotesAvecMarge,
  calculerMiseAvecMarge,
  calculerGainAvecMarge,
  DEFAULTS,
  SEUIL_COTE_MIN
};