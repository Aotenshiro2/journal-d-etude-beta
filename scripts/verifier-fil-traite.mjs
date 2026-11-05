// Verification HORS LIGNE (05/11/2026) du bouton « Déjà traité » du support.
// Brice : « quand une conversation a été traitée en dehors du bot, je veux
// pouvoir cliquer sur un bouton pour signaler qu'un humain est déjà passé ou
// que le membre a eu sa réponse, sinon le signalement reste levé pour rien ».
// Choix de Brice (option 3) : le bouton dans le fil du cockpit ET sous
// l'alerte d'Agent AOK. Regles pures, puis le branchement relu dans le code
// (route, clic d'Agent AOK, cockpit). Aucune base, aucun reseau.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-fil-traite.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import './resoudre-ts.mjs'

const P = await import('../src/lib/liveclub/support-pont-pur.ts')
const A = await import('../src/lib/alerte-equipe-telegram-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')
const FIL = '1a2b3c4d-0000-4000-8000-00000000abcd'
const sansTiretsLongs = (t) => { assert.ok(!/[—–]/.test(t), `tiret long dans : ${t}`) }
const corpsDe = (texte, debut, fin) => {
  const i = texte.indexOf(debut)
  assert.ok(i >= 0, `introuvable : ${debut}`)
  const j = fin ? texte.indexOf(fin, i + debut.length) : -1
  return texte.slice(i, j > i ? j : undefined)
}

bloc('la ligne du fil : au nom de qui clique, sans retour a la ligne, bornee', () => {
  assert.equal(P.ligneFilTraite('Brice'), 'Traité hors du bot par Brice : le membre a eu sa réponse.')
  assert.equal(P.ligneFilTraite(null), "Traité hors du bot par l'équipe : le membre a eu sa réponse.")
  assert.equal(P.ligneFilTraite('  Mé\nlanie  '), 'Traité hors du bot par Mé lanie : le membre a eu sa réponse.')
  assert.ok(P.ligneFilTraite('x'.repeat(200)).length < 100)
})

bloc('estLigneFilTraite : une ligne systeme seulement, avec le prefixe', () => {
  const ligne = `${P.PREFIXE_SYSTEME}${P.ligneFilTraite('Adil')}`
  assert.equal(P.estLigneFilTraite({ role: 'system', content: ligne }), true)
  assert.equal(P.estLigneFilTraite({ role: 'human', content: ligne }), false)
  assert.equal(P.estLigneFilTraite({ role: 'system', content: P.ligneFilTraite('Adil') }), false)
  assert.equal(P.estLigneFilTraite({ role: 'system', content: `${P.PREFIXE_SYSTEME}Traité hors du botanique` }), false)
  assert.equal(P.estLigneFilTraite(null), false)
})

bloc('la ligne rend la main au bot, comme « Rendre la main au bot »', () => {
  const maintenant = Date.parse('2026-11-05T14:00:00Z')
  const avant = [
    { role: 'user', content: 'Je veux parler a quelqu un', at: '2026-11-05T12:00:00Z' },
    { role: 'human', content: 'Je te reponds sur WhatsApp', at: '2026-11-05T13:00:00Z' },
  ]
  assert.equal(P.quiRepond(avant, maintenant), 'equipe')
  const apres = [...avant, { role: 'system', content: `${P.PREFIXE_SYSTEME}${P.ligneFilTraite('Brice')}`, at: '2026-11-05T13:30:00Z' }]
  assert.equal(P.quiRepond(apres, maintenant), 'bot')
  assert.equal(P.periodeEquipe(apres), null)
  // Un nouveau message de l'equipe apres la ligne lui redonne la main.
  const encore = [...apres, { role: 'human', content: 'Une precision', at: '2026-11-05T13:50:00Z' }]
  assert.equal(P.quiRepond(encore, maintenant), 'equipe')
})

bloc('le membre ne relit jamais les lignes « [système] »', () => {
  const fil = [
    { role: 'user', content: 'Bonjour' },
    { role: 'assistant', content: 'Salut' },
    { role: 'human', content: 'Je regarde' },
    { role: 'system', content: `${P.PREFIXE_SYSTEME}${P.ligneFilTraite('Brice')}` },
    null,
  ]
  const vu = P.messagesPourLeMembre(fil)
  assert.deepEqual(vu.map(m => m?.role ?? null), ['user', 'assistant', 'human', null])
  assert.deepEqual(P.messagesPourLeMembre(undefined), [])
  assert.deepEqual(P.messagesPourLeMembre({}), [])
})

bloc('le bouton d Agent AOK : tr:<fil>, 64 octets au plus, relu strictement', () => {
  const d = A.donneeFilTraite(FIL.toUpperCase())
  assert.equal(d, `tr:${FIL}`)
  assert.ok(Buffer.byteLength(d, 'utf8') <= 64)
  assert.equal(A.lireDonneeFilTraite(d), FIL)
  assert.equal(A.donneeFilTraite('pas-un-fil'), null)
  assert.equal(A.lireDonneeFilTraite(`rm:${FIL}`), null)
  assert.equal(A.lireDonneeFilTraite(`tr:${FIL}x`), null)
  assert.equal(A.lireDonneeRendreLaMain(d), null, 'les deux boutons ne se confondent pas')
  assert.equal(A.LIBELLE_FIL_TRAITE, 'Déjà traité')
})

bloc('le clavier de l alerte : « Déjà traité » sur toute demande, pas sur une reponse ni une annulation', () => {
  const deux = A.clavierAlerte({ fil: FIL }, true)
  assert.deepEqual(deux, [[
    { text: A.LIBELLE_RENDRE_LA_MAIN, callback_data: `rm:${FIL}` },
    { text: 'Déjà traité', callback_data: `tr:${FIL}` },
  ]])
  assert.deepEqual(A.clavierAlerte({ fil: FIL, genre: 'demande' }, false), [[{ text: 'Déjà traité', callback_data: `tr:${FIL}` }]], 'fil du site : sans bot a qui rendre la main')
  assert.deepEqual(A.clavierAlerte({ fil: FIL, genre: 'reponse' }, true), [[{ text: A.LIBELLE_RENDRE_LA_MAIN, callback_data: `rm:${FIL}` }]])
  assert.deepEqual(A.clavierAlerte({ fil: FIL, genre: 'annulee' }, false), [])
  assert.deepEqual(A.clavierAlerte({ fil: null }, true), [])
})

bloc('l equipe au courant : qui a marque, pour qui, le fil, sans tiret long', () => {
  const t = A.texteFilTraiteEquipe({ auteur: 'Adil', qui: 'arthur@example.com', fil: FIL })
  assert.match(t, /^Adil a marqué traitée la demande de arthur@example\.com : réglée hors du bot/)
  assert.match(t, /Inutile de lui répondre\./)
  assert.match(t, /\(fil 1a2b3c4d\)/)
  sansTiretsLongs(t)
  const anonyme = A.texteFilTraiteEquipe({ auteur: null, qui: null, fil: null })
  assert.match(anonyme, /^Quelqu'un de l'équipe a marqué traitée la demande d'un membre :/)
  assert.match(A.MARQUEUR_INFO_EQUIPE, /une demande marquée traitée hors du bot/)
})

bloc('ce que dit Agent AOK apres le clic', () => {
  const ref = 'fil 1a2b3c4d'
  const fait = P.phraseFilTraite({ ok: true, dejaTraite: false, telegram: true, prevenus: 2 }, ref)
  assert.match(fait, /^C'est noté \(fil 1a2b3c4d\) : la demande est marquée traitée/)
  assert.match(fait, /Rien n'est envoyé au membre\./)
  assert.match(fait, /Le bot reprend ses messages écrits\./)
  assert.match(fait, /Le reste de l'équipe est prévenu\./)
  const site = P.phraseFilTraite({ ok: true, dejaTraite: false, telegram: false, prevenus: 0 }, ref)
  assert.doesNotMatch(site, /bot reprend|prévenu\./)
  assert.match(P.phraseFilTraite({ ok: true, dejaTraite: true, telegram: true, prevenus: 0 }, ref), /n'attendait plus personne : rien n'a changé/)
  assert.match(P.phraseFilTraite({ ok: false, raison: 'introuvable' }, ref), /n'existe plus/)
  for (const t of [fait, site]) sansTiretsLongs(t)
})

bloc('le branchement : route gardee, clic apres le verrou, ecriture conditionnee, membre epargne', () => {
  const route = lire('src/app/api/cockpit/support/traite/route.ts')
  assert.match(route, /getUserId\(req\)/)
  assert.match(route, /from public\.cockpit_allowlist where user_id = \$\{userId\}::uuid/)
  assert.match(route, /traiterFilHorsBot\(threadId, userId,/)
  const pont = lire('src/lib/liveclub/support-pont.ts')
  const marquer = corpsDe(pont, 'export async function marquerFilTraite', 'export type OptionsTrace')
  assert.match(marquer, /where id = \$\{threadId\} and "escalatedAt" is not null/, 'deux clics croises : une seule ligne')
  assert.match(marquer, /ligneFilTraite\(par\)/)
  const traite = lire('src/lib/support-traite.ts')
  assert.match(traite, /support: true/, 'Adil (compte support) le sait aussi')
  assert.match(traite, /sauf: userId/, 'pas a celui qui vient de cliquer')
  const clic = lire('src/lib/agent-cockpit-telegram.ts')
  const corps = corpsDe(clic, 'export async function traiterClicAgentTelegram')
  const verrou = corps.indexOf('compteCockpitTelegram(telegramId)')
  const lecture = corps.indexOf('lireDonneeFilTraite(donnee)')
  assert.ok(verrou >= 0 && lecture > verrou, 'le clic « Déjà traité » passe apres le verrou du compte')
  assert.match(clic, /traiterFilHorsBot\(fil, compte\.user_id,/)
  const alerte = lire('src/lib/alerte-equipe-telegram.ts')
  assert.match(alerte, /clavierAlerte\(d, !!o\.rendreLaMain\)/)
  const fil = lire('src/app/api/support/thread/route.ts')
  assert.match(fil, /messages: messagesPourLeMembre\(thread\.messages\)/)
})

bloc('le cockpit lit la meme ligne que le serveur (pastille, main, bouton)', () => {
  const dossier = '../cockpit/src/views/'
  if (!existsSync(new URL(`../${dossier}support/regles.ts`, import.meta.url))) { console.log('    (cockpit hors de ce dossier : non relu)'); return }
  const regles = lire(`${dossier}support/regles.ts`)
  assert.ok(regles.includes(`export const DEBUT_LIGNE_FIL_TRAITE = '${P.PREFIXE_SYSTEME}${P.DEBUT_LIGNE_FIL_TRAITE} '`), 'meme debut de ligne que le serveur')
  assert.match(regles, /m\.role === 'human' \|\| estLigneFilTraite\(m\)/, '« humain passé »')
  assert.match(regles, /m\.content === LIGNE_MAIN_RENDUE\) \|\| estLigneFilTraite\(m\)/, 'la main revient au bot')
  for (const ecran of ['support/FilConversation.tsx', 'support/PanneauInfos.tsx']) {
    const t = lire(`${dossier}${ecran}`)
    assert.match(t, /\{fil\.escalated_at && \(/, `${ecran} : le bouton seulement quand le fil attend un humain`)
    assert.match(t, /onClick=\{onMarquerTraite\}/)
    assert.match(t, /Déjà traité/)
  }
  const vue = lire(`${dossier}SupportView.tsx`)
  assert.match(vue, /\/api\/cockpit\/support\/traite/)
  assert.match(vue, /escalated_at: null/)
})

console.log(`\n${n} blocs ok`)
process.exit(0)
