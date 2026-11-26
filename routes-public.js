// C:\Me\AppMoney\MeParisPortifs\routes-public.js
// ===================================================================
// v6.1.0 - Routes publiques blindees (JSON strict, erreurs catchees)
// ===================================================================
const express = require('express');
const { pool } = require('./db');
const logger = require('./logger');

const router = express.Router();

// Force JSON sur toutes les routes de ce router
router.use((_req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ===================================================================
// GET /public/stats
// ===================================================================
router.get('/public/stats', async (_req, res) => {
  try {
    const users = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'user'`);
    const subs = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE category != 'free'`);
    const saisies = await pool.query(`SELECT COUNT(*)::int AS n FROM saisies WHERE valide = TRUE`);
    const volume = await pool.query(`SELECT COALESCE(SUM(mise_totale), 0) AS t FROM saisies WHERE valide = TRUE`);
    res.json({
      users: users.rows[0].n,
      subscribers: subs.rows[0].n,
      saisies: saisies.rows[0].n,
      total_volume: Number(volume.rows[0].t)
    });
  } catch (e) {
    logger.error('[public/stats]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===================================================================
// GET /public/plans - CRITIQUE : renvoie toujours du JSON
// ===================================================================
router.get('/public/plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT code,
              nom AS name,
              description,
              prix_mensuel AS price_monthly,
              prix_annuel AS price_yearly,
              popular,
              couleur,
              ordre,
              features
         FROM plans
        ORDER BY ordre ASC NULLS LAST, prix_mensuel ASC NULLS LAST`
    );
    res.json(rows);
  } catch (e) {
    logger.error('[public/plans]', e.message);
    // Fallback : renvoie une reponse JSON valide meme si la DB echoue
    res.status(200).json([
      {
        code: 'free',
        name: 'Simple',
        description: 'Decouvrez la plateforme.',
        price_monthly: 0,
        popular: false,
        couleur: 'gris',
        ordre: 1,
        features: ['Liste des matchs', 'Chat IA', 'Bonus de bienvenue 500 XAF']
      }
    ]);
  }
});

// ===================================================================
// GET /public/faq
// ===================================================================
router.get('/public/faq', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT question, reponse FROM faq WHERE publie = TRUE ORDER BY ordre ASC`);
    res.json(rows);
  } catch (e) {
    logger.error('[public/faq]', e.message);
    res.status(200).json([]);
  }
});

// ===================================================================
// GET /public/testimonials
// ===================================================================
router.get('/public/testimonials', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT auteur, pays, note, contenu FROM testimonials WHERE publie = TRUE ORDER BY id DESC`);
    res.json(rows);
  } catch (e) {
    logger.error('[public/testimonials]', e.message);
    res.status(200).json([]);
  }
});

// ===================================================================
// GET /public/news
// ===================================================================
router.get('/public/news', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT titre AS title, contenu AS excerpt, date AS published_at
         FROM news WHERE publie = TRUE ORDER BY date DESC LIMIT 6`);
    res.json(rows);
  } catch (e) {
    logger.error('[public/news]', e.message);
    res.status(200).json([]);
  }
});

// ===================================================================
// GET /public/leaderboard
// ===================================================================
router.get('/public/leaderboard', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, balance FROM users
        WHERE role = 'user' AND balance > 0
        ORDER BY balance DESC LIMIT 10`);
        
    const out = rows.map((r, i) => {
      // Anonymisation stricte : "j***n@***.com"
      const parts = r.email.split('@');
      const local = parts[0];
      const domain = parts[1] || '***';
      
      const maskedLocal = local.length > 2 
        ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1] 
        : local[0] + '*';
        
      const maskedDomain = domain.substring(0, 1) + '***.' + (domain.split('.').pop() || 'com');

      return {
        rank: i + 1,
        email: `${maskedLocal}@${maskedDomain}`,
        balance: Number(r.balance)
      };
    });
    res.json(out);
  } catch (e) {
    logger.error('[public/leaderboard]', e.message);
    res.status(200).json([]);
  }
});

// ===================================================================
// GET /public/ads
// ===================================================================
router.get('/public/ads', async (req, res) => {
  try {
    const slot = String(req.query.slot || 'header_banner');
    const { rows } = await pool.query(
      `SELECT titre AS title, contenu AS description, image_url,
              target_url, cta_text, bg_color, text_color
         FROM ads
        WHERE actif = TRUE
          AND (slot = $1 OR slot IS NULL)
          AND (date_fin IS NULL OR date_fin > NOW())
        ORDER BY id DESC LIMIT 1`,
      [slot]);
    if (!rows.length) return res.json({});
    res.json(rows[0]);
  } catch (e) {
    logger.error('[public/ads]', e.message);
    res.json({});
  }
});

// ===================================================================
// POST /public/contact
// ===================================================================
router.post('/public/contact', async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Champs requis' });
    }
    await pool.query(
      `INSERT INTO contact_messages(nom, email, sujet, message)
       VALUES ($1, $2, $3, $4)`,
      [name, email, subject || '', message]
    );
    res.json({ ok: true, message: 'Message envoye avec succes.' });
  } catch (e) {
    logger.error('[public/contact]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;