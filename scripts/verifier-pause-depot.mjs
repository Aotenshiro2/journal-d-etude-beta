// Tests de la « PAUSE DE L'ABONNEMENT + ACCES PAR DEPOT BROKER » (01/11, cas
// d'Arthur : abonne depuis le 07/06, renouvellement le 07/11/2026) :
// - les conditions vides : rien d'invente (aucun broker, lien, minimum ni lots) ;
// - la lecture stricte des parametres de la carte ;
// - les dates alignees : reprise = fin payee + N mois = dernier jour de l'acces ;
// - le refus 'deja_abonne' leve pour CE parcours seulement ;
// - le clic avec un FAUX STRIPE et une FAUSSE BASE : l'ordre (acces et depot,
//   puis la pause, puis le message), une pause refusee (la carte redemandee
//   ne fait que ce qui manque), une periode renouvelee entre la carte et le
//   clic, un depot deja inscrit relie, les refus ;
// - pas de sortie du groupe, jour par jour, du clic a apres la reprise (le
//   vrai calcul du droit d'un abonnement, resumerAbonnement) ;
// - le rappel J-7 et la reprise ;
// - les cartes (longue, courte), les textes au membre et a l'equipe ;
// - le cablage : Agent AOK (outil, prompt, controle, filet sansNomsOutils),
//   bot des membres, droits, lots, passage, resume, vue calculee, API de Tab.
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-pause-depot.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const PD = await import('../src/lib/liveclub/pause-depot-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const R = await import('../src/lib/liveclub/passage-regles.ts')
const CFG = await import('../src/lib/liveclub/config.ts')
const AP = await import('../src/lib/agent-cockpit-pur.ts')
const M = await import('../src/lib/liveclub/prompt-membre.ts')
const V = await import('../src/lib/vues-serveur.ts')
const RS = await import('../src/lib/liveclub/resume-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

/** Les caracteres hors clavier, construits par leur code : le fichier n'en contient aucun. */
const classe = (codes) => new RegExp(`[${codes.map(c => String.fromCharCode(c)).join('')}]`)
const HORS_CLAVIER = classe([0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x2022])
const INVISIBLES = classe([0x00a0, 0x202f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])

function texteClavier(t, nom) {
  assert.ok(!HORS_CLAVIER.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!INVISIBLES.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
  assert.ok(!/\bbann?(i|ir|issement)?\b/i.test(t), `${nom} : ban`)
}
/** Un texte AU MEMBRE : clavier, et pas de « jamais » (regle de Brice). */
function texteMembre(t, nom) {
  texteClavier(t, nom)
  assert.ok(!/\bjamais\b/i.test(t), `${nom} : « jamais » dans un texte au membre`)
}
/** Aucun nom d'outil ni de parametre dans un texte rendu a l'equipe. */
function sansOutil(t, nom) {
  assert.ok(!/proposer_|pause_par_depot|email_abonnement|requete_sql|abonnement_id/.test(t), `${nom} : nom d'outil ou de parametre`)
}

// ---------------------------------------------------------------------------
// Fixtures (adresses fictives)
// ---------------------------------------------------------------------------

const AUJ = '2026-11-01'
const ARTHUR = 'arthur.essai@exemple.fr'
const SUB = 'sub_ArthurEssai0001'
const TG = 5026707870
const ACCES = '11111111-2222-4333-8444-555555555555'
const COMMISSION = '22222222-3333-4444-8555-666666666666'
/** Renouvellement le 07/11/2026 (fin de la periode payee). */
const FIN_ISO = '2026-11-07T10:00:00.000Z'

const abonnement = (o = {}) => ({
  id: SUB, statut: 'active', finPeriode: FIN_ISO, arretPrevu: false, pauseActive: false, pauseJusquau: null,
  pausePayeJusquau: null, clientStripe: 'cus_ArthurEssai01', tarif: '49 € par mois', ...o,
})
const params = (o = {}) => {
  const p = PD.lireParamsPauseDepot({ partenaire: 'RaiseFx', email: ARTHUR, client: 'Arthur', montant: 500, le: AUJ, commission: 400, ...o }, { aujourdhui: AUJ })
  assert.equal(typeof p, 'object', `parametres refuses : ${p}`)
  return p
}
const VIDE = { acces: null, depot: null, pauseDuParcours: null }

/** La carte telle que le controle la pose (abonnement, dates, compte Telegram), relue par lireParamsPauseDepot. */
function carte(a = abonnement(), base = VIDE, o = {}) {
  const p = params(o)
  const etapes = PD.etapesPauseDepot({ abonnement: a, base, email: p.email })
  assert.equal(typeof etapes, 'object', `etapes refusees : ${etapes}`)
  const plan = PD.datesPauseDepot(a, etapes, p.mois)
  return params({ ...o, abonnement_id: a.id, paye_jusquau: plan.payeJusquau, reprise_le: plan.repriseLe, telegram_id: TG })
}

/** Un faux Stripe et une fausse base, en memoire, avec le journal des appels. */
function monde(o = {}) {
  const etat = {
    abonnement: abonnement(o.abonnement), acces: o.acces ?? null, depot: o.depot ?? null, pauseDuParcours: o.pauseDuParcours ?? null,
    appels: [], message: null, marqueur: null,
  }
  const outils = {
    aujourdhui: AUJ,
    async lireAbonnement(id) { etat.appels.push('lireAbonnement'); return id === etat.abonnement.id ? { ...etat.abonnement } : null },
    async lireBase() { etat.appels.push('lireBase'); return { acces: etat.acces, depot: etat.depot, pauseDuParcours: etat.pauseDuParcours } },
    async poserAccesEtDepot(x) {
      etat.appels.push(`acces:${x.etapes.acces}/depot:${x.etapes.depot}`)
      if (x.etapes.acces === 'poser') {
        etat.acces = { accesId: ACCES, jusquau: x.repriseLe, actif: true, abonnementDuParcours: x.abonnement.id, telegramId: x.telegramId }
      } else etat.acces = { ...etat.acces, jusquau: x.repriseLe }
      if (x.etapes.depot !== 'garder') etat.depot = { commissionId: etat.depot?.commissionId ?? COMMISSION, accesId: etat.acces.accesId }
      etat.marqueur = { repriseLe: x.repriseLe, payeJusquau: x.payeJusquau, telegramId: x.telegramId }
      return { accesId: etat.acces.accesId, commissionId: etat.depot.commissionId }
    },
    async poserPause(id, mois) {
      etat.appels.push(`pause:${mois}`)
      if (o.pauseRefusee) throw new Error(o.pauseRefusee)
      // Le faux Stripe applique la regle de toute pause (calculerReprisePause), ou une autre date imposee.
      const finSec = Math.floor(Date.parse(etat.abonnement.finPeriode) / 1000)
      const reprise = o.repriseStripe ?? P.dateIso(P.calculerReprisePause(finSec, mois))
      etat.abonnement = { ...etat.abonnement, pauseActive: true, pauseJusquau: `${reprise}T10:00:00.000Z`, pausePayeJusquau: etat.abonnement.finPeriode }
      return { payeJusquau: etat.abonnement.finPeriode.slice(0, 10), repriseLe: reprise }
    },
    async alignerAcces(accesId, jusquau) { etat.appels.push(`aligner:${jusquau}`); etat.acces = { ...etat.acces, jusquau } },
    async journaliserPause(x) { etat.appels.push('journal:pause'); etat.pauseDuParcours = x.plan.repriseLe },
    async prevenirMembre(x) { etat.appels.push('message'); etat.message = x; return o.message ?? 'prive' },
  }
  return { etat, outils }
}

// ---------------------------------------------------------------------------

await bloc("conditions vides : l'offre en attente de Mel, rien d'invente, l'equipe prevenue", () => {
  // La configuration nommee, vide tant que Mel n'a pas donne les conditions.
  assert.deepEqual({ ...CFG.OFFRE_PAUSE_DEPOT }, { partenaire: '', lien: '', depotMinimum: '', lots: '' })
  assert.equal(PD.conditionsCompletes(), false)
  const { texte, equipe } = PD.texteOffrePauseDepot()
  assert.equal(equipe, true)
  assert.match(texte, /^Oui, c'est possible ! En faisant un dépôt chez notre broker partenaire, tu as 6 mois de Live Club offerts\./)
  assert.match(texte, /ton abonnement est en pause : rien n'est prélevé, et tu restes dans le groupe, sans coupure/)
  assert.match(texte, /c'est l'équipe qui te les envoie, ici même : je viens de la prévenir\.$/)
  // Rien d'invente : ni broker, ni lien, ni montant, ni lots.
  assert.ok(!/raisefx|https?:|€|EUR|\d+ lots|NAS/i.test(texte), texte)
  texteMembre(texte, 'offre sans conditions')
  // Une seule condition manque (ou un lien qui n'est pas une adresse) : toujours rien.
  const presque = { partenaire: 'RaiseFx', lien: '', depotMinimum: '500 EUR', lots: '2 lots sur le NAS' }
  assert.equal(PD.conditionsCompletes(presque), false)
  assert.ok(!/RaiseFx|500/.test(PD.texteOffrePauseDepot(presque).texte))
  assert.equal(PD.conditionsCompletes({ ...presque, lien: 'raisefx.com/aok' }), false)
  // Toutes la : elles sont dites telles quelles, le lien en fin de ligne, et l'equipe n'est pas derangee.
  const completes = { ...presque, lien: 'https://exemple.test/aok' }
  const ok = PD.texteOffrePauseDepot(completes)
  assert.equal(ok.equipe, false)
  assert.match(ok.texte, /En faisant un dépôt chez RaiseFx, notre broker partenaire/)
  assert.match(ok.texte, /un dépôt d'au moins 500 EUR, puis tes premiers lots à trader \(2 lots sur le NAS\)\. Pour ouvrir ton compte, passe par ce lien : https:\/\/exemple\.test\/aok\n/)
  texteMembre(ok.texte, 'offre avec conditions')
  // La reponse du serveur au membre, selon son etat relu.
  const r = (etat, etape) => PD.reponseMembrePauseDepot(etat, etape)
  assert.deepEqual(r({ genre: 'abonne' }, 'renseignement'), { texte, equipe: true, regle: 'pause_depot_demande' })
  assert.deepEqual(r({ genre: 'abonne' }, 'depot_fait'), { texte: PD.TEXTE_DEPOT_DECLARE_PAUSE, equipe: true, regle: 'pause_depot_declare' })
  assert.equal(r({ genre: 'pas_abonne' }, 'renseignement').equipe, true)
  assert.deepEqual(r({ genre: 'panne' }, 'depot_fait'), { texte: PD.TEXTE_PANNE_PAUSE_DEPOT, equipe: false, regle: null })
  const enPlace = r({ genre: 'en_place', partenaire: 'RaiseFx', repriseLe: '2027-05-07' }, 'renseignement')
  assert.equal(enPlace.equipe, false)
  assert.match(enPlace.texte, /court jusqu'au 7 mai 2027, et tu gardes le groupe jusque-là/)
  for (const t of [PD.TEXTE_DEPOT_DECLARE_PAUSE, PD.TEXTE_PAS_ABONNE_PAUSE, PD.TEXTE_PANNE_PAUSE_DEPOT, enPlace.texte]) texteMembre(t, t.slice(0, 30))
  // L'etape : depot_fait seulement si c'est dit.
  assert.equal(PD.lireEtapeMembre({ etape: 'depot_fait' }), 'depot_fait')
  assert.equal(PD.lireEtapeMembre({ etape: 'autre chose' }), 'renseignement')
  assert.equal(PD.lireEtapeMembre(null), 'renseignement')
})

await bloc('parametres de la carte : lecture stricte, refus clairs', () => {
  const p = params({ email: '  Arthur.Essai@Exemple.FR ', email_abonnement: 'arthur.essai@exemple.fr', partenaire: 'Raise FX' })
  assert.equal(p.email, ARTHUR)
  assert.equal(p.email_abonnement, null, 'la meme adresse ne compte pas deux fois')
  assert.equal(p.partenaire, 'raisefx')
  assert.equal(p.mois, 6)
  assert.equal(p.commission, 400)
  assert.equal(params({ email_abonnement: 'arthur.abonnement@exemple.fr' }).email_abonnement, 'arthur.abonnement@exemple.fr')
  const refus = (o) => PD.lireParamsPauseDepot({ partenaire: 'RaiseFx', email: ARTHUR, montant: 500, ...o }, { aujourdhui: AUJ })
  assert.match(refus({ email: '' }), /^email : l'adresse du membre chez le broker/)
  assert.match(refus({ partenaire: '' }), /^partenaire : /)
  assert.match(refus({ montant: 0 }), /^montant \(le dépôt\) : un montant positif\./)
  assert.match(refus({ mois: 7 }), /^mois : la durée en mois entiers, de 1 à 6/)
  assert.match(refus({ mois: 2.5 }), /^mois : /)
  assert.match(refus({ le: '2026-11-02' }), /est dans le futur/)
  assert.match(refus({ email_abonnement: 'pas une adresse' }), /^email_abonnement : /)
  assert.equal(params({ mois: '4' }).mois, 4)
  // Les champs du controle, relus seulement s'ils sont bien formes.
  const c = params({ abonnement_id: SUB, paye_jusquau: '2026-11-07', reprise_le: '2027-05-07', telegram_id: TG })
  assert.deepEqual([c.abonnement_id, c.paye_jusquau, c.reprise_le, c.telegram_id], [SUB, '2026-11-07', '2027-05-07', TG])
  const d = params({ abonnement_id: 'cus_x', paye_jusquau: '7/11', telegram_id: -3 })
  assert.equal(d.abonnement_id, undefined)
  assert.equal(d.paye_jusquau, undefined)
  assert.equal(d.telegram_id, null)
  // Le log : ni email, ni nom, ni note.
  const log = JSON.stringify(PD.paramsPourLogPauseDepot({ ...c, note: 'secret' }))
  assert.ok(!log.includes('arthur') && !log.includes('Arthur') && !log.includes('secret'), log)
})

await bloc("dates alignees (cas d'Arthur) : payé jusqu'au 07/11/2026, reprise et fin d'accès le 07/05/2027", () => {
  const plan = PD.planPauseDepot(FIN_ISO, 6)
  assert.deepEqual(plan, { payeJusquau: '2026-11-07', repriseLe: '2027-05-07' })
  // La MEME regle que la pose chez Stripe (preparerPoseDePause, pur.ts) : meme reprise, au jour pres.
  const sub = sousStripe()
  const pose = P.preparerPoseDePause(sub, 6)
  assert.equal(P.dateIso(pose.reprise), plan.repriseLe)
  assert.equal(pose.corps['pause_collection[behavior]'], 'void', 'aucune facture encaissee pendant la pause')
  assert.equal(P.dateIso(new Date(Number(pose.corps['pause_collection[resumes_at]']) * 1000)), plan.repriseLe)
  // Les autres durees, et un 31 (comportement deja en service : le debordement de setUTCMonth).
  assert.deepEqual(PD.planPauseDepot('2026-11-07T10:00:00Z', 1), { payeJusquau: '2026-11-07', repriseLe: '2026-12-07' })
  assert.equal(PD.planPauseDepot('2027-01-31T10:00:00Z', 1).repriseLe, '2027-03-03')
  assert.equal(PD.planPauseDepot(null, 6), null)
  // Le delai des lots : 21 jours a partir de l'acces (il est deja dans le groupe).
  assert.equal(PD.limiteLotsPauseDepot('2026-11-01'), '2026-11-22')
  assert.equal(PD.limiteLotsPauseDepot('2026-10-01'), '2026-11-21', 'jamais avant le suivi des lots')
})

/** L'abonnement Stripe brut d'Arthur (faux Stripe), avant la pause. */
function sousStripe() {
  return {
    id: SUB, status: 'active', customer: 'cus_ArthurEssai01', cancel_at_period_end: false, pause_collection: null, metadata: {},
    start_date: Date.parse('2026-06-07T10:00:00Z') / 1000, created: Date.parse('2026-06-07T10:00:00Z') / 1000,
    items: { data: [{ current_period_end: Date.parse(FIN_ISO) / 1000, quantity: 1, price: { product: CFG.PRODUITS_LIVECLUB[0], unit_amount: 4900, currency: 'eur', recurring: { interval: 'month', interval_count: 1 } } }] },
  }
}

await bloc("le refus 'deja_abonne' leve pour CE parcours seulement", () => {
  // Ce parcours : un abonnement en cours ne bloque pas l'acces, il est le point de depart.
  const e = PD.etapesPauseDepot({ abonnement: abonnement(), base: VIDE, email: ARTHUR })
  assert.deepEqual(e, { acces: 'poser', depot: 'inscrire', pause: 'poser' })
  // Partout ailleurs, le refus tient : accorderAccesBroker (acces.ts) n'a pas change, et ce parcours ne l'appelle pas.
  const acces = lire('src/lib/liveclub/acces.ts')
  assert.match(acces, /if \(abonnements\.some\(abonnementOuvreLeGroupe\)\) return \{ email, resultat: 'deja_abonne' \}/)
  const serveur = lire('src/lib/liveclub/pause-depot.ts')
  assert.ok(!/accorderAccesBroker|accorderUn/.test(serveur), "le parcours ne passe pas par accorderAccesBroker")
  assert.match(serveur, /insert into public\.cockpit_liveclub_acces \(email, motif, source, debut, jusquau, pose_par, note, telegram_id\)\n\s+values \(\$\{o\.p\.email\}, 'broker', \$\{o\.p\.partenaire\}, current_date, \$\{o\.repriseLe\}::date/)
  // La carte de depot broker classique garde son refus pour un abonne.
  assert.match(lire('src/lib/repartition/serveur.ts'), /if \(r\.resultat === 'deja_abonne'\) \{\n\s+issue = 'abonne'/)
  // Non renouvelable : une adresse qui a deja eu un acces broker ORDINAIRE est refusee.
  const deja = PD.etapesPauseDepot({ abonnement: abonnement(), email: ARTHUR, base: { ...VIDE, acces: { accesId: ACCES, jusquau: '2026-09-30', actif: false, abonnementDuParcours: null, telegramId: null } } })
  assert.match(deja, /a déjà eu un accès broker \(jusqu'au 30 septembre 2026\) : non renouvelable, rien n'est proposé\./)
})

await bloc('refus avant la carte et au clic : abonnement, arret, impaye, pause deja posee, depot ailleurs, tout fait', () => {
  const e = (a, base = VIDE) => PD.etapesPauseDepot({ abonnement: abonnement(a), base, email: ARTHUR })
  assert.match(e({ statut: 'past_due' }), /Son dernier paiement n'est pas passé/)
  assert.match(e({ statut: 'canceled' }), /« canceled »/)
  assert.match(e({ arretPrevu: true }), /Un arrêt est programmé sur son abonnement \(fin le 7 novembre 2026\) : il faut d'abord l'annuler/)
  assert.match(e({ pauseActive: true, pauseJusquau: '2027-01-07T10:00:00Z' }), /Une pause est déjà posée sur son abonnement \(reprise le 7 janvier 2027\)/)
  assert.match(e({ finPeriode: null }), /Fin de période introuvable/)
  const autre = { commissionId: COMMISSION, accesId: '99999999-2222-4333-8444-555555555555' }
  assert.match(e({}, { ...VIDE, depot: autre }), /déjà inscrit sur un autre accès broker/)
  // Un depot deja inscrit pour un abonne (carte de depot classique, sans acces) : relie, pas inscrit deux fois.
  assert.deepEqual(e({}, { ...VIDE, depot: { commissionId: COMMISSION, accesId: null } }), { acces: 'poser', depot: 'relier', pause: 'poser' })
  // Tout deja fait par ce parcours.
  const notre = { accesId: ACCES, jusquau: '2027-05-07', actif: true, abonnementDuParcours: SUB, telegramId: TG }
  const tout = e({ pauseActive: true, pauseJusquau: '2027-05-07T10:00:00Z', pausePayeJusquau: FIN_ISO },
    { acces: notre, depot: { commissionId: COMMISSION, accesId: ACCES }, pauseDuParcours: '2027-05-07' })
  assert.match(tout, /^Tout est déjà en place : accès broker jusqu'au 7 mai 2027/)
  // L'acces de ce parcours retire ou fini : rien n'est refait.
  assert.match(e({}, { ...VIDE, acces: { ...notre, actif: false } }), /retiré ou terminé : rien n'est refait/)
})

await bloc("le clic, faux Stripe et fausse base : acces et depot, PUIS la pause, PUIS le message ; dates alignees", async () => {
  const { etat, outils } = monde()
  const issue = await PD.executerPauseDepotAvec(carte(), outils)
  assert.deepEqual(etat.appels, ['lireAbonnement', 'lireBase', 'acces:poser/depot:inscrire', 'pause:6', 'journal:pause', 'message'])
  assert.deepEqual(issue.plan, { payeJusquau: '2026-11-07', repriseLe: '2027-05-07' })
  // L'acces court jusqu'au jour de la reprise INCLUS, relie a son compte Telegram.
  assert.equal(etat.acces.jusquau, '2027-05-07')
  assert.equal(etat.acces.telegramId, TG)
  assert.equal(etat.abonnement.pauseJusquau.slice(0, 10), etat.acces.jusquau, 'reprise = fin de l acces')
  assert.equal(issue.aligne, false)
  assert.equal(issue.message, 'prive')
  assert.equal(etat.message.email, ARTHUR)
  // Le resultat pour l'equipe : ce qui est fait, et l'etape suivante.
  const res = PD.resultatPauseDepot(issue, { qui: 'Arthur', partenaire: 'RaiseFx', phraseCommission: 'Commission attendue : 400 € (commission propre à ce dépôt).' })
  assert.match(res, /^C'est fait pour Arthur : dépôt inscrit, accès broker posé jusqu'au 7 mai 2027 inclus, abonnement en pause \(payé jusqu'au 7 novembre 2026, reprise automatique le 7 mai 2027\)\. Il garde le groupe tout du long\./)
  assert.match(res, /Il a reçu le message en privé/)
  assert.match(res, /Ensuite, rien à faire : dis-moi quand il a fait ses lots chez RaiseFx\.$/)
  texteClavier(res, 'resultat')
  sansOutil(res, 'resultat')
})

await bloc('le clic : Stripe refuse la pause, puis la carte redemandee ne fait que la pause', async () => {
  const { etat, outils } = monde({ pauseRefusee: 'Your account cannot currently make live charges.' })
  await assert.rejects(PD.executerPauseDepotAvec(carte(), outils), (err) => {
    assert.ok(err instanceof PD.PausePasPosee)
    assert.match(err.message, /accès broker posé jusqu'au 7 mai 2027 et dépôt inscrit, mais la pause n'est PAS posée chez Stripe/)
    assert.match(err.message, /Redemande-moi la même carte : elle ne fera que la pause\.$/)
    texteClavier(err.message, 'pause pas posee')
    sansOutil(err.message, 'pause pas posee')
    return true
  })
  assert.deepEqual(etat.appels, ['lireAbonnement', 'lireBase', 'acces:poser/depot:inscrire', 'pause:6'])
  assert.equal(etat.message, null, 'aucun message tant que la pause manque')
  // La carte redemandee (le controle relit : acces et depot de CE parcours).
  const base = { acces: etat.acces, depot: etat.depot, pauseDuParcours: null }
  assert.deepEqual(PD.etapesPauseDepot({ abonnement: abonnement(), base, email: ARTHUR }), { acces: 'garder', depot: 'garder', pause: 'poser' })
  const encore = monde({ acces: etat.acces, depot: etat.depot })
  const issue = await PD.executerPauseDepotAvec(carte(abonnement(), base), encore.outils)
  assert.deepEqual(encore.etat.appels, ['lireAbonnement', 'lireBase', 'pause:6', 'journal:pause', 'message'])
  assert.deepEqual(issue.etapes, { acces: 'garder', depot: 'garder', pause: 'poser' })
  assert.match(PD.resultatPauseDepot(issue, { qui: 'Arthur', partenaire: 'RaiseFx', phraseCommission: null }), /: dépôt déjà inscrit, accès broker jusqu'au 7 mai 2027 inclus, abonnement en pause/)
})

await bloc('le clic : la reponse de Stripe perdue (pause posee quand meme), la carte redemandee note la pause et previent', async () => {
  // Etat apres le premier clic : acces et depot du parcours, pause posee chez Stripe, rien au journal, aucun message.
  const notre = { accesId: ACCES, jusquau: '2027-05-07', actif: true, abonnementDuParcours: SUB, telegramId: TG }
  const posee = { pauseActive: true, pauseJusquau: '2027-05-07T10:00:00.000Z', pausePayeJusquau: FIN_ISO }
  const base = { acces: notre, depot: { commissionId: COMMISSION, accesId: ACCES }, pauseDuParcours: null }
  assert.deepEqual(PD.etapesPauseDepot({ abonnement: abonnement(posee), base, email: ARTHUR }), { acces: 'garder', depot: 'garder', pause: 'garder' })
  const { etat, outils } = monde({ abonnement: posee, acces: notre, depot: base.depot })
  const issue = await PD.executerPauseDepotAvec(carte(abonnement(posee), base), outils)
  assert.deepEqual(etat.appels, ['lireAbonnement', 'lireBase', 'journal:pause', 'message'])
  assert.deepEqual(issue.plan, { payeJusquau: '2026-11-07', repriseLe: '2027-05-07' })
  // Une fois tout note : la carte suivante est refusee, rien a refaire.
  assert.match(PD.etapesPauseDepot({ abonnement: abonnement(posee), base: { ...base, pauseDuParcours: '2027-05-07' }, email: ARTHUR }), /^Tout est déjà en place/)
  // Une pause d'une AUTRE date sur cet abonnement n'est pas la sienne : refus.
  assert.match(PD.etapesPauseDepot({ abonnement: abonnement({ ...posee, pauseJusquau: '2027-02-07T10:00:00Z' }), base, email: ARTHUR }), /Une pause est déjà posée/)
})

await bloc("le clic : periode renouvelee depuis la carte = refus, rien n'est fait ; Stripe pose une autre date = acces aligne", async () => {
  const c = carte()
  const { etat, outils } = monde({ abonnement: { finPeriode: '2026-12-07T10:00:00.000Z' } })
  await assert.rejects(PD.executerPauseDepotAvec(c, outils), (err) => {
    assert.ok(err instanceof PD.RefusPauseDepot)
    assert.match(err.message, /Les dates de son abonnement ont changé depuis la carte \(payé jusqu'au 7 décembre 2026, reprise le 7 juin 2027\) : redemande la carte, rien n'a été fait\./)
    return true
  })
  assert.deepEqual(etat.appels, ['lireAbonnement', 'lireBase'])
  // Le filet : si Stripe posait une autre reprise, l'acces suivrait (jamais de trou).
  const autre = monde({ repriseStripe: '2027-05-08' })
  const issue = await PD.executerPauseDepotAvec(carte(), autre.outils)
  assert.ok(autre.etat.appels.includes('aligner:2027-05-08'))
  assert.equal(autre.etat.acces.jusquau, '2027-05-08')
  assert.equal(issue.aligne, true)
  // Une carte sans lecture de l'abonnement (jamais passee par le controle) : refus.
  await assert.rejects(PD.executerPauseDepotAvec(params(), monde().outils), /Carte sans lecture de l'abonnement/)
  // L'abonnement n'existe plus : refus.
  await assert.rejects(PD.executerPauseDepotAvec(carte(), monde({ abonnement: { id: 'sub_Autre0000000' } }).outils), /introuvable chez Stripe/)
  // Un depot deja inscrit sans acces : relie au nouvel acces, la commission ne compte qu'une fois.
  const relie = monde({ depot: { commissionId: COMMISSION, accesId: null } })
  await PD.executerPauseDepotAvec(carte(abonnement(), { ...VIDE, depot: { commissionId: COMMISSION, accesId: null } }), relie.outils)
  assert.ok(relie.etat.appels.includes('acces:poser/depot:relier'))
  assert.deepEqual(relie.etat.depot, { commissionId: COMMISSION, accesId: ACCES })
})

await bloc('pas de sortie du groupe, jour par jour : du clic (01/11) a apres la reprise (07/05), aucun trou', () => {
  // Le faux Stripe apres la pose : pause_collection et les metadonnees, dans le meme appel (preparerPoseDePause).
  const avant = sousStripe()
  const pose = P.preparerPoseDePause(avant, 6)
  const metadata = Object.fromEntries(Object.entries(pose.corps)
    .filter(([k]) => k.startsWith('metadata['))
    .map(([k, v]) => [k.slice('metadata['.length, -1), v]))
  const reprisesMs = Number(pose.corps['pause_collection[resumes_at]']) * 1000
  const plan = PD.planPauseDepot(FIN_ISO, 6)
  const debutAcces = AUJ
  const vraiNow = Date.now
  let jours = 0
  try {
    for (let t = Date.parse(`${AUJ}T07:00:00Z`); t <= Date.parse('2027-05-12T07:00:00Z'); t += 86_400_000) {
      Date.now = () => t
      const jour = new Date(t).toISOString().slice(0, 10)
      // Avant le clic (01/11 a 7 h) l'abonnement n'a pas de pause ; apres la reprise, Stripe l'enleve.
      const sub = jour === AUJ ? avant
        : t >= reprisesMs ? { ...avant, metadata }
          : { ...avant, metadata, pause_collection: { behavior: 'void', resumes_at: reprisesMs / 1000 } }
      const a = P.resumerAbonnement(sub, CFG.PRODUITS_LIVECLUB)
      const parAbonnement = P.abonnementOuvreLeGroupeLe(a, t)
      const parAcces = jour >= debutAcces && jour <= plan.repriseLe
      assert.ok(parAbonnement || parAcces, `trou le ${jour}`)
      // Pendant la pause, c'est l'acces broker qui garde le groupe (l'abonnement ne l'ouvre plus) ;
      // apres la reprise, l'abonnement (et rien n'est paye deux fois : behavior void pendant la pause).
      if (jour >= '2026-11-08' && jour <= '2027-05-07') {
        assert.equal(parAbonnement, false, `abonnement en pause le ${jour}`)
        assert.equal(R.pauseASortir(a), true, 'la tache des pauses le regarde, et relit le droit avant toute sortie')
      }
      if (jour >= '2027-05-08') {
        assert.equal(parAbonnement, true, `abonnement repris le ${jour}`)
        assert.equal(parAcces, false)
      }
      // Le rappel J-7 de la reprise : du 30/04 au 07/05, une fois (reservation du passage).
      const rappel = R.repriseAPrevenir(a, new Date(t))
      if (jour >= '2027-04-30' && jour <= '2027-05-07') assert.equal(rappel, '2027-05-07', `rappel le ${jour}`)
      else assert.equal(rappel, null, `pas de rappel le ${jour}`)
      jours++
    }
  } finally {
    Date.now = vraiNow
  }
  assert.ok(jours > 190, `${jours} jours regardes`)
  // Le passage relit le droit avant toute sortie de pause : l'acces broker dit 'oui'.
  const passage = lire('src/lib/liveclub/passage.ts')
  const pauses = passage.slice(passage.indexOf('async function tachePauses'), passage.indexOf('async function tacheRetours'))
  assert.ok(pauses.indexOf('droitAvantSortie(r.telegramId') < pauses.indexOf('await sortir(ctx, r.telegramId'), 'droit relu avant la sortie')
  assert.match(pauses, /if \(droit === 'oui'\) \{ s\.ignores\+\+; continue \}/)
})

await bloc("lots en retard : pas de sortie pour ce parcours, l'equipe prevenue une fois (proposition a valider)", () => {
  assert.equal(PD.SUITE_LOTS_PAUSE_DEPOT, 'equipe', 'la regle proposee (reprise) attend la decision de Brice')
  // Le droit : un acces de ce parcours garde son 'oui' meme lots en retard.
  const droits = lire('src/lib/liveclub/droits.ts')
  assert.match(droits, /if \(etat\?\.etat === 'en_retard' && !etat\.pauseDepot\) \{\n\s+lotsEnPause \?\?= etat\n\s+continue\n\s+\}/)
  // Le marqueur lu dans la meme requete que le suivi des lots.
  const lecture = lire('src/lib/liveclub/lots-lecture.ts')
  assert.match(lecture, /where pd\.geste = 'acces_broker' and pd\.regle = 'pause_depot' and pd\.resultat = 'fait'\n\s+and pd\.details->>'acces_id' = a\.acces_id::text\) as pause_depot/)
  assert.match(lecture, /\.\.\.\(l\.pauseDepot \? \{ pauseDepot: true \} : \{\}\)/)
  // Le passage : l'alerte a la place de la sortie, une fois par depot, reservee.
  const passage = lire('src/lib/liveclub/passage.ts')
  assert.match(passage, /if \(phase === 'pause' && l\.pauseDepot\) await alerterLotsPauseDepot\(ctx, l, aujourdhui\)\n\s+else if \(phase === 'pause'\) await mettreEnPauseLots/)
  assert.match(passage, /cle: `liveclub:\$\{REGLE_LOTS_PAUSE_DEPOT\}:\$\{l\.commissionId\}`/)
  assert.match(passage, /modeleRelanceLots\(n, limite, 'telegram', l\.pauseDepot\)/)
  // La declaration de lots : jamais « en pause » pour ce parcours.
  assert.match(lire('src/lib/liveclub/lots.ts'), /const enPause = lotsEnRetard\(ligne\.suivi, aujourdhui\) && !ligne\.pauseDepot/)
  // L'alerte : rien de coupe, la decision a l'equipe.
  const alerte = PD.texteAlerteLotsPauseDepot({ qui: 'Arthur', email: ARTHUR, partenaire: 'RaiseFx', depot: '500 €', depotLe: AUJ, repriseLe: '2027-05-07' })
  assert.match(alerte, /^Lots pas tradés à la fin du délai : Arthur \(arthur\.essai@exemple\.fr\), dépôt de 500 € chez RaiseFx du 1er novembre 2026, abonnement en pause par ce dépôt jusqu'au 7 mai 2027\./)
  assert.match(alerte, /Rien n'a été coupé : il garde le groupe, et son abonnement reste en pause\./)
  assert.match(alerte, /À décider : reprendre son abonnement maintenant \(dis-moi « reprends l'abonnement d'Arthur »\), ou attendre ses lots\.$/)
  assert.match(PD.texteAlerteLotsPauseDepot({ qui: 'Brice', email: null, partenaire: 'RaiseFx', depot: null, depotLe: AUJ, repriseLe: null }), /« reprends l'abonnement de Brice »/)
  texteClavier(alerte, 'alerte lots')
  sansOutil(alerte, 'alerte lots')
  // La consigne de l'agent des membres pour ses lots : il garde le groupe.
  const consigne = M.consigneLots({ etat: 'en_retard', limite: '2026-11-22', declare: false, pauseDepot: true })
  assert.match(consigne, /son abonnement est en pause grâce à son dépôt chez notre broker partenaire/)
  assert.match(consigne, /l'équipe revient vers lui pour la suite de sa pause ; il garde le groupe en attendant\./)
  assert.ok(!/EN PAUSE \(ce n'est pas un bannissement/.test(consigne))
})

await bloc('le rappel J-7 et les relances des lots : textes de ce parcours (prive et email)', () => {
  const tg = PD.modeleRappelPauseDepot('2027-05-07', 'telegram')
  const t = tg.paragraphes.join('\n\n')
  assert.match(t, /ta pause d'abonnement, liée à ton dépôt chez le broker, se termine le 7 mai 2027\. Ce jour-là, ton abonnement reprend tout seul/)
  assert.match(t, /Tu restes dans le groupe, sans coupure : rien à faire de ton côté\./)
  assert.match(t, /Tu préfères arrêter là \? Écris-moi ici avant le 7 mai 2027 : on arrête ton abonnement, et rien ne sera prélevé\./)
  assert.ok(!/revenir dans le groupe/.test(t), 'il ne sort pas : rien a revenir')
  texteMembre(t, 'rappel J-7')
  const em = PD.modeleRappelPauseDepot('2027-05-07', 'email').paragraphes.join('\n\n')
  assert.match(em, /^Bonjour,/)
  assert.match(em, /Vous restez dans le groupe Telegram/)
  assert.match(em, /Répondez à cet email avant le 7 mai 2027/)
  texteMembre(em, 'rappel J-7 email')
  for (const n of [1, 2]) {
    const r = PD.modeleRelanceLotsPauseDepot(n, '2026-11-22', 'telegram', 'https://t.me/aok_liveclub_bot')
    const txt = r.paragraphes.join('\n\n')
    assert.equal(r.boutonBot.data, 'm:lots')
    assert.match(txt, /22 novembre 2026/)
    assert.ok(!/se met en pause|sortie du groupe/.test(txt), `relance ${n} : pas de sortie`)
    texteMembre(txt, `relance ${n}`)
    const e = PD.modeleRelanceLotsPauseDepot(n, '2026-11-22', 'email', 'https://t.me/aok_liveclub_bot').paragraphes.join('\n\n')
    assert.match(e, /^Bonjour,/)
    texteMembre(e, `relance ${n} email`)
  }
  assert.match(PD.modeleRelanceLotsPauseDepot(2, '2026-11-22', 'telegram', '').paragraphes.join(' '), /si les lots ne sont pas faits à cette date, l'équipe revient vers toi pour voir la suite ensemble/)
  // Le passage : le texte de ce parcours pour le J-7 de la pause, et pas de J-7 « fin d'acces broker » en plus.
  const passage = lire('src/lib/liveclub/passage.ts')
  assert.match(passage, /const parDepot = await pauseDepotDeAbonnement\(a\.id\)\.catch\(\(\) => null\)/)
  assert.match(passage, /modeleRappelRepriseDepot\(date\), e => emailRappelRepriseDepot\(e, date\), parDepot\.accesId\)/)
  assert.match(passage, /const reprend = await accesDePauseQuiReprend\(l\.acces_id\)\n\s+if \(reprend === 'inconnu'\) \{ s\.inconnus\+\+; continue \}\n\s+if \(reprend\) \{ s\.ignores\+\+; continue \}/)
  // La reprise : celle de Stripe (resumes_at), rien a faire de notre cote ; l'abonnement reprend et ouvre le groupe (bloc precedent).
  assert.match(lire('src/lib/liveclub/pause-depot.ts'), /return Boolean\(a && statutDonneDroit\(a\.statut\) && a\.pauseActive && !a\.arretPrevu\)/)
})

await bloc('le message au membre apres le clic : depot, dates, groupe garde, reprise ou arret, lots', () => {
  const m = PD.modeleConfirmationPauseDepot({ partenaire: 'RaiseFx', payeJusquau: '2026-11-07', repriseLe: '2027-05-07', limiteLots: '2026-11-22' }, 'telegram', 'https://t.me/aok_liveclub_bot')
  const t = m.paragraphes.join('\n\n')
  assert.match(t, /^Salut ! Ton dépôt chez RaiseFx est bien noté, merci\./)
  assert.match(t, /ta période payée va jusqu'au 7 novembre 2026, puis rien n'est prélevé jusqu'au 7 mai 2027\. Et tu gardes le groupe tout du long, grâce à ton accès par le broker : aucune coupure\./)
  assert.match(t, /Le 7 mai 2027, ton abonnement reprend tout seul\. Une semaine avant, je te fais signe, et si tu préfères arrêter là, il suffira de me le dire\./)
  assert.match(t, /Tu as jusqu'au 22 novembre 2026 pour les faire\./)
  assert.equal(m.boutonBot.data, 'm:lots')
  texteMembre(t, 'message du clic')
  const e = PD.modeleConfirmationPauseDepot({ partenaire: 'RaiseFx', payeJusquau: '2026-11-07', repriseLe: '2027-05-07', limiteLots: null }, 'email', 'https://t.me/aok_liveclub_bot')
  assert.equal(e.boutonBot, undefined)
  assert.match(e.paragraphes.join(' '), /Vous gardez le groupe Telegram tout du long/)
  assert.ok(!/lots/.test(e.paragraphes.join(' ')), 'sans suivi des lots, pas de paragraphe des lots')
  texteMembre(e.paragraphes.join('\n\n'), 'message du clic email')
  // Sa situation (« Mon abonnement ») et la consigne de l'agent : il garde le groupe.
  assert.match(PD.ligneSituationPauseDepot({ partenaire: 'RaiseFx', repriseLe: '2027-05-07' }), /^Cette pause vient de ton dépôt chez RaiseFx : tu gardes le groupe pendant tout ce temps, et ton abonnement reprend tout seul le 7 mai 2027\.$/)
  const c = PD.consignePauseDepotMembre({ partenaire: 'RaiseFx', repriseLe: '2027-05-07' })
  assert.match(c, /il GARDE le groupe pendant tout ce temps, par son accès broker : ce n'est pas une pause classique/)
})

await bloc('les cartes : longue (Brice) et courte (Mel), clavier, sans nom d outil', () => {
  const c = {
    qui: 'Arthur', email: ARTHUR, emailAbonnement: null, telegram: `compte Telegram u${TG}`, tarif: '49 € par mois',
    partenaireNom: 'RaiseFx', montant: 50000, le: AUJ, commission: 40000,
    phraseCommission: 'Commission attendue : 400 € (commission propre à ce dépôt), prévue fin novembre 2026 si Arthur fait ses lots d\'ici là, sinon elle glisse au mois suivant. Part de Mel : 280 €, part de Brice : 120 € (70/30, avant dépenses).',
    payeJusquau: '2026-11-07', repriseLe: '2027-05-07', debutAcces: AUJ, mois: 6, limiteLots: '2026-11-22',
    etapes: { acces: 'poser', depot: 'inscrire', pause: 'poser' },
  }
  const longue = PD.carteLonguePauseDepot(c)
  console.log(`\n--- carte longue ---\n${longue}\n`)
  assert.match(longue, /^Dépôt broker d'un abonné : pause de son abonnement et accès Live Club, en une fois\.\n/)
  assert.match(longue, /Arthur \(arthur\.essai@exemple\.fr, compte Telegram u5026707870\), abonné au Live Club \(49 € par mois\)\./)
  assert.match(longue, /Dépôt de 500 € chez RaiseFx le 1er novembre 2026\. Commission attendue : 400 €/)
  assert.match(longue, /1\. Le dépôt est inscrit, relié à son accès broker : commission figée, mois des lots et 70\/30 comme une carte de dépôt broker\./)
  assert.match(longue, /2\. Accès broker posé du 1er novembre 2026 au 7 mai 2027 inclus, malgré son abonnement en cours, relié à son compte Telegram u5026707870 : aucun email d'invitation, il est déjà dans le groupe\./)
  assert.match(longue, /3\. Son abonnement est mis en pause : période payée jusqu'au 7 novembre 2026, puis aucun prélèvement pendant 6 mois, reprise automatique le 7 mai 2027, le jour où son accès broker se termine\. Pas de trou, pas de double paiement\./)
  assert.match(longue, /4\. Il reste dans le groupe tout du long/)
  assert.match(longue, /relances en privé à J\+14 et J\+18/)
  assert.match(longue, /Lots pas faits à cette date : il garde le groupe \(son abonnement est en pause\), et vous êtes prévenus ici pour décider de la suite/)
  assert.match(longue, /Fin : une semaine avant le 7 mai 2027, il reçoit un rappel : son abonnement reprend ce jour-là, ou il peut arrêter avant\.$/)
  texteClavier(longue, 'carte longue')
  sansOutil(longue, 'carte longue')
  const courte = PD.carteCourtePauseDepot(c)
  console.log(`--- carte courte ---\n${courte}\n`)
  assert.equal(courte, "Dépôt RaiseFx de 500 € le 01/11 pour Arthur, commission 400 €. Abonnement en pause du 07/11 au 7 mai 2027, accès broker jusqu'au même jour : il garde le groupe, reprise toute seule.")
  texteClavier(courte, 'carte courte')
  // Sans compte Telegram relie, et une carte a moitie faite : la carte le dit.
  const sans = { ...c, telegram: null, etapes: { acces: 'poser', depot: 'relier', pause: 'poser' } }
  assert.match(PD.carteLonguePauseDepot(sans), /sur l'adresse arthur\.essai@exemple\.fr : aucun compte Telegram n'est relié à son abonnement/)
  assert.match(PD.carteLonguePauseDepot(sans), /Le dépôt déjà inscrit pour lui est relié à son accès broker \(rien n'est inscrit deux fois\)\./)
  assert.match(PD.carteCourtePauseDepot(sans), /Aucun compte Telegram relié à son abonnement\.$/)
  assert.match(PD.carteCourtePauseDepot({ ...c, etapes: { acces: 'garder', depot: 'garder', pause: 'poser' } }), /Seul ce qui manque sera fait\.$/)
  assert.match(PD.carteLonguePauseDepot({ ...c, limiteLots: null }), /Ses lots : le suivi des lots est coupé, rien ne le relance\./)
})

await bloc('Agent AOK : outil, consigne, controle, bouton, filet sansNomsOutils (tous les outils), exemple d Arthur', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  assert.ok(src.includes("name: 'proposer_pause_depot'"), "l'outil est dans OUTILS")
  const outil = src.slice(src.indexOf("name: 'proposer_pause_depot'"))
  assert.match(outil.slice(0, 4000), /required: \['partenaire', 'email', 'montant'\]/)
  assert.match(outil.slice(0, 4000), /email_abonnement: \{ type: 'string'/)
  assert.match(src, /^\s+proposer_pause_depot: 'pause_depot',$/m)
  // La consigne, avec l'exemple du brief, et jamais trois cartes pour lui.
  assert.match(src, /« Arthur fait un dépôt RaiseFx pour mettre son abonnement en pause »/)
  assert.match(src, /= proposer_pause_depot, UNE carte\. Jamais proposer_depot_broker, proposer_pause_abonnement ni proposer_acces_broker en plus pour lui/)
  assert.match(src, /requete_sql sur la vue cockpit_liveclub_pauses_depot/)
  assert.match(src, /- cockpit_liveclub_pauses_depot \(01\/11, VUE CALCULÉE par le serveur/)
  // Le controle avant la carte, avant celui de la repartition (meme compte cockpit), carte courte pour Mel.
  assert.match(src, /\} else if \(action\.type === 'pause_depot'\) \{\n(.*\n){1,8}\s+controle = await controlerPauseDepot\(action\)/)
  assert.ok(src.indexOf("action.type === 'pause_depot'") < src.indexOf("} else if (action.compte === 'cockpit') {"))
  // Le bouton dit l'action.
  assert.ok(AP.libelleBoutonConfirmer('pause_depot').endsWith(' Pause + accès broker'))
  // Le filet : TOUS les outils d'OUTILS ont leur description, et le nouveau est remplace.
  const noms = [...src.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1])
  for (const nom of noms) assert.ok(AP.DESCRIPTIONS_OUTILS[nom], `outil sans description : ${nom}`)
  assert.ok(noms.includes('proposer_pause_depot'))
  assert.equal(AP.sansNomsOutils('Je te propose proposer_pause_depot pour Arthur.'), "Je te propose la carte « dépôt broker d'un abonné : pause et accès » pour Arthur.")
  assert.equal(AP.sansNomsOutils('Voici la carte `proposer_pause_depot`.'), "Voici la carte « dépôt broker d'un abonné : pause et accès ».")
  // Le prompt compte ses outils d'action : dix-neuf.
  const phrase = /Tu disposes de dix-neuf outils d'action : ([^(]+) \(décrits plus bas\)/.exec(src)
  assert.ok(phrase)
  assert.equal(phrase[1].split(/, | et /).length, 19)
  assert.ok(phrase[1].includes('proposer_pause_depot'))
  // Validation, resume, execution, log.
  const stripe = lire('src/lib/stripe-actions.ts')
  assert.match(stripe, /\| 'pause_depot'/)
  assert.match(stripe, /if \(a\.type === 'pause_depot'\) \{\n\s+const lu = lireParamsPauseDepot\(p, \{ aujourdhui: jourParis\(new Date\(\)\) \}\)\n\s+if \(typeof lu === 'string'\) return lu\n\s+return \{ type: 'pause_depot', compte: 'cockpit', params: \{ \.\.\.lu \} \}/)
  assert.match(stripe, /if \(a\.type === 'pause_depot'\) return paramsPourLogPauseDepot\(a\.params\)/)
  assert.match(stripe, /if \(a\.type === 'pause_depot'\) return resumePauseDepot\(p\)/)
  assert.match(stripe, /const \{ executerPauseDepot \} = await import\('@\/lib\/liveclub\/pause-depot'\)\n\s+return executerPauseDepot\(a, acteur\)/)
  const exec = stripe.slice(stripe.indexOf('export async function executerAction'))
  assert.ok(exec.indexOf("a.type === 'pause_depot'") < exec.indexOf("a.type === 'retirer_telegram'"), 'avant les branches Stripe et Telegram')
  // Le serveur : la pause par le chemin existant (pauser), l'acces avant la pause.
  const serveur = lire('src/lib/liveclub/pause-depot.ts')
  assert.match(serveur, /const issue = await pauser\(id, mois\)/)
  assert.match(serveur, /depotPourPauseDepot\(p\)/)
})

await bloc('bot des membres : outil, consigne, prudence, la reponse du serveur (pas du modele)', () => {
  const noms = M.OUTILS_MEMBRE.map(o => o.name)
  assert.ok(noms.includes('pause_par_depot'))
  const outil = M.OUTILS_MEMBRE.find(o => o.name === 'pause_par_depot')
  assert.deepEqual(outil.input_schema.properties.etape.enum, ['renseignement', 'depot_fait'])
  assert.match(M.SYSTEM_PROMPT_MEMBRE, /- pause_par_depot : un abonné qui veut passer par un dépôt chez notre broker partenaire/)
  assert.match(M.SYSTEM_PROMPT_MEMBRE, /Tu ne donnes jamais toi-même de broker, de lien, de dépôt minimum ni de lots pour cette offre/)
  // La consigne d'une pause du parcours en cours : en dernier bloc system, pour lui seulement.
  const avec = M.requeteAgentMembre([{ role: 'user', content: 'salut' }], undefined, { pauseDepot: { partenaire: 'RaiseFx', repriseLe: '2027-05-07' } })
  assert.match(avec.system.at(-1).text, /il GARDE le groupe pendant tout ce temps/)
  const sans = M.requeteAgentMembre([{ role: 'user', content: 'salut' }])
  assert.ok(!sans.system.some(b => /GARDE le groupe/.test(b.text)))
  const agent = lire('src/lib/liveclub/agent-membre.ts')
  assert.match(agent, /\|\| bloc\.name === NOM_OUTIL_MEMBRE_PAUSE_DEPOT\)\) \{\n\s+resultats\.push\(\{ type: 'tool_result', tool_use_id: bloc\.id, content: JSON\.stringify\(REFUS_PRUDENCE_MEMBRE\) \}\)/)
  assert.match(agent, /const r = await parcoursPauseDepotMembre\(telegramId, bloc\.input\)\n\s+if \(r\.veutHumain\) humain = true/)
  // Le serveur : l'alerte existante (veutHumain), une ligne de demande par 24 h, rien d'ecrit d'autre.
  const serveur = lire('src/lib/liveclub/pause-depot.ts')
  assert.match(serveur, /and fait_le > now\(\) - interval '24 hours'/)
  assert.match(serveur, /return \{ texte: r\.texte, veutHumain: r\.equipe, panne: etat\.genre === 'panne' \}/)
})

await bloc('visibilite : vue calculee pour Agent AOK, API de Tab, resume du matin, fil Support', () => {
  // La vue calculee : un WITH de meme nom, rien sur une requete qui ne la cite pas.
  assert.equal(V.avecVuesServeur('select count(*) from cockpit_paiements'), 'select count(*) from cockpit_paiements')
  const r = V.avecVuesServeur('select nom, reprise_le from public.cockpit_liveclub_pauses_depot where en_cours')
  assert.ok(r.startsWith('with cockpit_liveclub_pauses_depot as (select distinct on (a.acces_id)'), r.slice(0, 120))
  assert.ok(r.endsWith(') select nom, reprise_le from cockpit_liveclub_pauses_depot where en_cours'))
  assert.match(V.SQL_PAUSES_DEPOT, /where g\.geste = 'acces_broker' and g\.regle = 'pause_depot' and g\.resultat = 'fait'/)
  for (const col of ['acces_id', 'telegram_id', 'abonnement_id', 'broker', 'acces_jusquau', 'paye_jusquau', 'reprise_le', 'en_cours']) {
    assert.match(V.SQL_PAUSES_DEPOT, new RegExp(`as ${col}\\b|\\b${col},`), col)
  }
  // Avec une vue gardee dans la meme requete : les deux WITH.
  const deux = V.avecVuesServeur('select * from cockpit_support_threads t join cockpit_liveclub_pauses_depot p on p.telegram_id = t.telegram_id')
  assert.ok(deux.startsWith('with cockpit_support_threads as (select * from public.cockpit_serveur_support_threads()), cockpit_liveclub_pauses_depot as ('))
  // L'API de Tab (GET /membres) et le resume du matin.
  const tab = lire('src/lib/tab/lectures.ts')
  assert.match(tab, /pauses_par_depot_broker: \{/)
  assert.match(tab, /from \(\$\{SQL_PAUSES_DEPOT\}\) v where v\.en_cours order by v\.acces_jusquau limit \$1/)
  const ev = (geste, regle, details = {}) => RS.evenementDeGeste({ id: '1', geste, resultat: 'fait', regle, details, fait_le: '2026-11-01T12:00:00Z', telegram_id: TG, membre_id: null, abonnement_id: SUB })
  assert.deepEqual(ev('acces_broker', 'pause_depot', { jusquau: '2027-05-07' }), { rubrique: 'pauses', detail: "accès broker posé par un dépôt (pause de son abonnement) jusqu'au 7 mai 2027, groupe gardé" })
  assert.deepEqual(ev('pause', 'pause_depot', { reprise_le: '2027-05-07' }), { rubrique: 'pauses', detail: "pause par dépôt broker posée par l'équipe, reprise le 7 mai 2027" })
  assert.equal(ev('acces_broker', 'pause_depot_demande').detail, 'demande la pause de son abonnement par un dépôt broker')
  assert.match(ev('acces_broker', 'pause_depot_declare').detail, /à vérifier, puis la carte$/)
  assert.match(ev('acces_broker', 'pause_depot_lots').detail, /à décider, il garde le groupe$/)
  assert.equal(ev('acces_broker', 'lots_declares'), null, 'les autres lignes du parcours des lots ne changent pas')
  assert.match(lire('src/lib/liveclub/resume.ts'), /where g\.geste = 'acces_broker' and g\.regle = 'pause_depot' and g\.resultat = 'fait'\n\s+and g\.details->>'acces_id' = a\.acces_id::text\)/)
  // Le fil Support : des lignes lisibles, sans adresse.
  const g = (geste, regle, details = {}) => P.phraseGeste({ geste, resultat: 'fait', regle, details })
  assert.match(g('acces_broker', 'pause_depot', { jusquau: '2027-05-07' }), /^Pause de l'abonnement par un dépôt broker posée par l'équipe : accès broker jusqu'au 7 mai 2027, groupe gardé tout du long\.$/)
  assert.match(g('pause', 'pause_depot', { paye_jusquau: '2026-11-07', reprise_le: '2027-05-07' }), /période payée jusqu'au 7 novembre 2026, reprise le 7 mai 2027 : groupe gardé tout du long\.$/)
  assert.match(g('rappel', 'pause_depot_message', { canal: 'prive' }), /^Message de la pause par dépôt broker envoyé/)
  for (const regle of ['pause_depot_demande', 'pause_depot_declare', 'pause_depot_lots']) {
    const phrase = g('acces_broker', regle)
    assert.ok(phrase && !/@/.test(phrase), regle)
    texteClavier(phrase, regle)
  }
})

await bloc('cablage : migration aucune, regles du journal coherentes, emails, Mon abonnement', () => {
  // Aucune migration : le motif reste 'broker' (check de la table), le marqueur est au journal.
  assert.equal(PD.REGLE_PAUSE_DEPOT, 'pause_depot')
  for (const f of ['src/lib/liveclub/pause-depot.ts', 'src/lib/liveclub/pause-depot-pur.ts']) {
    assert.ok(!/motif\s*=\s*'pause|'pause_depot'\)\s*check/.test(lire(f)), f)
  }
  const emails = lire('src/lib/liveclub/emails.ts')
  assert.match(emails, /if \(pauseDepot\) return modeleRelanceLotsPauseDepot\(n, limite, canal, lienBotAccueil\(\)\)/)
  assert.match(emails, /export function emailMessagePauseDepot\(/)
  assert.match(emails, /export function emailRappelRepriseDepot\(/)
  const actions = lire('src/lib/liveclub/actions-membre.ts')
  assert.match(actions, /const parDepot = vivants\.some\(a => a\.pauseActive\) \? await pauseDepotPourAgentMembre\(telegramId\) : null/)
  // Le message au membre : une fois par acces, reserve avant l'envoi.
  const serveur = lire('src/lib/liveclub/pause-depot.ts')
  assert.match(serveur, /where d\.geste = 'rappel' and d\.regle = \$\{REGLE_MESSAGE_PAUSE_DEPOT\} and d\.resultat = 'fait'\n\s+and d\.details->>'acces_id' = \$\{o\.accesId\}\)/)
  // L'acces, le depot et le marqueur dans UNE transaction, sous verrou.
  const tx = serveur.slice(serveur.indexOf('poserAccesEtDepot: async'), serveur.indexOf('poserPause: async'))
  assert.match(tx, /prisma\.\$transaction\(async \(tx\) => \{\n\s+await verrou\(tx, `liveclub:pause_depot:\$\{abonnementId\}`\)/)
  assert.ok(tx.indexOf('insert into public.cockpit_liveclub_acces') < tx.indexOf('insert into public.cockpit_commissions'))
  assert.ok(tx.indexOf('insert into public.cockpit_commissions') < tx.indexOf('insert into public.cockpit_liveclub_gestes'))
  // Jamais d'email dans un log du serveur.
  for (const l of serveur.split('\n').filter(x => /console\.(log|warn|error)/.test(x))) {
    assert.ok(!/email|p\.client|qui\b/.test(l), `log : ${l.trim()}`)
  }
})

console.log(`\n${n} blocs ok`)
