-- C:\Me\AppMoney\MeParisPortifs\migrations\migration-v6.3.0.sql
ALTER TABLE withdrawal_otps ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
ALTER TABLE withdrawal_audit ADD COLUMN IF NOT EXISTS phone VARCHAR(40);
ALTER TABLE withdrawal_audit ADD COLUMN IF NOT EXISTS payout_txid VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_withdrawal_audit_payout_txid 
  ON withdrawal_audit(payout_txid) WHERE payout_txid IS NOT NULL;