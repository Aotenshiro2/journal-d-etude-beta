// Connexion par adresse (14/11/2026) : la partie serveur des routes
// /api/connexion/adresse et /api/connexion/envoi. Règles, email et déroulé :
// connexion-adresse-pur.ts. Migration : 20261114200000_aok_connexion_adresse.sql
// du dépôt workspace.
//
// Secrets (déjà posés sur le journal, rien de neuf) :
// - SUPABASE_SERVICE_ROLE_KEY : les fonctions SQL (réservées à service_role,
//   appelées par PostgREST avec cette clé), generateLink, et la racine des clés
//   HMAC de l'IP et de l'adresse (une par usage). La changer remet les
//   compteurs à zéro, rien d'autre.
// - RESEND_API_KEY_LIVECLUB, sinon RESEND_API_KEY : l'envoi depuis support@
//   (même ordre que les codes d'ajout d'adresse, emails-confirmation.ts).
// - CONNEXION_ADRESSE=off (facultative) : coupe les deux routes ; la page du
//   site reçoit « simple » puis « indisponible » et retombe sur signInWithOtp.
//
// Jamais l'adresse, l'IP, le code, le jeton ni le token_hash dans un log.

import { Resend } from 'resend'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  EXPEDITEUR, SUPPORT, envoyer, reconnaitre,
  type EntreeEnvoi, type ModeleEmail, type Reconnaissance, type SortieEnvoi,
} from '@/lib/connexion-adresse-pur'

const PREFIXE = '[connexion/adresse]'

/** CONNEXION_ADRESSE=off coupe les deux routes. */
export const coupe = () => /^(off|non|0|false)$/i.test(process.env.CONNEXION_ADRESSE?.trim() ?? '')

/** Le secret des HMAC (et la clé de service), ou null. */
export function secretServeur(): string | null {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  return s && s.length >= 32 ? s : null
}

function cleResend(): string | null {
  return process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim() || null
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

/** Le code de l'erreur (PostgREST, Supabase, Resend) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; status?: unknown; name?: unknown }
  const codes = [e.code, e.status].filter((x): x is string | number => typeof x === 'string' || typeof x === 'number')
  if (codes.length) return codes.map(String).map(c => c.slice(0, 40)).join('/')
  return err instanceof Error ? err.name : 'erreur'
}

const journal = (ligne: string) => console.info(`${PREFIXE} ${ligne}`)

/** Appelle une fonction SQL réservée à service_role. Jette l'erreur de PostgREST. */
async function rpc(nom: string, args: Record<string, unknown>): Promise<unknown> {
  const c = clientAdmin()
  if (!c) throw Object.assign(new Error('config'), { code: 'config' })
  const { data, error } = await c.rpc(nom, args)
  if (error) throw error
  return data
}

export async function reconnaitreServeur(email: string | null, ip: string | null): Promise<{ reponse: Reconnaissance }> {
  if (coupe()) return { reponse: 'simple' }
  return reconnaitre({ email, ip, secret: clientAdmin() ? secretServeur() : null }, {
    rpc: (e, cleIp, cleEmail) => rpc('aok_connexion_reconnaitre', { p_email: e, p_cle_ip: cleIp, p_cle_email: cleEmail }),
    journal,
    codeErreur,
  })
}

export async function envoyerServeur(entree: Omit<EntreeEnvoi, 'secret' | 'resend'>): Promise<SortieEnvoi> {
  if (coupe()) return { envoi: 'indisponible' }
  const cle = cleResend()
  return envoyer({ ...entree, secret: clientAdmin() ? secretServeur() : null, resend: Boolean(cle) }, {
    rpc: (e, cleIp, cleEmail, creer) => rpc('aok_connexion_envoi', { p_email: e, p_cle_ip: cleIp, p_cle_email: cleEmail, p_creer: creer }),
    async genererLien(e, donnees) {
      const c = clientAdmin()
      if (!c) throw Object.assign(new Error('config'), { code: 'config' })
      // 'magiclink' : n'envoie rien. Adresse sans compte : Supabase crée le compte (jeton 'signup').
      const { data, error } = await c.auth.admin.generateLink({
        type: 'magiclink',
        email: e,
        ...(donnees ? { options: { data: donnees } } : {}),
      })
      if (error) throw error
      return data?.properties ?? null
    },
    async envoyerEmail(e, m: ModeleEmail) {
      const { error } = await new Resend(cle ?? '').emails.send({
        from: EXPEDITEUR, to: e, replyTo: SUPPORT, subject: m.sujet, html: m.html, text: m.texte,
      })
      if (error) throw Object.assign(new Error('resend'), { code: String(error.name ?? 'erreur').slice(0, 40) })
    },
    journal,
    codeErreur,
  })
}
