// C:\Me\AppMoney\MeParisPortifs\maintenance.js
// ═══════════════════════════════════════════════════════════════════
// Tâches de maintenance périodique
//   • #11 : purge ia_conversations (30 jours)
//   • purge sessions expirées
//   • purge login_attempts (> 30 jours)
// ═══════════════════════════════════════════════════════════════════

const { pool } = require('./db');
const logger = require('./logger');

/**
 * Purge les conversations IA de plus de 30 jours.
 */
async function purgeIaConversations(days = 30) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ia_conversations
        WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [days]
    );

    if (rowCount > 0) {
      logger.info(`[Maintenance] ${rowCount} conversation(s) IA purgée(s) (> ${days} jours)`);
    }
    return rowCount;
  } catch (e) {
    logger.error('[Maintenance] Erreur purge ia_conversations:', e.message);
    return 0;
  }
}

/**
 * Purge les sessions expirées.
 */
async function purgeExpiredSessions() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM sessions WHERE expires_at < NOW()`
    );
    if (rowCount > 0) {
      logger.info(`[Maintenance] ${rowCount} session(s) expirée(s) purgée(s)`);
    }
    return rowCount;
  } catch (e) {
    logger.error('[Maintenance] Erreur purge sessions:', e.message);
    return 0;
  }
}

/**
 * Purge les tentatives de login de plus de 30 jours.
 */
async function purgeLoginAttempts(days = 30) {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM login_attempts
        WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [days]
    );
    if (rowCount > 0) {
      logger.info(`[Maintenance] ${rowCount} tentative(s) login purgée(s)`);
    }
    return rowCount;
  } catch (e) {
    logger.error('[Maintenance] Erreur purge login_attempts:', e.message);
    return 0;
  }
}

/**
 * Cycle complet de maintenance.
 */
async function runMaintenance() {
  logger.info('[Maintenance] ▶️ Démarrage du cycle...');
  const start = Date.now();

  const ia = await purgeIaConversations(30);
  const sess = await purgeExpiredSessions();
  const login = await purgeLoginAttempts(30);

  const duration = Date.now() - start;
  logger.info(`[Maintenance] ✅ Terminé : ia=${ia}, sessions=${sess}, login=${login} (${duration}ms)`);
}

/**
 * Lance le cron (1× par jour, à 3h du matin).
 */
function startMaintenanceCron() {
  const DAILY_INTERVAL = 24 * 60 * 60 * 1000; // 24h

  logger.info('[Maintenance] Cron démarré (toutes les 24h)');

  // Premier lancement après 1 min (pour laisser le serveur démarrer)
  setTimeout(runMaintenance, 60 * 1000);

  // Puis toutes les 24h
  setInterval(runMaintenance, DAILY_INTERVAL);
}

module.exports = {
  runMaintenance,
  startMaintenanceCron,
  purgeIaConversations,
  purgeExpiredSessions,
  purgeLoginAttempts
};