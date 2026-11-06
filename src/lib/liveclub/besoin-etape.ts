// « IL ME MANQUE QUELQUE CHOSE » DANS LE BOT DES MEMBRES (lot 2 des besoins
// des membres, 06/11/2026) : l'etape en base et l'enregistrement. Les regles et
// les textes : besoin-etape-pur.ts ; l'envoi et la trace au fil Support :
// bot-membre.ts (envoyer, enregistrerEchangeSupport).
//
// L'ETAPE : cockpit_liveclub_conversations.action_en_attente (le meme
// emplacement que les confirmations et l'indicateur d'Alex), type
// besoin_texte, avec un nonce. Une proposition (pause, arret...) ou l'etape de
// l'indicateur la remplace ; tout autre bouton ou commande la ferme
// (oublierEtapeBesoin) ; « Laisser tomber » (bx:) ne consomme que SON nonce.
// Un message ecrit pendant l'etape la CONSOMME en un seul UPDATE avant d'etre
// enregistre : deux messages simultanes, une seule demande.
//
// Securite : un texte suspect (niveau 'injection') n'est pas enregistre par
// cette voie et Brice est prevenu ; le membre est invite a le redire.
// Jamais de texte de membre dans un log.

import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { alerterBriceSecurite } from '@/lib/securite/alerte'
import { analyserTexte } from '@/lib/securite/injection-pur'
import { PHRASE_BOUTON_BESOIN } from '@/lib/besoins/bouton-pur'
import { signalerDepuisBot } from '@/lib/besoins/membres'
import { messageErreur } from './pur'
import {
  TEXTE_ANNULE_BESOIN, TEXTE_ETAPE_BESOIN, TEXTE_PANNE_BESOIN, TEXTE_PERIME_BESOIN, TEXTE_PRUDENCE_BESOIN,
  TEXTE_QUOTA_BESOIN, TEXTE_RELANCE_BESOIN, TYPE_ETAPE_BESOIN,
  boutonsEtapeBesoin, estEtapeBesoin, etapeBesoinExpiree, lireEntreeBesoin, nouvelleEtapeBesoin, type BoutonBesoin,
} from './besoin-etape-pur'

/** Ce que le bot envoie au membre. `equipe` : joindre « Contacter l'equipe ». */
export type ReponseBesoin = { texte: string; boutons?: BoutonBesoin[][]; equipe?: true }

/** « Il me manque quelque chose » : l'etape posee, la question. Ne jette pas. */
export async function ouvrirEtapeBesoin(telegramId: number): Promise<ReponseBesoin> {
  const nonce = randomBytes(9).toString('base64url')
  try {
    await prisma.$executeRaw`
      insert into public.cockpit_liveclub_conversations (telegram_id, action_en_attente, nonce, maj_le)
      values (${telegramId}, ${JSON.stringify(nouvelleEtapeBesoin(Date.now()))}::jsonb, ${nonce}, now())
      on conflict (telegram_id) do update set
        action_en_attente = excluded.action_en_attente, nonce = excluded.nonce, maj_le = now()`
  } catch (err) {
    console.warn(`[liveclub/besoin] etape non posee : ${messageErreur(err).slice(0, 160)}`)
    return { texte: TEXTE_PANNE_BESOIN, equipe: true }
  }
  return { texte: TEXTE_ETAPE_BESOIN, boutons: boutonsEtapeBesoin(nonce) }
}

/** L'etape en cours de ce compte (pas expiree), ou null. Ne jette pas (panne = pas d'etape : le parcours habituel). */
async function lireEtapeBesoin(telegramId: number): Promise<{ nonce: string } | null> {
  try {
    const l = (await prisma.$queryRaw<{ action_en_attente: unknown; nonce: string | null }[]>`
      select action_en_attente, nonce from public.cockpit_liveclub_conversations
      where telegram_id = ${telegramId} and nonce is not null and action_en_attente ->> 'type' = ${TYPE_ETAPE_BESOIN}
      limit 1`)[0]
    if (!l?.nonce || !estEtapeBesoin(l.action_en_attente) || etapeBesoinExpiree(l.action_en_attente, Date.now())) return null
    return { nonce: l.nonce }
  } catch {
    return null
  }
}

/** Consomme le nonce de CE compte pour l'etape, en un seul UPDATE. true = consomme ici, pas expire. */
async function consommerEtapeBesoin(telegramId: number, nonce: string): Promise<boolean | 'expire'> {
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return false
  const l = await prisma.$queryRaw<{ action_en_attente: unknown }[]>`
    update public.cockpit_liveclub_conversations set nonce = null, maj_le = now()
    where telegram_id = ${telegramId} and nonce = ${nonce} and action_en_attente ->> 'type' = ${TYPE_ETAPE_BESOIN}
    returning action_en_attente`
  const e = l[0]?.action_en_attente
  if (!estEtapeBesoin(e)) return false
  return etapeBesoinExpiree(e, Date.now()) ? 'expire' : true
}

/** Un autre bouton ou une commande : l'etape se ferme (un message suivant ne sera pas pris pour un besoin). Ne jette pas. */
export async function oublierEtapeBesoin(telegramId: number): Promise<void> {
  try {
    await prisma.$executeRaw`
      update public.cockpit_liveclub_conversations set nonce = null, maj_le = now()
      where telegram_id = ${telegramId} and nonce is not null and action_en_attente ->> 'type' = ${TYPE_ETAPE_BESOIN}`
  } catch {
    // Rien : l'etape expire seule au bout de 10 minutes.
  }
}

/** « Laisser tomber » (bx:<nonce>). Ne jette pas. */
export async function annulerEtapeBesoin(telegramId: number, nonce: string): Promise<ReponseBesoin> {
  try {
    const c = await consommerEtapeBesoin(telegramId, nonce)
    return c === true ? { texte: TEXTE_ANNULE_BESOIN } : { texte: TEXTE_PERIME_BESOIN }
  } catch (err) {
    console.warn(`[liveclub/besoin] annulation illisible : ${messageErreur(err).slice(0, 160)}`)
    return { texte: TEXTE_ANNULE_BESOIN }
  }
}

/**
 * Le message ecrit pendant l'etape, AVANT sa trace au fil. null = pas d'etape
 * (ou elle vient d'etre prise par un autre message) : le parcours habituel.
 * Sinon : 'relance' (l'etape reste), 'annule' (consommee), ou 'texte'
 * (consommee : l'appelant trace le message puis appelle enregistrerBesoinDuBot).
 */
export async function lireMessageEtapeBesoin(telegramId: number, texte: string): Promise<
  | null
  | { genre: 'relance'; reponse: ReponseBesoin }
  | { genre: 'annule'; reponse: ReponseBesoin }
  | { genre: 'texte'; texte: string }
> {
  const e = await lireEtapeBesoin(telegramId)
  if (!e) return null
  const entree = lireEntreeBesoin(texte)
  if (entree.genre === 'relance') return { genre: 'relance', reponse: { texte: TEXTE_RELANCE_BESOIN, boutons: boutonsEtapeBesoin(e.nonce) } }
  let pris: boolean | 'expire'
  try {
    pris = await consommerEtapeBesoin(telegramId, e.nonce)
  } catch {
    return null
  }
  if (pris !== true) return null
  return entree.genre === 'annuler' ? { genre: 'annule', reponse: { texte: TEXTE_ANNULE_BESOIN } } : { genre: 'texte', texte: entree.texte }
}

/**
 * Le texte du besoin, deja trace au fil Support (texteFil = tel qu'il y est,
 * filId = son fil). Suspect : rien d'enregistre par cette voie, Brice prevenu.
 * Sinon la demande (classement Haiku, regroupement), puis la phrase. Ne jette pas.
 */
export async function enregistrerBesoinDuBot(o: {
  telegramId: number; qui: string | null; filId: string | null; membreId: string | null; texteFil: string
}): Promise<ReponseBesoin> {
  const analyse = analyserTexte(o.texteFil, { niveau: 'injection' })
  if (analyse.suspect) {
    await alerterBriceSecurite({
      source: 'bot Live Club, « Il me manque quelque chose »', qui: o.qui ?? `u${o.telegramId}`, analyse,
      suite: "Rien n'est noté par ce bouton (le membre est invité à le redire simplement) ; son message est dans son fil Support.",
    })
    return { texte: TEXTE_PRUDENCE_BESOIN }
  }
  const issue = await signalerDepuisBot({ telegramId: o.telegramId, filId: o.filId, membreId: o.membreId, texte: o.texteFil })
  if (issue === 'ok') return { texte: PHRASE_BOUTON_BESOIN }
  if (issue === 'quota') return { texte: TEXTE_QUOTA_BESOIN }
  return { texte: TEXTE_PANNE_BESOIN, equipe: true }
}
