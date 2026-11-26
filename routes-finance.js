// C:\Me\AppMoney\MeParisPortifs\routes-finance.js
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, requireAdmin } = require('./utils');

const router = express.Router();
router.use(authenticateToken, requireAdmin);

/* ═══════════════════════════════════════════════════════════════════ */
/* Utilitaires                                                          */
/* ═══════════════════════════════════════════════════════════════════ */
async function getConstantes() {
  const { rows } = await pool.query(
    `SELECT key, value FROM constantes
      WHERE key IN ('MARGE_MIN_IA','MARGE_ALERTE')`);
  const out = {};
  rows.forEach(r => { out[r.key] = Number(r.value); });
  return {
    margeMin: out.MARGE_MIN_IA ?? 0.02,
    margeAlerte: out.MARGE_ALERTE ?? 0.015
  };
}

function computeMarge(c1, cN, c2) {
  const a = Number(c1), b = Number(cN), c = Number(c2);
  if (!a || !b || !c) return null;
  return (1/a + 1/b + 1/c) - 1;
}

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /api/admin/finance/overview                                      */
/* KPIs globaux + marge moyenne                                         */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/finance/overview', async (_req, res) => {
  try {
    const K = await getConstantes();

    /* Volume misé et gains payés */
    const totals = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type='bet' THEN -montant_eur END), 0) AS volume,
        COALESCE(SUM(CASE WHEN type='win' THEN  montant_eur END), 0) AS gains,
        COALESCE(SUM(CASE WHEN type='deposit' THEN montant_eur END), 0) AS depots,
        COALESCE(SUM(CASE WHEN type='withdraw' THEN -montant_eur END), 0) AS retraits
      FROM transactions`);

    const volume = Number(totals.rows[0].volume);
    const gains = Number(totals.rows[0].gains);
    const depots = Number(totals.rows[0].depots);
    const retraits = Number(totals.rows[0].retraits);
    const profit = volume - gains;
    const margeEffective = volume > 0 ? profit / volume : 0;

    /* Marge théorique moyenne des matchs */
    const marges = await pool.query(`
      SELECT
        cote_w1, cote_x, cote_w2, ia_cote_w1, ia_cote_x, ia_cote_w2, ia_generated
      FROM matches_cache
      WHERE cote_w1 IS NOT NULL
      ORDER BY id DESC LIMIT 500`);

    let sumMargeMarche = 0, cntMarche = 0;
    let sumMargeIA = 0, cntIA = 0;

    for (const m of marges.rows) {
      const mM = computeMarge(m.cote_w1, m.cote_x, m.cote_w2);
      if (mM !== null) { sumMargeMarche += mM; cntMarche++; }
      if (m.ia_generated) {
        const mI = computeMarge(m.ia_cote_w1, m.ia_cote_x, m.ia_cote_w2);
        if (mI !== null) { sumMargeIA += mI; cntIA++; }
      }
    }

    const margeMarche = cntMarche ? sumMargeMarche / cntMarche : 0;
    const margeIA = cntIA ? sumMargeIA / cntIA : 0;

    /* Utilisateurs actifs */
    const users = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role='user'`);
    const usersActifs = await pool.query(
      `SELECT COUNT(DISTINCT user_email)::int AS n
       FROM saisies WHERE valide = TRUE AND moment > NOW() - INTERVAL '30 days'`);

    res.json({
      volume, gains, profit, depots, retraits,
      margeEffective,
      margeMarche,
      margeIA,
      nbIAgeneres: cntIA,
      nbTotalMatchs: cntMarche,
      users: users.rows[0].n,
      usersActifs: usersActifs.rows[0].n,
      seuils: K
    });
  } catch (e) {
    console.error('[finance/overview]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /api/admin/finance/daily?days=30                                 */
/* Profit par jour (30 derniers par défaut)                             */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/finance/daily', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 365);

    const { rows } = await pool.query(`
      SELECT
        t.date::date AS jour,
        COALESCE(SUM(CASE WHEN type='bet' THEN -montant_eur END), 0) AS volume,
        COALESCE(SUM(CASE WHEN type='win' THEN  montant_eur END), 0) AS gains
      FROM transactions t
      WHERE t.date > NOW() - INTERVAL '1 day' * $1
      GROUP BY t.date::date
      ORDER BY t.date::date ASC`,
      [days]);

    const data = rows.map(r => {
      const v = Number(r.volume);
      const g = Number(r.gains);
      return {
        date: r.jour,
        volume: v,
        gains: g,
        profit: v - g,
        marge: v > 0 ? (v - g) / v : 0
      };
    });

    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /api/admin/finance/marges-matchs                                 */
/* Liste des matchs avec leur marge (pour repérer les dangereux)        */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/finance/marges-matchs', async (req, res) => {
  try {
    const { limit = 100, source = 'all' } = req.query;

    let q = `SELECT id, equipe1, equipe2, league, pays,
                    cote_w1, cote_x, cote_w2,
                    ia_cote_w1, ia_cote_x, ia_cote_w2,
                    ia_generated, commence_at
               FROM matches_cache
              WHERE cote_w1 IS NOT NULL`;
    if (source === 'ia') q += ` AND ia_generated = TRUE`;

    q += ` ORDER BY id DESC LIMIT $1`;
    const { rows } = await pool.query(q, [Number(limit)]);

    const K = await getConstantes();

    const out = rows.map(m => {
      const mMarche = computeMarge(m.cote_w1, m.cote_x, m.cote_w2);
      const mIA = m.ia_generated ? computeMarge(m.ia_cote_w1, m.ia_cote_x, m.ia_cote_w2) : null;

      return {
        id: m.id,
        equipe1: m.equipe1,
        equipe2: m.equipe2,
        league: m.league,
        pays: m.pays,
        marge_marche: mMarche,
        marge_ia: mIA,
        ia_generated: m.ia_generated,
        commence_at: m.commence_at,
        alerte_marche: mMarche !== null && mMarche < K.margeAlerte,
        alerte_ia: mIA !== null && mIA < K.margeMin
      };
    });

    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /api/admin/finance/projection                                    */
/* Simulateur : N users × P paris/jour × M mise → profit estimé         */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/finance/projection', async (req, res) => {
  try {
    const users = Math.max(1, Number(req.query.users) || 100);
    const parisJourUser = Math.max(1, Number(req.query.paris) || 5);
    const miseMoyenne = Math.max(100, Number(req.query.mise) || 1500);
    const marge = Math.max(0, Number(req.query.marge) || 0.02);

    const volumeJour = users * parisJourUser * miseMoyenne;
    const profitJour = volumeJour * marge;

    res.json({
      input: { users, parisJourUser, miseMoyenne, marge },
      volumeJour,
      volumeSemaine: volumeJour * 7,
      volumeMois: volumeJour * 30,
      volumeAn: volumeJour * 365,
      profitJour,
      profitSemaine: profitJour * 7,
      profitMois: profitJour * 30,
      profitAn: profitJour * 365
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /api/admin/finance/alerts                                        */
/* Liste des alertes marge insuffisante                                 */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/finance/alerts', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const { rows } = await pool.query(
      `SELECT * FROM finance_alerts
        WHERE resolu = FALSE
        ORDER BY created_at DESC LIMIT $1`,
      [Number(limit)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/admin/finance/alerts/:id/resolve                            */
router.post('/finance/alerts/:id/resolve', async (req, res) => {
  try {
    await pool.query(
      `UPDATE finance_alerts SET resolu = TRUE WHERE id = $1`,
      [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /api/admin/finance/scan                                          */
/* Scanne les matchs et crée les alertes si marge insuffisante          */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/finance/scan', async (_req, res) => {
  try {
    const K = await getConstantes();

    /* Matchs IA avec marge insuffisante */
    const { rows } = await pool.query(`
      SELECT id, equipe1, equipe2, ia_cote_w1, ia_cote_x, ia_cote_w2
        FROM matches_cache
       WHERE ia_generated = TRUE`);

    let created = 0;
    for (const m of rows) {
      const marge = computeMarge(m.ia_cote_w1, m.ia_cote_x, m.ia_cote_w2);
      if (marge === null) continue;
      if (marge < K.margeMin) {
        const exists = await pool.query(
          `SELECT 1 FROM finance_alerts
            WHERE match_id = $1 AND resolu = FALSE AND type = 'ia_marge_faible'`,
          [m.id]);
        if (!exists.rows.length) {
          await pool.query(
            `INSERT INTO finance_alerts(type, severity, match_id, marge, message)
             VALUES ('ia_marge_faible', $1, $2, $3, $4)`,
            [marge < 0 ? 'critical' : 'warn', m.id, marge,
             `Marge IA insuffisante (${(marge*100).toFixed(2)}%) sur ${m.equipe1} vs ${m.equipe2}`]);
          created++;
        }
      }
    }

    res.json({ ok: true, alertes_crees: created });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET / PUT /api/admin/finance/seuils                                   */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/finance/seuils', async (_req, res) => {
  try { res.json(await getConstantes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/finance/seuils', async (req, res) => {
  try {
    const { margeMin, margeAlerte } = req.body || {};
    if (margeMin !== undefined) {
      await pool.query(
        `UPDATE constantes SET value = $1, updated_at = NOW() WHERE key = 'MARGE_MIN_IA'`,
        [Number(margeMin)]);
    }
    if (margeAlerte !== undefined) {
      await pool.query(
        `UPDATE constantes SET value = $1, updated_at = NOW() WHERE key = 'MARGE_ALERTE'`,
        [Number(margeAlerte)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;