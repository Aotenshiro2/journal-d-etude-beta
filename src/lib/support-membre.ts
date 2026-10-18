// La page Support du site (/mon-espace/support, Brice 18/10/2026, lot 1) :
// une demande du membre, rangee dans l'onglet Support du cockpit et annoncee
// a l'equipe par Agent AOK.
//
// - Le compte est TOUJOURS celui du jeton Bearer (route /api/compte/support).
// - La demande devient un fil SupportThread app 'site', « attend un humain »
//   (escalatedAt) : l'equipe la voit dans l'onglet Support sans rien changer
//   au cockpit, et sa reponse arrive au membre dans le chat Support du site
//   (SupportAOK, qui rouvre son dernier fil 'site'). Une ligne dans
//   aok_support_demandes garde la trace et sert a la limite de 5 par jour.
// - Les captures sont deposees par le navigateur dans le bucket PRIVE
//   support-captures (<uuid du compte>/<uuid>.webp, policy du dossier du
//   compte) ; le serveur verifie qu'elles existent dans ce dossier, puis les
//   range chacune dans un message du fil (piece de type photo, file_id
//   « stockage:<chemin> »). La vignette du cockpit les relit par
//   /api/cockpit/support/piece (cle de service, apres l'allowlist).
// - Migration : 20261018234500_mon_espace_lot1.sql.
//
// Jamais un email, un jeton, une cle ni le texte du membre dans un log.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { alerterEquipeTelegram } from '@/lib/alerte-equipe-telegram'
import { messageErreur } from '@/lib/liveclub/pur'
import {
  BUCKET_CAPTURES, LIBELLE_ESPACE, MAX_DEMANDES_JOUR, PREFIXE_STOCKAGE, texteDuFil, type DemandeSupport,
} from '@/lib/support-membre-pur'

export type IssueSupport =
  | { ok: true; prevenue: boolean }
  | { ok: false; erreur: 'limite' | 'captures' | 'paiement' | 'indisponible' }

type Paiement = { paiement_id?: unknown; produit?: unknown; date?: unknown }

/** Le libelle d'un paiement du compte (« Live Club, 12/10/2026 »), ou null s'il n'est pas a lui. */
async function libellePaiement(userId: string, paiementId: string): Promise<string | null> {
  const l = await prisma.$queryRawUnsafe<{ c: string | null }[]>('select public.aok_compte_de($1::uuid)::text as c', userId)
  const o = JSON.parse(l[0]?.c ?? '{}') as { achats?: Paiement[]; live_club_paiements?: Paiement[] }
  const p = [...(o.achats ?? []), ...(o.live_club_paiements ?? [])].find((x) => x.paiement_id === paiementId)
  if (!p) return null
  const date = typeof p.date === 'string' ? p.date.slice(0, 10).split('-').reverse().join('/') : ''
  return [typeof p.produit === 'string' ? p.produit : 'Achat', date].filter(Boolean).join(', ')
}

export async function enregistrerDemandeSupport(compte: { id: string; email: string | null }, d: DemandeSupport): Promise<IssueSupport> {
  let filId: string
  try {
    const n = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int as n from public.aok_support_demandes where user_id = $1::uuid and cree_le > now() - interval '1 day'`, compte.id)
    if ((n[0]?.n ?? 0) >= MAX_DEMANDES_JOUR) return { ok: false, erreur: 'limite' }

    if (d.captures.length) {
      const l = await prisma.$queryRawUnsafe<{ name: string }[]>(
        `select name
           from storage.objects where bucket_id = $1 and name = any($2::text[])`, BUCKET_CAPTURES, d.captures)
      if (l.length !== d.captures.length) return { ok: false, erreur: 'captures' }
    }

    const achat = d.paiementId ? await libellePaiement(compte.id, d.paiementId) : null
    if (d.paiementId && !achat) return { ok: false, erreur: 'paiement' }

    const maintenant = new Date().toISOString()
    const messages = [
      { role: 'user', content: texteDuFil(d, achat), at: maintenant },
      ...d.captures.map((chemin, i) => ({
        role: 'user',
        content: `(capture ${i + 1} sur ${d.captures.length})`,
        at: maintenant,
        piece: { file_id: `${PREFIXE_STOCKAGE}${chemin}`, type: 'photo', mime: chemin.endsWith('.jpg') ? 'image/jpeg' : 'image/webp' },
      })),
    ]
    const fil = await prisma.supportThread.create({
      data: { userId: compte.id, app: 'site', escalatedAt: new Date(), messages },
    })
    filId = fil.id
    await prisma.$executeRawUnsafe(
      `insert into public.aok_support_demandes (user_id, espace, paiement_id, message, captures, fil_id)
       values ($1::uuid, $2, $3, $4, $5::text[], $6)`,
      compte.id, d.espace, d.paiementId, d.message, d.captures, filId)
  } catch (err) {
    console.warn(`[compte/support] enregistrement impossible : ${messageErreur(err).slice(0, 160)}`)
    return { ok: false, erreur: 'indisponible' }
  }

  const livres = await alerterEquipeTelegram({
    origine: `page Support du site, ${LIBELLE_ESPACE[d.espace]}${d.captures.length ? `, ${d.captures.length} capture${d.captures.length > 1 ? 's' : ''} dans l'onglet Support` : ''}`,
    qui: compte.email,
    dernierMessage: d.message,
    reponseDans: 'son chat',
    fil: filId,
  })
  if (livres > 0) {
    await prisma.$executeRawUnsafe('update public.aok_support_demandes set prevenue = true where fil_id = $1', filId).catch(() => 0)
  }
  return { ok: true, prevenue: livres > 0 }
}

// ---------------------------------------------------------------- lecture d'une capture (cockpit)

let client: SupabaseClient | null = null

function clientStockage(): SupabaseClient | null {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/** Les octets d'une capture du bucket prive (512 Ko au plus, borne du bucket). Appel reserve a la route du cockpit, apres l'allowlist. */
export async function lireCapture(chemin: string): Promise<{ ok: true; octets: Uint8Array; mime: string } | { ok: false }> {
  const s = clientStockage()
  if (!s) return { ok: false }
  try {
    const { data, error } = await s.storage.from(BUCKET_CAPTURES).download(chemin)
    if (error || !data) return { ok: false }
    const octets = new Uint8Array(await data.arrayBuffer())
    const webp = octets.length > 12 && String.fromCharCode(...octets.slice(8, 12)) === 'WEBP'
    const jpeg = octets.length > 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff
    if (!webp && !jpeg) return { ok: false }
    return { ok: true, octets, mime: webp ? 'image/webp' : 'image/jpeg' }
  } catch {
    return { ok: false }
  }
}
