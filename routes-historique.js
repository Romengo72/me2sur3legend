// C:\Me\AppMoney\MeParisPortifs\routes-historique.js
// v6.2.2 — Gain net (marge 6%), suppression avec remboursement, garde jsonb_array_length
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, logSecurity } = require('./utils');

const router = express.Router();

/* Applique la marge 6% sur le gain brut (miroir de calculs.js) */
function calcGainNet(miseGagnante, coteGagnante) {
  const brut = Number(miseGagnante) * Number(coteGagnante);
  return Number((brut * 0.94).toFixed(2));
}

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /historique                                                   */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/historique', authenticateToken, async (req, res) => {
  try {
    const { from, to, limit = 100, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    let q = `SELECT id, date, moment, data, mise_totale, valide FROM saisies WHERE user_email = $1`;
    const params = [req.user.email];
    if (from) { params.push(from); q += ` AND date >= $${params.length}`; }
    if (to)   { params.push(to);   q += ` AND date <= $${params.length}`; }

    /* Total : nombre de matchs (garde jsonb_array_length) */
    let countQ = `SELECT COALESCE(SUM(jsonb_array_length(COALESCE(data->'VALIDATION', '[]'::jsonb))), 0)::int AS total FROM saisies WHERE user_email = $1`;
    const countParams = [req.user.email];
    if (from) { countParams.push(from); countQ += ` AND date >= $${countParams.length}`; }
    if (to)   { countParams.push(to);   countQ += ` AND date <= $${countParams.length}`; }

    const countResult = await pool.query(countQ, countParams);
    const total = countResult.rows[0].total;

    q += ` ORDER BY date DESC, moment DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(safeLimit, safeOffset);

    const { rows } = await pool.query(q, params);

    const entries = [];
    for (const s of rows) {
      const validation = (s.data && s.data.VALIDATION) || [];
      validation.forEach((m, idx) => {
        const statutKey = ['1', 'N', '2'].find(k => m.statuts && m.statuts[k]);
        const statutValeur = statutKey ? m.statuts[statutKey] : null;
        const coteGagnante = statutKey ? Number(m.cotes[statutKey]) : 0;
        const tableauChoisi = m.tableauChoisi || 1;
        const T = (m.tableaux && m.tableaux[`T${tableauChoisi}`]) || [];
        const miseGagnante = statutKey ? (T.find(x => x.col === statutKey)?.mise || 0) : 0;

        /* ⭐ v6.2.2 : gain net (utilise gainCredite stocké si présent, sinon marge 6%) */
        const gainNet = m.gainCredite !== undefined && m.gainCredite !== null
          ? Number(m.gainCredite)
          : (statutKey ? calcGainNet(miseGagnante, coteGagnante) : 0);

        const Ri = m.valide ? (gainNet - Number(m.miseDebitee || 0)) : null;

        entries.push({
          saisieId: s.id, date: s.date, moment: s.moment, idx,
          equipe1: m.equipe1 || '', equipe2: m.equipe2 || '',
          cotes: m.cotes, statut: statutKey || null, statutValeur,
          tableauChoisi, mise: Number(m.miseDebitee || 0),
          gain: gainNet, Ri,
          valide: !!m.valide,
          gainCredite: m.gainCredite || null,
          validePar: m.validePar || null,
          valideLe: m.valideLe || null,
          multiplicateur: (s.data && s.data.multiplicateur) || 1
        });
      });
    }

    res.json({ entries, total, limit: safeLimit, offset: safeOffset, hasMore: safeOffset + entries.length < total });
  } catch (e) {
    console.error('[historique GET]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /transactions                                                 */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { limit = 100, offset = 0, type = '' } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    let q = `SELECT id, type, montant_eur, devise_origine, ref_id, note, date FROM transactions WHERE user_email = $1`;
    const params = [req.user.email];
    if (type) { params.push(type); q += ` AND type = $${params.length}`; }

    const countQ = q.replace(
      'SELECT id, type, montant_eur, devise_origine, ref_id, note, date',
      'SELECT COUNT(*)::int AS total'
    );
    const txCountRes = await pool.query(countQ, params);
    const total = txCountRes.rows[0].total;

    q += ` ORDER BY date DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(safeLimit, safeOffset);

    const { rows } = await pool.query(q, params);
    res.json({
      entries: rows.map(r => ({
        id: r.id, type: r.type, montant: Number(r.montant_eur),
        devise: r.devise_origine || 'XAF', ref_id: r.ref_id || null,
        note: r.note || '', date: r.date
      })),
      total, limit: safeLimit, offset: safeOffset,
      hasMore: safeOffset + rows.length < total
    });
  } catch (e) {
    console.error('[transactions GET]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* DELETE /historique/:id — Rembourse la mise + retire le gain      */
/* ═══════════════════════════════════════════════════════════════════ */
router.delete('/historique/:id', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const s = await client.query(
      `SELECT * FROM saisies WHERE id = $1 AND user_email = $2 FOR UPDATE`,
      [req.params.id, req.user.email]);
    if (!s.rows.length) throw new Error('Saisie introuvable');

    const row = s.rows[0];
    const data = row.data;

    if (!row.valide) {
      /* Saisie non validée : simple suppression, aucun flux financier */
      await client.query(`DELETE FROM saisies WHERE id = $1`, [req.params.id]);
      await client.query('COMMIT');
      return res.json({ ok: true, deleted: req.params.id, refunded: 0, gains_removed: 0 });
    }

    /* Saisie validée : rembourse mise + retire gains */
    let totalRembourse = 0;
    let totalGainsRetires = 0;

    for (const m of (data.VALIDATION || [])) {
      if (!m.valide) continue;
      const hasStatut = m.statuts && (m.statuts['1'] || m.statuts['N'] || m.statuts['2']);
      if (!hasStatut) {
        throw new Error('Impossible de supprimer : des paris sont en attente de résultat.');
      }
      totalRembourse += Number(m.miseDebitee || 0);
      totalGainsRetires += Number(m.gainCredite || 0);
    }

    const delta = totalRembourse - totalGainsRetires;

    /* Vérifie que le solde résultant ne devient pas négatif */
    const u = await client.query(`SELECT balance FROM users WHERE email = $1 FOR UPDATE`, [row.user_email]);
    const balance = Number(u.rows[0].balance);
    if (balance + delta < 0) {
      throw new Error(`Suppression impossible : solde résultant négatif (${(balance + delta).toFixed(2)} XAF).`);
    }

    await client.query(`UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE email = $2`, [delta, row.user_email]);
    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, ref_id, note) VALUES ($1, 'adjust', $2, $3, $4)`,
      [row.user_email, delta, String(row.id),
       `Suppression saisie (remboursement ${totalRembourse.toFixed(2)} - gains ${totalGainsRetires.toFixed(2)})`]);

    /* Retire les marges de gain associées */
    await client.query(
      `DELETE FROM margin_collections WHERE ref_id = $1 AND user_email = $2 AND type = 'win'`,
      [String(row.id), row.user_email]);

    await client.query(`DELETE FROM saisies WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');

    await logSecurity({
      email: req.user.email, event: 'user_delete_saisie', severity: 'info', ip: req.ip,
      details: { saisie_id: row.id, rembourse: totalRembourse, gains_retires: totalGainsRetires, delta }
    });

    res.json({
      ok: true, deleted: req.params.id,
      refunded: totalRembourse, gains_removed: totalGainsRetires, delta
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;