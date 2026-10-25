/**
 * ESSAI des images de Belrive deposees par ChatGPT (25/10/2026), contre la VRAIE base.
 *
 *   node scripts/essayer-images-belrive.mjs --migration
 *     La migration 20261025120000_cockpit_perso_images.sql dans UNE transaction TOUJOURS ANNULEE :
 *     jouee deux fois, contraintes, trigger qui fige la ligne, RLS (anon, compte hors perso, Brice),
 *     droits de service_role (lecture et rapatrie_le seulement), requetes EXACTES de requetes.ts.
 *     Puis on verifie que rien n'est reste (si la migration n'etait pas deja appliquee).
 *
 *   node scripts/essayer-images-belrive.mjs --bout-en-bout
 *     Une fois la migration appliquee : le vrai gestionnaire JSON-RPC (traiterPost) avec la vraie base
 *     et le vrai bucket (serveur.ts), cle factice : tools/list, deposer_image en base64, le meme
 *     depot une seconde fois (dedoublonne), deposer_image par une vraie url https, lister_documents,
 *     l'URL signee de Tab (lue, octets compares). Puis TOUT est retire : lignes et objets du bucket.
 *
 * Lancement (apps/journal-d-etude, .env.local charge). N'affiche aucune cle.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import './resoudre-ts.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FICHIER = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261025120000_cockpit_perso_images.sql')
const mode = process.argv[2]
if (!['--migration', '--bout-en-bout'].includes(mode)) {
  console.error('Usage : node scripts/essayer-images-belrive.mjs --migration | --bout-en-bout')
  process.exit(2)
}

// Aucun envoi Telegram ni email possible pendant l'essai.
delete process.env.TELEGRAM_BOT_TOKEN_COCKPIT
delete process.env.RESEND_API_KEY

const { PrismaClient } = await import('@prisma/client')
const I = await import('../src/lib/mcp-gpt/images-pur.ts')
const R = await import('../src/lib/mcp-gpt/requetes.ts')

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
let ok = 0
const bloc = (t) => { ok++; console.log('ok ', t) }

function decouper(sql) {
  const ordres = []; let courant = ''; let tag = null; let i = 0
  while (i < sql.length) {
    if (!tag) {
      const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (dollar) { tag = dollar[0]; courant += tag; i += tag.length; continue }
      if (sql[i] === ';') { if (courant.trim()) ordres.push(courant.trim()); courant = ''; i += 1; continue }
    } else if (sql.startsWith(tag, i)) { courant += tag; i += tag.length; tag = null; continue }
    courant += sql[i]; i += 1
  }
  if (courant.trim()) ordres.push(courant.trim())
  return ordres
}

async function refuse(tx, nom, sql, ...valeurs) {
  await tx.$executeRawUnsafe('savepoint s')
  let refuse = false
  try { await tx.$executeRawUnsafe(sql, ...valeurs) } catch { refuse = true }
  await tx.$executeRawUnsafe('rollback to savepoint s')
  assert.ok(refuse, `devait etre refuse : ${nom}`)
}
async function commeRole(tx, role, uid, fn) {
  await tx.$executeRawUnsafe('savepoint r')
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid ?? '', role })}', true)`)
  await tx.$executeRawUnsafe(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', true)`)
  await tx.$executeRawUnsafe(`set local role ${role}`)
  let r, erreur = null
  try { r = await fn() } catch (e) { erreur = e }
  await tx.$executeRawUnsafe('rollback to savepoint r')
  await tx.$executeRawUnsafe('reset role')
  if (erreur) throw erreur
  return r
}

const p = new PrismaClient()

if (mode === '--migration') {
  const ORDRES = decouper(readFileSync(FICHIER, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n'))
    .filter((o) => !/^notify /i.test(o))
  const [{ existait }] = await p.$queryRawUnsafe(`select to_regclass('public.cockpit_perso_images') is not null as existait`)
  const ANNULER = new Error('annulation volontaire')
  try {
    await p.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`set local lock_timeout = '5s'`)
      for (let passe = 0; passe < 2; passe++) for (const o of ORDRES) await tx.$executeRawUnsafe(o)
      bloc(`migration jouee deux fois (${ORDRES.length} ordres), rejouable`)

      const [b] = await tx.$queryRawUnsafe(`select public, file_size_limit::int as limite, allowed_mime_types from storage.buckets where id = 'belrive-images'`)
      assert.equal(b.public, false); assert.equal(b.limite, I.IMAGE_MAX_OCTETS)
      assert.deepEqual([...b.allowed_mime_types].sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
      const pol = await tx.$queryRawUnsafe(`select count(*)::int n from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%belrive-images%' or with_check like '%belrive-images%')`)
      assert.equal(pol[0].n, 0)
      bloc('bucket belrive-images : prive, 8 Mo, quatre types, aucune policy sur storage.objects')

      // Les requetes EXACTES de requetes.ts.
      const e = I.empreinteOctets(PNG)
      const depot = { titre: 'Essai', role: 'essai annule', nomFichier: 'essai.png', chemin: I.cheminStockage(e, 'png'), mime: 'image/png', octets: PNG, empreinte: e, origine: 'base64' }
      const un = await R.insererImage(tx, depot)
      assert.ok(un && un.image_id && un.taille === PNG.length && un.origine === 'base64')
      assert.equal(await R.insererImage(tx, { ...depot, titre: 'Autre titre' }), null, 'meme empreinte : rien insere')
      assert.equal((await R.imageParEmpreinte(tx, e)).image_id, un.image_id)
      assert.equal((await R.lireImage(tx, un.image_id)).titre, 'Essai')
      assert.equal((await R.listerImages(tx, 200)).filter((x) => x.image_id === un.image_id).length, 1)
      bloc('requetes exactes : insertion, doublon ignore (on conflict), lecture par empreinte, par id, liste')

      const ins = (o) => `insert into public.cockpit_perso_images (titre, role, nom_fichier, chemin, mime, taille, empreinte, origine)
        values ('${o.titre ?? 't'}', '${o.role ?? 'r'}', '${o.nom ?? 'a.png'}', '${o.chemin}', '${o.mime ?? 'image/png'}', ${o.taille ?? 10}, '${o.empreinte}', '${o.origine ?? 'url'}')`
      const e2 = 'a'.repeat(64)
      const c2 = `belrive/aa/${e2}.png`
      await refuse(tx, 'chemin qui ne suit pas l empreinte', ins({ chemin: `belrive/bb/${'b'.repeat(64)}.png`, empreinte: e2 }))
      await refuse(tx, 'chemin hors belrive/', ins({ chemin: `autre/aa/${e2}.png`, empreinte: e2 }))
      await refuse(tx, 'nom avec dossier', ins({ chemin: c2, empreinte: e2, nom: '../x.png' }))
      await refuse(tx, 'nom en svg', ins({ chemin: c2, empreinte: e2, nom: 'x.svg' }))
      await refuse(tx, 'type svg', ins({ chemin: c2, empreinte: e2, mime: 'image/svg+xml' }))
      await refuse(tx, 'plus de 8 Mo', ins({ chemin: c2, empreinte: e2, taille: I.IMAGE_MAX_OCTETS + 1 }))
      await refuse(tx, 'origine inconnue', ins({ chemin: c2, empreinte: e2, origine: 'disque' }))
      await refuse(tx, 'role vide', ins({ chemin: c2, empreinte: e2, role: '' }))
      await refuse(tx, 'autre projet', `insert into public.cockpit_perso_images (projet, titre, role, nom_fichier, chemin, mime, taille, empreinte, origine)
        values ('aok', 't', 'r', 'a.png', '${c2}', 'image/png', 10, '${e2}', 'url')`)
      await refuse(tx, 'autre auteur', `insert into public.cockpit_perso_images (titre, role, nom_fichier, chemin, mime, taille, empreinte, origine, depose_par)
        values ('t', 'r', 'a.png', '${c2}', 'image/png', 10, '${e2}', 'url', 'tab')`)
      await tx.$executeRawUnsafe(ins({ chemin: c2, empreinte: e2 }))
      bloc('contraintes : chemin = empreinte sous belrive/, nom et type des quatre formats, 8 Mo, origine, projet et auteur fixes')

      await tx.$executeRawUnsafe(`update public.cockpit_perso_images set titre = 'change', chemin = 'x', empreinte = 'y', taille = 1, depose_le = now() - interval '1 year', rapatrie_le = now() where image_id = $1::uuid`, un.image_id)
      const [apres] = await tx.$queryRawUnsafe(`select titre, chemin, empreinte, taille, depose_le, rapatrie_le from public.cockpit_perso_images where image_id = $1::uuid`, un.image_id)
      assert.equal(apres.titre, 'Essai'); assert.equal(apres.chemin, depot.chemin); assert.equal(apres.empreinte, e); assert.equal(apres.taille, PNG.length)
      assert.ok(apres.rapatrie_le && new Date(apres.depose_le) > new Date(Date.now() - 3600_000))
      bloc('trigger : la ligne est figee, seul rapatrie_le change')

      const [brice] = await tx.$queryRawUnsafe(`select user_id::text as uid from public.cockpit_allowlist where acces_perso limit 1`)
      const [sansPerso] = await tx.$queryRawUnsafe(`select user_id::text as uid from public.cockpit_allowlist where not acces_perso limit 1`)
      const compter = () => tx.$queryRawUnsafe(`select count(*)::int n from public.cockpit_perso_images`).then((r) => r[0].n)
      const vuAnon = await commeRole(tx, 'anon', null, () => compter().catch(() => 'refuse'))
      assert.ok(vuAnon === 'refuse' || vuAnon === 0)
      assert.equal(await commeRole(tx, 'authenticated', '11111111-2222-3333-4444-555555555555', compter), 0)
      if (sansPerso) assert.equal(await commeRole(tx, 'authenticated', sansPerso.uid, compter), 0)
      assert.ok(await commeRole(tx, 'authenticated', brice.uid, compter) >= 2)
      const ecritBrice = await commeRole(tx, 'authenticated', brice.uid, () => tx.$executeRawUnsafe(ins({ chemin: `belrive/cc/${'c'.repeat(64)}.png`, empreinte: 'c'.repeat(64) })).then(() => true).catch(() => false))
      assert.equal(ecritBrice, false)
      bloc(`RLS : anon et inconnu 0 ligne${sansPerso ? ', membre du cockpit sans acces perso 0 ligne' : ''}, Brice lit mais n ecrit pas`)

      assert.ok(await commeRole(tx, 'service_role', null, compter) >= 2)
      const svc = (sql) => commeRole(tx, 'service_role', null, () => tx.$executeRawUnsafe(sql).then(() => true).catch(() => false))
      assert.equal(await svc(`update public.cockpit_perso_images set rapatrie_le = now() where image_id = '${un.image_id}'`), true)
      assert.equal(await svc(`update public.cockpit_perso_images set titre = 'x' where image_id = '${un.image_id}'`), false)
      assert.equal(await svc(ins({ chemin: `belrive/dd/${'d'.repeat(64)}.png`, empreinte: 'd'.repeat(64) })), false)
      assert.equal(await svc(`delete from public.cockpit_perso_images where image_id = '${un.image_id}'`), false)
      bloc('service_role : lit, pose rapatrie_le, ni titre, ni insertion, ni suppression')
      throw ANNULER
    }, { timeout: 60_000, maxWait: 10_000 })
  } catch (err) {
    if (err !== ANNULER) { await p.$disconnect(); throw err }
  }
  const [{ reste }] = await p.$queryRawUnsafe(`select to_regclass('public.cockpit_perso_images') is not null as reste`)
  if (!existait) {
    assert.equal(reste, false)
    const [{ n }] = await p.$queryRawUnsafe(`select count(*)::int n from storage.buckets where id = 'belrive-images'`)
    assert.equal(n, 0)
    bloc('transaction annulee : ni table ni bucket ne restent')
  } else {
    bloc('transaction annulee (migration deja appliquee avant l essai : rien de neuf ne reste)')
  }
}

if (mode === '--bout-en-bout') {
  const P = await import('../src/lib/mcp-gpt/pur.ts')
  const { base } = await import('../src/lib/mcp-gpt/serveur.ts')
  const S = await import('../src/lib/mcp-gpt/stockage-images.ts')
  const { createClient } = await import('@supabase/supabase-js')
  const stockage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const SECRET = `gpt_${'E'.repeat(43)}`
  const deps = { base, verifierCle: async () => ({ ok: true, cleId: null }) }
  const rpc = (id, method, params) => P.traiterPost({ secret: SECRET, typeContenu: 'application/json', versionProtocole: '2025-06-18',
    brut: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) }, deps)
  const outil = async (id, name, args) => {
    const r = await rpc(id, 'tools/call', { name, arguments: args })
    assert.equal(r.status, 200)
    return { erreur: r.corps.result.isError, texte: r.corps.result.content[0].text, journal: r.journal }
  }

  // Une image propre a l'essai (aucune collision avec un vrai depot) : le PNG 1x1 suivi d'un commentaire aleatoire apres IEND.
  const essai = Buffer.concat([PNG, Buffer.from(`essai-${Date.now()}-${Math.random()}`)])
  const crees = []
  try {
    const l = await rpc(1, 'tools/list')
    const o = l.corps.result.tools.find((t) => t.name === 'deposer_image')
    assert.deepEqual(o._meta, { 'openai/fileParams': ['image'] })
    bloc(`tools/list : ${l.corps.result.tools.length} outils, deposer_image avec openai/fileParams`)

    const d1 = await outil(2, 'deposer_image', { titre: 'Essai Yume (a retirer)', role: 'essai de bout en bout, retire a la fin', nom_fichier: 'Essai Yume.png', donnees_base64: essai.toString('base64') })
    assert.equal(d1.erreur, false, d1.texte)
    const j1 = JSON.parse(d1.texte)
    crees.push(j1.id.slice(4))
    assert.equal(j1.nom_fichier, 'essai-yume.png'); assert.equal(j1.deja_deposee, false); assert.equal(j1.taille_octets, essai.length)
    bloc(`deposer_image (base64) : ${j1.id}, ${j1.nom_fichier}, ${j1.taille_octets} octets`)

    const d2 = JSON.parse((await outil(3, 'deposer_image', { titre: 'Encore', role: 'meme octets', donnees_base64: essai.toString('base64') })).texte)
    assert.equal(d2.id, j1.id); assert.equal(d2.deja_deposee, true)
    bloc('meme image une seconde fois : meme id, rien de neuf')

    const URL_REELLE = 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png'
    const d3 = await outil(4, 'deposer_image', { titre: 'Essai url (a retirer)', role: 'telechargement reel', url: URL_REELLE })
    if (d3.erreur) {
      console.log(`!!  deposer_image par url reelle refuse : ${d3.texte}`)
    } else {
      const j3 = JSON.parse(d3.texte)
      if (!j3.deja_deposee) crees.push(j3.id.slice(4))
      assert.equal(j3.type, 'image/png')
      bloc(`deposer_image (url https reelle, gardes anti-SSRF actives) : ${j3.nom_fichier}, ${j3.taille_octets} octets`)
    }
    const refus = await outil(5, 'deposer_image', { titre: 't', role: 'r', url: 'https://169.254.169.254/latest/meta-data' })
    assert.equal(refus.erreur, true)
    const refusDns = await outil(6, 'deposer_image', { titre: 't', role: 'r', url: 'https://localtest.me/a.png' })
    assert.equal(refusDns.erreur, true)
    assert.match(refusDns.texte, /privée ou locale|introuvable/)
    bloc(`refus reels : adresse de metadonnees, nom public qui resout en 127.0.0.1 (${refusDns.texte.slice(0, 80)})`)

    const ld = JSON.parse((await outil(7, 'lister_documents', {})).texte)
    assert.ok(ld.images.some((x) => x.id === j1.id))
    bloc(`lister_documents : ${ld.documents.length} document(s), ${ld.images.length} image(s), dont l essai`)

    const ligne = await R.lireImage(p, crees[0])
    const signee = await S.urlSigneeImage(ligne.chemin, ligne.nom_fichier)
    assert.ok(signee && /token=/.test(signee.url))
    const lu = Buffer.from(await (await fetch(signee.url)).arrayBuffer())
    assert.ok(lu.equals(essai), 'octets relus par l URL signee')
    const anonyme = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/belrive-images/${ligne.chemin}`)
    assert.notEqual(anonyme.status, 200)
    bloc(`URL signee de Tab : octets identiques ; acces public refuse (HTTP ${anonyme.status})`)
  } finally {
    for (const id of crees) {
      const l = await R.lireImage(p, id)
      if (!l) continue
      const { error } = await stockage.storage.from(I.BUCKET_IMAGES).remove([l.chemin])
      if (error) console.log(`!!  objet non retire : ${l.chemin}`)
      await p.$executeRawUnsafe(`delete from public.cockpit_perso_images where image_id = $1::uuid and projet = 'belrive'`, id)
    }
    const restes = await p.$queryRawUnsafe(`select count(*)::int n from public.cockpit_perso_images where image_id = any($1::uuid[])`, crees)
    assert.equal(restes[0].n, 0)
    bloc(`nettoyage : ${crees.length} ligne(s) et objet(s) retires`)
  }
}

await p.$disconnect()
console.log(`\n${ok} blocs passes.`)
process.exit(0)
