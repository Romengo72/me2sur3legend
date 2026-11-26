// C:\Me\AppMoney\MeParisPortifs\auto-settlement.js
// v6.2.9 — Multidiscipline : mapping sport_key → Sportradar, skip si non couvert
const { pool } = require('./db');
const logger = require('./logger');
const crypto = require('crypto');

const SPORTRADAR_API_KEY = process.env.SPORTRADAR_API_KEY;
const SPORTRADAR_BASE = 'https://api.sportradar.com';
const ODDSPAPI_KEY = process.env.ODDSPAPI_KEY;
const ODDSPAPI_BASE = 'https://v5.oddspapi.io';

const MIN_DELAY_AFTER_KICKOFF_MS = Number(process.env.SETTLEMENT_MIN_DELAY_MS || 2 * 60 * 60 * 1000);
const MAX_MATCH_AGE_MS = Number(process.env.SETTLEMENT_MAX_AGE_DAYS || 7) * 24 * 60 * 60 * 1000;
const SETTLEMENT_INTERVAL_MS = Number(process.env.SETTLEMENT_INTERVAL_MS || 5 * 60 * 1000);

let isRunning = false;

/* ═══════════════════════════════════════════════════════════════════ */
/* MAPPING sport_key The Odds API → sport Sportradar                 */
/* ═══════════════════════════════════════════════════════════════════ */
function mapSportToSportradar(sportKey) {
  const k = String(sportKey || '').toLowerCase();
  if (!k) return 'soccer';
  if (k.startsWith('soccer_')) return 'soccer';
  if (k.startsWith('basketball_')) return 'basketball';
  if (k.startsWith('tennis_')) return 'tennis';
  if (k.startsWith('americanfootball_')) return 'americanfootball';
  if (k.startsWith('baseball_')) return 'baseball';
  if (k.startsWith('icehockey_')) return 'icehockey';
  if (k.startsWith('mma_') || k.startsWith('boxing_')) return 'mma';
  if (k.startsWith('cricket_')) return 'cricket';
  if (k.startsWith('rugby')) return 'rugby';
  /* Sportradar : soccer par défaut */
  return 'soccer';
}

/* Sports couverts par Sportradar trial (soccer uniquement) */
const SPORTRADAR_TRIAL_SPORTS = new Set(['soccer']);

/* ═══════════════════════════════════════════════════════════════════ */
/* HELPERS                                                           */
/* ═══════════════════════════════════════════════════════════════════ */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function determinerIssue(scoreHome, scoreAway) {
  const s1 = Number(scoreHome);
  const s2 = Number(scoreAway);
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) return null;
  if (s1 < 0 || s2 < 0) return null;
  if (s1 > s2) return '1';
  if (s1 < s2) return '2';
  return 'N';
}

/* ═══════════════════════════════════════════════════════════════════ */
/* SPORTRADAR                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
async function fetchScoreSportradar(externalId, sport = 'soccer') {
  if (!SPORTRADAR_API_KEY) return null;

  /* ⭐ v6.2.9 : skip si le sport n'est pas couvert par le plan trial */
  if (!SPORTRADAR_TRIAL_SPORTS.has(sport)) {
    logger.info(`[Auto-Settlement] Sportradar : sport '${sport}' non couvert par le plan trial, skip.`);
    return null;
  }

  try {
    let urn;
    const idStr = String(externalId);

    if (idStr.startsWith('sr:match:') || idStr.startsWith('sr:sport_event:')) {
      urn = idStr;
    } else {
      urn = `sr:match:${idStr}`;
    }

    const level = process.env.SPORTRADAR_LEVEL || 'trial';
    const url = `${SPORTRADAR_BASE}/${sport}/${level}/v4/en/sport_events/${urn}/summary.json`;

    const res = await fetchWithTimeout(url, {
      headers: { 'accept': 'application/json', 'x-api-key': SPORTRADAR_API_KEY }
    }, 15000);

    if (!res.ok) {
      logger.warn(`[Auto-Settlement] Sportradar HTTP ${res.status} pour ${externalId} (urn: ${urn}, sport: ${sport})`);
      return null;
    }

    const data = await res.json();
    const status = data?.sport_event_status;

    if (!status || (status.status !== 'ended' && status.status !== 'closed')) {
      logger.info(`[Auto-Settlement] Sportradar : match ${externalId} pas encore terminé (${status?.status || 'inconnu'})`);
      return null;
    }

    const scoreHome = status.home_score;
    const scoreAway = status.away_score;

    if (scoreHome === undefined || scoreAway === undefined) {
      logger.warn(`[Auto-Settlement] Sportradar : scores manquants pour ${externalId}`);
      return null;
    }

    return {
      score1: Number(scoreHome),
      score2: Number(scoreAway),
      source: 'sportradar',
      raw: data,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    logger.warn(`[Auto-Settlement] Sportradar error ${externalId}: ${e.message}`);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* ODDSPAPI (fallback)                                               */
/* ═══════════════════════════════════════════════════════════════════ */
async function fetchScoreOddsPapi(externalId) {
  if (!ODDSPAPI_KEY) return null;

  try {
    const url = `${ODDSPAPI_BASE}/en/fixtures/settlement?fixtureId=${encodeURIComponent(externalId)}&apiKey=${ODDSPAPI_KEY}`;
    const res = await fetchWithTimeout(url, {}, 15000);

    if (!res.ok) {
      logger.warn(`[Auto-Settlement] OddsPapi HTTP ${res.status} pour ${externalId}`);
      return null;
    }

    const data = await res.json();
    const scores = data?.scores?.result;

    if (!scores) {
      logger.info(`[Auto-Settlement] OddsPapi : pas de scores pour ${externalId}`);
      return null;
    }

    const scoreHome = scores.participant1Score;
    const scoreAway = scores.participant2Score;

    if (scoreHome === undefined || scoreAway === undefined) {
      logger.warn(`[Auto-Settlement] OddsPapi : scores manquants pour ${externalId}`);
      return null;
    }

    return {
      score1: Number(scoreHome),
      score2: Number(scoreAway),
      source: 'oddspapi',
      raw: data,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    logger.warn(`[Auto-Settlement] OddsPapi error ${externalId}: ${e.message}`);
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* FALLBACK                                                          */
/* ═══════════════════════════════════════════════════════════════════ */
async function fetchScoreAvecFallback(externalId, sport) {
  const sr = await fetchScoreSportradar(externalId, sport);
  if (sr) {
    logger.info(`[Auto-Settlement] ✅ Sportradar : ${externalId} ${sr.score1}-${sr.score2} (${sport})`);
    return sr;
  }

  const op = await fetchScoreOddsPapi(externalId);
  if (op) {
    logger.info(`[Auto-Settlement] ✅ OddsPapi : ${externalId} ${op.score1}-${op.score2}`);
    return op;
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════════ */
/* APPLICATION DU RÉSULTAT                                           */
/* ═══════════════════════════════════════════════════════════════════ */
async function appliquerResultat(externalId, resultat, source, scoreData) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const matchCheck = await client.query(
      `SELECT termine, resultat FROM matches_cache WHERE external_id = $1 FOR UPDATE`,
      [externalId]);

    if (!matchCheck.rows.length) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'match_not_found' };
    }

    if (matchCheck.rows[0].termine && matchCheck.rows[0].resultat) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'already_settled', resultat: matchCheck.rows[0].resultat };
    }

    await client.query(
      `UPDATE matches_cache
          SET termine = TRUE, resultat = $1, score1 = $2, score2 = $3, updated_at = NOW()
        WHERE external_id = $4`,
      [resultat, scoreData.score1, scoreData.score2, externalId]);

    const { rows: saisies } = await client.query(
      `SELECT id, user_email, data FROM saisies
        WHERE valide = TRUE AND data->'VALIDATION' @> $1::jsonb
        FOR UPDATE`,
      [JSON.stringify([{ _external_id: externalId }])]);

    let nbSaisiesModifiees = 0;
    let totalGainCredite = 0;
    let totalMargeGain = 0;
    const usersToCheck = new Set();

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
          const margeGain = Number((gainBrut * 0.06).toFixed(2));
          const gainNet = Number((gainBrut - margeGain).toFixed(2));

          match.gainCredite = gainNet;
          match.margeGain = margeGain;
          match.Ri = gainNet - Number(match.miseDebitee || 0);
          match.validePar = `IA (${source})`;
          match.valideLe = new Date().toISOString();
          match.settlement_score = { home: scoreData.score1, away: scoreData.score2 };
          match.settlement_hash = crypto.createHash('sha256')
            .update(`${externalId}:${resultat}:${scoreData.score1}:${scoreData.score2}`)
            .digest('hex').slice(0, 16);

          gainTotal += gainNet;
          margeTotal += margeGain;
        }
        modified = true;
      }

      if (modified) {
        if (gainTotal > 0) {
          await client.query(
            `UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE email = $2`,
            [gainTotal, s.user_email]);
          await client.query(
            `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note)
             VALUES ($1, 'win', $2, $3, $4)`,
            [s.user_email, gainTotal, String(s.id),
             `Gain Auto (${source}, résultat ${resultat}, score ${scoreData.score1}-${scoreData.score2})`]);
          totalGainCredite += gainTotal;
          usersToCheck.add(s.user_email);
        }

        if (margeTotal > 0) {
          await client.query(
            `INSERT INTO margin_collections(user_email, type, montant, ref_id, note)
             VALUES ($1, 'win', $2, $3, $4)`,
            [s.user_email, margeTotal, String(s.id), `Marge 6% sur gain (settlement ${source})`]);
          totalMargeGain += margeTotal;
        }

        await client.query(`UPDATE saisies SET data = $1 WHERE id = $2`, [data, s.id]);
        nbSaisiesModifiees++;
      }
    }

    await client.query('COMMIT');

    for (const email of usersToCheck) {
      try {
        const { checkAndCreateSuspension } = require('./routes-ia');
        if (typeof checkAndCreateSuspension === 'function') {
          const u = await pool.query(`SELECT category FROM users WHERE email = $1`, [email]);
          await checkAndCreateSuspension(email, u.rows[0]?.category || 'free');
        }
      } catch (err) {
        logger.warn(`[Auto-Settlement suspension] ${email}: ${err.message}`);
      }
    }

    logger.info(
      `[Auto-Settlement] ✅ ${externalId} → ${resultat} ` +
      `(source: ${source}, score: ${scoreData.score1}-${scoreData.score2}) ` +
      `| ${nbSaisiesModifiees} saisie(s), ${totalGainCredite.toFixed(2)} XAF crédités, ` +
      `${totalMargeGain.toFixed(2)} XAF de marge`);

    return {
      applied: true,
      resultat,
      source,
      score: { home: scoreData.score1, away: scoreData.score2 },
      saisies_modifiees: nbSaisiesModifiees,
      total_gain: totalGainCredite,
      total_marge: totalMargeGain
    };

  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logger.error(`[Auto-Settlement] ❌ Erreur ${externalId}: ${e.message}`);
    throw e;
  } finally {
    client.release();
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* CYCLE PRINCIPAL                                                   */
/* ═══════════════════════════════════════════════════════════════════ */
async function runAutoSettlement() {
  if (isRunning) {
    logger.info('[Auto-Settlement] Cycle précédent en cours, skip.');
    return;
  }

  isRunning = true;
  const start = Date.now();
  logger.info('[Auto-Settlement] ▶️ Démarrage du cycle...');

  try {
    const { rows: matchs } = await pool.query(
      `SELECT DISTINCT mc.id, mc.external_id, mc.sport, mc.equipe1, mc.equipe2, mc.commence_at
         FROM matches_cache mc
         INNER JOIN saisies s ON s.valide = TRUE
           AND s.data->'VALIDATION' @> jsonb_build_array(
             jsonb_build_object('_external_id', mc.external_id))
        WHERE mc.termine = FALSE
          AND mc.commence_at < NOW() - INTERVAL '2 hours'
          AND mc.commence_at > NOW() - INTERVAL '7 days'
          AND mc.external_id IS NOT NULL
        ORDER BY mc.commence_at ASC
        LIMIT 50`);

    if (!matchs.length) {
      logger.info('[Auto-Settlement] Aucun match à régler.');
      return;
    }

    logger.info(`[Auto-Settlement] ${matchs.length} match(s) à vérifier.`);

    let nbRegles = 0;
    let nbEchecs = 0;
    let nbIgnores = 0;

    for (const match of matchs) {
      try {
        /* ⭐ v6.2.9 : mapping sport_key → Sportradar */
        const sportradarSport = mapSportToSportradar(match.sport);
        logger.info(`[Auto-Settlement] Match ${match.external_id} : sport='${match.sport}' → Sportradar='${sportradarSport}'`);

        const scoreData = await fetchScoreAvecFallback(match.external_id, sportradarSport);

        if (!scoreData) {
          /* Si le sport n'est pas couvert par Sportradar trial, on log un avertissement et on skip */
          if (!SPORTRADAR_TRIAL_SPORTS.has(sportradarSport)) {
            logger.info(`[Auto-Settlement] ℹ️ Match ${match.external_id} (sport='${match.sport}') non couvert par Sportradar trial — réglage manuel requis.`);
            nbIgnores++;
          } else {
            logger.warn(`[Auto-Settlement] ⚠️ Aucun score pour ${match.external_id} (${match.equipe1} vs ${match.equipe2})`);
            nbEchecs++;
          }
          continue;
        }

        const resultat = determinerIssue(scoreData.score1, scoreData.score2);
        if (!resultat) {
          logger.warn(`[Auto-Settlement] ⚠️ Score invalide pour ${match.external_id}`);
          nbEchecs++;
          continue;
        }

        const result = await appliquerResultat(match.external_id, resultat, scoreData.source, scoreData);
        if (result.applied) nbRegles++;

      } catch (e) {
        logger.error(`[Auto-Settlement] Erreur match ${match.external_id}: ${e.message}`);
        nbEchecs++;
      }
    }

    const duration = Date.now() - start;
    logger.info(
      `[Auto-Settlement] ✅ Cycle terminé : ${nbRegles} réglé(s), ` +
      `${nbEchecs} échec(s), ${nbIgnores} ignoré(s) en ${duration}ms`);

  } catch (e) {
    logger.error('[Auto-Settlement] ❌ Erreur globale :', e.message);
  } finally {
    isRunning = false;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* CRON                                                              */
/* ═══════════════════════════════════════════════════════════════════ */
function startAutoSettlementCron() {
  if (process.env.SETTLEMENT_CRON_ENABLED === 'false') {
    logger.info('[Auto-Settlement] Cron désactivé (SETTLEMENT_CRON_ENABLED=false)');
    return;
  }

  logger.info(`[Auto-Settlement] Cron démarré (toutes les ${SETTLEMENT_INTERVAL_MS / 60000} min)`);
  setTimeout(runAutoSettlement, 30000);
  setInterval(runAutoSettlement, SETTLEMENT_INTERVAL_MS);
}

/* ═══════════════════════════════════════════════════════════════════ */
/* INJECTION MANUELLE (TESTS)                                        */
/* ═══════════════════════════════════════════════════════════════════ */
async function injectTestResult(externalId, scoreHome, scoreAway) {
  const resultat = determinerIssue(scoreHome, scoreAway);
  if (!resultat) throw new Error(`Score invalide : ${scoreHome}-${scoreAway}`);

  const scoreData = {
    score1: scoreHome,
    score2: scoreAway,
    source: 'test_manual',
    timestamp: new Date().toISOString()
  };

  return await appliquerResultat(externalId, resultat, 'test_manual', scoreData);
}

module.exports = {
  runAutoSettlement,
  startAutoSettlementCron,
  determinerIssue,
  fetchScoreAvecFallback,
  fetchScoreSportradar,
  fetchScoreOddsPapi,
  injectTestResult,
  appliquerResultat,
  mapSportToSportradar
};