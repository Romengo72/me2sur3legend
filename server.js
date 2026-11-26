// C:\Me\AppMoney\MeParisPortifs\server.js
// v6.3.0 — Port ouvert AVANT initDb (compatibilité Render)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const compression = require('compression');
const fs = require('fs');

const { syncFromSportradar } = require('./matches-sync-sportradar');
const { initDb, pool } = require('./db');
const templates = require('./templates');
const { syncScoresAndValidate } = require('./scores-sync');
const { syncUpcomingMatches } = require('./matches-sync');
const { startAutoSettlementCron } = require('./auto-settlement');
const logger = require('./logger');
const { startMaintenanceCron } = require('./maintenance');

/* Google Translate (optionnel) */
let Translate;
try {
  const translateModule = require('@google-cloud/translate');
  Translate = translateModule.v2.Translate;
  logger.info('[Translate] Module chargé.');
} catch (e) {
  logger.warn('⚠️ Module @google-cloud/translate non installé :', e.message);
  Translate = null;
}

const app = express();
const APP_VERSION = process.env.APP_VERSION || '6.3.0';
const PORT = Number(process.env.PORT || 3000);

const SCORES_SYNC_INTERVAL = 30 * 60 * 1000;
const MATCHES_SYNC_INTERVAL = 2 * 60 * 60 * 1000;

/* ═══════════════════════════════════════════════════════════════════ */
/* MIDDLEWARES                                                       */
/* ═══════════════════════════════════════════════════════════════════ */
if (process.env.BEHIND_PROXY === '1') {
  app.set('trust proxy', 1);
  logger.info('[Server] trust proxy activé (BEHIND_PROXY=1)');
}

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* Logging HTTP basique */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const dur = Date.now() - start;
    const lvl = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[lvl](`[HTTP] ${req.method} ${req.originalUrl} → ${res.statusCode} (${dur}ms)`);
  });
  next();
});

/* CSRF */
const { csrfProtection } = require('./utils');
app.use(csrfProtection);

/* ═══════════════════════════════════════════════════════════════════ */
/* HEALTH (indépendant de la DB — critique pour Render)              */
/* ═══════════════════════════════════════════════════════════════════ */
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', version: APP_VERSION, uptime: process.uptime() });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, version: APP_VERSION }));
app.get('/api/version', (_req, res) => res.json({ version: APP_VERSION }));

/* ═══════════════════════════════════════════════════════════════════ */
/* CONFIG JS (version injectée)                                      */
/* ═══════════════════════════════════════════════════════════════════ */
app.get('/js/config.js', (_req, res) => {
  const full = path.join(__dirname, 'js', 'config.js');
  if (!fs.existsSync(full)) return res.status(404).send('// config.js manquant');
  let content = fs.readFileSync(full, 'utf8');
  content = content.replace(/VERSION:\s*['"][^'"]*['"]/, `VERSION: '${APP_VERSION}'`);
  res.type('application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(content);
});

/* ═══════════════════════════════════════════════════════════════════ */
/* CHARGEMENT DES ROUTEURS                                           */
/* ═══════════════════════════════════════════════════════════════════ */
function loadRoute(routePath, label) {
  try { return require(routePath); }
  catch (e) {
    logger.error(`❌ Impossible de charger « ${label} » : ${e.message}`);
    return express.Router();
  }
}

const routes = {
  public:     loadRoute('./routes-public',         'routes-public'),
  auth:       loadRoute('./routes-auth',           'routes-auth'),
  security:   loadRoute('./routes-security',       'routes-security'),
  withdrawal: loadRoute('./routes-withdrawal',     'routes-withdrawal'),
  deposit:    loadRoute('./routes-deposit',        'routes-deposit'),
  payment:    loadRoute('./routes-payment',        'routes-payment'),
  core:       loadRoute('./routes-core',           'routes-core'),
  historique: loadRoute('./routes-historique',     'routes-historique'),
  matches:    loadRoute('./routes-matches',        'routes-matches'),
  ia:         loadRoute('./routes-ia',             'routes-ia'),
  iaGen:      loadRoute('./routes-ia-generator',   'routes-ia-generator'),
  user:       loadRoute('./routes-user',           'routes-user'),
  admin:      loadRoute('./routes-admin',          'routes-admin'),
  finance:    loadRoute('./routes-finance',        'routes-finance'),
  oddsGen:    loadRoute('./routes-odds-generator', 'routes-odds-generator')
};

Object.entries(routes).forEach(([key, router]) => {
  if (!router) return;
  if (key === 'admin' || key === 'finance') {
    app.use('/api/admin', router);
  } else {
    app.use('/api', router);
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* TRADUCTION (optionnel)                                            */
/* ═══════════════════════════════════════════════════════════════════ */
if (Translate) {
  const translateClient = new Translate({
    projectId: process.env.GOOGLE_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
  });

  app.post('/api/translate', async (req, res) => {
    try {
      const { text, target } = req.body;
      if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return res.status(400).json({ error: 'Texte manquant ou vide' });
      }
      if (!target || !['fr', 'en', 'ru', 'zh'].includes(target)) {
        return res.status(400).json({ error: 'Langue cible invalide' });
      }
      logger.info(`[Translate] "${text.substring(0, 30)}..." -> ${target}`);
      const [translation] = await translateClient.translate(text, target);
      res.json({ translatedText: translation });
    } catch (error) {
      logger.error(`[Translate] ❌ ${error.message}`);
      res.json({ translatedText: req.body.text });
    }
  });
  logger.info('✅ Service de traduction actif.');
} else {
  app.post('/api/translate', (req, res) => res.json({ translatedText: req.body.text }));
  logger.warn('⚠️ Service de traduction désactivé.');
}

/* ═══════════════════════════════════════════════════════════════════ */
/* FICHIERS STATIQUES                                                 */
/* ═══════════════════════════════════════════════════════════════════ */
['css', 'assets', 'uploads', 'pages'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (fs.existsSync(p)) app.use(`/${dir}`, express.static(p));
});

const jsDir = path.join(__dirname, 'js');
if (fs.existsSync(jsDir)) {
  app.use('/js', express.static(jsDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('config.js')) res.set('Cache-Control', 'no-store');
    }
  }));
}

/* ═══════════════════════════════════════════════════════════════════ */
/* PAGES HTML                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
function sendPage(file, res) {
  const full = path.join(__dirname, file);
  if (!fs.existsSync(full)) return res.status(404).send(`<h1>404 — ${file} introuvable</h1>`);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  const html = templates.renderHtml(file);
  if (!html) return res.status(500).send('Erreur de rendu');
  res.type('html').send(html);
}

app.get('/',      (_, res) => sendPage('index.html', res));
app.get('/login', (_, res) => sendPage('login.html', res));
app.get('/app',   (_, res) => sendPage('app.html',   res));
app.get('/payment-waiting',    (_, res) => sendPage('payment-waiting.html', res));
app.get('/payment-transition', (_, res) => sendPage('payment-transition.html', res));

app.get('/pages/:name', (req, res) => {
  const name = String(req.params.name).replace(/\.\./g, '').replace(/[^a-z0-9_-]/gi, '');
  const full = path.join(__dirname, 'pages', `${name}.html`);
  if (!fs.existsSync(full)) return res.status(404).send('Page introuvable');
  res.sendFile(full);
});

/* ═══════════════════════════════════════════════════════════════════ */
/* 404 API + gestion d'erreur                                       */
/* ═══════════════════════════════════════════════════════════════════ */
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route API inconnue.' });
});

app.use((err, req, res, _next) => {
  logger.error('[ERR]', err.stack || err);
  if (res.headersSent) return;
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'Erreur serveur',
    ...(isProd ? {} : { detail: err.message })
  });
});

/* ═══════════════════════════════════════════════════════════════════ */
/* DÉMARRAGE — PORT OUVERT IMMÉDIATEMENT (compatibilité Render)      */
/* ═══════════════════════════════════════════════════════════════════ */
let server;

// 1. Ouvrir le port TOUT DE SUITE
server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('═══════════════════════════════════════════');
  logger.info(`🚀 Me2/3Legend v${APP_VERSION}`);
  logger.info(`📡 Port : ${PORT}`);
  logger.info(`🎯 Sportradar : ${process.env.SPORTRADAR_API_KEY ? '✅' : '❌'}`);
  logger.info(`🎯 OddsPapi   : ${process.env.ODDSPAPI_KEY ? '✅' : '❌'}`);
  logger.info(`🎯 CinetPay   : ${process.env.CINETPAY_MODE || 'sandbox'}`);
  logger.info('═══════════════════════════════════════════');
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

// 2. Initialiser la DB en arrière-plan (ne bloque pas l'écoute)
initDb()
  .then(() => {
    logger.info('✔ Base de données initialisée.');

    // 3. Démarrer les crons SEULEMENT si la DB est prête
    if (process.env.DISABLE_CRONS !== '1') {
      safeInterval(syncScoresAndValidate, SCORES_SYNC_INTERVAL, 'scores');
      safeInterval(async () => {
        try {
          await syncUpcomingMatches();
          await syncFromSportradar();
        } catch (e) {
          logger.error('[Cron matches]', e.message);
        }
      }, MATCHES_SYNC_INTERVAL, 'matches');
      startAutoSettlementCron();
      startMaintenanceCron();

      // Premier cycle après 10s
      setTimeout(() => {
        syncScoresAndValidate().catch(e => logger.error('[Init scores]', e.message));
        syncUpcomingMatches().catch(e => logger.error('[Init matches]', e.message));
      }, 10000);
    } else {
      logger.info('[Cron] Désactivés (DISABLE_CRONS=1)');
    }
  })
  .catch(e => {
    logger.error('❌ Échec init DB (le serveur reste joignable) :', e.message);
    // ⚠️ NE PAS process.exit(1) : Render verrait un service mort
  });

/* ═══════════════════════════════════════════════════════════════════ */
/* CRON SÉCURISÉS                                                    */
/* ═══════════════════════════════════════════════════════════════════ */
function safeInterval(fn, ms, label) {
  return setInterval(async () => {
    try { await fn(); }
    catch (e) { logger.error(`[Cron ${label}]`, e.message); }
  }, ms);
}

/* ═══════════════════════════════════════════════════════════════════ */
/* ARRÊT PROPRE                                                      */
/* ═══════════════════════════════════════════════════════════════════ */
async function shutdown(signal) {
  logger.info(`[Server] ${signal} reçu, arrêt en cours...`);

  if (server) {
    server.close((err) => {
      if (err) logger.error('[Server] Erreur fermeture HTTP:', err.message);
      else logger.info('[Server] HTTP fermé.');
    });
  }

  try {
    await pool.end();
    logger.info('[Server] Pool PostgreSQL fermé.');
  } catch (e) {
    logger.error('[Server] Erreur fermeture pool:', e.message);
  }

  setTimeout(() => process.exit(0), 500);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));