// LA REPONSE A UN MEMBRE DEPUIS L'AGENT DU COCKPIT, cote serveur (Brice,
// 16/10/2026) : Brice ou Mel lisent l'alerte « un membre demande un humain »
// dans Agent AOK et repondent d'ici (« reponds-lui : ... »), sans ouvrir
// l'onglet Support. Regles et textes : reponse-membre-pur.ts.
//
// Un seul chemin : l'outil proposer_reponse_membre de l'agent du cockpit
// (agent-cockpit.ts), servi a l'equipe seulement. Comme les autres actions,
// l'agent PROPOSE et c'est le clic qui envoie :
// - Avant la carte (controlerReponseMembre) : le fil est retrouve en lecture
//   seule (transaction READ ONLY), par son identifiant, par la reference
//   courte de l'alerte (« fil 1a2b3c4d »), ou par la personne (resolue comme
//   fiche_personne : le resolveur est passe par l'agent, ce module n'importe
//   pas la fiche). La carte dit le destinataire, ou part le message et le
//   TEXTE EXACT qui partira.
// - Au clic (executerReponseMembre) : l'envoi de l'onglet Support,
//   repondreAuFil (support-reponse.ts), avec ses garde-fous (livraison
//   Telegram verifiee avant toute ecriture, role human, fil qui sort de
//   l'attente). Le resultat dit livre ou non.
// Jamais le texte du message, un nom ni un email dans un log.

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { RefusAction, type ActionAgent } from '@/lib/stripe-actions'
import { nomBot } from '@/lib/liveclub/config'
import { texteReponseEquipe } from '@/lib/liveclub/support-pont'
import { referenceFil } from '@/lib/alerte-equipe-telegram-pur'
import { repondreAuFil, type FichierReponse } from '@/lib/support-reponse'
import { telechargerFichierTelegram } from '@/lib/liveclub/telegram'
import {
  MAX_FICHIER_AGENT, descriptionFichier, formaterTaille, legendeFichier, lireFichierSortant, phraseMainRendue, refusLegende,
  type FichierLu, type PieceAgent,
} from '@/lib/liveclub/support-pont-pur'
import {
  lireParamsReponseMembre, lireFil, choisirFilParReference, choisirFilParPersonne, repartirFilsParPersonne,
  reponsePlusieursFils, composerCarteReponse, libelleDestinataire, phraseIssueReponse,
  type CanalReponse, type ChoixFil, type FilCandidat, type PersonneFils,
} from '@/lib/reponse-membre-pur'

type Tx = Prisma.TransactionClient

/** La personne designee, telle que la rend resoudrePersonnePourSupport (fiche-personne.ts). */
export type ResolutionPersonneSupport =
  | { statut: 'personnes'; groupes: { telegram: number[]; membres: string[] }[]; email: string | null }
  | { statut: 'aucun' | 'erreur'; reponse: string; email: string | null }

export type ControleReponseMembre =
  | { erreur: string }
  | { action: ActionAgent; carte: string; manque: string | null }

const RIEN = "Rien n'a été proposé."

function premiereLigne(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return (brut.split('\n').filter(Boolean).pop() ?? '').slice(0, 160)
}

/** Lecture seule, delai borne : meme une erreur de ce code ne peut rien ecrire. */
async function enLectureSeule<T>(f: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
    return f(tx)
  }, { maxWait: 5000, timeout: 25000 })
}

type LigneFil = {
  id: string
  app: string
  telegram_id: bigint | null
  membre_id: string | null
  email: string | null
  nom: string | null
  pseudo: string | null
  attend_le: string | null
  attend_t: number | null
  maj_le: string
  maj_t: number
}

/**
 * Les fils Support qui repondent a la condition, avec de quoi dire a qui ils
 * sont : nom et pseudo Telegram (registre du groupe), sinon le nom de la
 * fiche membre (par le fil, ou par l'email), email du compte AOK ou donne au
 * bot. Dates a l'heure de Paris (colonnes Prisma en UTC sans fuseau).
 */
const SELECT_FILS = `
  select t.id, t.app, t."telegramId" as telegram_id, t."membreId" as membre_id,
    coalesce(u.email::text, t."contactEmail") as email,
    coalesce(g.nom_affiche, m1.nom, m2.nom) as nom, g.pseudo,
    to_char((t."escalatedAt" at time zone 'UTC') at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI') as attend_le,
    (extract(epoch from t."escalatedAt") * 1000)::float8 as attend_t,
    to_char((t."updatedAt" at time zone 'UTC') at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI') as maj_le,
    (extract(epoch from t."updatedAt") * 1000)::float8 as maj_t
  from public."SupportThread" t
  left join auth.users u on u.id::text = t."userId"
  left join public.cockpit_telegram_membres g on g.telegram_id = t."telegramId"
  left join lateral (
    select me.nom from public.cockpit_membres_etat me where me.membre_id::text = t."membreId" limit 1) m1 on true
  left join lateral (
    select me.nom from public.cockpit_membre_emails e
    join public.cockpit_membres_etat me on me.membre_id = e.membre_id
    where lower(e.email) = lower(coalesce(u.email::text, t."contactEmail"))
    order by e.principal desc nulls last limit 1) m2 on true`

const CONDITIONS = {
  id: 't.id = $1',
  prefixe: 'lower(t.id) like $1',
  // $1 comptes Telegram, $2 fiches membres, $3 emails (en minuscules).
  personnes: `(t."telegramId" = any($1::bigint[]) or t."membreId" = any($2::text[])
    or lower(coalesce(u.email::text, t."contactEmail")) in (
      select lower(e.email) from public.cockpit_membre_emails e where e.membre_id::text = any($2::text[]))
    or lower(coalesce(u.email::text, t."contactEmail")) = any($3::text[]))`,
} as const

async function lireFils(tx: Tx, condition: keyof typeof CONDITIONS, params: unknown[]): Promise<FilCandidat[]> {
  const lignes = await tx.$queryRawUnsafe<LigneFil[]>(
    `${SELECT_FILS}\n  where ${CONDITIONS[condition]}\n  order by t."updatedAt" desc\n  limit 50`, ...params)
  return lignes.map((l) => {
    const tg = l.telegram_id === null ? null : Number(l.telegram_id)
    return {
      id: l.id,
      reference: referenceFil(l.id) ?? `fil ${l.id.slice(0, 8)}`,
      app: l.app,
      telegramId: tg !== null && Number.isSafeInteger(tg) ? tg : null,
      membreId: l.membre_id,
      nom: l.nom,
      pseudo: l.pseudo,
      email: l.email,
      attendLe: l.attend_le,
      attendT: l.attend_t === null ? null : Number(l.attend_t),
      majLe: l.maj_le,
      majT: Number(l.maj_t),
    }
  })
}

/** Les emails des fiches membres de ces personnes, par fiche. */
async function emailsDesFiches(tx: Tx, membres: string[]): Promise<Map<string, string[]>> {
  const r = new Map<string, string[]>()
  if (membres.length === 0) return r
  const lignes = await tx.$queryRawUnsafe<{ membre_id: string; email: string }[]>(
    `select membre_id::text as membre_id, lower(email) as email from public.cockpit_membre_emails
     where membre_id::text = any($1::text[])`, membres)
  for (const l of lignes) r.set(l.membre_id, [...(r.get(l.membre_id) ?? []), l.email])
  return r
}

function lireErreurResolveur(reponse: string): string {
  try {
    return `${String((JSON.parse(reponse) as { erreur?: unknown }).erreur ?? 'Recherche impossible.')} ${RIEN}`
  } catch {
    return `Recherche de la personne impossible : réessaie dans un instant. ${RIEN}`
  }
}

export type Resolveur = (qui: string) => Promise<ResolutionPersonneSupport>

/**
 * Le fil designe par `fil` (reference d'alerte, identifiant, ou personne), en
 * lecture seule. `erreur` = rien de choisi (plusieurs, aucun, panne), a rendre
 * au modele. `homonymes` : un nom qui designe plusieurs personnes, dont une
 * seule a un fil (dit sur la carte).
 */
async function resoudreFil(
  fil: string,
  resoudre: Resolveur,
): Promise<{ erreur: string } | { choix: Extract<ChoixFil, { statut: 'un' }>; homonymes: { cherche: string; personnes: number } | null }> {
  const cible = lireFil(fil)
  let choix: ChoixFil
  let homonymes: { cherche: string; personnes: number } | null = null
  try {
    if (cible.genre === 'id') {
      choix = choisirFilParReference(await enLectureSeule((tx) => lireFils(tx, 'id', [cible.id])))
      if (choix.statut === 'aucun') {
        return { erreur: `Aucun fil Support n'a l'identifiant ${cible.id} (une fiche membre s'écrit membre:<uuid>). ${RIEN}` }
      }
    } else if (cible.genre === 'prefixe') {
      choix = choisirFilParReference(await enLectureSeule((tx) => lireFils(tx, 'prefixe', [`${cible.prefixe}%`])))
      if (choix.statut === 'aucun') {
        return { erreur: `Aucun fil Support pour la référence « fil ${cible.prefixe} » : relis celle de l'alerte, `
          + `ou passe la personne (nom, @pseudo, u..., email). ${RIEN}` }
      }
    } else {
      const r = await resoudre(cible.qui)
      if (r.statut === 'erreur') return { erreur: lireErreurResolveur(r.reponse) }
      const emailsDonnes = r.email ? [r.email.toLowerCase()] : []
      const groupes = r.statut === 'personnes' ? r.groupes : []
      if (groupes.length === 0 && emailsDonnes.length === 0) {
        return { erreur: `Aucune personne trouvée pour « ${cible.qui} » : ni nom, ni compte Telegram, ni fiche. Demande une autre `
          + `orthographe, le @pseudo, le numéro Telegram (u...) ou son email ; une référence d'alerte s'écrit « fil 1a2b3c4d ». ${RIEN}` }
      }
      choix = await enLectureSeule(async (tx) => {
        const parFiche = await emailsDesFiches(tx, [...new Set(groupes.flatMap((g) => g.membres))])
        const personnes: PersonneFils[] = (groupes.length ? groupes : [{ telegram: [], membres: [] }]).map((g) => ({
          telegram: g.telegram,
          membres: g.membres,
          emails: [...new Set([...emailsDonnes, ...g.membres.flatMap((m) => parFiche.get(m) ?? [])])],
        }))
        const fils = await lireFils(tx, 'personnes', [
          [...new Set(personnes.flatMap((g) => g.telegram))],
          [...new Set(personnes.flatMap((g) => g.membres))],
          emailsDonnes,
        ])
        return choisirFilParPersonne(repartirFilsParPersonne(fils, personnes))
      })
      if (choix.statut === 'aucun') {
        return { erreur: `« ${cible.qui} » : ${groupes.length > 1 ? 'aucune des personnes trouvées n\'a' : 'pas'} de fil Support `
          + `(jamais écrit au bot des membres ni au support du site) : il n'y a nulle part où lui répondre d'ici. ${RIEN}` }
      }
      if (groupes.length > 1) homonymes = { cherche: cible.qui, personnes: groupes.length }
    }
  } catch (err) {
    console.error(`[cockpit/reponse-membre] fils illisibles : ${premiereLigne(err)}`)
    return { erreur: `Lecture des fils Support impossible (${premiereLigne(err)}) : réessaie dans un instant. ${RIEN}` }
  }

  if (choix.statut === 'plusieurs') return { erreur: reponsePlusieursFils(choix) }
  if (choix.statut !== 'un') return { erreur: `Aucun fil Support trouvé. ${RIEN}` }
  return { choix, homonymes }
}

/**
 * Le controle AVANT la carte. `erreur` retourne au modele (il demande, ou dit
 * pourquoi) ; sinon l'action complete (fil resolu), la carte composee par le
 * serveur, et ce qui manque pour envoyer.
 * (16/10) `piece` : la derniere piece recue dans Agent AOK (canal de l'agent),
 * jointe si le modele le demande (piece_jointe) ; jamais une piece du modele.
 */
export async function controlerReponseMembre(
  a: ActionAgent,
  resoudre: Resolveur,
  piece: PieceAgent | null = null,
): Promise<ControleReponseMembre> {
  const p = lireParamsReponseMembre(a.params)
  if (typeof p === 'string') return { erreur: p }

  // La piece d'abord : sans elle, rien a chercher.
  let fichier: FichierLu | null = null
  if (p.piece_jointe) {
    if (!piece) {
      return { erreur: "Aucune pièce jointe reçue ici : demande qu'on t'envoie le fichier dans Agent AOK (photo ou fichier), "
        + `avec la demande en légende ou juste avant. Depuis la fenêtre du cockpit, c'est le bouton « joindre » de l'onglet Support. ${RIEN}` }
    }
    const lu = lireFichierSortant(piece, MAX_FICHIER_AGENT)
    if (typeof lu === 'string') return { erreur: `${lu} ${RIEN}` }
    fichier = lu
  }
  // Une piece passee par le modele lui-meme ne compte pas : sans piece, il faut un texte.
  if (!fichier && !p.texte) return { erreur: `texte vide : rien à envoyer. ${RIEN}` }

  const r = await resoudreFil(p.fil, resoudre)
  if ('erreur' in r) return r
  const { choix, homonymes } = r
  const f = choix.fil
  const canal: CanalReponse = f.app === 'telegram' ? 'telegram' : 'site'
  if (canal === 'telegram' && !f.telegramId) {
    return { erreur: `Le ${f.reference} est un fil Telegram sans compte : réponse impossible à livrer. ${RIEN}` }
  }
  if (fichier && canal !== 'telegram') {
    return { erreur: `Le chat du site (app ${f.app}) n'affiche que du texte : je ne peux pas y envoyer de fichier. `
      + `Propose la réponse sans pièce jointe, ou un lien. ${RIEN}` }
  }
  // Ce que le membre lira : exactement ce que l'envoi produira.
  const texteEnvoye = fichier ? legendeFichier(p.texte) : canal === 'telegram' ? texteReponseEquipe(p.texte) : p.texte
  const refus = fichier ? refusLegende(texteEnvoye) : null
  if (refus) return { erreur: `${refus} ${RIEN}` }
  const carte = composerCarteReponse({
    fil: f, canal, texteEnvoye, botMembres: nomBot(), pourquoi: choix.pourquoi, total: choix.total, homonymes,
    piece: fichier ? descriptionFichier(fichier) : null,
  })
  const manque = canal === 'telegram' && !process.env.TELEGRAM_LIVECLUB_BOT_TOKEN?.trim()
    ? "Le bot des membres n'est pas configuré (TELEGRAM_LIVECLUB_BOT_TOKEN absent du projet journal) : rien ne peut partir dans Telegram."
    : fichier && piece?.bot === 'cockpit' && !process.env.TELEGRAM_BOT_TOKEN_COCKPIT?.trim()
      ? "Le bot Agent AOK n'est pas configuré (TELEGRAM_BOT_TOKEN_COCKPIT absent du projet journal) : la pièce jointe ne peut pas être relue."
      : null
  return {
    // Les champs resolus ECRASENT ceux que le modele aurait passes.
    action: {
      type: 'reponse_membre',
      compte: 'cockpit',
      params: {
        fil: p.fil, texte: p.texte, fil_id: f.id, qui: libelleDestinataire(f), reference: f.reference, canal, app: f.app,
        ...(fichier && piece ? { piece_jointe: true, piece } : {}),
      },
    },
    carte,
    manque,
  }
}

/**
 * « Rends la main au bot » dit a l'agent (16/10) : le fil de la derniere
 * alerte (sa reference) ou celui d'une personne, puis le meme geste que le
 * bouton (rendreLaMainAuBot, support-pont.ts). Sans carte : rien ne part au
 * membre, et l'equipe reprend la main en lui repondant. Rend la phrase pour
 * le modele. Ne jette pas.
 */
export async function rendreLaMainPourAgent(entree: unknown, resoudre: Resolveur): Promise<string> {
  const fil = entree && typeof entree === 'object' ? (entree as { fil?: unknown }).fil : null
  if (typeof fil !== 'string' || !fil.trim()) {
    return JSON.stringify({ erreur: "fil manquant : la référence de l'alerte (« fil 1a2b3c4d ») ou la personne." })
  }
  try {
    const r = await resoudreFil(fil.slice(0, 120), resoudre)
    if ('erreur' in r) return JSON.stringify({ erreur: r.erreur.replace(RIEN, "Rien n'a changé.") })
    const { rendreLaMainAuBot } = await import('@/lib/liveclub/support-pont')
    const issue = await rendreLaMainAuBot(r.choix.fil.id)
    return JSON.stringify({ fait: issue.ok, resultat: phraseMainRendue(issue, r.choix.fil.reference), qui: libelleDestinataire(r.choix.fil) })
  } catch (err) {
    console.error(`[cockpit/reponse-membre] main non rendue : ${premiereLigne(err)}`)
    return JSON.stringify({ erreur: "Base illisible : la main n'a pas été rendue au bot. Réessaie dans un instant." })
  }
}

/**
 * Au clic : l'envoi de l'onglet Support, sur le fil resolu avant la carte,
 * avec le texte de la carte. Renvoie la phrase du resultat ; RefusAction si
 * une regle bloque (rien n'est parti), Error si rien n'est parti sur une panne
 * ou un refus de Telegram. Livre mais pas enregistre : une phrase (pas une
 * erreur), pour que personne ne la renvoie.
 */
export async function executerReponseMembre(a: ActionAgent): Promise<string> {
  const p = lireParamsReponseMembre(a.params)
  if (typeof p === 'string') throw new RefusAction(`${p} Rien n'a été envoyé.`)
  if (!p.fil_id) throw new RefusAction("Carte incomplète (fil non résolu) : rien n'a été envoyé, redemande la réponse.")
  if (p.piece_jointe && !p.piece) throw new RefusAction("Carte incomplète (pièce jointe absente) : rien n'a été envoyé, redemande la réponse.")

  // (16/10) La piece : relue, puis telechargee en memoire avec le jeton du bot
  // qui l'a recue (Agent AOK), ou reprise par son file_id si c'est un fichier
  // du bot des membres. Rien n'est parti si elle est illisible.
  let fichier: FichierReponse | null = null
  if (p.piece) {
    const lu = lireFichierSortant(p.piece, MAX_FICHIER_AGENT)
    if (typeof lu === 'string') throw new RefusAction(`${lu} Rien n'a été envoyé.`)
    if (p.piece.bot === 'liveclub') {
      fichier = { lu, fileIdMembres: p.piece.file_id }
    } else {
      const charge = await telechargerFichierTelegram('cockpit', p.piece.file_id, MAX_FICHIER_AGENT, p.piece.taille)
      if (!charge.ok) {
        throw new Error(charge.raison === 'trop_gros'
          ? `Pièce jointe trop lourde (${formaterTaille(charge.taille)}, 20 Mo au plus) : rien n'a été envoyé.`
          : "Pièce jointe illisible chez Telegram pour le moment : rien n'a été envoyé. Réessaie dans un instant.")
      }
      fichier = { lu: { ...lu, taille: charge.octets.byteLength }, octets: charge.octets }
    }
  }

  let issue: Awaited<ReturnType<typeof repondreAuFil>>
  try {
    issue = await repondreAuFil(p.fil_id, p.texte, '[cockpit/reponse-membre]', fichier)
  } catch (err) {
    // repondreAuFil ne jette qu'avant tout envoi (fil illisible) ou sur
    // l'ecriture d'un fil du site : rien n'est parti.
    console.error(`[cockpit/reponse-membre] envoi impossible : ${premiereLigne(err)}`)
    throw new Error("Base illisible : rien n'a été envoyé ni enregistré. Réessaie dans un instant.")
  }
  const phrase = phraseIssueReponse(issue, { qui: p.qui ?? 'le membre', reference: p.reference ?? referenceFil(p.fil_id) })
  if (phrase.genre === 'refus') throw new RefusAction(phrase.texte)
  if (phrase.genre === 'echec') throw new Error(phrase.texte)
  return phrase.texte
}
