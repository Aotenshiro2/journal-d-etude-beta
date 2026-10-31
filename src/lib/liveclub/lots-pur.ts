// LE SUIVI DES LOTS d'un membre entre au Live Club par un acces broker
// (Brice et Melanie, 31/10). Module PUR, sans aucun import : les regles, les
// dates et les textes. Teste par scripts/verifier-suivi-lots.mjs.
//
// Pourquoi : un acces broker (motif 'broker', cockpit_liveclub_acces) avec un
// depot inscrit (cockpit_commissions, nature 'depot') ne paie l'affiliation
// qu'une fois les PREMIERS LOTS trades chez le broker. Tant qu'ils ne le sont
// pas, la commission reste attendue (lots_faits_le vide) et glisse.
//
// Le parcours, decide le 31/10 :
// 1. a l'entree, le message prive de l'admission (texteAdmission,
//    accueil-groupe.ts) dit simplement, sans forcer : tant que les premiers
//    lots ne sont pas trades, l'affiliation ne nous paie pas ; pas besoin de
//    cramer son compte (2 lots sur le NAS, position tenue 30 secondes) ;
//    ensuite il prend tout son temps ; et le delai a respecter ;
// 2. relance en prive RELANCE_LOTS_1_JOURS apres le depart (un pas-a-pas tres
//    court), puis une seconde RELANCE_LOTS_2_AVANT_FIN_JOURS avant la fin du
//    delai ; chacune une seule fois, depuis le passage quotidien, tracee dans
//    cockpit_liveclub_gestes ('rappel', regles lots_relance_1 et
//    lots_relance_2), l'etat relu juste avant d'envoyer ;
// 3. le membre dit « c'est bon, j'ai trade mes lots » (outil lots_trades de
//    l'agent, ou bouton BOUTON_LOTS) : une DECLARATION ('acces_broker',
//    regle lots_declares), une carte a Brice et Melanie dans Agent AOK, « Oui,
//    lots tradés » / « Non, pas encore » ; au membre, une ligne : l'equipe
//    verifie chez le broker ;
// 4. Oui = les lots notes faits (la meme ecriture que la carte
//    proposer_marquer_commission, etat lots_faits : la commission est prevue
//    a la fin du mois des lots, moisPrevuCommission) et le membre prevenu ;
//    Non = le membre prevenu que l'equipe ne les voit pas encore ;
// 5. lots pas trades a la fin du delai : l'acces est EN PAUSE, par le meme
//    mecanisme que la sortie pour impaye (le droit dit 'non', le passage le
//    sort du groupe SANS ban, un message prive clair). Jamais de ban. Des que
//    les lots sont notes faits, le droit redit 'oui' et il revient tout de
//    suite (lien en prive au clic de l'equipe, filet au passage du lendemain).
//
// GARDE-FOUS :
// - une declaration en cours (l'equipe n'a pas encore tranche) arrete tout :
//   ni relance, ni pause ;
// - aucune pause tant que la seconde relance n'est pas partie, et jamais moins
//   de RELANCE_LOTS_2_AVANT_FIN_JOURS jours apres elle (limiteEffectiveLots) :
//   personne n'est mis en pause sans avoir ete prevenu, avec la date ;
// - les membres deja entres AVANT ce deploiement : leur delai part de
//   SUIVI_LOTS_DEPUIS, pas de leur entree (aucune pause retroactive) ;
// - LIVECLUB_SUIVI_LOTS=0 coupe tout le suivi (config.ts, suiviLotsActif).

/**
 * (31/10) Le delai pour trader ses premiers lots, en jours, depuis le depart
 * du suivi (departLots). Brice, 31/10 : 3 semaines.
 */
export const DELAI_LOTS_JOURS = 21

/** (31/10) La premiere relance, en jours apres le depart. Decidee par Brice : 14. */
export const RELANCE_LOTS_1_JOURS = 14

/**
 * (31/10) La seconde relance, en jours AVANT la fin du delai (J+18 avec 21
 * jours). Brice, 31/10 : oui. C'est aussi le temps minimum laisse entre
 * cette relance et la pause.
 */
export const RELANCE_LOTS_2_AVANT_FIN_JOURS = 3

/**
 * (31/10) LES MEMBRES DEJA ENTRES par un acces broker avant ce deploiement :
 * pas de pause retroactive surprise, leur delai court a partir de ce jour.
 * A POSER au jour du deploiement (ou plus tard, jamais avant). Les acces
 * broker SANS depot inscrit (les 6 d'avant le 29/10) ne sont jamais suivis.
 */
export const SUIVI_LOTS_DEPUIS = '2026-10-31'

/** L'exemple de lots donne au membre (Brice, 31/10). */
export const EXEMPLE_LOTS = '2 lots sur le NAS'
/** Le temps de tenue de la position de l'exemple (Brice, 31/10). */
export const TENUE_LOTS = '30 secondes'

const JOUR_MS = 86_400_000

/** 'YYYY-MM-DD' + n jours. */
export function jourPlus(jour: string, n: number): string {
  const t = Date.parse(`${jour.slice(0, 10)}T00:00:00Z`)
  return new Date(t + n * JOUR_MS).toISOString().slice(0, 10)
}

/** Le plus tardif de plusieurs jours 'YYYY-MM-DD' (les vides ignores). */
function plusTard(...jours: (string | null | undefined)[]): string {
  return jours.filter((j): j is string => typeof j === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j))
    .map(j => j.slice(0, 10)).sort().pop() ?? ''
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** '2026-12-02' -> '2 décembre 2026' (la meme forme que formaterDateFr, pur.ts). */
export function dateLots(jour: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(jour)
  if (!m) return jour
  const j = Number(m[3])
  return `${j === 1 ? '1er' : j} ${MOIS_FR[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

// ---------------------------------------------------------------------------
// Les dates et les phases
// ---------------------------------------------------------------------------

/** Ce que le suivi d'un acces broker lit en base (lots-lecture.ts). */
export type SuiviLots = {
  /** Debut de l'acces broker ('YYYY-MM-DD'). */
  debut: string
  /**
   * Le jour (Paris) ou il a ouvert son lien personnel vers le bot (jeton
   * d'entree utilise), ou null : c'est son entree au Live Club.
   */
  entreeLe: string | null
  /** Le jour (Paris) ou la seconde relance est partie, ou null. */
  relance2Le: string | null
  /** Une declaration « j'ai trade mes lots » attend la decision de l'equipe. */
  declarationEnCours: boolean
}

/**
 * Le depart du delai : son entree (jeton utilise, sinon le debut de l'acces),
 * jamais avant SUIVI_LOTS_DEPUIS (les membres d'avant ce deploiement).
 */
export function departLots(s: Pick<SuiviLots, 'debut' | 'entreeLe'>): string {
  return plusTard(s.debut, s.entreeLe, SUIVI_LOTS_DEPUIS)
}

/** La fin du delai annoncee au membre (incluse) : depart + DELAI_LOTS_JOURS. */
export function limiteLots(s: Pick<SuiviLots, 'debut' | 'entreeLe'>): string {
  return jourPlus(departLots(s), DELAI_LOTS_JOURS)
}

/**
 * Le dernier jour avant la pause (inclus) : la fin du delai, repoussee pour
 * que la seconde relance laisse toujours RELANCE_LOTS_2_AVANT_FIN_JOURS jours.
 * null tant que la seconde relance n'est pas partie : pas de pause sans
 * prevenir, avec la date.
 */
export function limiteEffectiveLots(s: Pick<SuiviLots, 'debut' | 'entreeLe' | 'relance2Le'>): string | null {
  if (!s.relance2Le) return null
  return plusTard(limiteLots(s), jourPlus(s.relance2Le, RELANCE_LOTS_2_AVANT_FIN_JOURS))
}

/** La date a annoncer dans la seconde relance envoyee `aujourdhui` (la meme que limiteEffectiveLots ensuite). */
export function limiteAnnonceeRelance2(s: Pick<SuiviLots, 'debut' | 'entreeLe'>, aujourdhui: string): string {
  return plusTard(limiteLots(s), jourPlus(aujourdhui, RELANCE_LOTS_2_AVANT_FIN_JOURS))
}

/**
 * Ce que le suivi demande `aujourdhui` (jour de Paris) :
 * - 'declares' : le membre a dit les avoir faits, l'equipe verifie : rien ;
 * - 'pause' : la fin du delai est passee (limite effective) : acces en pause ;
 * - 'relance_2' : dans les RELANCE_LOTS_2_AVANT_FIN_JOURS derniers jours (ou
 *   apres la fin du delai), la seconde relance n'est pas encore partie ;
 * - 'relance_1' : RELANCE_LOTS_1_JOURS apres le depart (le passage ne l'envoie
 *   qu'une fois, reservation) ;
 * - 'attente' : trop tot, ou seconde relance partie et sa date pas atteinte.
 */
export type PhaseLots = 'attente' | 'relance_1' | 'relance_2' | 'pause' | 'declares'

export function phaseLots(s: SuiviLots, aujourdhui: string): PhaseLots {
  if (s.declarationEnCours) return 'declares'
  const effective = limiteEffectiveLots(s)
  if (effective && aujourdhui > effective) return 'pause'
  if (s.relance2Le) return 'attente'
  if (aujourdhui >= jourPlus(limiteLots(s), -RELANCE_LOTS_2_AVANT_FIN_JOURS)) return 'relance_2'
  if (aujourdhui >= jourPlus(departLots(s), RELANCE_LOTS_1_JOURS)) return 'relance_1'
  return 'attente'
}

/** L'acces est-il en pause pour ses lots (le droit dit 'non') ? */
export function lotsEnRetard(s: SuiviLots, aujourdhui: string): boolean {
  return phaseLots(s, aujourdhui) === 'pause'
}

/**
 * Le suivi d'un acces tel que le droit le porte (droits.ts) : 'a_faire' (dans
 * le delai) ou 'en_retard' (en pause), la date a dire, et si une declaration
 * attend l'equipe.
 */
export type EtatLots = { etat: 'a_faire' | 'en_retard'; limite: string; declare: boolean }

export function etatLots(s: SuiviLots, aujourdhui: string): EtatLots {
  return {
    etat: lotsEnRetard(s, aujourdhui) ? 'en_retard' : 'a_faire',
    limite: limiteEffectiveLots(s) ?? limiteLots(s),
    declare: s.declarationEnCours,
  }
}

// ---------------------------------------------------------------------------
// La declaration du membre
// ---------------------------------------------------------------------------

/** Le bouton du bot des membres (callback_data de 6 octets). */
export const BOUTON_LOTS = { texte: "J'ai tradé mes lots", data: 'm:lots' } as const

export type IssueDeclarationLots = 'declare' | 'deja_declare' | 'deja_faits' | 'rien' | 'panne'

/**
 * Ce que dit la declaration, d'apres l'etat relu juste avant : rien a
 * verifier (pas d'acces broker avec depot), lots deja notes faits, une
 * declaration attend deja l'equipe, ou une nouvelle a transmettre.
 */
export function decisionDeclarationLots(o: { enAttente: boolean; dejaFaits: boolean; declarationEnCours: boolean }): Exclude<IssueDeclarationLots, 'panne'> {
  if (o.enAttente) return o.declarationEnCours ? 'deja_declare' : 'declare'
  return o.dejaFaits ? 'deja_faits' : 'rien'
}

/** La ligne du bot au membre apres sa declaration (une ligne : l'equipe verifie chez le broker). */
export function texteDeclarationLots(issue: IssueDeclarationLots, o: { enPause: boolean } = { enPause: false }): string {
  switch (issue) {
    case 'declare':
      return o.enPause
        ? "Merci, c'est noté ! L'équipe vérifie chez le broker, et dès que c'est vu, je te redonne ton lien vers le groupe ici."
        : "Merci, c'est noté ! L'équipe vérifie chez le broker."
    case 'deja_declare':
      return o.enPause
        ? "C'est déjà noté : l'équipe vérifie chez le broker, et je te redonne ton lien vers le groupe dès que c'est vu."
        : "C'est déjà noté : l'équipe vérifie chez le broker."
    case 'deja_faits':
      return "C'est déjà bon de notre côté : tes lots sont bien notés. Merci !"
    case 'rien':
      return "Je n'ai pas de lots en attente à ton nom, donc rien à vérifier de ce côté."
    case 'panne':
      return "Je n'arrive pas à prévenir l'équipe là, tout de suite. Réessaie dans quelques minutes, ou appuie sur « Contacter l'équipe » : elle te répond ici."
  }
}

// ---------------------------------------------------------------------------
// Les textes au membre (tutoiement en prive ; les emails vouvoient, emails.ts)
// ---------------------------------------------------------------------------

/** L'exemple, dans une phrase : « 2 lots sur le NAS, avec une position tenue 30 secondes ». */
const EXEMPLE = `${EXEMPLE_LOTS}, avec une position tenue ${TENUE_LOTS}`

/**
 * (31/10, Brice) Le paragraphe du message prive de l'admission, pour un acces
 * broker dont les lots sont attendus. Simple et rassurant, sans forcer : ce
 * que ca change pour nous, que ca ne coute presque rien, puis le delai.
 */
export function paragrapheLotsAdmission(limite: string): string {
  return `Un mot sur ton accès par le broker : tant que tes premiers lots ne sont pas tradés chez lui, l'affiliation ne nous paie pas. `
    + `Pas besoin de cramer ton compte pour ça : ${EXEMPLE}, par exemple, et c'est bon. Ensuite, tu prends tout ton temps. `
    + `Tu as jusqu'au ${dateLots(limite)} pour les faire. Quand c'est fait, dis-le-moi ici : l'équipe vérifie chez le broker.`
}

/** Les trois etapes du pas-a-pas (relance 1). */
export const ETAPES_LOTS: readonly string[] = [
  'Ouvre ta plateforme chez le broker.',
  `Prends une position de ${EXEMPLE_LOTS}.`,
  `Garde-la ${TENUE_LOTS}, puis ferme-la.`,
]

/** La phrase « quand c'est fait » d'un message prive : le bouton, ou un mot au bot. */
const QUAND_C_EST_FAIT = `Quand c'est fait, appuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici : l'équipe vérifie chez le broker.`

/** Relance 1, en prive : un pas-a-pas tres court. */
export function texteRelanceLots1(limite: string): string {
  return [
    `Salut ! Petit rappel pour ton accès au Live Club par le broker : tes premiers lots ne sont pas encore tradés chez lui, et tant qu'ils ne le sont pas, l'affiliation ne nous paie pas.`,
    `Le plus simple, en trois étapes :\n${ETAPES_LOTS.map((e, i) => `${i + 1}. ${e}`).join('\n')}`,
    `C'est tout, et tu as jusqu'au ${dateLots(limite)}. ${QUAND_C_EST_FAIT}`,
  ].join('\n\n')
}

/** Relance 2, en prive : la date, l'exemple, et ce qui se passe apres (une pause, rien de definitif). */
export function texteRelanceLots2(limite: string): string {
  return [
    `Salut ! Il te reste quelques jours pour trader tes premiers lots chez le broker : jusqu'au ${dateLots(limite)}.`,
    `Pour rappel, ${EXEMPLE} suffisent.`,
    `Passé cette date, ton accès au groupe se met en pause tant que les lots ne sont pas faits. Rien de définitif : tu reviens dès que l'équipe les voit chez le broker.`,
    `Déjà fait ? Appuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici : l'équipe vérifie chez le broker.`,
  ].join('\n\n')
}

/** Le message prive de la pause (le passage vient de le sortir du groupe, sans ban). */
export function texteSuspensionLots(): string {
  return [
    `Salut ! Tes premiers lots ne sont pas encore tradés chez le broker, et le délai est passé : ton accès au groupe Telegram est donc en pause pour le moment.`,
    `Rien de définitif : dès que tes lots sont faits (${EXEMPLE}, par exemple), appuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici. L'équipe vérifie chez le broker, et je te redonne ton lien vers le groupe.`,
    `Une question ? Écris-moi ici.`,
  ].join('\n\n')
}

/**
 * Sa situation quand l'acces est en pause (droit 'non' pour ses lots) : /start,
 * /menu, « Mon abonnement », demande d'adhesion refusee, outil mon_abonnement.
 */
export function texteAccesEnPauseLots(): string {
  return `Ton accès offert au Live Club, grâce à ton compte chez notre broker partenaire, est en pause : tes premiers lots ne sont pas encore tradés chez lui, et le délai est passé. `
    + `Dès qu'ils sont faits (${EXEMPLE}, par exemple), appuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici : l'équipe vérifie chez le broker, et je te redonne ton lien vers le groupe.`
}

/** La ligne ajoutee a sa situation d'acces broker tant que ses lots sont a faire. */
export function ligneLotsAFaire(limite: string, declare: boolean): string {
  return declare
    ? `Tes premiers lots chez le broker : tu m'as dit qu'ils sont faits, l'équipe vérifie.`
    : `Tes premiers lots chez le broker sont à faire d'ici le ${dateLots(limite)} (${EXEMPLE}, par exemple). Quand c'est fait, dis-le-moi ici.`
}

/**
 * Les textes de situation, pour accesSansAbonnement (pur.ts, qui n'importe
 * rien). (31/10) depotPerdu : l'acces ferme pour un depot perdu (plus bas).
 */
export const TEXTES_LOTS_SITUATION = {
  enPause: texteAccesEnPauseLots, aFaire: ligneLotsAFaire, depotPerdu: (t: string) => texteAccesFermeDepot(t),
} as const

/** Apres le « Oui » de l'equipe, s'il est (ou semble) dans le groupe. */
export const TEXTE_LOTS_CONFIRMES = "Bonne nouvelle : l'équipe a bien vu tes lots chez le broker. Merci !"

/** Apres le « Oui » de l'equipe, s'il est hors du groupe : le lien suit sur un bouton. */
export const TEXTE_LOTS_CONFIRMES_RETOUR = "Bonne nouvelle : l'équipe a bien vu tes lots chez le broker, ton accès au groupe est rouvert. "
  + "Appuie sur le bouton ci-dessous et demande à rejoindre le groupe : c'est accepté tout seul."

/** Apres le « Oui », hors du groupe, sans lien possible la, tout de suite. */
export const TEXTE_LOTS_CONFIRMES_SANS_LIEN = "Bonne nouvelle : l'équipe a bien vu tes lots chez le broker, ton accès au groupe est rouvert. "
  + 'Écris-moi /menu pour avoir ton lien vers le groupe.'

/** Apres le « Non » de l'equipe. */
export function texteLotsPasVus(): string {
  return `L'équipe ne voit pas encore tes lots chez le broker. Quand c'est fait (${EXEMPLE}, par exemple), réappuie sur « ${BOUTON_LOTS.texte} » ou écris-le-moi ici. Une question ? Écris-moi ici, l'équipe te répond.`
}

// ---------------------------------------------------------------------------
// La carte de l'equipe dans Agent AOK (« Oui, lots tradés » / « Non, pas encore »)
// ---------------------------------------------------------------------------

/** callback_data : lt:o:<declaration> (oui), lt:n:<declaration> (non). */
export const PREFIXE_BOUTON_LOTS = 'lt:'

export type VerbeLots = 'oui' | 'non'

export function dataBoutonLots(id: number, verbe: VerbeLots): string {
  return `${PREFIXE_BOUTON_LOTS}${verbe === 'oui' ? 'o' : 'n'}:${Math.trunc(id)}`
}

export function lireBoutonLots(data: unknown): { id: number; verbe: VerbeLots } | null {
  const m = typeof data === 'string' ? /^lt:([on]):(\d{1,15})$/.exec(data) : null
  if (!m) return null
  const id = Number(m[2])
  return Number.isSafeInteger(id) && id > 0 ? { id, verbe: m[1] === 'o' ? 'oui' : 'non' } : null
}

/** Les deux boutons, chacun dit l'action (grille de Brice, 29/10). */
export function clavierCarteLots(id: number): { text: string; callback_data: string }[][] {
  return [[
    { text: 'Oui, lots tradés', callback_data: dataBoutonLots(id, 'oui') },
    { text: 'Non, pas encore', callback_data: dataBoutonLots(id, 'non') },
  ]]
}

/** La carte, courte (Melanie : « pas la patience des messages detailles »). Montants deja mis en forme. */
export function texteCarteLots(o: {
  qui: string
  email: string | null
  partenaire: string
  depot: string | null
  depotLe: string
  commission: string
  enPause: boolean
  /** Le jour des lots qui sera note (celui de la declaration). */
  lotsLe: string
}): string {
  const email = o.email && o.email !== o.qui ? ` (${o.email})` : ''
  return [
    `Lots à vérifier chez ${o.partenaire} : ${o.qui}${email} dit avoir tradé ses premiers lots.`,
    `Dépôt${o.depot ? ` de ${o.depot}` : ''} du ${dateLots(o.depotLe)}, commission attendue ${o.commission}.${o.enPause ? ' Son accès au groupe est en pause en attendant.' : ''}`,
    `Oui : je note ses lots faits le ${dateLots(o.lotsLe)} et je le préviens. Non : je lui dis que tu ne les vois pas encore.`,
  ].join('\n')
}

/** Une carte deja tranchee (un autre clic, ou l'autre membre de l'equipe). */
export function texteLotsDejaDecides(regle: string | null, par: string | null): string {
  const quoi = regle === 'lots_confirmes' ? 'lots notés tradés' : regle === 'lots_pas_vus' ? 'lots pas encore vus' : null
  return quoi ? `Déjà traité${par ? ` par ${par}` : ''} : ${quoi}.` : 'Cette carte est introuvable.'
}

/** Le marqueur de l'historique d'Agent AOK : la carte n'est pas une question de l'equipe. */
export const MARQUEUR_CARTE_LOTS = "[système] Carte « lots à vérifier », envoyée automatiquement par le bot des membres (ce n'est pas une question de l'équipe)."

// ---------------------------------------------------------------------------
// (31/10) LE DEPOT PERDU : pas de commission, pas d'acces
// ---------------------------------------------------------------------------
// Brice, 31/10 : « pas de commission pas d'acces, s'il y a un souci tu nous le
// fais remonter a moi et Mel et le membre doit regulariser sa situation. s'il
// a retire ses fonds sans activer son depot c'est comme annuler son
// abonnement ».
//
// La regle (lots-lecture.ts, lireFermes) : un acces broker actif dont un
// depot est marque PERDU (statut 'perdue', le broker ne paiera pas : fonds
// retires sans activer le depot, depot refuse...) depuis DEPOT_PERDU_DEPUIS,
// et dont AUCUN depot n'est attendu ni recu, est FERME, comme une fin
// d'abonnement : le droit dit 'non' (droits.ts, depotPerdu). C'est un ETAT
// LU, rien n'est ecrit sur l'acces :
// - le passage quotidien (passage.ts, tache p) le sort du groupe SANS ban,
//   lui ecrit une fois (texteFermetureDepot, en prive sinon par email), et
//   previent Brice et Melanie dans Agent AOK une fois par commission ;
// - la REGULARISATION le rouvre d'elle-meme : la commission remise en
//   attendue ou en lots faits par la carte d'Agent AOK (proposer_marquer_
//   commission, etat attendue ou lots_faits), ou un nouveau depot inscrit sur
//   le meme acces. Sur le modele du retour apres les lots : le lien de retour
//   part au clic de l'equipe s'il est hors du groupe, et le passage du
//   lendemain sert de filet (regle retour_depot, une fois par commission) ;
// - un depot douteux NON marque perdu : rien d'automatique, le suivi des lots
//   s'applique (pause apres le delai) ;
// - LIVECLUB_DEPOT_PERDU=0 coupe tout (config.ts, fermetureDepotPerduActive).

/**
 * (31/10) Les commissions marquees perdues AVANT ce jour (maj_le, jour de
 * Paris) ne ferment rien : pas de fermeture retroactive surprise, comme
 * SUIVI_LOTS_DEPUIS. A poser au jour du deploiement (ou avant, si l'equipe
 * veut fermer aussi les anciennes).
 */
export const DEPOT_PERDU_DEPUIS = '2026-10-31'

/** Le bouton qui transmet a l'equipe (le meme que « Contacter l'équipe » du menu). */
export const BOUTON_EQUIPE_DEPOT = { texte: "Contacter l'équipe", data: 'm:equipe' } as const

/** Le constat, sans reproche (Brice : le depot n'a pas ete active). */
const CONSTAT_DEPOT = "Ton accès au Live Club par le broker n'est plus valide : ton dépôt chez lui n'a pas été activé."

/** Les deux portes, puis comment regulariser. */
const PORTES_DEPOT = "Pour revenir, deux possibilités : régulariser avec l'équipe (un nouveau dépôt activé chez le broker, puis tes premiers lots tradés), ou t'abonner au Live Club. "
  + `Pour régulariser, appuie sur « ${BOUTON_EQUIPE_DEPOT.texte} » : l'équipe te répond ici.`

/**
 * Le message prive de la fermeture : le passage vient de le sortir du groupe
 * (sans ban), ou il n'y etait pas. texteAbonnement : la phrase des deux portes
 * d'abonnement (config.ts), passee par l'appelant (ce module n'importe rien).
 */
export function texteFermetureDepot(texteAbonnement: string): string {
  return [
    `Salut ! ${CONSTAT_DEPOT} Ton accès au groupe Telegram est donc fermé pour le moment.`,
    PORTES_DEPOT,
    texteAbonnement,
  ].join('\n\n')
}

/** Sa situation quand l'acces est ferme (/start, /menu, « Mon abonnement », demande d'adhesion, outil mon_abonnement). */
export function texteAccesFermeDepot(texteAbonnement: string): string {
  return [CONSTAT_DEPOT, PORTES_DEPOT, texteAbonnement].join('\n\n')
}

/** Apres la regularisation, hors du groupe : le lien suit sur un bouton. */
export const TEXTE_DEPOT_REGULARISE_RETOUR = 'Bonne nouvelle : ta situation avec le broker est régularisée, ton accès au groupe est rouvert. '
  + "Appuie sur le bouton ci-dessous et demande à rejoindre le groupe : c'est accepté tout seul."

/** Apres la regularisation, hors du groupe, sans lien possible la, tout de suite. */
export const TEXTE_DEPOT_REGULARISE_SANS_LIEN = 'Bonne nouvelle : ta situation avec le broker est régularisée, ton accès au groupe est rouvert. '
  + 'Écris-moi /menu pour avoir ton lien vers le groupe.'

/** Ce qui est arrive au membre au passage (la ligne 2 de l'alerte). */
export type IssueFermetureDepot = 'sorti' | 'absent' | 'sans_compte' | 'garde'

/**
 * L'ALERTE a Brice et Melanie dans Agent AOK (une fois par commission), trois
 * lignes courtes (Melanie : « pas la patience des messages detailles »).
 * Montant deja mis en forme ; message = le canal du message au membre, null
 * s'il n'a pas pu partir (ou rien a lui dire : 'garde').
 */
export function texteAlerteDepotPerdu(o: {
  qui: string
  email: string | null
  partenaire: string
  depot: string | null
  depotLe: string
  issue: IssueFermetureDepot
  message: 'prive' | 'email' | null
}): string {
  const email = o.email && o.email !== o.qui ? ` (${o.email})` : ''
  const message = o.message === 'prive' ? 'il a reçu en privé le message pour régulariser'
    : o.message === 'email' ? 'il a reçu par email le message pour régulariser'
      : "je n'ai pas pu lui écrire (bot pas ouvert, email qui ne passe pas)"
  const issue = o.issue === 'sorti' ? `Il est sorti du groupe, sans blocage, et ${message}.`
    : o.issue === 'absent' ? `Il n'était pas dans le groupe ; ${message}.`
      : o.issue === 'sans_compte' ? `Il n'est pas encore entré dans le groupe ; ${message}.`
        : "Il garde le groupe par un autre accès (abonnement ou accès offert) : rien n'a changé pour lui."
  return [
    `Commission perdue chez ${o.partenaire} : l'accès broker de ${o.qui}${email} est fermé (pas de commission, pas d'accès). Dépôt${o.depot ? ` de ${o.depot}` : ''} du ${dateLots(o.depotLe)}.`,
    issue,
    "S'il régularise (nouveau dépôt activé, lots tradés), dis-le-moi : je remets sa commission en attendue ou en lots faits, et son accès rouvre.",
  ].join('\n')
}

/** Le marqueur de l'historique d'Agent AOK : l'alerte n'est pas une question de l'equipe. */
export const MARQUEUR_ALERTE_DEPOT = "[système] Alerte « commission perdue, accès broker fermé », envoyée automatiquement par le passage du matin (ce n'est pas une question de l'équipe)."

/** La carte « marquer perdue » d'un depot dont l'acces se ferme (avant la confirmation). */
export const PHRASE_CARTE_PERTE_FERME = "Son accès broker au Live Club se ferme (pas de commission, pas d'accès) : au passage du matin, il sort du groupe sans blocage et reçoit un message pour régulariser ; Brice et Mel sont prévenus."

/** La meme, en court (carte de Melanie). */
export const ALERTE_CARTE_PERTE_FERME = 'Son accès broker au Live Club se ferme.'

/** La carte de regularisation d'une commission perdue (avant la confirmation). */
export const PHRASE_CARTE_REGULARISATION = 'Régularisation : la commission était perdue, elle redevient attendue, et son accès broker au Live Club rouvre (lien de retour vers le groupe s\'il en est sorti).'

/** Ce que le resultat dit apres la regularisation, selon ce qui s'est passe pour le membre. */
export type IssueRegularisation = 'lien' | 'lien_deja' | 'dans_le_groupe' | 'sans_lien' | 'pas_prevenu' | 'encore_ferme' | 'en_pause_lots' | 'panne'

export function phraseApresRegularisation(issue: IssueRegularisation): string {
  switch (issue) {
    case 'lien': return "Son accès broker au Live Club est rouvert : je l'ai prévenu et lui ai redonné son lien vers le groupe."
    case 'lien_deja': return 'Son accès broker au Live Club est rouvert ; son lien de retour était déjà parti.'
    case 'dans_le_groupe': return "Son accès broker au Live Club est rouvert ; il est toujours dans le groupe, rien d'autre à faire."
    case 'sans_lien': return "Son accès broker au Live Club est rouvert ; je n'ai pas pu lui envoyer son lien, le passage de demain matin réessaie."
    case 'pas_prevenu': return "Son accès broker au Live Club est rouvert (il n'avait pas encore été prévenu de la fermeture)."
    case 'encore_ferme': return "Son accès broker reste fermé : un autre dépôt de son accès est encore marqué perdu, sans dépôt attendu."
    case 'en_pause_lots': return 'Sa commission est de nouveau attendue, mais ses premiers lots ne sont pas notés faits et le délai est passé : son accès reste en pause tant que ses lots ne le sont pas.'
    case 'panne': return "Son accès broker devrait rouvrir, mais je n'ai pas pu le vérifier : le passage de demain matin s'en occupe."
  }
}
