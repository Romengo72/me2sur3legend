// C:\Me\AppMoney\MeParisPortifs\routes-payment.js
// ===================================================================
// v6.2.8 - Ajout /payment/check-direct (fallback webhook)
//   - CORRECTIF #5 : seuls mobile_money acceptes (carte/virement refuses)
//   - CORRECTIF #10 : seuil PAYMENT_THRESHOLD a 25M XAF (retrait manuel)
//   - Aucune marge prelevee sur les depots (decision Lot 3 - 1-A)
//   - Verification directe CinetPay si webhook tarde (check-direct)
// ===================================================================
// NOTE : cles techniques en ASCII strict (pas d'accents)
//        accents uniquement dans les libelles affiches

const https = require('https');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const {
  authenticateToken,
  generateUserId,
  generateReferralCode,
  createSession,
  logSecurity
} = require('./utils');
const logger = require('./logger');

const router = express.Router();

// ===================================================================
// CONFIGURATION
// ===================================================================

let BASE_URL = (process.env.APP_URL || 'http://localhost:8080').replace(/\/+$/, '');
if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(BASE_URL)) {
  logger.error('[CinetPay] APP_URL pointe vers localhost en production !');
}

const CINETPAY_MODE = (process.env.CINETPAY_MODE || 'sandbox').toLowerCase();
const CINETPAY_API = CINETPAY_MODE === 'production'
  ? 'https://api.cinetpay.co'
  : 'https://api.cinetpay.net';
const AUTH_URL = `${CINETPAY_API}/v1/oauth/login`;
const CINETPAY_TARGET_CURRENCY = 'XAF';

// ===================================================================
// CORRECTIF #5 : masquage des methodes de paiement
// ===================================================================
const PAYMENT_METHODS = {
  mobile_money: {
    enabled: true,
    channel: 'MOBILE_MONEY',
    fee: 0.025,
    label: 'Mobile Money'
  },
  carte: {
    enabled: false,
    channel: 'CREDIT_CARD',
    fee: 0.050,
    label: 'Carte bancaire',
    disabledReason: 'Moyen de paiement temporairement indisponible.'
  },
  virement: {
    enabled: false,
    channel: 'BANK_TRANSFER',
    fee: 0.020,
    label: 'Virement bancaire',
    disabledReason: 'Moyen de paiement temporairement indisponible.'
  }
};

// ===================================================================
// CORRECTIF #10 : seuil de paiement 25M XAF
// ===================================================================
const PAYMENT_THRESHOLD = 25_000_000;

async function getPaymentThreshold() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM constantes WHERE key = 'PAYMENT_THRESHOLD'`);
    return rows[0] ? Number(rows[0].value) : PAYMENT_THRESHOLD;
  } catch (_) { return PAYMENT_THRESHOLD; }
}

// ===================================================================
// TAUX DE CONVERSION
// ===================================================================
const DEVISES_TO_XAF = {
  XAF: 1, XOF: 1, EUR: 655.957, USD: 601.80, GBP: 762.70, CHF: 676.20,
  CAD: 443.20, JPY: 4.024, AUD: 395.20, CNY: 83.56, BRL: 120.36,
  MAD: 60.46, DZD: 4.492, TND: 191.80, RUB: 6.66
};

// Bonus par categorie - CLES TECHNIQUES EN ASCII STRICT
const CATEGORY_BONUS = {
  free: 0,
  premium: 0.02,
  vip: 0.05,
  legendaire: 0.10
};

logger.info(`[CinetPay] Mode : ${CINETPAY_MODE.toUpperCase()} | API: ${CINETPAY_API}`);
logger.info(`[CinetPay] Seuil : ${PAYMENT_THRESHOLD.toLocaleString('fr-FR')} XAF`);
logger.info(`[CinetPay] Methodes actives : ${Object.entries(PAYMENT_METHODS).filter(([, m]) => m.enabled).map(([k]) => k).join(', ')}`);

// ===================================================================
// HELPERS
// ===================================================================
function convertToXAF(montant, deviseSource) {
  const dev = String(deviseSource || 'XAF').toUpperCase();
  const taux = DEVISES_TO_XAF[dev];
  if (!taux) {
    throw Object.assign(
      new Error(`Devise non supportee : ${dev}. Devises acceptees : ${Object.keys(DEVISES_TO_XAF).join(', ')}`),
      { status: 400, code: 'UNSUPPORTED_CURRENCY', devise: dev }
    );
  }
  return { montantXAF: Math.round(Number(montant) * taux), taux, deviseSource: dev };
}

function translateCinetPayError(r, deviseOrigine) {
  const raw = r.data?.description || r.data?.message || r.data?.error || '';
  const status = r.status;
  if (status === 401 || /auth|token/i.test(raw)) {
    return 'Erreur de configuration du paiement. Contactez le support.';
  }
  if (/currency/i.test(raw)) {
    return `Devise non acceptee (${deviseOrigine}). Reessayez.`;
  }
  if (/amount|montant/i.test(raw) && /min/i.test(raw)) {
    return 'Montant inferieur au minimum accepte.';
  }
  if (/channel/i.test(raw)) {
    return 'Ce moyen de paiement n\'est pas active.';
  }
  if (status >= 500) {
    return 'Service de paiement temporairement indisponible. Reessayez.';
  }
  return `Erreur de paiement : ${raw || 'inconnue'}`;
}

function httpsRequest(url, { method = 'GET', body = null, headers = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      family: 4,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Me2-3Legend/6.2.8',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers
      },
      timeout
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch (e) { resolve({ status: res.statusCode, data: { raw: text } }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout HTTPS')); });
    req.on('error', (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

// ===================================================================
// OAUTH CINETPAY
// ===================================================================
let cachedToken = null;
let tokenExpiry = 0;

async function tryAuth(body) {
  const r = await httpsRequest(AUTH_URL, { method: 'POST', body });
  const token = r.data?.access_token || r.data?.data?.access_token || r.data?.data?.token;
  if (r.status >= 400 || !token) {
    return { ok: false, status: r.status, data: r.data, token: null };
  }
  return { ok: true, token, expiresIn: r.data?.expires_in || r.data?.data?.expires_in || 3600 };
}

async function getAuthToken(forceRefresh = false) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  logger.info('[CinetPay Auth] Nouveau token...');
  let result = await tryAuth({
    api_key: process.env.CINETPAY_API_KEY,
    api_password: process.env.CINETPAY_API_PASSWORD
  });
  if (!result.ok) {
    logger.warn('[CinetPay Auth] Retry format legacy...');
    result = await tryAuth({
      apikey: process.env.CINETPAY_API_KEY,
      apipassword: process.env.CINETPAY_API_PASSWORD
    });
  }
  if (!result.ok) {
    logger.error('[CinetPay Auth] Echec :', JSON.stringify(result.data).slice(0, 300));
    throw new Error(`Authentification CinetPay echouee (status ${result.status}).`);
  }
  cachedToken = result.token;
  tokenExpiry = Date.now() + (result.expiresIn * 1000) - 60000;
  logger.info(`[CinetPay Auth] [OK] Token valide ${Math.floor(result.expiresIn / 60)} min.`);
  return cachedToken;
}

async function apiCallWithToken(url, opts = {}) {
  const token = await getAuthToken();
  const headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${token}` };
  let r = await httpsRequest(url, { ...opts, headers });
  if (r.status === 401) {
    logger.warn('[CinetPay] 401 recu, refresh token et retry...');
    const newToken = await getAuthToken(true);
    r = await httpsRequest(url, {
      ...opts,
      headers: { ...(opts.headers || {}), 'Authorization': `Bearer ${newToken}` }
    });
  }
  return r;
}

// ===================================================================
// POST /payment/initialize - Depot
// ===================================================================
router.post('/payment/initialize', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  let transactionId = null;

  try {
    const { amount, methode = 'mobile_money', devise = 'XAF' } = req.body || {};
    const montantSaisi = Math.round(Number(amount));

    if (req.user.role === 'admin') {
      return res.status(403).json({ error: "L'admin ne peut pas deposer." });
    }

    // CORRECTIF #5 : methode obligatoirement active
    const method = PAYMENT_METHODS[methode];
    if (!method) {
      return res.status(400).json({
        error: `Methode de paiement inconnue : ${methode}`,
        supported_methods: Object.entries(PAYMENT_METHODS)
          .filter(([, m]) => m.enabled).map(([k]) => k)
      });
    }
    if (!method.enabled) {
      return res.status(400).json({
        error: method.disabledReason || 'Moyen de paiement indisponible.',
        code: 'METHOD_DISABLED',
        methode,
        supported_methods: Object.entries(PAYMENT_METHODS)
          .filter(([, m]) => m.enabled).map(([k]) => k)
      });
    }

    if (!montantSaisi || montantSaisi < 500) {
      return res.status(400).json({ error: 'Montant minimum : 500 (dans la devise choisie).' });
    }

    // CORRECTIF #10 : seuil de paiement global
    const threshold = await getPaymentThreshold();
    if (montantSaisi > threshold) {
      return res.status(400).json({
        error: `Montant superieur au seuil autorise (${threshold.toLocaleString('fr-FR')} XAF). Contactez le support.`,
        code: 'PAYMENT_THRESHOLD_EXCEEDED',
        threshold
      });
    }

    let conversion;
    try {
      conversion = convertToXAF(montantSaisi, devise);
    } catch (convErr) {
      return res.status(convErr.status || 400).json({
        error: convErr.message,
        code: convErr.code,
        supported_currencies: Object.keys(DEVISES_TO_XAF)
      });
    }

    const { montantXAF, taux, deviseSource } = conversion;

    if (montantXAF < 500) {
      return res.status(400).json({
        error: `Apres conversion, le montant (${montantXAF} XAF) est inferieur au minimum (500 XAF).`,
        montant_converti: montantXAF,
        taux
      });
    }

    // Idempotency : PENDING < 5 min
    const recent = await client.query(
      `SELECT ref_id FROM transactions
       WHERE user_email = $1 AND type = 'deposit'
         AND note LIKE 'PENDING:%' AND date > NOW() - INTERVAL '5 minutes'
       ORDER BY id DESC LIMIT 1`,
      [req.user.email]);
    if (recent.rows.length) {
      logger.warn(`[payment/initialize] PENDING recent ${req.user.email}`);
      return res.status(429).json({
        error: 'Un paiement est deja en cours. Attendez 5 minutes.',
        pending_ref: recent.rows[0].ref_id
      });
    }

    transactionId = 'DEP' + Date.now() + Math.floor(Math.random() * 1000);
    const pendingNote = `PENDING:${montantXAF}|${methode}|${CINETPAY_TARGET_CURRENCY}`;

    await client.query('BEGIN');
    await client.query(
      `INSERT INTO transactions(
         user_email, type, montant_eur, devise_origine,
         montant_origine, devise_destination, taux_applique,
         ref_id, note
       ) VALUES ($1, 'deposit', $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.user.email,
        montantXAF,
        deviseSource,
        montantSaisi,
        CINETPAY_TARGET_CURRENCY,
        taux,
        transactionId,
        pendingNote
      ]);
    await client.query('COMMIT');

    const payload = {
      currency: CINETPAY_TARGET_CURRENCY,
      merchant_transaction_id: transactionId,
      amount: montantXAF,
      lang: 'fr',
      designation: `Depot Me2/3Legend (${montantSaisi} ${deviseSource})`,
      client_email: req.user.email,
      client_first_name: 'Client',
      client_last_name: 'Legend',
      success_url: `${BASE_URL}/payment-waiting?txid=${transactionId}`,
      failed_url: `${BASE_URL}/payment-waiting?txid=${transactionId}&error=1`,
      notify_url: `${BASE_URL}/api/payment/notify`,
      channels: method.channel
    };

    logger.info(
      `[payment/initialize] ${montantSaisi} ${deviseSource} -> ${montantXAF} XAF ` +
      `(canal ${method.channel}, txid ${transactionId})`);

    const r = await apiCallWithToken(`${CINETPAY_API}/v1/payment`, {
      method: 'POST', body: payload
    });

    if (r.status >= 400) {
      logger.error('[CinetPay] HTTP', r.status, JSON.stringify(r.data).slice(0, 300));
      throw new Error(translateCinetPayError(r, deviseSource));
    }

    const pData = r.data?.data || r.data;
    const paymentUrl = pData?.payment_url || pData?.paymentUrl;
    if (!paymentUrl) throw new Error('URL de paiement absente');

    res.json({
      ok: true,
      payment_url: paymentUrl,
      transaction_id: transactionId,
      conversion: {
        montant_origine: montantSaisi,
        devise_origine: deviseSource,
        montant_xaf: montantXAF,
        taux,
        canal: method.channel
      }
    });
  } catch (e) {
    logger.error('[payment/initialize]', e.message);
    if (transactionId) {
      try {
        await pool.query(
          `UPDATE transactions SET note = $1
            WHERE ref_id = $2 AND note LIKE 'PENDING:%'`,
          [`FAILED:init_${e.message.slice(0, 100)}`, transactionId]);
      } catch (cleanupErr) {
        logger.error('[payment/initialize cleanup]', cleanupErr.message);
      }
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ===================================================================
// POST /payment/subscribe - Inscription + Paiement
// ===================================================================
router.post('/payment/subscribe', async (req, res) => {
  const client = await pool.connect();
  let transactionId = null;

  try {
    const { email, password, plan_code, fullName } = req.body || {};
    if (!email || !password || !plan_code) {
      return res.status(400).json({ error: 'Champs requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe : 6 caracteres min.' });
    }

    const normalized = String(email).toLowerCase().trim();

    const planRes = await client.query(
      `SELECT * FROM plans WHERE code = $1`, [plan_code]);
    if (!planRes.rows.length) throw new Error('Formule inconnue.');
    const plan = planRes.rows[0];

    const montantXAF = Math.round(Number(plan.prix_mensuel));
    if (montantXAF <= 0) throw new Error('Formule gratuite - utilisez /register.');

    const threshold = await getPaymentThreshold();
    if (montantXAF > threshold) {
      return res.status(400).json({
        error: `Abonnement superieur au seuil autorise (${threshold.toLocaleString('fr-FR')} XAF).`,
        code: 'PAYMENT_THRESHOLD_EXCEEDED'
      });
    }

    const exists = await client.query(
      `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [normalized]);
    const isExisting = exists.rows.length > 0;

    await client.query('BEGIN');

    if (!isExisting) {
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `INSERT INTO users (
           email, password, full_name, role, balance, devise,
           user_id, category, referral_code, welcome_bonus, joined_at
         ) VALUES ($1, $2, $3, 'user', 0, 'XAF', $4, 'free', $5, TRUE, NOW())`,
        [normalized, hash, fullName || 'Client', generateUserId(), generateReferralCode()]);

      await client.query(
        `INSERT INTO permissions(user_email) VALUES ($1) ON CONFLICT DO NOTHING`,
        [normalized]);
      await client.query(
        `INSERT INTO preferences(user_email) VALUES ($1) ON CONFLICT DO NOTHING`,
        [normalized]);
      await client.query(
        `UPDATE users SET balance = 500 WHERE email = $1`, [normalized]);
      await client.query(
        `INSERT INTO user_bonuses(user_email, type, montant, note)
         VALUES ($1, 'welcome', 500, 'Bonus de bienvenue')`, [normalized]);
      await client.query(
        `INSERT INTO transactions(user_email, type, montant_eur, note)
         VALUES ($1, 'bonus', 500, 'Bonus de bienvenue')`, [normalized]);
    } else {
      const pwdOk = await bcrypt.compare(password, exists.rows[0].password);
      if (!pwdOk) throw new Error('Mot de passe incorrect.');
    }

    transactionId = 'SUB' + Date.now() + Math.floor(Math.random() * 1000);
    const pendingNote = `PENDING:${montantXAF}|${plan.code}|${CINETPAY_TARGET_CURRENCY}`;

    await client.query(
      `INSERT INTO transactions(
         user_email, type, montant_eur, devise_origine,
         montant_origine, devise_destination, taux_applique,
         note, ref_id
       ) VALUES ($1, 'subscription', $2, 'XAF', $2, 'XAF', 1, $3, $4)`,
      [normalized, montantXAF, pendingNote, transactionId]);
    await client.query('COMMIT');

    const payload = {
      currency: CINETPAY_TARGET_CURRENCY,
      merchant_transaction_id: transactionId,
      amount: montantXAF,
      lang: 'fr',
      designation: `Abonnement ${plan.nom}`,
      client_email: normalized,
      client_first_name: (fullName || 'Client').split(' ')[0] || 'Client',
      client_last_name: (fullName || 'Legend').split(' ').slice(1).join(' ') || 'Legend',
      success_url: `${BASE_URL}/payment-waiting?txid=${transactionId}`,
      failed_url: `${BASE_URL}/payment-waiting?txid=${transactionId}&error=1`,
      notify_url: `${BASE_URL}/api/payment/notify`,
      channels: 'MOBILE_MONEY'
    };

    const r = await apiCallWithToken(`${CINETPAY_API}/v1/payment`, {
      method: 'POST', body: payload
    });

    if (r.status >= 400) {
      logger.error('[CinetPay/subscribe] HTTP', r.status, JSON.stringify(r.data).slice(0, 300));
      throw new Error(translateCinetPayError(r, 'XAF'));
    }

    const pData = r.data?.data || r.data;
    const paymentUrl = pData?.payment_url || pData?.paymentUrl;
    if (!paymentUrl) throw new Error('URL de paiement absente');

    res.json({ ok: true, payment_url: paymentUrl, transaction_id: transactionId });
  } catch (e) {
    logger.error('[payment/subscribe]', e.message);
    if (transactionId) {
      try {
        await pool.query(
          `UPDATE transactions SET note = $1
            WHERE ref_id = $2 AND note LIKE 'PENDING:%'`,
          [`FAILED:init_${e.message.slice(0, 100)}`, transactionId]);
      } catch (cleanupErr) {
        logger.error('[payment/subscribe cleanup]', cleanupErr.message);
      }
    }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ===================================================================
// GET /payment/status/:txid - Polling post-paiement
// ===================================================================
const statusAttempts = new Map();
const STATUS_RATE_MAX = 120;

function checkStatusRateLimit(ip) {
  const now = Date.now();
  const entry = statusAttempts.get(ip) || { count: 0, resetAt: now + 3600_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 3600_000; }
  entry.count++;
  statusAttempts.set(ip, entry);
  if (statusAttempts.size > 1000) {
    for (const [k, v] of statusAttempts) if (now > v.resetAt) statusAttempts.delete(k);
  }
  return entry.count <= STATUS_RATE_MAX;
}

router.get('/payment/status/:txid', async (req, res) => {
  const ip = req.ip;
  if (!checkStatusRateLimit(ip)) {
    return res.status(429).json({ error: 'Trop de requetes.' });
  }
  const { txid } = req.params;
  if (!/^(DEP|SUB)\d{13,16}$/.test(txid)) {
    return res.status(400).json({ error: 'Format txid invalide' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_email, note, montant_eur, montant_origine,
              devise_origine, taux_applique
         FROM transactions WHERE ref_id = $1 LIMIT 1`,
      [txid]);
    if (!rows.length) return res.status(404).json({ error: 'Transaction introuvable' });

    const row = rows[0];
    const note = String(row.note || '');

    if (note.startsWith('SUCCESS:')) {
      return res.json({
        status: 'paid',
        user_email: row.user_email,
        montant: Number(row.montant_eur),
        montant_origine: Number(row.montant_origine || row.montant_eur),
        devise_origine: row.devise_origine || 'XAF',
        taux: Number(row.taux_applique || 1)
      });
    }
    if (note.startsWith('PENDING:')) return res.json({ status: 'pending' });
    if (note.startsWith('FAILED:')) {
      return res.json({ status: 'failed', reason: note.substring(7).slice(0, 100) });
    }
    return res.json({ status: 'unknown' });
  } catch (e) {
    logger.error(`[payment/status] ${e.message}`);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ===================================================================
// GET /payment/check-direct/:txid - Verification directe CinetPay
// Fallback si le webhook tarde ou n'a pas ete appele
// ===================================================================
router.get('/payment/check-direct/:txid', async (req, res) => {
  const { txid } = req.params;
  if (!/^(DEP|SUB)\d{13,16}$/.test(txid)) {
    return res.status(400).json({ error: 'Format txid invalide' });
  }

  try {
    // 1. Verifier d'abord en base
    const { rows } = await pool.query(
      `SELECT user_email, note, montant_eur FROM transactions WHERE ref_id = $1 LIMIT 1`,
      [txid]
    );
    if (!rows.length) return res.status(404).json({ status: 'NOT_FOUND' });

    const note = String(rows[0].note || '');
    if (note.startsWith('SUCCESS:')) return res.json({ status: 'paid', source: 'db' });
    if (note.startsWith('FAILED:')) {
      return res.json({ status: 'failed', source: 'db', reason: note.substring(7) });
    }

    // 2. Si toujours PENDING, interroger CinetPay directement
    logger.info(`[payment/check-direct] Interrogation CinetPay pour ${txid}...`);
    const r = await apiCallWithToken(`${CINETPAY_API}/v1/payment/${txid}`, { method: 'GET' });

    if (r.status >= 400) {
      logger.warn(`[payment/check-direct] CinetPay HTTP ${r.status} pour ${txid}`);
      return res.json({ status: 'pending', source: 'cinetpay_error', http_status: r.status });
    }

    const txData = r.data?.data || r.data;
    const rawStatus = String(txData?.status || '').toUpperCase();
    logger.info(`[payment/check-direct] CinetPay status pour ${txid} : ${rawStatus}`);

    if (['ACCEPTED', '00', 'SUCCESS', 'PAID', 'OK', 'COMPLETED'].includes(rawStatus)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const tx = await client.query(
          `SELECT user_email, montant_eur, note FROM transactions
           WHERE ref_id = $1 AND note LIKE 'PENDING:%' FOR UPDATE`,
          [txid]);

        if (tx.rows.length) {
          const row = tx.rows[0];
          const userEmail = row.user_email;
          const montantPayeXAF = Number(row.montant_eur);
          const isSubscription = txid.startsWith('SUB');

          const noteMatch = row.note.match(/^PENDING:[\d.]+\|([^|]+)\|/);
          const methode = noteMatch ? noteMatch[1] : 'mobile_money';
          let noteFinale = '';

          if (isSubscription) {
            const planCode = methode.toLowerCase();
            await client.query(
              `UPDATE users SET category = $1 WHERE email = $2`, [planCode, userEmail]);
            await client.query(
              `INSERT INTO user_upgrades(user_email, from_cat, to_cat, prix, duree_jours, expire_at)
               VALUES ($1, 'free', $2, $3, 30, NOW() + INTERVAL '30 days')`,
              [userEmail, planCode, montantPayeXAF]);
            noteFinale = `SUCCESS:Abonnement ${planCode} (${montantPayeXAF} XAF) [check-direct]`;
          } else {
            const u = await client.query(
              `SELECT category, balance FROM users WHERE email = $1 FOR UPDATE`,
              [userEmail]);
            const category = u.rows[0]?.category || 'free';
            const ancienSolde = Number(u.rows[0]?.balance || 0);
            const frais = montantPayeXAF * (PAYMENT_METHODS[methode]?.fee || 0.025);
            const bonus = (montantPayeXAF - frais) * (CATEGORY_BONUS[category] || 0);
            const totalCredite = (montantPayeXAF - frais) + bonus;

            await client.query(
              `UPDATE users SET balance = $1 WHERE email = $2`,
              [ancienSolde + totalCredite, userEmail]);
            noteFinale = `SUCCESS:Depot ${montantPayeXAF} XAF - credite:${totalCredite.toFixed(2)} XAF [check-direct]`;

            const threshold = await getPaymentThreshold();
            if (montantPayeXAF >= threshold) {
              await client.query(
                `INSERT INTO security_log(user_email, event, severity, details)
                 VALUES ($1, 'payment_threshold_reached', 'critical', $2)`,
                [userEmail, JSON.stringify({ montant: montantPayeXAF, threshold, txid })]);
            }
          }

          await client.query(
            `UPDATE transactions SET note = $1 WHERE ref_id = $2`,
            [noteFinale, txid]);

          logger.info(`[payment/check-direct] [OK] Transaction ${txid} confirmee et creditee (${userEmail})`);
        }

        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        logger.error(`[payment/check-direct] Erreur mise a jour: ${e.message}`);
        return res.json({ status: 'pending', source: 'db_error', error: e.message });
      } finally {
        client.release();
      }

      return res.json({ status: 'paid', source: 'cinetpay_direct' });
    }

    return res.json({ status: 'pending', source: 'cinetpay', cinetpay_status: rawStatus });
  } catch (e) {
    logger.error('[payment/check-direct]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===================================================================
// POST /payment/notify - Webhook CinetPay
// ===================================================================
const CINETPAY_WEBHOOK_IPS = (process.env.CINETPAY_WEBHOOK_IPS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const NOTIFY_RATE_MAX = Number(process.env.NOTIFY_RATE_MAX || 200);
const notifyAttempts = new Map();

function checkNotifyRateLimit(ip) {
  const now = Date.now();
  const entry = notifyAttempts.get(ip) || { count: 0, resetAt: now + 3600_000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 3600_000; }
  entry.count++;
  notifyAttempts.set(ip, entry);
  if (notifyAttempts.size > 1000) {
    for (const [k, v] of notifyAttempts) if (now > v.resetAt) notifyAttempts.delete(k);
  }
  return entry.count <= NOTIFY_RATE_MAX;
}

router.post('/payment/notify', async (req, res) => {
  const start = Date.now();
  const ip = req.ip;

  if (!checkNotifyRateLimit(ip)) {
    logger.warn(`[CinetPay Notify] Rate limit IP=${ip}`);
    return res.status(429).send('RATE_LIMIT');
  }
  if (CINETPAY_WEBHOOK_IPS.length > 0 && !CINETPAY_WEBHOOK_IPS.includes(ip)) {
    logger.warn(`[CinetPay Notify] IP non autorisee : ${ip}`);
    return res.status(403).send('FORBIDDEN');
  }

  const client = await pool.connect();
  let transactionId = null;
  let status = 'received';

  try {
    const data = req.body || {};
    const cinetpayTxId = data.cpm_trans_id || data.transaction_id;
    if (!cinetpayTxId) return res.status(400).send('BAD_REQUEST');
    transactionId = cinetpayTxId;
    logger.info(`[CinetPay Notify] Recu tx=${cinetpayTxId} IP=${ip}`);

    const r = await apiCallWithToken(`${CINETPAY_API}/v1/payment/${cinetpayTxId}`, { method: 'GET' });
    if (r.status >= 400) {
      logger.warn(`[CinetPay Notify] HTTP ${r.status} tx=${cinetpayTxId}`);
      return res.status(400).send('BAD_REQUEST');
    }

    const txData = r.data?.data || r.data;
    if (!txData?.merchant_transaction_id) {
      logger.warn(`[CinetPay Notify] merchant_tx_id introuvable tx=${cinetpayTxId}`);
      return res.status(400).send('BAD_REQUEST');
    }

    const merchantTxId = txData.merchant_transaction_id;
    const rawStatus = String(txData.status || '').toUpperCase();
    if (!['ACCEPTED', '00', 'SUCCESS', 'OK', 'PAID'].includes(rawStatus)) {
      logger.info(`[CinetPay Notify] Statut non valide (${rawStatus}) tx=${merchantTxId}`);
      return res.status(200).send('OK');
    }

    const isSubscription = merchantTxId.startsWith('SUB');
    await client.query('BEGIN');

    const tx = await client.query(
      `SELECT user_email, montant_eur, note FROM transactions
       WHERE ref_id = $1 AND note LIKE 'PENDING:%' FOR UPDATE`,
      [merchantTxId]);

    if (!tx.rows.length) {
      await client.query('ROLLBACK');
      logger.info(`[CinetPay Notify] Deja traite : ${merchantTxId}`);
      return res.status(200).send('ALREADY_PROCESSED');
    }

    const row = tx.rows[0];
    const userEmail = row.user_email;
    const montantAttenduXAF = Number(row.montant_eur);
    const montantWebhook = Number(data.cpm_amount || txData.amount || 0);

    let montantPayeXAF = montantAttenduXAF;
    if (montantWebhook > 0) {
      if (Math.abs(montantWebhook - montantAttenduXAF) > 1) {
        logger.error(
          `[CinetPay Notify] [FRAUDE] webhook=${montantWebhook} base=${montantAttenduXAF} tx=${merchantTxId}`);
        await client.query('ROLLBACK');
        return res.status(400).send('AMOUNT_MISMATCH');
      }
      montantPayeXAF = montantWebhook;
    }

    const noteMatch = row.note.match(/^PENDING:[\d.]+\|([^|]+)\|/);
    const methode = noteMatch ? noteMatch[1] : 'mobile_money';
    let noteFinale = '';

    if (isSubscription) {
      const planCode = methode.toLowerCase();
      await client.query(
        `UPDATE users SET category = $1 WHERE email = $2`, [planCode, userEmail]);
      await client.query(
        `INSERT INTO user_upgrades(user_email, from_cat, to_cat, prix, duree_jours, expire_at)
         VALUES ($1, 'free', $2, $3, 30, NOW() + INTERVAL '30 days')`,
        [userEmail, planCode, montantPayeXAF]);
      noteFinale = `SUCCESS:Abonnement ${planCode} (${montantPayeXAF} XAF)`;
    } else {
      const u = await client.query(
        `SELECT category, balance FROM users WHERE email = $1 FOR UPDATE`,
        [userEmail]);
      const category = u.rows[0]?.category || 'free';
      const ancienSolde = Number(u.rows[0]?.balance || 0);
      const frais = montantPayeXAF * (PAYMENT_METHODS[methode]?.fee || 0.025);
      const bonus = (montantPayeXAF - frais) * (CATEGORY_BONUS[category] || 0);
      const totalCredite = (montantPayeXAF - frais) + bonus;

      await client.query(
        `UPDATE users SET balance = $1 WHERE email = $2`,
        [ancienSolde + totalCredite, userEmail]);
      noteFinale = `SUCCESS:Depot ${montantPayeXAF} XAF - credite:${totalCredite.toFixed(2)} XAF`;

      const threshold = await getPaymentThreshold();
      if (montantPayeXAF >= threshold) {
        await client.query(
          `INSERT INTO security_log(user_email, event, severity, details)
           VALUES ($1, 'payment_threshold_reached', 'critical', $2)`,
          [userEmail, JSON.stringify({ montant: montantPayeXAF, threshold, txid: merchantTxId })]);
      }
    }

    await client.query(
      `UPDATE transactions SET note = $1 WHERE ref_id = $2`,
      [noteFinale, merchantTxId]);
    await client.query('COMMIT');
    status = 'success';

    logger.info(`[CinetPay Notify] [OK] ${Date.now() - start}ms tx=${merchantTxId} user=${userEmail}`);
    return res.status(200).send('OK');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logger.error(`[CinetPay Notify] [ERR] tx=${transactionId} : ${e.message}`);
    return res.status(500).send('ERROR');
  } finally {
    client.release();
    logger.info(
      `[CinetPay Notify Audit] ip=${ip} tx=${transactionId || '?'} status=${status} dur=${Date.now() - start}ms`);
  }
});

module.exports = router;