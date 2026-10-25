// Verification locale des IMAGES de Belrive deposees par ChatGPT (25/10/2026).
// Aucune base, aucun reseau : les regles pures (src/lib/mcp-gpt/images-pur.ts),
// le resolveur anti-SSRF (src/lib/mcp-gpt/telechargement.ts, avec un DNS
// factice), et l'outil deposer_image de bout en bout du protocole contre une
// base FACTICE en memoire (src/lib/mcp-gpt/pur.ts).
//
//   node scripts/verifier-images-belrive.mjs
//
// Sort en code 1 au premier ecart. L'essai contre la vraie base et le vrai
// bucket : scripts/essayer-images-belrive.mjs.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'
const I = await import('../src/lib/mcp-gpt/images-pur.ts')
const T = await import('../src/lib/mcp-gpt/telechargement.ts')
const P = await import('../src/lib/mcp-gpt/pur.ts')
const R = await import('../src/lib/mcp-gpt/requetes.ts')

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')
let n = 0
async function cas(nom, f) {
  await f()
  n += 1
  console.log(`ok  ${nom}`)
}

// De vraies petites images (1 x 1 pixel).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 ')])

// ---------------------------------------------------------------------------
// Octets magiques, empreinte, chemin
// ---------------------------------------------------------------------------

await cas('octets magiques : png, jpeg, webp, gif reconnus ; le reste refuse', async () => {
  assert.deepEqual(I.detecterImage(PNG), { mime: 'image/png', ext: 'png' })
  assert.deepEqual(I.detecterImage(JPEG), { mime: 'image/jpeg', ext: 'jpg' })
  assert.deepEqual(I.detecterImage(WEBP), { mime: 'image/webp', ext: 'webp' })
  assert.deepEqual(I.detecterImage(GIF), { mime: 'image/gif', ext: 'gif' })
  for (const faux of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from('%PDF-1.7'), Buffer.from('<html>'),
    Buffer.from('RIFF\x1a\x00\x00\x00WAVE'), Buffer.from([0x89, 0x50, 0x4e]), Buffer.from('GIF88a'), Buffer.alloc(0)]) {
    assert.equal(I.detecterImage(faux), null, faux.toString('latin1').slice(0, 20))
  }
})

await cas('validerOctets : vide, trop lourd, pas une image', async () => {
  assert.equal(I.validerOctets(Buffer.alloc(0)).ok, false)
  const lourd = Buffer.concat([PNG, Buffer.alloc(I.IMAGE_MAX_OCTETS)])
  assert.match(I.validerOctets(lourd).raison, /8 Mo/)
  assert.match(I.validerOctets(Buffer.from('bonjour')).raison, /png, jpeg, webp ou gif/)
  assert.equal(I.validerOctets(PNG).ok, true)
})

await cas('chemin de stockage : derive de l empreinte, accepte par la regle de la table', async () => {
  const e = I.empreinteOctets(PNG)
  assert.match(e, /^[0-9a-f]{64}$/)
  const c = I.cheminStockage(e, 'png')
  assert.equal(c, `belrive/${e.slice(0, 2)}/${e}.png`)
  assert.equal(c.substr(11, 64), e) // substr(chemin, 12, 64) en SQL, base 1
  assert.match(c, /^belrive\/[0-9a-f]{2}\/[0-9a-f]{64}[.](png|jpg|webp|gif)$/)
  assert.throws(() => I.cheminStockage('../x', 'png'))
})

await cas('noms de fichier : sans dossier, sans accents, extension du vrai type, bornes de la table', async () => {
  const regle = /^[a-z0-9][a-z0-9._-]{0,75}[.](png|jpg|webp|gif)$/
  const essais = [
    [['Leurre 1 : hirondelle au poignet droit.PNG'], 'jpg', 'leurre-1-hirondelle-au-poignet-droit.jpg'],
    [['../../etc/passwd'], 'png', 'passwd.png'],
    [['C:\\Users\\x\\Décor Été.webp'], 'webp', 'decor-ete.webp'],
    [[null, '', '...', 'Visuel de la gare'], 'gif', 'visuel-de-la-gare.gif'],
    [['   '], 'png', 'image.png'],
    [['x'.repeat(300)], 'webp', `${'x'.repeat(75)}.webp`],
    [['.cache'], 'png', 'cache.png'],
    [['a..b--c__d'], 'png', 'a-b-c__d.png'],
  ]
  for (const [souhaits, ext, attendu] of essais) {
    const nom = I.assainirNomFichier(souhaits, ext)
    assert.equal(nom, attendu, String(souhaits[0]))
    assert.match(nom, regle, nom)
    assert.ok(nom.length <= I.NOM_FICHIER_MAX)
  }
})

// ---------------------------------------------------------------------------
// Anti-SSRF
// ---------------------------------------------------------------------------

await cas('adresses interdites : privees, locales, reservees, IPv6 non globales et IPv4 cachees', async () => {
  const interdites = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.5', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:0:4136:e378::1', '2001:db8::1',
    '::127.0.0.1', 'fe80::1%eth0', 'pas-une-ip', '']
  for (const ip of interdites) assert.equal(I.adresseInterdite(ip), true, ip)
  const permises = ['8.8.8.8', '1.1.1.1', '104.18.0.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450:4007:80c::200e', '::ffff:8.8.8.8', '2002:0808:0808::1']
  for (const ip of permises) assert.equal(I.adresseInterdite(ip), false, ip)
})

await cas('verifierUrl : https seul, port 443, sans identifiants, hote public', async () => {
  for (const u of ['http://exemple.com/a.png', 'ftp://exemple.com/a.png', 'file:///etc/passwd', 'https://user:mdp@exemple.com/a.png',
    'https://exemple.com:8443/a.png', 'https://localhost/a.png', 'https://x.localhost/a.png', 'https://serveur.internal/a.png',
    'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://169.254.169.254/latest/meta-data', 'https://intranet/a.png',
    'https://10.0.0.1./a.png', 'pas une adresse', `https://exemple.com/${'a'.repeat(I.URL_MAX)}`]) {
    assert.equal(I.verifierUrl(u).ok, false, u)
  }
  for (const u of ['https://files.oaiusercontent.com/file-abc?se=2026&sig=x', 'https://exemple.com:443/a.png', 'https://8.8.8.8/a.png']) {
    assert.equal(I.verifierUrl(u).ok, true, u)
  }
})

await cas('lookup sur : refuse si UNE adresse du nom est privee, rend une ou toutes les adresses', async () => {
  const dns = { 'public.test': [{ address: '93.184.215.14', family: 4 }, { address: '2606:2800:21f:cb07::1', family: 6 }],
    'melange.test': [{ address: '93.184.215.14', family: 4 }, { address: '10.0.0.5', family: 4 }],
    'rebind.test': [{ address: '127.0.0.1', family: 4 }], 'meta.test': [{ address: '::ffff:169.254.169.254', family: 6 }] }
  const lookup = T.creerLookupSur((h, cb) => (dns[h] ? cb(null, dns[h]) : cb(Object.assign(new Error('x'), { code: 'ENOTFOUND' }), [])))
  const appeler = (h, o) => new Promise((res) => lookup(h, o, (err, a, f) => res({ err, a, f })))
  const un = await appeler('public.test', {})
  assert.equal(un.err, null); assert.equal(un.a, '93.184.215.14'); assert.equal(un.f, 4)
  const tous = await appeler('public.test', { all: true })
  assert.equal(tous.a.length, 2)
  const v6 = await appeler('public.test', { family: 6 })
  assert.equal(v6.a, '2606:2800:21f:cb07::1')
  for (const h of ['melange.test', 'rebind.test', 'meta.test']) {
    const r = await appeler(h, { all: true })
    assert.ok(r.err instanceof T.AdresseRefusee, h)
  }
  assert.equal((await appeler('inconnu.test', {})).err.code, 'ENOTFOUND')
})

await cas('telechargerImage : refus avant tout reseau (http, adresse privee, nom qui resout en prive)', async () => {
  const lookup = T.creerLookupSur((h, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]))
  assert.match((await T.telechargerImage('http://exemple.com/a.png', { lookup })).raison, /https/)
  assert.match((await T.telechargerImage('https://192.168.0.1/a.png', { lookup })).raison, /privée ou locale/)
  const r = await T.telechargerImage('https://rebind.exemple.com/a.png', { lookup, delaiMs: 3000 })
  assert.equal(r.ok, false)
  assert.match(r.raison, /privée ou locale/)
})

// ---------------------------------------------------------------------------
// Les arguments
// ---------------------------------------------------------------------------

await cas('source : champ image (fileParams), url, base64, chemin /mnt/data refuse avec explication', async () => {
  const f = I.lireSourceImage({ image: { download_url: 'https://files.oaiusercontent.com/x?sig=1', file_id: 'file_abc', mime_type: 'image/png', file_name: 'leurre.png' }, url: 'https://autre.test/b.png' })
  assert.deepEqual(f, { ok: true, source: { genre: 'fichier', url: 'https://files.oaiusercontent.com/x?sig=1', fileId: 'file_abc', nom: 'leurre.png' } })
  assert.equal(I.lireSourceImage({ url: 'https://exemple.com/a.png' }).source.genre, 'url')
  assert.equal(I.lireSourceImage({ image: 'https://exemple.com/a.png' }).source.genre, 'url')
  const b = I.lireSourceImage({ donnees_base64: `data:image/png;base64,${PNG.toString('base64')}` })
  assert.equal(b.source.genre, 'base64'); assert.ok(b.source.octets.equals(PNG))
  assert.ok(I.lireSourceImage({ donnees_base64: PNG.toString('base64url') }).source.octets.equals(PNG))
  for (const a of [{ image: '/mnt/data/leurre.png' }, { url: '/mnt/data/leurre.png' }, { image: 'sandbox:/mnt/data/x.png' }]) {
    assert.match(I.lireSourceImage(a).raison, /mnt\/data/)
  }
  assert.match(I.lireSourceImage({ image: { file_id: 'x' } }).raison, /download_url/)
  assert.match(I.lireSourceImage({}).raison, /aucune image/)
  assert.match(I.lireSourceImage({ donnees_base64: 'pas du base64 !' }).raison, /pas du base64/)
  assert.match(I.lireSourceImage({ donnees_base64: 'A'.repeat(900_000) }).raison, /trop long/)
  assert.equal(I.nomDansUrl('https://x.test/dossier/Leurre%201.png?sig=2'), 'Leurre 1.png')
})

// ---------------------------------------------------------------------------
// L'outil, par le protocole, contre une base factice
// ---------------------------------------------------------------------------

function baseFactice() {
  const images = []
  const journal = []
  return {
    images, journal,
    async telechargerImage(url) {
      journal.push(['telecharger', url])
      if (url.includes('pdf')) return { ok: true, octets: Buffer.from('%PDF-1.4') }
      if (url.includes('expire')) return { ok: false, raison: 'fichier introuvable ou lien expiré (HTTP 403).' }
      return { ok: true, octets: GIF }
    },
    async enregistrerImage(i) {
      journal.push(['enregistrer', { ...i, octets: i.octets.length }])
      const deja = images.find((x) => x.empreinte === i.empreinte)
      if (deja) return { image: deja, deja: true }
      const image = { image_id: `6666666${images.length}-6666-4666-8666-666666666666`, titre: i.titre, role: i.role, nom_fichier: i.nomFichier,
        chemin: i.chemin, mime: i.mime, taille: i.octets.length, empreinte: i.empreinte, origine: i.origine, depose_le: '2026-10-25T10:00:00.000Z' }
      images.push(image)
      return { image, deja: false }
    },
    async listerImages() { return images },
    async listerDocuments() { return [] },
  }
}
const SECRET = `gpt_${'A'.repeat(43)}`
const deps = (base) => ({ base, verifierCle: async () => ({ ok: true, cleId: 'cle' }) })
const appel = (base, name, args) => P.traiterPost({ secret: SECRET, typeContenu: 'application/json', versionProtocole: null,
  brut: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, deps(base))
const sortie = (r) => ({ erreur: r.corps.result.isError, texte: r.corps.result.content[0].text })

await cas('tools/list : deposer_image declare openai/fileParams sur image, schema fichier a quatre proprietes', async () => {
  const r = await P.traiterPost({ secret: SECRET, typeContenu: 'application/json', versionProtocole: null, brut: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }, deps(baseFactice()))
  const o = r.corps.result.tools.find((x) => x.name === 'deposer_image')
  assert.deepEqual(o._meta, { 'openai/fileParams': ['image'] })
  const img = o.inputSchema.properties.image
  assert.equal(img.type, 'object')
  assert.deepEqual(Object.keys(img.properties).sort(), ['download_url', 'file_id', 'file_name', 'mime_type'])
  assert.deepEqual(img.required, ['download_url', 'file_id'])
  assert.deepEqual(o.inputSchema.required, ['titre', 'role'])
  assert.equal(o.annotations.readOnlyHint, false)
  assert.equal(o.annotations.destructiveHint, false)
  assert.ok(!/[\u2014\u2013\u2026\u201c\u201d\u2018\u2019]/.test(JSON.stringify(o)), 'caractere hors clavier')
  assert.match(P.INSTRUCTIONS, /deposer_image/)
  assert.match(r.corps.result.tools.find((x) => x.name === 'lister_documents').description, /images/)
})

await cas('deposer_image : fichier de la conversation, nom assaini, id img:, journal sans lien signe', async () => {
  const base = baseFactice()
  const r = await appel(base, 'deposer_image', { titre: 'Leurre 1', role: 'leurre 1 : hirondelle au poignet droit',
    image: { download_url: 'https://files.oaiusercontent.com/file-xyz?se=2026&sig=SECRETSIG', file_id: 'file-xyz', mime_type: 'image/png', file_name: 'leurre_1.png' } })
  const s = sortie(r)
  assert.equal(s.erreur, false, s.texte)
  const j = JSON.parse(s.texte)
  assert.match(j.id, /^img:[0-9a-f-]{36}$/)
  assert.equal(j.nom_fichier, 'leurre_1.gif', 'extension du VRAI type (gif), pas de l annonce')
  assert.equal(j.type, 'image/gif')
  assert.equal(j.deja_deposee, false)
  const [, e] = base.journal.find((x) => x[0] === 'enregistrer')
  assert.equal(e.origine, 'fichier')
  assert.equal(e.chemin, I.cheminStockage(I.empreinteOctets(GIF), 'gif'))
  assert.ok(!JSON.stringify(r.journal).includes('SECRETSIG'), 'le lien signe ne va pas au journal')
  assert.equal(r.journal.route, 'mcp/tools/call/deposer_image')
  // Meme image redeposee : un seul fichier.
  const r2 = JSON.parse(sortie(await appel(base, 'deposer_image', { titre: 'Encore', role: 'r', url: 'https://exemple.com/autre.gif' })).texte)
  assert.equal(r2.deja_deposee, true)
  assert.equal(r2.id, j.id)
  assert.equal(base.images.length, 1)
})

await cas('deposer_image : base64, url ; refus nets (pas une image, lien expire, http, prive, sans role)', async () => {
  const base = baseFactice()
  const b = JSON.parse(sortie(await appel(base, 'deposer_image', { titre: 'Décor de la gare', role: 'visuel', donnees_base64: PNG.toString('base64') })).texte)
  assert.equal(b.nom_fichier, 'decor-de-la-gare.png')
  assert.equal(base.journal.filter((x) => x[0] === 'telecharger').length, 0, 'base64 : aucun telechargement')
  const refus = [
    [{ titre: 't', role: 'r', url: 'https://exemple.com/doc.pdf' }, /png, jpeg, webp ou gif/],
    [{ titre: 't', role: 'r', url: 'https://exemple.com/expire.png' }, /expiré/],
    [{ titre: 't', role: 'r', url: 'http://exemple.com/a.png' }, /https/],
    [{ titre: 't', role: 'r', url: 'https://169.254.169.254/a.png' }, /privée ou locale/],
    [{ titre: 't', role: 'r', image: '/mnt/data/a.png' }, /mnt\/data/],
    [{ titre: 't', role: 'r', donnees_base64: Buffer.from('bonjour').toString('base64') }, /png, jpeg/],
    [{ titre: 't', url: 'https://exemple.com/a.png' }, /role manquant/],
    [{ role: 'r', url: 'https://exemple.com/a.png' }, /titre manquant/],
    [{ titre: 'x'.repeat(201), role: 'r', url: 'https://exemple.com/a.png' }, /titre trop long/],
    [{ titre: 't', role: 'x'.repeat(301), url: 'https://exemple.com/a.png' }, /role trop long/],
    [{ titre: 't', role: 'r' }, /aucune image/],
  ]
  for (const [args, motif] of refus) {
    const s = sortie(await appel(base, 'deposer_image', args))
    assert.equal(s.erreur, true, JSON.stringify(args).slice(0, 80))
    assert.match(s.texte, motif, s.texte)
  }
  assert.equal(base.images.length, 1)
})

await cas('lister_documents montre les images ; fetch img: renvoie vers lister_documents', async () => {
  const base = baseFactice()
  await appel(base, 'deposer_image', { titre: 'Leurre 2', role: 'leurre 2', donnees_base64: PNG.toString('base64') })
  const l = JSON.parse(sortie(await appel(base, 'lister_documents', {})).texte)
  assert.equal(l.images.length, 1)
  assert.deepEqual(Object.keys(l.images[0]), ['id', 'titre', 'role', 'nom_fichier', 'type', 'taille_octets', 'depose_le'])
  assert.ok(!('chemin' in l.images[0]) && !('empreinte' in l.images[0]))
  const f = sortie(await appel(base, 'fetch', { id: l.images[0].id }))
  assert.equal(f.erreur, true)
  assert.match(f.texte, /lister_documents/)
})

// ---------------------------------------------------------------------------
// Le SQL et la migration
// ---------------------------------------------------------------------------

await cas('SQL des images : projet belrive en dur, insertion sans ecrasement, auteur gpt', async () => {
  for (const k of ['SQL_IMAGE_PAR_EMPREINTE', 'SQL_LIRE_IMAGE', 'SQL_LISTER_IMAGES']) assert.match(R[k], /i\.projet = 'belrive'/, k)
  assert.match(R.SQL_INSERER_IMAGE, /values \('belrive', \$1::text/)
  assert.match(R.SQL_INSERER_IMAGE, /'gpt'\)\non conflict \(projet, empreinte\) do nothing/)
})

await cas('migration : bucket prive 8 Mo, RLS forcee, service_role ne pose que rapatrie_le, pas de ; dans une chaine', async () => {
  const m = lire('../../../sites/Aoknowledgecom/supabase/migrations/20261025120000_cockpit_perso_images.sql')
  assert.match(m, /values \('belrive-images', 'belrive-images', false, 8388608/)
  assert.match(m, /force row level security/)
  assert.match(m, /grant update \(rapatrie_le\) on public\.cockpit_perso_images to service_role/)
  assert.ok(!/grant (insert|delete)[^\n]*cockpit_perso_images/.test(m))
  assert.ok(!/on storage\.objects/.test(m), 'aucune policy sur storage.objects')
  assert.equal(Number(/file_size_limit = (\d+)/.exec(m)[1]), I.IMAGE_MAX_OCTETS)
  const sql = m.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  const chaines = sql.replace(/\$fn\$[\s\S]*?\$fn\$/g, '').match(/'(?:[^']|'')*'/g) ?? []
  for (const c of chaines) assert.ok(!c.includes(';'), c.slice(0, 40))
})

console.log(`\n${n} verifications passees.`)
