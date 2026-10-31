// (31/10) L'ADRESSE DE CONTACT d'un acces broker : regles et textes, sans
// serveur (scripts/verifier-adresse-contact.mjs).
//
// Cas reel du 31/10 : Fabien est entre par un depot RaiseFx avec une adresse
// @libertysurf.fr, qui refuse nos emails comme spam (« 550 spam detected »).
// Brice, 31/10 : l'adresse de l'acces est celle de l'ACTIVATION chez le
// broker. Melanie s'en sert pour verifier depots et lots, et le tracking de
// l'affiliation en depend : elle ne change pas. On ajoute a l'acces une
// adresse de CONTACT, qui sert seulement a lui ECRIRE (invitation, relances
// des lots, fin d'acces, pause, fermeture). Sans elle : l'adresse de l'acces,
// comme avant. acces_id, dates, commission, lots, jeton et compte Telegram ne
// bougent pas.
//
// Table cockpit_liveclub_acces_contacts (migration 20261031210000) : une
// ligne par adresse posee, celle en cours = retire_le null. Changer = retirer
// l'ancienne et poser la nouvelle dans la meme transaction (adresse-contact.ts).

import { formaterDateFr, normaliserEmail } from './pur'
import { euros } from '../repartition/pur'

/** Le type d'action de la carte (stripe-actions.ts, agent-cockpit.ts). */
export const TYPE_ADRESSE_CONTACT = 'adresse_contact'
export const TABLE_CONTACTS = 'cockpit_liveclub_acces_contacts'
export const MIGRATION_CONTACTS = '20261031210000'
/** La regle de la ligne du journal (geste 'acces_broker'). */
export const REGLE_JOURNAL_CONTACT = 'adresse_contact'
/** La regle de l'invitation renvoyee a l'adresse de contact (geste 'invitation'). */
export const REGLE_INVITATION_CONTACT = 'broker_contact'
export const RAISON_MAX = 200

export const TEXTE_TABLE_ABSENTE = `Les adresses de contact ne sont pas encore en place (table ${TABLE_CONTACTS}, `
  + `migration ${MIGRATION_CONTACTS} à appliquer) : rien n'a été changé. Les emails partent à l'adresse de l'accès, comme avant.`

/** La table des adresses de contact manque (migration pas appliquee). */
export function tableContactsAbsente(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /42P01|relation .* does not exist/i.test(m) && m.includes(TABLE_CONTACTS)
}

// ---------------------------------------------------------------------------
// (31/10) L'ADRESSE D'ENVOI de tous les emails du Live Club a un membre
// (adresse-envoi.ts, une seule fonction serveur). Dans l'ordre :
//   1. l'adresse « communications » cochee par le membre dans Mon espace (son
//      compte AOK, retrouve par l'adresse d'identite verifiee, un seul compte) :
//      c'est SON choix, il passe en premier ;
//   2. l'adresse de contact posee par l'equipe sur son acces broker ;
//   3. l'adresse d'identite (acces ou abonnement), comme avant.
// L'adresse de l'acces (celle du broker) reste l'identite de l'acces et de la
// commission dans tous les cas.
// ---------------------------------------------------------------------------

export type SourceAdresseEnvoi = 'communications' | 'contact' | 'identite'

/** Le choix pur de l'adresse d'envoi. null = aucune adresse. */
export function choisirAdresseEnvoi(o: { communications: string | null; contact: string | null; identite: string | null }): { email: string; source: SourceAdresseEnvoi } | null {
  if (o.communications) return { email: o.communications, source: 'communications' }
  if (o.contact) return { email: o.contact, source: 'contact' }
  if (o.identite) return { email: o.identite, source: 'identite' }
  return null
}

/** La migration 20261031211000 (colonne profile_emails.communications, fonction aok_email_communications) manque. */
export const MIGRATION_COMMUNICATIONS = '20261031211000'
export function communicationsAbsentes(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err)
  return /42883|42703/.test(m)
    || /function .*aok_email_communications.* does not exist/i.test(m)
    || /column .*communications.* does not exist/i.test(m)
}

// ---------------------------------------------------------------------------
// Les parametres de la carte
// ---------------------------------------------------------------------------

export type ParamsAdresseContact = {
  /** L'adresse de l'acces broker (celle du broker), minuscules. */
  email_acces: string
  /** La nouvelle adresse de contact, minuscules ; null = retirer. */
  adresse_contact: string | null
  retirer: boolean
  raison: string | null
  // Poses par le controle avant la carte (ils ecrasent ce que donne le modele),
  // relus et compares a la base au clic.
  acces_id?: string
  contact_avant?: string | null
  invitation?: boolean
  /** Ou partiront les emails apres le clic (choisirAdresseEnvoi), pour la carte courte. */
  envoi_vers?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function cite(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/**
 * Les parametres lus strictement. Une chaine = un refus, rien n'est change :
 * adresse illisible, les deux adresses identiques, ou ni adresse ni retrait.
 */
export function lireParamsAdresseContact(p: Record<string, unknown>): ParamsAdresseContact | string {
  if (p.email_acces == null || String(p.email_acces).trim() === '') {
    return "email_acces : l'adresse de l'accès broker, celle du broker (de l'activation)."
  }
  const emailAcces = normaliserEmail(p.email_acces)
  if (!emailAcces) return `Adresse de l'accès illisible (« ${cite(p.email_acces)} ») : rien n'a été changé.`
  if (p.retirer != null && typeof p.retirer !== 'boolean') return 'retirer : vrai ou faux.'
  const retirer = p.retirer === true
  const brut = p.adresse_contact == null ? '' : String(p.adresse_contact).trim()
  if (retirer && brut) return 'Soit une nouvelle adresse de contact, soit le retrait : pas les deux.'
  if (!retirer && !brut) {
    return "adresse_contact : l'adresse où lui écrire (ou retirer vrai pour revenir à l'adresse de l'accès)."
  }
  let contact: string | null = null
  if (!retirer) {
    contact = normaliserEmail(brut)
    if (!contact) return `Adresse de contact illisible (« ${cite(brut)} ») : rien n'a été changé.`
    if (contact === emailAcces) {
      return `${contact} est déjà l'adresse de l'accès (celle du broker) : rien à changer.`
    }
  }
  const raison = p.raison == null ? null : String(p.raison).replace(/\s+/g, ' ').trim().slice(0, RAISON_MAX) || null
  const lu: ParamsAdresseContact = { email_acces: emailAcces, adresse_contact: contact, retirer, raison }
  if (typeof p.acces_id === 'string' && UUID.test(p.acces_id)) lu.acces_id = p.acces_id
  if ('contact_avant' in p) {
    lu.contact_avant = p.contact_avant == null ? null : normaliserEmail(p.contact_avant)
  }
  if (typeof p.invitation === 'boolean') lu.invitation = p.invitation
  const vers = typeof p.envoi_vers === 'string' ? normaliserEmail(p.envoi_vers) : null
  if (vers) lu.envoi_vers = vers
  return lu
}

// ---------------------------------------------------------------------------
// Ce qu'on lit de l'acces, et les refus
// ---------------------------------------------------------------------------

export type DepotLu = {
  partenaire: string
  montant: number
  /** 'YYYY-MM-DD' */
  le: string
  commission: number
  statut: 'attendue' | 'recue' | 'perdue'
  lotsFaitsLe: string | null
  montantRecu: number | null
  recueLe: string | null
}

export type LectureContact = {
  accesId: string
  /** L'adresse de l'acces (celle du broker), minuscules. */
  email: string
  debut: string
  jusquau: string
  telegramId: number | null
  /** invite_envoyee_le pose : l'invitation est partie (ou en cours). */
  inviteEnvoyee: boolean
  retire: boolean
  sorti: boolean
  /** jusquau passe. */
  fini: boolean
  /** Un jeton d'entree de cet acces a deja servi. */
  jetonServi: boolean
  /** L'adresse de contact en cours, ou null. */
  contact: string | null
  depots: DepotLu[]
  /** (31/10) L'adresse « communications » cochee par le membre dans Mon espace, ou null (choisirAdresseEnvoi). */
  communications?: string | null
}

/** Ou partiront les emails apres le clic : son choix, sinon l'adresse de contact (nouvelle), sinon l'adresse de l'acces. */
export function destinationApres(p: Pick<ParamsAdresseContact, 'retirer' | 'adresse_contact'>, l: Pick<LectureContact, 'communications' | 'email'>): string {
  return choisirAdresseEnvoi({
    communications: l.communications ?? null, contact: p.retirer ? null : p.adresse_contact, identite: l.email,
  })?.email ?? l.email
}

/** La nouvelle adresse sert-elle deja ailleurs ? */
export type UsageAilleurs = { accesAilleurs: boolean; contactAilleurs: boolean }

/** Le lien personnel a-t-il servi (compte Telegram relie, ou jeton utilise) ? */
export function lienServi(l: Pick<LectureContact, 'telegramId' | 'jetonServi'>): boolean {
  return l.telegramId !== null || l.jetonServi
}

/** L'acces court encore (ni retire, ni sorti, ni fini). */
function enCours(l: LectureContact): boolean {
  return !l.retire && !l.sorti && !l.fini
}

/**
 * Faut-il (re)envoyer l'invitation a l'adresse de contact ? Seulement pour une
 * adresse posee ou changee (pas un retrait), un acces en cours et un lien
 * personnel qui n'a pas servi.
 */
export function invitationAEnvoyer(p: Pick<ParamsAdresseContact, 'retirer'>, l: LectureContact): boolean {
  return !p.retirer && enCours(l) && !lienServi(l)
}

/**
 * La meme adresse de contact, mais l'invitation n'est pas partie (envoi rate,
 * ou remise « pas envoyee » par un refus definitif) : la carte la renvoie.
 */
export function renvoiSeul(p: ParamsAdresseContact, l: LectureContact): boolean {
  return !p.retirer && p.adresse_contact !== null && l.contact === p.adresse_contact
    && !l.inviteEnvoyee && invitationAEnvoyer(p, l)
}

/** Le refus, ou null. Le meme avant la carte et au clic (relu en base). */
export function refusAdresseContact(p: ParamsAdresseContact, l: LectureContact | null, ailleurs: UsageAilleurs | null): string | null {
  if (!l) {
    return `Aucun accès broker à l'adresse ${p.email_acces} : rien n'a été changé. Une adresse de contact s'ajoute à un accès `
      + "qui existe, à l'adresse du broker (celle de l'activation) : vérifie-la. Un nouvel accès ne sert qu'à une nouvelle personne."
  }
  if (l.retire) return `L'accès broker de ${l.email} a été retiré : rien n'a été changé.`
  if (l.fini || l.sorti) {
    return `L'accès broker de ${l.email} est terminé (${formaterDateFr(l.jusquau)}) : plus aucun email du Live Club ne lui part, rien n'a été changé.`
  }
  if (p.retirer) {
    return l.contact ? null : `L'accès de ${l.email} n'a pas d'adresse de contact : rien à retirer.`
  }
  const contact = p.adresse_contact as string
  if (l.contact === contact && !renvoiSeul(p, l)) {
    return `${contact} est déjà l'adresse de contact de l'accès de ${l.email} : rien à changer.`
  }
  if (ailleurs?.accesAilleurs) {
    return `${contact} a son propre accès broker (une adresse = un accès, non renouvelable) : elle ne peut pas servir `
      + "d'adresse de contact à un autre accès. Rien n'a été changé."
  }
  if (ailleurs?.contactAilleurs) {
    return `${contact} est déjà l'adresse de contact d'un autre accès broker : rien n'a été changé.`
  }
  return null
}

// ---------------------------------------------------------------------------
// La carte (longue, courte) et le resultat
// ---------------------------------------------------------------------------

const jour = (iso: string | null) => (iso ? formaterDateFr(iso) : '?')
const eur = (v: number | null) => euros(Math.round((v ?? 0) * 100))

/** Les depots inscrits sur l'acces et leur commission, une ligne chacun. */
export function lignesDepots(depots: readonly DepotLu[]): string[] {
  if (depots.length === 0) return ['Aucun dépôt inscrit sur cet accès.']
  return depots.map((d) => {
    const etat = d.statut === 'recue'
      ? `reçue (${eur(d.montantRecu)} le ${jour(d.recueLe)})`
      : d.statut === 'perdue'
        ? 'perdue'
        : `attendue${d.lotsFaitsLe ? `, lots faits le ${jour(d.lotsFaitsLe)}` : ''}`
    return `Dépôt ${d.partenaire} de ${eur(d.montant)} le ${jour(d.le)} : commission de ${eur(d.commission)} ${etat}.`
  })
}

/** La phrase obligatoire de la carte (Brice, 31/10). */
export function phraseAdresseBroker(emailAcces: string): string {
  return `L'adresse du broker reste ${emailAcces} : c'est elle qui compte pour la commission et les vérifications chez le broker.`
}

/** Ce qui part au clic, en une ligne. */
export function lignePart(p: ParamsAdresseContact, l: LectureContact): string {
  if (p.retirer) return 'Ce qui part : rien.'
  const vers = destinationApres(p, l)
  if (invitationAEnvoyer(p, l)) {
    return `Ce qui part : son lien personnel n'a pas encore servi, une nouvelle invitation part à ${vers} `
      + '(le même lien, pour le même accès).'
  }
  return `Ce qui part : rien. Son lien personnel a déjà servi, il garde son compte Telegram ; les prochains emails iront à ${vers}.`
}

/** (31/10) Le membre a choisi son adresse dans Mon espace : elle passe avant l'adresse de contact. */
export function phraseChoixMembre(communications: string): string {
  return `Il a choisi ${communications} dans Mon espace : son choix passe en premier, nos emails partent là tant qu'il le garde.`
}

/** La carte LONGUE (Brice) : l'acces, le depot et sa commission, ce qui part, ce qui ne bouge pas. */
export function carteAdresseContact(p: ParamsAdresseContact, l: LectureContact): string {
  const lignes: string[] = []
  const choix = l.communications ? ` ${phraseChoixMembre(l.communications)}` : ''
  if (p.retirer) {
    lignes.push(`Retirer l'adresse de contact ${l.contact} de l'accès broker de ${l.email} : les emails du Live Club repartent à ${destinationApres(p, l)}.${choix}`)
  } else if (renvoiSeul(p, l)) {
    lignes.push(`Renvoyer l'invitation de l'accès broker de ${l.email} à ${destinationApres(p, l)} : elle n'est pas partie.${choix}`)
  } else {
    lignes.push(`Écrire à ${p.adresse_contact} pour l'accès broker de ${l.email}${l.contact ? ` (à la place de ${l.contact})` : ''}. `
      + (l.communications
        ? phraseChoixMembre(l.communications)
        : "Tous les emails du Live Club à ce membre partiront là : invitation, relances des lots, fin d'accès, pause ou fermeture."))
  }
  lignes.push(phraseAdresseBroker(l.email))
  lignes.push(`Accès du ${jour(l.debut)} au ${jour(l.jusquau)}, ${lienServi(l) ? 'déjà entré (compte Telegram relié)' : 'pas encore entré'}.`)
  lignes.push(...lignesDepots(l.depots))
  lignes.push(lignePart(p, l))
  lignes.push("Rien d'autre ne bouge : l'accès, ses dates, la commission, les lots, son lien personnel et son compte Telegram.")
  if (p.raison) lignes.push(`Raison : ${p.raison}`)
  return lignes.join('\n')
}

/** La carte COURTE (Melanie, 31/10) : l'action et ce qui part, sans les regles. */
export function carteCourteAdresseContact(p: ParamsAdresseContact): string {
  if (p.retirer) {
    return `Retirer l'adresse de contact de ${p.email_acces} : les emails repartent à ${p.envoi_vers ?? p.email_acces}.`
  }
  const vers = p.envoi_vers ?? p.adresse_contact
  const part = p.invitation === true ? `Nouvelle invitation à ${vers}.` : 'Rien ne part (déjà entré).'
  const choix = vers !== p.adresse_contact ? ` Il a choisi ${vers} dans Mon espace : son choix passe en premier.` : ''
  return `Écrire à ${p.adresse_contact} pour l'accès de ${p.email_acces} (l'adresse du broker ne change pas).${choix} ${part}`
}

/** La premiere ligne de la carte quand le controle n'a pas encore lu la base (resumeAction). */
export function resumeAdresseContact(p: Record<string, unknown>): string {
  const lu = lireParamsAdresseContact(p)
  if (typeof lu === 'string') return `Adresse de contact d'un accès broker (${lu})`
  return lu.retirer
    ? `Retirer l'adresse de contact de l'accès broker de ${lu.email_acces}.`
    : `Écrire à ${lu.adresse_contact} pour l'accès broker de ${lu.email_acces}. ${phraseAdresseBroker(lu.email_acces)}`
}

export type IssueInvitationContact = 'partie' | 'pas_partie' | 'sans'

/** Le resultat rendu a l'equipe apres le clic. La derniere ligne dit l'etape humaine suivante. */
export function resultatAdresseContact(o: {
  emailAcces: string
  contact: string | null
  avant: string | null
  retirer: boolean
  renvoi: boolean
  invitation: IssueInvitationContact
  erreur?: string | null
  jusquau: string
  /**
   * (31/10) Ou partent ses emails maintenant (choisirAdresseEnvoi) : son
   * adresse choisie dans Mon espace si elle existe. Absente = l'adresse de
   * contact, ou celle de l'acces apres un retrait.
   */
  destination?: string | null
}): string {
  if (o.retirer) {
    return `Adresse de contact retirée de l'accès broker de ${o.emailAcces}${o.avant ? ` (c'était ${o.avant})` : ''} : `
      + `les emails du Live Club repartent à ${o.destination ?? o.emailAcces}.\nRien à faire.`
  }
  const vers = o.destination ?? o.contact
  const tete = o.renvoi
    ? `Adresse de contact de l'accès broker de ${o.emailAcces} : ${o.contact}, inchangée.`
    : `Adresse de contact notée pour l'accès broker de ${o.emailAcces} : ${o.contact}${o.avant ? ` (avant : ${o.avant})` : ''}.`
  const broker = `L'adresse du broker reste ${o.emailAcces} : commission et vérifications chez le broker inchangées.`
    + (vers !== o.contact ? ` Il a choisi ${vers} dans Mon espace : son choix passe en premier.` : '')
  if (o.invitation === 'partie') {
    return `${tete} ${broker}\nInvitation envoyée à ${vers}, avec son lien personnel (le même), valable jusqu'au ${jour(o.jusquau)}.\n`
      + "À faire : rien, il entre en ouvrant le lien de l'email."
  }
  if (o.invitation === 'pas_partie') {
    return `${tete} ${broker}\nATTENTION : l'invitation n'est PAS partie (${o.erreur ?? '?'}).\n`
      + 'À faire : redemande la même carte pour la renvoyer.'
  }
  return `${tete} ${broker}\nRien n'est parti : son lien a déjà servi, il garde son compte Telegram. Les prochains emails du Live Club iront à ${vers}.\n`
    + 'Rien à faire.'
}

/** Les parametres tels qu'ils peuvent aller dans un log : jamais une adresse. */
export function paramsPourLogContact(p: Record<string, unknown>): Record<string, unknown> {
  return { retirer: p.retirer === true, invitation: p.invitation ?? null, raison: p.raison ? 'oui' : 'non' }
}
