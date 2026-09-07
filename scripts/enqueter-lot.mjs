/**
 * ENQUÊTER EN LOT, EN TÂCHE DE FOND, AVEC UN MODÈLE MOINS CHER.
 *
 * Brice, 07/09 : « lance-le avec un modèle moins coûteux en tâche de fond ».
 * Même moteur que la route /api/cockpit/enquete (ancrage = ce que le fonds
 * sait + les notes dictées ; recherche web ; propositions structurées), mais
 * ici on boucle sur une liste de personnes et on écrit directement dans
 * `cockpit_arch_propositions` avec statut « proposee ». L'humain tranche
 * ensuite dans le cockpit, ligne par ligne — rien ne fusionne.
 *
 * Qui : par défaut, les personnes du fonds RATTACHÉES à un membre (les
 * clients), sans enquête depuis 7 jours. Modèle : claude-sonnet-5 par défaut
 * (l'outil de recherche web 20260209 le demande au minimum), surchargeable.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a
 *   ANTHROPIC_API_KEY_COCKPIT=… node scripts/enqueter-lot.mjs [--modele claude-sonnet-5] [--max 50] [--personne p-x]
 *
 * Journal de bord : scripts/enqueter-lot.log (une ligne par personne).
 */
import { appendFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}
const MODELE = arg('--modele', 'claude-sonnet-5')
const MAX = Number(arg('--max', '60'))
const UNE = arg('--personne', null)
const LOG = new URL('./enqueter-lot.log', import.meta.url).pathname

const prisma = new PrismaClient()
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY_COCKPIT ?? process.env.ANTHROPIC_API_KEY })
const log = (s) => { const l = `${new Date().toISOString()} ${s}`; console.log(l); appendFileSync(LOG, l + '\n') }

const BLOQUES = ['spokeo.com', 'pipl.com', 'whitepages.com', 'truepeoplesearch.com', 'beenverified.com',
  'peoplefinders.com', 'fastpeoplesearch.com', '118000.fr', '118712.fr', 'pagesblanches.fr']

// Première formulation (« où il vit, adresse, téléphone, email ») : Sonnet a
// refusé en bloc, 0 page — lu comme un dossier sur un particulier. Ce qu'on
// veut, c'est sa PRÉSENCE PUBLIQUE : ce qu'il ou elle publie, et les
// coordonnées qu'une page professionnelle affiche elle-même.
const CONSIGNE = [
  'Tu documentes la présence publique en ligne d’une personne pour la fiche d’un CRM d’école de trading : elle est élève ou contact de cette communauté, et l’équipe veut savoir ce qu’elle publie et fait professionnellement.',
  'Ce qu’on cherche : ses comptes publics (Instagram, YouTube, TikTok, LinkedIn, X, Facebook, Twitch), un site ou blog, une chaîne ou un podcast, son activité et son métier, une société qu’elle dirige ou représente (nom, rôle, ville du siège, SIREN — registres publics Pappers, societe.com, Infogreffe bienvenus), la ville ou région qu’elle affiche publiquement, et les coordonnées professionnelles qu’elle publie elle-même (mentions légales de son site, fiche de sa société, page de contact pro).',
  'RÈGLES FERMES : uniquement ce que la personne ou sa société a rendu public ; jamais d’information sur des mineurs ; pas d’annuaires de personnes ni de courtiers de données ; pas de pages derrière une connexion ; rien sur la vie privée qui ne soit publié par la personne elle-même.',
  'L’ANCRAGE avant tout : pour chaque information, dis ce qui relie la page à CETTE personne (pseudo posté dans les salons, ville citée, activité de trading, photo, lien depuis un profil sûr). Une page non reliable est un homonyme : écarte-la et dis-le.',
  'Cite la source de chaque affirmation et le fragment exact qui la fonde. Ne conclus rien sur la personnalité ou la situation financière.',
  'Commence par les profils déjà postés et par ce que l’équipe sait. Termine par un compte rendu : trouvé (sources + ancrages), écarté (pourquoi).',
].join('\n')

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['propositions', 'homonymes', 'resume'],
  properties: {
    resume: { type: 'string' }, homonymes: { type: 'string' },
    propositions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['champ', 'valeur', 'source_url', 'extrait', 'pourquoi_lui', 'confiance'],
      properties: {
        champ: { type: 'string', enum: ['reseau', 'site', 'societe', 'localisation', 'activite', 'biographie', 'coordonnees', 'autre'] },
        reseau: { type: 'string' }, valeur: { type: 'string' }, source_url: { type: 'string' },
        extrait: { type: 'string' }, pourquoi_lui: { type: 'string' },
        confiance: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
      } } },
  },
}

async function ancrageDe(pid) {
  const [p] = await prisma.$queryRawUnsafe(
    `select personne_id, nom, alias, telegram, nature, messages, premier::text premier, dernier::text dernier
     from public.cockpit_arch_personnes where personne_id = '${pid}'`)
  if (!p) return null
  const reseaux = await prisma.$queryRawUnsafe(`select reseau, profil, fois from public.cockpit_arch_reseaux where personne_id='${pid}' and profil is not null order by fois desc limit 12`)
  const salons = await prisma.$queryRawUnsafe(`select s.nom from public.cockpit_arch_presences pr join public.cockpit_arch_salons s using(salon_id) where pr.personne_id='${pid}' order by pr.messages desc nulls last limit 5`)
  const lieux = await prisma.$queryRawUnsafe(`select extrait from public.cockpit_arch_vies where personne_id='${pid}' and rubrique in ('geo','metier','presentations') order by dit_le limit 8`)
  const notes = await prisma.$queryRawUnsafe(`select rubrique, texte from public.cockpit_arch_notes where personne_id='${pid}' order by ecrit_le desc limit 8`)
  const membre = await prisma.$queryRawUnsafe(`select m.nom, m.prenom, m.telegram from public.cockpit_membres m join public.cockpit_membre_telegram v using(membre_id) where v.personne_id='${pid}' limit 1`)
  const deja = await prisma.$queryRawUnsafe(`select champ, valeur, statut from public.cockpit_arch_propositions where personne_id='${pid}' and statut in ('acceptee','refusee')`)
  const texte = [
    `Nom tel qu'il apparaît sur Telegram : ${p.nom}`,
    p.alias ? `Autres noms ou alias vus : ${p.alias}` : null,
    p.telegram ? `Pseudo Telegram : @${p.telegram}` : null,
    membre[0] ? `Nom à l'état civil (client payant) : ${membre[0].nom}${membre[0].telegram ? ` · pseudo déclaré au paiement : ${membre[0].telegram}` : ''}` : null,
    `Contexte : communauté francophone de trading (${p.nature}), ${p.messages} messages entre ${p.premier} et ${p.dernier}.`,
    salons.length ? `Salons fréquentés : ${salons.map((s) => s.nom).join(' · ')}` : null,
    reseaux.length ? `Profils POSTÉS dans les conversations (ancrage fort, vérifie qu'ils sont les siens) :\n${reseaux.map((r) => `  - ${r.reseau} : ${r.profil} (${r.fois} fois)`).join('\n')}` : null,
    lieux.length ? `Ce qu'il ou elle a dit de sa vie :\n${lieux.map((l) => `  - « ${l.extrait.slice(0, 200)} »`).join('\n')}` : null,
    notes.length ? `CE QUE L'ÉQUIPE SAIT DÉJÀ, écrit à la main (ancrage le plus fiable) :\n${notes.map((n) => `  - [${n.rubrique ?? 'note'}] ${n.texte.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n')}` : null,
    deja.filter((d) => d.statut === 'acceptee').length ? `Déjà accepté (ne pas reproposer) : ${deja.filter((d) => d.statut === 'acceptee').map((d) => `${d.champ}=${d.valeur}`).join(' ; ')}` : null,
    deja.filter((d) => d.statut === 'refusee').length ? `Déjà REFUSÉ par un humain (ne pas reproposer) : ${deja.filter((d) => d.statut === 'refusee').map((d) => `${d.champ}=${d.valeur}`).join(' ; ')}` : null,
  ].filter(Boolean).join('\n')
  return { p, texte, deja }
}

async function enqueter(pid) {
  const a = await ancrageDe(pid)
  if (!a) { log(`${pid} : inconnu`); return }
  const t0 = Date.now()
  const messages = [{ role: 'user', content: `Voici ce que le fonds sait déjà :\n\n${a.texte}\n\nEnquête, puis rends ton compte rendu.` }]
  let cr = ''; const sources = new Set(); let usage = 0
  for (let tour = 0; tour < 6; tour++) {
    const r = await client.messages.create({
      model: MODELE, max_tokens: 16000, system: CONSIGNE,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10, blocked_domains: BLOQUES }],
      messages,
    })
    usage += (r.usage?.input_tokens ?? 0) + (r.usage?.output_tokens ?? 0)
    if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content }); continue }
    for (const b of r.content) {
      if (b.type === 'text') cr += b.text + '\n'
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content) if (x.type === 'web_search_result') sources.add(x.url)
    }
    break
  }
  const s = await client.messages.create({
    model: MODELE, max_tokens: 8000,
    system: 'Tu transformes un compte rendu d’enquête en propositions structurées. Tu n’ajoutes rien qui ne soit dans le compte rendu. Ce qui a été écarté va dans « homonymes ».',
    messages: [{ role: 'user', content: `Compte rendu :\n\n${cr}\n\nURL :\n${[...sources].join('\n')}` }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })
  usage += (s.usage?.input_tokens ?? 0) + (s.usage?.output_tokens ?? 0)
  const txt = s.content.find((b) => b.type === 'text')
  let json = { propositions: [] }
  try { json = JSON.parse(txt?.text ?? '{}') } catch { /* schéma non respecté : zéro proposition */ }
  const vues = new Set(a.deja.map((d) => `${d.champ}|${d.valeur.toLowerCase()}`))
  const enquete = randomUUID()
  let n = 0
  for (const q of json.propositions ?? []) {
    if (!q.valeur || vues.has(`${q.champ}|${q.valeur.toLowerCase()}`)) continue
    await prisma.$executeRaw`
      insert into public.cockpit_arch_propositions (enquete_id, personne_id, champ, reseau, valeur, source_url, extrait, pourquoi_lui, confiance)
      values (${enquete}::uuid, ${pid}, ${q.champ}, ${q.reseau ?? null}, ${q.valeur.slice(0, 500)},
              ${(q.source_url ?? '').slice(0, 1000) || null}, ${(q.extrait ?? '').slice(0, 1000) || null},
              ${(q.pourquoi_lui ?? '').slice(0, 600) || null}, ${q.confiance ?? 'moyenne'})`
    n += 1
  }
  log(`${pid} (${a.p.nom}) : ${n} proposition(s), ${sources.size} pages, ${Math.round((Date.now() - t0) / 1000)} s, ${usage} jetons — ${(json.resume ?? '').slice(0, 160)}`)
}

const cibles = UNE ? [{ personne_id: UNE }] : await prisma.$queryRawUnsafe(
  `select v.personne_id from public.cockpit_membre_telegram v
   where not exists (select 1 from public.cockpit_arch_propositions pr
                     where pr.personne_id = v.personne_id and pr.cree_le > now() - interval '7 days')
   order by v.messages desc limit ${MAX}`)
log(`lot : ${cibles.length} personne(s), modèle ${MODELE}`)
for (const c of cibles) {
  try { await enqueter(c.personne_id) } catch (e) {
    const msg = String(e.message)
    log(`${c.personne_id} : ERREUR ${msg.slice(0, 200)}`)
    // Le 07/09, le crédit du workspace cockpit s'est épuisé après la première
    // personne : 49 erreurs identiques en 17 secondes. Une erreur de crédit ou
    // d'authentification ne se répare pas en passant au suivant — on s'arrête,
    // et la relance reprendra là où on en était (les personnes sans
    // proposition récente sont reprises d'office).
    if (/credit balance|authentication|invalid x-api-key/i.test(msg)) { log('arrêt : le compte API ne répond plus, relancer après rechargement'); break }
  }
}
log('lot terminé')
await prisma.$disconnect()
