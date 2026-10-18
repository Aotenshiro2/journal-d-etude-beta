/**
 * Prouve que les tables academie_* se lisent par l'equipe du cockpit et par
 * personne d'autre (migration 20261018220000_cockpit_academie.sql), que les
 * identifiants Bunny et le contenu des lecons restent fermes, qu'aucune
 * ecriture navigateur n'est possible, et que cockpit_academie_comptes() ne
 * rend rien hors allowlist.
 *
 * Meme methode que verifier-litiges-rls.mjs : dans une transaction ANNULEE, on
 * prend le role `authenticated` (ou `anon`) avec un `sub` choisi. Rien n'est ecrit.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-academie-cockpit-rls.mjs
 *
 * Sort en code 1 au premier ecart. N'affiche que des comptes de lignes.
 */

import { PrismaClient } from '@prisma/client'

const INCONNU = '00000000-0000-4000-8000-000000000001'
const prisma = new PrismaClient()

const TABLES = [
  'academie_modules', 'academie_sections', 'academie_offres', 'academie_offre_contenus',
  'academie_acces', 'academie_progression', 'academie_lectures',
]

async function jouerComme(role, uuid, sql) {
  let resultat
  await prisma
    .$transaction(async (tx) => {
      const claims = JSON.stringify(uuid ? { sub: uuid, role } : { role })
      await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '${claims}', true)`)
      await tx.$executeRawUnsafe(`set local role ${role}`)
      try {
        const r = await tx.$queryRawUnsafe(sql)
        resultat = { lu: true, lignes: Number(r[0]?.n ?? r.length) }
      } catch (e) {
        resultat = { lu: false, motif: String(e.message).split('\n').find((l) => l.includes('permission') || l.includes('policy')) ?? 'refus' }
      }
      throw new Error('__rollback__')
    })
    .catch((e) => {
      if (!String(e.message).includes('__rollback__')) throw e
    })
  return resultat
}

let ecarts = 0
function attendre(nom, ok, detail) {
  console.log(`${ok ? 'ok ' : 'KO '} ${nom}${detail ? ` (${detail})` : ''}`)
  if (!ok) ecarts++
}

async function main() {
  const membre = (await prisma.$queryRawUnsafe('select user_id::text as id from public.cockpit_allowlist limit 1'))[0]?.id
  if (!membre) throw new Error('allowlist vide')

  for (const t of TABLES) {
    const vrai = Number((await prisma.$queryRawUnsafe(`select count(*)::int as n from public.${t}`))[0].n)
    const m = await jouerComme('authenticated', membre, `select count(*)::int as n from public.${t}`)
    attendre(`${t} : equipe lit tout`, m.lu && m.lignes === vrai, m.lu ? `${m.lignes}/${vrai}` : m.motif)
    const i = await jouerComme('authenticated', INCONNU, `select count(*)::int as n from public.${t}`)
    attendre(`${t} : compte inconnu ne voit rien`, i.lu && i.lignes === 0, i.lu ? `${i.lignes}` : i.motif)
    const a = await jouerComme('anon', null, `select count(*)::int as n from public.${t}`)
    attendre(`${t} : anonyme refuse`, !a.lu, a.motif)
  }

  const colonnes = await jouerComme('authenticated', membre,
    'select count(*)::int as n from (select id, titre, type, hebergeur, duree_s, statut from public.academie_lecons) x')
  attendre('academie_lecons : equipe lit les colonnes ouvertes', colonnes.lu, colonnes.lu ? `${colonnes.lignes}` : colonnes.motif)
  for (const c of ['bunny_video_id', 'wistia_id', 'contenu', 'ressources']) {
    const r = await jouerComme('authenticated', membre, `select count(${c})::int as n from public.academie_lecons`)
    attendre(`academie_lecons.${c} : ferme meme pour l equipe`, !r.lu, r.motif)
  }

  const ecriture = await jouerComme('authenticated', membre,
    `update public.academie_acces set note = note where false returning 1`)
  attendre('academie_acces : aucune ecriture navigateur (equipe)', !ecriture.lu, ecriture.motif)

  const fnMembre = await jouerComme('authenticated', membre, 'select count(*)::int as n from public.cockpit_academie_comptes()')
  attendre('cockpit_academie_comptes : equipe', fnMembre.lu && fnMembre.lignes > 0, fnMembre.lu ? `${fnMembre.lignes}` : fnMembre.motif)
  const fnInconnu = await jouerComme('authenticated', INCONNU, 'select count(*)::int as n from public.cockpit_academie_comptes()')
  attendre('cockpit_academie_comptes : inconnu ne voit rien', fnInconnu.lu && fnInconnu.lignes === 0, fnInconnu.lu ? `${fnInconnu.lignes}` : fnInconnu.motif)
  const fnAnon = await jouerComme('anon', null, 'select count(*)::int as n from public.cockpit_academie_comptes()')
  attendre('cockpit_academie_comptes : anonyme refuse', !fnAnon.lu, fnAnon.motif)

  console.log(ecarts ? `\n${ecarts} ecart(s).` : '\nTout passe (transactions annulees).')
  process.exitCode = ecarts ? 1 : 0
}

main().finally(() => prisma.$disconnect())
