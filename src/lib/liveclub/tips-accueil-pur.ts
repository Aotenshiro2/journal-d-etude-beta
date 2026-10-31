// L'ACCUEIL ETALE EN CONSEILS (Brice, 31/10). Module PUR : les regles, les
// dates et les textes. Teste par scripts/verifier-tips-accueil.mjs.
//
// Brice, 31/10 : « etaler les messages d'infos du bot avec des messages courts
// comme des tips dans les jours qui suivent l'entree plutot que de tout donner
// d'un coup », et « ca cree aussi un lien entre eux et le bot ». Il ne voulait
// pas « les bombarder de messages ou de longs textes a leur premiere connexion ».
//
// Le calendrier, valide par Brice le 31/10 (memoire bot-infos-en-tips-etales) :
// - J0 : le message prive de l'admission, RACCOURCI (texteAdmission avec
//   `tips`, accueil-groupe.ts) : bienvenue, l'essentiel avec les liens
//   (Annonce, Replay, Trading chat), l'invitation a se presenter dans Bla-bla
//   avec les idees, et pour un acces broker le paragraphe des lots (la date
//   limite) ;
// - J+1 : l'academie ;
// - J+2 : les autres sujets, avec leur lien, et la ligne du challenge ;
// - J+4 : les liens utiles (« demande-moi ») ;
// - J+7 : l'abonnement (ou l'acces offert) et ses adresses email.
//
// Chaque conseil part du passage quotidien (passage.ts, tache q), le matin, un
// par jour au plus, une seule fois, trace dans le journal (geste 'rappel',
// regle 'tip_accueil', details.tip). L'etat est relu juste avant (grille de
// Brice, bot-messages-etat-pas-sequence) :
// - pas de conseil si le membre est sorti du groupe ou n'a plus de droit ;
// - pas de conseil si son fil Support attend l'equipe, ou si l'equipe a la
//   main (elle lui repond, le bot se tait) ;
// - un conseil dont il a deja parle (ses messages au bot ou au fil Support,
//   mots simples, dejaParle) est SAUTE (ligne 'refuse', motif deja_parle) ;
// - une relance des lots partie le meme jour passe avant : le conseil est
//   decale au lendemain.
// Seulement pour les NOUVEAUX entres depuis TIPS_ACCUEIL_DEPUIS, acceptes par
// le bot avec ce code (details.genre 'nouveau' sur la ligne entree_acceptee).
// Les membres d'avant ne recoivent rien ; un retour (30 jours ou plus dehors)
// et le cas « connu » gardent leur message court, sans conseils.
// LIVECLUB_TIPS_ACCUEIL=0 coupe tout (config.ts, tipsAccueilActifs) : le
// message de l'admission redevient alors le tour complet d'avant.

import { URL_FORMATION_LIVECLUB } from './config'
import { LIGNE_CHALLENGE_CORE_CONTENT, SUJETS_LIVECLUB, lienSujet } from './accueil-groupe'
import { jourPlus } from './lots-pur'

/**
 * (31/10) Les membres entres AVANT ce jour (jour de Paris) ne recoivent aucun
 * conseil. A poser au jour du deploiement (le message de l'admission change
 * le meme jour).
 */
export const TIPS_ACCUEIL_DEPUIS = '2026-10-31'

/** Les delais, en jours apres l'entree (Brice, 31/10). */
export const TIP_ACADEMIE_JOURS = 1
export const TIP_SUJETS_JOURS = 2
export const TIP_LIENS_JOURS = 4
export const TIP_ABONNEMENT_JOURS = 7

/** Au-dela, plus aucun conseil (un membre parti puis revenu longtemps apres n'en recoit pas). */
export const TIPS_FENETRE_JOURS = 21

export type CleTip = 'academie' | 'sujets' | 'liens' | 'abonnement'

/** Le calendrier, dans l'ordre. */
export const TIPS_ACCUEIL: readonly { cle: CleTip; jours: number }[] = [
  { cle: 'academie', jours: TIP_ACADEMIE_JOURS },
  { cle: 'sujets', jours: TIP_SUJETS_JOURS },
  { cle: 'liens', jours: TIP_LIENS_JOURS },
  { cle: 'abonnement', jours: TIP_ABONNEMENT_JOURS },
]

/** Le nom d'un conseil, pour le journal et le fil Support. */
export const NOMS_TIPS: Readonly<Record<CleTip, string>> = {
  academie: "l'académie",
  sujets: 'les autres sujets du groupe',
  liens: 'les liens utiles',
  abonnement: "l'abonnement et les adresses email",
}

export function estCleTip(v: unknown): v is CleTip {
  return v === 'academie' || v === 'sujets' || v === 'liens' || v === 'abonnement'
}

// ---------------------------------------------------------------------------
// Les dates
// ---------------------------------------------------------------------------

/** Ce que le passage lit pour un membre. Jours 'YYYY-MM-DD' (Paris). */
export type EtatTips = {
  /** Le jour de son entree (ligne entree_acceptee, genre nouveau). */
  entreLe: string
  aujourdhui: string
  /** Les conseils deja envoyes ou sautes. */
  traites: ReadonlySet<CleTip>
  /** Un conseil est deja parti aujourd'hui (un par jour au plus). */
  envoyeAujourdhui: boolean
  /** Une relance des lots est partie aujourd'hui : elle passe avant, le conseil attend demain. */
  relanceLotsAujourdhui: boolean
}

/**
 * Les conseils a regarder aujourd'hui, dans l'ordre : dus (le delai est
 * atteint) et pas encore traites. Le passage envoie le premier ; un conseil
 * dont le membre a deja parle est saute, et le suivant peut partir le meme
 * jour. Vide : rien aujourd'hui (trop tot, deja un conseil, relance des lots,
 * hors fenetre, entree d'avant TIPS_ACCUEIL_DEPUIS).
 */
export function tipsDus(e: EtatTips): CleTip[] {
  if (e.entreLe.slice(0, 10) < TIPS_ACCUEIL_DEPUIS) return []
  if (e.aujourdhui > jourPlus(e.entreLe, TIPS_FENETRE_JOURS)) return []
  if (e.envoyeAujourdhui || e.relanceLotsAujourdhui) return []
  return TIPS_ACCUEIL
    .filter(t => !e.traites.has(t.cle) && e.aujourdhui >= jourPlus(e.entreLe, t.jours))
    .map(t => t.cle)
}

// ---------------------------------------------------------------------------
// Un sujet dont il a deja parle (« quand c'est simple a savoir »)
// ---------------------------------------------------------------------------

/** Des mots simples, cherches dans SES messages (au bot et au fil Support). */
const MOTS_DEJA_PARLES: Readonly<Record<CleTip, RegExp>> = {
  academie: /acad[ée]mie|formation|\bcours\b|\bmodules?\b/i,
  sujets: /\bsujets?\b|explication charts|mindset|core content|macro ?breaker|\bpdf\b|vos r[ée]sultats|challenge|\bquiz\b/i,
  liens: /liens? utiles?|\bbrokers?\b|prop ?firms?|\boutils?\b/i,
  abonnement: /abonnement|\bpause\b|arr[êe]t(er)?\b|r[ée]silie|adresses? (e-?)?mail|autre (adresse|e-?mail)/i,
}

export function dejaParle(cle: CleTip, textesDuMembre: readonly string[]): boolean {
  return textesDuMembre.some(t => typeof t === 'string' && MOTS_DEJA_PARLES[cle].test(t))
}

// ---------------------------------------------------------------------------
// Les textes (tutoiement, prive ; caracteres clavier, sans « jamais »)
// ---------------------------------------------------------------------------

type SujetListe = { nom: string; sujet: number; quoi: string }

/** J+2 : les autres sujets (Bla-bla est au J0, Liens utiles au J+4). */
const SUJETS_DU_TIP: readonly SujetListe[] = [
  { nom: 'Explication charts', sujet: SUJETS_LIVECLUB.explicationCharts, quoi: 'des charts expliqués' },
  { nom: 'Mindset', sujet: SUJETS_LIVECLUB.mindset, quoi: 'le mental du trader' },
  { nom: 'Core content by MELMOM', sujet: SUJETS_LIVECLUB.coreContentMelmom, quoi: 'les contenus de fond de Mélanie' },
  { nom: 'Macro Breaker strat', sujet: SUJETS_LIVECLUB.macroBreaker, quoi: 'la stratégie Macro Breaker' },
  { nom: 'PDF', sujet: SUJETS_LIVECLUB.pdf, quoi: 'les supports en PDF' },
  { nom: 'Vos résultats', sujet: SUJETS_LIVECLUB.vosResultats, quoi: 'pour partager tes résultats' },
]

/** Les sujets du conseil J+2, dans l'ordre (verifier-tips-accueil.mjs). */
export const SUJETS_TIP_SUJETS: readonly number[] = SUJETS_DU_TIP.map(s => s.sujet)

/** « - Nom, ce que c'est : lien ». L'adresse finit la ligne. */
function ligneSujet(s: SujetListe, chat: number | null): string {
  const lien = lienSujet(chat, s.sujet)
  return `- ${s.nom}, ${s.quoi}${lien ? ` : ${lien}` : ''}`
}

export type OptionsTip = {
  /** chat_id du groupe : les liens des sujets en viennent. null = sujets nommes, sans lien. */
  chat: number | null
  /** Acces sans abonnement (exemption, acces broker, acces manuel). */
  accesOffert: boolean
}

/** Le texte d'un conseil. */
export function texteTip(cle: CleTip, o: OptionsTip): string {
  switch (cle) {
    case 'academie': {
      const email = o.accesOffert ? `l'email sous lequel l'équipe te connaît` : `l'email de ton abonnement`
      return `Petit conseil pour bien démarrer : les cours de formation inclus dans le Live Club t'attendent sur l'académie du site, en vidéo ou à lire, avec ta progression. `
        + `Connecte-toi avec ${email} (le compte se crée au même endroit si tu n'en as pas encore), et ils s'ouvrent tout seuls : ${URL_FORMATION_LIVECLUB}\n`
        + `Un cours reste fermé, ou tu cherches par où commencer ? Dis-le-moi ici.`
    }
    case 'sujets':
      return `Au fait, il y a d'autres sujets dans le groupe qui valent le détour :\n`
        + `${SUJETS_DU_TIP.map(s => ligneSujet(s, o.chat)).join('\n')}\n\n`
        + `${LIGNE_CHALLENGE_CORE_CONTENT}\n`
        + `Si tu te poses une question sur l'un d'eux, écris-moi ici.`
    case 'liens': {
      const lien = lienSujet(o.chat, SUJETS_LIVECLUB.liensUtiles)
      return `Un truc pratique à savoir : j'ai sous la main tous les liens utiles, les brokers proposés, les prop firms et les outils qui peuvent servir. `
        + (lien ? `Ils sont aussi rangés dans le sujet Liens utiles : ${lien}\n` : `Ils sont aussi rangés dans le sujet Liens utiles du groupe.\n`)
        + `Tu cherches l'un d'eux ? Demande-moi, je te donne le bon lien.`
    }
    case 'abonnement':
      return o.accesOffert
        ? `Dernier petit conseil, et après je te laisse tranquille : ton accès au Live Club t'est offert, donc rien à payer ni à gérer de ton côté. `
          + `Pour voir jusqu'à quand il court, appuie sur « Mon abonnement » ou demande-moi.\n`
          + `Tu utilises une autre adresse email que celle que l'équipe connaît ? Dis-le-moi, tu peux en avoir plusieurs.`
        : `Dernier petit conseil, et après je te laisse tranquille : ton abonnement se gère ici, avec moi. `
          + `Le voir, le mettre en pause de 1 à 6 mois ou l'arrêter : appuie sur « Mon abonnement », ou écris-le-moi simplement.\n`
          + `Et si tu as payé avec plusieurs adresses email, pas de souci, tu peux en avoir plusieurs : « Mon abonnement » te montre celles que je connais, et s'il en manque une, dis-le-moi.`
  }
}

/** Le bouton sous un conseil : « Mon abonnement » pour le dernier (le meme que le menu), rien sinon. */
export function boutonsTip(cle: CleTip): { texte: string; data: string }[][] | undefined {
  return cle === 'abonnement' ? [[{ texte: 'Mon abonnement', data: 'm:abo' }]] : undefined
}
