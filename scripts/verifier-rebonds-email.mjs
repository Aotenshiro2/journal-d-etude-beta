// Tests des EMAILS DU LIVE CLUB QUI N'ARRIVENT PAS (31/10, webhook Resend) :
// - la signature Svix (vecteur de test de la doc Svix, corps change, secret faux,
//   horodatage trop vieux, rotation de secret) ;
// - la decision de la route : sans secret, signature fausse, evenements ignores,
//   emails d'un autre produit, coupure ;
// - la nature du refus (le cas reel du 31/10 : Transient / ContentRejected,
//   « 550 spam detected ») et ce qui en decoule pour l'invitation broker ;
// - le deroule sur une fausse base en memoire : rejeu du meme svix-id,
//   invitation broker remise ou gardee, lien personnel dans l'alerte mais pas
//   dans l'historique, membre relie ou non, alerte une fois par adresse et par
//   jour, alerte ratee rejouee ;
// - les textes (alerte, message au membre), le fil, le journal et le resume ;
// - le cablage (route, middleware, SQL du serveur, expediteur et sujet).
// Aucune base, aucun reseau, aucun appel au modele.
// node scripts/verifier-rebonds-email.mjs
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const R = await import('../src/lib/liveclub/rebonds-pur.ts')
const P = await import('../src/lib/liveclub/pur.ts')
const RS = await import('../src/lib/liveclub/resume-pur.ts')
const E = await import('../src/lib/liveclub/emails.ts')

let n = 0
const bloc = async (nom, f) => { await f(); n++; console.log(`ok  ${nom}`) }
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
}

/** Caracteres clavier simples pour un texte a l'equipe (« » permis). */
function texteClavier(t, nom) {
  assert.ok(!/[\u2014\u2013\u2026\u201c\u201d\u2018\u2019\u2022]/.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce`)
  assert.ok(!/[\u00a0\u202f\u200b-\u200d\u2060\ufeff]/.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET_CLE = randomBytes(24)
const SECRET = `whsec_${SECRET_CLE.toString('base64')}`
const MAINTENANT_S = Math.floor(Date.parse('2026-10-31T11:36:00Z') / 1000)

function signer(corps, id = 'msg_2abcDEF123', t = String(MAINTENANT_S), cle = SECRET_CLE) {
  const sig = createHmac('sha256', cle).update(`${id}.${t}.${corps}`, 'utf8').digest('base64')
  return { id, horodatage: t, signature: `v1,${sig}` }
}

const FROM_LIVECLUB = 'Live Club AOKnowledge <support@aoknowledge.com>'

/** Le rebond reel du 31/10 (adresse fictive), tel que Resend le decrit. */
function evenement(o = {}) {
  return {
    type: o.type ?? 'email.bounced',
    created_at: '2026-10-31T11:35:20.000Z',
    data: {
      created_at: '2026-10-31T11:35:02.000Z',
      email_id: '56761188-7520-42d8-8898-ff6fc54ce618',
      from: 'from' in o ? o.from : FROM_LIVECLUB,
      to: 'to' in o ? o.to : ['Fabien.Essai@LibertySurf.fr'],
      subject: 'subject' in o ? o.subject : 'Votre accès au Live Club est ouvert',
      ...(o.sansRefus ? {} : {
        bounce: o.bounce ?? {
          type: 'Transient', subType: 'ContentRejected',
          message: "Blocked due to content: The message was rejected because it contained content that the recipient's server doesn't allow",
          diagnosticCode: ['smtp; 550 spam detected'],
        },
      }),
      ...(o.suppressed ? { suppressed: o.suppressed } : {}),
    },
  }
}

const decision = (corpsObj, o = {}) => {
  const corps = typeof corpsObj === 'string' ? corpsObj : JSON.stringify(corpsObj)
  return R.decisionWebhook({
    secret: 'secret' in o ? o.secret : SECRET,
    corps,
    entetes: o.entetes ?? signer(corps),
    maintenantS: o.maintenantS ?? MAINTENANT_S,
    expediteurs: o.expediteurs ?? [],
    coupe: o.coupe,
  })
}

const lireEv = (o = {}, expediteurs = []) => {
  const l = R.lireEvenementResend(evenement(o), expediteurs)
  assert.equal(l.ok, true, `evenement illisible : ${JSON.stringify(l)}`)
  return l.evenement
}

/** Une fausse base : memes regles que le SQL de rebonds.ts (svix-id, alerte par adresse et par jour, message par adresse). */
function fausseBase(o = {}) {
  const lignes = []
  const vu = { prives: [], alertes: [], remises: [], clos: [], liens: 0 }
  const outils = {
    retrouverPersonne: async () => o.personne ?? { telegramIds: [], membreId: null, nom: null, acces: null, clientStripe: null },
    reserver: async (r) => {
      if (o.panne) throw new Error('base indisponible')
      if (lignes.some(l => l.svix_id === r.svixId && l.resultat === 'fait')) return null
      const alerte = !lignes.some(l => l.empreinte === r.empreinte && l.jour === r.jour && l.alerte === 'envoyee')
      const message = r.membreAPrevenir && !lignes.some(l => l.empreinte === r.empreinte && l.message === 'prive')
      const l = {
        id: String(lignes.length + 1), svix_id: r.svixId, empreinte: r.empreinte, jour: r.jour, regle: r.regle,
        telegramId: r.telegramId, details: r.details, resultat: 'fait',
        alerte: alerte ? 'a_envoyer' : 'deja', message: message ? 'a_envoyer' : r.membreAPrevenir ? 'deja' : 'sans_compte',
      }
      lignes.push(l)
      return { id: l.id, alerte, message }
    },
    remettreInvitation: async (accesId) => { vu.remises.push(accesId); return o.remise ?? true },
    lienPersonnel: async () => { vu.liens++; return o.lien ?? null },
    equipeALaMain: async (tid) => (o.equipe ?? []).includes(tid),
    envoyerPrive: async (tid, texte) => { vu.prives.push({ tid, texte }); return !(o.bloques ?? []).includes(tid) },
    analyserMotif: (m) => ({ texte: m, securite: null }),
    alerterEquipe: async (texte, historique, id) => { vu.alertes.push({ texte, historique, id }); return o.livres ?? 2 },
    clore: async (id, c) => {
      const l = lignes.find(x => x.id === id)
      l.resultat = c.resultat
      l.alerte = c.details.alerte
      l.message = c.details.message
      vu.clos.push(c)
    },
    maintenant: () => o.maintenant ?? new Date('2026-10-31T11:36:00Z'),
  }
  return { outils, lignes, vu, o }
}

const ACCES_PAS_ENTRE = { accesId: '11111111-2222-3333-4444-555555555555', telegramId: null, actif: true }
const LIEN = 'https://t.me/aok_liveclub_bot?start=AbCdEfGhIjKlMnOpQrStUvWx'

// ---------------------------------------------------------------------------

await bloc('signature Svix : vecteur de la doc Svix, corps ou id changes, horodatage, rotation, prefixe', () => {
  const doc = { id: 'msg_loFOjxBNrRLzqYUf', horodatage: '1731705121', signature: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=' }
  const corps = '{"event_type":"ping","data":{"success":true}}'
  const secretDoc = 'whsec_plJ3nmyCDGBKInavdOK15jsl'
  assert.equal(R.verifierSignatureSvix(corps, doc, secretDoc, 1731705121), true)
  assert.equal(R.verifierSignatureSvix(corps, doc, 'plJ3nmyCDGBKInavdOK15jsl', 1731705121), true, 'prefixe whsec_ facultatif')
  // Horodatage : 5 minutes de tolerance, et la doc est vieille (refusee a l'heure actuelle).
  assert.equal(R.verifierSignatureSvix(corps, doc, secretDoc, 1731705121 + 299), true)
  assert.equal(R.verifierSignatureSvix(corps, doc, secretDoc, 1731705121 + 301), false)
  assert.equal(R.verifierSignatureSvix(corps, doc, secretDoc), false)
  // Corps, id ou secret differents : refus.
  assert.equal(R.verifierSignatureSvix(corps.replace('true', 'false'), doc, secretDoc, 1731705121), false)
  assert.equal(R.verifierSignatureSvix(corps, { ...doc, id: 'msg_autre' }, secretDoc, 1731705121), false)
  assert.equal(R.verifierSignatureSvix(corps, doc, SECRET, 1731705121), false)
  // Rotation : plusieurs signatures separees par des espaces, une seule bonne suffit.
  assert.equal(R.verifierSignatureSvix(corps, { ...doc, signature: `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${doc.signature}` }, secretDoc, 1731705121), true)
  assert.equal(R.verifierSignatureSvix(corps, { ...doc, signature: doc.signature.replace('v1,', 'v2,') }, secretDoc, 1731705121), false)
  // En-tetes absents ou malformes, secret illisible.
  for (const e of [{ ...doc, signature: null }, { ...doc, signature: '' }, { ...doc, id: null }, { ...doc, horodatage: 'abc' }, { ...doc, id: 'msg id' }]) {
    assert.equal(R.verifierSignatureSvix(corps, e, secretDoc, 1731705121), false)
  }
  assert.equal(R.verifierSignatureSvix(corps, doc, 'whsec_', 1731705121), false)
  assert.equal(R.verifierSignatureSvix(corps, doc, '', 1731705121), false)
})

await bloc('route : sans secret 503, signature fausse 400, corps illisible ou trop gros 400, rien n est traite', () => {
  const ev = evenement()
  assert.deepEqual(decision(ev, { secret: undefined }), { statut: 503, erreur: 'config' })
  assert.deepEqual(decision(ev, { secret: '  ' }), { statut: 503, erreur: 'config' })
  // Signature d'un autre secret, d'un autre corps, ou trop vieille.
  const corps = JSON.stringify(ev)
  assert.deepEqual(decision(ev, { entetes: signer(corps, 'msg_x', String(MAINTENANT_S), randomBytes(24)) }), { statut: 400, erreur: 'signature' })
  assert.deepEqual(decision(ev, { entetes: signer(`${corps} `) }), { statut: 400, erreur: 'signature' })
  assert.deepEqual(decision(ev, { entetes: signer(corps, 'msg_x', String(MAINTENANT_S - 600)) }), { statut: 400, erreur: 'signature' })
  assert.deepEqual(decision(ev, { entetes: { id: null, horodatage: null, signature: null } }), { statut: 400, erreur: 'signature' })
  // La coupure ne se lit qu'apres la signature.
  assert.deepEqual(decision(ev, { coupe: true, entetes: { id: 'msg_x', horodatage: String(MAINTENANT_S), signature: 'v1,AAAA' } }), { statut: 400, erreur: 'signature' })
  assert.deepEqual(decision(ev, { coupe: true }), { statut: 200, ignore: 'coupe' })
  assert.deepEqual(decision('pas du json'), { statut: 400, erreur: 'corps' })
  assert.deepEqual(decision('x'.repeat(R.MAX_CORPS_WEBHOOK + 1)), { statut: 400, erreur: 'corps' })
  const d = decision(ev)
  assert.equal(d.statut, 'traiter')
  assert.equal(d.svixId, 'msg_2abcDEF123')
  assert.equal(d.evenement.email, 'fabien.essai@libertysurf.fr', 'adresse en minuscules')
})

await bloc('evenements ignores : livre, ouvert, retard, autre produit du compte Resend, sans destinataire', () => {
  for (const type of ['email.delivered', 'email.sent', 'email.opened', 'email.clicked', 'email.delivery_delayed', 'email.failed', 'contact.created', 'domain.updated']) {
    assert.deepEqual(decision(evenement({ type })), { statut: 200, ignore: 'type' }, type)
  }
  for (const from of ['AO Knowledge <support@aoknowledge.com>', 'Cockpit AOK <support@aoknowledge.com>', 'AOK Support <onboarding@resend.dev>', '', null]) {
    assert.deepEqual(decision(evenement({ from })), { statut: 200, ignore: 'hors_live_club' }, String(from))
  }
  assert.deepEqual(decision(evenement({ to: ['pas-une-adresse'] })), { statut: 200, ignore: 'sans_destinataire' })
  assert.deepEqual(decision({ type: 'email.bounced' }), { statut: 200, ignore: 'illisible' })
  // Expediteur du Live Club : casse et espaces ignores ; LIVECLUB_FROM_EMAIL reconnu, la valeur par defaut aussi.
  assert.equal(decision(evenement({ from: '  live club aoknowledge   <SUPPORT@aoknowledge.com> ' })).statut, 'traiter')
  const perso = 'Live Club <liveclub@aoknowledge.com>'
  assert.equal(decision(evenement({ from: perso }), { expediteurs: [perso] }).statut, 'traiter')
  assert.equal(decision(evenement({ from: perso })).statut, 200)
  assert.equal(decision(evenement(), { expediteurs: [perso] }).statut, 'traiter')
})

await bloc('le cas du 31/10 : Transient / ContentRejected, « 550 spam detected » = contenu, pas une adresse morte', () => {
  const ev = lireEv()
  assert.equal(ev.genre, 'rebond')
  assert.equal(ev.nature, 'contenu')
  assert.equal(ev.type, 'Transient')
  assert.equal(ev.sousType, 'ContentRejected')
  assert.equal(ev.motif, '550 spam detected', 'le code SMTP d abord, sans « smtp; »')
  assert.equal(ev.sujet, R.SUJET_INVITATION_BROKER)
  assert.equal(ev.envoyeLe, '2026-10-31T11:35:02.000Z')
  assert.equal(R.invitationARemettre(ev.nature), false, 'le meme email renvoye serait refuse pareil')
  assert.match(R.LIBELLE_NATURE.contenu, /^refusé comme spam par le serveur du destinataire \(contenu\), pas une adresse morte/)
  // Le tableau de bord ecrit « Content Rejected » : meme nature.
  assert.equal(R.natureRefus('rebond', 'Transient', 'Content Rejected', null), 'contenu')
  assert.equal(R.natureRefus('rebond', 'Undetermined', 'Undetermined', '550 spam detected'), 'contenu')
  // Les autres natures.
  assert.equal(R.natureRefus('rebond', 'Permanent', 'General', null), 'definitif')
  assert.equal(R.natureRefus('rebond', 'Permanent', 'NoEmail', null), 'definitif')
  assert.equal(R.natureRefus('rebond', 'Transient', 'MailboxFull', null), 'passager')
  assert.equal(R.natureRefus('rebond', 'Temporary', 'General', null), 'passager')
  assert.equal(R.natureRefus('rebond', 'Permanent', 'Suppressed', null), 'bloque')
  assert.equal(R.natureRefus('rebond', 'Undetermined', 'Undetermined', null), 'indetermine')
  assert.equal(R.invitationARemettre('definitif'), true)
  for (const nat of ['contenu', 'passager', 'bloque', 'plainte', 'indetermine']) assert.equal(R.invitationARemettre(nat), false, nat)
  // email.suppressed et email.complained.
  const bloque = lireEv({ type: 'email.suppressed', sansRefus: true, suppressed: { type: 'OnAccountSuppressionList', message: 'Suppressed' } })
  assert.equal(bloque.genre, 'bloque')
  assert.equal(bloque.nature, 'bloque')
  const plainte = lireEv({ type: 'email.complained', sansRefus: true })
  assert.equal(plainte.genre, 'plainte')
  assert.equal(plainte.nature, 'plainte')
  assert.equal(plainte.motif, null)
  // Le sujet du code de verification ne garde pas le code ; une date reste.
  assert.equal(R.sujetSur('Votre code pour le bot Live Club : 123456'), 'Votre code pour le bot Live Club')
  assert.equal(R.sujetSur('Votre prochain prélèvement Live Club, le 12 novembre 2026'), 'Votre prochain prélèvement Live Club, le 12 novembre 2026')
})

await bloc('rejeu du meme svix-id : traite une fois, rien n est refait ; une base en panne jette (500, Resend rejoue)', async () => {
  const b = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: ACCES_PAS_ENTRE, clientStripe: null }, lien: LIEN })
  const ev = lireEv()
  const un = await R.traiterRebond(ev, 'msg_1', b.outils)
  assert.equal(un.etat, 'traite')
  const deux = await R.traiterRebond(ev, 'msg_1', b.outils)
  assert.deepEqual(deux, { etat: 'deja' })
  assert.equal(b.lignes.length, 1)
  assert.equal(b.vu.alertes.length, 1)
  assert.equal(b.vu.clos.length, 1)
  const panne = fausseBase({ panne: true })
  await assert.rejects(R.traiterRebond(ev, 'msg_2', panne.outils), /base indisponible/)
  assert.equal(panne.vu.alertes.length, 0)
})

await bloc('invitation broker, refus de CONTENU (31/10) : rien n est remis, lien personnel dans l alerte, pas dans l historique', async () => {
  const b = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: ACCES_PAS_ENTRE, clientStripe: null }, lien: LIEN })
  const r = await R.traiterRebond(lireEv(), 'msg_c', b.outils)
  assert.equal(r.invitation, 'gardee')
  assert.equal(b.vu.remises.length, 0, 'invite_envoyee_le pas touche : ce serait un renvoi automatique du meme contenu')
  assert.equal(r.membre, 'sans_compte')
  assert.equal(b.vu.prives.length, 0)
  const { texte, historique, id } = b.vu.alertes[0]
  assert.equal(id, 'rebond-1')
  assert.match(texte, /^Email du Live Club refusé : « Votre accès au Live Club est ouvert », parti le 31 octobre à 12 h 35, à fabien\.essai@libertysurf\.fr \(accès broker, pas encore entré dans le groupe\)\./)
  assert.match(texte, /Pourquoi : refusé comme spam par le serveur du destinataire \(contenu\), pas une adresse morte\. Le même email renvoyé serait sans doute refusé pareil\. \(Resend : Transient \/ ContentRejected, « 550 spam detected »\.\)/)
  assert.match(texte, /Son invitation reste notée « envoyée »/)
  assert.match(texte, /À faire : donne-lui toi-même son lien personnel \(ci-dessous\), il le fait entrer tout seul ; ou demande-lui une autre adresse\./)
  assert.ok(texte.includes(`${R.PREFIXE_LIEN}${LIEN}`))
  assert.match(texte, /aucun compte Telegram relié au bot/)
  assert.ok(!historique.includes(LIEN), 'le lien personnel ne se garde pas dans l historique d Agent AOK')
  assert.ok(historique.includes(R.LIEN_HORS_HISTORIQUE))
  assert.deepEqual(b.vu.clos[0], {
    resultat: 'fait', telegramId: null, regle: 'email_rebond',
    details: { alerte: 'envoyee', livres: 2, message: 'sans_compte', invitation: 'gardee', lien_donne: true },
  })
  // Le journal : empreinte et identifiants, jamais l'adresse.
  const l = b.lignes[0]
  assert.equal(l.empreinte, R.empreinteEmail('fabien.essai@libertysurf.fr'))
  assert.equal(l.jour, '2026-10-31')
  assert.ok(!JSON.stringify(l.details).includes('libertysurf'), 'pas d adresse dans le journal')
  assert.equal(l.details.acces_id, ACCES_PAS_ENTRE.accesId)
  assert.equal(l.details.svix_id, 'msg_c')
  assert.equal(l.details.connue, true)
  texteClavier(texte, 'alerte du 31/10')
})

await bloc('invitation broker, adresse MORTE (Permanent) : l invitation repasse « pas envoyee » ; pas d invitation = rien', async () => {
  const definitif = { bounce: { type: 'Permanent', subType: 'General', message: 'Mailbox does not exist', diagnosticCode: ['smtp; 550 5.1.1 user unknown'] } }
  const b = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: ACCES_PAS_ENTRE, clientStripe: null }, lien: LIEN })
  const r = await R.traiterRebond(lireEv(definitif), 'msg_d', b.outils)
  assert.equal(r.invitation, 'remise')
  assert.deepEqual(b.vu.remises, [ACCES_PAS_ENTRE.accesId])
  assert.match(b.vu.alertes[0].texte, /adresse refusée pour de bon par le serveur du destinataire \(inexistante ou fermée\)/)
  assert.match(b.vu.alertes[0].texte, /Son invitation d'accès broker repasse « pas envoyée »\./)
  // Deja renvoyee ou jeton utilise : le serveur ne remet rien.
  const c = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: ACCES_PAS_ENTRE, clientStripe: null }, remise: false })
  assert.equal((await R.traiterRebond(lireEv(definitif), 'msg_e', c.outils)).invitation, 'inchangee')
  // Un autre email (relance des lots) vers un acces pas entre : pas une invitation.
  const d = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: ACCES_PAS_ENTRE, clientStripe: null } })
  assert.equal((await R.traiterRebond(lireEv({ ...definitif, subject: 'Vos premiers lots chez le broker' }), 'msg_f', d.outils)).invitation, null)
  assert.equal(d.vu.remises.length, 0)
  // Acces deja ouvert (compte Telegram) ou termine : ni invitation, ni lien.
  const e = fausseBase({ personne: { telegramIds: [42], membreId: null, nom: null, acces: { ...ACCES_PAS_ENTRE, telegramId: 42 }, clientStripe: null }, lien: LIEN })
  const re = await R.traiterRebond(lireEv(definitif), 'msg_g', e.outils)
  assert.equal(re.invitation, null)
  assert.equal(re.lien, false)
  assert.equal(e.vu.liens, 0)
  const f = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: { ...ACCES_PAS_ENTRE, actif: false }, clientStripe: null }, lien: LIEN })
  assert.equal((await R.traiterRebond(lireEv(definitif), 'msg_h', f.outils)).invitation, null)
  assert.equal(f.vu.remises.length, 0)
})

await bloc('membre relie ou non : prive une fois par adresse, l equipe a la main = silence, bot bloque = echec', async () => {
  const abonne = { telegramIds: [101, 102], membreId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', nom: 'Fabien @fab', acces: null, clientStripe: 'cus_Abc123' }
  const sujet = { subject: 'Votre prochain prélèvement Live Club, le 12 novembre 2026' }
  const b = fausseBase({ personne: abonne })
  const r = await R.traiterRebond(lireEv(sujet), 'msg_m1', b.outils)
  assert.equal(r.membre, 'prive')
  assert.equal(b.vu.prives.length, 1)
  assert.equal(b.vu.prives[0].tid, 101)
  assert.equal(b.vu.prives[0].texte, R.texteMembreRebond('fabien.essai@libertysurf.fr', 'Votre prochain prélèvement Live Club, le 12 novembre 2026', 'rebond'))
  assert.match(b.vu.alertes[0].texte, /\(Fabien @fab, client Stripe du Live Club\)/)
  assert.match(b.vu.alertes[0].texte, /Je l'ai prévenu en privé/)
  assert.match(b.vu.alertes[0].texte, /À faire : demande-lui une autre adresse, l'équipe la relie à son compte après vérification\./)
  assert.equal(b.lignes[0].telegramId, 101)
  // Un second refus de la meme adresse : pas de second message.
  const r2 = await R.traiterRebond(lireEv(sujet), 'msg_m2', b.outils)
  assert.equal(r2.membre, 'deja')
  assert.equal(b.vu.prives.length, 1)
  // Premier compte bloque : le second recoit.
  const c = fausseBase({ personne: abonne, bloques: [101] })
  assert.equal((await R.traiterRebond(lireEv(sujet), 'msg_m3', c.outils)).membre, 'prive')
  assert.deepEqual(c.vu.prives.map(p => p.tid), [101, 102])
  // Tous bloques : echec, dit dans l'alerte ; un refus suivant retente.
  const d = fausseBase({ personne: abonne, bloques: [101, 102] })
  assert.equal((await R.traiterRebond(lireEv(sujet), 'msg_m4', d.outils)).membre, 'echec')
  assert.match(d.vu.alertes[0].texte, /Mon message privé n'est pas passé/)
  d.o.bloques = []
  d.o.maintenant = new Date('2026-11-01T09:00:00Z')
  assert.equal((await R.traiterRebond(lireEv(sujet), 'msg_m5', d.outils)).membre, 'prive')
  // L'equipe a la main dans son fil : le bot se tait, et le dit.
  const e = fausseBase({ personne: abonne, equipe: [101] })
  assert.equal((await R.traiterRebond(lireEv(sujet), 'msg_m6', e.outils)).membre, 'equipe')
  assert.equal(e.vu.prives.length, 0)
  assert.match(e.vu.alertes[0].texte, /l'équipe a la main dans son fil/)
  // Adresse inconnue du Live Club : pas de message, l'alerte le dit.
  const f = fausseBase()
  const rf = await R.traiterRebond(lireEv(sujet), 'msg_m7', f.outils)
  assert.equal(rf.membre, 'sans_compte')
  assert.match(f.vu.alertes[0].texte, /\(adresse inconnue du Live Club\)/)
  assert.equal(f.lignes[0].details.connue, false)
})

await bloc('alerte une seule fois par adresse et par jour ; le lendemain a nouveau ; ratee = echec et rejeu', async () => {
  const b = fausseBase()
  await R.traiterRebond(lireEv(), 'msg_a1', b.outils)
  const deux = await R.traiterRebond(lireEv({ subject: 'Vos premiers lots chez le broker' }), 'msg_a2', b.outils)
  assert.equal(deux.alerte, 'deja')
  assert.equal(b.vu.alertes.length, 1)
  assert.equal(b.lignes.length, 2, 'chaque refus a sa ligne au journal')
  // Une autre adresse le meme jour : sa propre alerte.
  await R.traiterRebond(lireEv({ to: ['autre@exemple.fr'] }), 'msg_a3', b.outils)
  assert.equal(b.vu.alertes.length, 2)
  // Le lendemain (jour de Paris) : a nouveau.
  b.o.maintenant = new Date('2026-10-31T23:30:00Z')
  assert.equal(R.jourParisDe(b.o.maintenant), '2026-11-01')
  assert.equal((await R.traiterRebond(lireEv(), 'msg_a4', b.outils)).alerte, 'envoyee')
  assert.equal(b.vu.alertes.length, 3)
  // Personne n'a recu l'alerte : ligne 'echec', la route repond 500, le rejeu (meme svix-id) la retente.
  const c = fausseBase({ livres: 0 })
  const rate = await R.traiterRebond(lireEv(), 'msg_r', c.outils)
  assert.equal(rate.alerte, 'echec')
  assert.equal(rate.aRejouer, true)
  assert.equal(c.lignes[0].resultat, 'echec')
  c.o.livres = 2
  const rejeu = await R.traiterRebond(lireEv(), 'msg_r', c.outils)
  assert.equal(rejeu.alerte, 'envoyee')
  assert.equal(rejeu.aRejouer, false)
  assert.equal((await R.traiterRebond(lireEv(), 'msg_r', c.outils)).etat, 'deja')
})

await bloc('textes au membre : sans spam pour un refus, une autre adresse proposee, caracteres simples', () => {
  const rebond = R.texteMembreRebond('fabien.essai@libertysurf.fr', R.SUJET_INVITATION_BROKER, 'rebond')
  assert.equal(rebond, [
    "Petit souci avec ton adresse email : notre email « Votre accès au Live Club est ouvert » n'a pas pu t'arriver à fabien.essai@libertysurf.fr.",
    "Tu as une autre adresse ? Écris-la-moi ici, l'équipe s'en occupe.",
  ].join('\n\n'))
  assert.ok(!/spam|indésirable|refus/i.test(rebond), 'un refus ne parle pas de spam au membre')
  const bloque = R.texteMembreRebond('a@b.fr', null, 'bloque')
  assert.match(bloque, /notre dernier email n'a pas pu t'arriver à a@b\.fr/)
  const plainte = R.texteMembreRebond('a@b.fr', 'Ton accès au Live Club se termine dans une semaine', 'plainte')
  assert.match(plainte, /parmi les indésirables/)
  for (const [nom, t] of [['rebond', rebond], ['bloque', bloque], ['plainte', plainte]]) texteSain(t, `message au membre (${nom})`)
})

await bloc('alertes : chaque nature dite en clair, quoi faire, securite, caracteres simples', () => {
  const base = {
    email: 'x@y.fr', qui: null, quoi: null, invitation: null, lien: null, accesBroker: false, membre: 'sans_compte', securite: null,
  }
  const ev = (nature, genre = 'rebond') => ({ genre, nature, sujet: 'Sujet', envoyeLe: null, type: null, sousType: null, motif: null })
  const t = (nature, o = {}) => R.texteAlerteRebond({ ...base, evenement: ev(nature, o.genre), ...o })
  assert.match(t('bloque', { genre: 'bloque' }), /^Email du Live Club bloqué par Resend : « Sujet », à x@y\.fr \(adresse inconnue du Live Club\)\./)
  assert.match(t('bloque', { genre: 'bloque' }), /se débloque dans Resend \(Suppressions\)/)
  assert.match(t('plainte', { genre: 'plainte' }), /^Email du Live Club marqué comme spam/)
  assert.match(t('passager'), /un prochain email peut passer/)
  assert.match(t('definitif', { accesBroker: true }), /son lien personnel n'est plus valable, ou il a déjà servi/)
  const sur = t('contenu', { securite: 'Attention (sécurité) : la réponse du serveur contient X.' })
  assert.match(sur, /\nAttention \(sécurité\)/)
  for (const nature of ['contenu', 'definitif', 'passager', 'bloque', 'plainte', 'indetermine']) {
    texteClavier(t(nature), `alerte ${nature}`)
    assert.ok(t(nature).split('\n').length <= 6, `alerte ${nature} : courte (Melanie)`)
  }
  assert.ok(R.MARQUEUR_ALERTE_REBOND.startsWith('[système] '))
})

await bloc('journal, fil Support et resume du matin', () => {
  const g = (regle, resultat = 'fait', details = {}) => ({ id: '9', geste: 'adresse', resultat, regle, details, fait_le: '2026-10-31T11:36:00Z', telegram_id: null, membre_id: null, abonnement_id: null })
  // Fil Support : une ligne courte, sans adresse.
  assert.equal(P.phraseGeste({ geste: 'adresse', resultat: 'fait', regle: 'email_rebond' }), "Un email du Live Club n'a pas pu lui arriver (refusé par sa boîte, ou bloqué) : l'équipe est prévenue.")
  assert.equal(P.phraseGeste({ geste: 'adresse', resultat: 'fait', regle: 'email_bloque' }), P.phraseGeste({ geste: 'adresse', resultat: 'fait', regle: 'email_rebond' }))
  assert.match(P.phraseGeste({ geste: 'adresse', resultat: 'fait', regle: 'email_plainte' }), /indésirables/)
  assert.match(P.phraseGeste({ geste: 'adresse', resultat: 'fait', regle: 'telegram' }), /Une autre adresse email lui est rattachée/, 'les adresses rattachees inchangees')
  // Resume : rubrique a part, une ligne 'fait' seulement.
  assert.ok(RS.RUBRIQUES_RESUME.some(r => r.cle === 'rebonds' && r.titre === 'Emails du Live Club qui ne sont pas arrivés'))
  const details = { nature: 'contenu', sujet: R.SUJET_INVITATION_BROKER, invitation: 'gardee', lien_donne: true, message: 'sans_compte', connue: true }
  const phrase = R.phraseRebondResume(details)
  assert.equal(phrase, "email « Votre accès au Live Club est ouvert » refusé comme spam par son serveur (contenu), lien personnel donné à l'équipe")
  assert.deepEqual(RS.evenementDeGeste(g('email_rebond', 'fait', details), { phraseRebond: phrase }), { rubrique: 'rebonds', detail: phrase })
  assert.equal(RS.evenementDeGeste(g('email_rebond', 'echec', details), { phraseRebond: phrase }), null)
  assert.equal(RS.evenementDeGeste(g('telegram', 'fait')).rubrique, 'adresses', 'les adresses rattachees inchangees')
  assert.match(R.phraseRebondResume({ nature: 'definitif', invitation: 'remise', message: 'prive' }), /^email du Live Club refusé : adresse inexistante ou fermée, invitation repassée « pas envoyée », prévenu en privé$/)
  assert.match(R.phraseRebondResume({ nature: 'inconnue', connue: false }), /refusé par son serveur, adresse inconnue du Live Club/)
  const texte = RS.composerResume(
    [{ rubrique: 'rebonds', qui: 'efabien.essai@libertysurf.fr', detail: phrase, quand: '2026-10-31T11:36:00Z' }],
    new Map([['efabien.essai@libertysurf.fr', { nom: null, email: 'fabien.essai@libertysurf.fr', pseudo: null, telegramId: null }]]),
    { depuis: '2026-10-30T07:00:00Z', jusqua: '2026-11-01T07:00:00Z' },
  )
  assert.match(texte, /Emails du Live Club qui ne sont pas arrivés\n- fabien\.essai@libertysurf\.fr : email « Votre accès au Live Club est ouvert » refusé comme spam/)
  const resume = lire('src/lib/liveclub/resume.ts')
  assert.match(resume, /if \(g\.geste === 'adresse' && estRegleRebond\(g\.regle\)\) \{/)
  assert.match(resume, /select acces_id::text as id, lower\(email\) as email from public\.cockpit_liveclub_acces where acces_id::text = any/)
  assert.match(resume, /evenementDeGeste\(g, \{ phraseRebond: phraseRebondResume\(d\) \}\)/)
})

await bloc('cablage : route, middleware, SQL du serveur, expediteur et sujet, aucun log d adresse, aucune migration', () => {
  const route = lire('src/app/api/liveclub/resend/route.ts')
  assert.match(route, /const secret = process\.env\.RESEND_WEBHOOK_SECRET_LIVECLUB\?\.trim\(\)\n\s+if \(!secret\) \{/)
  assert.ok(route.indexOf('if (!secret)') < route.indexOf('await req.text()'), 'sans secret, rien n est lu')
  assert.ok(route.indexOf('decisionWebhook(') < route.indexOf('traiterRebondServeur('), 'la signature avant tout traitement')
  assert.match(route, /req\.headers\.get\('svix-id'\)/)
  assert.match(route, /req\.headers\.get\('svix-timestamp'\)/)
  assert.match(route, /req\.headers\.get\('svix-signature'\)/)
  assert.match(route, /if \(b\.aRejouer\) return NextResponse\.json\(\{ ok: false, erreur: 'alerte_non_envoyee' \}, \{ status: 500 \}\)/)
  assert.match(lire('middleware.ts'), /'\/api\/liveclub\/stripe', '\/api\/liveclub\/resend'/)

  const s = lire('src/lib/liveclub/rebonds.ts')
  assert.match(s, /pg_advisory_xact_lock\(hashtextextended\(\$\{`liveclub:rebond:\$\{r\.empreinte\}`\}::text, 0\)\)/)
  assert.match(s, /regle = any\(\$\{REGLES\}::text\[\]\) and resultat = 'fait'\n\s+and details->>'svix_id' = \$\{r\.svixId\}/)
  assert.match(s, /g\.details->>'empreinte' = \$\{r\.empreinte\} and g\.details->>'jour' = \$\{r\.jour\}/)
  assert.match(s, /insert into public\.cockpit_liveclub_gestes \(telegram_id, membre_id, geste, resultat, acteur, regle, details\)\n\s+values \(\$\{r\.telegramId\}::bigint, \$\{r\.membreId\}::uuid, 'adresse', 'fait'/)
  // L'invitation : acces jamais ouvert, jeton pas utilise, pas renvoyee depuis.
  const remise = s.slice(s.indexOf('async function remettreInvitation('), s.indexOf('async function lienPersonnel('))
  assert.match(remise, /set invite_envoyee_le = null/)
  assert.match(remise, /a\.invite_envoyee_le is not null and a\.telegram_id is null/)
  assert.match(remise, /a\.retire_le is null and a\.sorti_le is null/)
  assert.match(remise, /a\.invite_envoyee_le <= \$\{envoyeLe\}::timestamptz \+ interval '5 minutes'/)
  assert.match(remise, /j\.acces_id = a\.acces_id and j\.utilise_le is not null/)
  // Le lien seulement d'un jeton pas utilise ; l'historique recoit le texte sans lien.
  assert.match(s, /return j && !j\.utilise \? lienBot\(j\.jeton\) : null/)
  assert.match(s, /\{ role: 'assistant', content: texteHistorique, id: `\$\{id\}-texte` \}/)
  assert.match(s, /analyserTexte\(motif, \{ niveau: 'tiers' \}\)/)
  assert.match(s, /fil\.attend \|\| quiRepond\(fil\.messages, Date\.now\(\)\) === 'equipe'/)
  // Aucun log d'adresse, de lien, de motif ni de texte.
  for (const ligne of s.split('\n').filter(l => /console\.(log|warn|error)/.test(l))) {
    assert.ok(!/email\}|lien\}|motif\}|texte\}|ev\.email|ev\.motif/.test(ligne), `log suspect : ${ligne.trim()}`)
  }
  // Jamais de ban, d'exclusion ni d'ecriture Stripe.
  assert.ok(!/banChatMember|kickChatMember|stripePost|stripeDelete/.test(s))

  // L'expediteur par defaut et le sujet de l'invitation sont ceux des envois.
  assert.ok(lire('src/lib/liveclub/emails.ts').includes(`process.env.LIVECLUB_FROM_EMAIL?.trim() || '${R.EXPEDITEUR_LIVECLUB_DEFAUT}'`))
  assert.ok(lire('src/lib/liveclub/emails-verification.ts').includes(`process.env.LIVECLUB_FROM_EMAIL?.trim() || '${R.EXPEDITEUR_LIVECLUB_DEFAUT}'`))
  assert.equal(E.modeleAccesBroker('https://t.me/x?start=y', '2027-04-30', 6).sujet, R.SUJET_INVITATION_BROKER)

  // Aucune migration : 'adresse' est permis par la contrainte (derniere migration qui la pose).
  const m = lire('../../sites/Aoknowledgecom/supabase/migrations/20261015230000_cockpit_liveclub_comptes_telegram.sql')
  assert.match(m, /'adresse', 'compte_telegram'\n\s+\)\);/)
  // La consigne d'Agent AOK connait les nouvelles regles du geste 'adresse'.
  assert.match(lire('src/lib/agent-cockpit.ts'), /Sauf regle 'email_rebond', 'email_plainte' ou 'email_bloque' \(31\/10\)/)
})

// Les textes, pour relecture (adresse et lien fictifs).
{
  const b = fausseBase({ personne: { telegramIds: [], membreId: null, nom: null, acces: ACCES_PAS_ENTRE, clientStripe: null }, lien: LIEN })
  await R.traiterRebond(lireEv(), 'msg_texte', b.outils)
  console.log('\n--- alerte (cas du 31/10, Telegram) ---\n' + b.vu.alertes[0].texte)
  console.log('\n--- message au membre (refus) ---\n' + R.texteMembreRebond('fabien.essai@libertysurf.fr', R.SUJET_INVITATION_BROKER, 'rebond'))
}

console.log(`\n${n} blocs ok`)
