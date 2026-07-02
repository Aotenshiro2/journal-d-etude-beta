-- Socle notation (PLAN-NOTATION.md phase 1) — changements ADDITIFS uniquement.
-- Appliqué via : npx prisma db execute --file prisma/migrations-manual/2026-07-02-notation-socle.sql --schema prisma/schema.prisma
-- (db push impossible : l'introspection Prisma bute sur auth_security_logs → auth.users)

-- Concepts extraits par la smart capture (extension) au niveau note
ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "concepts" TEXT[] NOT NULL DEFAULT '{}';

-- ID stable du message côté extension (survit au replace-all de la sync)
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "extensionMessageId" TEXT;

-- Tags au niveau note — même taxonomie Tag que les messages
CREATE TABLE IF NOT EXISTS "NoteTag" (
  "noteId" TEXT NOT NULL,
  "tagId"  TEXT NOT NULL,
  CONSTRAINT "NoteTag_pkey" PRIMARY KEY ("noteId", "tagId"),
  CONSTRAINT "NoteTag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NoteTag_tagId_fkey"  FOREIGN KEY ("tagId")  REFERENCES "Tag"("id")  ON DELETE CASCADE ON UPDATE CASCADE
);

-- La « notation » (masterclass edge) : grade A/B/C + phrase + catégorie de cause + cycle de relecture.
-- messageRef = extensionMessageId ou Message.id, SANS FK (les messages extension sont recréés à chaque sync).
CREATE TABLE IF NOT EXISTS "Annotation" (
  "id"            TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "noteId"        TEXT,
  "messageRef"    TEXT,
  "grade"         TEXT NOT NULL,
  "phrase"        TEXT NOT NULL,
  "causeCategory" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewDueAt"   TIMESTAMP(3),
  "reviewedAt"    TIMESTAMP(3),
  CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Annotation_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Annotation_userId_reviewDueAt_idx" ON "Annotation"("userId", "reviewDueAt");
CREATE INDEX IF NOT EXISTS "Annotation_noteId_idx" ON "Annotation"("noteId");
