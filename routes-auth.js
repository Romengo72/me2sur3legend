// C:\Me\AppMoney\MeParisPortifs\routes-auth.js
// v6.2.1 — Corrections sécurité (bypass admin, esc, sessions)
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const {
  authenticateToken, createSession, generateUserId,
  generateReferralCode, logSecurity, countRecentFailedLogins,
  recordLoginAttempt, getEffectivePermissions
} = require('./utils');

const router = express.Router();

/* Rate-limit simple en mémoire (anti-spam inscription) */
const registerAttempts = new Map();
function rateLimitRegister(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const max = 5;
  const arr = (registerAttempts.get(ip) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) {
    return res.status(429).json({ error: 'Trop d\'inscriptions depuis cette IP. Réessayez dans 1 heure.' });
  }
  arr.push(now);
  registerAttempts.set(ip, arr);
  next();
}

async function getSetting(key, fallback = null) {
  try {
    const { rows } = await pool.query(`SELECT value FROM company_settings WHERE key = $1`, [key]);
    return rows[0]?.value ?? fallback;
  } catch (_) { return fallback; }
}

async function isReferralRequired() {
  const val = await getSetting('REFERRAL_REQUIRED', '1');
  if (val !== null && val !== '') return val === '1' || val === 'true';
  const { rows } = await pool.query(`SELECT value FROM constantes WHERE key = 'REFERRAL_REQUIRED'`);
  return Number(rows[0]?.value ?? 1) === 1;
}

async function getSystemReferralCode() {
  const code = await getSetting('system_referral_code', 'SYSTEM0000');
  return String(code || 'SYSTEM0000').toUpperCase();
}

async function validateReferralCode(code) {
  const normalized = String(code || '').toUpperCase().trim();
  if (!normalized) return { valid: false, error: 'Code de parrainage obligatoire.' };

  if (normalized.startsWith('INV-')) {
    const inv = await pool.query(`SELECT id FROM invitations WHERE code = $1 AND used = FALSE`, [normalized]);
    if (inv.rows.length) {
      return { valid: true, isInvite: true, inviteId: inv.rows[0].id, parrainEmail: null, parrainReferralCode: null };
    }
    return { valid: false, error: 'Code d\'invitation invalide ou deja utilise.' };
  }

  const systemCode = await getSystemReferralCode();
  if (normalized === systemCode) {
    return { valid: true, isSystem: true, parrainEmail: null, parrainReferralCode: null };
  }

  const { rows } = await pool.query(
    `SELECT email, referral_code FROM users WHERE UPPER(referral_code) = $1 LIMIT 1`,
    [normalized]);
  if (!rows.length) return { valid: false, error: 'Code de parrainage invalide ou inexistant.' };

  return { valid: true, isSystem: false, parrainEmail: rows[0].email, parrainReferralCode: rows[0].referral_code };
}

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /register                                                    */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/register', rateLimitRegister, async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, password, fullName, country, phone, referralCode, language } = req.body || {};

    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email et mot de passe (6+) requis.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Format d\'email invalide.' });
    }

    const normalized = String(email).toLowerCase().trim();
    const required = await isReferralRequired();
    let parrainEmail = null;
    let parrainReferralCode = null;
    let inviteId = null;

    if (required) {
      const validation = await validateReferralCode(referralCode);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error || 'Code invalide.', code: 'REFERRAL_REQUIRED' });
      }
      parrainEmail = validation.parrainEmail;
      parrainReferralCode = validation.parrainReferralCode;
      if (validation.isInvite) inviteId = validation.inviteId;
    } else if (referralCode) {
      const validation = await validateReferralCode(referralCode);
      if (validation.valid) {
        parrainEmail = validation.parrainEmail;
        parrainReferralCode = validation.parrainReferralCode;
        if (validation.isInvite) inviteId = validation.inviteId;
      }
    }

    const exists = await client.query(`SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [normalized]);
    if (exists.rows.length) {
      await logSecurity({ email: normalized, event: 'register_duplicate_email', severity: 'warn', ip: req.ip });
      return res.status(409).json({ error: 'Cet email est deja utilise.', code: 'EMAIL_TAKEN' });
    }

    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS || 10));
    const userId = generateUserId();
    let referralCodeSelf = generateReferralCode();

    for (let i = 0; i < 3; i++) {
      const dup = await client.query(`SELECT 1 FROM users WHERE referral_code = $1`, [referralCodeSelf]);
      if (!dup.rows.length) break;
      referralCodeSelf = generateReferralCode();
    }

    const lang = ['fr', 'en', 'ru', 'zh'].includes(String(language || '').toLowerCase())
      ? String(language).toLowerCase() : 'fr';

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (
         email, password, full_name, country, phone, role, balance,
         devise, language, user_id, category, referral_code, referred_by,
         welcome_bonus, joined_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'user', 500,
         'XAF', $6, $7, 'free', $8, $9, TRUE, NOW()
       )`,
      [normalized, hash, String(fullName || '').slice(0, 200), String(country || '').slice(0, 100),
       String(phone || '').slice(0, 30), lang, userId, referralCodeSelf, parrainReferralCode]);

    await client.query(`INSERT INTO permissions(user_email) VALUES ($1) ON CONFLICT DO NOTHING`, [normalized]);
    await client.query(`INSERT INTO preferences(user_email, language) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [normalized, lang]);
    await client.query(`INSERT INTO user_bonuses(user_email, type, montant, note) VALUES ($1, 'welcome', 500, 'Bonus de bienvenue')`, [normalized]);
    await client.query(`INSERT INTO transactions(user_email, type, montant_eur, note) VALUES ($1, 'bonus', 500, 'Bonus de bienvenue Me2/3Legend')`, [normalized]);

    if (parrainEmail) {
      await client.query(`UPDATE users SET balance = balance + 250, updated_at = NOW() WHERE email = $1`, [parrainEmail]);
      await client.query(`INSERT INTO transactions(user_email, type, montant_eur, note) VALUES ($1, 'bonus', 250, $2)`, [parrainEmail, `Bonus parrainage (filleul: ${normalized})`]);
      await client.query(`INSERT INTO user_bonuses(user_email, type, montant, note) VALUES ($1, 'referral', 250, $2)`, [parrainEmail, `Parrainage ${normalized}`]);
    }

    if (inviteId) {
      await client.query(`UPDATE invitations SET used = TRUE, used_at = NOW(), used_by = $1 WHERE id = $2`, [normalized, inviteId]);
    }

    await client.query('COMMIT');

    try {
      await createSession(normalized, req, res);
    } catch (sessionErr) {
      console.error('[register] createSession échoué:', sessionErr.message);
    }

    await logSecurity({ email: normalized, event: 'register_success', severity: 'info', ip: req.ip, details: { referredBy: parrainEmail || 'SYSTEM' } });

    res.status(201).json({ ok: true, email: normalized, userId, referralCode: referralCodeSelf, language: lang, referredBy: parrainEmail });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[register]', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /login — SANS bypass admin                                   */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/login', async (req, res) => {
  const ip = req.ip;
  const ua = req.headers['user-agent'] || '';

  try {
    const { email, password } = req.body || {};
    const normalized = String(email || '').toLowerCase().trim();

    const failed = await countRecentFailedLogins(ip, normalized);
    if (failed >= 5) {
      await logSecurity({ email: normalized, event: 'login_bruteforce_blocked', severity: 'critical', ip, userAgent: ua });
      return res.status(429).json({ error: 'Trop de tentatives echouees. Reessayez dans 15 minutes.' });
    }

    const { rows } = await pool.query(
      `SELECT email, password, role, category, language FROM users WHERE LOWER(email) = LOWER($1)`,
      [normalized]);

    if (!rows.length) {
      await recordLoginAttempt(ip, normalized, false);
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const ok = await bcrypt.compare(password, rows[0].password);
    if (!ok) {
      await recordLoginAttempt(ip, normalized, false);
      await logSecurity({ email: normalized, event: 'login_failed', severity: 'warn', ip, userAgent: ua });
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    await recordLoginAttempt(ip, normalized, true);
    await createSession(rows[0].email, req, res);
    await logSecurity({ email: normalized, event: 'login_success', severity: 'info', ip, userAgent: ua });

    res.json({
      ok: true, email: rows[0].email, role: rows[0].role,
      category: rows[0].category || 'free', language: rows[0].language || 'fr'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const t = req.cookies?.auth_token;
    if (t) await pool.query(`DELETE FROM sessions WHERE token = $1`, [t]);
    res.clearCookie('auth_token', { path: '/' }).json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, role, category, balance, full_name, country, phone,
              devise, theme, language, user_id, referral_code, welcome_bonus, joined_at
         FROM users WHERE email = $1`, [req.user.email]);

    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const user = rows[0];

    if (user.role === 'admin') {
      const bfRes = await pool.query(`SELECT value FROM constantes WHERE key = 'BUDGET_FONCTIONNEMENT'`);
      if (bfRes.rows.length) {
        user.bf = Number(bfRes.rows[0].value);
        user.balance = user.bf;
      }
    }

    const effective = await getEffectivePermissions(user);
    const susp = await pool.query(
      `SELECT suspended_at, suspended_until, total_won, threshold
         FROM ia_suspensions
        WHERE user_email = $1 AND lifted_at IS NULL
          AND (suspended_until IS NULL OR suspended_until > NOW())
        ORDER BY suspended_at DESC LIMIT 1`,
      [req.user.email]);

    res.json({ user, permissions: effective, suspension: susp.rows[0] || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/auth/validate-referral', async (req, res) => {
  try {
    const code = String(req.query.code || '').toUpperCase().trim();
    if (!code) return res.json({ valid: false, error: 'Code requis' });
    const validation = await validateReferralCode(code);
    res.json({ valid: validation.valid, isSystem: validation.isSystem, error: validation.error || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;