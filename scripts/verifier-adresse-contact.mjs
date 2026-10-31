// Tests de l'ADRESSE DE CONTACT d'un acces broker (31/10, cas de Fabien,
// adresse @libertysurf.fr qui refuse nos emails) :
// - la lecture stricte des parametres de la carte et ses refus (illisible,
//   identiques, ni adresse ni retrait) ;
// - les refus avant la carte et au clic (pas d'acces, retire, termine, rien a
//   retirer, deja l'adresse de contact, adresse d'un autre acces) ;
// - le cas « lien personnel servi / pas servi » : ce qui part, la carte longue
//   (Brice), la carte courte (Melanie), le resultat apres le clic ;
// - Agent AOK : outil, consigne, bouton, filet sansNomsOutils (TOUS les outils) ;
// - le webhook Resend : un refus sur l'adresse de contact retrouve l'acces,
//   l'alerte propose ce geste ;
// - le cablage : envois du passage, invitation, transaction, migration.
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-adresse-contact.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import './resoudre-ts.mjs'

const C = await import('../src/lib/liveclub/adresse-contact-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const R = await import('../src/lib/liveclub/rebonds-pur.ts')
const AP = await import('../src/lib/agent-cockpit-pur.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

/** Les caracteres hors clavier, construits par leur code : le fichier n'en contient aucun. */
const classe = (codes) => new RegExp(`[${codes.map(c => String.fromCharCode(c)).join('')}]`)
const HORS_CLAVIER = classe([0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x2022])
const INVISIBLES = classe([0x00a0, 0x202f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])

/** Caracteres clavier simples (textes de l'equipe et cartes). */
function texteClavier(t, nom) {
  assert.ok(!HORS_CLAVIER.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!INVISIBLES.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
  assert.ok(!/\bbann?(i|ir|issement)?\b/i.test(t), `${nom} : ban`)
}

/** Aucun nom d'outil ni de parametre d'Agent AOK dans un texte rendu a l'equipe. */
function sansOutil(t, nom) {
  assert.ok(!/proposer_|email_acces|adresse_contact\b|requete_sql/.test(t), `${nom} : nom d'outil ou de parametre`)
}

// ---------------------------------------------------------------------------
// Fixtures (adresses fictives)
// ---------------------------------------------------------------------------

const BROKER = 'fabien.essai@libertysurf.fr'
const GMAIL = 'fabien.essai@gmail.com'
const ACCES = '11111111-2222-4333-8444-555555555555'

/** L'acces du 31/10 : depot RaiseFx 650 EUR, commission 587 attendue, jusqu'au 30/04/2027, pas encore entre. */
function lecture(o = {}) {
  return {
    accesId: ACCES, email: BROKER, debut: '2026-10-31', jusquau: '2027-04-30', telegramId: null,
    inviteEnvoyee: true, retire: false, sorti: false, fini: false, jetonServi: false, contact: null,
    depots: [{ partenaire: 'RaiseFx', montant: 650, le: '2026-10-31', commission: 587, statut: 'attendue', lotsFaitsLe: null, montantRecu: null, recueLe: null }],
    ...o,
  }
}

const params = (o = {}) => {
  const p = C.lireParamsAdresseContact({ email_acces: BROKER, adresse_contact: GMAIL, ...o })
  assert.equal(typeof p, 'object', `parametres refuses : ${p}`)
  return p
}

const AUCUN = { accesAilleurs: false, contactAilleurs: false }

// ---------------------------------------------------------------------------

await bloc('parametres : lecture stricte, refus clairs', () => {
  const p = C.lireParamsAdresseContact({ email_acces: '  Fabien.Essai@LibertySurf.FR ', adresse_contact: 'Fabien.Essai@Gmail.com', raison: '  sa boîte\nrefuse  nos emails ' })
  assert.deepEqual(p, { email_acces: BROKER, adresse_contact: GMAIL, retirer: false, raison: 'sa boîte refuse nos emails' })
  // Illisibles.
  assert.match(C.lireParamsAdresseContact({ email_acces: 'fabien@', adresse_contact: GMAIL }), /^Adresse de l'accès illisible \(« fabien@ »\) : rien n'a été changé\.$/)
  assert.match(C.lireParamsAdresseContact({ email_acces: BROKER, adresse_contact: 'pas une adresse' }), /^Adresse de contact illisible \(« pas une adresse »\) : rien n'a été changé\.$/)
  assert.match(C.lireParamsAdresseContact({ adresse_contact: GMAIL }), /^email_acces : /)
  // Les deux adresses identiques (casse comprise).
  assert.equal(C.lireParamsAdresseContact({ email_acces: BROKER, adresse_contact: BROKER.toUpperCase() }),
    `${BROKER} est déjà l'adresse de l'accès (celle du broker) : rien à changer.`)
  // Ni adresse ni retrait, ou les deux.
  assert.match(C.lireParamsAdresseContact({ email_acces: BROKER }), /^adresse_contact : /)
  assert.match(C.lireParamsAdresseContact({ email_acces: BROKER, adresse_contact: GMAIL, retirer: true }), /pas les deux/)
  assert.equal(C.lireParamsAdresseContact({ email_acces: BROKER, retirer: 'oui' }), 'retirer : vrai ou faux.')
  // Retrait.
  assert.deepEqual(C.lireParamsAdresseContact({ email_acces: BROKER, retirer: true }), { email_acces: BROKER, adresse_contact: null, retirer: true, raison: null })
  // La raison est bornee.
  assert.equal(params({ raison: 'x'.repeat(500) }).raison.length, C.RAISON_MAX)
  // Les champs du controle : gardes s'ils sont bien formes, ignores sinon.
  const c = params({ acces_id: ACCES, contact_avant: null, invitation: true })
  assert.equal(c.acces_id, ACCES)
  assert.equal(c.contact_avant, null)
  assert.equal(c.invitation, true)
  assert.ok(!('acces_id' in params({ acces_id: 'pas-un-uuid' })))
  assert.ok(!('contact_avant' in params()), 'sans controle : pas de contact_avant (le clic le refuse)')
})

await bloc('refus avant la carte et au clic : rien ne change', () => {
  const p = params()
  assert.match(C.refusAdresseContact(p, null, null), /^Aucun accès broker à l'adresse fabien\.essai@libertysurf\.fr : rien n'a été changé\./)
  assert.match(C.refusAdresseContact(p, null, null), /Un nouvel accès ne sert qu'à une nouvelle personne\./)
  assert.match(C.refusAdresseContact(p, lecture({ retire: true }), AUCUN), /a été retiré : rien n'a été changé\./)
  assert.match(C.refusAdresseContact(p, lecture({ fini: true }), AUCUN), /est terminé \(30 avril 2027\) : plus aucun email du Live Club ne lui part, rien n'a été changé\./)
  assert.match(C.refusAdresseContact(p, lecture({ sorti: true }), AUCUN), /est terminé/)
  assert.equal(C.refusAdresseContact(params({ adresse_contact: undefined, retirer: true }), lecture(), null),
    `L'accès de ${BROKER} n'a pas d'adresse de contact : rien à retirer.`)
  assert.equal(C.refusAdresseContact(params({ adresse_contact: undefined, retirer: true }), lecture({ contact: GMAIL }), null), null)
  // La nouvelle adresse a deja eu un acces broker (non renouvelable) : refus.
  assert.match(C.refusAdresseContact(p, lecture(), { accesAilleurs: true, contactAilleurs: false }),
    /a son propre accès broker \(une adresse = un accès, non renouvelable\) : elle ne peut pas servir d'adresse de contact à un autre accès\. Rien n'a été changé\./)
  assert.match(C.refusAdresseContact(p, lecture(), { accesAilleurs: false, contactAilleurs: true }), /déjà l'adresse de contact d'un autre accès broker : rien n'a été changé\./)
  // Deja l'adresse de contact, invitation partie : rien a changer.
  assert.equal(C.refusAdresseContact(p, lecture({ contact: GMAIL, inviteEnvoyee: true }), AUCUN),
    `${GMAIL} est déjà l'adresse de contact de l'accès de ${BROKER} : rien à changer.`)
  // ... invitation pas partie, lien pas servi : la carte la renvoie.
  assert.equal(C.refusAdresseContact(p, lecture({ contact: GMAIL, inviteEnvoyee: false }), AUCUN), null)
  assert.equal(C.renvoiSeul(p, lecture({ contact: GMAIL, inviteEnvoyee: false })), true)
  assert.equal(C.renvoiSeul(p, lecture({ contact: GMAIL, inviteEnvoyee: false, telegramId: 42 })), false)
  // Le cas de Fabien : aucun refus.
  assert.equal(C.refusAdresseContact(p, lecture(), AUCUN), null)
  for (const t of [C.refusAdresseContact(p, null, null), C.refusAdresseContact(p, lecture(), { accesAilleurs: true, contactAilleurs: false })]) texteClavier(t, 'refus')
  // La table absente : un message clair, rien n'est ecrit.
  assert.match(C.TEXTE_TABLE_ABSENTE, /migration 20261031210000 à appliquer\) : rien n'a été changé\. Les emails partent à l'adresse de l'accès, comme avant\./)
  assert.equal(C.tableContactsAbsente(new Error('relation "public.cockpit_liveclub_acces_contacts" does not exist')), true)
  assert.equal(C.tableContactsAbsente(new Error('Code: `42P01`. relation "public.cockpit_liveclub_acces_contacts" does not exist')), true)
  assert.equal(C.tableContactsAbsente(new Error('relation "public.cockpit_commissions" does not exist')), false, 'une autre table')
  assert.equal(C.tableContactsAbsente(new Error('timeout')), false)
})

await bloc('lien personnel pas servi : une nouvelle invitation part a l adresse de contact', () => {
  const l = lecture()
  const p = { ...params(), acces_id: ACCES, contact_avant: null, invitation: C.invitationAEnvoyer(params(), l) }
  assert.equal(p.invitation, true)
  const carte = C.carteAdresseContact(p, l)
  const lignes = carte.split('\n')
  assert.equal(lignes[0], `Écrire à ${GMAIL} pour l'accès broker de ${BROKER}. Tous les emails du Live Club à ce membre partiront là : invitation, relances des lots, fin d'accès, pause ou fermeture.`)
  assert.equal(lignes[1], `L'adresse du broker reste ${BROKER} : c'est elle qui compte pour la commission et les vérifications chez le broker.`)
  assert.equal(lignes[2], 'Accès du 31 octobre 2026 au 30 avril 2027, pas encore entré.')
  assert.equal(lignes[3], 'Dépôt RaiseFx de 650 € le 31 octobre 2026 : commission de 587 € attendue.')
  assert.equal(lignes[4], `Ce qui part : son lien personnel n'a pas encore servi, une nouvelle invitation part à ${GMAIL} (le même lien, pour le même accès).`)
  assert.equal(lignes[5], "Rien d'autre ne bouge : l'accès, ses dates, la commission, les lots, son lien personnel et son compte Telegram.")
  assert.equal(lignes.length, 6)
  assert.equal(C.carteCourteAdresseContact(p),
    `Écrire à ${GMAIL} pour l'accès de ${BROKER} (l'adresse du broker ne change pas). Nouvelle invitation à ${GMAIL}.`)
  // Resultat apres le clic.
  const ok = C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: null, retirer: false, renvoi: false, invitation: 'partie', jusquau: l.jusquau })
  assert.match(ok, /^Adresse de contact notée pour l'accès broker de fabien\.essai@libertysurf\.fr : fabien\.essai@gmail\.com\. L'adresse du broker reste fabien\.essai@libertysurf\.fr : commission et vérifications chez le broker inchangées\./)
  assert.match(ok, /\nInvitation envoyée à fabien\.essai@gmail\.com, avec son lien personnel \(le même\), valable jusqu'au 30 avril 2027\.\nÀ faire : rien, il entre en ouvrant le lien de l'email\.$/)
  const rate = C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: null, retirer: false, renvoi: false, invitation: 'pas_partie', erreur: 'Acces accorde, email pas parti : 429', jusquau: l.jusquau })
  assert.match(rate, /ATTENTION : l'invitation n'est PAS partie \(Acces accorde, email pas parti : 429\)\.\nÀ faire : redemande la même carte pour la renvoyer\.$/)
  // ... et la meme carte la renvoie (adresse inchangee, invitation pas partie).
  const lr = lecture({ contact: GMAIL, inviteEnvoyee: false })
  const pr = { ...params(), acces_id: ACCES, contact_avant: GMAIL, invitation: true }
  assert.match(C.carteAdresseContact(pr, lr), /^Renvoyer l'invitation de l'accès broker de fabien\.essai@libertysurf\.fr à fabien\.essai@gmail\.com : elle n'est pas partie\./)
  assert.match(C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: GMAIL, retirer: false, renvoi: true, invitation: 'partie', jusquau: l.jusquau }),
    /^Adresse de contact de l'accès broker de fabien\.essai@libertysurf\.fr : fabien\.essai@gmail\.com, inchangée\./)
  for (const t of [carte, C.carteCourteAdresseContact(p), ok, rate]) { texteClavier(t, 'pas servi'); sansOutil(t, 'pas servi') }
})

await bloc('lien personnel deja servi : rien ne part, il garde son compte Telegram', () => {
  for (const l of [lecture({ telegramId: 777 }), lecture({ jetonServi: true })]) {
    const p = { ...params(), acces_id: ACCES, contact_avant: null, invitation: C.invitationAEnvoyer(params(), l) }
    assert.equal(p.invitation, false)
    const carte = C.carteAdresseContact(p, l)
    assert.match(carte, /\nAccès du 31 octobre 2026 au 30 avril 2027, déjà entré \(compte Telegram relié\)\.\n/)
    assert.match(carte, /\nCe qui part : rien\. Son lien personnel a déjà servi, il garde son compte Telegram ; les prochains emails iront à fabien\.essai@gmail\.com\.\n/)
    assert.match(carte, /L'adresse du broker reste fabien\.essai@libertysurf\.fr : c'est elle qui compte pour la commission et les vérifications chez le broker\./)
    assert.equal(C.carteCourteAdresseContact(p), `Écrire à ${GMAIL} pour l'accès de ${BROKER} (l'adresse du broker ne change pas). Rien ne part (déjà entré).`)
    const r = C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: null, retirer: false, renvoi: false, invitation: 'sans', jusquau: l.jusquau })
    assert.match(r, /\nRien n'est parti : son lien a déjà servi, il garde son compte Telegram\. Les prochains emails du Live Club iront à fabien\.essai@gmail\.com\.\nRien à faire\.$/)
    for (const t of [carte, r]) { texteClavier(t, 'servi'); sansOutil(t, 'servi') }
  }
  // Un acces termine n'envoie rien (et la carte est refusee avant).
  assert.equal(C.invitationAEnvoyer(params(), lecture({ fini: true })), false)
})

await bloc('changer et retirer : meme carte, ancienne adresse dite, rien ne part au retrait', () => {
  const l = lecture({ contact: 'ancienne@gmail.com', telegramId: 777 })
  const p = { ...params(), acces_id: ACCES, contact_avant: 'ancienne@gmail.com', invitation: false }
  assert.match(C.carteAdresseContact(p, l), /^Écrire à fabien\.essai@gmail\.com pour l'accès broker de fabien\.essai@libertysurf\.fr \(à la place de ancienne@gmail\.com\)\./)
  assert.match(C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: 'ancienne@gmail.com', retirer: false, renvoi: false, invitation: 'sans', jusquau: l.jusquau }),
    /: fabien\.essai@gmail\.com \(avant : ancienne@gmail\.com\)\./)
  const pr = { ...params({ adresse_contact: undefined, retirer: true }), acces_id: ACCES, contact_avant: 'ancienne@gmail.com', invitation: false }
  assert.equal(C.invitationAEnvoyer(pr, lecture({ contact: 'ancienne@gmail.com' })), false, 'un retrait n envoie rien')
  const carte = C.carteAdresseContact(pr, l)
  assert.match(carte, /^Retirer l'adresse de contact ancienne@gmail\.com de l'accès broker de fabien\.essai@libertysurf\.fr : les emails du Live Club repartent à fabien\.essai@libertysurf\.fr\.\n/)
  assert.match(carte, /\nCe qui part : rien\.\n/)
  assert.equal(C.carteCourteAdresseContact(pr), `Retirer l'adresse de contact de ${BROKER} : les emails repartent à ${BROKER}.`)
  assert.equal(C.resultatAdresseContact({ emailAcces: BROKER, contact: null, avant: 'ancienne@gmail.com', retirer: true, renvoi: false, invitation: 'sans', jusquau: l.jusquau }),
    `Adresse de contact retirée de l'accès broker de ${BROKER} (c'était ancienne@gmail.com) : les emails du Live Club repartent à ${BROKER}.\nRien à faire.`)
  // Depots : recu, perdu, lots faits, aucun.
  assert.deepEqual(C.lignesDepots([]), ['Aucun dépôt inscrit sur cet accès.'])
  const [recu, perdu, lots] = C.lignesDepots([
    { partenaire: 'Pulse', montant: 1000, le: '2026-10-01', commission: 400, statut: 'recue', lotsFaitsLe: '2026-10-10', montantRecu: 400, recueLe: '2026-10-30' },
    { partenaire: 'RaiseFx', montant: 500, le: '2026-10-02', commission: 400, statut: 'perdue', lotsFaitsLe: null, montantRecu: null, recueLe: null },
    { partenaire: 'RaiseFx', montant: 650, le: '2026-10-31', commission: 587, statut: 'attendue', lotsFaitsLe: '2026-11-05', montantRecu: null, recueLe: null },
  ])
  assert.equal(recu, 'Dépôt Pulse de 1 000 € le 1er octobre 2026 : commission de 400 € reçue (400 € le 30 octobre 2026).')
  assert.equal(perdu, 'Dépôt RaiseFx de 500 € le 2 octobre 2026 : commission de 400 € perdue.')
  assert.equal(lots, 'Dépôt RaiseFx de 650 € le 31 octobre 2026 : commission de 587 € attendue, lots faits le 5 novembre 2026.')
  // La raison, en dernier.
  assert.match(C.carteAdresseContact({ ...p, raison: 'sa boîte refuse nos emails' }, l), /\nRaison : sa boîte refuse nos emails$/)
  // Le log : jamais une adresse.
  const log = JSON.stringify(C.paramsPourLogContact(p))
  assert.ok(!/@/.test(log), log)
})

await bloc('adresse d envoi : son choix dans Mon espace, puis le contact, puis l identite (jamais l inverse)', () => {
  const CHOIX = 'fabien.pro@outlook.fr'
  assert.deepEqual(C.choisirAdresseEnvoi({ communications: CHOIX, contact: GMAIL, identite: BROKER }), { email: CHOIX, source: 'communications' })
  assert.deepEqual(C.choisirAdresseEnvoi({ communications: null, contact: GMAIL, identite: BROKER }), { email: GMAIL, source: 'contact' })
  assert.deepEqual(C.choisirAdresseEnvoi({ communications: null, contact: null, identite: BROKER }), { email: BROKER, source: 'identite' })
  assert.equal(C.choisirAdresseEnvoi({ communications: null, contact: null, identite: null }), null)
  // Migration 20261031211000 absente : reconnue (etape sautee), une autre panne aussi sautee mais dite autrement.
  assert.equal(C.communicationsAbsentes(new Error('Code: `42883`. Message: `ERROR: function public.aok_email_communications(uuid) does not exist`')), true)
  assert.equal(C.communicationsAbsentes(new Error('ERROR: column pe.communications does not exist')), true)
  assert.equal(C.communicationsAbsentes(new Error('timeout')), false)
  assert.equal(C.MIGRATION_COMMUNICATIONS, '20261031211000')
  // Destination apres le clic : son choix l'emporte sur la nouvelle adresse de contact ; un retrait revient a l'acces.
  assert.equal(C.destinationApres(params(), { email: BROKER, communications: CHOIX }), CHOIX)
  assert.equal(C.destinationApres(params(), { email: BROKER, communications: null }), GMAIL)
  assert.equal(C.destinationApres(params({ adresse_contact: undefined, retirer: true }), { email: BROKER, communications: null }), BROKER)
  // La carte le dit : l'adresse de contact est notee, mais son choix passe en premier.
  const l = lecture({ communications: CHOIX })
  const p = { ...params(), acces_id: ACCES, contact_avant: null, invitation: true, envoi_vers: C.destinationApres(params(), l) }
  const carte = C.carteAdresseContact(p, l)
  assert.match(carte, /^Écrire à fabien\.essai@gmail\.com pour l'accès broker de fabien\.essai@libertysurf\.fr\. Il a choisi fabien\.pro@outlook\.fr dans Mon espace : son choix passe en premier, nos emails partent là tant qu'il le garde\.\n/)
  assert.match(carte, /\nCe qui part : son lien personnel n'a pas encore servi, une nouvelle invitation part à fabien\.pro@outlook\.fr /)
  assert.match(carte, /L'adresse du broker reste fabien\.essai@libertysurf\.fr : c'est elle qui compte pour la commission et les vérifications chez le broker\./)
  assert.equal(C.carteCourteAdresseContact(p),
    `Écrire à ${GMAIL} pour l'accès de ${BROKER} (l'adresse du broker ne change pas). Il a choisi ${CHOIX} dans Mon espace : son choix passe en premier. Nouvelle invitation à ${CHOIX}.`)
  const r = C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: null, retirer: false, renvoi: false, invitation: 'partie', jusquau: l.jusquau, destination: CHOIX })
  assert.match(r, /Il a choisi fabien\.pro@outlook\.fr dans Mon espace : son choix passe en premier\.\nInvitation envoyée à fabien\.pro@outlook\.fr,/)
  // Le parametre de la carte est relu proprement (et ignore s'il est illisible).
  assert.equal(params({ envoi_vers: 'Fabien.Pro@Outlook.fr' }).envoi_vers, CHOIX)
  assert.ok(!('envoi_vers' in params({ envoi_vers: 'n importe quoi' })))
  for (const t of [carte, C.carteCourteAdresseContact(p), r]) { texteClavier(t, 'choix du membre'); sansOutil(t, 'choix du membre') }
})

await bloc('fil Support : une ligne sans adresse', () => {
  const pose = P.phraseGeste({ geste: 'acces_broker', resultat: 'fait', regle: 'adresse_contact', details: { quoi: 'pose' } })
  assert.equal(pose, "Adresse de contact de son accès broker notée par l'équipe : les emails du Live Club lui partent là (l'adresse du broker ne change pas).")
  assert.match(P.phraseGeste({ geste: 'acces_broker', resultat: 'fait', regle: 'adresse_contact', details: { quoi: 'retrait' } }), /retirée par l'équipe : les emails du Live Club repartent à l'adresse du broker\./)
  assert.equal(P.phraseGeste({ geste: 'acces_broker', resultat: 'refuse', regle: 'adresse_contact', details: {} }), null)
  // Les autres lignes de l'acces broker ne changent pas.
  assert.match(P.phraseGeste({ geste: 'acces_broker', resultat: 'fait', regle: 'broker', details: { jusquau: '2027-04-30' } }), /^Accès broker ouvert jusqu'au 30 avril 2027\.$/)
  assert.equal(C.REGLE_JOURNAL_CONTACT, 'adresse_contact')
})

await bloc('Agent AOK : outil, consigne, bouton, controle, carte courte, filet sansNomsOutils (tous les outils)', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  assert.ok(src.includes("name: 'proposer_adresse_contact_acces'"), "l'outil est dans OUTILS")
  const outil = src.slice(src.indexOf("name: 'proposer_adresse_contact_acces'"))
  assert.match(outil.slice(0, 3000), /required: \['email_acces'\]/)
  assert.match(outil.slice(0, 3000), /retirer: \{ type: 'boolean'/)
  assert.match(src, /^\s+proposer_adresse_contact_acces: 'adresse_contact',$/m)
  // La consigne : « son autre adresse est Y », « ecris-lui plutot a Y », jamais un nouvel acces.
  assert.match(src, /L'ADRESSE DE CONTACT D'UN ACCÈS BROKER \(règle de Brice, 31\/10\)/)
  assert.match(src, /« son autre adresse est Y », « écris-lui plutôt à Y », « change l'adresse de l'accès de X en Y »/)
  assert.match(src, /JAMAIS un nouvel accès \(proposer_acces_broker, proposer_depot_broker\) ni un nouvel email collé pour quelqu'un qui a déjà un accès : un nouvel accès ne sert qu'à une NOUVELLE personne\./)
  assert.match(src, /- cockpit_liveclub_acces_contacts \(31\/10\) : contact_id, acces_id, email/)
  // Le controle avant la carte, la carte du serveur, la version courte de Melanie.
  assert.match(src, /\} else if \(action\.type === 'adresse_contact'\) \{\n(.*\n){1,6}\s+controle = await controlerAdresseContact\(action\)/)
  assert.match(src, /carteCourte = controle\.court/)
  assert.match(src, /\.\.\.\(carteCourte && estMelanie\(qui\) \? \{ resume: carteCourte \} : \{\}\),/)
  assert.ok(src.indexOf("action.type === 'adresse_contact'") < src.indexOf("} else if (action.compte === 'cockpit') {"), 'avant le controle de la repartition (meme compte cockpit)')
  // Le bouton dit l'action.
  assert.ok(AP.libelleBoutonConfirmer('adresse_contact').endsWith(" Changer l'adresse de contact"))
  assert.equal(AP.libelleBoutonConfirmer('adresse_contact').length, AP.libelleBoutonConfirmer('acces_broker').length - "Ouvrir l'accès broker".length + "Changer l'adresse de contact".length)
  // Le filet : TOUS les outils d'OUTILS ont leur description, et le nouveau est remplace.
  const noms = [...src.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1])
  assert.ok(noms.length >= 30, `${noms.length} outils lus`)
  for (const nom of noms) assert.ok(AP.DESCRIPTIONS_OUTILS[nom], `outil sans description : ${nom}`)
  assert.ok(noms.includes('proposer_adresse_contact_acces'))
  for (const nom of Object.keys(AP.DESCRIPTIONS_OUTILS)) {
    if (nom === 'generer_post') continue
    assert.ok(noms.includes(nom), `description d'un outil absent : ${nom}`)
  }
  assert.equal(AP.sansNomsOutils('Je te propose proposer_adresse_contact_acces pour Fabien.'), "Je te propose la carte d'adresse de contact pour Fabien.")
  assert.equal(AP.sansNomsOutils('Voici la carte `proposer_adresse_contact_acces`.'), "Voici la carte d'adresse de contact.")
  // Le prompt compte ses outils d'action.
  const phrase = /Tu disposes de dix-huit outils d'action : ([^(]+) \(décrits plus bas\)/.exec(src)
  assert.ok(phrase)
  assert.equal(phrase[1].split(/, | et /).length, 18)
  assert.ok(phrase[1].includes('proposer_adresse_contact_acces'))

  // Validation, resume, execution, log.
  const stripe = lire('src/lib/stripe-actions.ts')
  assert.match(stripe, /\| 'adresse_contact'/)
  assert.match(stripe, /if \(a\.type === 'adresse_contact'\) \{\n\s+const lu = lireParamsAdresseContact\(p\)\n\s+if \(typeof lu === 'string'\) return lu\n\s+return \{ type: 'adresse_contact', compte: 'cockpit', params: \{ \.\.\.lu \} \}/)
  assert.match(stripe, /if \(a\.type === 'adresse_contact'\) return paramsPourLogContact\(a\.params\)/)
  assert.match(stripe, /if \(a\.type === 'adresse_contact'\) return resumeAdresseContact\(p\)/)
  assert.match(stripe, /const \{ executerAdresseContact \} = await import\('@\/lib\/liveclub\/adresse-contact'\)\n\s+return executerAdresseContact\(a, acteur\)/)
  const exec = stripe.slice(stripe.indexOf('export async function executerAction'))
  assert.ok(exec.indexOf("a.type === 'adresse_contact'") < exec.indexOf("a.type === 'retirer_telegram'"), 'execution avant les branches Stripe et Telegram')
})

await bloc('webhook Resend : un refus sur l adresse de contact retrouve l acces, l alerte propose le geste', async () => {
  // quoi : l'adresse de contact de l'acces.
  assert.equal(R.quoiAdresse({ acces: { telegramId: null, parContact: true, emailAcces: BROKER }, clientStripe: null, telegramIds: [] }),
    `adresse de contact de l'accès broker de ${BROKER}, pas encore entré dans le groupe`)
  assert.equal(R.quoiAdresse({ acces: { telegramId: 42 }, clientStripe: null, telegramIds: [42] }), 'accès broker', 'inchange')
  // L'alerte d'un acces broker propose l'adresse de contact, sans nom d'outil ; pas pour un abonne.
  const base = { email: BROKER, qui: null, quoi: 'accès broker', invitation: null, lien: null, accesBroker: true, membre: 'sans_compte', securite: null }
  const ev = { genre: 'rebond', nature: 'contenu', sujet: R.SUJET_INVITATION_BROKER, envoyeLe: null, type: 'Transient', sousType: 'ContentRejected', motif: '550 spam detected' }
  const avecLien = R.texteAlerteRebond({ ...base, evenement: ev, lien: 'https://t.me/bot?start=xxxxxxxxxxxxxxxxxxxxxxxx' })
  assert.match(avecLien, /À faire : donne-lui toi-même son lien personnel \(ci-dessous\), il le fait entrer tout seul ; ou demande-lui une autre adresse\. S'il donne une autre adresse, dis-moi « écris-lui plutôt à » et cette adresse : elle devient son adresse de contact, l'accès et la commission restent sur l'adresse du broker\./)
  assert.ok(avecLien.split('\n').length <= 6, 'alerte courte (Melanie)')
  for (const nature of ['contenu', 'definitif', 'passager', 'bloque', 'plainte']) {
    const t = R.texteAlerteRebond({ ...base, evenement: { ...ev, nature, genre: nature === 'plainte' ? 'plainte' : 'rebond' } })
    assert.ok(t.includes(R.SUITE_AUTRE_ADRESSE_ACCES), `acces broker ${nature}`)
    texteClavier(t, `alerte ${nature}`)
    sansOutil(t, `alerte ${nature}`)
  }
  assert.ok(!R.texteAlerteRebond({ ...base, accesBroker: false, evenement: ev }).includes(R.SUITE_AUTRE_ADRESSE_ACCES), 'pas pour un abonne')

  // Le deroule, sur une fausse base : l'invitation partie a l'adresse de contact est refusee.
  const vu = { reservations: [], alertes: [], remises: [] }
  const outils = {
    retrouverPersonne: async () => ({ telegramIds: [], membreId: null, nom: null, acces: { accesId: ACCES, telegramId: null, actif: true, parContact: true, emailAcces: BROKER }, clientStripe: null }),
    reserver: async (r) => { vu.reservations.push(r); return { id: '1', alerte: true, message: false } },
    remettreInvitation: async (id) => { vu.remises.push(id); return true },
    lienPersonnel: async () => null,
    equipeALaMain: async () => false,
    envoyerPrive: async () => true,
    analyserMotif: (m) => ({ texte: m, securite: null }),
    alerterEquipe: async (texte) => { vu.alertes.push(texte); return 2 },
    clore: async () => {},
    maintenant: () => new Date('2026-11-02T09:00:00Z'),
  }
  const b = await R.traiterRebond({ ...ev, nature: 'definitif', type: 'Permanent', sousType: 'General', email: GMAIL, emailId: 'e1' }, 'msg_contact', outils)
  assert.equal(b.etat, 'traite')
  assert.equal(b.invitation, 'remise', "l'invitation de l'acces repasse « pas envoyee »")
  assert.deepEqual(vu.remises, [ACCES])
  assert.equal(vu.reservations[0].details.acces_id, ACCES)
  assert.equal(vu.reservations[0].details.par_contact, true)
  assert.ok(!JSON.stringify(vu.reservations[0].details).includes('@'), 'jamais une adresse au journal')
  assert.match(vu.alertes[0], new RegExp(`à ${GMAIL.replace(/\./g, '\\.')} \\(adresse de contact de l'accès broker de ${BROKER.replace(/\./g, '\\.')}, pas encore entré dans le groupe\\)\\.`))
  assert.ok(vu.alertes[0].includes(R.SUITE_AUTRE_ADRESSE_ACCES))

  // Le serveur cherche aussi par l'adresse de contact, puis par les autres adresses de son compte AOK
  // (son choix dans Mon espace), sans rien loguer de l'adresse.
  const s = lire('src/lib/liveclub/rebonds.ts')
  assert.match(s, /if \(!acces\) \{\n\s+const c = await accesParAdresseContact\(email\)/)
  assert.match(s, /acces = \{ accesId: c\.accesId, telegramId: c\.telegramId, actif: c\.actif, parContact: true, emailAcces: c\.emailAcces \}/)
  assert.match(s, /const autres = acces \? \[\] : await autresAdressesDuCompte\(email\)/)
  assert.match(s, /where lower\(email\) = any\(\$\{autres\}::text\[\]\) and motif = 'broker'/)
  assert.match(s, /actif: l\[0\]\.actif === true, parCompte: true, emailAcces: l\[0\]\.email_acces,/)
  assert.match(s, /and \(lower\(email\) = \$\{email\} or lower\(email\) = any\(\$\{autres\}::text\[\]\)/)
  assert.equal(R.quoiAdresse({ acces: { telegramId: 42, parCompte: true, emailAcces: BROKER }, clientStripe: null, telegramIds: [42] }),
    `adresse de son compte AOK, accès broker de ${BROKER}`)
  const envoiSrc = lire('src/lib/liveclub/adresse-envoi.ts')
  const autres = envoiSrc.slice(envoiSrc.indexOf('export async function autresAdressesDuCompte('))
  assert.match(autres, /limit 2/)
  assert.match(autres, /if \(l\.length !== 1\) return \[\]/)
})

await bloc('cablage : envois du passage, invitation, transaction, lectures sans table, migration', () => {
  // UNE seule fonction choisit ou part un email : prevenir (tous les messages du passage) la prend.
  const pa = lire('src/lib/liveclub/passage.ts')
  const prev = pa.slice(pa.indexOf('async function prevenir('), pa.indexOf('async function sortir('))
  assert.match(prev, /accesId: string \| null = null,/)
  assert.match(prev, /const adresse = email \|\| accesId \? await adresseEnvoi\(\{ emailIdentite: email, accesId \}\) : null\n\s+if \(adresse\) \{\n\s+const r = await parEmail\(adresse\)/)
  // Les envois d'un acces broker passent l'adresse d'IDENTITE et l'acces (son adresse de contact).
  const envois = [
    /prevenir\(ctx, tid \? \[tid\] : \[\], l\.email, modeleRappelFinBroker\(jusquau\),\n\s+e => emailRappelFinBroker\(e, jusquau\), l\.acces_id\)/,
    /prevenir\(ctx, \[telegramId\], email, modeleFinBroker\(\), e => emailFinBroker\(e\), accesId\)/,
    /prevenir\(ctx, \[tid\], l\.email, modeleRelanceLots\(n, limite\), e => emailRelanceLots\(e, n, limite\), l\.accesId\)/,
    /prevenir\(ctx, \[tid\], l\.email, modeleSuspensionLots\(\), e => emailSuspensionLots\(e\), l\.accesId\)/,
    /prevenir\(ctx, tid !== null \? \[tid\] : \[\], l\.email, modeleFermetureDepot\(\), e => emailFermetureDepot\(e\), l\.accesId\)/,
  ]
  for (const e of envois) assert.match(pa, e)
  // Les envois hors de prevenir : a l'adresse d'envoi aussi (reouverture, bienvenue rattrapee).
  // (emailClient lit l'email d'un client Stripe : ce n'est pas un envoi.)
  const directs = pa.split('\n').filter(l => /await email(?!Client\b)[A-Z]\w*\(/.test(l))
  assert.equal(directs.length, 2, directs.join('\n'))
  for (const l of directs) assert.match(l, /await email(Reouverture|Bienvenue)\(await adresseEnvoi\(\{ emailIdentite: email \}\) \?\? email, /)
  assert.match(lire('src/app/api/liveclub/bienvenue/route.ts'), /await emailBienvenue\(await adresseEnvoi\(\{ emailIdentite: session\.email \}\) \?\? session\.email, lien\)/)
  // Qui envoie les emails du Live Club : passage, acces, bienvenue (et le code de verification, a SON adresse).
  const fichiers = []
  const parcourir = (dossier) => {
    for (const nom of readdirSync(new URL(`../${dossier}`, import.meta.url))) {
      const chemin = `${dossier}/${nom}`
      if (statSync(new URL(`../${chemin}`, import.meta.url)).isDirectory()) parcourir(chemin)
      else if (/\.tsx?$/.test(nom)) fichiers.push(chemin)
    }
  }
  parcourir('src')
  const expediteurs = fichiers.filter(f => /import \{[^}]*\bemail[A-Z]\w*[^}]*\} from '(\.\/emails|@\/lib\/liveclub\/emails)'/.test(lire(f)))
  assert.deepEqual(expediteurs.sort(), ['src/app/api/liveclub/bienvenue/route.ts', 'src/lib/liveclub/acces.ts', 'src/lib/liveclub/passage.ts'])
  // L'identite reste l'adresse de l'acces (droit, abonnements).
  assert.match(pa, /abonnementsLiveClubParEmail\(l\.email\)/)

  // L'invitation : le jeton garde l'adresse de l'acces, l'email part a l'adresse d'envoi.
  const ac = lire('src/lib/liveclub/acces.ts')
  assert.match(ac, /export async function envoyerInvitation\(\n\s+accesId: string, email: string, jusquau: string, mois\?: number,\n\)/)
  assert.match(ac, /creerJeton\(\{ usage: 'entree', accesId, email \}/)
  assert.match(ac, /const destination = \(await adresseEnvoi\(\{ emailIdentite: email, accesId \}\)\) \?\? email\n\s+const envoi = await emailAccesBroker\(destination, lienBot\(jeton\), jusquau, mois\)/)
  assert.match(ac, /const envoi = await envoyerInvitation\(deja\[0\]\.acces_id, email, jusquau\)/)

  // L'adresse d'envoi : son choix (un seul compte, adresse verifiee), puis le contact, puis l'identite ;
  // fonction ou colonne absente = etape suivante, un avertissement par instance ; jamais l'adresse dans un log.
  const ev = lire('src/lib/liveclub/adresse-envoi.ts')
  assert.match(ev, /where lower\(btrim\(u\.email\)\) = \$\{email\} and u\.email_confirmed_at is not null/)
  assert.match(ev, /where lower\(btrim\(pe\.email\)\) = \$\{email\} and pe\.verified = true/)
  assert.match(ev, /if \(l\.length !== 1 \|\| l\[0\]\.coche !== true\) return null/)
  assert.match(ev, /public\.aok_email_communications\(c\.id\) as email/)
  assert.match(ev, /pe\.profile_id = c\.id and pe\.communications and pe\.verified/)
  assert.match(ev, /if \(communicationsAbsentes\(err\)\) \{\n\s+avertirUneFois\('communications_absentes'/)
  assert.match(ev, /const contact = !communications && o\.accesId \? await adresseContactAcces\(o\.accesId\) : null/)
  const le = lire('src/lib/liveclub/adresse-contact-lecture.ts')
  assert.match(le, /table \$\{TABLE_CONTACTS\} absente \(migration \$\{MIGRATION_CONTACTS\} pas appliquee\)/)
  assert.match(le, /if \(avertis\.has\(cle\)\) return/)
  for (const fichier of ['src/lib/liveclub/adresse-contact-lecture.ts', 'src/lib/liveclub/adresse-contact.ts', 'src/lib/liveclub/adresse-envoi.ts']) {
    for (const ligne of lire(fichier).split('\n').filter(l => /console\.(log|warn|error)/.test(l))) {
      assert.ok(!/email\}|contact\}|adresse_contact|emailAcces|destination\}/.test(ligne), `log suspect (${fichier}) : ${ligne.trim()}`)
    }
  }

  // L'execution : une transaction, l'acces verrouille, la nouvelle adresse verrouillee, les refus refaits,
  // l'ancienne retiree et la nouvelle posee, l'invitation remise si le lien n'a pas servi, le journal dedans.
  const ex = lire('src/lib/liveclub/adresse-contact.ts')
  const tx = ex.slice(ex.indexOf('await prisma.$transaction('), ex.indexOf('} catch (err) {\n    if (err instanceof RefusAction) throw err'))
  assert.match(tx, /where lower\(email\) = \$\{p\.email_acces\} and motif = 'broker'\n\s+for update/)
  assert.match(tx, /pg_advisory_xact_lock\(hashtextextended\(\$\{`liveclub:contact:\$\{p\.adresse_contact\}`\}::text, 0\)\)/)
  assert.match(tx, /const refus = refusAdresseContact\(p, \{ \.\.\.lecture, depots: \[\] \}, ailleurs\)\n\s+if \(refus\) throw new RefusAction\(refus\)/)
  assert.match(tx, /if \(\(p\.contact_avant \?\? null\) !== contact\)/)
  assert.match(tx, /update public\.cockpit_liveclub_acces_contacts set retire_le = now\(\), retire_par = \$\{acteur\}/)
  assert.match(tx, /insert into public\.cockpit_liveclub_acces_contacts \(acces_id, email, raison, pose_par\)/)
  assert.match(tx, /update public\.cockpit_liveclub_acces a set invite_envoyee_le = null\n\s+where a\.acces_id = \$\{acces\.accesId\}::uuid and a\.telegram_id is null/)
  assert.match(tx, /j\.acces_id = a\.acces_id and j\.utilise_le is not null/)
  assert.match(tx, /insert into public\.cockpit_liveclub_gestes \(telegram_id, geste, resultat, acteur, regle, details\)\n\s+values \(\$\{acces\.telegramId\}::bigint, 'acces_broker', 'fait', \$\{acteur\}, \$\{REGLE_JOURNAL_CONTACT\}/)
  // Rien n'ecrit sur l'adresse de l'acces, ses dates, la commission, le jeton ou le compte Telegram.
  assert.ok(!/update public\.cockpit_liveclub_acces set email|set email =|update public\.cockpit_commissions|update public\.cockpit_liveclub_jetons|set telegram_id|set jusquau|set debut/.test(ex))
  // Apres la transaction : l'invitation a l'adresse de contact, meme jeton.
  assert.match(ex, /const envoi = await envoyerInvitation\(lecture\.accesId, lecture\.email, lecture\.jusquau\)/)
  assert.match(ex, /communications: await adresseCommunicationsCompte\(acces\.email\),/)
  // Jamais de ban, d'ecriture Stripe ni d'appel Telegram ici.
  assert.ok(!/banChatMember|kickChatMember|stripePost|stripeDelete|telegramPost/.test(ex))

  // La migration : ecrite, pas appliquee ici ; table, une adresse en cours par acces, une adresse par acces, RLS.
  const m = lire('../../sites/Aoknowledgecom/supabase/migrations/20261031210000_cockpit_liveclub_acces_contacts.sql')
  assert.match(m, /create table if not exists public\.cockpit_liveclub_acces_contacts \(/)
  assert.match(m, /references public\.cockpit_liveclub_acces \(acces_id\) on delete cascade/)
  assert.match(m, /on public\.cockpit_liveclub_acces_contacts \(acces_id\) where retire_le is null/)
  assert.match(m, /on public\.cockpit_liveclub_acces_contacts \(email\) where retire_le is null/)
  assert.match(m, /force row level security/)
  assert.match(m, /using \(public\.is_cockpit_member\(\)\)/)
  // appliquer-migration.sh decoupe sur les points-virgules : aucun dans les commentaires ni les chaines.
  for (const ligne of m.split('\n')) {
    if (/^\s*--/.test(ligne)) assert.ok(!ligne.includes(';'), `point-virgule en commentaire : ${ligne}`)
    for (const chaine of ligne.match(/'[^']*'/g) ?? []) assert.ok(!chaine.includes(';'), `point-virgule dans une chaine : ${chaine}`)
  }
})

await bloc('caracteres clavier dans les modules', () => {
  for (const f of ['src/lib/liveclub/adresse-contact-pur.ts', 'src/lib/liveclub/adresse-contact.ts', 'src/lib/liveclub/adresse-contact-lecture.ts', 'scripts/verifier-adresse-contact.mjs']) {
    const t = lire(f)
    assert.ok(!HORS_CLAVIER.test(t) && !INVISIBLES.test(t), `${f} : caractere hors clavier`)
  }
})

// Les textes, pour relecture (adresses fictives).
{
  const l = lecture()
  const p = { ...params({ raison: 'sa boîte refuse nos emails (550 spam detected)' }), acces_id: ACCES, contact_avant: null, invitation: true }
  console.log('\n--- carte longue (Brice), lien pas servi ---\n' + C.carteAdresseContact(p, l))
  console.log('\n--- carte courte (Melanie) ---\n' + C.carteCourteAdresseContact(p))
  const ls = lecture({ telegramId: 777 })
  const ps = { ...params(), acces_id: ACCES, contact_avant: null, invitation: false }
  console.log('\n--- carte longue, lien deja servi ---\n' + C.carteAdresseContact(ps, ls))
  console.log('\n--- carte courte, lien deja servi ---\n' + C.carteCourteAdresseContact(ps))
  console.log('\n--- resultat, invitation partie ---\n' + C.resultatAdresseContact({ emailAcces: BROKER, contact: GMAIL, avant: null, retirer: false, renvoi: false, invitation: 'partie', jusquau: l.jusquau }))
}

console.log(`\n${n} blocs ok`)
