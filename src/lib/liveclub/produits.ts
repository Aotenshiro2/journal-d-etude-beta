// Les produits Stripe qui ouvrent le Live Club : liste DYNAMIQUE (Brice, 13/10).
//
// Les deux produits de base (PRODUITS_LIVECLUB, config.ts) sont toujours
// reconnus. Les autres (un tarif particulier = un produit de plus, comme
// l'acces de Yassine a 1 EUR/mois) vivent dans cockpit_liveclub_produits
// (migration 20261013120000), inscrits par l'agent du cockpit
// (proposer_produit avec live_club, proposer_marquer_live_club). Lus ici avec
// un cache de 60 s par instance : droits, page de bienvenue, passage
// quotidien, bot et agent passent tous par lireProduitsLiveClub.
//
// Une panne de lecture ne fait jamais perdre les produits de base. Sans
// aucune liste lue avant, la liste est dite NON complete : droits.ts fait
// alors d'un 'non' un 'inconnu' (un abonne d'un produit de plus ne doit pas
// etre sorti ni refuse sur une lecture ratee). Le pipeline Python
// (push_membres_supabase.py) lit la meme table.

import { prisma } from '@/lib/db'
import { PRODUITS_LIVECLUB } from './config'
import {
  creerLecteurProduitsLiveClub, messageErreur, relationAbsente, type ListeProduitsLiveClub,
} from './pur'

export type { ListeProduitsLiveClub }

const lecteur = creerLecteurProduitsLiveClub(
  async () => {
    const lignes = await prisma.$queryRaw<{ produit_id: string }[]>`
      select produit_id from public.cockpit_liveclub_produits where retire_le is null`
    return lignes.map(l => l.produit_id)
  },
  {
    connus: PRODUITS_LIVECLUB,
    estAbsente: relationAbsente,
    surPanne: err => console.warn(`[liveclub/produits] liste des produits illisible, produits de base seuls : ${messageErreur(err)}`),
  },
)

/** La liste des produits Live Club (jamais sans les produits de base). Ne jette pas. */
export function lireProduitsLiveClub(): Promise<ListeProduitsLiveClub> {
  return lecteur.lire()
}

/** Les identifiants seuls. */
export async function produitsLiveClub(): Promise<readonly string[]> {
  return (await lecteur.lire()).produits
}

export type IssueInscriptionProduit =
  | { ok: true; deja: boolean }
  | { ok: false; raison: 'table_absente' | 'echec'; message: string }

/**
 * Inscrit un produit Stripe (compte melanie) comme produit Live Club. Un
 * produit deja inscrit et actif : rien ne change (deja). Un produit retire :
 * reinscrit. Vide le cache de cette instance (les autres relisent sous 60 s).
 * Ne jette pas.
 */
export async function inscrireProduitLiveClub(o: {
  produitId: string; nom: string | null; posePar: string; note: string | null
}): Promise<IssueInscriptionProduit> {
  try {
    const lignes = await prisma.$queryRaw<{ produit_id: string }[]>`
      insert into public.cockpit_liveclub_produits (produit_id, compte, nom, pose_par, note)
      values (${o.produitId}, 'melanie', ${o.nom ? o.nom.slice(0, 200) : null}, ${o.posePar.slice(0, 120)},
              ${o.note ? o.note.slice(0, 500) : null})
      on conflict (produit_id) do update
        set retire_le = null, retire_par = null, pose_par = excluded.pose_par, pose_le = now(),
            nom = coalesce(excluded.nom, public.cockpit_liveclub_produits.nom),
            note = coalesce(excluded.note, public.cockpit_liveclub_produits.note)
        where public.cockpit_liveclub_produits.retire_le is not null
      returning produit_id`
    lecteur.oublier()
    return { ok: true, deja: lignes.length === 0 }
  } catch (err) {
    if (relationAbsente(err)) {
      return {
        ok: false, raison: 'table_absente',
        message: "La table cockpit_liveclub_produits n'existe pas encore (migration 20261013120000_cockpit_liveclub_produits.sql à appliquer).",
      }
    }
    console.error(`[liveclub/produits] inscription refusee : ${messageErreur(err)}`)
    return { ok: false, raison: 'echec', message: `La base a refusé l'inscription (${messageErreur(err)}).` }
  }
}
