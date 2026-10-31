// Le message d'accueil dans le groupe Live Club (Brice, 13/10). Metricgram
// postait une annonce a chaque entree ; notre bot le fait desormais, sur un
// ton plus sobre (« chaleureux, mais pas too much »), et pas a chaque fois :
// - un NOUVEAU membre (jamais vu dans le groupe) : bienvenue ;
// - un membre qui revient apres au moins JOURS_ABSENCE_RETOUR jours dehors :
//   « bon retour » ;
// - un retour rapide (sorti pour un impaye, puis revenu apres avoir paye) :
//   rien, personne n'a besoin d'une annonce.
// Un compte deja connu mais sans date de sortie (historique importe de
// Metricgram) : rien non plus, on ne sait pas depuis quand il est parti.
//
// (31/10, Brice) L'accueil ne s'affichait plus : publie sans
// message_thread_id, il part dans le sujet general « Accueil » du forum, qui
// est FERME, et le bot n'avait pas le droit « Gerer les sujets »
// (manage_topics=False ; Metricgram l'avait) : Telegram refusait,
// « TOPIC_CLOSED » dans les logs Vercel du 31/10. Brice a donne ce droit le
// 31/10 (manage_topics=True, verifie). La repartition decidee le 31/10 :
// 1. Accueil (sujet general, sans message_thread_id) : une ligne de
//    bienvenue, nouveau ou retour, une phrase sans consigne. Elle tient le
//    registre des entrees, a cote des lignes de service « X a ete accepte
//    dans le groupe ».
// 2. Bla-bla (SUJET_MOT_NOUVEAU), pour un NOUVEAU seulement : un petit mot
//    social, court. Il dit aux autres de lui souhaiter la bienvenue, et
//    invite le nouveau a se presenter la en deux mots (idee d'Alex, un
//    membre, et de Brice : arriver devant tout le groupe intimide, Bla-bla
//    est l'endroit ou la conversation demarre). Rien dans Bla-bla pour un
//    retour.
// 3. En PRIVE, juste a l'entree (texteAdmission, envoye par bot-membre.ts) :
//    tout le reste, qui ne se perd pas dans le fil du groupe. Le message
//    existait deja (« ta demande est acceptee ») : c'est LUI qui est mis a
//    jour, aucun message de plus (regle de Brice : un message dit un etat et
//    un sens, on ne double pas). Pour un nouveau : le tour du proprietaire
//    (sujets et liens, sans « Formation », que Brice retire), la courte
//    presentation dans Bla-bla avec des idees de quoi dire, l'academie (ou,
//    comment s'y connecter, ce qu'on y trouve : les consignes d'avant
//    l'entree, plus Skool) et les liens utiles que le bot sait donner. Un
//    retour apres 30 jours : un rappel court de l'academie. Un retour
//    rapide : l'acceptation seule.
// Les deux envois publics sont independants (envoisAccueil, route du
// webhook) : l'echec de l'un n'empeche pas l'autre, chacun est journalise.
// Un rejeu de l'update ne republie rien : la ligne dit deja « present ».
//
// Module pur, teste par scripts/verifier-accueil-groupe.mjs. Imports :
// config.ts (pur lui aussi), pour l'adresse de l'academie ; lots-pur.ts (pur,
// 31/10), pour le paragraphe des premiers lots d'un acces broker.
//
// (31/10, Brice) Deux ajouts au message prive de l'admission :
// - un acces broker dont les premiers lots sont attendus : un paragraphe
//   simple et rassurant, sans forcer (paragrapheLotsAdmission), avec le delai ;
// - le challenge du sujet « Core content by MELMOM » compte toutes les
//   reponses aux quiz depuis le debut : une ligne courte pour un nouveau
//   (LIGNE_CHALLENGE_CORE_CONTENT), il peut y repondre au fil de sa progression.

import { URL_FORMATION_LIVECLUB } from './config'
import { paragrapheLotsAdmission } from './lots-pur'

export const JOURS_ABSENCE_RETOUR = 30

const JOUR_MS = 86_400_000
const STATUTS_DEDANS = ['member', 'administrator', 'creator', 'restricted']

/** La ligne de cockpit_telegram_membres AVANT l'evenement (null = jamais vu). */
export type AvantEntree = { present: boolean | null; sortiLe: Date | null } | null

/**
 * (31/10) Qui entre, d'apres la ligne d'AVANT l'entree : jamais vu = nouveau ;
 * dehors depuis au moins JOURS_ABSENCE_RETOUR jours = retour ; sinon connu
 * (retour rapide, ligne qui dit deja « present », ou sortie sans date). La
 * meme regle decide l'accueil du groupe et le message prive de l'admission.
 */
export type GenreEntree = 'nouveau' | 'retour' | 'connu'

export function genreEntree(avant: AvantEntree, quand: Date): GenreEntree {
  if (!avant) return 'nouveau'
  if (avant.present === true || !avant.sortiLe) return 'connu'
  const absence = quand.getTime() - avant.sortiLe.getTime()
  return absence >= JOURS_ABSENCE_RETOUR * JOUR_MS ? 'retour' : 'connu'
}

export type Accueil = 'nouveau' | 'retour' | null

/**
 * Faut-il publier un accueil pour cet evenement chat_member ? Seulement sur
 * une ENTREE (ancien statut dehors, nouveau statut dedans) : un changement de
 * droits d'un membre deja present, ou un rejeu de l'update par Telegram (la
 * ligne dit deja « present »), ne publie rien.
 */
export function accueilAPublier(
  avant: AvantEntree,
  ancienStatut: string | null | undefined,
  nouveauPresent: boolean,
  quand: Date,
): Accueil {
  if (!nouveauPresent) return null
  if (ancienStatut && STATUTS_DEDANS.includes(ancienStatut)) return null
  const genre = genreEntree(avant, quand)
  return genre === 'connu' ? null : genre
}

// ---------------------------------------------------------------------------
// Les sujets du forum du Live Club (31/10)
// ---------------------------------------------------------------------------

/**
 * Les sujets du groupe Live Club (forum a sujets, chat -1001930901866),
 * releves le 31/10. L'id d'un sujet est celui de son premier message ; son
 * lien, https://t.me/c/<chat sans -100>/<id>, ne s'ouvre qu'aux membres.
 * Un sujet cree, renomme ou ferme dans le groupe : a reporter ici.
 */
export const SUJETS_LIVECLUB = {
  annonce: 2,
  replay: 12,
  pdf: 34,
  blabla: 16368,
  vosResultats: 16369,
  explicationCharts: 16372,
  mindset: 16384,
  liensUtiles: 16389,
  tradingChat: 16639,
  coreContentMelmom: 22809,
  macroBreaker: 24392,
} as const

/**
 * Les sujets laisses hors du tour du proprietaire :
 * - Accueil (1) : le sujet general, FERME, ou tombent les lignes de service
 *   « X a ete accepte dans le groupe » et la ligne de bienvenue du bot ;
 * - Formation (16391) : FERME, Brice le retire (31/10) ; ce qu'il disait
 *   (l'acces a la formation, sur Skool) passe dans le message prive, avec
 *   l'academie du site ;
 * - Edgyx FAQ (30) : Edgyx est sorti du Live Club.
 */
export const SUJETS_HORS_TOUR = { accueil: 1, formation: 16391, edgyxFaq: 30 } as const

/**
 * (31/10) Le sujet du petit mot social pour un nouveau membre
 * (message_thread_id) : Bla-bla, ouvert, ou les membres discutent. Son texte
 * dit « presente-toi ici » : il change avec ce sujet.
 */
export const SUJET_MOT_NOUVEAU: number = SUJETS_LIVECLUB.blabla

/**
 * Le lien d'un sujet : https://t.me/c/<id interne>/<sujet>. L'id interne est
 * le chat_id du supergroupe sans son prefixe -100 (-1001930901866 donne
 * 1930901866). null si le chat est absent ou n'a pas cette forme.
 */
export function lienSujet(chat: number | null | undefined, sujet: number): string | null {
  if (typeof chat !== 'number' || !Number.isSafeInteger(chat)) return null
  const m = /^-100(\d+)$/.exec(String(chat))
  return m ? `https://t.me/c/${m[1]}/${sujet}` : null
}

type SujetDuTour = { nom: string; sujet: number; quoi: string }

/** L'essentiel d'abord : ou sont annonces les lives, les replays, ou poser ses questions. */
const TOUR_ESSENTIEL: readonly SujetDuTour[] = [
  { nom: 'Annonce', sujet: SUJETS_LIVECLUB.annonce, quoi: 'où sont annoncés les lives' },
  { nom: 'Replay', sujet: SUJETS_LIVECLUB.replay, quoi: 'chaque live, à revoir quand tu veux' },
  { nom: 'Trading chat', sujet: SUJETS_LIVECLUB.tradingChat, quoi: 'pour parler trading entre membres et poser tes questions' },
]

/** Les autres sujets, une demi-ligne chacun : rien de plus que ce que leur nom dit. */
const TOUR_AUTRES: readonly SujetDuTour[] = [
  { nom: 'Explication charts', sujet: SUJETS_LIVECLUB.explicationCharts, quoi: 'des charts expliqués' },
  { nom: 'Mindset', sujet: SUJETS_LIVECLUB.mindset, quoi: 'le mental du trader' },
  { nom: 'Core content by MELMOM', sujet: SUJETS_LIVECLUB.coreContentMelmom, quoi: 'les contenus de fond de Mélanie' },
  { nom: 'Macro Breaker strat', sujet: SUJETS_LIVECLUB.macroBreaker, quoi: 'la stratégie Macro Breaker' },
  { nom: 'PDF', sujet: SUJETS_LIVECLUB.pdf, quoi: 'les supports en PDF' },
  { nom: 'Liens utiles', sujet: SUJETS_LIVECLUB.liensUtiles, quoi: 'les prop firms, brokers et outils conseillés' },
  { nom: 'Vos résultats', sujet: SUJETS_LIVECLUB.vosResultats, quoi: 'pour partager tes résultats' },
  { nom: 'Bla-bla', sujet: SUJETS_LIVECLUB.blabla, quoi: 'pour discuter de tout le reste' },
]

/** Les sujets du tour, dans l'ordre du message (verifier-accueil-groupe.mjs). */
export const SUJETS_DU_TOUR: readonly number[] = [...TOUR_ESSENTIEL, ...TOUR_AUTRES].map(s => s.sujet)

/**
 * (31/10, Brice) Le challenge du sujet Core content by MELMOM compte TOUTES
 * les reponses aux quiz du sujet depuis le debut : un nouveau peut repondre
 * aux anciens au fil de sa progression. Une ligne, sous la liste des sujets.
 * Le reste (qui gagne, egalite) : l'agent du bot l'explique si on le lui
 * demande (prompt-membre.ts). Le lot n'est ecrit nulle part dans le code ni
 * dans la base de connaissances : il n'est pas cite.
 */
export const LIGNE_CHALLENGE_CORE_CONTENT = `Dans Core content by MELMOM, le challenge compte toutes les réponses aux quiz, les anciens aussi : tu peux y répondre au fil de ta progression. `
  // (31/10, Brice) « dire que ce n'est pas de la chance, il faut vraiment regarder les cours ».
  + `Ce n'est pas de la chance : les réponses sont dans les cours.`

/** « - Nom, ce que c'est : lien ». L'adresse finit la ligne : une ponctuation collee entrerait dans le lien. */
function ligneSujet(s: SujetDuTour, chat: number | null): string {
  const lien = lienSujet(chat, s.sujet)
  return `- ${s.nom}, ${s.quoi}${lien ? ` : ${lien}` : ''}`
}

/**
 * (31/10) Des idees de quoi dire pour se presenter, pour rassurer. Les themes
 * qui reviennent dans les vraies presentations passees (salons « presente-toi »
 * du Discord AoK, groupes Telegram Deep Knowledge et Live Club, lus le
 * 31/10) : depuis quand on trade, sur quoi et comment, ou on en est, ce qu'on
 * vient chercher. Aucun texte de membre n'est repris.
 */
const IDEES_PRESENTATION: readonly string[] = [
  'depuis quand tu trades, ou si tu débutes tout juste',
  "ce que tu trades, et comment (les indices, l'or, le forex, sur ton compte ou en prop firm)",
  'où tu en es en ce moment, et ce qui coince',
  'ce que tu viens chercher dans le Live Club',
]

// ---------------------------------------------------------------------------
// Les textes publics, dans le groupe
// ---------------------------------------------------------------------------

/** @pseudo s'il existe, sinon le prenom, sinon rien de nominatif. */
export function nomPourAccueil(pseudo: string | null | undefined, prenom: string | null | undefined): string | null {
  const p = (pseudo ?? '').replace(/^@/, '').trim()
  if (p) return `@${p}`
  const n = (prenom ?? '').trim()
  return n || null
}

/**
 * La ligne de bienvenue du sujet general « Accueil » (31/10) : une phrase,
 * sans consigne, pour un nouveau comme pour un retour. Le nom y est sans @ :
 * la mention, et sa notification, sont pour le mot de Bla-bla (une seule).
 */
export function texteAccueil(accueil: Exclude<Accueil, null>, nom: string | null): string {
  const qui = nom ? `, ${nom.replace(/^@/, '')}` : ''
  return accueil === 'nouveau' ? `Bienvenue dans le Live Club${qui} !` : `Bon retour dans le Live Club${qui} !`
}

/**
 * (31/10) Le petit mot social de Bla-bla, pour un NOUVEAU seulement : les
 * autres lui souhaitent la bienvenue, lui se presente en deux mots, s'il
 * veut. Detendu, court (Alex et Brice).
 */
export function texteMotNouveau(nom: string | null): string {
  return `Hey tout le monde, ${nom ?? 'un nouveau membre'} vient d'arriver dans le Live Club, n'hésitez pas à lui souhaiter la bienvenue ! `
    + `Et toi, présente-toi ici en deux mots si tu veux : ton parcours dans le trading, ce qui t'amène.`
}

/** Un envoi public : ou (pour les logs), le sujet (null = sujet general, sans message_thread_id) et le texte. */
export type EnvoiAccueil = { ou: 'Accueil' | 'Bla-bla'; sujet: number | null; texte: string }

/**
 * (31/10) Les envois publics d'une entree, dans l'ordre : la ligne d'Accueil
 * (nouveau ou retour), puis, pour un nouveau seulement, le mot de Bla-bla.
 * La route les envoie l'un apres l'autre, independants.
 */
export function envoisAccueil(accueil: Exclude<Accueil, null>, nom: string | null): EnvoiAccueil[] {
  const envois: EnvoiAccueil[] = [{ ou: 'Accueil', sujet: null, texte: texteAccueil(accueil, nom) }]
  if (accueil === 'nouveau') envois.push({ ou: 'Bla-bla', sujet: SUJET_MOT_NOUVEAU, texte: texteMotNouveau(nom) })
  return envois
}

// ---------------------------------------------------------------------------
// Le message prive de l'admission
// ---------------------------------------------------------------------------

export type OptionsAdmission = {
  /** chat_id du groupe (TELEGRAM_LIVECLUB_CHAT_ID) : les liens des sujets en viennent. null = sujets nommes, sans lien. */
  chat: number | null
  /**
   * Acces sans abonnement (exemption, acces broker, acces manuel) : l'academie
   * le reconnait par l'email sous lequel l'equipe le connait, pas par celui
   * d'un abonnement (src/lib/academie/droits.ts), et il n'a pas
   * d'abonnement a gerer.
   */
  accesOffert: boolean
  /**
   * (31/10) Un acces broker dont les premiers lots sont attendus (et pas
   * encore declares faits) : la fin du delai ('YYYY-MM-DD'). Absent ou null :
   * pas de paragraphe des lots.
   */
  lots?: { limite: string } | null
}

/**
 * (31/10, Brice) Le message PRIVE de l'admission, envoye au demandeur juste
 * avant l'approbation de sa demande (traiterDemandeAdhesion, bot-membre.ts)
 * ou juste apres la reprise d'une demande restee en attente. Un seul
 * message, qui dit l'etat (la demande est acceptee) et le sens :
 * - nouveau : le tour du proprietaire (les sujets avec leur lien, ou poser
 *   ses questions, ou sont annonces les lives et les replays), la courte
 *   presentation dans Bla-bla avec des idees, l'academie (ou, comment s'y
 *   connecter, ce qu'on y trouve) et les liens utiles ;
 * - retour (30 jours ou plus dehors) : un rappel court, l'academie ;
 * - connu (retour rapide, ou sortie sans date) : l'acceptation seule.
 * Ce qu'il annonce, le code le tient :
 * - les cours inclus s'ouvrent par l'email (droits de l'academie), et s'ils
 *   restent fermes, l'agent du bot transmet a l'equipe (prompt-membre.ts) ;
 * - les liens utiles (brokers, prop firms, outils) sont dans les consignes
 *   de l'agent du bot (texteLiensUtiles, politique-information.ts) ;
 * - ce qu'on trouve a l'academie : la fiche « academie » de la base de
 *   connaissances (docs/connaissances/academie.md, relue le 18/10), que
 *   l'agent lit aussi. A tenir a jour si l'offre Live Club de l'academie change.
 */
export function texteAdmission(genre: GenreEntree, o: OptionsAdmission): string {
  const email = o.accesOffert ? `l'email sous lequel l'équipe te connaît` : `l'email de ton abonnement`
  const fin = o.accesOffert
    ? `Je reste là pour la moindre question : écris-moi ici quand tu veux.`
    : `Je reste là pour ton abonnement : écris-moi ici quand tu veux (le voir, une pause, un arrêt).`
  // (31/10) Les premiers lots d'un acces broker : un paragraphe, juste apres
  // l'acceptation (nouveau) ou avant la derniere ligne (retour, connu).
  const lots = o.lots?.limite ? paragrapheLotsAdmission(o.lots.limite) : null
  if (genre === 'connu') {
    return `C'est bon, ta demande pour rejoindre le Live Club est acceptée : le groupe s'ouvre à l'instant.\n\n${lots ? `${lots}\n\n` : ''}${fin}`
  }
  if (genre === 'retour') {
    return `Bon retour dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant.\n\n`
      + `Petit rappel : les cours de formation inclus dans le Live Club sont sur l'académie du site. `
      + `Connecte-toi avec ${email}, et ils s'ouvrent tout seuls : ${URL_FORMATION_LIVECLUB}\n\n`
      + (lots ? `${lots}\n\n` : '')
      + fin
  }
  const questions = o.accesOffert
    ? `Et si tu as la moindre question, sur l'académie ou sur ton accès, écris-moi ici.`
    : `Et si tu as la moindre question, sur l'académie ou sur ton abonnement (le voir, une pause, un arrêt), écris-moi ici.`
  return `Bienvenue dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant.`
    + (lots ? `\n\n${lots}\n\n` : ' ')
    + `Voici le tour du propriétaire, pour t'y retrouver.\n\n`
    + `L'essentiel :\n${TOUR_ESSENTIEL.map(s => ligneSujet(s, o.chat)).join('\n')}\n\n`
    + `Les autres sujets :\n${TOUR_AUTRES.map(s => ligneSujet(s, o.chat)).join('\n')}\n\n`
    + `${LIGNE_CHALLENGE_CORE_CONTENT}\n\n`
    + `Pour briser la glace, présente-toi en deux mots dans Bla-bla, pas besoin d'en faire un roman. `
    + `Si tu ne sais pas quoi dire, quelques idées :\n${IDEES_PRESENTATION.map(i => `- ${i}`).join(' ;\n')}.\n\n`
    // (31/10) Sans la liste des cours : elle change avec l'offre (module
    // Liveclub du 26/10), et l'agent la donne d'apres la fiche academie.md.
    + `L'académie, c'est là que sont les cours de formation inclus dans le Live Club, en vidéo ou à lire, avec ta progression. `
    + `L'adresse : ${URL_FORMATION_LIVECLUB}\n`
    + `Connecte-toi avec ${email}, et ils s'ouvrent tout seuls. Pas encore de compte ? Il se crée au même endroit, avec ce même email. `
    + `Un cours inclus reste fermé ? Dis-le-moi ici.\n\n`
    + `Au passage, j'ai aussi tous les liens utiles : les brokers proposés, les prop firms, les outils qui peuvent servir. `
    + questions
}
