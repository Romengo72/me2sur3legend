// C:\Me\AppMoney\MeParisPortifs\routes-matches.js
// v6.2.6 — Exclusion des matchs passés + tri chronologique + total correct
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, requireAdmin } = require('./utils');
const { syncUpcomingMatches } = require('./matches-sync');
const logger = require('./logger');

const router = express.Router();

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /matches/sync — Synchronisation manuelle (admin)             */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/matches/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await syncUpcomingMatches();
    const log = await pool.query(`SELECT * FROM matches_sync_log ORDER BY id DESC LIMIT 1`);
    const data = log.rows[0] || { nb_fetched: 0, nb_inserted: 0, nb_updated: 0 };

    res.json({
      ok: true,
      fetched: data.nb_fetched,
      inserted: data.nb_inserted,
      updated: data.nb_updated
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /matches — Liste des matchs à venir                           */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/matches', authenticateToken, async (req, res) => {
  try {
    const {
      search = '',
      pays = '',
      sport = '',
      date = '',
      sort = 'commence_asc',
      limit = 100,
      offset = 0
    } = req.query;

    /* Validation limit / offset */
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    /* ⭐ v6.2.6 : filtre par défaut = matchs à venir */
    let where = `WHERE termine = FALSE`;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (equipe1 ILIKE $${params.length} OR equipe2 ILIKE $${params.length})`;
    }
    if (pays) {
      params.push(pays);
      where += ` AND pays = $${params.length}`;
    }
    if (sport) {
      params.push(`%${sport}%`);
      where += ` AND (sport ILIKE $${params.length} OR league ILIKE $${params.length})`;
    }

    /* ⭐ v6.2.6 : si date explicite → matchs de cette date (même passés) */
    /*             sinon → uniquement matchs à venir                    */
    if (date) {
      params.push(date);
      where += ` AND commence_at::date = $${params.length}::date`;
    } else {
      where += ` AND commence_at > NOW()`;
    }

    /* ⭐ Tri sécurisé via whitelist (jamais d'interpolation directe) */
    const SORT_MAP = {
      commence_asc:  'commence_at ASC NULLS LAST',
      commence_desc: 'commence_at DESC NULLS LAST',
      cote_w1_asc:   'cote_w1 ASC NULLS LAST',
      cote_w1_desc:  'cote_w1 DESC NULLS LAST',
      id_asc:        'id ASC',
      id_desc:       'id DESC'
    };
    const orderBy = SORT_MAP[sort] || SORT_MAP.commence_asc;

    /* ⭐ Total réel (pas la taille de la page) */
    const countQ = `SELECT COUNT(*)::int AS total FROM matches_cache ${where}`;
    const countResult = await pool.query(countQ, params);
    const total = countResult.rows[0].total;

    /* ⭐ Page courante */
    const q = `SELECT * FROM matches_cache ${where}
               ORDER BY ${orderBy}
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const pageParams = [...params, safeLimit, safeOffset];

    const { rows } = await pool.query(q, pageParams);

    /* Facettes (sports / pays) */
    const [sportsList, paysList] = await Promise.all([
      pool.query(`SELECT DISTINCT sport FROM matches_cache
                   WHERE sport IS NOT NULL AND sport <> ''
                   ORDER BY sport`),
      pool.query(`SELECT DISTINCT pays FROM matches_cache
                   WHERE pays IS NOT NULL AND pays <> ''
                   ORDER BY pays`)
    ]);

    res.json({
      matches: rows,
      total,
      limit: safeLimit,
      offset: safeOffset,
      hasMore: safeOffset + rows.length < total,
      facettes: {
        sports: sportsList.rows.map(r => r.sport),
        pays: paysList.rows.map(r => r.pays)
      }
    });
  } catch (e) {
    logger.error('[matches/get]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /matches/vip-ia — Matchs avec cotes IA (VIP/Légendaire)       */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/matches/vip-ia', authenticateToken, async (req, res) => {
  try {
    /* ⭐ Vérification catégorie : VIP, Légendaire ou Admin uniquement */
    const { rows: userRows } = await pool.query(
      `SELECT category, role FROM users WHERE email = $1`, [req.user.email]
    );
    const category = userRows[0]?.category || 'free';
    const role = userRows[0]?.role || 'user';
    if (role !== 'admin' && !['vip', 'legendaire'].includes(category)) {
      return res.status(403).json({ error: '🔒 Accès réservé aux membres VIP/Légendaire.' });
    }

    const { search = '', pays = '', league = '', limit = 200 } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);

    /* ⭐ v6.2.9 : uniquement les matchs à venir avec cotes IA générées */
    let where = `WHERE termine = FALSE
                   AND commence_at > NOW()
                   AND ia_generated = TRUE
                   AND cote_w1 IS NOT NULL
                   AND cote_x IS NOT NULL
                   AND cote_w2 IS NOT NULL`;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (equipe1 ILIKE $${params.length} OR equipe2 ILIKE $${params.length})`;
    }
    if (pays) {
      params.push(pays);
      where += ` AND pays = $${params.length}`;
    }
    if (league) {
      params.push(`%${league}%`);
      where += ` AND league ILIKE $${params.length}`;
    }

    const q = `SELECT id, external_id, sport, league, pays, equipe1, equipe2,
                      cote_w1, cote_x, cote_w2,
                      ia_cote_w1, ia_cote_x, ia_cote_w2,
                      ia_generated, ia_confidence, ia_raison,
                      commence_at, source
                 FROM matches_cache
                 ${where}
                 ORDER BY commence_at ASC
                 LIMIT $${params.length + 1}`;
    params.push(safeLimit);

    const { rows } = await pool.query(q, params);

    /* Facettes (pays + leagues) */
    const [paysList, leaguesList] = await Promise.all([
      pool.query(`SELECT DISTINCT pays FROM matches_cache
                   WHERE pays IS NOT NULL AND pays <> '' AND ia_generated = TRUE
                   ORDER BY pays`),
      pool.query(`SELECT DISTINCT league FROM matches_cache
                   WHERE league IS NOT NULL AND league <> '' AND ia_generated = TRUE
                   ORDER BY league`)
    ]);

    /* Mapping pour le frontend : cote_w1 = IA si dispo, sinon marché */
    const matches = rows.map(m => ({
      id: m.id,
      external_id: m.external_id,
      sport: m.sport,
      league: m.league,
      pays: m.pays,
      equipe1: m.equipe1,
      equipe2: m.equipe2,
      cote_w1: m.ia_cote_w1 || m.cote_w1,
      cote_x: m.ia_cote_x || m.cote_x,
      cote_w2: m.ia_cote_w2 || m.cote_w2,
      marche_w1: m.cote_w1,
      marche_x: m.cote_x,
      marche_w2: m.cote_w2,
      ia_generated: m.ia_generated,
      ia_confidence: m.ia_confidence,
      ia_raison: m.ia_raison,
      commence_at: m.commence_at,
      source: m.source
    }));

    res.json({
      matches,
      total: matches.length,
      facettes: {
        pays: paysList.rows.map(r => r.pays),
        leagues: leaguesList.rows.map(r => r.league)
      }
    });
  } catch (e) {
    logger.error('[matches/vip-ia]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;