/**
 * La cle Kit du journal repond-elle ? (10/11/2026, restes du 10/11, point 1)
 *
 * Constat du 10/11 : la carte « Mes emails » de Mon espace disait a TOUS les membres « Tes choix ne sont pas
 * lisibles pour le moment ». Cause : CONVERTKIT_API_KEY, sur Vercel (projet journal, Production), est refusee
 * par Kit (401 « The API key is invalid ») ; chaque appel de /api/compte/abonnements finissait en 'kit' (502).
 * La meme lecture vaut pour /api/newsletter/subscribe, le webhook des formulaires et le filet /api/cron/kit-defauts.
 *
 * Ce script lit la cle comme le journal (cleKit : CONVERTKIT_API_KEY, sinon KIT_API_KEY) et fait UNE lecture,
 * GET /v4/account. Il n affiche JAMAIS la cle : seulement sa forme (longueur, prefixe kit_) et le statut HTTP.
 *
 * Lancement, avec les variables de PRODUCTION du projet (rien n est ecrit sur le disque) :
 *   vercel env run -e production -- node scripts/verifier-cle-kit.mjs
 * Code de sortie 0 si Kit repond 200, 1 sinon.
 */

const cle = process.env.CONVERTKIT_API_KEY?.trim() || process.env.KIT_API_KEY?.trim() || ''
const source = process.env.CONVERTKIT_API_KEY?.trim() ? 'CONVERTKIT_API_KEY' : process.env.KIT_API_KEY?.trim() ? 'KIT_API_KEY' : null
console.log(`environnement : ${process.env.VERCEL_ENV ?? 'local'}`)
if (!cle) {
  console.log('aucune cle Kit (CONVERTKIT_API_KEY ou KIT_API_KEY) : la route rend config (503)')
  process.exit(1)
}
console.log(`cle lue dans ${source} : ${cle.length} caracteres, prefixe kit_ : ${cle.startsWith('kit_') ? 'oui' : 'non'}`)
const r = await fetch('https://api.kit.com/v4/account', {
  headers: { 'X-Kit-Api-Key': cle, Accept: 'application/json' },
  signal: AbortSignal.timeout(8000),
})
const corps = await r.json().catch(() => null)
console.log(`GET /v4/account : ${r.status}${r.ok ? '' : ` ${JSON.stringify(corps?.errors ?? null)}`}`)
process.exit(r.ok ? 0 : 1)
