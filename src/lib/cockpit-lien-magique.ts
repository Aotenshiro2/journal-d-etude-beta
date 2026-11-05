// Connexion au cockpit par lien, avec toute adresse verifiee du compte (05/11) :
// la partie serveur. Regles, email et deroule : cockpit-lien-magique-pur.ts.
// Routes : /api/cockpit/lien-magique et /api/cockpit/lien-magique/ouvrir.
// Migration : 20261105220000_cockpit_lien_magique.sql (table
// cockpit_lien_magique_demandes, serveur seul).
//
// Secrets (deja poses sur le journal, rien de neuf) :
// - SUPABASE_SERVICE_ROLE_KEY : generateLink, et la racine des cles HMAC
//   (cleDerivee, une par usage). La changer rend les liens en cours
//   inutilisables (15 min) et remet les compteurs a zero, rien d'autre.
// - RESEND_API_KEY (ou RESEND_API_KEY_LIVECLUB) : l'envoi depuis support@.
// - COCKPIT_URL (facultative) : la base des liens, https://cockpit.aoknowledge.com
//   par defaut. Jamais lue dans la requete.
// - COCKPIT_LIEN_MAGIQUE=off (facultative) : coupe les deux routes (503). La
//   page de connexion du cockpit retombe alors sur l'ancien envoi par
//   Supabase (email de connexion seulement), et un lien deja recu ne s'ouvre plus.
//
// Jamais l'adresse, l'IP, le jeton du lien ni le token_hash dans un log.

import type { Prisma } from '@prisma/client'
import { Resend } from 'resend'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { relationAbsente } from '@/lib/liveclub/pur'
import { alerterEquipeTexte } from '@/lib/alerte-equipe-telegram'
import {
  EXPEDITEUR, JOURNAL_JOURS, SUPPORT, TYPE_JETON_SUPABASE,
  baseCockpit, genererJeton, htmlEmailLien, ouvrirLien, texteEmailLien, traiterDemande,
  type CompteCandidat, type CompteOuverture, type Compteurs, type Consommation, type IssueDemande, type JetonSupabase,
  type ModeleEmailLien, type Reponse, type TxDemande,
} from '@/lib/cockpit-lien-magique-pur'

const PREFIXE = '[cockpit/lien-magique]'

/** (05/11) L'interrupteur : COCKPIT_LIEN_MAGIQUE=off coupe les deux routes. */
const coupe = () => /^(off|non|0|false)$/i.test(process.env.COCKPIT_LIEN_MAGIQUE?.trim() ?? '')

/** Le secret des HMAC, ou null (la route rend 503 'config'). */
function secretServeur(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return s && s.length >= 32 ? s : null
}

function cleResend(): string | null {
  return process.env.RESEND_API_KEY?.trim() || process.env.RESEND_API_KEY_LIVECLUB?.trim() || null
}

let admin: SupabaseClient | null = null
function clientAdmin(): SupabaseClient | null {
  if (admin) return admin
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const cle = secretServeur()
  if (!url || !cle) return null
  admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return admin
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  if (relationAbsente(err)) return 'table absente (migration 20261105220000)'
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}

const journal = (ligne: string) => console.info(`${PREFIXE} ${ligne}`)

// ---------------------------------------------------------------------------
// La demande
// ---------------------------------------------------------------------------

type LigneCompteurs = {
  adresse_heure: number
  adresse_jour: number
  ip_heure: number
  ip_jour: number
  total_heure: number
  toutes_heure: number
  limites_heure: number
  envoyes_heure: number
  alerte_recente: boolean
}

type LigneCandidat = {
  user_id: string
  autorise: boolean
  lien: 'connexion' | 'verifiee' | 'non_verifiee'
  connexion_confirmee: boolean
}

const txDemande = (tx: Prisma.TransactionClient): TxDemande => ({
  async compter(emailHmac, ipHmac): Promise<Compteurs> {
    const l = (await tx.$queryRaw<LigneCompteurs[]>`
      select
        count(*) filter (where d.email_hmac = ${emailHmac} and d.issue <> 'limite' and d.cree_le > now() - interval '1 hour')::int as adresse_heure,
        count(*) filter (where d.email_hmac = ${emailHmac} and d.issue <> 'limite')::int as adresse_jour,
        count(*) filter (where d.ip_hmac = ${ipHmac} and d.issue <> 'limite' and d.cree_le > now() - interval '1 hour')::int as ip_heure,
        count(*) filter (where d.ip_hmac = ${ipHmac} and d.issue <> 'limite')::int as ip_jour,
        count(*) filter (where d.issue <> 'limite' and d.cree_le > now() - interval '1 hour')::int as total_heure,
        count(*) filter (where d.cree_le > now() - interval '1 hour')::int as toutes_heure,
        count(*) filter (where d.issue = 'limite' and d.cree_le > now() - interval '1 hour')::int as limites_heure,
        count(*) filter (where d.issue = 'envoye' and d.cree_le > now() - interval '1 hour')::int as envoyes_heure,
        coalesce(bool_or(d.alerte and d.cree_le > now() - interval '1 hour'), false) as alerte_recente
      from public.cockpit_lien_magique_demandes d
      where d.cree_le > now() - interval '1 day'`)[0]
    if (!l) throw new Error('compteurs illisibles')
    return {
      adresseHeure: l.adresse_heure, adresseJour: l.adresse_jour, ipHeure: l.ip_heure, ipJour: l.ip_jour,
      totalHeure: l.total_heure, toutesHeure: l.toutes_heure, limitesHeure: l.limites_heure, envoyesHeure: l.envoyes_heure,
      alerteRecente: l.alerte_recente,
    }
  },

  async candidats(email): Promise<CompteCandidat[]> {
    // Lecture seule. Les comptes dont l'email de connexion est l'adresse, et
    // ceux qui la portent dans profile_emails (verifiee ou non : une ligne non
    // verifiee ne sert qu'a nommer le refus dans le journal).
    const lignes = await tx.$queryRaw<LigneCandidat[]>`
      select
        u.id::text as user_id,
        exists (select 1 from public.cockpit_allowlist a where a.user_id = u.id) as autorise,
        case
          when lower(btrim(u.email)) = ${email} then 'connexion'
          when exists (select 1 from public.profile_emails pe
                        where pe.profile_id = u.id and lower(btrim(pe.email)) = ${email} and pe.verified) then 'verifiee'
          else 'non_verifiee'
        end as lien,
        (u.email_confirmed_at is not null) as connexion_confirmee
      from auth.users u
      where u.id in (
        select u2.id from auth.users u2 where lower(btrim(u2.email)) = ${email}
        union
        select pe.profile_id from public.profile_emails pe where lower(btrim(pe.email)) = ${email}
      )`
    return lignes.map(l => ({ userId: l.user_id, autorise: l.autorise, lien: l.lien, connexionConfirmee: l.connexion_confirmee }))
  },

  async consigner(l) {
    await tx.$executeRaw`
      insert into public.cockpit_lien_magique_demandes
        (email_hmac, ip_hmac, issue, user_id, par_connexion, lien_hmac, expire_le, alerte)
      values (
        ${l.emailHmac}, ${l.ipHmac}, ${l.issue}, ${l.userId}::uuid, ${l.parConnexion}, ${l.lienHmac},
        case when ${l.validiteMinutes}::int is null then null else now() + make_interval(mins => ${l.validiteMinutes}::int) end,
        ${l.alerte})`
    // Le journal ne garde que JOURNAL_JOURS jours.
    await tx.$executeRaw`
      delete from public.cockpit_lien_magique_demandes where cree_le < now() - make_interval(days => ${JOURNAL_JOURS}::int)`
  },
})

/** L'email du lien, par Resend, depuis support@. Ne jette pas. Jamais l'adresse ni le lien dans l'erreur rendue. */
async function envoyerEmail(cle: string, destinataire: string, m: ModeleEmailLien): Promise<{ ok: true } | { ok: false; erreur: string }> {
  try {
    const { error } = await new Resend(cle).emails.send({
      from: EXPEDITEUR,
      to: destinataire,
      replyTo: SUPPORT,
      subject: m.sujet,
      html: htmlEmailLien(m),
      text: texteEmailLien(m),
    })
    if (error) return { ok: false, erreur: `Resend : ${String(error.name ?? 'erreur').slice(0, 80)}` }
    return { ok: true }
  } catch (err) {
    return { ok: false, erreur: `Resend : ${err instanceof Error ? err.name : 'erreur'}` }
  }
}

/**
 * La demande d'un lien pour `email` (normalise). Rend la reponse et ce qui
 * part apres elle (email, alerte), a passer a after().
 */
export async function demanderLienCockpit(email: string, ip: string | null): Promise<IssueDemande> {
  if (coupe()) return { reponse: { status: 503, corps: { ok: false, erreur: 'coupe' } }, apres: null, issue: 'indisponible' }
  const secret = secretServeur()
  const cle = cleResend()
  if (!secret || !cle) {
    console.warn(`${PREFIXE} config incomplete : ${!secret ? 'SUPABASE_SERVICE_ROLE_KEY ' : ''}${!cle ? 'RESEND_API_KEY et RESEND_API_KEY_LIVECLUB' : ''}`.trim())
    return { reponse: { status: 503, corps: { ok: false, erreur: 'config' } }, apres: null, issue: 'indisponible' }
  }
  return traiterDemande({ email, ip }, {
    secret,
    urlCockpit: baseCockpit(process.env.COCKPIT_URL),
    maintenant: () => new Date(),
    jeton: genererJeton,
    dansVerrou: f => prisma.$transaction(async tx => {
      // Un seul verrou pour toutes les demandes : deux demandes simultanees ne
      // passent pas sous un plafond ensemble. Le cockpit en recoit quelques-unes par jour.
      await tx.$queryRaw`select count(*)::int as n from (select pg_advisory_xact_lock(hashtextextended('cockpit_lien_magique'::text, 0))) as verrou`
      return f(txDemande(tx))
    }),
    envoyerEmail: (destinataire, m) => envoyerEmail(cle, destinataire, m),
    envoiRate: async lienHmac => {
      await prisma.$executeRaw`
        update public.cockpit_lien_magique_demandes set issue = 'envoi_rate', lien_hmac = null
        where lien_hmac = ${lienHmac} and issue = 'envoye'`
    },
    alerter: async texte => { await alerterEquipeTexte(texte, { journal: `${PREFIXE} alerte rafale` }) },
    journal,
    codeErreur,
  })
}

// ---------------------------------------------------------------------------
// L'ouverture
// ---------------------------------------------------------------------------

/** Consomme le lien et rend le token_hash a passer a verifyOtp, ou un refus. */
export async function ouvrirLienCockpit(brut: unknown): Promise<Reponse> {
  if (coupe()) return { status: 503, corps: { ok: false, erreur: 'coupe', message: 'La connexion par lien est coupée pour le moment.' } }
  const secret = secretServeur()
  const client = clientAdmin()
  if (!secret || !client) {
    console.warn(`${PREFIXE} config incomplete : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY`)
    return { status: 503, corps: { ok: false, erreur: 'config' } }
  }
  return ouvrirLien(brut, {
    secret,
    async consommer(lienHmac): Promise<Consommation> {
      const pris = await prisma.$queryRaw<{ user_id: string; email_hmac: string }[]>`
        update public.cockpit_lien_magique_demandes
           set ouvert_le = now()
         where lien_hmac = ${lienHmac} and issue = 'envoye' and ouvert_le is null and expire_le > now()
           and user_id is not null
        returning user_id::text as user_id, email_hmac`
      if (pris[0]) return { etat: 'ok', userId: pris[0].user_id, emailHmac: pris[0].email_hmac }
      const l = (await prisma.$queryRaw<{ ouvert: boolean; expire: boolean }[]>`
        select (ouvert_le is not null) as ouvert, (expire_le is null or expire_le <= now()) as expire
        from public.cockpit_lien_magique_demandes where lien_hmac = ${lienHmac}`)[0]
      if (!l) return { etat: 'inconnu' }
      return { etat: l.ouvert ? 'utilise' : 'expire' }
    },
    async compte(userId): Promise<CompteOuverture | null> {
      const l = (await prisma.$queryRaw<{ email: string | null; confirme: boolean; autorise: boolean; verifiees: string[] | null }[]>`
        select
          u.email,
          (u.email_confirmed_at is not null) as confirme,
          exists (select 1 from public.cockpit_allowlist a where a.user_id = u.id) as autorise,
          (select array_agg(lower(btrim(pe.email))) from public.profile_emails pe
            where pe.profile_id = u.id and pe.verified) as verifiees
        from auth.users u where u.id = ${userId}::uuid`)[0]
      if (!l) return null
      return { autorise: l.autorise, emailConnexion: l.email, connexionConfirmee: l.confirme, verifiees: l.verifiees ?? [] }
    },
    async genererJeton(emailConnexion): Promise<JetonSupabase> {
      // 'recovery' et rien d'autre : sur une adresse inconnue, Supabase rend
      // une erreur au lieu de creer un compte (ce que ferait le type magiclink).
      // generateLink n'envoie aucun email.
      const { data, error } = await client.auth.admin.generateLink({ type: TYPE_JETON_SUPABASE, email: emailConnexion })
      if (error || !data?.user || !data.properties?.hashed_token) {
        return { ok: false, erreur: error ? `supabase ${error.status ?? ''} ${error.code ?? error.name}`.trim() : 'reponse vide' }
      }
      return { ok: true, userId: data.user.id, tokenHash: data.properties.hashed_token, type: data.properties.verification_type }
    },
    journal,
    codeErreur,
  })
}
