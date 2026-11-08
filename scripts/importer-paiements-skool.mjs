/**
 * Importe les paiements encaisses par Skool dans cockpit_paiements_tiers
 * (C10, Brice 08/11/2026 : « S'ils ont payé par Skool et que ce n'est pas nous
 * qui générons la facture, c'est autre chose »). Le membre les voit dans Mon
 * espace > Achats, avec un renvoi vers Skool pour la facture : on n'invente
 * aucune facture.
 *
 * Source : l'export de fermeture de Skool (07/11/2026), sur D: :
 *   paiements.csv (une facture Skool par ligne) et membres.csv (l'email d'un
 *   membre quand la facture ne le porte pas, par member_id).
 * Ecartees : les factures de l'abonnement Skool de Brice (produit hosting).
 * Rattachement : l'email, en minuscules, a une fiche du cockpit
 * (cockpit_membre_emails). Sans fiche : la facture n'est pas importee et le
 * bilan le compte (le membre peut ecrire au support).
 *
 * Migration requise pour ecrire : 20261108230000_mon_espace_historique_paiements.sql.
 * ESSAI A BLANC par defaut (lecture seule) ; --ecrire pour ecrire (rejouable :
 * upsert sur paiement_id = skool:<invoice_id>).
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/importer-paiements-skool.mjs [--export <dossier>] [--ecrire]
 *
 * N'affiche ni email, ni nom, ni identifiant : des comptes seulement.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const EXPORT_DEFAUT = '/mnt/d/6_Societe/Pilotage/Data-Performance/platforms/skool/exports/2026-11-07'

const args = process.argv.slice(2)
const ecrire = args.includes('--ecrire')
const iExport = args.indexOf('--export')
const dossier = iExport >= 0 && args[iExport + 1] ? args[iExport + 1] : EXPORT_DEFAUT

/** CSV (RFC 4180) : guillemets, virgules et retours a la ligne dans un champ, BOM retire. */
export function lireCsv(texte) {
  const t = texte.replace(/^﻿/, '')
  const lignes = []
  let ligne = []
  let champ = ''
  let guillemets = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++ } else if (c === '"') guillemets = false
      else champ += c
    } else if (c === '"') guillemets = true
    else if (c === ',') { ligne.push(champ); champ = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      ligne.push(champ); champ = ''
      if (ligne.some((x) => x !== '')) lignes.push(ligne)
      ligne = []
    } else champ += c
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); if (ligne.some((x) => x !== '')) lignes.push(ligne) }
  const [entete, ...corps] = lignes
  return corps.map((l) => Object.fromEntries(entete.map((k, j) => [k.trim(), (l[j] ?? '').trim()])))
}

const STATUTS = { paid: 'paye', uncollectible: 'impaye', open: 'impaye', void: 'impaye', draft: 'impaye' }

/** Une facture Skool de l'export, prete pour cockpit_paiements_tiers (sans membre_id). null = ecartee. */
export function factureSkool(f, emailsParMembre) {
  if ((f.produit || '').toLowerCase() === 'hosting') return null
  const invoice = (f.invoice_id || '').trim()
  if (!/^[A-Za-z0-9_-]{4,110}$/.test(invoice)) return null
  const quand = (f.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(quand)) return null
  const montant = Number(f.montant)
  if (!Number.isFinite(montant) || montant < 0) return null
  const devise = (f.devise || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(devise)) return null
  const rembourse = /^(true|1|oui)$/i.test(f.rembourse || '')
  const statut = rembourse ? 'rembourse' : (STATUTS[(f.statut || '').toLowerCase()] ?? 'impaye')
  const email = ((f.email || '').trim() || emailsParMembre.get((f.member_id || '').trim()) || '').toLowerCase() || null
  return {
    paiement_id: `skool:${invoice}`,
    date_paiement: `${quand.replace(' ', 'T')}Z`,
    montant: Math.round(montant * 100) / 100,
    devise,
    produit: (f.produit || '').toLowerCase() === 'course' ? 'Cours sur Skool' : '10% Club sur Skool',
    statut,
    facture: (f.facture || '').trim().slice(0, 60) || null,
    email,
  }
}

async function main() {
  const factures = lireCsv(readFileSync(path.join(dossier, 'paiements.csv'), 'utf8'))
  const membres = lireCsv(readFileSync(path.join(dossier, 'membres.csv'), 'utf8'))
  const emailsParMembre = new Map(membres.filter((m) => m.member_id && m.email).map((m) => [m.member_id, m.email]))
  const lignes = factures.map((f) => factureSkool(f, emailsParMembre)).filter(Boolean)
  const origine = `export Skool du ${path.basename(dossier)}`

  const prisma = new PrismaClient()
  try {
    const emails = [...new Set(lignes.map((l) => l.email).filter(Boolean))]
    const fiches = emails.length ? await prisma.$queryRawUnsafe(
      'select lower(email) as email, membre_id::text as m from public.cockpit_membre_emails where lower(email) = any($1::text[])', emails) : []
    const ficheDe = new Map(fiches.map((f) => [f.email, f.m]))
    // Visible dans Mon espace : la fiche a une adresse confirmee d'un compte du site.
    const visibles = emails.length ? await prisma.$queryRawUnsafe(
      `select distinct lower(me.email) as email from public.cockpit_membre_emails me
        where lower(me.email) = any($1::text[])
          and exists (select 1 from public.cockpit_membre_emails me2
                       join auth.users u on lower(u.email) = lower(me2.email) and u.email_confirmed_at is not null
                      where me2.membre_id = me.membre_id
                      union all
                      select 1 from public.cockpit_membre_emails me3
                       join public.profile_emails pe on lower(pe.email) = lower(me3.email) and pe.verified
                      where me3.membre_id = me.membre_id)`, emails) : []
    const vu = new Set(visibles.map((v) => v.email))

    const aImporter = lignes.filter((l) => l.email && ficheDe.has(l.email))
    const payes = lignes.filter((l) => l.statut === 'paye')
    console.log(`factures lues          : ${factures.length}`)
    console.log(`factures de membres    : ${lignes.length} (abonnement Skool de Brice ecarte)`)
    console.log(`  payees               : ${payes.length}, impayees : ${lignes.filter((l) => l.statut === 'impaye').length}, remboursees : ${lignes.filter((l) => l.statut === 'rembourse').length}`)
    console.log(`  membres distincts    : ${new Set(lignes.map((l) => l.email ?? 'sans')).size}`)
    console.log(`  sans email           : ${lignes.filter((l) => !l.email).length} (payees : ${payes.filter((l) => !l.email).length})`)
    console.log(`  sans fiche du cockpit: ${lignes.filter((l) => l.email && !ficheDe.has(l.email)).length} (payees : ${payes.filter((l) => l.email && !ficheDe.has(l.email)).length})`)
    console.log(`  rattachees a une fiche : ${aImporter.length} (payees : ${aImporter.filter((l) => l.statut === 'paye').length})`)
    console.log(`  payees visibles dans Mon espace aujourd'hui (compte du site) : ${aImporter.filter((l) => l.statut === 'paye' && vu.has(l.email)).length}`)

    if (!ecrire) {
      console.log('\nEssai a blanc : rien ecrit. --ecrire pour importer.')
      return
    }
    const table = Number((await prisma.$queryRawUnsafe(
      `select count(*)::int as n from pg_class where relname = 'cockpit_paiements_tiers' and relnamespace = 'public'::regnamespace`))[0].n)
    if (!table) throw new Error('table cockpit_paiements_tiers absente : appliquer la migration 20261108230000 d abord')
    let n = 0
    for (const l of aImporter) {
      n += await prisma.$executeRawUnsafe(
        `insert into public.cockpit_paiements_tiers (paiement_id, encaisse_par, membre_id, date_paiement, montant, devise, produit, statut, facture, origine)
         values ($1, 'skool', $2::uuid, $3::timestamptz, $4::numeric, $5, $6, $7, $8, $9)
         on conflict (paiement_id) do update set membre_id = excluded.membre_id, date_paiement = excluded.date_paiement,
           montant = excluded.montant, devise = excluded.devise, produit = excluded.produit, statut = excluded.statut,
           facture = excluded.facture, origine = excluded.origine, importe_le = now()`,
        l.paiement_id, ficheDe.get(l.email), l.date_paiement, l.montant, l.devise, l.produit, l.statut, l.facture, origine)
    }
    console.log(`\necrit : ${n} ligne(s) dans cockpit_paiements_tiers`)
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error('ECHEC :', String(e.message).split('\n').slice(-3).join(' ').slice(0, 300))
    process.exitCode = 1
  })
}
