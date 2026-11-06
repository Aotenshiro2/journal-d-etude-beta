// L'API DE TAB : la lecture INSTAGRAM, partie SERVEUR (05/11/2026, note de Tab 60478b43).
// Lit, dans la transaction READ ONLY de la route, ce que collect_meta.py range ; les calculs
// sont dans instagram-pur.ts. Branche dans /reseaux (lectures.ts, reseaux()).

import type { Ctx } from '@/lib/tab/lectures'
import { decalerJour, jourLisible } from '@/lib/tab/pur'
import {
  bilanPeriode, COMMENT_LIRE, dernierJourComplet, enBref, GRILLE_LECTURE, lirePublication, messagesApres, nbJours,
  niveauxBilan, nombre, PAS_DANS_L_API, periodeMesuree, reperesLisibles, type JourIG, type Objectif, type PubIG, type Reperes,
} from '@/lib/tab/instagram-pur'

const H = (col: string) => `to_char(${col} at time zone 'Europe/Paris', 'YYYY-MM-DD HH24:MI')`
const D = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`
const JP = (col: string) => `(${col} at time zone 'Europe/Paris')::date`

async function q<T>(c: Ctx, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await c.tx.$queryRawUnsafe<T[]>(sql, ...params)
  return JSON.parse(JSON.stringify(r, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))) as T[]
}

const COLONNES_PUB = `publication_id, ${H('publie_le')} as publie_le, type, left(legende, 200) as legende, lien,
  j_aime, commentaires, partages, enregistrements, couverture, vues, metriques`

/**
 * Le bloc Instagram de /reseaux. null si le compte n'est pas encore collecte. Les notes
 * (periode reculee au dernier jour complet...) s'ajoutent a `notes`.
 */
export async function lectureInstagram(c: Ctx, notes: string[]): Promise<Record<string, unknown> | null> {
  const p = c.periode
  const [compte] = await q<{ compte_id: string; pseudo: string | null; abonnes: number | null; reperes: Reperes | null; releve_le: string }>(c, `
    select compte_id, pseudo, abonnes, details -> 'reperes' as reperes, ${H('maj_le')} as releve_le
    from public.cockpit_social_comptes where plateforme = 'instagram' order by maj_le desc limit 1`)
  if (!compte) return null
  const n = nbJours(p.du, p.au)
  const jours = await q<JourIG>(c, `
    select ${D('jour')} as jour, abonnes, nouveaux_abonnes, desabonnes, vues, visites_profil, interactions, metriques
    from public.cockpit_social_jour where plateforme = 'instagram' and compte_id = $1
      and jour between $2::date and $3::date order by jour`,
  compte.compte_id, decalerJour(p.du, -n - 3), decalerJour(p.au, 1))
  const complet = dernierJourComplet(jours)
  const lu = periodeMesuree(p.du, p.au, complet)
  if (lu.reculee && complet) {
    notes.push(`Instagram lu du ${jourLisible(lu.du)} au ${jourLisible(lu.au)} (${n} jours) : Meta livre ses chiffres avec 1 à 2 jours de retard, le ${jourLisible(complet)} est le dernier jour complet.`)
  }
  const actuelle = bilanPeriode(jours, lu.du, lu.au)
  const precedente = bilanPeriode(jours, decalerJour(lu.du, -n), decalerJour(lu.du, -1))
  if (actuelle.comptes_touches_uniques === null) {
    notes.push('Instagram : les comptes touchés UNIQUES n\'existent que sur 7 ou 30 jours (Meta) ; pour une autre durée, rien n\'est additionné jour par jour (une personne vue deux jours compterait deux fois).')
  }

  const pubs = await q<PubIG>(c, `
    select ${COLONNES_PUB} from public.cockpit_social_publications
    where plateforme = 'instagram' and type <> 'STORY' and ${JP('publie_le')} between $1::date and $2::date
    order by publie_le desc limit $3`, p.du, p.au, c.pag.limite)
  const avant = pubs.length ? [] : await q<PubIG>(c, `
    select ${COLONNES_PUB} from public.cockpit_social_publications
    where plateforme = 'instagram' and type <> 'STORY' and publie_le is not null order by publie_le desc limit 3`)
  // L'objectif choisi a la main dans le cockpit (geste humain, migration 20261105200000).
  // Table absente : on le sait AVANT de la lire (une erreur casserait la transaction de la route).
  let objectifs: Record<string, Objectif> = {}
  const [existe] = await q<{ ok: boolean }>(c, `select to_regclass('public.cockpit_social_objectifs') is not null as ok`)
  if (existe?.ok) {
    const lignes = await q<{ publication_id: string; objectif: Objectif }>(c, `
      select publication_id, objectif from public.cockpit_social_objectifs where plateforme = 'instagram'`)
    objectifs = Object.fromEntries(lignes.map((l) => [l.publication_id, l.objectif]))
  } else {
    notes.push('cockpit_social_objectifs absente : publications lues sans leur objectif.')
  }
  // Un post « vente » porte les messages recus par le compte les 3 jours qui suivent (Meta ne
  // relie pas un message a un post : c'est tout le compte, face a sa moyenne de 3 jours).
  const lire = (x: PubIG) => {
    const o = objectifs[x.publication_id] ?? null
    const l = lirePublication(x, compte.reperes, o)
    return o === 'vente' ? { ...l, messages_recus_du_compte_3_jours: messagesApres(x.publie_le, jours) } : l
  }
  const [stories] = await q<{ nombre: number; couverture_moyenne: number | null; vues: number | null; reponses: number | null }>(c, `
    select count(*)::int as nombre, round(avg(couverture))::int as couverture_moyenne, sum(vues)::int as vues,
      sum(commentaires)::int as reponses
    from public.cockpit_social_publications
    where plateforme = 'instagram' and type = 'STORY' and ${JP('publie_le')} between $1::date and $2::date`, p.du, p.au)

  // Le niveau du bilan face aux periodes de meme duree (reperes du compte, 7 ou 30 jours).
  const niveaux = niveauxBilan(actuelle, compte.reperes, n)

  return {
    compte: { pseudo: compte.pseudo, abonnes: nombre(compte.abonnes), releve_le: compte.releve_le },
    en_bref: enBref(actuelle, precedente, pubs.length, stories ?? null, niveaux, n),
    periode_mesuree: { du: lu.du, au: lu.au, dernier_jour_complet: complet },
    bilan: actuelle,
    niveaux_du_bilan: niveaux,
    niveaux_du_bilan_se_lisent: 'face aux périodes de même durée du compte (reperes.compte) : bon = mieux que 3 périodes sur 4, faible = moins bien que 3 sur 4 ; seulement sur 7 ou 30 jours',
    periode_precedente_meme_duree: precedente,
    publications_de_la_periode: pubs.map(lire),
    dernieres_publications: avant.length ? avant.map(lire) : undefined,
    stories_de_la_periode: stories ?? null,
    reperes: reperesLisibles(compte.reperes),
    grille_de_lecture_par_objectif: GRILLE_LECTURE,
    comment_lire_chaque_indicateur: COMMENT_LIRE,
    objectif_des_publications: 'choisi à la main dans le cockpit (fiche d\'une publication) ; null = pas encore choisi, lis alors la grille complète',
    pas_dans_l_api: PAS_DANS_L_API,
  }
}
