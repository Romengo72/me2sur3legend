// C:\Me\AppMoney\MeParisPortifs\matches-sync-sportradar.js
// ═══════════════════════════════════════════════════════════════════
// v1.2 — Sync Sportradar + générateur de cotes hybride
//   • Filtrage côté code (competition_id ignoré par l'API trial)
//   • Génération de cotes via odds-generator-v2 (classement réel)
//   • Fallback sur hash temporel si Football-Data indisponible
//   • Garde-fous : cotes entre 1.60 et 8.00, marge 6%
// ═══════════════════════════════════════════════════════════════════

const { pool } = require('./db');
const logger = require('./logger');
const { genererCotesHybride } = require('./odds-generator-v2');

const SPORTRADAR_API_KEY = process.env.SPORTRADAR_API_KEY;
const SPORTRADAR_LEVEL = process.env.SPORTRADAR_LEVEL || 'trial';

/* ⭐ Compétitions à filtrer (parmi tous les matchs récupérés) */
const COMPETITIONS_A_GARDER = {
  'sr:competition:17': { nom: 'Premier League',   pays: 'Angleterre' },
  'sr:competition:8':  { nom: 'LaLiga',           pays: 'Espagne' },
  'sr:competition:34': { nom: 'Ligue 1',          pays: 'France' },
  'sr:competition:35': { nom: 'Bundesliga',       pays: 'Allemagne' },
  'sr:competition:23': { nom: 'Serie A',          pays: 'Italie' },
  'sr:competition:7':  { nom: 'Champions League', pays: 'Europe' },
  'sr:competition:679': { nom: 'Europa League',   pays: 'Europe' },
  'sr:competition:242': { nom: 'MLS',             pays: 'USA' },
  'sr:competition:955': { nom: 'Saudi Pro League', pays: 'Arabie Saoudite' }
};

let sportradarSyncDisabled = false;

/* ═══════════════════════════════════════════════════════════════════ */
/* HELPERS                                                            */
/* ═══════════════════════════════════════════════════════════════════ */

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════════════════════════════════ */
/* RÉCUPÉRATION BRUTE D'UNE JOURNÉE                                   */
/* ═══════════════════════════════════════════════════════════════════ */

async function fetchDaySchedules(dateStr) {
  if (!SPORTRADAR_API_KEY) return [];

  try {
    const url = `https://api.sportradar.com/soccer/${SPORTRADAR_LEVEL}/v4/en/schedules/${dateStr}/schedules.json`;

    const res = await fetchWithTimeout(url, {
      headers: {
        'accept': 'application/json',
        'x-api-key': SPORTRADAR_API_KEY
      }
    }, 30000);

    if (res.status === 401 || res.status === 403) {
      logger.error(`[SR-Sync] Auth échouée (${res.status}) — arrêt de la sync`);
      sportradarSyncDisabled = true;
      return [];
    }

    if (res.status === 429) {
      logger.warn(`[SR-Sync] Quota dépassé — pause`);
      return [];
    }

    if (!res.ok) {
      logger.warn(`[SR-Sync] HTTP ${res.status} pour ${dateStr}`);
      return [];
    }

    const data = await res.json();
    return data?.schedules || data?.sport_events || [];
  } catch (e) {
    logger.warn(`[SR-Sync] Erreur ${dateStr}: ${e.message}`);
    return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* FILTRAGE CÔTÉ CODE                                                 */
/* ═══════════════════════════════════════════════════════════════════ */

function filtrerMatchsInteressants(events) {
  const filtered = [];

  for (const ev of events) {
    const context = ev.sport_event?.sport_event_context;
    if (!context) continue;

    const competitionId = context.competition?.id;
    if (!COMPETITIONS_A_GARDER[competitionId]) continue;

    const status = ev.sport_event_status?.status;
    if (['closed', 'ended', 'cancelled', 'postponed'].includes(status)) continue;

    const competitors = ev.sport_event.competitors || [];
    const home = competitors.find(c => c.qualifier === 'home');
    const away = competitors.find(c => c.qualifier === 'away');
    if (!home || !away) continue;

    filtered.push({
      ev,
      competitionId,
      competitionNom: COMPETITIONS_A_GARDER[competitionId].nom,
      competitionPays: COMPETITIONS_A_GARDER[competitionId].pays
    });
  }

  return filtered;
}

/* ═══════════════════════════════════════════════════════════════════ */
/* INSERTION DANS matches_cache AVEC COTES GÉNÉRÉES                   */
/* ═══════════════════════════════════════════════════════════════════ */

async function insertSportradarEvent(item) {
  const { ev, competitionId, competitionNom, competitionPays } = item;
  const externalId = ev.sport_event?.id;
  if (!externalId) return null;

  /* Skip si déjà présent */
  const existing = await pool.query(
    `SELECT id FROM matches_cache WHERE external_id = $1 LIMIT 1`,
    [externalId]
  );
  if (existing.rows.length) return null;

  const sportEvent = ev.sport_event;
  const competitors = sportEvent.competitors || [];
  const home = competitors.find(c => c.qualifier === 'home');
  const away = competitors.find(c => c.qualifier === 'away');

  if (!home || !away) return null;

  const startTime = sportEvent.start_time;
  if (!startTime) return null;

  /* ⭐ GÉNÉRATION DES COTES (hybride : classement réel + fallback hash) */
  let result;
  try {
    result = await genererCotesHybride({
      equipe1: home.name,
      equipe2: away.name,
      competitionId: competitionId,
      dateMatch: startTime.slice(0, 10),
      maxButs: 6,
      marge: 1.06
    });
  } catch (e) {
    logger.warn(`[SR-Sync] Impossible de générer les cotes pour ${home.name} vs ${away.name}: ${e.message}`);
    /* Fallback minimal : cotes neutres */
    result = {
      cotes: { '1': 2.10, 'N': 3.40, '2': 3.20 },
      probs: null,
      lambdas: null,
      sources: { equipe1: 'fallback', equipe2: 'fallback' },
      forces: null
    };
  }

  try {
    await pool.query(
      `INSERT INTO matches_cache
         (external_id, sport, league, pays, equipe1, equipe2,
          cote_w1, cote_x, cote_w2, commence_at, source, raw)
       VALUES ($1, 'soccer', $2, $3, $4, $5, $6, $7, $8, $9, 'sportradar', $10)
       ON CONFLICT (external_id) DO NOTHING`,
      [
        externalId,
        competitionNom,
        competitionPays,
        home.name,
        away.name,
        result.cotes['1'],
        result.cotes['N'],
        result.cotes['2'],
        startTime,
        {
          ...ev,
          _generated_odds: {
            cotes: result.cotes,
            probs: result.probs,
            lambdas: result.lambdas,
            sources: result.sources,
            forces: result.forces
          }
        }
      ]
    );
    return externalId;
  } catch (e) {
    logger.warn(`[SR-Sync] Erreur insertion ${externalId}: ${e.message}`);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* SYNCHRONISATION GLOBALE                                            */
/* ═══════════════════════════════════════════════════════════════════ */

async function syncFromSportradar() {
  if (sportradarSyncDisabled) {
    return { skipped: true, reason: 'disabled_after_error' };
  }

  if (!SPORTRADAR_API_KEY) {
    logger.warn('[SR-Sync] SPORTRADAR_API_KEY absente — sync annulée');
    return { skipped: true, reason: 'no_key' };
  }

  const start = Date.now();
  logger.info('[SR-Sync] ▶️ Démarrage sync Sportradar (filtrage + cotes hybrides)...');

  let totalFetched = 0;
  let totalFiltered = 0;
  let totalInserted = 0;

  const today = new Date();

  /* Récupérer J0, J+1, J+2 (3 jours) */
  for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
    if (sportradarSyncDisabled) break;

    const d = new Date(today);
    d.setDate(d.getDate() + dayOffset);
    const dateStr = formatDate(d);

    const events = await fetchDaySchedules(dateStr);
    totalFetched += events.length;
    logger.info(`[SR-Sync] ${dateStr} : ${events.length} events récupérés`);

    const filtered = filtrerMatchsInteressants(events);
    totalFiltered += filtered.length;
    logger.info(`[SR-Sync] ${dateStr} : ${filtered.length} matchs intéressants`);

    for (const item of filtered) {
      const inserted = await insertSportradarEvent(item);
      if (inserted) totalInserted++;
    }

    /* Délai pour respecter QPS=1 du trial */
    await new Promise(r => setTimeout(r, 1200));
  }

  const duration = Date.now() - start;
  logger.info(
    `[SR-Sync] ✅ Terminé : ${totalFetched} récupérés, ${totalFiltered} filtrés, ` +
    `${totalInserted} ajoutés en ${duration}ms`
  );

  return {
    fetched: totalFetched,
    filtered: totalFiltered,
    inserted: totalInserted,
    duration_ms: duration
  };
}

/* ═══════════════════════════════════════════════════════════════════ */
/* EXPORTS                                                            */
/* ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  syncFromSportradar,
  isSportradarSyncDisabled: () => sportradarSyncDisabled,
  resetSportradarSync: () => { sportradarSyncDisabled = false; }
};