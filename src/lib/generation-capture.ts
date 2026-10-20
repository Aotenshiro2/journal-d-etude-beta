// LA CAPTURE GARDEE D'UN BROUILLON DU GENERATEUR (20/10/2026).
//
// Demande de Brice : « j'ai recharge la page, je n'ai plus l'image que j'avais
// collee. Si j'avais un travail en cours, je ne pourrais pas le finir. » Le
// choix du 19/10 (l'image part au modele et n'est pas stockee) est renverse :
// la capture est gardee, REDUITE, dans le bucket PRIVE cockpit-inspirations
// sous generations/<id du brouillon>.webp (lecture : membres du cockpit par
// URL signee, policy du bucket ; ecriture : ce serveur, cle de service).
//
// Supabase est en plan Free (stockage a 747 Mo sur 1 Go le 20/10) :
// - une image vise moins de 200 Ko (webp, 1400 px puis 1100 px au plus) ;
// - une regeneration ou une retouche REUTILISE le chemin du parent : aucune
//   copie (cockpit_generations.image_chemin pointe le meme fichier) ;
// - l'image envoyee au modele reste celle recue (qualite de lecture du chart).
//
// Partage par genererPost : l'ecran, l'Agent AOK et l'API de Tab gardent leurs
// captures de la meme facon. Une panne du stockage ne bloque jamais le brouillon.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { TypeImage } from '@/lib/generation-pur'

export const BUCKET_CAPTURES_GENERATION = 'cockpit-inspirations'
const CIBLE_OCTETS = 200 * 1024
/** Sans sharp, l'original n'est garde que s'il reste raisonnable. */
const MAX_SANS_REDUCTION = 350 * 1024

let client: SupabaseClient | null = null

function stockage(): SupabaseClient | null {
  if (client) return client
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
  const cle = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()
  if (!url || !cle) return null
  client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

/** Reduit une image en webp sous ~200 Ko. Null si sharp est absent (l'appelant decide). */
async function reduire(octets: Buffer): Promise<Buffer | null> {
  let sharp: typeof import('sharp')
  try {
    sharp = (await import('sharp')).default
  } catch {
    return null
  }
  let dernier: Buffer | null = null
  for (const [cote, qualite] of [[1400, 76], [1100, 66], [900, 58]] as const) {
    dernier = await sharp(octets).rotate().resize({ width: cote, height: cote, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: qualite }).toBuffer()
    if (dernier.length <= CIBLE_OCTETS) return dernier
  }
  return dernier
}

/** Garde la capture d'un brouillon. Rend le chemin, ou null (rien n'est garde, le brouillon reste). */
export async function garderCapture(id: string, image: { media_type: TypeImage; data: string }): Promise<string | null> {
  const s = stockage()
  if (!s) {
    console.error('[generation] capture non gardee : SUPABASE_SERVICE_ROLE_KEY absente')
    return null
  }
  try {
    const brut = Buffer.from(image.data, 'base64')
    const reduite = await reduire(brut)
    let corps: Buffer
    let type: string
    let ext: string
    if (reduite) {
      corps = reduite; type = 'image/webp'; ext = 'webp'
    } else if (brut.length <= MAX_SANS_REDUCTION && image.media_type !== 'image/gif') {
      corps = brut; type = image.media_type; ext = image.media_type === 'image/png' ? 'png' : image.media_type === 'image/webp' ? 'webp' : 'jpg'
    } else {
      console.error(`[generation] capture non gardee : reduction impossible et ${brut.length} octets`)
      return null
    }
    const chemin = `generations/${id}.${ext}`
    const { error } = await s.storage.from(BUCKET_CAPTURES_GENERATION).upload(chemin, corps, { contentType: type, upsert: true })
    if (error) {
      console.error('[generation] capture non gardee', error.message)
      return null
    }
    return chemin
  } catch (err) {
    console.error('[generation] capture non gardee', err)
    return null
  }
}

/** Relit une capture gardee, pour la renvoyer au modele (regenerer, retoucher, rouvrir). */
export async function lireCapture(chemin: string): Promise<{ media_type: TypeImage; data: string } | null> {
  const s = stockage()
  if (!s) return null
  try {
    const { data, error } = await s.storage.from(BUCKET_CAPTURES_GENERATION).download(chemin)
    if (error || !data) return null
    const octets = Buffer.from(await data.arrayBuffer())
    const media_type: TypeImage = /\.webp$/i.test(chemin) ? 'image/webp' : /\.png$/i.test(chemin) ? 'image/png' : 'image/jpeg'
    return { media_type, data: octets.toString('base64') }
  } catch (err) {
    console.error('[generation] capture illisible', err)
    return null
  }
}
