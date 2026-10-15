// Pose (ou retire) des acces a l'academie a partir d'un CSV, en attendant l'ecran du cockpit (Brice,
// 15/10/2026 : d'accord sur le principe d'un ecran plus tard ; pour l'alpha, un script).
//
//   node --env-file=.env.local scripts/donner-acces-academie.mjs <acces.csv> [--ecrire] [--retirer]
//
// CSV, separateur « ; », une ligne par acces, en-tete facultatif, lignes vides et lignes en « # »
// ignorees :
//   email;offre;source;note
//   eleve@exemple.fr;formation-complete;offert;alpha du 17/10
// - email : celui du compte du site de l'eleve. L'acces se pose sur l'EMAIL (user_id vide) : droitsAcademie
//   (src/lib/academie/droits.ts, SQL_ACCES) le retrouve des que l'eleve a un compte avec cet email VERIFIE
//   (email confirme de auth.users, ou profile_emails verified), y compris s'il cree son compte apres ;
// - offre : slug d'academie_offres (formation-complete, live-club, ...) ;
// - source : stripe, paypal, migration_skool, liveclub ou offert (vide = offert) ;
// - note : texte libre, facultatif (1 000 caracteres au plus).
//
// Sans --ecrire, tout est joue dans une transaction puis ANNULE (essai a blanc) : le bilan dit ce qui
// serait fait. Avec --ecrire, la transaction est validee.
// Idempotent : jamais deux acces ACTIFS pour le meme email et la meme offre (un acces deja actif, pose sur
// l'email ou sur un compte qui a cet email verifie, est compte « deja la »).
// --retirer : retire (retire_le = now(), retire_par) les acces actifs de ces emails pour ces offres, POSES
// PAR CE SCRIPT seulement (pose_par = agent:alpha-2026-10) : un achat ou un acces pose autrement reste.
//
// Le bilan est chiffre : JAMAIS la liste des emails (une ligne en erreur est donnee par son numero).
//
// donnerAcces(tx, lignes, options) est exportee pour scripts/essayer-migration-ressources-academie.mjs
// (memes ordres, dans une transaction toujours annulee).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { lireCsvAcces } from '../src/lib/academie/pur.ts'

export const POSE_PAR_ALPHA = 'agent:alpha-2026-10'

// Un acces actif de cette offre pour cet email : pose sur l'email, ou sur un compte qui a cet email verifie.
const SQL_ACTIFS = `
select count(*)::int as n from public.academie_acces a
 where a.offre_id = $2::uuid and a.retire_le is null and (a.fin is null or a.fin > now())
   and (a.email = $1 or a.user_id in (
     select u.id from auth.users u
      where lower(btrim(u.email)) = $1 and u.email_confirmed_at is not null
     union
     select pe.profile_id from public.profile_emails pe
      where lower(btrim(pe.email)) = $1 and pe.verified = true))`

// Combien de ces emails ont deja un compte : verifie (l'acces s'ouvre a la connexion), non verifie
// (il faut confirmer l'email), aucun (l'eleve doit creer son compte avec cet email).
const SQL_COMPTES = `
select
  count(*) filter (where verifie)::int as comptes_verifies,
  count(*) filter (where not verifie and existe)::int as comptes_non_verifies,
  count(*) filter (where not existe)::int as sans_compte
from (
  select
    exists (select 1 from auth.users u where lower(btrim(u.email)) = e and u.email_confirmed_at is not null)
      or exists (select 1 from public.profile_emails pe where lower(btrim(pe.email)) = e and pe.verified = true) as verifie,
    exists (select 1 from auth.users u where lower(btrim(u.email)) = e)
      or exists (select 1 from public.profile_emails pe where lower(btrim(pe.email)) = e) as existe
  from unnest($1::text[]) as e
) x`

/**
 * Pose ou retire les acces des lignes (lireCsvAcces) dans la transaction tx. Rend un bilan chiffre.
 * options : { retirer = false, posePar = POSE_PAR_ALPHA }.
 */
export async function donnerAcces(tx, lignes, { retirer = false, posePar = POSE_PAR_ALPHA } = {}) {
  const bilan = retirer
    ? { mode: 'retrait', lignes: lignes.length, retirees: 0, absentes: 0, offres_inconnues: {} }
    : { mode: 'pose', lignes: lignes.length, posees: 0, deja_la: 0, offres_inconnues: {}, par_offre: {} }

  const slugs = [...new Set(lignes.map(l => l.offre))]
  const offres = new Map((await tx.$queryRawUnsafe(
    `select slug, id::text as id from public.academie_offres where slug = any($1::text[])`, slugs,
  )).map(o => [o.slug, o.id]))

  for (const l of lignes) {
    const offreId = offres.get(l.offre)
    if (!offreId) {
      bilan.offres_inconnues[l.offre] = (bilan.offres_inconnues[l.offre] ?? 0) + 1
      continue
    }
    if (retirer) {
      const n = await tx.$executeRawUnsafe(
        `update public.academie_acces set retire_le = now(), retire_par = $3
          where email = $1 and offre_id = $2::uuid and pose_par = $3 and retire_le is null`,
        l.email, offreId, posePar)
      if (n) bilan.retirees += n
      else bilan.absentes++
      continue
    }
    const [{ n }] = await tx.$queryRawUnsafe(SQL_ACTIFS, l.email, offreId)
    if (n > 0) { bilan.deja_la++; continue }
    await tx.$executeRawUnsafe(
      `insert into public.academie_acces (email, offre_id, source, note, pose_par)
       values ($1, $2::uuid, $3, $4, $5)`,
      l.email, offreId, l.source, l.note, posePar)
    bilan.posees++
    bilan.par_offre[l.offre] = (bilan.par_offre[l.offre] ?? 0) + 1
  }

  if (!retirer) {
    const emails = [...new Set(lignes.map(l => l.email))]
    bilan.comptes = (await tx.$queryRawUnsafe(SQL_COMPTES, emails))[0]
  }
  return bilan
}

// ---------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------

const estLanceDirectement = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (estLanceDirectement) {
  const args = process.argv.slice(2)
  const chemin = args.find(a => !a.startsWith('--'))
  const ecrire = args.includes('--ecrire')
  const retirer = args.includes('--retirer')
  if (!chemin) {
    console.error('Usage : node --env-file=.env.local scripts/donner-acces-academie.mjs <acces.csv> [--ecrire] [--retirer]')
    process.exit(2)
  }

  const { lignes, erreurs, doublons } = lireCsvAcces(readFileSync(chemin, 'utf8'))
  if (erreurs.length) {
    console.error(`${erreurs.length} ligne(s) illisible(s), rien n'est fait :`)
    for (const e of erreurs) console.error(`  ligne ${e.numero} : ${e.motif}`)
    process.exit(1)
  }
  if (!lignes.length) {
    console.error('Aucune ligne a traiter.')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  class Annulation extends Error {}
  let bilan = null
  try {
    await prisma.$transaction(async tx => {
      bilan = await donnerAcces(tx, lignes, { retirer })
      if (Object.keys(bilan.offres_inconnues).length) throw new Error(`offre(s) inconnue(s) : ${Object.keys(bilan.offres_inconnues).join(', ')}`)
      if (!ecrire) throw new Annulation()
    }, { timeout: 120_000, maxWait: 20_000 })
    console.log('ECRIT :', JSON.stringify({ ...bilan, doublons_fichier: doublons }))
  } catch (e) {
    if (e instanceof Annulation) console.log('ESSAI A BLANC (rien ecrit) :', JSON.stringify({ ...bilan, doublons_fichier: doublons }))
    else {
      // Le message d'une erreur SQL peut reprendre la ligne refusee : emails masques.
      const msg = String(e?.message ?? e).split('\n').slice(-3).join(' ').replace(/[^\s@;,()]+@[^\s@;,()]+/g, '[email]')
      console.error('ECHEC, rien ecrit :', msg)
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}
