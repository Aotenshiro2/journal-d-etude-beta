// LES IMAGES DE BELRIVE (25/10/2026) : le TELECHARGEMENT sur, cote serveur.
//
// Le serveur va chercher lui-meme l'image que ChatGPT designe (download_url
// d'un fichier de la conversation, ou url https). Anti-SSRF :
// - https seulement, port 443, sans identifiants, hote public (verifierUrl) ;
// - l'adresse IP est verifiee AU MOMENT DE LA CONNEXION (option lookup de
//   node:https) : c'est l'adresse reellement jointe qui compte, pas une
//   resolution faite avant (pas de rebinding DNS). Une seule adresse interdite
//   parmi celles du nom suffit a refuser ;
// - redirections suivies a la main, 3 au plus, chacune reverifiee (https, hote,
//   adresse) ;
// - 15 secondes au total, 8 Mo au plus (compte pendant la lecture, la
//   longueur annoncee n'est qu'un premier filtre), pas de connexion reutilisee.
//
// N'importe que des modules node: et images-pur.ts : scripts/verifier-images-belrive.mjs
// le teste avec un resolveur factice, sans reseau.

import { lookup as lookupDns, type LookupAddress } from 'node:dns'
import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { adresseInterdite, DELAI_TELECHARGEMENT_MS, IMAGE_MAX_OCTETS, REDIRECTIONS_MAX, verifierUrl } from './images-pur'

export type Telecharge = { ok: true; octets: Buffer; typeAnnonce: string | null } | { ok: false; raison: string }

type Resolveur = (hote: string, cb: (err: NodeJS.ErrnoException | null, adresses: LookupAddress[]) => void) => void

const resolveurDns: Resolveur = (hote, cb) => lookupDns(hote, { all: true, verbatim: true }, cb)

export class AdresseRefusee extends Error {
  code = 'EADRESSEREFUSEE'
}

/**
 * La fonction lookup passee a node:https : resout le nom, refuse si UNE des
 * adresses est interdite, sinon rend ce que Node demande (une adresse, ou
 * toutes quand options.all).
 */
export function creerLookupSur(resoudre: Resolveur = resolveurDns) {
  return function lookupSur(
    hote: string,
    options: { all?: boolean; family?: number } | number | undefined,
    cb: (err: NodeJS.ErrnoException | null, adresse: string | LookupAddress[], famille?: number) => void,
  ): void {
    const opts = typeof options === 'object' && options ? options : {}
    resoudre(hote, (err, adresses) => {
      if (err) return cb(err, '', 0)
      const liste = (adresses ?? []).filter((a) => !opts.family || a.family === opts.family)
      if (!liste.length) return cb(Object.assign(new Error(`aucune adresse pour ${hote}`), { code: 'ENOTFOUND' }), '', 0)
      if (liste.some((a) => adresseInterdite(a.address))) return cb(new AdresseRefusee('adresse privée ou locale refusée'), '', 0)
      if (opts.all) return cb(null, liste)
      return cb(null, liste[0].address, liste[0].family)
    })
  }
}

type Options = { lookup?: ReturnType<typeof creerLookupSur>; delaiMs?: number; maxOctets?: number; redirectionsMax?: number }

function uneRequete(u: URL, lookup: ReturnType<typeof creerLookupSur>, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(u, {
      method: 'GET',
      lookup: lookup as never,
      agent: false,
      signal,
      headers: { 'User-Agent': 'belrive-aok/1.0', Accept: 'image/png, image/jpeg, image/webp, image/gif, */*;q=0.1' },
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

function lireCorps(res: IncomingMessage, max: number): Promise<Buffer | 'trop'> {
  return new Promise((resolve, reject) => {
    const morceaux: Buffer[] = []
    let total = 0
    let fini = false
    res.on('data', (m: Buffer) => {
      total += m.length
      if (total > max) {
        fini = true
        res.destroy()
        resolve('trop')
        return
      }
      morceaux.push(m)
    })
    res.on('end', () => { fini = true; resolve(Buffer.concat(morceaux)) })
    res.on('error', (e) => { fini = true; reject(e) })
    // Coupure (delai depasse, connexion fermee) sans 'end' : jamais d'attente sans fin.
    res.on('close', () => { if (!fini) reject(Object.assign(new Error('coupé'), { code: 'ABORT_ERR' })) })
  })
}

function raisonReseau(err: unknown): string {
  if (err instanceof AdresseRefusee || (err as { cause?: unknown })?.cause instanceof AdresseRefusee) return 'adresse privée ou locale refusée.'
  const code = (err as { code?: string })?.code ?? ''
  if (code === 'ABORT_ERR' || (err as Error)?.name === 'AbortError') return 'téléchargement trop long (15 secondes au plus).'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'hôte introuvable.'
  if (code === 'EADRESSEREFUSEE') return 'adresse privée ou locale refusée.'
  if (/CERT|SSL|TLS/i.test(code)) return 'certificat https invalide.'
  return 'téléchargement impossible.'
}

/** Telecharge une image par https, avec toutes les gardes. Jamais d'exception : ok ou raison. */
export async function telechargerImage(brute: string, o: Options = {}): Promise<Telecharge> {
  const lookup = o.lookup ?? creerLookupSur()
  const max = o.maxOctets ?? IMAGE_MAX_OCTETS
  const controle = new AbortController()
  const minuterie = setTimeout(() => controle.abort(), o.delaiMs ?? DELAI_TELECHARGEMENT_MS)
  try {
    let adresse = brute
    for (let saut = 0; saut <= (o.redirectionsMax ?? REDIRECTIONS_MAX); saut += 1) {
      const v = verifierUrl(adresse)
      if (!v.ok) return { ok: false, raison: saut ? `redirection refusée : ${v.raison}` : v.raison }
      let res: IncomingMessage
      try {
        res = await uneRequete(v.url, lookup, controle.signal)
      } catch (err) {
        return { ok: false, raison: raisonReseau(err) }
      }
      const statut = res.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(statut)) {
        res.resume()
        const loc = res.headers.location
        if (!loc) return { ok: false, raison: `redirection ${statut} sans adresse.` }
        adresse = new URL(loc, v.url).toString()
        continue
      }
      if (statut !== 200) {
        res.resume()
        return { ok: false, raison: statut === 403 || statut === 404 || statut === 410 ? `fichier introuvable ou lien expiré (HTTP ${statut}).` : `le serveur de l'image a répondu HTTP ${statut}.` }
      }
      const annonce = Number(res.headers['content-length'])
      if (Number.isFinite(annonce) && annonce > max) {
        res.destroy()
        return { ok: false, raison: `image trop lourde : 8 Mo au plus (annoncé ${annonce} octets).` }
      }
      let corps: Buffer | 'trop'
      try {
        corps = await lireCorps(res, max)
      } catch (err) {
        return { ok: false, raison: raisonReseau(err) }
      }
      if (corps === 'trop') return { ok: false, raison: 'image trop lourde : 8 Mo au plus.' }
      const type = res.headers['content-type']
      return { ok: true, octets: corps, typeAnnonce: typeof type === 'string' ? type.slice(0, 100) : null }
    }
    return { ok: false, raison: `trop de redirections (${o.redirectionsMax ?? REDIRECTIONS_MAX} au plus).` }
  } finally {
    clearTimeout(minuterie)
  }
}
