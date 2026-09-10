import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Webhook du bot ADMIN du groupe Telegram Live Club (chantier du 10/09).
//
// Il ne fait qu'UNE chose : tenir `cockpit_telegram_membres` a jour au fil
// des entrees et sorties. Il ne recoit QUE les evenements d'adhesion
// (allowed_updates=chat_member au setWebhook) — AUCUN message du groupe ne
// passe par ici, par construction : la table dit QUI est la, jamais ce qui
// s'y dit.
//
// C'est un bot DIFFERENT de l'agent (@aok_cockpit_bot) : l'agent parle en
// prive a Brice et Melanie, celui-ci vit dans un groupe de membres. Meler
// les deux aurait mis le webhook de l'agent sous le bruit du groupe.
//
// Verrous : le secret de webhook, et le chat_id du groupe quand il est
// connu (TELEGRAM_LIVECLUB_CHAT_ID) — un update d'un autre chat est ignore.
// Tant que la variable n'est pas posee, on loggue le chat.id observe pour
// pouvoir la poser (premier evenement = decouverte de l'identifiant).

export const maxDuration = 30

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_LIVECLUB_WEBHOOK_SECRET?.trim()
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = await req.json().catch(() => ({}))

  // `my_chat_member` = le statut du BOT change (ajoute au groupe, promu
  // admin…) : c'est le moment ou on decouvre le chat_id du groupe.
  if (update.my_chat_member) {
    const chat = update.my_chat_member.chat
    console.log(`[liveclub/telegram] bot ${update.my_chat_member.new_chat_member?.status} `
      + `dans « ${chat?.title} » — chat_id ${chat?.id} (a poser en TELEGRAM_LIVECLUB_CHAT_ID)`)
    return NextResponse.json({ ok: true })
  }

  const cm = update.chat_member
  if (!cm) return NextResponse.json({ ok: true })

  const chatAttendu = process.env.TELEGRAM_LIVECLUB_CHAT_ID?.trim()
  if (chatAttendu && String(cm.chat?.id) !== chatAttendu) {
    return NextResponse.json({ ok: true })
  }

  const nouveau = cm.new_chat_member
  const u = nouveau?.user
  if (!u?.id || u.is_bot) return NextResponse.json({ ok: true })

  // member/administrator/creator/restricted = dedans ; left/kicked = dehors.
  const present = ['member', 'administrator', 'creator', 'restricted'].includes(nouveau.status)
  const pseudo = (u.username || '').replace(/^@/, '') || null
  const nomAffiche = [u.first_name, u.last_name].filter(Boolean).join(' ') || null
  const quand = new Date((cm.date ?? Math.floor(Date.now() / 1000)) * 1000)

  await prisma.$executeRaw`
    insert into public.cockpit_telegram_membres
      (telegram_id, pseudo, nom_affiche, present, entre_le, sorti_le, source, maj_le)
    values (${u.id}, ${pseudo}, ${nomAffiche}, ${present},
            ${present ? quand : null}, ${present ? null : quand}, 'evenement', now())
    on conflict (telegram_id) do update set
      pseudo = coalesce(excluded.pseudo, cockpit_telegram_membres.pseudo),
      nom_affiche = coalesce(excluded.nom_affiche, cockpit_telegram_membres.nom_affiche),
      present = excluded.present,
      entre_le = case when excluded.present
                      then coalesce(cockpit_telegram_membres.entre_le, ${quand})
                      else cockpit_telegram_membres.entre_le end,
      sorti_le = case when excluded.present then null else ${quand} end,
      source = 'evenement',
      maj_le = now()`

  return NextResponse.json({ ok: true })
}
