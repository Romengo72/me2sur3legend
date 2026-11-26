// C:\Me\AppMoney\MeParisPortifs\logger.js
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

const APP_LOG = path.join(LOG_DIR, 'app.log');

/* Rotation simple : si > 10 Mo, on renomme en .1 */
function rotateIfNeeded() {
  try {
    if (fs.existsSync(APP_LOG)) {
      const stats = fs.statSync(APP_LOG);
      if (stats.size > 10 * 1024 * 1024) {
        const backup = APP_LOG + '.1';
        if (fs.existsSync(backup)) fs.unlinkSync(backup);
        fs.renameSync(APP_LOG, backup);
      }
    }
  } catch (_) {}
}

function log(level, ...args) {
  const ts = new Date().toISOString();
  const message = args.map(a => {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }
    return String(a);
  }).join(' ');

  const line = `[${ts}] [${level}] ${message}`;

  /* Écriture SYNCHRONE garantie sur disque (NSSM-safe) */
  rotateIfNeeded();
  try { fs.appendFileSync(APP_LOG, line + '\n'); } catch (_) {}

  /* Aussi sur console (utile en dev) */
  if (level === 'ERROR') console.error(line);
  else console.log(line);
}

module.exports = {
  info:  (...a) => log('INFO',  ...a),
  warn:  (...a) => log('WARN',  ...a),
  error: (...a) => log('ERROR', ...a),
  debug: (...a) => log('DEBUG', ...a),
  logPath: APP_LOG
};