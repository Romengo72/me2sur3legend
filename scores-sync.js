// C:\Me\AppMoney\MeParisPortifs\scores-sync.js
// v6.2.9 — Filtrage des sport_key invalides + fallback Sportradar
const { pool } = require('./db');
const logger = require('./logger');
const { isOddsApiDisabled } = require('./matches-sync');

let checkAndCreateSuspension = null;
try {
  const iaMod = require('./routes-ia');
  checkAndCreateSuspension = iaMod.checkAndCreateSuspension;
} catch (e) {
  logger.warn('[scores-sync] checkAndCreateSuspension non chargé :', e.message);
}

const MARGE_GAIN_RATE = 0.06;

/* ⭐ v6.2.9 : clés de sport valides pour The Odds API */
const VALID_ODDS_SPORTS = new Set([
  'soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a',
  'soccer_germany_bundesliga', 'soccer_france_ligue_one',
  'soccer_uefa_champs_league', 'soccer_uefa_europa_league',
  'soccer_usa_mls', 'soccer_brazil_campeonato',
  'basketball_nba', 'basketball_euroleague',
  'americanfootball_nfl', 'baseball_mlb', 'icehockey_nhl',
  'mma_mixed_martial_arts', 'boxing_boxing',
  'tennis_atp', 'tennis_wta', 'cricket_test_match', 'rugbyunion'
]);

/* ⭐ v6.2.9 : vérifie si la valeur ressemble à une clé The Odds API */
function isLikelyOddsSportKey(sport) {
  if (!sport || typeof sport !== 'string') return false;
  const s = sport.trim().toLowerCase();
  if (VALID_ODDS_SPORTS.has(s)) return true;
  /* Format général : "sport_region_competition" ou contient un underscore */
  return /^[a-z]+_[a-z0-9_]+$/.test(s);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function syncScoresAndValidate() {
  if (isOddsApiDisabled()) return;

  const start = Date.now();
  logger.info('[Scores-Sync] ▶️ Démarrage...');

  try {
    const keyRes = await pool.query(
      `SELECT value FROM company_settings WHERE key = 'theodds_key' LIMIT 1`
    );
    const apiKey = keyRes.rows[0]?.value;
    if (!apiKey || !apiKey.trim()) {
      logger.warn('[Scores-Sync] Clé The Odds API absente.');
      return;
    }

    const { rows: matchs } = await pool.query(
      `SELECT id, external_id, sport
         FROM matches_cache
        WHERE termine = FALSE
          AND commence_at < NOW() - INTERVAL '2 hours'
          AND commence_at > NOW() - INTERVAL '3 days'
        LIMIT 30`
    );

    if (!matchs.length) { logger.info('[Scores-Sync] Aucun match en attente.'); return; }
    logger.info(`[Scores-Sync] ${matchs.length} match(s) à vérifier.`);

    /* ⭐ v6.2.9 : filtrer les sport invalides AVANT de grouper */
    const sportsGroup = {};
    const invalidSports = new Set();

    matchs.forEach(m => {
      const sport = String(m.sport || '').trim();

      /* Cas 1 : pas de sport → ignorer */
      if (!sport) {
        invalidSports.add('(vide)');
        return;
      }

      /* Cas 2 : clé The Odds API valide → OK */
      if (isLikelyOddsSportKey(sport)) {
        if (!sportsGroup[sport]) sportsGroup[sport] = [];
        sportsGroup[sport].push(m);
        return;
      }

      /* Cas 3 : sport invalide → ignorer (sera traité par auto-settlement) */
      invalidSports.add(sport);
    });

    if (invalidSports.size > 0) {
      logger.warn(
        `[Scores-Sync] ⚠️ ${invalidSports.size} sport(s) ignoré(s) (non compatible The Odds API) : ` +
        `${Array.from(invalidSports).slice(0, 5).join(', ')}${invalidSports.size > 5 ? '…' : ''}. ` +
        `Ces matchs seront réglés via auto-settlement (Sportradar) ou manuellement.`
      );
    }

    if (Object.keys(sportsGroup).length === 0) {
      logger.info('[Scores-Sync] Aucun match avec sport The Odds API valide. Fin.');
      return;
    }

    let totalValidated = 0;
    let totalSkipped = 0;
    const usersToCheck = new Set();

    for (const sport of Object.keys(sportsGroup)) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/?apiKey=${encodeURIComponent(apiKey.trim())}&daysFrom=3`;
        const r = await fetchWithTimeout(url);

        if (!r.ok) {
          if (r.status === 401) {
            logger.warn(`[Scores-Sync] ⚠️ HTTP 401 sur ${sport}. Sync globale suspendue.`);
            return;
          }
          if (r.status === 429) { logger.warn(`[Scores-Sync] ⚠️ HTTP 429 sur ${sport}.`); continue; }
          if (r.status === 404) {
            logger.warn(`[Scores-Sync] ⚠️ HTTP 404 sur ${sport} (clé de sport inconnue de The Odds API). Skip.`);
            continue;
          }
          logger.error(`[Scores-Sync] ❌ HTTP ${r.status} sur ${sport}`);
          continue;
        }

        const scores = await r.json();
        if (!Array.isArray(scores)) { logger.warn(`[Scores-Sync] Réponse non-array pour ${sport}, skip.`); continue; }

        for (const s of scores) {
          if (!s.completed) continue;
          const matchDb = sportsGroup[sport].find(m => m.external_id === s.id);
          if (!matchDb) continue;

          if (!s.scores || !Array.isArray(s.scores) || s.scores.length < 2) {
            logger.warn(`[Scores-Sync] ⚠️ Match ${s.id} sans scores — SKIP`);
            totalSkipped++; continue;
          }

          const homeEntry = s.scores.find(x => x.name === s.home_team);
          const awayEntry = s.scores.find(x => x.name === s.away_team);
          if (!homeEntry || !awayEntry) {
            logger.warn(`[Scores-Sync] ⚠️ Noms d'équipes non trouvés pour ${s.id} — SKIP`);
            totalSkipped++; continue;
          }

          const s1 = Number(homeEntry.score);
          const s2 = Number(awayEntry.score);
          if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
            logger.warn(`[Scores-Sync] ⚠️ Scores non numériques pour ${s.id} — SKIP`);
            totalSkipped++; continue;
          }

          let resultat = 'N';
          if (s1 > s2) resultat = '1';
          else if (s1 < s2) resultat = '2';

          logger.info(`[Scores-Sync] ✅ ${s.home_team} ${s1}-${s2} ${s.away_team} → ${resultat}`);

          await pool.query(
            `UPDATE matches_cache SET termine = TRUE, resultat = $1, score1 = $2, score2 = $3, updated_at = NOW() WHERE id = $4`,
            [resultat, s1, s2, matchDb.id]
          );

          const validated = await validerSaisiesPourMatch(matchDb.external_id, resultat);
          totalValidated++;
          validated.emails.forEach(em => usersToCheck.add(em));
          if (validated.count > 0) {
            logger.info(`[Scores-Sync] 💰 ${validated.count} saisie(s) validée(s) pour ${s.id}`);
          }
        }
      } catch (sportErr) {
        logger.error(`[Scores-Sync] ❌ Erreur sport ${sport}: ${sportErr.message}`);
      }
    }

    for (const email of usersToCheck) {
      try {
        if (!checkAndCreateSuspension) continue;
        const u = await pool.query(`SELECT category FROM users WHERE email = $1`, [email]);
        await checkAndCreateSuspension(email, u.rows[0]?.category || 'free');
      } catch (err) { logger.warn(`[Scores-Sync suspension] ${email}: ${err.message}`); }
    }

    logger.info(`[Scores-Sync] ✅ Terminé : ${totalValidated} validé(s), ${totalSkipped} ignoré(s) en ${Date.now() - start}ms`);
  } catch (e) {
    logger.error('[Scores-Sync] ❌ Erreur globale :', e.message);
  }
}

async function validerSaisiesPourMatch(externalId, resultat) {
  const client = await pool.connect();
  let nbSaisiesModifiees = 0;
  const emails = new Set();

  try {
    await client.query('BEGIN');
    const { rows: saisies } = await client.query(
      `SELECT id, user_email, data FROM saisies
        WHERE valide = TRUE AND data->'VALIDATION' @> $1::jsonb
        FOR UPDATE`,
      [JSON.stringify([{ _external_id: externalId }])]
    );

    for (const s of saisies) {
      let modified = false;
      const data = s.data;
      let gainTotal = 0;
      let margeTotal = 0;

      for (let idx = 0; idx < (data.VALIDATION || []).length; idx++) {
        const match = data.VALIDATION[idx];
        if (match._external_id !== externalId) continue;
        if (!match.valide) continue;
        if (match.statuts && (match.statuts['1'] || match.statuts['N'] || match.statuts['2'])) continue;

        match.statuts = { '1': null, 'N': null, '2': null };
        if (resultat === '1') match.statuts['1'] = 'vert';
        else if (resultat === 'N') match.statuts['N'] = 'orange';
        else if (resultat === '2') match.statuts['2'] = 'rouge';

        const tableauKey = `T${match.tableauChoisi || 1}`;
        const T = match.tableaux?.[tableauKey] || [];
        const col = T.find(x => x.col === resultat);

        if (col) {
          const gainBrut = Number(col.mise) * Number(col.cote);
          const margeGain = Number((gainBrut * MARGE_GAIN_RATE).toFixed(2));
          const gainNet = Number((gainBrut - margeGain).toFixed(2));

          match.gainCredite = gainNet;
          match.margeGain = margeGain;
          match.Ri = gainNet - Number(match.miseDebitee || 0);
          match.validePar = 'Système (Auto)';
          match.valideLe = new Date().toISOString();
          gainTotal += gainNet;
          margeTotal += margeGain;
        }
        modified = true;
      }

      if (modified) {
        if (gainTotal > 0) {
          await client.query(
            `UPDATE users SET balance = balance + $1 WHERE email = $2`,
            [gainTotal, s.user_email]
          );
          await client.query(
            `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note)
             VALUES ($1, 'win', $2, $3, $4)`,
            [s.user_email, gainTotal, String(s.id), `Gain Auto (score-sync, résultat ${resultat})`]
          );
          emails.add(s.user_email);
        }
        if (margeTotal > 0) {
          await client.query(
            `INSERT INTO margin_collections(user_email, type, montant, ref_id, note)
             VALUES ($1, 'win', $2, $3, $4)`,
            [s.user_email, margeTotal, String(s.id), `Marge 6% sur gain (score-sync)`]
          );
        }
        await client.query(`UPDATE saisies SET data = $1 WHERE id = $2`, [data, s.id]);
        nbSaisiesModifiees++;
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logger.error('[Scores-Sync valider]', e.message);
  } finally {
    client.release();
  }

  return { count: nbSaisiesModifiees, emails: Array.from(emails) };
}

module.exports = { syncScoresAndValidate };