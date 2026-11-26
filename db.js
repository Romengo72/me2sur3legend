// C:\Me\AppMoney\MeParisPortifs\db.js
const { Pool } = require('pg');
const path = require('path');

// ⭐ On force le chemin exact du .env (crucial pour Electron/Setup.exe)
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Petit garde-fou pour afficher une erreur claire dans les logs
if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) {
  console.error("⚠️ ATTENTION : Le fichier .env n'a pas été trouvé ou est vide. La connexion échouera.");
}

const isCloudDB = process.env.DATABASE_URL || process.env.DB_SSL === 'true' || (process.env.DB_HOST && process.env.DB_HOST !== 'localhost');

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME || 'paris_db',
      user: process.env.DB_USER || 'paris_user',
      password: process.env.DB_PASSWORD, // C'est ici que l'erreur se produisait si undefined
      ssl: isCloudDB ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

const pool = new Pool(poolConfig);

pool.on('error', err => console.error('[PG] Erreur pool:', err.message));

async function initDb() {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    console.log('✔ PostgreSQL (Neon) connecté avec succès.');
  } catch (e) {
    console.error('✖ Connexion PostgreSQL échouée :', e.message);
  }
}

module.exports = { pool, initDb };