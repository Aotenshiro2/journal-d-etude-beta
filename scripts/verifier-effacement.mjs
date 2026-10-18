// Verification locale de l'EFFACEMENT des donnees d'une personne (Brice,
// 15/10/2026) : les regles PURES de src/lib/effacement-pur.ts (choix du
// niveau, cible, composition de la carte, textes pour la personne, textes du
// bot sans proposition d'effacement), puis des controles STATIQUES : le
// perimetre (aucun bot ni route des membres ne touche a l'effacement), la
// regle du bot des membres, ce que lit vraiment le mentor du Journal, et la
// coherence de la migration (memes cles dans l'apercu et dans l'effacement).
// Aucune base, aucun reseau, aucun modele.
// Lancement (Node 22) : node scripts/verifier-effacement.mjs

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC_URL = pathToFileURL(path.join(RACINE, 'src') + path.sep).href
// prompt-membre.ts importe './config' sans extension : meme crochet que eval-fuites.mjs.
register('data:text/javascript,' + encodeURIComponent(`
const SRC = ${JSON.stringify(SRC_URL)};
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx) } catch (err) {
    let base = null
    if (spec.startsWith('@/')) base = new URL(spec.slice(2), SRC).href
    else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) base = new URL(spec, ctx.parentURL).href
    if (!base) throw err
    for (const c of [base + '.ts', base + '/index.ts']) { try { return await next(c, ctx) } catch {} }
    throw err
  }
}`))

const E = await import('../src/lib/effacement-pur.ts')
const M = await import('../src/lib/liveclub/prompt-membre.ts')

let n = 0
const test = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }

// La migration, lue une fois (section 7, et le libelle de chaque cle en section 3).
const MIGRATION = path.join(RACINE, '../../sites/Aoknowledgecom/supabase/migrations/20261016090000_cockpit_effacement.sql')
const SQL = readFileSync(MIGRATION, 'utf8')
function corps(tag) {
  const debut = SQL.indexOf(`as $${tag}$`)
  const fin = SQL.indexOf(`$${tag}$`, debut + tag.length + 5)
  assert.ok(debut > 0 && fin > debut, `corps ${tag}`)
  return SQL.slice(debut + tag.length + 5, fin)
}
function clesMigration() {
  const apercu = corps('apercu')
  const efface = apercu.slice(apercu.indexOf("'efface',"), apercu.indexOf("'anonymise',"))
  const anonymise = apercu.slice(apercu.indexOf("'anonymise',"), apercu.indexOf("'garde',"))
  const cles = (t) => new Set([...t.matchAll(/'([a-z_]+)', \(select count/g)].map((m) => m[1]))
  const effacer = corps('effacer')
  const cotes = (prefixe) => new Set([...effacer.matchAll(new RegExp(`${prefixe} := ${prefixe} \\|\\| jsonb_build_object\\(([^;]+?)\\);`, 'g'))]
    .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)', /g)].map((x) => x[1])))
  return { efface: cles(efface), anonymise: cles(anonymise), effaceFait: cotes('v_efface'), anonymiseFait: cotes('v_anonymise') }
}

const SANS_TIRET_LONG = (t) => !/[–—]/.test(t)
const UUID = '0b0e0c3a-1111-4222-8333-944445555666'

// --- 1. Le choix du niveau : jamais deduit -------------------------------------

test('niveau : 1, 2 ou 3 seulement, sinon le rappel des trois niveaux', () => {
  assert.equal(E.lireNiveau(1), 1)
  assert.equal(E.lireNiveau('2'), 2)
  assert.equal(E.lireNiveau(' 3 '), 3)
  for (const x of [0, 4, 1.5, '1 ou 2', 'deux', 'niveau 2', null, undefined, '', [], {}]) {
    const r = E.lireNiveau(x)
    assert.equal(typeof r, 'string', `refus attendu pour ${JSON.stringify(x)}`)
    assert.match(r, /1 \(ne plus être suivi\), 2 \(effacer ses échanges avec nos bots\) ou 3 \(partir et tout effacer\)/)
    assert.match(r, /ne le choisis jamais/)
  }
})

test('parametres : qui obligatoire, niveau obligatoire, cible validee strictement', () => {
  assert.equal(typeof E.lireParamsEffacement({ niveau: 1 }), 'string')
  assert.equal(typeof E.lireParamsEffacement({ qui: 'Fred' }), 'string')
  assert.deepEqual(E.lireParamsEffacement({ qui: '  Fred   Dupont ', niveau: 2 }), { niveau: 2, qui: 'Fred Dupont' })
  const ok = E.lireParamsEffacement({
    qui: 'u123456789', niveau: 3,
    cible: { telegram: [123456789, '123456789'], membres: [UUID.toUpperCase()], archives: ['p-fred'], emails: [' Fred@Exemple.fr '] },
  })
  assert.deepEqual(ok.cible, { telegram: [123456789], membres: [UUID], archives: ['p-fred'], emails: ['fred@exemple.fr'] })
  for (const cible of [
    { telegram: [-1] }, { telegram: ['abc'] }, { membres: ['pas-un-uuid'] }, { archives: ['fred'] },
    { emails: ['sans-arobase'] }, { telegram: 'u1' }, { telegram: [1, 2, 3, 4, 5, 6, 7] }, [],
  ]) {
    assert.equal(typeof E.lireParamsEffacement({ qui: 'x', niveau: 1, cible }), 'string', JSON.stringify(cible))
  }
  assert.equal(typeof E.lireParamsEffacement({ qui: 'x'.repeat(121), niveau: 1 }), 'string')
  assert.equal(E.cibleVide({ telegram: [], membres: [], archives: [], emails: [] }), true)
})

// --- 2. L'apercu et les refus ---------------------------------------------------

const APERCU_3 = {
  niveau: 3,
  cibles: { comptes_telegram: 1, fiches_membres: 1, emails: 2, comptes_aok: 1, fiches_archive: 1 },
  efface: {
    tg_messages: 120, tg_noms: 3, archive_fiches: 1, archive_paroles: 40, archive_vies: 0,
    bot_fils: 2, bot_conversations: 1, journal_notes: 12, journal_messages: 300, aok_comptes: 1, aok_profils: 1,
    fiche_membres: 1, fiche_emails: 2, lc_rattachements: 1, lc_gestes: 14, tg_registre: 1, cle_inconnue: 2,
  },
  anonymise: { ia_usage: 30, lc_acces_broker_gardes: 0 },
  garde: { paiements: 5, abonnements: 2, commissions: 0, academie_lectures: 0 },
  externe: { abonnements_live_club_vivants: 1, abonnements_arret_deja_prevu: 0, abonnements_live_club_impayes: 0, abonnements_autres_vivants: 1, comptes_dans_le_groupe: 1 },
  bloquants: [],
  alertes: ['plusieurs_comptes_aok'],
}

test('apercu : lecture du JSON de la base, nombres seulement', () => {
  const a = E.lireApercu(JSON.stringify({ ...APERCU_3, efface: { ...APERCU_3.efface, piege: 'texte', negatif: -3 } }))
  assert.equal(a.niveau, 3)
  assert.equal(a.efface.piege, undefined)
  assert.equal(a.efface.negatif, undefined)
  assert.equal(a.efface.tg_messages, 120)
  assert.deepEqual(a.alertes, ['plusieurs_comptes_aok'])
  assert.equal(E.lireApercu('{pas du json'), null)
  assert.equal(E.lireApercu({ niveau: 7 }), null)
})

test('refus avant la carte : equipe, tarif reserve en attente, trop large, rien a effacer', () => {
  const base = E.lireApercu(APERCU_3)
  assert.equal(E.refusApercu(base), null)
  assert.match(E.refusApercu({ ...base, bloquants: ['equipe'] }), /compte de l'équipe/)
  assert.match(E.refusApercu({ ...base, bloquants: ['tarif_reserve_en_attente'] }), /proposer_retirer_tarif_reserve/)
  assert.match(E.refusApercu({ ...base, bloquants: ['trop_large'] }), /à vérifier à la main/)
  assert.match(E.refusApercu({ ...base, niveau: 1, efface: { tg_messages: 0 }, anonymise: {} }), /Rien à effacer au niveau 1/)
  assert.equal(E.refusApercu({ ...base, niveau: 1, efface: {}, anonymise: { tg_registre_noms: 1 } }), null)
})

// --- 3. La composition de la carte -------------------------------------------

test('carte niveau 3 : app par app, ce qui reste, hors base, a la main, irreversible', () => {
  const carte = E.composerCarte('Fred', E.lireApercu(APERCU_3))
  const l = carte.split('\n')
  assert.match(l[0], /^Effacer les données de Fred, niveau 3 : partir et tout effacer \(1 compte\(s\) Telegram, 1 fiche\(s\) membre, 1 compte\(s\) AOK, 2 email\(s\), 1 fiche\(s\) d'archive\)\.$/)
  assert.ok(l.includes('- Groupes Telegram : 120 messages relevés, 3 noms (historique), 1 ligne du registre du groupe.'))
  assert.ok(l.includes("- Archive d'avant le 30/08 : 1 fiche, 40 paroles."), 'les zeros ne sont pas dits')
  assert.ok(l.includes("- Journal d'Études : 12 notes, 300 blocs de notes."))
  assert.ok(l.some((x) => x.startsWith('- Compte AOK (site, masterclass, académie) : 1 compte, 1 profil')))
  assert.ok(l.includes('- Autres : cle_inconnue 2.'), 'une cle inconnue reste visible')
  assert.ok(carte.includes("Stripe : 1 abonnement(s) Live Club vivant(s) d'après la collecte du matin, relu en direct au clic : arrêt à la fin de la période payée"))
  assert.ok(carte.includes('Telegram : sortie du groupe Live Club sans bannissement (1 compte(s) présent(s))'))
  assert.ok(carte.includes("Reste : 5 paiement(s), avec son nom et son email figés avant l'effacement (pièces comptables)"))
  assert.ok(carte.includes('ses factures et paiements chez Stripe'))
  assert.ok(carte.includes("ses messages dans les groupes Telegram (c'est à lui de les supprimer)"))
  assert.ok(carte.includes("Kit : supprimer l'abonné"))
  assert.ok(carte.includes('Skool : le retirer du groupe Skool'))
  assert.ok(carte.includes('1 abonnement(s) hors Live Club à arrêter au Dashboard'))
  assert.ok(carte.includes('ATTENTION : plusieurs fiches ou comptes AOK'))
  assert.match(l[l.length - 1], /^IRRÉVERSIBLE : .*notes du Journal.*compte AOK/)
  assert.ok(SANS_TIRET_LONG(carte))
  assert.ok(carte.length < 2600, `carte de ${carte.length} caracteres (Telegram : 4 096 avec la reponse)`)
})

test('carte niveaux 1 et 2 : il reste membre, rien hors base', () => {
  const a1 = E.lireApercu({ niveau: 1, cibles: { comptes_telegram: 1 }, efface: { tg_messages: 9, archive_fiches: 1 }, anonymise: { tg_registre_noms: 1 } })
  const c1 = E.composerCarte('u123456789', a1)
  assert.match(c1, /niveau 1 : ne plus être suivi/)
  assert.match(c1, /plus rien de ce qu'il écrit ne sera relevé/)
  assert.match(c1, /le registre du groupe garde son compte \(présence\) mais plus son nom/)
  assert.match(c1, /il reste membre : abonnement, fiche, compte AOK et Journal ne bougent pas/)
  assert.ok(!/Stripe|Kit|Skool/.test(c1))
  const c2 = E.composerCarte('Fred', E.lireApercu({ niveau: 2, efface: { bot_fils: 2, bot_conversations: 1 }, anonymise: { ia_usage: 4 } }))
  assert.match(c2, /- Bot des membres et support : 2 fils de conversation, 1 mémoire du bot\./)
  assert.ok(!/ne sera relevé/.test(c2))
  assert.match(c2, /IRRÉVERSIBLE/)
})

test('carte bornee : le pire cas tient dans un message Telegram avec le texte a dire', () => {
  const tout = Object.fromEntries(E.APPS.flatMap((a) => Object.keys(a.cles)).map((k) => [k, 123]))
  const pire = E.lireApercu({
    ...APERCU_3, efface: tout, anonymise: { ia_usage: 4, lc_acces_broker_gardes: 1, academie_acces_preuves: 1 },
    garde: { paiements: 12, abonnements: 3, commissions: 1, academie_lectures: 40 },
    externe: { abonnements_live_club_vivants: 1, abonnements_arret_deja_prevu: 1, abonnements_live_club_impayes: 1, abonnements_autres_vivants: 1, comptes_dans_le_groupe: 1 },
    alertes: ['plusieurs_fiches', 'paiements_sans_nom'],
  })
  const carte = E.composerCarte('Prénom Nomdefamille', pire)
  assert.ok(carte.length <= E.MAX_CARTE, `carte de ${carte.length} caracteres`)
  assert.match(carte, /autre\(s\) table\(s\)/, 'les tables non citees sont comptees')
  assert.match(carte, /IRRÉVERSIBLE/)
  // Reponse du modele (300) + texte a dire + carte, dans un message Telegram.
  for (const niveau of [1, 2, 3]) assert.ok(300 + E.texteAvantCarte(niveau).length + 4 + carte.length <= 4096)
})

test('carte : chaque cle d\'effacement a son libelle', () => {
  const connues = new Set(E.APPS.flatMap((a) => Object.keys(a.cles)))
  for (const cle of clesMigration().efface) assert.ok(connues.has(cle), `libelle manquant pour ${cle}`)
})

// --- 4. Les textes pour la personne ----------------------------------------------

test('prevenir : trois textes, tutoiement, definitif, sans tiret long', () => {
  for (const niveau of [1, 2, 3]) {
    const t = E.TEXTES_PREVENIR[niveau]
    assert.ok(SANS_TIRET_LONG(t))
    assert.match(t, /^Avant qu'on le fasse : /)
    assert.match(t, /définitif/)
    assert.match(E.texteAvantCarte(niveau), new RegExp(`^À dire à la personne AVANT de confirmer \\(niveau ${niveau}, `))
  }
  assert.match(E.TEXTES_PREVENIR[1], /Tu restes membre/)
  assert.match(E.TEXTES_PREVENIR[1], /Ce que ça change pour toi/)
  assert.match(E.TEXTES_PREVENIR[1], /mentor du Journal d'Études, lui, lit tes notes et tes trades, pas tes messages du groupe/)
  assert.match(E.TEXTES_PREVENIR[3], /tes notes et ton historique du Journal d'Études/)
  assert.match(E.TEXTES_PREVENIR[3], /tes paiements, avec ton nom et ton email/)
  assert.match(E.TEXTES_PREVENIR[3], /c'est toi qui peux les supprimer/)
})

test('prevenir niveau 1 : le mentor ne lit vraiment ni les messages du groupe, ni les noms, ni l\'archive', () => {
  // Ce que dit le texte doit rester vrai : le brief du mentor, ses routes, et
  // la regle d'acces (entitlements.ts : abonnement, ETM, Skool, rien du niveau 1).
  const fichiers = ['src/lib/mentorat-brief.ts', 'src/lib/entitlements.ts', ...readdirSync(path.join(RACINE, 'src/app/api/mentorat'))
    .map((d) => `src/app/api/mentorat/${d}/route.ts`)]
  assert.ok(fichiers.length >= 5)
  for (const f of fichiers) {
    const t = readFileSync(path.join(RACINE, f), 'utf8')
    for (const interdit of ['cockpit_telegram', 'cockpit_arch', 'fiche-personne', 'SupportThread', 'supportThread', 'cockpit_liveclub_conversations']) {
      assert.ok(!t.includes(interdit), `${f} lit ${interdit} : le texte du niveau 1 est a revoir`)
    }
  }
})

test('recapitulatif a transmettre : sans nom, email ni identifiant', () => {
  const r3 = E.recapitulatifPersonne(3, {
    stripe: { arretes: [{ fin: '2026-11-03T10:00:00.000Z' }, { fin: '2026-10-30T10:00:00.000Z' }], dejaPrevus: 0, impayes: 0 },
    telegram: { sortis: 1, absents: 0, refuses: 0, echecs: 0, comptesEnEchec: [] },
  })
  assert.match(r3, /ton abonnement s'arrête à la fin de la période déjà payée, le 03\/11\/2026/)
  assert.match(r3, /tu n'es plus dans le groupe Telegram \(sans bannissement\)/)
  assert.match(r3, /ton compte AOK et tes notes du Journal d'Études sont supprimés/)
  const sansAbo = E.recapitulatifPersonne(3, { stripe: { arretes: [], dejaPrevus: 0, impayes: 0 }, telegram: { sortis: 0, absents: 1, refuses: 0, echecs: 0, comptesEnEchec: [] } })
  assert.ok(!/abonnement s'arrête/.test(sansAbo))
  assert.ok(!/plus dans le groupe/.test(sansAbo))
  for (const t of [r3, sansAbo, E.recapitulatifPersonne(1), E.recapitulatifPersonne(2)]) {
    assert.ok(!/@|u\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}/.test(t), t)
    assert.ok(SANS_TIRET_LONG(t))
  }
})

test('resultat pour l\'equipe : fait, garde, Stripe, Telegram, a la main, recapitulatif', () => {
  const r = E.lireResultat({
    effacement_id: UUID, niveau: 3,
    efface: { tg_messages: 120, journal_notes: 12, aok_comptes: 1, fiche_membres: 1 },
    anonymise: { ia_usage: 30 }, garde: { paiements: 5, paiements_figes: 5, abonnements: 2 },
  })
  const t = E.phraseResultat(r, {
    stripe: { arretes: [{ fin: '2026-11-03T10:00:00.000Z' }], dejaPrevus: 1, impayes: 1 },
    telegram: { sortis: 0, absents: 0, refuses: 0, echecs: 1, comptesEnEchec: [123456789] },
    externe: { abonnements_autres_vivants: 0 },
  })
  assert.match(t, /^Effacement de niveau 3 fait \(partir et tout effacer\), journalisé sans nom ni email\./)
  assert.match(t, /Gardé : 5 paiement\(s\) avec son nom et son email \(5 figé\(s\) à l'instant\)/)
  assert.match(t, /Stripe : 1 arrêt\(s\) programmé\(s\) à la fin de la période payée \(accès jusqu'au 03\/11\/2026\), 1 déjà programmé\(s\)\./)
  assert.match(t, /Telegram : 0 compte\(s\) sorti\(s\)/)
  assert.match(t, /la sortie a échoué pour u123456789 : le retirer à la main \(proposer_retirer_telegram\)/)
  assert.match(t, /abonnement\(s\) Live Club impayé\(s\) à résilier au Dashboard/)
  assert.match(t, /À transmettre à la personne :\n« C'est fait : /)
  assert.ok(SANS_TIRET_LONG(t))
  const t1 = E.phraseResultat(E.lireResultat({ niveau: 1, efface: {}, anonymise: {}, garde: {} }))
  assert.match(t1, /Effacé : rien en base à ce niveau\./)
  assert.ok(!/Kit|Stripe/.test(t1))
})

test('journal : des nombres seulement', () => {
  const j = E.externePourJournal(
    { arretes: [{ fin: '2026-11-03' }], dejaPrevus: 0, impayes: 0 },
    { sortis: 1, absents: 0, refuses: 0, echecs: 1, comptesEnEchec: [123456789] },
  )
  assert.deepEqual(Object.keys(j).sort(), ['stripe_arrets', 'stripe_deja_prevus', 'stripe_impayes', 'telegram_absents', 'telegram_echecs', 'telegram_refuses', 'telegram_sortis'])
  assert.ok(Object.values(j).every((x) => typeof x === 'number'))
  assert.ok(!JSON.stringify(j).includes('123456789'))
})

// --- 5. Le bot des membres : transmission, jamais de proposition ----------------

test('textes du bot : la transmission neutre passe, les propositions et les niveaux sont detectes', () => {
  assert.equal(E.proposeEffacement(M.TEXTE_DEMANDE_EFFACEMENT), false)
  assert.equal(E.proposeEffacement(M.RESULTAT_DEMANDER_UN_HUMAIN.consigne), false)
  assert.equal(E.proposeEffacement(M.CONSIGNE_EQUIPE_TRANSMISE), false)
  for (const mauvais of [
    'Tu peux choisir entre trois niveaux : ne plus être suivi, effacer tes échanges, ou tout effacer.',
    'Niveau 1 : on efface tes messages. Niveau 2 : tes échanges avec le bot.',
    "C'est fait, j'ai supprimé tes données.",
    'Si tu veux, on peut effacer tes messages du groupe.',
    'Tu as le droit de faire supprimer ton compte, veux-tu que je le fasse ?',
    'On a bien effacé tout ce qui te concerne.',
  ]) assert.equal(E.proposeEffacement(mauvais), true, mauvais)
  assert.ok(SANS_TIRET_LONG(M.TEXTE_DEMANDE_EFFACEMENT))
})

test('prompt du bot des membres : la regle, la transmission, la phrase mot pour mot', () => {
  const p = M.SYSTEM_PROMPT_MEMBRE
  const i = p.indexOf("Une demande sur l'effacement de ses données")
  assert.ok(i > 0, 'la regle est dans le prompt')
  const regle = p.slice(i, p.indexOf('\n', i))
  assert.match(regle, /tu ne supprimes rien, tu n'as aucun outil pour ça/)
  assert.match(regle, /ni des options, ni des niveaux/)
  assert.match(regle, /Tu appelles demander_un_humain/)
  assert.ok(regle.includes(`« ${M.TEXTE_DEMANDE_EFFACEMENT} »`))
  assert.match(regle, /Tu ne proposes jamais de toi-même d'effacer quoi que ce soit/)
  // Aucun outil d'effacement chez le bot des membres.
  assert.ok(!M.OUTILS_MEMBRE.some((o) => /effac|supprim|oubli/i.test(o.name)))
  assert.ok(SANS_TIRET_LONG(regle))
})

// --- 6. Le perimetre : l'effacement reste dans le cockpit ----------------------

const SRC = path.join(RACINE, 'src')
function fichiers(dossier) {
  const r = []
  for (const e of readdirSync(dossier)) {
    const p = path.join(dossier, e)
    if (statSync(p).isDirectory()) r.push(...fichiers(p))
    else if (/\.(ts|tsx|mjs|js)$/.test(e)) r.push(p)
  }
  return r
}
const TOUS = fichiers(SRC).map((p) => ({ rel: path.relative(RACINE, p).split(path.sep).join('/'), texte: readFileSync(p, 'utf8') }))
const importeStatique = (texte, module) => new RegExp(`from ['"]@/lib/${module}['"]|from ['"]\\./${module}['"]|from ['"]\\.\\./${module}['"]`).test(texte)

test('perimetre : seuls l\'agent du cockpit et stripe-actions touchent a l\'effacement', () => {
  const statiques = TOUS.filter((f) => importeStatique(f.texte, 'effacement')).map((f) => f.rel).sort()
  assert.deepEqual(statiques, ['src/lib/agent-cockpit.ts'])
  const dynamiques = TOUS.filter((f) => f.texte.includes("import('@/lib/effacement')")).map((f) => f.rel).sort()
  // compte-membre.ts (18/10) : la suppression du compte par le membre lui-meme, depuis le site.
  assert.deepEqual(dynamiques, ['src/lib/compte-membre.ts', 'src/lib/stripe-actions.ts'])
  const sql = TOUS.filter((f) => /cockpit_effacer\(|cockpit_effacement_apercu\(|cockpit_effacement_cibles\(/.test(f.texte)).map((f) => f.rel)
  assert.deepEqual(sql, ['src/lib/effacement.ts'])
  // effacement.ts n'importe pas la fiche : l'agent lui passe le resolveur.
  const eff = TOUS.find((f) => f.rel === 'src/lib/effacement.ts').texte
  assert.ok(!importeStatique(eff, 'fiche-personne'))
  const MEMBRES = /^src\/app\/api\/(support|mentorat|liveclub)\/|^src\/lib\/liveclub\/(agent-membre|prompt-membre|actions-membre|support-pont|bot-membre)\.ts$|^src\/lib\/(support-prompt|politique-information)\.ts$/
  const cotesMembres = TOUS.filter((f) => MEMBRES.test(f.rel))
  assert.ok(cotesMembres.length >= 9)
  for (const f of cotesMembres) {
    for (const interdit of ['effacement-pur', "lib/effacement'", 'proposer_effacement', 'cockpit_effacer', 'cockpit_effacement']) {
      assert.ok(!f.texte.includes(interdit), `${f.rel} contient ${interdit}`)
    }
  }
})

test('suppression par le membre : son compte seulement, niveau 3, mot SUPPRIMER', () => {
  const lib = TOUS.find((f) => f.rel === 'src/lib/compte-membre.ts').texte
  const route = TOUS.find((f) => f.rel === 'src/app/api/compte/supprimer/route.ts').texte
  // La cible ne vient que de l'email confirme du jeton.
  assert.match(lib, /lireCible\(\{ telegram: \[\], membres: \[\], archives: \[\], emails: \[compte\.email\] \}\)/)
  assert.match(lib, /params: \{ niveau: 3, qui: 'compte du site \(demande du membre\)', cible \}/)
  assert.match(lib, /export const MOT_CONFIRMATION = 'SUPPRIMER'/)
  assert.match(lib, /u\.email && u\.email_confirmed_at \?/)
  assert.match(route, /if \(corps\?\.confirmation !== MOT_CONFIRMATION\) return refus\('confirmation', 400\)/)
  assert.match(route, /supprimerCompte\(\{ id: compte\.id, email: compte\.email \}\)/)
  // Rien du corps de la requete n'atteint la cible.
  assert.ok(!/corps\??\.(email|cible|qui|telegram|membres)/.test(route))
})

test('agent du cockpit : outil declare, niveau en enum, carte du serveur, texte avant la carte', () => {
  const agent = TOUS.find((f) => f.rel === 'src/lib/agent-cockpit.ts').texte
  assert.match(agent, /name: 'proposer_effacement'/)
  assert.match(agent, /niveau: \{ type: 'integer', enum: \[1, 2, 3\]/)
  assert.match(agent, /proposer_effacement: 'effacement'/)
  const boucle = agent.slice(agent.indexOf('const typeAction = TYPE_PAR_OUTIL'))
  assert.ok(boucle.indexOf("action.type === 'effacement'") > 0)
  assert.ok(boucle.indexOf("action.type === 'effacement'") < boucle.indexOf("action.compte === 'cockpit'"), 'l\'effacement avant la repartition')
  assert.match(agent, /\+ \(avant \? `\\n\\n\$\{avant\}` : ''\)/)
  assert.match(agent, /resume: carte \?\? \(resumeAction\(action\)/)
  assert.match(agent, /L'EFFACEMENT DES DONNÉES D'UNE PERSONNE/)
  assert.match(agent, /ne choisis jamais : rappelle les trois niveaux/)
  assert.ok(!/fonction serveur \(cockpit_oublier_telegram\) que Brice lance/.test(agent), 'l\'ancienne consigne est remplacee')
  const actions = TOUS.find((f) => f.rel === 'src/lib/stripe-actions.ts').texte
  assert.match(actions, /if \(a\.type === 'effacement'\) return \{ niveau: a\.params\.niveau \}/)
  const route = TOUS.find((f) => f.rel === 'src/app/api/cockpit/agent/action/route.ts').texte
  assert.ok(route.indexOf("action.type === 'effacement'") < route.indexOf('await executerAction('), 'carte videe avant l\'execution')
})

// --- 7. La migration : decoupage, droits, memes cles des deux cotes ------------

test('migration : apercu et effacement rendent les memes cles', () => {
  const c = clesMigration()
  // aok_journaux_securite est une somme de deux comptes dans l'apercu.
  c.efface.add('aok_journaux_securite')
  assert.ok(c.efface.size >= 60, `${c.efface.size} cles`)
  assert.deepEqual([...c.effaceFait].sort(), [...c.efface].sort())
  assert.deepEqual([...c.anonymiseFait].sort(), [...c.anonymise].sort())
})

test('migration : droits postgres seulement, apercu STABLE, payeur fige en premier, oublis', () => {
  for (const f of [
    'cockpit_effacer(integer, bigint[], uuid[], text[], text[], text)',
    'cockpit_effacement_apercu(integer, bigint[], uuid[], text[], text[])',
    'cockpit_effacement_cibles(bigint[], uuid[], text[], text[])',
    'cockpit_figer_payeur(uuid[], uuid[])',
    'cockpit_oublier_membre(uuid)',
  ]) {
    assert.ok(SQL.includes(`revoke all on function public.${f} from public, anon, authenticated, service_role;`), f)
  }
  assert.match(SQL, /cockpit_effacement_apercu\([\s\S]{0,200}returns jsonb\s+language sql\s+stable\s+security definer/)
  assert.match(SQL, /cockpit_effacer\([\s\S]{0,300}language plpgsql\s+volatile\s+security definer/)
  const effacer = corps('effacer')
  const fige = effacer.indexOf('public.cockpit_figer_payeur(v_mb, v_us)')
  assert.ok(fige > 0 && fige < effacer.indexOf('delete from'), 'le payeur est fige avant toute suppression')
  assert.ok(effacer.indexOf("raise exception 'cockpit_effacer : compte de l equipe") < fige)
  // L'ancien oubli d'un membre fige aussi, et ne detache plus les paiements a la main.
  const oublier = corps('oublier')
  assert.ok(oublier.indexOf('cockpit_figer_payeur') < oublier.indexOf('delete from'))
  assert.ok(!/update public\.cockpit_paiements set membre_id = null/.test(oublier))
  // Les filtres d'oubli : emails, archive (fiches et presences), registre sans nom.
  for (const t of ['cockpit_membre_emails_oublis', 'cockpit_arch_personnes_oublis', 'cockpit_arch_presences_oublis', 'cockpit_telegram_membres_oublis', 'cockpit_membres_figer_payeur', 'cockpit_paiements_payeur']) {
    assert.match(SQL, new RegExp(`create trigger ${t}\\b`), t)
  }
  // Le decoupage d'appliquer-migration.mjs : jamais de ';' ni de '$' dans une chaine hors bloc $...$.
  const horsBlocs = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, '')
  for (const chaine of horsBlocs.match(/'(?:[^']|'')*'/g) ?? []) {
    assert.ok(!chaine.includes(';'), `point-virgule dans ${chaine}`)
    assert.ok(!/\$[A-Za-z_]*\$/.test(chaine), `dollar dans ${chaine}`)
  }
})

console.log(`\n${n} blocs verifies, tout est bon.`)
