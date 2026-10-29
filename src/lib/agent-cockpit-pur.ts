// Fonctions PURES de l'agent du Cockpit (08/10) : aucune base, aucun reseau,
// aucun import. scripts/verifier-liveclub.mjs les charge telles quelles.
//
// LES DEMANDES DE L'EQUIPE (Brice, 08/10 : « si elle fait une demande qui
// n'est pas encore prevue dans Cockpit, la demande doit pouvoir remonter
// jusqu'a notre task picker »). L'agent ne developpe pas : il NOTE
// (outil noter_demande, table cockpit_demandes), et la demande s'affiche dans
// l'onglet Support du cockpit, ou Brice la fait passer au task picker.

/** D'ou vient une demande : la fenetre du cockpit, ou Agent AOK sur Telegram. */
export type SourceDemande = 'agent_cockpit' | 'agent_telegram'

/** La demande reformulee : une phrase actionnable. */
export const MAX_TEXTE_DEMANDE = 300
/** La demande telle qu'ecrite (check de la table : 500 caracteres au plus). */
export const MAX_CITATION_DEMANDE = 500

export type DemandeLue = { texte: string; citation: string | null }

/**
 * Les parametres de noter_demande, ou la raison du refus (rendue au modele
 * pour qu'il corrige). Le texte est ramene a une ligne ; la citation garde
 * ses retours a la ligne et est coupee a 500 caracteres.
 */
export function lireDemande(brut: unknown): DemandeLue | string {
  const p = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>
  const texte = String(p.texte ?? '').replace(/\s+/g, ' ').trim()
  if (texte.length < 5) return 'texte : la demande reformulée en une phrase actionnable.'
  if (texte.length > MAX_TEXTE_DEMANDE) {
    return `texte trop long (${texte.length} caractères) : une seule phrase de ${MAX_TEXTE_DEMANDE} caractères au plus.`
  }
  const citation = String(p.citation ?? '').trim().slice(0, MAX_CITATION_DEMANDE).trim() || null
  return { texte, citation }
}

/**
 * L'auteur d'une demande : le libelle du compte Telegram de l'equipe
 * (cockpit_telegram_comptes) quand il est connu, sinon 'cockpit:<uuid>'.
 */
export function auteurDemande(o: { libelle?: string | null; userId: string }): string {
  const libelle = o.libelle?.trim().slice(0, 60)
  return libelle || `cockpit:${o.userId}`
}

// ---------------------------------------------------------------------------
// LE BOUTON DE LA CARTE (Brice, 29/10) : « un bouton a un clic, avec un
// libelle qui dit l'action precise ». Avant : « Confirmer et exécuter » pour
// tout. Le resume de la carte, au-dessus, garde le detail.
// ---------------------------------------------------------------------------

const LIBELLES_BOUTON: Record<string, string> = {
  code_promo: 'Créer le code promo',
  remboursement: 'Rembourser',
  produit: 'Créer le produit',
  revoquer_code: 'Désactiver le code',
  retirer_telegram: 'Retirer du groupe',
  reintegrer_telegram: 'Réintégrer dans le groupe',
  pause_abonnement: 'Mettre en pause',
  reprise_abonnement: 'Lever la pause',
  acces_broker: "Ouvrir l'accès broker",
  exemption: "Poser l'exemption",
  lien_paiement: 'Créer le lien de paiement',
  marquer_live_club: 'Marquer produit Live Club',
  abonnement_reserve: 'Réserver ce tarif',
  retirer_tarif_reserve: 'Retirer le tarif réservé',
  depot_broker: 'Inscrire le dépôt',
  commission_affiliation: 'Inscrire la commission',
  marquer_commission: 'Marquer la commission',
  taux_partenaire: 'Enregistrer le broker',
  intervenant: 'Enregistrer le tarif',
  lives_du_mois: 'Déclarer les lives',
  depense: 'Ajouter la dépense',
  reglement: 'Noter le règlement',
  effacement: "Lancer l'effacement",
  reponse_membre: 'Envoyer la réponse',
}

/** Le texte du bouton Confirmer d'une carte : l'action precise, jamais « exécuter l'image ». */
export function libelleBoutonConfirmer(type: string): string {
  return `✅ ${LIBELLES_BOUTON[type] ?? 'Confirmer et exécuter'}`
}

// ---------------------------------------------------------------------------
// LES BROUILLONS ET LE TEMPS (29/10, bug de Melanie du 28/10 : 6 brouillons de
// suite depassaient le temps de la fonction, voir agent-cockpit-telegram-pur.ts).
// ---------------------------------------------------------------------------

/** Brouillons de posts (generer_post) par message, au plus. Lances en parallele. */
export const MAX_GENERATIONS_PAR_TOUR = 3
/** Ce qu'un brouillon peut prendre (mesure le 28/10 : 25 a 37 s), avec de la marge. */
export const DUREE_GENERATION_MS = 50_000
/** Ce qu'il faut garder pour un dernier appel au modele (la reponse qui recopie les brouillons). */
export const MARGE_APPEL_MODELE_MS = 30_000

export const TEXTE_TROP_DE_BROUILLONS = `${MAX_GENERATIONS_PAR_TOUR} brouillons par message au plus. `
  + 'Rends ceux qui sont faits, puis dis en une ligne combien il en reste et que « continue » lance la suite.'
export const TEXTE_PLUS_LE_TEMPS_BROUILLON = "Pas lancé : plus assez de temps dans ce message pour un brouillon de plus. "
  + 'Rends ceux qui sont faits, puis dis en une ligne que « continue » lance la suite.'

/**
 * La reponse composee par le serveur quand la boucle s'arrete faute de temps :
 * les brouillons deja ecrits (TELS QUELS, ils sont aussi dans le Cockpit), et
 * comment reprendre. Jamais une reponse vide.
 */
export function reponsePartielle(o: { brouillons: readonly string[] }): string {
  const tete = "Je n'ai pas pu finir dans le temps d'un message."
  const suite = 'Dis « continue » et je reprends là où je me suis arrêté.'
  const brouillons = o.brouillons.map(b => b.trim()).filter(Boolean)
  if (brouillons.length === 0) return `${tete} ${suite}`
  const n = brouillons.length
  return [
    `${tete} ${n === 1 ? 'Un brouillon est prêt' : `${n} brouillons sont prêts`} (rangé${n > 1 ? 's' : ''} aussi dans le Cockpit, onglet Création) :`,
    ...brouillons.map((b, i) => (n > 1 ? `Brouillon ${i + 1}\n\n${b}` : b)),
    suite,
  ].join('\n\n')
}
