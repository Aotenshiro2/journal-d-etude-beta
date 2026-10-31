// Tests du DEPOT PERDU (Brice, 31/10 : « pas de commission pas d'acces ») et
// des noms d'outils d'Agent AOK (31/10) :
// - la regle (lecture), le droit qui ferme l'acces, la situation dite au membre ;
// - les textes au membre (prive, email, retour apres regularisation) ;
// - l'alerte a Brice et Melanie, les phrases du journal et du resume ;
// - la carte d'Agent AOK : perdue qui ferme, regularisation (attendue, lots faits) ;
// - le cablage : passage (sortie sans ban, message et alerte une fois, filet du
//   retour), bot, clic « Oui, lots tradés » sur une commission perdue ;
// - Agent AOK ne cite plus ses noms d'outils (consigne et filet du serveur).
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-depot-perdu.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const L = await import('../src/lib/liveclub/lots-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const E = await import('../src/lib/liveclub/emails.ts')
const R = await import('../src/lib/liveclub/resume-pur.ts')
const RP = await import('../src/lib/repartition/pur.ts')
const AP = await import('../src/lib/agent-cockpit-pur.ts')
const { texteAbonnement } = await import('../src/lib/liveclub/config.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

/** Caracteres clavier simples, sans « jamais », sans ban, sans emoji, sans reproche (textes aux membres). */
function texteSain(t, nom) {
  assert.ok(!/[\u2014\u2013\u2026\u201c\u201d\u2018\u2019\u2022]/.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!/\.\.\./.test(t), `${nom} : points de suspension`)
  assert.ok(!/[\u00a0\u202f\u200b-\u200d\u2060\ufeff]/.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
  assert.ok(!/jamais/i.test(t), `${nom} : « jamais » dans un texte au membre`)
  assert.ok(!/\bbann?(i|ir|issement)?\b|exclu/i.test(t), `${nom} : ban ou exclusion`)
  assert.ok(!/retir[ée]|fraud|faute|abus|malgr[ée]/i.test(t), `${nom} : reproche`)
  for (const url of t.match(/https?:\/\/\S+/g) ?? []) assert.match(url, /[A-Za-z0-9/]$/, `${nom} : ponctuation collee au lien ${url}`)
}

const PORTES = texteAbonnement()

bloc('la regle : depot perdu depuis le deploiement, aucun depot attendu ni recu, coupure', () => {
  assert.match(L.DEPOT_PERDU_DEPUIS, /^2026-\d{2}-\d{2}$/)
  const lecture = lire('src/lib/liveclub/lots-lecture.ts')
  const sql = lecture.slice(lecture.indexOf('async function lireFermes('), lecture.indexOf('export function accesFermesParDepot('))
  assert.match(sql, /c1\.nature = 'depot' and c1\.statut = 'perdue'/)
  assert.match(sql, /\(coalesce\(c1\.maj_le, c1\.pose_le\) at time zone 'Europe\/Paris'\)::date >= \$\{DEPOT_PERDU_DEPUIS\}::date/)
  assert.match(sql, /c2\.nature = 'depot' and c2\.statut in \('attendue', 'recue'\)\)/)
  assert.match(sql, /a\.motif = 'broker' and a\.retire_le is null and a\.sorti_le is null and a\.jusquau >= current_date/)
  assert.ok(!/update |insert /i.test(sql), 'un etat lu : rien n est ecrit sur l acces')
  // Le droit ne jette pas : lecture ratee ou regle coupee = acces garde.
  const droitLecture = lecture.slice(lecture.indexOf('export async function depotsPerdusDesAcces('))
  assert.match(droitLecture, /if \(!fermetureDepotPerduActive\(\) \|\| accesIds\.length === 0\) return fermes/)
  assert.match(droitLecture, /catch \(err\) \{\n\s+console\.warn\(`\[liveclub\/lots\] depots perdus illisibles \(droit garde\)/)
  assert.match(lire('src/lib/liveclub/config.ts'), /return process\.env\.LIVECLUB_DEPOT_PERDU\?\.trim\(\) !== '0'/)
})

bloc('le droit : un acces ferme n ouvre plus le groupe, le non porte depotPerdu', () => {
  const droits = lire('src/lib/liveclub/droits.ts')
  assert.match(droits, /const fermes = lignes\.length \? await depotsPerdusDesAcces\(lignes\.map\(l => l\.acces_id\)\)/)
  assert.match(droits, /if \(ferme\) \{\n\s+depotPerdu \?\?= ferme\n\s+continue\n\s+\}/)
  assert.ok(droits.indexOf('if (ferme) {') < droits.indexOf("if (etat?.etat === 'en_retard')"), 'le depot perdu est lu avant les lots')
  assert.match(droits, /\.\.\.\(depotPerdu \? \{ depotPerdu \} : \{\}\)/)
})

bloc('situation : un acces offert ferme qui dit pourquoi, les deux portes, jamais « envoie ton email »', () => {
  const ferme = { statut: 'non', raison: null, depotPerdu: { commissionId: 'c' } }
  assert.equal(P.accesFermeDepot(ferme), true)
  assert.equal(P.accesFermeDepot({ statut: 'oui', raison: 'acces_broker', depotPerdu: { commissionId: 'c' } }), false)
  assert.equal(P.parcoursSansRattachement('aucun', ferme), 'acces_offert')
  assert.equal(P.parcoursSansRattachement('illisible', ferme), 'acces_offert')
  const a = P.accesSansAbonnement(ferme, { texteAbonnement: PORTES, lots: L.TEXTES_LOTS_SITUATION })
  assert.equal(a.texte, L.texteAccesFermeDepot(PORTES))
  assert.equal(a.faits.acces, 'offert_broker_ferme')
  assert.ok(!/l'email de ton paiement|envoie-moi ton email/i.test(a.texte))
  assert.match(a.rienAGerer, /rien à mettre en pause ni à arrêter/)
  // Sans les textes (anciens appelants) : une phrase neutre et les portes, jamais null.
  assert.ok(P.accesSansAbonnement(ferme, { texteAbonnement: PORTES }).texte.endsWith(PORTES))
  // Une pause des lots (un autre acces) passe avant : il la leve seul.
  const deux = { ...ferme, lots: { etat: 'en_retard', limite: '2026-12-02', declare: false } }
  assert.equal(P.accesFermeDepot(deux), false)
  assert.equal(P.accesSansAbonnement(deux, { texteAbonnement: PORTES, lots: L.TEXTES_LOTS_SITUATION }).texte, L.texteAccesEnPauseLots())
})

bloc('textes au membre : sobres, sans reproche, le depot pas active, regulariser ou s abonner', () => {
  const prive = L.texteFermetureDepot(PORTES)
  assert.ok(prive.startsWith("Salut ! Ton accès au Live Club par le broker n'est plus valide : ton dépôt chez lui n'a pas été activé."))
  assert.match(prive, /Ton accès au groupe Telegram est donc fermé pour le moment\./)
  assert.match(prive, /régulariser avec l'équipe \(un nouveau dépôt activé chez le broker, puis tes premiers lots tradés\), ou t'abonner au Live Club/)
  assert.match(prive, /appuie sur « Contacter l'équipe » : l'équipe te répond ici\./)
  assert.ok(prive.endsWith(PORTES))
  const situation = L.texteAccesFermeDepot(PORTES)
  assert.ok(situation.startsWith("Ton accès au Live Club par le broker n'est plus valide"))
  for (const [t, nom] of [
    [prive, 'fermeture prive'], [situation, 'situation'],
    [L.TEXTE_DEPOT_REGULARISE_RETOUR, 'retour'], [L.TEXTE_DEPOT_REGULARISE_SANS_LIEN, 'retour sans lien'],
  ]) texteSain(t, nom)
  assert.equal(L.BOUTON_EQUIPE_DEPOT.data, 'm:equipe')
  assert.equal(L.BOUTON_EQUIPE_DEPOT.texte, P.libelleBouton('m:equipe'))
  // En prive : le bouton de l'equipe ; par email : vouvoiement, repondre a l'email, sans bouton du bot.
  const t = E.modeleFermetureDepot()
  assert.deepEqual(t.boutonBot, { texte: "Contacter l'équipe", data: 'm:equipe' })
  assert.equal(t.paragraphes.join('\n\n'), prive)
  const m = E.modeleFermetureDepot('email')
  const texteEmail = m.paragraphes.join('\n\n')
  assert.equal(m.boutonBot, undefined)
  assert.ok(!/\b(tu|ton|ta|tes|toi)\b/i.test(texteEmail), 'vouvoiement')
  assert.match(texteEmail, /Pour régulariser, répondez à cet email/)
  texteSain(texteEmail, 'fermeture email')
  assert.ok(E.htmlEmail(m).includes('Brice et Mélanie'))
})

bloc('alerte a Brice et Melanie : trois lignes courtes, ce qui est arrive, comment rouvrir', () => {
  const base = { qui: 'Jean', email: 'jean@x.fr', partenaire: 'RaiseFx', depot: '650 EUR', depotLe: '2026-10-29' }
  const issues = {
    sorti: /Il est sorti du groupe, sans blocage, et il a reçu en privé le message pour régulariser\./,
    absent: /Il n'était pas dans le groupe ; il a reçu en privé le message pour régulariser\./,
    sans_compte: /Il n'est pas encore entré dans le groupe ; il a reçu en privé le message pour régulariser\./,
    garde: /Il garde le groupe par un autre accès/,
  }
  for (const [issue, attendu] of Object.entries(issues)) {
    const t = L.texteAlerteDepotPerdu({ ...base, issue, message: 'prive' })
    const lignes = t.split('\n')
    assert.equal(lignes.length, 3)
    assert.equal(lignes[0], "Commission perdue chez RaiseFx : l'accès broker de Jean (jean@x.fr) est fermé (pas de commission, pas d'accès). Dépôt de 650 EUR du 29 octobre 2026.")
    assert.match(lignes[1], attendu)
    assert.match(lignes[2], /je remets sa commission en attendue ou en lots faits, et son accès rouvre/)
    assert.ok(!/[\u2014\u2013]/.test(t))
  }
  assert.match(L.texteAlerteDepotPerdu({ ...base, issue: 'sorti', message: 'email' }), /reçu par email/)
  assert.match(L.texteAlerteDepotPerdu({ ...base, issue: 'absent', message: null }), /je n'ai pas pu lui écrire/)
  assert.match(L.MARQUEUR_ALERTE_DEPOT, /^\[système\] .+ce n'est pas une question de l'équipe\)\.$/)
})

bloc('journal et resume : chaque geste du depot perdu a sa phrase', () => {
  const g = (geste, resultat, regle, details = {}) => P.phraseGeste({ geste, resultat, regle, details })
  assert.match(g('retrait', 'fait', 'depot_perdu'), /sans blocage : accès broker fermé, dépôt pas activé/)
  assert.match(g('rappel', 'fait', 'depot_perdu_message', { canal: 'email' }), /Message de fermeture de l'accès broker .+ envoyé par email\./)
  assert.match(g('acces_broker', 'fait', 'depot_perdu_alerte'), /l'équipe est prévenue/)
  assert.match(g('entree_refusee', 'fait', 'depot_perdu'), /accès broker fermé : dépôt pas activé/)
  assert.match(g('invitation', 'refuse', 'depot_perdu'), /accès broker fermé/)
  assert.match(g('invitation', 'fait', 'retour_depot'), /Situation régularisée avec le broker : accès rouvert, lien de retour envoyé\./)
  assert.match(g('invitation', 'refuse', 'retour_depot'), /déjà revenu/)
  const ev = (geste, regle) => R.evenementDeGeste({ id: '1', geste, resultat: 'fait', regle, details: {}, telegramId: null, membreId: null, faitLe: '2026-11-03' })
  assert.match(ev('retrait', 'depot_perdu').detail, /accès broker fermé : dépôt pas activé \(commission perdue\), sorti du groupe sans blocage/)
  assert.match(ev('invitation', 'retour_depot').detail, /situation régularisée/)
})

bloc('carte d Agent AOK : perdue, et regularisation (attendue ou lots faits)', () => {
  const ctx = { aujourdhui: '2026-10-31', moisCourant: '2026-10' }
  const id = '0a1b2c3d-0000-4000-8000-000000000001'
  const att = RP.lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'attendue', qui: 'Jean' }, ctx)
  assert.deepEqual(att, { commission_id: id, etat: 'attendue', le: '2026-10-31', qui: 'Jean', note: null })
  // regulariser : pose par le controle du serveur, garde seulement pour attendue ou lots_faits.
  assert.equal(RP.lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'attendue', regulariser: true }, ctx).regulariser, true)
  assert.equal(RP.lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'lots_faits', regulariser: true }, ctx).regulariser, true)
  assert.equal(RP.lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'perdue', regulariser: true }, ctx).regulariser, undefined)
  assert.equal(RP.lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'lots_faits', regulariser: 'oui' }, ctx).regulariser, undefined)
  assert.equal(typeof RP.lireParamsRepartition('marquer_commission', { commission_id: id, etat: 'payee' }, ctx), 'string')
  // Les cartes disent l'action exacte.
  assert.equal(RP.resumeRepartition('marquer_commission', { etat: 'attendue', qui: 'Jean' }), 'Remettre la commission de Jean en attendue (régularisation) : elle revient dans les commissions attendues.')
  assert.equal(RP.resumeRepartition('marquer_commission', { etat: 'lots_faits', le: '2026-11-05', qui: 'Jean', regulariser: true }), 'Régulariser la commission de Jean : de nouveau attendue, lots faits le 5 novembre 2026.')
  assert.equal(RP.resumeCourtRepartition('marquer_commission', { etat: 'attendue', qui: 'Jean' }), 'Commission de nouveau attendue : Jean (régularisation).')
  assert.equal(RP.resumeCourtRepartition('marquer_commission', { etat: 'lots_faits', le: '2026-11-05', qui: 'Jean' }), 'Lots faits le 05/11 : Jean.')
  assert.match(L.PHRASE_CARTE_PERTE_FERME, /il sort du groupe sans blocage et reçoit un message pour régulariser ; Brice et Mel sont prévenus\./)
  assert.match(L.PHRASE_CARTE_REGULARISATION, /elle redevient attendue, et son accès broker au Live Club rouvre/)
  for (const i of ['lien', 'lien_deja', 'dans_le_groupe', 'sans_lien', 'pas_prevenu', 'encore_ferme', 'en_pause_lots', 'panne']) {
    assert.ok(L.phraseApresRegularisation(i).length > 20, i)
  }
})

bloc('serveur de la repartition : controle et ecriture de la regularisation', () => {
  const s = lire('src/lib/repartition/serveur.ts')
  assert.match(s, /const regularisation = c\.statut === 'perdue' && \(p\.etat === 'attendue' \|\| p\.etat === 'lots_faits'\)/)
  assert.match(s, /\.\.\.\(regularisation \? \{ regulariser: true \} : \{\}\)/)
  assert.match(s, /alerte = ALERTE_CARTE_PERTE_FERME/)
  const exec = s.slice(s.indexOf("if (type === 'marquer_commission') {\n    const id = String(p.commission_id)"))
  assert.match(exec, /const regularisation = p\.regulariser === true && c\.statut === 'perdue' && \(etat === 'attendue' \|\| etat === 'lots_faits'\)/)
  assert.match(exec, /set statut = 'attendue',\n\s+lots_faits_le = case when \$\{etat === 'lots_faits'\} then \$\{le\}::date else lots_faits_le end,/)
  assert.match(exec, /where commission_id = \$\{id\}::uuid and statut = 'perdue'`/)
  assert.match(exec, /await import\('@\/lib\/liveclub\/lots'\)/)
  assert.match(exec, /apresMarquageDepot\(id, 'regularisee', acteur\)/)
  assert.match(exec, /apresMarquageDepot\(id, 'perdue', acteur\)/)
  // Le lots_faits ordinaire reste sur une commission attendue (le clic « Oui, lots tradés » ne regularise rien).
  assert.match(exec, /set lots_faits_le = \$\{le\}::date, maj_par = \$\{posePar\}::uuid, note = coalesce\(\$\{note\}, note\)\n\s+where commission_id = \$\{id\}::uuid and statut = 'attendue'/)
  const lots = lire('src/lib/liveclub/lots.ts')
  const oui = lots.slice(lots.indexOf('async function apresOui('), lots.indexOf('async function apresNon('))
  assert.ok(oui.indexOf("c?.statut === 'perdue'") > 0 && oui.indexOf("c?.statut === 'perdue'") < oui.indexOf('validerAction('), 'perdue verifiee avant l ecriture')
  assert.match(oui, /await annulerDecision\(d\.decisionId\)\n\s+return \{\n\s+ok: false,/)
  assert.ok(!/regulariser/.test(oui), 'le clic des lots ne passe pas regulariser')
})

bloc('passage : sortie sans ban, message et alerte une fois, filet du retour, rappel J-7 epargne', () => {
  const passage = lire('src/lib/liveclub/passage.ts')
  const iLots = passage.indexOf("await etape('lots', () => tacheLots(ctx))")
  const iDepot = passage.indexOf("await etape('depots_perdus', () => tacheDepotsPerdus(ctx))")
  assert.ok(iLots > 0 && iDepot > iLots, 'apres les lots')
  const t = passage.slice(passage.indexOf('async function tacheDepotsPerdus('), passage.indexOf('// (q) L\'ACCUEIL ETALE'))
  assert.match(t, /if \(!fermetureDepotPerduActive\(\)\) \{\n\s+s\.coupe = true/)
  assert.match(t, /relu = await accesFermeDeCommission\(l\.commissionId\)/)
  assert.match(t, /if \(estIntouchable\(p\)\) \{ s\.gardes\+\+; return \}/)
  assert.match(t, /const droit = await droitAvantSortie\(tid, \[l\.email\]\)/)
  assert.match(t, /if \(!sortiesActives\(\)\) \{/)
  assert.match(t, /await sortir\(ctx, tid, \{ geste: 'retrait', regle: 'depot_perdu', details \}\)/)
  assert.match(t, /cle: `liveclub:depot_perdu_message:\$\{l\.commissionId\}`/)
  assert.match(t, /cle: `liveclub:depot_perdu_alerte:\$\{l\.commissionId\}`/)
  assert.match(t, /retourApresRegularisation\(tid, \{ commissionId: l\.commission_id, acteur: ACTEUR \}\)/)
  assert.match(t, /c2\.nature = 'depot' and c2\.statut in \('attendue', 'recue'\)\)/)
  assert.ok(!/banChatMember/.test(t.replace(/unbanChatMember/g, '')), 'jamais de ban')
  assert.match(passage, /if \(\(await depotsPerdusDesAcces\(\[l\.acces_id\]\)\)\.has\(l\.acces_id\)\) \{ s\.ignores\+\+; continue \}/)
  const lots = lire('src/lib/liveclub/lots.ts')
  assert.match(lots, /regle: 'retour_depot', texte: TEXTE_DEPOT_REGULARISE_RETOUR/)
  assert.match(lots, /only_if_banned: true/)
  assert.ok(!/banChatMember'|'banChatMember/.test(lots.replace(/unbanChatMember/g, '')), 'jamais de ban')
})

bloc('bot des membres : demande d adhesion, lien, jeton, avec le bouton de l equipe', () => {
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.match(bot, /const fermeDepot = !droit\.dette && !enPauseLots && Boolean\(droit\.depotPerdu\)/)
  assert.match(bot, /else if \(fermeDepot\) await envoyer\(ecrireA, texteAccesFermeDepot\(texteAbonnement\(\)\), clavierEquipe\(\)\)/)
  assert.match(bot, /if \(!droit\.dette && droit\.depotPerdu && o\.declencheur !== 'bouton'\) \{/)
  assert.match(bot, /\{ geste: 'invitation', resultat: 'refuse', regle: 'depot_perdu', details \}/)
  assert.match(bot, /if \(droit\.depotPerdu\) \{\n\s+await envoyer\(chat, texteAccesFermeDepot\(texteAbonnement\(\)\), clavierAccesOffert\(\)\)/)
})

bloc('consigne d Agent AOK : pas de commission, pas d acces ; regularisation par la carte', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  assert.match(src, /PAS DE COMMISSION, PAS D'ACCÈS \(règle de Brice, 31\/10\)/)
  assert.match(src, /RÉGULARISER \(il a refait un dépôt activé, ou ses lots sont tradés\) = proposer_marquer_commission sur la commission perdue, etat attendue, ou lots_faits/)
  assert.match(src, /Un dépôt seulement douteux, non marqué perdu : rien d'automatique/)
  assert.match(src, /etat: \{ type: 'string', enum: \['lots_faits', 'recue', 'perdue', 'attendue'\]/)
})

bloc('regle 2 : Agent AOK decrit l action en francais, jamais par le nom d un outil', () => {
  // Le cas du 31/10.
  assert.equal(
    AP.sansNomsOutils("Si tu me le confirmes, je proposerai alors la carte proposer_taux_partenaire pour enregistrer l'accord daté."),
    "Si tu me le confirmes, je proposerai alors la carte d'accord du broker pour enregistrer l'accord daté.",
  )
  assert.equal(AP.sansNomsOutils('Je lance `requete_sql` pour vérifier.'), 'Je lance une lecture de la base pour vérifier.')
  assert.equal(AP.sansNomsOutils("Avec l'outil fiche_personne, je vois deux fiches."), 'Avec la fiche de la personne, je vois deux fiches.')
  assert.equal(AP.sansNomsOutils('Puis proposer_depot_broker, et c est bon.'), 'Puis la carte de dépôt broker, et c est bon.')
  assert.equal(AP.sansNomsOutils('Je propose la carte de proposer_marquer_commission.'), 'Je propose la carte de suivi de la commission.')
  // Un texte sans nom d'outil ne bouge pas (une table, un email, un mot compose).
  for (const t of ['La table cockpit_commissions dit 3 dépôts.', 'jean_dupont@x.fr', 'Rien à signaler.', '']) assert.equal(AP.sansNomsOutils(t), t)
  // Chaque outil d'Agent AOK a sa description, sans nom technique.
  const noms = [...lire('src/lib/agent-cockpit.ts').matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1])
  noms.push(...[...lire('src/lib/generation-agent.ts').matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1]))
  assert.ok(noms.length >= 30, `outils lus : ${noms.length}`)
  for (const nom of noms) assert.ok(AP.DESCRIPTIONS_OUTILS[nom], `outil sans description : ${nom}`)
  for (const [nom, d] of Object.entries(AP.DESCRIPTIONS_OUTILS)) {
    assert.ok(!/_/.test(d), `${nom} : description technique`)
    assert.equal(AP.sansNomsOutils(`Voici ${nom}.`), `Voici ${d}.`)
  }
  // La consigne et le filet, aux deux endroits ou la reponse part.
  const src = lire('src/lib/agent-cockpit.ts')
  assert.match(src, /TES OUTILS SONT INTERNES \(règle de Brice, 31\/10\) : dans tes réponses, décris l'action en français, jamais par le nom d'un outil ni d'un paramètre\./)
  assert.match(src, /reply: sansNomsOutils\(textOf\(response\)\) \|\| 'Je n.ai pas de réponse\.'/)
  assert.match(src, /reply: \(sansNomsOutils\(textOf\(response\)\)/)
  // Le complement de la carte (texte du serveur) passe au filet ; une carte composee (effacement, reponse) n'est pas touchee.
  assert.match(src, /resume: carte \?\? \(resumeAction\(action\) \+ \(complement \? ` \$\{sansNomsOutils\(complement\)\}` : ''\)\)/)
  // Le texte d'une carte du serveur ne cite plus d'outil.
  assert.ok(!/chaque dépôt devra porter sa commission \(proposer_depot_broker/.test(lire('src/lib/repartition/serveur.ts')))
})

console.log(`\n${n} blocs ok`)
