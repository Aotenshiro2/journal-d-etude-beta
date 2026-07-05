-- Fiche « Pattern Map » (Tendler, Mental Game of Trading) : cartographier l'escalade
-- d'un problème récurrent (déclencheur → … → erreur) + la phrase corrective.
CREATE TABLE IF NOT EXISTS "Pattern" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Nouveau pattern',
  "area" TEXT,                 -- avidité | peur | tilt | confiance | discipline
  "trigger" TEXT,              -- le déclencheur (détonateur)
  "thoughts" TEXT,             -- pensées automatiques
  "emotions" TEXT,             -- émotions (escalade : frustration → colère…)
  "behaviors" TEXT,            -- comportements
  "actions" TEXT,              -- actions
  "decisionShift" TEXT,        -- changement de prise de décision
  "perceptionShift" TEXT,      -- changement de perception du marché
  "mistake" TEXT,              -- l'erreur d'exécution finale
  "correction" TEXT,           -- phrase corrective / stratégie temps réel
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Pattern_userId_idx" ON "Pattern" ("userId");
