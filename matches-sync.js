// C:\Me\AppMoney\MeParisPortifs\matches-sync.js
// v6.2.9 — Multidiscipline : sport_key The Odds API + mapping pays étendu
const { pool } = require('./db');
const logger = require('./logger');

const ODDS_BASE = 'https://api.the-odds-api.com/v4';

let oddsApiDisabled = false;

function isOddsApiDisabled() { return oddsApiDisabled; }

function resetOddsApi() {
  if (oddsApiDisabled) {
    oddsApiDisabled = false;
    logger.info('[Auto-Sync] 🔄 Drapeau 401 réinitialisé manuellement.');
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* HELPERS                                                           */
/* ═══════════════════════════════════════════════════════════════════ */

/* Sports à 2 issues (pas de match nul réel) */
function isTwoWaySport(sportKey) {
  return /(tennis|mma|boxing|cricket|rugby|americanfootball)/i.test(sportKey || '');
}

/* Mapping clé sport → label lisible (pour l'affichage) */
function sportLabel(sportKey) {
  const k = String(sportKey || '').toLowerCase();
  if (k.startsWith('soccer_')) return 'Football';
  if (k.startsWith('basketball_')) return 'Basketball';
  if (k.startsWith('tennis_')) return 'Tennis';
  if (k.startsWith('americanfootball_')) return 'Football US';
  if (k.startsWith('baseball_')) return 'Baseball';
  if (k.startsWith('icehockey_')) return 'Hockey';
  if (k.startsWith('mma_')) return 'MMA';
  if (k.startsWith('boxing_')) return 'Boxe';
  if (k.startsWith('cricket_')) return 'Cricket';
  if (k.startsWith('rugby')) return 'Rugby';
  return sportKey || 'Sport';
}

function ajusterCotesAvecMarge(c) {
  const [c1, cN, c2] = [Number(c['1']), Number(c['N']), Number(c['2'])];
  if (!c1 || !cN || !c2) return c;
  const s = 1 / c1 + 1 / cN + 1 / c2;
  const o = 1.06;
  return s >= o ? c : {
    '1': (c1 * (s / o)).toFixed(2),
    'N': (cN * (s / o)).toFixed(2),
    '2': (c2 * (s / o)).toFixed(2)
  };
}

function extrairePays(titre) {
  const t = (titre || '').toLowerCase();
  const map = [
    ['france', 'France'], ['ligue 1', 'France'],
    ['england', 'Angleterre'], ['premier league', 'Angleterre'],
    ['spain', 'Espagne'], ['la liga', 'Espagne'],
    ['italy', 'Italie'], ['serie a', 'Italie'],
    ['germany', 'Allemagne'], ['bundesliga', 'Allemagne'],
    ['portugal', 'Portugal'], ['netherlands', 'Pays-Bas'], ['eredivisie', 'Pays-Bas'],
    ['belgium', 'Belgique'], ['turkey', 'Turquie'],
    ['usa', 'États-Unis'], ['mls', 'États-Unis'],
    ['mexico', 'Mexique'], ['brazil', 'Brésil'], ['argentina', 'Argentine'],
    ['japan', 'Japon'], ['korea', 'Corée'], ['australia', 'Australie'], ['canada', 'Canada'],
    ['nba', 'États-Unis'], ['nfl', 'États-Unis'], ['nhl', 'États-Unis'], ['mlb', 'États-Unis'],
    ['ufc', 'International'], ['atp', 'International'], ['wta', 'International'],
    ['champions league', 'Europe'], ['europa league', 'Europe']
  ];
  for (const [k, v] of map) if (t.includes(k)) return v;
  return 'International';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* SYNCHRONISATION DES MATCHS À VENIR                                */
/* ═══════════════════════════════════════════════════════════════════ */
async function syncUpcomingMatches() {
  if (oddsApiDisabled) return;

  const start = Date.now();
  logger.info('[Auto-Sync] ▶️ Démarrage de la synchronisation automatique...');

  try {
    // Dans matches-sync.js (cherchez const apiKey = ... et remplacez par ceci)
    /* 1. Récupération de la clé */
    const keyRes = await pool.query(
      `SELECT value FROM company_settings WHERE key = 'theodds_key' LIMIT 1`
    );
    
    // ⭐ FALLBACK .ENV
    let apiKey = keyRes.rows[0]?.value;
    if (!apiKey || !apiKey.trim()) {
      apiKey = process.env.THEODDS_KEY;
    }

    if (!apiKey || !apiKey.trim()) {
      logger.warn('[Auto-Sync] Clé The Odds API absente (ni en BDD, ni dans .env). Synchronisation annulée.');
      return;
    }

    /* ⭐ v6.2.9 : The Odds API /upcoming couvre TOUS les sports */
    const upcomingUrl = `${ODDS_BASE}/sports/upcoming/odds/`
      + `?apiKey=${encodeURIComponent(apiKey.trim())}`
      + `&regions=eu,us,uk`
      + `&markets=h2h`
      + `&oddsFormat=decimal`
      + `&dateFormat=iso`;

    const r = await fetchWithTimeout(upcomingUrl);

    if (!r.ok) {
      if (r.status === 401) {
        oddsApiDisabled = true;
        logger.error('[Auto-Sync] ❌ HTTP 401 — Clé The Odds API invalide ou quota épuisé. Sync suspendue.');
        try {
          await pool.query(
            `INSERT INTO matches_sync_log(provider, statut, message)
             VALUES ('theodds', 'error', 'Quota épuisé (401) — sync suspendue')`
          );
        } catch (_) {}
      } else if (r.status === 429) {
        logger.warn('[Auto-Sync] ⚠️ HTTP 429 — Rate limit The Odds API.');
      } else {
        logger.error(`[Auto-Sync] ❌ HTTP ${r.status} — ${r.statusText || 'erreur inconnue'}`);
      }
      return;
    }

    const allGames = await r.json();
    if (!Array.isArray(allGames) || allGames.length === 0) {
      logger.info('[Auto-Sync] Aucun match retourné par The Odds API.');
      return;
    }

    /* Distribution des sports (diagnostic multidiscipline) */
    const sportDist = {};
    allGames.forEach(g => {
      const k = g.sport_key || 'inconnu';
      sportDist[k] = (sportDist[k] || 0) + 1;
    });
    logger.info(`[Auto-Sync] Distribution sports : ${Object.entries(sportDist).map(([k, n]) => `${k}(${n})`).join(', ')}`);

    let nbInserted = 0;
    let nbUpdated = 0;
    let nbSkipped = 0;

    for (const game of allGames) {
      try {
        let c1 = 0, cN = 0, c2 = 0;
        const isTwoWay = isTwoWaySport(game.sport_key);

        for (const bk of game.bookmakers || []) {
          for (const mk of bk.markets || []) {
            if (mk.key !== 'h2h') continue;
            for (const oc of mk.outcomes || []) {
              if (oc.name === game.home_team) c1 = Math.max(c1, oc.price);
              else if (oc.name === game.away_team) c2 = Math.max(c2, oc.price);
              else if (oc.name === 'Draw') cN = Math.max(cN, oc.price);
            }
          }
        }

        if (isTwoWay && c1 && c2 && !cN) cN = 100.00;

        if (!c1 || !cN || !c2) {
          nbSkipped++;
          continue;
        }

        const cotes = ajusterCotesAvecMarge({ '1': c1, 'N': cN, '2': c2 });

        /* ⭐ v6.2.9 : sport_key (clé) + sport_title (lisible) */
        const sportKey = game.sport_key || game.sport_group || 'sport';
        const sportTitle = game.sport_title || sportLabel(sportKey);

        const existing = await pool.query(
          `SELECT id FROM matches_cache WHERE external_id = $1 LIMIT 1`,
          [game.id]
        );

        if (existing.rows.length) {
          await pool.query(
            `UPDATE matches_cache
                SET cote_w1 = $1, cote_x = $2, cote_w2 = $3,
                    sport = $4, league = $5,
                    commence_at = $6, updated_at = NOW()
              WHERE external_id = $7`,
            [cotes['1'], cotes['N'], cotes['2'],
             sportKey, sportTitle,
             game.commence_time, game.id]
          );
          nbUpdated++;
        } else {
          await pool.query(
            `INSERT INTO matches_cache
               (external_id, sport, league, pays, equipe1, equipe2,
                cote_w1, cote_x, cote_w2, commence_at, raw, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'theodds')`,
            [
              game.id,
              sportKey,
              sportTitle,
              extrairePays(game.sport_title || game.sport_key),
              game.home_team,
              game.away_team,
              cotes['1'], cotes['N'], cotes['2'],
              game.commence_time,
              game
            ]
          );
          nbInserted++;
        }
      } catch (gameErr) {
        logger.warn(`[Auto-Sync] ⚠️ Match ${game.id} ignoré : ${gameErr.message}`);
        nbSkipped++;
      }
    }

    const duration = Date.now() - start;
    logger.info(
      `[Auto-Sync] ✅ Succès : ${nbInserted} ajoutés, ${nbUpdated} mis à jour, ` +
      `${nbSkipped} ignorés en ${duration}ms`
    );

    await pool.query(
      `INSERT INTO matches_sync_log
         (provider, nb_fetched, nb_inserted, nb_updated, duree_ms, statut, message)
       VALUES ('theodds', $1, $2, $3, $4, 'success', 'Auto')`,
      [allGames.length, nbInserted, nbUpdated, duration]
    );

  } catch (e) {
    logger.error('[Auto-Sync] ❌ Erreur réseau ou interne :', e.message);
  }
}

module.exports = {
  syncUpcomingMatches,
  isOddsApiDisabled,
  resetOddsApi,
  isTwoWaySport,
  sportLabel
};