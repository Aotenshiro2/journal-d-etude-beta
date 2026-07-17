// Migration 0.1.2 : les anciens blocs texte qui ne sont QUE de la métadonnée
// de capture (« 📅 date • 🌐 titre (url) » / « 📅 date • 🖥️ Capture externe »)
// deviennent des blocs type 'meta' — le toggle œil peut alors les masquer.
// Prudence : on ne touche pas aux blocs contenant une image ou un autre texte.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const strip = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

const texts = await prisma.message.findMany({
  where: { type: 'text' },
  select: { id: true, content: true },
})

const isPureMeta = (m) => {
  if (m.content.includes('<img')) return false
  const t = strip(m.content)
  // La ligne générée par l'extension commence par 📅 et contient un « • »
  return /^📅 .+ • /.test(t) && t.length < 300
}

const toMigrate = texts.filter(isPureMeta)
console.log(`Blocs métadonnées legacy trouvés : ${toMigrate.length}`)
for (const m of toMigrate.slice(0, 5)) console.log('  ex:', strip(m.content).slice(0, 80))

if (toMigrate.length > 0) {
  // Le contenu devient le texte nu (plus de HTML) — cohérent avec les blocs meta v1.6.7
  for (const m of toMigrate) {
    await prisma.message.update({
      where: { id: m.id },
      data: { type: 'meta', content: strip(m.content) },
    })
  }
  console.log(`Migrés en type 'meta' : ${toMigrate.length}`)
}

await prisma.$disconnect()
