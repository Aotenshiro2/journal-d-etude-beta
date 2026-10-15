// Verification locale de la FICHE D'UNE PERSONNE (outil fiche_personne de
// l'agent du Cockpit, passe 2 du chantier « noms et paroles des membres »,
// 15/10/2026) : les regles PURES de src/lib/fiche-personne-pur.ts, puis un
// controle statique du perimetre (qui importe la fiche, qui lit les messages
// des groupes). Aucune base, aucun reseau, aucun modele.
// Lancement : node scripts/verifier-fiche-personne.mjs

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  ACCENTS, SANS_ACCENTS, MIN_TEXTE, MAX_QUI, MAX_CANDIDATS, BUDGET_FICHE, PALIERS, SEUIL_MARQUANT,
  normaliser, echapperLike, lireQui, grouper, idsDuGroupe, libelleNoeud, phrasesTrouvePar,
  listerCandidats, reponseCandidats, reponseAucun, nomsSuccessifs, lireMotifs, choisirMessages,
  choisirParoles, couper, composerFiche, fichePourAgent, ficheVide, lireMessagesJson,
} from '../src/lib/fiche-personne-pur.ts'

let n = 0
const test = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

// --- Fabrique de donnees -----------------------------------------------------

const T0 = Date.parse('2026-09-01T08:00:00Z')
const HEURE = 3600 * 1000
let idMsg = 1000
function message(texte, { heures = 0, sujet = 'Bla-bla', media = null, longueur = null } = {}) {
  idMsg++
  return {
    chat_id: -1001930901866, message_id: idMsg, groupe: 'Live club', sujet,
    le: new Date(T0 + heures * HEURE).toISOString().slice(0, 16).replace('T', ' '), t: T0 + heures * HEURE,
    texte, longueur: longueur ?? (texte ? texte.length : 0), a_media: media !== null, type_media: media,
  }
}

const DEPART_FRED = 'Bonsoir les amis \nJuste un petit mot pour vous dire que je quitte le groupe pour l' + String.fromCharCode(0x2019) + ' instant, '
  + 'rien a voir avec la qualite ni les personnes, vous etes super. Mais le boulot me rattrape, mes trois plus gros mois '
  + 'de l annee, donc pas assez de temps pour suivre et participer. Je reviendrai sans doute. Je continue a vous suivre '
  + 'sur le groupe public. Pleine reussite a vous, vous allez tout dechirer. Merci a @melmom et @brice pour leurs '
  + 'apprentissages et explications. A bientot !'

function donnees({ messages = [], noms = [], vies = [], paroles = [], support = [], notes = [], gestes = [] } = {}) {
  return {
    trouvePar: ['nom Telegram « Fred trader » (exact)'],
    telegram: [1644619224],
    liens: ['u1644619224 et membre:m-1 : rattachement metricgram'],
    liensProbables: [],
    identite: {
      noms: noms.length ? noms : [{ telegram_id: 1644619224, pseudo: 'fredtrader1973', nom_affiche: 'Fred trader', premier_vu: '2026-10-15 13:43', dernier_vu: '2026-10-15 13:43', source: 'groupe' }],
      registre: [{ compte: 'u1644619224', present: true }],
      membres: [{ membre_id: 'm-1', nom: 'Frederic B.', abonnement_en_cours: true }],
      emails: [], archive: [],
    },
    liveClub: {
      abonnements: [{ statut: 'active', offre_id: 'live-club' }], exemptions: [], acces_broker: [], tarifs_reserves: [],
      acces_manuel: [], etm: [], rattachements: [{ compte: 'u1644619224', source: 'metricgram' }], gestes_total: gestes.length, gestes,
    },
    archive: { vies, themes: [{ theme: 'Payout', mentions: 8 }], paroles },
    notes,
    messages: { total: messages.length, par_groupe: [{ groupe: 'Live club', messages: messages.length }], par_sujet: [], liste: messages },
    support,
    oublis: [],
  }
}

// --- 1. Lire « qui » -----------------------------------------------------------

test('qui : numero Telegram, fiche membre, archive, email, pseudo, nom', () => {
  assert.deepEqual(lireQui('u1644619224'), { genre: 'telegram', id: 1644619224 })
  assert.deepEqual(lireQui(' 1644619224 '), { genre: 'telegram', id: 1644619224 })
  assert.deepEqual(lireQui({ qui: 'U1644619224' }), { genre: 'telegram', id: 1644619224 })
  assert.deepEqual(lireQui('membre:100E74DD-25d9-47fb-9dbf-5a310ea89f84'), { genre: 'membre', id: '100e74dd-25d9-47fb-9dbf-5a310ea89f84' })
  assert.deepEqual(lireQui('100e74dd-25d9-47fb-9dbf-5a310ea89f84'), { genre: 'membre', id: '100e74dd-25d9-47fb-9dbf-5a310ea89f84' })
  assert.deepEqual(lireQui('p-fred-trader'), { genre: 'archive', id: 'p-fred-trader' })
  assert.deepEqual(lireQui('archive:p-fred-trader'), { genre: 'archive', id: 'p-fred-trader' })
  assert.deepEqual(lireQui('Fred@Exemple.FR'), { genre: 'email', email: 'fred@exemple.fr' })
  // Un @pseudo : l'arobase tombe, la recherche porte sur tous les champs de nom.
  assert.deepEqual(lireQui('@fredtrader1973'), { genre: 'texte', brut: 'fredtrader1973', exact: 'fredtrader1973', motif: '%fredtrader1973%' })
  // Un ancien nom, accents et casse ignores, espaces resserres.
  assert.deepEqual(lireQui('  Frédéric   Bosco '), { genre: 'texte', brut: 'Frédéric Bosco', exact: 'frederic bosco', motif: '%frederic bosco%' })
  // Les jokers de LIKE sont echappes : « 100% » ne veut pas dire « tout ».
  assert.equal(lireQui('100%_x').motif, '%100\\%\\_x%')
  assert.equal(echapperLike('a\\b'), 'a\\\\b')
})

test('qui : refus clairs (vide, trop court, trop long)', () => {
  for (const x of [undefined, null, '', '   ', 42, {}, { qui: 3 }]) assert.ok('erreur' in lireQui(x), String(x))
  assert.match(lireQui('ab').erreur, /trop court/)
  assert.equal(MIN_TEXTE, 3)
  assert.match(lireQui('x'.repeat(MAX_QUI + 1)).erreur, /trop long/)
  // Un nombre trop court n'est pas un numero Telegram : c'est un texte.
  assert.equal(lireQui('1234').genre, 'texte')
})

test('normalisation : la meme table que translate() cote SQL', () => {
  assert.equal(ACCENTS.length, SANS_ACCENTS.length)
  assert.equal([...ACCENTS].length, ACCENTS.length)
  assert.equal(normaliser('Frédéric ÉLÈVE Çà'), 'frederic eleve ca')
  assert.equal(normaliser('Noël Müller Ñandú'), 'noel muller nandu')
})

// --- 2. Qui est qui -----------------------------------------------------------

test('groupes : seuls les liens CERTAINS reunissent, transitivement', () => {
  const touches = [
    { noeud: 'tg:1644619224', champ: 'nom Telegram', valeur: 'Fred trader', exact: true },
    { noeud: 'archive:p-fred-trader', champ: 'archive (nom)', valeur: 'Fred trader', exact: true },
  ]
  const liens = [
    { a: 'tg:1644619224', b: 'membre:m-1', nature: 'rattachement metricgram', certain: true },
    { a: 'tg:1644619224', b: 'archive:p-fred-trader', nature: 'même compte Telegram dans l\'archive', certain: true },
    // Second telephone de la meme fiche : rejoint par la fiche, sans etre touche.
    { a: 'tg:777000111', b: 'membre:m-1', nature: 'rattachement bot', certain: true },
    // Un lien par le nom : dit, jamais suivi.
    { a: 'archive:p-fred-trader', b: 'membre:m-2', nature: 'archive rapprochée par nom', certain: false },
  ]
  const g = grouper(touches, liens)
  assert.equal(g.length, 1)
  assert.deepEqual(g[0].noeuds, ['tg:1644619224', 'tg:777000111', 'membre:m-1', 'archive:p-fred-trader'])
  assert.equal(g[0].certains.length, 3)
  assert.equal(g[0].probables.length, 1)
  assert.ok(!g[0].noeuds.includes('membre:m-2'))
  assert.deepEqual(idsDuGroupe(g[0]), { telegram: [1644619224, 777000111], membres: ['m-1'], archives: ['p-fred-trader'] })
  assert.equal(libelleNoeud(g[0].noeuds[0]), 'u1644619224')
  assert.equal(libelleNoeud('membre:m-1'), 'membre:m-1')
  assert.equal(libelleNoeud('archive:p-x'), 'p-x')
})

test('groupes : un nom commun a deux personnes donne deux candidats, meme reliees par un lien probable', () => {
  const touches = [
    { noeud: 'membre:m-2', champ: 'fiche membre', valeur: 'Fred Antoine', exact: true },
    { noeud: 'archive:p-muet-fredantoine', champ: 'archive (nom)', valeur: 'Fred Antoine', exact: true },
  ]
  const liens = [{ a: 'archive:p-muet-fredantoine', b: 'membre:m-2', nature: 'archive rapprochée par nom', certain: false }]
  const g = grouper(touches, liens)
  assert.equal(g.length, 2)
  assert.ok(g.every((x) => x.probables.length === 1 && x.noeuds.length === 1))
  // L'ordre ne depend pas de l'ordre des entrees.
  assert.deepEqual(grouper([...touches].reverse(), liens).map((x) => x.noeuds[0]), g.map((x) => x.noeuds[0]))
  // Un lien qui ne touche aucun noeud trouve n'invente pas de personne.
  assert.equal(grouper(touches, [{ a: 'tg:1', b: 'membre:zz', nature: 'x', certain: true }]).length, 2)
  assert.equal(grouper([], liens).length, 0)
})

test('candidats : le plus vivant d\'abord, au plus 10, sans choisir', () => {
  const groupes = []
  for (let i = 1; i <= 14; i++) groupes.push({ noeuds: [`archive:p-fred-${i}`], touches: [{ noeud: `archive:p-fred-${i}`, champ: 'archive (nom)', valeur: `Fred ${i}`, exact: i === 5 }], certains: [], probables: [] })
  groupes.push({
    noeuds: ['tg:1644619224', 'membre:m-1'],
    touches: [{ noeud: 'tg:1644619224', champ: 'nom Telegram', valeur: 'Fred trader', exact: false }],
    certains: [], probables: [{ a: 'membre:m-1', b: 'archive:p-x', nature: 'archive rapprochée par nom', certain: false }],
  })
  const stats = {
    messages: { 1644619224: { n: 107, dernier: '2026-10-15' } },
    present: { 1644619224: true },
    noms: { 1644619224: { nom: 'Fred trader', pseudo: 'fredtrader1973' } },
    membres: { 'm-1': { nom: 'Frederic B.', abonnement_en_cours: true, dernier_paiement: '2026-09-19' } },
    archive: {},
  }
  const { total, candidats } = listerCandidats(groupes, stats)
  assert.equal(total, 15)
  assert.equal(candidats.length, MAX_CANDIDATS)
  assert.equal(candidats[0].identifiant, 'u1644619224')
  assert.equal(candidats[0].messages_depuis_30_08, 107)
  assert.equal(candidats[0].dans_le_groupe_live_club, true)
  assert.equal(candidats[0].abonnement_en_cours, true)
  assert.deepEqual(candidats[0].noms, ['Fred trader (@fredtrader1973), u1644619224', 'fiche membre « Frederic B. »'])
  assert.match(candidats[0].liens_probables[0], /PROBABLE/)
  // A egalite d'activite, la reponse exacte passe devant.
  assert.equal(candidats[1].identifiant, 'p-fred-5')
  const r = JSON.parse(reponseCandidats('Fred', groupes, stats))
  assert.equal(r.statut, 'plusieurs')
  assert.equal(r.autres, 5)
  assert.match(r.consigne, /Ne choisis pas/)
  assert.ok(!('fiche' in r) && !('identite' in r))
  const a = JSON.parse(reponseAucun('zz'))
  assert.equal(a.statut, 'aucun')
  assert.match(a.cherche_dans, /tous les noms passés/)
})

test('trouve par : exact d\'abord, sans doublon, trois au plus', () => {
  const t = [
    { noeud: 'tg:1', champ: 'registre du groupe', valeur: 'Fred trader', exact: false },
    { noeud: 'tg:1', champ: 'registre du groupe', valeur: 'Fred trader', exact: false },
    { noeud: 'tg:1', champ: 'nom Telegram', valeur: 'Fred', exact: true },
    { noeud: 'tg:1', champ: 'auteur de messages', valeur: 'Fred trader', exact: false },
    { noeud: 'tg:1', champ: 'pseudo Telegram', valeur: '@fred', exact: false },
  ]
  const p = phrasesTrouvePar(t)
  assert.equal(p.length, 3)
  assert.equal(p[0], 'nom Telegram « Fred » (exact)')
  assert.equal(new Set(p).size, 3)
})

// --- 3. Les noms successifs ----------------------------------------------------

test('noms successifs : Fred se renomme, l\'ancien nom reste connu et date', () => {
  const noms = [
    { telegram_id: 1644619224, pseudo: 'fredtrader1973', nom_affiche: 'Fred trader', premier_vu: '2026-10-15 13:43', dernier_vu: '2026-10-20 07:30', source: 'groupe' },
    { telegram_id: 1644619224, pseudo: 'fredtrader1973', nom_affiche: 'Fred l\'alchimiste', premier_vu: '2026-10-21 07:30', dernier_vu: '2026-11-02 07:30', source: 'groupe' },
    { telegram_id: 1644619224, pseudo: 'fred_alchimiste', nom_affiche: 'Fred l\'alchimiste', premier_vu: '2026-11-03 07:30', dernier_vu: '2026-11-03 07:30', source: 'prive' },
  ]
  const [c] = nomsSuccessifs(noms)
  assert.equal(c.compte, 'u1644619224')
  assert.deepEqual(c.actuel, { nom: 'Fred l\'alchimiste', pseudo: 'fred_alchimiste', vu_du: '2026-11-03', vu_au: '2026-11-03', source: 'prive' })
  assert.deepEqual(c.anciens.map((x) => [x.nom, x.pseudo, x.vu_du, x.vu_au]), [
    ['Fred l\'alchimiste', 'fredtrader1973', '2026-10-21', '2026-11-02'],
    ['Fred trader', 'fredtrader1973', '2026-10-15', '2026-10-20'],
  ])
  // Borne sur les anciens, et un compte par entree.
  assert.equal(nomsSuccessifs(noms, 1)[0].anciens.length, 1)
  assert.equal(nomsSuccessifs([...noms, { ...noms[0], telegram_id: 5 }]).length, 2)
})

// --- 4. Les messages marquants -------------------------------------------------

test('marquants : le message de depart de Fred porte ses cinq motifs', () => {
  const { motifs, score } = lireMotifs(DEPART_FRED, DEPART_FRED.length)
  assert.deepEqual(motifs.sort(), ['depart', 'difficulte', 'long', 'pause', 'remerciement'])
  assert.ok(score >= 15)
})

test('marquants : les mots-cles, sans faux positifs evidents', () => {
  const m = (t) => lireMotifs(t, t.length)
  assert.deepEqual(m('Bonne journee je pars bosser, a demain').motifs, [])
  // Calibre sur les vrais messages (15/10) : un retrait d'argent, l'adieu a un autre, une cassure.
  assert.deepEqual(m('il fallait que je retire mes gains avant le week-end').motifs, [])
  assert.deepEqual(m('Bonne continuation à toi et bon courage pour tes projets').motifs, [])
  assert.deepEqual(m('Joli break de structure sur le H1 ce matin').motifs, [])
  assert.deepEqual(m('Bonne continuation l\'équipe, le trading aura eu ma peau').motifs, ['depart'])
  assert.deepEqual(m('Je me désabonne, merci pour tout').motifs.sort(), ['abonnement', 'depart', 'remerciement'])
  // L'apostrophe typographique du telephone vaut l'apostrophe droite.
  assert.deepEqual(m('Bon, je m' + String.fromCharCode(0x2019) + 'en vais pour de bon').motifs, ['depart'])
  assert.deepEqual(m('merci Mel !').motifs, []) // trop court
  assert.deepEqual(m('Bonjour a tous, belle journee de trading').motifs, [])
  assert.deepEqual(m('Bonjour, je me présente : Paul, 34 ans, trader débutant').motifs, ['arrivee'])
  assert.deepEqual(m('Je vais mettre mon abonnement en pause le temps du déménagement').motifs.sort(), ['abonnement', 'pause'])
  assert.deepEqual(m('Un grand merci à vous deux pour tout ce que vous faites').motifs, ['remerciement'])
  assert.deepEqual(m('Je suis découragé, rien ne marche en ce moment').motifs, ['difficulte'])
  // La difficulte faible (une perte) existe mais ne suffit pas seule.
  const perte = m('Grosse perte ce matin sur le NQ, -300')
  assert.deepEqual(perte.motifs, ['difficulte'])
  assert.ok(perte.score < SEUIL_MARQUANT)
  // La longueur se lit sur le texte COMPLET, pas sur l'extrait.
  assert.deepEqual(lireMotifs('court', 900).motifs, ['long'])
  assert.equal(lireMotifs('court', 900).score, 4)
  assert.equal(lireMotifs(null, 0).score, 0)
})

test('marquants : recents a part, premiers, puis les meilleurs scores, dans l\'ordre des dates', () => {
  const liste = [
    message('Salut, premier message ici, ravi d\'etre la', { heures: 0 }),
    message('ok', { heures: 1 }),
    message('Grosse perte ce matin sur le NQ', { heures: 2 }),
    message(DEPART_FRED, { heures: 100 }),
    message('x'.repeat(320), { heures: 50 }),
    message(null, { heures: 101, media: 'photo' }),
    message('Je mets mon abonnement en pause', { heures: 60 }),
    message('a plus', { heures: 102 }),
    message('encore un', { heures: 103 }),
  ]
  const { recents, marquants } = choisirMessages(liste, 3, 10)
  assert.deepEqual(recents.map((x) => x.texte), ['encore un', 'a plus', null])
  // Deux premiers (un tiers des places au plus), puis les scores au-dessus du seuil.
  assert.deepEqual(marquants.map((x) => x.motifs[0]), ['premier', 'premier', 'long', 'pause', 'depart'])
  assert.ok(marquants.every((x, i) => i === 0 || marquants[i - 1].t <= x.t))
  // La perte (score 1) et « ok » ne sont pas marquants.
  assert.ok(!marquants.some((x) => x.texte === 'Grosse perte ce matin sur le NQ'))
  // Aucun message deux fois.
  const refs = [...recents, ...marquants].map((x) => x.message_id)
  assert.equal(new Set(refs).size, refs.length)
  // Peu de places : le depart (meilleur score) passe avant les premiers.
  const peu = choisirMessages(liste, 3, 2).marquants
  assert.equal(peu.length, 2)
  assert.ok(peu.some((x) => x.motifs.includes('depart')))
  assert.ok(!peu.some((x) => x.motifs.includes('premier')))
  // Rien : rien.
  assert.deepEqual(choisirMessages([], 6, 10), { recents: [], marquants: [] })
})

test('messages lus en JSON : champs nuls retires par la base, medias seuls compris', () => {
  const l = lireMessagesJson([
    { chat_id: -100, message_id: 5, groupe: 'Live club', le: '2026-10-13 19:34', t: 1, a_media: true, type_media: 'photo', longueur: 0 },
    { chat_id: -100, message_id: 6, groupe: 'Live club', sujet: 'Bla-bla', le: 'x', t: 2, texte: 'abc', longueur: 548, a_media: false },
    { message_id: 7 },
  ])
  assert.equal(l.length, 2)
  assert.deepEqual([l[0].texte, l[0].sujet, l[0].a_media, l[0].type_media], [null, null, true, 'photo'])
  assert.equal(l[1].longueur, 548)
  assert.deepEqual(lireMessagesJson(null), [])
})

// --- 5. La borne ----------------------------------------------------------------

test('borne : une fiche ordinaire tient au premier palier, sans rien couper', () => {
  const d = donnees({ messages: [message(DEPART_FRED, { heures: 10 }), message('salut', { heures: 11 })] })
  const s = fichePourAgent(d)
  assert.ok(s.length <= BUDGET_FICHE)
  const f = JSON.parse(s)
  assert.equal(f.statut, 'fiche')
  assert.equal(f.borne.palier, 0)
  assert.equal(f.borne.raccourcie, false)
  assert.deepEqual(f.identite.telegram, ['u1644619224'])
  assert.equal(f.messages.recents.length, 2)
  assert.equal(f.messages.recents[1].ref, '-1001930901866:' + d.messages.liste[0].message_id)
  // Coupe a 300 au premier palier pour un recent, longueur complete donnee.
  assert.ok(f.messages.recents[1].texte.endsWith('...'))
  assert.ok(f.messages.recents[1].texte.length <= PALIERS[0].texteRecent)
  assert.equal(f.messages.recents[1].longueur, DEPART_FRED.length)
})

test('borne : une fiche enorme est ramenee sous le budget, palier par palier, identite intacte', () => {
  const messages = []
  for (let i = 0; i < 400; i++) messages.push(message(`message numero ${i} ` + 'blabla '.repeat(200), { heures: i }))
  messages.push(message(DEPART_FRED, { heures: 1000 - 5 }))
  for (let i = 0; i < 6; i++) messages.push(message(`recent ${i}`, { heures: 1000 + i }))
  const longs = (k) => Array.from({ length: 20 }, (_, i) => ({ [k]: 'z'.repeat(2000), dit_le: `2026-0${1 + (i % 8)}-01`, rang: i % 3 ? 'long' : 'dernier' }))
  const support = [{ fil: 'f', app: 'telegram', nb_messages: 40, humain_demande_le: null, cree_le: null, maj_le: null, derniers: Array.from({ length: 10 }, () => ({ role: 'user', le: null, texte: 'y'.repeat(600) })) }]
  const d = donnees({
    messages, vies: longs('extrait'), paroles: longs('texte'), notes: longs('texte'), support,
    gestes: Array.from({ length: 12 }, () => ({ geste: 'rappel', details: 'd'.repeat(160) })),
  })
  const s = fichePourAgent(d)
  assert.ok(s.length <= BUDGET_FICHE, `taille ${s.length}`)
  const f = JSON.parse(s)
  assert.equal(f.borne.raccourcie, true)
  assert.ok(f.borne.palier > 0)
  assert.deepEqual(f.identite.telegram, ['u1644619224'])
  assert.equal(f.identite.noms_successifs[0].actuel.nom, 'Fred trader')
  assert.equal(f.messages.total, 407)
  // Le depart de Fred survit : c'est le meilleur score.
  assert.ok(f.messages.marquants.some((x) => (x.motifs ?? []).includes('depart')), JSON.stringify(f.borne))
  // Plus petit budget : d'autres sections tombent, jamais le JSON.
  for (const budget of [6000, 3000, 1500, 600]) {
    const r = fichePourAgent(d, budget)
    assert.ok(r.length <= budget, `budget ${budget} : ${r.length}`)
    assert.doesNotThrow(() => JSON.parse(r))
  }
  assert.ok(JSON.parse(fichePourAgent(d, 2000)).borne.retire.length > 0)
  // Un budget absurde : un JSON valide qui dit quoi faire, jamais une chaine coupee.
  assert.equal(JSON.parse(fichePourAgent(d, 50)).statut, 'fiche')
})

test('borne : chaque palier est plus petit que le precedent', () => {
  for (let i = 1; i < PALIERS.length; i++) {
    for (const [k, v] of Object.entries(PALIERS[i])) assert.ok(v <= PALIERS[i - 1][k], `${k} au palier ${i}`)
  }
  assert.equal(couper('abcdef', 6), 'abcdef')
  assert.equal(couper('abcdefgh', 6), 'abc...')
  assert.equal(couper(null, 5), null)
})

test('paroles d\'archive : les dernieres et les longues avant les premieres, puis par date', () => {
  const p = [
    { rang: 'premier', dit_le: '2026-06-19', texte: 'p' },
    { rang: 'long', dit_le: '2026-08-04', texte: 'l1' },
    { rang: 'dernier', dit_le: '2026-08-29', texte: 'd' },
    { rang: 'long', dit_le: '2026-07-30', texte: 'l2' },
  ]
  assert.deepEqual(choisirParoles(p, 3).map((x) => x.texte), ['l2', 'l1', 'd'])
  assert.deepEqual(choisirParoles(p, 0), [])
})

test('fiche vide : un numero qui n\'est nulle part donne « aucun »', () => {
  const vide = donnees()
  vide.identite = { noms: [], registre: [], membres: [], emails: [], archive: [] }
  vide.liveClub = { ...vide.liveClub, rattachements: [], gestes_total: 0 }
  assert.equal(ficheVide(vide), true)
  assert.equal(ficheVide({ ...vide, oublis: [{ compte: 'u1', oublie_le: '2026-10-15 10:00' }] }), false)
  assert.equal(ficheVide(donnees()), false)
  // Un compte efface a sa demande : la fiche le dit.
  const f = composerFiche({ ...donnees(), oublis: [{ compte: 'u1644619224', oublie_le: '2026-10-16 09:00' }] }, PALIERS[0])
  assert.equal(f.messages.effaces_a_sa_demande.length, 1)
})

// --- 6. Le perimetre : la fiche et les messages restent dans le cockpit ----------

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(RACINE, 'src')
function fichiers(dossier) {
  const r = []
  for (const e of readdirSync(dossier)) {
    const p = path.join(dossier, e)
    if (statSync(p).isDirectory()) r.push(...fichiers(p))
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) r.push(p)
  }
  return r
}
const TOUS = fichiers(SRC).map((p) => ({ rel: path.relative(RACINE, p).split(path.sep).join('/'), texte: readFileSync(p, 'utf8') }))
const importe = (texte, module) => new RegExp(`from ['"]@/lib/${module}['"]|from ['"]\\./${module}['"]|from ['"]\\.\\./${module}['"]`).test(texte)

test('perimetre : seul l\'agent du Cockpit importe la fiche, seul la fiche et l\'agent lisent les messages', () => {
  const fiche = TOUS.filter((f) => importe(f.texte, 'fiche-personne')).map((f) => f.rel)
  assert.deepEqual(fiche, ['src/lib/agent-cockpit.ts'])
  const messages = TOUS.filter((f) => f.texte.includes('cockpit_telegram_messages')).map((f) => f.rel).sort()
  assert.deepEqual(messages, ['src/lib/agent-cockpit.ts', 'src/lib/fiche-personne-pur.ts', 'src/lib/fiche-personne.ts'])
  // Le journal n'ecrit les noms que par la fonction, il ne les lit nulle part ailleurs.
  const lisentNoms = TOUS.filter((f) => /from\s+public\.cockpit_telegram_noms\b/.test(f.texte)).map((f) => f.rel)
  assert.deepEqual(lisentNoms, ['src/lib/fiche-personne.ts'])
})

test('perimetre : l\'agent n\'est servi qu\'a l\'equipe', () => {
  const agent = TOUS.filter((f) => importe(f.texte, 'agent-cockpit')).map((f) => f.rel).sort()
  assert.deepEqual(agent, ['src/app/api/cockpit/agent/route.ts', 'src/lib/agent-cockpit-telegram.ts'])
  const route = TOUS.find((f) => f.rel === 'src/app/api/cockpit/agent/route.ts').texte
  assert.match(route, /from public\.cockpit_allowlist where user_id/)
  // Le bot des membres ne passe a l'agent que les comptes de l'equipe.
  const bot = TOUS.find((f) => f.rel === 'src/lib/liveclub/bot-membre.ts').texte
  const corps = bot.slice(bot.indexOf('async function transmettreSiEquipe'))
  assert.ok(corps.indexOf('compteCockpitTelegram(') > 0)
  assert.ok(corps.indexOf('compteCockpitTelegram(') < corps.indexOf('traiterTexteAgentTelegram('))
  assert.match(corps, /if \(!compte\) return false/)
  // Les routes et les bots des membres ne touchent ni a la fiche, ni aux messages, ni au SQL de l'agent.
  const MEMBRES = /^src\/app\/api\/(support|mentorat|liveclub)\/|^src\/lib\/liveclub\/(agent-membre|prompt-membre|actions-membre|support-pont)\.ts$|^src\/lib\/(support-prompt|politique-information)\.ts$/
  const cotesMembres = TOUS.filter((f) => MEMBRES.test(f.rel))
  assert.ok(cotesMembres.length >= 8, `${cotesMembres.length} fichiers cote membres`)
  for (const f of cotesMembres) {
    for (const interdit of ['fiche-personne', 'fichePersonne', 'cockpit_telegram_messages', 'cockpit_telegram_noms', 'requete_sql', 'cockpit_arch_', 'agent-cockpit']) {
      assert.ok(!f.texte.includes(interdit), `${f.rel} contient ${interdit}`)
    }
  }
})

test('lecture seule : la fiche et requete_sql tournent en transaction READ ONLY', () => {
  const fiche = TOUS.find((f) => f.rel === 'src/lib/fiche-personne.ts').texte
  assert.match(fiche, /\$executeRawUnsafe\('set transaction read only'\)/)
  const agent = TOUS.find((f) => f.rel === 'src/lib/agent-cockpit.ts').texte
  const sql = agent.slice(agent.indexOf('async function executerSql'), agent.indexOf('const OUTILS'))
  const ro = sql.indexOf("'set transaction read only'")
  assert.ok(ro > 0 && ro < sql.indexOf('statement_timeout'), 'READ ONLY doit etre le premier ordre de la transaction')
  // L'outil est declare, et traite avant le repli SQL.
  assert.match(agent, /name: 'fiche_personne'/)
  assert.ok(agent.indexOf("bloc.name === 'fiche_personne'") < agent.indexOf('const resultat = await executerSql(sql)'))
  // Les deux tables sont au catalogue de requete_sql.
  assert.match(agent, /- cockpit_telegram_messages : /)
  assert.match(agent, /- cockpit_telegram_noms : /)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
