// C:\Me\AppMoney\MeParisPortifs\routes-withdrawal.js
// v6.3.0 — Payout automatique via CinetPay
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { pool } = require('./db');
const { authenticateToken, sha256, requirePermission } = require('./utils');
const { sendPayout } = require('./payout');
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

async function getPaymentThreshold() {
  try {
    const { rows } = await pool.query(`SELECT value FROM constantes WHERE key = 'PAYMENT_THRESHOLD'`);
    return rows[0] ? Number(rows[0].value) : PAYMENT_THRESHOLD_DEFAULT;
  } catch (_) { return PAYMENT_THRESHOLD_DEFAULT; }
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

async function auditLog(email, amount, devise, ip, ua, statut, raison, phone = null, payoutTxid = null) {
  try {
    await pool.query(
      `INSERT INTO withdrawal_audit(user_email, amount, devise, ip, user_agent, statut, raison, phone, payout_txid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [email, amount, devise, ip, ua, statut, raison, phone, payoutTxid]);
  } catch (e) { logger.error('[audit withdrawal]', e.message); }
}

function denyAdmin(req, res) {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: "L'administrateur ne peut pas effectuer de retrait." });
  }
  return null;
}

router.post('/withdrawal/request-otp', authenticateToken, requirePermission('can_retirer'), requestOtpLimiter, async (req, res) => {
  const guard = denyAdmin(req, res);
  if (guard) return guard;

  const client = await pool.connect();
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  try {
    const { amount, devise = 'XAF', password, phone } = req.body || {};
    const m = Number(amount);

    if (!password) return res.status(400).json({ error: 'Mot de passe requis' });
    if (!phone || String(phone).replace(/\D/g, '').length < 8) {
      return res.status(400).json({ error: 'Numéro Mobile Money valide requis' });
    }
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
    const frais = m * fee;
    const totalRequisSurSolde = m + frais;

    const pwdOk = await bcrypt.compare(password, user.password);
    if (!pwdOk) {
      await auditLog(user.email, m, devise, ip, ua, 'failed', 'password_incorrect', phone);
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Mot de passe incorrect' });
    }

    if (balance < totalRequisSurSolde) {
      await auditLog(user.email, m, devise, ip, ua, 'failed', 'solde_insuffisant', phone);
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Solde insuffisant. Montant : ${m} XAF · Frais : ${frais.toFixed(2)} XAF · Total requis : ${totalRequisSurSolde.toFixed(2)} XAF.`
      });
    }

    const c24 = await client.query(`SELECT count_withdrawals_24h($1) AS n`, [user.email]);
    if (c24.rows[0].n >= 1) {
      await auditLog(user.email, m, devise, ip, ua, 'failed', 'limite_24h', phone);
      await client.query('ROLLBACK');
      return res.status(429).json({ error: 'Un seul retrait autorisé par 24 heures.' });
    }

    await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE user_email = $1 AND used = FALSE`, [user.email]);

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await client.query(
      `INSERT INTO withdrawal_otps(user_email, code_hash, amount, devise, expires_at, phone)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [user.email, codeHash, m, devise, expiresAt, phone]);

    await auditLog(user.email, m, devise, ip, ua, 'otp_sent', needsAdminApproval ? 'requires_admin_approval' : null, phone);
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

    const montantDemande = Number(row.amount);
    const fraisVisibles = montantDemande * fee;
    const montantDebite = montantDemande + fraisVisibles;

    if (balance < montantDebite) {
      await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Solde insuffisant.' });
    }

    const threshold = await getPaymentThreshold();
    if (montantDemande > threshold) {
      await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
      await client.query(
        `INSERT INTO withdrawal_audit(user_email, amount, devise, ip, user_agent, statut, raison, phone) VALUES ($1, $2, $3, $4, $5, 'pending_admin', $6, $7)`,
        [req.user.email, montantDemande, row.devise, ip, ua, `threshold_exceeded:${threshold}`, row.phone]);
      await client.query(
        `INSERT INTO security_log(user_email, event, severity, details) VALUES ($1, 'withdrawal_pending_admin', 'critical', $2)`,
        [req.user.email, JSON.stringify({ montant: montantDemande, threshold, devise: row.devise, ip })]);
      await client.query('COMMIT');
      return res.status(202).json({ ok: true, pending: true, message: `Votre retrait dépasse le seuil. Un admin va valider.`, threshold, montant: montantDemande });
    }

    // Débit virtuel
    await client.query(`UPDATE withdrawal_otps SET used = TRUE WHERE id = $1`, [row.id]);
    await client.query(`UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE email = $2`, [montantDebite, req.user.email]);

    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, devise_origine, note)
       VALUES ($1, 'withdraw', $2, $3, $4)`,
      [req.user.email, -montantDebite, row.devise, `Retrait (${montantDemande} + frais ${fraisVisibles.toFixed(2)})`]);

    const payoutTxid = 'PAY' + Date.now() + Math.floor(Math.random() * 1000);
    await auditLog(req.user.email, montantDemande, row.devise, ip, ua, 'processing', `frais=${fraisVisibles.toFixed(2)}`, row.phone, payoutTxid);
    await client.query('COMMIT');

    // ⭐ Payout réel via CinetPay (hors transaction)
    const payoutResult = await sendPayout(req.user.email, montantDemande, row.devise, payoutTxid, row.phone);

    if (payoutResult.ok) {
      await pool.query(`UPDATE withdrawal_audit SET statut = 'success' WHERE payout_txid = $1`, [payoutTxid]);
      res.json({ ok: true, message: `Retrait de ${montantDemande.toFixed(2)} ${row.devise} validé et envoyé sur votre Mobile Money.`, newBalance: balance - montantDebite });
    } else {
      await pool.query(`UPDATE withdrawal_audit SET statut = 'failed_payout', raison = $1 WHERE payout_txid = $2`, [payoutResult.error.slice(0,100), payoutTxid]);
      await pool.query(
        `INSERT INTO security_log(user_email, event, severity, details) VALUES ($1, 'payout_failed', 'critical', $2)`,
        [req.user.email, JSON.stringify({ amount: montantDemande, error: payoutResult.error, txid: payoutTxid })]);
      return res.status(500).json({ error: 'Retrait débité mais échec de l\'envoi réel. Contactez le support.' });
    }
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

router.get('/withdrawal/audit', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT amount, devise, statut, raison, created_at, phone, payout_txid FROM withdrawal_audit WHERE user_email = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.email]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;