/**
 * LA LISTE DES ANCIENS MEMBRES (09/11/2026, revue le 10/11), en LECTURE SEULE
 * depuis l'ontologie du cockpit. Produit la liste a valider par Brice :
 *   - un JSON (entree du script d'import, apres validation) ;
 *   - une page de relecture HTML (jamais du .md brut).
 *
 * Briefs : D:\7_Agents\briefs\2026-11-09-anciens-membres-numeros-annuaire.md
 *          D:\7_Agents\briefs\2026-11-10-statuts-anciens-eleves.md
 *
 * Regles :
 *   - perimetre : natures eleve, eleve-proche, mentore, presentes dans au moins
 *     un ecosysteme AOK (izimoney, aoknowledge, deep-knowledge, coaching,
 *     ligue-schlags, izi-gentleman, live-club), PLUS toute personne qui porte
 *     un statut d'ancien eleve paye (formation IziTrade, mentore IziTrade,
 *     KOFM, SMM, Deep Knowledge), quelle que soit sa nature ou le classement
 *     de son groupe (Djock, de nature « pair », Sebastien Picard, dont le
 *     groupe est classe « petit groupe ») ;
 *   - les statuts : lus dans cockpit_parcours une fois la migration
 *     20261110010000 appliquee, calcules ici sinon, avec la MEME
 *     correspondance groupe vers statut que la migration (GROUPES_STATUTS et
 *     EXCEPTIONS ci-dessous, a garder identiques au fichier SQL) ;
 *   - epoque, la plus ancienne des deux : IziTrade si un statut IziTrade ou
 *     une presence dans izimoney HORS des groupes SMM (« Formation Boris »,
 *     « Formation - Marco » sont de 2025, epoque LearnyBox) ; sinon LearnyBox
 *     si un statut KOFM, SMM ou Deep Knowledge, ou une presence dans
 *     aoknowledge ou deep-knowledge avant la migration Skool (11/09/2025), ou
 *     un acces premium-skool ou vip-skool sans fin ;
 *   - l'equipe et les associes : liste a part (numeros 5 a 20 choisis par
 *     Brice) ; « anciennete_depuis_equipe » les fait passer dans les anciens ;
 *   - palier trace : section « a confirmer », sans numero (sauf « inclure ») ;
 *   - numeros 30 et suivants par anciennete : la premiere activite DANS LES
 *     ECOSYSTEMES AOK (et les groupes a statut) la plus ancienne recoit le plus
 *     petit numero. Les inscrits suivront le dernier ancien, a l'import.
 *
 * Aucune adresse email ni aucun telephone n'est ecrit : les adresses servent
 * seulement, en memoire, a dire si un compte du site correspond deja.
 *
 * Lancement (depuis apps/journal-d-etude ou son worktree) :
 *   node --env-file=.env.local scripts/lister-anciens-membres.mjs [--sortie <dossier>]
 * Sortie par defaut : /mnt/d/6_Societe/Pilotage/Academie/anciens-membres/
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
/** Brice, 10/11 : les anciens a partir de 30 ; les inscrits juste apres le dernier ancien. */
const PREMIER_NUMERO = 30
/** Les numeros deja portes par un compte de l'equipe (Brice 1, Melanie 2, Adil 3, Adrien 4 ; confirme le 09/11 au soir). */
const DEJA_NUMEROTES_DEFAUT = { 'p-melanie': 2, 'p-adil-belka': 3, 'p-adrien-pacheco': 4 }
const NOMS_ECOS = {
  izimoney: 'IziMoney / IziTrade', aoknowledge: 'AOKnowledge', 'deep-knowledge': 'Deep Knowledge', coaching: 'Coachings',
  'ligue-schlags': 'Ligue des Schlags', 'izi-gentleman': 'Izi Gentleman', 'live-club': 'Live Club',
}

// --- LES STATUTS : miroir EXACT de la migration 20261110010000 -----------------
// Tant que la migration n'est pas appliquee, la liste les calcule ici. Apres,
// elle les lit en base (la correspondance peut alors avoir ete corrigee par
// l'equipe : c'est la base qui fait foi).
export const STATUTS = {
  'formation-izitrade': { libelle: 'Formation IziTrade', epoque: 'izitrade', ordre: 10 },
  'mentore-izitrade': { libelle: 'Mentoré IziTrade', epoque: 'izitrade', ordre: 20 },
  kofm: { libelle: 'KOFM', epoque: 'learnybox', ordre: 30 },
  smm: { libelle: 'SMM', epoque: 'learnybox', ordre: 40 },
  'deep-knowledge': { libelle: 'Deep Knowledge', epoque: 'learnybox', ordre: 50 },
  etm: { libelle: 'ETM', epoque: null, ordre: 60 },
}
export const GROUPES_STATUTS = {
  434741904: 'formation-izitrade', 384264573: 'formation-izitrade', 410716980: 'formation-izitrade', 387371690: 'formation-izitrade',
  439361798: 'formation-izitrade', 314805078: 'formation-izitrade', 362250966: 'formation-izitrade', 439174417: 'formation-izitrade',
  306257036: 'formation-izitrade', 421640159: 'formation-izitrade', 494609093: 'formation-izitrade', 425012734: 'formation-izitrade',
  365011472: 'formation-izitrade', 533293289: 'formation-izitrade', 581983157: 'formation-izitrade', 685907178: 'formation-izitrade',
  692320124: 'formation-izitrade', 430681511: 'formation-izitrade',
  418459990: 'mentore-izitrade',
  862434051: 'kofm', 4044093752: 'kofm', 1944899425: 'kofm', 972209243: 'kofm', 973729847: 'kofm', 940164805: 'kofm',
  4655997578: 'smm', 4604991883: 'smm', 4695064831: 'smm',
  1675620238: 'deep-knowledge',
}
export const EXCEPTIONS = [
  { personne_id: 'p-mehdi-chergui', statut: 'formation-izitrade', salon_id: null, effet: 'exclure' },
  { personne_id: 'p-mehdi-chergui', statut: 'mentore-izitrade', salon_id: null, effet: 'exclure' },
  { personne_id: 'p-adrien-pacheco', statut: 'kofm', salon_id: null, effet: 'exclure' },
  { personne_id: 'p-marco', statut: 'smm', salon_id: '4655997578', effet: 'paiement_incomplet' },
]
const SALONS_STATUTS = Object.keys(GROUPES_STATUTS)
/** Les groupes d'epoque LearnyBox : une presence izimoney DANS ces groupes ne fait pas un ancien d'IziTrade. */
const SALONS_LEARNYBOX = new Set(SALONS_STATUTS.filter(s => STATUTS[GROUPES_STATUTS[s]].epoque === 'learnybox'))

// --- LES ETM DOCUMENTES (10/11/2026), a valider par Brice ------------------------
// Sources : D:\6_Societe\Pilotage\registre-identites.md (« registre »),
// D:\6_Societe\Pilotage\coachings-a-relancer-2026-11-06.md (« coachings du 06/11 »),
// D:\6_Societe\Pilotage\suivi-eleves.md (« suivi des eleves »), les fiches
// D:\1_Ecriture\Systeme\archives-anciens-textes\chatgpt\eleves\*.md (« archive ChatGPT »)
// et le statut ETM du cockpit (cockpit_statut_etm, sur une fiche client).
// L'import ne les ecrit qu'avec "etm_valide_le" dans decisions-brice.json.
export const ETM_DOCUMENTES = [
  {
    personne_id: 'p-melanie', nom: 'Mélanie Sommer', periode: 'juin 2024 → avril 2025', depuis: '2024-06-01',
    sources: ['suivi des élèves, anciens mentorats : « ETM juin 2024 → »', 'coachings du 06/11 : « ETM 2024, aujourd’hui associée »', 'archive ChatGPT melanie.md : ETM juin 2024 → 2025'],
    identification: 'Registre : p-melanie, associée principale.',
  },
  {
    personne_id: 'p-manon-meyer', nom: 'Manon Meyer', periode: 'septembre → octobre 2024', depuis: '2024-09-01',
    sources: ['registre : « ETM septembre → octobre 2024 »', 'suivi des élèves, anciens mentorats', 'coachings du 06/11 : ETM 2024 fini', 'archive ChatGPT manon.md'],
    identification: 'Registre : p-manon-meyer (alias Astra, AstraFX).',
  },
  {
    personne_id: 'p-corentin', nom: 'Corentin Leclerc', periode: 'octobre 2024 → avril 2025', depuis: '2024-10-01',
    sources: ['statut ETM du cockpit, sur sa fiche client (posé le 14/09/2026)', 'suivi des élèves : ETM oct. 2024 → avril 2025', 'archive ChatGPT corentin.md', 'Brice, 09/11/2026 : « Laisse Corentin en ETM »'],
    identification: 'Premier message Telegram le 08/10/2024, début de l’ETM en octobre 2024. Sa fiche client (prénom Corentin, statut ETM) n’est pas encore reliée à cette personne des archives : lien à poser à la main dans la fiche.',
    note: 'ETM confirmé par Brice le 09/11/2026. Sa note de relecture parlait d’un mentorat de 6 mois et du 10% Club : le 10% Club reste dans ses droits, en plus de l’ETM.',
  },
  {
    personne_id: 'p-seif-scalp-andrieux', nom: 'Benjamin Andrieux', periode: 'avril → automne 2025', depuis: '2025-04-01',
    sources: ['coachings du 06/11 : dossier ETM « Benjamin Andrieux » sur le Drive, dernier coaching le 21/07/2025', 'registre : « Élève, mentoré ETM »', 'suivi des élèves : Benjamin, ETM avril → oct. 2025', 'archive ChatGPT benjamin.md'],
    identification: 'Rapproché avec prudence : le compte Telegram « Seif_scalp Andrieux » porte le même nom de famille que le dossier ETM du Drive, le registre de Brice le dit « mentoré ETM », il écrit du 04/04/2025 (l’ETM démarre fin avril 2025) au 29/03/2026, la date exacte du dernier échange Telegram relevé pour Benjamin Andrieux le 06/11. Le prénom n’apparaît nulle part dans le fonds.',
  },
  {
    personne_id: 'p-boris-fchrt', nom: 'Boris Fauchart', periode: 'décembre 2025 → mars 2026', depuis: '2025-12-01',
    sources: ['statut ETM du cockpit, sur sa fiche client (posé le 14/09/2026)', 'suivi des élèves : coachings ETM de janvier à mars 2026', 'archive ChatGPT boris.md'],
    identification: 'Personne des archives liée à sa fiche par le nom affiché (lien probable).',
  },
  {
    personne_id: 'p-yassine', nom: 'Yassine Zouari', periode: 'décembre 2025 → (cycles en 2026)', depuis: '2025-12-01',
    sources: ['statut ETM du cockpit, sur sa fiche client (posé le 14/09/2026)', 'coachings du 06/11 : nouveau cycle ouvert le 23/04/2026', 'archive ChatGPT yassine.md'],
    identification: 'Personne des archives liée à sa fiche par le nom (lien probable).',
  },
  {
    personne_id: 'p-florent', nom: 'Florent Soriano', periode: 'janvier 2026 →', depuis: '2026-01-01',
    sources: ['coachings du 06/11 : « ETM (4 000 EUR pour 3 mois en 3 mensualités, ouvert le 13/01) »', 'suivi des élèves : coachings ETM de 2026', 'archive ChatGPT florent.md, titrée « Florent (Soriano) »'],
    identification: 'Rapproché avec prudence : l’entrée du registre p-florent (posée par Brice, nature mentoré) renvoie à la fiche florent.md, titrée « Florent (Soriano) » ; son compte Telegram écrit à partir du 04/02/2026, l’ETM ouvre le 13/01/2026. L’autre Florent du fonds (p-florent-lopez, 5 messages en 2021) ne correspond pas. Le registre rappelle qu’une entrée au prénom seul peut viser le mauvais compte.',
  },
  {
    personne_id: 'p-cedric-rizello', nom: 'Cédric Rizzello', periode: 'fin avril 2026 →', depuis: '2026-04-01',
    sources: ['registre : « Élève proche et mentoré ETM »', 'coachings du 06/11 : ETM ouvert fin avril 2026', 'archive ChatGPT cedric.md : ETM lancé fin avril 2026'],
    identification: 'Deux comptes dans le fonds : p-cedric-rizello (le principal, 1 794 messages) et p-cedric-rizzello (une trace). Le registre les dit à fusionner : le statut se pose sur le principal.',
  },
  {
    personne_id: 'p-guillaume-curial', nom: 'Guillaume Curial', periode: 'décembre 2025 →', depuis: '2025-12-01',
    sources: ['coachings du 06/11 : « ETM (mentorat, dossier ETM du Drive) »', 'archive ChatGPT guillaume.md : accompagnement décembre 2025 → février 2026'],
    identification: 'Registre : p-guillaume-curial, aussi membre de l’équipe (n° 9).',
  },
]
/** Cites dans les sources mais pas retenus : pas de preuve d'un ETM. */
export const ETM_NON_RETENUS = [
  { nom: 'Djibril', raison: 'Sorti de la liste des suivis le 11/06, aucune source ne le dit ETM, aucune trace retrouvée le 06/11.' },
  { nom: 'Thomas Falzon, Célia Dutoit', raison: 'Coachings ponctuels. « Coaching ETM » n’est que le titre automatique des notes Gemini.' },
  { nom: 'Hamdi', raison: 'Suivi communautaire en 2025, pas un ETM.' },
]

/** Les droits dits par Brice (decisions-brice.json, « droits ») : leur offre de l'academie. */
export const DROITS_OFFRES = { '10% club': 'formation-complete', vip: 'vip-skool', 'live club': 'live-club', etm: 'etm' }

/** Les corrections d'identite dites par Brice, portees en base par l'import. */
export const CORRECTIONS_NOMS = {
  'p-marlon': { nom: 'Marlon Wricka', alias: ['Marlon Wricka', 'Wricka'], dit: 'Brice, 09/11/2026 : « wricka c’est le nom de famille de Marlon »' },
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

/** Les statuts calcules depuis les presences, comme cockpit_parcours_calcul(). */
function calculerStatuts(presences) {
  const exclu = (pid, st, salon) => EXCEPTIONS.some(e => e.effet === 'exclure' && e.personne_id === pid && e.statut === st && (e.salon_id == null || e.salon_id === salon))
  const incomplet = (pid, st, salon) => EXCEPTIONS.some(e => e.effet === 'paiement_incomplet' && e.personne_id === pid && e.statut === st && (e.salon_id == null || e.salon_id === salon))
  const out = []
  for (const pr of presences) {
    const st = GROUPES_STATUTS[pr.salon_id]
    if (!st || exclu(pr.personne_id, st, pr.salon_id)) continue
    out.push({
      personne_id: pr.personne_id, statut: st, source: 'archives', salon_id: pr.salon_id, detail: pr.salon_nom,
      depuis: jour(pr.entree) ?? jour(pr.salon_premier), depuis_estime: !pr.entree, paiement_incomplet: incomplet(pr.personne_id, st, pr.salon_id),
    })
  }
  return out
}

// --- Les decisions de Brice (apres relecture) ---------------------------------
// Fichier decisions-brice.json a cote de la liste :
//   exclure, inclure, epoque, equipe ({ "p-...": 5 a 20 }), deja_numerotes
//   ({ "p-...": 3 } : un compte de l'equipe qui garde son numero), notes,
//   anciennete_depuis_equipe (un associe qui prend un numero d'ancien),
//   sans_droits, droits ({ "p-...": ["10% Club", "VIP", "Live Club"] }),
//   a_trancher (tant qu'il n'est pas vide, l'import refuse), valide_le,
//   etm_valide_le (la liste ETM ci-dessus validee : l'import l'ecrit alors).
let decisions = {
  exclure: [], inclure: [], epoque: {}, equipe: {}, deja_numerotes: {}, notes: {}, anciennete_depuis_equipe: [],
  sans_droits: [], droits: {}, a_trancher: {},
}
try {
  decisions = { ...decisions, ...JSON.parse(readFileSync(join(SORTIE, 'decisions-brice.json'), 'utf8')) }
  console.log('decisions de Brice lues :', JSON.stringify({
    exclure: decisions.exclure.length, inclure: decisions.inclure.length, epoque: Object.keys(decisions.epoque).length,
    equipe: Object.keys(decisions.equipe).length, deja_numerotes: Object.keys(decisions.deja_numerotes).length,
    notes: Object.keys(decisions.notes).length, sans_droits: decisions.sans_droits.length, droits: Object.keys(decisions.droits).length,
    a_trancher: Object.keys(decisions.a_trancher).length, valide_le: decisions.valide_le ?? null, etm_valide_le: decisions.etm_valide_le ?? null,
  }))
} catch { /* pas encore de decisions */ }
for (const [id, n] of Object.entries(decisions.equipe)) {
  if (!(Number.isInteger(n) && n >= 5 && n <= 20)) throw new Error(`numero d'equipe hors de 5-20 : ${id} ${n}`)
}
if (new Set(Object.values(decisions.equipe)).size !== Object.keys(decisions.equipe).length) throw new Error('deux personnes de l equipe ont le meme numero')
const DEJA_NUMEROTES = new Map(Object.entries({ ...DEJA_NUMEROTES_DEFAUT, ...decisions.deja_numerotes }))
for (const [id, n] of DEJA_NUMEROTES) {
  if (!(Number.isInteger(n) && n >= 1 && n <= 4)) throw new Error(`numero deja porte hors de 1-4 : ${id} ${n}`)
  if (Object.values(decisions.equipe).includes(n)) throw new Error(`le numero ${n} est a la fois deja porte et donne a l equipe`)
}
for (const [id, liste] of Object.entries(decisions.droits)) {
  for (const d of liste) if (!DROITS_OFFRES[String(d).trim().toLowerCase()]) throw new Error(`droit inconnu pour ${id} : ${d}`)
}

// --- La lecture, en une transaction en lecture seule --------------------------
const prisma = new PrismaClient(process.env.DIRECT_URL ? { datasourceUrl: process.env.DIRECT_URL } : undefined)
class Fin extends Error {}
let brut
try {
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(`set transaction read only`)
    await tx.$executeRawUnsafe(`set local statement_timeout = '60s'`)
    const q = (sql, ...p) => tx.$queryRawUnsafe(sql, ...p)
    const enBase = (await q(`select to_regclass('public.cockpit_parcours') is not null as la`))[0].la
    const presStatuts = await q(`
      select pr.personne_id, pr.salon_id, s.nom as salon_nom, pr.entree, s.premier as salon_premier
        from public.cockpit_arch_presences pr join public.cockpit_arch_salons s on s.salon_id = pr.salon_id
       where pr.salon_id = any($1::text[])`, SALONS_STATUTS)
    const statuts = enBase
      ? await q(`select p.personne_id, p.statut, p.source, p.salon_id, p.source_detail as detail, p.depuis, p.depuis_estime, p.paiement_incomplet
            from public.cockpit_parcours p where p.retire_le is null`)
      : calculerStatuts(presStatuts)
    const avecStatut = [...new Set(statuts.filter(s => s.statut !== 'etm').map(s => s.personne_id))]
    brut = {
      statuts_en_base: enBase,
      statuts: statuts.map(s => ({ ...s, depuis: jour(s.depuis) })),
      pres_statuts: presStatuts,
      personnes: await q(`
        select p.personne_id, p.nom, p.alias, p.nom_est_identifiant, p.telegram, p.nature, p.palier, p.premier, p.dernier, p.messages,
               coalesce(p.tg_ids::text[], '{}') as tg,
               mt.membre_id::text as membre_id, mt.membre_confiance as confiance, mt.membre_lie_par as lie_par
          from public.cockpit_arch_personnes p
          left join public.cockpit_membre_telegram mt on mt.personne_id = p.personne_id
         where (p.nature = any($1::text[]) and exists (
           select 1 from public.cockpit_arch_presences pr join public.cockpit_arch_salons s on s.salon_id = pr.salon_id
            where pr.personne_id = p.personne_id and s.ecosysteme = any($2::text[])))
            or p.personne_id = any($3::text[])
            or p.personne_id = any($4::text[])`,
        [...NATURES_ELEVE, ...NATURES_EQUIPE], ECOS_AOK, avecStatut, ETM_DOCUMENTES.map(e => e.personne_id)),
      presences: await q(`
        select pr.personne_id, pr.salon_id, s.ecosysteme, pr.entree, pr.entree_source, pr.messages, s.premier as salon_premier,
               (select min(pa.dit_le) from public.cockpit_arch_paroles pa where pa.personne_id = pr.personne_id and pa.salon_id = pr.salon_id) as parole
          from public.cockpit_arch_presences pr join public.cockpit_arch_salons s on s.salon_id = pr.salon_id
         where s.ecosysteme is not null or pr.salon_id = any($1::text[])`, SALONS_STATUTS),
      acces: await q(`
        select distinct e.membre_id::text as membre_id, o.slug
          from public.academie_acces a join public.academie_offres o on o.id = a.offre_id
          join public.cockpit_membre_emails e on lower(e.email) = lower(a.email)
         where a.retire_le is null and a.fin is null and o.slug in ('premium-skool', 'vip-skool')`),
      etm_fiches: await q(`
        select distinct mt.personne_id
          from public.cockpit_statut_etm e join public.cockpit_membre_telegram mt on mt.membre_id = e.membre_id
         where e.retire_le is null`),
      etm_fiches_sans_lien: Number((await q(`
        select count(*) as n from public.cockpit_statut_etm e
         where e.retire_le is null and not exists (select 1 from public.cockpit_membre_telegram mt where mt.membre_id = e.membre_id)`))[0].n),
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

// --- Les statuts, par personne ------------------------------------------------
const statutsDe = new Map()
for (const s of brut.statuts) {
  if (!statutsDe.has(s.personne_id)) statutsDe.set(s.personne_id, [])
  statutsDe.get(s.personne_id).push(s)
}
/** Une ligne par statut : le statut, ses groupes, la premiere date, paiement non termine si tous ses groupes le disent. */
function resumeStatuts(pid) {
  const parStatut = new Map()
  for (const s of statutsDe.get(pid) ?? []) {
    if (!parStatut.has(s.statut)) parStatut.set(s.statut, [])
    parStatut.get(s.statut).push(s)
  }
  return [...parStatut.entries()]
    .sort((a, b) => (STATUTS[a[0]]?.ordre ?? 99) - (STATUTS[b[0]]?.ordre ?? 99))
    .map(([statut, l]) => ({
      statut, libelle: STATUTS[statut]?.libelle ?? statut,
      groupes: [...new Set(l.map(x => x.detail).filter(Boolean))],
      depuis: l.reduce((m, x) => minJour(m, x.depuis), null),
      paiement_incomplet: l.every(x => x.paiement_incomplet),
    }))
}

// --- Les presences, par personne ---------------------------------------------
const presencesDe = new Map()
const ecosDe = new Map()
for (const pr of brut.presences) {
  if (pr.ecosysteme) {
    if (!ecosDe.has(pr.personne_id)) ecosDe.set(pr.personne_id, new Set())
    ecosDe.get(pr.personne_id).add(pr.ecosysteme)
  }
  if (!ECOS_AOK.includes(pr.ecosysteme) && !GROUPES_STATUTS[pr.salon_id]) continue
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

function compteDuSite(p, nom) {
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
  const cle = cleNom(nom)
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
  // Les corrections dites par Brice, tant qu'elles ne sont pas en base.
  if (CORRECTIONS_NOMS[p.personne_id]) nom = CORRECTIONS_NOMS[p.personne_id].nom
  return { nom, pseudo }
}

/** Robots vus dans les groupes, classes eleve par l'ontologie : jamais un ancien membre. */
const ROBOTS = new Set(['p-group-butler'])
/** Une personne qui n'est pas un humain eleve (le canal « FORMATION BRICE », source suivie). */
const NATURES_HORS = new Set(['source-suivie'])

/** Avant le premier salon Deep Knowledge (28/02/2022) : l'epoque IziTrade, sinon LearnyBox. Une PROPOSITION, jamais appliquee sans Brice. */
const DEBUT_DEEP_KNOWLEDGE = '2022-02-28'
const etmPersonnes = new Set(brut.etm_fiches.map(x => x.personne_id))

// --- Une ligne par personne ----------------------------------------------------
const lignes = []
for (const p of brut.personnes) {
  if (ROBOTS.has(p.personne_id) || NATURES_HORS.has(p.nature)) continue
  const pres = presencesDe.get(p.personne_id) ?? []
  const sts = resumeStatuts(p.personne_id)
  const epoquesStatut = new Set(sts.map(s => STATUTS[s.statut]?.epoque).filter(Boolean))
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
    if (ECOS_LEARNYBOX.includes(pr.ecosysteme) || SALONS_LEARNYBOX.has(pr.salon_id)) premiereLB = minJour(premiereLB, d)
    if (pr.ecosysteme === 'izimoney' && !SALONS_LEARNYBOX.has(pr.salon_id)) izi = minJour(izi, d)
  }
  const ecosAok = [...new Set(pres.map(x => x.ecosysteme).filter(e => ECOS_AOK.includes(e)))].sort((a, b) => ECOS_AOK.indexOf(a) - ECOS_AOK.indexOf(b))
  const lb = p.membre_id ? [...(acces.get(p.membre_id) ?? [])] : []
  let epoque = null
  let raison = null
  if (izi) { epoque = 'izitrade'; raison = `IziMoney / IziTrade dès ${izi}` }
  else if (epoquesStatut.has('izitrade')) { epoque = 'izitrade'; raison = `statut ${sts.filter(s => STATUTS[s.statut]?.epoque === 'izitrade').map(s => s.libelle).join(', ')}` }
  else if (epoquesStatut.has('learnybox')) { epoque = 'learnybox'; raison = `statut ${sts.filter(s => STATUTS[s.statut]?.epoque === 'learnybox').map(s => s.libelle).join(', ')}` }
  else if (premiereLB && premiereLB < MIGRATION_SKOOL) { epoque = 'learnybox'; raison = `${ecosAok.filter(e => ECOS_LEARNYBOX.includes(e)).map(e => NOMS_ECOS[e]).join(', ')} dès ${premiereLB}` }
  else if (lb.length) { epoque = 'learnybox'; raison = `accès ${lb.join(', ')} sans fin` }
  const { nom, pseudo } = nomEtPseudo(p)
  const versAnciens = decisions.anciennete_depuis_equipe.includes(p.personne_id)
  const equipe = NATURES_EQUIPE.includes(p.nature) && !versAnciens
  let epoqueProposee = null
  if (!epoque && premiere && premiere < MIGRATION_SKOOL) epoqueProposee = premiere < DEBUT_DEEP_KNOWLEDGE ? 'izitrade' : 'learnybox'
  if (decisions.epoque[p.personne_id]) { epoque = decisions.epoque[p.personne_id]; raison = 'choix de Brice' }
  // Dans la liste : un statut d'ancien eleve paye, ou la regle d'origine (nature d'eleve ET un groupe AOK).
  const enPerimetre = sts.some(s => s.statut !== 'etm')
    || ((NATURES_ELEVE.includes(p.nature) || NATURES_EQUIPE.includes(p.nature)) && ecosAok.length > 0)
  let groupe
  if (decisions.exclure.includes(p.personne_id)) groupe = 'exclu'
  else if (equipe) groupe = 'equipe'
  else if (decisions.inclure.includes(p.personne_id) || versAnciens) {
    if (!epoque && epoqueProposee) { epoque = epoqueProposee; raison = `proposée par la date (${premiere}), validée par Brice` }
    if (!epoque) throw new Error(`inclusion sans epoque : ${p.personne_id}`)
    groupe = 'anciens'
  }
  else if (!enPerimetre) groupe = 'actuel'
  else if (!epoque) groupe = epoqueProposee ? 'epoque-a-confirmer' : 'actuel'
  else if (!nom) groupe = 'sans-nom'
  else if (p.palier === 'trace') groupe = 'a-confirmer'
  else groupe = 'anciens'
  const droitsBrice = (decisions.droits[p.personne_id] ?? []).map(d => DROITS_OFFRES[String(d).trim().toLowerCase()])
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
    compte_du_site: compteDuSite(p, nom),
    statuts: sts,
    etm_fiche: etmPersonnes.has(p.personne_id),
    deja_numerote: DEJA_NUMEROTES.has(p.personne_id) && !decisions.equipe[p.personne_id],
    sans_droits: decisions.sans_droits.includes(p.personne_id),
    droits_brice: droitsBrice,
    note_brice: decisions.notes[p.personne_id] ?? null,
    a_trancher: decisions.a_trancher[p.personne_id] ?? null,
    anciennete_depuis_equipe: versAnciens,
  })
}

// --- Les numeros : 30 et suivants, par anciennete ------------------------------
const parAnciennete = (a, b) => (a.premiere_activite ?? '9999').localeCompare(b.premiere_activite ?? '9999') || b.messages - a.messages || a.nom.localeCompare(b.nom)
const anciens = lignes.filter(l => l.groupe === 'anciens').sort(parAnciennete)
anciens.forEach((l, i) => { l.numero = PREMIER_NUMERO + i })
const groupe = g => lignes.filter(l => l.groupe === g).sort(parAnciennete)

// --- Les ETM documentes ----------------------------------------------------------
const ligneDe = new Map(lignes.map(l => [l.personne_id, l]))
const connus = new Set(brut.personnes.map(p => p.personne_id))
const etm = ETM_DOCUMENTES.map(e => {
  const l = ligneDe.get(e.personne_id)
  return {
    ...e,
    dans_le_fonds: connus.has(e.personne_id),
    etm_fiche: etmPersonnes.has(e.personne_id),
    numero: l?.numero ?? null, groupe: l?.groupe ?? null,
    etat: e.personne_id === 'p-corentin' ? 'confirme-par-brice' : etmPersonnes.has(e.personne_id) ? 'deja-sur-la-fiche' : 'a-poser',
  }
})

// --- Les noms cites par Brice ---------------------------------------------------
const CITES = [
  { cite: 'Marlon', id: 'p-marlon', note: 'Nom de famille Wricka (Brice, 09/11) : « Marlon Wricka », note d’identité portée en base par l’import.' },
  { cite: 'Wricka', id: 'p-marlon', note: 'C’est Marlon : « wricka c’est le nom de famille de Marlon » (Brice, 09/11).' },
  { cite: 'Pierre', id: 'p-pierre-guirriec', note: 'Le seul Pierre élève des écosystèmes AOK (salon « Formation pierre », 2020).' },
  { cite: 'Philippe Lerjen', id: 'p-philippe-lerjen' },
  { cite: 'Armando', id: 'p-armando' },
  { cite: 'Didier', id: 'p-didier-vr' },
  { cite: 'Jules', id: 'p-jules-vital' },
  { cite: 'Joao', id: 'p-joao' },
  { cite: 'Djock', id: 'p-abdourahmane-djock', note: 'Nature « pair » dans l’ontologie : il manquait, il entre par ses statuts Deep Knowledge et KOFM.' },
  { cite: 'Sébastien Picard', id: 'p-sebastien-picard', note: 'Son groupe « Sébastien - Formation » était classé petit groupe : il entre par son statut SMM.' },
  { cite: 'Manon Meyer', id: 'p-manon-meyer', note: 'ETM septembre → octobre 2024 (registre) : dans la liste ETM ci-dessous.' },
].map(c => {
  const l = c.id ? ligneDe.get(c.id) : null
  return { ...c, trouve: Boolean(l), nom: l?.nom ?? null, groupe: l?.groupe ?? null, numero: l?.numero ?? null, epoque: l?.epoque ?? null }
})

// --- Ce qui change par rapport a la liste precedente ---------------------------
let difference = null
const fichierJson = join(SORTIE, 'liste-anciens-membres.json')
if (existsSync(fichierJson)) {
  try {
    const avant = JSON.parse(readFileSync(fichierJson, 'utf8'))
    const idsAvant = new Set((avant.anciens ?? []).map(l => l.personne_id))
    const idsApres = new Set(anciens.map(l => l.personne_id))
    difference = {
      liste_du: avant.genere_le ?? null,
      entres: anciens.filter(l => !idsAvant.has(l.personne_id)).map(l => l.personne_id),
      sortis: [...idsAvant].filter(id => !idsApres.has(id)),
      epoque_changee: anciens.filter(l => { const a = (avant.anciens ?? []).find(x => x.personne_id === l.personne_id); return a && a.epoque !== l.epoque }).map(l => l.personne_id),
    }
  } catch { /* liste precedente illisible : pas de difference */ }
}

// --- Les comptes ---------------------------------------------------------------
const compter = (liste, cle) => liste.reduce((m, l) => (m[l[cle]] = (m[l[cle]] ?? 0) + 1, m), {})
const personnesParStatut = {}
for (const [pid, l] of statutsDe) {
  for (const st of new Set(l.map(x => x.statut))) (personnesParStatut[st] ??= new Set()).add(pid)
}
const comptes = {
  numerotes: anciens.length,
  premier_numero: anciens[0]?.numero ?? null,
  dernier_numero: anciens.at(-1)?.numero ?? null,
  premier_inscrit: (anciens.at(-1)?.numero ?? PREMIER_NUMERO - 1) + 1,
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
  statuts_source: brut.statuts_en_base ? 'base (cockpit_parcours)' : 'calcul du script (miroir de la migration)',
  personnes_par_statut: Object.fromEntries(Object.keys(STATUTS).filter(s => personnesParStatut[s]).map(s => [s, personnesParStatut[s].size])),
  paiement_incomplet: lignes.filter(l => l.statuts.some(s => s.paiement_incomplet)).map(l => l.personne_id),
  etm_documentes: etm.length,
  etm_fiches_sans_lien: brut.etm_fiches_sans_lien,
  a_trancher: Object.keys(decisions.a_trancher).length,
}

const sortie = {
  genere_le: new Date().toISOString(),
  // Pose par decisions-brice.json ("valide_le": "AAAA-MM-JJ") une fois la liste validee : le script d'import l'exige.
  valide_le: decisions.valide_le ?? null,
  etm_valide_le: decisions.etm_valide_le ?? null,
  a_trancher: decisions.a_trancher,
  regles: {
    ecosystemes_aok: ECOS_AOK, natures_eleve: NATURES_ELEVE, natures_equipe: NATURES_EQUIPE, migration_skool: MIGRATION_SKOOL,
    premier_numero: PREMIER_NUMERO, inscrits: 'juste après le dernier ancien', deja_numerotes: Object.fromEntries(DEJA_NUMEROTES),
  },
  comptes, cites: CITES, difference,
  anciens, a_confirmer: groupe('a-confirmer'), epoque_a_confirmer: groupe('epoque-a-confirmer'), sans_nom: groupe('sans-nom'),
  equipe: groupe('equipe'), exclus: groupe('exclu'),
  etm, etm_non_retenus: ETM_NON_RETENUS,
  corrections: Object.entries(CORRECTIONS_NOMS).map(([personne_id, c]) => ({ personne_id, ...c })),
}

mkdirSync(SORTIE, { recursive: true })
writeFileSync(fichierJson, JSON.stringify(sortie, null, 2))
const { pageHtml } = await import('./lib-anciens-membres-page.mjs')
writeFileSync(join(SORTIE, 'liste-anciens-membres.html'), pageHtml(sortie))
console.log(JSON.stringify(comptes, null, 2))
if (difference) console.log('difference avec la liste precedente :', JSON.stringify({ entres: difference.entres.length, sortis: difference.sortis.length, epoque_changee: difference.epoque_changee.length }))
console.log('cites :', CITES.map(c => `${c.cite} ${c.trouve ? `${c.groupe} n${c.numero ?? '-'}` : 'non trouve'}`).join(' | '))
console.log(`ecrit : ${SORTIE}/liste-anciens-membres.{json,html}`)
