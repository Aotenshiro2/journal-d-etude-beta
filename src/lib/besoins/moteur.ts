// LES BESOINS DES MEMBRES, LOT 1 (06/11/2026) : le MOTEUR des deux voies (la
// note en direct des bots, la passe de reperage) et le regroupement commun.
//
// Il ne touche ni la base ni le reseau lui-meme : tout passe par `Depots`
// (serveur.ts branche le SQL et Anthropic ; scripts/verifier-besoins.mjs, des
// faux qui comptent les ecritures). Ainsi le mode essai se prouve hors ligne :
// aucune fonction d'ecriture n'est appelee.
//
// Regles :
// - le texte d'une demande est recopie du fil par le serveur, en entier ;
// - une demande = (carte, fil, empreinte) unique ; la passe saute un message
//   deja compte dans ce fil ;
// - suspect (analyserTexte, niveau 'injection') : garde et marque, jamais de
//   phrase au membre ;
// - la phrase du serveur : une fois par echange, et pas si ce membre l'a deja
//   recue pour cette carte dans ce fil ;
// - aucune fonction de la voie directe ne jette : le chat et le bot repondent
//   comme avant ; jamais de texte de membre dans un log.

import type Anthropic from '@anthropic-ai/sdk'
import {
  type BesoinPropose, type BesoinRepere, type CanalBesoin, type CurseurFil, type DetectePar, type FilAClasser,
  type LectureFil, type OutilBesoin, type SuitePasse,
  MAX_CARTES_REGROUPEMENT, analyseDemande, besoinsDistincts, cleSuffixee, decouperEnPaquets, empreinteTexte, erreurCourte,
  lireReponseRegroupement, lireReponseReperage, messagesAClasser, requeteRegroupement, requeteReperage, texteDeDemande,
} from './pur'

/** Une carte lue en base (ou prevue, en essai : id vide). */
export type CarteLue = { id: string; cle: string; titre: string; outil: OutilBesoin }

/** Un fil lu pour la passe. */
export type FilLu = {
  id: string
  app: string
  /** SupportThread.userId : uuid du compte AOK, ou 'telegram:<id>'. */
  userId: string
  membreId: string | null
  messages: unknown
  /** SupportThread.updatedAt tel que lu (ISO). */
  maj: string
  curseur: CurseurFil
}

export type DemandeAEcrire = {
  besoinId: string
  canal: CanalBesoin
  app: string | null
  filId: string | null
  membreRef: string
  membreId: string | null
  texte: string
  empreinte: string
  empreintesMessages: string[]
  resume: string
  detectePar: DetectePar
  suspect: boolean
  suspectRaison: string | null
  texteVisible: string | null
}

export type CurseurAEcrire = { filId: string; maj: string; messagesLus: number; dernierAt: string | null; passeId: string | null }

export type BilanPasse = {
  fils_lus: number
  messages_lus: number
  besoins_trouves: number
  demandes_creees: number
  cartes_creees: number
  suspects: number
  erreurs: number
  restants: number | null
  erreur: string | null
}

/** (06/11, lots 2 a 4) besoins_classement : le classement d'un signalement (bouton, bot, saisie de l'equipe). */
export type UsageBesoins = 'besoins_reperage' | 'besoins_regroupement' | 'besoins_classement'

/** Tout ce que le moteur lit, ecrit et demande au modele. */
export type Depots = {
  /** Les tables de la migration 20261106120000 existent-elles ? */
  tablesPresentes(): Promise<boolean>
  /** Les fils a relire, ordre (updatedAt, id), apres `apres` ; avecCurseurs : seulement ceux plus recents que leur curseur. */
  lireFils(o: { max: number; apres: SuitePasse | null; avecCurseurs: boolean }): Promise<FilLu[]>
  compterRestants(o: { apres: SuitePasse | null; avecCurseurs: boolean }): Promise<number>
  /** Les empreintes de messages deja comptees, par fil. */
  empreintesConnues(filIds: string[]): Promise<Map<string, Set<string>>>
  /** La carte de cette cle, en suivant fusionne_dans jusqu'a la carte qui compte. */
  carteParCle(cle: string): Promise<CarteLue | null>
  /** Les cartes non fusionnees d'un outil, les plus actives d'abord. */
  cartesDeLOutil(outil: OutilBesoin, max: number): Promise<CarteLue[]>
  /** Ce membre a-t-il deja recu la phrase pour cette carte dans ce fil ? */
  accuseDejaDit(carteId: string, filId: string): Promise<boolean>
  // Ecritures (jamais en essai)
  /** null = cle deja prise. */
  creerCarte(b: BesoinPropose, cle: string, creePar: string): Promise<CarteLue | null>
  /** null = deja enregistree (meme carte, meme fil, meme empreinte). */
  insererDemande(d: DemandeAEcrire): Promise<string | null>
  marquerAccuse(demandeId: string): Promise<void>
  avancerCurseur(c: CurseurAEcrire): Promise<void>
  /** null = une autre passe tourne. */
  ouvrirPasse(par: string): Promise<string | null>
  fermerPasse(id: string, bilan: BilanPasse): Promise<void>
  /** Un appel du modele (trace dans AiUsage par serveur.ts). */
  appelIA(requete: Anthropic.MessageCreateParamsNonStreaming, usage: UsageBesoins, qui: string): Promise<{ texte: string; coutMicros: number }>
  maintenant(): number
  /** Un log court, jamais de texte de membre. */
  journal(message: string): void
}

// ---------------------------------------------------------------------------
// Le regroupement
// ---------------------------------------------------------------------------

/** La carte retenue pour un besoin. id null = en essai, la carte serait creee. */
export type CarteRetenue = { id: string | null; cle: string; titre: string; nouvelle: boolean; creee: boolean }

export type ContexteRegroupement = {
  depots: Depots
  essai: boolean
  creePar: string
  /** Pour la trace d'usage du modele. */
  qui: string
  /** Essai : les cartes qui seraient creees (cle -> carte), vues par les besoins suivants. */
  virtuelles: Map<string, CarteLue>
  /** Cle normalisee -> carte retenue dans ce passage : le modele n'est pas redemande. */
  memo: Map<string, CarteRetenue>
  cout: { micros: number; appels: number }
}

export function contexteRegroupement(depots: Depots, o: { essai: boolean; creePar: string; qui: string }): ContexteRegroupement {
  return { depots, essai: o.essai, creePar: o.creePar, qui: o.qui, virtuelles: new Map(), memo: new Map(), cout: { micros: 0, appels: 0 } }
}

/**
 * Une carte par besoin. 1) Meme cle normalisee qu'une carte (fusions suivies) :
 * on rattache. 2) Sinon, le modele recoit le besoin et les cartes du meme outil
 * (cle et titre, les plus actives d'abord) et rend une cle de la liste ou
 * « nouveau » ; une panne du modele vaut « nouveau ». 3) Nouveau : creation en
 * a_trier ; cle deja prise, suffixe (_2 a _9). En essai, rien n'est cree : la
 * carte est prevue et les besoins suivants du meme passage la voient.
 */
export async function regrouper(b: BesoinPropose, c: ContexteRegroupement): Promise<CarteRetenue> {
  const memo = c.memo.get(b.cle)
  if (memo) return { ...memo, creee: false }
  const retenir = (r: CarteRetenue): CarteRetenue => {
    c.memo.set(b.cle, r)
    return r
  }

  const virtuelle = c.virtuelles.get(b.cle)
  if (virtuelle) return retenir({ id: null, cle: virtuelle.cle, titre: virtuelle.titre, nouvelle: true, creee: false })
  const exacte = await c.depots.carteParCle(b.cle)
  if (exacte) return retenir({ id: exacte.id, cle: exacte.cle, titre: exacte.titre, nouvelle: false, creee: false })

  const prevues = [...c.virtuelles.values()].filter(v => v.outil === b.outil)
  const enBase = await c.depots.cartesDeLOutil(b.outil, MAX_CARTES_REGROUPEMENT)
  const cartes = [...prevues, ...enBase].slice(0, MAX_CARTES_REGROUPEMENT)
  if (cartes.length) {
    try {
      const r = await c.depots.appelIA(requeteRegroupement(b, cartes), 'besoins_regroupement', c.qui)
      c.cout.micros += r.coutMicros
      c.cout.appels++
      const cle = lireReponseRegroupement(r.texte, new Set(cartes.map(x => x.cle)))
      const choisie = cle ? cartes.find(x => x.cle === cle) : undefined
      if (choisie) {
        return retenir(choisie.id
          ? { id: choisie.id, cle: choisie.cle, titre: choisie.titre, nouvelle: false, creee: false }
          : { id: null, cle: choisie.cle, titre: choisie.titre, nouvelle: true, creee: false })
      }
    } catch (err) {
      c.depots.journal(`regroupement indisponible, nouvelle carte : ${erreurCourte(err)}`)
    }
  }

  if (c.essai) {
    c.virtuelles.set(b.cle, { id: '', cle: b.cle, titre: b.titre, outil: b.outil })
    return retenir({ id: null, cle: b.cle, titre: b.titre, nouvelle: true, creee: true })
  }
  for (let n = 1; n <= 9; n++) {
    const cle = n === 1 ? b.cle : cleSuffixee(b.cle, n)
    const carte = await c.depots.creerCarte(b, cle, c.creePar)
    if (carte) return retenir({ id: carte.id, cle: carte.cle, titre: carte.titre, nouvelle: true, creee: true })
  }
  throw new Error('aucune cle libre pour la carte')
}

// ---------------------------------------------------------------------------
// La voie directe (outil noter_besoin des bots)
// ---------------------------------------------------------------------------

export type NoteDirecte = {
  canal: 'chat' | 'telegram'
  detectePar: 'ia_chat' | 'ia_bot'
  app: string
  filId: string
  membreRef: string
  membreId: string | null
  /** Le message du membre tel qu'il est dans le fil. */
  texte: string
  besoins: readonly BesoinPropose[]
  /** La reponse peut-elle porter la phrase (texte libre, pas une proposition ni un repli) ? */
  peutDire: boolean
  /** Pour la trace d'usage du modele. */
  qui: string
  /** (06/11, limites des agents) Qui cree une carte nouvelle ; detectePar par defaut ('agent' pour noter_limite). */
  creePar?: string
}

export type IssueDirecte = { phrase: boolean; enregistres: number; suspects: number }

/**
 * Enregistre les besoins notes pendant un echange, APRES la sauvegarde du fil
 * (le fil d'un premier message n'existe pas avant). La phrase : au moins une
 * demande enregistree, non suspecte, sur une carte pour laquelle ce membre ne
 * l'a pas encore recue dans ce fil. Ne jette jamais.
 */
export async function noterEnDirect(n: NoteDirecte, depots: Depots): Promise<IssueDirecte> {
  const issue: IssueDirecte = { phrase: false, enregistres: 0, suspects: 0 }
  try {
    const texte = typeof n.texte === 'string' ? n.texte.trim() : ''
    const besoins = besoinsDistincts(n.besoins)
    if (!texte || !n.filId || !besoins.length) return issue
    const analyse = analyseDemande(texte)
    const empreinte = empreinteTexte(texte)
    const ctx = contexteRegroupement(depots, { essai: false, creePar: n.creePar ?? n.detectePar, qui: n.qui })
    const aAccuser: string[] = []
    for (const b of besoins) {
      try {
        const carte = await regrouper(b, ctx)
        if (!carte.id) continue
        const id = await depots.insererDemande({
          besoinId: carte.id, canal: n.canal, app: n.app || null, filId: n.filId, membreRef: n.membreRef, membreId: n.membreId,
          texte, empreinte, empreintesMessages: [empreinte], resume: b.resume, detectePar: n.detectePar,
          suspect: analyse.suspect, suspectRaison: analyse.raison, texteVisible: analyse.visible,
        })
        if (!id) continue
        issue.enregistres++
        if (analyse.suspect) {
          issue.suspects++
          continue
        }
        if (n.peutDire && !(await depots.accuseDejaDit(carte.id, n.filId))) aAccuser.push(id)
      } catch (err) {
        depots.journal(`besoin non enregistre : ${erreurCourte(err)}`)
      }
    }
    if (aAccuser.length) {
      issue.phrase = true
      for (const id of aAccuser) {
        try {
          await depots.marquerAccuse(id)
        } catch (err) {
          depots.journal(`accuse non marque : ${erreurCourte(err)}`)
        }
      }
    }
  } catch (err) {
    depots.journal(`note directe en panne : ${erreurCourte(err)}`)
  }
  return issue
}

// ---------------------------------------------------------------------------
// La passe de reperage
// ---------------------------------------------------------------------------

export class ErreurPasse extends Error {
  code: 'table_absente' | 'deja_en_cours'
  constructor(code: 'table_absente' | 'deja_en_cours') {
    super(code === 'table_absente' ? 'Tables des besoins absentes (migration 20261106120000 non appliquee).' : 'Une passe de reperage tourne deja.')
    this.code = code
  }
}

export type OptionsPasse = {
  /** Essai : lit et classe, n'ecrit rien (ni carte, ni demande, ni curseur, ni journal des passes). */
  essai: boolean
  max: number
  apres: SuitePasse | null
  /** Qui lance (compte du cockpit, ou 'script') : journal des passes et trace d'usage. */
  par: string
  /** Au-dela, plus aucun appel du modele n'est lance (Vercel coupe a 60 s). */
  budgetMs?: number
}

/** Un besoin vu par la passe (ce qui est, ou serait en essai, enregistre). */
export type BesoinVu = {
  fil_id: string
  app: string
  membre_ref: string
  outil: OutilBesoin
  nature: string
  titre: string
  cle: string
  carte: { cle: string; titre: string; nouvelle: boolean }
  resume: string
  texte_membre: string
  messages: number
  suspect: boolean
  suspect_raison: string | null
  /** Deja enregistree (meme carte, meme fil, meme texte) : rien n'a ete ajoute. */
  deja: boolean
}

export type ResultatPasse = {
  essai: boolean
  /** Essai lance avant la migration : sans curseur ni carte existante. */
  sans_tables: boolean
  fils_lus: number
  messages_lus: number
  messages_ignores: number
  appels_ia: number
  cout_micros: number
  besoins: BesoinVu[]
  besoins_trouves: number
  demandes_creees: number
  cartes_creees: number
  suspects: number
  erreurs: number
  /** Fils encore a relire apres `suite`. */
  restants: number
  /** A repasser en `apres` pour continuer (null = rien de lu). */
  suite: SuitePasse | null
  /** Le budget de temps a coupe la passe avant la fin du paquet de fils. */
  coupe: boolean
}

/**
 * Une passe : les fils plus recents que leur curseur (au plus `max`), leurs
 * messages du membre posterieurs au curseur, classes par paquets (un appel du
 * modele par paquet), puis regroupement, insertion et avancement des curseurs.
 * Un fil dont un paquet ou une ecriture a echoue garde son curseur (relu la
 * prochaine fois, les demandes deja ecrites ne comptent pas deux fois).
 */
export async function repererBesoins(o: OptionsPasse, depots: Depots): Promise<ResultatPasse> {
  const debut = depots.maintenant()
  const budget = o.budgetMs ?? 40_000
  const tables = await depots.tablesPresentes()
  if (!tables && !o.essai) throw new ErreurPasse('table_absente')
  const passeId = o.essai ? null : await depots.ouvrirPasse(o.par)
  if (!o.essai && !passeId) throw new ErreurPasse('deja_en_cours')

  const r: ResultatPasse = {
    essai: o.essai, sans_tables: !tables, fils_lus: 0, messages_lus: 0, messages_ignores: 0, appels_ia: 0, cout_micros: 0,
    besoins: [], besoins_trouves: 0, demandes_creees: 0, cartes_creees: 0, suspects: 0, erreurs: 0, restants: 0, suite: null, coupe: false,
  }
  const ctx = contexteRegroupement(depots, { essai: o.essai, creePar: 'reperage', qui: o.par })
  try {
    const fils = await depots.lireFils({ max: o.max, apres: o.apres, avecCurseurs: tables })
    const connues = tables && fils.length ? await depots.empreintesConnues(fils.map(f => f.id)) : new Map<string, Set<string>>()
    const lectures = new Map<string, LectureFil>()
    const aClasser: FilAClasser[] = []
    for (const f of fils) {
      const l = messagesAClasser(f.messages, f.curseur, connues.get(f.id))
      lectures.set(f.id, l)
      if (l.nouveaux.length) aClasser.push({ filId: f.id, app: f.app, messages: l.nouveaux })
    }
    const parId = new Map(fils.map(f => [f.id, f]))
    // Fils traites (curseur a avancer) et fils tentes (pour la suite).
    const tentes = new Set<string>(fils.filter(f => !lectures.get(f.id)?.nouveaux.length).map(f => f.id))
    const echecs = new Set<string>()

    for (const paquet of decouperEnPaquets(aClasser)) {
      if (depots.maintenant() - debut > budget) {
        r.coupe = true
        break
      }
      for (const f of paquet) tentes.add(f.filId)
      const { requete, numeros } = requeteReperage(paquet)
      let besoins: BesoinRepere[]
      try {
        const rep = await depots.appelIA(requete, 'besoins_reperage', o.par)
        r.appels_ia++
        r.cout_micros += rep.coutMicros
        const lu = lireReponseReperage(rep.texte, numeros)
        if (lu.illisible) throw new Error('reponse du modele illisible')
        besoins = lu.besoins
      } catch (err) {
        for (const f of paquet) echecs.add(f.filId)
        r.erreurs += paquet.length
        depots.journal(`paquet de ${paquet.length} fil(s) non classe : ${erreurCourte(err)}`)
        continue
      }
      for (const b of besoins) {
        r.besoins_trouves++
        const parFil = new Map<string, Set<number>>()
        for (const rep of b.reperes) {
          const s = parFil.get(rep.filId) ?? new Set<number>()
          s.add(rep.index)
          parFil.set(rep.filId, s)
        }
        for (const [filId, indexes] of parFil) {
          const f = parId.get(filId)
          const lecture = lectures.get(filId)
          if (!f || !lecture) continue
          const msgs = lecture.nouveaux.filter(m => indexes.has(m.index)).sort((x, y) => x.index - y.index)
          if (!msgs.length) continue
          const texte = texteDeDemande(msgs.map(m => m.texte))
          const analyse = analyseDemande(texte)
          if (analyse.suspect) r.suspects++
          let carte: CarteRetenue
          try {
            carte = await regrouper(b, ctx)
          } catch (err) {
            echecs.add(filId)
            r.erreurs++
            depots.journal(`regroupement en echec : ${erreurCourte(err)}`)
            continue
          }
          if (carte.creee) r.cartes_creees++
          const vu: BesoinVu = {
            fil_id: filId, app: f.app, membre_ref: f.userId, outil: b.outil, nature: b.nature, titre: b.titre, cle: b.cle,
            carte: { cle: carte.cle, titre: carte.titre, nouvelle: carte.nouvelle }, resume: b.resume, texte_membre: texte,
            messages: msgs.length, suspect: analyse.suspect, suspect_raison: analyse.raison, deja: false,
          }
          if (!o.essai && carte.id) {
            try {
              const id = await depots.insererDemande({
                besoinId: carte.id, canal: f.app === 'telegram' ? 'telegram' : 'chat', app: f.app || null, filId, membreRef: f.userId,
                membreId: f.membreId, texte, empreinte: empreinteTexte(texte), empreintesMessages: msgs.map(m => m.empreinte),
                resume: b.resume, detectePar: 'reperage', suspect: analyse.suspect, suspectRaison: analyse.raison, texteVisible: analyse.visible,
              })
              if (id) r.demandes_creees++
              else vu.deja = true
            } catch (err) {
              echecs.add(filId)
              r.erreurs++
              depots.journal(`demande non enregistree : ${erreurCourte(err)}`)
            }
          }
          r.besoins.push(vu)
        }
      }
    }

    // Les fils tentes, dans l'ordre : compteurs, curseurs (hors essai), suite.
    let derniereSuite: SuitePasse | null = o.apres
    for (const f of fils) {
      if (!tentes.has(f.id)) break
      derniereSuite = { maj: f.maj, id: f.id }
      const l = lectures.get(f.id)
      r.fils_lus++
      r.messages_lus += l?.nouveaux.length ?? 0
      r.messages_ignores += l?.ignores ?? 0
      if (o.essai || echecs.has(f.id) || !l) continue
      try {
        await depots.avancerCurseur({ filId: f.id, maj: f.maj, messagesLus: l.messagesLus, dernierAt: l.dernierAt, passeId })
      } catch (err) {
        r.erreurs++
        depots.journal(`curseur non avance : ${erreurCourte(err)}`)
      }
    }
    r.suite = derniereSuite
    r.appels_ia += ctx.cout.appels
    r.cout_micros += ctx.cout.micros
    r.restants = await depots.compterRestants({ apres: r.suite, avecCurseurs: tables })
  } catch (err) {
    if (passeId) {
      await depots.fermerPasse(passeId, bilanDe(r, erreurCourte(err))).catch(() => {})
    }
    throw err
  }
  if (passeId) {
    try {
      await depots.fermerPasse(passeId, bilanDe(r, null))
    } catch (err) {
      depots.journal(`journal de passe non ferme : ${erreurCourte(err)}`)
    }
  }
  return r
}

function bilanDe(r: ResultatPasse, erreur: string | null): BilanPasse {
  return {
    fils_lus: r.fils_lus, messages_lus: r.messages_lus, besoins_trouves: r.besoins_trouves, demandes_creees: r.demandes_creees,
    cartes_creees: r.cartes_creees, suspects: r.suspects, erreurs: r.erreurs, restants: r.restants, erreur,
  }
}
