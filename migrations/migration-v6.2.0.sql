-- =====================================================================
-- Me2/3Legend — Migration v6.1.0 → v6.2.0
-- Correctifs : mojibake 'Légendaire', tables manquantes, harmonisation
-- Idempotent. Backup recommandé avant exécution.
-- =====================================================================
SET client_encoding = 'UTF8';

BEGIN;

-- =====================================================================
-- 1. SUPPRESSION DES CONTRAINTES (Avant les modifications de données)
-- =====================================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_category_check;
ALTER TABLE permission_groups DROP CONSTRAINT IF EXISTS permission_groups_category_check;

-- =====================================================================
-- 2. FIX MOJIBAKE : 'Léndaire' / 'Légendaire' / 'Legendaire' → 'legendaire'
-- =====================================================================
UPDATE users
   SET category = 'legendaire'
 WHERE category IS NOT NULL
   AND category <> 'legendaire'
   AND (category ILIKE '%gendaire%' OR category = 'prestige' OR category = 'legendaire ');

UPDATE permission_groups
   SET category = 'legendaire'
 WHERE category IS NOT NULL
   AND category <> 'legendaire'
   AND (category ILIKE '%gendaire%' OR category = 'prestige');

UPDATE plans
   SET code = 'legendaire', nom = 'Légendaire'
 WHERE code IS NOT NULL
   AND code <> 'legendaire'
   AND (code ILIKE '%gendaire%' OR code = 'prestige');

UPDATE constantes
   SET label = 'Suspension IA - Premium/VIP/Légendaire'
 WHERE key = 'IA_WIN_THRESHOLD_PREMIUM';

-- =====================================================================
-- 3. RECRÉATION DES CONTRAINTES (Propres)
-- =====================================================================
ALTER TABLE users ADD CONSTRAINT users_category_check
  CHECK (category IN ('free','premium','vip','legendaire'));

ALTER TABLE permission_groups ADD CONSTRAINT permission_groups_category_check
  CHECK (category IN ('free','premium','vip','legendaire','admin'));

-- =====================================================================
-- 4. TABLE MANQUANTE : invitations
-- =====================================================================
CREATE TABLE IF NOT EXISTS invitations (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(40) UNIQUE NOT NULL,
  created_by  VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  used        BOOLEAN DEFAULT FALSE,
  used_by     VARCHAR(255) REFERENCES users(email) ON DELETE SET NULL,
  used_at     TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code) WHERE used = FALSE;
CREATE INDEX IF NOT EXISTS idx_invitations_admin ON invitations(created_by, created_at DESC);

-- =====================================================================
-- 5. TABLE MANQUANTE : deletion_requests
-- =====================================================================
CREATE TABLE IF NOT EXISTS deletion_requests (
  id          BIGSERIAL PRIMARY KEY,
  user_email  VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  statut      VARCHAR(20) NOT NULL DEFAULT 'pending'
              CHECK (statut IN ('pending','approved','rejected')),
  raison      TEXT,
  date        TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  processed_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_status ON deletion_requests(statut, date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_deletion_pending
  ON deletion_requests(user_email) WHERE statut = 'pending';

-- =====================================================================
-- 6. NETTOYAGE : supprimer les doublons de plans
-- =====================================================================
DELETE FROM plans
 WHERE code IN ('prestige', 'Légendaire', 'LГѓВ©gendaire')
   AND EXISTS (SELECT 1 FROM plans WHERE code = 'legendaire');

-- =====================================================================
-- 7. CONSTANTE : désactiver la marge silencieuse sur retrait (v6.2.0)
-- =====================================================================
INSERT INTO constantes(key, value, label) VALUES
  ('MARGIN_RATE_WITHDRAWAL', 0, 'Marge silencieuse sur retrait (0 = désactivée, 0.02 = 2%)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label;

COMMIT;