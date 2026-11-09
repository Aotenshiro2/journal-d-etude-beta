/**
 * LA LISTE DES ANCIENS MEMBRES (09/11/2026), en LECTURE SEULE depuis
 * l'ontologie du cockpit. Produit la liste a valider par Brice :
 *   - un JSON (entree du script d'import, apres validation) ;
 *   - une page de relecture HTML (jamais du .md brut).
 *
 * Brief : D:\7_Agents\briefs\2026-11-09-anciens-membres-numeros-annuaire.md
 *
 * Regles (decisions du brief, appliquees telles quelles) :
 *   - perimetre : natures eleve, eleve-proche, mentore, presentes dans au moins
 *     un ecosysteme AOK (izimoney, aoknowledge, deep-knowledge, coaching,
 *     ligue-schlags, izi-gentleman, live-club). Une personne vue SEULEMENT
 *     hors perimetre (future-infinity, mlm, sigma, hors, business, petits
 *     groupes, same-academy, impuls, nvisionu) n'y entre pas ;
 *   - epoque, la plus ancienne des deux : IziTrade si presente dans izimoney ;
 *     sinon LearnyBox si presente dans aoknowledge ou deep-knowledge avant la
 *     migration Skool (avant le 11/09/2025, premiere fiche Skool du cockpit),
 *     ou si sa fiche porte un acces premium-skool ou vip-skool sans fin ;
 *   - l'equipe et les associes : liste a part (candidats aux numeros 5 a 20) ;
 *   - palier trace : section « a confirmer », sans numero ;
 *   - numeros 21 et suivants par anciennete : la premiere activite DANS LES
 *     ECOSYSTEMES AOK la plus ancienne recoit le plus petit numero.
 *
 * Aucune adresse email ni aucun telephone n'est ecrit : les adresses servent
 * seulement, en memoire, a dire si un compte du site correspond deja.
 *
 * Lancement (depuis apps/journal-d-etude ou son worktree) :
 *   node --env-file=.env.local scripts/lister-anciens-membres.mjs [--sortie <dossier>]
 * Sortie par defaut : /mnt/d/6_Societe/Pilotage/Academie/anciens-membres/
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const iSortie = args.indexOf('--sortie')
const SORTIE = iSortie >= 0 ? args[iSortie + 1] : '/mnt/d/6_Societe/Pilotage/Academie/anciens-membres'

const ECOS_AOK = ['izimoney', 'aoknowledge', 'deep-knowledge', 'coaching', 'ligue-schlags', 'izi-gentleman', 'live-club']
const ECOS_LEARNYBOX = ['aoknowledge', 'deep-knowledge']
const NATURES_ELEVE = ['eleve', 'eleve-proche', 'mentore']
const NATURES_EQUIPE = ['equipe', 'associe', 'associee', 'associee-principale', 'eleve-equipe', 'ancien-equipe', 'ancien-associe', 'ancienne-associee']
/** Premiere fiche Skool du cockpit (cockpit_membres, source skool) : la migration Skool. */
const MIGRATION_SKOOL = '2025-09-11'
const PREMIER_NUMERO = 21
const DERNIER_NUMERO = 300
/** Les numeros deja poses par le brief (Brice 1, Melanie 2, Adil 3, Adrien 4). */
const DEJA_NUMEROTES = new Map([['p-melanie', 2], ['p-adil-belka', 3], ['p-adrien-pacheco', 4]])
const NOMS_ECOS = {
  izimoney: 'IziMoney / IziTrade', aoknowledge: 'AOKnowledge', 'deep-knowledge': 'Deep Knowledge', coaching: 'Coachings',
  'ligue-schlags': 'Ligue des Schlags', 'izi-gentleman': 'Izi Gentleman', 'live-club': 'Live Club',
}

/** La cle de nom du bot (reconnaissance-pur.ts, cleNom) : sans accents ni casse, mots tries, au moins deux mots de deux lettres. */
export function cleNom(nom) {
  if (typeof nom !== 'string') return null
  const mots = nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .split(/[^a-z]+/).filter(m => m.length >= 2)
  if (mots.length < 2) return null
  return [...new Set(mots)].sort().join(' ')
}

const jour = d => (d ? new Date(d).toISOString().slice(0, 10) : null)
const minJour = (a, b) => (!a ? b : !b ? a : a < b ? a : b)
const maxJour = (a, b) => (!a ? b : !b ? a : a > b ? a : b)

const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
class Fin extends Error {}
let brut
try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set transaction read only`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)
    const q = (sql, ...p) => tx.$queryRawUnsafe(sql, ...p)
    brut = {
      personnes: await q(`
        select p.personne_id, p.nom, p.alias, p.nom_est_identifiant, p.telegram, p.nature, p.palier, p.premier, p.dernier, p.messages,
               coalesce(p.tg_ids::text[], '{}') as tg,
               mt.membre_id::text as membre_id, mt.membre_confiance as confiance, mt.membre_lie_par as lie_par
          from public.cockpit_arch_personnes p
          left join public.cockpit_membre_telegram mt on mt.personne_id = p.personne_id
         where p.nature = any($1::text[]) and exists (
           select 1 from public.cockpit_arch_presences pr join public.cockpit_arch_salons s on s.salon_id = pr.salon_id
            where pr.personne_id = p.personne_id and s.ecosysteme = any($2::text[]))`,
        [...NATURES_ELEVE, ...NATURES_EQUIPE], ECOS_AOK),
      presences: await q(`
        select pr.personne_id, s.ecosysteme, pr.entree, pr.entree_source, pr.messages, s.premier as salon_premier,
               (select min(pa.dit_le) from public.cockpit_arch_paroles pa where pa.personne_id = pr.personne_id and pa.salon_id = pr.salon_id) as parole
          from public.cockpit_arch_presences pr join public.cockpit_arch_salons s on s.salon_id = pr.salon_id
         where s.ecosysteme is not null`),
      acces: await q(`
        select distinct e.membre_id::text as membre_id, o.slug
          from public.academie_acces a join public.academie_offres o on o.id = a.offre_id
          join public.cockpit_membre_emails e on lower(e.email) = lower(a.email)
         where a.retire_le is null and a.fin is null and o.slug in ('premium-skool', 'vip-skool')`),
      // En memoire seulement, jamais ecrit : les adresses verifiees des comptes du site.
      comptes: await q(`
        select p.id::text as id, p.client_number::int as numero, p.role::text as role, p.first_name, p.last_name,
               array_remove(array(
                 select lower(pe.email) from public.profile_emails pe where pe.profile_id = p.id and pe.verified
                 union select lower(u.email) from auth.users u where u.id = p.id and u.email_confirmed_at is not null
               ), null) as emails
          from public.profiles p`),
      fichesEmails: await q(`select lower(email) as email, membre_id::text as membre_id from public.cockpit_membre_emails`),
      rattachements: await q(`select telegram_id::text as tg, lower(email) as email, membre_id::text as membre_id
          from public.cockpit_liveclub_rattachements where retire_le is null`),
      codes: await q(`select telegram_id::text as tg, lower(email) as email from public.cockpit_liveclub_codes where valide_le is not null`),
    }
    throw new Fin()
  }, { timeout: 120000, maxWait: 20000 })
} catch (e) {
  if (!(e instanceof Fin)) throw e
} finally {
  await prisma.$disconnect()
}

// --- Les presences, par personne ---------------------------------------------
const presencesDe = new Map()
const ecosDe = new Map()
for (const pr of brut.presences) {
  if (!ecosDe.has(pr.personne_id)) ecosDe.set(pr.personne_id, new Set())
  ecosDe.get(pr.personne_id).add(pr.ecosysteme)
  if (!ECOS_AOK.includes(pr.ecosysteme)) continue
  if (!presencesDe.has(pr.personne_id)) presencesDe.set(pr.personne_id, [])
  presencesDe.get(pr.personne_id).push(pr)
}

// --- Les rapprochements avec les comptes du site (memes regles que la base) ---
const fichesDeEmail = new Map()
for (const f of brut.fichesEmails) {
  if (!fichesDeEmail.has(f.email)) fichesDeEmail.set(f.email, new Set())
  fichesDeEmail.get(f.email).add(f.membre_id)
}
const comptesNonEquipe = brut.comptes.filter(c => c.role !== 'admin')
const acces = new Map()
for (const a of brut.acces) {
  if (!acces.has(a.membre_id)) acces.set(a.membre_id, new Set())
  acces.get(a.membre_id).add(a.slug)
}

function compteDuSite(p) {
  const tg = new Set(p.tg)
  let parEmail = null
  let parTelegram = false
  for (const c of comptesNonEquipe) {
    for (const e of c.emails) {
      const fiches = fichesDeEmail.get(e) ?? new Set()
      if (p.membre_id && fiches.has(p.membre_id)) parEmail = p.confiance === 'certain' ? 'certain' : (parEmail ?? 'probable')
      if (brut.rattachements.some(r => tg.has(r.tg) && (r.email === e || (r.membre_id && fiches.has(r.membre_id))))) parTelegram = true
      if (brut.codes.some(k => tg.has(k.tg) && k.email === e)) parTelegram = true
    }
  }
  const cle = cleNom(p.nom)
  const parNom = cle ? comptesNonEquipe.filter(c => cleNom(`${c.first_name ?? ''} ${c.last_name ?? ''}`) === cle).length : 0
  if (parTelegram) return { lien: 'telegram', libelle: 'oui, par Telegram (activation automatique)' }
  if (parEmail === 'certain') return { lien: 'email', libelle: 'oui, par email (activation automatique)' }
  if (parEmail === 'probable') return { lien: 'email-probable', libelle: 'email, fiche liée par le nom : à confirmer' }
  if (parNom > 0) return { lien: 'nom', libelle: parNom > 1 ? `nom seul, ${parNom} comptes : à confirmer` : 'nom seul : à confirmer' }
  return null
}

// --- Le nom et le pseudo --------------------------------------------------------
// L'archive garde surtout les noms affiches de Telegram : le @pseudo n'est connu
// que pour une poignee de personnes (colonne telegram, ou un @ dans les alias).
const estIdentifiant = s => /^u\d{5,}$/.test(String(s ?? '').trim())
function nomEtPseudo(p) {
  const alias = String(p.alias ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const pseudo = p.telegram ?? alias.find(a => /^@\w{4,}$/.test(a))?.slice(1) ?? (/^@\w{4,}$/.test(p.nom ?? '') ? p.nom.slice(1) : null)
  let nom = p.nom
  if (p.nom_est_identifiant || estIdentifiant(p.nom)) nom = alias.find(a => !estIdentifiant(a) && !a.startsWith('@')) ?? null
  // Quelques noms de l'ontologie portent un surnom apres un tiret long : une virgule a la place.
  if (nom) nom = nom.replace(/\s*\u2014\s*/g, ', ').trim()
  return { nom, pseudo }
}

/** Robots vus dans les groupes, classes eleve par l'ontologie : jamais un ancien membre. */
const ROBOTS = new Set(['p-group-butler'])

// --- Les decisions de Brice (apres relecture), facultatives ---------------------
// Fichier decisions-brice.json a cote de la liste :
//   { "exclure": ["p-..."], "inclure": ["p-..."], "epoque": { "p-...": "izitrade" },
//     "equipe": { "p-...": 5 }, "valide_le": "2026-11-10" }
// exclure : retire de la liste ; inclure : fait entrer une ligne d'une section
// « a confirmer » dans la numerotation ; epoque : force l'epoque ; equipe : pose
// un numero de 5 a 20 ; valide_le : Brice a valide la liste (sans lui, l'import
// refuse). Les numeros 21 et suivants sont recalcules a chaque passage.
let decisions = { exclure: [], inclure: [], epoque: {}, equipe: {} }
try {
  const { readFileSync } = await import('node:fs')
  decisions = { ...decisions, ...JSON.parse(readFileSync(join(SORTIE, 'decisions-brice.json'), 'utf8')) }
  console.log('decisions de Brice lues :', JSON.stringify({ exclure: decisions.exclure.length, inclure: decisions.inclure.length, epoque: Object.keys(decisions.epoque).length, equipe: Object.keys(decisions.equipe).length }))
} catch { /* pas encore de decisions */ }
for (const [id, n] of Object.entries(decisions.equipe)) {
  if (!(Number.isInteger(n) && n >= 5 && n <= 20)) throw new Error(`numero d'equipe hors de 5-20 : ${id} ${n}`)
}
if (new Set(Object.values(decisions.equipe)).size !== Object.keys(decisions.equipe).length) throw new Error('deux personnes de l equipe ont le meme numero')

/** Avant le premier salon Deep Knowledge (28/02/2022) : l'epoque IziTrade, sinon LearnyBox. Une PROPOSITION, jamais appliquee sans Brice. */
const DEBUT_DEEP_KNOWLEDGE = '2022-02-28'

// --- Une ligne par personne ----------------------------------------------------
const lignes = []
for (const p of brut.personnes) {
  if (ROBOTS.has(p.personne_id)) continue
  const pres = presencesDe.get(p.personne_id) ?? []
  let premiere = null
  let estimee = false
  let premiereLB = null
  let izi = null
  for (const pr of pres) {
    let d = jour(pr.entree)
    let approx = false
    if (!d) { d = jour(pr.parole) ?? maxJour(jour(p.premier), jour(pr.salon_premier)); approx = true }
    if (!d) continue
    if (!premiere || d < premiere) { premiere = d; estimee = approx }
    if (ECOS_LEARNYBOX.includes(pr.ecosysteme)) premiereLB = minJour(premiereLB, d)
    if (pr.ecosysteme === 'izimoney') izi = minJour(izi, d)
  }
  const ecosAok = [...new Set(pres.map(x => x.ecosysteme))].sort((a, b) => ECOS_AOK.indexOf(a) - ECOS_AOK.indexOf(b))
  const lb = p.membre_id ? [...(acces.get(p.membre_id) ?? [])] : []
  let epoque = null
  let raison = null
  if (pres.some(x => x.ecosysteme === 'izimoney')) { epoque = 'izitrade'; raison = `IziMoney / IziTrade dès ${izi ?? '?'}` }
  else if (premiereLB && premiereLB < MIGRATION_SKOOL) { epoque = 'learnybox'; raison = `${ecosAok.filter(e => ECOS_LEARNYBOX.includes(e)).map(e => NOMS_ECOS[e]).join(', ')} dès ${premiereLB}` }
  else if (lb.length) { epoque = 'learnybox'; raison = `accès ${lb.join(', ')} sans fin` }
  const { nom, pseudo } = nomEtPseudo(p)
  const equipe = NATURES_EQUIPE.includes(p.nature)
  let epoqueProposee = null
  if (!epoque && premiere && premiere < MIGRATION_SKOOL) epoqueProposee = premiere < DEBUT_DEEP_KNOWLEDGE ? 'izitrade' : 'learnybox'
  if (decisions.epoque[p.personne_id]) { epoque = decisions.epoque[p.personne_id]; raison = 'choix de Brice' }
  let groupe
  if (decisions.exclure.includes(p.personne_id)) groupe = 'exclu'
  else if (equipe) groupe = 'equipe'
  else if (decisions.inclure.includes(p.personne_id)) {
    if (!epoque && epoqueProposee) { epoque = epoqueProposee; raison = `proposée par la date (${premiere}), validée par Brice` }
    if (!epoque) throw new Error(`inclusion sans epoque : ${p.personne_id}`)
    groupe = 'anciens'
  }
  else if (!epoque) groupe = epoqueProposee ? 'epoque-a-confirmer' : 'actuel'
  else if (!nom) groupe = 'sans-nom'
  else if (p.palier === 'trace') groupe = 'a-confirmer'
  else groupe = 'anciens'
  lignes.push({
    numero: equipe ? (decisions.equipe[p.personne_id] ?? DEJA_NUMEROTES.get(p.personne_id) ?? null) : null,
    groupe, epoque, raison_epoque: raison, epoque_proposee: epoqueProposee,
    personne_id: p.personne_id, nom: nom ?? `Sans nom (${p.nom})`, telegram: pseudo,
    nature: p.nature, palier: p.palier,
    premiere_activite: premiere, premiere_estimee: estimee, derniere_activite: jour(p.dernier),
    premiere_izitrade: izi,
    messages: p.messages ?? 0,
    ecosystemes: ecosAok, hors_perimetre: [...(ecosDe.get(p.personne_id) ?? [])].filter(e => !ECOS_AOK.includes(e)).sort(),
    fiche: p.membre_id ? { id: p.membre_id.slice(0, 8), confiance: p.confiance, lie_par: p.lie_par } : null,
    acces_learnybox: lb,
    a_un_telegram: p.tg.length > 0,
    compte_du_site: compteDuSite(p),
  })
}

// --- Les numeros : 21 et suivants, par anciennete ------------------------------
const anciens = lignes.filter(l => l.groupe === 'anciens')
  .sort((a, b) => (a.premiere_activite ?? '9999').localeCompare(b.premiere_activite ?? '9999') || b.messages - a.messages || a.nom.localeCompare(b.nom))
anciens.forEach((l, i) => { l.numero = PREMIER_NUMERO + i })
if (anciens.length && anciens[anciens.length - 1].numero > DERNIER_NUMERO) {
  throw new Error(`${anciens.length} anciens : la plage ${PREMIER_NUMERO}-${DERNIER_NUMERO} ne suffit pas`)
}
const parAnciennete = (a, b) => (a.premiere_activite ?? '9999').localeCompare(b.premiere_activite ?? '9999') || b.messages - a.messages || a.nom.localeCompare(b.nom)
const groupe = g => lignes.filter(l => l.groupe === g).sort(parAnciennete)

// --- Les noms cites par Brice ---------------------------------------------------
const CITES = [
  { cite: 'Marlon', id: 'p-marlon' },
  { cite: 'Wricka', id: null, note: 'Aucun nom, alias ni pseudo approchant dans l\'ontologie (recherche exacte, par similarité et par motif).' },
  { cite: 'Pierre', id: 'p-pierre-guirriec', note: 'Le seul Pierre élève des écosystèmes AOK (salon « Formation pierre », 2020).' },
  { cite: 'Philippe Lerjen', id: 'p-philippe-lerjen' },
  { cite: 'Armando', id: 'p-armando' },
  { cite: 'Didier', id: 'p-didier-vr' },
  { cite: 'Jules', id: 'p-jules-vital' },
  { cite: 'Joao', id: 'p-joao' },
].map(c => {
  const l = c.id ? lignes.find(x => x.personne_id === c.id) : null
  return { ...c, trouve: Boolean(l), nom: l?.nom ?? null, groupe: l?.groupe ?? null, numero: l?.numero ?? null, epoque: l?.epoque ?? null }
})

// --- Les comptes ---------------------------------------------------------------
const compter = (liste, cle) => liste.reduce((m, l) => (m[l[cle]] = (m[l[cle]] ?? 0) + 1, m), {})
const comptes = {
  numerotes: anciens.length,
  premier_numero: anciens[0]?.numero ?? null,
  dernier_numero: anciens.at(-1)?.numero ?? null,
  par_epoque: compter(anciens, 'epoque'),
  par_palier: compter(anciens, 'palier'),
  a_confirmer: groupe('a-confirmer').length,
  a_confirmer_par_epoque: compter(groupe('a-confirmer'), 'epoque'),
  epoque_a_confirmer: groupe('epoque-a-confirmer').length,
  sans_nom: groupe('sans-nom').length,
  exclus_par_brice: groupe('exclu').length,
  robots_retires: ROBOTS.size,
  equipe: groupe('equipe').length,
  actuels_hors_liste: groupe('actuel').length,
  comptes_du_site: compter(lignes.filter(l => l.compte_du_site && l.groupe !== 'equipe' && l.groupe !== 'actuel'), 'groupe'),
  liens_compte: compter(lignes.filter(l => l.compte_du_site && l.groupe !== 'equipe' && l.groupe !== 'actuel').map(l => ({ lien: l.compte_du_site.lien })), 'lien'),
}

const sortie = {
  genere_le: new Date().toISOString(),
  // Pose par decisions-brice.json ("valide_le": "AAAA-MM-JJ") une fois la liste validee : le script d'import l'exige.
  valide_le: decisions.valide_le ?? null,
  regles: { ecosystemes_aok: ECOS_AOK, natures_eleve: NATURES_ELEVE, natures_equipe: NATURES_EQUIPE, migration_skool: MIGRATION_SKOOL, plage: [PREMIER_NUMERO, DERNIER_NUMERO] },
  comptes, cites: CITES,
  anciens, a_confirmer: groupe('a-confirmer'), epoque_a_confirmer: groupe('epoque-a-confirmer'), sans_nom: groupe('sans-nom'),
  equipe: groupe('equipe'), exclus: groupe('exclu'),
}

mkdirSync(SORTIE, { recursive: true })
writeFileSync(join(SORTIE, 'liste-anciens-membres.json'), JSON.stringify(sortie, null, 2))
const { pageHtml } = await import('./lib-anciens-membres-page.mjs')
writeFileSync(join(SORTIE, 'liste-anciens-membres.html'), pageHtml(sortie))
console.log(JSON.stringify(comptes, null, 2))
console.log('cites :', CITES.map(c => `${c.cite} ${c.trouve ? `${c.groupe} n${c.numero ?? '-'}` : 'non trouve'}`).join(' | '))
console.log(`ecrit : ${SORTIE}/liste-anciens-membres.{json,html}`)
