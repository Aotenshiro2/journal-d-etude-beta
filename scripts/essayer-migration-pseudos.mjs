/**
 * ESSAI de la migration des @ a verifier (20261024150000_cockpit_liveclub_pseudos.sql)
 * contre la vraie base, dans UNE transaction TOUJOURS ANNULEE (rien ne reste) :
 *   1. la migration, ordre par ordre (meme decoupage que appliquer-migration.mjs), jouee deux fois ;
 *   2. les contraintes refusent ce qu'elles doivent refuser (savepoints) ;
 *   3. RLS : anon et un compte hors cockpit ne voient rien, un membre du cockpit lit mais n'ecrit pas ;
 *   4. l'APERCU reel de ce qu'Alex recevrait aujourd'hui (apercuRelais, donnees reelles), puis le meme
 *      apercu en supposant presents dans le groupe les comptes des ecarts connus (pour voir le message) ;
 *   5. la proposition d'Alex (proposerCorrectionPseudo, envoi coupe), la validation (deciderCorrection),
 *      un second clic, puis le PUSH DES PAIEMENTS simule (upsert merge-duplicates en service_role) :
 *      la correction doit survivre ;
 * Puis la transaction est annulee et on verifie que les tables n'existent pas.
 *
 * Lancement (apps/journal-d-etude, .env.local charge) : node scripts/essayer-migration-pseudos.mjs
 * N'affiche aucun email ni aucune cle. N'envoie aucun message Telegram (getChatMember au plus, une lecture).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = pathToFileURL(path.join(RACINE, 'src') + path.sep).href
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC)};
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (err) {
    let base = null
    if (spec.startsWith('@/')) base = new URL(spec.slice(2), SRC).href
    else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) base = new URL(spec, ctx.parentURL).href
    if (!base) throw err
    for (const c of [base + '.ts', base + '/index.ts']) { try { return await next(c, ctx) } catch {} }
    throw err
  }
}`))

// Aucun envoi possible : le jeton d'Agent AOK est retire de l'environnement de l'essai.
delete process.env.TELEGRAM_BOT_TOKEN_COCKPIT
const { PrismaClient } = await import('@prisma/client')
const { apercuRelais } = await import('../src/lib/liveclub/relais.ts')
const { proposerCorrectionPseudo, deciderCorrection } = await import('../src/lib/liveclub/corrections-pseudo.ts')

const FICHIER = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261024150000_cockpit_liveclub_pseudos.sql')
function decouper(sql) {
  const ordres = []; let courant = ''; let tag = null; let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]; i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}
const ORDRES = decouper(readFileSync(FICHIER, 'utf8').split('\n').filter(l => !l.trim().startsWith('--')).join('\n'))
  .filter(o => !/^notify /i.test(o))

const ALEX = 2110821350
const p = new PrismaClient()
const ANNULER = new Error('annulation volontaire')
let ok = 0
const bloc = (t) => { ok++; console.log('ok ', t) }
const sansSecret = (t) => !/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(t) && !/(€|\beur\b|montant|paiement|pr[eé]l[eè]vement|abonnement|stripe|factur)/i.test(t)

async function refuse(tx, nom, sql) {
  await tx.$executeRawUnsafe('savepoint s')
  let refuse = false
  try { await tx.$executeRawUnsafe(sql) } catch { refuse = true }
  await tx.$executeRawUnsafe('rollback to savepoint s')
  assert.ok(refuse, `devait etre refuse : ${nom}`)
}
async function commeRole(tx, role, uid, fn) {
  await tx.$executeRawUnsafe('savepoint r')
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid ?? '', role })}', true)`)
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', true)`)
  await tx.$executeRawUnsafe(`set local role ${role}`)
  let r, erreur = null
  try { r = await fn() } catch (e) { erreur = e }
  await tx.$executeRawUnsafe('rollback to savepoint r')
  await tx.$executeRawUnsafe('reset role')
  if (erreur) throw erreur
  return r
}

let apercuReel = null, apercuSimule = null, connus = []
try {
  await p.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
    for (let passe = 0; passe < 2; passe++) for (const o of ORDRES) await tx.$executeRawUnsafe(o)
    bloc(`migration jouee deux fois (${ORDRES.length} ordres), rejouable`)

    const [m] = await tx.$queryRawUnsafe(`select membre_id::text as id from public.cockpit_membres limit 1`)
    await refuse(tx, '@ invalide (ecart)', `insert into public.cockpit_liveclub_relais_ecarts (relais_id, membre_id, pseudo_fiche, pseudo_compte) values (${ALEX}, '${m.id}', 'a b', 'valide1')`)
    await refuse(tx, 'meme @ des deux cotes', `insert into public.cockpit_liveclub_relais_ecarts (relais_id, membre_id, pseudo_fiche, pseudo_compte) values (${ALEX}, '${m.id}', 'Lea_M', 'lea_m')`)
    await tx.$executeRawUnsafe(`insert into public.cockpit_liveclub_relais_ecarts (relais_id, membre_id, pseudo_fiche, pseudo_compte) values (${ALEX}, '${m.id}', 'fiche1', 'compte1')`)
    await refuse(tx, 'meme ecart deux fois (casse)', `insert into public.cockpit_liveclub_relais_ecarts (relais_id, membre_id, pseudo_fiche, pseudo_compte) values (${ALEX}, '${m.id}', 'FICHE1', 'Compte1')`)
    await refuse(tx, '@ propose invalide', `insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, propose_par_telegram) values ('${m.id}', '@avec_arobase', ${ALEX})`)
    await refuse(tx, 'statut inconnu', `insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, propose_par_telegram, statut, decide_le) values ('${m.id}', 'valide1', ${ALEX}, 'appliquee', now())`)
    await refuse(tx, 'validee sans date', `insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, propose_par_telegram, statut) values ('${m.id}', 'valide1', ${ALEX}, 'validee')`)
    await tx.$executeRawUnsafe(`insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, propose_par_telegram, statut, decide_le) values ('${m.id}', 'valide1', ${ALEX}, 'validee', now())`)
    await refuse(tx, 'deux validees pour un membre', `insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, propose_par_telegram, statut, decide_le) values ('${m.id}', 'valide2', ${ALEX}, 'validee', now())`)
    await tx.$executeRawUnsafe(`delete from public.cockpit_liveclub_corrections_pseudo`)
    await tx.$executeRawUnsafe(`delete from public.cockpit_liveclub_relais_ecarts`)
    bloc('contraintes : @ au format, jamais le meme @ des deux cotes, un ecart une fois (sans casse), statuts, une seule validee par membre')

    const [membre] = await tx.$queryRawUnsafe(`select user_id::text as uid from public.cockpit_allowlist where label = 'Brice' limit 1`)
    const inconnu = '11111111-2222-3333-4444-555555555555'
    for (const t of ['cockpit_liveclub_relais_ecarts', 'cockpit_liveclub_corrections_pseudo']) {
      const vuAnon = await commeRole(tx, 'anon', null, () => tx.$queryRawUnsafe(`select count(*)::int n from public.${t}`).then(r => r[0].n).catch(() => 'refuse'))
      const vuInconnu = await commeRole(tx, 'authenticated', inconnu, () => tx.$queryRawUnsafe(`select count(*)::int n from public.${t}`).then(r => r[0].n))
      assert.ok(vuAnon === 'refuse' || vuAnon === 0); assert.equal(vuInconnu, 0)
      const lit = await commeRole(tx, 'authenticated', membre.uid, () => tx.$queryRawUnsafe(`select count(*)::int n from public.${t}`).then(() => true))
      assert.equal(lit, true)
    }
    const ecrit = await commeRole(tx, 'authenticated', membre.uid, () => tx.$executeRawUnsafe(
      `insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, propose_par_telegram) values ('${m.id}', 'valide1', ${ALEX})`).then(() => true).catch(() => false))
    assert.equal(ecrit, false)
    bloc('RLS : anon et hors cockpit 0 ligne, un membre du cockpit lit mais n ecrit pas')

    // 4. L'apercu reel, puis l'apercu en supposant les comptes des ecarts connus presents dans le groupe.
    apercuReel = await apercuRelais(tx, { enDirect: true })
    assert.equal(apercuReel.etat, 'apercu')
    assert.ok(sansSecret(JSON.stringify(apercuReel)), 'apercu reel sans email ni argent')
    connus = await tx.$queryRawUnsafe(`select m.membre_id::text as membre_id, m.nom, m.telegram, r.telegram_id, tm.pseudo, tm.present, tm.statut_tg
      from public.cockpit_membres m
      join public.cockpit_liveclub_rattachements r on r.membre_id = m.membre_id and r.retire_le is null
      join public.cockpit_telegram_membres tm on tm.telegram_id = r.telegram_id
      where tm.pseudo is not null and m.telegram ~ '^@?[A-Za-z][A-Za-z0-9_]{3,31}$' and lower(ltrim(m.telegram, '@')) <> lower(tm.pseudo)
      order by m.nom`)
    bloc(`apercu reel : ${apercuReel.lignes} membre(s) a contacter, ${apercuReel.ecarts} @ a verifier (${connus.length} ecart(s) en base, comptes joignables ou non)`)
    if (connus.length > 0) {
      await tx.$executeRawUnsafe(`update public.cockpit_telegram_membres set present = true, statut_tg = 'member'
        where telegram_id::text = any($1::text[])`, connus.map(c => String(c.telegram_id)))
      apercuSimule = await apercuRelais(tx, { enDirect: false })
      assert.ok(sansSecret(JSON.stringify(apercuSimule)), 'apercu simule sans email ni argent')
      assert.ok(apercuSimule.ecarts >= 1)
      bloc(`apercu simule (comptes des ecarts supposes presents) : ${apercuSimule.ecarts} @ a verifier`)
    }

    // 5. Alex propose, l'equipe valide, le push des paiements repasse.
    const cible = connus.find(c => /fouchane/i.test(c.nom ?? '')) ?? connus[0]
    if (!cible) throw new Error('aucun ecart reel pour l essai de proposition')
    const [ins] = await tx.$queryRawUnsafe(`insert into public.cockpit_liveclub_relais_ecarts (relais_id, membre_id, pseudo_fiche, pseudo_compte, envoye_le)
      values (${ALEX}, '${cible.membre_id}', ltrim('${cible.telegram}', '@'), '${cible.pseudo}', now()) returning ecart_id`)
    assert.ok(ins)
    const horsListe = await proposerCorrectionPseudo(ALEX, { membre: 'personne-inexistante-xyz', pseudo: 'valide1' }, tx, { envoyer: false })
    assert.ok(horsListe.erreur, JSON.stringify(horsListe))
    const pasRelais = await proposerCorrectionPseudo(123456, { membre: cible.nom, pseudo: cible.pseudo }, tx, { envoyer: false })
    assert.ok(pasRelais.erreur)
    const mauvais = await proposerCorrectionPseudo(ALEX, { membre: cible.nom, pseudo: 'a b' }, tx, { envoyer: false })
    assert.ok(mauvais.erreur)
    const propose = await proposerCorrectionPseudo(ALEX, { membre: cible.nom, pseudo: `@${cible.pseudo}` }, tx, { envoyer: false })
    assert.equal(propose.resultat, 'Transmis à Brice et Mel : ils valident, puis la fiche est corrigée.', JSON.stringify(propose))
    const encore = await proposerCorrectionPseudo(ALEX, { membre: cible.nom, pseudo: cible.pseudo.toUpperCase() }, tx, { envoyer: false })
    assert.match(String(encore.resultat), /^Déjà transmis/)
    const [avant] = await tx.$queryRawUnsafe(`select telegram from public.cockpit_membres where membre_id = '${cible.membre_id}'`)
    assert.equal(avant.telegram, cible.telegram, 'la proposition n applique rien')
    bloc('proposition : hors liste, non-relais et @ invalide refuses, enregistree une fois, fiche inchangee')

    const [prop] = await tx.$queryRawUnsafe(`select correction_id::int as id, pseudo_fiche_avant, pseudo_compte from public.cockpit_liveclub_corrections_pseudo where membre_id = '${cible.membre_id}' and statut = 'proposee'`)
    const equipe = { telegramId: 1, userId: membre.uid, libelle: 'Brice' }
    await tx.$executeRawUnsafe('savepoint d')
    const valide = await deciderCorrection(tx, prop.id, 'valider', equipe)
    assert.equal(valide.genre, 'valider')
    const deja = await deciderCorrection(tx, prop.id, 'refuser', equipe)
    assert.equal(deja.genre, 'deja')
    const [apres] = await tx.$queryRawUnsafe(`select telegram from public.cockpit_membres where membre_id = '${cible.membre_id}'`)
    assert.equal(apres.telegram, `@${cible.pseudo}`)
    const rattachementsAvant = (await tx.$queryRawUnsafe(`select count(*)::int n from public.cockpit_liveclub_rattachements where membre_id = '${cible.membre_id}' and retire_le is null`))[0].n
    // Le push des paiements, tel que PostgREST le joue (merge-duplicates), en service_role.
    await tx.$executeRawUnsafe(`set local role service_role`)
    await tx.$executeRawUnsafe(`insert into public.cockpit_membres (membre_id, nom, telegram) values ('${cible.membre_id}', $1, $2)
      on conflict (membre_id) do update set nom = excluded.nom, telegram = excluded.telegram`, cible.nom, cible.telegram)
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = null where membre_id = '${cible.membre_id}'`)
    await tx.$executeRawUnsafe('reset role')
    const [push] = await tx.$queryRawUnsafe(`select telegram from public.cockpit_membres where membre_id = '${cible.membre_id}'`)
    assert.equal(push.telegram, `@${cible.pseudo}`, 'la correction survit au push')
    const rattachementsApres = (await tx.$queryRawUnsafe(`select count(*)::int n from public.cockpit_liveclub_rattachements where membre_id = '${cible.membre_id}' and retire_le is null`))[0].n
    assert.equal(rattachementsApres, rattachementsAvant)
    bloc(`validation : fiche corrigee, second clic = deja traite, push des paiements rejoue (upsert et null) = correction gardee, rattachements intacts`)
    console.log('   message apres validation :', valide.texte)
    await tx.$executeRawUnsafe('rollback to savepoint d')

    const refus = await deciderCorrection(tx, prop.id, 'refuser', equipe)
    assert.equal(refus.genre, 'refuser')
    const [garde] = await tx.$queryRawUnsafe(`select telegram from public.cockpit_membres where membre_id = '${cible.membre_id}'`)
    assert.equal(garde.telegram, cible.telegram)
    bloc('refus : marquee refusee, fiche inchangee')
    console.log('   message apres refus :', refus.texte)
    throw ANNULER
  }, { timeout: 120_000, maxWait: 20_000 })
} catch (e) {
  if (e !== ANNULER) { console.error('ECHEC :', e.message); await p.$disconnect(); process.exit(1) }
}
const [reste] = await p.$queryRawUnsafe(`select to_regclass('public.cockpit_liveclub_relais_ecarts') is null and to_regclass('public.cockpit_liveclub_corrections_pseudo') is null as absente`)
assert.equal(reste.absente, true)
bloc('transaction annulee : rien n est reste en base')
await p.$disconnect()

console.log(`\n${ok} blocs verifies, tout est bon.`)
console.log('\nECARTS EN BASE (fiche / compte rattache, registre du groupe) :')
for (const c of connus) console.log(`- ${c.nom} : ${c.telegram} / @${c.pseudo} (present ${c.present}, ${c.statut_tg})`)
const afficher = (titre, a) => {
  console.log(`\n${titre}`)
  for (const r of a?.apercus ?? []) for (const [i, m] of r.messages.entries()) {
    console.log(`\n--- message ${i + 1} a ${r.relais} ---\n${m.texte}${m.boutons.length ? `\n[boutons] ${m.boutons.join(' | ')}` : ''}`)
  }
  if (!a?.apercus?.some(r => r.messages.length)) console.log('(aucun message)')
}
afficher("APERCU REEL (ce qu'Alex recevrait aujourd'hui, rien n'est envoye) :", apercuReel)
afficher('APERCU SIMULE (comptes des ecarts supposes presents dans le groupe) :', apercuSimule)
