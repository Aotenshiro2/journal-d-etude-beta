// Verifie les choix par defaut des inscrits par formulaire Kit (31/10/2026)
// hors ligne, sans base ni Kit : src/lib/kit-defauts-pur.ts (secret du
// chemin, lecture d'un webhook, regle « vierge », filet) avec un faux Kit et
// une fausse garde, la liste des recents du client Kit (faux fetch), et relit
// la route, le cron, le middleware et vercel.json.
//
//   node scripts/verifier-kit-defauts.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHOIX_KIT } from '../src/lib/kit-choix.ts'
import { clientKit } from '../src/lib/kit.ts'
import {
  FILET_HEURES, WEBHOOK_MAX_ABONNES, cheminSecret, debutDuFilet, filetDefauts, idsDuWebhook, poserDefautsSiVierge,
  secretCorrespond, traiterAbonnes,
} from '../src/lib/kit-defauts-pur.ts'

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

const DEFAUTS = CHOIX_KIT.filter(c => c.inscription).map(c => c.tag).sort()
const PARTENAIRES = CHOIX_KIT.find(c => !c.inscription).tag

function fauxKit(abonnes) {
  const ecritures = []
  return {
    ecritures,
    async abonne(id) { const a = abonnes.get(id); if (a?.erreur) throw new Error('kit 500'); return a ? { id, email: 'x@exemple.fr', etat: a.etat, prenom: null } : null },
    async tagsDe(id) { return [...abonnes.get(id).tags] },
    async poserTag(tag, id) { ecritures.push(`+${tag}@${id}`); abonnes.get(id).tags.add(tag) },
    async abonnesActifsCreesDepuis(depuis) {
      return [...abonnes].filter(([, a]) => a.etat === 'active' && Date.parse(a.cree) >= depuis.getTime()).map(([id, a]) => ({ id, creeLe: a.cree }))
    },
  }
}
const garde = membres => ({ async ecarte(id) { return membres.has(id) } })
const deps = (abonnes, membres = new Set()) => {
  const kit = fauxKit(abonnes)
  return { kit, d: { kit, garde: garde(membres), choix: CHOIX_KIT } }
}
const ab = (etat, tags = [], cree = '2026-11-01T10:00:00Z') => ({ etat, tags: new Set(tags), cree })

// ------------------------------------------------------------------ le secret du chemin

await bloc('secret du chemin : 40 hexadecimaux, stable, propre a la cle serveur', () => {
  const a = cheminSecret('cle-serveur-de-test-assez-longue-0123456789')
  assert.match(a, /^[0-9a-f]{40}$/)
  assert.equal(cheminSecret('cle-serveur-de-test-assez-longue-0123456789'), a)
  assert.notEqual(cheminSecret('une-autre-cle-serveur-de-test-0123456789'), a)
  assert.equal(secretCorrespond(a, a), true)
  assert.equal(secretCorrespond(a.slice(0, 39) + (a[39] === '0' ? '1' : '0'), a), false)
  assert.equal(secretCorrespond(a.slice(0, 20), a), false)
  assert.equal(secretCorrespond('', a), false)
})

// ------------------------------------------------------------------ le corps du webhook

await bloc('webhook : seul l id de l abonne est lu (format historique et format endpoints)', () => {
  assert.deepEqual(idsDuWebhook({ subscriber: { id: 42, email_address: 'x@exemple.fr', state: 'active' } }), [42])
  assert.deepEqual(idsDuWebhook({
    delivery_id: 1,
    events: [
      { type: 'subscriber.subscribed_to_form', data: { subscriber: { id: 7 }, form: { id: 9317717 } } },
      { type: 'subscriber.created', data: { subscriber: { id: 8 } } },
      { type: 'subscriber.subscribed_to_form', data: { subscriber: { id: 7 } } },
    ],
  }), [7])
  for (const mauvais of [null, 'texte', [], {}, { subscriber: { id: '42' } }, { subscriber: { id: -1 } }, { subscriber: { id: 1.5 } }, { subscriber: 42 }]) {
    assert.deepEqual(idsDuWebhook(mauvais), [])
  }
  const beaucoup = { events: Array.from({ length: 150 }, (_, i) => ({ type: 'subscriber.subscribed_to_form', data: { subscriber: { id: i + 1 } } })) }
  assert.equal(idsDuWebhook(beaucoup).length, WEBHOOK_MAX_ABONNES)
})

// ------------------------------------------------------------------ la regle

await bloc('vierge et actif : les choix par defaut, pas les offres de partenaires', async () => {
  const abonnes = new Map([[1, ab('active')]])
  const { kit, d } = deps(abonnes)
  assert.equal(await poserDefautsSiVierge(d, 1), 'pose')
  assert.deepEqual([...abonnes.get(1).tags].sort(), DEFAUTS)
  assert.ok(!abonnes.get(1).tags.has(PARTENAIRES))
  assert.equal(kit.ecritures.length, DEFAUTS.length)
})

await bloc('idempotent : un second passage ne pose rien', async () => {
  const abonnes = new Map([[1, ab('active')]])
  const { kit, d } = deps(abonnes)
  await poserDefautsSiVierge(d, 1)
  const avant = kit.ecritures.length
  assert.equal(await poserDefautsSiVierge(d, 1), 'deja_choisi')
  assert.equal(kit.ecritures.length, avant)
})

await bloc('un seul tag « Choix », meme les offres de partenaires seules : on ne touche a rien', async () => {
  for (const tag of CHOIX_KIT.map(c => c.tag)) {
    const abonnes = new Map([[1, ab('active', [tag, 4242])]])
    const { kit, d } = deps(abonnes)
    assert.equal(await poserDefautsSiVierge(d, 1), 'deja_choisi')
    assert.deepEqual(kit.ecritures, [])
  }
})

await bloc('des tags hors « Choix » ne comptent pas : l abonne reste vierge', async () => {
  const abonnes = new Map([[1, ab('active', [4242, 11576519])]])
  const { d } = deps(abonnes)
  assert.equal(await poserDefautsSiVierge(d, 1), 'pose')
})

await bloc('membre qui a regle ses choix (relie ou mon_espace) : jamais recoche, meme sans aucun tag', async () => {
  const abonnes = new Map([[1, ab('active')]])
  const { kit, d } = deps(abonnes, new Set([1]))
  assert.equal(await poserDefautsSiVierge(d, 1), 'membre')
  assert.deepEqual(kit.ecritures, [])
})

await bloc('pas actif (desinscrit, en attente de confirmation, rejete) ou absent : rien', async () => {
  for (const etat of ['cancelled', 'inactive', 'bounced', 'complained']) {
    const abonnes = new Map([[1, ab(etat)]])
    const { kit, d } = deps(abonnes)
    assert.equal(await poserDefautsSiVierge(d, 1), 'inactif')
    assert.deepEqual(kit.ecritures, [])
  }
  const { d } = deps(new Map())
  assert.equal(await poserDefautsSiVierge(d, 99), 'absent')
})

await bloc('une erreur Kit sur un abonne n arrete pas les suivants', async () => {
  const abonnes = new Map([[1, { ...ab('active'), erreur: true }], [2, ab('active')], [3, ab('active', [DEFAUTS[0]])]])
  const { d } = deps(abonnes)
  const s = await traiterAbonnes(d, [1, 2, 3])
  assert.deepEqual(s, { vus: 3, pose: 1, absent: 0, inactif: 0, deja_choisi: 1, membre: 0, erreurs: 1 })
})

// ------------------------------------------------------------------ le filet

await bloc('filet : abonnes actifs des 72 dernieres heures seulement, meme regle', async () => {
  const maintenant = new Date('2026-11-07T05:00:00Z')
  assert.equal(FILET_HEURES, 72)
  assert.equal(debutDuFilet(maintenant).toISOString(), '2026-11-04T05:00:00.000Z')
  const abonnes = new Map([
    [1, ab('active', [], '2026-11-06T22:00:00Z')],
    [2, ab('active', [], '2026-11-01T22:00:00Z')],
    [3, ab('active', [], '2026-11-05T08:00:00Z')],
    [4, ab('cancelled', [], '2026-11-06T08:00:00Z')],
    [5, ab('active', [DEFAUTS[1]], '2026-11-06T09:00:00Z')],
  ])
  const { d } = deps(abonnes, new Set([3]))
  const s = await filetDefauts(d, debutDuFilet(maintenant))
  assert.deepEqual(s, { vus: 3, pose: 1, absent: 0, inactif: 0, deja_choisi: 1, membre: 1, erreurs: 0 })
  assert.equal(abonnes.get(2).tags.size, 0)
})

await bloc('client Kit : les recents par created_after (la veille) puis filtres a la seconde, pagines', async () => {
  const vus = []
  const pages = [
    { subscribers: [{ id: 1, created_at: '2026-11-04T04:59:59Z' }, { id: 2, created_at: '2026-11-04T05:00:00Z' }], pagination: { has_next_page: true, end_cursor: 'C1' } },
    { subscribers: [{ id: 3, created_at: '2026-11-06T10:00:00Z' }, { id: 'x', created_at: '2026-11-06T10:00:00Z' }], pagination: { has_next_page: false } },
  ]
  const f = async url => { vus.push(new URL(url)); return new Response(JSON.stringify(pages.shift()), { status: 200 }) }
  const r = await clientKit('cle-de-test', f).abonnesActifsCreesDepuis(new Date('2026-11-04T05:00:00Z'))
  assert.deepEqual(r.map(x => x.id), [2, 3])
  assert.equal(vus[0].searchParams.get('created_after'), '2026-11-03')
  assert.equal(vus[0].searchParams.get('status'), 'active')
  assert.equal(vus[1].searchParams.get('after'), 'C1')
})

// ------------------------------------------------------------------ relecture des branchements

await bloc('route du webhook : secret du chemin a temps constant (404 sinon), id seul, reponse avant le travail', () => {
  const r = lire('src/app/api/kit/webhook/[secret]/route.ts')
  assert.match(r, /secretCorrespond\(secret, attendu\)\) return NextResponse\.json\(\{ ok: false \}, \{ status: 404 \}\)/)
  assert.match(r, /idsDuWebhook\(corps\)/)
  assert.match(r, /after\(async/)
  assert.ok(!/console\.(log|warn)\([^)]*(email|corps|texte|secret)/.test(r))
  assert.match(lire('src/lib/kit-defauts.ts'), /SUPABASE_SERVICE_ROLE_KEY/)
})

await bloc('middleware : le webhook est public, le reste de /api/kit ne l est pas', () => {
  const m = lire('middleware.ts')
  assert.match(m, /'\/api\/kit\/webhook\/'/)
  assert.ok(!/'\/api\/kit\/'/.test(m))
})

await bloc('filet : cron 05:00 UTC (avant les envois de 07:00), garde CRON_SECRET, garde des membres en base', () => {
  const v = JSON.parse(lire('vercel.json'))
  assert.ok(v.crons.some(c => c.path === '/api/cron/kit-defauts' && c.schedule === '0 5 * * *'))
  assert.ok(v.crons.some(c => c.path === '/api/cron/liveclub'))
  assert.match(lire('src/app/api/cron/kit-defauts/route.ts'), /CRON_SECRET/)
  const g = lire('src/lib/kit-abonnements-depot.ts')
  assert.match(g, /from public\.profile_kit where kit_abonne_id = \$1::bigint/)
  assert.match(g, /source = 'mon_espace'/)
})

console.log(`\n${n} blocs ok`)
