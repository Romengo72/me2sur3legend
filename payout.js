// C:\Me\AppMoney\MeParisPortifs\payout.js
// v1.1 — Gestion du Payout Automatique via CinetPay (Render/Cloud Ready)
const https = require('https');
const dns = require('dns');
const logger = require('./logger');

// ⭐ Forcer IPv4 pour éviter les timeouts de Render vers CinetPay
dns.setDefaultResultOrder('ipv4first');

const CINETPAY_MODE = (process.env.CINETPAY_MODE || 'sandbox').toLowerCase();
const CINETPAY_API = CINETPAY_MODE === 'production'
  ? 'https://api.cinetpay.co'
  : 'https://api.cinetpay.net';

// Cache pour le token OAuth (évite de redemander un token à chaque requête)
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Effectue une requête HTTPS native (sans dépendance externe comme Axios)
 */
function httpsRequest(url, { method = 'GET', body = null, headers = {}, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      family: 4, // Force IPv4
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Me2-3Legend/6.3.0',
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
        try { 
          resolve({ status: res.statusCode, data: JSON.parse(text) }); 
        } catch (e) { 
          resolve({ status: res.statusCode, data: { raw: text } }); 
        }
      });
    });

    req.on('timeout', () => { 
      req.destroy(); 
      reject(new Error('Timeout lors de la requête vers CinetPay')); 
    });
    
    req.on('error', (err) => reject(err));
    
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Récupère un token d'authentification CinetPay (OAuth)
 * Gère le cache pour ne pas spammer l'API
 */
async function getAuthToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  // Tentative avec les clés standard (v1)
  let r = await httpsRequest(`${CINETPAY_API}/v1/oauth/login`, {
    method: 'POST',
    body: { 
      api_key: process.env.CINETPAY_API_KEY, 
      api_password: process.env.CINETPAY_API_PASSWORD 
    }
  });

  // Fallback pour les anciens comptes (au cas où)
  if (r.status >= 400) {
    r = await httpsRequest(`${CINETPAY_API}/v1/oauth/login`, {
      method: 'POST',
      body: { 
        apikey: process.env.CINETPAY_API_KEY, 
        apipassword: process.env.CINETPAY_API_PASSWORD 
      }
    });
  }

  const token = r.data?.access_token || r.data?.data?.access_token || r.data?.data?.token;
  if (!token) {
    const errorMsg = r.data?.description || r.data?.message || JSON.stringify(r.data);
    throw new Error(`Impossible d'obtenir le token CinetPay Payout : ${errorMsg}`);
  }

  cachedToken = token;
  const expiresIn = r.data?.expires_in || r.data?.data?.expires_in || 3600;
  tokenExpiry = Date.now() + (expiresIn * 1000) - 60000; // Expire 1 min avant
  
  return cachedToken;
}

/**
 * Envoie l'argent sur le Mobile Money du joueur via CinetPay
 * 
 * @param {string} userEmail - Email du joueur
 * @param {number} amount - Montant net à recevoir
 * @param {string} devise - Devise (XAF)
 * @param {string} transactionId - ID unique de la transaction (ex: PAY123456)
 * @param {string} phone - Numéro de téléphone saisi par le joueur
 * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
 */
async function sendPayout(userEmail, amount, devise, transactionId, phone) {
  try {
    const token = await getAuthToken();
    const prefix = process.env.CINETPAY_PAYOUT_PREFIX || '237';
    
    // Nettoyage du numéro : on garde les chiffres et on retire le préfixe s'il est déjà présent
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.startsWith(prefix) && cleanPhone.length > 9) {
      cleanPhone = cleanPhone.substring(prefix.length);
    }
    
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error(`Numéro de téléphone invalide : ${phone}`);
    }

    const payload = {
      currency: devise || 'XAF',
      merchant_transaction_id: transactionId,
      amount: Math.round(Number(amount)),
      prefix: prefix,
      phone: cleanPhone,
      payment_method: 'MOBILE_MONEY', // CinetPay détecte MTN ou Orange avec ceci
      client_email: userEmail,
      // URL de webhook pour que CinetPay notifie le serveur une fois l'argent envoyé
      notify_url: `${process.env.APP_URL || 'https://me2sur3legend.onrender.com'}/api/payment/notify-payout`
    };

    logger.info(`[Payout] Envoi de ${amount} ${devise} à ${prefix}${cleanPhone} (tx: ${transactionId})`);

    const r = await httpsRequest(`${CINETPAY_API}/v1/transfer`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: payload
    });

    // Gestion des erreurs HTTP
    if (r.status >= 400) {
      const errorMsg = r.data?.description || r.data?.message || r.data?.error || `Erreur HTTP ${r.status}`;
      throw new Error(errorMsg);
    }

    logger.info(`[Payout] ✅ Succès pour ${transactionId}`);
    return { ok: true, data: r.data };

  } catch (e) {
    logger.error(`[Payout] ❌ Échec pour ${transactionId}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendPayout };