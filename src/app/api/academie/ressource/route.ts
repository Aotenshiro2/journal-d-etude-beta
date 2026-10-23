import { NextRequest, NextResponse } from 'next/server'
import { droitsAcademie, type DroitsAcademie } from '@/lib/academie/droits'
import { lireLeconParId, type LeconComplete } from '@/lib/academie/catalogue'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import { lireDemandeRessource, ouvertureLecon } from '@/lib/academie/pur'
import { urlSigneeRessource } from '@/lib/academie/stockage'
import { noterRessource } from '@/lib/academie/suivi'
import { messageErreur } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/ressource : ouvrir une piece jointe PROTEGEE d'une lecon
 * (PDF d'un module payant : Bunny CDN a jeton depuis le 23/10/2026, repli sur
 * le bucket prive Supabase academie-ressources tant que BUNNY_PDF_* ne sont
 * pas posees ; src/lib/academie/stockage.ts) pour un compte
 * qui a droit a la lecon. Meme authentification, meme CORS et meme regle que
 * /api/academie/lecture (droitsAcademie, ouvertureLecon) : le serveur decide,
 * jamais la page.
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps
 *   { lecon_id: '<id de lecon>', index: <rang de la piece jointe> }
 * index = le rang dans la liste « ressources » rendue par /api/academie/lecture
 * (ressourcesPropres, meme ordre). Seules les pieces jointes { titre, fichier }
 * passent par ici ; une { titre, url } est publique et s'ouvre directement.
 *
 * Reponses :
 *   200 { ok: true, url, expire_le, titre }       URL signee de 5 min (Bunny CDN, ou Supabase en repli)
 *   400 { ok: false, erreur: 'demande' }           corps illisible
 *   401 { ok: false, erreur: 'jeton' }             pas de jeton, ou jeton refuse
 *   403 { ok: false, erreur: 'acces' }             compte sans droit sur cette lecon
 *   404 { ok: false, erreur: 'lecon' }             lecon inconnue, en brouillon ou archivee
 *   404 { ok: false, erreur: 'ressource' }         pas de piece jointe protegee a ce rang
 *   404 { ok: false, erreur: 'fichier' }           (repli Supabase) fichier pas dans le bucket ; (Bunny)
 *                                                  chemin mal forme seulement : un absent repond 404 chez Bunny
 *   409 { ok: false, erreur: 'a_venir' }           lecon ou module annonce, pas encore ouvert
 *   503 { ok: false, erreur: 'config' }            BUNNY_PDF_* a moitie posees, ou ni Bunny ni cle de service
 *   503 { ok: false, erreur: 'indisponible' }      base, Supabase Auth, Stripe ou Storage illisible
 *
 * L'ouverture est notee au journal des lectures (evenement 'ressource', avec
 * le fichier), au mieux : une panne d'ecriture n'empeche pas l'eleve d'ouvrir
 * son document, elle est signalee.
 *
 * Logs : compte TRONQUE, lecon, rang. Jamais l'email, le jeton du compte, la
 * cle de service, la cle de jeton Bunny ni l'URL signee.
 */

export const maxDuration = 30

// Preflight : le middleware laisse passer les OPTIONS sur /api/.
export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

let configAbsenteSignalee = false

export async function POST(req: NextRequest) {
  // Une URL signee est personnelle et datee : ni cache du navigateur, ni cache intermediaire.
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  // 1. Le compte.
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/ressource] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  // 2. La demande.
  const demande = lireDemandeRessource(await req.json().catch(() => ({})))
  if (!demande) return refus('demande', 400)

  // 3. La lecon, lue fraiche.
  let lecon: LeconComplete | null
  try {
    lecon = await lireLeconParId(demande.lecon)
  } catch (err) {
    console.warn(`[academie/ressource] lecon illisible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  const visible = (s: string) => s === 'publie' || s === 'a_venir'
  if (!lecon || !visible(lecon.statut) || !visible(lecon.moduleStatut)) return refus('lecon', 404)
  if (lecon.statut === 'a_venir' || lecon.moduleStatut === 'a_venir') return refus('a_venir', 409)

  // 4. Le droit (meme regle que la lecture).
  let droits: DroitsAcademie
  try {
    droits = await droitsAcademie(userId)
  } catch (err) {
    console.warn(`[academie/ressource] droits illisibles : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  const resultat = ouvertureLecon(droits, lecon)
  if (resultat.acces === 'inconnu') {
    console.warn(`[academie/ressource] droit inconnu compte=${tronquer(userId)} lecon=${lecon.id} (${droits.erreurs.join(', ')})`)
    return refus('indisponible', 503)
  }
  if (resultat.acces !== 'ouvert') {
    console.info(`[academie/ressource] refus compte=${tronquer(userId)} lecon=${lecon.id}`)
    return refus('acces', 403)
  }

  // 5. La piece jointe protegee a ce rang.
  const ressource = lecon.ressources[demande.index]
  if (!ressource || !('fichier' in ressource)) return refus('ressource', 404)

  // 6. L'URL signee.
  const signee = await urlSigneeRessource(ressource.fichier)
  if (!signee.ok) {
    if (signee.erreur === 'config') {
      if (!configAbsenteSignalee) {
        configAbsenteSignalee = true
        console.warn(`[academie/ressource] ${signee.detail ?? 'configuration absente'} : aucune URL ne peut etre signee.`)
      }
      return refus('config', 503)
    }
    if (signee.erreur === 'introuvable') {
      console.warn(`[academie/ressource] fichier absent du bucket : lecon=${lecon.id} rang=${demande.index}`)
      return refus('fichier', 404)
    }
    console.warn(`[academie/ressource] Storage illisible (${signee.detail ?? 'erreur'}) lecon=${lecon.id}`)
    return refus('indisponible', 503)
  }

  // 7. Le journal (au mieux).
  try {
    await noterRessource(userId, lecon.id, ressource.fichier, origineDeLaRequete(req))
  } catch (err) {
    console.warn(`[academie/ressource] journal des lectures NON ecrit compte=${tronquer(userId)} lecon=${lecon.id} : ${messageErreur(err)}`)
  }

  console.info(`[academie/ressource] url compte=${tronquer(userId)} lecon=${lecon.id} rang=${demande.index} source=${signee.source} raison=${resultat.raisons[0] ?? null}`)
  return NextResponse.json(
    { ok: true, url: signee.url, expire_le: signee.expireLe, titre: ressource.titre },
    { headers },
  )
}
