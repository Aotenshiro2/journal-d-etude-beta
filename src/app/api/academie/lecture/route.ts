import { NextRequest, NextResponse } from 'next/server'
import { aAccesAcademieEssai, droitsAcademie, type AccesAcademieEssai, type DroitsAcademie } from '@/lib/academie/droits'
import { configBibliotheque, configBunny, DUREE_LIEN_S, signerLecture } from '@/lib/academie/bunny'
import { lireLeconParId, lireLeconsParVideo, type LeconComplete } from '@/lib/academie/catalogue'
import { videoEssai } from '@/lib/academie/essai'
import { compteDuJeton, corsAcademie, entetesAcademie, origineDeLaRequete, refusAcademie, tronquer } from '@/lib/academie/http'
import { lireDemandeLecture, ouvertureLecon, type Resultat } from '@/lib/academie/pur'
import { noterLien, type Progression } from '@/lib/academie/suivi'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/lecture : delivrer une lecon de l'academie a un compte
 * qui y a droit (PLAN-ACADEMIE.md, sections 4.3, 5 et 7).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>, corps
 *   { lecon: '<id de lecon>' }   (ecrans de l'academie)
 *   { video: '<guid Bunny>' }    (page d'essai du 15/10, compatibilite)
 * Reponses :
 *   200 { ok: true, raison, raisons, lecon: {...}, reprise_s, progression, ... } avec, selon la lecon
 *       (progression.etat : 'ouvert' des la premiere ouverture, puis en_cours ou vu ; l'ouverture
 *       cree ou rafraichit la ligne de progression pour une video, un texte ou un PDF) :
 *         video Bunny  : hebergeur 'bunny', url (lecteur signe 4 h), expire_le
 *         video Wistia : hebergeur 'wistia', wistia_id (le lecteur Wistia est branche cote site)
 *         texte        : contenu, ressources
 *         pdf          : ressources
 *   400 { ok: false, erreur: 'lecon' | 'video' } corps illisible, ou video d'aucune lecon publiee
 *   401 { ok: false, erreur: 'jeton' }           pas de jeton, ou jeton refuse
 *   403 { ok: false, erreur: 'acces' }           compte sans droit sur cette lecon
 *   404 { ok: false, erreur: 'lecon' }           lecon inconnue, en brouillon ou archivee
 *   409 { ok: false, erreur: 'a_venir' }         lecon ou module annonce, pas encore ouvert
 *   503 { ok: false, erreur: 'config' }          bibliotheque Bunny sans variables
 *   503 { ok: false, erreur: 'indisponible' }    base, Supabase Auth ou Stripe illisible (jamais un faux refus)
 *
 * Dans l'ordre : le compte (jeton verifie aupres de Supabase), la lecon (lue
 * fraiche : publiee, module publie), le droit (droitsAcademie), la livraison,
 * puis le journal (progression et ligne 'lien' dans academie_lectures, au
 * mieux : une panne d'ecriture n'empeche pas l'eleve de regarder, elle est
 * signalee). Le serveur decide, jamais la page.
 *
 * Compatibilite : la page d'essai envoie { video } et lit ok, url, expire_le
 * et le statut HTTP. Si les tables academie_* n'existent pas encore (code
 * deploye avant la migration 20261015210000), la route repond comme avant le
 * 15/10 (liste d'essai en constante, decision B).
 *
 * Logs : compte TRONQUE, lecon ou guid. Jamais l'email, le jeton du compte,
 * la cle Bunny ni l'URL signee.
 */

export const maxDuration = 30

// Preflight : le middleware laisse passer les OPTIONS sur /api/.
export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req) })
}

const configsAbsentesSignalees = new Set<string>()

function signalerConfigAbsente(bibliotheque: string) {
  if (configsAbsentesSignalees.has(bibliotheque)) return
  configsAbsentesSignalees.add(bibliotheque)
  console.warn(`[academie/lecture] bibliotheque Bunny '${bibliotheque}' sans identifiant ou cle de jeton : aucun lien ne peut etre signe.`)
}

function progressionPublique(p: Progression | null) {
  if (!p) return null
  return {
    derniere_position_s: p.dernierePositionS,
    position_max_s: p.positionMaxS,
    secondes_vues: p.secondesVues,
    pourcentage: p.pourcentage,
    terminee_le: p.termineeLe?.toISOString() ?? null,
    marquee_vue_le: p.marqueeVueLe?.toISOString() ?? null,
    vu_le: p.vuLe?.toISOString() ?? null,
    vu_par: p.vuPar,
    // ouvert des l'ouverture (la ligne vient d'etre creee ou rafraichie), en_cours ou vu ensuite.
    etat: p.etat,
  }
}

export async function POST(req: NextRequest) {
  // Un lien signe est personnel et date : ni cache du navigateur, ni cache
  // intermediaire.
  const headers = entetesAcademie(req)
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)

  // 1. Le compte.
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/lecture] verification du jeton impossible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!userId) return refus('jeton', 401)

  // 2. La demande.
  const corps: unknown = await req.json().catch(() => ({}))
  const demande = lireDemandeLecture(corps)
  if (!demande) {
    const parLecon = Boolean(corps && typeof corps === 'object' && 'lecon' in corps)
    return refus(parLecon ? 'lecon' : 'video', 400)
  }

  // 3. La ou les lecons candidates, lues fraiches.
  let candidates: LeconComplete[]
  try {
    if ('lecon' in demande) {
      const l = await lireLeconParId(demande.lecon)
      candidates = l ? [l] : []
    } else {
      candidates = await lireLeconsParVideo(demande.video)
    }
  } catch (err) {
    if ('video' in demande && relationAbsente(err)) return lectureEssaiSansTables(userId, demande.video, headers)
    console.warn(`[academie/lecture] lecon illisible : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }

  if ('lecon' in demande) {
    const l = candidates[0]
    const visible = (s: string) => s === 'publie' || s === 'a_venir'
    if (!l || !visible(l.statut) || !visible(l.moduleStatut)) return refus('lecon', 404)
    if (l.statut === 'a_venir' || l.moduleStatut === 'a_venir') return refus('a_venir', 409)
  } else if (!candidates.length) {
    return refus('video', 400)
  }

  // 4. Le droit.
  let droits: DroitsAcademie
  try {
    droits = await droitsAcademie(userId)
  } catch (err) {
    console.warn(`[academie/lecture] droits illisibles : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  const jugees = candidates.map(l => ({ lecon: l, resultat: ouvertureLecon(droits, l) }))
  const ouverte = jugees.find(j => j.resultat.acces === 'ouvert')
  if (!ouverte) {
    if (jugees.some(j => j.resultat.acces === 'inconnu')) {
      console.warn(`[academie/lecture] droit inconnu compte=${tronquer(userId)} lecon=${candidates[0].id} (${droits.erreurs.join(', ')})`)
      return refus('indisponible', 503)
    }
    console.info(`[academie/lecture] refus compte=${tronquer(userId)} lecon=${candidates[0].id}`)
    return refus('acces', 403)
  }
  const lecon: LeconComplete = ouverte.lecon
  const resultat: Resultat = ouverte.resultat

  // 5. Ce qu'on delivre.
  let livraison: Record<string, unknown>
  if (lecon.type === 'video') {
    if (lecon.hebergeur === 'bunny' && lecon.bunnyVideoId) {
      const bibliotheque = lecon.bunnyBibliotheque ?? ''
      const config = configBibliotheque(bibliotheque)
      if (!config) {
        signalerConfigAbsente(bibliotheque)
        return refus('config', 503)
      }
      const lien = signerLecture(lecon.bunnyVideoId, DUREE_LIEN_S, { config })
      if (!lien) return refus('config', 503)
      livraison = { hebergeur: 'bunny', url: lien.url, expire_le: lien.expireLe }
    } else if (lecon.hebergeur === 'wistia' && lecon.wistiaId) {
      livraison = { hebergeur: 'wistia', wistia_id: lecon.wistiaId }
    } else {
      console.warn(`[academie/lecture] video publiee sans hebergeur : lecon=${lecon.id}`)
      return refus('config', 503)
    }
  } else if (lecon.type === 'texte') {
    livraison = { contenu: lecon.contenu ?? '', ressources: lecon.ressources }
  } else {
    livraison = { ressources: lecon.ressources }
  }

  // 6. Le journal (au mieux).
  let progression: Progression | null = null
  try {
    progression = await noterLien(userId, lecon.id, origineDeLaRequete(req))
  } catch (err) {
    console.warn(`[academie/lecture] journal des lectures NON ecrit compte=${tronquer(userId)} lecon=${lecon.id} : ${messageErreur(err)}`)
  }

  const raison = resultat.raisons[0] ?? null
  console.info(`[academie/lecture] lien compte=${tronquer(userId)} lecon=${lecon.id} raison=${raison}`)
  return NextResponse.json(
    {
      ok: true,
      ...livraison,
      raison,
      raisons: resultat.raisons,
      lecon: {
        id: lecon.id,
        slug: lecon.slug,
        titre: lecon.titre,
        type: lecon.type,
        format: lecon.format,
        duree_s: lecon.dureeS,
        module_id: lecon.moduleId,
        module_slug: lecon.moduleSlug,
        module_titre: lecon.moduleTitre,
        section_id: lecon.sectionId,
      },
      reprise_s: progression?.dernierePositionS ?? 0,
      progression: progressionPublique(progression),
    },
    { headers },
  )
}

let configAbsenteSignalee = false

/**
 * La route d'avant le 15/10 au soir, pour la page d'essai seulement, tant que
 * les tables academie_* n'existent pas : liste d'essai en constante, decision
 * B (aAccesAcademieEssai), bibliotheque « formation ». Rien n'est note.
 */
async function lectureEssaiSansTables(userId: string, guid: string, headers: Record<string, string>) {
  const refus = (erreur: string, status: number) => refusAcademie(erreur, status, headers)
  const video = videoEssai(guid)
  if (!video) return refus('video', 400)

  let droit: AccesAcademieEssai
  try {
    droit = await aAccesAcademieEssai(userId)
  } catch (err) {
    console.warn(`[academie/lecture] droits illisibles : ${messageErreur(err)}`)
    return refus('indisponible', 503)
  }
  if (!droit.acces) {
    console.info(`[academie/lecture] refus compte=${tronquer(userId)} video=${video.id} (sans tables)`)
    return refus('acces', 403)
  }

  const config = configBunny()
  if (!config) {
    if (!configAbsenteSignalee) {
      configAbsenteSignalee = true
      console.warn('[academie/lecture] BUNNY_STREAM_LIBRARY_ID ou BUNNY_STREAM_TOKEN_KEY absente ou mal formee : aucun lien ne peut etre signe.')
    }
    return refus('config', 503)
  }
  const lien = signerLecture(video.id, DUREE_LIEN_S, { config })
  if (!lien) return refus('config', 503)

  console.info(`[academie/lecture] lien compte=${tronquer(userId)} video=${video.id} raison=${droit.raison} (sans tables)`)
  return NextResponse.json(
    { ok: true, url: lien.url, expire_le: lien.expireLe, raison: droit.raison },
    { headers },
  )
}
