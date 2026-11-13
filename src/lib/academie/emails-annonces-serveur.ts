// EMAIL A TOUS LES MEMBRES DEPUIS LE COCKPIT, cote serveur (13/11/2026) : la base
// (requetes de emails-annonces.ts et emails-broadcast.ts) et l'envoi (simulation, essai
// transactionnel Resend, ou Broadcast Resend pour l'envoi aux membres).
//
// Variables du journal :
//   ANNONCES_EMAIL_MODE        « reel » pour envoyer vraiment. ABSENTE = SIMULATION (rien ne part,
//                              aucune ecriture chez Resend : seules des LECTURES pour verifier la cle,
//                              le domaine et ce que la synchronisation ferait). A poser sur le go de Brice.
//   RESEND_API_KEY_ANNONCES    la cle Resend de ces envois, sinon RESEND_API_KEY. Les contacts, segments
//                              et Broadcasts exigent une cle « Full access » (une « Sending access » est refusee).
//   ANNONCES_FROM_EMAIL        l'expediteur (une adresse @aoknowledge.com), sinon « AO Knowledge <support@...> ».
//   ANNONCES_DESINSCRIPTION_URL la route de desinscription des ESSAIS (https), sinon journal.aoknowledge.com.
//   SUPABASE_SERVICE_ROLE_KEY  deja posee : le secret des jetons de desinscription en est derive.
//
// Jamais une adresse, une cle ni un jeton dans un journal : l'envoi n'y ecrit que des
// nombres, 8 caracteres de l'id de l'envoi, et (simulation) le texte de l'email
// avec le lien personnel remplace.

import { Resend } from 'resend'
import {
  DELAI_GARDE_H, EXPEDITEUR_DEFAUT, GROUPES_ENVOI, LIBELLE_GROUPE, REPONSE_A, SQL_A_ENVOYER, SQL_BILLET, SQL_COMPTES_ENVOI,
  SQL_CREER_ENVOI, SQL_DERNIER_REEL, SQL_DESTINATAIRES, SQL_DETAIL_ECHECS, SQL_DETAIL_RAISONS, SQL_DROITS,
  SQL_FINIR_ENVOI, SQL_HISTORIQUE, SQL_INSCRIRE_ANNONCE, SQL_INSERER_DESTINATAIRES, SQL_NB_DESINSCRITS, SQL_NOTER_LOT,
  SQL_VERROU_REEL, SQL_ADRESSES_ESSAI, TAILLE_LOT, baseDesinscription, cleLot, compterGroupes, construireEmail,
  deriverSecret, droitsDe, entetesDesinscription, envoyeurSimulation, estGroupeEnvoi, etatGarde, jetonDesinscription, lienBouton,
  lienDesinscription, masquerEmails, statutFinal, transportDepuis, transportsGarde,
  type Destinataire, type Droits, type DroitsAppelant, type EmailDuLot, type EmailPret, type Envoyeur, type EtatGarde,
  type Groupe, type GroupeEnvoi, type ModeEnvoi, type Raison, type SaisieEmail, type Transport,
} from './emails-annonces'
import {
  LIMITES_GRATUIT, SEGMENTS_RESEND, SQL_BROADCASTS_PASSES, SQL_CONFIER, SQL_DESINSCRITS_BASE,
  SQL_IMPORTER_DESINSCRITS, SQL_NOTER_BROADCAST, SQL_NOTER_RESEND_LE, SQL_NOTER_SYNCHRO, SQL_SIMULER_TOUT, SUJET_RESEND,
  VARIABLE_DESINSCRIPTION, appel, appliquerPlan, cadence, ecrivainDepuisSdk, lecteurDepuisSdk, lireEtatResend, messageResend,
  nomBroadcast, payloadBroadcast, planifierSynchro, resumePlan, resumeResultat, toutesLesPages, trouverBroadcast, verifierCle,
  type DesinscritBase, type EtatResend, type LecteurResend, type ResumePlan, type SdkResend, type SegmentCle, type VerifCle,
} from './emails-broadcast'

export { envoyeurSimulation }

const PREFIXE = '[emails-annonces]'

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ConfigEnvoi = {
  /** Le mode du SERVEUR : simulation, ou resend (ANNONCES_EMAIL_MODE=reel). */
  transport: 'simulation' | 'resend'
  expediteur: string
  baseDesinscription: string
  cle: string | null
  secret: Buffer | null
}

export function configEnvoi(env: Record<string, string | undefined> = process.env): ConfigEnvoi {
  const exp = env.ANNONCES_FROM_EMAIL?.trim()
  let secret: Buffer | null = null
  try { secret = env.SUPABASE_SERVICE_ROLE_KEY ? deriverSecret(env.SUPABASE_SERVICE_ROLE_KEY) : null } catch { secret = null }
  return {
    transport: transportDepuis(env.ANNONCES_EMAIL_MODE),
    expediteur: exp && /@aoknowledge\.com>?$/i.test(exp) && !/[\r\n]/.test(exp) ? exp : EXPEDITEUR_DEFAUT,
    baseDesinscription: baseDesinscription(env.ANNONCES_DESINSCRIPTION_URL),
    cle: env.RESEND_API_KEY_ANNONCES?.trim() || env.RESEND_API_KEY?.trim() || null,
    secret,
  }
}

/** Le SDK Resend vu par emails-broadcast.ts (type structurel : le SDK 6.24 y entre sans conversion). */
function sdk(cfg: ConfigEnvoi): SdkResend | null {
  return cfg.cle ? new Resend(cfg.cle) : null
}

/** Les LECTURES Resend seulement (verifier la cle, le domaine, ce que la synchronisation ferait). */
export function lecteurResend(cfg: ConfigEnvoi): LecteurResend | null {
  const s = sdk(cfg)
  return s ? lecteurDepuisSdk(s) : null
}

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function lireDestinataires(c: ClientSql, groupe: Groupe): Promise<Destinataire[]> {
  const l = await c.$queryRawUnsafe<{ email: string; user_id: string | null; raison: Raison; desinscrit: boolean }[]>(SQL_DESTINATAIRES, groupe)
  return l.map((x) => ({ email: x.email, user_id: x.user_id, raison: x.raison, desinscrit: x.desinscrit === true }))
}

export async function lireDroits(c: ClientSql, userId: string): Promise<{ appelant: DroitsAppelant | null; droits: Droits }> {
  const l = await c.$queryRawUnsafe<DroitsAppelant[]>(SQL_DROITS, userId)
  const appelant = l[0] ?? null
  return { appelant, droits: droitsDe(appelant) }
}

/** La garde de 72 h : envois reels du meme monde (simulation, ou Resend : Broadcast et ancien batch). */
export async function lireGarde(c: ClientSql, serveur: 'simulation' | 'resend', maintenant: Date): Promise<EtatGarde> {
  const l = await c.$queryRawUnsafe<{ dernier: Date | null }[]>(SQL_DERNIER_REEL, transportsGarde(serveur))
  return etatGarde(l[0]?.dernier ? new Date(l[0].dernier) : null, maintenant)
}

export type LigneHistorique = {
  id: string; mode: ModeEnvoi; transport: Transport; groupe: string; groupe_libelle: string; objet: string; lien: string | null
  billet_id: string | null; destinataires: number; envoyes: number; echecs: number; exclus_desinscrits: number
  force_72h: boolean; statut: string; erreur: string | null; resend_broadcast_id: string | null; cree_le: string; fini_le: string | null; par: string | null
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null)

function libelleGroupe(g: string): string {
  if (g === 'essai_moi') return 'Essai : moi seulement'
  if (g === 'essai_equipe') return 'Essai : l\'équipe'
  return (LIBELLE_GROUPE as Record<string, string>)[g] ?? g
}

export async function lireHistorique(c: ClientSql): Promise<LigneHistorique[]> {
  const l = await c.$queryRawUnsafe<(Omit<LigneHistorique, 'cree_le' | 'fini_le' | 'groupe_libelle'> & { cree_le: Date; fini_le: Date | null })[]>(SQL_HISTORIQUE)
  return l.map((x) => ({
    ...x, groupe_libelle: libelleGroupe(x.groupe), destinataires: Number(x.destinataires), envoyes: Number(x.envoyes),
    echecs: Number(x.echecs), exclus_desinscrits: Number(x.exclus_desinscrits), cree_le: iso(x.cree_le) ?? '', fini_le: iso(x.fini_le),
  }))
}

/** Ce que l'ecran dit de la voie d'envoi (constantes, aucun appel a Resend). */
export type VoieEnvoi = {
  type: 'broadcast'
  segments: Record<SegmentCle, string>
  sujet: string
  limites: { contacts: number; segments: number }
}

export const VOIE: VoieEnvoi = { type: 'broadcast', segments: SEGMENTS_RESEND, sujet: SUJET_RESEND.nom, limites: { ...LIMITES_GRATUIT } }

export type EtatEmails = {
  transport: 'simulation' | 'resend'
  voie: VoieEnvoi
  expediteur: string
  delai_garde_h: number
  garde: EtatGarde
  droits: Droits
  groupes: { cle: GroupeEnvoi; libelle: string; total: number; desinscrits: number; a_envoyer: number }[]
  desinscrits_total: number
  historique: LigneHistorique[]
}

export async function lireEtat(c: ClientSql, userId: string, maintenant: Date, cfg: ConfigEnvoi): Promise<EtatEmails> {
  const [{ droits }, garde, tous, nb, historique] = await Promise.all([
    lireDroits(c, userId),
    lireGarde(c, cfg.transport, maintenant),
    lireDestinataires(c, 'tous'),
    c.$queryRawUnsafe<{ n: number }[]>(SQL_NB_DESINSCRITS),
    lireHistorique(c),
  ])
  const comptes = compterGroupes(tous)
  return {
    transport: cfg.transport,
    voie: VOIE,
    expediteur: cfg.expediteur,
    delai_garde_h: DELAI_GARDE_H,
    garde,
    droits,
    groupes: GROUPES_ENVOI.map((g) => ({ cle: g, libelle: LIBELLE_GROUPE[g], ...comptes[g] })),
    desinscrits_total: Number(nb[0]?.n ?? 0),
    historique,
  }
}

export type BilletPourEmail = { id: string; lien: string; publie: boolean; retire: boolean }

export async function lireBilletPourEmail(c: ClientSql, billetId: string): Promise<BilletPourEmail | null> {
  const l = await c.$queryRawUnsafe<{ id: string; module_slug: string; lecon_slug: string; publication_faite_le: Date | null; retire_le: Date | null }[]>(SQL_BILLET, billetId)
  const b = l[0]
  if (!b) return null
  return {
    id: b.id,
    lien: lienBouton(`https://aoknowledge.com/academie/${b.module_slug}/${b.lecon_slug}`),
    publie: b.publication_faite_le !== null,
    retire: b.retire_le !== null,
  }
}

/** L'apercu : l'email tel qu'un membre le recevra (lien de desinscription factice). */
export function apercu(s: Pick<SaisieEmail, 'objet' | 'texte'>, lien: string | null): EmailPret {
  return construireEmail({ objet: s.objet, texte: s.texte, lien, lienDesinscription: null, essai: false })
}

// ---------------------------------------------------------------------------
// Preparer un envoi (dans une transaction)
// ---------------------------------------------------------------------------

export type IssuePreparer =
  | { issue: 'ok'; envoiId: string; destinataires: number; exclus: number; force: boolean }
  | { issue: 'garde'; garde: EtatGarde }
  | { issue: 'confirmation'; attendu: number }
  | { issue: 'vide' }

/**
 * Cree l'envoi et ses lignes. Envoi reel : verrou (un a la fois), garde de 72 h
 * (sauf `forcer`, deja verifie par l'appelant), destinataires du groupe sans les
 * desinscrits, et `confirmation` doit egaler ce nombre (la liste a pu bouger
 * entre l'ecran et le clic). Essai : les adresses donnees, raison « essai ».
 * `transport` est celui de l'ENVOI (transportEnvoi) : simulation, resend (essai) ou broadcast.
 */
export async function preparerEnvoi(tx: ClientSql, o: {
  mode: ModeEnvoi; transport: Transport; saisie: SaisieEmail; lien: string | null; par: string; maintenant: Date
  forcer?: boolean; confirmation?: number; adressesEssai?: { email: string; user_id: string | null }[]; groupeEssai?: 'essai_moi' | 'essai_equipe'
}): Promise<IssuePreparer> {
  let lignes: { email: string; user_id: string | null; raison: Raison }[]
  let exclus = 0
  let force = false
  let groupe: string
  if (o.mode === 'reel') {
    await tx.$queryRawUnsafe(SQL_VERROU_REEL)
    const garde = await lireGarde(tx, o.transport === 'simulation' ? 'simulation' : 'resend', o.maintenant)
    if (garde.bloque && !o.forcer) return { issue: 'garde', garde }
    force = garde.bloque && o.forcer === true
    const tous = await lireDestinataires(tx, o.saisie.groupe)
    exclus = tous.filter((d) => d.desinscrit).length
    lignes = tous.filter((d) => !d.desinscrit).map(({ email, user_id, raison }) => ({ email, user_id, raison }))
    if (lignes.length === 0) return { issue: 'vide' }
    if (o.confirmation !== lignes.length) return { issue: 'confirmation', attendu: lignes.length }
    groupe = o.saisie.groupe
  } else {
    lignes = (o.adressesEssai ?? []).map((a) => ({ email: a.email, user_id: a.user_id, raison: 'essai' as const }))
    if (lignes.length === 0) return { issue: 'vide' }
    groupe = o.groupeEssai ?? 'essai_moi'
  }
  const cree = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_CREER_ENVOI,
    o.mode, o.transport, groupe, o.saisie.objet, o.saisie.texte, o.lien, o.saisie.billetId, lignes.length, exclus, force, o.par)
  const envoiId = cree[0].id
  await tx.$executeRawUnsafe(SQL_INSERER_DESTINATAIRES, envoiId,
    lignes.map((l) => l.email), lignes.map((l) => l.user_id ?? ''), lignes.map((l) => l.raison))
  return { issue: 'ok', envoiId, destinataires: lignes.length, exclus, force }
}

// ---------------------------------------------------------------------------
// Les ESSAIS : emails transactionnels (hors transaction, lot par lot)
// ---------------------------------------------------------------------------

/** RESEND : un appel batch par lot (100 au plus), validation permissive (un email refuse n'arrete pas les autres). */
export function envoyeurResend(cle: string, expediteur: string): Envoyeur {
  const resend = new Resend(cle)
  return async (lot, idem) => {
    try {
      const { data, error } = await resend.batch.send(lot.map((e) => ({
        from: expediteur,
        to: [e.email],
        replyTo: REPONSE_A,
        subject: e.pret.sujet,
        html: e.pret.html,
        text: e.pret.texte,
        headers: entetesDesinscription(e.lien),
        tags: [{ name: 'usage', value: 'annonce-academie' }],
      })), { idempotencyKey: idem, batchValidation: 'permissive' })
      if (error || !data) {
        const m = masquerEmails(error?.message ?? 'reponse vide')
        return lot.map((e) => ({ id: e.id, statut: 'echec' as const, resend_id: null, erreur: m }))
      }
      const erreurs = new Map<number, string>()
      for (const x of (data as { errors?: { index: number; message: string }[] }).errors ?? []) erreurs.set(x.index, masquerEmails(x.message))
      // Les ids rendus suivent l'ordre des emails acceptes : on les distribue en sautant les refuses.
      const ids = [...(data.data ?? [])]
      return lot.map((e, i) => {
        if (erreurs.has(i)) return { id: e.id, statut: 'echec' as const, resend_id: null, erreur: erreurs.get(i) ?? 'refuse' }
        const r = ids.shift()
        return r?.id
          ? { id: e.id, statut: 'envoye' as const, resend_id: r.id, erreur: null }
          : { id: e.id, statut: 'echec' as const, resend_id: null, erreur: 'pas d\'id rendu par Resend' }
      })
    } catch (err) {
      const m = masquerEmails(err)
      return lot.map((e) => ({ id: e.id, statut: 'echec' as const, resend_id: null, erreur: m }))
    }
  }
}

export function envoyeurPour(cfg: ConfigEnvoi): Envoyeur | { erreur: string } {
  if (cfg.transport === 'simulation') return envoyeurSimulation()
  if (!cfg.cle) return { erreur: 'RESEND_API_KEY_ANNONCES et RESEND_API_KEY absentes du projet journal : rien n\'est parti.' }
  return envoyeurResend(cfg.cle, cfg.expediteur)
}

const SQL_ENVOI = `
select id::text as id, mode, transport, groupe, objet, texte, lien, statut, resend_broadcast_id, cree_le
  from public.academie_emails_envois
 where id = $1::uuid`

type LigneEnvoi = {
  id: string; mode: ModeEnvoi; transport: Transport; groupe: string; objet: string; texte: string; lien: string | null
  statut: string; resend_broadcast_id: string | null; cree_le: Date
}

async function lireEnvoi(c: ClientSql, envoiId: string): Promise<LigneEnvoi> {
  const e = (await c.$queryRawUnsafe<LigneEnvoi[]>(SQL_ENVOI, envoiId))[0]
  if (!e) throw new Error('envoi introuvable')
  return e
}

export type BilanEnvoi = { envoiId: string; envoyes: number; echecs: number; a_envoyer: number; statut: string }

async function finir(c: ClientSql, envoiId: string, erreurForcee: string | null = null): Promise<BilanEnvoi> {
  const comptes = (await c.$queryRawUnsafe<{ a_envoyer: number; envoyes: number; echecs: number }[]>(SQL_COMPTES_ENVOI, envoiId))[0]
  const n = { a_envoyer: Number(comptes.a_envoyer), envoyes: Number(comptes.envoyes), echecs: Number(comptes.echecs) }
  const statut = statutFinal(n)
  const erreur = erreurForcee ?? (n.a_envoyer > 0 ? `${n.a_envoyer} email(s) restent a envoyer : reprendre l'envoi` : null)
  await c.$executeRawUnsafe(SQL_FINIR_ENVOI, envoiId, n.envoyes, n.echecs, statut, erreur ? erreur.slice(0, 500) : null)
  return { envoiId, ...n, statut }
}

/**
 * Envoie les lignes « a_envoyer » d'un envoi en emails transactionnels, lot par lot, jusqu'a
 * `limiteMs` : les ESSAIS (un envoi en Broadcast passe par envoyerParBroadcast). Rejouable :
 * une coupure laisse des lignes a_envoyer, « reprendre » les envoie (meme cle d'idempotence).
 */
export async function executerEnvoi(c: ClientSql, envoiId: string, cfg: ConfigEnvoi, envoyeur: Envoyeur, limiteMs = 45_000): Promise<BilanEnvoi> {
  if (!cfg.secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY absente : pas de lien de desinscription, rien ne part')
  const e = await lireEnvoi(c, envoiId)
  if (e.transport === 'broadcast') throw new Error('envoi en Broadcast : pas par cette voie')
  if (e.transport !== cfg.transport) throw new Error(`envoi prepare en ${e.transport}, serveur en ${cfg.transport} : rien ne part`)
  const court = envoiId.slice(0, 8)
  const debut = Date.now()
  const essai = e.mode === 'essai'
  for (let tour = 0; tour < 50 && Date.now() - debut < limiteMs; tour++) {
    const rangs = await c.$queryRawUnsafe<{ id: string; email: string }[]>(SQL_A_ENVOYER, envoiId, TAILLE_LOT)
    if (rangs.length === 0) break
    const lot: EmailDuLot[] = rangs.map((r) => {
      const lien = lienDesinscription(cfg.baseDesinscription, jetonDesinscription(cfg.secret as Buffer, r.id))
      return { id: r.id, email: r.email, lien, pret: construireEmail({ objet: e.objet, texte: e.texte, lien: e.lien, lienDesinscription: lien, essai }) }
    })
    const res = await envoyeur(lot, cleLot(envoiId, lot.map((x) => x.id)), court)
    await c.$executeRawUnsafe(SQL_NOTER_LOT, res.map((r) => r.id), res.map((r) => r.statut), res.map((r) => r.resend_id ?? ''), res.map((r) => r.erreur ?? ''))
    const ok = res.filter((r) => r.statut !== 'echec').length
    console.info(`${PREFIXE} envoi=${court} ${e.mode} ${e.transport} lot ${tour + 1} : ${ok} ok, ${res.length - ok} echec(s)`)
  }
  return finir(c, envoiId)
}

// ---------------------------------------------------------------------------
// La SYNCHRONISATION des contacts (base -> Resend ; desinscriptions dans les deux sens)
// ---------------------------------------------------------------------------

export type BilanSynchro = {
  mode: 'simulation' | 'reel'
  applique: boolean
  cle: VerifCle
  lu_chez_resend: boolean
  plan: ResumePlan | null
  resultat: ReturnType<typeof resumeResultat> | null
  erreur: string | null
}

const ETAT_VIDE: EtatResend = { segments: [], sujet: null, contacts: [], membres: { tous: [], comptes: [] }, importsEnCours: 0, desinscritsBroadcasts: [] }

/**
 * Compare notre groupe « tous » (et nos desinscrits) a Resend et, SEULEMENT si `appliquer`
 * ET que le serveur est en mode reel, ecrit le plan chez Resend. Sinon : lectures seules
 * (la cle, le domaine, l'etat de Resend) et le plan en nombres. Une cle qui n'est pas
 * « Full access » ne lit rien : le plan est calcule contre un Resend vide (tout serait cree).
 */
export async function synchroniser(c: ClientSql, cfg: ConfigEnvoi, o: { appliquer: boolean }): Promise<BilanSynchro> {
  const reel = o.appliquer && cfg.transport === 'resend'
  const mode = cfg.transport === 'resend' ? 'reel' : 'simulation'
  const l = lecteurResend(cfg)
  const cle = await verifierCle(l)
  const [tous, base, passes] = await Promise.all([
    lireDestinataires(c, 'tous'),
    c.$queryRawUnsafe<DesinscritBase[]>(SQL_DESINSCRITS_BASE),
    c.$queryRawUnsafe<{ id: string }[]>(SQL_BROADCASTS_PASSES),
  ])
  const cible = tous.map((d) => ({ email: d.email, compte: d.user_id !== null }))
  let etat = ETAT_VIDE
  let lu = false
  let erreur: string | null = null
  if (l && cle.acces === 'complet') {
    try { etat = await lireEtatResend(l, passes.map((p) => p.id)); lu = true } catch (err) { erreur = `Lecture de Resend : ${messageResend(err)}` }
  }
  const plan = planifierSynchro(cible, base, etat)
  const bilan: BilanSynchro = { mode, applique: false, cle, lu_chez_resend: lu, plan: resumePlan(plan), resultat: null, erreur }
  if (!reel) {
    console.info(`${PREFIXE} synchro SIMULATION : cle ${cle.acces}, lu ${lu}, ${plan.creer.length} a creer, ${plan.ajouter.length} ajout(s), ${plan.retirer.length} retrait(s), ${plan.pousser_desinscriptions.length} desinscription(s) a pousser, ${plan.importer_desinscriptions.length} a verser chez nous, rien d'ecrit`)
    return bilan
  }
  if (cle.acces !== 'complet') return { ...bilan, erreur: `${cle.message} Rien n'est synchronisé.` }
  if (!cle.domaine_verifie) return { ...bilan, erreur: `${cle.message} Rien n'est synchronisé.` }
  if (!lu) return { ...bilan, erreur: erreur ?? 'Resend n\'a pas pu être lu : rien n\'est synchronisé.' }
  if (plan.bloquants.length > 0) return { ...bilan, erreur: plan.bloquants.join(' ') }

  // 1. Resend -> base : les desinscriptions lues la-bas entrent chez nous (jamais l'inverse d'un reabonnement).
  if (plan.importer_desinscriptions.length > 0) await c.$executeRawUnsafe(SQL_IMPORTER_DESINSCRITS, plan.importer_desinscriptions)
  // 2. base -> Resend : contacts, segments, opt_out du sujet.
  const res = await appliquerPlan(ecrivainDepuisSdk(sdk(cfg) as SdkResend), etat, plan)
  if (res.emails_connus_de_resend.length > 0) await c.$executeRawUnsafe(SQL_NOTER_RESEND_LE, res.emails_connus_de_resend)
  const resume = resumeResultat(res)
  console.info(`${PREFIXE} synchro REELLE : ${res.crees} cree(s), ${res.importes} en import (${res.imports_lances} lot(s)), ${res.ajoutes} ajout(s), ${res.retires} retrait(s), ${res.pousses} desinscription(s) poussee(s), ${plan.importer_desinscriptions.length} versee(s) chez nous, ${res.erreurs.length} erreur(s)`)
  return { ...bilan, applique: true, resultat: resume, erreur: res.erreurs.length > 0 ? res.erreurs.join(' ; ').slice(0, 500) : null }
}

// ---------------------------------------------------------------------------
// L'ENVOI AUX MEMBRES : un Broadcast (ou sa simulation)
// ---------------------------------------------------------------------------

export type InfoBroadcast = { segment: string; sujet: string; simule: boolean; id: string | null; statut_resend: string | null }

/**
 * SIMULATION d'un Broadcast : l'email est rendu UNE fois avec la variable de desinscription de
 * Resend, ecrit dans le journal du serveur (aucune adresse), et les lignes sont notees « simule ».
 */
export async function simulerBroadcast(c: ClientSql, envoiId: string): Promise<BilanEnvoi & { broadcast: InfoBroadcast }> {
  const e = await lireEnvoi(c, envoiId)
  if (e.transport !== 'simulation' || e.mode !== 'reel') throw new Error('pas un envoi simule')
  const groupe: GroupeEnvoi = estGroupeEnvoi(e.groupe) ? e.groupe : 'tous'
  const pret = construireEmail({ objet: e.objet, texte: e.texte, lien: e.lien, lienDesinscription: VARIABLE_DESINSCRIPTION, essai: false })
  const n = await c.$executeRawUnsafe(SQL_SIMULER_TOUT, envoiId)
  console.info(`${PREFIXE} SIMULATION Broadcast envoi=${envoiId.slice(0, 8)} : segment « ${SEGMENTS_RESEND[groupe]} », sujet « ${SUJET_RESEND.nom} », ${n} destinataire(s), rien ne part. Sujet : ${pret.sujet}\n${pret.texte.split(VARIABLE_DESINSCRIPTION).join('[lien de desinscription de Resend]')}`)
  const bilan = await finir(c, envoiId)
  return { ...bilan, broadcast: { segment: SEGMENTS_RESEND[groupe], sujet: SUJET_RESEND.nom, simule: true, id: null, statut_resend: null } }
}

/**
 * L'envoi REEL aux membres : un Broadcast Resend vers le segment du groupe, limite au sujet.
 * En deux temps pour qu'une coupure ne cree jamais deux Broadcasts : 1. le brouillon (ou celui
 * qu'une tentative coupee a laisse, retrouve par l'id de l'envoi dans son nom), dont l'id est
 * aussitot garde en base ; 2. l'envoi du brouillon. Une reprise refait seulement ce qui manque.
 * Les lignes passent a « confie » quand Resend a accepte l'envoi.
 */
export async function envoyerParBroadcast(c: ClientSql, envoiId: string, cfg: ConfigEnvoi): Promise<BilanEnvoi & { broadcast: InfoBroadcast }> {
  const e = await lireEnvoi(c, envoiId)
  if (e.transport !== 'broadcast' || e.mode !== 'reel') throw new Error('pas un envoi en Broadcast')
  if (cfg.transport !== 'resend') throw new Error('serveur en simulation : rien ne part')
  const s = sdk(cfg)
  if (!s) throw new Error('aucune cle Resend : rien ne part')
  const l = lecteurDepuisSdk(s)
  const w = ecrivainDepuisSdk(s)
  const pas = cadence()
  const groupe: GroupeEnvoi = estGroupeEnvoi(e.groupe) ? e.groupe : 'tous'
  const info: InfoBroadcast = { segment: SEGMENTS_RESEND[groupe], sujet: SUJET_RESEND.nom, simule: false, id: e.resend_broadcast_id, statut_resend: null }
  const court = envoiId.slice(0, 8)

  const broadcasts = await toutesLesPages(pas, (after) => l.broadcasts({ after }))
  let existant = info.id ? broadcasts.find((b) => b.id === info.id) ?? null : trouverBroadcast(broadcasts, envoiId)
  if (!info.id && existant) {
    info.id = existant.id
    await c.$executeRawUnsafe(SQL_NOTER_BROADCAST, envoiId, existant.id)
  }
  if (!info.id) {
    const segments = await toutesLesPages(pas, (after) => l.segments({ after }))
    const segment = segments.find((x) => x.name === SEGMENTS_RESEND[groupe])
    const sujets = await appel(pas, () => l.sujets())
    const sujet = sujets.data?.data.find((x) => x.name === SUJET_RESEND.nom)
    if (!segment || !sujet) return { ...(await finir(c, envoiId, 'Segment ou sujet absent chez Resend : synchroniser d\'abord.')), broadcast: info }
    const pret = construireEmail({ objet: e.objet, texte: e.texte, lien: e.lien, lienDesinscription: VARIABLE_DESINSCRIPTION, essai: false })
    const r = await appel(pas, () => w.creerBroadcast(payloadBroadcast({
      segmentId: segment.id, sujetId: sujet.id, expediteur: cfg.expediteur, repondreA: REPONSE_A,
      sujet: pret.sujet, html: pret.html, texte: pret.texte, nom: nomBroadcast(envoiId, new Date(e.cree_le)),
    })))
    if (r.error || !r.data) return { ...(await finir(c, envoiId, `Broadcast refusé par Resend : ${messageResend(r.error)}`)), broadcast: info }
    info.id = r.data.id
    await c.$executeRawUnsafe(SQL_NOTER_BROADCAST, envoiId, info.id)
    existant = { id: info.id, name: null, status: 'draft' }
    console.info(`${PREFIXE} envoi=${court} broadcast brouillon cree`)
  }
  info.statut_resend = existant?.status ?? null
  if (!existant || existant.status === 'draft') {
    const r = await appel(pas, () => w.envoyerBroadcast(info.id as string))
    if (r.error) return { ...(await finir(c, envoiId, `Envoi du Broadcast refusé par Resend : ${messageResend(r.error)}`)), broadcast: info }
    info.statut_resend = 'queued'
  }
  await c.$executeRawUnsafe(SQL_CONFIER, envoiId, info.id)
  console.info(`${PREFIXE} envoi=${court} broadcast parti (${info.statut_resend}), segment ${groupe}`)
  return { ...(await finir(c, envoiId)), broadcast: info }
}

/** Le compte rendu de synchronisation garde sur l'envoi (nombres seulement). */
export async function noterSynchro(c: ClientSql, envoiId: string, s: BilanSynchro): Promise<void> {
  const corps = { mode: s.mode, applique: s.applique, cle: s.cle.acces, lu_chez_resend: s.lu_chez_resend, plan: s.plan, resultat: s.resultat, erreur: s.erreur }
  await c.$executeRawUnsafe(SQL_NOTER_SYNCHRO, envoiId, JSON.stringify(corps))
}

/** Inscrit un envoi reel dans « Annonces envoyees » (une fois). */
export async function inscrireAnnonce(c: ClientSql, envoiId: string, groupe: Groupe, destinataires: number): Promise<void> {
  const cible = `${LIBELLE_GROUPE[groupe]} : ${destinataires} destinataire${destinataires > 1 ? 's' : ''}`
  await c.$executeRawUnsafe(SQL_INSCRIRE_ANNONCE, envoiId, cible)
}

export async function lireDetail(c: ClientSql, envoiId: string): Promise<{ echecs: { email: string; raison: string; erreur: string }[]; raisons: { raison: string; n: number }[] }> {
  const [echecs, raisons] = await Promise.all([
    c.$queryRawUnsafe<{ email: string; raison: string; erreur: string }[]>(SQL_DETAIL_ECHECS, envoiId),
    c.$queryRawUnsafe<{ raison: string; n: number }[]>(SQL_DETAIL_RAISONS, envoiId),
  ])
  return { echecs, raisons: raisons.map((r) => ({ raison: r.raison, n: Number(r.n) })) }
}

export async function lireAdressesEssai(c: ClientSql, userId: string, pour: 'moi' | 'equipe'): Promise<{ email: string; user_id: string | null }[]> {
  return c.$queryRawUnsafe<{ email: string; user_id: string | null }[]>(SQL_ADRESSES_ESSAI, userId, pour)
}
