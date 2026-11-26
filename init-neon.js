const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client } = require('pg');

async function runInit() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✅ Connecté à Neon');

    // ⭐ Chemin corrigé vers le dossier migrations
    const initSqlPath = path.join(__dirname, 'migrations', 'production-init.sql');
    const migSqlPath = path.join(__dirname, 'migrations', 'migration-v6.2.0.sql');

    if (fs.existsSync(initSqlPath)) {
      console.log('⏳ Exécution de production-init.sql...');
      const initSql = fs.readFileSync(initSqlPath, 'utf8');
      await client.query(initSql);
      console.log('✅ production-init.sql exécuté avec succès.');
    } else {
      console.error('❌ Fichier introuvable :', initSqlPath);
    }

    if (fs.existsSync(migSqlPath)) {
      console.log('⏳ Exécution de migration-v6.2.0.sql...');
      const migSql = fs.readFileSync(migSqlPath, 'utf8');
      await client.query(migSql);
      console.log('✅ migration-v6.2.0.sql exécuté avec succès.');
    } else {
      console.log('⚠️ Fichier migration-v6.2.0.sql non trouvé, on passe.');
    }

    console.log('🎉 Initialisation terminée ! La base de données Neon est prête.');
  } catch (err) {
    console.error('❌ Erreur lors de l\'initialisation :', err.message);
  } finally {
    await client.end();
  }
}

runInit();