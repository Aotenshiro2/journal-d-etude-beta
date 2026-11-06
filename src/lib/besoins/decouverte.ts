// LES BESOINS DES MEMBRES, DECOUVERTE DANS LE JOURNAL (06/11/2026, apres-midi,
// pistes A, B et C du contrat besoins-contrat-api.md, choisies par Brice sans
// labo). Module CLIENT (aucun import serveur) : les textes et deux gestes.
//
// - A : le bouton du support dit « Aide et idées » (SupportBubble.tsx).
// - B : une bulle de decouverte UNE seule fois, memorisee dans le navigateur
//   (lecture et ecriture dans un try/catch : navigation privee, stockage
//   bloque = pas de bulle, rien ne casse) ; affichee = deja vue.
// - C : au moment d'un echec d'import, le signal journal.import_echec (sans
//   contenu : un code court) et une ligne qui ouvre « Il me manque quelque
//   chose » avec une phrase pre-remplie que le membre peut changer, puis
//   envoie lui-meme. La demande va sur la carte de la cle (POST
//   /api/besoins/signaler avec `signal`).
// Aucune minuterie : la bulle apparait en CSS, le signal part a l'evenement.

/** A : le libelle du bouton du support. A VALIDER PAR BRICE. */
export const LIBELLE_AIDE_IDEES = 'Aide et idées'

/** B : la bulle de decouverte. A VALIDER PAR BRICE. */
export const TEXTE_BULLE_DECOUVERTE = "Une question ou une idée pour cet outil ? C'est ici."

/** C : la ligne apres un fichier de trades non reconnu (format inconnu). A VALIDER PAR BRICE. */
export const LIGNE_IMPORT_NON_RECONNU = "Ton fichier n'a pas été reconnu. Tu veux qu'on ajoute ta plateforme ?"
/** C : la phrase pre-remplie, que le membre complete ou change. A VALIDER PAR BRICE. */
export const PHRASE_IMPORT_NON_RECONNU = "J'aimerais importer le fichier de trades de ma plateforme dans le Journal, il n'est pas reconnu. Ma plateforme : "

/** C : la ligne apres un autre echec de l'import. A VALIDER PAR BRICE. */
export const LIGNE_IMPORT_ECHEC = "L'import n'a pas marché. Tu veux le signaler à l'équipe ?"
/** C : la phrase pre-remplie d'un autre echec. A VALIDER PAR BRICE. */
export const PHRASE_IMPORT_ECHEC = "L'import de mon fichier de trades a échoué dans le Journal. "

/** C : le bouton de la ligne (il ouvre le formulaire pre-rempli, rien ne part sans « Envoyer »). A VALIDER PAR BRICE. */
export const BOUTON_LIGNE_BESOIN = "Oui, le dire à l'équipe"

/** La cle du navigateur : la bulle a ete montree (donc plus jamais). */
export const CLE_BULLE_VUE = 'aok-journal-bulle-aide-idees-vue'

/** L'evenement qui ouvre le formulaire pre-rempli dans le panneau du support. */
export const EVENEMENT_OUVRIR_BESOIN = 'aok:ouvrir-besoin'

export type BesoinPrerempli = { texte: string; signal: string | null }

/** La bulle a-t-elle deja ete montree ? Stockage illisible : oui (pas de bulle). */
export function bulleDejaVue(): boolean {
  try {
    return window.localStorage.getItem(CLE_BULLE_VUE) === '1'
  } catch {
    return true
  }
}

export function marquerBulleVue(): void {
  try {
    window.localStorage.setItem(CLE_BULLE_VUE, '1')
  } catch {
    /* stockage bloque : la bulle ne revient de toute facon pas dans cette page */
  }
}

/** Un signal de friction (meme origine, session par cookie). Ne jette pas, n'attend rien. */
export function envoyerSignal(app: string, cle: string, contexte: Record<string, string> = {}): void {
  try {
    void fetch('/api/besoins/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app, cle, contexte }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* rien : un signal perdu ne gene pas le membre */
  }
}

/** Ouvre « Il me manque quelque chose » pre-rempli (SupportBubble l'ecoute). */
export function ouvrirBesoin(d: BesoinPrerempli): void {
  try {
    window.dispatchEvent(new CustomEvent<BesoinPrerempli>(EVENEMENT_OUVRIR_BESOIN, { detail: d }))
  } catch {
    /* rien */
  }
}
