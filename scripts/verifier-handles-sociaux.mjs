// Verification locale des @HANDLES DES RESEAUX (13/11/2026, lot de Tab, POST /api/tab/v1/handles).
// Aucune base, aucun reseau : les regles pures (src/lib/tab/handles-pur.ts) tournent sur des cas
// construits, et le cablage (route, aide, connecteur de Tache, cockpit) est controle sur son texte.
// Node 22 retire les types : ce script importe les .ts directement.
//
//   node scripts/verifier-handles-sociaux.mjs
//
// Sort en code 1 au premier ecart. La base (migration, RLS, ecriture reelle sous verrou) se verifie
// avec scripts/essayer-migration-handles-sociaux.mjs (transaction annulee).

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import './resoudre-ts.mjs'
const H = await import('../src/lib/tab/handles-pur.ts')

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let blocs = 0
const bloc = (nom, f) => { f(); blocs++; console.log(`ok ${blocs}. ${nom}`) }
const AUJ = '2026-11-13'
const EMAIL_TEST = 'quelqu.un@exemple.fr'

bloc('plateforme et handle normalises (sans @, minuscules, adresse de profil)', () => {
  assert.equal(H.normaliserPlateforme(' TikTok '), 'tiktok')
  assert.equal(H.normaliserPlateforme('Twitter'), 'x')
  assert.equal(H.normaliserPlateforme('IG'), 'instagram')
  assert.equal(H.normaliserPlateforme('tik tok'), null)
  assert.equal(H.normaliserHandle('@AlexTraderFT'), 'alextraderft')
  assert.equal(H.normaliserHandle('mel.mom.trader'), 'mel.mom.trader')
  assert.equal(H.normaliserHandle('https://www.tiktok.com/@momo.chez97?lang=fr'), 'momo.chez97')
  assert.equal(H.normaliserHandle('https://instagram.com/kais.dgtl/'), 'kais.dgtl')
  assert.equal(H.normaliserHandle('@@x_y-z'), 'x_y-z')
  assert.equal(H.normaliserHandle(EMAIL_TEST), null)
  assert.equal(H.normaliserHandle('avec espace'), null)
  assert.equal(H.normaliserHandle(''), null)
})

bloc('qui : numero, equipe, membre:, p-, vide ; jamais d email (et l erreur ne le recopie pas)', () => {
  assert.deepEqual(H.lireQui('248'), { type: 'numero', numero: 248 })
  assert.deepEqual(H.lireQui('n°248'), { type: 'numero', numero: 248 })
  assert.deepEqual(H.lireQui('#12'), { type: 'numero', numero: 12 })
  assert.deepEqual(H.lireQui(7), { type: 'numero', numero: 7 })
  assert.deepEqual(H.lireQui('équipe : Mélanie'), { type: 'equipe', prenom: 'Mélanie' })
  assert.deepEqual(H.lireQui('Equipe: Adil'), { type: 'equipe', prenom: 'Adil' })
  assert.deepEqual(H.lireQui('membre:AE94BE02-B226-44E4-B9AC-154021F46BF2'), { type: 'membre', membreId: 'ae94be02-b226-44e4-b9ac-154021f46bf2' })
  assert.deepEqual(H.lireQui('p-melanie'), { type: 'personne', personneId: 'p-melanie' })
  for (const v of ['', '  ', null, undefined, '-', 'vide']) assert.deepEqual(H.lireQui(v), { type: 'vide' }, String(v))
  const e = H.lireQui(EMAIL_TEST)
  assert.equal(typeof e, 'string')
  assert.match(e, /jamais d'email/)
  assert.ok(!e.includes(EMAIL_TEST))
  assert.equal(typeof H.lireQui('Jonathan'), 'string')
  assert.equal(typeof H.lireQui('0'), 'string')
  assert.equal(typeof H.lireQui('membre:pas-un-uuid'), 'string')
})

const L = (o = {}) => ({ plateforme: 'tiktok', handle: '@alextraderft', statut: 'sur', qui: '248', preuve: 'Se présente lui-même', source: 'commentaires TikTok @bricedlb, 30 jours', interactions: 5, dernier_echange: '2026-11-08', ...o })

bloc('lot : erreurs du lot entier', () => {
  assert.equal(typeof H.lireLot(null, AUJ), 'string')
  assert.equal(typeof H.lireLot({ lignes: [] }, AUJ), 'string')
  assert.match(H.lireLot({ lignes: [L()], autre: 1 }, AUJ), /Champ inconnu dans le lot : autre/)
  assert.match(H.lireLot({ lignes: [L()], a_blanc: 'oui' }, AUJ), /a_blanc/)
  assert.match(H.lireLot({ lignes: Array.from({ length: H.MAX_LIGNES + 1 }, () => L()) }, AUJ), /au plus/)
})

bloc('lot : une ligne valide, et chaque refus avec son rang et sa raison (sans email)', () => {
  const lot = H.lireLot({
    a_blanc: true,
    lignes: [
      L(),
      L({ handle: 'david19691969', statut: 'a_identifier', qui: '248' }),
      L({ handle: 'momo.chez97', statut: 'probable', qui: '' }),
      L({ handle: 'x1', preuve: `écrire à ${EMAIL_TEST}` }),
      L({ handle: 'x2', qui: EMAIL_TEST }),
      L({ handle: 'x3', nombre: 3 }),
      L({ handle: 'ALEXTRADERFT' }),
      L({ handle: 'x4', dernier_echange: '2026-11-14' }),
      L({ handle: 'x5', statut: 'certain' }),
      L({ handle: 'x6', interactions: -1 }),
      L({ handle: 'x7', preuve: 'a'.repeat(H.MAX_PREUVE + 1) }),
      L({ handle: 'x8', dernier_echange: '08/11/2026', interactions: '4' }),
    ],
  }, AUJ)
  assert.equal(typeof lot, 'object')
  assert.equal(lot.aBlanc, true)
  assert.deepEqual(lot.lignes.map((l) => l.rang), [1, 12])
  assert.equal(lot.lignes[1].dernierEchange, '2026-11-08')
  assert.equal(lot.lignes[1].interactions, 4)
  const raison = Object.fromEntries(lot.refusees.map((r) => [r.rang, r.erreur]))
  assert.match(raison[2], /a_identifier : qui reste vide/)
  assert.match(raison[3], /qui est obligatoire/)
  assert.match(raison[4], /preuve : jamais d'email/)
  assert.match(raison[5], /jamais d'email/)
  assert.match(raison[6], /Champ inconnu : nombre/)
  assert.match(raison[7], /Doublon de la ligne 1/)
  assert.match(raison[8], /futur/)
  assert.match(raison[9], /statut : sur, probable ou a_identifier/)
  assert.match(raison[10], /interactions/)
  assert.match(raison[11], /300 caractères au plus/)
  assert.ok(!JSON.stringify(lot).includes(EMAIL_TEST), 'un email est repasse dans le lot lu')
  assert.deepEqual(lot.lignes[0].qui, { type: 'numero', numero: 248 })
  assert.equal(lot.lignes[0].handle, 'alextraderft')
})

bloc('masquerEmails : le journal d acces ne garde aucune adresse', () => {
  const m = H.masquerEmails({ lignes: [{ qui: EMAIL_TEST, preuve: `voir ${EMAIL_TEST} et @bricedlb` }] })
  assert.ok(!JSON.stringify(m).includes(EMAIL_TEST))
  assert.match(m.lignes[0].preuve, /voir \[email\] et @bricedlb/)
  assert.equal(H.contientEmail('commentaires TikTok @bricedlb, 30 jours'), false)
})

bloc('equipe : une seule personne du fonds par prenom (accents, alias), sinon aucune', () => {
  const C = [
    { personne_id: 'p-melanie', nom: 'Mélanie', alias: 'MELMOM,Melanie,Melanie Sommer' },
    { personne_id: 'p-adil-belka', nom: 'Adil Belka', alias: 'Adil,Adil Belka' },
    { personne_id: 'p-jules-vital', nom: 'Jules Vital', alias: 'Jules' },
    { personne_id: 'p-jules-autre', nom: 'Jules Autre', alias: '' },
  ]
  assert.deepEqual(H.personneEquipe('Mélanie', C), { trouvee: 'p-melanie', nombre: 1 })
  assert.deepEqual(H.personneEquipe('melanie', C), { trouvee: 'p-melanie', nombre: 1 })
  assert.deepEqual(H.personneEquipe('MELMOM', C), { trouvee: 'p-melanie', nombre: 1 })
  assert.deepEqual(H.personneEquipe('Adil', C), { trouvee: 'p-adil-belka', nombre: 1 })
  assert.deepEqual(H.personneEquipe('Jules', C), { trouvee: null, nombre: 2 })
  assert.deepEqual(H.personneEquipe('Brice', C), { trouvee: null, nombre: 0 })
})

const lire = (o) => { const l = H.lireLot({ lignes: [L(o)] }, AUJ); assert.equal(l.refusees.length, 0, JSON.stringify(l.refusees)); return l.lignes[0] }
const RES_ALEX = { identite: { membreId: 'm-alex', personneId: null, numeroMembre: 248, equipe: null }, statutMax: 'sur', note: null }
const RES_VIDE = { identite: { membreId: null, personneId: null, numeroMembre: null, equipe: null }, statutMax: 'sur', note: null }

bloc('decider : creation, puis le meme lot ne change rien (idempotent, interactions non additionnees)', () => {
  const l = lire()
  const a = H.decider(null, l, RES_ALEX, 'tab', AUJ)
  assert.equal(a.action, 'cree')
  assert.equal(a.etat.statut, 'sur')
  assert.equal(a.etat.membreId, 'm-alex')
  assert.equal(a.etat.interactions, 5)
  assert.equal(a.etat.premierVu, '2026-11-08')
  assert.equal(a.etat.dernierVu, '2026-11-08')
  assert.equal(a.etat.posePar, 'tab')
  const b = H.decider(a.etat, l, RES_ALEX, 'tab', AUJ)
  assert.equal(b.action, 'inchange')
  assert.equal(b.etat.interactions, 5)
  // Un lot plus recent : les observations suivent, le poseur du statut ne change pas.
  const c = H.decider(a.etat, lire({ interactions: 7, dernier_echange: '2026-11-12' }), RES_ALEX, 'tache', AUJ)
  assert.equal(c.action, 'mis_a_jour')
  assert.equal(c.etat.interactions, 7)
  assert.equal(c.etat.premierVu, '2026-11-08')
  assert.equal(c.etat.dernierVu, '2026-11-12')
  assert.equal(c.etat.posePar, 'tab')
  // Une date plus ancienne recule premier_vu, jamais dernier_vu.
  const d = H.decider(c.etat, lire({ interactions: 7, dernier_echange: '2026-10-20' }), RES_ALEX, 'tab', AUJ)
  assert.equal(d.etat.premierVu, '2026-10-20')
  assert.equal(d.etat.dernierVu, '2026-11-12')
})

bloc('decider : un « sur » pose a la main n est jamais retrograde par un lot', () => {
  const main = { membreId: 'm-alex', personneId: null, numeroMembre: 248, equipe: null, statut: 'sur', preuve: 'Vu par Brice', source: 'x', note: null, interactions: 5, premierVu: '2026-11-01', dernierVu: '2026-11-08', posePar: 'main:Brice' }
  const r = H.decider(main, lire({ statut: 'probable', qui: '12', preuve: 'autre', interactions: 9, dernier_echange: '2026-11-10' }),
    { identite: { membreId: 'm-autre', personneId: null, numeroMembre: 12, equipe: null }, statutMax: 'sur', note: null }, 'tab', AUJ)
  assert.equal(r.etat.statut, 'sur')
  assert.equal(r.etat.membreId, 'm-alex')
  assert.equal(r.etat.numeroMembre, 248)
  assert.equal(r.etat.preuve, 'Vu par Brice')
  assert.equal(r.etat.posePar, 'main:Brice')
  assert.equal(r.etat.interactions, 9)
  assert.equal(r.etat.dernierVu, '2026-11-10')
  assert.equal(r.action, 'mis_a_jour')
  assert.ok(r.remarques.some((x) => /posé à la main \(Brice\)/.test(x)))
  assert.ok(r.remarques.some((x) => /autre personne/.test(x)))
  // Meme un lot a_identifier sans qui ne le touche pas.
  const v = H.decider(main, lire({ statut: 'a_identifier', qui: '' }), RES_VIDE, 'tab', AUJ)
  assert.equal(v.etat.statut, 'sur')
  assert.equal(v.etat.membreId, 'm-alex')
  // Un « probable » pose a la main, lui, peut etre change par un lot (seul le « sur » est fige).
  const p = H.decider({ ...main, statut: 'probable' }, lire({ statut: 'sur', qui: '12' }),
    { identite: { membreId: 'm-autre', personneId: null, numeroMembre: 12, equipe: null }, statutMax: 'sur', note: null }, 'tab', AUJ)
  assert.equal(p.etat.statut, 'sur')
  assert.equal(p.etat.membreId, 'm-autre')
  assert.equal(p.etat.posePar, 'tab')
})

bloc('decider : une ligne sans qui n efface jamais une identification posee par un lot', () => {
  const pose = H.decider(null, lire(), RES_ALEX, 'tab', AUJ).etat
  const r = H.decider(pose, lire({ statut: 'a_identifier', qui: '', interactions: 6 }), RES_VIDE, 'tab', AUJ)
  assert.equal(r.etat.statut, 'sur')
  assert.equal(r.etat.membreId, 'm-alex')
  assert.equal(r.etat.interactions, 6)
  assert.ok(r.remarques.some((x) => /Identification gardée/.test(x)))
})

bloc('decider : plusieurs fiches possibles = statut ramene a probable, avec la note', () => {
  const res = { identite: { membreId: null, personneId: null, numeroMembre: 248, equipe: null }, statutMax: 'probable', note: 'Le compte n° 248 est relié à 2 fiches du cockpit : aucune n\'est choisie' }
  const r = H.decider(null, lire(), res, 'tab', AUJ)
  assert.equal(r.etat.statut, 'probable')
  assert.equal(r.etat.membreId, null)
  assert.match(r.etat.note, /2 fiches/)
  assert.ok(r.remarques.some((x) => /ramené à probable/.test(x)))
})

bloc('decider : a_identifier cree sans personne, premier_vu = le jour du lot quand aucune date', () => {
  const r = H.decider(null, lire({ handle: 'momo.chez97', statut: 'a_identifier', qui: '', dernier_echange: null, interactions: null }), RES_VIDE, 'claude', AUJ)
  assert.equal(r.etat.statut, 'a_identifier')
  assert.equal(H.aUneIdentite(r.etat), false)
  assert.equal(r.etat.premierVu, AUJ)
  assert.equal(r.etat.dernierVu, null)
  assert.equal(r.etat.interactions, 0)
  assert.equal(H.libelleIdentite(r.etat, {}), null)
  assert.equal(H.libelleIdentite(RES_ALEX.identite, { fiche: 'Alex Auger' }), 'fiche Alex Auger · membre n° 248')
})

// ---------------------------------------------------------------------------
// Le cablage, sur le texte
// ---------------------------------------------------------------------------
const lireF = (p) => readFileSync(path.join(RACINE, p), 'utf8')
const ROUTE = lireF('src/app/api/tab/v1/[[...chemin]]/route.ts')
const AIDE = lireF('src/lib/tab/aide.ts')
const SERVEUR = lireF('src/lib/tab/handles.ts')

bloc('route : GET /handles en lecture, POST /handles par recevoirLot, corps journalise sans email', () => {
  assert.match(ROUTE, /handles: \{ f: handlesTab, defaut: 'tout' \}/)
  assert.match(ROUTE, /if \(route === '\/handles'\) \{[\s\S]{0,400}recevoirLot\(corps, \{ posePar: verdict\.portee/)
  assert.match(ROUTE, /parametresJournal\(url, route === '\/handles' \? masquerEmails\(corps\) : corps\)/)
  assert.match(AIDE, /route: '\/handles', methode: 'GET'/)
  assert.match(AIDE, /route: '\/handles', methode: 'POST'/)
  assert.match(AIDE, /handles_des_reseaux: \{/)
  // Le serveur ecrit sous verrou, et ne lit jamais d'adresse email.
  assert.match(SERVEUR, /for update/)
  assert.match(SERVEUR, /on conflict \(plateforme, handle\) do nothing/)
  // La lecture GET /handles ne rend aucune colonne d'email.
  assert.doesNotMatch(SERVEUR.slice(SERVEUR.indexOf('export async function handlesTab')), /email/i)
})

bloc('interne : aucune route de l espace membre ni du site ne lit la table', () => {
  const fichiers = []
  const parcourir = (d) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n)
      if (statSync(p).isDirectory()) { if (n !== 'node_modules') parcourir(p) } else if (/\.(ts|tsx)$/.test(n)) fichiers.push(p)
    }
  }
  parcourir(path.join(RACINE, 'src'))
  const permis = new Set([
    'src/lib/tab/handles.ts', 'src/lib/tab/handles-pur.ts', 'src/lib/tab/aide.ts', 'src/lib/agent-cockpit.ts',
    'src/app/api/tab/v1/[[...chemin]]/route.ts', 'src/lib/mcp-tache/pur.ts',
  ])
  const lecteurs = fichiers.map((f) => path.relative(RACINE, f).split(path.sep).join('/'))
    .filter((f) => /cockpit_handles_sociaux|tab\/handles/.test(readFileSync(path.join(RACINE, f), 'utf8')))
  for (const f of lecteurs) assert.ok(permis.has(f), `${f} lit les handles alors qu'il n'est pas du cote equipe`)
  assert.ok(lecteurs.includes('src/lib/tab/handles.ts'))
})

console.log(`\n${blocs} blocs ok`)
