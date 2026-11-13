import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { estGroupeEnvoi, lireSaisieEmail, transportEnvoi } from '@/lib/academie/emails-annonces'
import {
  apercu, configEnvoi, envoyerParBroadcast, envoyeurPour, executerEnvoi, inscrireAnnonce, lireAdressesEssai, lireBilletPourEmail,
  lireDetail, lireDroits, lireEtat, lireGarde, noterSynchro, preparerEnvoi, simulerBroadcast, synchroniser,
} from '@/lib/academie/emails-annonces-serveur'
import { messageErreur, relationAbsente } from '@/lib/liveclub/pur'

/**
 * POST /api/cockpit/academie/emails : l'EMAIL A TOUS LES MEMBRES depuis le cockpit (13/11/2026,
 * espace Annonces, onglet « Emails aux membres » ; src/lib/academie/emails-annonces.ts et
 * emails-broadcast.ts ; migration 20261113210000_academie_emails_annonces.sql). Remplace l'email
 * a tous de Skool (ferme le 16/11). L'envoi aux membres est un BROADCAST de Resend (plan
 * gratuit, Brice : « Ok B ») ; les essais restent des emails transactionnels.
 *
 * Reservee a cockpit_allowlist (verifiee serveur), jeton de session du cockpit en Bearer.
 * SIMULATION tant que ANNONCES_EMAIL_MODE ne vaut pas « reel » : rien ne part, meme l'essai, et
 * rien n'est ecrit chez Resend (seules des lectures : cle, domaine, contacts).
 *
 * { action: 'etat' }
 *   200 { ok, transport, voie, expediteur, delai_garde_h, garde, droits, groupes (tous, comptes), desinscrits_total, historique }
 * { action: 'apercu', objet, texte, billet_id? }
 *   200 { ok, sujet, html, texte } (l'email d'un membre, lien de desinscription factice)
 * { action: 'essai', objet, texte, billet_id?, pour: 'moi' | 'equipe' }
 *   Essai a l'appelant, ou aux admins de l'allowlist, en email transactionnel. Sujet « [Essai] ».
 *   200 { ok, envoi, ...etat }
 * { action: 'synchro', appliquer? }
 *   Compare nos adresses (groupe « tous ») aux contacts Resend. Par defaut, ou en simulation :
 *   lectures seules, 200 { ok, synchro: { mode, applique: false, cle, lu_chez_resend, plan } }.
 *   appliquer: true (admin, serveur en mode reel) : ecrit le plan chez Resend.
 * { action: 'envoyer', objet, texte, billet_id?, groupe: 'tous' | 'comptes', confirmation, forcer? }
 *   Envoi aux membres : compte admin seulement (pas le compte de Tab). Garde de 72 h (sauf forcer,
 *   Brice seul). Synchronisation juste avant (reelle en mode reel, lue seulement en simulation),
 *   puis confirmation = le nombre de destinataires affiche (sinon 409 avec le bon nombre), puis
 *   le Broadcast (ou sa simulation). Un billet doit etre publie. 200 { ok, envoi, broadcast, synchro, ...etat }
 * { action: 'reprendre', envoi_id }   finit un envoi coupe (Broadcast : brouillon retrouve, jamais deux). Admin.
 * { action: 'detail', envoi_id }      les echecs d'un envoi (adresse, raison, erreur) et le compte par raison.
 * 400 saisie refusee ; 401 ; 403 ; 404 ; 409 ; 503 migration absente, cle ou base indisponible.
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

    if (action === 'synchro') {
      const appliquer = c.appliquer === true
      if (appliquer) {
        const { droits } = await lireDroits(prisma, userId)
        if (!droits.envoyer_reel) return repondre({ error: 'La synchronisation réelle est réservée à Brice, Mélanie et Adil.' }, 403)
        if (cfg.transport !== 'resend') return repondre({ error: 'Le journal est en simulation : la synchronisation réelle attend ANNONCES_EMAIL_MODE=reel.' }, 409)
      }
      const synchro = await synchroniser(prisma, cfg, { appliquer })
      return repondre({ ok: true, synchro })
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

      if (action === 'essai') {
        const envoyeur = envoyeurPour(cfg)
        if ('erreur' in envoyeur) return repondre({ error: envoyeur.erreur }, 503)
        if (!cfg.secret) return repondre({ error: 'SUPABASE_SERVICE_ROLE_KEY absente : pas de lien de désinscription, rien ne part.' }, 503)
        const pour = c.pour === 'equipe' ? 'equipe' : 'moi'
        const adresses = await lireAdressesEssai(prisma, userId, pour)
        const issue = await prisma.$transaction(tx => preparerEnvoi(tx, {
          mode: 'essai', transport: transportEnvoi('essai', cfg.transport), saisie, lien, par: userId, maintenant, adressesEssai: adresses,
          groupeEssai: pour === 'equipe' ? 'essai_equipe' : 'essai_moi',
        }), { timeout: 15_000, maxWait: 5_000 })
        if (issue.issue !== 'ok') return repondre({ error: 'Aucune adresse d\'équipe trouvée pour l\'essai.' }, 409)
        const bilan = await executerEnvoi(prisma, issue.envoiId, cfg, envoyeur)
        console.info(`[cockpit/academie/emails] essai ${pour} envoi=${issue.envoiId.slice(0, 8)} ${cfg.transport} : ${bilan.envoyes} ok, ${bilan.echecs} echec(s)`)
        return repondre({ ok: true, envoi: bilan, ...(await lireEtat(prisma, userId, new Date(), cfg)) })
      }

      // action === 'envoyer' : l'envoi aux membres, un Broadcast (ou sa simulation).
      const { droits } = await lireDroits(prisma, userId)
      if (!droits.envoyer_reel) return repondre({ error: 'L\'envoi aux membres est réservé à Brice, Mélanie et Adil.' }, 403)
      const forcer = c.forcer === true
      if (forcer && !droits.forcer) return repondre({ error: 'Seul Brice peut passer outre la garde de 72 h.' }, 403)
      const confirmation = typeof c.confirmation === 'number' && Number.isInteger(c.confirmation) ? c.confirmation : -1

      // La garde d'abord (lecture) : pas de synchronisation pour un envoi qui serait refuse.
      const garde = await lireGarde(prisma, cfg.transport, maintenant)
      if (garde.bloque && !forcer) {
        return repondre({ error: `Un envoi aux membres est déjà parti il y a moins de 72 h. Prochain envoi possible : ${garde.libre_le}.`, garde }, 409)
      }

      // La synchronisation juste avant : reelle en mode reel, LUE seulement en simulation.
      const synchro = await synchroniser(prisma, cfg, { appliquer: cfg.transport === 'resend' })
      if (cfg.transport === 'resend') {
        if (synchro.cle.acces !== 'complet' || !synchro.cle.domaine_verifie) {
          return repondre({ error: `${synchro.cle.message} Rien n'est parti.`, synchro }, 503)
        }
        if (!synchro.applique || synchro.erreur) {
          return repondre({ error: `Synchronisation des contacts incomplète, rien n'est parti : ${synchro.erreur ?? 'raison inconnue'}`, synchro }, 503)
        }
        if ((synchro.resultat?.imports_lances ?? 0) > 0) {
          return repondre({ error: 'Les contacts sont en cours d\'import chez Resend. Rien n\'est parti : réessaie dans une minute.', synchro }, 409)
        }
      }

      const issue = await prisma.$transaction(tx => preparerEnvoi(tx, {
        mode: 'reel', transport: transportEnvoi('reel', cfg.transport), saisie, lien, par: userId, maintenant, forcer, confirmation,
      }), { timeout: 20_000, maxWait: 5_000 })
      if (issue.issue === 'garde') {
        return repondre({ error: `Un envoi aux membres est déjà parti il y a moins de 72 h. Prochain envoi possible : ${issue.garde.libre_le}.`, garde: issue.garde }, 409)
      }
      if (issue.issue === 'vide') return repondre({ error: 'Aucun destinataire dans ce groupe (désinscrits retirés).' }, 409)
      if (issue.issue === 'confirmation') {
        return repondre({ error: `La liste a changé : ${issue.attendu} destinataires maintenant. Relis puis confirme ce nombre.`, attendu: issue.attendu }, 409)
      }
      await noterSynchro(prisma, issue.envoiId, synchro)
      const bilan = cfg.transport === 'resend'
        ? await envoyerParBroadcast(prisma, issue.envoiId, cfg)
        : await simulerBroadcast(prisma, issue.envoiId)
      if (bilan.envoyes > 0) await inscrireAnnonce(prisma, issue.envoiId, saisie.groupe, issue.destinataires)
      console.info(`[cockpit/academie/emails] reel envoi=${issue.envoiId.slice(0, 8)} ${cfg.transport} groupe=${saisie.groupe} : ${bilan.envoyes}/${issue.destinataires} ${bilan.broadcast.simule ? 'simules' : 'confies au Broadcast'}, ${issue.exclus} desinscrit(s) exclu(s)${issue.force ? ', garde forcee' : ''}`)
      return repondre({ ok: true, envoi: bilan, broadcast: bilan.broadcast, synchro, ...(await lireEtat(prisma, userId, new Date(), cfg)) })
    }

    if (action === 'reprendre') {
      if (typeof c.envoi_id !== 'string' || !UUID.test(c.envoi_id)) return repondre({ error: 'Envoi inconnu.' }, 400)
      const { droits } = await lireDroits(prisma, userId)
      if (!droits.envoyer_reel) return repondre({ error: 'Réservé à Brice, Mélanie et Adil.' }, 403)
      const ligne = (await prisma.$queryRawUnsafe<{ mode: string; transport: string; groupe: string; destinataires: number }[]>(
        'select mode, transport, groupe, destinataires from public.academie_emails_envois where id = $1::uuid', c.envoi_id))[0]
      if (!ligne) return repondre({ error: 'Envoi inconnu.' }, 404)
      let bilan
      if (ligne.transport === 'broadcast') {
        if (cfg.transport !== 'resend') return repondre({ error: 'Le journal est repassé en simulation : un Broadcast ne se reprend qu\'en mode réel.' }, 409)
        bilan = await envoyerParBroadcast(prisma, c.envoi_id, cfg)
      } else if (ligne.transport === 'simulation' && ligne.mode === 'reel') {
        bilan = await simulerBroadcast(prisma, c.envoi_id)
      } else {
        const envoyeur = envoyeurPour(cfg)
        if ('erreur' in envoyeur) return repondre({ error: envoyeur.erreur }, 503)
        bilan = await executerEnvoi(prisma, c.envoi_id, cfg, envoyeur)
      }
      if (ligne.mode === 'reel' && bilan.envoyes > 0 && estGroupeEnvoi(ligne.groupe)) {
        await inscrireAnnonce(prisma, c.envoi_id, ligne.groupe, Number(ligne.destinataires))
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
    console.error(`[cockpit/academie/emails] ${String(action)} : echec (${m.replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/re_[A-Za-z0-9_]+/g, 're_[cle]').slice(0, 300)})`)
    return repondre({ error: 'La base ou l\'envoi a refusé : rien n\'est perdu, relis l\'historique avant de réessayer.' }, 503)
  }
}
