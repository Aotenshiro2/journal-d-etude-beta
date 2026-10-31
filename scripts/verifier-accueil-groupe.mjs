// Tests de l'accueil du Live Club (src/lib/liveclub/accueil-groupe.ts) :
// - l'accueil publie dans le groupe (Brice 13/10 ; 31/10 : une ligne de
//   bienvenue dans le sujet general « Accueil » pour un nouveau ou un retour,
//   et, pour un nouveau seulement, un petit mot social dans Bla-bla) ;
// - le message prive de l'admission (31/10 : tour du proprietaire, courte
//   presentation, academie et liens utiles pour un nouveau membre ; rappel
//   court de l'academie pour un retour ; plus Skool).
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-accueil-groupe.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import './resoudre-ts.mjs'

// Import dynamique : accueil-groupe.ts importe './config' sans extension (resoudre-ts.mjs).
const {
  JOURS_ABSENCE_RETOUR, accueilAPublier, genreEntree, nomPourAccueil, texteAccueil, texteMotNouveau, envoisAccueil,
  texteAdmission, lienSujet, SUJETS_LIVECLUB, SUJETS_HORS_TOUR, SUJET_MOT_NOUVEAU, SUJETS_DU_TOUR,
} = await import('../src/lib/liveclub/accueil-groupe.ts')
const { URL_FORMATION_LIVECLUB } = await import('../src/lib/liveclub/config.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

const CHAT = -1001930901866
const maintenant = new Date('2026-10-13T12:00:00Z')
const ilYa = (jours) => new Date(maintenant.getTime() - jours * 86_400_000)
const FIN_ABONNEMENT = "Je reste là pour ton abonnement : écris-moi ici quand tu veux (le voir, une pause, un arrêt)."

/** Caracteres clavier simples, sans « jamais », sans Skool, aucune ponctuation collee a un lien. */
function texteSain(t, nom) {
  assert.ok(!/[—–…“”‘’•]/.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!/\.\.\./.test(t), `${nom} : points de suspension`)
  assert.ok(!/[  ​-‍⁠﻿]/.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
  assert.ok(!/jamais/i.test(t), `${nom} : « jamais » dans un texte d'accueil`)
  assert.ok(!/skool/i.test(t), `${nom} : Skool`)
  // Rien d'interne : ni nombre de membres, ni equipe en coulisses.
  assert.ok(!/\d+\s*(membres|personnes)/i.test(t), `${nom} : un nombre de membres`)
  for (const url of t.match(/https?:\/\/\S+/g) ?? []) {
    assert.match(url, /[A-Za-z0-9/]$/, `${nom} : ponctuation collee au lien ${url}`)
  }
}

bloc("accueil du groupe : seulement sur une entree, nouveau ou retour d'au moins 30 jours", () => {
  // Jamais vu : nouveau.
  assert.equal(accueilAPublier(null, 'left', true, maintenant), 'nouveau')
  assert.equal(accueilAPublier(null, undefined, true, maintenant), 'nouveau')
  // Retour rapide (impaye, sorti il y a 5 jours) : rien.
  assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(5) }, 'left', true, maintenant), null)
  assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(JOURS_ABSENCE_RETOUR - 1) }, 'left', true, maintenant), null)
  // Parti depuis un mois ou plus : retour.
  assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(JOURS_ABSENCE_RETOUR) }, 'left', true, maintenant), 'retour')
  assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(90) }, 'kicked', true, maintenant), 'retour')
  // Deja present (rejeu de l'update, ou changement de droits) : rien.
  assert.equal(accueilAPublier({ present: true, sortiLe: null }, 'left', true, maintenant), null)
  assert.equal(accueilAPublier(null, 'member', true, maintenant), null)
  assert.equal(accueilAPublier({ present: false, sortiLe: ilYa(90) }, 'restricted', true, maintenant), null)
  // Une sortie : rien.
  assert.equal(accueilAPublier(null, 'member', false, maintenant), null)
  // Connu sans date de sortie (historique Metricgram) : rien.
  assert.equal(accueilAPublier({ present: false, sortiLe: null }, 'left', true, maintenant), null)
})

bloc("qui entre (31/10) : la meme regle pour l'accueil du groupe et le message prive", () => {
  assert.equal(genreEntree(null, maintenant), 'nouveau')
  assert.equal(genreEntree({ present: false, sortiLe: ilYa(JOURS_ABSENCE_RETOUR) }, maintenant), 'retour')
  assert.equal(genreEntree({ present: false, sortiLe: ilYa(400) }, maintenant), 'retour')
  assert.equal(genreEntree({ present: false, sortiLe: ilYa(5) }, maintenant), 'connu')
  assert.equal(genreEntree({ present: false, sortiLe: null }, maintenant), 'connu')
  assert.equal(genreEntree({ present: null, sortiLe: null }, maintenant), 'connu')
  assert.equal(genreEntree({ present: true, sortiLe: null }, maintenant), 'connu')
  // Pour toute ligne, l'accueil du groupe suit genreEntree (connu = rien).
  for (const avant of [null, { present: false, sortiLe: ilYa(5) }, { present: false, sortiLe: ilYa(31) }, { present: true, sortiLe: null }, { present: false, sortiLe: null }]) {
    const g = genreEntree(avant, maintenant)
    assert.equal(accueilAPublier(avant, 'left', true, maintenant), g === 'connu' ? null : g)
  }
})

bloc('nom : @pseudo, sinon prenom, sinon rien', () => {
  assert.equal(nomPourAccueil('Julien_Rb', 'Julien'), '@Julien_Rb')
  assert.equal(nomPourAccueil('@Nyfab34', null), '@Nyfab34')
  assert.equal(nomPourAccueil(null, 'Nelly'), 'Nelly')
  assert.equal(nomPourAccueil('', '  '), null)
})

bloc('sujets du forum : le mot du nouveau dans Bla-bla ; Accueil, Formation et Edgyx hors du tour', () => {
  assert.equal(SUJET_MOT_NOUVEAU, 16368)
  assert.equal(SUJET_MOT_NOUVEAU, SUJETS_LIVECLUB.blabla)
  assert.deepEqual({ ...SUJETS_LIVECLUB }, {
    annonce: 2, replay: 12, pdf: 34, blabla: 16368, vosResultats: 16369, explicationCharts: 16372,
    mindset: 16384, liensUtiles: 16389, tradingChat: 16639, coreContentMelmom: 22809, macroBreaker: 24392,
  })
  assert.deepEqual({ ...SUJETS_HORS_TOUR }, { accueil: 1, formation: 16391, edgyxFaq: 30 })
  const hors = Object.values(SUJETS_HORS_TOUR)
  assert.ok(!hors.includes(SUJET_MOT_NOUVEAU), 'le mot du nouveau ne part pas dans un sujet ferme')
  // Le tour presente chaque sujet utile une fois (Liens utiles compris), et aucun sujet ferme ou hors Live Club.
  assert.deepEqual([...SUJETS_DU_TOUR].sort((a, b) => a - b), Object.values(SUJETS_LIVECLUB).sort((a, b) => a - b))
  assert.equal(new Set(SUJETS_DU_TOUR).size, SUJETS_DU_TOUR.length)
  assert.ok(SUJETS_DU_TOUR.includes(SUJETS_LIVECLUB.liensUtiles))
  for (const h of hors) assert.ok(!SUJETS_DU_TOUR.includes(h))
  // Les trois essentiels d'abord : lives annonces, replays, questions.
  assert.deepEqual(SUJETS_DU_TOUR.slice(0, 3), [SUJETS_LIVECLUB.annonce, SUJETS_LIVECLUB.replay, SUJETS_LIVECLUB.tradingChat])
})

bloc("lien d'un sujet : t.me/c/<chat sans -100>/<id>, rien sans chat de supergroupe", () => {
  assert.equal(lienSujet(CHAT, 16368), 'https://t.me/c/1930901866/16368')
  assert.equal(lienSujet(CHAT, 2), 'https://t.me/c/1930901866/2')
  assert.equal(lienSujet(null, 2), null)
  assert.equal(lienSujet(undefined, 2), null)
  assert.equal(lienSujet(-4242, 2), null)
  assert.equal(lienSujet(1930901866, 2), null)
  assert.equal(lienSujet(Number.NaN, 2), null)
})

bloc("envois publics : Accueil pour tous (sans sujet), Bla-bla pour un nouveau seulement", () => {
  const nouveau = envoisAccueil('nouveau', '@Nyfab34')
  assert.deepEqual(nouveau.map(e => [e.ou, e.sujet]), [['Accueil', null], ['Bla-bla', 16368]])
  assert.equal(nouveau[0].texte, texteAccueil('nouveau', '@Nyfab34'))
  assert.equal(nouveau[1].texte, texteMotNouveau('@Nyfab34'))
  const retour = envoisAccueil('retour', 'Nelly')
  assert.deepEqual(retour.map(e => [e.ou, e.sujet]), [['Accueil', null]], 'rien dans Bla-bla pour un retour')
  assert.equal(retour[0].texte, texteAccueil('retour', 'Nelly'))
})

bloc("textes publics : une phrase sans consigne dans Accueil, un mot social court dans Bla-bla", () => {
  // (31/10) Sans @ dans Accueil : une seule mention, celle de Bla-bla.
  assert.equal(texteAccueil('nouveau', '@Nyfab34'), 'Bienvenue dans le Live Club, Nyfab34 !')
  assert.equal(texteAccueil('retour', 'Nelly'), 'Bon retour dans le Live Club, Nelly !')
  assert.equal(texteAccueil('nouveau', null), 'Bienvenue dans le Live Club !')
  assert.equal(texteAccueil('retour', null), 'Bon retour dans le Live Club !')
  const mot = texteMotNouveau('@Nyfab34')
  assert.ok(mot.startsWith("Hey tout le monde, @Nyfab34 vient d'arriver dans le Live Club, n'hésitez pas à lui souhaiter la bienvenue !"), mot)
  assert.match(mot, /présente-toi ici en deux mots si tu veux : ton parcours dans le trading/)
  assert.equal((mot.match(/!/g) ?? []).length, 1, 'detendu, sans en faire trop')
  assert.ok(mot.length < 260, `court : ${mot.length}`)
  assert.ok(!mot.includes('http'), 'pas de lien dans le mot social')
  assert.ok(texteMotNouveau(null).startsWith("Hey tout le monde, un nouveau membre vient d'arriver"))
  for (const [t, nom] of [
    [texteAccueil('nouveau', '@Nyfab34'), 'Accueil nouveau'], [texteAccueil('retour', 'Nelly'), 'Accueil retour'], [mot, 'Bla-bla'],
  ]) texteSain(t, nom)
})

bloc("message prive de l'admission, nouveau : tour, presentation, academie, liens utiles", () => {
  const t = texteAdmission('nouveau', { chat: CHAT, accesOffert: false })
  assert.ok(t.startsWith("Bienvenue dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant."), t)
  assert.match(t, /tour du propriétaire/)
  // Chaque sujet du tour, avec son lien en fin de ligne ; aucun sujet ferme.
  for (const s of SUJETS_DU_TOUR) {
    const lien = `https://t.me/c/1930901866/${s}`
    assert.ok(new RegExp(`^- [^\\n]+ : ${lien.replace(/[./]/g, '\\$&')}$`, 'm').test(t), `sujet ${s}`)
  }
  for (const h of Object.values(SUJETS_HORS_TOUR)) assert.ok(!new RegExp(`/1930901866/${h}$`, 'm').test(t), `hors tour ${h}`)
  assert.ok(!/Formation \(|^- Formation/m.test(t), 'pas de sujet Formation')
  assert.match(t, /- Annonce, où sont annoncés les lives : /)
  assert.match(t, /- Replay, chaque live, à revoir quand tu veux : /)
  assert.match(t, /- Trading chat, pour parler trading entre membres et poser tes questions : /)
  assert.match(t, /- Liens utiles, les prop firms, brokers et outils conseillés : /)
  // La courte presentation dans Bla-bla, avec 3 ou 4 idees.
  assert.match(t, /Pour briser la glace, présente-toi en deux mots dans Bla-bla, pas besoin d'en faire un roman\./)
  const idees = t.slice(t.indexOf('quelques idées :')).split('\n\n')[0].split('\n').slice(1)
  assert.ok(idees.length >= 3 && idees.length <= 4 && idees.every(l => l.startsWith('- ')), idees.join(' | '))
  assert.match(idees.join(' '), /depuis quand tu trades/)
  // L'academie : la constante, ce qu'on y trouve, l'email de l'abonnement, le compte qui se cree au meme endroit, et si ca coince.
  assert.ok(t.includes(`L'adresse : ${URL_FORMATION_LIVECLUB}\n`))
  // (31/10) Pas de liste de cours dans le message : elle change avec l'offre.
  assert.match(t, /en vidéo ou à lire, avec ta progression\. L'adresse/)
  assert.ok(!/Smart Money|Plan de Trading/.test(t), 'aucune liste de cours dans le message prive')
  assert.match(t, /Connecte-toi avec l'email de ton abonnement, et ils s'ouvrent tout seuls/)
  assert.match(t, /Pas encore de compte \? Il se crée au même endroit, avec ce même email/)
  assert.match(t, /Un cours inclus reste fermé \? Dis-le-moi ici/)
  // Les liens utiles : le bot les a vraiment (consignes de son agent).
  assert.match(t, /Au passage, j'ai aussi tous les liens utiles : les brokers proposés, les prop firms, les outils qui peuvent servir\./)
  assert.ok(t.endsWith("Et si tu as la moindre question, sur l'académie ou sur ton abonnement (le voir, une pause, un arrêt), écris-moi ici."))
  assert.ok(t.length < 4096, `trop long pour Telegram : ${t.length}`)
  texteSain(t, 'admission nouveau')
  // Acces offert (exemption, broker, manuel) : l'email que l'equipe connait, pas d'abonnement a gerer.
  const offert = texteAdmission('nouveau', { chat: CHAT, accesOffert: true })
  assert.match(offert, /Connecte-toi avec l'email sous lequel l'équipe te connaît/)
  assert.ok(!/abonnement/.test(offert), 'acces offert : rien sur un abonnement')
  texteSain(offert, 'admission nouveau, acces offert')
  // Sans chat lisible : les sujets nommes, sans lien.
  const sansChat = texteAdmission('nouveau', { chat: null, accesOffert: false })
  assert.ok(!sansChat.includes('t.me/c/'))
  assert.match(sansChat, /^- Annonce, où sont annoncés les lives$/m)
  texteSain(sansChat, 'admission nouveau, sans chat')
})

bloc("message prive de l'admission, retour et connu : un rappel court, ou l'acceptation seule", () => {
  const retour = texteAdmission('retour', { chat: CHAT, accesOffert: false })
  assert.ok(retour.startsWith("Bon retour dans le Live Club ! Ta demande est acceptée, le groupe s'ouvre à l'instant."))
  assert.ok(retour.includes(`et ils s'ouvrent tout seuls : ${URL_FORMATION_LIVECLUB}\n`))
  assert.match(retour, /Petit rappel : les cours de formation inclus dans le Live Club sont sur l'académie du site/)
  assert.ok(!retour.includes('t.me/c/') && !retour.includes('Bla-bla'), 'pas de tour ni de presentation pour un retour')
  assert.ok(retour.endsWith(FIN_ABONNEMENT))
  assert.ok(retour.length < 450, `rappel court : ${retour.length}`)
  texteSain(retour, 'admission retour')
  assert.match(texteAdmission('retour', { chat: CHAT, accesOffert: true }), /l'email sous lequel l'équipe te connaît/)
  // Connu (retour rapide, sortie sans date) : le texte d'avant, mot pour mot.
  const connu = texteAdmission('connu', { chat: CHAT, accesOffert: false })
  assert.equal(connu, `C'est bon, ta demande pour rejoindre le Live Club est acceptée : le groupe s'ouvre à l'instant.\n\n${FIN_ABONNEMENT}`)
  const connuOffert = texteAdmission('connu', { chat: null, accesOffert: true })
  assert.ok(!/abonnement/.test(connuOffert) && connuOffert.endsWith('écris-moi ici quand tu veux.'))
  texteSain(connu, 'admission connu')
  texteSain(connuOffert, 'admission connu, acces offert')
})

bloc("ce que le message prive annonce, le bot le tient : liens utiles, transmission, fiche de l'academie", () => {
  // Les liens utiles (brokers, prop firms, outils) sont dans les consignes de l'agent du bot.
  const politique = lire('src/lib/politique-information.ts')
  assert.match(politique, /categorie: 'Prop firms'/)
  assert.match(politique, /categorie: 'Brokers pour fonds propres'/)
  assert.match(politique, /categorie: 'Analyse et graphiques'/)
  assert.match(politique, /\$\{texteLiensUtiles\(\)\}/)
  const prompt = lire('src/lib/liveclub/prompt-membre.ts')
  assert.ok(/\$\{consignesPolitique\(.*'liveclub'\)\}/.test(prompt), "le prompt du bot des membres prend les consignes 'liveclub'")
  // Un cours qui reste ferme : l'agent transmet a l'equipe.
  assert.ok(prompt.includes("ça coince, tu transmets à l'équipe (demander_un_humain)"), 'transmission si un cours reste ferme')
  // Ce qu'on trouve a l'academie : la fiche que l'agent lit aussi.
  const fiche = lire('docs/connaissances/academie.md')
  assert.match(fiche, /Inclus dans le Live Club, tant que l'abonnement est actif : Bienvenue, Novice en trading, Les bases Smart Money, la partie 1 de La Formation complète \(épisodes 0 à 19\), Plan de Trading en 21 jours, Psychologie et émotions\./)
})

bloc("le code : deux envois publics independants, message de l'admission mis a jour (pas un de plus), lu avant l'approbation", () => {
  const route = lire('src/app/api/cockpit/liveclub/telegram/route.ts')
  const accueil = route.slice(route.indexOf('const accueil = avantLu'))
  assert.match(accueil, /for \(const envoi of envoisAccueil\(accueil, nomPourAccueil\(pseudo, u\.first_name\)\)\)/)
  assert.match(accueil, /\.\.\.\(envoi\.sujet !== null \? \{ message_thread_id: envoi\.sujet \} : \{\}\)/)
  // Chaque echec journalise, sans throw entre les deux envois (appelTelegram ne jette pas).
  assert.match(accueil, /if \(!r\.ok\) console\.warn\(`\[liveclub\/telegram\] accueil \(\$\{accueil\}\) non publie dans \$\{envoi\.ou\}/)
  assert.ok(!/throw/.test(accueil.slice(0, accueil.indexOf('return NextResponse'))))
  const telegram = lire('src/lib/liveclub/telegram.ts')
  assert.match(telegram, /Appel brut qui ne jette pas/)
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.ok(!bot.includes('TEXTE_DEMANDE_ACCEPTEE'), "l'ancien texte d'acceptation a disparu")
  assert.ok(!bot.includes('Ta demande est acceptée'), "les textes de l'admission vivent dans accueil-groupe.ts")
  // Demande d'adhesion acceptee : un seul envoi, le message de l'admission, avant l'approbation.
  const demande = bot.slice(bot.indexOf('export async function traiterDemandeAdhesion('), bot.indexOf("// La dette d'abord (Brice, 30/09) : un payeur rattache dont"))
  const oui = demande.slice(demande.indexOf("if (droit.statut === 'oui')"))
  assert.equal((oui.match(/await envoyer\(/g) ?? []).length, 1)
  assert.ok(oui.indexOf('lireGenreEntree(u.id)') < oui.indexOf('texteAdmissionPour(entree, droit)'))
  assert.ok(oui.indexOf('texteAdmissionPour(entree, droit)') < oui.indexOf('approuverDemande(u.id)'))
  // Reprise d'une demande en attente : qui entre est lu avant l'approbation.
  const reprise = bot.slice(bot.indexOf('async function reprendreDemandeEnAttente('), bot.indexOf('async function leverBanSiBanni('))
  assert.ok(reprise.indexOf('lireGenreEntree(u.id)') > 0 && reprise.indexOf('lireGenreEntree(u.id)') < reprise.indexOf('approuverDemande(u.id)'))
  // Les trois reprises envoient le message de l'admission.
  assert.equal((bot.match(/texteAdmissionPour\(reprise\.entree, reprise\.droit\)/g) ?? []).length, 3)
  // L'adresse de l'academie vient de la constante, jamais en dur.
  const source = lire('src/lib/liveclub/accueil-groupe.ts')
  assert.match(source, /import \{ URL_FORMATION_LIVECLUB \} from '\.\/config'/)
  assert.ok(!source.includes('aoknowledge.com/academie'))
})

bloc('plus de lien Skool dans les textes du bot des membres', () => {
  const dossier = 'src/lib/liveclub'
  for (const f of readdirSync(new URL(`../${dossier}/`, import.meta.url)).filter(f => f.endsWith('.ts'))) {
    // config.ts garde l'ancienne adresse en commentaire et dans une constante inutilisee (historique, brief F1).
    if (f === 'config.ts') continue
    assert.ok(!/skool\.com/i.test(lire(`${dossier}/${f}`)), `${f} : lien Skool`)
  }
  for (const f of ['src/lib/politique-information.ts', 'src/app/api/cockpit/liveclub/telegram/route.ts']) {
    assert.ok(!/skool\.com/i.test(lire(f)), `${f} : lien Skool`)
  }
})

console.log(`\naccueil du Live Club : ${n} blocs verifies, tout est bon.`)
