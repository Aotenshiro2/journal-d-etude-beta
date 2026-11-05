// L'INDICATEUR TRADINGVIEW D'ALEX (Brice, 05/11/2026) : les regles PURES, les
// textes du bot et les messages a Alex. Aucune base, aucun reseau
// (scripts/verifier-indicateur-alex.mjs les charge telles quelles). La
// lecture, l'ecriture et l'envoi vivent dans indicateur.ts.
//
// Brice, 05/11 : « je veux que Alex ait acces aux @ telegram des membres du
// liveclub pour son indicateur de trading. il n'a pas pu faire tous les
// rapprochements entre nom et @ et les identifiants tradingview (que nous
// n'avons pas). les membres ont comme condition d'etre dans le liveclub pour
// avoir acces gratuitement a son indicateur et il n'a pas de moyen de verifier
// facilement si un membre s'est desinscrit ». Option choisie : le MEMBRE donne
// son pseudo TradingView au bot des membres (ce geste vaut son accord), et
// c'est « la conversation qu'il [Alex] a avec l'agent live club qui lui
// transmet les infos dans leur conversation ». « ca nous permet aussi de
// recuperer les @tradingview de nos membres au passage » : le pseudo est garde
// (cockpit_liveclub_indicateur, migration 20261105250000).
//
// Le parcours du membre (tenu ici, branche dans bot-membre.ts) :
// 1. « Indicateur d'Alex » (menu, conseil d'accueil) ou une phrase a l'agent
//    (outil indicateur_alex : l'agent oriente vers la MEME etape, il n'agit
//    pas seul). Le droit au Live Club est relu en direct (droitLiveClub, la
//    regle du groupe) : un non-membre recoit une reponse courte, rien n'est
//    garde.
// 2. Le bot demande le pseudo TradingView. L'etape est un etat en base
//    (cockpit_liveclub_conversations.action_en_attente, type
//    indicateur_pseudo, 30 minutes), relu avant chaque message (regle « etat
//    et sens ») : une phrase n'est pas un pseudo (l'agent lui repond), un mot
//    courant (« ok », « merci ») fait redemander le pseudo, « annule » ferme
//    l'etape.
// 3. Le pseudo, format STRICT (lettres, chiffres, point, tiret, souligne, 3 a
//    40 caracteres, rien d'autre : aucun lien, aucun texte libre ne part chez
//    Alex), puis la CARTE : « Ton prenom, ton @ et ton pseudo TradingView
//    partent chez Alex, qui gere l'indicateur », boutons « Oui, envoie a
//    Alex » / « Laisser tomber » (grille de securite des bots : un message a
//    un tiers passe par une confirmation). Le clic est l'accord.
// 4. Meme pseudo qu'une demande ouverte : rien de plus (ni doublon, ni second
//    message a Alex). Autre pseudo : le pseudo change, Alex recoit « pseudo
//    change ».
//
// Les messages a Alex (relais d'accueil qui porte cockpit_liveclub_relais.
// indicateur, actif), dans SA conversation avec le bot des membres : une
// demande, un pseudo change, un depart (« X a quitte le Live Club : retire
// l'acces de <pseudo> »), une fois chacun, chacun avec une ligne #indicateur
// lisible par une machine. Jamais d'email, d'abonnement ni de paiement.

import { echapperHtml, nomPropre, pseudoPropre } from './relais-pur'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Le pseudo TradingView : lettres, chiffres, point, tiret, souligne, 3 a 40 caracteres, rien d'autre. */
export const PSEUDO_TRADINGVIEW = /^[A-Za-z0-9._-]{3,40}$/

/** L'etape (pseudo attendu) et la carte (clic attendu) valent 30 minutes. */
export const VALIDITE_ETAPE_MIN = 30

/** Le bouton du menu et du conseil d'accueil. callback_data court (<= 64 octets). */
export const BOUTON_INDICATEUR = { texte: "Indicateur d'Alex", data: 'm:indic' } as const

/** Les boutons de l'etape et de la carte : ic:<nonce> (oui), ix:<nonce> (laisser tomber). */
export const LIBELLE_OUI = 'Oui, envoie à Alex'
export const LIBELLE_NON = 'Laisser tomber'

/** L'outil de l'agent des membres (prompt-membre.ts). */
export const NOM_OUTIL_INDICATEUR = 'indicateur_alex'

/** Les membres qui ont DEJA l'indicateur ont 3 semaines apres l'annonce pour donner leur pseudo au bot (Brice, 05/11). */
export const DELAI_ANCIENS_JOURS = 21

/** Le passage relit le droit d'une demande ouverte au plus une fois par 20 heures (sauf sortie ou absence du groupe). */
export const RELECTURE_MIN_HEURES = 20

/** Au plus, par passage : droits relus, demandes retentees, departs prevenus. */
export const MAX_DROITS_PASSAGE = 50
export const MAX_ENVOIS_PASSAGE = 50

// ---------------------------------------------------------------------------
// Le pseudo
// ---------------------------------------------------------------------------

/** Le pseudo TradingView, ou null. Un @ en tete est retire (habitude des reseaux). */
export function pseudoTradingView(brut: unknown): string | null {
  if (typeof brut !== 'string') return null
  const s = brut.trim().replace(/^@/, '')
  return PSEUDO_TRADINGVIEW.test(s) ? s : null
}

/** Deux pseudos TradingView egaux, sans tenir compte de la casse. */
export function memePseudo(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase()
}

export type EntreePseudo =
  | { genre: 'pseudo'; pseudo: string }
  /** « annule », « stop », « laisse tomber » : l'etape se ferme. */
  | { genre: 'annuler' }
  /** Un mot courant (« ok », « merci », « oui ») : pas un pseudo, le bot le redemande. */
  | { genre: 'relance' }
  /** Un seul mot, mais pas un pseudo (trop court, un lien, un caractere interdit). */
  | { genre: 'invalide' }
  /** Une phrase : ce n'est pas la reponse a l'etape, le parcours habituel la lit (l'agent). */
  | { genre: 'phrase' }

/** Les accents combinants (U+0300 a U+036F), construits par leur code : ce fichier reste en caracteres clavier. */
const ACCENTS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g')
const sansAccents = (s: string) => s.normalize('NFD').replace(ACCENTS, '')

/** L'apostrophe droite et la typographique (construite par son code : ce fichier reste en caracteres clavier). */
const APOSTROPHES = new RegExp(`['${String.fromCharCode(0x2019)}]`, 'g')

const PHRASES_ANNULER = new Set(['laisse tomber', 'non merci', 'pas maintenant', 'plus tard', 'pas la peine', 'on oublie', 'oublie'])
const MOTS_ANNULER = new Set(['annule', 'annuler', 'stop', 'non', 'nan', 'laisse', 'abandon', 'abandonner', 'rien'])
const MOTS_COURANTS = new Set([
  'ok', 'okay', 'oki', 'oui', 'ouais', 'yes', 'yep', 'merci', 'mercii', 'salut', 'bonjour', 'bonsoir', 'hello', 'coucou',
  'super', 'top', 'cool', 'parfait', 'daccord', 'go', 'attends', 'attend', 'pseudo', 'tradingview', 'indicateur', 'aide',
  'help', 'question', 'quoi', 'comment', 'pourquoi',
])

/**
 * Ce que le membre ecrit pendant l'etape. Seul un message qui EST un pseudo
 * (format strict) donne un pseudo : rien n'est extrait d'une phrase.
 */
export function lireEntreePseudo(texte: string): EntreePseudo {
  const t = (typeof texte === 'string' ? texte : '').trim()
  if (!t || t.length > 120) return { genre: 'phrase' }
  // La ponctuation de fin (« merci ! », « ok. ») ne compte pas pour reconnaitre un mot.
  const cle = sansAccents(t.toLowerCase()).replace(APOSTROPHES, '').replace(/[\s!?.,;:]+$/, '').trim()
  if (/\s/.test(cle)) return PHRASES_ANNULER.has(cle) ? { genre: 'annuler' } : { genre: 'phrase' }
  if (MOTS_ANNULER.has(cle)) return { genre: 'annuler' }
  if (MOTS_COURANTS.has(cle)) return { genre: 'relance' }
  // Le pseudo, lui, garde ses points (un point final fait partie du pseudo tape) : seuls !?,;: et les espaces de fin tombent.
  const pseudo = pseudoTradingView(t.replace(/[\s!?,;:]+$/, ''))
  return pseudo ? { genre: 'pseudo', pseudo } : { genre: 'invalide' }
}

// ---------------------------------------------------------------------------
// L'etape et la carte (cockpit_liveclub_conversations.action_en_attente)
// ---------------------------------------------------------------------------

export type EtapeIndicateur =
  | { type: 'indicateur_pseudo'; expire: string }
  | { type: 'indicateur'; pseudo: string; expire: string }

export const TYPES_ETAPE_INDICATEUR: readonly string[] = ['indicateur_pseudo', 'indicateur']

const expireDans = (maintenant: number) => new Date(maintenant + VALIDITE_ETAPE_MIN * 60_000).toISOString()

/** L'etape « pseudo attendu ». */
export function nouvelleEtape(maintenant: number): EtapeIndicateur {
  return { type: 'indicateur_pseudo', expire: expireDans(maintenant) }
}

/** La carte « clic attendu », avec le pseudo lu. */
export function nouvelleCarte(pseudo: string, maintenant: number): EtapeIndicateur {
  return { type: 'indicateur', pseudo, expire: expireDans(maintenant) }
}

/** Une etape lue en base (jsonb) : la forme exacte, sinon rien. */
export function estEtapeIndicateur(v: unknown): v is EtapeIndicateur {
  const x = v as { type?: unknown; expire?: unknown; pseudo?: unknown } | null
  if (!x || typeof x.expire !== 'string' || !Number.isFinite(Date.parse(x.expire))) return false
  if (x.type === 'indicateur_pseudo') return true
  return x.type === 'indicateur' && pseudoTradingView(x.pseudo) === x.pseudo
}

export function etapeExpiree(e: EtapeIndicateur, maintenant: number): boolean {
  return Date.parse(e.expire) < maintenant
}

/** Un bouton de l'etape ou de la carte : ic:<nonce> ou ix:<nonce>. */
export function lireBoutonIndicateur(data: string): { geste: 'oui' | 'non'; nonce: string } | null {
  const m = /^i([cx]):([A-Za-z0-9_-]{8,32})$/.exec(data)
  return m ? { geste: m[1] === 'c' ? 'oui' : 'non', nonce: m[2] } : null
}

export type BoutonIndicateur = { texte: string; data: string }

/** Sous l'etape : « Laisser tomber ». */
export function boutonsEtape(nonce: string): BoutonIndicateur[][] {
  return [[{ texte: LIBELLE_NON, data: `ix:${nonce}` }]]
}

/** Sous la carte : « Oui, envoie a Alex » et « Laisser tomber ». */
export function boutonsCarte(nonce: string): BoutonIndicateur[][] {
  return [[{ texte: LIBELLE_OUI, data: `ic:${nonce}` }, { texte: LIBELLE_NON, data: `ix:${nonce}` }]]
}

// ---------------------------------------------------------------------------
// Les demandes : idempotence
// ---------------------------------------------------------------------------

export type DecisionDemande = 'nouvelle' | 'identique' | 'changement'

/** Une demande face a celle deja ouverte : meme pseudo = rien a faire, autre pseudo = changement. */
export function decisionDemande(ouverte: { pseudo: string } | null, pseudo: string): DecisionDemande {
  if (!ouverte) return 'nouvelle'
  return memePseudo(ouverte.pseudo, pseudo) ? 'identique' : 'changement'
}

export type EtatDemande = { pseudo: string; pseudoTransmis: string | null; departLe: string | null }

export type Annonce = { genre: 'demande' } | { genre: 'changement'; ancien: string }

/**
 * Le message qui attend de partir chez Alex : aucun si la demande est partie
 * ou si Alex a deja le pseudo actuel ; une demande s'il n'a encore rien recu ;
 * un changement s'il a un autre pseudo.
 */
export function annonceAFaire(e: EtatDemande): Annonce | null {
  if (e.departLe) return null
  if (!e.pseudoTransmis) return { genre: 'demande' }
  return memePseudo(e.pseudoTransmis, e.pseudo) ? null : { genre: 'changement', ancien: e.pseudoTransmis }
}

/** Le statut en base, deduit de l'etat. */
export function statutDemande(e: EtatDemande): 'a_transmettre' | 'transmise' | 'partie' {
  if (e.departLe) return 'partie'
  return annonceAFaire(e) ? 'a_transmettre' : 'transmise'
}

/** Les pseudos dont Alex retire l'acces a un depart : celui qu'il a recu, et l'actuel s'il differe. */
export function pseudosARetirer(e: Pick<EtatDemande, 'pseudo' | 'pseudoTransmis'>): string[] {
  const liste = [e.pseudoTransmis, e.pseudo].filter((p): p is string => !!p)
  return liste.filter((p, i) => liste.findIndex(q => memePseudo(p, q)) === i)
}

/** Un depart se dit une seule fois a Alex. */
export function departAPrevenir(e: { departLe: string | null; prevenuDepartLe: string | null }): boolean {
  return !!e.departLe && !e.prevenuDepartLe
}

/** Le droit relu (droitLiveClub) : non = depart, inconnu = on ne touche a rien. */
export function issueDroit(statut: 'oui' | 'non' | 'inconnu'): 'garde' | 'depart' | 'inconnu' {
  return statut === 'non' ? 'depart' : statut === 'oui' ? 'garde' : 'inconnu'
}

export type LigneAVerifier = {
  demandeId: number
  telegramId: number
  /** cockpit_telegram_membres.present (null : compte inconnu du registre). */
  present: boolean | null
  droitVerifieLe: string | null
  demandeLe: string
}

/**
 * Les demandes ouvertes dont le passage relit le droit, dans l'ordre : les
 * comptes sortis par ce passage, puis ceux absents du groupe, puis les jamais
 * relus, puis les plus anciennement relus. Un droit relu depuis moins de
 * RELECTURE_MIN_HEURES attend (sauf sortie ou absence). `max` au plus.
 */
export function ordreVerification(
  lignes: readonly LigneAVerifier[],
  o: { sortis: ReadonlySet<number>; max: number; maintenant: number },
): LigneAVerifier[] {
  const recent = (l: LigneAVerifier) => !!l.droitVerifieLe
    && o.maintenant - Date.parse(l.droitVerifieLe) < RELECTURE_MIN_HEURES * 3_600_000
  const rang = (l: LigneAVerifier) => (o.sortis.has(l.telegramId) ? 0 : l.present === false ? 1 : 2)
  return lignes
    .filter(l => rang(l) < 2 || !recent(l))
    .sort((a, b) => rang(a) - rang(b)
      || (a.droitVerifieLe ? 1 : 0) - (b.droitVerifieLe ? 1 : 0)
      || (a.droitVerifieLe ?? '').localeCompare(b.droitVerifieLe ?? '')
      || a.demandeLe.localeCompare(b.demandeLe)
      || a.demandeId - b.demandeId)
    .slice(0, Math.max(0, o.max))
}

// ---------------------------------------------------------------------------
// Les dates
// ---------------------------------------------------------------------------

/** « 2026-11-05 » (ou un ISO) -> « 05/11/2026 ». */
export function dateFr(jour: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(jour)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : jour
}

/** Un jour AAAA-MM-JJ plus n jours. */
export function jourApres(jour: string, n: number): string {
  const [a, m, j] = jour.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Les textes au membre (tutoiement, caracteres clavier, sans « jamais »)
// ---------------------------------------------------------------------------

const EXEMPLE = 'julien_trades'

export const TEXTE_ETAPE = "L'indicateur TradingView d'Alex est offert aux membres du Live Club.\n\n"
  + `Envoie-moi ici ton pseudo TradingView, tel qu'il s'affiche sur ton profil, en un message (par exemple : ${EXEMPLE}).`

/** La demande est deja ouverte : son pseudo, et comment le changer. */
export function texteEtapeDeja(o: { pseudo: string; demandeLe: string }): string {
  return `Ta demande est déjà faite, avec le pseudo TradingView ${o.pseudo} (le ${dateFr(o.demandeLe)}). Alex gère l'accès de son côté.\n\n`
    + `Tu as changé de pseudo ? Envoie-moi le nouveau ici, en un message. Sinon, rien à refaire.`
}

export const TEXTE_RELANCE = `J'attends ton pseudo TradingView, seul, en un message (par exemple : ${EXEMPLE}). Tu préfères laisser tomber ? Appuie sur « ${LIBELLE_NON} ».`

export const TEXTE_RELANCE_CARTE = `Pour l'envoyer, appuie sur « ${LIBELLE_OUI} » juste au-dessus, ou sur « ${LIBELLE_NON} ».`

export const TEXTE_PSEUDO_INVALIDE = 'Ce pseudo ne passe pas. Envoie-le-moi seul, sans lien ni espace : lettres, chiffres, point, tiret ou souligné, '
  + `de 3 à 40 caractères (par exemple : ${EXEMPLE}).`

export type QuiCarte = { prenom: string | null; pseudoTelegram: string | null }

/**
 * La carte : ce qui part, et a qui (Brice : « Ton prenom, ton @ et ton pseudo
 * TradingView partent chez Alex, qui gere l'indicateur »). Le clic est l'accord.
 */
export function texteCarte(q: QuiCarte, pseudo: string, ancien: string | null): string {
  const prenom = nomPropre(q.prenom, 40)
  const at = pseudoPropre(q.pseudoTelegram)
  const tonPrenom = prenom ? `ton prénom (${prenom})` : 'ton prénom'
  const tonAt = at ? `ton @ (@${at})` : 'un lien vers ton profil Telegram'
  if (ancien) {
    return `Ton nouveau pseudo TradingView (${pseudo}) part chez Alex à la place de ${ancien}, avec ${tonPrenom} et ${tonAt}. Je l'envoie ?`
  }
  const debut = `${tonPrenom.charAt(0).toUpperCase()}${tonPrenom.slice(1)}`
  return `${debut}, ${tonAt} et ton pseudo TradingView (${pseudo}) partent chez Alex, qui gère l'indicateur. Je les envoie ?`
}

/** Apres le clic « Oui, envoie a Alex ». */
export function texteApres(decision: DecisionDemande, pseudo: string, ancien: string | null): string {
  if (decision === 'identique') return `Ta demande est déjà faite avec ce pseudo TradingView (${pseudo}), rien à refaire.`
  if (decision === 'changement') return `C'est noté : Alex reçoit ton nouveau pseudo TradingView, ${pseudo}${ancien ? `, à la place de ${ancien}` : ''}.`
  return `C'est noté : ta demande part chez Alex avec le pseudo TradingView ${pseudo}. `
    + `Il t'ouvre l'accès à l'indicateur sur TradingView, et l'accès reste ouvert tant que tu es membre du Live Club.`
}

export const TEXTE_ANNULE = `OK, rien n'est parti. Pour l'indicateur d'Alex, appuie sur « ${BOUTON_INDICATEUR.texte} » quand tu veux.`
export const TEXTE_NON_MEMBRE = "L'indicateur d'Alex est réservé aux membres du Live Club, et je ne trouve pas d'accès en cours à ton nom. "
  + 'Je ne peux donc pas transmettre de demande pour le moment.'
export const TEXTE_DROIT_ILLISIBLE = "Je n'arrive pas à vérifier ton accès au Live Club pour le moment, donc rien n'est parti. "
  + `Réessaie dans un moment avec « ${BOUTON_INDICATEUR.texte} ».`
export const TEXTE_PANNE_INDICATEUR = `Souci technique de mon côté, rien n'est parti. Réessaie dans un moment avec « ${BOUTON_INDICATEUR.texte} ».`
export const TEXTE_PAS_ENCORE = "L'accès à l'indicateur d'Alex s'ouvre ici très bientôt. Reviens vers moi dans quelques jours."
export const TEXTE_BOUTON_PERIME = `Ce bouton ne marche plus, et rien n'est parti. Pour l'indicateur d'Alex, appuie sur « ${BOUTON_INDICATEUR.texte} ».`

// ---------------------------------------------------------------------------
// Les messages a Alex (HTML Telegram)
// ---------------------------------------------------------------------------

/** Qui, pour Alex : le prenom Telegram, le @, et le compte (lien de profil quand il n'y a pas de @). */
export type QuiPourAlex = { prenom: string | null; pseudoTelegram: string | null; telegramId: number }

function quiHtml(q: QuiPourAlex): string {
  const nom = echapperHtml(nomPropre(q.prenom, 40) ?? 'Un membre')
  const at = pseudoPropre(q.pseudoTelegram)
  return at ? `${nom} (@${at})` : `<a href="tg://user?id=${Math.trunc(q.telegramId)}">${nom}</a>`
}

/** La ligne lisible par une machine : #indicateur <genre> cle=valeur... (ASCII, pseudos au format strict). */
export function ligneMachine(genre: 'demande' | 'changement' | 'depart', q: QuiPourAlex, champs: { tv: string[]; ancien?: string | null; le: string }): string {
  const at = pseudoPropre(q.pseudoTelegram)
  const prenom = (nomPropre(q.prenom, 40) ?? '').replace(/"/g, '')
  return [
    `#indicateur ${genre}`,
    `tv=${champs.tv.join(',')}`,
    ...(champs.ancien ? [`ancien=${champs.ancien}`] : []),
    `tg=${at ? `@${at}` : `id:${Math.trunc(q.telegramId)}`}`,
    `prenom="${echapperHtml(prenom)}"`,
    `le=${champs.le.slice(0, 10)}`,
  ].join(' ')
}

/** En tete du tout premier message a Alex sur l'indicateur. */
export function textePresentationAlex(nom: string): string {
  const p = nomPropre(nom, 30)
  return `Salut${p ? ` ${echapperHtml(p)}` : ''}, comme convenu avec Brice : quand un membre du Live Club demande ton indicateur, `
    + `je t'envoie ici son prénom, son @ et son pseudo TradingView. Quand un membre quitte le Live Club, je te dis quel accès retirer. `
    + 'Chaque message finit par une ligne #indicateur, lisible par une machine.'
}

/** (a) Une demande. `le` : le jour de la demande, AAAA-MM-JJ. */
export function messageDemandeAlex(q: QuiPourAlex, pseudo: string, le: string): string {
  return [
    'Indicateur : nouvelle demande',
    quiHtml(q),
    `TradingView : ${pseudo}`,
    `Demandé le ${dateFr(le)}`,
    '',
    ligneMachine('demande', q, { tv: [pseudo], le }),
  ].join('\n')
}

/** (a bis) Un pseudo change. `le` : le jour du changement. */
export function messageChangementAlex(q: QuiPourAlex, ancien: string, nouveau: string, le: string): string {
  return [
    'Indicateur : pseudo changé',
    `${quiHtml(q)} a changé de pseudo TradingView : retire l'accès de ${ancien} et donne-le à ${nouveau}.`,
    '',
    ligneMachine('changement', q, { tv: [nouveau], ancien, le }),
  ].join('\n')
}

/** (b) Un depart (Brice : « X a quitte le Live Club : retire l'acces de <pseudo> »). `le` : le jour du depart. */
export function messageDepartAlex(q: QuiPourAlex, pseudos: readonly string[], le: string): string {
  const liste = pseudos.length > 1 ? `${pseudos.slice(0, -1).join(', ')} et de ${pseudos[pseudos.length - 1]}` : (pseudos[0] ?? '')
  return [
    `${quiHtml(q)} a quitté le Live Club : retire l'accès de ${liste} à l'indicateur.`,
    '',
    ligneMachine('depart', q, { tv: [...pseudos], le }),
  ].join('\n')
}

// ---------------------------------------------------------------------------
// L'annonce aux membres actuels (NON envoyee : Brice la valide)
// ---------------------------------------------------------------------------

/**
 * Le texte unique pour les membres actuels, dans le groupe, avec le delai de
 * 3 semaines (Brice, 05/11 : apres, Alex peut retirer les acces qu'il ne relie
 * a aucun membre). `envoyeLe` : le jour de l'annonce, AAAA-MM-JJ. Rien ne
 * l'envoie : Brice le valide et le poste.
 */
export function texteAnnonceIndicateur(envoyeLe: string): string {
  const limite = dateFr(jourApres(envoyeLe, DELAI_ANCIENS_JOURS))
  return 'Bonne nouvelle pour les membres du Live Club : Alex vous offre l\'accès à son indicateur TradingView, tant que vous êtes membres.\n\n'
    + `Pour l'avoir, écrivez en privé au bot @aok_liveclub_bot et appuyez sur « ${BOUTON_INDICATEUR.texte} » (ou écrivez-lui « je veux l'indicateur d'Alex »). `
    + 'Il vous demande votre pseudo TradingView et le transmet à Alex.\n\n'
    + `Vous avez déjà l'indicateur ? Donnez aussi votre pseudo au bot, avant le ${limite} : après cette date, Alex pourra retirer les accès qu'il ne relie à aucun membre du Live Club.`
}
