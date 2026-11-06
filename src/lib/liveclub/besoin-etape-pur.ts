// « IL ME MANQUE QUELQUE CHOSE » DANS LE BOT DES MEMBRES (lot 2 des besoins
// des membres, 06/11/2026) : les regles PURES de l'etape, ses boutons et ses
// textes. Aucune base, aucun reseau (scripts/verifier-besoins.mjs). La
// lecture, l'ecriture et l'enregistrement : besoin-etape.ts ; le branchement :
// bot-membre.ts.
//
// Le parcours :
// 1. Le bouton « Il me manque quelque chose » (menu, menu d'un acces offert) :
//    le bot demande en un message ce qui manque. L'etape est un ETAT en base
//    (cockpit_liveclub_conversations.action_en_attente, type besoin_texte,
//    10 minutes, nonce), relu avant chaque message (regle « etat et sens »,
//    jamais une sequence supposee) ; tout autre bouton ou commande la ferme.
// 2. Le message suivant : « annule », « laisse tomber »... ferme l'etape ; un
//    mot courant (« ok », « merci ») ou trop court fait redemander ; un texte
//    devient une demande (canal telegram, detecte_par bouton, son fil Support
//    garde le message), puis la phrase du serveur.
// 3. Un texte suspect (texte cache, consigne adressee a une IA) n'est pas
//    enregistre par cette voie (refus sous prudence, Brice prevenu) : le
//    membre est invite a le redire simplement. Le message reste dans son fil.

/** Le bouton du menu. callback_data court (<= 64 octets). */
export const BOUTON_BESOIN = { texte: 'Il me manque quelque chose', data: 'm:besoin' } as const

/** Le bouton « Laisser tomber » sous la question : bx:<nonce>. */
export const LIBELLE_LAISSER_BESOIN = 'Laisser tomber'

/** L'etape vaut 10 minutes : au-dela, un message reprend le parcours habituel (l'agent). */
export const VALIDITE_ETAPE_BESOIN_MIN = 10

export const TYPE_ETAPE_BESOIN = 'besoin_texte'

export type EtapeBesoin = { type: 'besoin_texte'; expire: string }

export function nouvelleEtapeBesoin(maintenant: number): EtapeBesoin {
  return { type: TYPE_ETAPE_BESOIN, expire: new Date(maintenant + VALIDITE_ETAPE_BESOIN_MIN * 60_000).toISOString() }
}

/** Une etape lue en base (jsonb) : la forme exacte, sinon rien. */
export function estEtapeBesoin(v: unknown): v is EtapeBesoin {
  const x = v as { type?: unknown; expire?: unknown } | null
  return !!x && x.type === TYPE_ETAPE_BESOIN && typeof x.expire === 'string' && Number.isFinite(Date.parse(x.expire))
}

export function etapeBesoinExpiree(e: EtapeBesoin, maintenant: number): boolean {
  return Date.parse(e.expire) < maintenant
}

/** « Laisser tomber » : bx:<nonce>. */
export function lireBoutonBesoin(data: string): { nonce: string } | null {
  const m = /^bx:([A-Za-z0-9_-]{8,32})$/.exec(data)
  return m ? { nonce: m[1] } : null
}

export type BoutonBesoin = { texte: string; data: string }

export function boutonsEtapeBesoin(nonce: string): BoutonBesoin[][] {
  return [[{ texte: LIBELLE_LAISSER_BESOIN, data: `bx:${nonce}` }]]
}

export type EntreeBesoin =
  | { genre: 'texte'; texte: string }
  /** « annule », « laisse tomber » : l'etape se ferme. */
  | { genre: 'annuler' }
  /** Un mot courant, ou trop court : le bot redemande. */
  | { genre: 'relance' }

const ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')
const APOSTROPHES = new RegExp(`['${String.fromCharCode(0x2019)}]`, 'g')
const cleDe = (t: string) => t.toLowerCase().normalize('NFD').replace(ACCENTS, '').replace(APOSTROPHES, '').replace(/[\s!?.,;:]+$/, '').replace(/\s+/g, ' ').trim()

const ANNULER = new Set([
  'annule', 'annuler', 'stop', 'non', 'nan', 'laisse', 'laisse tomber', 'laisser tomber', 'abandon', 'non merci', 'pas maintenant',
  'plus tard', 'on oublie', 'oublie', 'rien', 'finalement rien', 'cest bon', 'ca ira', 'tant pis',
])
const COURANTS = new Set([
  'ok', 'okay', 'oki', 'oui', 'ouais', 'yes', 'merci', 'mercii', 'salut', 'bonjour', 'bonsoir', 'hello', 'coucou', 'super', 'top',
  'cool', 'parfait', 'daccord', 'go', 'attends', 'attend', 'euh', 'hmm', 'quoi', 'comment', 'pourquoi', 'aide', 'help',
])

/** Le texte mini d'un besoin (le meme plancher que le bouton des outils). */
export const TEXTE_BESOIN_MIN = 5

/** Ce que le membre ecrit pendant l'etape. Seul un vrai texte devient une demande. */
export function lireEntreeBesoin(texte: string): EntreeBesoin {
  const t = (typeof texte === 'string' ? texte : '').trim()
  const cle = cleDe(t)
  if (ANNULER.has(cle)) return { genre: 'annuler' }
  if (!cle || COURANTS.has(cle) || t.length < TEXTE_BESOIN_MIN) return { genre: 'relance' }
  return { genre: 'texte', texte: t }
}

// ---------------------------------------------------------------------------
// Les textes du bot (A VALIDER PAR BRICE)
// ---------------------------------------------------------------------------

/** La question. A VALIDER PAR BRICE. */
export const TEXTE_ETAPE_BESOIN = "Dis-moi en un message ce qui te manque dans nos outils (le Carnet, le Journal, Pilotage, l'académie, le site ou ce bot) : une fonction qui n'existe pas, un blocage ou un bug. Ton message arrive tel quel à l'équipe."

/** Un mot courant pendant l'etape. A VALIDER PAR BRICE. */
export const TEXTE_RELANCE_BESOIN = "Écris-moi en une ou deux phrases ce qui te manque, ou appuie sur « Laisser tomber »."

/** L'etape fermee par le membre. A VALIDER PAR BRICE. */
export const TEXTE_ANNULE_BESOIN = `OK, rien n'est noté. Si quelque chose te manque plus tard, appuie sur « ${BOUTON_BESOIN.texte} ».`

/** Un texte suspect : refuse sous prudence, sans dire pourquoi. A VALIDER PAR BRICE. */
export const TEXTE_PRUDENCE_BESOIN = `Je n'ai pas pu le noter tel quel. Réécris-moi simplement ce qui te manque, en une phrase, après avoir appuyé sur « ${BOUTON_BESOIN.texte} ».`

/** Plus de 5 signalements en 24 heures. A VALIDER PAR BRICE. */
export const TEXTE_QUOTA_BESOIN = `J'ai déjà noté plusieurs besoins de ta part aujourd'hui. Garde celui-ci pour demain : appuie à nouveau sur « ${BOUTON_BESOIN.texte} ».`

/** Une panne. A VALIDER PAR BRICE. */
export const TEXTE_PANNE_BESOIN = `Souci technique de mon côté, rien n'est noté. Réessaie dans un moment avec « ${BOUTON_BESOIN.texte} ».`

/** « Laisser tomber » sur une etape deja fermee. A VALIDER PAR BRICE. */
export const TEXTE_PERIME_BESOIN = `Ce bouton ne marche plus. Si quelque chose te manque, appuie sur « ${BOUTON_BESOIN.texte} ».`
