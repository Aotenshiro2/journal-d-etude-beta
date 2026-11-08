// Invitations des membres de Skool (08/11/2026) : l'ouverture du lien, partie serveur. Regles et deroule :
// invitations-pur.ts. Route : GET /api/academie/invitation?j=<jeton>. Table : academie_invitations
// (migration 20261108200000_academie_invitations.sql du depot workspace, serveur seul).
//
// Secrets (deja poses sur le journal, rien de neuf) :
// - SUPABASE_SERVICE_ROLE_KEY : creation du compte (admin.createUser) et generateLink.
// - ACADEMIE_INVITATIONS=off (facultative) : coupe la route, tout lien renvoie vers la connexion (repere
//   « erreur »). Le jeton reste valable : il remarche des que la variable est retiree.
//
// Jamais le jeton, le token_hash ni l'adresse dans un log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { relationAbsente } from '@/lib/liveclub/pur'
import {
  LOT_DEFAUT, SQL_COMPTE_CONNEXION, SQL_COMPTE_SECONDAIRE, SQL_NOTER, SQL_TROUVER, TYPE_LIEN_SUPABASE, URL_SITE,
  ouvrirInvitation, urlConnexionRepere,
  type CompteTrouve, type InvitationTrouvee, type IssueOuverture, type Version,
} from './invitations-pur'

const PREFIXE = '[academie/invitation]'

const coupe = () => /^(off|non|0|false)$/i.test(process.env.ACADEMIE_INVITATIONS?.trim() ?? '')

let admin: SupabaseClient | null = null
function clientAdmin(): SupabaseClient | null {
  if (admin) return admin
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || cle.length < 32) return null
  admin = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return admin
}

/** Le code de l'erreur (Prisma, Postgres, Supabase) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  if (relationAbsente(err)) return 'table absente (migration 20261108200000)'
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; status?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code, e.status].filter((x): x is string | number => typeof x === 'string' || typeof x === 'number')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}

type LigneTrouvee = { id: string; email: string; prenom: string | null; version: Version; expire_le: Date | null }

/** Le clic sur un lien d'invitation : l'adresse ou rediriger le navigateur. Ne jette pas. */
export async function ouvrirInvitationServeur(jeton: unknown): Promise<{ url: string; issue: IssueOuverture | 'coupe' | 'config' }> {
  if (coupe()) return { url: urlConnexionRepere('erreur'), issue: 'coupe' }
  const client = clientAdmin()
  if (!client) {
    console.warn(`${PREFIXE} config incomplete : NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY`)
    return { url: urlConnexionRepere('erreur'), issue: 'config' }
  }

  return ouvrirInvitation(jeton, {
    async trouver(jetonHash): Promise<InvitationTrouvee | null> {
      const l = (await prisma.$queryRawUnsafe<LigneTrouvee[]>(SQL_TROUVER, jetonHash))[0]
      return l ? { id: l.id, email: l.email, prenom: l.prenom, version: l.version, expireLe: l.expire_le } : null
    },

    async compte(email): Promise<CompteTrouve> {
      // L'email de CONNEXION d'abord : c'est le seul compte que ce lien peut ouvrir.
      const u = (await prisma.$queryRawUnsafe<{ user_id: string; confirme: boolean }[]>(SQL_COMPTE_CONNEXION, email))[0]
      if (u) return { etat: 'connexion', userId: u.user_id, confirme: u.confirme }
      const s = (await prisma.$queryRawUnsafe<{ secondaire: boolean }[]>(SQL_COMPTE_SECONDAIRE, email))[0]
      return s?.secondaire ? { etat: 'secondaire' } : null
    },

    async creerCompte(email, prenom) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        // Le lien n'arrive que dans cette boite : l'adresse est prouvee.
        email_confirm: true,
        // Lu par handle_new_user (profiles.first_name).
        user_metadata: prenom ? { first_name: prenom } : {},
        app_metadata: { invitation: LOT_DEFAUT },
      })
      if (error || !data?.user) {
        const code = error ? `${error.status ?? ''} ${error.code ?? error.name}`.trim() : 'reponse vide'
        const existe = error?.code === 'email_exists' || error?.status === 422 || /already/i.test(error?.message ?? '')
        return { ok: false, existe, erreur: code }
      }
      return { ok: true, userId: data.user.id }
    },

    async genererJeton(email) {
      // 'magiclink' sur un compte qui existe deja (trouve ou cree juste avant) : n'envoie aucun email, rend un
      // jeton a usage unique. Compte jamais confirme : Supabase rend un jeton 'signup', que verifyOtp confirme.
      const { data, error } = await client.auth.admin.generateLink({ type: TYPE_LIEN_SUPABASE, email })
      if (error || !data?.user || !data.properties?.hashed_token) {
        return { ok: false, erreur: error ? `supabase ${error.status ?? ''} ${error.code ?? error.name}`.trim() : 'reponse vide' }
      }
      return {
        ok: true,
        userId: data.user.id,
        email: data.user.email ?? null,
        tokenHash: data.properties.hashed_token,
        type: data.properties.verification_type,
      }
    },

    async noter(id, { userId, compteCree }) {
      await prisma.$executeRawUnsafe(SQL_NOTER, id, userId, compteCree)
    },

    journal: ligne => console.info(`${PREFIXE} ${ligne}`),
    codeErreur,
    maintenant: () => new Date(),
  }, URL_SITE)
}
