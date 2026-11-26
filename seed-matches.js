// C:\Me\AppMoney\MeParisPortifs\seed-matches.js
const { pool } = require('./db');

async function seed() {
  console.log("⏳ Injection de matchs de test...");
  
  const matchs = [
    { id: 'test_1', sport: 'Soccer', league: 'Ligue 1', pays: 'France', e1: 'PSG', e2: 'OM', c1: 1.85, cN: 3.40, c2: 4.20 },
    { id: 'test_2', sport: 'Soccer', league: 'Premier League', pays: 'Angleterre', e1: 'Man City', e2: 'Arsenal', c1: 1.75, cN: 3.60, c2: 4.80 },
    { id: 'test_3', sport: 'Soccer', league: 'La Liga', pays: 'Espagne', e1: 'Real Madrid', e2: 'Barcelone', c1: 2.00, cN: 3.50, c2: 3.40 },
    { id: 'test_4', sport: 'Basketball', league: 'NBA', pays: 'USA', e1: 'Lakers', e2: 'Warriors', c1: 1.95, cN: 100.00, c2: 1.90 },
    { id: 'test_5', sport: 'Tennis', league: 'ATP Masters', pays: 'Monaco', e1: 'Djokovic', e2: 'Alcaraz', c1: 2.10, cN: 100.00, c2: 1.75 }
  ];

  try {
    for (const m of matchs) {
      const date = new Date();
      date.setHours(date.getHours() + Math.floor(Math.random() * 48) + 2); // Entre demain et après-demain

      await pool.query(`
        INSERT INTO matches_cache (external_id, sport, league, pays, equipe1, equipe2, cote_w1, cote_x, cote_w2, commence_at, termine)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
        ON CONFLICT (external_id) DO NOTHING
      `, [m.id, m.sport, m.league, m.pays, m.e1, m.e2, m.c1, m.cN, m.c2, date]);
    }
    console.log("✅ 5 matchs de test ajoutés avec succès !");
  } catch (e) {
    console.error("❌ Erreur :", e.message);
  } finally {
    process.exit(0);
  }
}

seed();