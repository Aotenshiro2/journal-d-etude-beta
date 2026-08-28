-- IA (mentorat, support, capture) — 28/08/2026.
-- AiUsage : chaque appel Claude loggé par membre (source de l'écran cockpit).
-- SupportThread : fils du chatbot support. MentoratPlan : plans proposés/validés.
CREATE TABLE IF NOT EXISTS "AiUsage" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AiUsage_userId_createdAt_idx" ON "AiUsage" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsage_product_createdAt_idx" ON "AiUsage" ("product", "createdAt");

CREATE TABLE IF NOT EXISTS "SupportThread" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "app" TEXT NOT NULL DEFAULT 'extension',
  "messages" JSONB NOT NULL DEFAULT '[]',
  "escalatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SupportThread_userId_updatedAt_idx" ON "SupportThread" ("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "MentoratPlan" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "periodDays" INTEGER NOT NULL,
  "brief" JSONB NOT NULL,
  "plan" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "MentoratPlan_userId_createdAt_idx" ON "MentoratPlan" ("userId", "createdAt");
