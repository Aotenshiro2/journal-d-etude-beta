// Le bloc « À contacter » du resume du matin (Brice, 18/10) : les membres dont
// une fenetre de contact s'est OUVERTE depuis le dernier resume, ni deja
// annonces ni marques « fait » au cockpit ; et la ligne « Bientôt », qui ne
// fait jamais partir le resume a elle seule. Fonctions pures de resume-pur.ts,
// aucune base, aucun reseau.
// node scripts/verifier-a-contacter.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  cleAnnonce, composerResume, detailAContacter, episodesAAnnoncer, ligneBientot, memoireAnnonces, RUBRIQUES_RESUME,
} from '../src/lib/liveclub/resume-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const membre = (id, motif, extra = {}) => ({
  membreId: id, cleEpisode: `a_risque:${motif}:${extra.date ?? '2026-10-10'}`, motif,
  prochainPrelevement: null, prochaineTentative: null, joursSilence: null, joursAnciennete: null, entree: null, ...extra,
})

bloc('avec memoire : seuls les episodes nouveaux, jamais un episode marque fait', () => {
  const a = membre('a', 'silence', { entree: '2026-10-16' })
  const b = membre('b', 'echec', { date: '2026-10' })
  const c = membre('c', 'accueil', { entree: '2026-10-18' })
  const d = membre('d', 'prelevement', { entree: '2026-10-18' })
  const annoncesAvant = [cleAnnonce('a', a.cleEpisode)]
  const traitees = new Set([cleAnnonce('d', d.cleEpisode)])
  const r = episodesAAnnoncer([a, b, c, d], { annoncesAvant, traitees, depuisJour: '2026-10-17' })
  assert.deepEqual(r.map(m => m.membreId), ['b', 'c'])
  // Ranges par fenetre : echec, prelevement, silence, accueil.
  const tous = episodesAAnnoncer([c, a, d, b], { annoncesAvant: [], traitees: new Set(), depuisJour: '2026-10-17' })
  assert.deepEqual(tous.map(m => m.motif), ['echec', 'prelevement', 'silence', 'accueil'])
  // Un nouvel episode du meme membre (il a reecrit puis s'est tu) : annonce de nouveau.
  const a2 = membre('a', 'silence', { date: '2026-10-20', entree: '2026-11-03' })
  assert.deepEqual(episodesAAnnoncer([a2], { annoncesAvant, traitees, depuisJour: '2026-11-02' }).map(m => m.membreId), ['a'])
})

bloc('sans memoire : les fenetres ouvertes apres le dernier resume, aucun echec', () => {
  const vieux = membre('v', 'silence', { entree: '2026-10-01' })
  const jourMeme = membre('j', 'accueil', { entree: '2026-10-17' })
  const neuf = membre('n', 'prelevement', { entree: '2026-10-18' })
  const echec = membre('e', 'echec', { date: '2026-10' })
  const r = episodesAAnnoncer([vieux, jourMeme, neuf, echec], { annoncesAvant: null, traitees: new Set(), depuisJour: '2026-10-17' })
  assert.deepEqual(r.map(m => m.membreId), ['n'])
  // Un tableau vide est une memoire (personne n'etait a contacter) : tout est nouveau.
  assert.equal(episodesAAnnoncer([vieux, echec], { annoncesAvant: [], traitees: new Set(), depuisJour: '2026-10-17' }).length, 2)
})

bloc('la memoire : episodes du jour plus les recents, sans doublon, triee', () => {
  const cles = ['m1::a_risque:silence:2026-10-02', 'm2::a_risque:echec:2026-10']
  const avant = [
    'm1::a_risque:silence:2026-10-02',
    'm3::a_risque:accueil:2026-09-20',
    'm4::a_risque:silence:2026-07-01',
    'm5::a_risque:echec:2026-08',
    'm6::a_risque:echec:2026-09',
    'n importe quoi',
  ]
  assert.deepEqual(memoireAnnonces(cles, avant, '2026-10-18'), [
    'm1::a_risque:silence:2026-10-02', 'm2::a_risque:echec:2026-10', 'm3::a_risque:accueil:2026-09-20', 'm6::a_risque:echec:2026-09',
  ])
  assert.deepEqual(memoireAnnonces([], null, '2026-10-18'), [])
})

bloc('le motif en clair, court, sans point final', () => {
  assert.equal(detailAContacter(membre('x', 'echec', { prochaineTentative: '2026-10-21' }), '2026-10-18'), 'paiement en échec, nouvelle tentative le 21 octobre 2026')
  assert.equal(detailAContacter(membre('x', 'echec'), '2026-10-18'), 'paiement en échec')
  assert.equal(detailAContacter(membre('x', 'prelevement', { prochainPrelevement: '2026-10-25' }), '2026-10-18'), 'prélèvement dans 7 jours, rien écrit depuis 30 j')
  assert.equal(detailAContacter(membre('x', 'prelevement', { prochainPrelevement: '2026-10-19' }), '2026-10-18'), 'prélèvement demain, rien écrit depuis 30 j')
  assert.equal(detailAContacter(membre('x', 'silence', { joursSilence: 15 }), '2026-10-18'), 'silencieux depuis 15 jours')
  assert.equal(detailAContacter(membre('x', 'accueil', { joursAnciennete: 6 }), '2026-10-18'), 'nouveau, pas encore un mot (arrivé il y a 6 j)')
})

bloc('la ligne Bientôt', () => {
  assert.equal(ligneBientot(0), null)
  assert.equal(ligneBientot(1), 'Bientôt : 1 membre entre dans une fenêtre cette semaine')
  assert.equal(ligneBientot(13), 'Bientôt : 13 membres entrent dans une fenêtre cette semaine')
})

bloc('le resume : « À contacter » suffit a envoyer, « Bientôt » jamais seul', () => {
  const o = { depuis: '2026-10-17T07:00:00Z', jusqua: '2026-10-18T07:00:00Z', bientot: 4 }
  const personnes = new Map([['mA', { nom: 'X', email: null, pseudo: 'x', telegramId: null }]])
  // Rien : pas d'envoi, meme avec des membres « bientôt ».
  assert.equal(composerResume([], personnes, o), null)
  // Une demande d'humain ancienne seule : pas d'envoi non plus.
  const ancienne = { rubrique: 'humains', qui: 't1', detail: 'attend', quand: '2026-10-10T00:00:00Z', ancien: true }
  assert.equal(composerResume([ancienne], personnes, o), null)
  // Un membre a contacter : le resume part, la ligne Bientôt en pied.
  const contact = { rubrique: 'contacter', qui: 'mA', detail: 'silencieux depuis 15 jours', quand: '2026-10-18T00:00:00Z' }
  const texte = composerResume([contact, ancienne], personnes, o)
  assert.ok(texte)
  assert.match(texte, /\n\nÀ contacter\n- X, @x : silencieux depuis 15 jours\n\nDemandes d'humain en attente\n/)
  assert.ok(texte.endsWith('\n\nBientôt : 4 membres entrent dans une fenêtre cette semaine'))
  // Sans membres a venir : pas de pied.
  assert.ok(!composerResume([contact], personnes, { ...o, bientot: 0 }).includes('Bientôt'))
  // La rubrique vient juste avant les demandes d'humain.
  const cles = RUBRIQUES_RESUME.map(r => r.cle)
  assert.equal(cles.indexOf('contacter') + 1, cles.indexOf('humains'))
})

bloc('le serveur lit les deux vues, garde la memoire, ne logue aucun nom', () => {
  const source = readFileSync(new URL('../src/lib/liveclub/resume.ts', import.meta.url), 'utf8')
  assert.match(source, /from public\.cockpit_membres_risque/)
  assert.match(source, /from public\.cockpit_membres_a_venir/)
  assert.match(source, /from public\.cockpit_actions_traitees where motif like 'a_risque:%'/)
  assert.match(source, /risque_annonces/)
  // Vue illisible : la memoire du repere est gardee (sinon tout serait reannonce le lendemain).
  assert.match(source, /: repere\?\.annonces \?\? null/)
  for (const ligne of source.split('\n').filter(l => /console\.(log|warn)/.test(l))) {
    assert.ok(!/\b(nom|email|telegram|pseudo)\b/.test(ligne.replace(/\[liveclub\/resume\][^`']*/, '')), `log suspect : ${ligne.trim()}`)
  }
  // La cle de l'episode est celle du bouton « Fait » du cockpit.
  const atraiter = new URL('../../cockpit/src/views/membres/ATraiter.tsx', import.meta.url)
  if (existsSync(atraiter)) {
    assert.match(readFileSync(atraiter, 'utf8'), /cleTraitee = \(membreId: string, motif: string\) => `\$\{membreId\}::\$\{motif\}`/)
    assert.equal(cleAnnonce('m', 'a_risque:silence:2026-10-02'), 'm::a_risque:silence:2026-10-02')
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
