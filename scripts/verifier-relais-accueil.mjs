// Le RELAIS D'ACCUEIL du Live Club (Brice, 24/10) : le bot des membres envoie
// chaque jour a Alex les membres a qui dire un mot. Fonctions pures de
// relais-pur.ts et resume-pur.ts, plus quelques controles du source. Aucune
// base, aucun reseau.
// node scripts/verifier-relais-accueil.mjs
function serveurFiche() {
  const t = readFileSync(new URL('../src/lib/liveclub/relais.ts', import.meta.url), 'utf8')
  return t.slice(t.indexOf('export async function ficheMembrePourRelais'), t.indexOf("// Le bouton « C'est fait »"))
}
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clavierApresFait, compteAJoindre, dataBoutonRelais, decisionBoutonRelais, estBoutonRelais, LIGNES_PAR_MESSAGE,
  lignesPourRelais, lireBoutonRelais, messagesRelais, motifEnClair, motifsDuRelais, NOTE_BOT_MEMBRES, NOTE_SANS_PSEUDO, noteMarqueRelais,
  pseudoPropre, textePresentation, TITRE_RETARD,
} from '../src/lib/liveclub/relais-pur.ts'
import {
  cleAnnonce, composerResume, detailAContacter, detailAvecRelais, episodesAAnnoncer, pseudoCroise, relaisParEpisode,
} from '../src/lib/liveclub/resume-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

const ALEX = 2110821350
const alex = { telegramId: ALEX, nom: 'Alex', motifs: ['accueil', 'silence'], presenteLe: null }
const compte = (id, extra = {}) => ({ telegramId: id, pseudo: `membre${id}`, nomAffiche: `Membre ${id}`, present: true, statutTg: 'member', ...extra })
const candidat = (id, motif, extra = {}) => ({
  membreId: `m${id}`, cleEpisode: `a_risque:${motif}:${extra.date ?? '2026-10-10'}`, motif,
  joursSilence: motif === 'silence' ? 16 : null, joursAnciennete: motif === 'accueil' ? 6 : null,
  entree: extra.entree ?? '2026-10-20', nomFiche: `Fiche ${id}`, comptes: [compte(id)], ...extra,
})
const vide = { equipe: new Set(), exemptes: new Set(), relais: new Set([ALEX]) }
const sans = { traitees: new Set(), dejaTransmis: new Set() }
const ids = (lignes) => lignes.map(l => l.membreId)

bloc('motifs : accueil et silence seulement, jamais echec ni prelevement', () => {
  assert.deepEqual(motifsDuRelais(['echec', 'prelevement', 'silence', 'accueil', 'silence', 'autre']), ['accueil', 'silence'])
  assert.deepEqual(motifsDuRelais(null), [])
  const tous = [candidat(1, 'echec', { date: '2026-10' }), candidat(2, 'prelevement'), candidat(3, 'silence'), candidat(4, 'accueil')]
  // Meme un relais mal configure (motifs forces a la main) ne recoit jamais un paiement.
  const force = { ...alex, motifs: ['echec', 'prelevement', 'accueil', 'silence'] }
  assert.deepEqual(ids(lignesPourRelais(tous, force, vide, sans)), ['m4', 'm3'])
  // Un relais limite au silence.
  assert.deepEqual(ids(lignesPourRelais(tous, { ...alex, motifs: ['silence'] }, vide, sans)), ['m3'])
  // Une cle qui ne dit pas la meme fenetre que le motif est ecartee.
  assert.deepEqual(lignesPourRelais([{ ...candidat(5, 'silence'), cleEpisode: 'a_risque:echec:2026-10' }], alex, vide, sans), [])
  // Le source ne lit que ces deux fenetres dans la vue.
  const source = readFileSync(new URL('../src/lib/liveclub/relais.ts', import.meta.url), 'utf8')
  assert.match(source, /from public\.cockpit_membres_risque\s+where motif in \('accueil', 'silence'\)/)
  const migration = readFileSync(new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261024120000_cockpit_liveclub_relais.sql', import.meta.url), 'utf8')
  assert.match(migration, /motifs <@ array\['accueil', 'silence'\]::text\[\]/)
  assert.match(migration, /check \(motif in \('accueil', 'silence'\)\)/)
})

bloc('exclusions : equipe, admins, exemptes, relais, hors groupe', () => {
  const equipe = candidat(10, 'silence')
  const admin = candidat(11, 'silence', { comptes: [compte(11, { statutTg: 'administrator' })] })
  const createur = candidat(12, 'silence', { comptes: [compte(12, { statutTg: 'creator' })] })
  const exempte = candidat(13, 'accueil')
  const lui = candidat(14, 'silence', { comptes: [compte(ALEX)] })
  const autreRelais = candidat(15, 'silence')
  const parti = candidat(16, 'silence', { comptes: [compte(16, { present: false, statutTg: 'left' })] })
  const sansCompte = candidat(17, 'accueil', { comptes: [] })
  const banni = candidat(18, 'silence', { comptes: [compte(18, { statutTg: 'kicked' })] })
  const ok = candidat(19, 'silence')
  // Deux comptes : un de l'equipe suffit a ecarter le membre ; sinon le compte present est choisi.
  const mixte = candidat(20, 'silence', { comptes: [compte(20), compte(10)] })
  const deux = candidat(21, 'accueil', { comptes: [compte(210, { present: false, statutTg: 'left' }), compte(211)] })
  const excl = { equipe: new Set([10]), exemptes: new Set([13]), relais: new Set([ALEX, 15]) }
  const lignes = lignesPourRelais([equipe, admin, createur, exempte, lui, autreRelais, parti, sansCompte, banni, ok, mixte, deux], alex, excl, sans)
  assert.deepEqual(ids(lignes), ['m21', 'm19'])
  assert.equal(lignes[0].telegramId, 211)
  // Le relais lui-meme est ecarte meme absent de la liste des relais passee.
  assert.deepEqual(lignesPourRelais([lui], alex, { equipe: new Set(), exemptes: new Set(), relais: new Set() }, sans), [])
  // Le statut en direct prime : sorti depuis la collecte, ou promu admin.
  const direct = { ...vide, statutsDirects: new Map([[19, 'left'], [22, 'administrator'], [23, null]]) }
  assert.deepEqual(ids(lignesPourRelais([ok, candidat(22, 'silence'), candidat(23, 'silence')], alex, direct, sans)), ['m23'])
  // Un compte « restricted » present au registre reste joignable.
  assert.ok(compteAJoindre([compte(24, { statutTg: 'restricted' })], vide))
})

bloc('memoire du relais : une fois par episode, jamais un episode fait, pas de doublon', () => {
  const a = candidat(30, 'silence')
  const b = candidat(31, 'accueil')
  const c = candidat(32, 'silence')
  const dejaTransmis = new Set([cleAnnonce('m30', a.cleEpisode)])
  const traitees = new Set([cleAnnonce('m32', c.cleEpisode)])
  assert.deepEqual(ids(lignesPourRelais([a, b, c], alex, vide, { traitees, dejaTransmis })), ['m31'])
  // Premier envoi (memoire vide, propre au relais) : tout le retard part, accueil d'abord puis par entree.
  const vieux = candidat(33, 'silence', { entree: '2026-10-01' })
  assert.deepEqual(ids(lignesPourRelais([a, vieux, b], alex, vide, sans)), ['m31', 'm33', 'm30'])
  // La fenetre change (accueil devenu silence) : nouvel episode, annonce normalement.
  const devenu = candidat(31, 'silence', { date: '2026-10-22' })
  const memoire = new Set([cleAnnonce('m31', b.cleEpisode)])
  assert.deepEqual(ids(lignesPourRelais([devenu], alex, vide, { traitees: new Set(), dejaTransmis: memoire })), ['m31'])
  // Deux episodes du meme membre le meme jour : une seule ligne.
  assert.deepEqual(ids(lignesPourRelais([b, devenu], alex, vide, sans)), ['m31'])
  // La memoire est PROPRE au relais : celle du resume (risque_annonces) n'est jamais lue.
  assert.ok(!/risque_annonces/.test(readFileSync(new URL('../src/lib/liveclub/relais.ts', import.meta.url), 'utf8')))
})

bloc('bouton « C\'est fait » : reserve au relais de l\'episode', () => {
  assert.equal(dataBoutonRelais(123456789012), 'rl:123456789012')
  assert.ok(new TextEncoder().encode(dataBoutonRelais(Number.MAX_SAFE_INTEGER)).length <= 64)
  assert.equal(lireBoutonRelais('rl:42'), 42)
  for (const x of ['rl:', 'rl:0', 'rl:-3', 'rl:4a', 'rl:1234567890123456', 'm:menu', 'c:abcdefgh']) assert.equal(lireBoutonRelais(x), null, x)
  assert.ok(estBoutonRelais('rl:42'))
  assert.ok(!estBoutonRelais('m:equipe'))
  const ep = { relaisId: ALEX, envoye: true, fait: false, relaisActif: true }
  assert.equal(decisionBoutonRelais(ALEX, ep), 'marquer')
  assert.equal(decisionBoutonRelais(ALEX, { ...ep, fait: true }), 'deja_fait')
  assert.equal(decisionBoutonRelais(999, ep), 'refuse')
  assert.equal(decisionBoutonRelais(ALEX, { ...ep, relaisActif: false }), 'refuse')
  assert.equal(decisionBoutonRelais(ALEX, { ...ep, envoye: false }), 'refuse')
  assert.equal(decisionBoutonRelais(ALEX, null), 'refuse')
  // Le clavier : seul le bouton appuye change.
  const clavier = { inline_keyboard: [[{ text: "C'est fait : 1. Julien", callback_data: 'rl:7' }], [{ text: "C'est fait : 2. Marc", callback_data: 'rl:8' }]] }
  const apres = clavierApresFait(clavier, 'rl:8')
  assert.deepEqual(apres, [[{ text: "C'est fait : 1. Julien", callback_data: 'rl:7' }], [{ text: 'Fait : 2. Marc', callback_data: 'rl:8' }]])
  // Un second appui ne change plus rien.
  assert.equal(clavierApresFait({ inline_keyboard: apres }, 'rl:8'), null)
  assert.equal(clavierApresFait(null, 'rl:8'), null)
  assert.match(noteMarqueRelais('Alex'), /^Fait par Alex \(relais d'accueil/)
  // Le bot traite le bouton AVANT le fil Support et le rattachement ; l'agent IA ne connait pas le relais.
  const bot = readFileSync(new URL('../src/lib/liveclub/bot-membre.ts', import.meta.url), 'utf8')
  const i = bot.indexOf('if (estBoutonRelais(data))')
  assert.ok(i > 0 && i < bot.indexOf('const r = await rattachementOuNull(u.id)', i) && i < bot.indexOf('await versSupport(u.id, identite', i))
  // La liste du matin n'entre ni au fil Support ni a l'historique de l'agent.
  for (const f of ['conversations.ts', 'support-pont.ts']) {
    assert.ok(!/relais/i.test(readFileSync(new URL(`../src/lib/liveclub/${f}`, import.meta.url), 'utf8')), `${f} parle du relais`)
  }
  // (24/10, Brice) L'agent repond au relais sur SES membres : l'outil n'existe que pour un relais actif,
  // et le serveur ne lit que les membres transmis a ce relais, sans contenu de message ni email ni paiement.
  const agent = readFileSync(new URL('../src/lib/liveclub/agent-membre.ts', import.meta.url), 'utf8')
  assert.match(agent, /const relais = await estRelaisActif\(telegramId\)/)
  assert.match(agent, /relais \? await ficheMembrePourRelais\(telegramId, bloc\.input\) : \{ erreur/)
  const prompt = readFileSync(new URL('../src/lib/liveclub/prompt-membre.ts', import.meta.url), 'utf8')
  assert.match(prompt, /tools: o\.relais \? \[\.\.\.OUTILS_MEMBRE, OUTIL_MEMBRE_A_CONTACTER\] : OUTILS_MEMBRE/)
  const fiche = serveurFiche()
  assert.match(fiche, /where e\.relais_id = \$\{relaisId\} and e\.envoye_le is not null/)
  assert.ok(!/\btexte\b|email\s*[,:]|montant|abonnement_|statut_abonnement|stripe/i.test(fiche.replace(/lower\(u\.email\) = lower\(r\.email\)|r\.email is not null|ni email|un email|jamais l'email|l'email du rattachement/g, '')), 'la fiche ne lit ni texte de message, ni email rendu, ni paiement')
  const serveur = readFileSync(new URL('../src/lib/liveclub/relais.ts', import.meta.url), 'utf8')
  assert.match(serveur, /decisionBoutonRelais\(bouton\.from\.id/)
  assert.match(serveur, /for update of e/)
})

bloc('textes : prenom nom, nom Telegram, @pseudo ou lien, motif ; jamais email, montant, abonnement', () => {
  const fuite = {
    email: 'secret@exemple.fr', email_principal: 'secret@exemple.fr', montant: 139, produits: 'Live Club mensuel',
    prochain_prelevement: '2026-11-02', en_echec: true,
  }
  const avec = candidat(40, 'accueil', { ...fuite, joursAnciennete: 5, comptes: [compte(40, { pseudo: '@julien_tr', nomAffiche: 'Julien <b>T</b> & co' })] })
  const sansPseudo = candidat(41, 'silence', { ...fuite, joursSilence: 14, comptes: [compte(41, { pseudo: null, nomAffiche: 'Marc' })] })
  const sansNom = candidat(42, 'silence', { ...fuite, nomFiche: null, comptes: [compte(42, { pseudo: 'x', nomAffiche: null })] })
  const memeNom = candidat(43, 'silence', { ...fuite, joursSilence: 20, nomFiche: 'Léa Martin', comptes: [compte(43, { pseudo: 'lea_m', nomAffiche: 'Lea MARTIN 🙏' })] })
  const lignes = lignesPourRelais([avec, sansPseudo, sansNom, memeNom], alex, vide, sans)
  // Le @ de la fiche comble un compte sans @ ; un nom dans ce champ ne compte pas.
  assert.equal(lignesPourRelais([candidat(44, 'silence', { pseudoFiche: '@rudy_s', comptes: [compte(44, { pseudo: null })] })], alex, vide, sans)[0].pseudo, 'rudy_s')
  assert.equal(lignesPourRelais([candidat(45, 'silence', { pseudoFiche: 'Rudy S', comptes: [compte(45, { pseudo: null })] })], alex, vide, sans)[0].pseudo, null)
  for (const l of lignes) assert.deepEqual(Object.keys(l).sort(), ['cleEpisode', 'jours', 'membreId', 'motif', 'nom', 'nomTelegram', 'pseudo', 'telegramId'])
  const [m] = messagesRelais(lignes.map((l, i) => ({ ...l, episodeId: i + 1 })), { presentation: null })
  assert.equal(m.texte, [
    '1. Fiche 40 (Julien &lt;b&gt;T&lt;/b&gt; &amp; co, @julien_tr) : arrivé il y a 5 jours, n\'a pas encore écrit',
    '2. Fiche 41 (<a href="tg://user?id=41">Marc</a>) : plus de message depuis 14 jours',
    '3. <a href="tg://user?id=42">Membre sans nom</a> : plus de message depuis 16 jours',
    '4. Léa Martin (@lea_m) : plus de message depuis 20 jours',
    '',
    NOTE_SANS_PSEUDO,
    '',
    NOTE_BOT_MEMBRES,
  ].join('\n'))
  for (const interdit of [/secret@/, /€/, /139/, /abonnement/i, /prélèvement/i, /paiement/i, /Live Club mensuel/, /2026-11-02/]) {
    assert.ok(!interdit.test(m.texte), `${interdit} dans le texte`)
    assert.ok(!interdit.test(JSON.stringify(m.boutons)), `${interdit} dans les boutons`)
  }
  assert.equal(pseudoPropre('x'), null)
  assert.equal(motifEnClair({ motif: 'accueil', jours: 1 }), "arrivé il y a 1 jour, n'a pas encore écrit")
  assert.equal(motifEnClair({ motif: 'silence', jours: null }), 'plus de message depuis 14 jours')
})

bloc('messages : presentation et retard au premier envoi, decoupe, un bouton par ligne', () => {
  const p = textePresentation('Alex')
  assert.equal(p, "Salut Alex, comme convenu avec Brice : chaque jour où il y a du nouveau, je t'envoie ici les membres à qui dire un mot. Appuie sur « C'est fait » quand c'est fait.")
  const lignes = Array.from({ length: 23 }, (_, i) => ({
    membreId: `m${i}`, cleEpisode: `a_risque:silence:2026-10-${String(i + 1).padStart(2, '0')}`, motif: 'silence',
    telegramId: 1000 + i, pseudo: `pseudo_long_${i}`.padEnd(32, 'x'), nom: 'N'.repeat(40), jours: 20, episodeId: 500 + i,
  }))
  const premiers = messagesRelais(lignes, { presentation: p })
  assert.equal(premiers.length, Math.ceil(23 / LIGNES_PAR_MESSAGE))
  assert.ok(premiers[0].texte.startsWith(`${p}\n\n${TITRE_RETARD}\n1. `))
  assert.ok(!premiers[1].texte.includes(TITRE_RETARD) && !premiers[1].texte.includes('Salut'))
  assert.ok(premiers[1].texte.startsWith(`${LIGNES_PAR_MESSAGE + 1}. `))
  for (const m of premiers) {
    assert.ok(m.texte.length < 4096)
    assert.equal(m.boutons.length, m.episodes.length)
    for (const [b] of m.boutons) assert.match(b.texte, /^C'est fait : \d+\. .{1,20}$/)
  }
  assert.deepEqual(premiers.flatMap(m => m.episodes), lignes.map(l => l.episodeId))
  assert.equal(premiers[2].boutons[0][0].data, 'rl:520')
  // Les jours suivants : droit a la liste.
  const ensuite = messagesRelais(lignes.slice(0, 2), { presentation: null })
  assert.ok(ensuite[0].texte.startsWith('1. '))
  assert.deepEqual(messagesRelais([], { presentation: p }), [])
})

bloc('resume de Brice et Mel : « (Alex s\'en occupe) », puis la ligne sort une fois faite', () => {
  assert.equal(detailAvecRelais('silencieux depuis 15 jours', ['Alex']), "silencieux depuis 15 jours (Alex s'en occupe)")
  assert.equal(detailAvecRelais('silencieux depuis 15 jours', ['Alex', 'Sam', 'Alex']), "silencieux depuis 15 jours (Alex et Sam s'en occupent)")
  assert.equal(detailAvecRelais('silencieux depuis 15 jours', []), 'silencieux depuis 15 jours')
  // Le @ lu aux deux sources : l'une comble l'autre, deux @ differents remontent.
  assert.deepEqual(pseudoCroise(null, 'Milene76'), { pseudo: 'Milene76', alerte: null })
  assert.deepEqual(pseudoCroise('@mathetrader', null), { pseudo: 'mathetrader', alerte: null })
  assert.deepEqual(pseudoCroise('@Lea_M', 'lea_m'), { pseudo: 'lea_m', alerte: null })
  assert.deepEqual(pseudoCroise('ancien', 'nouveau'),
    { pseudo: 'nouveau', alerte: 'deux @ différents, @ancien sur la fiche et @nouveau sur le compte rattaché, à vérifier' })
  assert.deepEqual(pseudoCroise('', null), { pseudo: null, alerte: null })
  assert.deepEqual(pseudoCroise('Christophe chapelier', 'Chrissssstoooo'), { pseudo: 'Chrissssstoooo', alerte: null })
  assert.deepEqual(pseudoCroise('Ginger', null), { pseudo: 'Ginger', alerte: null })
  assert.deepEqual(pseudoCroise('Laura Mancini', null), { pseudo: null, alerte: null })
  const par = relaisParEpisode([
    { membre_id: 'a', cle_episode: 'a_risque:silence:2026-10-02', nom: 'Alex' },
    { membre_id: 'a', cle_episode: 'a_risque:silence:2026-10-02', nom: 'Alex' },
    { membre_id: 'b', cle_episode: 'a_risque:accueil:2026-10-15', nom: null },
  ])
  assert.deepEqual([...par], [['a::a_risque:silence:2026-10-02', ['Alex']]])
  const m = { membreId: 'a', cleEpisode: 'a_risque:silence:2026-10-02', motif: 'silence', prochainPrelevement: null, prochaineTentative: null, joursSilence: 15, joursAnciennete: null, entree: '2026-10-16' }
  const detail = detailAvecRelais(detailAContacter(m, '2026-10-24'), par.get(cleAnnonce(m.membreId, m.cleEpisode)) ?? [])
  const texte = composerResume([{ rubrique: 'contacter', qui: 'ma', detail, quand: '2026-10-24T07:00:00Z' }],
    new Map([['ma', { nom: 'Paul', email: null, pseudo: 'paul', telegramId: null }]]),
    { depuis: '2026-10-23T07:00:00Z', jusqua: '2026-10-24T07:00:00Z' })
  assert.match(texte, /\nÀ contacter\n- Paul, @paul : silencieux depuis 15 jours \(Alex s'en occupe\)/)
  // Alex a appuye : la marque (meme cle) l'exclut des annonces.
  const traitees = new Set([cleAnnonce('a', m.cleEpisode)])
  assert.deepEqual(episodesAAnnoncer([m], { annoncesAvant: [], traitees, depuisJour: '2026-10-23' }), [])
  // Le serveur du resume lit la memoire du relais, relais actifs et episodes partis seulement.
  const resume = readFileSync(new URL('../src/lib/liveclub/resume.ts', import.meta.url), 'utf8')
  assert.match(resume, /where r\.actif and e\.envoye_le is not null and e\.fait_le is null/)
  assert.match(resume, /detailAvecRelais\(detailAContacter\(m, jour\)/)
})

bloc('le serveur ne logue ni nom ni identifiant, et passe avant le resume', () => {
  const source = readFileSync(new URL('../src/lib/liveclub/relais.ts', import.meta.url), 'utf8')
  for (const ligne of source.split('\n').filter(l => /console\.(log|warn|error)/.test(l))) {
    assert.ok(!/\b(nom|pseudo|telegramId|membreId|texte)\b/.test(ligne.replace(/\[liveclub\/relais\][^`']*/, '')), `log suspect : ${ligne.trim()}`)
  }
  const passage = readFileSync(new URL('../src/lib/liveclub/passage.ts', import.meta.url), 'utf8')
  const relais = passage.indexOf("await etape('relais'")
  assert.ok(relais > 0 && relais < passage.indexOf("await etape('resume'"))
})

console.log(`\n${n} blocs verifies, tout est bon.`)
