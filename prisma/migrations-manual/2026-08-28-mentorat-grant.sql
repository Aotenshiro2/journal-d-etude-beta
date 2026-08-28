-- Gating mentorat (28/08/2026) : table des accès accordés à la main.
-- Les droits automatiques (Live Club, Skool premium/vip) se lisent dans les
-- tables cockpit_* déjà alimentées chaque matin par AOK-Push-Membres.
CREATE TABLE IF NOT EXISTS "MentoratGrant" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "MentoratGrant_email_idx" ON "MentoratGrant" ("email");
