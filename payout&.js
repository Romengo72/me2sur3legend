// C:\Me\AppMoney\MeParisPortifs\payout.js
// v1.0 — Envoi automatique de fonds vers Mobile Money (CinetPay Payout)
const https = require('https');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const logger = require('./logger');

const CINETPAY_MODE = (process.env.CINETPAY_MODE || 'sandbox').toLowerCase();
const CINETPAY_API = CINETPAY_MODE === 'production'
  ? 'https://api.cinetpay.co'
  : 'https://api.cinetpay.net';

let cachedToken = null;
let tokenExpiry = 0;

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
        'User-Agent': 'Me2-3Legend/6.2.9',
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

async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  let r = await httpsRequest(`${CINETPAY_API}/v1/oauth/login`, {
    method: 'POST',
    body: { api_key: process.env.CINETPAY_API_KEY, api_password: process.env.CINETPAY_API_PASSWORD }
  });

  if (r.status >= 400) {
    r = await httpsRequest(`${CINETPAY_API}/v1/oauth/login`, {
      method: 'POST',
      body: { apikey: process.env.CINETPAY_API_KEY, apipassword: process.env.CINETPAY_API_PASSWORD }
    });
  }

  const token = r.data?.access_token || r.data?.data?.access_token || r.data?.data?.token;
  if (!token) throw new Error("Impossible d'obtenir le token CinetPay Payout");

  cachedToken = token;
  const expiresIn = r.data?.expires_in || r.data?.data?.expires_in || 3600;
  tokenExpiry = Date.now() + (expiresIn * 1000) - 60000;
  return cachedToken;
}

async function sendPayout(userEmail, amount, devise, transactionId, phone) {
  try {
    const token = await getAuthToken();
    const prefix = process.env.CINETPAY_PAYOUT_PREFIX || '237';

    // Nettoyage du numéro (on garde les chiffres, on retire le 237 s'il est présent)
    const cleanPhone = String(phone || '').replace(/\D/g, '').replace(/^237/, '');

    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error(`Numéro de téléphone invalide : ${phone}`);
    }

    const payload = {
      currency: devise || 'XAF',
      merchant_transaction_id: transactionId,
      amount: Math.round(Number(amount)),
      prefix: prefix,
      phone: cleanPhone,
      payment_method: 'MOBILE_MONEY',
      client_email: userEmail,
      notify_url: `${process.env.APP_URL || 'https://me2sur3legend.onrender.com'}/api/payment/notify-payout`
    };

    logger.info(`[Payout] Envoi de ${amount} ${devise} à ${prefix}${cleanPhone} (tx: ${transactionId})`);

    const r = await httpsRequest(`${CINETPAY_API}/v1/transfer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: payload
    });

    if (r.status >= 400) {
      throw new Error(r.data?.description || r.data?.message || 'Erreur API CinetPay Payout');
    }

    logger.info(`[Payout] ✅ Succès pour ${transactionId}`);
    return { ok: true, data: r.data };
  } catch (e) {
    logger.error(`[Payout] ❌ Échec pour ${transactionId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendPayout };