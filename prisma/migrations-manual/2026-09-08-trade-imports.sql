-- Trades importés des plateformes (go Brice 08/09/2026, v1 Tradovate).
-- Montants gardés dans leur monnaie d'origine ; dédup (userId, source, idExterne).
CREATE TABLE IF NOT EXISTS "TradeImport" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "idExterne" TEXT NOT NULL,
  "compte" TEXT,
  "symbole" TEXT NOT NULL,
  "direction" TEXT,
  "quantite" INTEGER NOT NULL DEFAULT 1,
  "prixEntree" DOUBLE PRECISION,
  "prixSortie" DOUBLE PRECISION,
  "entreLe" TIMESTAMP(3) NOT NULL,
  "sortiLe" TIMESTAMP(3),
  "pnl" DOUBLE PRECISION NOT NULL,
  "devise" TEXT NOT NULL DEFAULT 'USD',
  "frais" DOUBLE PRECISION,
  "dureeSec" INTEGER,
  "fichier" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TradeImport_userId_source_idExterne_key"
  ON "TradeImport"("userId", "source", "idExterne");
CREATE INDEX IF NOT EXISTS "TradeImport_userId_entreLe_idx"
  ON "TradeImport"("userId", "entreLe");
