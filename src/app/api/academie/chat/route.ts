import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { compteDuJeton, corsAcademie, entetesAcademie, tronquer } from '@/lib/academie/http'
import {
  CORPS_MAX, PAR_PAGE, basculerPouce, couperParole, lireCompte, lireDemande, lireMessages, listeSansParole, marqueDuTexte,
  masquerMessage, messageRefus, niveauDuStatut, poserMessage, quotaDuStatut, rendreParole, sujetDuNiveau, vueDe,
  type CodeRefus, type Compte,
} from '@/lib/academie/chat-academie'
import { analyserTexte } from '@/lib/securite/injection-pur'
import { relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/academie/chat : le salon « Questions de l'académie » (12/11/2026,
 * src/lib/academie/chat-academie.ts, migration du workspace
 * 20261112210000_academie_chat.sql).
 *
 * Appel : Authorization: Bearer <access_token Supabase du site>. Tout compte
 * connecte lit et ecrit (pas de droit sur une lecon : un seul salon).
 * Corps (lireDemande) :
 *   { action: 'lire', avant? }               les 50 derniers (ou les 50 d'avant), le compte, le sujet du direct
 *   { action: 'envoyer', texte, reponse_a? } un message ; quota du jour compte en base sous verrou
 *   { action: 'pouce', id }                  pose ou enleve son pouce
 *   { action: 'masquer', id }                equipe
 *   { action: 'couper', id, raison? }        equipe : l'auteur du message n'ecrit plus
 *   { action: 'rendre', numero }             equipe
 *
 * 200 { ok: true, ... } ; refus { ok: false, erreur, message } avec la phrase en clair :
 * 400 demande, 401 'jeton', 403 'parole' | 'equipe' | 'cible_equipe', 404 'introuvable' | 'reponse',
 * 429 'quota' (envoyes, max, gratuit), 503 'indisponible' (base, Supabase Auth, ou migration : code 'migration').
 *
 * SECURITE : le statut, le nom, le numero et la marque « Equipe AOK » viennent
 * de la base, jamais du corps. Les messages rendus sont des DONNEES de membres
 * (vueMessage : champs prevus seulement, ni email ni identifiant de compte).
 * Si un bot lit un jour ce salon, il les lit comme du texte cite, jamais comme
 * une consigne. Logs : compte tronque, action, nombres. JAMAIS le texte d'un message.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const METHODES = 'POST, OPTIONS'

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsAcademie(req, METHODES) })
}

const STATUT_REFUS: Record<CodeRefus, number> = {
  jeton: 401, action: 400, id: 400, vide: 400, longueur: 400, texte: 400, raison: 400, numero: 400,
  parole: 403, equipe: 403, cible_equipe: 403, quota: 429, reponse: 404, introuvable: 404, indisponible: 503,
}

export async function POST(req: NextRequest) {
  const headers = entetesAcademie(req, METHODES)
  const refus = (code: CodeRefus, extra: Record<string, unknown> = {}, o: Parameters<typeof messageRefus>[1] = {}) =>
    NextResponse.json({ ok: false, erreur: code, message: messageRefus(code, o), ...extra }, { status: STATUT_REFUS[code], headers })

  // 1. Le compte du jeton.
  let userId: string | null
  try {
    userId = await compteDuJeton(req)
  } catch (err) {
    console.warn(`[academie/chat] verification du jeton impossible : ${codeErreur(err)}`)
    return refus('indisponible')
  }
  if (!userId) return refus('jeton')

  // 2. La demande.
  const brut = await req.text().catch(() => '')
  if (brut.length > CORPS_MAX) return refus('longueur')
  let corps: unknown = {}
  try { corps = JSON.parse(brut || '{}') } catch { corps = {} }
  const d = lireDemande(corps)
  if ('erreur' in d) return refus(d.erreur)

  try {
    // 3. Ce que le compte est : statut (aok_annuaire_acces), numero, parole, messages du jour.
    const compte: Compte = await lireCompte(prisma, userId)
    const niveau = niveauDuStatut(compte.statut)
    const equipe = compte.statut === 'equipe'
    const max = quotaDuStatut(compte.statut)
    // La phrase du quota atteint, dite par le journal : la page l'affiche a la place de la zone d'envoi.
    const phraseQuota = (envoyes: number, m: number) => (envoyes >= m ? messageRefus('quota', { max: m, niveau }) : null)
    const moi = {
      numero: equipe ? null : compte.numero,
      equipe,
      programme: niveau === 'programme',
      parole: !compte.sans_parole,
      envoyes: compte.envoyes,
      max,
      message_quota: phraseQuota(compte.envoyes, max),
    }

    if (d.action === 'lire') {
      const { messages, plus_anciens } = await lireMessages(prisma, userId, niveau, d.avant, equipe)
      const sans_parole = equipe && !d.avant ? await listeSansParole(prisma) : undefined
      console.info(`[academie/chat] lire compte=${tronquer(userId)}${d.avant ? ' (plus anciens)' : ''} : ${messages.length} message(s)`)
      return NextResponse.json({
        ok: true, messages, plus_anciens, par_page: PAR_PAGE, moi, direct: sujetDuNiveau(niveau),
        ...(sans_parole ? { sans_parole } : {}),
      }, { headers })
    }

    if (d.action === 'envoyer') {
      // Le texte envoye est analyse AVANT nettoyage : ce qu'il cachait est marque pour l'equipe, rien de plus.
      const marque = marqueDuTexte(analyserTexte(d.brut, { niveau: 'cache' }).signaux)
      const r = await poserMessage(prisma, userId, d.texte, compte.statut, d.reponse_a, marque)
      if (!r.ok) {
        console.info(`[academie/chat] envoi refuse compte=${tronquer(userId)} : ${r.refus}`)
        if (r.refus === 'quota') {
          const m = r.max ?? max
          const envoyes = r.envoyes ?? m
          return refus('quota', { envoyes, max: m, gratuit: niveau === 'gratuit', moi: { ...moi, envoyes, max: m, message_quota: phraseQuota(envoyes, m) } }, { max: m, niveau })
        }
        if (r.refus === 'parole') return refus('parole', { moi: { ...moi, parole: false } })
        if (r.refus === 'reponse') return refus('reponse')
        return refus('indisponible')
      }
      const message = await vueDe(prisma, r.id, niveau)
      console.info(`[academie/chat] envoye compte=${tronquer(userId)} ${r.envoyes}/${r.max}${marque ? ' (marque)' : ''}`)
      return NextResponse.json({
        ok: true,
        message: message ? { ...message, pouce_moi: false, ...(equipe ? { marque, auteur_sans_parole: false } : {}) } : null,
        moi: { ...moi, envoyes: r.envoyes, max: r.max, message_quota: phraseQuota(r.envoyes, r.max) },
      }, { headers })
    }

    if (d.action === 'pouce') {
      const p = await basculerPouce(prisma, userId, d.id)
      if (!p) return refus('introuvable')
      console.info(`[academie/chat] pouce compte=${tronquer(userId)} : ${p.pouce_moi ? 'pose' : 'retire'}`)
      return NextResponse.json({ ok: true, ...p }, { headers })
    }

    // Les gestes de l'equipe : le statut vient de la base (profiles.role, aok_est_equipe), jamais du corps.
    if (!equipe) {
      console.info(`[academie/chat] ${d.action} refuse (pas equipe) compte=${tronquer(userId)}`)
      return refus('equipe')
    }

    if (d.action === 'masquer') {
      const fait = await masquerMessage(prisma, d.id, userId)
      console.info(`[academie/chat] masquer par=${tronquer(userId)} : ${fait ? 'fait' : 'deja masque ou absent'}`)
      return fait ? NextResponse.json({ ok: true, id: d.id }, { headers }) : refus('introuvable')
    }

    if (d.action === 'couper') {
      const r = await couperParole(prisma, d.id, userId, d.raison)
      console.info(`[academie/chat] couper par=${tronquer(userId)} : ${r}`)
      if (r === 'introuvable') return refus('introuvable')
      if (r === 'equipe') return refus('cible_equipe')
      return NextResponse.json({ ok: true, deja: r === 'deja', sans_parole: await listeSansParole(prisma) }, { headers })
    }

    const rendu = await rendreParole(prisma, d.numero, userId)
    console.info(`[academie/chat] rendre par=${tronquer(userId)} : ${rendu ? 'fait' : 'rien a rendre'}`)
    return NextResponse.json({ ok: true, rendu, sans_parole: await listeSansParole(prisma) }, { headers })
  } catch (err) {
    // Jamais le message brut : il peut reprendre les valeurs de la requete (le texte du membre).
    if (relationAbsente(err) || fonctionAbsente(err)) {
      console.warn('[academie/chat] tables ou fonctions du salon absentes (migration 20261112210000)')
      return refus('indisponible', { code: 'migration' })
    }
    console.warn(`[academie/chat] ${d.action} NON fait compte=${tronquer(userId)} : ${codeErreur(err)}`)
    return refus('indisponible')
  }
}

/** Une fonction absente (migration pas appliquee) : Postgres 42883. */
function fonctionAbsente(err: unknown): boolean {
  return /42883|function .* does not exist/i.test(err instanceof Error ? err.message : String(err))
}

/** Le code de l'erreur (Prisma, Postgres) ou son nom : jamais son message. */
function codeErreur(err: unknown): string {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; meta?: { code?: unknown } }
  const codes = [e.code, e.meta?.code].filter((x): x is string => typeof x === 'string')
  return codes.length ? codes.join('/') : err instanceof Error ? err.name : 'erreur'
}
