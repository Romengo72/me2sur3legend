// C:\Me\AppMoney\MeParisPortifs\routes-ia-generator.js
// ═══════════════════════════════════════════════════════════════════
// v6.1.0 — Intégration suspension IA (contrôle à chaque génération)
// ═══════════════════════════════════════════════════════════════════
const express = require('express');
const { pool } = require('./db');
const { authenticateToken, requireAdmin, requireCategory, logSecurity } = require('./utils');
const logger = require('./logger');

const router = express.Router();

let callAI = null;
let safeParseJson = null;
let checkAndCreateSuspension = null;

try {
  const iaModule = require('./routes-ia');
  callAI = iaModule.callAI;
  safeParseJson = iaModule.safeParseJson;
  checkAndCreateSuspension = iaModule.checkAndCreateSuspension;
  logger.info('[ia-generator] Module routes-ia chargé.');
} catch (e) {
  logger.error('[ia-generator] routes-ia non chargé :', e.message);
}

const isDev = () => process.env.NODE_ENV !== 'production';

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /admin/ia-odds/pending                                        */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/admin/ia-odds/pending', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const { rows } = await pool.query(
      `SELECT id, external_id, equipe1, equipe2, league, pays, sport,
              cote_w1, cote_x, cote_w2, commence_at,
              ia_generated, ia_cote_w1, ia_cote_x, ia_cote_w2, ia_raison
         FROM matches_cache
        WHERE (source = 'theodds' OR source IS NULL) AND ia_generated = FALSE
        ORDER BY commence_at ASC NULLS LAST LIMIT $1`,
      [Number(limit)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/admin/ia-odds/list', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const { rows } = await pool.query(
      `SELECT id, equipe1, equipe2, league, pays,
              cote_w1, cote_x, cote_w2,
              ia_cote_w1, ia_cote_x, ia_cote_w2,
              ia_raison, ia_confidence, ia_provider, ia_generated_at,
              commence_at, termine, resultat
         FROM matches_cache
        WHERE ia_generated = TRUE
        ORDER BY ia_generated_at DESC NULLS LAST LIMIT $1`,
      [Number(limit)]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* POST /admin/ia-odds/generate                                      */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/admin/ia-odds/generate', authenticateToken, requireAdmin, async (req, res) => {
  const start = Date.now();
  if (isDev()) logger.info('[ia-odds/generate] Début requête');

  try {
    const { match_ids = [], notes = '' } = req.body || {};

    if (!Array.isArray(match_ids) || !match_ids.length) {
      return res.status(400).json({ error: 'match_ids requis (au moins 1)' });
    }
    if (match_ids.length > 10) {
      return res.status(400).json({ error: 'Maximum 10 matchs par appel' });
    }
    if (!callAI || !safeParseJson) {
      throw new Error('Service IA indisponible (routes-ia non chargé)');
    }

    const { rows: matchs } = await pool.query(
      `SELECT id, equipe1, equipe2, league, pays, sport,
              cote_w1, cote_x, cote_w2, commence_at
         FROM matches_cache WHERE id = ANY($1::bigint[])`,
      [match_ids]);

    if (!matchs.length) return res.status(404).json({ error: 'Aucun match trouvé' });

    const seuilRow = await pool.query(
      `SELECT value FROM constantes WHERE key = 'MARGE_MIN_IA'`);
    const MARGE_MIN = Number(seuilRow.rows[0]?.value ?? 0.02);

    const results = [];

    for (const m of matchs) {
      if (isDev()) logger.info(`[ia-odds] Match ${m.id}: ${m.equipe1} vs ${m.equipe2}`);

      try {
        const prompt = `Tu es un analyste sportif professionnel.

MATCH : ${m.equipe1} vs ${m.equipe2}
Compétition : ${m.league || 'Championnat'} (${m.pays || 'International'})
Cotes marché : W1=${m.cote_w1} · X=${m.cote_x} · W2=${m.cote_w2}
${notes ? `Consignes : ${notes}` : ''}

MISSION : Génère 3 cotes pour la stratégie « 2 gagnants sur 3 ».

CONTRAINTES (aucune exception) :
1. Plus petite cote ≥ 1.60
2. Plus grande cote ≤ 20.00
3. Marge = (1/W1 + 1/X + 1/W2 - 1) ≥ 0.03

Exemples VALIDES :
- 2.00 / 3.40 / 3.60 → marge = 0.072 ✅
- 1.80 / 3.60 / 4.20 → marge = 0.072 ✅

Réponds STRICTEMENT en JSON :
{
  "ia_cote_w1": 2.15,
  "ia_cote_x": 3.40,
  "ia_cote_w2": 3.50,
  "confidence": 78,
  "raison": "..."
}`;

        const r = await callAI(prompt, { temperature: 0.3, maxTokens: 500 });

        let parsed;
        try {
          parsed = safeParseJson(r.content);
        } catch (parseErr) {
          logger.warn(`[ia-odds] Parse invalide pour ${m.id}:`, parseErr.message);
          results.push({
            match_id: m.id, equipe1: m.equipe1, equipe2: m.equipe2,
            error: 'JSON IA invalide',
            raw: r.content.slice(0, 200)
          });
          continue;
        }

        let c1 = Number(parsed.ia_cote_w1);
        let cN = Number(parsed.ia_cote_x);
        let c2 = Number(parsed.ia_cote_w2);

        if (!c1 || !cN || !c2) {
          results.push({
            match_id: m.id, equipe1: m.equipe1, equipe2: m.equipe2,
            error: 'Cotes IA manquantes', suggestion: parsed
          });
          continue;
        }

        if (Math.min(c1, cN, c2) < 1.50) {
          results.push({
            match_id: m.id, equipe1: m.equipe1, equipe2: m.equipe2,
            error: `Cote minimum ${Math.min(c1, cN, c2).toFixed(2)} < 1.50`,
            suggestion: parsed
          });
          continue;
        }

        /* Ajustement mathématique par itération */
        const S = (1/c1) + (1/cN) + (1/c2);
        const k = S / (1 + MARGE_MIN);
        let c1F = Number((k * c1).toFixed(2));
        let cNF = Number((k * cN).toFixed(2));
        let c2F = Number((k * c2).toFixed(2));
        let margeAdj = (1/c1F) + (1/cNF) + (1/c2F) - 1;
        let iter = 0;

        while (margeAdj < MARGE_MIN && iter < 5) {
          const kk = (1/c1F + 1/cNF + 1/c2F) / (1 + MARGE_MIN);
          c1F = Number((c1F * kk).toFixed(2));
          cNF = Number((cNF * kk).toFixed(2));
          c2F = Number((c2F * kk).toFixed(2));
          margeAdj = (1/c1F) + (1/cNF) + (1/c2F) - 1;
          iter++;
        }

        /* Vérification post-itération */
        if (Math.min(c1F, cNF, c2F) < 1.50) {
          results.push({
            match_id: m.id, equipe1: m.equipe1, equipe2: m.equipe2,
            error: 'Ajustement a produit une cote trop basse',
            suggestion: { w1: c1F, x: cNF, w2: c2F }
          });
          continue;
        }

        const margeBrute = S - 1;

        await pool.query(
          `UPDATE matches_cache
              SET ia_cote_w1 = $1, ia_cote_x = $2, ia_cote_w2 = $3,
                  ia_raison = $4, ia_confidence = $5,
                  ia_provider = $6, ia_generated = TRUE,
                  ia_generated_at = NOW(), updated_at = NOW()
            WHERE id = $7`,
          [c1F, cNF, c2F,
           parsed.raison || '', Number(parsed.confidence) || 50,
           r.provider, m.id]);

        results.push({
          match_id: m.id, equipe1: m.equipe1, equipe2: m.equipe2,
          cotes_marche: { w1: m.cote_w1, x: m.cote_x, w2: m.cote_w2 },
          cotes_ia: { w1: c1F, x: cNF, w2: c2F },
          marge_brute: margeBrute,
          marge_finale: margeAdj,
          confidence: parsed.confidence,
          raison: parsed.raison,
          tokens: r.tokens
        });

        if (isDev()) logger.info(`[ia-odds] Match ${m.id} OK (marge ${(margeAdj*100).toFixed(2)}%)`);

      } catch (err) {
        logger.error(`[ia-odds] Match ${m.id}:`, err.message);
        results.push({
          match_id: m.id, equipe1: m.equipe1, equipe2: m.equipe2,
          error: err.message
        });
      }
    }

    const success = results.filter(r => !r.error).length;
    const duration = Date.now() - start;

    await logSecurity({
      email: req.user.email, event: 'ia_odds_generated', severity: 'info',
      ip: req.ip, userAgent: req.headers['user-agent'],
      details: { nb_matchs: matchs.length, nb_success: success }
    });

    res.json({
      ok: true, total: matchs.length, success,
      failed: results.length - success,
      duration_ms: duration, results
    });
  } catch (e) {
    logger.error('[ia-odds/generate] ERREUR:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/ia-odds/reset/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE matches_cache
          SET ia_cote_w1 = NULL, ia_cote_x = NULL, ia_cote_w2 = NULL,
              ia_raison = NULL, ia_confidence = NULL,
              ia_generated = FALSE, ia_generated_at = NULL
        WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /matches/vip-ia — matchs VIP (suspension vérifiée)           */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/matches/vip-ia', authenticateToken, requireCategory('vip'), async (req, res) => {
  try {
    /* CORRECTIF #9 : bloque si suspension active */
    const { getUserSuspension } = require('./routes-ia');
    const suspension = getUserSuspension ? await getUserSuspension(req.user.email) : null;
    if (suspension) {
      return res.status(423).json({
        error: 'Compte suspendu : gains successifs détectés.',
        code: 'IA_SUSPENDED',
        suspension: {
          total_won: Number(suspension.total_won),
          threshold: Number(suspension.threshold),
          suspended_until: suspension.suspended_until
        }
      });
    }

    const { pays = '', league = '', search = '', limit = 100 } = req.query;

    let q = `SELECT id, external_id, equipe1, equipe2, league, pays,
                    cote_w1 AS marche_w1, cote_x AS marche_x, cote_w2 AS marche_w2,
                    ia_cote_w1 AS cote_w1, ia_cote_x AS cote_x, ia_cote_w2 AS cote_w2,
                    ia_raison, ia_confidence, commence_at, termine, resultat
               FROM matches_cache WHERE ia_generated = TRUE`;
    const p = [];

    if (pays)   { p.push(pays);   q += ` AND pays = $${p.length}`; }
    if (league) { p.push(league); q += ` AND league = $${p.length}`; }
    if (search) {
      p.push(`%${search}%`);
      q += ` AND (equipe1 ILIKE $${p.length} OR equipe2 ILIKE $${p.length})`;
    }
    q += ` ORDER BY commence_at ASC NULLS LAST LIMIT $${p.length + 1}`;
    p.push(Number(limit));

    const { rows } = await pool.query(q, p);

    const fPays = await pool.query(
      `SELECT DISTINCT pays FROM matches_cache
        WHERE ia_generated = TRUE AND pays IS NOT NULL ORDER BY pays`);
    const fLeagues = await pool.query(
      `SELECT DISTINCT league FROM matches_cache
        WHERE ia_generated = TRUE AND league IS NOT NULL ORDER BY league LIMIT 50`);

    res.json({
      matches: rows, total: rows.length,
      facettes: {
        pays: fPays.rows.map(r => r.pays),
        leagues: fLeagues.rows.map(r => r.league)
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;