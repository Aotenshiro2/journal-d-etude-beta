-- État de relecture au niveau de la note réorganisée (canvas d'étude).
-- reviewedAt        : relue le (null = pas encore relue). Une note relue est considérée
--                     mémorisée → elle sort de la file de relecture.
-- reviewReminderAt  : rappel fixé par l'élève (« repropose-la-moi dans X jours ») ; quand
--                     l'échéance passe, la note revient dans la file même si relue.
ALTER TABLE "Canvas" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Canvas" ADD COLUMN IF NOT EXISTS "reviewReminderAt" TIMESTAMP(3);
