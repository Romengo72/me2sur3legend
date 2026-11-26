// C:\Me\AppMoney\MeParisPortifs\routes-deposit.js
// ═══════════════════════════════════════════════════════════════════
// ⚠️⚠️⚠️  FICHIER NEUTRALISÉ — v4.1.1  ⚠️⚠️⚠️
//
// HISTORIQUE :
//   v4.0 : Ce fichier créditait directement le solde utilisateur
//          SANS AUCUN PAIEMENT. Faille critique de sécurité.
//
//   v4.1.1 : Endpoint désactivé. Tout dépôt réel doit passer par
//            POST /api/payment/initialize (routes-payment.js) qui
//            redirige vers la page CinetPay (choix opérateur +
//            saisie du numéro), puis crédite via webhook sécurisé.
//
// CONSERVÉ dans le projet pour :
//   • Traçabilité (historique des routes)
//   • Compatibilité (retourne un message explicite si appelé)
//   • Documentation vivante de la faille corrigée
//
// NE PAS RÉACTIVER sans revoir complètement la logique.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const router = express.Router();

/* ----------------------------------------------------------------- */
/* Route /deposit — Désactivée (410 Gone)                             */
/* ----------------------------------------------------------------- */
router.post('/deposit', (_req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Cet endpoint est définitivement désactivé pour raison de sécurité.',
    code: 'DEPOSIT_ENDPOINT_DISABLED',
    reason: 'Le crédit direct sans paiement permettait de se créditer gratuitement.',
    alternative: {
      endpoint: '/api/payment/initialize',
      method: 'POST',
      description: 'Dépôt réel via CinetPay (redirection guichet + webhook sécurisé)',
      body_example: {
        amount: 10000,
        methode: 'mobile_money',
        devise: 'XAF'
      }
    },
    documentation: 'Voir cahier des charges v4.1.0 — section 5 (Frais & commissions)'
  });
});

/* ----------------------------------------------------------------- */
/* Route /deposit/status — Info sur la redirection                    */
/* ----------------------------------------------------------------- */
router.get('/deposit', (_req, res) => {
  res.json({
    ok: false,
    message: 'Endpoint POST /deposit désactivé. Utilisez POST /api/payment/initialize.',
    active_endpoint: '/api/payment/initialize'
  });
});

module.exports = router;