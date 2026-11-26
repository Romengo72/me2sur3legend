// C:\Me\AppMoney\MeParisPortifs\routes-security.js
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const {
  authenticateToken, requireAdmin, esc,
  logSecurity, generateResetToken, forceLogout
} = require('./utils');

const router = express.Router();

let sendMail = null;
try { ({ sendMail } = require('./mailer')); } catch (_) {}

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3,
  keyGenerator: r => r.ip,
  message: { error: 'Trop de demandes. Réessayez dans une heure.' }
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  keyGenerator: r => r.ip,
  message: { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /api/auth/forgot-password — self-service                        */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/auth/forgot-password', forgotLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  try {
    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email invalide' });

    const normalized = String(email).toLowerCase().trim();

    /* Anti-énumération : on renvoie toujours le même message */
    const user = await pool.query(
      `SELECT email FROM users WHERE email = $1`, [normalized]);

    if (user.rows.length) {
      /* Invalide les anciens tokens */
      await pool.query(
        `UPDATE password_resets SET used = TRUE
          WHERE user_email = $1 AND used = FALSE`, [normalized]);

      const { token, hash } = generateResetToken();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      await pool.query(
        `INSERT INTO password_resets(user_email, token_hash, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [normalized, hash, expiresAt, ip, ua]);

      // APRÈS (v6.2.0 — APP_URL prioritaire, fallback sur proto/host)
      const baseUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
      const resetLink = `${baseUrl}/login?reset_token=${token}`;

      /* Envoi email (best-effort) */
      if (sendMail) {
        try {
          await sendMail({
            to: normalized,
            subject: '🔑 Réinitialisation de votre mot de passe',
            html: `
              <div style="font-family:Inter,sans-serif;max-width:520px;margin:auto;padding:30px;background:#0d0d18;color:#e9e9ff;border-radius:14px;">
                <h2 style="color:#7c3aed;">🔑 Réinitialiser votre mot de passe</h2>
                <p>Vous avez demandé la réinitialisation de votre mot de passe Me2/3Legend.</p>
                <p style="text-align:center;margin:24px 0;">
                  <a href="${resetLink}" style="background:linear-gradient(135deg,#7c3aed,#22d3ee);color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;">
                    Réinitialiser mon mot de passe
                  </a>
                </p>
                <p style="font-size:.85rem;color:#a0a0c0;">
                  Ce lien expire dans <strong>30 minutes</strong>.<br>
                  Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.
                </p>
              </div>`
          });
        } catch (e) { console.error('[forgot mail]', e.message); }
      }

      await logSecurity({
        email: normalized, event: 'password_reset_requested',
        severity: 'warn', ip, userAgent: ua
      });
    }

    /* Réponse uniforme (anti-énumération) */
    res.json({
      ok: true,
      message: 'Si cet email existe dans notre système, un lien de réinitialisation vous a été envoyé.'
    });
  } catch (e) {
    console.error('[forgot-password]', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /api/auth/reset-password — validation token + nouveau mdp       */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/auth/reset-password', resetLimiter, async (req, res) => {
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Token et mot de passe (6+) requis' });

    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');

    const r = await pool.query(
      `SELECT * FROM password_resets
        WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1`,
      [tokenHash]);

    if (!r.rows.length) {
      await logSecurity({ event: 'password_reset_invalid_token', severity: 'warn', ip, userAgent: ua });
      return res.status(400).json({ error: 'Lien invalide ou expiré. Refaites une demande.' });
    }

    const row = r.rows[0];
    const hash = await bcrypt.hash(newPassword, Number(process.env.BCRYPT_ROUNDS || 10));

    await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE email = $2`,
      [hash, row.user_email]);

    await pool.query(
      `UPDATE password_resets SET used = TRUE WHERE id = $1`, [row.id]);

    /* Force la déconnexion de toutes les sessions */
    const killed = await forceLogout(row.user_email);

    await logSecurity({
      email: row.user_email, event: 'password_reset_success',
      severity: 'critical', ip, userAgent: ua,
      details: { sessions_killed: killed }
    });

    res.json({ ok: true, message: 'Mot de passe réinitialisé. Reconnectez-vous.' });
  } catch (e) {
    console.error('[reset-password]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Admin — Reset mot de passe utilisateur                               */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/admin/reset-user-password', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, newPassword } = req.body || {};
    if (!email || !newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'Email et mot de passe (6+) requis' });

    const normalized = String(email).toLowerCase().trim();
    const exists = await pool.query(`SELECT 1 FROM users WHERE email = $1`, [normalized]);
    if (!exists.rows.length)
      return res.status(404).json({ error: 'Utilisateur introuvable' });

    const hash = await bcrypt.hash(newPassword, Number(process.env.BCRYPT_ROUNDS || 10));
    await pool.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE email = $2`,
      [hash, normalized]);

    /* Force déconnexion */
    const killed = await forceLogout(normalized);

    await logSecurity({
      email: normalized, event: 'admin_password_reset',
      severity: 'critical', ip: req.ip, userAgent: req.headers['user-agent'],
      details: { by: req.user.email, sessions_killed: killed }
    });

    res.json({ ok: true, sessions_killed: killed });
  } catch (e) {
    console.error('[admin/reset-user-password]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Admin — Forcer déconnexion                                           */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/admin/force-logout', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Email requis' });

    const killed = await forceLogout(String(email).toLowerCase().trim());

    await logSecurity({
      email, event: 'admin_force_logout', severity: 'warn',
      ip: req.ip, userAgent: req.headers['user-agent'],
      details: { by: req.user.email, sessions_killed: killed }
    });

    res.json({ ok: true, sessions_killed: killed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Admin — Sessions actives d'un utilisateur                            */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/admin/user-sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email requis' });

    const { rows } = await pool.query(
      `SELECT token, user_agent, ip, created_at, expires_at, last_seen
         FROM sessions
        WHERE user_email = $1 AND expires_at > NOW()
        ORDER BY created_at DESC`,
      [String(email).toLowerCase().trim()]);

    /* On masque le token complet */
    const out = rows.map(r => ({
      ...r,
      token: r.token.slice(0, 8) + '…'
    }));
    res.json(out);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Admin — Journal sécurité                                             */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/admin/security-log', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, event, severity, limit = 100 } = req.query;
    let q = `SELECT * FROM security_log WHERE 1=1`;
    const p = [];
    if (email)    { p.push(email);    q += ` AND user_email = $${p.length}`; }
    if (event)    { p.push(event);    q += ` AND event = $${p.length}`; }
    if (severity) { p.push(severity); q += ` AND severity = $${p.length}`; }
    p.push(Number(limit));
    q += ` ORDER BY created_at DESC LIMIT $${p.length}`;
    const { rows } = await pool.query(q, p);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Admin — Purge sessions expirées (maintenance)                        */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/admin/purge-sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM sessions WHERE expires_at < NOW()`);
    res.json({ ok: true, purged: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;