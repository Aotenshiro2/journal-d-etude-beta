// Test réel du brief compressé (lecture seule) : calcule le brief de
// l'utilisateur qui a le plus de notes (Brice, élève zéro) et l'affiche.
// Lancement : npx -y tsx scripts/test-mentorat-brief.ts [userId] [days]
import { prisma } from '../src/lib/db'
import { buildMentoratBrief } from '../src/lib/mentorat-brief'

const argUser = process.argv[2]
const days = Number(process.argv[3]) || 90

async function main() {
  let userId = argUser
  if (!userId) {
    const top = await prisma.note.groupBy({
      by: ['userId'],
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 3,
    })
    console.log('Utilisateurs par volume de notes :', top.map(t => `${t.userId.slice(0, 8)}… (${t._count._all})`).join(', '))
    userId = top[0]?.userId
  }
  if (!userId) { console.log('Aucune note en base.'); return }

  const brief = await buildMentoratBrief(userId, days)
  console.log('\n═══ BRIEF STRUCTURÉ ═══')
  const { text, ...data } = brief
  console.log(JSON.stringify(data, null, 2))
  console.log('\n═══ BRIEF TEXTE (à joindre à une conversation IA) ═══\n')
  console.log(text)
}

main().finally(() => prisma.$disconnect())
