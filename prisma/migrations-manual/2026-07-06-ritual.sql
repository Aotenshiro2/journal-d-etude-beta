-- Rituel de séance (Tendler + masterclass perte) : warmup avant / cooldown après.
-- Warmup : état physique/émotionnel, pensée dominante, objectif qualitatif, jauge
-- d'émotion accumulée (0-100). Cooldown : erreurs repérées, leçon, comment je me recentre.
CREATE TABLE IF NOT EXISTS "Ritual" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "physical" TEXT,
  "emotional" TEXT,
  "dominantThought" TEXT,
  "objective" TEXT,
  "emotionLevel" INTEGER,       -- 0-100, émotion accumulée au démarrage
  "errors" TEXT,
  "lesson" TEXT,
  "recenter" TEXT,
  "closed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "Ritual_userId_idx" ON "Ritual" ("userId");
