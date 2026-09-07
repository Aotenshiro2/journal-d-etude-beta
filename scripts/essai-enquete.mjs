/**
 * Essai a blanc du moteur d'enquete en ligne (route /api/cockpit/enquete),
 * sans passer par la route ni ecrire en base : memes deux appels, meme
 * ancrage, on imprime ce que ca rend. Sert a valider le schema et l'outil de
 * recherche AVANT que Brice clique dans le cockpit.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/essai-enquete.mjs p-james
 */
import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'

const pid = process.argv[2] ?? 'p-james'
const prisma = new PrismaClient()
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY_COCKPIT ?? process.env.ANTHROPIC_API_KEY })
const modele = process.env.AI_MODEL_COCKPIT ?? 'claude-opus-5'

const [p] = await prisma.$queryRawUnsafe(
  `select personne_id, nom, alias, telegram, nature, messages, premier::text premier, dernier::text dernier
   from public.cockpit_arch_personnes where personne_id = '${pid}'`)
const reseaux = await prisma.$queryRawUnsafe(
  `select reseau, profil, fois from public.cockpit_arch_reseaux where personne_id='${pid}' and profil is not null order by fois desc limit 12`)
const salons = await prisma.$queryRawUnsafe(
  `select s.nom from public.cockpit_arch_presences pr join public.cockpit_arch_salons s using(salon_id) where pr.personne_id='${pid}' order by pr.messages desc nulls last limit 5`)
const notes = await prisma.$queryRawUnsafe(
  `select rubrique, texte from public.cockpit_arch_notes where personne_id='${pid}' order by ecrit_le desc limit 8`)
await prisma.$disconnect()

const ancrage = [
  `Nom tel qu'il apparaît sur Telegram : ${p.nom}`,
  p.alias ? `Autres noms ou alias vus : ${p.alias}` : null,
  p.telegram ? `Pseudo Telegram : @${p.telegram}` : null,
  `Contexte : membre d'une communauté francophone de trading (${p.nature}), ${p.messages} messages entre ${p.premier} et ${p.dernier}.`,
  salons.length ? `Salons fréquentés : ${salons.map((s) => s.nom).join(' · ')}` : null,
  reseaux.length ? `Profils postés :\n${reseaux.map((r) => `  - ${r.reseau} : ${r.profil} (${r.fois} fois)`).join('\n')}` : null,
  notes.length ? `CE QUE L'ÉQUIPE SAIT DÉJÀ, écrit à la main (ancrage le plus fiable) :\n${notes.map((n) => `  - [${n.rubrique ?? 'note'}] ${n.texte.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n')}` : null,
].filter(Boolean).join('\n')
console.log('ANCRAGE\n' + ancrage + '\n')

const consigne = 'Tu enquêtes sur une personne pour enrichir la fiche d’un CRM privé, à partir de sources publiques uniquement. Cherche ses réseaux sociaux, un site, une société, son activité, sa ville. Jamais d’adresse postale, de téléphone, d’email, de date de naissance complète. Pour chaque information, dis ce qui relie la page à CETTE personne. Cite tes sources. Termine par un compte rendu.'

const messages = [{ role: 'user', content: `Voici ce que le fonds sait déjà :\n\n${ancrage}\n\nEnquête, puis rends ton compte rendu.` }]
let compteRendu = ''
const sources = new Set()
const t0 = Date.now()
for (let tour = 0; tour < 6; tour++) {
  const r = await client.messages.create({
    model: modele, max_tokens: 16000, system: consigne,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
    messages,
  })
  if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content }); continue }
  for (const b of r.content) {
    if (b.type === 'text') compteRendu += b.text + '\n'
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const x of b.content) if (x.type === 'web_search_result') sources.add(x.url)
  }
  console.log('usage recherche :', JSON.stringify(r.usage))
  break
}
console.log(`\nCOMPTE RENDU (${Math.round((Date.now() - t0) / 1000)} s, ${sources.size} pages)\n` + compteRendu.slice(0, 3000) + '\n')

const schema = {
  type: 'object', additionalProperties: false, required: ['propositions', 'homonymes', 'resume'],
  properties: {
    resume: { type: 'string' }, homonymes: { type: 'string' },
    propositions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['champ', 'valeur', 'source_url', 'extrait', 'pourquoi_lui', 'confiance'],
      properties: {
        champ: { type: 'string', enum: ['reseau', 'site', 'societe', 'localisation', 'activite', 'biographie', 'autre'] },
        reseau: { type: 'string' }, valeur: { type: 'string' }, source_url: { type: 'string' },
        extrait: { type: 'string' }, pourquoi_lui: { type: 'string' },
        confiance: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
      } } },
  },
}
const s = await client.messages.create({
  model: modele, max_tokens: 8000,
  system: 'Tu transformes un compte rendu d’enquête en propositions structurées. Tu n’ajoutes rien qui ne soit dans le compte rendu.',
  messages: [{ role: 'user', content: `Compte rendu :\n\n${compteRendu}\n\nURL :\n${[...sources].join('\n')}` }],
  output_config: { format: { type: 'json_schema', schema } },
})
const txt = s.content.find((b) => b.type === 'text')
const json = JSON.parse(txt.text)
console.log('PROPOSITIONS', json.propositions.length, '| usage :', JSON.stringify(s.usage))
for (const q of json.propositions) console.log(`  [${q.confiance}] ${q.champ}${q.reseau ? '/' + q.reseau : ''} = ${q.valeur}\n      source : ${q.source_url}\n      pourquoi : ${q.pourquoi_lui}`)
console.log('\nRESUME :', json.resume, '\nHOMONYMES :', json.homonymes)
