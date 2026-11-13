// EMAIL A TOUS LES MEMBRES DEPUIS LE COCKPIT, cote serveur (13/11/2026) : la base
// (requetes de emails-annonces.ts) et l'envoi (simulation ou Resend).
//
// Variables du journal :
//   ANNONCES_EMAIL_MODE        « reel » pour envoyer vraiment. ABSENTE = SIMULATION (rien ne part,
//                              l'email est ecrit dans les journaux du serveur). A poser sur le go de Brice.
//   RESEND_API_KEY_ANNONCES    la cle Resend de ces envois, sinon RESEND_API_KEY.
//   ANNONCES_FROM_EMAIL        l'expediteur (une adresse @aoknowledge.com), sinon « AO Knowledge <support@...> ».
//   ANNONCES_DESINSCRIPTION_URL la route de desinscription (https), sinon journal.aoknowledge.com.
//   SUPABASE_SERVICE_ROLE_KEY  deja posee : le secret des jetons de desinscription en est derive.
//
// Jamais une adresse ni un jeton dans un journal : l'envoi n'y ecrit que des
// nombres, 8 caracteres de l'id de l'envoi, et (simulation) le texte de l'email
// avec le lien personnel remplace.

import { Resend } from 'resend'
import {
  DELAI_GARDE_H, EXPEDITEUR_DEFAUT, GROUPES, LIBELLE_GROUPE, REPONSE_A, SQL_A_ENVOYER, SQL_BILLET, SQL_COMPTES_ENVOI,
  SQL_CREER_ENVOI, SQL_DERNIER_REEL, SQL_DESTINATAIRES, SQL_DETAIL_ECHECS, SQL_DETAIL_RAISONS, SQL_DROITS,
  SQL_FINIR_ENVOI, SQL_HISTORIQUE, SQL_INSCRIRE_ANNONCE, SQL_INSERER_DESTINATAIRES, SQL_NB_DESINSCRITS, SQL_NOTER_LOT,
  SQL_VERROU_REEL, SQL_ADRESSES_ESSAI, TAILLE_LOT, baseDesinscription, cleLot, compterGroupes, construireEmail,
  deriverSecret, droitsDe, entetesDesinscription, envoyeurSimulation, etatGarde, jetonDesinscription, lienBouton,
  lienDesinscription, masquerEmails, statutFinal, transportDepuis,
  type Destinataire, type Droits, type DroitsAppelant, type EmailDuLot, type EmailPret, type Envoyeur, type EtatGarde,
  type Groupe, type ModeEnvoi, type Raison, type SaisieEmail, type Transport,
} from './emails-annonces'

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
  transport: Transport
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

export async function lireGarde(c: ClientSql, transport: Transport, maintenant: Date): Promise<EtatGarde> {
  const l = await c.$queryRawUnsafe<{ dernier: Date | null }[]>(SQL_DERNIER_REEL, transport)
  return etatGarde(l[0]?.dernier ? new Date(l[0].dernier) : null, maintenant)
}

export type LigneHistorique = {
  id: string; mode: ModeEnvoi; transport: Transport; groupe: string; groupe_libelle: string; objet: string; lien: string | null
  billet_id: string | null; destinataires: number; envoyes: number; echecs: number; exclus_desinscrits: number
  force_72h: boolean; statut: string; erreur: string | null; cree_le: string; fini_le: string | null; par: string | null
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

export type EtatEmails = {
  transport: Transport
  expediteur: string
  delai_garde_h: number
  garde: EtatGarde
  droits: Droits
  groupes: { cle: Groupe; libelle: string; total: number; desinscrits: number; a_envoyer: number }[]
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
    expediteur: cfg.expediteur,
    delai_garde_h: DELAI_GARDE_H,
    garde,
    droits,
    groupes: GROUPES.map((g) => ({ cle: g, libelle: LIBELLE_GROUPE[g], ...comptes[g] })),
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
    const garde = await lireGarde(tx, o.transport, o.maintenant)
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
// Envoyer (hors transaction, lot par lot)
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
select id::text as id, mode, transport, objet, texte, lien, statut
  from public.academie_emails_envois
 where id = $1::uuid`

export type BilanEnvoi = { envoiId: string; envoyes: number; echecs: number; a_envoyer: number; statut: string }

/**
 * Envoie les lignes « a_envoyer » d'un envoi, lot par lot, jusqu'a `limiteMs`.
 * Rejouable : une coupure laisse des lignes a_envoyer, « reprendre » les envoie
 * (meme cle d'idempotence pour les memes lignes). Un envoi reel qui a fait partir
 * au moins un email s'inscrit dans « Annonces envoyees ».
 */
export async function executerEnvoi(c: ClientSql, envoiId: string, cfg: ConfigEnvoi, envoyeur: Envoyeur, limiteMs = 45_000): Promise<BilanEnvoi> {
  if (!cfg.secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY absente : pas de lien de desinscription, rien ne part')
  const e = (await c.$queryRawUnsafe<{ id: string; mode: ModeEnvoi; transport: Transport; objet: string; texte: string; lien: string | null; statut: string }[]>(SQL_ENVOI, envoiId))[0]
  if (!e) throw new Error('envoi introuvable')
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
  const comptes = (await c.$queryRawUnsafe<{ a_envoyer: number; envoyes: number; echecs: number }[]>(SQL_COMPTES_ENVOI, envoiId))[0]
  const n = { a_envoyer: Number(comptes.a_envoyer), envoyes: Number(comptes.envoyes), echecs: Number(comptes.echecs) }
  const statut = statutFinal(n)
  const erreur = n.a_envoyer > 0 ? `${n.a_envoyer} email(s) restent a envoyer : reprendre l'envoi` : null
  await c.$executeRawUnsafe(SQL_FINIR_ENVOI, envoiId, n.envoyes, n.echecs, statut, erreur)
  return { envoiId, ...n, statut }
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
