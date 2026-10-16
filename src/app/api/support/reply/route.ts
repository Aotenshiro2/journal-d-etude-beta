import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { repondreAuFil, type FichierReponse } from '@/lib/support-reponse'
import { MAX_FICHIER_COCKPIT, lireFichierSortant } from '@/lib/liveclub/support-pont-pur'

/**
 * POST /api/support/reply — la prise de main humaine depuis le cockpit.
 *
 * Réservé à l'allowlist du cockpit (`cockpit_allowlist`, la même qui garde
 * tout l'écran) : être authentifié ne prouve rien, le projet Supabase est
 * partagé avec un site à inscription publique.
 *
 * Ajoute un message `role: 'human'` au fil et remet `escalatedAt` à null :
 * la demande d'humain est prise en main. Le membre voit la réponse dans le
 * chat de son extension (qui recharge le fil à l'ouverture).
 *
 * Fil 'telegram' (bot membre Live Club, decision Brice du 29/09) : le membre
 * n'a pas de chat a rouvrir, la reponse lui PART dans Telegram par le bot
 * (sendMessage, jeton TELEGRAM_LIVECLUB_BOT_TOKEN). On envoie AVANT
 * d'enregistrer : si Telegram refuse (membre qui a bloque le bot, jeton
 * absent), rien n'est ecrit, la demande reste en attente et le cockpit
 * affiche la raison. Livre puis echec d'ecriture : 500 avec
 * livreTelegram=true, enregistre=false, pour que l'equipe ne renvoie pas.
 * La valeur app 'telegram' est reservee au pont (chat et escalate la
 * remplacent par leur valeur par defaut), un fil du site ne peut donc pas se faire passer pour un fil
 * Telegram.
 *
 * CORS : le cockpit (cockpit.aoknowledge.com) appelle depuis le navigateur,
 * contrairement à l'extension qui échappe au CORS par ses host_permissions.
 *
 * (16/10) L'envoi lui-même vit dans src/lib/support-reponse.ts (repondreAuFil),
 * partagé avec la réponse proposée par l'agent du cockpit (carte de
 * confirmation) : mêmes garde-fous. Cette route garde l'authentification, la
 * lecture du corps et ses réponses HTTP, inchangées (statuts et corps JSON).
 */

const MAX_MESSAGE_LEN = 4000

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  // Le garde réel : l'allowlist du cockpit, par UUID.
  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) {
    return NextResponse.json({ error: 'Réservé au cockpit' }, { status: 403, headers })
  }

  // (16/10) Multipart (bouton « joindre » de l'onglet Support, fil Telegram
  // seulement) : threadId, message (facultatif avec un fichier) et fichier.
  // Sinon le JSON d'avant, inchange.
  let threadId: string | null
  let message: string
  let fichier: File | null = null
  if ((req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
    const form = await req.formData().catch(() => null)
    const champ = (k: string) => { const v = form?.get(k); return typeof v === 'string' ? v : null }
    threadId = champ('threadId')
    message = (champ('message') ?? '').trim().slice(0, MAX_MESSAGE_LEN)
    const f = form?.get('fichier')
    fichier = f instanceof File && f.size > 0 ? f : null
  } else {
    const body = await req.json().catch(() => ({}))
    threadId = typeof body.threadId === 'string' ? body.threadId : null
    message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LEN) : ''
  }
  if (!threadId || (!message && !fichier)) {
    return NextResponse.json({ error: 'threadId et message requis' }, { status: 400, headers })
  }

  // Le fichier : type accepte et poids sous la limite d'un corps de fonction
  // Vercel, lus avant tout envoi ; puis en memoire, jamais sur disque.
  let piece: FichierReponse | null = null
  if (fichier) {
    const lu = lireFichierSortant({ type: 'document', mime: fichier.type, nom: fichier.name, taille: fichier.size }, MAX_FICHIER_COCKPIT)
    if (typeof lu === 'string') {
      return NextResponse.json({ error: lu }, { status: lu.startsWith('Fichier trop lourd') ? 413 : 415, headers })
    }
    piece = { lu, octets: new Uint8Array(await fichier.arrayBuffer()) }
  }

  const issue = await repondreAuFil(threadId, message, '[support/reply]', piece)
  if (issue.ok) {
    return issue.canal === 'telegram'
      ? NextResponse.json({
        ok: true,
        livreTelegram: true,
        enregistre: true,
        messages: issue.messages,
        escalatedAt: issue.escalatedAt,
      }, { headers })
      : NextResponse.json({ ok: true, messages: issue.messages, escalatedAt: null, livreTelegram: false }, { headers })
  }
  switch (issue.raison) {
    case 'introuvable':
      return NextResponse.json({ error: 'Fil introuvable' }, { status: 404, headers })
    case 'compte_illisible':
      return NextResponse.json({ error: 'Compte Telegram du fil illisible (migration 20260930090100 appliquée ?).' }, { status: 500, headers })
    case 'sans_compte':
      return NextResponse.json({ error: 'Ce fil Telegram ne porte aucun compte : réponse impossible à livrer.' }, { status: 409, headers })
    case 'non_livre':
      return NextResponse.json({ error: `Réponse non livrée dans Telegram : ${issue.detail}.` }, { status: 502, headers })
    case 'livre_non_enregistre':
      return NextResponse.json({
        ok: false,
        livreTelegram: true,
        enregistre: false,
        error: 'Réponse livrée dans Telegram mais non enregistrée dans le fil : ne la renvoie pas, le membre l\'a déjà reçue.',
      }, { status: 500, headers })
    case 'texte_invalide':
      // Inatteignable ici (message deja borne et non vide ci-dessus).
      return NextResponse.json({ error: 'threadId et message requis' }, { status: 400, headers })
    case 'piece_hors_telegram':
      return NextResponse.json({ error: "Pièce jointe : seulement pour un fil Telegram (le chat du site n'affiche que du texte)." }, { status: 400, headers })
    case 'legende_trop_longue':
      return NextResponse.json({ error: issue.detail }, { status: 400, headers })
  }
}
