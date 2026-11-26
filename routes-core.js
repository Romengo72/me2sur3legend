// C:\Me\AppMoney\MeParisPortifs\routes-core.js
// v6.2.2 — Vérification BF avant crédit de gain (le reste inchangé)
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, requireAdmin, requirePermission, logSecurity } = require('./utils');
const { calcMises, buildTableaux, ajusterCotesAvecMarge, calculerGainAvecMarge } = require('./calculs-server');
const logger = require('./logger');

const router = express.Router();
const MAX_MATCHS_PAR_SAISIE = 20;

async function loadConstantes() {
  const { rows } = await pool.query(`SELECT key, value FROM constantes`);
  return Object.fromEntries(rows.map(r => [r.key, Number(r.value)]));
}

async function getBF(client = pool) {
  const r = await client.query(`SELECT value FROM constantes WHERE key = 'BUDGET_FONCTIONNEMENT'`);
  return Number(r.rows[0]?.value || 0);
}

async function checkUserSuspension(email) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ia_suspensions WHERE user_email = $1 AND lifted_at IS NULL
        AND (suspended_until IS NULL OR suspended_until > NOW())
        ORDER BY suspended_at DESC LIMIT 1`, [email]);
    return rows[0] || null;
  } catch (e) { return null; }
}

router.get('/constantes', async (_req, res) => {
  try { res.json(await loadConstantes()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/constantes/:key', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { value } = req.body || {};
    if (value === undefined || isNaN(Number(value))) return res.status(400).json({ error: 'Valeur numérique requise' });
    const r = await pool.query(`UPDATE constantes SET value = $1, updated_at = NOW() WHERE key = $2`, [Number(value), req.params.key]);
    if (!r.rowCount) return res.status(404).json({ error: 'Constante inconnue' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/saisies', authenticateToken, requirePermission('can_saisir'), async (req, res) => {
  try {
    const u = await pool.query(`SELECT category FROM users WHERE email = $1`, [req.user.email]);
    const category = u.rows[0]?.category || 'free';
    const { date, matchs, multiplicateur } = req.body || {};

    if (!Array.isArray(matchs) || matchs.length === 0) return res.status(400).json({ error: 'Aucun match fourni' });
    if (matchs.length > MAX_MATCHS_PAR_SAISIE) return res.status(400).json({ error: `Maximum ${MAX_MATCHS_PAR_SAISIE} matchs.` });

/* ⭐ v6.2.3 : les matchs SANS _external_id sont des saisies manuelles (externes) */
    const manuels = matchs.filter(m => !m._external_id);
    if (manuels.length > 0 && !['vip', 'legendaire'].includes(category)) {
      return res.status(403).json({ error: '🔒 Saisie manuelle réservée VIP/Légendaire. Utilisez l\'onglet Suggestions.' });
    }

    const K = await loadConstantes();
    const mult = Number(multiplicateur || 1);

    const enriched = matchs.map((m, idx) => {
      const cotesBrutes = m.cotes || {};
      if (!cotesBrutes['1'] || !cotesBrutes['N'] || !cotesBrutes['2']) {
        throw Object.assign(new Error(`Match #${idx + 1} : 3 cotes requises`), { status: 400 });
      }

      const c1 = Number(cotesBrutes['1']), cN = Number(cotesBrutes['N']), c2 = Number(cotesBrutes['2']);
      if (!Number.isFinite(c1) || !Number.isFinite(cN) || !Number.isFinite(c2) || c1 < 1.01 || cN < 1.01 || c2 < 1.01) {
        throw Object.assign(new Error(`Match #${idx + 1} : cotes invalides`), { status: 400 });
      }

      const cotesSecurisees = ajusterCotesAvecMarge({ '1': c1, 'N': cN, '2': c2 });
      const M = calcMises(cotesSecurisees, { constantes: K, multiplicateur: mult });
      const T = buildTableaux(cotesSecurisees, M);

      return {
        equipe1: String(m.equipe1 || '').slice(0, 100), equipe2: String(m.equipe2 || '').slice(0, 100),
        cotes: { '1': String(cotesSecurisees['1']), 'N': String(cotesSecurisees['N']), '2': String(cotesSecurisees['2']) },
        cotes_brutes: { '1': String(c1), 'N': String(cN), '2': String(c2) },
        _external_id: m._external_id || null,
        statuts: { '1': null, 'N': null, '2': null },
        tableauChoisi: Number(m.tableauChoisi || 1),
        calculs: M, tableaux: T, valide: false
      };
    });

    const data = { VALIDATION: enriched, multiplicateur: mult };
    const { rows } = await pool.query(
      `INSERT INTO saisies(user_email, date, data, valide) VALUES ($1, $2, $3, FALSE) RETURNING id, date, moment`,
      [req.user.email, date || new Date().toISOString().slice(0, 10), data]);

    res.status(201).json({ ok: true, id: rows[0].id, moment: rows[0].moment });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/saisies/valider', authenticateToken, requirePermission('can_valider'), async (req, res) => {
  const client = await pool.connect();
  try {
    const susp = await checkUserSuspension(req.user.email);
    if (susp) {
      return res.status(423).json({
        error: `Compte suspendu. Réessayez le ${new Date(susp.suspended_until).toLocaleDateString()}.`,
        code: 'IA_SUSPENDED'
      });
    }

    await client.query('BEGIN');
    const { date, indices } = req.body || {};
    const s = await client.query(
      `SELECT id, data FROM saisies WHERE user_email = $1 AND date = $2 ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [req.user.email, date || new Date().toISOString().slice(0, 10)]);
    if (!s.rows.length) throw new Error('Saisie introuvable');

    const row = s.rows[0];
    const data = row.data;
    let totalMise = 0;
    const idxList = Array.isArray(indices) ? indices : data.VALIDATION.map((_, i) => i);

    for (const i of idxList) {
      const m = data.VALIDATION[i];
      if (!m || m.valide) continue;
      const T = m.tableaux[`T${m.tableauChoisi}`];
      const miseMatch = T.reduce((a, x) => a + Number(x.mise), 0);
      totalMise += miseMatch;

      m.valide = true;
      m.dateValidation = new Date().toISOString();
      m.miseDebitee = miseMatch;
    }

    if (totalMise <= 0) throw new Error('Aucune mise à débiter');

    const u = await client.query(`SELECT balance FROM users WHERE email = $1 FOR UPDATE`, [req.user.email]);
    const balance = Number(u.rows[0].balance);

    if (balance < totalMise) throw new Error(`Solde insuffisant (requis ${totalMise.toFixed(2)}, dispo ${balance.toFixed(2)})`);

    await client.query(`UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE email = $2`, [totalMise, req.user.email]);
    await client.query(`UPDATE saisies SET data = $1, valide = TRUE, mise_totale = $2 WHERE id = $3`, [data, totalMise, row.id]);
    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note) VALUES ($1, 'bet', $2, $3, 'Validation saisie')`,
      [req.user.email, -totalMise, String(row.id)]);

    await client.query('COMMIT');
    res.json({ ok: true, totalMise, newBalance: balance - totalMise });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

router.delete('/saisies/valider/:id', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(`SELECT * FROM saisies WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!s.rows.length) throw new Error('Saisie introuvable');
    const row = s.rows[0];
    if (!row.valide) throw new Error('Saisie déjà non validée');

    const data = row.data;
    const rembourse = Number(row.mise_totale || 0);
    let totalGainsAnnules = 0;

    data.VALIDATION.forEach(m => {
      if (m.valide) {
        if (m.gainCredite) totalGainsAnnules += Number(m.gainCredite);
        m.valide = false;
        delete m.dateValidation;
        delete m.miseDebitee;
        delete m.gainCredite;
        delete m.Ri;
        delete m.validePar;
        delete m.valideLe;
        delete m.margeMise;
        delete m.margeGain;
        m.statuts = { '1': null, 'N': null, '2': null };
      }
    });

    const delta = rembourse - totalGainsAnnules;

    if (delta < 0) {
      const u = await client.query(`SELECT balance FROM users WHERE email = $1 FOR UPDATE`, [row.user_email]);
      const balance = Number(u.rows[0].balance);
      if (balance + delta < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Dévalidation impossible : solde négatif.` });
      }
    }

    await client.query(`UPDATE users SET balance = balance + $1 WHERE email = $2`, [delta, row.user_email]);
    await client.query(`UPDATE saisies SET data = $1, valide = FALSE, mise_totale = 0 WHERE id = $2`, [data, row.id]);
    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note) VALUES ($1, 'adjust', $2, $3, 'Dévalidation')`,
      [row.user_email, delta, String(row.id)]);
    await client.query(`DELETE FROM margin_collections WHERE ref_id = $1 AND user_email = $2 AND type = 'win'`, [String(row.id), row.user_email]);

    await client.query('COMMIT');
    res.json({ ok: true, rembourse, gains_annules: totalGainsAnnules, delta });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

router.get('/saisies', authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;
    let q, p;
    if (req.user.role === 'admin' && req.query.user) {
      q = `SELECT * FROM saisies WHERE user_email = $1 ORDER BY moment DESC LIMIT 100`;
      p = [req.query.user];
    } else if (date) {
      q = `SELECT * FROM saisies WHERE user_email = $1 AND date = $2 ORDER BY moment DESC`;
      p = [req.user.email, date];
    } else {
      q = `SELECT * FROM saisies WHERE user_email = $1 ORDER BY moment DESC LIMIT 50`;
      p = [req.user.email];
    }
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/balance', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const bf = await getBF();
      return res.json({ balance: bf, isAdmin: true });
    }
    const { rows } = await pool.query(`SELECT balance FROM users WHERE email = $1`, [req.user.email]);
    res.json({ balance: Number(rows[0].balance) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/user/totals', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'bet'  THEN -montant_eur END), 0) AS total_mises,
              COALESCE(SUM(CASE WHEN type = 'win'  THEN  montant_eur END), 0) AS total_gains
         FROM transactions WHERE user_email = $1`, [req.user.email]);
    const balance = await pool.query(`SELECT balance FROM users WHERE email = $1`, [req.user.email]);
    res.json({
      balance: Number(balance.rows[0].balance),
      totalMises: Number(rows[0].total_mises),
      totalGains: Number(rows[0].total_gains),
      benefice: Number(rows[0].total_gains) - Number(rows[0].total_mises)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT devise, theme, language, notif_email FROM preferences WHERE user_email = $1`, [req.user.email]);
    res.json(rows[0] || { devise: 'XAF', theme: 'dark', language: 'fr', notif_email: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/preferences', authenticateToken, async (req, res) => {
  try {
    const { devise, theme, language, notif_email } = req.body || {};
    await pool.query(
      `INSERT INTO preferences(user_email, devise, theme, language, notif_email)
       VALUES ($1, COALESCE($2, 'XAF'), COALESCE($3, 'dark'), COALESCE($4, 'fr'), COALESCE($5, TRUE))
       ON CONFLICT (user_email) DO UPDATE SET
         devise = COALESCE(EXCLUDED.devise, preferences.devise),
         theme = COALESCE(EXCLUDED.theme, preferences.theme),
         language = COALESCE(EXCLUDED.language, preferences.language),
         notif_email = COALESCE(EXCLUDED.notif_email, preferences.notif_email)`,
      [req.user.email, devise, theme, language, notif_email]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ⭐ v6.2.2 : vérification BF avant crédit de gain */
router.post('/admin/valider-gain', authenticateToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const { saisie_id, idx } = req.body || {};
    const statut = req.body.statut;

    if (statut !== null && !['1', 'N', '2'].includes(String(statut))) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    await client.query('BEGIN');
    const s = await client.query(`SELECT * FROM saisies WHERE id = $1 FOR UPDATE`, [saisie_id]);
    if (!s.rows.length) throw new Error('Saisie introuvable');

    const row = s.rows[0];
    const data = row.data;
    const m = data.VALIDATION[idx];
    if (!m) throw new Error('Index invalide');
    if (!m.valide) throw new Error('Mise non débitée');

    const oldGain = Number(m.gainCredite || 0);
    const oldMargeGain = Number(m.margeGain || 0);
    let newGain = 0, newMargeGain = 0;

    if (statut) {
      const T = m.tableaux[`T${m.tableauChoisi || 1}`];
      const col = T.find(x => x.col === statut);
      if (!col) throw new Error('Colonne introuvable');
      const calc = calculerGainAvecMarge(Number(col.mise), Number(col.cote));
      newGain = calc.gainNet;
      newMargeGain = calc.margeGain;
    }

    const deltaGain = newGain - oldGain;

    /* ⭐ Vérification BF avant crédit */
    if (deltaGain > 0) {
      const bf = await getBF(client);
      if (bf < deltaGain) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Budget Fonctionnement insuffisant : ${bf.toFixed(2)} XAF disponibles, ${deltaGain.toFixed(2)} XAF requis.`
        });
      }
    }

    if (deltaGain !== 0) {
      await client.query(`UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE email = $2`, [deltaGain, row.user_email]);
    }

    m.statuts = { '1': null, 'N': null, '2': null };
    delete m.gainCredite; delete m.Ri; delete m.validePar; delete m.valideLe; delete m.margeGain;

    if (statut) {
      m.statuts[statut] = statut === '1' ? 'vert' : statut === 'N' ? 'orange' : 'rouge';
      m.gainCredite = newGain;
      m.margeGain = newMargeGain;
      m.Ri = newGain - Number(m.miseDebitee);
      m.validePar = req.user.email;
      m.valideLe = new Date().toISOString();

      if (deltaGain !== 0) {
        await client.query(
          `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note) VALUES ($1, 'win', $2, $3, $4)`,
          [row.user_email, deltaGain, String(row.id), `Gain statut ${statut} (admin)`]);
      }

      if (oldMargeGain > 0) {
        await client.query(`DELETE FROM margin_collections WHERE ref_id = $1 AND user_email = $2 AND type = 'win'`, [String(row.id), row.user_email]);
      }
      if (newMargeGain > 0) {
        await client.query(
          `INSERT INTO margin_collections(user_email, type, montant, ref_id, note) VALUES ($1, 'win', $2, $3, $4)`,
          [row.user_email, newMargeGain, String(row.id), `Marge 6% sur gain`]);
      }
    }

    await client.query(`UPDATE saisies SET data = $1 WHERE id = $2`, [data, row.id]);
    await client.query('COMMIT');

    await logSecurity({
      email: req.user.email, event: 'admin_validate_gain', severity: 'info', ip: req.ip,
      details: { saisie_id: row.id, idx, statut, delta: deltaGain }
    });

    res.json({ ok: true, gain: newGain, delta: deltaGain });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;
module.exports.loadConstantes = loadConstantes;
module.exports.checkUserSuspension = checkUserSuspension;