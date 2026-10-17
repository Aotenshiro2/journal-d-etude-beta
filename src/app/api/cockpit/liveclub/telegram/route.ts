import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { traiterBouton, traiterDemandeAdhesion, traiterMessagePrive } from '@/lib/liveclub/bot-membre'
import { accueilAPublier, nomPourAccueil, texteAccueil, type AvantEntree } from '@/lib/liveclub/accueil-groupe'
import { appelTelegram } from '@/lib/liveclub/telegram'
import { noterNomTelegram } from '@/lib/liveclub/noms'
import { chatDeLUpdate } from '@/lib/liveclub/mouvements-pur'
import { chatsTracesDuServeur, enregistrerMouvement } from '@/lib/liveclub/mouvements'

// Webhook du bot du groupe Telegram Live Club, @aok_liveclub_bot (chantier du
// 10/09, etendu le 29/09).
//
// Deux metiers sur le meme webhook :
// 1. tenir `cockpit_telegram_membres` a jour au fil des entrees et sorties
//    (chat_member, my_chat_member) : comportement du 10/09, inchange ;
// 2. depuis le 29/09, le bot des MEMBRES (lib/liveclub/bot-membre.ts) :
//    demandes d'adhesion nees de nos liens, /start avec le jeton personnel,
//    menu a boutons, confirmations, agent Haiku en prive.
//
// PREMIERE REGLE, avant tout le reste : un message qui n'est pas prive est
// ignore sans log ni ecriture. Le bot est admin du groupe et "message" est
// ecoute pour le prive : sans ce filtre, tout ce qui se dit dans le groupe
// passerait par ici. La table dit QUI est la, jamais ce qui s'y dit.
//
// C'est un bot DIFFERENT de l'agent (@aok_cockpit_bot) : l'agent parle en
// prive a Brice et Melanie, celui-ci aux membres du groupe.
//
// Verrous : le secret de webhook, et le chat_id du groupe quand il est
// connu (TELEGRAM_LIVECLUB_CHAT_ID) : un update d'un autre chat est ignore.
// Tant que la variable n'est pas posee, on loggue le chat.id observe pour
// pouvoir la poser (premier evenement = decouverte de l'identifiant).

// 60 s suffisaient a une reponse de l'agent des membres (Haiku, quelques
// outils). 120 s depuis le 08/10 : le texte libre d'un compte de l'equipe est
// transmis a l'agent du Cockpit (meme duree que sa route), qui peut reflechir
// une ou deux minutes. Un rejeu de Telegram pendant ce temps est ecarte par le
// dedoublonnage du bot (premierPassage).
export const maxDuration = 120

// Les six statuts de ChatMember, ceux qu'accepte la contrainte de statut_tg.
const STATUTS_TG: unknown[] = ['creator', 'administrator', 'member', 'restricted', 'left', 'kicked']

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_LIVECLUB_WEBHOOK_SECRET?.trim()
  if (!secret || req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const update = await req.json().catch(() => ({}))

  // (1) Hors prive : rien, tout de suite, sans log ni ecriture.
  if (update.message && update.message.chat?.type !== 'private') {
    return NextResponse.json({ ok: true })
  }

  const updateId = Number(update.update_id)
  const idLisible = Number.isSafeInteger(updateId)

  // (17/10) Les chats TRACES (TELEGRAM_CHATS_TRACES : le canal MELMOM et le
  // groupe Les AS du NAS de Melanie, ou le bot est admin sans droits). On y
  // ENREGISTRE chaque chat_member (cockpit_telegram_mouvements) et RIEN
  // D'AUTRE : ni message, ni accueil, ni exclusion, ni logique du Live Club.
  // Leurs messages sont deja ecartes par (1), leurs channel_post ne sont pas
  // demandes a Telegram. Retour immediat, avant tout traitement du Live Club,
  // qui ne voit jamais ces updates (lib/liveclub/mouvements.ts). Le chat du
  // Live Club n'est jamais traite ici, meme mis par erreur dans la liste.
  const chatUpdate = chatDeLUpdate(update)
  if (chatUpdate && chatsTracesDuServeur().has(chatUpdate)) {
    if (update.chat_member && idLisible) {
      await enregistrerMouvement(updateId, update.chat_member)
    } else if (update.my_chat_member) {
      const chat = update.my_chat_member.chat
      console.log(`[liveclub/telegram] bot ${update.my_chat_member.new_chat_member?.status} `
        + `dans le chat trace « ${chat?.title} » (${chat?.id})`)
    }
    return NextResponse.json({ ok: true })
  }

  // Bot des membres. Une panne ici ne doit jamais faire rejouer l'update en
  // boucle par Telegram : on loggue (sans texte ni identifiant de membre) et
  // on repond 200. Le dedoublonnage (2) vit dans chaque traitement.
  if (update.message || update.callback_query || update.chat_join_request) {
    if (!idLisible) return NextResponse.json({ ok: true })
    try {
      if (update.message) await traiterMessagePrive(update.message, updateId)
      else if (update.callback_query) await traiterBouton(update.callback_query, updateId)
      else await traiterDemandeAdhesion(update.chat_join_request, updateId)
    } catch (err) {
      const genre = update.message ? 'message' : update.callback_query ? 'bouton' : 'demande'
      console.error(`[liveclub/telegram] ${genre} non traite : ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200)}`)
    }
    return NextResponse.json({ ok: true })
  }

  // `my_chat_member` = le statut du BOT change (ajoute au groupe, promu
  // admin…) : c'est le moment ou on decouvre le chat_id du groupe.
  if (update.my_chat_member) {
    const chat = update.my_chat_member.chat
    // En prive, my_chat_member = un membre qui bloque ou debloque le bot :
    // rien a decouvrir, et rien a logguer sur lui.
    if (chat?.type === 'private') return NextResponse.json({ ok: true })
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

  // QUI a fait le geste : `from` est l'auteur du changement. Lui-meme = un
  // depart volontaire ou une entree par lien ; un bot (Metricgram, le notre)
  // ou un admin = un geste execute. C'est la matiere de la regle « un maitre
  // par geste » : sans l'auteur, tous les departs se ressemblent.
  const acteur = cm.from
  const parQui = !acteur ? null
    : acteur.id === u.id ? 'lui-même'
    : (acteur.username ? `@${acteur.username}` : [acteur.first_name, acteur.last_name].filter(Boolean).join(' ')) || null

  // (13/10) L'accueil se decide sur la ligne AVANT l'upsert : jamais vu =
  // nouveau, longtemps parti = retour (accueil-groupe.ts). Lecture ratee = pas
  // d'accueil, la presence est tenue quand meme.
  let avant: AvantEntree = null
  let avantLu = true
  try {
    const lignes = await prisma.$queryRaw<{ present: boolean | null; sorti_le: Date | null }[]>`
      select present, sorti_le from public.cockpit_telegram_membres where telegram_id = ${u.id}`
    avant = lignes[0] ? { present: lignes[0].present, sortiLe: lignes[0].sorti_le } : null
  } catch {
    avantLu = false
  }

  await prisma.$executeRaw`
    insert into public.cockpit_telegram_membres
      (telegram_id, pseudo, nom_affiche, present, entre_le, sorti_le, source, par_qui, maj_le)
    values (${u.id}, ${pseudo}, ${nomAffiche}, ${present},
            ${present ? quand : null}, ${present ? null : quand}, 'evenement', ${parQui}, now())
    on conflict (telegram_id) do update set
      pseudo = coalesce(excluded.pseudo, cockpit_telegram_membres.pseudo),
      nom_affiche = coalesce(excluded.nom_affiche, cockpit_telegram_membres.nom_affiche),
      present = excluded.present,
      entre_le = case when excluded.present
                      then coalesce(cockpit_telegram_membres.entre_le, ${quand})
                      else cockpit_telegram_membres.entre_le end,
      sorti_le = case when excluded.present then null else ${quand} end,
      source = 'evenement',
      par_qui = ${parQui},
      maj_le = now()`

  // (15/10) L'historique des noms (cockpit_telegram_noms, source 'evenement') :
  // le nom et le pseudo tels que l'evenement les donne, entree ou sortie.
  // Best effort, ne leve jamais (lib/liveclub/noms.ts).
  await noterNomTelegram(u, 'evenement', quand)

  // Le statut Telegram BRUT (29/09, chantier sortie de Metricgram) : `present`
  // ne distingue pas un depart volontaire (left) d'un bannissement (kicked),
  // ni un admin d'un membre. La colonne statut_tg le garde tel quel. Un statut
  // hors de la liste connue n'est pas ecrit, plutot que de buter sur la
  // contrainte check (Telegram rejouerait l'update en boucle).
  // Ecrit A PART de l'upsert, en best effort : la colonne vient de la
  // migration 20260929190300, et si le code part avant elle, la presence
  // (l'upsert ci-dessus) doit continuer d'etre tenue. Colonne absente
  // (42703) = on passe, avec un avertissement dans les logs.
  const statutTg = STATUTS_TG.includes(nouveau.status) ? String(nouveau.status) : null
  if (statutTg) {
    try {
      await prisma.$executeRaw`
        update public.cockpit_telegram_membres
        set statut_tg = ${statutTg}
        where telegram_id = ${u.id}`
    } catch (err) {
      const texte = err instanceof Error ? err.message : String(err)
      if (!/42703|column .*statut_tg.* does not exist/i.test(texte)) throw err
      console.warn('[liveclub/telegram] colonne statut_tg absente (migration 20260929190300 pas appliquee) : statut non ecrit.')
    }
  }

  // L'accueil dans le groupe, en best effort : un echec d'envoi ne fait pas
  // rejouer l'update (et un rejeu ne republie pas : la ligne dit « present »).
  const accueil = avantLu ? accueilAPublier(avant, cm.old_chat_member?.status, present, quand) : null
  if (accueil) {
    const r = await appelTelegram('sendMessage', {
      chat_id: cm.chat.id,
      text: texteAccueil(accueil, nomPourAccueil(pseudo, u.first_name)),
    })
    if (!r.ok) console.warn(`[liveclub/telegram] accueil (${accueil}) non publie : ${r.erreur.slice(0, 160)}`)
  }

  return NextResponse.json({ ok: true })
}
