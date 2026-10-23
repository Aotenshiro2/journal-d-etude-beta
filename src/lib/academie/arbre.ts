// L'arbre du catalogue de l'academie, range depuis le cockpit (23/10/2026, lot
// D:\6_Societe\Pilotage\Academie\lots\LOT-ARBRE-CATALOGUE-COCKPIT.md ; migration
// 20261023150000_academie_arbre.sql ; route /api/academie/arbre).
//
// Brice voit tout le catalogue (modules publies ET brouillons, sections, lecons)
// et le range : reordonner, deplacer une ou plusieurs lecons dans une autre
// section ou un AUTRE module, publier ou cacher, creer une section vide. Chaque
// changement va dans academie_editions (avant / apres) et pose une marque
// (deplace_le, statut_le, origine_module_id + origine_slug) que l'importeur du
// catalogue respecte (planImport* plus bas).
//
// L'ORDRE D'UNE LECON EST CELUI DU MODULE ENTIER : le site range les lecons
// hors section d'abord, puis section par section, et « suivante » suit l'ordre
// du module (sites/Aoknowledgecom/v3/src/academie/outils.ts, parties() et
// suivante()). Apres un geste, les ordres du module sont donc recalcules pour
// suivre l'affichage, en touchant le moins de lignes possible (renumeroter).
//
// CE FICHIER N'IMPORTE RIEN, expres : l'importeur, verifier-academie.mjs et
// essayer-migration-arbre-academie.mjs l'importent tel quel sous Node 22 (les
// types sont effaces). Le droit (admin) se juge dans la route avec estAdmin de
// pur.ts, la meme regle que droitsAcademie et l'edition.

// ---------------------------------------------------------------------------
// Les formes
// ---------------------------------------------------------------------------

export type StatutContenu = 'brouillon' | 'publie' | 'archive' | 'a_venir'
/** Ce que l'arbre pose en un clic : publier ou cacher. */
export type StatutGeste = 'publie' | 'brouillon'

export type ModuleArbre = {
  id: string; slug: string; titre: string; ordre: number; parcours: string | null; statut: StatutContenu
  edite_le: string | null; deplace_le: string | null; statut_le: string | null
}
export type SectionArbre = {
  id: string; module_id: string; ordre: number; titre: string
  /** Cle de l'importeur ; null = section creee dans l'app. */
  ordre_fichier: number | null
  deplace_le: string | null
}
export type LeconArbre = {
  id: string; module_id: string; section_id: string | null; slug: string; ordre: number; titre: string
  type: 'video' | 'texte' | 'pdf'; hebergeur: 'bunny' | 'wistia' | null; bunny_bibliotheque: string | null
  bunny_video_id: string | null; wistia_id: string | null; duree_s: number | null; statut: StatutContenu
  apercu: boolean
  /** Un texte est present (une lecon ecrite publiee en exige un). */
  a_contenu: boolean
  /** Titres et noms de fichier des pieces jointes (PDF...), pour la recherche. */
  fichiers: string[]
  edite_le: string | null; deplace_le: string | null; statut_le: string | null
  origine_module_id: string | null; origine_slug: string | null
}
export type Arbre = { modules: ModuleArbre[]; sections: SectionArbre[]; lecons: LeconArbre[] }

export type GesteArbre =
  | { action: 'deplacer_lecons'; ids: string[]; module: string; section: string | null; avant: string | null }
  | { action: 'deplacer_section'; id: string; avant: string | null }
  | { action: 'deplacer_module'; id: string; avant: string | null }
  | { action: 'statut'; cible: 'lecon' | 'module'; ids: string[]; statut: StatutGeste }
  | { action: 'creer_section'; module: string; titre: string }

export type ErreurDemandeArbre = 'demande' | 'titre'

/** Une ligne de academie_editions (origine 'app', l'auteur est pose par la requete). */
export type LigneHistoriqueArbre = {
  cible: 'lecon' | 'module' | 'section'; cible_id: string; champ: 'position' | 'statut' | 'creation'
  avant: string | null; apres: string | null
}

/** Ce qu'un geste ecrit. Les lignes de lecon portent toute la place (module, section, ordre, slug, origine). */
export type PlanArbre = {
  lecons: { id: string; module_id: string; section_id: string | null; ordre: number; slug: string
    origine_module_id: string | null; origine_slug: string | null }[]
  sections: { id: string; ordre: number }[]
  modules: { id: string; ordre: number }[]
  statutsLecons: { id: string; statut: StatutGeste }[]
  statutsModules: { id: string; statut: StatutGeste }[]
  historique: LigneHistoriqueArbre[]
  /** Lecons arrivees dans un module ou leur slug etait pris : leur nouveau slug (l'adresse change). */
  renommees: { id: string; avant: string; apres: string }[]
  /** Lecons qu'on ne peut pas publier : video pas encore envoyee, texte vide. */
  refusees: { id: string; titre: string; raison: 'video' | 'texte' }[]
}

export type IssuePlan = { ok: true; plan: PlanArbre } | { ok: false; erreur: 'introuvable' | 'cible' }

// ---------------------------------------------------------------------------
// La demande (POST /api/academie/arbre)
// ---------------------------------------------------------------------------

/** Au plus 200 lecons par geste (une selection, ou « tout publier » d'une section). */
export const MAX_LECONS_GESTE = 200
export const MAX_TITRE_SECTION = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function uuid(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const u = v.trim().toLowerCase()
  return UUID_RE.test(u) ? u : null
}

/** undefined ou null = null ; un uuid ; sinon false (refus). */
function uuidOuRien(v: unknown): string | null | false {
  if (v === undefined || v === null) return null
  return uuid(v) ?? false
}

function listeUuids(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_LECONS_GESTE) return null
  const vus = new Set<string>()
  for (const x of v) {
    const u = uuid(x)
    if (!u) return null
    vus.add(u)
  }
  return [...vus]
}

const CLES: Record<GesteArbre['action'], readonly string[]> = {
  deplacer_lecons: ['ids', 'module', 'section', 'avant'],
  deplacer_section: ['id', 'avant'],
  deplacer_module: ['id', 'avant'],
  statut: ['cible', 'ids', 'statut'],
  creer_section: ['module', 'titre'],
}

/**
 * Le corps de POST /api/academie/arbre. Refuse toute cle en trop, un uuid mal
 * forme, plus de 200 lecons, un statut autre que publie / brouillon.
 * avant = l'element devant lequel poser (absent ou null : a la fin).
 */
export function lireGesteArbre(corps: unknown): { ok: true; geste: GesteArbre } | { ok: false; erreur: ErreurDemandeArbre } {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return { ok: false, erreur: 'demande' }
  const c = corps as Record<string, unknown>
  const action = c.action
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(CLES, action)) return { ok: false, erreur: 'demande' }
  const permises = CLES[action as GesteArbre['action']]
  for (const cle of Object.keys(c)) if (cle !== 'action' && !permises.includes(cle)) return { ok: false, erreur: 'demande' }
  const non = { ok: false as const, erreur: 'demande' as const }

  if (action === 'deplacer_lecons') {
    const ids = listeUuids(c.ids)
    const moduleId = uuid(c.module)
    const section = uuidOuRien(c.section)
    const avant = uuidOuRien(c.avant)
    if (!ids || !moduleId || section === false || avant === false) return non
    if (avant && ids.includes(avant)) return non
    return { ok: true, geste: { action, ids, module: moduleId, section, avant } }
  }
  if (action === 'deplacer_section' || action === 'deplacer_module') {
    const id = uuid(c.id)
    const avant = uuidOuRien(c.avant)
    if (!id || avant === false || avant === id) return non
    return { ok: true, geste: { action, id, avant } }
  }
  if (action === 'statut') {
    const ids = listeUuids(c.ids)
    if (!ids || (c.cible !== 'lecon' && c.cible !== 'module') || (c.statut !== 'publie' && c.statut !== 'brouillon')) return non
    return { ok: true, geste: { action, cible: c.cible as 'lecon' | 'module', ids, statut: c.statut as StatutGeste } }
  }
  // creer_section
  const moduleId = uuid(c.module)
  if (!moduleId) return non
  if (typeof c.titre !== 'string') return { ok: false, erreur: 'titre' }
  const titre = c.titre.replace(/\s+/g, ' ').trim()
  if (!titre || titre.length > MAX_TITRE_SECTION) return { ok: false, erreur: 'titre' }
  return { ok: true, geste: { action: 'creer_section', module: moduleId, titre } }
}

/**
 * La porte de la route : le droit d'abord (un non-admin est refuse avant meme
 * de lire sa demande : 403 'droit'), puis la demande (400). admin = estAdmin(role)
 * de pur.ts.
 */
export function autoriserArbre(admin: boolean, corps: unknown):
  | { ok: true; geste: GesteArbre }
  | { ok: false; status: 403 | 400; erreur: 'droit' | ErreurDemandeArbre } {
  if (!admin) return { ok: false, status: 403, erreur: 'droit' }
  const lu = lireGesteArbre(corps)
  return lu.ok ? lu : { ok: false, status: 400, erreur: lu.erreur }
}

// ---------------------------------------------------------------------------
// L'ordre
// ---------------------------------------------------------------------------

type AvecOrdre = { id: string; ordre: number; titre: string }

function comparer(a: AvecOrdre, b: AvecOrdre): number {
  return a.ordre - b.ordre || a.titre.localeCompare(b.titre) || a.id.localeCompare(b.id)
}

/** Les modules dans l'ordre de l'arbre (et du site). */
export function modulesTries(arbre: Arbre): ModuleArbre[] {
  return [...arbre.modules].sort(comparer)
}

/** Les sections d'un module, dans l'ordre. */
export function sectionsDuModule(arbre: Arbre, moduleId: string): SectionArbre[] {
  return arbre.sections.filter(s => s.module_id === moduleId).sort(comparer)
}

/**
 * Les « conteneurs » d'un module dans l'ordre d'affichage du site : les lecons
 * hors section d'abord (section null, toujours presente meme vide), puis chaque
 * section (meme vide). Une lecon dont la section n'est pas dans le module compte
 * hors section, comme sur le site.
 */
export function conteneursDuModule(arbre: Arbre, moduleId: string): { section: string | null; lecons: LeconArbre[] }[] {
  const sections = sectionsDuModule(arbre, moduleId)
  const connues = new Set(sections.map(s => s.id))
  const lecons = arbre.lecons.filter(l => l.module_id === moduleId).sort(comparer)
  return [
    { section: null, lecons: lecons.filter(l => !l.section_id || !connues.has(l.section_id)) },
    ...sections.map(s => ({ section: s.id, lecons: lecons.filter(l => l.section_id === s.id) })),
  ]
}

/** Indices d'une plus longue sous-suite strictement croissante (algorithme de patience). */
function plusLongueCroissante(valeurs: number[]): number[] {
  const fins: number[] = [] // fins[k] = indice de la plus petite fin d'une suite de longueur k+1
  const precedent: number[] = new Array(valeurs.length).fill(-1)
  for (let i = 0; i < valeurs.length; i++) {
    let bas = 0
    let haut = fins.length
    while (bas < haut) {
      const milieu = (bas + haut) >> 1
      if (valeurs[fins[milieu]] < valeurs[i]) bas = milieu + 1
      else haut = milieu
    }
    if (bas > 0) precedent[i] = fins[bas - 1]
    fins[bas] = i
  }
  const res: number[] = []
  let k = fins.length ? fins[fins.length - 1] : -1
  while (k >= 0) { res.push(k); k = precedent[k] }
  return res.reverse()
}

/**
 * Les nouveaux ordres d'une suite d'elements DEJA dans l'ordre voulu : rien si
 * leurs ordres croissent deja ; sinon on garde la plus longue sous-suite deja
 * croissante et on loge les autres dans les trous (au debut : en dessous du
 * premier, a la fin : au-dessus du dernier) ; s'il n'y a pas la place, tout
 * est renumerote 1..n. Rend SEULEMENT ce qui change (id -> ordre) : chaque
 * ligne qui change sera marquee comme rangee dans l'app.
 */
export function renumeroter(suite: readonly { id: string; ordre: number }[]): Map<string, number> {
  const res = new Map<string, number>()
  const n = suite.length
  if (n === 0) return res
  let croissant = true
  for (let i = 1; i < n; i++) if (!(suite[i].ordre > suite[i - 1].ordre)) { croissant = false; break }
  if (croissant) return res

  const gardes = new Set(plusLongueCroissante(suite.map(x => x.ordre)))
  const nouveaux = suite.map(x => x.ordre)
  let i = 0
  let possible = true
  while (i < n && possible) {
    if (gardes.has(i)) { i++; continue }
    let j = i
    while (j < n && !gardes.has(j)) j++
    const k = j - i // elements a loger entre i-1 et j
    const avant = i > 0 ? nouveaux[i - 1] : null
    const apres = j < n ? nouveaux[j] : null
    if (avant === null && apres === null) { possible = false; break }
    for (let x = 0; x < k; x++) {
      if (avant === null) nouveaux[i + x] = (apres as number) - k + x
      else if (apres === null) nouveaux[i + x] = avant + 1 + x
      else {
        const ecart = apres - avant
        if (ecart - 1 < k) { possible = false; break }
        nouveaux[i + x] = avant + Math.floor(((x + 1) * ecart) / (k + 1))
      }
    }
    i = j
  }
  if (!possible) for (let x = 0; x < n; x++) nouveaux[x] = x + 1
  for (let x = 0; x < n; x++) if (nouveaux[x] !== suite[x].ordre) res.set(suite[x].id, nouveaux[x])
  return res
}

// ---------------------------------------------------------------------------
// Les plans (purs : l'arbre lu sous verrou -> ce qu'il faut ecrire)
// ---------------------------------------------------------------------------

const SLUG_MAX = 120

function planVide(): PlanArbre {
  return { lecons: [], sections: [], modules: [], statutsLecons: [], statutsModules: [], historique: [], renommees: [], refusees: [] }
}

/** La place d'une lecon en JSON (historique) : lisible a la main, les ids pour revenir en arriere. */
function place(arbre: Arbre, p: { module_id: string; section_id: string | null; ordre: number; slug: string }): string {
  const m = arbre.modules.find(x => x.id === p.module_id)
  const s = p.section_id ? arbre.sections.find(x => x.id === p.section_id) : null
  return JSON.stringify({
    module: m?.slug ?? null, section: s?.titre ?? null, ordre: p.ordre, slug: p.slug,
    module_id: p.module_id, section_id: p.section_id,
  })
}

/** Un slug libre dans le module : le meme, sinon slug-2, slug-3... (borne a 120 caracteres). */
export function slugLibre(slug: string, pris: ReadonlySet<string>): string {
  if (!pris.has(slug)) return slug
  for (let n = 2; ; n++) {
    const suffixe = `-${n}`
    const base = slug.slice(0, SLUG_MAX - suffixe.length).replace(/-+$/, '')
    const essai = `${base}${suffixe}`
    if (!pris.has(essai)) return essai
  }
}

/**
 * Deplacer des lecons (une ou plusieurs, dans l'ordre de ids) dans le module
 * `module`, section `section` (null = hors section), devant la lecon `avant`
 * (null = a la fin de ce conteneur). Couvre : reordonner dans une section,
 * changer de section, changer de MODULE.
 *
 * Une lecon qui change de module : sa section devient celle choisie (du module
 * cible) ; son slug reste s'il est libre dans le module cible (ni pris, ni
 * reserve par l'origine d'une autre lecon), sinon slug-2... ; son module et son
 * slug d'origine sont notes (le premier depart seulement) ; revenue dans son
 * module d'origine sous son slug d'origine, l'origine s'efface.
 */
export function planDeplacerLecons(arbre: Arbre, g: Extract<GesteArbre, { action: 'deplacer_lecons' }>): IssuePlan {
  if (!arbre.modules.some(m => m.id === g.module)) return { ok: false, erreur: 'introuvable' }
  if (g.section) {
    const s = arbre.sections.find(x => x.id === g.section)
    if (!s) return { ok: false, erreur: 'introuvable' }
    if (s.module_id !== g.module) return { ok: false, erreur: 'cible' }
  }
  const parId = new Map(arbre.lecons.map(l => [l.id, l]))
  const deplacees: LeconArbre[] = []
  for (const id of g.ids) {
    const l = parId.get(id)
    if (!l) return { ok: false, erreur: 'introuvable' }
    deplacees.push(l)
  }
  const bouge = new Set(g.ids)
  const conteneurs = conteneursDuModule(arbre, g.module).map(c => ({ section: c.section, lecons: c.lecons.filter(l => !bouge.has(l.id)) }))
  const iCible = conteneurs.findIndex(c => c.section === g.section)
  if (iCible < 0) return { ok: false, erreur: 'cible' }
  if (g.avant) {
    const a = parId.get(g.avant)
    if (!a) return { ok: false, erreur: 'introuvable' }
    if (!conteneurs[iCible].lecons.some(l => l.id === g.avant)) return { ok: false, erreur: 'cible' }
  }

  // La suite du module apres le geste.
  const cible = conteneurs[iCible].lecons
  const pos = g.avant ? cible.findIndex(l => l.id === g.avant) : cible.length
  conteneurs[iCible] = { section: g.section, lecons: [...cible.slice(0, pos), ...deplacees, ...cible.slice(pos)] }
  const suite = conteneurs.flatMap(c => c.lecons.map(l => ({ l, section: c.section })))
  const ordres = renumeroter(suite.map(x => ({ id: x.l.id, ordre: x.l.ordre })))

  // Les slugs du module cible : ceux des lecons qui y sont deja, et ceux reserves par l'origine
  // d'une autre lecon (partie ailleurs : l'importeur la retrouve par ce slug, il ne doit pas
  // tomber sur une autre).
  const pris = new Set<string>()
  for (const l of arbre.lecons) {
    if (l.module_id === g.module) pris.add(l.slug)
    if (l.origine_module_id === g.module && l.origine_slug && !bouge.has(l.id)) pris.add(l.origine_slug)
  }

  const plan = planVide()
  for (const { l, section } of suite) {
    let slug = l.slug
    let origineModule = l.origine_module_id
    let origineSlug = l.origine_slug
    if (l.module_id !== g.module) {
      if (l.origine_module_id === g.module && l.origine_slug && !pris.has(l.origine_slug)) {
        // Retour dans son module d'origine, sous son slug d'origine : plus rien a retenir.
        slug = l.origine_slug
        origineModule = null
        origineSlug = null
      } else {
        slug = slugLibre(l.slug, pris)
        if (!origineModule) { origineModule = l.module_id; origineSlug = l.slug }
      }
      pris.add(slug)
      if (slug !== l.slug) plan.renommees.push({ id: l.id, avant: l.slug, apres: slug })
    }
    const ordre = ordres.get(l.id) ?? l.ordre
    const change = l.module_id !== g.module || (l.section_id ?? null) !== section || ordre !== l.ordre || slug !== l.slug
    if (!change) continue
    plan.lecons.push({ id: l.id, module_id: g.module, section_id: section, ordre, slug, origine_module_id: origineModule, origine_slug: origineSlug })
    plan.historique.push({
      cible: 'lecon', cible_id: l.id, champ: 'position',
      avant: place(arbre, l),
      apres: place(arbre, { module_id: g.module, section_id: section, ordre, slug }),
    })
  }
  return { ok: true, plan }
}

/** Les lecons d'un module renumerotees pour suivre l'ordre d'affichage (apres un changement d'ordre des sections). */
function realignerLecons(arbre: Arbre, moduleId: string, plan: PlanArbre): void {
  const suite = conteneursDuModule(arbre, moduleId).flatMap(c => c.lecons)
  const ordres = renumeroter(suite.map(l => ({ id: l.id, ordre: l.ordre })))
  for (const l of suite) {
    const ordre = ordres.get(l.id)
    if (ordre === undefined) continue
    plan.lecons.push({ id: l.id, module_id: l.module_id, section_id: l.section_id, ordre, slug: l.slug,
      origine_module_id: l.origine_module_id, origine_slug: l.origine_slug })
    plan.historique.push({ cible: 'lecon', cible_id: l.id, champ: 'position', avant: place(arbre, l), apres: place(arbre, { ...l, ordre }) })
  }
}

/** Reordonner une section dans son module (devant `avant`, ou a la fin). Les lecons suivent. */
export function planDeplacerSection(arbre: Arbre, g: Extract<GesteArbre, { action: 'deplacer_section' }>): IssuePlan {
  const s = arbre.sections.find(x => x.id === g.id)
  if (!s) return { ok: false, erreur: 'introuvable' }
  const autres = sectionsDuModule(arbre, s.module_id).filter(x => x.id !== s.id)
  let pos = autres.length
  if (g.avant) {
    pos = autres.findIndex(x => x.id === g.avant)
    if (pos < 0) return { ok: false, erreur: arbre.sections.some(x => x.id === g.avant) ? 'cible' : 'introuvable' }
  }
  const suite = [...autres.slice(0, pos), s, ...autres.slice(pos)]
  const ordres = renumeroter(suite)
  const plan = planVide()
  const slugModule = arbre.modules.find(m => m.id === s.module_id)?.slug ?? null
  for (const x of suite) {
    const ordre = ordres.get(x.id)
    if (ordre === undefined) continue
    plan.sections.push({ id: x.id, ordre })
    plan.historique.push({
      cible: 'section', cible_id: x.id, champ: 'position',
      avant: JSON.stringify({ module: slugModule, ordre: x.ordre }), apres: JSON.stringify({ module: slugModule, ordre }),
    })
  }
  if (plan.sections.length) {
    // L'arbre tel qu'il sera, pour realigner les lecons du module sur le nouvel ordre des sections.
    const nouveau: Arbre = { ...arbre, sections: arbre.sections.map(x => (ordres.has(x.id) ? { ...x, ordre: ordres.get(x.id)! } : x)) }
    realignerLecons(nouveau, s.module_id, plan)
  }
  return { ok: true, plan }
}

/** Reordonner un module dans le catalogue (devant `avant`, ou a la fin). */
export function planDeplacerModule(arbre: Arbre, g: Extract<GesteArbre, { action: 'deplacer_module' }>): IssuePlan {
  const m = arbre.modules.find(x => x.id === g.id)
  if (!m) return { ok: false, erreur: 'introuvable' }
  const autres = modulesTries(arbre).filter(x => x.id !== m.id)
  let pos = autres.length
  if (g.avant) {
    pos = autres.findIndex(x => x.id === g.avant)
    if (pos < 0) return { ok: false, erreur: 'introuvable' }
  }
  const suite = [...autres.slice(0, pos), m, ...autres.slice(pos)]
  const ordres = renumeroter(suite)
  const plan = planVide()
  for (const x of suite) {
    const ordre = ordres.get(x.id)
    if (ordre === undefined) continue
    plan.modules.push({ id: x.id, ordre })
    plan.historique.push({ cible: 'module', cible_id: x.id, champ: 'position', avant: JSON.stringify({ ordre: x.ordre }), apres: JSON.stringify({ ordre }) })
  }
  return { ok: true, plan }
}

/**
 * Publier ou cacher (brouillon) des lecons ou un module. Une lecon video pas
 * encore envoyee (sans hebergeur) ou ecrite sans texte ne se publie pas
 * (contraintes de la base) : elle est rendue dans `refusees`, les autres passent.
 */
export function planStatut(arbre: Arbre, g: Extract<GesteArbre, { action: 'statut' }>): IssuePlan {
  const plan = planVide()
  if (g.cible === 'module') {
    for (const id of g.ids) {
      const m = arbre.modules.find(x => x.id === id)
      if (!m) return { ok: false, erreur: 'introuvable' }
      if (m.statut === g.statut) continue
      plan.statutsModules.push({ id, statut: g.statut })
      plan.historique.push({ cible: 'module', cible_id: id, champ: 'statut', avant: m.statut, apres: g.statut })
    }
    return { ok: true, plan }
  }
  const parId = new Map(arbre.lecons.map(l => [l.id, l]))
  for (const id of g.ids) {
    const l = parId.get(id)
    if (!l) return { ok: false, erreur: 'introuvable' }
    if (l.statut === g.statut) continue
    if (g.statut === 'publie' && l.type === 'video' && !l.hebergeur) { plan.refusees.push({ id, titre: l.titre, raison: 'video' }); continue }
    if (g.statut === 'publie' && l.type === 'texte' && !l.a_contenu) { plan.refusees.push({ id, titre: l.titre, raison: 'texte' }); continue }
    plan.statutsLecons.push({ id, statut: g.statut })
    plan.historique.push({ cible: 'lecon', cible_id: id, champ: 'statut', avant: l.statut, apres: g.statut })
  }
  return { ok: true, plan }
}

/** Le plan d'un geste (sauf creer_section, qui n'a rien a calculer). */
export function planGeste(arbre: Arbre, g: Exclude<GesteArbre, { action: 'creer_section' }>): IssuePlan {
  switch (g.action) {
    case 'deplacer_lecons': return planDeplacerLecons(arbre, g)
    case 'deplacer_section': return planDeplacerSection(arbre, g)
    case 'deplacer_module': return planDeplacerModule(arbre, g)
    case 'statut': return planStatut(arbre, g)
  }
}

// ---------------------------------------------------------------------------
// L'importeur face a l'arbre (scripts/importer-catalogue-academie.mjs)
// ---------------------------------------------------------------------------

/**
 * Une valeur que l'app a pu changer (marque posee) face a celle du fichier :
 * marque = on garde la base (garde) ; ecraser (--ecraser-editions) = le
 * fichier, et la marque s'efface (effacer).
 */
function arbitrer<T>(marque: boolean, base: T, fichier: T, ecraser: boolean): { valeur: T; garde: boolean; effacer: boolean } {
  if (!marque) return { valeur: fichier, garde: false, effacer: false }
  if (!ecraser) return { valeur: base, garde: true, effacer: false }
  return { valeur: fichier, garde: false, effacer: true }
}

/** Un statut tient-il avec les donnees du fichier ? (contraintes academie_lecons_hebergeur_coherent et _texte_publie) */
export function statutTient(statut: string, f: { type: string; heberge: boolean; contenu: string | null }): boolean {
  if ((statut === 'publie' || statut === 'archive') && f.type === 'video' && !f.heberge) return false
  if (statut === 'publie' && f.type === 'texte' && f.contenu === null) return false
  return true
}

export type LigneHistoriqueImport = { champ: 'position' | 'statut'; avant: string | null; apres: string | null }

export type BaseImportLecon = {
  id: string; module_id: string; section_id: string | null; slug: string; ordre: number; statut: string
  deplace: boolean; statut_modifie: boolean; origine_module_id: string | null; origine_slug: string | null
}
export type FichierImportLecon = {
  module_id: string; section_id: string | null; slug: string; ordre: number; statut: string
  type: string; heberge: boolean; contenu: string | null
}

function placeImport(p: { module_id: string; section_id: string | null; ordre: number; slug: string }): string {
  return JSON.stringify({ ordre: p.ordre, slug: p.slug, module_id: p.module_id, section_id: p.section_id })
}

/**
 * Une lecon du fichier face a sa ligne en base (retrouvee par (module, slug)
 * ou par son origine). Sans --ecraser-editions : une lecon rangee dans l'app
 * (deplace_le) garde module, section, ordre et slug ; un statut change dans
 * l'app (statut_le) est garde s'il tient encore avec le fichier, sinon le
 * fichier l'emporte avec un avertissement. Avec --ecraser-editions : le
 * fichier partout (la lecon revient dans son module d'origine), les marques
 * s'effacent, l'historique note ce qui est defait.
 */
export function planImportLecon(base: BaseImportLecon | null, f: FichierImportLecon, ecraser: boolean): {
  module_id: string; section_id: string | null; slug: string; ordre: number; statut: string
  effacerPlace: boolean; effacerStatut: boolean; gardePlace: boolean; gardeStatut: boolean
  /** La lecon vit dans un autre module que celui du fichier (deplacee dans le cockpit). */
  ailleurs: boolean
  avertissement: string | null
  historique: LigneHistoriqueImport[]
} {
  if (!base) {
    return { module_id: f.module_id, section_id: f.section_id, slug: f.slug, ordre: f.ordre, statut: f.statut,
      effacerPlace: false, effacerStatut: false, gardePlace: false, gardeStatut: false, ailleurs: false, avertissement: null, historique: [] }
  }
  // Une lecon venue d'un autre module garde toujours sa place, marque ou non (sauf --ecraser-editions).
  const marquePlace = base.deplace || base.module_id !== f.module_id || base.origine_module_id !== null
  const pl = arbitrer(marquePlace,
    { module_id: base.module_id, section_id: base.section_id, ordre: base.ordre, slug: base.slug },
    { module_id: f.module_id, section_id: f.section_id, ordre: f.ordre, slug: f.slug }, ecraser)
  let st = arbitrer(base.statut_modifie, base.statut, f.statut, ecraser)
  let avertissement: string | null = null
  if (st.garde && !statutTient(st.valeur, f)) {
    avertissement = `statut « ${base.statut} » du cockpit abandonne (le fichier ne le permet plus) : « ${f.statut} »`
    st = { valeur: f.statut, garde: false, effacer: true }
  }
  const historique: LigneHistoriqueImport[] = []
  if (pl.effacer) {
    const avant = placeImport(base)
    const apres = placeImport(pl.valeur)
    if (avant !== apres) historique.push({ champ: 'position', avant, apres })
  }
  if (st.effacer && base.statut !== st.valeur) historique.push({ champ: 'statut', avant: base.statut, apres: st.valeur })
  return {
    ...pl.valeur, statut: st.valeur,
    effacerPlace: pl.effacer, effacerStatut: st.effacer, gardePlace: pl.garde, gardeStatut: st.garde,
    ailleurs: pl.valeur.module_id !== f.module_id, avertissement, historique,
  }
}

/** Un module du fichier face a sa ligne : ordre et statut gardes s'ils ont ete changes dans l'app. */
export function planImportModule(
  base: { ordre: number; statut: string; deplace: boolean; statut_modifie: boolean } | null,
  f: { ordre: number; statut: string },
  ecraser: boolean,
) {
  if (!base) return { ordre: f.ordre, statut: f.statut, effacerPlace: false, effacerStatut: false, gardePlace: false, gardeStatut: false, historique: [] as LigneHistoriqueImport[] }
  const o = arbitrer(base.deplace, base.ordre, f.ordre, ecraser)
  const s = arbitrer(base.statut_modifie, base.statut, f.statut, ecraser)
  const historique: LigneHistoriqueImport[] = []
  if (o.effacer && base.ordre !== o.valeur) historique.push({ champ: 'position', avant: JSON.stringify({ ordre: base.ordre }), apres: JSON.stringify({ ordre: o.valeur }) })
  if (s.effacer && base.statut !== s.valeur) historique.push({ champ: 'statut', avant: base.statut, apres: s.valeur })
  return { ordre: o.valeur, statut: s.valeur, effacerPlace: o.effacer, effacerStatut: s.effacer, gardePlace: o.garde, gardeStatut: s.garde, historique }
}

/** Une section du fichier (retrouvee par ordre_fichier) face a sa ligne : l'ordre garde s'il a ete change dans l'app. */
export function planImportSection(base: { ordre: number; deplace: boolean } | null, f: { ordre: number }, ecraser: boolean) {
  if (!base) return { ordre: f.ordre, effacerPlace: false, gardePlace: false, historique: [] as LigneHistoriqueImport[] }
  const o = arbitrer(base.deplace, base.ordre, f.ordre, ecraser)
  const historique: LigneHistoriqueImport[] = []
  if (o.effacer && base.ordre !== o.valeur) historique.push({ champ: 'position', avant: JSON.stringify({ ordre: base.ordre }), apres: JSON.stringify({ ordre: o.valeur }) })
  return { ordre: o.valeur, effacerPlace: o.effacer, gardePlace: o.garde, historique }
}

// ---------------------------------------------------------------------------
// Le SQL (role postgres du journal ; joue tel quel par essayer-migration-arbre-academie.mjs)
// ---------------------------------------------------------------------------

/** Tous les modules verrouilles : un geste a la fois, et pas pendant un import (qui verrouille son module). */
export const SQL_ARBRE_VERROU = `select id from public.academie_modules order by id for update`

export const SQL_ARBRE_MODULES = `
select m.id::text as id, m.slug, m.titre, m.ordre, m.parcours, m.statut, m.edite_le, m.deplace_le, m.statut_le
  from public.academie_modules m
 order by m.ordre, m.titre, m.id
`

export const SQL_ARBRE_SECTIONS = `
select s.id::text as id, s.module_id::text as module_id, s.ordre, s.titre, s.ordre_fichier, s.deplace_le
  from public.academie_sections s
 order by s.module_id, s.ordre, s.titre, s.id
`

export const SQL_ARBRE_LECONS = `
select l.id::text as id, l.module_id::text as module_id, l.section_id::text as section_id, l.slug, l.ordre, l.titre,
       l.type, l.hebergeur, l.bunny_bibliotheque, l.bunny_video_id, l.wistia_id, l.duree_s, l.statut, l.apercu,
       (l.contenu is not null) as a_contenu, l.ressources, l.edite_le, l.deplace_le, l.statut_le,
       l.origine_module_id::text as origine_module_id, l.origine_slug
  from public.academie_lecons l
 order by l.module_id, l.ordre, l.titre, l.id
`

/** $1 = jsonb [{ id, module_id, section_id, ordre, slug, origine_module_id, origine_slug }]. */
export const SQL_ARBRE_ECRIRE_LECONS = `
update public.academie_lecons l
   set module_id = v.module_id::uuid, section_id = v.section_id::uuid, ordre = v.ordre, slug = v.slug,
       origine_module_id = v.origine_module_id::uuid, origine_slug = v.origine_slug, deplace_le = now()
  from jsonb_to_recordset($1::jsonb) as v(id text, module_id text, section_id text, ordre int, slug text,
                                          origine_module_id text, origine_slug text)
 where l.id = v.id::uuid
`

/** $1 = jsonb [{ id, ordre }]. */
export const SQL_ARBRE_ECRIRE_SECTIONS = `
update public.academie_sections s set ordre = v.ordre, deplace_le = now()
  from jsonb_to_recordset($1::jsonb) as v(id text, ordre int)
 where s.id = v.id::uuid
`

/** $1 = jsonb [{ id, ordre }]. */
export const SQL_ARBRE_ECRIRE_MODULES = `
update public.academie_modules m set ordre = v.ordre, deplace_le = now()
  from jsonb_to_recordset($1::jsonb) as v(id text, ordre int)
 where m.id = v.id::uuid
`

/** $1 = jsonb [{ id, statut }]. */
export const SQL_ARBRE_STATUT_LECONS = `
update public.academie_lecons l set statut = v.statut, statut_le = now()
  from jsonb_to_recordset($1::jsonb) as v(id text, statut text)
 where l.id = v.id::uuid
`

/** $1 = jsonb [{ id, statut }]. */
export const SQL_ARBRE_STATUT_MODULES = `
update public.academie_modules m set statut = v.statut, statut_le = now()
  from jsonb_to_recordset($1::jsonb) as v(id text, statut text)
 where m.id = v.id::uuid
`

/** $1 = module, $2 = titre. Une section vide a la fin du module (ordre_fichier vide : creee dans l'app). */
export const SQL_ARBRE_CREER_SECTION = `
insert into public.academie_sections (module_id, ordre, titre)
select $1::uuid, coalesce(max(s.ordre), 0) + 1, $2::text
  from public.academie_sections s
 where s.module_id = $1::uuid
returning id::text as id, ordre
`

/** $1 = compte admin, $2 = jsonb [{ cible, cible_id, champ, avant, apres }]. origine 'app'. */
export const SQL_ARBRE_HISTORIQUE = `
insert into public.academie_editions (cible, cible_id, champ, avant, apres, par, origine)
select h.cible, h.cible_id::uuid, h.champ, h.avant, h.apres, $1::uuid, 'app'
  from jsonb_to_recordset($2::jsonb) as h(cible text, cible_id text, champ text, avant text, apres text)
`

// ---------------------------------------------------------------------------
// Lire et ecrire (le client SQL est passe : prisma, ou la transaction d'un script)
// ---------------------------------------------------------------------------

export type ClientSql = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valeurs: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...valeurs: unknown[]): Promise<number>
}

const iso = (d: unknown): string | null => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : null)

/** Le dernier morceau d'un chemin ou d'une adresse (nom du PDF). */
function nomFichier(v: string): string {
  const sans = v.split(/[?#]/)[0]
  const nom = sans.split('/').filter(Boolean).pop() ?? sans
  try { return decodeURIComponent(nom) } catch { return nom }
}

/** Titres et noms de fichier des pieces jointes (ressources jsonb), dedoublonnes, 20 au plus. */
export function fichiersDesRessources(brut: unknown): string[] {
  if (!Array.isArray(brut)) return []
  const res = new Set<string>()
  for (const r of brut) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.titre === 'string' && o.titre.trim()) res.add(o.titre.trim().slice(0, 200))
    if (typeof o.fichier === 'string' && o.fichier) res.add(nomFichier(o.fichier).slice(0, 200))
    else if (typeof o.url === 'string' && o.url) res.add(nomFichier(o.url).slice(0, 200))
    if (res.size >= 20) break
  }
  return [...res]
}

type LigneModuleSql = Omit<ModuleArbre, 'edite_le' | 'deplace_le' | 'statut_le'> & { edite_le: unknown; deplace_le: unknown; statut_le: unknown }
type LigneSectionSql = Omit<SectionArbre, 'deplace_le'> & { deplace_le: unknown }
type LigneLeconSql = Omit<LeconArbre, 'fichiers' | 'edite_le' | 'deplace_le' | 'statut_le'> & {
  ressources: unknown; edite_le: unknown; deplace_le: unknown; statut_le: unknown
}

/** Tout le catalogue, brouillons compris, avec les marques. Jette sur une panne de base. */
export async function lireArbre(c: ClientSql): Promise<Arbre> {
  const modules = await c.$queryRawUnsafe<LigneModuleSql[]>(SQL_ARBRE_MODULES)
  const sections = await c.$queryRawUnsafe<LigneSectionSql[]>(SQL_ARBRE_SECTIONS)
  const lecons = await c.$queryRawUnsafe<LigneLeconSql[]>(SQL_ARBRE_LECONS)
  return {
    modules: modules.map(m => ({ ...m, ordre: Number(m.ordre), edite_le: iso(m.edite_le), deplace_le: iso(m.deplace_le), statut_le: iso(m.statut_le) })),
    sections: sections.map(s => ({
      ...s, ordre: Number(s.ordre), ordre_fichier: s.ordre_fichier === null ? null : Number(s.ordre_fichier), deplace_le: iso(s.deplace_le),
    })),
    lecons: lecons.map(({ ressources, ...l }) => ({
      ...l, ordre: Number(l.ordre), duree_s: l.duree_s === null ? null : Number(l.duree_s), fichiers: fichiersDesRessources(ressources),
      edite_le: iso(l.edite_le), deplace_le: iso(l.deplace_le), statut_le: iso(l.statut_le),
    })),
  }
}

export type IssueGeste =
  | { issue: 'ok'; modifies: number; renommees: PlanArbre['renommees']; refusees: PlanArbre['refusees']; section?: string }
  | { issue: 'introuvable' }
  | { issue: 'cible' }

/** Ecrit un plan dans la transaction tx. Rend le nombre de lignes d'historique (une par element qui change). */
async function ecrirePlan(tx: ClientSql, par: string, plan: PlanArbre): Promise<number> {
  if (plan.lecons.length) await tx.$executeRawUnsafe(SQL_ARBRE_ECRIRE_LECONS, JSON.stringify(plan.lecons))
  if (plan.sections.length) await tx.$executeRawUnsafe(SQL_ARBRE_ECRIRE_SECTIONS, JSON.stringify(plan.sections))
  if (plan.modules.length) await tx.$executeRawUnsafe(SQL_ARBRE_ECRIRE_MODULES, JSON.stringify(plan.modules))
  if (plan.statutsLecons.length) await tx.$executeRawUnsafe(SQL_ARBRE_STATUT_LECONS, JSON.stringify(plan.statutsLecons))
  if (plan.statutsModules.length) await tx.$executeRawUnsafe(SQL_ARBRE_STATUT_MODULES, JSON.stringify(plan.statutsModules))
  if (plan.historique.length) await tx.$executeRawUnsafe(SQL_ARBRE_HISTORIQUE, par, JSON.stringify(plan.historique))
  return plan.historique.length
}

/**
 * Joue un geste de l'admin `par` DANS la transaction tx (la route l'ouvre ;
 * les scripts d'essai passent la leur, toujours annulee). Verrouille tous les
 * modules, relit l'arbre, calcule, ecrit, garde l'historique. Jette sur une
 * panne de base (la transaction est alors annulee).
 */
export async function executerGeste(tx: ClientSql, par: string, g: GesteArbre): Promise<IssueGeste> {
  await tx.$queryRawUnsafe(SQL_ARBRE_VERROU)
  const arbre = await lireArbre(tx)
  if (g.action === 'creer_section') {
    if (!arbre.modules.some(m => m.id === g.module)) return { issue: 'introuvable' }
    const [s] = await tx.$queryRawUnsafe<{ id: string; ordre: number }[]>(SQL_ARBRE_CREER_SECTION, g.module, g.titre)
    await tx.$executeRawUnsafe(SQL_ARBRE_HISTORIQUE, par, JSON.stringify([
      { cible: 'section', cible_id: s.id, champ: 'creation', avant: null, apres: g.titre },
    ]))
    return { issue: 'ok', modifies: 1, renommees: [], refusees: [], section: s.id }
  }
  const p = planGeste(arbre, g)
  if (!p.ok) return { issue: p.erreur }
  const modifies = await ecrirePlan(tx, par, p.plan)
  return { issue: 'ok', modifies, renommees: p.plan.renommees, refusees: p.plan.refusees }
}
