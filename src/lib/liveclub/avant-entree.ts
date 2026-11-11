// (03/11) La ligne d'un compte AVANT son entree dans le groupe, lue au meme
// endroit pour l'accueil du groupe (route du webhook) et le message prive de
// l'admission (bot-membre.ts, lireGenreEntree) : presence, date de sortie et,
// si le bot ou l'equipe l'a sorti, la regle de ce retrait (geste « retrait »
// de cockpit_liveclub_gestes, a une heure pres de la sortie). La regle de qui
// entre vit dans accueil-groupe.ts (genreEntree).
//
// Cas du 03/11 (EarvinSaintus) : sorti le 06/10 par un retrait manuel (sans
// abonnement relie), revenu 28 jours plus tard par un acces broker ; la ligne
// seule disait « retour rapide » et rien n'etait publie.
//
// (11/11) Et si un BAN a ete leve pour ce compte juste avant (geste
// « reintegration » fait, regle payeur_banni ou statut 'kicked' leve, dans les
// JOURS_BAN_LEVE derniers jours, sans sortie depuis) : banLeve. Cas de Niko D
// (10/11) : banni avant le suivi du groupe, ban leve par le bot 12 secondes
// avant son entree ; il entrait comme un retour rapide, sans accueil. Un
// compte sans ligne mais dont le ban vient d'etre leve n'est pas « jamais
// vu » : la lecture le dit (present null, sortie inconnue, banLeve).
//
// Jette si la base ne repond pas : les appelants gardent leur repli.

import { prisma } from '@/lib/db'
import type { AvantEntree } from './accueil-groupe'

/** Un ban leve compte pour l'entree qui suit pendant ce nombre de jours (le lien envoye avec peut s'ouvrir plus tard). */
const JOURS_BAN_LEVE = 7

export async function lireAvantEntree(telegramId: number): Promise<AvantEntree> {
  const leves = await prisma.$queryRaw<{ n: number }[]>`
    select 1 as n from public.cockpit_liveclub_gestes g
    where g.telegram_id = ${telegramId} and g.geste = 'reintegration' and g.resultat = 'fait'
      and (g.regle = 'payeur_banni' or g.details->>'statut_tg' = 'kicked')
      and g.fait_le > now() - make_interval(days => ${JOURS_BAN_LEVE}::int)
      and not exists (select 1 from public.cockpit_telegram_membres m
        where m.telegram_id = g.telegram_id and m.sorti_le > g.fait_le + interval '1 minute')
    limit 1`
  const banLeve = leves.length > 0
  const lignes = await prisma.$queryRaw<{ present: boolean | null; sorti_le: Date | null; retrait_pour: string | null }[]>`
    select m.present, m.sorti_le,
      (select g.regle from public.cockpit_liveclub_gestes g
        where g.telegram_id = m.telegram_id and g.geste = 'retrait' and g.resultat = 'fait'
          and m.sorti_le is not null
          and g.fait_le between m.sorti_le - interval '1 hour' and m.sorti_le + interval '1 hour'
        order by g.fait_le desc limit 1) as retrait_pour
    from public.cockpit_telegram_membres m where m.telegram_id = ${telegramId}`
  const l = lignes[0]
  if (!l) return banLeve ? { present: null, sortiLe: null, retraitPour: null, banLeve } : null
  return { present: l.present, sortiLe: l.sorti_le, retraitPour: l.retrait_pour, banLeve }
}
