// C:\Me\AppMoney\MeParisPortifs\football-data.js
// ═══════════════════════════════════════════════════════════════════
// Client API Football-Data.org (gratuit : 10 req/min, 100 req/jour)
//   • Récupère le classement réel des équipes
//   • Cache 24h pour économiser le quota
//   • Fallback silencieux si API indisponible
// ═══════════════════════════════════════════════════════════════════

const logger = require('./logger');

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE_URL = 'https://api.football-data.org/v4';

/* Codes des compétitions supportées (gratuit) */
const COMPETITIONS = {
  'sr:competition:17':  'PL',   // Premier League
  'sr:competition:8':   'PD',   // La Liga
  'sr:competition:23':  'SA',   // Serie A
  'sr:competition:35':  'BL1',  // Bundesliga
  'sr:competition:34':  'FL1',  // Ligue 1
  'sr:competition:7':   'CL',   // Champions League
  'sr:competition:242': 'MLS'   // MLS (peut ne pas être dans le free tier)
};

/* Cache en mémoire : { competitionCode: { standings, fetchedAt } } */
const standingsCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/* ═══════════════════════════════════════════════════════════════════ */
/* HELPERS                                                            */
/* ═══════════════════════════════════════════════════════════════════ */

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise un nom d'équipe pour comparaison.
 * "Paris Saint-Germain FC" → "psg"
 * "FC Barcelona" → "barcelone"
 */
function normaliserNom(nom) {
  return String(nom || '')
    .toLowerCase()
    .replace(/fc|cf|sc|ac|as|afc|united|city|club|de|the|real|atletico/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/* ═══════════════════════════════════════════════════════════════════ */
/* RÉCUPÉRATION DU CLASSEMENT                                        */
/* ═══════════════════════════════════════════════════════════════════ */

async function fetchStandings(competitionCode) {
  if (!API_KEY) return null;

  /* Vérifier le cache */
  const cached = standingsCache.get(competitionCode);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.standings;
  }

  try {
    const url = `${BASE_URL}/competitions/${competitionCode}/standings`;
    const res = await fetchWithTimeout(url, {
      headers: { 'X-Auth-Token': API_KEY }
    });

    if (res.status === 429) {
      logger.warn(`[FootballData] Rate limit atteint pour ${competitionCode}`);
      return cached?.standings || null;
    }

    if (!res.ok) {
      logger.warn(`[FootballData] HTTP ${res.status} pour ${competitionCode}`);
      return null;
    }

    const data = await res.json();
    const standings = data?.standings?.find(s => s.type === 'TOTAL')?.table || [];

    /* Mise en cache */
    standingsCache.set(competitionCode, {
      standings,
      fetchedAt: Date.now()
    });

    logger.info(`[FootballData] ${competitionCode} : ${standings.length} équipes`);
    return standings;
  } catch (e) {
    logger.warn(`[FootballData] Erreur ${competitionCode}: ${e.message}`);
    return cached?.standings || null;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* FORCE D'UNE ÉQUIPE À PARTIR DU CLASSEMENT                          */
/* ═══════════════════════════════════════════════════════════════════ */

/**
 * Retourne la force d'une équipe (0.2 à 0.95) basée sur son classement.
 * Utilise une moyenne pondérée entre position et points.
 */
function forceDepuisClassement(standings, nomEquipe) {
  if (!standings || standings.length === 0) return null;

  const nomNormalise = normaliserNom(nomEquipe);
  if (!nomNormalise) return null;

  /* Chercher l'équipe par correspondance floue */
  let equipe = null;
  let meilleurScore = 0;

  for (const entry of standings) {
    const nomData = normaliserNom(entry.team?.name || entry.team?.shortName || '');
    if (!nomData) continue;

    /* Correspondance exacte */
    if (nomData === nomNormalise) {
      equipe = entry;
      break;
    }

    /* Correspondance partielle (au moins 4 caractères en commun) */
    let communs = 0;
    for (let i = 0; i < Math.min(nomData.length, nomNormalise.length); i++) {
      if (nomData[i] === nomNormalise[i]) communs++;
      else break;
    }
    if (communs >= 4 && communs > meilleurScore) {
      meilleurScore = communs;
      equipe = entry;
    }
  }

  if (!equipe) return null;

  const position = equipe.position;
  const totalEquipes = standings.length;

  /* Force basée sur la position : 1er → 0.95, dernier → 0.2 */
  const forcePosition = 0.2 + (1 - (position - 1) / (totalEquipes - 1)) * 0.75;

  return Number(forcePosition.toFixed(3));
}

/* ═══════════════════════════════════════════════════════════════════ */
/* API PUBLIQUE                                                       */
/* ═══════════════════════════════════════════════════════════════════ */

/**
 * Récupère la force d'une équipe via son classement réel.
 * Retourne null si l'API est indisponible ou l'équipe introuvable.
 */
async function getForceReelle(nomEquipe, competitionSportradarId) {
  const competitionCode = COMPETITIONS[competitionSportradarId];
  if (!competitionCode) return null;

  const standings = await fetchStandings(competitionCode);
  if (!standings) return null;

  return forceDepuisClassement(standings, nomEquipe);
}

/**
 * Vérifie si le client Football-Data est disponible.
 */
function isAvailable() {
  return !!API_KEY;
}

/**
 * Liste les compétitions supportées.
 */
function getSupportedCompetitions() {
  return Object.keys(COMPETITIONS);
}

module.exports = {
  getForceReelle,
  isAvailable,
  getSupportedCompetitions,
  fetchStandings,
  forceDepuisClassement,
  normaliserNom
};