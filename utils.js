// C:\Me\AppMoney\MeParisPortifs\utils.js
// v6.2.1 — Corrections sécurité (CSRF, sessions, HMAC webhook)
const crypto = require('crypto');
const { pool } = require('./db');

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_DAYS || 7) * 86400 * 1000;
const APP_URL_IS_HTTPS = /^https:\/\//i.test(process.env.APP_URL || '');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || undefined;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function generateUserId() {
  return 'M3L-' + String(crypto.randomInt(100000, 1000000));
}

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/* ═══════════════════════════════════════════════════════════════════ */
/* PERMISSIONS                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
const CATEGORY_LEVEL = { free: 0, premium: 1, vip: 2, legendaire: 3 };

const PERMISSION_KEYS = [
  'can_saisir', 'can_valider', 'can_voir_resultats', 'can_voir_historique',
  'can_voir_stats', 'can_utiliser_ia', 'can_retirer', 'can_deposer',
  'can_parrainer', 'can_voir_news', 'can_create_permissions', 'can_use_vip_ia', 'can_auto_settle'
];

const PERMISSION_GROUPS = {
  free: { can_saisir: true, can_valider: false, can_voir_resultats: true, can_voir_historique: true, can_voir_stats: true, can_utiliser_ia: false, can_retirer: true, can_deposer: true, can_parrainer: true, can_voir_news: true, can_create_permissions: false, can_use_vip_ia: false, can_auto_settle: false },
  premium: { can_saisir: true, can_valider: false, can_voir_resultats: true, can_voir_historique: true, can_voir_stats: true, can_utiliser_ia: true, can_retirer: true, can_deposer: true, can_parrainer: true, can_voir_news: true, can_create_permissions: false, can_use_vip_ia: false, can_auto_settle: false },
  vip: { can_saisir: true, can_valider: true, can_voir_resultats: true, can_voir_historique: true, can_voir_stats: true, can_utiliser_ia: true, can_retirer: true, can_deposer: true, can_parrainer: true, can_voir_news: true, can_create_permissions: false, can_use_vip_ia: true, can_auto_settle: false },
  legendaire: { can_saisir: true, can_valider: true, can_voir_resultats: true, can_voir_historique: true, can_voir_stats: true, can_utiliser_ia: true, can_retirer: true, can_deposer: true, can_parrainer: true, can_voir_news: true, can_create_permissions: false, can_use_vip_ia: true, can_auto_settle: true },
  admin: { can_saisir: true, can_valider: true, can_voir_resultats: true, can_voir_historique: true, can_voir_stats: true, can_utiliser_ia: true, can_retirer: true, can_deposer: true, can_parrainer: true, can_voir_news: true, can_create_permissions: true, can_use_vip_ia: true, can_auto_settle: true }
};

/* Permissions sensibles : ne peuvent jamais être plus permissives que le fallback */
const SENSITIVE_PERMS = ['can_create_permissions', 'can_use_vip_ia', 'can_auto_settle', 'can_valider'];

function hasCategory(userCategory, required) {
  return (CATEGORY_LEVEL[userCategory] ?? 0) >= (CATEGORY_LEVEL[required] ?? 0);
}

async function getEffectivePermissions(user) {
  if (!user) return {};
  if (user.role === 'admin') return { ...PERMISSION_GROUPS.admin };

  const category = user.category || 'free';
  let base = { ...(PERMISSION_GROUPS[category] || PERMISSION_GROUPS.free) };

  try {
    const groupRes = await pool.query(`SELECT permissions FROM permission_groups WHERE category = $1`, [category]);
    if (groupRes.rows.length && groupRes.rows[0].permissions) {
      const dbPerms = typeof groupRes.rows[0].permissions === 'string'
        ? JSON.parse(groupRes.rows[0].permissions)
        : groupRes.rows[0].permissions;

      for (const key of PERMISSION_KEYS) {
        if (dbPerms[key] === undefined) continue;
        if (SENSITIVE_PERMS.includes(key) && !!dbPerms[key] && !base[key]) {
          console.warn(`[getEffectivePermissions] DB tente d'accorder ${key}=true à ${category}, refusé.`);
          continue;
        }
        base[key] = !!dbPerms[key];
      }
    }

    const overrideRes = await pool.query(
      `SELECT permission_key, value FROM user_permission_overrides WHERE user_email = $1`,
      [user.email]);
    for (const r of overrideRes.rows) {
      if (!PERMISSION_KEYS.includes(r.permission_key)) continue;
      if (SENSITIVE_PERMS.includes(r.permission_key) && !!r.value && !base[r.permission_key]) {
        console.warn(`[getEffectivePermissions] Override refuse ${r.permission_key}=true pour ${user.email}`);
        continue;
      }
      base[r.permission_key] = !!r.value;
    }
  } catch (e) {
    console.error('[getEffectivePermissions]', e.message);
  }

  return base;
}

function requireCategory(required) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
      if (req.user.role === 'admin') return next();
      if (!hasCategory(req.user.category, required)) {
        return res.status(403).json({ error: `🔒 Accès réservé aux membres ${required.toUpperCase()}.` });
      }
      next();
    } catch (e) { next(e); }
  };
}

function requirePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Non authentifié' });
      if (req.user.role === 'admin') return next();
      if (!PERMISSION_KEYS.includes(permissionKey)) {
        return res.status(500).json({ error: `Permission inconnue : ${permissionKey}` });
      }
      const perms = await getEffectivePermissions(req.user);
      if (!perms[permissionKey]) {
        return res.status(403).json({ error: `🔒 Permission refusée : ${permissionKey}.`, permission: permissionKey });
      }
      next();
    } catch (e) { next(e); }
  };
}

/* ═══════════════════════════════════════════════════════════════════ */
/* LOGS & TOKENS                                                     */
/* ═══════════════════════════════════════════════════════════════════ */
async function logSecurity({ email, event, severity = 'info', ip, userAgent, details }) {
  try {
    await pool.query(
      `INSERT INTO security_log(user_email, event, severity, ip, user_agent, details) VALUES ($1, $2, $3, $4, $5, $6)`,
      [email || null, event, severity, ip || null, userAgent || null, details ? JSON.stringify(details) : null]);
  } catch (e) { console.error('[logSecurity]', e.message); }
}

function generateResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: sha256(token) };
}

async function forceLogout(email) {
  const r = await pool.query(`DELETE FROM sessions WHERE user_email = $1`, [email]);
  return r.rowCount;
}

/* ═══════════════════════════════════════════════════════════════════ */
/* LOGIN ATTEMPTS                                                    */
/* ═══════════════════════════════════════════════════════════════════ */
async function countRecentFailedLogins(ip, email) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM login_attempts
        WHERE (ip = $1 OR email = $2) AND success = FALSE
          AND created_at > NOW() - INTERVAL '15 minutes'`,
      [ip, email]);
    return r.rows[0].n;
  } catch (e) { return 0; }
}

async function recordLoginAttempt(ip, email, success) {
  try { await pool.query(`INSERT INTO login_attempts(ip, email, success) VALUES ($1, $2, $3)`, [ip, email, success]); } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════ */
/* AUTH                                                              */
/* ═══════════════════════════════════════════════════════════════════ */
async function authenticateToken(req, res, next) {
  try {
    const token = req.cookies?.auth_token;
    if (!token) return res.status(401).json({ error: 'Non authentifié' });
    const { rows } = await pool.query(
      `SELECT s.token, s.user_email, s.expires_at, u.role, u.category
         FROM sessions s JOIN users u ON u.email = s.user_email
        WHERE s.token = $1 AND s.expires_at > NOW()`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'Session expirée' });
    req.user = {
      email: rows[0].user_email,
      role: rows[0].role,
      category: rows[0].category || 'free'
    };
    next();
  } catch (e) { next(e); }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

/* ═══════════════════════════════════════════════════════════════════ */
/* SESSIONS                                                          */
/* ═══════════════════════════════════════════════════════════════════ */
async function createSession(email, req, res) {
  const token = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    `INSERT INTO sessions(token, user_email, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)`, 
    [token, email, expires, req.headers['user-agent'] || null, req.ip]
  );

  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const isHttps = (proto === 'https' || req.secure === true || APP_URL_IS_HTTPS);
  const secure = IS_PRODUCTION ? isHttps : false;
  
  const cookieOptions = { 
    httpOnly: true, 
    sameSite: 'none',  // ⭐ CORRIGÉ : 'none' est requis pour HTTPS cross-origin
    secure,            // En prod HTTPS, 'none' exige 'secure: true'
    maxAge: SESSION_TTL_MS, 
    path: '/' 
  };
  
  if (COOKIE_DOMAIN) cookieOptions.domain = COOKIE_DOMAIN;
  
  // ⭐ On envoie le cookie de session
  res.cookie('auth_token', token, cookieOptions);
  
  // ⭐ On génère et envoie le cookie CSRF si pas déjà présent
  if (!req.cookies?.csrf_token) {
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,  // Le JS du frontend doit pouvoir lire ce cookie
      sameSite: 'none',
      secure,
      maxAge: SESSION_TTL_MS,
      path: '/'
    });
  }
  
  return token;
}

/* ═══════════════════════════════════════════════════════════════════ */
/* CSRF                                                              */
/* ═══════════════════════════════════════════════════════════════════ */
const CSRF_EXEMPT_PATHS = ['/payment/notify', '/public/contact', '/auth/forgot-password', '/auth/reset-password'];

function csrfProtection(req, res, next) {
  const method = req.method.toUpperCase();
  if (CSRF_EXEMPT_PATHS.some(p => req.path === p)) return next();

  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!req.cookies?.csrf_token) {
      const token = crypto.randomBytes(32).toString('hex');
      res.cookie('csrf_token', token, {
        httpOnly: false, sameSite: 'lax',
        secure: IS_PRODUCTION, maxAge: SESSION_TTL_MS,
        path: '/', domain: COOKIE_DOMAIN
      });
    }
    return next();
  }

  const cookieToken = req.cookies?.csrf_token;
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'Token CSRF manquant ou invalide', code: 'CSRF_INVALID' });
  }
  next();
}

/* ═══════════════════════════════════════════════════════════════════ */
/* WEBHOOK HMAC                                                      */
/* ═══════════════════════════════════════════════════════════════════ */
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.CINETPAY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[verifyWebhookSignature] CINETPAY_WEBHOOK_SECRET non défini.');
    return false;
  }
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (_) { return false; }
}

module.exports = {
  esc, sha256, generateUserId, generateReferralCode,
  authenticateToken, requireAdmin, createSession,
  hasCategory, requireCategory, CATEGORY_LEVEL,
  getEffectivePermissions, requirePermission,
  PERMISSION_GROUPS, PERMISSION_KEYS,
  logSecurity, generateResetToken, forceLogout,
  countRecentFailedLogins, recordLoginAttempt,
  csrfProtection, verifyWebhookSignature
};