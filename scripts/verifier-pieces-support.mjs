// Verification du fil Support du bot des membres (Brice, 16/10/2026) : les
// regles PURES de src/lib/liveclub/support-pont-pur.ts (pieces jointes dans
// les deux sens, « l'equipe a la main », rythme des alertes), le resume du
// matin (resume-pur.ts) et le bouton « Rendre la main au bot »
// (alerte-equipe-telegram-pur.ts), puis un controle statique.
// Aucune base, aucun reseau. Lancement : node scripts/verifier-pieces-support.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as S from '../src/lib/liveclub/support-pont-pur.ts'
import { RUBRIQUES_RESUME, attentesHorsEquipe, detailRepriseBot } from '../src/lib/liveclub/resume-pur.ts'
import { donneeRendreLaMain, lireDonneeRendreLaMain, texteDemandeHumain } from '../src/lib/alerte-equipe-telegram-pur.ts'

let n = 0
function test(nom, f) {
  f()
  n++
  console.log(`ok  ${nom}`)
}
const SOBRE = (s) => !/[—–]/.test(s) && !/\p{Extended_Pictographic}/u.test(s)
const H = 3600 * 1000
const T0 = Date.UTC(2026, 9, 16, 9, 0)
const at = (ms) => new Date(ms).toISOString()
const FIL = '3f2a9c1b-7d4e-4a1b-9c2d-0e5f6a7b8c9d'

// --- 1. L'image d'un membre ------------------------------------------------------

test('image d un membre : photo (la plus grande qui se relit) et legende', () => {
  const lu = S.lirePieceImageMembre({
    caption: ' regarde ça ',
    photo: [
      { file_id: 'petit', file_unique_id: 'u1', width: 90, height: 90, file_size: 2_000 },
      { file_id: 'moyen', file_unique_id: 'u2', width: 800, height: 600, file_size: 90_000 },
      { file_id: 'enorme', file_unique_id: 'u3', width: 4000, height: 3000, file_size: 5_000_000 },
    ],
  })
  assert.deepEqual(lu, {
    legende: 'regarde ça',
    piece: { file_id: 'moyen', file_unique_id: 'u2', type: 'photo', mime: 'image/jpeg', nom: null, taille: 90_000 },
  })
  // Sans legende : « [image] » au fil.
  assert.equal(S.texteFilImage(''), '[image]')
  assert.equal(S.texteFilImage('  vois  '), 'vois')
})

test('image d un membre : capture en fichier (mime, ou extension), jamais un PDF', () => {
  const png = S.lirePieceImageMembre({ document: { file_id: 'd1', file_unique_id: 'du1', file_name: 'Capture.PNG', mime_type: 'image/png', file_size: 300_000 } })
  assert.equal(png.piece.type, 'document')
  assert.equal(png.piece.mime, 'image/png')
  assert.equal(png.piece.nom, 'Capture.PNG')
  const parExtension = S.lirePieceImageMembre({ document: { file_id: 'd2', file_name: 'ecran.jpg', mime_type: 'application/octet-stream' } })
  assert.equal(parExtension.piece.mime, 'image/jpeg')
  assert.equal(S.lirePieceImageMembre({ document: { file_id: 'd3', file_name: 'releve.pdf', mime_type: 'application/pdf' } }), null)
  assert.equal(S.lirePieceImageMembre({ voice: { file_id: 'v' } }), null)
  assert.equal(S.lirePieceImageMembre({ text: 'bonjour' }), null)
  assert.equal(S.lirePieceImageMembre(null), null)
})

test('reponse du bot a une image : le texte de Brice, une seule fois pour un album', () => {
  assert.equal(S.TEXTE_IMAGE_TRANSMISE,
    "Bien reçu. Je ne lis pas les images moi-même, alors je transmets ta capture à l'équipe : elle te répond ici. Si tu veux, ajoute un mot pour expliquer.")
  assert.ok(SOBRE(S.TEXTE_IMAGE_TRANSMISE) && SOBRE(S.TEXTE_IMAGE_NON_TRANSMISE) && SOBRE(S.TEXTE_ACCUSE_EQUIPE))
  // Un album de 3 photos : 3 updates, un seul fait passer le fil en attente (atomique en base).
  const album = [{ filId: FIL, passeEnAttente: true }, { filId: FIL, passeEnAttente: false }, { filId: FIL, passeEnAttente: false }]
  const reponses = album.map(S.reponseAImage)
  assert.deepEqual(reponses, ['transmise', 'silence', 'silence'])
  assert.equal(reponses.filter((r) => r === 'transmise').length, 1)
  // Fil non ecrit (pont en panne) : le secours, jamais une promesse dans le vide.
  assert.equal(S.reponseAImage(null), 'secours')
})

// --- 2. Un fichier de l'equipe pour un membre -----------------------------------

test('fichier sortant : sendPhoto ou sendDocument', () => {
  const photo = S.lireFichierSortant({ type: 'photo', taille: 200_000 }, S.MAX_FICHIER_AGENT)
  assert.equal(photo.methode, 'sendPhoto')
  assert.equal(photo.nom, 'image.jpg')
  assert.equal(S.lireFichierSortant({ type: 'document', mime: 'image/png', nom: 'a.png', taille: 2_000_000 }, S.MAX_FICHIER_AGENT).methode, 'sendPhoto')
  // Une image de plus de 10 Mo part en fichier (limite de sendPhoto), un GIF aussi (sendPhoto ne l'anime pas).
  assert.equal(S.lireFichierSortant({ type: 'document', mime: 'image/png', nom: 'a.png', taille: 12 * 1024 * 1024 }, S.MAX_FICHIER_AGENT).methode, 'sendDocument')
  assert.equal(S.lireFichierSortant({ type: 'document', mime: 'image/gif', nom: 'a.gif', taille: 1000 }, S.MAX_FICHIER_AGENT).methode, 'sendDocument')
  const pdf = S.lireFichierSortant({ type: 'document', mime: 'application/pdf', nom: 'devis.pdf', taille: 240 * 1024 }, S.MAX_FICHIER_AGENT)
  assert.deepEqual(pdf, { mime: 'application/pdf', libelle: 'PDF', nom: 'devis.pdf', taille: 240 * 1024, methode: 'sendDocument' })
  assert.equal(S.descriptionFichier(pdf), 'PDF « devis.pdf », 240 Ko, envoyé en fichier')
  assert.equal(S.descriptionFichier(photo), 'image JPEG, 195 Ko, envoyée en photo')
  // Un mime vague se lit par l'extension ; un chemin dans le nom est retire.
  const word = S.lireFichierSortant({ type: 'document', mime: 'application/octet-stream', nom: 'C:\\temp\\plan.docx', taille: 10 }, S.MAX_FICHIER_AGENT)
  assert.equal(word.libelle, 'Word')
  assert.equal(word.nom, 'plan.docx')
})

test('fichier sortant : limites (types, 20 Mo par Agent AOK, 4 Mo par l onglet Support)', () => {
  assert.match(S.lireFichierSortant({ type: 'document', mime: 'application/zip', nom: 'a.zip', taille: 10 }, S.MAX_FICHIER_AGENT), /^Type de fichier refusé \(application\/zip\) : j'envoie seulement images/)
  assert.match(S.lireFichierSortant({ type: 'document', mime: 'application/octet-stream', nom: 'setup.exe', taille: 10 }, S.MAX_FICHIER_AGENT), /refusé \(exe\)/)
  assert.match(S.lireFichierSortant({ type: 'document', mime: 'application/pdf', nom: 'a.pdf', taille: 21 * 1024 * 1024 }, S.MAX_FICHIER_AGENT),
    /^Fichier trop lourd \(21,0 Mo\) : 20,0 Mo au plus \(limite de Telegram pour un bot\)\.$/)
  assert.match(S.lireFichierSortant({ type: 'document', mime: 'application/pdf', nom: 'a.pdf', taille: 5 * 1024 * 1024 }, S.MAX_FICHIER_COCKPIT),
    /depuis l'onglet Support \(limite d'envoi du serveur\)\. Envoie-le plutôt depuis Agent AOK \(jusqu'à 20 Mo\)\.$/)
  assert.equal(S.lireFichierSortant({ type: 'document', mime: 'application/pdf', nom: 'a.pdf', taille: 0 }, S.MAX_FICHIER_AGENT), 'Fichier vide : rien à envoyer.')
  // La legende : 1 024 caracteres, en-tete compris ; trop long = refus, rien n'est coupe.
  assert.equal(S.legendeFichier(''), "De la part de l'équipe AOK.")
  assert.equal(S.legendeFichier('voici'), "Réponse de l'équipe AOK :\n\nvoici")
  assert.equal(S.refusLegende('a'.repeat(1024)), null)
  assert.match(S.refusLegende('a'.repeat(1025)), /^Avec une pièce jointe, le texte part en légende : 1024 caractères au plus, en-tête compris \(1025 ici\)/)
  assert.equal(S.texteFilEnvoi('', { methode: 'sendPhoto', nom: 'image.jpg' }), '[image]')
  assert.equal(S.texteFilEnvoi('', { methode: 'sendDocument', nom: 'devis.pdf' }), '[fichier « devis.pdf »]')
  assert.equal(S.texteFilEnvoi('voici', { methode: 'sendDocument', nom: 'devis.pdf' }), 'voici')
})

test('fichier envoye : le fil garde le file_id rendu par le bot des membres', () => {
  const photo = S.pieceDuResultat({ message_id: 9, photo: [{ file_id: 'p1', file_unique_id: 'q1', width: 90, height: 90 }, { file_id: 'p2', file_unique_id: 'q2', width: 1280, height: 720, file_size: 80_000 }] }, { mime: 'image/png', nom: 'a.png' })
  assert.equal(photo.file_id, 'p2')
  assert.equal(photo.type, 'photo')
  const doc = S.pieceDuResultat({ message_id: 9, document: { file_id: 'f1', file_unique_id: 'g1', file_size: 1000 } }, { mime: 'application/pdf', nom: 'devis.pdf' })
  assert.deepEqual(doc, { file_id: 'f1', file_unique_id: 'g1', type: 'document', mime: 'application/pdf', nom: 'devis.pdf', taille: 1000 })
  assert.equal(S.pieceDuResultat({ message_id: 9, text: 'x' }, { mime: 'x', nom: 'y' }), null)
})

test('piece recue par Agent AOK : trace dans l historique, et la derniere piece recente seulement', () => {
  const piece = S.lirePieceMessage({ document: { file_id: 'ag1', file_unique_id: 'z', file_name: 'devis.pdf', mime_type: 'application/pdf', file_size: 240 * 1024 } })
  assert.equal(S.tracePieceAgent(piece), "[pièce jointe : PDF « devis.pdf », 240 Ko. Je peux l'envoyer à un membre (proposer_reponse_membre, piece_jointe).]")
  const p = { ...piece, bot: 'cockpit' }
  const histo = [
    { role: 'user', content: 'x', piece: { ...p, file_id: 'ancienne' } },
    ...Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
  ]
  assert.equal(S.dernierePieceHistorique(histo), null, 'une piece de plus de 6 messages ne compte plus')
  const recente = S.dernierePieceHistorique([...histo, { role: 'user', content: 'envoie-lui ça', piece: p }])
  assert.equal(recente.file_id, 'ag1')
  assert.equal(recente.bot, 'cockpit')
  // Une piece mal formee, ou d'un bot inconnu, ne compte pas.
  assert.equal(S.lirePieceAgent({ ...p, bot: 'autre' }), null)
  assert.equal(S.lirePieceAgent({ ...p, type: 'video' }), null)
  assert.equal(S.dernierePieceHistorique([{ role: 'assistant', content: 'x', piece: p }]), null)
})

// --- 3. L'equipe a la main ---------------------------------------------------------

const membre = (t, c = 'salut') => ({ role: 'user', content: c, at: at(t) })
const humain = (t, c = 'je regarde') => ({ role: 'human', content: c, at: at(t) })
const ia = (t, c) => ({ role: 'assistant', content: c, at: at(t) })
const rendue = (t) => ({ role: 'system', content: `${S.PREFIXE_SYSTEME}${S.LIGNE_MAIN_RENDUE}`, at: at(t) })

test('qui repond : le bot, jusqu a ce que l equipe ecrive', () => {
  assert.equal(S.quiRepond([], T0), 'bot')
  assert.equal(S.quiRepond([membre(T0 - H), ia(T0 - H, 'reponse IA')], T0), 'bot')
  // Cas de Lea : Brice repond a 11 h 28, elle repond a 11 h 29 : l'equipe a la main.
  const lea = [membre(T0 - 10 * 60000, '[bouton] Contacter l\'équipe'), humain(T0 - 2 * 60000), membre(T0 - 60000, 'merci, en fait...')]
  assert.equal(S.quiRepond(lea, T0), 'equipe')
  // Un message humain sans date ne garde pas la main.
  assert.equal(S.quiRepond([{ role: 'human', content: 'x' }], T0), 'bot')
})

test('reprise par le bouton « Rendre la main au bot », puis l equipe la reprend en ecrivant', () => {
  const fil = [humain(T0 - 3 * H), membre(T0 - 2 * H), rendue(T0 - H)]
  assert.equal(S.quiRepond(fil, T0), 'bot')
  assert.equal(S.periodeEquipe(fil), null)
  assert.equal(S.quiRepond([...fil, humain(T0 - 60000)], T0), 'equipe')
  assert.equal(S.phraseMainRendue({ ok: true, dejaAuBot: false }, 'fil 3f2a9c1b'),
    "C'est fait (fil 3f2a9c1b) : le bot reprend la main et répond de nouveau à ses messages écrits. Le membre n'est pas prévenu.")
  assert.match(S.phraseMainRendue({ ok: true, dejaAuBot: true }, null), /^Le bot avait déjà la main : rien n'a changé\.$/)
  assert.match(S.phraseMainRendue({ ok: false, raison: 'pas_telegram' }, null), /pas un fil du bot Live Club/)
  assert.match(S.phraseMainRendue({ ok: false, raison: 'introuvable' }, 'fil 1'), /n'existe plus/)
  // Le bouton sous l'alerte : rm:<id du fil>, 64 octets au plus, relu strictement.
  const d = donneeRendreLaMain(FIL.toUpperCase())
  assert.equal(d, `rm:${FIL}`)
  assert.ok(new TextEncoder().encode(d).length <= 64)
  assert.equal(lireDonneeRendreLaMain(d), FIL)
  assert.equal(lireDonneeRendreLaMain('ok:1234'), null)
  assert.equal(donneeRendreLaMain('telegram:1'), null)
})

test('filet de securite : 24 h sans message de l equipe, glissant', () => {
  assert.equal(S.DUREE_MAIN_EQUIPE_MS, 24 * H)
  assert.equal(S.quiRepond([humain(T0 - 24 * H + 60000)], T0), 'equipe')
  assert.equal(S.quiRepond([humain(T0 - 24 * H)], T0), 'bot')
  // Glissant : chaque message humain relance les 24 h.
  assert.equal(S.quiRepond([humain(T0 - 30 * H), membre(T0 - 29 * H), humain(T0 - 2 * H)], T0), 'equipe')
  // La reprise seule, datee pour le resume du matin.
  const fil = [humain(T0 - 30 * H), membre(T0 - 29 * H)]
  assert.equal(S.repriseAutomatique(fil, T0 - 24 * H, T0), T0 - 6 * H)
  assert.equal(S.repriseAutomatique(fil, T0 - 5 * H, T0), null, 'hors de la fenetre')
  assert.equal(S.repriseAutomatique([...fil, rendue(T0 - 28 * H)], T0 - 24 * H, T0), null, 'main rendue par le bouton : pas une reprise seule')
  assert.equal(S.repriseAutomatique([humain(T0 - H)], T0 - 24 * H, T0), null, 'encore a l equipe')
  assert.equal(detailRepriseBot(at(T0 - 6 * H)), "le bot a repris la main le 16 octobre à 5 h 00, sans message de l'équipe depuis 24 h")
  assert.ok(RUBRIQUES_RESUME.some((r) => r.cle === 'reprises' && /24 h sans message de l'équipe/.test(r.titre)))
})

test('accuse neutre : une seule fois tant que l equipe a la main', () => {
  const avant = [humain(T0 - 3 * H), membre(T0 - 2 * H)]
  assert.equal(S.accuseDejaDonne(avant), false)
  const apres = [...avant, ia(T0 - 2 * H + 1000, S.TEXTE_ACCUSE_EQUIPE), humain(T0 - H), membre(T0 - 30 * 60000)]
  assert.equal(S.accuseDejaDonne(apres), true, 'un nouveau message de l equipe ne le relance pas')
  // Nouvelle periode (main rendue, ou 24 h sans l'equipe) : l'accuse peut repartir une fois.
  assert.equal(S.accuseDejaDonne([...apres, rendue(T0 - 20 * 60000), humain(T0 - 10 * 60000)]), false)
  assert.equal(S.accuseDejaDonne([humain(T0 - 50 * H), ia(T0 - 49 * H, S.TEXTE_ACCUSE_EQUIPE), humain(T0 - H)]), false)
})

test('alertes : au plus une par fil toutes les 10 minutes', () => {
  const prevenue = (t) => ({ role: 'system', content: `${S.PREFIXE_SYSTEME}${S.LIGNE_EQUIPE_PREVENUE}`, at: at(t) })
  assert.equal(S.alerteAutorisee([], T0), true)
  assert.equal(S.alerteAutorisee([prevenue(T0 - 5 * 60000), membre(T0)], T0), false)
  assert.equal(S.alerteAutorisee([prevenue(T0 - 10 * 60000)], T0), true)
  assert.equal(S.derniereAlerteT([prevenue(T0 - H), prevenue(T0 - 60000)]), T0 - 60000)
})

test('alerte « a repondu a l equipe » : son message, la reference, sans « demande un humain »', () => {
  const t = texteDemandeHumain({
    origine: 'bot Live Club', qui: 'Léa @leaafighter', dernierMessage: 'merci, en fait mon souci est...', reponseDans: 'Telegram', fil: FIL, genre: 'reponse',
  })
  const l = t.split('\n')
  assert.equal(l[0], "Léa @leaafighter a répondu à l'équipe (bot Live Club).")
  assert.equal(l[1], 'Son message : « merci, en fait mon souci est... »')
  assert.ok(!t.includes('demande un humain'))
  assert.ok(t.endsWith('(fil 3f2a9c1b).'))
  const img = texteDemandeHumain({ origine: 'bot Live Club', qui: 'x', dernierMessage: '(a envoyé une image)', reponseDans: 'Telegram', fil: FIL, image: 'jointe' })
  assert.ok(img.includes('Son dernier message : (a envoyé une image)'))
  assert.ok(img.includes('Avec une image : la voici juste en dessous.'))
  assert.ok(texteDemandeHumain({ origine: 'o', qui: 'x', dernierMessage: null, reponseDans: 'Telegram', fil: FIL, image: 'onglet' })
    .includes("Avec une image, à voir dans l'onglet Support."))
  for (const s of [t, img]) assert.ok(SOBRE(s))
})

// --- 4. Le resume du matin : jamais un compte de l'equipe ---------------------------

test('resume du matin : les fils des comptes de l equipe ne sont jamais des demandes d humain', () => {
  const attentes = [
    { id: 'a', telegram_id: 111n }, { id: 'b', telegram_id: 222n }, { id: 'c', telegram_id: null }, { id: 'd', telegram_id: 333 },
  ]
  assert.deepEqual(attentesHorsEquipe(attentes, [222, 333]).map((a) => a.id), ['a', 'c'])
  assert.deepEqual(attentesHorsEquipe(attentes, []).map((a) => a.id), ['a', 'b', 'c', 'd'])
})

// --- 5. Statique ------------------------------------------------------------------

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lire = (rel) => readFileSync(path.join(RACINE, rel), 'utf8')

test('statique : passage en attente atomique, alerte rythmee, image du membre au bot', () => {
  const pont = lire('src/lib/liveclub/support-pont.ts')
  const enr = pont.slice(pont.indexOf('export async function enregistrerEchangeSupport'), pont.indexOf('export async function lireMessagesFil'))
  assert.match(enr, /timezone\('utc', clock_timestamp\(\)\)::timestamp\(3\) as t/)
  assert.match(enr, /"escalatedAt"::timestamp\(3\) = \(select t from horloge\) as passe_en_attente/)
  assert.ok(enr.indexOf('alerteAutorisee(') < enr.indexOf('alerterEquipeTelegram('))
  assert.ok(enr.indexOf('alerterEquipeTelegram(') < enr.indexOf('tracerEtape(e.telegramId, LIGNE_EQUIPE_PREVENUE'))
  const bot = lire('src/lib/liveclub/bot-membre.ts')
  assert.ok(bot.indexOf('await recevoirImageMembre(chat, u, message)') < bot.indexOf("'[message sans texte]'"))
  assert.ok(bot.indexOf('await transmettreSiEquipe(chat, u, message)') < bot.indexOf('await recevoirImageMembre(chat, u, message)'), 'l equipe d abord')
  const texteLibre = bot.slice(bot.indexOf('async function traiterTexteLibre'))
  assert.ok(texteLibre.indexOf('versEquipeSiElleALaMain(') < texteLibre.indexOf('converserAvecAgent('))
})

test('statique : routes du cockpit gardees, file_id lu en base, jamais du navigateur', () => {
  for (const rel of ['src/app/api/cockpit/support/piece/route.ts', 'src/app/api/cockpit/support/main/route.ts']) {
    const r = lire(rel)
    assert.match(r, /from public\.cockpit_allowlist where user_id/, rel)
    assert.match(r, /getUserId\(req\)/, rel)
  }
  const piece = lire('src/app/api/cockpit/support/piece/route.ts')
  assert.match(piece, /messages -> \$\{indice\}::int -> 'piece'/)
  assert.ok(!/body\??\.file_id/.test(piece))
  assert.match(piece, /telechargerImageTelegram\('liveclub'/)
  // Jamais l'URL d'un fichier (elle porte le jeton) dans un log.
  const tg = lire('src/lib/liveclub/telegram.ts')
  const fichiers = tg.slice(tg.indexOf('export async function telechargerFichierTelegram'), tg.indexOf('/** Un bouton :'))
  for (const ligne of fichiers.split('\n').filter((x) => /console\.(error|warn|log)/.test(x))) {
    assert.ok(!/\$\{jeton\}|\$\{chemin\}|\/file\/bot|API_TG/.test(ligne), ligne.trim())
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
