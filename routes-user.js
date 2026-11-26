// C:\Me\AppMoney\MeParisPortifs\routes-user.js
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, getEffectivePermissions, PERMISSION_GROUPS } = require('./utils');

const router = express.Router();

const CATEGORIES = {
  free: {
    label: 'Simple',
    icon: '\uD83D\uDC64', // 👤
    color: '#94a3b8',
    prix: 0,
    duree: null,
    description: 'Liste des matchs, chat IA, bonus de bienvenue et parrainage.'
  },
  premium: {
    label: 'Premium',
    icon: '\u2B50', // ⭐
    color: '#7c3aed',
    prix: 5000,
    duree: 30,
    description: 'Toutes les fonctions Simple + priorite + reductions.'
  },
  vip: {
    label: 'VIP',
    icon: '\uD83D\uDC51', // 👑
    color: '#f59e0b',
    prix: 15000,
    duree: 30,
    description: 'Predictions IA + matchs externes + support prioritaire.'
  },
  legendaire: {
    label: 'L\u00E9gendaire', // Légendaire
    icon: '\uD83D\uDC8E', // 💎
    color: '#22d3ee',
    prix: 25000,
    duree: 30,
    description: 'Toutes les fonctions VIP + validation automatique IA + support dedie.'
  }
};

const LEVEL = { free: 0, premium: 1, vip: 2, legendaire: 3 };

router.get('/user/profile', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT email, user_id, category, balance, devise, full_name, country,
              phone, referral_code, referred_by, welcome_bonus, language,
              created_at, joined_at, role
         FROM users WHERE email = $1`,
      [req.user.email]);

    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const u = rows[0];

    const bonuses = await pool.query(
      `SELECT type, montant, note, created_at FROM user_bonuses WHERE user_email = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.user.email]);

    const upgrades = await pool.query(
      `SELECT from_cat, to_cat, prix, expire_at, created_at FROM user_upgrades WHERE user_email = $1 ORDER BY created_at DESC LIMIT 10`,
      [req.user.email]);

    const refCount = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE referred_by = $1`,
      [u.referral_code]);

    const permissions = await getEffectivePermissions({
      email: u.email,
      role: u.role,
      category: u.category
    });

    res.json({
      ...u,
      categoryLabel: CATEGORIES[u.category]?.label || u.category,
      bonuses: bonuses.rows,
      upgrades: upgrades.rows,
      referralCount: refCount.rows[0].n,
      permissions
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/user/categories', authenticateToken, (_req, res) => {
  res.json(CATEGORIES);
});

router.get('/user/permissions', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT category, role FROM users WHERE email = $1`, [req.user.email]);
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const perms = await getEffectivePermissions({
      email: req.user.email,
      role: rows[0].role,
      category: rows[0].category
    });

    res.json({
      permissions: perms,
      group: PERMISSION_GROUPS[rows[0].category] || PERMISSION_GROUPS.free
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/user/language', authenticateToken, async (req, res) => {
  try {
    const { language } = req.body || {};
    const lang = String(language || '').toLowerCase();
    if (!['fr', 'en', 'ru', 'zh'].includes(lang)) {
      return res.status(400).json({ error: 'Langue invalide. Valeurs acceptees : fr, en, ru, zh.', supported: ['fr', 'en', 'ru', 'zh'] });
    }

    await pool.query(`UPDATE users SET language = $1, updated_at = NOW() WHERE email = $2`, [lang, req.user.email]);
    await pool.query(
      `INSERT INTO preferences(user_email, language) VALUES ($1, $2) ON CONFLICT (user_email) DO UPDATE SET language = EXCLUDED.language`,
      [req.user.email, lang]);

    res.json({ ok: true, language: lang });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/user/upgrade', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { category } = req.body || {};

    if (!['premium', 'vip', 'legendaire'].includes(category)) {
      return res.status(400).json({ error: 'Categorie invalide.' });
    }

    const info = CATEGORIES[category];
    if (!info) return res.status(400).json({ error: 'Categorie inconnue.' });

    await client.query('BEGIN');
    const u = await client.query(`SELECT balance, category FROM users WHERE email = $1 FOR UPDATE`, [req.user.email]);

    if (!u.rows.length) throw new Error('Utilisateur introuvable');

    const balance = Number(u.rows[0].balance);
    const currentCat = u.rows[0].category;

    if (currentCat === category) throw new Error(`Vous etes deja membre ${info.label}.`);
    if ((LEVEL[currentCat] || 0) > (LEVEL[category] || 0)) throw new Error('Retrogradation non autorisee.');
    if (balance < info.prix) throw new Error(`Solde insuffisant : ${info.prix.toLocaleString('fr-FR')} XAF requis.`);

    await client.query(
      `UPDATE users SET balance = balance - $1, category = $2, updated_at = NOW() WHERE email = $3`,
      [info.prix, category, req.user.email]);

    await client.query(
      `INSERT INTO user_upgrades(user_email, from_cat, to_cat, prix, duree_jours, expire_at) VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $5::int))`,
      [req.user.email, currentCat, category, info.prix, info.duree]);

    await client.query(
      `INSERT INTO transactions(user_email, type, montant_eur, note) VALUES ($1, 'subscription', $2, $3)`,
      [req.user.email, -info.prix, `Upgrade vers ${info.label}`]);

    await client.query('COMMIT');

    const fresh = await pool.query(`SELECT email, category, balance, devise FROM users WHERE email = $1`, [req.user.email]);

    res.json({
      ok: true,
      category,
      label: info.label,
      newBalance: balance - info.prix,
      user: fresh.rows[0]
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

// Route pour demander la suppression du compte
router.post('/user/request-deletion', authenticateToken, async (req, res) => {
  try {
    // Vérifier si une demande n'est pas déjà en cours
    const existing = await pool.query(
      `SELECT 1 FROM deletion_requests WHERE user_email = $1 AND statut = 'pending'`,
      [req.user.email]
    );
    
    if (existing.rows.length) {
      return res.status(400).json({ error: 'Vous avez deja une demande en cours.' });
    }

    await pool.query(
      `INSERT INTO deletion_requests(user_email, statut) VALUES ($1, 'pending')`,
      [req.user.email]
    );
    res.json({ ok: true, message: 'Votre demande de suppression a ete transmise a l\'administrateur.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;