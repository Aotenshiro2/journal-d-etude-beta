// Outils communs des scripts qui ecrivent dans la Storage Zone Bunny des PDF de
// l'academie (envoyer-ressources-academie.mjs, migrer-ressources-vers-bunny.mjs,
// 23/10/2026). Pas une route : jamais importe par l'app.
//
// API Storage de Bunny (https://docs.bunny.net/reference/storage-api) :
//   liste : GET https://<hote>/<zone>/<dossier>/   -> [{ ObjectName, Path, IsDirectory, Length, Checksum }]
//   envoi : PUT https://<hote>/<zone>/<chemin>     corps = le fichier, 201 si cree
// En-tete AccessKey = mot de passe de la Storage Zone. Checksum = SHA256 du
// contenu en hexadecimal (Bunny le rend en majuscules dans la liste ; envoye a
// l'envoi, Bunny refuse un contenu qui ne correspond pas).
//
// Coffre : D:\6_Societe\Pilotage\Data-Performance\credentials.local\bunny-storage.local.json
// (storage_zone, storage_hostname, storage_password, pull_zone_hostname,
// token_auth_key). Aucune valeur secrete n'est jamais affichee : les erreurs
// ne rendent que le code HTTP et le chemin.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const COFFRE_BUNNY_DEFAUT = '/mnt/d/6_Societe/Pilotage/Data-Performance/credentials.local/bunny-storage.local.json'

/** --coffre=<chemin> parmi les arguments, sinon le coffre par defaut. */
export function cheminCoffreBunny(args) {
  const a = args.find(x => x.startsWith('--coffre='))
  return a ? a.slice('--coffre='.length) : COFFRE_BUNNY_DEFAUT
}

/** Lit le coffre ; arrete le script (sans rien afficher du contenu) s'il manque une valeur. */
export function lireCoffreBunny(chemin) {
  let c
  try {
    c = JSON.parse(readFileSync(chemin, 'utf8'))
  } catch (err) {
    console.error(`Coffre Bunny illisible : ${chemin} (${err.code ?? err.name})`)
    process.exit(1)
  }
  const zone = String(c.storage_zone ?? '').trim()
  const hote = String(c.storage_hostname ?? 'storage.bunnycdn.com').trim().replace(/^https:\/\//, '').replace(/\/+$/, '')
  const motDePasse = String(c.storage_password ?? '').trim()
  const pullZone = String(c.pull_zone_hostname ?? '').trim()
  const cleJeton = String(c.token_auth_key ?? '').trim()
  if (!/^[a-z0-9-]+$/.test(zone) || !/^[a-z0-9.-]+$/.test(hote) || motDePasse.length < 8) {
    console.error('Coffre Bunny incomplet : storage_zone, storage_hostname ou storage_password absent ou mal forme.')
    process.exit(1)
  }
  return { zone, hote, motDePasse, pullZone, cleJeton }
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex').toUpperCase()

const segments = (chemin) => chemin.split('/').map(encodeURIComponent).join('/')

/**
 * Tous les fichiers sous <dossier> (recursif ; '' = toute la zone) :
 * Map(chemin sans « / » au debut -> { taille, checksum (majuscules ou '') }).
 * Un dossier absent rend une Map vide.
 */
export async function listerBunny(coffre, dossier = '') {
  const fichiers = new Map()
  const aVoir = [dossier.replace(/^\/+|\/+$/g, '')]
  while (aVoir.length) {
    const d = aVoir.shift()
    const res = await fetch(`https://${coffre.hote}/${coffre.zone}/${d ? `${segments(d)}/` : ''}`, {
      headers: { AccessKey: coffre.motDePasse, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    })
    if (res.status === 404) continue
    if (!res.ok) throw new Error(`liste Bunny ${d || '/'} : HTTP ${res.status}`)
    for (const o of await res.json()) {
      const chemin = d ? `${d}/${o.ObjectName}` : o.ObjectName
      if (o.IsDirectory) aVoir.push(chemin)
      else fichiers.set(chemin, { taille: Number(o.Length), checksum: String(o.Checksum ?? '').toUpperCase() })
    }
  }
  return fichiers
}

/** Envoie un contenu a <chemin> avec sa somme SHA256 (Bunny refuse si elle ne correspond pas). Rend le code HTTP. */
export async function envoyerBunny(coffre, chemin, contenu, somme) {
  const res = await fetch(`https://${coffre.hote}/${coffre.zone}/${segments(chemin)}`, {
    method: 'PUT',
    headers: { AccessKey: coffre.motDePasse, 'Content-Type': 'application/octet-stream', Checksum: somme },
    body: contenu,
    signal: AbortSignal.timeout(10 * 60000),
  })
  await res.arrayBuffer().catch(() => null)
  return res.status
}

/** Le meme fichier deja sur Bunny : meme taille et meme somme SHA256. */
export const identiqueSurBunny = (distant, taille, somme) =>
  !!distant && distant.taille === taille && !!distant.checksum && distant.checksum === somme

export const mo = (o) => `${(o / 1048576).toFixed(1)} Mo`
