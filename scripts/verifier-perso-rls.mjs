/**
 * Prouve que l'espace perso de Brice (cockpit_perso_notes, 20/10/2026) n'est
 * lisible QUE par Brice et Tab : ni Melanie ni Adil (pourtant dans
 * cockpit_allowlist avec acces_fonds), ni un compte authentifie quelconque,
 * ni anon.
 *
 * Meme methode que verifier-fonds-rls.mjs : dans une transaction, on pose une
 * note de test (en postgres), puis on rejoue PostgREST (role authenticated et
 * JWT dont le sub est l'identite simulee, ou role anon). Aucune session n'est
 * ouverte sur un vrai compte. La transaction est ANNULEE : rien ne reste.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/verifier-perso-rls.mjs
 *
 * Sort en code 1 au premier ecart.
 *
 * Depuis le 23/10/2026, meme preuve pour cockpit_perso_documents (les
 * documents de Belrive lus par le connecteur MCP de ChatGPT), des que la
 * migration 20261023170000 est appliquee : un document de test, lu ou non
 * selon l'identite, jamais ecrit ni efface par le navigateur.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const [{ docs: AVEC_DOCUMENTS }] = await prisma.$queryRawUnsafe(
  `select to_regclass('public.cockpit_perso_documents') is not null as docs`)

const IDENTITES = [
  { qui: 'Brice', role: 'authenticated', sub: '0636a40b-13a4-4fe8-af11-d060e2810767', doitLire: true },
  { qui: 'Tab', role: 'authenticated', sub: '193ebc99-d64e-4a8e-9953-1719df529054', doitLire: true },
  { qui: 'Melanie', role: 'authenticated', sub: '9d7424e5-8de6-42b5-9c95-2b8d7702a880', doitLire: false },
  { qui: 'Adil', role: 'authenticated', sub: '19dcd404-5309-4d18-8814-4b52eb474062', doitLire: false },
  { qui: 'inconnu', role: 'authenticated', sub: '00000000-0000-4000-8000-000000000001', doitLire: false },
  { qui: 'anon', role: 'anon', sub: null, doitLire: false },
]

async function essai(id) {
  const r = {}
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `insert into public.cockpit_perso_notes (sens, auteur, sujet, texte) values ('vers_claude', 'tab', 'essai RLS', 'essai RLS, annule')`)
    if (AVEC_DOCUMENTS) {
      await tx.$executeRawUnsafe(
        `insert into public.cockpit_perso_documents (chemin, titre, contenu, empreinte, source)
         values ('essai-rls.md', 'essai RLS', 'essai RLS, annule', repeat('0', 64), 'disque')`)
    }
    const claims = id.sub ? { sub: id.sub, role: id.role } : { role: id.role }
    await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '${JSON.stringify(claims)}', true)`)
    await tx.$executeRawUnsafe(`set local role ${id.role}`)
    if (AVEC_DOCUMENTS) {
      // AVANT les essais des notes (un refus non rattrape y annule la transaction) :
      // chaque essai dans son point de reprise.
      const essaiDoc = async (sql) => {
        await tx.$executeRawUnsafe('savepoint doc')
        try { const l = await tx.$queryRawUnsafe(sql); await tx.$executeRawUnsafe('release savepoint doc'); return l[0]?.n ?? 0 }
        catch { await tx.$executeRawUnsafe('rollback to savepoint doc'); return 'refus' }
      }
      r.docs = await essaiDoc(`select count(*)::int as n from public.cockpit_perso_documents where chemin = 'essai-rls.md'`)
      r.majDoc = await essaiDoc(`with u as (update public.cockpit_perso_documents set titre = 'x' returning 1) select count(*)::int as n from u`)
      r.supprDoc = await essaiDoc(`with d as (delete from public.cockpit_perso_documents returning 1) select count(*)::int as n from d`)
    }
    try {
      const l = await tx.$queryRawUnsafe(`select count(*)::int as n from public.cockpit_perso_notes`)
      r.lignes = l[0].n
    } catch (e) { r.refus = String(e.message).split('\n').filter(Boolean).pop().slice(0, 90) }
    try {
      const f = await tx.$queryRawUnsafe(`select public.is_cockpit_perso() as ok`)
      r.perso = f[0].ok
    } catch (e) { r.perso = 'refus' }
    try {
      const u = await tx.$executeRawUnsafe(`update public.cockpit_perso_notes set statut = 'lue' where sujet = 'essai RLS'`)
      r.maj = u
    } catch (e) { r.maj = 'refus' }
    try {
      await tx.$executeRawUnsafe(`update public.cockpit_perso_notes set texte = 'x' where sujet = 'essai RLS'`)
      r.majTexte = 'PASSE'
    } catch (e) { r.majTexte = 'refus' }
    throw new Error('__rollback__')
  }).catch((e) => { if (!String(e.message).includes('__rollback__')) throw e })
  return r
}

let ecarts = 0
for (const id of IDENTITES) {
  const r = await essai(id)
  const lit = (r.lignes ?? 0) > 0
  const okNotes = lit === id.doitLire && (id.doitLire ? r.maj === 1 : r.maj !== 1) && r.majTexte !== 'PASSE'
  // Documents (23/10) : lus par Brice et Tab seulement, jamais modifies ni effaces par le navigateur.
  const okDocs = !AVEC_DOCUMENTS || ((r.docs === 1) === id.doitLire && r.majDoc === 'refus' && r.supprDoc === 'refus')
  const ok = okNotes && okDocs
  if (!ok) ecarts += 1
  const docs = AVEC_DOCUMENTS ? ` documents=${r.docs} maj=${r.majDoc} suppr=${r.supprDoc}` : ''
  console.log(`${ok ? 'ok' : 'X '} ${id.qui.padEnd(8)} lignes=${r.lignes ?? '-'} ${r.refus ? `(refus : ${r.refus}) ` : ''}is_cockpit_perso=${r.perso} statut=${r.maj} texte=${r.majTexte}${docs}`)
}
await prisma.$disconnect()
if (!AVEC_DOCUMENTS) console.log('\n(cockpit_perso_documents absente : migration 20261023170000 a appliquer, documents non verifies)')
console.log(ecarts ? `\n${ecarts} ECART(S)` : '\nEspace perso : Brice et Tab seuls.')
process.exit(ecarts ? 1 : 0)
