/**
 * Verifie la partie pure de la CLOCHE et de la RECHERCHE DANS LES LECONS (13/11/2026,
 * src/lib/academie/cloche.ts et src/lib/academie/recherche.ts) : la marque du compte, les
 * notifications et ce qui en sort, le corps du POST, la marque apres un clic ou « tout marquer
 * lu » ; les mots cherches, le texte brut, les extraits, et surtout LES ACCES (une lecon fermee
 * sort sans son contenu, un visiteur n'a d'extrait que pour un apercu). Sans base, sans reseau.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node scripts/verifier-cloche-recherche.mjs
 */

import assert from 'node:assert/strict'
import * as C from '../src/lib/academie/cloche.ts'
import * as R from '../src/lib/academie/recherche.ts'

let blocs = 0
const bloc = (nom, f) => { f(); blocs++; console.log(`ok  ${nom}`) }

const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const V = n => `1a2b3c4d-5e6f-4000-8000-${String(n).padStart(12, '0')}`
// Des uuid dont les 12 premiers chiffres different (les cles courtes aussi).
const W = n => `${n.toString(16).padStart(8, '0')}-abcd-4000-8000-000000000000`

// ---------------------------------------------------------------------------
// La cloche
// ---------------------------------------------------------------------------

bloc('cloche : la marque du compte', () => {
  assert.deepEqual(C.lireMarque(undefined), { lu_le: null, lues: [] })
  assert.deepEqual(C.lireMarque('x'), { lu_le: null, lues: [] })
  assert.deepEqual(C.lireMarque([1, 2]), { lu_le: null, lues: [] })
  const m = C.lireMarque({ lu_le: '2026-11-13T10:00:00Z', lues: ['c1a2b3c4d5e6f', 'q000000004000', 'a1a2b3c4d5e6f', 'c1a2b3c4d5e6f', 12, 'C1A2B3C4D5E6F'] })
  assert.equal(m.lu_le, '2026-11-13T10:00:00.000Z')
  assert.deepEqual(m.lues, ['c1a2b3c4d5e6f', 'q000000004000'])
  assert.equal(C.lireMarque({ lu_le: 'pas une date' }).lu_le, null)
  const beaucoup = Array.from({ length: 80 }, (_, i) => `c${String(i).padStart(12, '0')}`)
  assert.equal(C.lireMarque({ lues: beaucoup }).lues.length, C.MAX_LUES)
})

bloc('cloche : cles courtes et reponse lue', () => {
  assert.equal(C.cleCourte(`c:${V(1)}`), 'c1a2b3c4d5e6f')
  assert.equal(C.cleCourte(`q:${U(7)}`), 'q000000000000')
  assert.equal(C.cleCourte(`a:${U(7)}`), null)
  assert.equal(C.cleCourte('c:pas-un-uuid'), null)
  assert.equal(C.cleCourte(`x:${U(1)}`), null)
  const marque = { lu_le: '2026-11-10T00:00:00.000Z', lues: ['c1a2b3c4d5e6f'] }
  assert.equal(C.reponseLue(`q:${U(1)}`, '2026-11-09T00:00:00.000Z', marque), true, 'avant tout marquer lu')
  assert.equal(C.reponseLue(`q:${U(1)}`, '2026-11-11T00:00:00.000Z', marque), false)
  assert.equal(C.reponseLue(`c:${V(1)}`, '2026-11-11T00:00:00.000Z', marque), true, 'cliquee')
  assert.equal(C.reponseLue(`c:${V(1)}`, '2026-11-11T00:00:00.000Z', { lu_le: null, lues: [] }), false)
})

bloc('cloche : extraits', () => {
  assert.equal(C.extraitDe(null), null)
  assert.equal(C.extraitDe('   \n '), null)
  assert.equal(C.extraitDe('Une\nligne   courte'), 'Une ligne courte')
  const long = 'mot '.repeat(80)
  const e = C.extraitDe(long)
  assert.ok(e.endsWith('…') && Array.from(e).length <= C.MAX_EXTRAIT + 1, e)
  assert.ok(!e.includes('—'), 'jamais de tiret cadratin')
})

bloc('cloche : les trois sources en notifications (rien d\'autre ne sort)', () => {
  const vide = { lu_le: null, lues: [] }
  const a = C.notifAnnonce({ id: U(1), publie_le: new Date('2026-11-12T09:00:00Z'), titre: 'Le point de la semaine', vue: false })
  assert.deepEqual(a, {
    cle: `a:${U(1)}`, type: 'annonce', le: '2026-11-12T09:00:00.000Z', titre: 'Le point de la semaine', extrait: null, qui: null,
    lien: `/academie/annonces#annonce-${U(1)}`, lue: false,
  })
  assert.equal(C.notifAnnonce({ id: U(1), publie_le: '2026-11-12T09:00:00Z', titre: 't', vue: true }).lue, true)
  assert.equal(C.notifAnnonce({ id: 'x', publie_le: '2026-11-12T09:00:00Z', titre: 't', vue: false }), null)

  const s = C.notifSalon({ id: V(2), cree_le: '2026-11-13T08:00:00Z', texte: 'Oui, regarde la zone\nde la veille.', qui: 'Membre 1204' }, vide)
  assert.deepEqual(Object.keys(s).sort(), ['cle', 'extrait', 'le', 'lien', 'lue', 'qui', 'titre', 'type'])
  assert.equal(s.lien, `/academie/chat#m-${V(2)}`)
  assert.equal(s.extrait, 'Oui, regarde la zone de la veille.')
  assert.equal(s.titre, null)
  assert.equal(s.lue, false)

  const q = C.notifLecon({
    id: U(3), traitee_le: new Date('2026-11-13T07:00:00Z'), signature: 'Brice', reponse: 'Regarde la leçon 4.',
    lecon_titre: 'Épisode 9, Le timing idéal', lecon_slug: 'episode-9', module_slug: 'la-formation-complete',
  }, vide)
  assert.equal(q.lien, '/academie/la-formation-complete/episode-9#questions')
  assert.equal(q.qui, 'Brice')
  assert.equal(q.titre, 'Épisode 9, Le timing idéal')
  assert.equal(C.notifLecon({ id: U(3), traitee_le: '2026-11-13T07:00:00Z', signature: null, reponse: 'x', lecon_titre: 't', lecon_slug: 'l', module_slug: 'm' }, vide).qui, "L'équipe")
})

bloc('cloche : assembler (ordre, plafond, compteur)', () => {
  const vide = { lu_le: null, lues: [] }
  const n = i => C.notifSalon({ id: U(i), cree_le: new Date(Date.UTC(2026, 10, 1 + (i % 28), i % 24)).toISOString(), texte: 't', qui: 'q' }, vide)
  const beaucoup = Array.from({ length: 50 }, (_, i) => n(i + 1))
  const r = C.assembler([beaucoup, [null], [C.notifAnnonce({ id: U(99), publie_le: '2026-12-01T00:00:00Z', titre: 'z', vue: true })]])
  assert.equal(r.notifications.length, C.MAX_NOTIFICATIONS)
  assert.equal(r.notifications[0].cle, `a:${U(99)}`, 'la plus recente d\'abord')
  for (let i = 1; i < r.notifications.length; i++) assert.ok(r.notifications[i - 1].le >= r.notifications[i].le)
  assert.equal(r.non_lues, r.notifications.filter(x => !x.lue).length)
  assert.equal(r.non_lues, C.MAX_NOTIFICATIONS - 1)
})

bloc('cloche : le corps du POST', () => {
  assert.deepEqual(C.lireDemandeCloche({ tout: true }), { tout: true })
  assert.deepEqual(C.lireDemandeCloche({ lues: [`A:${U(1)}`.toLowerCase(), ` c:${V(1)} `, `c:${V(1)}`] }), { lues: [`a:${U(1)}`, `c:${V(1)}`] })
  assert.equal(C.lireDemandeCloche({}), null)
  assert.equal(C.lireDemandeCloche({ tout: 'oui' }), null)
  assert.equal(C.lireDemandeCloche({ lues: [] }), null)
  assert.equal(C.lireDemandeCloche({ lues: ['x:1'] }), null)
  assert.equal(C.lireDemandeCloche({ lues: [`c:${V(1)}`, 'pas une cle'] }), null, 'une seule mauvaise cle : refus')
  assert.equal(C.lireDemandeCloche({ lues: Array.from({ length: C.MAX_CLES + 1 }, (_, i) => `c:${U(i)}`) }), null)
  assert.equal(C.lireDemandeCloche(null), null)
  assert.equal(C.lireDemandeCloche([`c:${V(1)}`]), null)
  assert.deepEqual(C.annoncesDe({ lues: [`a:${U(1)}`, `c:${V(1)}`, `a:${U(2)}`] }), [U(1), U(2)])
  assert.deepEqual(C.annoncesDe({ tout: true }), [])
  assert.equal(C.toucheLaMarque({ tout: true }), true)
  assert.equal(C.toucheLaMarque({ lues: [`a:${U(1)}`] }), false, 'une annonce seule ne touche pas la marque')
  assert.equal(C.toucheLaMarque({ lues: [`a:${U(1)}`, `q:${U(2)}`] }), true)
})

bloc('cloche : la marque apres un clic ou « tout marquer lu »', () => {
  const maintenant = '2026-11-13T12:00:00.000Z'
  const marque = { lu_le: '2026-11-10T00:00:00.000Z', lues: ['q000000000000', 'cffffffffffff'] }
  assert.deepEqual(C.nouvelleMarque(marque, { tout: true }, [], maintenant), { lu_le: maintenant, lues: [] })
  const courantes = [
    C.notifSalon({ id: V(5), cree_le: '2026-11-12T00:00:00Z', texte: 't', qui: 'q' }, marque),
    C.notifLecon({ id: U(1), traitee_le: '2026-11-11T00:00:00Z', signature: 'B', reponse: 'r', lecon_titre: 't', lecon_slug: 'l', module_slug: 'm' }, marque),
    C.notifSalon({ id: W(6), cree_le: '2026-11-09T00:00:00Z', texte: 't', qui: 'q' }, marque),
  ]
  assert.equal(courantes[2].lue, true, 'plus ancienne que lu_le : deja lue')
  const r = C.nouvelleMarque(marque, { lues: [`c:${V(5)}`, `c:${W(6)}`, `a:${U(9)}`] }, courantes, maintenant)
  assert.equal(r.lu_le, marque.lu_le, 'un clic ne bouge pas lu_le')
  // V(5) cliquee et vivante ; W(6) deja couverte par lu_le (inutile) ; q000.. garde (vivante) ; cfff.. partie (plus dans la fenetre).
  assert.deepEqual(r.lues, ['c1a2b3c4d5e6f', 'q000000000000'])
  const plein = Array.from({ length: 60 }, (_, i) => C.notifSalon({ id: W(100 + i), cree_le: '2026-11-12T00:00:00Z', texte: 't', qui: 'q' }, { lu_le: null, lues: [] }))
  const r2 = C.nouvelleMarque({ lu_le: null, lues: [] }, { lues: plein.slice(0, 50).map(x => x.cle) }, plein, maintenant)
  assert.equal(r2.lues.length, C.MAX_LUES)
  assert.equal(new Set(r2.lues).size, C.MAX_LUES)
  assert.ok(JSON.stringify(r2).length < 700, 'la marque reste petite dans le jeton du compte')
})

bloc('cloche : les requetes (fenetre, compte, masques, moi-meme)', () => {
  assert.match(C.SQL_REPONSES_SALON, /r\.masque_le is null/)
  assert.match(C.SQL_REPONSES_SALON, /r\.user_id <> \$1::uuid/)
  assert.match(C.SQL_REPONSES_SALON, /aok_chat_vue\(r\.id, \$2\)/)
  assert.match(C.SQL_REPONSES_LECONS, /q\.user_id = \$1::uuid/)
  assert.match(C.SQL_REPONSES_LECONS, /statut in \('publiee', 'privee'\)/)
  assert.match(C.SQL_ANNONCES_CLOCHE, /l\.statut = 'publie' and m\.statut = 'publie'/)
  assert.match(C.SQL_ANNONCES_TOUTES_VUES, /on conflict \(billet_id, user_id\) do nothing/)
  for (const s of [C.SQL_REPONSES_SALON, C.SQL_REPONSES_LECONS, C.SQL_ANNONCES_CLOCHE]) {
    assert.ok(!/select \*/.test(s))
    assert.ok(!/email/i.test(s), 'aucun email lu')
  }
})

// ---------------------------------------------------------------------------
// La recherche
// ---------------------------------------------------------------------------

bloc('recherche : les mots cherches', () => {
  assert.equal(R.normaliser('Élève À LA Fenêtre'), 'eleve a la fenetre')
  assert.deepEqual(R.termesDe("  L'Ordre   Block  "), ['ordre', 'block'])
  assert.deepEqual(R.termesDe('order-block FVG fvg'), ['order', 'block', 'fvg'])
  assert.deepEqual(R.termesDe('épisode 9'), ['episode', '9'])
  assert.deepEqual(R.termesDe('Plan de trading'), ['plan', 'trading'], 'sans les mots vides')
  assert.deepEqual(R.termesDe('de la'), ['de', 'la'], 'que des mots vides : on les garde')
  assert.deepEqual(R.motsDe("Plan de l'ordre"), ['plan', 'de', 'l', 'ordre'])
  assert.deepEqual(R.termesDe('a b c'), [])
  assert.deepEqual(R.termesDe(''), [])
  assert.equal(R.termesDe('un deux trois quatre cinq six sept huit').length, R.MAX_TERMES)
  assert.ok(R.termesDe('x'.repeat(200)).every(t => t.length <= R.MAX_Q))
})

bloc('recherche : le Markdown en texte brut', () => {
  const md = [
    '# Le titre', '', '![Image 1](/media/x.webp)', 'Un [lien](https://x.fr) et du **gras**, du _penche_ et `code`.',
    '- une puce', '1. un point', ':::note', '<iframe src="x"></iframe>', '> une citation', '| a | b |',
  ].join('\n')
  const t = R.texteBrut(md)
  assert.equal(t, 'Le titre Un lien et du gras, du penche et code. une puce un point une citation a b')
  assert.equal(R.texteBrut(null), '')
})

bloc('recherche : extraits et positions (accents, caractere combinant)', () => {
  const brut = `${'Début du texte. '.repeat(12)}Ici la zone de liquidité est prise avant l'ouverture. ${'Suite du texte. '.repeat(20)}`
  const t = R.indexer(brut)
  assert.equal(t.carte, null, 'des accents seuls ne changent pas la longueur')
  const e = R.extraitAutour(t, ['liquidite'], 'liquidite')
  assert.ok(e.includes('liquidité'), e)
  assert.ok(e.startsWith('…') && e.endsWith('…'))
  assert.ok(e.length <= R.LARGEUR_EXTRAIT + 2)
  // Un e suivi d'un accent combinant isole : la normalisation raccourcit, la carte garde la position.
  const brut2 = `Avant étrange ${'x '.repeat(40)}la cible est ici`
  const t2 = R.indexer(brut2)
  assert.ok(t2.carte instanceof Int32Array)
  const e2 = R.extraitAutour(t2, ['cible'], 'cible')
  assert.ok(e2.includes('la cible est ici'), e2)
  // Phrase entiere preferee au premier mot seul.
  const t3 = R.indexer(`ordre seul ici. ${'bla '.repeat(60)}un order block propre. ${'bla '.repeat(10)}`)
  assert.ok(R.extraitAutour(t3, ['order', 'block'], 'order block').includes('order block propre'))
  assert.equal(R.extraitAutour(R.indexer('rien'), ['zzz'], 'zzz'), null)
})

function jeu() {
  const modules = [
    { id: 'm1', slug: 'la-formation-complete', titre: 'La Formation complète', resume: 'Toute la méthode, de la liquidité au plan.', ordre: 3, lienExterne: null },
    { id: 'm2', slug: 'psychologie-et-emotions', titre: 'Psychologie et émotions', resume: 'Le mental du trader.', ordre: 10, lienExterne: null },
    { id: 'm3', slug: 'bienvenue', titre: 'Bienvenue', resume: 'Par où commencer.', ordre: 0, lienExterne: null },
  ]
  const lecons = [
    { id: 'l1', moduleId: 'm1', slug: 'episode-9', titre: 'Épisode 9, Le timing idéal', type: 'video', dureeS: 1865, ordre: 9, section: 'Partie 2' },
    { id: 'l2', moduleId: 'm1', slug: 'episode-4', titre: 'Épisode 4, La liquidité', type: 'video', dureeS: 1200, ordre: 4, section: null },
    { id: 'l3', moduleId: 'm2', slug: 'la-peur', titre: 'Gérer ses émotions', type: 'texte', dureeS: null, ordre: 1, section: null },
    { id: 'l4', moduleId: 'm3', slug: 'demarrer', titre: 'Démarrer ici', type: 'texte', dureeS: null, ordre: 1, section: null },
  ]
  const textes = new Map([
    ['l1', R.indexer('Le timing compte plus que tout. On attend que la liquidité soit prise avant d\'entrer.')],
    ['l2', R.indexer('La liquidité se trouve au-dessus des sommets et sous les creux.')],
    ['l3', R.indexer('La peur de rater le mouvement pousse à entrer trop tôt. Respire.')],
    ['l4', R.indexer('Commence par la liquidité, puis le reste.')],
  ])
  return { modules, lecons, textes }
}

bloc('recherche : les acces (fermee = titre et cadenas, sans contenu)', () => {
  const { modules, lecons, textes } = jeu()
  const ouverture = l => (l.moduleId === 'm3' ? { acces: 'ouvert', raisons: ['compte'] } : l.id === 'l2' ? { acces: 'ouvert', raisons: ['apercu'] } : { acces: 'ferme', raisons: [] })
  const membre = R.chercher({ q: 'liquidité', modules, lecons, textes, ouverture, extraitPermis: () => true })
  const tout = membre.modules.flatMap(m => m.lecons)
  const l1 = tout.find(l => l.slug === 'episode-9')
  assert.equal(l1.acces, 'ferme')
  assert.equal(l1.extrait, null, 'une lecon fermee ne sort jamais son texte')
  assert.deepEqual(l1.ou, ['texte'])
  assert.deepEqual(Object.keys(l1).sort(), ['acces', 'duree_s', 'extrait', 'ou', 'section', 'slug', 'titre', 'type'])
  assert.ok(tout.find(l => l.slug === 'demarrer').extrait.includes('liquidité'))
  assert.ok(!JSON.stringify(membre).includes('avant d\'entrer'), 'rien du texte de la lecon fermee, nulle part')
  // Visiteur : pas d'extrait, sauf l'apercu.
  const visiteur = R.chercher({ q: 'liquidité', modules, lecons, textes, ouverture, extraitPermis: o => o.raisons.includes('apercu') })
  const tv = visiteur.modules.flatMap(m => m.lecons)
  assert.equal(tv.find(l => l.slug === 'demarrer').extrait, null)
  assert.ok(tv.find(l => l.slug === 'episode-4').extrait.includes('liquidité'))
})

bloc('recherche : correspondance, classement, module', () => {
  const { modules, lecons, textes } = jeu()
  const ouvert = () => ({ acces: 'ouvert', raisons: ['admin'] })
  const r = R.chercher({ q: 'liquidite', modules, lecons, textes, ouverture: ouvert, extraitPermis: () => true })
  assert.equal(r.total, 3)
  assert.equal(r.modules[0].slug, 'la-formation-complete', 'le module dont le resume parle de liquidite, et un titre')
  assert.equal(r.modules[0].correspond, true)
  assert.equal(r.modules[0].lecons[0].slug, 'episode-4', 'le titre passe avant le texte')
  assert.deepEqual(r.modules[0].lecons[0].ou, ['titre', 'texte'])
  // Un mot dans le titre du module, l'autre dans la lecon.
  const p = R.chercher({ q: 'psychologie peur', modules, lecons, textes, ouverture: ouvert, extraitPermis: () => true })
  assert.equal(p.total, 1)
  assert.equal(p.modules[0].lecons[0].slug, 'la-peur')
  // Le titre du module seul ne suffit pas a une lecon.
  const q = R.chercher({ q: 'psychologie', modules, lecons, textes, ouverture: ouvert, extraitPermis: () => true })
  assert.equal(q.total, 0)
  assert.equal(q.modules.length, 1)
  assert.equal(q.modules[0].correspond, true)
  assert.deepEqual(q.modules[0].lecons, [])
  // Rien.
  const z = R.chercher({ q: 'zzz introuvable', modules, lecons, textes, ouverture: ouvert, extraitPermis: () => true })
  assert.deepEqual(z, { termes: ['zzz', 'introuvable'], total: 0, modules: [] })
  assert.deepEqual(R.chercher({ q: ' ', modules, lecons, textes, ouverture: ouvert, extraitPermis: () => true }).modules, [])
})

bloc('recherche : plafonds (par module, en tout)', () => {
  const modules = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, slug: `m${i}`, titre: `Module ${i}`, resume: null, ordre: i, lienExterne: null }))
  const lecons = []
  const textes = new Map()
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 10; k++) {
      lecons.push({ id: `l${i}-${k}`, moduleId: `m${i}`, slug: `l${k}`, titre: `Lecon ${k}`, type: 'texte', dureeS: null, ordre: k, section: null })
      textes.set(`l${i}-${k}`, R.indexer('un fair value gap ici'))
    }
  }
  const r = R.chercher({ q: 'fair value gap', modules, lecons, textes, ouverture: () => ({ acces: 'ouvert', raisons: [] }), extraitPermis: () => true })
  assert.equal(r.total, 120)
  assert.ok(r.modules.every(m => m.n === 10 && m.lecons.length <= R.MAX_PAR_MODULE))
  assert.equal(r.modules.reduce((s, m) => s + m.lecons.length, 0), R.MAX_LECONS)
})

bloc('recherche : la requete des textes (lisibles seulement)', () => {
  assert.match(R.SQL_TEXTES_LECONS, /m\.statut = 'publie' and l\.statut = 'publie'/)
})

console.log(`\n${blocs} blocs ok`)
