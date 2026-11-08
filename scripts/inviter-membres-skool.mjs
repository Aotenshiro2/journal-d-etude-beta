// Invitations des membres de Skool vers l'academie (passation, 08/11/2026, options A2, A4 et A7 choisies par
// Brice) : l'email aux adresses connues, la relance a J+3, le compteur.
//
//   node --env-file=.env.local scripts/inviter-membres-skool.mjs <destinataires.csv> --modeles <dossier> [options]
//   node --env-file=.env.local scripts/inviter-membres-skool.mjs <destinataires.csv> --compteur
//
// (apres nvm : Node 22 retire les types des .ts tout seul.)
//
// Sans --ecrire : ESSAI A BLANC. Lectures seulement (comptes, table academie_invitations si elle existe),
// aucun email, aucune ecriture ; le bilan dit ce qui partirait.
//
// Options :
//   --ecrire            agit : ecrit les lignes, cree les jetons, envoie par Resend (refuse un modele BROUILLON).
//   --relance           la relance : lignes envoyees il y a 3 jours ou plus, sans relance, toujours sans compte.
//                       Un payant garde son lien, sauf s'il expire dans moins de 5 jours (nouveau lien de 14 jours).
//   --max N             emails au plus pour ce passage (90 par defaut : le plan gratuit de Resend s'arrete a 100 par
//                       jour). Les payants partent d'abord, puis les gratuits, chacun dans l'ordre du CSV. Le
//                       reste part au passage suivant (idempotent).
//   --lot L             le lot (skool-2026-11 par defaut) : une invitation par email et par lot.
//   --compteur          lecture seule, par version du CSV : adresses, comptes, emails recus, relances, liens ouverts.
//   --test-vers ADRESSE un email par modele du mode (3 a l'envoi, 2 a la relance), a ADRESSE seulement (adresses
//                       de test de Resend : delivered@resend.dev...), sujet « [Essai] », lien payant factice (il
//                       mene a la connexion, repere « invalide ») ; n'ecrit RIEN en base, aucun membre ne recoit rien.
//
// Entree : un CSV « email;version;prenom » (version payant ou gratuit), qui reste sur D:. Un payant qui a deja
// un compte utilisable (email de connexion confirme, ou adresse verifiee de profile_emails) passe en
// « payant-compte » : pas de jeton, lien vers la connexion. Un payant sans compte recoit le lien personnel
// (GET /api/academie/invitation?j=, 14 jours) qui cree le compte et connecte en un clic. Un gratuit recoit le
// lien de la connexion.
//
// Modeles (--modeles <dossier>) : <nom>.sujet.txt et <nom>.corps.txt, avec {{prenom}} et {{lien}} ;
// nom = payant, payant-compte, gratuit, puis relance-payant et relance-gratuit pour la relance. Le corps est
// du texte : le HTML en est tire (paragraphes, liens). Un modele qui contient « BROUILLON » ne part a aucun
// membre (--test-vers l'accepte).
//
// Envoi : Resend (RESEND_API_KEY_LIVECLUB, sinon RESEND_API_KEY), depuis « AO Knowledge <support@aoknowledge.com> »
// (INVITATIONS_FROM_EMAIL pour changer), reponse a support@. Cle d'idempotence par ligne et par etape : un
// passage relance apres une panne ne double pas un email deja accepte par Resend (24 h).
// Jeton : derive de SUPABASE_SERVICE_ROLE_KEY, de l'id de la ligne et de son numero ; la base ne garde que son
// sha256.
//
// Sortie : des chiffres seulement. Jamais une adresse : une ligne en erreur est donnee par son numero dans le CSV.

import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  EXPEDITEUR, LOT_DEFAUT, MAX_DEFAUT, POSE_PAR, RELANCE_SEUIL_JOURS, RESERVATION_MINUTES, SUPPORT,
  compter, decisionJeton, deriverJeton, emailDepuisModele, estAdresseTestResend, estBrouillon, expirationNouveauJeton,
  hacherJeton, jetonAleatoire, lienPourVersion, lireCsvInvitations, masquerEmails, nomModele, planifier, verifierModele,
} from '../src/lib/academie/invitations-pur.ts'

const PAUSE_MS = 600 // Resend : 2 requetes par seconde par defaut.

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** Les options de la ligne de commande, ou { erreur }. */
export function lireArguments(argv) {
  const o = { csv: null, modeles: null, ecrire: false, relance: false, compteur: false, max: MAX_DEFAUT, lot: LOT_DEFAUT, testVers: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const valeur = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} attend une valeur`)
      return v
    }
    try {
      if (a === '--ecrire') o.ecrire = true
      else if (a === '--relance') o.relance = true
      else if (a === '--compteur') o.compteur = true
      else if (a === '--modeles') o.modeles = valeur()
      else if (a === '--lot') o.lot = valeur()
      else if (a === '--test-vers') o.testVers = valeur()
      else if (a === '--max') {
        const n = Number(valeur())
        if (!Number.isInteger(n) || n < 1 || n > 1000) return { erreur: '--max attend un entier de 1 a 1000' }
        o.max = n
      } else if (a.startsWith('--')) return { erreur: `option inconnue : ${a}` }
      else if (!o.csv) o.csv = a
      else return { erreur: 'un seul fichier CSV' }
    } catch (e) {
      return { erreur: e.message }
    }
  }
  if (!o.csv) return { erreur: 'fichier CSV manquant' }
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(o.lot)) return { erreur: '--lot : minuscules, chiffres et tirets' }
  if (o.compteur && (o.ecrire || o.relance || o.testVers)) return { erreur: '--compteur se lance seul (lecture seule)' }
  if (o.testVers && o.ecrire) return { erreur: '--test-vers n ecrit rien en base : sans --ecrire' }
  if (o.testVers && !estAdresseTestResend(o.testVers)) return { erreur: '--test-vers : seulement une adresse de test de Resend (delivered@resend.dev)' }
  if (!o.compteur && !o.modeles) return { erreur: '--modeles <dossier> manquant' }
  return o
}

// ---------------------------------------------------------------------------
// Modeles
// ---------------------------------------------------------------------------

/** Lit les modeles des noms donnes. Rend { modeles: Map, defauts: string[] }. */
export function lireModeles(dossier, noms) {
  const modeles = new Map()
  const defauts = []
  for (const nom of noms) {
    const fs = ['sujet', 'corps'].map(p => join(dossier, `${nom}.${p}.txt`))
    const manquants = fs.filter(f => !existsSync(f))
    if (manquants.length) { defauts.push(`${nom} : fichier manquant (${manquants.map(f => f.split(/[\\/]/).pop()).join(', ')})`); continue }
    const m = { sujet: readFileSync(fs[0], 'utf8').replace(/^﻿/, ''), corps: readFileSync(fs[1], 'utf8').replace(/^﻿/, '') }
    for (const d of verifierModele(m)) defauts.push(`${nom} : ${d}`)
    modeles.set(nom, m)
  }
  return { modeles, defauts }
}

// ---------------------------------------------------------------------------
// Le deroule d'un passage avec --ecrire (ports injectes : vraie base et vrai Resend, ou faux pour la verification)
// ---------------------------------------------------------------------------

/**
 * Envoie les emails des actions, une par une. ports :
 *   preparer(action)                 -> la ligne (envoi : inseree ou mise a jour ; relance : la ligne lue) ou null
 *   reserver(ligne, jeton)           -> true si la ligne est prise (jeton = { hash, numero, expireLe } ou null)
 *   envoyer(email, cleIdempotence)   -> { ok: true, id } | { ok: false, erreur, arret }
 *   reussi(ligne, id) / echoue(ligne, erreur)
 *   pause()
 * Rend un bilan chiffre.
 */
export async function derouler({ actions, mode, modeles, secret, maintenant, ports }) {
  const r = { envoyes: 0, par_version: {}, echecs: {}, sautes: {}, jetons_neufs: 0, jetons_repris: 0, arret: null }
  const sauter = m => { r.sautes[m] = (r.sautes[m] ?? 0) + 1 }
  let premier = true
  for (const a of actions) {
    const ligne = await ports.preparer(a)
    if (!ligne) { sauter(mode === 'envoi' ? 'deja_envoye' : 'disparue'); continue }

    let jeton = null
    let lienJeton = null
    if (a.version === 'payant') {
      let decision = decisionJeton(ligne, maintenant, RELANCE_SEUIL_JOURS)
      if (decision === 'reprendre') {
        lienJeton = deriverJeton(secret, ligne.id, ligne.jetonNumero)
        // Secret change depuis le premier envoi : le lien d'origine n'est plus recalculable, on en fait un neuf.
        if (hacherJeton(lienJeton) !== ligne.jetonHash) decision = 'nouveau'
        else jeton = { hash: ligne.jetonHash, numero: ligne.jetonNumero, expireLe: ligne.expireLe }
      }
      if (decision === 'nouveau') {
        const numero = ligne.jetonNumero + 1
        lienJeton = deriverJeton(secret, ligne.id, numero)
        jeton = { hash: hacherJeton(lienJeton), numero, expireLe: expirationNouveauJeton(maintenant) }
        r.jetons_neufs++
      } else r.jetons_repris++
    }

    if (!(await ports.reserver(ligne, jeton))) { sauter('reservee'); continue }

    const modele = modeles.get(nomModele(mode, a.version))
    const lien = lienPourVersion(a.version, lienJeton)
    const email = emailDepuisModele(modele, { prenom: a.prenom, lien })
    if (!premier) await ports.pause()
    premier = false
    const res = await ports.envoyer({ to: a.email, version: a.version, ...email }, `aok-invitation/${ligne.id}/${mode}`)
    if (res.ok) {
      await ports.reussi(ligne, res.id)
      r.envoyes++
      r.par_version[a.version] = (r.par_version[a.version] ?? 0) + 1
    } else {
      await ports.echoue(ligne, res.erreur)
      r.echecs[res.erreur] = (r.echecs[res.erreur] ?? 0) + 1
      if (res.arret) { r.arret = `${res.erreur} (ligne ${a.numero} du CSV) : le reste attend le prochain passage`; break }
    }
  }
  return r
}

// ---------------------------------------------------------------------------
// Base et Resend
// ---------------------------------------------------------------------------

export const COLONNES = `id::text as id, email, version, prenom, jeton_hash, jeton_numero, expire_le, envoye_le, relance_le,
  reserve_le, ouvert_le, compte_le, compte_cree, erreur`

const enLigne = l => ({
  id: l.id, email: l.email, version: l.version, prenom: l.prenom, jetonHash: l.jeton_hash, jetonNumero: l.jeton_numero,
  expireLe: l.expire_le, envoyeLe: l.envoye_le, relanceLe: l.relance_le, reserveLe: l.reserve_le, ouvertLe: l.ouvert_le,
  compteLe: l.compte_le, compteCree: l.compte_cree, erreur: l.erreur,
})

// Compte utilisable : email de connexion confirme, ou adresse verifiee de profile_emails (droits.ts). Sinon un
// compte jamais confirme (le lien d'invitation le confirme), sinon aucun.
export const SQL_COMPTES = `
select x.e as email,
  (exists (select 1 from auth.users u where lower(btrim(u.email)) = x.e and u.email_confirmed_at is not null)
    or exists (select 1 from public.profile_emails pe where lower(btrim(pe.email)) = x.e and pe.verified)) as utilisable,
  exists (select 1 from auth.users u where lower(btrim(u.email)) = x.e) as existe
from unnest($1::text[]) as x(e)`

async function lireComptes(prisma, emails) {
  const lignes = await prisma.$queryRawUnsafe(SQL_COMPTES, emails)
  return new Map(lignes.map(l => [l.email, l.utilisable ? 'utilisable' : l.existe ? 'non_confirme' : 'aucun']))
}

async function tablePresente(prisma) {
  const [{ la }] = await prisma.$queryRawUnsafe(`select to_regclass('public.academie_invitations') is not null as la`)
  return la
}

async function lireTable(prisma, lot, emails) {
  const lignes = await prisma.$queryRawUnsafe(
    `select ${COLONNES} from public.academie_invitations where lot = $1 and email = any($2::text[])`, lot, emails)
  return new Map(lignes.map(l => [l.email, enLigne(l)]))
}

export const SQL_PREPARER = `
insert into public.academie_invitations (lot, email, version, prenom, pose_par)
values ($1, $2, $3, $4, $5)
on conflict (lot, email) do update
   set version = excluded.version,
       prenom = coalesce(excluded.prenom, academie_invitations.prenom),
       jeton_hash = case when excluded.version = 'payant' then academie_invitations.jeton_hash end,
       expire_le = case when excluded.version = 'payant' then academie_invitations.expire_le end
 where academie_invitations.envoye_le is null
returning ${COLONNES}`

export const SQL_RESERVER = {
  envoi: `
update public.academie_invitations
   set reserve_le = now(), jeton_hash = $2, jeton_numero = $3, expire_le = $4::timestamptz
 where id = $1::uuid and envoye_le is null
   and (reserve_le is null or reserve_le < now() - make_interval(mins => $5::int))
returning id::text as id`,
  relance: `
update public.academie_invitations
   set reserve_le = now(), jeton_hash = $2, jeton_numero = $3, expire_le = $4::timestamptz
 where id = $1::uuid and envoye_le is not null and relance_le is null
   and (reserve_le is null or reserve_le < now() - make_interval(mins => $5::int))
returning id::text as id`,
}

export const SQL_REUSSI = {
  envoi: `update public.academie_invitations set envoye_le = now(), resend_id = $2, erreur = null, reserve_le = null where id = $1::uuid`,
  relance: `update public.academie_invitations set relance_le = now(), relance_resend_id = $2, erreur = null, reserve_le = null where id = $1::uuid`,
}

export const SQL_ECHEC = `update public.academie_invitations set erreur = $2, reserve_le = null where id = $1::uuid`

/** Les codes de Resend qui arretent le passage (cadence, quota du jour ou du mois). */
const ARRETS = new Set(['rate_limit_exceeded', 'daily_quota_exceeded', 'monthly_quota_exceeded'])

function envoyeurResend(cle, { essai = false } = {}) {
  let Resend = null
  const from = process.env.INVITATIONS_FROM_EMAIL?.trim() || EXPEDITEUR
  return async (e, cleIdempotence) => {
    try {
      Resend ??= (await import('resend')).Resend
      const { data, error, headers } = await new Resend(cle).emails.send({
        from,
        to: e.to,
        replyTo: SUPPORT,
        subject: e.sujet,
        html: e.html,
        text: e.texte,
        tags: [{ name: 'campagne', value: essai ? 'passation-skool-essai' : 'passation-skool' }, { name: 'version', value: e.version }],
      }, { idempotencyKey: cleIdempotence })
      const quota = Object.fromEntries(Object.entries(headers ?? {}).filter(([k]) => /quota|ratelimit/i.test(k)))
      if (error) {
        const nom = String(error.name ?? 'erreur').slice(0, 60)
        return { ok: false, erreur: `Resend : ${nom}`, arret: ARRETS.has(nom) || error.statusCode === 429, quota }
      }
      return { ok: true, id: data?.id ?? null, quota }
    } catch (err) {
      return { ok: false, erreur: `Resend : ${err instanceof Error ? err.name : 'erreur'}`, arret: true, quota: {} }
    }
  }
}

const pause = () => new Promise(r => setTimeout(r, PAUSE_MS))

// ---------------------------------------------------------------------------
// Ligne de commande
// ---------------------------------------------------------------------------

async function principal(argv) {
  const o = lireArguments(argv)
  if (o.erreur) {
    console.error(`Erreur : ${o.erreur}`)
    console.error('Usage : node --env-file=.env.local scripts/inviter-membres-skool.mjs <destinataires.csv> --modeles <dossier> [--ecrire] [--relance] [--max N] [--lot L] [--test-vers delivered@resend.dev]')
    console.error('        node --env-file=.env.local scripts/inviter-membres-skool.mjs <destinataires.csv> --compteur')
    return 2
  }

  const { lignes, erreurs, doublons } = lireCsvInvitations(readFileSync(resolve(o.csv), 'utf8'))
  if (erreurs.length) {
    console.error(`${erreurs.length} ligne(s) illisible(s), rien n'est fait :`)
    for (const e of erreurs.slice(0, 50)) console.error(`  ligne ${e.numero} : ${e.motif}`)
    return 1
  }
  if (!lignes.length) { console.error('Aucune ligne a traiter.'); return 1 }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const emails = lignes.map(l => l.email)
    const comptes = await lireComptes(prisma, emails)
    const presente = await tablePresente(prisma)
    const table = presente ? await lireTable(prisma, o.lot, emails) : null
    const maintenant = new Date()

    if (o.compteur) {
      console.log('COMPTEUR (lecture seule) :', JSON.stringify({
        lot: o.lot, table: presente ? 'presente' : 'absente (migration 20261108200000 pas appliquee : recus et ouverts non mesures)',
        doublons_fichier: doublons, ...compter(lignes, comptes, table),
      }))
      return 0
    }

    const mode = o.relance ? 'relance' : 'envoi'
    const { actions, bilan } = planifier({ mode, lignes, comptes, table: table ?? new Map(), max: o.max, maintenant })
    // L'essai vers Resend passe chaque modele du mode ; sinon, ceux des versions qui partiraient.
    const versionsEssai = mode === 'relance' ? ['payant', 'gratuit'] : ['payant', 'payant-compte', 'gratuit']
    const noms = o.testVers
      ? versionsEssai.map(v => nomModele(mode, v))
      : [...new Set(Object.entries(bilan.a_envoyer).filter(([, n]) => n > 0).map(([v]) => nomModele(mode, v)))]
    const { modeles, defauts } = lireModeles(resolve(o.modeles), noms)
    if (defauts.length) {
      console.error('Modele(s) a corriger, rien n est envoye :')
      for (const d of defauts) console.error(`  ${d}`)
      return 1
    }
    const brouillons = noms.filter(n => estBrouillon(modeles.get(n)))
    const apercu = Object.fromEntries(noms.map(n => [n, emailDepuisModele(modeles.get(n), { prenom: 'Prenom', lien: 'https://exemple.invalid/lien' }).sujet]))
    const entete = {
      lot: o.lot, table: presente ? 'presente' : 'absente', doublons_fichier: doublons, ...bilan,
      modeles_brouillon: brouillons, apercu_sujets: apercu,
    }

    // --- Envoi d'essai vers une adresse de test de Resend : rien en base.
    if (o.testVers) {
      const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
      if (!cle) { console.error('RESEND_API_KEY_LIVECLUB ou RESEND_API_KEY manquante : aucun envoi.'); return 1 }
      const envoyer = envoyeurResend(cle, { essai: true })
      const resultats = []
      let premier = true
      for (const version of versionsEssai) {
        // Le prenom de la premiere ligne du CSV de cette version (CSV fictif pour un essai), le lien payant est
        // un jeton qu'aucune ligne ne porte : il mene a la connexion avec le repere « invalide ».
        const prenom = lignes.find(l => l.version === (version === 'gratuit' ? 'gratuit' : 'payant'))?.prenom ?? lignes[0].prenom
        const lien = lienPourVersion(version, version === 'payant' ? jetonAleatoire() : null)
        const e = emailDepuisModele(modeles.get(nomModele(mode, version)), { prenom, lien }, true)
        if (!premier) await pause()
        premier = false
        const res = await envoyer({ to: o.testVers.trim().toLowerCase(), version, ...e }, `aok-invitation/essai/${mode}/${version}/${Date.now()}`)
        resultats.push({ version, ok: res.ok, resend_id: res.ok ? res.id : null, erreur: res.ok ? null : res.erreur, entetes_quota: res.quota })
        if (!res.ok && res.arret) break
      }
      console.log('ENVOI D ESSAI (adresse de test de Resend, rien en base) :', JSON.stringify({ ...entete, essais: resultats }))
      return resultats.every(r => r.ok) ? 0 : 1
    }

    if (!o.ecrire) {
      console.log('ESSAI A BLANC (rien ecrit, rien envoye) :', JSON.stringify(entete))
      return 0
    }

    // --- Pour de vrai.
    if (!presente) { console.error('Table academie_invitations absente : appliquer d abord la migration 20261108200000.'); return 1 }
    if (brouillons.length) { console.error(`Modele(s) BROUILLON (${brouillons.join(', ')}) : aucun email ne part a un membre.`); return 1 }
    const cle = process.env.RESEND_API_KEY_LIVECLUB?.trim() || process.env.RESEND_API_KEY?.trim()
    if (!cle) { console.error('RESEND_API_KEY_LIVECLUB ou RESEND_API_KEY manquante : aucun envoi.'); return 1 }
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? ''
    if (actions.some(a => a.version === 'payant') && secret.length < 32) { console.error('SUPABASE_SERVICE_ROLE_KEY manquante : pas de jeton possible.'); return 1 }

    const envoyer = envoyeurResend(cle)
    const resultat = await derouler({
      actions, mode, modeles, secret, maintenant,
      ports: {
        async preparer(a) {
          if (mode === 'relance') return a.ligne
          const [l] = await prisma.$queryRawUnsafe(SQL_PREPARER, o.lot, a.email, a.version, a.prenom, POSE_PAR)
          return l ? enLigne(l) : null
        },
        async reserver(ligne, jeton) {
          const pris = await prisma.$queryRawUnsafe(SQL_RESERVER[mode], ligne.id, jeton?.hash ?? null,
            jeton?.numero ?? ligne.jetonNumero, jeton ? jeton.expireLe.toISOString() : null, RESERVATION_MINUTES)
          return pris.length === 1
        },
        envoyer: (e, cleIdempotence) => envoyer(e, cleIdempotence),
        async reussi(ligne, id) { await prisma.$executeRawUnsafe(SQL_REUSSI[mode], ligne.id, id) },
        async echoue(ligne, erreur) { await prisma.$executeRawUnsafe(SQL_ECHEC, ligne.id, masquerEmails(erreur)) },
        pause,
      },
    })
    console.log('ECRIT ET ENVOYE :', JSON.stringify({ ...entete, resultat }))
    return Object.keys(resultat.echecs).length ? 1 : 0
  } catch (e) {
    console.error('ECHEC :', masquerEmails(e?.message ?? e))
    return 1
  } finally {
    await prisma.$disconnect()
  }
}

const estLanceDirectement = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (estLanceDirectement) process.exitCode = await principal(process.argv.slice(2))
