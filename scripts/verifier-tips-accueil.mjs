// Tests de l'ACCUEIL ETALE EN CONSEILS (Brice, 31/10, tips-accueil-pur.ts) et
// des ADRESSES MULTIPLES dites au bon moment (31/10) :
// - le calendrier (J+1, J+2, J+4, J+7), un conseil par jour au plus, une fois,
//   decale par une relance des lots, saute s'il en a deja parle ;
// - les textes (le message court de l'admission, chaque conseil) ;
// - le cablage : journal de l'entree, passage (etat relu juste avant), bot ;
// - les adresses multiples : une phrase quand rien n'est trouve, le code qui
//   n'arrive pas, la ligne de « Mon abonnement », la consigne de l'agent.
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-tips-accueil.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const T = await import('../src/lib/liveclub/tips-accueil-pur.ts')
const A = await import('../src/lib/liveclub/accueil-groupe.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const L = await import('../src/lib/liveclub/lots-pur.ts')
const { URL_FORMATION_LIVECLUB } = await import('../src/lib/liveclub/config.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const CHAT = -1001930901866
const plus = L.jourPlus

/** Caracteres clavier simples, sans « jamais », sans Skool, aucune ponctuation collee a un lien. */
function texteSain(t, nom) {
  assert.ok(!/[\u2014\u2013\u2026\u201c\u201d\u2018\u2019\u2022]/.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!/\.\.\./.test(t), `${nom} : points de suspension`)
  assert.ok(!/[\u00a0\u202f\u200b-\u200d\u2060\ufeff]/.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
  assert.ok(!/jamais/i.test(t), `${nom} : « jamais »`)
  assert.ok(!/skool/i.test(t), `${nom} : Skool`)
  for (const url of t.match(/https?:\/\/\S+/g) ?? []) assert.match(url, /[A-Za-z0-9/]$/, `${nom} : ponctuation collee au lien ${url}`)
}

bloc('constantes : J+1, J+2, J+4, J+7, depuis le deploiement, coupure', () => {
  assert.deepEqual(T.TIPS_ACCUEIL.map(t => [t.cle, t.jours]), [['academie', 1], ['sujets', 2], ['liens', 4], ['abonnement', 7]])
  assert.match(T.TIPS_ACCUEIL_DEPUIS, /^2026-\d{2}-\d{2}$/)
  assert.ok(T.TIPS_FENETRE_JOURS > 7)
  assert.match(lire('src/lib/liveclub/config.ts'), /return process\.env\.LIVECLUB_TIPS_ACCUEIL\?\.trim\(\) !== '0'/)
  // Les noms du journal : les memes dans pur.ts (qui n'importe rien).
  for (const [cle, nom] of Object.entries(T.NOMS_TIPS)) {
    assert.equal(P.phraseGeste({ geste: 'rappel', resultat: 'fait', regle: 'tip_accueil', details: { tip: cle } }), `Conseil d'accueil envoyé (${nom}).`)
  }
  assert.match(P.phraseGeste({ geste: 'rappel', resultat: 'refuse', regle: 'tip_accueil', details: { tip: 'liens' } }), /sauté \(les liens utiles\) : sujet déjà abordé/)
})

bloc('calendrier : un conseil par jour au plus, une fois chacun, dans l ordre', () => {
  const entre = plus(T.TIPS_ACCUEIL_DEPUIS, 3)
  const e = (j, traites = [], o = {}) => T.tipsDus({
    entreLe: entre, aujourdhui: plus(entre, j), traites: new Set(traites), envoyeAujourdhui: false, relanceLotsAujourdhui: false, ...o,
  })
  assert.deepEqual(e(0), [], 'rien le jour de l entree')
  assert.deepEqual(e(1), ['academie'])
  assert.deepEqual(e(2, ['academie']), ['sujets'])
  assert.deepEqual(e(3, ['academie', 'sujets']), [])
  assert.deepEqual(e(4, ['academie', 'sujets']), ['liens'])
  assert.deepEqual(e(7, ['academie', 'sujets', 'liens']), ['abonnement'])
  assert.deepEqual(e(8, ['academie', 'sujets', 'liens', 'abonnement']), [])
  // En retard (un jour sans passage) : l'ordre est garde ; le passage n'envoie que le premier.
  assert.deepEqual(e(5, ['academie']), ['sujets', 'liens'])
  // Un deja envoye aujourd'hui, ou une relance des lots aujourd'hui : rien, demain.
  assert.deepEqual(e(2, ['academie'], { envoyeAujourdhui: true }), [])
  assert.deepEqual(e(7, ['academie', 'sujets', 'liens'], { relanceLotsAujourdhui: true }), [])
  // Entre avant le deploiement : aucun conseil. Hors fenetre : plus rien.
  assert.deepEqual(T.tipsDus({ entreLe: plus(T.TIPS_ACCUEIL_DEPUIS, -1), aujourdhui: T.TIPS_ACCUEIL_DEPUIS, traites: new Set(), envoyeAujourdhui: false, relanceLotsAujourdhui: false }), [])
  assert.deepEqual(e(T.TIPS_FENETRE_JOURS + 1), [])
})

bloc('deja parle : des mots simples dans SES messages, le conseil est saute', () => {
  assert.equal(T.dejaParle('academie', ['Bonjour, comment j accède aux cours ?']), true)
  assert.equal(T.dejaParle('academie', ["c'est où l'académie"]), true)
  assert.equal(T.dejaParle('sujets', ['il y a un challenge ?']), true)
  assert.equal(T.dejaParle('liens', ['tu as une prop firm à conseiller ?']), true)
  assert.equal(T.dejaParle('abonnement', ['je voudrais mettre en pause']), true)
  assert.equal(T.dejaParle('abonnement', ["j'ai une autre adresse mail"]), true)
  assert.equal(T.dejaParle('liens', ['merci, tout est bon']), false)
  assert.equal(T.dejaParle('academie', []), false)
})

bloc('les conseils : courts, detendus, une ouverture pour lui repondre', () => {
  for (const accesOffert of [false, true]) {
    for (const t of T.TIPS_ACCUEIL) {
      const texte = T.texteTip(t.cle, { chat: CHAT, accesOffert })
      texteSain(texte, `${t.cle} ${accesOffert ? 'offert' : 'abonne'}`)
      assert.ok(texte.length < 1100, `${t.cle} : ${texte.length}`)
      assert.match(texte.split('\n').pop(), /(écris-moi ici|Dis-le-moi ici|demande-moi|Demande-moi|dis-le-moi|Dis-le-moi)/i, `${t.cle} : ouverture finale`)
      if (t.cle !== 'sujets') assert.ok(texte.split('\n').length <= 3, `${t.cle} : 3 lignes au plus`)
    }
  }
  const academie = T.texteTip('academie', { chat: CHAT, accesOffert: false })
  assert.ok(academie.includes(`et ils s'ouvrent tout seuls : ${URL_FORMATION_LIVECLUB}\n`))
  assert.match(academie, /Connecte-toi avec l'email de ton abonnement/)
  assert.match(T.texteTip('academie', { chat: CHAT, accesOffert: true }), /l'email sous lequel l'équipe te connaît/)
  const sujets = T.texteTip('sujets', { chat: CHAT, accesOffert: false })
  const lignes = sujets.split('\n').filter(l => l.startsWith('- '))
  assert.equal(lignes.length, 6)
  for (const s of T.SUJETS_TIP_SUJETS) assert.ok(sujets.includes(`https://t.me/c/1930901866/${s}\n`), `sujet ${s}`)
  assert.deepEqual([...T.SUJETS_TIP_SUJETS], [
    A.SUJETS_LIVECLUB.explicationCharts, A.SUJETS_LIVECLUB.mindset, A.SUJETS_LIVECLUB.coreContentMelmom,
    A.SUJETS_LIVECLUB.macroBreaker, A.SUJETS_LIVECLUB.pdf, A.SUJETS_LIVECLUB.vosResultats,
  ])
  assert.ok(sujets.includes(A.LIGNE_CHALLENGE_CORE_CONTENT))
  const liens = T.texteTip('liens', { chat: CHAT, accesOffert: false })
  assert.ok(liens.includes(`https://t.me/c/1930901866/${A.SUJETS_LIVECLUB.liensUtiles}\n`))
  assert.match(liens, /Demande-moi, je te donne le bon lien\.$/)
  assert.ok(!T.texteTip('liens', { chat: null, accesOffert: false }).includes('t.me'))
  const abo = T.texteTip('abonnement', { chat: CHAT, accesOffert: false })
  assert.match(abo, /le mettre en pause de 1 à 6 mois ou l'arrêter/)
  assert.match(abo, /tu peux en avoir plusieurs : « Mon abonnement » te montre celles que je connais/)
  assert.match(T.texteTip('abonnement', { chat: CHAT, accesOffert: true }), /t'est offert, donc rien à payer ni à gérer/)
  assert.deepEqual(T.boutonsTip('abonnement'), [[{ texte: 'Mon abonnement', data: 'm:abo' }]])
  assert.equal(P.libelleBouton('m:abo'), 'Mon abonnement')
  assert.equal(T.boutonsTip('academie'), undefined)
})

bloc('J0 : le message de l admission raccourci a l essentiel quand les conseils suivent', () => {
  const t = A.texteAdmission('nouveau', { chat: CHAT, accesOffert: false, tips: true })
  assert.ok(t.startsWith("Bienvenue dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant.\n\n"))
  assert.match(t, /L'essentiel pour commencer :\n- Annonce, où sont annoncés les lives : https:\/\/t\.me\/c\/1930901866\/2\n- Replay, chaque live, à revoir quand tu veux : https:\/\/t\.me\/c\/1930901866\/12\n- Trading chat, pour parler trading entre membres et poser tes questions : https:\/\/t\.me\/c\/1930901866\/16639\n/)
  assert.match(t, /présente-toi en deux mots dans Bla-bla, pas besoin d'en faire un roman : https:\/\/t\.me\/c\/1930901866\/16368\n/)
  assert.match(t, /quelques idées :\n- depuis quand tu trades/)
  assert.ok(t.endsWith("Le reste, je te le donne petit à petit ces prochains jours, un conseil à la fois. Et si tu as une question d'ici là, écris-moi ici."))
  // Le reste n'y est plus : academie, autres sujets, challenge, liens utiles.
  assert.ok(!t.includes(URL_FORMATION_LIVECLUB), 'pas l academie au J0')
  for (const s of [...T.SUJETS_TIP_SUJETS, A.SUJETS_LIVECLUB.liensUtiles]) assert.ok(!t.includes(`/1930901866/${s}`), `sujet ${s} au J0`)
  assert.ok(!t.includes('challenge'))
  assert.ok(t.length < A.texteAdmission('nouveau', { chat: CHAT, accesOffert: false }).length / 1.5, 'nettement plus court')
  texteSain(t, 'admission courte')
  // Acces broker : le paragraphe des lots reste au J0 (la date limite).
  const broker = A.texteAdmission('nouveau', { chat: CHAT, accesOffert: true, tips: true, lots: { limite: '2026-11-21' } })
  assert.ok(broker.includes(L.paragrapheLotsAdmission('2026-11-21')))
  // Sans chat : sans liens.
  assert.ok(!A.texteAdmission('nouveau', { chat: null, accesOffert: false, tips: true }).includes('t.me'))
  // Sans les conseils (coupes) : le tour complet d'avant, a l'identique.
  assert.equal(A.texteAdmission('nouveau', { chat: CHAT, accesOffert: false, tips: false }), A.texteAdmission('nouveau', { chat: CHAT, accesOffert: false }))
  // Retour et connu : leur message court, sans conseils.
  for (const g of ['retour', 'connu']) {
    assert.equal(A.texteAdmission(g, { chat: CHAT, accesOffert: false, tips: true }), A.texteAdmission(g, { chat: CHAT, accesOffert: false }))
  }
})

bloc('cablage : l entree tracee, le passage relit l etat juste avant, une fois, en prive', () => {
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.match(bot, /tips: tipsAccueilActifs\(\) \}\)/)
  assert.match(bot, /return \{ \.\.\.extra, genre: entree, \.\.\.\(entree === 'nouveau' && tipsAccueilActifs\(\) \? \{ tips: true \} : \{\}\) \}/)
  assert.match(bot, /\{ geste: 'entree_acceptee', resultat: 'fait', regle: droit\.raison, details: detailsEntree\(entree\) \}/)
  assert.match(bot, /\{ geste: 'entree_acceptee', resultat: 'fait', regle: droit\.raison, details: detailsEntree\(entree, \{ reprise: true \}\) \}/)
  const passage = lire('src/lib/liveclub/passage.ts')
  const iDepot = passage.indexOf("await etape('depots_perdus', () => tacheDepotsPerdus(ctx))")
  const iTips = passage.indexOf("await etape('tips', () => tacheTipsAccueil(ctx))")
  assert.ok(passage.indexOf("await etape('lots', () => tacheLots(ctx))") < iTips && iDepot < iTips, 'apres les relances des lots')
  const t = passage.slice(passage.indexOf('async function tacheTipsAccueil('), passage.indexOf('// (d) Purge des conversations privees'))
  assert.match(t, /if \(!tipsAccueilActifs\(\)\) \{\n\s+s\.coupe = true/)
  assert.match(t, /g\.details->>'genre' = 'nouveau' and g\.details->>'tips' = 'true'/)
  assert.match(t, />= \$\{TIPS_ACCUEIL_DEPUIS\}::date/)
  assert.match(t, /regle in \('tip_accueil', 'lots_relance_1', 'lots_relance_2'\)/)
  assert.ok(t.indexOf('presence(tid)') < t.indexOf('droitLiveClub(tid)') && t.indexOf('droitLiveClub(tid)') < t.indexOf('lireEtatFil(tid)'))
  assert.match(t, /if \(fil && \(fil\.attend \|\| quiRepond\(fil\.messages, Date\.now\(\)\) === 'equipe'\)\) \{ s\.equipe\+\+; return \}/)
  assert.match(t, /cle: `liveclub:tip_accueil:\$\{tid\}:\$\{cle\}`/)
  assert.match(t, /if \(dejaParle\(cle, textes\)\) \{\n\s+await noterGeste\(ctx, reserve, \{ resultat: 'refuse', details: \{ motif: 'deja_parle' \}, fil: false \}\)/)
  assert.match(t, /const r = await envoyer\(tid, texte, boutons\)/)
  assert.ok(!/emailRelance|parEmail|envoyerModele/.test(t), 'en prive seulement')
})

bloc('adresses multiples : au moment ou ca sert, sans rien promettre que le code ne fait pas', () => {
  assert.equal(P.PHRASE_AUTRE_ADRESSE, 'Tu as peut-être payé avec une autre adresse ? Donne-la-moi, tu peux en avoir plusieurs.')
  assert.equal(P.ligneAdresses(['Jean@X.fr', 'jean@x.fr', null, 'pas-une-adresse']), 'Adresse email reliée : jean@x.fr')
  assert.equal(P.ligneAdresses(['a@x.fr', 'b@y.com']), 'Adresses email reliées : a@x.fr, b@y.com')
  assert.equal(P.ligneAdresses([]), null)
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  // Le code qui n'arrive pas : une autre adresse, ou l'equipe pour un acces broker (bouton joint).
  assert.match(bot, /Rien ne vient \? Tu as peut-être payé avec une autre adresse : envoie-la-moi, tu peux en avoir plusieurs\. /)
  assert.match(bot, /Ton accès vient d'un broker partenaire et rien n'arrive \? Appuie sur « Contacter l'équipe » : elle te répond ici\./)
  assert.match(bot, /await repondre\(TEXTE_CODE_DEMANDE, clavierEquipe\(\)\)/)
  // Un email verifie sans abonnement actif : la phrase.
  assert.match(bot, /donc je ne peux pas t'ouvrir le groupe\. \$\{PHRASE_AUTRE_ADRESSE\}\\n\\n\$\{texteAbonnement\(\)\}/)
  // « Mon abonnement » : la ligne des adresses ; aucun abonnement trouve : la phrase.
  const actions = lire('src/lib/liveclub/actions-membre.ts')
  assert.match(actions, /const ligne = ligneAdresses\(adresses\)/)
  assert.match(actions, /Je ne trouve pas d'abonnement Live Club à ton nom\. \$\{PHRASE_AUTRE_ADRESSE\}/)
  assert.match(actions, /from public\.cockpit_membre_emails\n\s+where membre_id = \$\{r\.membre_id\}::uuid/)
  // L'agent : une adresse ne se relie que sur preuve ; il transmet, et l'email d'un acces broker qui n'arrive pas aussi.
  const prompt = lire('src/lib/liveclub/prompt-membre.ts')
  assert.match(prompt, /Ses adresses email \(règle de Brice, 31\/10\) : un membre peut en avoir plusieurs/)
  assert.match(prompt, /tu ne la relies pas toi-même et tu ne promets rien ; quand il t'en donne une, tu transmets à l'équipe \(demander_un_humain\)/)
  assert.match(prompt, /L'email de son accès offert par un broker partenaire n'arrive pas : tu transmets à l'équipe \(demander_un_humain\)/)
})

console.log(`\naccueil etale en conseils : ${n} blocs ok`)
