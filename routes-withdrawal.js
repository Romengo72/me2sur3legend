// C:\Me\AppMoney\MeParisPortifs\routes-withdrawal.js
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { pool } = require('./db');
const { authenticateToken, sha256, requirePermission } = require('./utils');
const logger = require('./logger');

let sendWithdrawalOTP = null;
try { ({ sendWithdrawalOTP } = require('./mailer')); } catch (e) {}

const router = express.Router();

const RETRAIT_MIN = 2000;
const PAYMENT_THRESHOLD_DEFAULT = 25_000_000;

const CATEGORY_FEES = {
  free:       0.050,
  premium:    0.030,
  vip:        0.025,
  legendaire: 0.025
};

const MARGIN_RATE_DEFAULT = 0.02;

async function getPaymentThreshold() {
  try {
    const { rows } = await pool.query(`SELECT value FROM constantes WHERE key = 'PAYMENT_THRESHOLD'`);
    return rows[0] ? Number(rows[0].value) : PAYMENT_THRESHOLD_DEFAULT;
  } catch (_) { return PAYMENT_THRESHOLD_DEFAULT; }
}

async function getMarginRate() {
  try {
    const { rows } = await pool.query(`SELECT value FROM constantes WHERE key = 'MARGIN_RATE_DEFAULT'`);
    return rows[0] ? Number(rows[0].value) : MARGIN_RATE_DEFAULT;
  } catch (_) { return MARGIN_RATE_DEFAULT; }
}

const requestOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  keyGenerator: r => r.user?.email || r.ip,
  message: { error: 'Trop de demandes de code.' }
});

const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  keyGenerator: r => r.user?.email || r.ip,
  message: { error: 'Trop de tentatives.' }
});

async function auditLog(email, amount, devise, ip, ua, statut, raison) {
  try {
    await pool.query(
      `INSERT INTO withdrawal_audit(user_email, amount, devise, ip, user_agent, statut, raison)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email, amount, devise, ip, ua, statut, raison]);
  } catch (e) { logger.error('[audit withdrawal]', e.message); }
}

function denyAdmin(req, res) {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: "L'administrateur ne peut pas effectuer de retrait." });
  }
  return null;
}

// ⭐ AJOUT : Vérification de la permission "can_retirer"
router.post('/withdrawal/request-otp', authenticateToken, requirePermission('can_retirer'), requestOtpLimiter, async (req, res) => {
  const guard = denyAdmin(req, res);
  if (guard) return guard;

  const client = await pool.connect();
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  try {
    const { amount, devise = 'XAF', password } = req.body || {};
    const m = Number(amount);

    if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
    if (m < RETRAIT_MIN) return res.status(400).json({ error: `Retrait minimum : ${RETRAIT_MIN} XAF` });
    if (!Number.isInteger(m)) return res.status(400).json({ error: 'Montant entier requis' });

    const threshold = await getPaymentThreshold();
    const needsAdminApproval = m > threshold;

    await client.query('BEGIN');

    const u = await client.query(`SELECT email, password, balance, category FROM users WHERE email = $1 FOR UPDATE`, [req.user.email]);
    if (!u.rows.length) throw new Error('Utilisateur introuvable');

    const user = u.rows[0];
    const balance = Number(user.balance);
    const fee = CATEGORY_FEES[user.category] || 0.05;
    const marginRate = await getMarginRate();
    
    // ⭐ LOGIQUE : Le montant demandé est intact. Les frais sont prélevés EN PLUS sur le solde.
    const fraisTotal = (m * fee) + (m * marginRate);
    const totalRequisSurSolde = m + fraisTotal; 

    const pwdOk = await bcrypt.compare(password, user.password);
    if (!pwdOk) {
      await auditLog(user.email, m, devise, ip, ua, 'failed', 'password_incorrect');
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    if (balance < totalRequisSurSolde) {
      await auditLog(user.email, m, devise, ip, ua, 'failed', 'solde_insuffisant');
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: `Solde insuffisant. Vous demandez ${m} XAF, des frais de ${fraisTotal.toFixed(2)} XAF s'appliquent. Total requis sur votre solde : ${totalRequisSurSolde.toFixed(2)} XAF.` 
      });
    }

    const c24 = await client.query(`SELECT count_withdrawals_24h($1) AS n`, [user.email]);
    if (c24.rows[0].n >= 1) {
      await auditLog(user.email, m, devise, ip, ua, 'failed', 'limite_24h');
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'Un seul retrait autorisé par 24 heures.' });
    }

    await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE user_email = $1 AND used = FALSE`, [user.email]);

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await client.query(
      `INSERT INTO withdrawal_otps(user_email, code_hash, amount, devise, expires_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [user.email, codeHash, m, devise, expiresAt]);

    await auditLog(user.email, m, devise, ip, ua, 'otp_sent', needsAdminApproval ? 'requires_admin_approval' : null);
    await client.query('COMMIT');

    if (sendWithdrawalOTP) {
      try { await sendWithdrawalOTP({ to: user.email, code, amount: m, devise }); }
      catch (err) { logger.error('[OTP mail]', err.message); }
    }

    const devHint = process.env.NODE_ENV !== 'production' ? { devCode: code } : {};
    res.json({ ok: true, message: 'Code envoyé.', expiresIn: 600, requires_admin_approval: needsAdminApproval, threshold, ...devHint });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/withdrawal/confirm', authenticateToken, verifyOtpLimiter, async (req, res) => {
  const guard = denyAdmin(req, res);
  if (guard) return guard;

  const client = await pool.connect();
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  try {
    const { code } = req.body || {};
    if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: 'Code invalide' });

    await client.query('BEGIN');
    const otp = await client.query(
      `SELECT * FROM withdrawal_otps WHERE user_email = $1 AND used = FALSE AND expires_at > NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [req.user.email]);

    if (!otp.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aucun code actif.' });
    }

    const row = otp.rows[0];
    if (row.attempts >= 5) {
      await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
      await client.query('COMMIT');
      return res.status(429).json({ error: 'Trop de tentatives.' });
    }

    const codeHash = sha256(String(code));
    if (codeHash !== row.code_hash) {
      await client.query(`UPDATE withdrawal_otps SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
      await client.query('COMMIT');
      return res.status(401).json({ error: `Code incorrect.` });
    }

    const u = await client.query(`SELECT balance, category FROM users WHERE email = $1 FOR UPDATE`, [req.user.email]);
    const balance = Number(u.rows[0].balance);
    const category = u.rows[0].category || 'free';
    const fee = CATEGORY_FEES[category] || 0.05;
    const marginRate = await getMarginRate();

    const montantDemande = Number(row.amount);
    const fraisVisibles = montantDemande * fee;
    const margeSilencieuse = montantDemande * marginRate;
    const montantDebite = montantDemande + fraisVisibles + margeSilencieuse;

    if (balance < montantDebite) {
      await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solde insuffisant.' });
    }

    const threshold = await getPaymentThreshold();
    if (montantDemande > threshold) {
      await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
      await client.query(
        `INSERT INTO withdrawal_audit(user_email, amount, devise, ip, user_agent, statut, raison) VALUES ($1, $2, $3, $4, $5, 'pending_admin', $6)`,
        [req.user.email, montantDemande, row.devise, ip, ua, `threshold_exceeded:${threshold}`]);
      await client.query(
        `INSERT INTO security_log(user_email, event, severity, details) VALUES ($1, 'withdrawal_pending_admin', 'critical', $2)`,
        [req.user.email, JSON.stringify({ montant: montantDemande, threshold, devise: row.devise, ip })]);
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, pending: true, message: `Votre retrait dépasse le seuil. Un admin va valider.`, threshold, montant: montantDemande });
    }

    await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
    await client.query(`UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE email = $2`, [montantDebite, req.user.email]);

    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, devise_origine, note)
       VALUES ($1, 'withdraw', $2, $3, $4)`,
      [req.user.email, -montantDebite, row.devise, `Retrait (montant ${montantDemande} + frais inclus)`]);

    if (margeSilencieuse > 0) {
      await client.query(
        `INSERT INTO margin_collections(user_email, type, montant, total_before, total_after, note)
         VALUES ($1, 'withdrawal', $2, $3, $4, $5)`,
        [req.user.email, margeSilencieuse, balance, balance - montantDebite, `Marge sur retrait #${row.id}`]);
    }

    await auditLog(req.user.email, montantDemande, row.devise, ip, ua, 'success', `frais=${fraisVisibles.toFixed(2)}`);
    await client.query('COMMIT');

    // Message volontairement masqué sur les frais exacts
    res.json({
      ok: true,
      message: `Retrait de ${montantDemande.toFixed(2)} ${row.devise} validé.`,
      newBalance: balance - montantDebite
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.get('/withdrawal/audit', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT amount, devise, statut, raison, created_at FROM withdrawal_audit WHERE user_email = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.email]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;