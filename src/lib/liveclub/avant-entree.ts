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
// Jette si la base ne repond pas : les appelants gardent leur repli.

import { prisma } from '@/lib/db'
import type { AvantEntree } from './accueil-groupe'

export async function lireAvantEntree(telegramId: number): Promise<AvantEntree> {
  const lignes = await prisma.$queryRaw<{ present: boolean | null; sorti_le: Date | null; retrait_pour: string | null }[]>`
    select m.present, m.sorti_le,
      (select g.regle from public.cockpit_liveclub_gestes g
        where g.telegram_id = m.telegram_id and g.geste = 'retrait' and g.resultat = 'fait'
          and m.sorti_le is not null
          and g.fait_le between m.sorti_le - interval '1 hour' and m.sorti_le + interval '1 hour'
        order by g.fait_le desc limit 1) as retrait_pour
    from public.cockpit_telegram_membres m where m.telegram_id = ${telegramId}`
  const l = lignes[0]
  return l ? { present: l.present, sortiLe: l.sorti_le, retraitPour: l.retrait_pour } : null
}
