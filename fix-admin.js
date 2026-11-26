// C:\Me\AppMoney\MeParisPortifs\fix-admin.js
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./db');

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026!';

async function fixAdmin() {
  try {
    console.log("⏳ Génération du hash bcrypt pour le mot de passe :", DEFAULT_ADMIN_PASSWORD);
    const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    // Vérification de cohérence
    const verify = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, hash);
    if (!verify) throw new Error("Le hash généré ne correspond pas !");
    console.log("✅ Hash vérifié avec succès.");

    console.log("⏳ Mise à jour de la base de données Neon...");
    await pool.query(`
      INSERT INTO users (email, password, role, balance, full_name, devise, category, user_id)
      VALUES ('admin@me23legend.app', $1, 'admin', 0, 'Super Admin', 'XAF', 'legendaire', 'M3L-000000')
      ON CONFLICT (email) DO UPDATE
        SET password = EXCLUDED.password,
            role = 'admin',
            category = 'legendaire'
    `, [hash]);

    // Vérification finale en base
    const check = await pool.query(`SELECT password FROM users WHERE email = 'admin@me23legend.app'`);
    const ok = await bcrypt.compare(DEFAULT_ADMIN_PASSWORD, check.rows[0].password);
    if (!ok) throw new Error("Échec de la vérification en base.");

    console.log("✅ SUCCÈS : Le compte admin a été réparé !");
    console.log("📧 Email        : admin@me23legend.app");
    console.log("🔑 Mot de passe :", DEFAULT_ADMIN_PASSWORD);

    process.exit(0);
  } catch (err) {
    console.error("❌ ERREUR :", err.message);
    process.exit(1);
  }
}

fixAdmin();