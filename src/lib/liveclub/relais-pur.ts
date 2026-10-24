// Regles PURES du RELAIS D'ACCUEIL du Live Club (Brice, 24/10) : aucune base,
// aucun reseau, aucun import de valeur (scripts/verifier-relais-accueil.mjs
// les charge telles quelles). La lecture, la garde et l'envoi vivent dans
// relais.ts.
//
// Le resume du matin liste les membres a contacter, ni Brice ni Melanie n'ont
// le temps de le faire. Alex Auger, membre actif, prend le relais : le bot
// des membres lui envoie en prive, une fois par jour, les membres a qui dire
// un mot. Regles tenues ici :
// - deux fenetres seulement, accueil (nouveau, pas encore un mot) et silence
//   (plus de message depuis 14 jours). JAMAIS echec ni prelevement : ce sont
//   des infos de paiement, elles restent a l'equipe. Le filtre est ici ET en
//   base (contraintes de cockpit_liveclub_relais et de ses episodes) ;
// - seulement des membres PRESENTS dans le groupe, hors equipe
//   (cockpit_telegram_comptes), admins et createur, comptes exemptes, et
//   jamais un relais (lui-meme compris) : un seul compte ecarte suffit a
//   ecarter le membre ;
// - par membre : le nom Telegram, le @pseudo s'il existe (sinon un lien
//   tg://user?id=..., qui ouvre son profil), le motif en mots simples. Jamais
//   d'email, de montant, d'etat d'abonnement ni de paiement : rien de tout ca
//   n'entre dans une LigneRelais ;
// - un episode (membre_id::cle_episode, la cle du cockpit et du resume) n'est
//   transmis qu'une fois a un relais, et jamais s'il est deja marque fait ;
// - le bouton « C'est fait » (rl:<episode_id>) ne vaut que pour le relais de
//   l'episode, s'il est toujours actif.

import type { MotifContact } from './resume-pur'

export type MotifRelais = 'accueil' | 'silence'

/** Les seules fenetres qu'un relais peut recevoir, dans l'ordre des messages. */
export const MOTIFS_RELAIS: readonly MotifRelais[] = ['accueil', 'silence']

export const estMotifRelais = (m: unknown): m is MotifRelais => m === 'accueil' || m === 'silence'

/** Les motifs d'un relais lus en base : accueil et silence seulement, dans cet ordre, sans doublon. */
export function motifsDuRelais(brut: unknown): MotifRelais[] {
  const liste = Array.isArray(brut) ? brut : []
  return MOTIFS_RELAIS.filter(m => liste.includes(m))
}

export type RelaisLu = { telegramId: number; nom: string; motifs: MotifRelais[]; presenteLe: string | null }

// ---------------------------------------------------------------------------
// Textes tapes par des tiers (noms, pseudos)
// ---------------------------------------------------------------------------

// Caracteres de controle et invisibles, construits par leur code (meme liste
// que texteSur, resume-pur.ts : ce module n'importe aucune valeur).
const INVISIBLES = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`, 'g')

/** Un nom tape par un tiers : une ligne, sans controle, `max` caracteres au plus, ou null. */
export function nomPropre(brut: unknown, max = 40): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.replace(INVISIBLES, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 3).trimEnd()}...` : s
}

/** Un pseudo Telegram valide (5 a 32 caracteres, lettres, chiffres, _), sans @, ou null. */
export function pseudoPropre(brut: unknown): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.trim().replace(/^@+/, '')
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s) ? s : null
}

export function echapperHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Qui transmettre
// ---------------------------------------------------------------------------

/** Un compte Telegram rattache a un membre, tel que le registre du groupe le voit. */
export type CompteDuMembre = {
  telegramId: number
  pseudo: string | null
  nomAffiche: string | null
  /** cockpit_telegram_membres.present (faux si le compte n'y est pas). */
  present: boolean
  statutTg: string | null
}

/** Un membre a contacter (cockpit_membres_risque) et ses comptes Telegram rattaches. */
export type CandidatRelais = {
  membreId: string
  cleEpisode: string
  motif: MotifContact | string
  joursSilence: number | null
  joursAnciennete: number | null
  /** Jour d'ouverture de la fenetre (AAAA-MM-JJ). */
  entree: string | null
  /** Le nom de la fiche du cockpit, si le compte Telegram n'a pas de nom affiche. */
  nomFiche: string | null
  comptes: readonly CompteDuMembre[]
}

export type ExclusionsRelais = {
  /** Comptes de l'equipe (cockpit_telegram_comptes). */
  equipe: ReadonlySet<number>
  /** Comptes exemptes, exemption en cours (cockpit_liveclub_exemptions). */
  exemptes: ReadonlySet<number>
  /** Comptes relais actifs (cockpit_liveclub_relais). */
  relais: ReadonlySet<number>
  /**
   * Statut lu en direct dans le groupe (getChatMember), quand on l'a. Prime
   * sur le registre ; null = illisible (le registre decide).
   */
  statutsDirects?: ReadonlyMap<number, string | null>
}

/** Ce qu'un relais recoit d'un membre. Aucun champ d'email, de montant ni d'abonnement. */
export type LigneRelais = {
  membreId: string
  cleEpisode: string
  motif: MotifRelais
  telegramId: number
  pseudo: string | null
  nom: string
  /** Accueil : jours depuis l'arrivee. Silence : jours sans message. */
  jours: number | null
}

const STATUTS_ADMIN = new Set(['creator', 'administrator'])
const STATUTS_DEHORS = new Set(['left', 'kicked'])

function statutDe(c: CompteDuMembre, excl: ExclusionsRelais): string | null {
  return excl.statutsDirects?.get(c.telegramId) ?? c.statutTg
}

/** Dans le groupe : le statut direct s'il est net, sinon le registre. */
function dansLeGroupe(c: CompteDuMembre, excl: ExclusionsRelais): boolean {
  const direct = excl.statutsDirects?.get(c.telegramId) ?? null
  if (direct && STATUTS_DEHORS.has(direct)) return false
  if (direct === 'member' || direct === 'administrator' || direct === 'creator') return true
  return c.present && !STATUTS_DEHORS.has(c.statutTg ?? '')
}

/**
 * Le compte par lequel le relais peut joindre le membre, ou null. Un seul
 * compte de l'equipe, exempte, relais, admin ou createur ecarte le membre
 * entier ; sinon le premier compte present dans le groupe ; aucun = hors
 * groupe, ecarte.
 */
export function compteAJoindre(comptes: readonly CompteDuMembre[], excl: ExclusionsRelais): CompteDuMembre | null {
  for (const c of comptes) {
    if (excl.equipe.has(c.telegramId) || excl.exemptes.has(c.telegramId) || excl.relais.has(c.telegramId)) return null
    if (STATUTS_ADMIN.has(statutDe(c, excl) ?? '')) return null
  }
  return comptes.find(c => dansLeGroupe(c, excl)) ?? null
}

/** La cle d'un episode, la meme que celle du cockpit (cleTraitee) et du resume (cleAnnonce). */
export const cleEpisodeRelais = (membreId: string, cleEpisode: string) => `${membreId}::${cleEpisode}`

/**
 * Les membres a transmettre a CE relais : ses motifs seulement (jamais echec
 * ni prelevement), ni deja transmis, ni marques fait, joignables dans le
 * groupe, hors exclusions et hors le relais lui-meme. Une ligne par membre.
 * Rangees par fenetre (accueil, puis silence), puis par jour d'ouverture.
 */
export function lignesPourRelais(
  candidats: readonly CandidatRelais[],
  relais: RelaisLu,
  excl: ExclusionsRelais,
  o: { traitees: ReadonlySet<string>; dejaTransmis: ReadonlySet<string> },
): LigneRelais[] {
  const motifs = new Set(motifsDuRelais(relais.motifs))
  const exclusions: ExclusionsRelais = { ...excl, relais: new Set([...excl.relais, relais.telegramId]) }
  const tries = [...candidats].sort((a, b) =>
    MOTIFS_RELAIS.indexOf(a.motif as MotifRelais) - MOTIFS_RELAIS.indexOf(b.motif as MotifRelais)
    || (a.entree ?? '').localeCompare(b.entree ?? ''))
  const vus = new Set<string>()
  const lignes: LigneRelais[] = []
  for (const c of tries) {
    const motif = c.motif
    if (!estMotifRelais(motif) || !motifs.has(motif)) continue
    // La cle doit dire la meme fenetre que le motif (a_risque:<motif>:<date>).
    if (!c.cleEpisode.startsWith(`a_risque:${motif}:`)) continue
    const cle = cleEpisodeRelais(c.membreId, c.cleEpisode)
    if (o.traitees.has(cle) || o.dejaTransmis.has(cle) || vus.has(c.membreId)) continue
    const compte = compteAJoindre(c.comptes, exclusions)
    if (!compte) continue
    vus.add(c.membreId)
    lignes.push({
      membreId: c.membreId,
      cleEpisode: c.cleEpisode,
      motif,
      telegramId: compte.telegramId,
      pseudo: pseudoPropre(compte.pseudo),
      nom: nomPropre(compte.nomAffiche) ?? nomPropre(c.nomFiche) ?? 'Membre sans nom',
      jours: motif === 'accueil' ? c.joursAnciennete : c.joursSilence,
    })
  }
  return lignes
}

// ---------------------------------------------------------------------------
// Les messages
// ---------------------------------------------------------------------------

/** Le motif en mots simples, sans point final. */
export function motifEnClair(l: Pick<LigneRelais, 'motif' | 'jours'>): string {
  const n = l.jours !== null && Number.isFinite(l.jours) && l.jours >= 0 ? Math.round(l.jours) : null
  if (l.motif === 'accueil') {
    if (n === null) return "nouveau, n'a pas encore écrit"
    if (n === 0) return "arrivé aujourd'hui, n'a pas encore écrit"
    return `arrivé il y a ${n} jour${n > 1 ? 's' : ''}, n'a pas encore écrit`
  }
  return `plus de message depuis ${n ?? 14} jours`
}

/** « 3. <a href="tg://user?id=...">Nom</a> : motif » ou « 3. Nom (@pseudo) : motif », en HTML Telegram. */
export function ligneHtml(l: LigneRelais, numero: number): string {
  const nom = echapperHtml(l.nom)
  const qui = l.pseudo ? `${nom} (@${l.pseudo})` : `<a href="tg://user?id=${Math.trunc(l.telegramId)}">${nom}</a>`
  return `${numero}. ${qui} : ${motifEnClair(l)}`
}

/** Le premier message a un relais (Brice, 24/10 : ton du Live Club, tutoiement, chaleureux et sobre). */
export function textePresentation(prenom: string): string {
  const p = nomPropre(prenom, 30)
  return `Salut${p ? ` ${echapperHtml(p)}` : ''}, comme convenu avec Brice : chaque jour où il y a du nouveau, `
    + `je t'envoie ici les membres à qui dire un mot. Appuie sur « C'est fait » quand c'est fait.`
}

/** Sous une liste ou un membre n'a pas de @pseudo. */
export const NOTE_SANS_PSEUDO = 'Sans @pseudo : touche son nom pour ouvrir son profil, ou retrouve-le dans le groupe.'

export const PREFIXE_BOUTON_RELAIS = 'rl:'
const DEBUT_A_FAIRE = "C'est fait : "
const DEBUT_FAIT = 'Fait : '

export const dataBoutonRelais = (episodeId: number) => `${PREFIXE_BOUTON_RELAIS}${Math.trunc(episodeId)}`
export const estBoutonRelais = (data: string) => data.startsWith(PREFIXE_BOUTON_RELAIS)

/** L'episode d'un bouton « C'est fait », ou null. */
export function lireBoutonRelais(data: string): number | null {
  const m = /^rl:(\d{1,15})$/.exec(data)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** Le libelle d'un bouton : « C'est fait : 3. Julien » (nom coupe a 20 caracteres). */
export function libelleBoutonRelais(l: Pick<LigneRelais, 'nom'>, numero: number): string {
  return `${DEBUT_A_FAIRE}${numero}. ${nomPropre(l.nom, 20) ?? 'membre'}`
}

export type BoutonRelais = { texte: string; data: string }
export type MessageRelais = { texte: string; boutons: BoutonRelais[][]; episodes: number[] }

/**
 * Lignes par message : 10 au plus. CHOIX (Brice, 24/10 : le retard du
 * premier envoi peut etre long) : une liste numerotee par message, un bouton
 * par ligne qui reprend le numero et le nom (« C'est fait : 3. Julien »).
 * A 10, le clavier tient sur un ecran de telephone sous sa liste. Ecartes :
 * un message par membre (une notification par personne, la conversation
 * noyee des le premier jour) et un clavier pagine (un etat a tenir par
 * message, et la page affichee ne correspondrait plus au texte au-dessus).
 */
export const LIGNES_PAR_MESSAGE = 10

/** Au premier envoi, au-dessus de la liste : tout ce qui attend deja. */
export const TITRE_RETARD = 'Pour commencer, ceux qui attendent déjà :'

/**
 * Les messages d'un relais, en HTML Telegram, rien a transmettre = aucun
 * message. Au premier envoi (`presentation` donnee) : la presentation, puis
 * la liste sous TITRE_RETARD ; ensuite, droit a la liste. Liste numerotee
 * d'un message a l'autre, un bouton « C'est fait » par membre.
 */
export function messagesRelais(
  lignes: readonly (LigneRelais & { episodeId: number })[],
  o: { presentation: string | null },
): MessageRelais[] {
  const messages: MessageRelais[] = []
  for (let debut = 0; debut < lignes.length; debut += LIGNES_PAR_MESSAGE) {
    const paquet = lignes.slice(debut, debut + LIGNES_PAR_MESSAGE)
    const blocs: string[] = []
    if (debut === 0 && o.presentation) blocs.push(o.presentation)
    const liste = paquet.map((l, i) => ligneHtml(l, debut + i + 1)).join('\n')
    blocs.push(debut === 0 && o.presentation ? `${TITRE_RETARD}\n${liste}` : liste)
    if (paquet.some(l => !l.pseudo)) blocs.push(NOTE_SANS_PSEUDO)
    messages.push({
      texte: blocs.join('\n\n'),
      boutons: paquet.map((l, i) => [{ texte: libelleBoutonRelais(l, debut + i + 1), data: dataBoutonRelais(l.episodeId) }]),
      episodes: paquet.map(l => l.episodeId),
    })
  }
  return messages
}

// ---------------------------------------------------------------------------
// Le bouton « C'est fait »
// ---------------------------------------------------------------------------

/** Ce que le serveur lit de l'episode d'un bouton. null = introuvable. */
export type EpisodeDuBouton = { relaisId: number; envoye: boolean; fait: boolean; relaisActif: boolean } | null

export type DecisionBoutonRelais = 'refuse' | 'deja_fait' | 'marquer'

/**
 * Le bouton ne vaut que pour le relais de l'episode, toujours actif, et un
 * episode dont le message est parti. Tout le reste : refuse, sans rien dire
 * de l'episode.
 */
export function decisionBoutonRelais(appuiDe: number, ep: EpisodeDuBouton): DecisionBoutonRelais {
  if (!ep || !ep.envoye || !ep.relaisActif || ep.relaisId !== appuiDe) return 'refuse'
  return ep.fait ? 'deja_fait' : 'marquer'
}

export const TEXTE_BOUTON_MARQUE = 'Noté, merci !'
export const TEXTE_BOUTON_DEJA = "C'est déjà noté."
export const TEXTE_BOUTON_REFUSE = 'Ce bouton ne marche plus.'
export const TEXTE_BOUTON_PANNE = "Souci technique, rien n'a été noté. Réessaie dans un moment."

/** La note de la marque dans cockpit_actions_traitees. */
export function noteMarqueRelais(nomRelais: string): string {
  return `Fait par ${nomPropre(nomRelais, 30) ?? 'le relais'} (relais d'accueil, bouton du bot Live Club)`
}

type BoutonClavier = { text?: unknown; callback_data?: unknown; url?: unknown }

/**
 * Le clavier du message apres un appui : le bouton appuye devient « Fait :
 * 3. Julien » (meme data : un second appui repond « deja note »), les autres
 * restent. null si le clavier recu est illisible ou si rien ne change.
 */
export function clavierApresFait(clavier: unknown, data: string): { text: string; callback_data?: string; url?: string }[][] | null {
  const lignes = (clavier as { inline_keyboard?: unknown } | null | undefined)?.inline_keyboard
  if (!Array.isArray(lignes)) return null
  let change = false
  const sortie: { text: string; callback_data?: string; url?: string }[][] = []
  for (const ligne of lignes) {
    if (!Array.isArray(ligne)) return null
    const nouvelle: { text: string; callback_data?: string; url?: string }[] = []
    for (const b of ligne as BoutonClavier[]) {
      if (typeof b?.text !== 'string') return null
      if (typeof b.url === 'string') { nouvelle.push({ text: b.text, url: b.url }); continue }
      if (typeof b.callback_data !== 'string') return null
      let text = b.text
      if (b.callback_data === data && text.startsWith(DEBUT_A_FAIRE)) {
        text = `${DEBUT_FAIT}${text.slice(DEBUT_A_FAIRE.length)}`
        change = true
      }
      nouvelle.push({ text, callback_data: b.callback_data })
    }
    sortie.push(nouvelle)
  }
  return change ? sortie : null
}
