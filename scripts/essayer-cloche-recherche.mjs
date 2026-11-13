/**
 * ESSAI de la CLOCHE et de la RECHERCHE DANS LES LECONS (13/11/2026) contre la vraie base.
 * AUCUNE MIGRATION : on joue les requetes EXACTES de src/lib/academie/cloche.ts et
 * src/lib/academie/recherche.ts.
 *
 * 1. La cloche, dans UNE transaction TOUJOURS ANNULEE (lock_timeout 5 s, rien ne reste) :
 *    deux comptes reels (lus en base, jamais affiches) ; aok_chat_diffuser remplacee DANS LA
 *    TRANSACTION par une fonction vide (le direct ne part pas) ; A ecrit dans le salon, B lui
 *    repond, une reponse de B masquee, A se repond a lui-meme, B se repond a lui-meme ; A pose deux
 *    questions sous une lecon publiee, l'une repondue (publiee), l'autre en attente ; un billet de
 *    test sur une lecon publiee.
 *    - SQL_REPONSES_SALON pour A : la seule reponse visible de B, lue par aok_chat_vue (vueMessage) ;
 *      pour B : rien (on ne se notifie pas soi-meme) ;
 *    - SQL_REPONSES_LECONS pour A : la question repondue seulement ;
 *    - SQL_ANNONCES_CLOCHE : le billet de test non vu, puis vu apres SQL_ANNONCES_TOUTES_VUES ;
 *    - assembler() : le compteur.
 *    Puis on verifie hors transaction que rien n'est reste.
 * 2. La recherche, en lecture seule : les textes de SQL_TEXTES_LECONS indexes, le catalogue lu par
 *    les requetes du catalogue, et chercher() sur quelques recherches, pour un compte « tout ferme »
 *    (aucun extrait ne doit sortir) et un compte « tout ouvert ». Seuls des NOMBRES et des durees
 *    s'affichent : le texte des lecons est payant.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node --env-file=.env.local scripts/essayer-cloche-recherche.mjs
 */

import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import * as C from '../src/lib/academie/cloche.ts'
import * as R from '../src/lib/academie/recherche.ts'
import { lireStatut, niveauDuStatut, nomAffiche, vueMessage } from '../src/lib/academie/chat-academie.ts'
import { SQL_LECONS_VISIBLES, SQL_MODULES_VISIBLES, SQL_SECTIONS_VISIBLES } from '../src/lib/academie/requetes.ts'

const prisma = new PrismaClient()
let etapes = 0
const ok = m => { etapes++; console.log(`ok  ${m}`) }
const ANNULE = '__essai_annule__'
const crees = { messages: [], questions: [], billets: [] }

// ---------------------------------------------------------------------------
// 1. La cloche
// ---------------------------------------------------------------------------

const debut = Date.now()
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '30s'`)

    // Le direct ne part pas : la fonction de diffusion est vide le temps de la transaction.
    await tx.$executeRawUnsafe(`create or replace function public.aok_chat_diffuser(p_evenement text, p_programme jsonb, p_gratuit jsonb)
      returns void language plpgsql volatile security definer set search_path = '' as $fn$ begin return; end $fn$`)
    ok('aok_chat_diffuser remplacee dans la transaction (rien ne part en direct)')

    const comptes = await tx.$queryRawUnsafe(`select p.id::text as id from public.profiles p
      where p.client_number is not null and coalesce(p.role::text, '') not in ('admin', 'equipe') order by p.client_number limit 2`)
    assert.equal(comptes.length, 2, 'deux comptes')
    const [A, B] = comptes.map(c => c.id)
    ok('deux comptes reels choisis (jamais affiches)')

    const ins = async (sql, ...p) => (await tx.$queryRawUnsafe(sql, ...p))[0].id
    const msgA = await ins(`insert into public.aok_chat_messages (user_id, texte, statut_auteur) values ($1::uuid, 'Essai cloche : ma question', 'communaute') returning id::text as id`, A)
    const repB = await ins(`insert into public.aok_chat_messages (user_id, texte, statut_auteur, est_reponse, reponse_a) values ($1::uuid, 'Essai cloche : la reponse de B', 'communaute', true, $2::uuid) returning id::text as id`, B, msgA)
    const masquee = await ins(`insert into public.aok_chat_messages (user_id, texte, statut_auteur, est_reponse, reponse_a, masque_le, masque_par) values ($1::uuid, 'Essai cloche : masquee', 'communaute', true, $2::uuid, now(), $1::uuid) returning id::text as id`, B, msgA)
    const soiA = await ins(`insert into public.aok_chat_messages (user_id, texte, statut_auteur, est_reponse, reponse_a) values ($1::uuid, 'Essai cloche : A se repond', 'communaute', true, $2::uuid) returning id::text as id`, A, msgA)
    const msgB = await ins(`insert into public.aok_chat_messages (user_id, texte, statut_auteur) values ($1::uuid, 'Essai cloche : message de B', 'communaute') returning id::text as id`, B)
    const soiB = await ins(`insert into public.aok_chat_messages (user_id, texte, statut_auteur, est_reponse, reponse_a) values ($1::uuid, 'Essai cloche : B se repond', 'communaute', true, $2::uuid) returning id::text as id`, B, msgB)
    crees.messages.push(msgA, repB, masquee, soiA, msgB, soiB)
    ok('salon : 6 messages de test (une reponse visible a A, une masquee, deux a soi-meme)')

    const acces = await tx.$queryRawUnsafe(C.SQL_ACCES_ANNUAIRE, A)
    const niveau = niveauDuStatut(lireStatut(acces[0]?.acces))
    const salonA = await tx.$queryRawUnsafe(C.SQL_REPONSES_SALON, A, niveau, C.JOURS_CLOCHE, C.MAX_PAR_SOURCE)
    const mienne = salonA.filter(x => crees.messages.includes(x.id))
    assert.deepEqual(mienne.map(x => x.id), [repB], 'seule la reponse visible de B')
    const v = vueMessage(mienne[0].vue)
    assert.ok(v && v.texte === 'Essai cloche : la reponse de B')
    const n = C.notifSalon({ id: v.id, cree_le: v.cree_le, texte: v.texte, qui: nomAffiche(v.auteur) }, { lu_le: null, lues: [] })
    assert.equal(n.lien, `/academie/chat#m-${repB}`)
    assert.ok(!/@/.test(n.qui), 'jamais un email')
    ok(`SQL_REPONSES_SALON pour A (niveau ${niveau}) : la reponse de B seulement, nom affiche « ${n.qui.startsWith('Membre') ? 'Membre <numero>' : 'nom du profil'} »`)
    const salonB = await tx.$queryRawUnsafe(C.SQL_REPONSES_SALON, B, 'gratuit', C.JOURS_CLOCHE, C.MAX_PAR_SOURCE)
    assert.equal(salonB.filter(x => crees.messages.includes(x.id)).length, 0)
    ok('SQL_REPONSES_SALON pour B : rien (on ne se notifie pas soi-meme)')

    const lecon = (await tx.$queryRawUnsafe(`select l.id::text as id from public.academie_lecons l join public.academie_modules m on m.id = l.module_id
      where l.statut = 'publie' and m.statut = 'publie' and not exists (select 1 from public.academie_billets b where b.lecon_id = l.id)
      order by m.ordre, l.ordre limit 1`))[0]?.id
    assert.ok(lecon, 'une lecon publiee sans billet')
    const qRep = await ins(`insert into public.academie_questions_lecons (user_id, lecon_id, question, statut, reponse, traitee_le, signature)
      values ($1::uuid, $2::uuid, 'Essai cloche : ma question', 'publiee', 'Essai cloche : la reponse', now(), 'Brice') returning id::text as id`, A, lecon)
    const qAtt = await ins(`insert into public.academie_questions_lecons (user_id, lecon_id, question) values ($1::uuid, $2::uuid, 'Essai cloche : en attente') returning id::text as id`, A, lecon)
    crees.questions.push(qRep, qAtt)
    const lecons = await tx.$queryRawUnsafe(C.SQL_REPONSES_LECONS, A, C.JOURS_CLOCHE, C.MAX_PAR_SOURCE)
    const lesMiennes = lecons.filter(x => crees.questions.includes(x.id))
    assert.deepEqual(lesMiennes.map(x => x.id), [qRep])
    const nq = C.notifLecon(lesMiennes[0], { lu_le: null, lues: [] })
    assert.match(nq.lien, /^\/academie\/[a-z0-9-]+\/[a-z0-9-]+#questions$/)
    assert.equal(nq.qui, 'Brice')
    ok('SQL_REPONSES_LECONS pour A : la question repondue seulement, lien vers le bloc des questions de la lecon')

    const billet = await ins(`insert into public.academie_billets (lecon_id, publie_le) values ($1::uuid, now() - interval '1 hour') returning id::text as id`, lecon)
    crees.billets.push(billet)
    const ann1 = await tx.$queryRawUnsafe(C.SQL_ANNONCES_CLOCHE, A, C.JOURS_CLOCHE, C.MAX_PAR_SOURCE)
    const b1 = ann1.find(x => x.id === billet)
    assert.ok(b1 && b1.vue === false, 'le billet de test, non vu')
    const ajoutees = await tx.$executeRawUnsafe(C.SQL_ANNONCES_TOUTES_VUES, A, C.JOURS_CLOCHE)
    assert.ok(ajoutees >= 1)
    const ann2 = await tx.$queryRawUnsafe(C.SQL_ANNONCES_CLOCHE, A, C.JOURS_CLOCHE, C.MAX_PAR_SOURCE)
    assert.equal(ann2.find(x => x.id === billet).vue, true)
    assert.equal(await tx.$executeRawUnsafe(C.SQL_ANNONCES_TOUTES_VUES, A, C.JOURS_CLOCHE), 0, 'rejouable')
    ok(`SQL_ANNONCES_CLOCHE : le billet de test non vu, puis vu apres « tout marquer lu » (${ajoutees} ligne(s)), rejouable`)

    const tout = C.assembler([
      ann1.map(C.notifAnnonce),
      [n],
      lesMiennes.map(x => C.notifLecon(x, { lu_le: null, lues: [] })),
    ])
    assert.ok(tout.non_lues >= 3)
    ok(`assembler : ${tout.notifications.length} notification(s), ${tout.non_lues} non lue(s) pour A dans l'essai`)

    throw new Error(ANNULE)
  }, { timeout: 120_000, maxWait: 10_000 })
} catch (err) {
  if (!String(err?.message).includes(ANNULE)) { await prisma.$disconnect(); throw err }
}
const reste = (await prisma.$queryRawUnsafe(`select
  (select count(*)::int from public.aok_chat_messages where id = any($1::uuid[])) as messages,
  (select count(*)::int from public.academie_questions_lecons where id = any($2::uuid[])) as questions,
  (select count(*)::int from public.academie_billets where id = any($3::uuid[])) as billets,
  (select position('realtime.send' in pg_get_functiondef('public.aok_chat_diffuser(text,jsonb,jsonb)'::regprocedure)) > 0) as diffuseur`,
crees.messages, crees.questions, crees.billets))[0]
assert.deepEqual(reste, { messages: 0, questions: 0, billets: 0, diffuseur: true })
ok(`transaction annulee (${((Date.now() - debut) / 1000).toFixed(1)} s) : aucun message, question ni billet n'est reste, aok_chat_diffuser intacte`)

// ---------------------------------------------------------------------------
// 2. La recherche (lecture seule)
// ---------------------------------------------------------------------------

const t0 = Date.now()
const [modulesL, sectionsL, leconsL, textesL] = await Promise.all([
  prisma.$queryRawUnsafe(SQL_MODULES_VISIBLES),
  prisma.$queryRawUnsafe(SQL_SECTIONS_VISIBLES),
  prisma.$queryRawUnsafe(SQL_LECONS_VISIBLES),
  prisma.$queryRawUnsafe(R.SQL_TEXTES_LECONS),
])
const t1 = Date.now()
const index = new Map()
for (const x of textesL) { const b = R.texteBrut(x.contenu); if (b) index.set(x.id, R.indexer(b)) }
const t2 = Date.now()
const publies = modulesL.filter(m => m.statut === 'publie')
const ids = new Set(publies.map(m => m.id))
const sections = new Map(sectionsL.map(s => [s.id, s.titre]))
const modules = publies.map(m => ({ id: m.id, slug: m.slug, titre: m.titre, resume: m.resume, ordre: m.ordre, lienExterne: m.lien_externe }))
const lecons = leconsL.filter(l => l.statut === 'publie' && ids.has(l.module_id)).map(l => ({
  id: l.id, moduleId: l.module_id, slug: l.slug, titre: l.titre, type: l.type, dureeS: l.duree_s, ordre: l.ordre,
  section: l.section_id ? sections.get(l.section_id) ?? null : null,
}))
const avecCarte = [...index.values()].filter(t => t.carte).length
const car = [...index.values()].reduce((s, t) => s + t.brut.length, 0)
ok(`index : ${lecons.length} lecons lisibles, ${index.size} textes (${Math.round(car / 1000)} k caracteres, ${avecCarte} avec carte), lu en ${t1 - t0} ms, indexe en ${t2 - t1} ms`)

const RECHERCHES = ['liquidité', 'order block', 'psychologie peur', 'fvg', 'plan de trading', 'journal', 'épisode 9', 'zzzz introuvable']
for (const q of RECHERCHES) {
  const ferme = () => ({ acces: 'ferme', raisons: [] })
  const a = Date.now()
  const rf = R.chercher({ q, modules, lecons, textes: index, ouverture: ferme, extraitPermis: () => true })
  const ms = Date.now() - a
  const extraitsFerme = rf.modules.flatMap(m => m.lecons).filter(l => l.extrait !== null).length
  assert.equal(extraitsFerme, 0, 'tout ferme : aucun extrait')
  const ro = R.chercher({ q, modules, lecons, textes: index, ouverture: () => ({ acces: 'ouvert', raisons: ['admin'] }), extraitPermis: () => true })
  const montrees = ro.modules.reduce((s, m) => s + m.lecons.length, 0)
  const extraits = ro.modules.flatMap(m => m.lecons).filter(l => l.extrait !== null).length
  assert.ok(montrees <= R.MAX_LECONS)
  ok(`« ${q} » : ${ro.total} lecon(s) dans ${ro.modules.length} module(s), ${montrees} montree(s), ${extraits} extrait(s) si ouvert, 0 si ferme, ${ms} ms`)
}

await prisma.$disconnect()
console.log(`\n${etapes} etapes ok`)
