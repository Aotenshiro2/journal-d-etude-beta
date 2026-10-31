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
 * (31/10, Brice) Melanie « n'a pas la patience des messages detailles » : ses
 * cartes partent en version courte (resumeCourtRepartition). Le libelle de
 * cockpit_allowlist ('Mélanie'), accents et casse ignores.
 */
export function estMelanie(qui: string | null | undefined): boolean {
  const s = String(qui ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
  return s === 'melanie' || s === 'mel'
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
  // « Arrêter », pas « Annuler » : sur Telegram, il voisine avec le bouton Annuler de la carte.
  annulation_abonnement: "Arrêter l'abonnement",
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

// ---------------------------------------------------------------------------
// (31/10, Brice) PAS DE NOM D'OUTIL DANS UNE REPONSE. Constate le 31/10 :
// « je proposerai alors la carte proposer_taux_partenaire pour enregistrer
// l'accord date ». La consigne est dans le prompt (agent-cockpit.ts, « TES
// OUTILS SONT INTERNES ») ; ce filet du serveur remplace, dans le texte
// envoye a l'equipe (reponse et carte), un nom d'outil connu par ce qu'il fait.
// ---------------------------------------------------------------------------

/**
 * Chaque outil d'Agent AOK et ce qu'il fait, dit en francais (avec son
 * article). Tout outil ajoute a OUTILS doit y entrer : verifier-depot-perdu.mjs
 * compare les deux listes.
 */
export const DESCRIPTIONS_OUTILS: Readonly<Record<string, string>> = {
  requete_sql: 'une lecture de la base',
  proposer_code_promo: 'la carte de code promo',
  proposer_remboursement: 'la carte de remboursement',
  proposer_revoquer_code: 'la carte qui désactive le code',
  proposer_pause_abonnement: "la carte de pause de l'abonnement",
  proposer_reprise_abonnement: "la carte de reprise de l'abonnement",
  proposer_annulation_abonnement: "la carte d'arrêt de l'abonnement",
  proposer_retirer_telegram: 'la carte de sortie du groupe',
  proposer_reintegrer_telegram: 'la carte de retour dans le groupe',
  proposer_acces_broker: "la carte d'accès broker",
  proposer_exemption: "la carte d'accès offert",
  proposer_depot_broker: 'la carte de dépôt broker',
  proposer_commission_affiliation: "la carte de commission d'affiliation",
  proposer_marquer_commission: 'la carte de suivi de la commission',
  proposer_taux_partenaire: "la carte d'accord du broker",
  proposer_intervenant: "la carte de tarif de l'intervenant",
  proposer_lives_du_mois: 'la carte des lives du mois',
  proposer_depense: 'la carte de dépense',
  proposer_reglement: 'la carte de règlement entre Brice et Mel',
  repartition_du_mois: 'le calcul de la répartition du mois',
  fiche_personne: 'la fiche de la personne',
  noter_demande: 'la note dans les demandes du Cockpit',
  proposer_produit: 'la carte de produit',
  proposer_lien_paiement: 'la carte de lien de paiement',
  proposer_marquer_live_club: 'la carte qui fait ouvrir le Live Club à ce produit',
  proposer_abonnement_reserve: 'la carte de tarif réservé',
  proposer_retirer_tarif_reserve: 'la carte qui retire le tarif réservé',
  proposer_effacement: "la carte d'effacement",
  proposer_reponse_membre: 'la carte de réponse au membre',
  rendre_la_main_au_bot: 'la main rendue au bot',
  demandes_en_suspens: 'la liste des demandes en suspens',
  reprendre_demande: 'la relance de la demande',
  poser_question_equipe: "la question à l'équipe",
  rapporter_reponse_equipe: 'la réponse rapportée',
  generer_post: 'un brouillon de post',
}

const NOMS_OUTILS = Object.keys(DESCRIPTIONS_OUTILS).sort((a, b) => b.length - a.length)

/**
 * Un nom d'outil (avec ou sans accents graves, avec ou sans « la carte »,
 * « l'outil », « la fonction » devant) remplace par ce qu'il fait. Le reste du
 * texte ne bouge pas. Pur, sans effet sur un texte qui n'en contient pas.
 */
export function sansNomsOutils(texte: string): string {
  if (!texte || !/[a-z]_[a-z]/.test(texte)) return texte
  const motif = new RegExp(
    // l' ou l + apostrophe typographique (U+2019, ecrite en echappement).
    `(?:\\b(?:la|une|ta|cette|l'|l\\u2019)\\s*(?:carte|outil|fonction)\\s+(?:de\\s+)?)?\`?\\b(${NOMS_OUTILS.join('|')})\\b\`?(?:\\(\\))?`,
    'g',
  )
  return texte.replace(motif, (_m, nom: string) => DESCRIPTIONS_OUTILS[nom] ?? nom)
}
