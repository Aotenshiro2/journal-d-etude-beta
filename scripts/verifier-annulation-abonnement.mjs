// Verification locale de l'annulation d'un abonnement par Agent AOK (demande
// de Brice du 30/10/2026). Fonctions PURES (src/lib/annulation-abonnement-pur.ts)
// et lecture des sources : aucune base, aucun appel Stripe, aucun appel au modele.
// - les parametres de l'outil (abonnement_id ou email, quand, motif) ;
// - la lecture d'un abonnement Stripe brut (version clover) ;
// - la carte pour chaque quand (fin de periode, immediatement, essai) ;
// - aucun abonnement trouve, plusieurs abonnements, abonnement termine ;
// - l'appel Stripe construit (methode, chemin, corps) ;
// - l'erreur de permission rendue en clair ;
// - le cablage : outil, prompt (dix-sept outils), validation, controle, execution, Telegram.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-annulation-abonnement.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MOTIF_MAX, QUANDS_ANNULATION,
  lireParamsAnnulation, lireAbonnementStripe, produitsDeAbonnement, choisirAbonnement, refusAnnulation,
  avertissementAnnulation, paramsDepuisAbonnement, carteAnnulation, requeteAnnulation, phraseAnnulationFaite,
  phraseEchecAnnulation, phraseLectureRefusee, abonnementTermine, dateFrAnnulation,
} from '../src/lib/annulation-abonnement-pur.ts'
import { estRefusDePermission, masquerCleStripe } from '../src/lib/liveclub/pur.ts'
import { libelleBoutonConfirmer } from '../src/lib/agent-cockpit-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const HORS_CLAVIER = new RegExp(`[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0xa0, 0x202f].map(c => String.fromCharCode(c)).join('')}]`)
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const sec = (iso) => Date.parse(iso) / 1000
const MAINTENANT = Date.parse('2026-10-30T09:00:00Z')

// Des abonnements tels que Stripe les rend en version 2025-09-30.clover
// (current_period_end sur les items). Identifiants inventes.
const CLIENT_JEAN = { id: 'cus_JeanDupont01', name: 'Jean Dupont', email: 'Jean.Dupont@Gmail.com' }
const item = (produit, centimes, intervalle, finIso, extra = {}) => ({
  quantity: 1, current_period_end: sec(finIso), discounts: [],
  price: { id: `price_${produit.slice(5)}x`, product: produit, unit_amount: centimes, currency: 'eur', recurring: { interval: intervalle, interval_count: 1 } },
  ...extra,
})
const SUB_PILOTAGE = {
  id: 'sub_1PilotagePrem01', status: 'active', customer: CLIENT_JEAN,
  cancel_at_period_end: false, cancel_at: null, pause_collection: null, discounts: [], ended_at: null,
  items: { data: [item('prod_PilotagePrem1', 599, 'month', '2026-11-12T10:00:00Z')] },
}
const SUB_CARNET = {
  ...SUB_PILOTAGE, id: 'sub_1CarnetPremium1',
  items: { data: [item('prod_V9jniZCCbIJsmV', 599, 'month', '2026-11-20T10:00:00Z')] },
}
const SUB_DUO_ESSAI = {
  ...SUB_PILOTAGE, id: 'sub_1PremiumDuoEss1', status: 'trialing', trial_end: sec('2026-11-05T08:00:00Z'),
  items: { data: [item('prod_PremiumDuo001', 7900, 'year', '2026-11-05T08:00:00Z')] },
}
const SUB_LIVECLUB_PAUSE = {
  id: 'sub_1LiveClubPause1', status: 'active', customer: 'cus_MarieMartin01',
  cancel_at_period_end: false, cancel_at: null, discounts: ['di_1Remise'],
  pause_collection: { behavior: 'void', resumes_at: sec('2027-01-15T00:00:00Z') },
  items: { data: [item('prod_LiveClub00001', 4900, 'month', '2026-11-30T10:00:00Z')] },
}
const SUB_ARRET_PREVU = {
  ...SUB_PILOTAGE, id: 'sub_1ArretDejaPrevu', cancel_at_period_end: true, cancel_at: sec('2026-11-12T10:00:00Z'),
}
const SUB_TERMINE = { ...SUB_PILOTAGE, id: 'sub_1DejaTermine001', status: 'canceled', ended_at: sec('2026-09-01T10:00:00Z') }
const NOMS = {
  prod_PilotagePrem1: 'Pilotage Premium', prod_V9jniZCCbIJsmV: 'Carnet Premium',
  prod_PremiumDuo001: 'Premium Duo (Carnet + Pilotage)', prod_LiveClub00001: 'Live Club',
}
const lu = (sub) => lireAbonnementStripe(sub, NOMS, MAINTENANT)

/** Le chemin d'une carte : parametres du modele, controle (lecture Stripe), carte. */
function carteDe(entree, sub, compte = 'aoknowledge') {
  const p = lireParamsAnnulation(entree)
  assert.equal(typeof p, 'object', String(p))
  const choix = choisirAbonnement([lu(sub)], { abonnementId: p.abonnement_id, email: p.email, compte })
  assert.ok('abonnement' in choix, choix.erreur)
  const params = paramsDepuisAbonnement(p, choix.abonnement)
  assert.equal(refusAnnulation(choix.abonnement, p.quand, params.qui), null)
  return { params, carte: carteAnnulation(params, compte) }
}

bloc('parametres : abonnement_id ou email, quand par defaut fin-de-periode, refus clairs', () => {
  assert.deepEqual([...QUANDS_ANNULATION], ['fin-de-periode', 'immediatement'])
  const parId = lireParamsAnnulation({ compte: 'aoknowledge', abonnement_id: 'stripe:sub_1PilotagePrem01' })
  assert.equal(parId.abonnement_id, 'sub_1PilotagePrem01', 'le prefixe stripe: de cockpit_abonnements est retire')
  assert.equal(parId.quand, 'fin-de-periode', 'fin de periode par defaut')
  assert.equal(parId.email, null)
  const parEmail = lireParamsAnnulation({ email: '  Jean.Dupont@Gmail.com ', quand: 'immediatement', motif: '  essai   de Brice ' })
  assert.equal(parEmail.email, 'jean.dupont@gmail.com')
  assert.equal(parEmail.quand, 'immediatement')
  assert.equal(parEmail.motif, 'essai de Brice')
  assert.match(lireParamsAnnulation({ compte: 'aoknowledge' }), /abonnement_id .* ou l'email du membre/)
  assert.match(lireParamsAnnulation({ abonnement_id: 'ch_123456789' }), /^abonnement_id invalide/)
  assert.match(lireParamsAnnulation({ email: 'pas-un-email' }), /^Email illisible/)
  assert.match(lireParamsAnnulation({ email: 'a@b.fr', quand: 'demain' }), /^quand : fin-de-periode/)
  assert.equal(lireParamsAnnulation({ email: 'a@b.fr', motif: 'x'.repeat(500) }).motif.length, MOTIF_MAX)
  // Les champs du serveur venus du modele sont bornes, et reecrits par le controle.
  const bidon = lireParamsAnnulation({ email: 'a@b.fr', echeance: 'demain', statut: 'ACTIVE; drop', arret_le: '2026-11-12' })
  assert.equal(bidon.echeance, null)
  assert.equal(bidon.statut, null)
  assert.equal(bidon.arret_le, '2026-11-12')
})

bloc('lecture d un abonnement Stripe brut (clover) : client, produit, tarif, echeance, arret, pause, essai', () => {
  const a = lu(SUB_PILOTAGE)
  assert.equal(a.id, 'sub_1PilotagePrem01')
  assert.equal(a.nom, 'Jean Dupont')
  assert.equal(a.email, 'jean.dupont@gmail.com')
  assert.deepEqual(a.produits, ['Pilotage Premium'])
  assert.equal(a.tarif, '5,99 € par mois')
  assert.equal(a.echeance, '2026-11-12')
  assert.equal(a.arretLe, null)
  assert.equal(a.pauseJusquau, null)
  const essai = lu(SUB_DUO_ESSAI)
  assert.equal(essai.tarif, '79 € par an')
  assert.equal(essai.echeance, '2026-11-05', "la fin de l'essai")
  const pause = lu(SUB_LIVECLUB_PAUSE)
  assert.equal(pause.pauseJusquau, '2027-01-15')
  assert.equal(pause.tarif, '49 € par mois, remise en cours')
  assert.equal(pause.nom, null, 'client non lu : pas de nom invente')
  assert.equal(pause.clientId, 'cus_MarieMartin01')
  assert.equal(lu(SUB_ARRET_PREVU).arretLe, '2026-11-12')
  assert.equal(lu({ ...SUB_PILOTAGE, cancel_at: null, cancel_at_period_end: true }).arretLe, '2026-11-12')
  assert.ok(abonnementTermine(lu(SUB_TERMINE).statut))
  assert.equal(lu({ id: 'pas_un_abonnement' }), null)
  // Nom de produit illisible : l'identifiant reste sur la carte.
  assert.deepEqual(lireAbonnementStripe(SUB_PILOTAGE, {}, MAINTENANT).produits, ['prod_PilotagePrem1'])
  assert.deepEqual(produitsDeAbonnement({ items: { data: [{ price: { product: { id: 'prod_ObjetExpand1' } } }, { price: { product: 'prod_ObjetExpand1' } }] } }), ['prod_ObjetExpand1'])
  // Deux items : montants additionnes ; devises differentes : pas de montant devine.
  const deux = { ...SUB_PILOTAGE, items: { data: [item('prod_PilotagePrem1', 599, 'month', '2026-11-12T10:00:00Z'), { ...item('prod_V9jniZCCbIJsmV', 599, 'month', '2026-11-12T10:00:00Z'), quantity: 2 }] } }
  assert.equal(lu(deux).tarif, '17,97 € par mois')
  assert.deepEqual(lu(deux).produits, ['Pilotage Premium', 'Carnet Premium'])
  const usd = { ...deux, items: { data: [deux.items.data[0], { ...deux.items.data[1], price: { ...deux.items.data[1].price, currency: 'usd' } }] } }
  assert.equal(lu(usd).tarif, null)
})

bloc('carte fin-de-periode : le membre, le produit, le montant et le rythme, l echeance, rien n est rembourse', () => {
  const { params, carte } = carteDe({ compte: 'aoknowledge', email: 'jean.dupont@gmail.com', motif: 'demande du membre' }, SUB_PILOTAGE)
  assert.equal(params.abonnement_id, 'sub_1PilotagePrem01', "retrouve par l'email, l'id est pose par le serveur")
  assert.equal(params.qui, 'Jean Dupont')
  assert.match(carte, /^Arrêter à la fin de la période l'abonnement de Jean Dupont \(jean\.dupont@gmail\.com\), compte aoknowledge : /)
  assert.match(carte, /Pilotage Premium, 5,99 € par mois, prochaine échéance le 12 novembre 2026\./)
  assert.match(carte, /Il s'arrête le 12 novembre 2026, rien n'est remboursé : le membre garde son accès jusque-là, puis plus aucun prélèvement\./)
  assert.match(carte, /Motif : demande du membre\./)
  assert.match(carte, /\(sub_1PilotagePrem01\)$/)
  assert.ok(!/maintenant/i.test(carte))
  // La carte stockee (cockpit_agent_cartes, ou la conversation Telegram) se relit a l'identique au clic.
  assert.deepEqual(lireParamsAnnulation(JSON.parse(JSON.stringify(params))), params)
})

bloc('carte immediatement : s arrete maintenant, aucun remboursement', () => {
  const { carte } = carteDe({ compte: 'aoknowledge', abonnement_id: 'sub_1CarnetPremium1', quand: 'immediatement', motif: 'fraude' }, SUB_CARNET)
  assert.match(carte, /^Arrêter MAINTENANT l'abonnement de Jean Dupont/)
  assert.match(carte, /Carnet Premium, 5,99 € par mois, prochaine échéance le 20 novembre 2026\./)
  assert.match(carte, /Il s'arrête maintenant : l'accès se ferme tout de suite et plus rien n'est prélevé\. Rien n'est remboursé : un remboursement est une carte à part\./)
  // Un arret deja programme n'empeche pas l'arret immediat, et la carte le dit.
  const { carte: avance } = carteDe({ compte: 'aoknowledge', abonnement_id: 'sub_1ArretDejaPrevu', quand: 'immediatement' }, SUB_ARRET_PREVU)
  assert.match(avance, /arrêt déjà programmé le 12 novembre 2026\. Il s'arrête maintenant/)
})

bloc('carte d un essai (trialing) et d un Live Club en pause', () => {
  const { carte } = carteDe({ compte: 'aoknowledge', email: 'jean.dupont@gmail.com', motif: 'essai de Brice' }, SUB_DUO_ESSAI)
  assert.match(carte, /Premium Duo \(Carnet \+ Pilotage\), 79 € par an, en période d'essai, fin de l'essai le 5 novembre 2026\./)
  assert.match(carte, /Il s'arrête à la fin de l'essai, le 5 novembre 2026, sans aucun prélèvement\./)
  const { carte: maintenant } = carteDe({ compte: 'aoknowledge', email: 'jean.dupont@gmail.com', quand: 'immediatement' }, SUB_DUO_ESSAI)
  assert.match(maintenant, /Il s'arrête maintenant/)
  const { carte: pause } = carteDe({ compte: 'melanie', abonnement_id: 'sub_1LiveClubPause1', qui: 'Marie' }, SUB_LIVECLUB_PAUSE, 'melanie')
  assert.match(pause, /l'abonnement de Marie, compte melanie : Live Club, 49 € par mois, remise en cours, prochaine échéance le 30 novembre 2026\./)
  assert.match(pause, /Il est en pause \(prélèvements suspendus jusqu'au 15 janvier 2027\)\./)
  for (const c of [carte, maintenant, pause]) assert.ok(!HORS_CLAVIER.test(c), c)
})

bloc('aucun abonnement trouve : refus sans carte', () => {
  const vide = choisirAbonnement([], { abonnementId: null, email: 'inconnu@gmail.com', compte: 'aoknowledge' })
  assert.match(vide.erreur, /^Aucun abonnement en cours pour inconnu@gmail\.com sur le compte aoknowledge\. Vérifie l'adresse/)
  assert.match(vide.erreur, /Live Club = compte melanie/)
  assert.match(vide.erreur, /Aucune carte\.$/)
  const finis = choisirAbonnement([lu(SUB_TERMINE)], { abonnementId: null, email: 'jean.dupont@gmail.com', compte: 'aoknowledge' })
  assert.match(finis.erreur, /^Aucun abonnement en cours .* \(1 abonnement déjà terminé\)/)
})

bloc('plusieurs abonnements : la liste rendue au modele, il demande lequel', () => {
  const r = choisirAbonnement([lu(SUB_PILOTAGE), lu(SUB_CARNET), lu(SUB_TERMINE)], { abonnementId: null, email: 'jean.dupont@gmail.com', compte: 'aoknowledge' })
  assert.ok('erreur' in r)
  const lignes = r.erreur.split('\n')
  assert.match(lignes[0], /^2 abonnements en cours pour jean\.dupont@gmail\.com sur le compte aoknowledge :$/)
  assert.equal(lignes[1], '- sub_1PilotagePrem01 : Pilotage Premium, 5,99 € par mois, statut active, prochaine échéance le 12 novembre 2026')
  assert.equal(lignes[2], '- sub_1CarnetPremium1 : Carnet Premium, 5,99 € par mois, statut active, prochaine échéance le 20 novembre 2026')
  assert.match(lignes[3], /^Demande lequel annuler .*repropose avec son abonnement_id\.$/)
  assert.ok(!r.erreur.includes('sub_1DejaTermine001'), 'un abonnement termine ne compte pas')
})

bloc('par id : introuvable, deja termine, email qui ne correspond pas', () => {
  const introuvable = choisirAbonnement([], { abonnementId: 'sub_1Inconnu000001', email: null, compte: 'melanie' })
  assert.match(introuvable.erreur, /^Abonnement sub_1Inconnu000001 introuvable sur le compte melanie/)
  const fini = choisirAbonnement([lu(SUB_TERMINE)], { abonnementId: 'sub_1DejaTermine001', email: null, compte: 'aoknowledge' })
  assert.match(fini.erreur, /déjà terminé \(statut canceled, fini le 1er septembre 2026\) : rien à annuler/)
  const autre = choisirAbonnement([lu(SUB_PILOTAGE)], { abonnementId: 'sub_1PilotagePrem01', email: 'paul@gmail.com', compte: 'aoknowledge' })
  assert.match(autre.erreur, /appartient à jean\.dupont@gmail\.com, pas à paul@gmail\.com/)
})

bloc('refus selon quand : arret deja programme, abonnement jamais paye ; avertissement impaye', () => {
  assert.match(refusAnnulation(lu(SUB_ARRET_PREVU), 'fin-de-periode', 'Jean Dupont'),
    /^Un arrêt est déjà programmé sur l'abonnement de Jean Dupont \(sub_1ArretDejaPrevu, fin le 12 novembre 2026\) : rien à faire\. .*quand immediatement/)
  assert.equal(refusAnnulation(lu(SUB_ARRET_PREVU), 'immediatement', 'Jean Dupont'), null)
  assert.match(refusAnnulation(lu({ ...SUB_PILOTAGE, status: 'incomplete' }), 'fin-de-periode', 'Jean'), /« incomplete ».*arrêt immédiat/)
  assert.equal(refusAnnulation(lu({ ...SUB_PILOTAGE, status: 'incomplete' }), 'immediatement', 'Jean'), null)
  assert.match(refusAnnulation(lu(SUB_TERMINE), 'immediatement', 'Jean'), /déjà terminé/)
  assert.match(avertissementAnnulation(lu({ ...SUB_PILOTAGE, status: 'past_due' }), 'fin-de-periode'), /^ATTENTION : paiement en retard \(past_due\)/)
  assert.equal(avertissementAnnulation(lu({ ...SUB_PILOTAGE, status: 'past_due' }), 'immediatement'), null)
  assert.equal(avertissementAnnulation(lu(SUB_PILOTAGE), 'fin-de-periode'), null)
})

bloc('appel Stripe construit : methode, chemin, corps', () => {
  assert.deepEqual(requeteAnnulation('sub_1CarnetPremium1', 'immediatement', 'fraude'), {
    methode: 'DELETE', chemin: '/v1/subscriptions/sub_1CarnetPremium1',
    corps: { invoice_now: 'false', prorate: 'false', 'cancellation_details[comment]': 'Agent AOK (cockpit) : fraude' },
  })
  assert.deepEqual(requeteAnnulation('sub_1PilotagePrem01', 'fin-de-periode', null), {
    methode: 'POST', chemin: '/v1/subscriptions/sub_1PilotagePrem01',
    corps: { cancel_at_period_end: 'true', 'cancellation_details[comment]': 'Agent AOK (cockpit)' },
  })
  assert.throws(() => requeteAnnulation('sub_../../v1/customers', 'immediatement', null), /abonnement invalide/)
})

bloc('erreur de permission rendue en clair, la cle jamais citee ; refus Stripe ; reponse incertaine', () => {
  const refus = "The provided key 'rk_live_51AbC***********************XyZ9' does not have the required permissions for this endpoint "
    + "on account 'acct_1AbC'. Having the 'rak_subscription_write' permission would allow this request to continue."
  const message = masquerCleStripe(refus)
  assert.ok(estRefusDePermission(message))
  const phrase = phraseEchecAnnulation({ message, permission: true, incertain: false, compte: 'aoknowledge', variable: 'STRIPE_AGENT_KEY_AOKNOWLEDGE', quand: 'fin-de-periode' })
  assert.match(phrase, /^Rien n'a été annulé : la clé de l'agent du compte aoknowledge \(STRIPE_AGENT_KEY_AOKNOWLEDGE\) n'a pas la permission « Subscriptions » en écriture\./)
  assert.match(phrase, /C'est un réglage à faire par Brice : Stripe, Développeurs, Clés API/)
  assert.match(phrase, /Subscriptions : Écriture \(Stripe la nomme rak_subscription_write\)/)
  assert.ok(!phrase.includes('rk_live') && !phrase.includes('Adil'))
  assert.match(phraseEchecAnnulation({ message, permission: true, incertain: false, compte: 'melanie', variable: 'STRIPE_AGENT_KEY_MELANIE', quand: 'immediatement' }), /Brice \(ou Adil, sur le Stripe de Mélanie\)/)
  assert.ok(!estRefusDePermission('No such subscription: sub_123'))
  assert.equal(phraseEchecAnnulation({ message: 'No such subscription: sub_123', permission: false, incertain: false, compte: 'aoknowledge', variable: 'X', quand: 'immediatement' }),
    "Stripe a refusé l'arrêt immédiat (No such subscription: sub_123) : rien n'a changé.")
  assert.match(phraseEchecAnnulation({ message: 'fetch failed', permission: false, incertain: true, compte: 'aoknowledge', variable: 'X', quand: 'fin-de-periode' }),
    /^Stripe n'a pas répondu \(fetch failed\) : on ne sait pas si l'annulation est passée\. Regarde l'abonnement au Dashboard Stripe/)
  // Lecture avant la carte refusee : Subscriptions, et Customers quand on cherche par email.
  const lecture = phraseLectureRefusee({ compte: 'aoknowledge', variable: 'STRIPE_AGENT_KEY_AOKNOWLEDGE', message, parEmail: true })
  assert.match(lecture, /Aucune carte\. Dis-le tel quel : il manque à cette clé la permission « Subscriptions » et « Customers » \(pour chercher par email\)/)
  assert.ok(!lecture.includes('rk_live'))
  assert.ok(!phraseLectureRefusee({ compte: 'aoknowledge', variable: 'X', message, parEmail: false }).includes('Customers'))
})

bloc('resultat apres confirmation', () => {
  assert.equal(phraseAnnulationFaite({ qui: 'Jean Dupont', produit: 'Pilotage Premium', quand: 'fin-de-periode', finLe: '2026-11-12', liveClub: false }),
    "Abonnement de Jean Dupont (Pilotage Premium) : arrêt programmé le 12 novembre 2026. Rien n'est remboursé, le membre garde son accès jusque-là, puis plus aucun prélèvement.\n"
    + "Rien à faire à la main : le droit à l'app suit l'abonnement tout seul.")
  const maintenant = phraseAnnulationFaite({ qui: 'Marie', produit: 'Live Club', quand: 'immediatement', finLe: '2026-10-30', liveClub: true })
  assert.match(maintenant, /^Abonnement de Marie \(Live Club\) arrêté maintenant\. Rien n'a été remboursé : pour un remboursement, demande-le-moi/)
  assert.match(maintenant, /\nTelegram : rien à faire, le passage quotidien s'occupe de la sortie du groupe/)
  assert.equal(dateFrAnnulation('2026-11-01'), '1er novembre 2026')
})

bloc('cablage : outil, prompt (dix-sept outils, regles), validation, controle, execution, Telegram, bouton', () => {
  const agent = lire('src/lib/agent-cockpit.ts')
  const outil = agent.slice(agent.indexOf("name: 'proposer_annulation_abonnement'"))
  assert.ok(agent.includes("name: 'proposer_annulation_abonnement'"), "l'outil est dans OUTILS")
  assert.match(outil.slice(0, 3000), /required: \['compte'\]/)
  assert.match(outil.slice(0, 3000), /enum: \['fin-de-periode', 'immediatement'\]/)
  assert.match(agent, /^\s+proposer_annulation_abonnement: 'annulation_abonnement',$/m)
  // Le prompt : dix-sept outils d'action, nommes un par un.
  const phrase = /Tu disposes de dix-sept outils d'action : ([^(]+) \(décrits plus bas\)/.exec(agent)
  assert.ok(phrase, 'la phrase des outils d action')
  const noms = phrase[1].split(/, | et /).map(s => s.trim())
  assert.equal(noms.length, 17, noms.join(' | '))
  assert.ok(noms.includes('proposer_annulation_abonnement'))
  assert.ok(!agent.includes('seize outils'))
  assert.match(agent, /ANNULER N'EST PAS REMBOURSER : aucune des deux cartes ne fait l'autre\. Si on te demande les deux, propose deux cartes, le remboursement d'abord/)
  assert.match(agent, /quand : fin-de-periode PAR DÉFAUT .* immediatement SEULEMENT si on te le demande .* ou pour un abonnement d'essai/)
  assert.match(agent, /Plusieurs abonnements en cours : le serveur te les rend, montre-les et demande lequel/)

  const stripe = lire('src/lib/stripe-actions.ts')
  assert.match(stripe, /\| 'annulation_abonnement'/)
  assert.match(stripe, /if \(a\.type === 'annulation_abonnement'\) \{\n\s+const lu = lireParamsAnnulation\(p\)\n\s+if \(typeof lu === 'string'\) return lu/, 'validerAction')
  assert.match(stripe, /\|\| type === 'annulation_abonnement'\n\}/, 'aControleStripe : controle avant la carte')
  assert.match(stripe, /if \(a\.type === 'annulation_abonnement'\) return controlerAnnulation\(a\)/)
  assert.match(stripe, /carteAnnulation\(lu, a\.compte\)/, 'resumeAction : la carte')
  const exec = stripe.slice(stripe.indexOf('export async function executerAction'))
  const branche = exec.slice(exec.indexOf("if (a.type === 'annulation_abonnement')"))
  assert.ok(exec.indexOf("if (a.type === 'annulation_abonnement')") > exec.indexOf('const cle = cleAgent(a.compte as CompteStripe)'), "l'execution prend la cle d'ecriture de l'agent")
  assert.match(branche, /const requete = requeteAnnulation\(abo, lu\.quand, lu\.motif\)/)
  assert.match(branche, /requete\.methode === 'DELETE'\n\s+\? await stripeDelete\(cle, requete\.chemin, requete\.corps\)\n\s+: await stripePost\(cle, requete\.chemin, requete\.corps\)/)
  assert.match(branche, /permission: estRefusDePermission\(message\)/)
  assert.match(branche, /geste: 'arret', resultat: 'fait', regle: 'manuel'/, 'journal du Live Club, comme la pause')
  // Le log de la route : jamais l'email, le nom ni le motif.
  const log = stripe.slice(stripe.indexOf("if (a.type === 'annulation_abonnement') {\n    return { abonnement_id"))
  assert.match(log.slice(0, 300), /motif: a\.params\.motif \? 'oui' : 'non'/)
  assert.ok(!/email|qui/.test(log.slice(0, log.indexOf('\n  }'))))

  // Telegram : meme chemin que les autres cartes (validerAction puis executerAction au clic), bouton qui dit l'action.
  const tg = lire('src/lib/agent-cockpit-telegram.ts')
  assert.match(tg, /const action = validerAction\(consommee\[0\]\.action_en_attente\)/)
  assert.match(tg, /await executerAction\(action, `agent:\$\{compte\.user_id\}`\)/)
  assert.equal(libelleBoutonConfirmer('annulation_abonnement'), "✅ Arrêter l'abonnement")
  assert.match(lire('src/app/api/cockpit/agent/action/route.ts'), /const resultat = await executerAction\(action, `agent:\$\{userId\}`\)/)
})

bloc('caracteres clavier dans le module', () => {
  const pur = lire('src/lib/annulation-abonnement-pur.ts')
  assert.ok(!HORS_CLAVIER.test(pur))
  assert.ok(!/^import /m.test(pur), 'module pur sans import (teste par Node seul)')
})

console.log(`\n${n} blocs ok`)
