// C:\Me\AppMoney\MeParisPortifs\routes-ia.js
// v6.2.1 — Réécriture UTF-8 propre (correction mojibake)
//         • WIN_THRESHOLDS.legendaire en ASCII
//         • checkAndCreateSuspension exportée
//         • Messages d'erreur en français propre
//         • requireAdmin retiré (non utilisé)
const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('./db');
const { authenticateToken, requireCategory } = require('./utils');
const logger = require('./logger');

const router = express.Router();

/* ═══════════════════════════════════════════════════════════════════ */
/* Rate limits                                                       */
/* ═══════════════════════════════════════════════════════════════════ */
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.IA_CHAT_RATE_MAX || 30),
  keyGenerator: r => r.user?.email || r.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Limite atteinte (30 messages/heure). Réessayez dans une heure.' }
});

const predictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.IA_PREDICT_RATE_MAX || 100),
  keyGenerator: r => r.user?.email || r.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Limite atteinte (100 prédictions/heure).' }
});

const adminAutoValidateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.IA_ADMIN_VALIDATE_RATE_MAX || 50),
  keyGenerator: r => r.user?.email || r.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Limite atteinte (50 analyses/heure).' }
});

const adminAutoValidateBatchLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.IA_ADMIN_BATCH_RATE_MAX || 10),
  keyGenerator: r => r.user?.email || r.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Limite atteinte (10 batches/heure = 30 appels IA max).' }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Seuils de suspension IA (CORRECTIF #9)                            */
/* ═══════════════════════════════════════════════════════════════════ */
const WIN_THRESHOLDS = {
  free:        50_000,
  premium:    100_000,
  vip:        100_000,
  legendaire: 100_000
};

const SUSPENSION_DURATION_HOURS = 24 * 7;   // 7 jours

/**
 * Vérifie si un utilisateur est suspendu.
 * Retourne null si libre, ou l'objet suspension actif.
 */
async function getUserSuspension(email) {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM ia_suspensions
        WHERE user_email = $1
          AND lifted_at IS NULL
          AND (suspended_until IS NULL OR suspended_until > NOW())
        ORDER BY suspended_at DESC LIMIT 1`,
      [email]);
    return rows[0] || null;
  } catch (e) {
    logger.error('[getUserSuspension]', e.message);
    return null;
  }
}

/**
 * Vérifie si un utilisateur doit être suspendu (gains cumulés 7j).
 * Crée la suspension si nécessaire.
 * Exportée pour être appelée par auto-settlement.js après crédit.
 */
async function checkAndCreateSuspension(email, category) {
  try {
    const threshold = WIN_THRESHOLDS[category] || WIN_THRESHOLDS.free;
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(montant_eur), 0) AS total, COUNT(*)::int AS nb
         FROM transactions
        WHERE user_email = $1
          AND type = 'win'
          AND date > NOW() - INTERVAL '7 days'`,
      [email]);

    const totalGagne = Number(rows[0].total);

    if (totalGagne < threshold) {
      return { suspended: false, totalGagne, threshold };
    }

    /* Vérifie qu'il n'y a pas déjà une suspension active */
    const active = await getUserSuspension(email);
    if (active) {
      return { suspended: true, existing: active, totalGagne, threshold };
    }

    /* Crée la suspension */
    const until = new Date(Date.now() + SUSPENSION_DURATION_HOURS * 3600 * 1000);
    const { rows: susp } = await pool.query(
      `INSERT INTO ia_suspensions(
         user_email, reason, total_won, threshold,
         suspended_at, suspended_until
       ) VALUES ($1, 'successive_wins', $2, $3, NOW(), $4)
       RETURNING *`,
      [email, totalGagne, threshold, until]);

    logger.warn(
      `[IA Suspension] ${email} suspendu — ` +
      `gains 7j: ${totalGagne.toFixed(2)} XAF >= seuil ${threshold} XAF. ` +
      `Durée: 7 jours.`);

    /* Log critique */
    await pool.query(
      `INSERT INTO security_log(user_email, event, severity, details)
       VALUES ($1, 'ia_suspension_created', 'critical', $2)`,
      [email, JSON.stringify({
        total_won: totalGagne,
        threshold,
        suspended_until: until,
        category
      })]);

    return { suspended: true, created: susp[0], totalGagne, threshold };
  } catch (e) {
    logger.error('[checkAndCreateSuspension]', e.message);
    return { suspended: false, error: e.message };
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Helpers IA                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function safeParseJson(text) {
  if (!text || typeof text !== 'string') throw new Error('Réponse IA vide');
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) throw new Error('Aucun objet JSON détecté');
  cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  try { return JSON.parse(cleaned); } catch (_) {}

  let repaired = cleaned
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/'/g, '"');
  try { return JSON.parse(repaired); }
  catch (repairErr) {
    logger.error('[safeParseJson] Réparation échouée:', repairErr.message);
    throw new Error('Réponse IA invalide (JSON non parsable)');
  }
}

async function getActiveProvider() {
  const { rows } = await pool.query(
    `SELECT key, value FROM company_settings
      WHERE key IN ('active_ai_provider','openai_key','deepseek_key','anthropic_key')`);
  const cfg = {};
  rows.forEach(r => { cfg[r.key] = r.value; });

  // ⭐ FALLBACK .ENV
  const provider = cfg.active_ai_provider || process.env.ACTIVE_AI_PROVIDER || 'openai';
  const keyMap = {
    openai: cfg.openai_key || process.env.OPENAI_API_KEY,
    deepseek: cfg.deepseek_key || process.env.DEEPSEEK_API_KEY,
    anthropic: cfg.anthropic_key || process.env.ANTHROPIC_API_KEY
  };
  return { provider, apiKey: keyMap[provider] };
}

async function callAI(prompt, opts = {}) {
  const { provider, apiKey } = await getActiveProvider();
  if (!apiKey || !apiKey.trim()) {
    throw new Error(`Clé API pour « ${provider} » non configurée.`);
  }

  const temperature = opts.temperature ?? 0.4;
  const maxTokens = opts.maxTokens ?? 800;

  if (provider === 'openai' || provider === 'deepseek') {
    const url = provider === 'openai'
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://api.deepseek.com/v1/chat/completions';
    const model = provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';

    const r = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature, max_tokens: maxTokens
      })
    }, 25000);

    if (!r.ok) {
      const raw = await r.text();
      throw new Error(`${provider} a renvoyé une erreur : ${raw.slice(0, 100)}`);
    }
    const data = await r.json();
    return {
      content: data.choices?.[0]?.message?.content?.trim() || '',
      tokens: data.usage?.total_tokens || 0,
      provider
    };
  }

  if (provider === 'anthropic') {
    const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }]
      })
    }, 25000);
    if (!r.ok) throw new Error('Anthropic a renvoyé une erreur');
    const data = await r.json();
    return {
      content: data.content?.[0]?.text?.trim() || '',
      tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      provider
    };
  }

  throw new Error(`Provider inconnu : ${provider}`);
}

/* ═══════════════════════════════════════════════════════════════════ */
/* Chat IA                                                           */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/ia/chat', authenticateToken, chatLimiter, async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message || message.trim().length < 2) {
      return res.status(400).json({ error: 'Message vide' });
    }

    let matchsContext = "Aucun match n'est actuellement disponible.";
    const q = message.toLowerCase();

    try {
      let query = "";
      let params = [];
      const searchTerms = q.split(' ').filter(w => w.length > 3 &&
        !['match','soir','demain','quels','sont','pour','dans','avec','cotes','paris','sport'].includes(w));

      if (searchTerms.length > 0) {
        const likeClauses = searchTerms.map((_, i) =>
          `(equipe1 ILIKE $${i + 1} OR equipe2 ILIKE $${i + 1} OR league ILIKE $${i + 1} OR sport ILIKE $${i + 1})`
        ).join(' OR ');
        params = searchTerms.map(t => `%${t}%`);
        query = `SELECT equipe1, equipe2, league, sport, commence_at, cote_w1, cote_x, cote_w2
                   FROM matches_cache WHERE termine = FALSE AND (${likeClauses})
                   ORDER BY commence_at ASC LIMIT 20`;
      } else {
        query = `SELECT equipe1, equipe2, league, sport, commence_at, cote_w1, cote_x, cote_w2
                   FROM matches_cache WHERE termine = FALSE
                     AND commence_at > NOW()
                     AND commence_at < NOW() + INTERVAL '48 hours'
                   ORDER BY commence_at ASC LIMIT 20`;
      }

      const { rows } = await pool.query(query, params);
      if (rows.length > 0) {
        matchsContext = `Voici les ${rows.length} matchs trouvés :\n`;
        rows.forEach(m => {
          const dateStr = new Date(m.commence_at).toLocaleString('fr-FR', {
            weekday: 'short', day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit'
          });
          matchsContext += `- [${m.sport || 'Sport'}] ${m.equipe1} vs ${m.equipe2} (${m.league || 'Compétition'}) le ${dateStr} | Cotes : W1=${m.cote_w1}, X=${m.cote_x}, W2=${m.cote_w2}\n`;
        });
      } else {
        matchsContext = "Aucun match spécifique à cette demande.";
      }
    } catch (dbErr) { logger.warn('[ia/chat] Erreur DB:', dbErr.message); }

    const prompt = `Tu es l'assistant « Pro » de Me2/3Legend. Tu tutoies l'utilisateur.
Voici les données en temps réel :
${matchsContext}

Instructions :
- Si l'utilisateur demande des matchs, liste ceux fournis ci-dessus.
- S'il n'y a pas de match correspondant, propose-lui de vérifier l'onglet "Suggestions".
- Ne JAMAIS inventer un match.

Question : ${message}`;

    const r = await callAI(prompt, { temperature: 0.5, maxTokens: 800 });
    await pool.query(
      `INSERT INTO ia_conversations(user_email, provider, prompt, reponse, tokens)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.email, r.provider, prompt, r.content, r.tokens]);

    res.json({ ok: true, reponse: r.content, provider: r.provider, tokens: r.tokens });
  } catch (e) {
    logger.error('[ia/chat] ❌', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Prédiction (VIP)                                                  */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/ia/predict', authenticateToken, requireCategory('vip'), predictLimiter, async (req, res) => {
  try {
    /* CORRECTIF #9 : bloque si suspension active */
    const suspension = await getUserSuspension(req.user.email);
    if (suspension) {
      return res.status(423).json({
        error: `Compte suspendu : gains successifs détectés (${Number(suspension.total_won).toFixed(2)} XAF).`
             + ` Suspension jusqu'au ${new Date(suspension.suspended_until).toLocaleString('fr-FR')}.`
             + ` Contactez le support pour lever la suspension.`,
        code: 'IA_SUSPENDED',
        suspension: {
          total_won: Number(suspension.total_won),
          threshold: Number(suspension.threshold),
          suspended_until: suspension.suspended_until
        }
      });
    }

    const { equipe1, equipe2, cotes } = req.body || {};
    if (!cotes || !cotes['1'] || !cotes['N'] || !cotes['2']) {
      return res.status(400).json({ error: 'Les 3 cotes sont requises' });
    }

    const prompt = `Expert paris : ${equipe1} vs ${equipe2}. Cotes : ${cotes['1']} / ${cotes['N']} / ${cotes['2']}. Résultat probable en JSON : {"prediction":"1|N|2","score":"X-Y","confidence":0-100,"raison":"..."}`;
    const r = await callAI(prompt, { temperature: 0.2, maxTokens: 200 });

    let parsed = null;
    try {
      parsed = safeParseJson(r.content);
      if (!['1', 'N', '2'].includes(String(parsed.prediction))) {
        throw new Error('prediction invalide');
      }
      parsed.confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 0));
    } catch (err) {
      logger.warn('[ia/predict] Parse invalide:', err.message);
      return res.status(502).json({ error: 'Réponse IA invalide, réessayez.', provider: r.provider });
    }

    res.json({ ok: true, ...parsed, provider: r.provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Validation automatique batch (admin)                              */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/ia/admin/auto-validate-batch', authenticateToken, adminAutoValidateBatchLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });

    const { matchs } = req.body || {};
    if (!Array.isArray(matchs) || matchs.length === 0) {
      return res.status(400).json({ error: 'Liste de matchs requise' });
    }
    if (matchs.length > 30) {
      return res.status(400).json({ error: 'Maximum 30 matchs par batch' });
    }

    const results = [];
    for (const m of matchs) {
      try {
        const prompt = `Match : ${m.equipe1} vs ${m.equipe2}. Cotes : ${m.cotes?.['1']} / ${m.cotes?.['N']} / ${m.cotes?.['2']}. Donne le résultat probable en JSON strict : {"prediction":"1|N|2","confidence":0-100,"raison":"..."}`;
        const r = await callAI(prompt, { temperature: 0.2, maxTokens: 150 });
        const parsed = safeParseJson(r.content);
        results.push({
          equipe1: m.equipe1, equipe2: m.equipe2,
          prediction: parsed.prediction,
          confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
          raison: parsed.raison || '',
          ok: true
        });
      } catch (e) {
        results.push({
          equipe1: m.equipe1, equipe2: m.equipe2,
          ok: false, error: e.message
        });
      }
    }

    res.json({ ok: true, results });
  } catch (e) {
    logger.error('[ia/admin/auto-validate-batch]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Validation automatique (admin, 1 match)                           */
/* ═══════════════════════════════════════════════════════════════════ */
router.post('/ia/admin/auto-validate', authenticateToken, adminAutoValidateLimiter, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès refusé' });

    const { equipe1, equipe2, cotes } = req.body || {};
    if (!equipe1 || !equipe2 || !cotes) {
      return res.status(400).json({ error: 'equipe1, equipe2 et cotes requis' });
    }

    const prompt = `Match : ${equipe1} vs ${equipe2}. Cotes : ${cotes['1']} / ${cotes['N']} / ${cotes['2']}. Donne le résultat probable en JSON strict : {"prediction":"1|N|2","confidence":0-100,"raison":"..."}`;
    const r = await callAI(prompt, { temperature: 0.2, maxTokens: 150 });
    const parsed = safeParseJson(r.content);

    res.json({
      ok: true,
      prediction: parsed.prediction,
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      raison: parsed.raison || '',
      provider: r.provider
    });
  } catch (e) {
    logger.error('[ia/admin/auto-validate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Vérification suspension (utilitaire pour le frontend)             */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/ia/suspension-status', authenticateToken, async (req, res) => {
  try {
    const susp = await getUserSuspension(req.user.email);
    if (!susp) return res.json({ suspended: false });
    res.json({
      suspended: true,
      total_won: Number(susp.total_won),
      threshold: Number(susp.threshold),
      suspended_until: susp.suspended_until
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* Vérification automatique de la plausibilité des cotes             */
/* ═══════════════════════════════════════════════════════════════════ */
const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.IA_VERIFY_RATE_MAX || 100),
  keyGenerator: r => r.user?.email || r.ip,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Limite de vérifications atteinte (100/heure).' }
});

router.post('/ia/verify-match', authenticateToken, verifyLimiter, async (req, res) => {
  try {
    const { equipe1, equipe2, cotes } = req.body || {};

    /* 1. Validations de base */
    if (!cotes || !cotes['1'] || !cotes['N'] || !cotes['2']) {
      return res.json({
        valide: false, confiance: 0,
        raisons: ['Les 3 cotes sont requises pour la vérification.']
      });
    }

    const c1 = Number(cotes['1']);
    const cN = Number(cotes['N']);
    const c2 = Number(cotes['2']);

    if (!Number.isFinite(c1) || !Number.isFinite(cN) || !Number.isFinite(c2)) {
      return res.json({ valide: false, confiance: 0, raisons: ['Cotes non numériques.'] });
    }

    const raisons = [];
    let confiance = 100;

    /* 2. Plages individuelles plausibles */
    const COTE_MIN = 1.01;
    const COTE_MAX_FOOT = 30;      /* au-delà, très improbable en football */
    const COTE_MAX_ABS = 100;       /* au-delà, absurdité */

    const cotesArray = [c1, cN, c2];

    if (cotesArray.some(c => c < COTE_MIN)) {
      raisons.push(`Cote inférieure au minimum réglementaire (${COTE_MIN}).`);
      confiance -= 50;
    }

    if (cotesArray.some(c => c > COTE_MAX_ABS)) {
      raisons.push(`Cote aberrante (> ${COTE_MAX_ABS}) : probablement une faute de frappe.`);
      confiance -= 60;
    } else if (cotesArray.some(c => c > COTE_MAX_FOOT)) {
      raisons.push(`Cote très élevée (> ${COTE_MAX_FOOT}) : à vérifier.`);
      confiance -= 25;
    }

    /* 3. Cohérence de la marge bookmaker */
    const sommeProbas = 1/c1 + 1/cN + 1/c2;

    if (sommeProbas < 0.85) {
      raisons.push(`Marge bookmaker anormalement basse (somme des probabilités = ${(sommeProbas * 100).toFixed(1)}%, normal ≈ 105-115%).`);
      confiance -= 30;
    } else if (sommeProbas > 1.60) {
      raisons.push(`Marge bookmaker anormalement élevée (somme des probabilités = ${(sommeProbas * 100).toFixed(1)}%, normal ≈ 105-115%).`);
      confiance -= 15;
    }

    /* 4. Détection de cotes "toutes hautes" (ex: 12, 10, 53 → suspect) */
    const nbCotesHautes = cotesArray.filter(c => c > 10).length;
    if (nbCotesHautes >= 2) {
      raisons.push(`Plusieurs cotes > 10 simultanément (${nbCotesHautes}/3) : match très déséquilibré ou cotes erronées.`);
      confiance -= 35;
    }

    /* 5. Vérification dans le cache des matchs synchronisés (si dispo) */
    try {
      const e1 = String(equipe1 || '').trim();
      const e2 = String(equipe2 || '').trim();
      if (e1.length >= 3 && e2.length >= 3) {
        const match = await pool.query(
          `SELECT equipe1, equipe2, cote_w1, cote_x, cote_w2
             FROM matches_cache
            WHERE termine = FALSE
              AND (
                (equipe1 ILIKE $1 AND equipe2 ILIKE $2)
                OR (equipe1 ILIKE $2 AND equipe2 ILIKE $1)
              )
            LIMIT 1`,
          [`%${e1}%`, `%${e2}%`]
        );

        if (match.rows.length) {
          const ref = match.rows[0];
          const refW1 = Number(ref.cote_w1);
          const refX  = Number(ref.cote_x);
          const refW2 = Number(ref.cote_w2);

          /* Écart max toléré : 25 % sur chaque cote */
          const ecartW1 = Math.abs(c1 - refW1) / refW1;
          const ecartX  = Math.abs(cN - refX)  / refX;
          const ecartW2 = Math.abs(c2 - refW2) / refW2;
          const ecartMax = Math.max(ecartW1, ecartX, ecartW2);

          if (ecartMax > 0.25) {
            raisons.push(
              `Écart important avec les cotes de référence ` +
              `(W1 ${refW1} / X ${refX} / W2 ${refW2}). ` +
              `Écart max : ${(ecartMax * 100).toFixed(0)}%.`
            );
            confiance -= 20;
          } else {
            /* Match trouvé et cotes proches → boost de confiance */
            confiance = Math.min(100, confiance + 10);
          }
        } else {
          raisons.push(`Match « ${e1} vs ${e2} » non trouvé dans notre base de données.`);
          confiance -= 5;
        }
      }
    } catch (dbErr) {
      logger.warn('[ia/verify-match] Erreur DB:', dbErr.message);
    }

    /* 6. Verdict */
    confiance = Math.max(0, Math.min(100, confiance));
    const valide = confiance >= 50;

    res.json({
      valide,
      confiance,
      raisons,
      conseils: valide
        ? null
        : 'Corrigez les cotes ou utilisez un match de la liste Suggestions.'
    });
  } catch (e) {
    logger.error('[ia/verify-match]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* GET /ia/my-pending-matches — Paris en attente de résultat         */
/* ═══════════════════════════════════════════════════════════════════ */
router.get('/ia/my-pending-matches', authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, date, data, mise_totale, valide
         FROM saisies
        WHERE user_email = $1
          AND valide = TRUE
        ORDER BY date DESC, moment DESC
        LIMIT 100`,
      [req.user.email]
    );

    const pending = [];

    for (const s of rows) {
      const validation = (s.data && s.data.VALIDATION) || [];

      validation.forEach((m, idx) => {
        if (!m.valide) return;
        const hasStatut = m.statuts && (m.statuts['1'] || m.statuts['N'] || m.statuts['2']);
        if (hasStatut) return; /* déjà validé */

        pending.push({
          saisieId: s.id,
          idx,
          equipe1: m.equipe1 || '',
          equipe2: m.equipe2 || '',
          league: m.league || m.sport || '',
          date: s.date,
          cotes: m.cotes || {},
          tableauChoisi: m.tableauChoisi || 1,
          miseDebitee: Number(m.miseDebitee || 0),
          multiplicateur: (s.data && s.data.multiplicateur) || 1,
          _external_id: m._external_id || null
        });
      });
    }

    res.json(pending);
  } catch (e) {
    logger.error('[ia/my-pending-matches]', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════════════════════════════════ */
/* EXPORTS                                                           */
/* ═══════════════════════════════════════════════════════════════════ */
module.exports = router;
module.exports.checkAndCreateSuspension = checkAndCreateSuspension;
module.exports.getUserSuspension = getUserSuspension;
module.exports.WIN_THRESHOLDS = WIN_THRESHOLDS;