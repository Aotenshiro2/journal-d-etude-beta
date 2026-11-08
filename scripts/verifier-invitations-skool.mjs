// Verifie les invitations des membres de Skool (passation, 08/11/2026), HORS LIGNE : jetons, CSV, choix de
// version, plan d'envoi et de relance, compteur, modeles, deroule d'un passage (fausse base, faux Resend) et
// ouverture du lien (fausse base, faux Supabase). Aucun appel reseau, aucune base, aucun email.
// Relit aussi la route, le middleware, le masque de Sentry, les modeles BROUILLON et, si on lui donne son
// dossier, la migration du depot workspace.
//
//   node scripts/verifier-invitations-skool.mjs
//   MIGRATIONS_DIR=<...>/sites/Aoknowledgecom/supabase/migrations node scripts/verifier-invitations-skool.mjs
//
// Node 22 retire les types tout seul : les .ts sont importes tels quels.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CHEMIN_PAGE_INVITATION, MAX_DEFAUT, RELANCE_APRES_JOURS, RELANCE_SEUIL_JOURS, URL_CONNEXION, URL_ROUTE_DEFAUT, VALIDITE_JOURS,
  baseRoute, compter, decisionJeton, deriverJeton, emailDepuisModele, estAdresseTestResend, estBrouillon, etatRelance,
  hacherJeton, htmlDepuisTexte, jetonAleatoire, lienInvitation, lienPourVersion, lireCsvInvitations, lireJeton,
  masquerEmails, nettoyerPrenom, nomModele, ouvrirInvitation, planifier, remplir, urlConnexionRepere, urlPageInvitation,
  verifierModele, versionPour,
} from '../src/lib/academie/invitations-pur.ts'
import { derouler, lireArguments, lireModeles } from './inviter-membres-skool.mjs'
import { masquerSecretMcp } from '../src/lib/sentry-masque.ts'

let n = 0
const blocs = []
const bloc = (nom, f) => blocs.push([nom, f])
const lire = chemin => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

// Tirets longs, demi-cadratins, points de suspension, guillemets courbes anglais, espace insecable, espace
// de largeur nulle : ecrits par leur numero (aucun dans ce fichier).
const INTERDITS = new RegExp(`[${[0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0xa0, 0x200b].map(x => String.fromCharCode(x)).join('')}]`)
const SECRET = 'secret-de-test-assez-long-pour-le-serveur-0123456789'
const JOUR = 24 * 60 * 60 * 1000
const T0 = new Date('2026-11-09T10:00:00Z')
const plusJours = (d, j) => new Date(d.getTime() + j * JOUR)
const ID = '0b6f5c1e-1a2b-4c3d-8e9f-001122334455'

// ---------------------------------------------------------------------------
// Jetons et liens
// ---------------------------------------------------------------------------

bloc('jeton : derive, stable, 43 caracteres, change avec la ligne, le numero et le secret', () => {
  const j1 = deriverJeton(SECRET, ID, 1)
  assert.equal(j1.length, 43)
  assert.equal(lireJeton(j1), j1)
  assert.equal(deriverJeton(SECRET, ID, 1), j1, 'meme ligne, meme numero : meme jeton (relance)')
  assert.notEqual(deriverJeton(SECRET, ID, 2), j1)
  assert.notEqual(deriverJeton(SECRET, '0b6f5c1e-1a2b-4c3d-8e9f-001122334456', 1), j1)
  assert.notEqual(deriverJeton(`${SECRET}x`, ID, 1), j1)
  assert.throws(() => deriverJeton('court', ID, 1))
  assert.throws(() => deriverJeton(SECRET, ID, 0))
  const h = hacherJeton(j1)
  assert.match(h, /^[0-9a-f]{64}$/)
  assert.ok(!h.includes(j1))
  assert.equal(lireJeton(jetonAleatoire()).length, 43)
  for (const faux of [null, undefined, 42, '', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, `${'a'.repeat(42)} `]) assert.equal(lireJeton(faux), null)
})

bloc('liens : route du journal pour un payant, connexion sinon ; base de la route bornee', () => {
  const j = deriverJeton(SECRET, ID, 1)
  assert.equal(lienInvitation(j), `${URL_ROUTE_DEFAUT}?j=${j}`)
  assert.equal(URL_ROUTE_DEFAUT, 'https://journal.aoknowledge.com/api/academie/invitation')
  assert.equal(lienPourVersion('payant', j), `${URL_ROUTE_DEFAUT}?j=${j}`)
  assert.equal(lienPourVersion('payant-compte', null), URL_CONNEXION)
  assert.equal(lienPourVersion('gratuit', null), URL_CONNEXION)
  assert.throws(() => lienPourVersion('payant', null))
  assert.equal(baseRoute('http://localhost:3000/api/academie/invitation'), 'http://localhost:3000/api/academie/invitation')
  assert.equal(baseRoute('https://evil.example/api/academie/invitation'), URL_ROUTE_DEFAUT)
  assert.equal(baseRoute('https://aoknowledge.com.evil.example/api/academie/invitation'), URL_ROUTE_DEFAUT)
  assert.equal(urlConnexionRepere('expiree'), 'https://aoknowledge.com/connexion?invitation=expiree')
  const page = new URL(urlPageInvitation('abc123def456ghi789', 'magiclink'))
  assert.equal(page.pathname, CHEMIN_PAGE_INVITATION)
  assert.equal(page.search, '', 'rien dans la requete : le jeton Supabase est dans le fragment')
  const f = new URLSearchParams(page.hash.slice(1))
  assert.equal(f.get('token_hash'), 'abc123def456ghi789')
  assert.equal(f.get('type'), 'magiclink')
})

// ---------------------------------------------------------------------------
// CSV, comptes, versions
// ---------------------------------------------------------------------------

bloc('CSV : en-tete, BOM, CRLF, commentaires, erreurs par numero, doublons (payant l emporte), prenom nettoye', () => {
  const texte = '﻿email;version;prenom\r\n'
    + 'Anne.Exemple@Example.com ; payant ; Anne\r\n'
    + '\r\n# commentaire\r\n'
    + 'bob@example.com;gratuit;Bob {{lien}} <b>\r\n'
    + 'pas-un-email;payant;X\r\n'
    + 'carl@example.com;vip;Carl\r\n'
    + 'bob@example.com;payant;\r\n'
    + 'dora@example.com;GRATUIT;\r\n'
    + 'anne.exemple@example.com;gratuit;Annie\r\n'
  const { lignes, erreurs, doublons } = lireCsvInvitations(texte)
  assert.deepEqual(erreurs, [{ numero: 6, motif: 'email illisible' }, { numero: 7, motif: 'version inconnue (vip)' }])
  assert.equal(doublons, 2)
  assert.deepEqual(lignes.map(l => [l.numero, l.email, l.version, l.prenom]), [
    [2, 'anne.exemple@example.com', 'payant', 'Anne'],
    [5, 'bob@example.com', 'payant', 'Bob lien b'],
    [9, 'dora@example.com', 'gratuit', null],
  ])
  assert.ok(!JSON.stringify(erreurs).includes('@'), 'jamais une adresse dans une erreur')
  assert.equal(nettoyerPrenom('  Jean\tPierre\u0000 '), 'Jean Pierre')
  assert.equal(nettoyerPrenom('x'.repeat(100)).length, 60)
  assert.equal(nettoyerPrenom('   '), null)
})

bloc('version : payant + compte utilisable = payant-compte (pas de jeton) ; non confirme garde le lien', () => {
  assert.equal(versionPour('payant', 'aucun'), 'payant')
  assert.equal(versionPour('payant', 'non_confirme'), 'payant', 'le clic confirme le compte')
  assert.equal(versionPour('payant', 'utilisable'), 'payant-compte')
  assert.equal(versionPour('gratuit', 'aucun'), 'gratuit')
  assert.equal(versionPour('gratuit', 'utilisable'), 'gratuit')
})

// ---------------------------------------------------------------------------
// Jeton a l'envoi, relance, plan
// ---------------------------------------------------------------------------

const ligneTable = (o = {}) => ({
  id: ID, email: 'anne@example.com', version: 'payant', prenom: 'Anne', jetonHash: null, jetonNumero: 0, expireLe: null,
  envoyeLe: null, relanceLe: null, reserveLe: null, ouvertLe: null, compteLe: null, compteCree: false, erreur: null, ...o,
})

bloc('decisionJeton : neuf sans jeton, repris s il reste assez de jours, neuf sous le seuil', () => {
  assert.equal(decisionJeton(null, T0), 'nouveau')
  assert.equal(decisionJeton(ligneTable(), T0), 'nouveau')
  const avec = (jours) => ligneTable({ jetonHash: 'a'.repeat(64), jetonNumero: 1, expireLe: plusJours(T0, jours) })
  assert.equal(decisionJeton(avec(11), T0, RELANCE_SEUIL_JOURS), 'reprendre')
  assert.equal(decisionJeton(avec(RELANCE_SEUIL_JOURS), T0, RELANCE_SEUIL_JOURS), 'nouveau')
  assert.equal(decisionJeton(avec(2), T0, RELANCE_SEUIL_JOURS), 'nouveau')
  assert.equal(decisionJeton(avec(-1), T0), 'nouveau', 'expire')
  assert.equal(VALIDITE_JOURS, 14)
  assert.equal(RELANCE_APRES_JOURS, 3)
  assert.equal(MAX_DEFAUT, 90)
})

bloc('relance : envoye depuis 3 jours, pas de relance, toujours sans compte, pas reservee', () => {
  const envoye = (j, o = {}) => ligneTable({ envoyeLe: plusJours(T0, -j), ...o })
  assert.equal(etatRelance(null, 'aucun', T0), 'non_envoye')
  assert.equal(etatRelance(ligneTable(), 'aucun', T0), 'non_envoye')
  assert.equal(etatRelance(envoye(2.9), 'aucun', T0), 'trop_tot')
  assert.equal(etatRelance(envoye(3), 'aucun', T0), 'due')
  assert.equal(etatRelance(envoye(3), 'non_confirme', T0), 'due', 'un compte jamais confirme ne compte pas')
  assert.equal(etatRelance(envoye(5), 'utilisable', T0), 'compte')
  assert.equal(etatRelance(envoye(5, { version: 'payant-compte' }), 'aucun', T0), 'compte')
  assert.equal(etatRelance(envoye(5, { relanceLe: plusJours(T0, -1) }), 'aucun', T0), 'deja_relance')
  assert.equal(etatRelance(envoye(5, { reserveLe: plusJours(T0, -0.01) }), 'aucun', T0), 'reservee')
  assert.equal(etatRelance(envoye(5, { reserveLe: plusJours(T0, -1) }), 'aucun', T0), 'due', 'reservation perimee')
})

bloc('plan d envoi : payants d abord puis ordre du CSV, deja envoyes et reserves ecartes, plafond, jetons comptes', () => {
  const { lignes } = lireCsvInvitations([
    'email;version;prenom', 'a@example.com;payant;A', 'b@example.com;payant;B', 'c@example.com;gratuit;C',
    'd@example.com;payant;D', 'e@example.com;gratuit;E', 'f@example.com;payant;F',
  ].join('\n'))
  const comptes = new Map([['b@example.com', 'utilisable'], ['d@example.com', 'non_confirme']])
  const table = new Map([
    ['e@example.com', ligneTable({ email: 'e@example.com', version: 'gratuit', envoyeLe: plusJours(T0, -1) })],
    ['f@example.com', ligneTable({ email: 'f@example.com', reserveLe: plusJours(T0, -0.001) })],
    ['a@example.com', ligneTable({ email: 'a@example.com', jetonHash: 'b'.repeat(64), jetonNumero: 1, expireLe: plusJours(T0, 13), erreur: 'Resend : x' })],
  ])
  const { actions, bilan } = planifier({ mode: 'envoi', lignes, comptes, table, max: 3, maintenant: T0 })
  assert.deepEqual(actions.map(a => [a.email, a.version, a.jeton]), [
    ['a@example.com', 'payant', 'reprendre'],
    ['b@example.com', 'payant-compte', null],
    ['d@example.com', 'payant', 'nouveau'],
  ])
  assert.deepEqual(bilan.ecartees, { deja_envoye: 1, reservee: 1 })
  assert.equal(bilan.eligibles, 4)
  assert.equal(bilan.retenus, 3)
  assert.equal(bilan.reportes, 1, 'le gratuit attend le passage suivant')
  assert.deepEqual(bilan.a_envoyer, { payant: 2, 'payant-compte': 1, gratuit: 1 })
  assert.deepEqual(bilan.par_version_csv, { payant: 4, gratuit: 2 })
  assert.deepEqual(bilan.comptes, { utilisable: 1, non_confirme: 1, aucun: 4 })
  assert.equal(bilan.jetons_repris, 1)
  assert.equal(bilan.jetons_neufs, 1)
  const tout = planifier({ mode: 'envoi', lignes, comptes, table, max: 90, maintenant: T0 })
  assert.deepEqual(tout.actions.map(a => a.email), ['a@example.com', 'b@example.com', 'd@example.com', 'c@example.com'])
  assert.ok(!JSON.stringify(bilan).includes('@'), 'le bilan ne porte aucune adresse')
})

bloc('plan de relance : version du premier email, seuil du jeton', () => {
  const { lignes } = lireCsvInvitations('a@example.com;payant;A\nb@example.com;payant;B\nc@example.com;gratuit;C\nd@example.com;payant;D')
  const table = new Map([
    ['a@example.com', ligneTable({ email: 'a@example.com', envoyeLe: plusJours(T0, -4), jetonHash: 'b'.repeat(64), jetonNumero: 1, expireLe: plusJours(T0, 10) })],
    ['b@example.com', ligneTable({ email: 'b@example.com', envoyeLe: plusJours(T0, -11), jetonHash: 'c'.repeat(64), jetonNumero: 1, expireLe: plusJours(T0, 3) })],
    ['c@example.com', ligneTable({ email: 'c@example.com', version: 'gratuit', envoyeLe: plusJours(T0, -3.5) })],
    ['d@example.com', ligneTable({ email: 'd@example.com', envoyeLe: plusJours(T0, -4) })],
  ])
  const comptes = new Map([['d@example.com', 'utilisable']])
  const { actions, bilan } = planifier({ mode: 'relance', lignes, comptes, table, max: 90, maintenant: T0 })
  assert.deepEqual(actions.map(a => [a.email, a.version, a.jeton]), [
    ['a@example.com', 'payant', 'reprendre'],
    ['b@example.com', 'payant', 'nouveau'],
    ['c@example.com', 'gratuit', null],
  ])
  assert.deepEqual(bilan.ecartees, { compte: 1 })
})

bloc('compteur : par version du CSV, null sans table', () => {
  const { lignes } = lireCsvInvitations('a@example.com;payant;A\nb@example.com;payant;B\nc@example.com;gratuit;C')
  const comptes = new Map([['a@example.com', 'utilisable'], ['c@example.com', 'non_confirme']])
  const table = new Map([
    ['a@example.com', ligneTable({ email: 'a@example.com', envoyeLe: T0, ouvertLe: T0, compteCree: true })],
    ['c@example.com', ligneTable({ email: 'c@example.com', version: 'gratuit', envoyeLe: T0, relanceLe: T0 })],
  ])
  const c = compter(lignes, comptes, table)
  assert.deepEqual(c.payant, { adresses: 2, comptes: 1, comptes_non_confirmes: 0, recus: 1, relances: 0, ouverts: 1, comptes_crees_par_invitation: 1 })
  assert.deepEqual(c.gratuit, { adresses: 1, comptes: 0, comptes_non_confirmes: 1, recus: 1, relances: 1, ouverts: 0, comptes_crees_par_invitation: 0 })
  assert.equal(c.total.adresses, 3)
  const sans = compter(lignes, comptes, null)
  assert.equal(sans.payant.recus, null)
  assert.equal(sans.total.ouverts, null)
  assert.equal(sans.payant.comptes, 1)
})

// ---------------------------------------------------------------------------
// Modeles
// ---------------------------------------------------------------------------

bloc('modeles : marques, BROUILLON, prenom absent, HTML echappe, adresses de test', () => {
  assert.deepEqual(verifierModele({ sujet: 'Bonjour {{prenom}}', corps: 'Lien : {{lien}}' }), [])
  assert.ok(verifierModele({ sujet: 'X', corps: 'pas de lien' }).includes('corps sans {{lien}}'))
  assert.ok(verifierModele({ sujet: '{{lien}}', corps: '{{lien}}' }).includes('{{lien}} dans le sujet'))
  assert.ok(verifierModele({ sujet: 'X', corps: '{{lien}} {{nom}}' }).includes('marque inconnue {{nom}}'))
  assert.ok(verifierModele({ sujet: 'a\nb', corps: '{{lien}}' }).includes('sujet sur plusieurs lignes'))
  assert.equal(estBrouillon({ sujet: '[BROUILLON] X', corps: '' }), true)
  assert.equal(estBrouillon({ sujet: 'X', corps: 'Brouillon : y' }), true)
  assert.equal(estBrouillon({ sujet: 'X', corps: 'Y' }), false)
  assert.equal(remplir('Bonjour {{prenom}},\n{{lien}}', { prenom: 'Anne', lien: 'https://x.test/a' }), 'Bonjour Anne,\nhttps://x.test/a')
  assert.equal(remplir('Bonjour {{ prenom }},', { prenom: null, lien: '' }), 'Bonjour,')
  assert.equal(remplir('{{lien}}', { prenom: null, lien: 'https://x.test/$1$&' }), 'https://x.test/$1$&', 'pas de motif de remplacement')
  const html = htmlDepuisTexte('Salut <script>\n\nVoir https://aoknowledge.com/connexion?a=1&b=2 ici')
  assert.ok(!html.includes('<script>'))
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /<a href="https:\/\/aoknowledge\.com\/connexion\?a=1&amp;b=2"/)
  assert.equal((html.match(/<p /g) ?? []).length, 2)
  const e = emailDepuisModele({ sujet: '  Bienvenue {{prenom}} \n', corps: 'Bonjour {{prenom}},\n{{lien}}' }, { prenom: 'Zoé <b>', lien: 'https://x.test' }, true)
  assert.equal(e.sujet, '[Essai] Bienvenue Zoé <b>')
  assert.match(e.html, /Zoé &lt;b&gt;/)
  assert.equal(nomModele('envoi', 'payant-compte'), 'payant-compte')
  assert.equal(nomModele('relance', 'gratuit'), 'relance-gratuit')
  for (const ok of ['delivered@resend.dev', 'Delivered+essai1@resend.dev', 'bounced@resend.dev']) assert.ok(estAdresseTestResend(ok), ok)
  for (const non of ['brice.d@aoknowledge.com', 'delivered@resend.dev.evil.com', 'x@example.com', '', null]) assert.ok(!estAdresseTestResend(non), String(non))
  assert.equal(masquerEmails(new Error('refus pour anne@example.com, ligne 3')), 'refus pour [email], ligne 3')
})

bloc('modeles BROUILLON du depot : complets, marques BROUILLON, sans tiret long', () => {
  const dossier = fileURLToPath(new URL('./modeles-invitation-skool/', import.meta.url))
  const noms = ['payant', 'payant-compte', 'gratuit', 'relance-payant', 'relance-gratuit']
  const { modeles, defauts } = lireModeles(dossier, noms)
  assert.deepEqual(defauts, [])
  for (const nom of noms) {
    const m = modeles.get(nom)
    assert.ok(estBrouillon(m), `${nom} doit rester marque BROUILLON`)
    assert.ok(!INTERDITS.test(m.sujet + m.corps), `${nom} : caractere interdit (tiret long...)`)
  }
  assert.deepEqual(readdirSync(dossier).sort(), noms.flatMap(nm => [`${nm}.corps.txt`, `${nm}.sujet.txt`]).sort())
  assert.match(lireModeles(dossier, ['inconnu']).defauts[0], /fichier manquant/)
})

bloc('arguments : essai a blanc par defaut, gardes', () => {
  const o = lireArguments(['x.csv', '--modeles', 'm'])
  assert.equal(o.ecrire, false)
  assert.equal(o.max, 90)
  assert.equal(o.lot, 'skool-2026-11')
  assert.equal(lireArguments(['x.csv', '--modeles', 'm', '--max', '20', '--relance', '--ecrire']).max, 20)
  assert.match(lireArguments(['x.csv', '--modeles', 'm', '--max', '0']).erreur, /--max/)
  assert.match(lireArguments(['x.csv', '--compteur', '--ecrire']).erreur, /--compteur/)
  assert.equal(lireArguments(['x.csv', '--compteur']).compteur, true)
  assert.match(lireArguments(['x.csv', '--modeles', 'm', '--test-vers', 'brice.d@aoknowledge.com']).erreur, /test de Resend/)
  assert.match(lireArguments(['x.csv', '--modeles', 'm', '--test-vers', 'delivered@resend.dev', '--ecrire']).erreur, /sans --ecrire/)
  assert.equal(lireArguments(['x.csv', '--modeles', 'm', '--test-vers', 'delivered@resend.dev']).testVers, 'delivered@resend.dev')
  assert.match(lireArguments(['x.csv']).erreur, /--modeles/)
  assert.match(lireArguments(['--modeles', 'm']).erreur, /CSV/)
  assert.match(lireArguments(['x.csv', '--modeles', 'm', '--lot', 'A B']).erreur, /--lot/)
  assert.match(lireArguments(['x.csv', '--modeles']).erreur, /attend une valeur/)
})

// ---------------------------------------------------------------------------
// Deroule d'un passage --ecrire (fausse base, faux Resend)
// ---------------------------------------------------------------------------

function passage({ table = new Map(), comptes = new Map(), envois = [], mode = 'envoi', max = 90, csv, refus = {} }) {
  const { lignes } = lireCsvInvitations(csv)
  const plan = planifier({ mode, lignes, comptes, table, max, maintenant: T0 })
  const modeles = new Map(['payant', 'payant-compte', 'gratuit'].map(v => [nomModele(mode, v), { sujet: `S ${v} {{prenom}}`, corps: `Bonjour {{prenom}}, {{lien}}` }]))
  const base = new Map(table)
  let id = 0
  const ports = {
    async preparer(a) {
      if (mode === 'relance') return a.ligne
      const l = base.get(a.email)
      if (l?.envoyeLe) return null
      const ligne = l ? { ...l, version: a.version, jetonHash: a.version === 'payant' ? l.jetonHash : null, expireLe: a.version === 'payant' ? l.expireLe : null }
        : ligneTable({ id: `00000000-0000-4000-8000-00000000000${++id}`, email: a.email, version: a.version, prenom: a.prenom })
      base.set(a.email, ligne)
      return ligne
    },
    async reserver(ligne, jeton) {
      if (refus.reserver?.includes(ligne.email)) return false
      Object.assign(ligne, { reserveLe: T0, jetonHash: jeton?.hash ?? null, jetonNumero: jeton?.numero ?? ligne.jetonNumero, expireLe: jeton?.expireLe ?? null })
      return true
    },
    async envoyer(e, cle) {
      envois.push({ ...e, cle })
      if (refus.quota && envois.length === refus.quota) return { ok: false, erreur: 'Resend : daily_quota_exceeded', arret: true }
      return { ok: true, id: `re_${envois.length}` }
    },
    async reussi(ligne, rid) { Object.assign(ligne, mode === 'envoi' ? { envoyeLe: T0, resendId: rid } : { relanceLe: T0 }, { reserveLe: null }) },
    async echoue(ligne, erreur) { Object.assign(ligne, { erreur, reserveLe: null }) },
    async pause() {},
  }
  return { run: () => derouler({ actions: plan.actions, mode, modeles, secret: SECRET, maintenant: T0, ports }), base, envois, plan }
}

bloc('passage : jeton neuf ecrit avant l envoi, lien = jeton de la base, idempotence par ligne', async () => {
  const p = passage({ csv: 'a@example.com;payant;Anne\nb@example.com;gratuit;Bob', comptes: new Map() })
  const r = await p.run()
  assert.equal(r.envoyes, 2)
  assert.equal(r.jetons_neufs, 1)
  const a = p.base.get('a@example.com')
  assert.equal(a.jetonNumero, 1)
  assert.equal(a.expireLe.getTime(), plusJours(T0, VALIDITE_JOURS).getTime())
  const lien = new URL(p.envois[0].texte.match(/https:\/\/\S+/)[0])
  assert.equal(hacherJeton(lien.searchParams.get('j')), a.jetonHash, 'le lien de l email ouvre la ligne')
  assert.equal(p.envois[0].cle, `aok-invitation/${a.id}/envoi`)
  assert.equal(p.envois[0].sujet, 'S payant Anne')
  assert.match(p.envois[1].texte, /https:\/\/aoknowledge\.com\/connexion/)
  assert.equal(p.base.get('b@example.com').jetonHash, null)
  // Second passage : rien ne repart.
  const p2 = passage({ csv: 'a@example.com;payant;Anne\nb@example.com;gratuit;Bob', table: p.base })
  assert.equal(p2.plan.actions.length, 0)
})

bloc('passage : envoi rate repris avec le meme lien ; secret change = lien neuf', async () => {
  const j1 = deriverJeton(SECRET, ID, 1)
  const table = new Map([['a@example.com', ligneTable({ email: 'a@example.com', jetonHash: hacherJeton(j1), jetonNumero: 1, expireLe: plusJours(T0, 12), erreur: 'Resend : x' })]])
  const p = passage({ csv: 'a@example.com;payant;A', table })
  const r = await p.run()
  assert.equal(r.jetons_repris, 1)
  assert.match(p.envois[0].texte, new RegExp(`\\?j=${j1}`))
  const autre = new Map([['a@example.com', ligneTable({ email: 'a@example.com', jetonHash: 'd'.repeat(64), jetonNumero: 1, expireLe: plusJours(T0, 12) })]])
  const p2 = passage({ csv: 'a@example.com;payant;A', table: autre })
  const r2 = await p2.run()
  assert.equal(r2.jetons_neufs, 1)
  assert.equal(p2.base.get('a@example.com').jetonNumero, 2)
})

bloc('passage : quota Resend = arret, le reste attend ; ligne reservee ailleurs sautee', async () => {
  const p = passage({ csv: 'a@example.com;gratuit;A\nb@example.com;gratuit;B\nc@example.com;gratuit;C', refus: { quota: 2, reserver: ['a@example.com'] } })
  const r = await p.run()
  assert.equal(r.sautes.reservee, 1)
  assert.equal(r.envoyes, 1)
  assert.deepEqual(r.echecs, { 'Resend : daily_quota_exceeded': 1 })
  assert.match(r.arret, /daily_quota_exceeded \(ligne 3 du CSV\)/)
  assert.equal(p.base.get('c@example.com').envoyeLe, null)
  assert.ok(!JSON.stringify(r).includes('@'))
})

bloc('passage de relance : meme lien si assez long, neuf sous le seuil', async () => {
  const ja = deriverJeton(SECRET, ID, 1)
  const IDB = '0b6f5c1e-1a2b-4c3d-8e9f-0011223344bb'
  const table = new Map([
    ['a@example.com', ligneTable({ email: 'a@example.com', envoyeLe: plusJours(T0, -4), jetonHash: hacherJeton(ja), jetonNumero: 1, expireLe: plusJours(T0, 10) })],
    ['b@example.com', ligneTable({ id: IDB, email: 'b@example.com', envoyeLe: plusJours(T0, -12), jetonHash: hacherJeton(deriverJeton(SECRET, IDB, 1)), jetonNumero: 1, expireLe: plusJours(T0, 2) })],
  ])
  const p = passage({ mode: 'relance', csv: 'a@example.com;payant;A\nb@example.com;payant;B', table })
  const r = await p.run()
  assert.equal(r.envoyes, 2)
  assert.match(p.envois[0].texte, new RegExp(`\\?j=${ja}`), 'meme lien que le premier email')
  assert.equal(p.envois[0].cle, `aok-invitation/${ID}/relance`)
  const b = p.base.get('b@example.com')
  assert.equal(b.jetonNumero, 2)
  assert.equal(b.expireLe.getTime(), plusJours(T0, VALIDITE_JOURS).getTime())
  assert.ok(p.envois[1].texte.includes(deriverJeton(SECRET, IDB, 2)))
  assert.ok(b.relanceLe)
})

// ---------------------------------------------------------------------------
// Ouverture du lien (fausse base, faux Supabase)
// ---------------------------------------------------------------------------

function monde({ invitations = [], comptes = [], secondaires = [], creer = 'ok', generer = 'ok', noterJette = false, trouverJette = null } = {}) {
  const journal = []
  const appels = { creer: [], generer: [], noter: [] }
  let compteurId = 0
  const ports = {
    async trouver(h) {
      if (trouverJette) throw trouverJette
      return invitations.find(i => hacherJeton(i.jeton) === h) ?? null
    },
    async compte(email) {
      const c = comptes.find(x => x.email === email)
      if (c) return { etat: 'connexion', userId: c.id, confirme: c.confirme !== false }
      return secondaires.includes(email) ? { etat: 'secondaire' } : null
    },
    async creerCompte(email, prenom) {
      appels.creer.push({ email, prenom })
      if (creer === 'existe') { comptes.push({ email, id: 'u-course' }); return { ok: false, existe: true, erreur: '422 email_exists' } }
      if (creer === 'refus') return { ok: false, existe: false, erreur: '500 unexpected_failure' }
      const id = `u-cree-${++compteurId}`
      comptes.push({ email, id })
      return { ok: true, userId: id }
    },
    async genererJeton(email) {
      appels.generer.push(email)
      if (generer === 'refus') return { ok: false, erreur: 'supabase 500 x' }
      const c = comptes.find(x => x.email === email)
      if (generer === 'autre') return { ok: true, userId: 'u-autre', email: 'autre@example.com', tokenHash: 'th', type: 'magiclink' }
      if (generer === 'type') return { ok: true, userId: c.id, email, tokenHash: 'th', type: 'email_change' }
      return { ok: true, userId: c.id, email: email.toUpperCase(), tokenHash: `th-${c.id}-0123456789`, type: c.confirme === false ? 'signup' : 'magiclink' }
    },
    async noter(id, f) {
      if (noterJette) throw new Error('42P01 relation does not exist')
      appels.noter.push({ id, ...f })
    },
    journal: l => journal.push(l),
    codeErreur: e => (e instanceof Error ? e.name : 'erreur'),
    maintenant: () => T0,
  }
  return { ports, journal, appels }
}

const JA = deriverJeton(SECRET, ID, 1)
const INV = { id: ID, email: 'anne@example.com', prenom: 'Anne', version: 'payant', expireLe: plusJours(T0, 10), jeton: JA }
const repere = url => new URL(url).searchParams.get('invitation')
const fragment = url => new URLSearchParams(new URL(url).hash.slice(1))

bloc('ouverture : sans compte, le compte est cree (email confirme, prenom), puis la page du site', async () => {
  const m = monde({ invitations: [INV] })
  const r = await ouvrirInvitation(JA, m.ports)
  assert.equal(r.issue, 'ok_compte_cree')
  assert.deepEqual(m.appels.creer, [{ email: 'anne@example.com', prenom: 'Anne' }])
  assert.equal(new URL(r.url).origin + new URL(r.url).pathname, 'https://aoknowledge.com/auth/invitation')
  assert.equal(fragment(r.url).get('token_hash'), 'th-u-cree-1-0123456789')
  assert.equal(fragment(r.url).get('type'), 'magiclink')
  assert.deepEqual(m.appels.noter, [{ id: ID, userId: 'u-cree-1', compteCree: true }])
  // Second clic (ordinateur apres telephone) : le compte existe, pas de creation, nouveau jeton Supabase.
  const r2 = await ouvrirInvitation(JA, m.ports)
  assert.equal(r2.issue, 'ok')
  assert.equal(m.appels.creer.length, 1)
  assert.equal(m.appels.generer.length, 2)
  assert.deepEqual(m.appels.noter[1], { id: ID, userId: 'u-cree-1', compteCree: false })
})

bloc('ouverture : compte existant (meme non confirme) ; compte cree entre-temps', async () => {
  const m = monde({ invitations: [INV], comptes: [{ email: 'anne@example.com', id: 'u-1', confirme: false }] })
  const r = await ouvrirInvitation(JA, m.ports)
  assert.equal(r.issue, 'ok')
  assert.equal(m.appels.creer.length, 0)
  assert.equal(fragment(r.url).get('type'), 'signup', 'Supabase rend un jeton signup : verifyOtp confirme le compte')
  const course = monde({ invitations: [INV], creer: 'existe' })
  const rc = await ouvrirInvitation(JA, course.ports)
  assert.equal(rc.issue, 'ok')
  assert.equal(fragment(rc.url).get('token_hash'), 'th-u-course-0123456789')
})

bloc('ouverture : refus et pannes renvoient vers la connexion avec le bon repere', async () => {
  const cas = [
    [monde({ invitations: [INV] }), 'x'.repeat(10), 'invalide', 'jeton_illisible'],
    [monde({ invitations: [INV] }), null, 'invalide', 'jeton_illisible'],
    [monde({ invitations: [INV] }), jetonAleatoire(), 'invalide', 'inconnue'],
    [monde({ invitations: [{ ...INV, expireLe: plusJours(T0, -0.001) }] }), JA, 'expiree', 'expiree'],
    [monde({ invitations: [{ ...INV, expireLe: null }] }), JA, 'expiree', 'expiree'],
    [monde({ invitations: [{ ...INV, version: 'gratuit' }] }), JA, 'invalide', 'inconnue'],
    [monde({ invitations: [INV], secondaires: ['anne@example.com'] }), JA, 'compte', 'compte_secondaire'],
    [monde({ invitations: [INV], creer: 'refus' }), JA, 'erreur', 'creation_echec'],
    [monde({ invitations: [INV], generer: 'refus' }), JA, 'erreur', 'generation_echec'],
    [monde({ invitations: [INV], generer: 'autre' }), JA, 'erreur', 'autre_compte'],
    [monde({ invitations: [INV], generer: 'type' }), JA, 'erreur', 'type_inconnu'],
    [monde({ invitations: [INV], trouverJette: new Error('42P01') }), JA, 'erreur', 'erreur'],
  ]
  for (const [m, jeton, attendu, issue] of cas) {
    const r = await ouvrirInvitation(jeton, m.ports)
    assert.equal(r.issue, issue)
    assert.equal(repere(r.url), attendu, issue)
    assert.equal(new URL(r.url).pathname, '/connexion')
  }
  const compte = monde({ invitations: [INV], secondaires: ['anne@example.com'] })
  await ouvrirInvitation(JA, compte.ports)
  assert.equal(compte.appels.creer.length + compte.appels.generer.length, 0, 'une adresse secondaire ne cree ni ne connecte rien')
})

bloc('ouverture : le suivi qui tombe ne bloque pas la connexion ; aucun jeton ni adresse dans les logs', async () => {
  const m = monde({ invitations: [INV], noterJette: true })
  const r = await ouvrirInvitation(JA, m.ports)
  assert.equal(r.issue, 'ok_compte_cree')
  assert.ok(m.journal.some(l => /suivi non note/.test(l)))
  const tout = monde({ invitations: [INV], comptes: [{ email: 'anne@example.com', id: 'u-1' }] })
  for (const j of [JA, jetonAleatoire(), 'x']) await ouvrirInvitation(j, tout.ports)
  const logs = [...m.journal, ...tout.journal].join('\n')
  assert.ok(!logs.includes(JA) && !logs.includes(hacherJeton(JA)), 'ni jeton ni hash')
  assert.ok(!logs.includes('@'), 'aucune adresse')
  assert.ok(!logs.includes('th-'), 'aucun token_hash')
  assert.match(logs, /inv=0b6f5c1e/)
})

// ---------------------------------------------------------------------------
// Fichiers : route, middleware, masque de Sentry, migration
// ---------------------------------------------------------------------------

bloc('route, middleware, serveur : publique en chemin exact, HEAD sans effet, 303 sans cache', () => {
  const route = lire('src/app/api/academie/invitation/route.ts')
  assert.match(route, /export async function GET\(req: NextRequest\)/)
  assert.match(route, /export function HEAD\(\)/)
  assert.match(route, /status: 204/)
  assert.match(route, /status: 303/)
  assert.match(route, /'Cache-Control': 'no-store'/)
  assert.match(route, /'Referrer-Policy': 'no-referrer'/)
  assert.ok(!/console\./.test(route), 'la route ne journalise rien elle-meme')
  const mw = lire('middleware.ts')
  assert.match(mw, /pathname === '\/api\/academie\/invitation'/)
  const serveur = lire('src/lib/academie/invitations.ts')
  assert.match(serveur, /email_confirm: true/)
  assert.match(serveur, /generateLink\(\{ type: TYPE_LIEN_SUPABASE, email \}\)/)
  assert.match(serveur, /\$queryRawUnsafe<LigneTrouvee\[\]>\(SQL_TROUVER, jetonHash\)/)
  assert.match(serveur, /\(SQL_COMPTE_CONNEXION, email\)/)
  assert.match(serveur, /\$executeRawUnsafe\(SQL_NOTER, id, userId, compteCree\)/)
  assert.ok(!/\$queryRaw`|\$executeRaw`/.test(serveur), 'les requetes viennent de invitations-pur.ts (essayees par essayer-migration-invitations.mjs)')
  assert.ok(!/console\.\w+\([^)]*(jeton|token|email)\b/i.test(serveur.replace(/\/\/.*$/gm, '')), 'aucun log de jeton ni d adresse')
})

bloc('Sentry : le jeton d invitation est masque dans les adresses, les chaines de requete et les objets', () => {
  const j = deriverJeton(SECRET, ID, 1)
  const ev = masquerSecretMcp({
    request: { url: `https://journal.aoknowledge.com/api/academie/invitation?j=${j}`, query_string: `j=${j}`, query: { j }, paires: [['j', j]] },
    transaction: 'GET /api/academie/invitation',
    spans: [{ data: { 'url.query': `?j=${j}&x=1`, 'http.target': `/api/academie/invitation?j=${j}` } }],
    autre: { j: 'court', mot: `objet=${j}` },
  })
  const s = JSON.stringify(ev)
  assert.ok(!s.includes(`j=${j}`) && !s.includes(`"${j}"`), 'jeton visible')
  assert.match(ev.request.url, /\?j=\[masque\]$/)
  assert.equal(ev.request.query_string, 'j=[masque]')
  assert.equal(ev.request.query.j, '[masque]')
  assert.equal(ev.request.paires[0][1], '[masque]')
  assert.equal(ev.autre.j, 'court', 'une valeur qui n est pas un jeton reste')
  assert.equal(masquerSecretMcp('/api/mcp/abc'), '/api/mcp/[masque]', 'le masque MCP marche toujours')
})

bloc('migration (depot workspace) : un ordre par point-virgule, table fermee, contraintes', () => {
  const dir = process.env.MIGRATIONS_DIR
    ?? fileURLToPath(new URL('../../../sites/Aoknowledgecom/supabase/migrations/', import.meta.url))
  const chemin = `${dir.replace(/\/+$/, '')}/20261108200000_academie_invitations.sql`
  if (!existsSync(chemin)) {
    console.log(`    (migration introuvable a ${chemin} : donner MIGRATIONS_DIR ; bloc NON verifie)`)
    sautes++
    return
  }
  const sql = readFileSync(chemin, 'utf8')
  // Comme scripts/appliquer-migration.mjs : lignes de commentaire retirees, puis coupe aux points-virgules.
  const sansCommentaires = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  const ordres = sansCommentaires.split(';').map(o => o.trim()).filter(Boolean)
  assert.equal(ordres.length, 8)
  assert.deepEqual(ordres.map(o => o.split(/\s+/).slice(0, 2).join(' ')), [
    'create table', 'comment on', 'create unique', 'create index', 'alter table', 'alter table', 'revoke all', 'notify pgrst,',
  ])
  assert.ok(!/--/.test(sansCommentaires), 'pas de commentaire en fin de ligne')
  assert.ok(!/\$[A-Za-z_]*\$/.test(sql), 'aucun bloc dollar')
  assert.match(sql, /unique \(lot, email\)/)
  assert.match(sql, /check \(version in \('payant', 'payant-compte', 'gratuit'\)\)/)
  assert.match(sql, /check \(jeton_hash is null or version = 'payant'\)/)
  assert.match(sql, /on public\.academie_invitations \(jeton_hash\) where jeton_hash is not null/)
  assert.match(sql, /enable row level security/)
  assert.match(sql, /force row level security/)
  assert.match(sql, /revoke all on table public\.academie_invitations from anon, authenticated/)
  assert.ok(!/create policy|grant /i.test(sql))
  // Les colonnes lues ou ecrites par le journal existent toutes.
  for (const col of ['lot', 'email', 'version', 'prenom', 'jeton_hash', 'jeton_numero', 'expire_le', 'reserve_le', 'envoye_le', 'resend_id',
    'relance_le', 'relance_resend_id', 'ouvert_le', 'dernier_clic_le', 'clics', 'compte_le', 'compte_cree', 'user_id', 'erreur', 'pose_par']) {
    assert.match(sql, new RegExp(`\\n  ${col}\\s+`), col)
  }
})

let sautes = 0
for (const [nom, f] of blocs) {
  await f()
  n++
  console.log(`ok  ${nom}`)
}
console.log(`\n${n} blocs ok${sautes ? `, dont ${sautes} NON verifie(s) (voir plus haut)` : ''}`)
