/**
 * Verifie la partie pure des ANNONCES de l'academie (13/11/2026, src/lib/academie/annonces.ts) :
 * categories des 75 titres Skool, texte des lecons (echappements, images, PDF), reponse de la
 * route (rien d'autre ne sort), corps du POST. Sans base, sans reseau.
 *
 * Lancement (depuis apps/journal-d-etude) :
 *   node scripts/verifier-annonces.mjs [--export <brice-annonces.json>] [--liste]
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  categorieDe, desechapper, fichierPublie, lireIdsSkool, lireVues, MAX_VUES, nettoyageNotes2710, planMajAnnonce, preparationSkool,
  resumer, texteAnnonceSkool, texteEntierSkool, versAnnonce,
} from '../src/lib/academie/annonces.ts'

let blocs = 0
const bloc = (nom, f) => { f(); blocs++; console.log(`ok  ${nom}`) }
const args = process.argv.slice(2)
const i = args.indexOf('--export')
const EXPORT = i >= 0 ? args[i + 1] : '/mnt/d/6_Societe/Pilotage/Data-Performance/platforms/skool/exports/2026-11-07/posts/brice-annonces.json'
const j = args.indexOf('--brut')
const BRUT = j >= 0 ? args[j + 1] : '/mnt/d/6_Societe/Pilotage/Data-Performance/platforms/skool/raw/2026-11-07/skool-posts-2026-11-07.json'

bloc('categories : des titres types', () => {
  const cas = {
    'Le Carnet du Trader — Release v1.6.5': 'apps',
    'Trading Notes v1.0.8 - Release Note': 'apps',
    "🗺️ Roadmap — Journal d'Études ": 'apps',
    "Les Échos de l'Académie | Mai 2026 | Vol. 08": 'echos',
    'Mais où est passé notre monthly news ?': 'echos',
    'Live Beat The Propfirm': 'lives',
    'Replay masterclass': 'lives',
    'FAQ Jeudi 5 Février.': 'lives',
    'Planning Liveclub S31': 'lives',
    'Promo topstep (rare) ': 'partenaires',
    "-90% Phidias jusqu'à 16h.": 'partenaires',
    'Message de Vigilance important ⚠️': 'marches',
    'Update du marché ': 'marches',
    'Bienvenue dans notre nouvelle maison': 'academie',
    'Clarification des niveaux (Classroom)': 'academie',
    'Notre temps sur skool est compté ! ': 'academie',
  }
  for (const [t, c] of Object.entries(cas)) assert.equal(categorieDe(t), c, t)
})

bloc('texte : echappements Skool retires, asterisques gardes', () => {
  assert.equal(desechapper('Petit à petit \\(update\\) \\- fin\\.'), 'Petit à petit (update) - fin.')
  assert.equal(desechapper('**gras** et \\*'), '**gras** et \\*')
})

bloc('texte : images en WebP seules sur leur ligne, PDF en ressources, echecs sautes', () => {
  assert.deepEqual(fichierPublie('images/x/01-IMG_6182.png'), { nom: '01-IMG_6182.webp', image: true })
  assert.deepEqual(fichierPublie('images/x/02-Keybo.gif'), { nom: '02-Keybo.webp', image: true })
  assert.deepEqual(fichierPublie('images/x/03-Plan été.pdf'), { nom: '03-Plan-ete.pdf', image: false })
  assert.equal(fichierPublie('images/x/sans-extension'), null)
  const t = texteAnnonceSkool('Bonjour \\(tous\\)\r\nLigne 2', 'mon-post', [
    { fichier: 'images/mon-post/01-a.png', telechargement: 'ok' },
    { fichier: 'images/mon-post/02-b.gif', telechargement: 'echec' },
    { fichier: 'images/mon-post/03-c.pdf', nom_origine: 'Le plan.pdf', telechargement: 'ok' },
  ], '/media/academie/annonces/')
  assert.equal(t.contenu, "Bonjour (tous)\nLigne 2\n\n![Image 1 de l'annonce](/media/academie/annonces/mon-post/01-a.webp)")
  assert.deepEqual(t.ressources, [{ titre: 'Le plan.pdf', url: '/media/academie/annonces/mon-post/03-c.pdf' }])
  assert.equal(t.images, 1)
})

bloc('route : une annonce Skool, un billet du cockpit, rien d autre ne sort', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111', publie_le: new Date('2026-10-14T07:35:15Z'), origine: 'skool', categorie: 'academie',
    epingle_le: null, youtube_id: null, titre: 'T', contenu: 'C', type: 'texte', ressources: [{ titre: 'p', url: '/media/x.pdf' }, { titre: 'q', url: 'https://x', protege: true }],
    lecon_slug: 'l', lecon_statut: 'archive', module_slug: 'annonces-skool', non_lue: true, cree_par: 'secret',
  }
  const a = versAnnonce(base)
  assert.deepEqual(Object.keys(a).sort(), ['categorie', 'contenu', 'epingle', 'id', 'lien', 'non_lue', 'origine', 'publie_le', 'ressources', 'titre', 'video'])
  assert.equal(a.non_lue, false, 'une annonce Skool n est jamais non lue')
  assert.equal(a.lien, null)
  assert.deepEqual(a.ressources, [{ titre: 'p', url: '/media/x.pdf' }])
  const b = versAnnonce({ ...base, origine: 'cockpit', categorie: null, lecon_statut: 'publie', module_slug: 'chroniques-de-l-accelerateur', type: 'video', epingle_le: new Date() })
  assert.equal(b.non_lue, true)
  assert.equal(b.lien, '/academie/chroniques-de-l-accelerateur/l')
  assert.deepEqual(b.video, { hebergeur: 'lecon' })
  assert.equal(b.epingle, true)
  assert.equal(versAnnonce({ ...base, categorie: 'inconnue' }).categorie, null)
  const r = resumer([b, a])
  assert.equal(r.non_lues, 1)
  assert.deepEqual(Object.keys(r.derniere).sort(), ['id', 'non_lue', 'origine', 'publie_le', 'titre'])
  assert.equal(r.dernieres.length, 2)
  assert.deepEqual(r.dernieres.map(x => x.id), [b.id, a.id])
  assert.equal(resumer([b, a, a, a, a]).dernieres.length, 3, "la barre en montre 3 au plus")
  assert.deepEqual(resumer([]), { non_lues: 0, derniere: null, dernieres: [] })
})

bloc('POST : corps des vues', () => {
  const id = '22222222-2222-4222-8222-222222222222'
  assert.deepEqual(lireVues({ vues: [id, id.toUpperCase()] }), [id])
  assert.equal(lireVues({ vues: [] }), null)
  assert.equal(lireVues({ vues: ['x'] }), null)
  assert.equal(lireVues({ vues: Array.from({ length: MAX_VUES + 1 }, () => id) }), null)
  assert.equal(lireVues(null), null)
})

bloc('--maj (13/11, correctif) : ids Skool lus, texte entier du brut, plan par annonce', () => {
  const a = 'afd30a4bb21e423f927cf9c540f6cf4a'
  const b = '9a36bda27bbc4cecac74475ba7872326'
  assert.deepEqual(lireIdsSkool(`${a}, skool:${b},${a.toUpperCase()}`), [a, b])
  for (const faux of ['', ' , ', 'abc', `${a},x`, `skool:${a}1`, null, undefined]) assert.equal(lireIdsSkool(faux), null, String(faux))
  const brut = { details_brice: { [a]: { post: { id: a, metadata: { content: 'Entier' } } }, [b]: { post: { id: 'autre', metadata: { content: 'x' } } } } }
  assert.equal(texteEntierSkool(brut, a), 'Entier')
  assert.equal(texteEntierSkool(brut, b), null, 'id de la page different : refuse')
  assert.equal(texteEntierSkool(brut, 'inconnu'), null)
  assert.equal(texteEntierSkool(null, a), null)
  const coupe = 'Debut \\(1\\)\r\nSuite'
  const entier = 'Debut \\(1\\)\r\nSuite\r\n\r\nLa fin qui manquait.'
  const pieces = [{ fichier: 'images/p/01-a.png', telechargement: 'ok' }]
  const tc = texteAnnonceSkool(coupe, 'p', pieces, '/media/academie/annonces').contenu
  const te = texteAnnonceSkool(entier, 'p', pieces, '/media/academie/annonces').contenu
  assert.equal(te, "Debut (1)\nSuite\n\nLa fin qui manquait.\n\n![Image 1 de l'annonce](/media/academie/annonces/p/01-a.webp)", 'meme chaine, memes images a la fin')
  assert.deepEqual(planMajAnnonce(tc, coupe, entier, tc, te), { action: 'maj' })
  assert.deepEqual(planMajAnnonce(te, coupe, entier, tc, te), { action: 'a_jour' }, 'rejouable')
  assert.equal(planMajAnnonce(`${tc} (corrige a la main)`, coupe, entier, tc, te).action, 'refus', 'texte modifie depuis l import : on n y touche pas')
  assert.equal(planMajAnnonce(null, coupe, entier, tc, te).action, 'refus')
  assert.equal(planMajAnnonce(tc, coupe, 'Un autre post', tc, te).action, 'refus', 'le texte entier doit prolonger le texte coupe')
  assert.equal(planMajAnnonce(tc, coupe, coupe, tc, tc).action, 'refus', 'pas plus long : rien a completer')
})

bloc('--maj : la preparation du texte coupe (tel quel le 07/11, nettoyage des notes de version le 27/10)', () => {
  const fil = 'v1.0.7 \\(Actuelle\\)\r\n[ul][li]Capture[/li][/ul]\n---\nMerci [@Melanie S](obj://user/f7ad3071ec9b4516bbf11cde721a206f) !'
  assert.equal(nettoyageNotes2710(fil), 'v1.0.7 (Actuelle)\nCapture\n\nMerci @Melanie S !')
  assert.equal(preparationSkool(fil, fil), 'brut')
  assert.equal(preparationSkool(nettoyageNotes2710(fil), fil), 'notes-27-10')
  assert.equal(preparationSkool('Autre chose', fil), null, 'on ne devine pas')
  assert.equal(preparationSkool('', ''), null)
  // Une ligne qui commence par deux tirets mais porte du texte n'est pas videe.
  assert.equal(nettoyageNotes2710('a\n-- b\n---\nc'), 'a\n-- b\n\nc')
})

if (existsSync(EXPORT) && existsSync(BRUT)) {
  bloc('export + brut du 07/11 : les annonces coupees, leur texte entier prolonge le texte du fil', () => {
    const posts = JSON.parse(readFileSync(EXPORT, 'utf8'))
    const brut = JSON.parse(readFileSync(BRUT, 'utf8'))
    let coupees = 0
    for (const p of posts) {
      const entier = texteEntierSkool(brut, p.id)
      if (!entier || entier.length <= (p.contenu ?? '').length) continue
      coupees++
      const pieces = Array.isArray(p.pieces_jointes) ? p.pieces_jointes : []
      const tc = texteAnnonceSkool(p.contenu, p.slug, pieces, '/media/academie/annonces')
      const te = texteAnnonceSkool(entier, p.slug, pieces, '/media/academie/annonces')
      assert.deepEqual(planMajAnnonce(tc.contenu, p.contenu, entier, tc.contenu, te.contenu), { action: 'maj' }, p.slug)
      assert.deepEqual(te.ressources, tc.ressources, `${p.slug} : memes PDF`)
      assert.equal(te.images, tc.images, `${p.slug} : memes images`)
      if (args.includes('--liste')) console.log(`    ${p.id} ${p.slug} ${tc.contenu.length} -> ${te.contenu.length}`)
    }
    assert.equal(coupees, 16, `16 annonces coupees attendues, ${coupees} trouvees`)
    console.log('    16 annonces coupees, toutes completables')
  })
} else console.log(`(export ou brut absent, bloc des annonces coupees saute)`)

if (existsSync(EXPORT)) {
  bloc('export : les 75 titres ont une categorie', () => {
    const posts = JSON.parse(readFileSync(EXPORT, 'utf8'))
    assert.equal(posts.length, 75)
    const par = {}
    for (const p of posts) {
      const c = categorieDe(p.titre)
      par[c] = (par[c] ?? 0) + 1
      if (args.includes('--liste')) console.log(`    ${c.padEnd(12)} ${p.titre}`)
    }
    console.log(`    ${JSON.stringify(par)}`)
  })
} else console.log(`(export absent : ${EXPORT}, bloc saute)`)

console.log(`\n${blocs} blocs ok.`)
