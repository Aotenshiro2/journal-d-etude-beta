/**
 * SIMULATION de la synchronisation des contacts Resend et du premier Broadcast (13/11/2026,
 * email a tous les membres ; src/lib/academie/emails-broadcast.ts).
 *
 * LECTURES SEULEMENT, par construction :
 * - la base : une transaction « read only » (Postgres refuse toute ecriture), annulee a la fin ;
 *   nos adresses (groupe « tous », la requete EXACTE du code), nos desinscrits, nos Broadcasts passes.
 *   Si la migration 20261113210000 n'est pas encore appliquee, les desinscrits comptent pour zero ;
 * - Resend : ce script n'importe QUE lecteurDepuisSdk (listes : domaines, segments, sujets, contacts,
 *   imports, destinataires de Broadcasts). Il n'importe ni ecrivainDepuisSdk ni appliquerPlan :
 *   il ne peut rien creer chez Resend.
 * Sortie : des NOMBRES (le plan resume, la cle, le domaine, le Broadcast qui partirait). Jamais une
 * adresse, jamais la cle.
 *
 * Lancement (depuis apps/journal-d-etude, apres nvm) :
 *   node --env-file=.env.local scripts/simuler-synchro-resend.mjs [--groupe tous|comptes]
 * Variables lues : DATABASE_URL (ou DIRECT_URL), RESEND_API_KEY_ANNONCES ou RESEND_API_KEY.
 */

import { Resend } from 'resend'
import * as E from '../src/lib/academie/emails-annonces.ts'
import * as B from '../src/lib/academie/emails-broadcast.ts'

const i = process.argv.indexOf('--groupe')
const groupe = i >= 0 ? process.argv[i + 1] : 'tous'
if (!E.estGroupeEnvoi(groupe)) throw new Error('--groupe tous ou comptes')

const destinatairesSansTable = E.SQL_DESTINATAIRES.replace(
  /exists \(select 1 from public\.academie_emails_desinscriptions[\s\S]*?\) as desinscrit/, 'false as desinscrit')
if (destinatairesSansTable === E.SQL_DESTINATAIRES) throw new Error('requete des destinataires : variante sans table introuvable')

async function lireBase() {
  const { PrismaClient } = await import('@prisma/client')
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL absente (node --env-file=.env.local ...)')
  const prisma = new PrismaClient({ datasources: { db: { url } } })
  const FIN = new Error('fin de la lecture (transaction annulee)')
  let sortie = null
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('set transaction read only')
      const tables = await tx.$queryRawUnsafe(`select to_regclass('public.academie_emails_desinscriptions') is not null as la`)
      const migration = tables[0]?.la === true
      const tous = await tx.$queryRawUnsafe(migration ? E.SQL_DESTINATAIRES : destinatairesSansTable, 'tous')
      const base = migration ? await tx.$queryRawUnsafe(B.SQL_DESINSCRITS_BASE) : []
      const passes = migration ? await tx.$queryRawUnsafe(B.SQL_BROADCASTS_PASSES) : []
      sortie = { migration, tous, base, passes: passes.map((p) => p.id) }
      throw FIN
    }, { timeout: 30_000, maxWait: 10_000 })
  } catch (err) {
    if (err !== FIN) throw err
  } finally {
    await prisma.$disconnect()
  }
  return sortie
}

const base = await lireBase()
const cible = base.tous.map((d) => ({ email: d.email, compte: d.user_id !== null }))
const compte = E.compterGroupes(base.tous.map((d) => ({ ...d, desinscrit: d.desinscrit === true })))

const cle = process.env.RESEND_API_KEY_ANNONCES?.trim() || process.env.RESEND_API_KEY?.trim() || ''
const lecteur = cle ? B.lecteurDepuisSdk(new Resend(cle)) : null
const verif = await B.verifierCle(lecteur)
let etat = { segments: [], sujet: null, contacts: [], membres: { tous: [], comptes: [] }, importsEnCours: 0, desinscritsBroadcasts: [] }
let lu = false
if (lecteur && verif.acces === 'complet') { etat = await B.lireEtatResend(lecteur, base.passes); lu = true }
const plan = B.planifierSynchro(cible, base.base, etat)

const segmentsChezResend = etat.segments.map((s) => s.name)
const email = E.construireEmail({ objet: 'Objet de démonstration', texte: 'Texte de démonstration.', lien: null, lienDesinscription: B.VARIABLE_DESINSCRIPTION, essai: false })

console.log(JSON.stringify({
  simulation: true,
  base: { migration_appliquee: base.migration, tous: compte.tous, comptes: compte.comptes, desinscrits: base.base.length, broadcasts_passes: base.passes.length },
  cle: { acces: verif.acces, domaine: verif.domaine, domaine_verifie: verif.domaine_verifie, message: verif.message },
  resend_lu: lu,
  resend_avant: { contacts: etat.contacts.length, contacts_desinscrits: etat.contacts.filter((c) => c.unsubscribed).length, segments: segmentsChezResend, sujet: etat.sujet?.name ?? null, imports_en_cours: etat.importsEnCours },
  plan: B.resumePlan(plan),
  lots_import: plan.creer.length > B.SEUIL_IMPORT ? B.lotsImport(plan.creer).map((l) => ({ segments: l.segments, sujet: l.sujet, n: l.n })) : [],
  broadcast_qui_partirait: {
    segment: B.SEGMENTS_RESEND[groupe], sujet: B.SUJET_RESEND.nom, destinataires: compte[groupe].a_envoyer,
    lien_desinscription_resend_dans_html: email.html.includes(B.VARIABLE_DESINSCRIPTION),
    lien_desinscription_resend_dans_texte: email.texte.includes(B.VARIABLE_DESINSCRIPTION),
  },
}, null, 2).replace(/[^\s@"]+@[^\s@"]+/g, '[email]'))
