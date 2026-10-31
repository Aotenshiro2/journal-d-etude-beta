// Tests du SUIVI DES LOTS d'un acces broker (Brice et Mel, 31/10) et des
// retouches d'Agent AOK du meme jour :
// - les dates (depart, delai, relances une seule fois, pause, retour), les
//   membres deja entres avant le deploiement (aucune pause retroactive) ;
// - les textes aux membres (admission, relances, pause, situation, reponses),
//   le bouton « J'ai tradé mes lots », la carte « Oui / Non » de l'equipe ;
// - le droit en pause qui reste un acces offert (jamais « envoie ton email ») ;
// - la regle des commissions (moisPrevuCommission : le mois des lots) ;
// - le challenge Core content (tour du proprietaire, consigne de l'agent) ;
// - Agent AOK : messages courts pour Melanie, carte courte, euros, commission
//   de CE depot sans debat, note « a confirmer » qui ne bloque rien ;
// - le cablage (lecture des sources) : droits, bot, passage, clic, prudence.
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-suivi-lots.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const L = await import('../src/lib/liveclub/lots-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const A = await import('../src/lib/liveclub/accueil-groupe.ts')
const E = await import('../src/lib/liveclub/emails.ts')
const M = await import('../src/lib/liveclub/prompt-membre.ts')
const R = await import('../src/lib/liveclub/resume-pur.ts')
const RP = await import('../src/lib/repartition/pur.ts')
const AP = await import('../src/lib/agent-cockpit-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

/** Caracteres clavier simples, sans « jamais », sans ban, sans emoji (textes aux membres). */
function texteSain(t, nom) {
  assert.ok(!/[—–…“”‘’•]/.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!/\.\.\./.test(t), `${nom} : points de suspension`)
  assert.ok(!/[  ​-‍⁠﻿]/.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
  assert.ok(!/jamais/i.test(t), `${nom} : « jamais » dans un texte d'engagement`)
  assert.ok(!/\bbann?(i|ir|issement)?\b|exclu/i.test(t), `${nom} : ban ou exclusion`)
}

const D = L.SUIVI_LOTS_DEPUIS
const plus = L.jourPlus

bloc('constantes du delai (Brice, 31/10 : 3 semaines) et dates', () => {
  assert.equal(L.DELAI_LOTS_JOURS, 21)
  assert.equal(L.RELANCE_LOTS_1_JOURS, 14)
  assert.equal(L.RELANCE_LOTS_2_AVANT_FIN_JOURS, 3)
  assert.match(D, /^2026-\d{2}-\d{2}$/)
  assert.equal(plus('2026-11-30', 2), '2026-12-02')
  assert.equal(plus('2026-03-01', -1), '2026-02-28')
  // La meme forme que formaterDateFr (pur.ts) : le membre lit la meme date partout.
  for (const j of ['2026-12-01', '2026-12-02', '2027-01-15']) assert.equal(L.dateLots(j), P.formaterDateFr(j))
  assert.equal(L.EXEMPLE_LOTS, '2 lots sur le NAS')
  assert.equal(L.TENUE_LOTS, '30 secondes')
})

bloc('depart : entree (jeton utilise) ou debut, jamais avant le deploiement', () => {
  const apres = plus(D, 10)
  assert.equal(L.departLots({ debut: apres, entreeLe: null }), apres)
  assert.equal(L.departLots({ debut: apres, entreeLe: plus(apres, 5) }), plus(apres, 5))
  // Membres deja entres avant le deploiement (29/10, 31/10) : le delai part de SUIVI_LOTS_DEPUIS.
  assert.equal(L.departLots({ debut: '2026-10-29', entreeLe: null }), D)
  assert.equal(L.departLots({ debut: '2026-10-31', entreeLe: '2026-10-31' }), D)
  assert.equal(L.limiteLots({ debut: apres, entreeLe: null }), plus(apres, 21))
})

bloc('phases : attente, relance 1, relance 2 (une fois), pause apres la relance 2 seulement', () => {
  const debut = plus(D, 5)
  const s = { debut, entreeLe: null, relance2Le: null, declarationEnCours: false }
  const ph = (jour, x = s) => L.phaseLots(x, jour)
  assert.equal(ph(debut), 'attente')
  assert.equal(ph(plus(debut, 13)), 'attente')
  assert.equal(ph(plus(debut, 14)), 'relance_1')
  assert.equal(ph(plus(debut, 17)), 'relance_1')
  assert.equal(ph(plus(debut, 18)), 'relance_2')
  assert.equal(ph(plus(debut, 21)), 'relance_2')
  // Delai passe, relance 2 jamais partie : PAS de pause (personne n'est mis en pause sans etre prevenu).
  assert.equal(ph(plus(debut, 45)), 'relance_2')
  assert.equal(L.limiteEffectiveLots(s), null)
  // Relance 2 partie a J+18 : attente jusqu'a la fin du delai (incluse), pause le lendemain.
  const r2 = { ...s, relance2Le: plus(debut, 18) }
  assert.equal(ph(plus(debut, 19), r2), 'attente')
  assert.equal(ph(plus(debut, 21), r2), 'attente')
  assert.equal(ph(plus(debut, 22), r2), 'pause')
  assert.equal(L.lotsEnRetard(r2, plus(debut, 22)), true)
  assert.equal(L.lotsEnRetard(r2, plus(debut, 21)), false)
  // Relance 2 partie en retard (J+35) : 3 jours pleins apres elle, toujours.
  const tard = { ...s, relance2Le: plus(debut, 35) }
  assert.equal(L.limiteEffectiveLots(tard), plus(debut, 38))
  assert.equal(L.limiteAnnonceeRelance2(s, plus(debut, 35)), plus(debut, 38))
  assert.equal(L.limiteAnnonceeRelance2(s, plus(debut, 18)), plus(debut, 21))
  assert.equal(ph(plus(debut, 38), tard), 'attente')
  assert.equal(ph(plus(debut, 39), tard), 'pause')
  // Une declaration en cours arrete tout : ni relance, ni pause.
  for (const j of [14, 27, 31, 60]) assert.equal(ph(plus(debut, j), { ...r2, declarationEnCours: true }), 'declares')
})

bloc('membres deja entres : aucune pause retroactive, leurs relances partent du deploiement', () => {
  const victor = { debut: '2026-10-29', entreeLe: null, relance2Le: null, declarationEnCours: false }
  assert.equal(L.phaseLots(victor, D), 'attente')
  assert.equal(L.phaseLots(victor, plus(D, 13)), 'attente')
  assert.equal(L.phaseLots(victor, plus(D, 14)), 'relance_1')
  assert.equal(L.phaseLots(victor, plus(D, 29)), 'relance_2')
  for (let j = 0; j <= 60; j++) assert.equal(L.lotsEnRetard(victor, plus(D, j)), false, `pas de pause sans relance 2 (J+${j})`)
  // Avec sa relance 2 au jour prevu (D + 18), la pause ne vient pas avant D + 22.
  const avecR2 = { ...victor, relance2Le: plus(D, 18) }
  assert.equal(L.lotsEnRetard(avecR2, plus(D, 21)), false)
  assert.equal(L.lotsEnRetard(avecR2, plus(D, 22)), true)
})

bloc('etat porte par le droit (a faire / en retard / declare)', () => {
  const s = { debut: plus(D, 1), entreeLe: null, relance2Le: null, declarationEnCours: false }
  assert.deepEqual(L.etatLots(s, plus(D, 2)), { etat: 'a_faire', limite: plus(D, 22), declare: false })
  const r2 = { ...s, relance2Le: plus(D, 19) }
  assert.deepEqual(L.etatLots(r2, plus(D, 40)), { etat: 'en_retard', limite: plus(D, 22), declare: false })
  assert.equal(L.etatLots({ ...r2, declarationEnCours: true }, plus(D, 40)).etat, 'a_faire')
})

bloc('textes aux membres : simples, sans forcer, sans « jamais », la date et l exemple', () => {
  const lim = '2026-12-02'
  const adm = L.paragrapheLotsAdmission(lim)
  assert.match(adm, /tant que tes premiers lots ne sont pas tradés chez lui, l'affiliation ne nous paie pas/)
  assert.match(adm, /Pas besoin de cramer ton compte/)
  assert.match(adm, /2 lots sur le NAS, avec une position tenue 30 secondes/)
  assert.match(adm, /Ensuite, tu prends tout ton temps/)
  assert.match(adm, /jusqu'au 2 décembre 2026/)
  const r1 = L.texteRelanceLots1(lim)
  assert.match(r1, /\n1\. Ouvre ta plateforme chez le broker\.\n2\. Prends une position de 2 lots sur le NAS\.\n3\. Garde-la 30 secondes, puis ferme-la\./)
  assert.match(r1, /jusqu'au 2 décembre 2026/)
  const r2 = L.texteRelanceLots2(lim)
  assert.match(r2, /se met en pause tant que les lots ne sont pas faits\. Rien de définitif/)
  const sus = L.texteSuspensionLots()
  assert.match(sus, /en pause pour le moment/)
  assert.match(sus, /je te redonne ton lien vers le groupe/)
  for (const [nom, t] of [
    ['admission', adm], ['relance 1', r1], ['relance 2', r2], ['pause', sus], ['situation en pause', L.texteAccesEnPauseLots()],
    ['ligne a faire', L.ligneLotsAFaire(lim, false)], ['ligne declare', L.ligneLotsAFaire(lim, true)],
    ['confirmes', L.TEXTE_LOTS_CONFIRMES], ['confirmes retour', L.TEXTE_LOTS_CONFIRMES_RETOUR],
    ['confirmes sans lien', L.TEXTE_LOTS_CONFIRMES_SANS_LIEN], ['pas vus', L.texteLotsPasVus()],
    ...['declare', 'deja_declare', 'deja_faits', 'rien', 'panne'].flatMap(i => [
      [`declaration ${i}`, L.texteDeclarationLots(i)], [`declaration ${i} (pause)`, L.texteDeclarationLots(i, { enPause: true })],
    ]),
  ]) texteSain(t, nom)
  for (const t of [r1, r2, sus, L.texteAccesEnPauseLots(), L.texteLotsPasVus()]) assert.ok(t.includes(`« ${L.BOUTON_LOTS.texte} »`))
})

bloc('reponse a la declaration : une ligne, « l equipe verifie chez le broker »', () => {
  for (const i of ['declare', 'deja_declare']) {
    for (const enPause of [false, true]) {
      const t = L.texteDeclarationLots(i, { enPause })
      assert.ok(!t.includes('\n'), 'une ligne')
      assert.match(t, /l'équipe vérifie chez le broker/i)
    }
  }
  assert.equal(L.decisionDeclarationLots({ enAttente: true, dejaFaits: false, declarationEnCours: false }), 'declare')
  assert.equal(L.decisionDeclarationLots({ enAttente: true, dejaFaits: false, declarationEnCours: true }), 'deja_declare')
  assert.equal(L.decisionDeclarationLots({ enAttente: false, dejaFaits: true, declarationEnCours: false }), 'deja_faits')
  assert.equal(L.decisionDeclarationLots({ enAttente: false, dejaFaits: false, declarationEnCours: false }), 'rien')
})

bloc('bouton du membre et carte de l equipe (Oui / Non, une ligne de plus au plus)', () => {
  assert.equal(L.BOUTON_LOTS.data, 'm:lots')
  assert.equal(P.libelleBouton('m:lots'), L.BOUTON_LOTS.texte)
  assert.ok(P.callbackDataValide(L.BOUTON_LOTS.data))
  assert.equal(L.dataBoutonLots(123, 'oui'), 'lt:o:123')
  assert.equal(L.dataBoutonLots(123, 'non'), 'lt:n:123')
  assert.deepEqual(L.lireBoutonLots('lt:o:123'), { id: 123, verbe: 'oui' })
  assert.deepEqual(L.lireBoutonLots('lt:n:9'), { id: 9, verbe: 'non' })
  for (const x of ['lt:x:1', 'lt:o:', 'lt:o:0', 'lt:o:-1', 'ok:123', null, 42, 'lt:o:1 ']) assert.equal(L.lireBoutonLots(x), null)
  const clavier = L.clavierCarteLots(987654321)
  assert.deepEqual(clavier[0].map(b => b.text), ['Oui, lots tradés', 'Non, pas encore'])
  for (const b of clavier[0]) assert.ok(P.callbackDataValide(b.callback_data))
  const carte = L.texteCarteLots({
    qui: 'Jean Test', email: 'jean@exemple.fr', partenaire: 'RaiseFx', depot: '650 €', depotLe: '2026-10-31',
    commission: '587 €', enPause: true, lotsLe: '2026-11-20',
  })
  assert.ok(carte.split('\n').length <= 3, 'courte')
  assert.match(carte, /^Lots à vérifier chez RaiseFx : Jean Test \(jean@exemple\.fr\) dit avoir tradé ses premiers lots\./)
  assert.match(carte, /Dépôt de 650 € du 31 octobre 2026, commission attendue 587 €\. Son accès au groupe est en pause/)
  assert.match(carte, /Oui : je note ses lots faits le 20 novembre 2026 et je le préviens\. Non : je lui dis que tu ne les vois pas encore\./)
  assert.equal(L.texteLotsDejaDecides('lots_confirmes', 'Mélanie'), 'Déjà traité par Mélanie : lots notés tradés.')
  assert.equal(L.texteLotsDejaDecides('lots_pas_vus', null), 'Déjà traité : lots pas encore vus.')
  assert.equal(L.texteLotsDejaDecides(null, null), 'Cette carte est introuvable.')
  assert.ok(L.MARQUEUR_CARTE_LOTS.startsWith('[système]'), "le marqueur n'est pas une question de l'equipe (demandes en suspens)")
})

bloc('admission : le paragraphe des lots, au bon endroit, pour un acces broker seulement', () => {
  const o = { chat: -1001930901866, accesOffert: true }
  const sans = A.texteAdmission('nouveau', o)
  assert.ok(sans.startsWith("Bienvenue dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant. Voici le tour du propriétaire"))
  assert.ok(!/lots/.test(sans))
  const avec = A.texteAdmission('nouveau', { ...o, lots: { limite: '2026-12-02' } })
  assert.ok(avec.startsWith(`Bienvenue dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant.\n\n${L.paragrapheLotsAdmission('2026-12-02')}\n\nVoici le tour du propriétaire`))
  for (const g of ['retour', 'connu']) {
    const t = A.texteAdmission(g, { ...o, lots: { limite: '2026-12-02' } })
    assert.ok(t.includes(L.paragrapheLotsAdmission('2026-12-02')), g)
    assert.ok(!A.texteAdmission(g, o).includes('lots'), `${g} sans lots`)
  }
  assert.ok(!A.texteAdmission('nouveau', { ...o, lots: null }).includes('affiliation'))
})

bloc('challenge Core content : une ligne dans le tour, la regle dans la consigne de l agent', () => {
  const t = A.texteAdmission('nouveau', { chat: null, accesOffert: false })
  assert.ok(t.includes(A.LIGNE_CHALLENGE_CORE_CONTENT))
  assert.ok(t.indexOf(A.LIGNE_CHALLENGE_CORE_CONTENT) > t.indexOf('Les autres sujets'))
  assert.match(A.LIGNE_CHALLENGE_CORE_CONTENT, /toutes les réponses aux quiz, les anciens aussi : tu peux y répondre au fil de ta progression/)
  texteSain(A.LIGNE_CHALLENGE_CORE_CONTENT, 'ligne du challenge')
  for (const g of ['retour', 'connu']) assert.ok(!A.texteAdmission(g, { chat: null, accesOffert: false }).includes('challenge'), g)
  const p = M.SYSTEM_PROMPT_MEMBRE
  assert.match(p, /Le challenge de Core content by MELMOM/)
  assert.match(p, /toutes les réponses aux quiz de ce sujet depuis le début, les anciens quiz compris/)
  assert.match(p, /le plus de bonnes réponses gagne ; en cas d'égalité, un tirage au sort départage/)
  assert.match(p, /Tu l'expliques s'il te le demande, sans en parler de toi-même/)
  // Le lot n'est ni dans le code ni dans la base de connaissances : pas cite.
  assert.ok(!/200 ?(EUR|€)|signaux gold/i.test(p))
})

bloc('droit en pause : un acces offert qui dit pourquoi, jamais la demande d email', () => {
  const enPause = { statut: 'non', raison: null, lots: { etat: 'en_retard', limite: '2026-12-02', declare: false } }
  assert.equal(P.accesEnPauseLots(enPause), true)
  assert.equal(P.parcoursSansRattachement('aucun', enPause), 'acces_offert')
  assert.equal(P.parcoursSansRattachement('illisible', enPause), 'acces_offert')
  const a = P.accesSansAbonnement(enPause, { texteAbonnement: 'PORTES', lots: L.TEXTES_LOTS_SITUATION })
  assert.equal(a.texte, L.texteAccesEnPauseLots())
  assert.equal(a.faits.acces, 'offert_broker_en_pause')
  assert.ok(!/email/i.test(a.texte))
  // Sans les textes (anciens appelants) : une phrase neutre, jamais null.
  assert.ok(P.accesSansAbonnement(enPause, { texteAbonnement: 'PORTES' }).texte.includes('en pause'))
  // Un 'non' sans lots : rien ne change (parcours non rattache).
  assert.equal(P.parcoursSansRattachement('aucun', { statut: 'non', raison: null }), 'non_rattache')
  assert.equal(P.accesSansAbonnement({ statut: 'non', raison: null }, { texteAbonnement: 'PORTES' }), null)
  // Dans le delai : la ligne des lots dans la situation de l'acces broker.
  const ouvert = { statut: 'oui', raison: 'acces_broker', fin: '2027-04-30', lots: { etat: 'a_faire', limite: '2026-12-02', declare: false } }
  const s = P.accesSansAbonnement(ouvert, { texteAbonnement: 'PORTES', lots: L.TEXTES_LOTS_SITUATION })
  assert.ok(s.texte.includes(L.ligneLotsAFaire('2026-12-02', false)))
  assert.ok(s.texte.endsWith('PORTES'))
  assert.match(String(s.faits.premiers_lots_chez_le_broker), /2 décembre 2026/)
  const declare = P.accesSansAbonnement({ ...ouvert, lots: { ...ouvert.lots, declare: true } }, { texteAbonnement: 'PORTES', lots: L.TEXTES_LOTS_SITUATION })
  assert.ok(declare.texte.includes("l'équipe vérifie"))
  // Sans lots : le texte d'avant le 31/10, a l'identique.
  const avant = P.accesSansAbonnement({ statut: 'oui', raison: 'acces_broker', fin: '2027-04-30' }, { texteAbonnement: 'PORTES' })
  assert.equal(avant.texte, "Tu as un accès offert au Live Club jusqu'au 30 avril 2027, grâce à ton compte chez notre broker partenaire. Il n'est pas renouvelable : pour rester après, il suffira de t'abonner.\n\nPORTES")
})

bloc('journal et fil Support : chaque geste du suivi a sa phrase, le resume aussi', () => {
  const g = (geste, resultat, regle, details = {}) => P.phraseGeste({ geste, resultat, regle, details })
  assert.match(g('retrait', 'fait', 'lots_non_faits'), /sans blocage : accès broker en pause/)
  assert.match(g('rappel', 'fait', 'lots_relance_1'), /Première relance des lots/)
  assert.match(g('rappel', 'fait', 'lots_relance_2', { canal: 'email' }), /Seconde relance des lots chez le broker envoyée par email/)
  assert.match(g('rappel', 'fait', 'lots_suspension_message'), /Message de pause de l'accès broker/)
  assert.match(g('acces_broker', 'fait', 'lots_declares'), /A dit avoir tradé ses premiers lots/)
  assert.match(g('acces_broker', 'fait', 'lots_confirmes'), /notés faits/)
  assert.match(g('acces_broker', 'fait', 'lots_pas_vus'), /pas encore vus/)
  assert.match(g('acces_broker', 'fait', 'broker', { jusquau: '2027-04-30' }), /Accès broker ouvert jusqu'au 30 avril 2027/)
  assert.match(g('invitation', 'fait', 'retour_lots'), /Lots faits : accès rouvert/)
  assert.match(g('invitation', 'refuse', 'retour_lots'), /déjà revenu/)
  assert.match(g('invitation', 'refuse', 'lots_non_faits'), /accès broker en pause/)
  assert.match(g('entree_refusee', 'fait', 'lots_non_faits'), /accès broker en pause/)
  const ev = (geste, regle) => R.evenementDeGeste({ id: '1', geste, resultat: 'fait', regle, details: {}, telegramId: null, membreId: null, faitLe: '2026-12-03' })
  assert.match(ev('retrait', 'lots_non_faits').detail, /accès broker en pause/)
  assert.ok(!/par l'équipe/.test(ev('retrait', 'lots_non_faits').detail))
  assert.match(ev('invitation', 'retour_lots').detail, /accès rouvert/)
})

bloc('messages du passage : prive avec le bouton, email au vouvoiement sans bouton du bot', () => {
  const t1 = E.modeleRelanceLots(1, '2026-12-02')
  assert.deepEqual(t1.boutonBot, { texte: L.BOUTON_LOTS.texte, data: L.BOUTON_LOTS.data })
  assert.equal(t1.paragraphes.join('\n\n'), L.texteRelanceLots1('2026-12-02'))
  assert.equal(E.modeleRelanceLots(2, '2026-12-02').paragraphes.join('\n\n'), L.texteRelanceLots2('2026-12-02'))
  assert.equal(E.modeleSuspensionLots().paragraphes.join('\n\n'), L.texteSuspensionLots())
  for (const m of [E.modeleRelanceLots(1, '2026-12-02', 'email'), E.modeleRelanceLots(2, '2026-12-02', 'email'), E.modeleSuspensionLots('email')]) {
    const t = m.paragraphes.join('\n\n')
    assert.equal(m.boutonBot, undefined)
    assert.ok(!/\b(tu|ton|ta|tes)\b/i.test(t), `vouvoiement : ${m.sujet}`)
    assert.match(t, /t\.me\//)
    texteSain(t, m.sujet)
    assert.ok(E.htmlEmail(m).includes('Brice et Mélanie'))
  }
})

bloc('agent des membres : outil et consigne des lots pour ce membre seulement', () => {
  const msg = [{ role: 'user', content: 'salut' }]
  const sans = M.requeteAgentMembre(msg)
  assert.ok(!sans.tools.some(t => t.name === M.NOM_OUTIL_LOTS))
  assert.equal(sans.system.length, 1)
  const etat = { etat: 'a_faire', limite: '2026-12-02', declare: false }
  const avec = M.requeteAgentMembre(msg, undefined, { lots: etat })
  assert.equal(avec.tools.at(-1).name, 'lots_trades')
  assert.deepEqual(avec.tools.at(-1).input_schema.properties, {}, 'aucun parametre : l identite vient du serveur')
  assert.equal(avec.system.length, 2)
  assert.equal(avec.system[0].text, sans.system[0].text, 'le prompt commun (en cache) ne change pas')
  const c = avec.system[1].text
  assert.match(c, /^Information du serveur sur le membre qui t'écrit \(ce n'est pas un message du membre\)/)
  assert.match(c, /jusqu'au 2 décembre 2026/)
  assert.match(c, /appelle lots_trades sans écrire de texte/)
  assert.match(M.consigneLots({ ...etat, etat: 'en_retard' }), /EN PAUSE \(ce n'est pas un bannissement, rien de définitif\)/)
  assert.match(M.consigneLots({ ...etat, declare: true }), /l'équipe vérifie chez le broker, il n'a rien à refaire/)
  // Relais et lots ensemble : les deux outils.
  const deux = M.requeteAgentMembre(msg, 'CTX', { relais: true, lots: etat })
  assert.deepEqual(deux.tools.slice(-3).map(t => t.name), ['membre_a_contacter', 'proposer_correction_pseudo', 'lots_trades'])
})

bloc('commission : prevue a la fin du mois des lots (moisPrevuCommission, deja la regle)', () => {
  const c = { statut: 'attendue', le: '2026-10-31', lotsFaitsLe: null }
  assert.equal(RP.moisPrevuCommission(c, '2026-10'), '2026-10')
  assert.equal(RP.glissementCommission(c, '2026-11'), 'lots')
  const lots = { ...c, lotsFaitsLe: '2026-11-20' }
  assert.equal(RP.moisPrevuCommission(lots, '2026-10'), '2026-11')
  assert.equal(RP.moisPrevuCommission(lots, '2026-11'), '2026-11')
  // Elle COMPTE dans la repartition le mois ou elle est recue (regle du 08/10).
  assert.equal(RP.moisDeLaCommission({ statut: 'recue', recueLe: '2026-12-31' }), '2026-12')
})

bloc('Agent AOK : carte courte pour Melanie, l action exacte du bouton', () => {
  assert.equal(AP.estMelanie('Mélanie'), true)
  assert.equal(AP.estMelanie('melanie'), true)
  assert.equal(AP.estMelanie('Mel'), true)
  assert.equal(AP.estMelanie('Brice'), false)
  assert.equal(AP.estMelanie(null), false)
  const p = { partenaire: 'raisefx', partenaire_nom: 'RaiseFx', email: 'x@y.fr', client: null, montant: 650, le: '2026-10-31', mois: 6, commission: 587, note: null }
  const court = RP.resumeCourtRepartition('depot_broker', p)
  assert.equal(court, "Dépôt RaiseFx de 650 € le 31/10 pour x@y.fr, commission 587 €. Accès Live Club 6 mois et email d'invitation, si l'adresse n'a jamais eu d'accès broker.")
  assert.ok(court.length < RP.resumeRepartition('depot_broker', p).length)
  assert.equal(RP.resumeCourtRepartition('marquer_commission', { etat: 'lots_faits', le: '2026-11-20', qui: 'Jean' }), 'Lots faits le 20/11 : Jean.')
  assert.equal(RP.resumeCourtRepartition('taux_partenaire', { partenaire_nom: 'RaiseFx', retroactif: true, a_partir_du: '2026-11-01', montant_fixe: 800 }), null, 'retroactif : la carte longue')
  for (const type of RP.TYPES_REPARTITION) assert.ok(type in { depot_broker: 1, commission_affiliation: 1, marquer_commission: 1, taux_partenaire: 1, intervenant: 1, lives_du_mois: 1, depense: 1, reglement: 1 })
})

bloc('Agent AOK : ton de Mel, euros, commission de CE depot, note « a confirmer » (prompt)', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  assert.match(src, /AVEC ELLE, DES MESSAGES COURTS, en francais simple : elle n'a pas la patience des messages detailles\./)
  assert.match(src, /Le detail ne le gene pas, mais une demande complete appelle la carte tout de suite/)
  assert.match(src, /LES MONTANTS SONT EN EUROS \(31\/10\) : « 650 EUR \(655 USD\) »/)
  assert.match(src, /Un montant en dollars SEULEMENT : une question courte, « Combien en euros \? »/)
  assert.match(src, /passe-la telle quelle \(commission de proposer_depot_broker\) et c'est tout, sans AUCUNE question/)
  assert.ok(!/demande si c'est la règle de ce broker pour tous ses clients ou seulement pour ce dépôt/.test(src), 'plus de debat sur la regle generale')
  assert.match(src, /« \.\.\. à confirmer par Mel »\) n'est PAS un accord/)
  assert.match(src, /QUAND TOUT EST LÀ \(31\/10\) : propose la carte TOUT DE SUITE/)
  assert.match(src, /LES RÈGLES DÉFINITIVES PAR BROKER \(31\/10\) : c'est Mélanie qui les donne/)
  assert.match(src, /« Lots à vérifier »/)
  // La carte courte n'est que pour Melanie, et garde l'alerte du controle.
  assert.match(src, /const court = !carte && estMelanie\(qui\) && estTypeRepartition\(action\.type\)/)
  assert.match(src, /alerte \? `\$\{court\} \$\{alerte\}` : court/)
  // La seule note lue comme accord reste celle de la carte d'accord (29/10).
  assert.equal(RP.accordNote("Si les accès d'avant étaient RaiseFx (et non Pulse) : 650 EUR fixes par dépôt dès 1000 EUR (Brice, 29/10) ; palier minimum abaissé depuis. Accord à confirmer par Mel."), null)
  assert.ok(RP.accordNote('Accord à partir du 1er novembre 2026 : 650 EUR par dépôt.'))
})

bloc('cablage : droit, bot, passage, clic de l equipe, prudence (lecture des sources)', () => {
  const droits = lire('src/lib/liveclub/droits.ts')
  assert.match(droits, /const lots = lignes\.length \? await lotsDesAcces\(/)
  assert.match(droits, /if \(etat\?\.etat === 'en_retard'\) \{\n\s+lotsEnPause \?\?= etat\n\s+continue/)
  assert.match(droits, /\.\.\.\(lotsEnPause \? \{ lots: lotsEnPause \} : \{\}\)/)
  const lecture = lire('src/lib/liveclub/lots-lecture.ts')
  assert.match(lecture, /NE JETTE JAMAIS/)
  assert.match(lecture, /if \(!suiviLotsActif\(\) \|\| accesIds\.length === 0\) return etats/)
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.match(bot, /if \(data === BOUTON_LOTS\.data\) \{\n\s+await repondreBouton\(bouton\.id\)\n\s+const d = await declarerLots\(u\.id, \{ origine: 'bouton' \}\)/)
  assert.match(bot, /regle: droit\.dette \? 'impaye_ouvert' : enPauseLots \? 'lots_non_faits' : 'sans_droit'/)
  assert.match(bot, /droit\.lots\?\.etat === 'en_retard' && o\.declencheur !== 'bouton'/)
  assert.match(bot, /droit\.raison === 'acces_broker' && droit\.lots\?\.etat === 'a_faire' && !droit\.lots\.declare/)
  const clic = lire('src/lib/agent-cockpit-telegram.ts')
  const iVerrou = clic.indexOf("await acquitter('Accès réservé.')")
  const iLots = clic.indexOf('const lots = lireBoutonLots(donnee)')
  assert.ok(iVerrou > 0 && iLots > iVerrou, 'le clic des lots passe APRES le verrou du compte de l equipe')
  const passage = lire('src/lib/liveclub/passage.ts')
  assert.match(passage, /await etape\('lots', \(\) => tacheLots\(ctx\)\)/)
  assert.match(passage, /if \(!sortiesActives\(\)\) \{\n\s+let deja: boolean/)
  assert.match(passage, /const issue = await sortir\(ctx, tid, \{ geste: 'retrait', regle: 'lots_non_faits', details \}\)/)
  assert.match(passage, /cle: `liveclub:\$\{regle\}:\$\{l\.commissionId\}`/)
  assert.match(passage, /const relu = await reluLots\(ctx, l\)/)
  const lots = lire('src/lib/liveclub/lots.ts')
  assert.match(lots, /pg_advisory_xact_lock\(hashtextextended\(\$\{`liveclub:lots_declares:/)
  assert.match(lots, /only_if_banned: true/)
  assert.ok(!/banChatMember'|'banChatMember/.test(lots.replace(/unbanChatMember/g, '')), 'jamais de ban')
  assert.match(lots, /for update`/)
  assert.match(lots, /type: 'marquer_commission', compte: 'cockpit',\n\s+params: \{ commission_id: d\.commissionId, etat: 'lots_faits', le: d\.lotsLe \}/)
  assert.match(lots, /executerActionRepartition\(action, `agent:\$\{compte\.user_id\}`\)/)
  const agent = lire('src/lib/liveclub/agent-membre.ts')
  assert.match(agent, /bloc\.name === NOM_OUTIL_PROPOSER_CORRECTION_PSEUDO \|\| bloc\.name === NOM_OUTIL_LOTS\)\) \{/)
  assert.match(agent, /if \(!lots\) \{\n\s+resultats\.push\(\{ type: 'tool_result', tool_use_id: bloc\.id, content: JSON\.stringify\(\{ erreur: 'Outil inconnu\.' \}\), is_error: true \}\)/)
  const config = lire('src/lib/liveclub/config.ts')
  assert.match(config, /return process\.env\.LIVECLUB_SUIVI_LOTS\?\.trim\(\) !== '0'/)
})

console.log(`\n${n} blocs ok`)
