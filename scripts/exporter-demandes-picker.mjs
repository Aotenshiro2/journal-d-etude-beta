// Les demandes de l'equipe (cockpit_demandes, statut « nouvelle ») vont a la
// boite du picker (D:\7_Agents\boite-picker\entrees\AAAA-MM-JJ.md, contrat dans
// LISEZMOI.md du dossier), puis passent « au_picker » (Brice, 08/10 : une
// demande imprevue de Melanie ou de Brice doit remonter jusqu'au task picker).
//
// Lance chaque matin par la tache planifiee « boite-picker » (session Windows),
// AVANT qu'elle range la boite :
//   wsl.exe -e bash -lc 'cd ~/Projects/Aoknowledge/apps/journal-d-etude && source ~/.nvm/nvm.sh >/dev/null && nvm use 22 >/dev/null && node --env-file=.env.local scripts/exporter-demandes-picker.mjs'
//
// Seul le texte reformule part (jamais la citation), emails et numeros de
// telephone masques : le contrat de la boite interdit les donnees personnelles.
// Le fichier du jour est complete, jamais reecrit. Le statut ne change
// qu'apres l'ecriture du fichier : un echec d'ecriture laisse les demandes
// « nouvelle », elles repartiront le lendemain.
import { appendFileSync, existsSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const BOITE = '/mnt/d/7_Agents/boite-picker/entrees'
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })

const jourParis = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })
const masquer = (t) => t
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/\+?\d[\d .-]{7,}\d/g, '[numero]')
const uneLigne = (t, max) => masquer(String(t ?? '')).replace(/\s+/g, ' ').trim().slice(0, max)

try {
  const demandes = await prisma.$queryRaw`
    select demande_id::text as id, cree_le, auteur, source, texte
    from public.cockpit_demandes where statut = 'nouvelle'
    order by cree_le`
  if (demandes.length === 0) {
    console.log('Aucune demande nouvelle du cockpit.')
  } else {
    if (!existsSync(BOITE)) throw new Error(`boite introuvable : ${BOITE}`)
    const jour = jourParis(new Date())
    const blocs = demandes.map((d) => [
      `## ${uneLigne(d.texte, 160)}`,
      '- type : developper',
      '- projet : Cockpit AOK',
      `- pourquoi : demande de ${uneLigne(d.auteur, 40)} a l'agent du Cockpit, qu'aucun outil ne couvre encore`,
      `- source : cockpit_demandes ${d.id.slice(0, 8)}, du ${jourParis(new Date(d.cree_le))} (${d.source})`,
    ].join('\n'))
    appendFileSync(`${BOITE}/${jour}.md`, `${blocs.join('\n\n')}\n\n`, 'utf8')
    const ids = demandes.map((d) => d.id)
    const n = await prisma.$executeRaw`
      update public.cockpit_demandes
      set statut = 'au_picker', note = ${`boite picker du ${jour}`}
      where statut = 'nouvelle' and demande_id = any(${ids}::uuid[])`
    console.log(`${demandes.length} demande(s) deposee(s) dans la boite du ${jour}, ${n} passee(s) au picker.`)
  }
} catch (err) {
  console.error(`Export des demandes impossible : ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
