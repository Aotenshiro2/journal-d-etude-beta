// Verification HORS LIGNE des questions sous les lecons (09/11/2026) : le
// nettoyage d'un texte, la lecture des corps (route du site, route du
// cockpit), QUI VOIT QUOI (visiblePour, questionsPourMembre), la LIMITE PAR
// JOUR, la signature, l'alerte a l'equipe, l'email au membre, la migration
// (lue comme un fichier) et le code des routes (aucun texte de membre ni
// email dans les journaux). Fonctions pures et lecture de fichiers : aucune
// base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude) : node scripts/verifier-questions-lecons.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-questions-lecons.mjs.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as Q from '../src/lib/academie/questions-lecons.ts'

let blocs = 0
async function bloc(nom, fn) {
  await fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')

// La migration vit dans le depot du workspace : a cote du journal dans le checkout principal
// (apps/journal-d-etude), ou ailleurs pour un worktree (AOK_WORKSPACE=<racine du workspace>).
const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261109090000_academie_questions_lecons.sql'
function cheminMigration() {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
    new URL(`../../../${MIGRATION}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find(u => existsSync(u))
  if (!trouve) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)
  return trouve
}

// Tiret demi-cadratin et cadratin, guillemets courbes, points de suspension en un caractere, espaces insecables.
const INTERDITS = /[–—‘’“”…  ]/
const c = String.fromCharCode
const MOI = 'a0000000-0000-4000-8000-00000000000a'
const AUTRE = 'b0000000-0000-4000-8000-00000000000b'
const LECON = 'c0000000-0000-4000-8000-00000000000c'

const ligne = (o) => ({
  id: o.id, user_id: o.user_id, lecon_id: LECON, question: o.question ?? `Question ${o.id}`,
  question_publiee: o.question_publiee ?? null, reponse: o.reponse ?? null, statut: o.statut,
  signature: o.signature ?? null, cree_le: o.cree_le, traitee_le: o.traitee_le ?? null,
})

await bloc('nettoyerTexte : controles et invisibles retires, fins de ligne, espaces, vide = null, bornes', () => {
  assert.equal(Q.nettoyerTexte(null, 10), null)
  assert.equal(Q.nettoyerTexte(undefined, 10), null)
  assert.equal(Q.nettoyerTexte('  \n\t ', 10), null)
  assert.equal(Q.nettoyerTexte(42, 10), 'invalide')
  assert.equal(Q.nettoyerTexte(['a'], 10), 'invalide')
  const sale = `Le${c(0)} FVG${c(7)} ${c(0x1b)}[31mcomble${c(0x85)} ${c(0x200b)}vite${c(0x202e)}${c(0x2066)}${c(0xfeff)}`
  assert.equal(Q.nettoyerTexte(sale, 200), 'Le FVG [31mcomble vite')
  assert.equal(Q.nettoyerTexte('  Ligne 1\r\nLigne\t2  \rLigne 3  ', 200), 'Ligne 1\nLigne 2\nLigne 3')
  assert.equal(Q.nettoyerTexte('a\n\n\n\n\nb', 200), 'a\n\nb')
  assert.equal(Q.nettoyerTexte('x'.repeat(Q.MAX_QUESTION), Q.MAX_QUESTION), 'x'.repeat(Q.MAX_QUESTION))
  assert.equal(Q.nettoyerTexte('x'.repeat(Q.MAX_QUESTION + 1), Q.MAX_QUESTION), 'trop_long')
  // Le HTML reste du texte : rien n'est interprete, l'ecran l'affiche tel quel.
  assert.equal(Q.nettoyerTexte('<b>gras</b>', 200), '<b>gras</b>')
})

await bloc('lireDemandeEleve : lire ou poser, lecon en uuid, question nettoyee (vide, trop longue, pas du texte)', () => {
  assert.deepEqual(Q.lireDemandeEleve({ action: 'lire', lecon: LECON.toUpperCase() }), { action: 'lire', lecon: LECON })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'poser', lecon: LECON, question: '  Pourquoi le OTE ?  ' }),
    { action: 'poser', lecon: LECON, question: 'Pourquoi le OTE ?' })
  assert.deepEqual(Q.lireDemandeEleve({}), { erreur: 'action' })
  assert.deepEqual(Q.lireDemandeEleve(null), { erreur: 'action' })
  assert.deepEqual(Q.lireDemandeEleve([]), { erreur: 'action' })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'supprimer', lecon: LECON }), { erreur: 'action' })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'lire', lecon: 'pas-un-id' }), { erreur: 'lecon' })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'poser', lecon: LECON }), { erreur: 'vide' })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'poser', lecon: LECON, question: `${c(0x200b)}  ` }), { erreur: 'vide' })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'poser', lecon: LECON, question: { t: 1 } }), { erreur: 'question' })
  assert.deepEqual(Q.lireDemandeEleve({ action: 'poser', lecon: LECON, question: 'x'.repeat(1001) }), { erreur: 'longueur' })
  // Le compte ne vient JAMAIS du corps : un user_id glisse dans la demande n'est pas lu.
  const d = Q.lireDemandeEleve({ action: 'poser', lecon: LECON, question: 'ok', user_id: AUTRE })
  assert.equal('user_id' in d, false)
})

await bloc('visiblePour : ses questions dans tous les etats, celles des autres seulement publiees', () => {
  for (const statut of ['en_attente', 'publiee', 'privee', 'ecartee']) {
    assert.equal(Q.visiblePour({ user_id: MOI, statut }, MOI), true, `la sienne ${statut}`)
  }
  assert.equal(Q.visiblePour({ user_id: AUTRE, statut: 'publiee' }, MOI), true)
  assert.equal(Q.visiblePour({ user_id: AUTRE, statut: 'en_attente' }, MOI), false, 'en attente d un autre')
  assert.equal(Q.visiblePour({ user_id: AUTRE, statut: 'privee' }, MOI), false, 'reponse privee d un autre')
  assert.equal(Q.visiblePour({ user_id: AUTRE, statut: 'ecartee' }, MOI), false, 'ecartee d un autre')
  assert.equal(Q.visiblePour({ user_id: '', statut: 'en_attente' }, ''), false, 'sans compte : rien de prive')
  assert.equal(Q.visiblePour({ user_id: '', statut: 'privee' }, ''), false, 'sans compte : rien de prive')
  assert.equal(Q.visiblePour({ user_id: AUTRE, statut: 'publiee' }, ''), true, 'une publiee reste publiee')
})

await bloc('questionsPourMembre : ce que voient l auteur et un autre membre, dans l ordre de l ecran, sans identifiant', () => {
  const lignes = [
    ligne({ id: 'p-ancienne', user_id: AUTRE, statut: 'publiee', reponse: 'R1', signature: 'Brice', cree_le: '2026-11-01T10:00:00Z', traitee_le: '2026-11-02T10:00:00Z' }),
    ligne({ id: 'p-recente', user_id: AUTRE, statut: 'publiee', question: 'Brice, pourquoi ?', question_publiee: 'Pourquoi ?', reponse: 'R2', signature: 'Brice', cree_le: '2026-11-03T10:00:00Z', traitee_le: '2026-11-05T10:00:00Z' }),
    ligne({ id: 'attente-moi', user_id: MOI, statut: 'en_attente', cree_le: '2026-11-06T10:00:00Z' }),
    ligne({ id: 'attente-autre', user_id: AUTRE, statut: 'en_attente', cree_le: '2026-11-06T11:00:00Z' }),
    ligne({ id: 'privee-moi', user_id: MOI, statut: 'privee', reponse: 'Rp', signature: 'Mélanie', cree_le: '2026-11-02T10:00:00Z', traitee_le: '2026-11-04T10:00:00Z' }),
    ligne({ id: 'privee-autre', user_id: AUTRE, statut: 'privee', reponse: 'Secret', signature: 'Brice', cree_le: '2026-11-02T10:00:00Z', traitee_le: '2026-11-04T12:00:00Z' }),
    ligne({ id: 'ecartee-moi', user_id: MOI, statut: 'ecartee', cree_le: '2026-11-05T09:00:00Z', traitee_le: '2026-11-05T12:00:00Z' }),
    ligne({ id: 'ecartee-autre', user_id: AUTRE, statut: 'ecartee', cree_le: '2026-11-05T09:00:00Z', traitee_le: '2026-11-05T12:00:00Z' }),
  ]
  const moi = Q.questionsPourMembre(lignes, MOI)
  assert.deepEqual(moi.map(q => q.id), ['attente-moi', 'ecartee-moi', 'p-recente', 'privee-moi', 'p-ancienne'])
  const pm = Object.fromEntries(moi.map(q => [q.id, q]))
  assert.equal(pm['attente-moi'].mienne, true)
  assert.equal(pm['attente-moi'].reponse, null)
  assert.equal(pm['attente-moi'].repondue_le, null)
  assert.equal(pm['privee-moi'].reponse, 'Rp', 'son auteur lit la reponse privee')
  assert.equal(pm['privee-moi'].signature, 'Mélanie')
  assert.equal(pm['p-recente'].question, 'Pourquoi ?', 'publiee : le texte corrige par l equipe')
  assert.equal(pm['p-recente'].mienne, false)
  assert.equal(pm['ecartee-moi'].reponse, null)

  const autre = Q.questionsPourMembre(lignes, AUTRE)
  assert.deepEqual(autre.map(q => q.id), ['attente-autre', 'ecartee-autre', 'p-recente', 'privee-autre', 'p-ancienne'])

  // Un troisieme membre ne voit que les publiees, de la reponse la plus recente a la plus ancienne.
  const tiers = Q.questionsPourMembre(lignes, 'd0000000-0000-4000-8000-00000000000d')
  assert.deepEqual(tiers.map(q => q.id), ['p-recente', 'p-ancienne'])
  assert.ok(tiers.every(q => q.mienne === false && q.statut === 'publiee'))

  // Jamais un identifiant de compte dans ce que recoit la page.
  for (const q of [...moi, ...autre, ...tiers]) {
    assert.deepEqual(Object.keys(q).sort(), ['cree_le', 'id', 'mienne', 'question', 'repondue_le', 'reponse', 'signature', 'statut'])
    assert.ok(!JSON.stringify(q).includes(MOI) && !JSON.stringify(q).includes(AUTRE))
  }
  // Borne du nombre rendu.
  const beaucoup = Array.from({ length: Q.MAX_PAR_LECON + 30 }, (_, i) =>
    ligne({ id: `n${i}`, user_id: AUTRE, statut: 'publiee', reponse: 'R', cree_le: '2026-11-01T10:00:00Z', traitee_le: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }))
  assert.equal(Q.questionsPourMembre(beaucoup, MOI).length, Q.MAX_PAR_LECON)
  // Sans compte : rien de prive ne sort.
  assert.deepEqual(Q.questionsPourMembre(lignes, '').map(q => q.id), ['p-recente', 'p-ancienne'])
})

await bloc('limite par jour : 5 questions sur 24 heures glissantes, restantes jamais negatives', () => {
  assert.equal(Q.MAX_QUESTIONS_JOUR, 5)
  assert.equal(Q.restantes(0), 5)
  assert.equal(Q.restantes(4), 1)
  assert.equal(Q.restantes(5), 0)
  assert.equal(Q.restantes(9), 0)
  assert.equal(Q.restantes(-3), 5)
  assert.equal(Q.restantes(Number.NaN), 0, 'compte illisible : on ne promet rien')
  assert.equal(Q.restantes(2, 3), 1)
  // La limite est dans le meme ordre SQL que l'ecriture (24 heures glissantes, le seuil en parametre).
  assert.match(Q.SQL_POSER, /insert into public\.academie_questions_lecons/)
  assert.match(Q.SQL_POSER, /cree_le > now\(\) - interval '1 day'\) < \$4::int/)
  assert.match(Q.SQL_POSEES_24H, /cree_le > now\(\) - interval '1 day'/)
})

await bloc('signatureDeLabel : le prenom du libelle de l allowlist', () => {
  assert.equal(Q.signatureDeLabel('Brice'), 'Brice')
  assert.equal(Q.signatureDeLabel('Mélanie'), 'Mélanie')
  assert.equal(Q.signatureDeLabel('Tab (agent IA de Brice)'), 'Tab')
  assert.equal(Q.signatureDeLabel('  Adil  '), 'Adil')
  assert.equal(Q.signatureDeLabel(''), null)
  assert.equal(Q.signatureDeLabel(null), null)
  assert.equal(Q.signatureDeLabel(12), null)
  assert.equal(Q.signatureDeLabel('x'.repeat(80)).length, 60)
})

await bloc('lireDemandeEquipe : lister, repondre (publier ou prive, question corrigee), ecarter', () => {
  assert.deepEqual(Q.lireDemandeEquipe({ action: 'lister' }), { action: 'lister', vue: 'attente' })
  assert.deepEqual(Q.lireDemandeEquipe({ action: 'lister', vue: 'traitees' }), { action: 'lister', vue: 'traitees' })
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'lister', vue: 'tout' }))
  assert.deepEqual(Q.lireDemandeEquipe({ action: 'ecarter', id: LECON }), { action: 'ecarter', id: LECON })
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'ecarter', id: 'x' }))
  assert.deepEqual(Q.lireDemandeEquipe({ action: 'repondre', id: LECON, reponse: ' Oui. ', mode: 'publier', question: 'Q corrigee' }),
    { action: 'repondre', id: LECON, reponse: 'Oui.', question: 'Q corrigee', mode: 'publier' })
  assert.deepEqual(Q.lireDemandeEquipe({ action: 'repondre', id: LECON, reponse: 'Oui', mode: 'prive' }),
    { action: 'repondre', id: LECON, reponse: 'Oui', question: null, mode: 'prive' })
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'repondre', id: LECON, reponse: '  ', mode: 'prive' }))
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'repondre', id: LECON, reponse: 'x'.repeat(4001), mode: 'prive' }))
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'repondre', id: LECON, reponse: 'Oui', mode: 'public' }))
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'repondre', id: LECON, reponse: 'Oui', mode: 'prive', question: 'x'.repeat(1001) }))
  assert.ok('erreur' in Q.lireDemandeEquipe({ action: 'supprimer', id: LECON }))
  assert.equal(Q.statutDuMode('publier'), 'publiee')
  assert.equal(Q.statutDuMode('prive'), 'privee')
  assert.equal(Q.questionCorrigee('Texte', null), null)
  assert.equal(Q.questionCorrigee('Texte', 'Texte'), null, 'identique : rien a corriger')
  assert.equal(Q.questionCorrigee('Txte', 'Texte'), 'Texte')
  // Un email a la premiere reponse (ou au repechage d'une ecartee), jamais a une retouche.
  assert.equal(Q.premiereReponse('en_attente'), true)
  assert.equal(Q.premiereReponse('ecartee'), true)
  assert.equal(Q.premiereReponse('publiee'), false)
  assert.equal(Q.premiereReponse('privee'), false)
})

await bloc('alerte a l equipe : lecon, qui, question citee (300), lien de la boite, sans tiret long ni emoji', () => {
  const t = Q.texteAlerteQuestion({ qui: 'eleve@exemple.fr', moduleTitre: 'Les bases', leconTitre: 'Le FVG', question: 'Pourquoi\n\nle FVG ?' })
  assert.match(t, /^Nouvelle question sous une leçon de l'académie\./)
  assert.match(t, /Leçon : Le FVG \(Les bases\)/)
  assert.match(t, /Qui : eleve@exemple\.fr/)
  assert.match(t, /Sa question : « Pourquoi le FVG \? »/)
  assert.ok(t.includes(Q.LIEN_BOITE))
  assert.doesNotMatch(t, INTERDITS)
  assert.doesNotMatch(t, /\p{Extended_Pictographic}/u)
  const long = Q.texteAlerteQuestion({ qui: null, moduleTitre: 'M', leconTitre: 'L', question: 'y'.repeat(500), securite: 'Attention (sécurité) : x.' })
  assert.match(long, /Qui : un membre/)
  assert.match(long, /« y{300}\.\.\. »/)
  assert.match(long, /Attention \(sécurité\)/)
})

await bloc('email au membre : court, tutoiement, lien de la lecon ancre #questions, prive ou publie, echappe', () => {
  const lien = Q.lienLecon('les-bases-smart-money', 'le-fvg')
  assert.equal(lien, 'https://aoknowledge.com/academie/les-bases-smart-money/le-fvg#questions')
  const m = Q.mailReponse({ moduleTitre: 'Les bases', leconTitre: 'Le <FVG>', lien, mode: 'publier', signature: 'Brice' })
  assert.equal(m.objet, 'Ta question sur « Le <FVG> » a sa réponse')
  assert.match(m.texte, /Brice a répondu à la question que tu as posées? sous la leçon « Le <FVG> » \(Les bases\)\./)
  assert.match(m.texte, /ta question leur sert aussi/)
  assert.ok(m.texte.includes(`Lire la réponse : ${lien}`))
  assert.ok(m.html.includes('Le &lt;FVG&gt;') && !m.html.includes('<FVG>'), 'le titre est echappe dans le HTML')
  assert.ok(m.html.includes(`href="${lien}"`))
  assert.doesNotMatch(m.texte, /\bvous\b|\bvotre\b/i)
  const p = Q.mailReponse({ moduleTitre: 'M', leconTitre: 'L', lien, mode: 'prive', signature: null, essai: true })
  assert.match(p.objet, /^\[Essai\] /)
  assert.match(p.texte, /^Bonjour,\n\nL'équipe a répondu/)
  assert.match(p.texte, /n'est visible que par toi/)
  for (const x of [m, p]) {
    assert.doesNotMatch(x.objet + x.texte, INTERDITS)
    assert.ok(x.texte.length < 800, 'un email court')
  }
})

await bloc('migration : table fermee a l ecriture, RLS activee et forcee, lecture de ses lignes et de l equipe, aucun ; hors fin d ordre', () => {
  const sql = readFileSync(cheminMigration(), 'utf8')
  const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const commentaires = sql.split('\n').filter(l => l.trim().startsWith('--')).join('\n')
  assert.doesNotMatch(commentaires, /;/, 'aucun point-virgule dans les commentaires')
  // Aucun point-virgule dans une chaine.
  for (const ch of code.match(/'[^']*'/g) ?? []) assert.doesNotMatch(ch, /;/, ch)
  assert.match(code, /alter table public\.academie_questions_lecons enable row level security/)
  assert.match(code, /alter table public\.academie_questions_lecons force row level security/)
  assert.match(code, /revoke all on public\.academie_questions_lecons from anon, authenticated, service_role/)
  assert.match(code, /grant select on public\.academie_questions_lecons to authenticated/)
  assert.doesNotMatch(code, /grant [^;]*(insert|update|delete)[^;]*academie_questions_lecons/i, 'aucune ecriture accordee')
  assert.match(code, /using \(user_id = \(select auth\.uid\(\)\)\)/)
  assert.match(code, /using \(public\.is_cockpit_member\(\)\)/)
  assert.doesNotMatch(code, /to anon/)
  assert.match(code, /between 1 and 1000/)
  assert.match(code, /'en_attente', 'publiee', 'privee', 'ecartee'/)
})

await bloc('routes : le droit sur la lecon avant la table, aucun texte de membre ni email dans les journaux', () => {
  const site = lire('../src/app/api/academie/questions-lecon/route.ts')
  const cockpit = lire('../src/app/api/cockpit/academie/questions-lecons/route.ts')
  const envois = lire('../src/lib/academie/questions-lecons-envois.ts')
  assert.ok(site.indexOf('droitsAcademie(compte.id)') < site.indexOf('questionsDeLecon('), 'le droit est lu avant les questions')
  assert.ok(site.indexOf("ouverture.acces !== 'ouvert'") < site.indexOf('poserQuestion('), 'le droit est verifie avant l ecriture')
  assert.match(site, /compteCompletDuJeton\(req\.headers\.get\('authorization'\)\)/)
  assert.match(cockpit, /from public\.cockpit_allowlist where user_id/)
  for (const [nom, src] of [['site', site], ['cockpit', cockpit], ['envois', envois]]) {
    const logs = src.split('\n').filter(l => /console\.(log|info|warn|error)/.test(l))
    for (const l of logs) {
      // Un nombre (« .length ») peut sortir, jamais le texte ni l'adresse.
      assert.doesNotMatch(l, /\$\{(?![^}]*\.length\})[^}]*(question|reponse|email|qui)[^}]*\}/i, `${nom} : ${l.trim()}`)
      assert.doesNotMatch(l, /\$\{(err|e)\.message/, `${nom} : message brut`)
    }
  }
  assert.match(cockpit, /premiereReponse\(r\.avant\)/, 'un email a la premiere reponse seulement')
})

console.log(`\n${blocs} blocs ok`)
