// Verification des messages du bot des membres autour de l'equipe (Brice,
// 22/10/2026, cas reel de Christine) : ils dependent de l'ETAT du fil relu
// juste avant l'envoi, plus d'une sequence supposee. Regles PURES de
// src/lib/liveclub/support-pont-pur.ts (section 4), texte de l'alerte
// « annulée » (alerte-equipe-telegram-pur.ts), puis un controle statique du
// branchement (bot-membre.ts, support-pont.ts, lecture-attente.ts).
// Aucune base, aucun reseau, aucun modele. Lancement :
//   node scripts/verifier-attente-equipe.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as S from '../src/lib/liveclub/support-pont-pur.ts'
import { texteDemandeHumain, dernierMessageMembre } from '../src/lib/alerte-equipe-telegram-pur.ts'

let n = 0
function test(nom, f) {
  f()
  n++
  console.log(`ok  ${nom}`)
}
// Caracteres clavier : pas de tiret long ni demi-cadratin, pas de points de suspension en un caractere, pas d'emoji.
const SOBRE = (s) => !/[—–…“”‘’]/.test(s) && !/\p{Extended_Pictographic}/u.test(s)
const MIN = 60 * 1000
const H = 60 * MIN
const T0 = Date.UTC(2026, 9, 22, 9, 17) // 11:17 a Paris
const at = (ms) => new Date(ms).toISOString()
const membre = (t, c) => ({ role: 'user', content: c, at: at(t) })
const bot = (t, c, auteur = 'bot') => ({ role: 'assistant', content: c, at: at(t), auteur })
const humain = (t, c = 'Hello, comment est-ce que je peux t aider ?') => ({ role: 'human', content: c, at: at(t) })
const systeme = (t, c) => ({ role: 'system', content: `${S.PREFIXE_SYSTEME}${c}`, at: at(t) })
const BOUTON = "[bouton] Contacter l'équipe"

// --- A. Le texte de « Contacter l'équipe » -----------------------------------------

test('A. deux versions du texte, selon ce que le membre a deja ecrit', () => {
  assert.equal(S.TEXTE_EQUIPE_DEJA_ECRIT,
    "C'est noté, je préviens l'équipe : quelqu'un va te répondre ici. Elle voit déjà toute notre conversation, tu n'as rien à réécrire.")
  assert.equal(S.TEXTE_EQUIPE_SANS_ECRIT,
    "C'est noté, je préviens l'équipe : quelqu'un va te répondre ici. Elle voit déjà toute notre conversation.\n\n"
    + 'Si tu veux aller plus vite, dis-moi en une phrase ce dont tu as besoin.')
  for (const t of [S.TEXTE_EQUIPE_DEJA_ECRIT, S.TEXTE_EQUIPE_SANS_ECRIT]) {
    assert.ok(SOBRE(t), t)
    assert.ok(!/Écris ta question|réécris ta question/i.test(t), 'plus jamais « écris ta question »')
  }
  // Il a ecrit il y a 2 h : rien a reecrire.
  const ecrit = [membre(T0 - 2 * H, 'je ne vois plus le groupe'), bot(T0 - 2 * H + 5000, 'Je regarde...', 'ia')]
  assert.equal(S.texteEquipe(ecrit, T0), S.TEXTE_EQUIPE_DEJA_ECRIT)
  // Une image compte comme un message.
  assert.equal(S.texteEquipe([{ ...membre(T0 - H, '[image]'), piece: { file_id: 'x' } }], T0), S.TEXTE_EQUIPE_DEJA_ECRIT)
  // Seulement des boutons, des commandes, des traces sans texte (cas de Christine) : l'invitation facultative.
  const gestes = [membre(T0 - 3 * MIN, '/start'), membre(T0 - 2 * MIN, '[bouton] Mon abonnement'),
    membre(T0 - MIN, '[message sans texte]'), membre(T0 - 30000, '[code de vérification tapé]'), membre(T0 - 1000, BOUTON)]
  assert.equal(S.texteEquipe(gestes, T0), S.TEXTE_EQUIPE_SANS_ECRIT)
  assert.equal(S.texteEquipe([], T0), S.TEXTE_EQUIPE_SANS_ECRIT)
  // Fenetre de 24 h : un message d'avant-hier ne compte plus ; un message sans date non plus.
  assert.equal(S.FENETRE_DEJA_ECRIT_MS, 24 * H)
  assert.equal(S.texteEquipe([membre(T0 - 24 * H - MIN, 'ancien sujet')], T0), S.TEXTE_EQUIPE_SANS_ECRIT)
  assert.equal(S.texteEquipe([membre(T0 - 24 * H + MIN, 'hier soir')], T0), S.TEXTE_EQUIPE_DEJA_ECRIT)
  assert.equal(S.texteEquipe([{ role: 'user', content: 'sans date' }], T0), S.TEXTE_EQUIPE_SANS_ECRIT)
  // Un message de l'equipe ou du bot ne compte pas comme ecrit par le membre.
  assert.equal(S.texteEquipe([humain(T0 - H), bot(T0 - H, 'menu')], T0), S.TEXTE_EQUIPE_SANS_ECRIT)
})

// --- B. Le bouton quand l'equipe est deja prevenue ou deja la ------------------------

test('B. bouton : deja prevenue ou deja la = une notification, aucun message', () => {
  assert.equal(S.decisionBoutonEquipe(null, T0), 'prevenir', 'fil absent ou illisible : on previent, l ecriture tranchera')
  assert.equal(S.decisionBoutonEquipe({ messages: [], attend: false }, T0), 'prevenir')
  // Cas de Christine, 11:17 : premier appui, puis le second appui trouve le fil en attente.
  const apresPremier = [membre(T0, BOUTON), bot(T0 + 1000, S.TEXTE_EQUIPE_SANS_ECRIT)]
  assert.equal(S.decisionBoutonEquipe({ messages: apresPremier, attend: true }, T0 + 20000), 'deja_prevenue')
  assert.equal(S.noteBoutonEquipe('deja_prevenue'), "L'équipe est déjà prévenue, elle te répond ici.")
  // 11:24 Brice repond : l'equipe a la main, attente eteinte ou non.
  const apresBrice = [...apresPremier, humain(T0 + 7 * MIN)]
  assert.equal(S.decisionBoutonEquipe({ messages: apresBrice, attend: false }, T0 + 8 * MIN), 'deja_la')
  assert.equal(S.decisionBoutonEquipe({ messages: apresBrice, attend: true }, T0 + 8 * MIN), 'deja_la')
  assert.equal(S.noteBoutonEquipe('deja_la'), "L'équipe est déjà avec toi dans cette conversation.")
  assert.equal(S.noteBoutonEquipe('prevenir'), undefined)
  // Main rendue au bot (ou 24 h sans message de l'equipe) : on previent de nouveau.
  assert.equal(S.decisionBoutonEquipe({ messages: [...apresBrice, systeme(T0 + 9 * MIN, S.LIGNE_MAIN_RENDUE)], attend: false }, T0 + 10 * MIN), 'prevenir')
  assert.equal(S.decisionBoutonEquipe({ messages: apresBrice, attend: false }, T0 + 7 * MIN + 24 * H), 'prevenir')
  // Notifications : 200 caracteres au plus (answerCallbackQuery), sobres.
  for (const t of [S.NOTE_EQUIPE_DEJA_PREVENUE, S.NOTE_EQUIPE_DEJA_LA]) assert.ok(t.length <= 200 && SOBRE(t))
})

// --- C. La reponse de l'IA retenue si l'equipe a ete plus rapide ---------------------

test('C. reponse de l IA retenue si l equipe a ecrit depuis le message du membre', () => {
  const recuLe = T0
  const fil = [membre(recuLe, 'je veux changer ma carte')]
  assert.equal(S.equipePlusRapide(fil, recuLe), false)
  // Brice repond 3 s apres, pendant que l'agent calcule.
  assert.equal(S.equipePlusRapide([...fil, humain(recuLe + 3000)], recuLe), true)
  // Une reponse de l'equipe d'AVANT le message ne retient rien (versEquipeSiElleALaMain l'a deja aiguille).
  assert.equal(S.equipePlusRapide([humain(recuLe - 2 * H), ...fil], recuLe), false)
  // Un message humain sans date ne retient rien.
  assert.equal(S.equipePlusRapide([...fil, { role: 'human', content: 'x' }], recuLe), false)
  assert.equal(S.LIGNE_REPONSE_RETENUE, "Réponse de l'IA non envoyée : l'équipe a écrit entre-temps.")
  assert.ok(SOBRE(S.LIGNE_REPONSE_RETENUE))
})

// --- C. Le message d'attente, une fois par periode ----------------------------------

test('C. message d attente : au plus une fois par periode d attente', () => {
  assert.equal(S.TEXTE_ATTENTE_HUMAIN,
    "J'ai transmis ton message à l'équipe : quelqu'un te répond ici, dans cette conversation.\n\nEn attendant, les boutons marchent toujours :")
  assert.ok(S.TEXTE_ATTENTE_HUMAIN.startsWith(S.DEBUT_ATTENTE_HUMAIN))
  const escalade = T0
  const fil = [membre(T0, BOUTON), bot(T0 + 500, S.TEXTE_EQUIPE_SANS_ECRIT), membre(T0 + MIN, 'c est pour ma facture')]
  assert.equal(S.attenteDejaDite(fil, escalade), false, 'premier message ecrit : le message d attente part')
  const apres = [...fil, bot(T0 + MIN + 2000, `${S.TEXTE_ATTENTE_HUMAIN}\n[boutons : Mon abonnement]`)]
  assert.equal(S.attenteDejaDite(apres, escalade), true, 'deuxieme message : silence')
  // Une attente precedente (avant ce passage en attente) ne compte pas.
  assert.equal(S.attenteDejaDite(apres, T0 + 2 * H), false)
  // Seul le texte d'attente compte, pas « je previens l'equipe » ni une reponse de l'IA.
  assert.equal(S.attenteDejaDite([bot(T0 + 1000, S.TEXTE_EQUIPE_DEJA_ECRIT), bot(T0 + 2000, "Je préviens l'équipe", 'ia')], escalade), false)
})

// --- F. Lire le sens d'un message ecrit pendant l'attente -----------------------------

test('F. lecture : la requete (consigne fermee, un mot, fil recent sans lignes systeme)', () => {
  const fil = [
    membre(T0 - 10 * MIN, '/start'),
    systeme(T0 - 9 * MIN, 'Équipe prévenue (Agent AOK et email).'),
    membre(T0, BOUTON),
    bot(T0 + 500, S.TEXTE_EQUIPE_SANS_ECRIT),
    membre(T0 + 8 * MIN, "Tout est good, c'était un accident"),
  ]
  const contenu = S.messageLectureAttente(fil, "Tout est good, c'était un accident")
  assert.ok(contenu.includes('Membre : [bouton] Contacter'))
  assert.ok(contenu.includes("Bot : C'est noté, je préviens l'équipe"))
  assert.ok(!contenu.includes('[système]'), 'pas de ligne systeme au modele')
  assert.equal(contenu.split("Tout est good, c'était un accident").length - 1, 1, 'le message n est pas repete')
  assert.ok(contenu.endsWith("Dernier message du membre, à classer :\n« Tout est good, c'était un accident »"))
  const q = S.requeteLectureAttente('claude-haiku-4-5-20251001', fil, 'x')
  assert.equal(q.max_tokens, 10)
  assert.equal(q.temperature, 0)
  assert.equal(q.system, S.CONSIGNE_LECTURE_ATTENTE)
  assert.equal(q.messages.length, 1)
  assert.equal(q.messages[0].role, 'user')
  assert.ok(SOBRE(S.CONSIGNE_LECTURE_ATTENTE))
  assert.match(S.CONSIGNE_LECTURE_ATTENTE, /chaque fois que tu as un doute/)
  // Six messages au plus, 300 caracteres chacun.
  const long = Array.from({ length: 12 }, (_, i) => membre(T0 + i, `m${i} ${'a'.repeat(400)}`))
  const c = S.messageLectureAttente(long, 'dernier')
  assert.equal((c.match(/^Membre : /gm) ?? []).length, 6)
  assert.ok(!c.includes('m5 '), 'les plus anciens tombent')
  assert.ok(c.includes(`m11 ${'a'.repeat(296)}...`), '300 caracteres puis « ... »')
  assert.ok(c.split('\n').filter((l) => l.startsWith('Membre : ')).every((l) => l.length <= 'Membre : '.length + 303))
})

test('F. annulation lue : l attente sort, aucun texte « je transmets »', () => {
  assert.equal(S.lireSensEnAttente('annule'), 'annule')
  assert.equal(S.lireSensEnAttente(' Annulé.'), 'annule')
  assert.equal(S.lireSensEnAttente('autre'), 'autre')
  assert.equal(S.decisionEnAttente('annule'), 'annuler')
  assert.equal(S.decisionEnAttente('autre'), 'transmettre')
  assert.equal(S.TEXTE_ANNULATION, "D'accord, je préviens l'équipe que c'est réglé.")
  assert.ok(!/transmets|transmis/i.test(S.TEXTE_ANNULATION))
  assert.equal(S.LIGNE_DEMANDE_ANNULEE, 'Demande annulée par le membre.')
  // L'alerte « annulée » ne part que si une alerte est partie pour CETTE attente.
  const escalade = T0
  assert.equal(S.alertePartieDepuis([systeme(T0 + 2000, S.LIGNE_EQUIPE_PREVENUE)], escalade), true)
  assert.equal(S.alertePartieDepuis([systeme(T0 - 5 * MIN, S.LIGNE_EQUIPE_PREVENUE)], escalade), false, 'alerte d une attente precedente')
  assert.equal(S.alertePartieDepuis([], escalade), false, 'rythme des 10 minutes : aucune alerte, rien a retirer')
  // Le texte de l'alerte : qui, son message, rien a faire, la reference du fil ; pas de « demande un humain ».
  const FIL = '3f2a9c1b-7d4e-4a1b-9c2d-0e5f6a7b8c9d'
  const messages = [membre(T0, BOUTON), bot(T0 + 500, S.TEXTE_EQUIPE_SANS_ECRIT), membre(T0 + MIN, "Tout est good, c'était un accident"), systeme(T0 + MIN + 900, S.LIGNE_DEMANDE_ANNULEE)]
  const t = texteDemandeHumain({ origine: 'bot Live Club', qui: 'Christine', dernierMessage: dernierMessageMembre(messages), reponseDans: 'Telegram', fil: FIL, genre: 'annulee' })
  assert.deepEqual(t.split('\n'), [
    'Christine a annulé sa demande (bot Live Club) : rien à faire.',
    "Son message : « Tout est good, c'était un accident »",
    "Si tu veux quand même lui écrire : dis-moi « réponds-lui : ton message » (fil 3f2a9c1b).",
  ])
  assert.ok(!t.includes('demande un humain') && SOBRE(t))
  // Les genres d'avant ne changent pas.
  assert.match(texteDemandeHumain({ origine: 'o', qui: 'x', dernierMessage: 'y', reponseDans: 'Telegram', fil: FIL }), /^Un membre demande un humain \(o\)\./)
})

test('F. panne ou doute de la lecture : on transmet sans rien annuler', () => {
  // Panne (null : cle absente, erreur, delai depasse) ou sortie qui n'est pas un des deux mots.
  for (const sortie of [null, undefined, '', 'Je pense que le membre...', 'peut-etre', 42]) {
    assert.equal(S.lireSensEnAttente(sortie), null)
    assert.equal(S.decisionEnAttente(S.lireSensEnAttente(sortie)), 'transmettre')
  }
  assert.equal(S.decisionEnAttente(null), 'transmettre')
})

// --- Le cas de Christine, en entier --------------------------------------------------

test('cas de Christine (22/10) : ce que le bot fait maintenant a chaque etape', () => {
  let fil = [membre(T0 - 30 * MIN, '/start')]
  // 11:17 premier appui : rien ecrit, le bot previent avec l'invitation facultative.
  assert.equal(S.decisionBoutonEquipe({ messages: fil, attend: false }, T0), 'prevenir')
  assert.equal(S.texteEquipe(fil, T0), S.TEXTE_EQUIPE_SANS_ECRIT)
  fil = [...fil, membre(T0, BOUTON), bot(T0 + 500, S.TEXTE_EQUIPE_SANS_ECRIT), systeme(T0 + 800, S.LIGNE_EQUIPE_PREVENUE)]
  // 11:17 second appui : une notification, aucun second message.
  assert.equal(S.decisionBoutonEquipe({ messages: fil, attend: true }, T0 + 15000), 'deja_prevenue')
  // Variante : elle ecrit « c'était un accident » AVANT la reponse de Brice : lu comme une annulation.
  assert.equal(S.decisionEnAttente(S.lireSensEnAttente('annule')), 'annuler')
  assert.equal(S.alertePartieDepuis(fil, T0), true, 'l alerte etait partie : l equipe recoit « annulée »')
  // 11:24 Brice repond : l'equipe a la main ; 11:25 son message va a l'equipe, le bot se tait (046e128).
  fil = [...fil, humain(T0 + 7 * MIN)]
  assert.equal(S.quiRepond(fil, T0 + 8 * MIN), 'equipe')
  assert.equal(S.decisionBoutonEquipe({ messages: fil, attend: false }, T0 + 8 * MIN), 'deja_la')
})

// --- Statique : le branchement ------------------------------------------------------

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lire = (rel) => readFileSync(path.join(RACINE, rel), 'utf8')
const entre = (texte, debut, fin) => {
  const i = texte.indexOf(debut)
  const j = texte.indexOf(fin, i + debut.length)
  assert.ok(i >= 0 && j > i, `${debut} ... ${fin}`)
  return texte.slice(i, j)
}
const botTs = lire('src/lib/liveclub/bot-membre.ts')
const pont = lire('src/lib/liveclub/support-pont.ts')

test('statique : le bouton lit l etat avant de repondre, et se tait si l equipe est deja la', () => {
  const fn = entre(botTs, 'async function boutonEquipe(', '/** Un clic sur un bouton.')
  const avant = fn.slice(0, fn.indexOf("if (decision !== 'prevenir') {"))
  assert.match(avant, /const etat = await lireEtatFil\(u\.id\)/)
  assert.ok(!/repondreBouton\(/.test(avant), 'la notification du bouton apres la lecture de l etat')
  const sansMessage = entre(fn, "if (decision !== 'prevenir') {", 'return\n')
  assert.match(sansMessage, /repondreBouton\(idBouton, noteBoutonEquipe\(decision\)\)/)
  assert.ok(!/envoyer\(|envoyerTelegram\(|veutHumain|enregistrerEchangeSupport\(/.test(sansMessage), 'aucun message, aucune attente, aucune alerte')
  // Prevenir : l'appui fait passer en attente, seul celui qui l'y fait passer parle.
  assert.match(fn, /veutHumain: true, alerte: 'demande'/)
  assert.ok(fn.indexOf('if (!issue.passeEnAttente) return') < fn.indexOf('texteEquipe('))
  assert.match(fn, /TEXTE_EQUIPE_INDISPONIBLE/)
  // Le bouton m:equipe ne passe plus par le repondeur ni par l'ancien texte fixe.
  const clic = entre(botTs, "if (data === 'm:equipe') {", '// « J\'ai paye : verifier mon email »')
  assert.match(clic, /await boutonEquipe\(/)
  assert.ok(!/TEXTE_EQUIPE\b/.test(botTs), 'plus de TEXTE_EQUIPE fixe')
  assert.match(botTs, /if \(data !== 'm:equipe'\) await versSupport\(/)
})

test('statique : fil en attente = message lu, une annulation sort de l attente, un seul message d attente', () => {
  const fn = entre(botTs, 'async function repondreEnAttente(', '/** (22/10) L\'equipe a-t-elle ecrit')
  assert.ok(fn.indexOf('lireSensEnAttenteIA(') < fn.indexOf('const relu = await lireEtatFil(u.id)'), 'l etat est relu APRES la lecture')
  assert.match(fn, /equipePlusRapide\(relu\.messages, recuLe\) \|\| quiRepond\(relu\.messages, Date\.now\(\)\) === 'equipe'\)\) return/)
  const annulation = entre(fn, "if (decisionEnAttente(sens) === 'annuler'", 'return\n')
  assert.match(annulation, /annulerDemandeEquipe\(u\.id, etat\.escaladeLe\)/)
  assert.match(annulation, /TEXTE_ANNULATION/)
  assert.ok(!/TEXTE_ATTENTE_HUMAIN/.test(annulation))
  assert.match(fn, /if \(await direAttenteUneFois\(u\.id, TEXTE_ATTENTE_HUMAIN,[^)]*\}\)\) \{\s+await envoyerTelegram\(chat, TEXTE_ATTENTE_HUMAIN, clavier\)/)
  // Branchee aux deux endroits qui repondaient TEXTE_ATTENTE_HUMAIN a chaque message.
  const agent = entre(botTs, 'async function converserAvecAgent(', '/** Un message prive')
  assert.ok(agent.indexOf('repondreEnAttente(') < agent.indexOf('reserverMessageIA('))
  const nonRattache = entre(botTs, 'async function traiterNonRattache(', 'async function traiterTexteLibre(')
  assert.match(nonRattache, /repondreEnAttente\(chat, u, masquerCodes\(texte\), null, clavierSansRattachement\(\), etat, recuLe\)/)
  assert.ok(!/repondre\(TEXTE_ATTENTE_HUMAIN/.test(botTs), 'plus de message d attente a chaque message')
  // La lecture : panne = null, jamais d'exception, un delai court, sans relance.
  const lecture = lire('src/lib/liveclub/lecture-attente.ts')
  assert.match(lecture, /timeout: DELAI_LECTURE_ATTENTE_MS, maxRetries: 0/)
  assert.match(lecture, /catch \(err\) \{[\s\S]*?return null\s*\}/)
  assert.match(lecture, /if \(!apiKey\) \{[^}]*return null/)
  assert.ok(!/console\.(warn|log|error)\([^)]*texte/.test(lecture), 'aucun texte de message dans un log')
})

test('statique : SQL du message d attente (atomique) et de l annulation (attente lue seulement)', () => {
  const dire = entre(pont, 'export async function direAttenteUneFois(', 'export async function annulerDemandeEquipe(')
  assert.match(dire, /where "telegramId" = \$\{telegramId\}\s+and "escalatedAt" is not null\s+and not exists \(/)
  assert.match(dire, /left\(coalesce\(m->>'content', ''\), \$\{DEBUT_ATTENTE_HUMAIN\.length\}::int\) = \$\{DEBUT_ATTENTE_HUMAIN\}/)
  assert.match(dire, /coalesce\(m->>'at', ''\) >= to_char\("escalatedAt", 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\)/)
  assert.match(dire, /coalesce\(m->>'at', ''\) ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T'/, 'une date mal formee ne compte pas')
  const annuler = entre(pont, 'export async function annulerDemandeEquipe(', 'export type IssueMainRendue')
  assert.match(annuler, /"escalatedAt" = null,/)
  assert.match(annuler, /and "escalatedAt" = \$\{escaladeLue\.toISOString\(\)\}::timestamp\(3\)/)
  assert.ok(annuler.indexOf('alertePartieDepuis(') < annuler.indexOf('alerterEquipeTelegram('))
  assert.match(annuler, /genre: 'annulee'/)
  assert.ok(!/alerterEquipe\(/.test(annuler), 'pas d email pour une annulation')
})

test('statique : la reponse de l agent ne part pas si l equipe a ecrit pendant le calcul', () => {
  const agent = entre(botTs, 'async function converserAvecAgent(', '/** Un message prive')
  const apres = agent.slice(agent.indexOf('reponse = await repondreAuMembre('))
  const retenue = apres.indexOf('if (await equipeAEcritDepuis(u.id, recuLe)) {')
  assert.ok(retenue > 0)
  assert.ok(retenue < apres.indexOf('clavierConfirmation(nonce)'), 'avant l envoi')
  assert.ok(retenue < apres.indexOf('ajouterEchange('), 'rien a l historique de l agent')
  assert.match(apres.slice(retenue), /^if \(await equipeAEcritDepuis\(u\.id, recuLe\)\) \{\s+await tracerEtape\(u\.id, LIGNE_REPONSE_RETENUE/)
  // Le repli de l'agent en panne aussi.
  const panne = entre(agent, 'console.warn(`[liveclub/bot] agent indisponible', "Je n'arrive pas à répondre là")
  assert.match(panne, /if \(await equipeAEcritDepuis\(u\.id, recuLe\)\) return/)
  // recuLe pris au debut du texte libre, avant toute lecture.
  const libre = entre(botTs, 'async function traiterTexteLibre(', 'const r = await rattachementOuNull(u.id)')
  assert.match(libre, /const recuLe = Date\.now\(\)/)
})

test('statique : auteur des messages du bot (« Bot » ou « IA » au cockpit)', () => {
  const tracer = entre(pont, 'export async function tracerMessageBot(', 'export async function tracerEtape(')
  assert.match(tracer, /auteur: o\.auteur \?\? 'bot'/)
  const enr = entre(pont, 'export async function enregistrerEchangeSupport(', 'export async function lireMessagesFil(')
  assert.match(enr, /e\.role === 'ia' && \(e\.auteur === 'bot' \|\| e\.auteur === 'ia'\) \? \{ auteur: e\.auteur \}/)
  const agent = entre(botTs, 'async function converserAvecAgent(', '/** Un message prive')
  assert.match(agent, /const auteur = reponse\.repli \? 'bot' : 'ia'/)
  assert.equal((agent.match(/undefined, \{ auteur \}\)/g) ?? []).length, 2)
})

console.log(`\n${n} blocs verifies, tout est bon.`)
