import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { estGroupe, lireSaisieEmail } from '@/lib/academie/emails-annonces'
import {
  apercu, configEnvoi, envoyeurPour, executerEnvoi, inscrireAnnonce, lireAdressesEssai, lireBilletPourEmail, lireDetail,
  lireDroits, lireEtat, preparerEnvoi,
} from '@/lib/academie/emails-annonces-serveur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/academie/emails : l'EMAIL A TOUS LES MEMBRES depuis le cockpit (13/11/2026,
 * espace Annonces, onglet « Emails aux membres » ; src/lib/academie/emails-annonces.ts ; migration
 * 20261113210000_academie_emails_annonces.sql). Remplace l'email a tous de Skool (ferme le 16/11).
 *
 * Reservee a cockpit_allowlist (verifiee serveur), jeton de session du cockpit en Bearer.
 * SIMULATION tant que ANNONCES_EMAIL_MODE ne vaut pas « reel » : rien ne part, meme l'essai.
 *
 * { action: 'etat' }
 *   200 { ok, transport, expediteur, delai_garde_h, garde, droits, groupes, desinscrits_total, historique }
 * { action: 'apercu', objet, texte, billet_id? }
 *   200 { ok, sujet, html, texte } (l'email d'un membre, lien de desinscription factice)
 * { action: 'essai', objet, texte, billet_id?, pour: 'moi' | 'equipe' }
 *   Essai a l'appelant, ou aux admins de l'allowlist. Sujet « [Essai] ». 200 { ok, envoi, historique }
 * { action: 'envoyer', objet, texte, billet_id?, groupe, confirmation, forcer? }
 *   Envoi REEL : compte admin seulement (pas le compte de Tab). confirmation = le nombre de
 *   destinataires affiche (sinon 409 avec le bon nombre). Garde : un envoi reel par 72 h, sinon 409,
 *   sauf forcer (Brice seul, sinon 403). Un billet doit etre publie. 200 { ok, envoi, historique }
 * { action: 'reprendre', envoi_id }   finit un envoi coupe (lignes restees a envoyer). Admin.
 * { action: 'detail', envoi_id }      les echecs d'un envoi (adresse, raison, erreur) et le compte par raison.
 * 400 saisie refusee ; 401 ; 403 ; 404 ; 409 ; 503 migration absente ou base indisponible.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export function OPTIONS(req: NextRequest) {
  return corsPreflight(req)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const headers: Record<string, string> = corsHeaders(req)
  const repondre = (corps: Record<string, unknown>, status = 200) => NextResponse.json(corps, { status, headers })
  const userId = await getUserId(req)
  if (!userId) return repondre({ error: 'Unauthorized' }, 401)

  const allow = await prisma.$queryRaw<{ ok: number }[]>`
    select 1 as ok from public.cockpit_allowlist where user_id = ${userId}::uuid`
  if (allow.length === 0) return repondre({ error: 'Réservé au cockpit' }, 403)

  const corps: unknown = await req.json().catch(() => ({}))
  const c = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>
  const action = c.action
  const cfg = configEnvoi()
  const maintenant = new Date()

  try {
    if (action === 'etat') {
      return repondre({ ok: true, ...(await lireEtat(prisma, userId, maintenant, cfg)) })
    }

    if (action === 'detail') {
      if (typeof c.envoi_id !== 'string' || !UUID.test(c.envoi_id)) return repondre({ error: 'Envoi inconnu.' }, 400)
      return repondre({ ok: true, ...(await lireDetail(prisma, c.envoi_id)) })
    }

    if (action === 'apercu' || action === 'essai' || action === 'envoyer') {
      const saisie = lireSaisieEmail(corps, action === 'envoyer')
      if ('erreur' in saisie) return repondre({ error: saisie.erreur }, 400)
      let lien: string | null = null
      if (saisie.billetId) {
        const b = await lireBilletPourEmail(prisma, saisie.billetId)
        if (!b) return repondre({ error: 'Billet inconnu : relis la liste des billets.' }, 404)
        if (action === 'envoyer' && b.retire) return repondre({ error: 'Ce billet est retiré.' }, 409)
        if (action === 'envoyer' && !b.publie) {
          return repondre({ error: 'Le billet n\'est pas encore publié : l\'email pointerait vers une leçon fermée. Envoie-le après sa publication.' }, 409)
        }
        lien = b.lien
      }

      if (action === 'apercu') {
        const e = apercu(saisie, lien)
        return repondre({ ok: true, sujet: e.sujet, html: e.html, texte: e.texte })
      }

      const envoyeur = envoyeurPour(cfg)
      if ('erreur' in envoyeur) return repondre({ error: envoyeur.erreur }, 503)
      if (!cfg.secret) return repondre({ error: 'SUPABASE_SERVICE_ROLE_KEY absente : pas de lien de désinscription, rien ne part.' }, 503)

      if (action === 'essai') {
        const pour = c.pour === 'equipe' ? 'equipe' : 'moi'
        const adresses = await lireAdressesEssai(prisma, userId, pour)
        const issue = await prisma.$transaction(tx => preparerEnvoi(tx, {
          mode: 'essai', transport: cfg.transport, saisie, lien, par: userId, maintenant, adressesEssai: adresses,
          groupeEssai: pour === 'equipe' ? 'essai_equipe' : 'essai_moi',
        }), { timeout: 15_000, maxWait: 5_000 })
        if (issue.issue !== 'ok') return repondre({ error: 'Aucune adresse d\'équipe trouvée pour l\'essai.' }, 409)
        const bilan = await executerEnvoi(prisma, issue.envoiId, cfg, envoyeur)
        console.info(`[cockpit/academie/emails] essai ${pour} envoi=${issue.envoiId.slice(0, 8)} ${cfg.transport} : ${bilan.envoyes} ok, ${bilan.echecs} echec(s)`)
        return repondre({ ok: true, envoi: bilan, ...(await lireEtat(prisma, userId, new Date(), cfg)) })
      }

      // action === 'envoyer' : l'envoi reel.
      const { droits } = await lireDroits(prisma, userId)
      if (!droits.envoyer_reel) return repondre({ error: 'L\'envoi aux membres est réservé à Brice, Mélanie et Adil.' }, 403)
      const forcer = c.forcer === true
      if (forcer && !droits.forcer) return repondre({ error: 'Seul Brice peut passer outre la garde de 72 h.' }, 403)
      const confirmation = typeof c.confirmation === 'number' && Number.isInteger(c.confirmation) ? c.confirmation : -1
      const issue = await prisma.$transaction(tx => preparerEnvoi(tx, {
        mode: 'reel', transport: cfg.transport, saisie, lien, par: userId, maintenant, forcer, confirmation,
      }), { timeout: 20_000, maxWait: 5_000 })
      if (issue.issue === 'garde') {
        return repondre({ error: `Un envoi aux membres est déjà parti il y a moins de 72 h. Prochain envoi possible : ${issue.garde.libre_le}.`, garde: issue.garde }, 409)
      }
      if (issue.issue === 'vide') return repondre({ error: 'Aucun destinataire dans ce groupe (désinscrits retirés).' }, 409)
      if (issue.issue === 'confirmation') {
        return repondre({ error: `La liste a changé : ${issue.attendu} destinataires maintenant. Relis puis confirme ce nombre.`, attendu: issue.attendu }, 409)
      }
      const bilan = await executerEnvoi(prisma, issue.envoiId, cfg, envoyeur)
      if (bilan.envoyes > 0) await inscrireAnnonce(prisma, issue.envoiId, saisie.groupe, issue.destinataires)
      console.info(`[cockpit/academie/emails] reel envoi=${issue.envoiId.slice(0, 8)} ${cfg.transport} groupe=${saisie.groupe} : ${bilan.envoyes}/${issue.destinataires} ok, ${bilan.echecs} echec(s), ${issue.exclus} desinscrit(s) exclu(s)${issue.force ? ', garde forcee' : ''}`)
      return repondre({ ok: true, envoi: bilan, ...(await lireEtat(prisma, userId, new Date(), cfg)) })
    }

    if (action === 'reprendre') {
      if (typeof c.envoi_id !== 'string' || !UUID.test(c.envoi_id)) return repondre({ error: 'Envoi inconnu.' }, 400)
      const { droits } = await lireDroits(prisma, userId)
      if (!droits.envoyer_reel) return repondre({ error: 'Réservé à Brice, Mélanie et Adil.' }, 403)
      const envoyeur = envoyeurPour(cfg)
      if ('erreur' in envoyeur) return repondre({ error: envoyeur.erreur }, 503)
      const bilan = await executerEnvoi(prisma, c.envoi_id, cfg, envoyeur)
      const ligne = await prisma.$queryRawUnsafe<{ mode: string; groupe: string; destinataires: number }[]>(
        'select mode, groupe, destinataires from public.academie_emails_envois where id = $1::uuid', c.envoi_id)
      const g = ligne[0]
      if (g && g.mode === 'reel' && bilan.envoyes > 0 && estGroupe(g.groupe)) {
        await inscrireAnnonce(prisma, c.envoi_id, g.groupe, Number(g.destinataires))
      }
      return repondre({ ok: true, envoi: bilan, ...(await lireEtat(prisma, userId, new Date(), cfg)) })
    }

    return repondre({ error: 'Action inconnue.' }, 400)
  } catch (err) {
    if (relationAbsente(err)) {
      return repondre({ error: 'Migration des emails aux membres pas encore appliquée (20261113210000).' }, 503)
    }
    const m = messageErreur(err)
    if (/envoi introuvable/.test(m)) return repondre({ error: 'Envoi inconnu.' }, 404)
    // Jamais le message brut dans la reponse (il peut citer une adresse).
    console.error(`[cockpit/academie/emails] ${String(action)} : echec (${m.replace(/[^\s@]+@[^\s@]+/g, '[email]').slice(0, 300)})`)
    return repondre({ error: 'La base ou l\'envoi a refusé : rien n\'est perdu, relis l\'historique avant de réessayer.' }, 503)
  }
}
