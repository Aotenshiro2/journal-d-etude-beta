// Verification HORS LIGNE (05/11/2026) de « Envoyer un diagnostic » du Carnet
// (1.8.14, brief C4) : les regles pures de POST /api/carnet/diagnostic
// (src/lib/carnet-diagnostic-pur.ts) : bornes, filtrage des champs, formatage
// du message a l'equipe, cadence ; puis le branchement relu dans la route.
// Aucune base, aucun reseau, aucun Telegram.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-diagnostic-carnet.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const P = await import('../src/lib/carnet-diagnostic-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const MAINTENANT = Date.UTC(2026, 10, 5, 19, 30)
const NOTE = 'Biais haussier, DOL au-dessus du high de la veille'

const erreur = (i, champs = {}) => ({
  le: MAINTENANT - (30 - i) * 60_000, ou: 'panneau', genre: 'erreur', message: `TypeError: erreur ${i}`, source: 'chunks/index-a1.js', ligne: 10 + i, colonne: 4, fois: 1, ...champs,
})

/** Un diagnostic tel que le Carnet 1.8.14 l'envoie (donnees d'essai). */
const diagnostic = (champs = {}) => ({
  schema: 1,
  genereLe: new Date(MAINTENANT).toISOString(),
  carnet: {
    version: '1.8.14', langue: 'fr', theme: 'systeme', sombre: true, mouvementReduit: false,
    reglages: {
      captureAuto: true, captures: true, captureGraphiqueTrade: true, extraction: false, metadonnees: false, affichageSecours: false,
      noterD: false, syncCoupee: false, fournisseurIA: 'chatgpt', filsIA: ['chatgpt'],
    },
  },
  navigateur: {
    marques: [{ marque: 'Chromium', version: '131.0.6778.86' }, { marque: 'Google Chrome', version: '131.0.6778.86' }],
    brave: false, plateforme: 'Windows', versionPlateforme: '15.0.0', architecture: 'x86', bits: '64', mobile: false, userAgent: null,
  },
  gpu: { contexte: 'webgl2', vendeur: 'Google Inc. (NVIDIA)', rendu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', renduLogiciel: false },
  ecran: { dpr: 1.25, zoomEstime: 1, echelleSysteme: 1.25, zoomOnglet: 1, panneau: { l: 420, h: 900 }, fenetre: { l: 1920, h: 1040 }, ecran: { l: 1920, h: 1080 }, profondeur: 24 },
  compte: { connecte: true, email: 'flow@example.com' },
  erreurs: [
    erreur(1),
    erreur(2, { genre: 'toast', message: 'panneau.erreurPdf', source: undefined, ligne: undefined, colonne: undefined }),
    erreur(3, { ou: 'serviceWorker', genre: 'rejet', message: 'TypeError: Failed to fetch', fois: 4 }),
  ],
  dernierEnvoiIA: {
    le: MAINTENANT - 40 * 60_000, fournisseur: 'chatgpt', mode: 'fil', page: 'conversation', projet: false,
    fichiers: { pdf: 1, autres: 0 }, stabilite: { ms: 2400, atteinte: true }, declencheurs: null,
    champsVus: [{ id: 'upload-files', accept: '' }, { id: 'upload-photos', accept: 'image/*' }],
    voies: [
      { voie: 'champ', donne: true, vu: false, ms: 6012 },
      { voie: 'champ-remplace', donne: true, vu: false, ms: 4003 },
      { voie: 'depot', donne: true, vu: false, ms: 4120 },
      { voie: 'collage', donne: true, vu: false, ms: 4007 },
    ],
    pdfUploaded: false, pdfNonVu: true, imageOnly: false, promptFilled: true,
    durees: { chargement: 3200, attente: 2500, injection: 21800, total: 27600 }, erreur: null, repli: false,
  },
  ...champs,
})

bloc('un diagnostic du Carnet se lit ; schema et version exiges', () => {
  const r = P.lireDiagnostic(diagnostic(), MAINTENANT)
  assert.equal(r.ok, true)
  assert.equal(r.diagnostic.carnet.version, '1.8.14')
  assert.equal(r.diagnostic.erreurs.length, 3)
  assert.equal(r.diagnostic.dernierEnvoiIA.voies.length, 4)
  assert.equal(P.lireDiagnostic(null).ok, false)
  assert.equal(P.lireDiagnostic([]).ok, false)
  assert.equal(P.lireDiagnostic({ ...diagnostic(), schema: 2 }).ok, false)
  assert.equal(P.lireDiagnostic({ ...diagnostic(), carnet: { version: 'x' } }).ok, false)
})

bloc('champs inconnus retires, a chaque niveau', () => {
  const d = diagnostic({ note: NOTE, titres: ['Seance NQ'] })
  d.carnet.reglages.apiKey = 'sk-SECRET'
  d.carnet.contenu = NOTE
  d.navigateur.historique = ['https://www.tradingview.com/chart/AbCd/']
  d.erreurs[0].pile = `Error: ${NOTE}`
  d.dernierEnvoiIA.adresse = 'https://chatgpt.com/c/6721a9f0-secret'
  d.dernierEnvoiIA.nom = 'Seance-NQ.pdf'
  d.dernierEnvoiIA.champsVus.push({ id: 'x', accept: '', valeur: NOTE })
  const texte = JSON.stringify(P.lireDiagnostic(d, MAINTENANT).diagnostic)
  for (const interdit of ['Biais', 'SECRET', 'Seance', 'tradingview', '6721a9f0', 'pile', 'historique', 'apiKey', 'valeur']) {
    assert.ok(!texte.includes(interdit), `${interdit} est reste`)
  }
})

bloc('chaque texte borne, types et listes verifies', () => {
  const d = diagnostic()
  d.gpu.rendu = 'R'.repeat(2000)
  d.navigateur.marques = Array.from({ length: 20 }, (_, i) => ({ marque: `M${i}${'x'.repeat(200)}`, version: '1' }))
  d.erreurs = Array.from({ length: 80 }, (_, i) => erreur(i % 30, { message: `m${i} ${'y'.repeat(500)}` }))
  d.ecran.dpr = 'grand'
  d.ecran.panneau = { l: -3, h: 900 }
  d.compte.email = 'e'.repeat(500)
  d.dernierEnvoiIA.voies = Array.from({ length: 20 }, () => ({ voie: 'champ', donne: true, vu: true, ms: 1 }))
  d.dernierEnvoiIA.voies.push({ voie: 'teleportation', donne: true })
  d.erreurs.push({ le: 'hier', ou: 'panneau', genre: 'erreur', message: 'x' })
  d.erreurs.push(erreur(1, { ou: 'ailleurs' }))
  d.erreurs.push(erreur(1, { genre: 'toast', message: 'un texte libre de toast' }))
  const r = P.lireDiagnostic(d, MAINTENANT).diagnostic
  assert.ok(r.gpu.rendu.length <= 300)
  assert.equal(r.navigateur.marques.length, 6)
  assert.ok(r.navigateur.marques.every(m => m.marque.length <= 60))
  assert.ok(r.erreurs.length <= 30)
  assert.ok(r.erreurs.every(e => e.message.length <= 200))
  assert.equal(r.erreurs.at(-1).message, 'hors-dictionnaire', 'un toast garde sa cle, jamais un texte libre')
  assert.equal(r.ecran.dpr, null)
  assert.equal(r.ecran.panneau, null)
  assert.ok(r.compte.email.length <= 200)
  assert.equal(r.dernierEnvoiIA.voies.length, 8)
  // Caracteres invisibles retires.
  const cache = P.texteBorne(`a${String.fromCharCode(0x200b)}b${String.fromCharCode(0x2028)}c`, 50)
  assert.equal(cache, 'a b c')
})

bloc('rendu logiciel relu par la route, sans croire le Carnet', () => {
  const d = diagnostic()
  d.gpu = { contexte: 'webgl', vendeur: 'Google Inc. (Google)', rendu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', renduLogiciel: false }
  assert.equal(P.lireDiagnostic(d, MAINTENANT).diagnostic.gpu.renduLogiciel, true)
  assert.equal(P.renduLogiciel('Microsoft Basic Render Driver'), true)
  assert.equal(P.renduLogiciel('llvmpipe (LLVM 15.0.7, 256 bits)'), true)
  assert.equal(P.renduLogiciel('NVIDIA GeForce GTX 1060'), false)
})

bloc('le message a l equipe : compact, 3500 caracteres au plus, les 5 erreurs les plus recentes', () => {
  const d = P.lireDiagnostic(diagnostic(), MAINTENANT).diagnostic
  const t = P.texteDiagnostic(d, 'flow@example.com')
  console.log('\n----- exemple de message (donnees d essai) -----\n' + t + '\n-----------------------------------------------\n')
  assert.ok(t.length <= P.TEXTE_MAX_DIAGNOSTIC)
  assert.ok(t.startsWith('Diagnostic du Carnet, envoyé par le membre'))
  assert.ok(t.includes('Qui : flow@example.com'))
  assert.ok(!t.includes('le Carnet affiche'), 'meme email : pas de rappel')
  assert.ok(t.includes('Carnet 1.8.14 (fr)'))
  assert.ok(t.includes('Google Chrome 131.0.6778.86, Windows 15.0.0, x86 64 bits'))
  assert.ok(t.includes('NVIDIA GeForce GTX 1060'))
  assert.ok(t.includes('rendu matériel'))
  assert.ok(t.includes('zoom estimé 100 % (échelle système 125 %), dpr 1.25'))
  assert.ok(t.includes('panneau 420 x 900'))
  assert.ok(t.includes('Affichage de secours : désactivé'))
  assert.ok(t.includes('Erreurs (3 plus récentes sur 3)'))
  assert.ok(t.includes('service worker, rejet : TypeError: Failed to fetch (chunks/index-a1.js:13) x4'))
  assert.ok(t.includes('toast : panneau.erreurPdf'))
  assert.ok(t.includes('Dernier envoi IA'))
  assert.ok(t.includes('conversation existante'))
  assert.ok(t.includes('PDF NON VU'))
  assert.ok(t.includes('#upload-files [tout], #upload-photos [image/*]'))
  assert.ok(t.includes('champ donné, non vu (6,0 s)'))
  assert.ok(t.includes('total 27,6 s'))
  assert.ok(![0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0xa0, 0x202f].some(c => t.includes(String.fromCharCode(c))), 'caracteres clavier seulement')
  // Les 5 plus recentes seulement, la plus recente d'abord.
  const beaucoup = P.lireDiagnostic(diagnostic({ erreurs: Array.from({ length: 30 }, (_, i) => erreur(i)) }), MAINTENANT).diagnostic
  const tb = P.texteDiagnostic(beaucoup, 'flow@example.com')
  assert.ok(tb.includes('Erreurs (5 plus récentes sur 30)'))
  assert.ok(tb.includes('erreur 29') && tb.includes('erreur 25') && !tb.includes('erreur 24 '))
  assert.ok(tb.indexOf('erreur 29') < tb.indexOf('erreur 25'))
  // Un email different dans le Carnet est rappele.
  assert.ok(P.texteDiagnostic(d, 'autre@example.com').includes('(le Carnet affiche flow@example.com)'))
  // Rendu logiciel et affichage de secours en evidence.
  const ls = P.lireDiagnostic(diagnostic({ gpu: { contexte: 'webgl', vendeur: 'Mesa', rendu: 'llvmpipe (LLVM 15.0.7, 256 bits)' } }), MAINTENANT).diagnostic
  ls.carnet.reglages.affichageSecours = true
  const tl = P.texteDiagnostic(ls, 'x@example.com')
  assert.ok(tl.includes('RENDU LOGICIEL'))
  assert.ok(tl.includes('Affichage de secours : ACTIVÉ'))
  // Sans envoi IA ni erreur.
  const vide = P.texteDiagnostic(P.lireDiagnostic(diagnostic({ erreurs: [], dernierEnvoiIA: null }), MAINTENANT).diagnostic, 'x@example.com')
  assert.ok(vide.includes('Erreurs : aucune') && vide.includes('Dernier envoi IA : aucun'))
  // Le pire cas tient dans la limite.
  const lourd = diagnostic({ erreurs: Array.from({ length: 30 }, (_, i) => erreur(i, { message: 'z '.repeat(100), source: `chunks/${'f'.repeat(150)}.js` })) })
  lourd.gpu.rendu = 'R'.repeat(300)
  lourd.navigateur.userAgent = 'U'.repeat(300)
  const tlourd = P.texteDiagnostic(P.lireDiagnostic(lourd, MAINTENANT).diagnostic, 'e'.repeat(200))
  assert.ok(tlourd.length <= P.TEXTE_MAX_DIAGNOSTIC)
  assert.ok(P.texteDiagnostic(d, 'x@example.com', 500).length <= 500)
})

bloc('heure de Paris en caracteres simples', () => {
  assert.equal(P.heureCourte(Date.UTC(2026, 10, 5, 19, 14)), '05/11 20:14')
  assert.equal(P.heureCourte(Date.UTC(2026, 6, 1, 7, 5)), '01/07 09:05')
})

bloc('champs libres pour l analyse d injection', () => {
  const d = P.lireDiagnostic(diagnostic(), MAINTENANT).diagnostic
  const libres = P.champsLibres(d)
  assert.ok(libres.includes('TypeError: Failed to fetch'))
  assert.ok(libres.includes('ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)'))
  assert.ok(libres.includes('upload-files'))
  assert.ok(libres.includes('flow@example.com'))
})

bloc('cadence : 5 par jour et par compte, 24 h glissantes', () => {
  assert.deepEqual(P.cadenceDiagnostic([], MAINTENANT), { autorise: true, restants: 5, recents: [], reessayerDansMs: 0 })
  const quatre = [5, 4, 3, 2].map(h => MAINTENANT - h * 3_600_000)
  assert.equal(P.cadenceDiagnostic(quatre, MAINTENANT).restants, 1)
  const cinq = [...quatre, MAINTENANT - 60_000]
  const c = P.cadenceDiagnostic(cinq, MAINTENANT)
  assert.equal(c.autorise, false)
  assert.equal(c.restants, 0)
  assert.equal(c.reessayerDansMs, 19 * 3_600_000, 'le plus ancien (il y a 5 h) sort dans 19 h')
  assert.equal(P.cadenceDiagnostic([...quatre, MAINTENANT - 86_400_000 - 1], MAINTENANT).autorise, true)
  assert.equal(P.cadenceDiagnostic([MAINTENANT + 10_000], MAINTENANT).restants, 5, 'un instant futur ne compte pas')
})

bloc('la route : Bearer, CORS, 32 Ko, schema, 429, alerte a l equipe, sans table', () => {
  const route = lire('src/app/api/carnet/diagnostic/route.ts')
  assert.ok(route.includes('getUserId(req)'))
  assert.ok(route.includes('corsPreflight(req, METHODES)') && route.includes('corsHeaders(req, METHODES)'))
  assert.ok(route.includes('OCTETS_MAX_DIAGNOSTIC') && route.includes('status: 413'))
  assert.ok(route.includes('lireDiagnostic(brut, maintenant)'))
  assert.ok(route.includes('status: 429') && route.includes('Retry-After'))
  assert.ok(route.includes('alerterEquipeTexte(texte'))
  assert.ok(route.includes("analyserTexte(champsLibres(lu.diagnostic).join('\\n'), { niveau: 'injection' })"))
  assert.ok(route.includes('select email from auth.users where id = ${userId}::uuid'))
  assert.ok(!/prisma\.\w+\.(create|update|upsert|delete)/.test(route), 'aucune ecriture en base')
  assert.ok(!/insert into|update public|delete from/i.test(route), 'aucune ecriture SQL')
  assert.equal(P.OCTETS_MAX_DIAGNOSTIC, 32 * 1024)
  assert.equal(P.DIAGNOSTICS_PAR_JOUR, 5)
  assert.equal(P.TEXTE_MAX_DIAGNOSTIC, 3500)
})

console.log(`\n${n} blocs ok`)
