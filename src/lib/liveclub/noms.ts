// L'historique des noms Telegram, cote journal (passe 1 du chantier « noms et
// paroles des membres », Brice 15/10/2026). Regles dans noms-pur.ts.
//
// BEST EFFORT, sans exception : noterNomTelegram ne leve jamais. Une base
// illisible, une migration pas encore appliquee (fonction absente) ou une
// ligne refusee ne bloquent ni le webhook du groupe ni le bot des membres :
// un avertissement dans les logs, sans nom ni identifiant, et c'est tout.
//
// On ECRIT seulement, on ne lit jamais : la table n'est lisible que par
// l'equipe du cockpit et l'agent (aucun outil d'un bot membre n'y touche).

import { prisma } from '@/lib/db'
import { jourParis } from './passage-regles'
import { identiteTelegram, ligneNom, nomANoter, type UtilisateurTg } from './noms-pur'

// Compte Telegram -> derniere cle (jour de Paris, pseudo, nom) ecrite en prive,
// pour cette instance du serveur. La fonction SQL refait la garde en base.
const NOMS_PRIVES_DU_JOUR = new Map<number, string>()

export async function noterNomTelegram(
  u: UtilisateurTg | null | undefined,
  source: 'evenement' | 'prive',
  quand: Date = new Date(),
): Promise<void> {
  try {
    const identite = identiteTelegram(u)
    if (!identite) return
    const vuLe = Number.isFinite(quand.getTime()) ? quand : new Date()
    const uneFoisParJour = source === 'prive'
    if (uneFoisParJour && !nomANoter(NOMS_PRIVES_DU_JOUR, identite, jourParis(vuLe.toISOString()))) return
    const lignes = JSON.stringify([ligneNom(identite, source, vuLe)])
    await prisma.$queryRaw`
      select public.cockpit_telegram_noms_noter(${lignes}::jsonb, ${uneFoisParJour})::text as r`
  } catch (err) {
    // Le code Postgres suffit (jamais la ligne refusee, qui porterait le nom).
    const texte = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ')
    const code = /Code: `?([0-9A-Z]{5})`?/.exec(texte)?.[1] ?? null
    if (code === '42883' || code === '42P01' || /does not exist/i.test(texte)) {
      console.warn(`[liveclub/noms] historique des noms absent (migration 20261015170000 pas appliquee ?) : nom ${source} non note.`)
    } else {
      console.warn(`[liveclub/noms] nom ${source} non note : ${code ? `code ${code}` : texte.slice(0, 120)}`)
    }
  }
}
