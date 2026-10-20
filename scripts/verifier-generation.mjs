/**
 * Le generateur de posts du cockpit (migration 20261019030000_cockpit_generation.sql) :
 * - cockpit_inspirations et cockpit_generations se lisent par l'equipe du
 *   cockpit et par personne d'autre, l'anonyme est refuse ;
 * - le navigateur ne peut que noter un brouillon (note, brouillon_final),
 *   jamais en inserer un ni en reecrire le texte ;
 * - le bucket prive cockpit-inspirations ne se lit que par l'equipe ;
 * - la route /api/cockpit/generation refuse sans jeton et avec un faux jeton ;
 * - avec --pousser : npm run pousser:inspirations relance a vide (idempotent).
 *
 * Meme methode que verifier-academie-cockpit-rls.mjs : transactions ANNULEES,
 * role `authenticated` (ou `anon`) avec un `sub` choisi. Rien n'est ecrit.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-generation.mjs [--pousser]
 *
 * Sort en code 1 au premier ecart. N'affiche que des comptes.
 */

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

const INCONNU = '00000000-0000-4000-8000-000000000001'
const ROUTE = 'https://journal-d-etude-beta.vercel.app/api/cockpit/generation'
const prisma = new PrismaClient()

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
        resultat = { lu: false, motif: String(e.message).split('\n').find((l) => l.includes('permission') || l.includes('policy') || l.includes('reserve')) ?? 'refus' }
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

  for (const t of ['cockpit_inspirations', 'cockpit_generations']) {
    const vrai = Number((await prisma.$queryRawUnsafe(`select count(*)::int as n from public.${t}`))[0].n)
    const m = await jouerComme('authenticated', membre, `select count(*)::int as n from public.${t}`)
    attendre(`${t} : equipe lit tout`, m.lu && m.lignes === vrai, m.lu ? `${m.lignes}/${vrai}` : m.motif)
    const i = await jouerComme('authenticated', INCONNU, `select count(*)::int as n from public.${t}`)
    attendre(`${t} : compte hors allowlist ne voit rien`, i.lu && i.lignes === 0, i.lu ? `${i.lignes}` : i.motif)
    const a = await jouerComme('anon', null, `select count(*)::int as n from public.${t}`)
    attendre(`${t} : anonyme refuse`, !a.lu, a.motif)
  }

  const insp = await jouerComme('authenticated', membre, "update public.cockpit_inspirations set texte = texte where false returning 1")
  attendre('cockpit_inspirations : aucune ecriture navigateur', !insp.lu, insp.motif)

  const nbGen = Number((await prisma.$queryRawUnsafe('select count(*)::int as n from public.cockpit_generations'))[0].n)
  const cible = 'where id = (select id from public.cockpit_generations order by cree_le desc limit 1)'
  const note = await jouerComme('authenticated', membre, `update public.cockpit_generations set note = 'jete' ${cible} returning 1`)
  attendre('cockpit_generations : l equipe note', note.lu && note.lignes === Math.min(1, nbGen), note.lu ? `${note.lignes}` : note.motif)
  const noteInconnu = await jouerComme('authenticated', INCONNU, `update public.cockpit_generations set note = 'jete' ${cible} returning 1`)
  attendre('cockpit_generations : hors allowlist ne note rien', noteInconnu.lu && noteInconnu.lignes === 0, noteInconnu.lu ? `${noteInconnu.lignes}` : noteInconnu.motif)
  const texte = await jouerComme('authenticated', membre, `update public.cockpit_generations set brouillon = 'x' ${cible} returning 1`)
  attendre('cockpit_generations : le texte genere ne se reecrit pas', !texte.lu, texte.motif)
  const insertion = await jouerComme('authenticated', membre,
    `insert into public.cockpit_generations (cree_par, personne, canal, objectif, sens, brouillon, modele)
     values ('${membre}', 'brice', 'x', 'enseigner', 'idee', 'x', 'x') returning 1`)
  attendre('cockpit_generations : aucune insertion navigateur', !insertion.lu, insertion.motif)

  const images = Number((await prisma.$queryRawUnsafe("select count(*)::int as n from storage.objects where bucket_id = 'cockpit-inspirations'"))[0].n)
  const bm = await jouerComme('authenticated', membre, "select count(*)::int as n from storage.objects where bucket_id = 'cockpit-inspirations'")
  attendre('bucket cockpit-inspirations : equipe lit', bm.lu && bm.lignes === images && images > 0, bm.lu ? `${bm.lignes}/${images}` : bm.motif)
  const bi = await jouerComme('authenticated', INCONNU, "select count(*)::int as n from storage.objects where bucket_id = 'cockpit-inspirations'")
  attendre('bucket cockpit-inspirations : hors allowlist ne voit rien', bi.lu && bi.lignes === 0, bi.lu ? `${bi.lignes}` : bi.motif)
  const pub = (await prisma.$queryRawUnsafe("select public from storage.buckets where id = 'cockpit-inspirations'"))[0]?.public
  attendre('bucket cockpit-inspirations : prive', pub === false)

  // 20/10/2026 : le rapprochement brouillon -> post publie et la vue des reperes.
  const rm = await jouerComme('authenticated', membre, 'select public.cockpit_generations_rapprocher() as n')
  attendre('rapprochement : l equipe le lance', rm.lu, rm.lu ? `${rm.lignes} lie(s)` : rm.motif)
  const ri = await jouerComme('authenticated', INCONNU, 'select public.cockpit_generations_rapprocher() as n')
  attendre('rapprochement : hors allowlist refuse', !ri.lu, ri.motif)
  const ra = await jouerComme('anon', null, 'select public.cockpit_generations_rapprocher() as n')
  attendre('rapprochement : anonyme refuse', !ra.lu, ra.motif)
  const vm = await jouerComme('authenticated', membre, 'select count(*)::int as n from public.cockpit_generations_reperes')
  attendre('reperes : l equipe lit', vm.lu && vm.lignes > 0, vm.lu ? `${vm.lignes}` : vm.motif)
  const vi = await jouerComme('authenticated', INCONNU, 'select count(*)::int as n from public.cockpit_generations_reperes')
  attendre('reperes : hors allowlist ne voit rien', vi.lu && vi.lignes === 0, vi.lu ? `${vi.lignes}` : vi.motif)

  for (const [nom, auth] of [['sans jeton', null], ['faux jeton', 'Bearer faux.jeton.x']]) {
    try {
      const r = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ personne: 'brice', canal: 'x', objectif: 'enseigner', sens: 'idee', idee: 'x' }),
      })
      attendre(`route : ${nom} refuse`, r.status === 401, `HTTP ${r.status}`)
    } catch (e) {
      attendre(`route : ${nom} refuse`, false, String(e.message))
    }
  }

  if (process.argv.includes('--pousser')) {
    const sortie = execFileSync('node', ['scripts/pousser-inspirations.mjs'], { cwd: resolve('../cockpit'), encoding: 'utf8' })
    const ligne = sortie.split('\n').find((l) => l.startsWith('Inspirations :')) ?? ''
    const images2 = sortie.split('\n').find((l) => l.startsWith('Images :')) ?? ''
    attendre('pousser:inspirations idempotent', / 0 nouvelles, 0 changées/.test(ligne) && / 0 envoyées/.test(images2), `${ligne} ${images2}`)
  }

  console.log(ecarts ? `\n${ecarts} ecart(s).` : '\nTout passe (transactions annulees).')
  process.exitCode = ecarts ? 1 : 0
}

main().finally(() => prisma.$disconnect())
