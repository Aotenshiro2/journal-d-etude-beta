// Verifie les abonnements aux emails (31/10/2026) hors ligne, sans base ni
// Kit : la logique (src/lib/kit-abonnements-pur.ts) avec un faux Kit et un
// faux depot, le client Kit (src/lib/kit.ts) avec un faux fetch, la liste
// des choix (src/lib/kit-choix.ts), et relit les routes pour les garde-fous.
//
//   node scripts/verifier-kit-abonnements.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHOIX_KIT, CLE_NEWSLETTER_HEBDO, TAG_CONSENTEMENT_PUB } from '../src/lib/kit-choix.ts'
import { ErreurKit, clientKit } from '../src/lib/kit.ts'
import {
  choixAffiches, enregistrerAbonnements, etatDe, lireAbonnements, lireDemande, tagsInscription,
} from '../src/lib/kit-abonnements-pur.ts'

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

const tagDe = cle => CHOIX_KIT.find(c => c.cle === cle).tag
const HEBDO = tagDe('newsletter_hebdo'), MONTHLY = tagDe('monthly_news'), CONSEILS = tagDe('conseils_semaine')
const OFFRES = tagDe('nos_offres'), PROMOS = tagDe('partenaires')
const U = 'compte-u', V = 'compte-v'

function fauxKit() {
  const abonnes = new Map()
  const appels = []
  let prochain = 1000
  const vue = a => ({ id: a.id, email: a.email, etat: a.etat, prenom: a.prenom })
  const trouver = email => [...abonnes.values()].find(a => a.email.toLowerCase() === email.toLowerCase()) ?? null
  return {
    abonnes, appels,
    ajouter(email, etat = 'active', tags = []) {
      const a = { id: prochain++, email, etat, prenom: null, tags: new Set(tags) }
      abonnes.set(a.id, a)
      return a.id
    },
    tags: id => [...abonnes.get(id).tags].sort(),
    async abonneParEmail(email) { appels.push('recherche'); const a = trouver(email); return a ? vue(a) : null },
    async abonne(id) { appels.push('abonne'); const a = abonnes.get(id); return a ? vue(a) : null },
    async creerAbonne(email, prenom) {
      appels.push('creation')
      const deja = trouver(email)
      if (deja) return { abonne: vue(deja), cree: false }
      const a = { id: prochain++, email, etat: 'active', prenom, tags: new Set() }
      abonnes.set(a.id, a)
      return { abonne: vue(a), cree: true }
    },
    async changerEmail(id, email) {
      appels.push('adresse')
      const autre = trouver(email)
      if (autre && autre.id !== id) return 'pris'
      abonnes.get(id).email = email
      return 'ok'
    },
    async tagsDe(id) { appels.push('tags'); return [...abonnes.get(id).tags] },
    async poserTag(tag, id) { appels.push(`+${tag}`); abonnes.get(id).tags.add(tag) },
    async retirerTag(tag, id) { appels.push(`-${tag}`); abonnes.get(id)?.tags.delete(tag) },
    async desinscrire(id) { appels.push(`desinscrire ${id}`); abonnes.get(id).etat = 'cancelled' },
  }
}

function fauxDepot(adresses) {
  const liens = new Map()
  const consentements = []
  return {
    liens, consentements, adresses,
    async adresse(u) { return adresses.get(u) ?? null },
    async prenom() { return 'Lucas' },
    async lien(u) { return liens.get(u) ?? null },
    async lier(u, k) {
      for (const [v, kk] of liens) if (kk === k && v !== u) return false
      liens.set(u, k)
      return true
    },
    async delier(u) { liens.delete(u) },
    async consentir(u, lignes) { for (const l of lignes) consentements.push({ u, ...l }) },
  }
}

const monde = (adresses = { [U]: 'lucas@exemple.fr' }) => {
  const kit = fauxKit()
  const depot = fauxDepot(new Map(Object.entries(adresses)))
  return { kit, depot, d: { kit, depot, choix: CHOIX_KIT } }
}
const actifs = r => r.abonnements.choix.filter(c => c.actif).map(c => c.cle)
const ecritures = kit => kit.appels.filter(a => /^[+-]|creation|adresse|desinscrire/.test(a))

// ------------------------------------------------------------------ la liste des choix

await bloc('choix : cles et tags uniques, cles stables lisibles par le journal des consentements', () => {
  assert.ok(CHOIX_KIT.length >= 4)
  assert.equal(new Set(CHOIX_KIT.map(c => c.cle)).size, CHOIX_KIT.length)
  assert.equal(new Set(CHOIX_KIT.map(c => c.tag)).size, CHOIX_KIT.length)
  for (const c of CHOIX_KIT) {
    assert.match(c.cle, /^[a-z][a-z0-9_]{1,39}$/) // = profile_consentements_type_ck
    assert.ok(Number.isInteger(c.tag) && c.tag > 0)
    assert.ok(c.libelle.trim() && c.detail.trim())
    // Tirets longs, espaces insecables, guillemets courbes, points de suspension en un caractere.
    const interdits = [0x2013, 0x2014, 0xa0, 0x202f, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026].map(x => String.fromCharCode(x))
    assert.ok(!interdits.some(x => (c.libelle + c.detail).includes(x)), `typographie : ${c.cle}`)
  }
})

await bloc('choix : decisions de Brice (5 choix, 4 coches a l inscription, partenaires decoches, rattrapage partenaires aux seuls consentants)', () => {
  assert.equal(CHOIX_KIT.length, 5)
  assert.deepEqual(tagsInscription(CHOIX_KIT), [25238321, 25238322, 25238323, 25238607])
  const partenaires = CHOIX_KIT.find(c => c.tag === 25238324)
  assert.equal(partenaires.cle, 'partenaires')
  assert.equal(partenaires.inscription, false)
  assert.deepEqual(partenaires.rattrapage, { tagRequis: TAG_CONSENTEMENT_PUB })
  assert.equal(TAG_CONSENTEMENT_PUB, 11576519)
  for (const c of CHOIX_KIT.filter(x => x.tag !== 25238324)) assert.deepEqual(c.rattrapage, { tagRequis: null })
  assert.equal(CHOIX_KIT.find(c => c.cle === CLE_NEWSLETTER_HEBDO).tag, 25238321)
  assert.equal(OFFRES, 25238607)
})

await bloc('choix : un choix de plus passe partout sans autre code (demande, affichage, inscription)', () => {
  const plus = [...CHOIX_KIT, { cle: 'essai_choix', tag: 99, libelle: 'Essai', detail: 'x', inscription: true, rattrapage: { tagRequis: null } }]
  assert.deepEqual(lireDemande({ choix: { essai_choix: true } }, plus), { essai_choix: true })
  assert.equal(choixAffiches(plus, [99]).find(c => c.cle === 'essai_choix').actif, true)
  assert.ok(tagsInscription(plus).includes(99))
})

// ------------------------------------------------------------------ la demande

await bloc('demande : cles connues, booleens, au moins une', () => {
  assert.deepEqual(lireDemande({ choix: { newsletter_hebdo: false } }, CHOIX_KIT), { newsletter_hebdo: false })
  assert.equal(lireDemande({ choix: { inconnue: true } }, CHOIX_KIT), null)
  assert.equal(lireDemande({ choix: { newsletter_hebdo: 'oui' } }, CHOIX_KIT), null)
  assert.equal(lireDemande({ choix: {} }, CHOIX_KIT), null)
  assert.equal(lireDemande({ choix: [true] }, CHOIX_KIT), null)
  assert.equal(lireDemande(null, CHOIX_KIT), null)
  assert.equal(lireDemande({ choix: { __proto__: { newsletter_hebdo: true } } }, CHOIX_KIT), null)
})

await bloc('etat : actif, desinscrit (cancelled, bounced, complained), inactif, absent', () => {
  assert.equal(etatDe(null), 'absent')
  assert.equal(etatDe({ etat: 'active' }), 'actif')
  for (const e of ['cancelled', 'bounced', 'complained']) assert.equal(etatDe({ etat: e }), 'desinscrit')
  assert.equal(etatDe({ etat: 'inactive' }), 'inactif')
})

// ------------------------------------------------------------------ lecture et choix

await bloc('lecture sans abonne Kit : absent, tout decoche, aucune ecriture chez Kit', async () => {
  const { kit, depot, d } = monde()
  const r = await lireAbonnements(d, U)
  assert.equal(r.ok, true)
  assert.equal(r.abonnements.etat, 'absent')
  assert.equal(r.abonnements.adresse, 'lucas@exemple.fr')
  assert.deepEqual(actifs(r), [])
  assert.deepEqual(ecritures(kit), [])
  assert.equal(depot.liens.size, 0)
})

await bloc('lecture : un abonne existant a cette adresse est relie au compte (resynchro lie)', async () => {
  const { kit, depot, d } = monde()
  const id = kit.ajouter('Lucas@Exemple.fr', 'active', [HEBDO, 4242])
  const r = await lireAbonnements(d, U)
  assert.equal(r.abonnements.resynchro, 'lie')
  assert.equal(depot.liens.get(U), id)
  assert.deepEqual(actifs(r), ['newsletter_hebdo'])
  assert.deepEqual(ecritures(kit), [])
})

await bloc('choix sans abonne : creation, un seul tag, consentement note ; tout decoche ne cree rien', async () => {
  const a = monde()
  const r0 = await enregistrerAbonnements(a.d, U, { newsletter_hebdo: false })
  assert.equal(r0.abonnements.etat, 'absent')
  assert.deepEqual(ecritures(a.kit), [])
  const r = await enregistrerAbonnements(a.d, U, { partenaires: true })
  assert.equal(r.ok, true)
  assert.equal(r.abonnements.etat, 'actif')
  assert.deepEqual(actifs(r), ['partenaires'])
  assert.deepEqual(ecritures(a.kit), ['creation', `+${PROMOS}`])
  assert.deepEqual(a.depot.consentements.map(c => [c.type, c.valeur, c.source]), [['partenaires', true, 'mon_espace']])
})

await bloc('choix : seules les cles demandees changent, un consentement par changement reel', async () => {
  const { kit, depot, d } = monde()
  const id = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO, MONTHLY, CONSEILS])
  const r = await enregistrerAbonnements(d, U, { newsletter_hebdo: true, monthly_news: false })
  assert.deepEqual(actifs(r), ['newsletter_hebdo', 'conseils_semaine'])
  assert.deepEqual(kit.tags(id), [CONSEILS, HEBDO].sort())
  assert.deepEqual(depot.consentements.map(c => [c.type, c.valeur]), [['monthly_news', false]])
})

await bloc('tout desactiver : les tags des choix partent, les autres tags restent, jamais de desinscription', async () => {
  const { kit, d } = monde()
  const id = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO, MONTHLY, CONSEILS, PROMOS, 4242])
  const tout = Object.fromEntries(CHOIX_KIT.map(c => [c.cle, false]))
  const r = await enregistrerAbonnements(d, U, tout)
  assert.deepEqual(actifs(r), [])
  assert.equal(r.abonnements.etat, 'actif')
  assert.deepEqual(kit.tags(id), [4242])
  assert.ok(!kit.appels.some(x => x.startsWith('desinscrire')))
  const re = await enregistrerAbonnements(d, U, { newsletter_hebdo: true })
  assert.deepEqual(actifs(re), ['newsletter_hebdo'])
})

await bloc('desinscrit chez Kit : etat desinscrit, les choix s enregistrent, pas de reabonnement force', async () => {
  const { kit, d } = monde()
  kit.ajouter('lucas@exemple.fr', 'cancelled', [])
  const r = await enregistrerAbonnements(d, U, { newsletter_hebdo: true })
  assert.equal(r.abonnements.etat, 'desinscrit')
  assert.deepEqual(actifs(r), ['newsletter_hebdo'])
  assert.ok(!kit.appels.includes('creation'))
})

await bloc('compte sans adresse : lecture vide, choix refuse (adresse)', async () => {
  const { d } = monde({})
  const r = await lireAbonnements(d, U)
  assert.equal(r.abonnements.adresse, null)
  assert.deepEqual(await enregistrerAbonnements(d, U, { newsletter_hebdo: true }), { ok: false, erreur: 'adresse' })
})

// ------------------------------------------------------------------ changement d'adresse

await bloc('adresse changee, nouvelle adresse inconnue de Kit : meme abonne, nouvelle adresse, tags gardes', async () => {
  const { kit, depot, d } = monde()
  const id = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO, PROMOS])
  await lireAbonnements(d, U)
  depot.adresses.set(U, 'lucas.trading@exemple.fr')
  const r = await lireAbonnements(d, U)
  assert.equal(r.abonnements.resynchro, 'adresse')
  assert.equal(depot.liens.get(U), id)
  assert.equal(kit.abonnes.get(id).email, 'lucas.trading@exemple.fr')
  assert.equal(kit.abonnes.size, 1)
  assert.deepEqual(actifs(r), ['newsletter_hebdo', 'partenaires'])
  const encore = await lireAbonnements(d, U)
  assert.equal(encore.abonnements.resynchro, 'non')
})

await bloc('adresse changee vers un AUTRE abonne Kit : on le garde, choix recopies, ancien desinscrit, compte relie', async () => {
  const { kit, depot, d } = monde()
  const ancien = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO, CONSEILS, 4242])
  const autre = kit.ajouter('lucas.trading@exemple.fr', 'active', [MONTHLY, PROMOS, 777])
  await lireAbonnements(d, U)
  depot.adresses.set(U, 'lucas.trading@exemple.fr')
  const r = await lireAbonnements(d, U)
  assert.equal(r.abonnements.resynchro, 'fusion')
  assert.equal(depot.liens.get(U), autre)
  assert.deepEqual(kit.tags(autre), [777, HEBDO, CONSEILS].sort())
  assert.equal(kit.abonnes.get(ancien).etat, 'cancelled')
  assert.equal(kit.abonnes.get(ancien).email, 'lucas@exemple.fr')
  assert.deepEqual(actifs(r), ['newsletter_hebdo', 'conseils_semaine'])
  assert.deepEqual(depot.consentements.map(c => [c.type, c.valeur, c.source]).sort(), [
    ['conseils_semaine', true, 'changement_adresse'], ['monthly_news', false, 'changement_adresse'],
    ['newsletter_hebdo', true, 'changement_adresse'], ['partenaires', false, 'changement_adresse'],
  ])
})

await bloc('fusion refusee si l autre abonne est lie a un autre compte : rien ne bouge, personne desinscrit', async () => {
  const { kit, depot, d } = monde({ [U]: 'lucas@exemple.fr', [V]: 'lea@exemple.fr' })
  const ancien = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO])
  const autre = kit.ajouter('lea@exemple.fr', 'active', [PROMOS])
  await lireAbonnements(d, U)
  await lireAbonnements(d, V)
  depot.adresses.set(U, 'lea@exemple.fr')
  assert.deepEqual(await lireAbonnements(d, U), { ok: false, erreur: 'conflit' })
  assert.equal(depot.liens.get(U), ancien)
  assert.equal(depot.liens.get(V), autre)
  assert.deepEqual(kit.tags(autre), [PROMOS])
  assert.ok(!kit.appels.some(x => x.startsWith('desinscrire')))
})

await bloc('course : Kit refuse le changement d adresse (prise entre-temps), on fusionne', async () => {
  const { kit, depot, d } = monde()
  const ancien = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO])
  await lireAbonnements(d, U)
  depot.adresses.set(U, 'lucas.trading@exemple.fr')
  const vraiRecherche = kit.abonneParEmail
  let premiere = true
  kit.abonneParEmail = async email => {
    if (premiere) { premiere = false; kit.ajouter('lucas.trading@exemple.fr', 'active', []); return null }
    return vraiRecherche(email)
  }
  const r = await lireAbonnements(d, U)
  assert.equal(r.abonnements.resynchro, 'fusion')
  assert.notEqual(depot.liens.get(U), ancien)
  assert.equal(kit.abonnes.get(ancien).etat, 'cancelled')
})

await bloc('abonne lie supprime chez Kit : lien efface, on repart de l adresse', async () => {
  const { kit, depot, d } = monde()
  const id = kit.ajouter('lucas@exemple.fr', 'active', [HEBDO])
  await lireAbonnements(d, U)
  kit.abonnes.delete(id)
  const r = await lireAbonnements(d, U)
  assert.equal(r.abonnements.etat, 'absent')
  assert.equal(depot.liens.has(U), false)
})

await bloc('le compte d un autre abonne lie refuse la liaison (conflit), sans ecriture', async () => {
  const { kit, depot, d } = monde({ [U]: 'lea@exemple.fr', [V]: 'lea@exemple.fr' })
  kit.ajouter('lea@exemple.fr', 'active', [])
  await lireAbonnements(d, V)
  assert.deepEqual(await enregistrerAbonnements(d, U, { newsletter_hebdo: true }), { ok: false, erreur: 'conflit' })
  assert.deepEqual(ecritures(kit), [])
  assert.equal(depot.liens.has(U), false)
})

// ------------------------------------------------------------------ le client Kit (faux fetch)

await bloc('client Kit : en-tete, recherche par adresse (status=all), 422 = pris, 404 du retrait toleres, erreurs sans adresse', async () => {
  const vus = []
  const reponses = []
  const f = async (url, init) => {
    vus.push({ url, init })
    const [statut, corps] = reponses.shift()
    return new Response(corps === null ? null : JSON.stringify(corps), { status: statut })
  }
  const k = clientKit('cle-de-test', f)
  reponses.push([200, { subscribers: [{ id: 5, email_address: 'Lucas@Exemple.fr', state: 'active', first_name: null }] }])
  assert.deepEqual(await k.abonneParEmail('lucas@exemple.fr'), { id: 5, email: 'Lucas@Exemple.fr', etat: 'active', prenom: null })
  const u = new URL(vus[0].url)
  assert.equal(u.origin + u.pathname, 'https://api.kit.com/v4/subscribers')
  assert.equal(u.searchParams.get('status'), 'all')
  assert.equal(vus[0].init.headers['X-Kit-Api-Key'], 'cle-de-test')
  reponses.push([422, { errors: ['Email address has already been taken'] }])
  assert.equal(await k.changerEmail(5, 'pris@exemple.fr'), 'pris')
  reponses.push([404, null])
  await k.retirerTag(HEBDO, 5)
  reponses.push([404, null])
  assert.equal(await k.abonne(5), null)
  reponses.push([201, { subscriber: { id: 9, email_address: 'n@exemple.fr', state: 'active', first_name: 'N' } }])
  assert.deepEqual(await k.creerAbonne('n@exemple.fr', 'N'), { abonne: { id: 9, email: 'n@exemple.fr', etat: 'active', prenom: 'N' }, cree: true })
  reponses.push([500, { error: 'boom pour n@exemple.fr' }])
  const e = await k.tagsDe(9).catch(x => x)
  assert.ok(e instanceof ErreurKit && e.statut === 500)
  assert.ok(!e.message.includes('@'))
})

// ------------------------------------------------------------------ relecture des routes

await bloc('routes : Bearer obligatoire, GET et POST, CORS de l academie, aucune adresse dans les logs', () => {
  const route = lire('src/app/api/compte/abonnements/route.ts')
  assert.match(route, /compteDuJeton\(req\)/)
  assert.match(route, /export async function GET/)
  assert.match(route, /export async function POST/)
  assert.match(route, /'GET, POST, OPTIONS'/)
  assert.match(route, /lireDemande\(corps, CHOIX_KIT\)/)
  for (const f of ['src/lib/kit.ts', 'src/lib/kit-abonnements.ts', 'src/app/api/compte/abonnements/route.ts', 'src/app/api/newsletter/subscribe/route.ts']) {
    for (const ligne of lire(f).split('\n').filter(l => /console\.(log|warn|error)/.test(l))) {
      assert.ok(!/\$\{(adresse|email|r\.adresse)|, email\)|texte|text\)/.test(ligne), `log suspect dans ${f}`)
    }
  }
})

await bloc('inscription : les choix « inscription » seulement, et seulement pour un abonne NOUVEAU', () => {
  const s = lire('src/app/api/newsletter/subscribe/route.ts')
  assert.match(s, /if \(cree\)/)
  assert.match(s, /tagsInscription\(CHOIX_KIT\)/)
})

console.log(`\n${n} blocs ok`)
