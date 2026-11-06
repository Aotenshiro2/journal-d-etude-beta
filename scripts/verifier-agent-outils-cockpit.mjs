// Verification HORS LIGNE (05/11/2026) des gestes du cockpit depuis Agent AOK,
// LOT 1. Brice, 05/11 : « que l'agent puisse faire depuis Telegram les gestes
// du cockpit ». Sept cartes (acces et rangement de l'academie, acces aux apps,
// clips) et un geste sans carte (« deja traite » par la phrase).
// - validerAction accepte les bonnes entrees et refuse les mauvaises, pour
//   chaque nouveau type, et ce qu'il garde survit au stockage de la carte
//   (JSON de cockpit_agent_cartes et de cockpit_agent_conversations) ;
// - les cartes disent ce qui compte (personne, offre, titres, credits) ;
// - TYPE_PAR_OUTIL, la liste des outils, les boutons et les descriptions
//   sont coherents ; marquer_fil_traite est un geste sans carte, borne au
//   titulaire ;
// - les executeurs posent les colonnes d'acteur (auth.uid() est nul cote
//   serveur) et les routes du cockpit appellent les memes fonctions ;
// - aucun tiret long ni caractere hors clavier dans les textes.
// LOT 2 (05/11, meme phrase de Brice) : huit cartes de plus (charges,
// abonnements IA, objectif d'une publication Instagram, le fonds : note,
// decision, enquete en ligne payante, relais d'accueil, adresse secondaire
// d'un membre), memes verifications, plus : les colonnes d'acteur de chaque
// table (pose_par, retire_par, ecrit_par, decide_par et decide_le,
// coupe_par), le droit au fonds a la carte ET au clic, l'enquete qui est
// celle de la route, et aucune adresse de source ni texte du web dans une carte.
// Aucune base, aucun reseau, aucun appel au modele.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-agent-outils-cockpit.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import './resoudre-ts.mjs'

const P = await import('../src/lib/agent-gestes-cockpit-pur.ts')
const A = await import('../src/lib/academie/arbre.ts')
const S = await import('../src/lib/stripe-actions.ts')
const AP = await import('../src/lib/agent-cockpit-pur.ts')

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8')

/** Les caracteres hors clavier, construits par leur code : ce fichier n'en contient aucun. */
const classe = (codes) => new RegExp(`[${codes.map(c => String.fromCharCode(c)).join('')}]`)
const HORS_CLAVIER = classe([0x2014, 0x2013, 0x2026, 0x201c, 0x201d, 0x2018, 0x2019, 0x2022])
const INVISIBLES = classe([0x00a0, 0x202f, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff])
function texteClavier(t, nom) {
  assert.equal(typeof t, 'string', `${nom} : pas un texte`)
  assert.ok(!HORS_CLAVIER.test(t), `${nom} : tiret long, points de suspension, guillemets courbes ou puce : ${t}`)
  assert.ok(!INVISIBLES.test(t), `${nom} : espace insecable ou caractere invisible`)
  assert.ok(!/\p{Extended_Pictographic}/u.test(t), `${nom} : emoji`)
}
function sansOutil(t, nom) {
  assert.ok(!/proposer_|marquer_fil_traite|requete_sql|clip_ids|acces_id\b|replay_id\b/.test(t), `${nom} : nom d'outil ou de parametre : ${t}`)
  // (05/11, LOT 2) Les parametres des nouvelles cartes non plus.
  assert.ok(!/charge_id|fixe_id|publication_id|personne_id|proposition_id|telegram_id|membre_id|empreinte/.test(t), `${nom} : nom de parametre : ${t}`)
}

const U = (k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
const valider = (type, params) => S.validerAction({ type, compte: undefined, params })
const ok = (type, params) => {
  const a = valider(type, params)
  assert.equal(typeof a, 'object', `${type} refuse : ${a}`)
  assert.equal(a.type, type)
  assert.equal(a.compte, 'cockpit')
  // Le stockage de la carte (jsonb) puis la revalidation au clic rendent la meme action.
  const relue = S.validerAction(JSON.parse(JSON.stringify(a)))
  assert.deepEqual(relue, a, `${type} : la carte stockee ne se relit pas a l'identique`)
  return a
}
const non = (type, params, motif) => {
  const a = valider(type, params)
  assert.equal(typeof a, 'string', `${type} accepte a tort : ${JSON.stringify(params)}`)
  if (motif) assert.match(a, motif)
  texteClavier(a, `refus ${type}`)
  return a
}

const TYPES_LOT2 = ['charge_fixe', 'abonnement_ia', 'objectif_publication', 'note_fonds', 'decision_fonds', 'enquete_fonds', 'relais_accueil', 'retrait_adresse']
const TYPES = ['acces_academie', 'retrait_acces_academie', 'rangement_academie', 'acces_mentorat', 'decision_clip', 'clips_replay', 'envoi_opus', ...TYPES_LOT2]
const OUTIL_DE = {
  proposer_acces_academie: 'acces_academie',
  proposer_retrait_acces_academie: 'retrait_acces_academie',
  proposer_rangement_academie: 'rangement_academie',
  proposer_acces_mentorat: 'acces_mentorat',
  proposer_decision_clip: 'decision_clip',
  proposer_clips_replay: 'clips_replay',
  proposer_envoi_opus: 'envoi_opus',
  // (05/11, LOT 2)
  proposer_charge_fixe: 'charge_fixe',
  proposer_abonnement_ia: 'abonnement_ia',
  proposer_objectif_publication: 'objectif_publication',
  proposer_note_fonds: 'note_fonds',
  proposer_decision_fonds: 'decision_fonds',
  proposer_enquete_fonds: 'enquete_fonds',
  proposer_relais_accueil: 'relais_accueil',
  proposer_retrait_adresse: 'retrait_adresse',
}

// ---------------------------------------------------------------------------
// A. Academie : acces
// ---------------------------------------------------------------------------

bloc('acces academie : email, offre (slug), fin incluse jamais passee, raison obligatoire', () => {
  const a = ok('acces_academie', { email: '  Arthur.Martin@Example.com ', offre: 'module-ict-bases', fin: '2099-12-31', raison: 'geste commercial' })
  assert.deepEqual(a.params, { email: 'arthur.martin@example.com', offre: 'module-ict-bases', fin: '2099-12-31', raison: 'geste commercial' })
  assert.equal(ok('acces_academie', { email: 'a@b.fr', offre: 'formation', raison: 'achat PayPal', fin: '' }).params.fin, null, 'vide = a vie')
  non('acces_academie', { email: 'a@b.fr', offre: 'formation' }, /raison/)
  non('acces_academie', { email: 'a@b.fr', offre: 'formation', raison: '   ' }, /raison/)
  non('acces_academie', { email: 'pas-un-email', offre: 'formation', raison: 'x' }, /Email invalide/)
  non('acces_academie', { email: 'a@b.fr', offre: 'Module ICT', raison: 'x' }, /slug/)
  non('acces_academie', { email: 'a@b.fr', offre: 'formation', raison: 'x', fin: '2020-01-01' }, /déjà passée/)
  non('acces_academie', { email: 'a@b.fr', offre: 'formation', raison: 'x', fin: '2027-02-30' }, /AAAA-MM-JJ/)
  non('acces_academie', { email: 'a@b.fr', offre: 'formation', raison: 'x'.repeat(401) }, /400/)
})

bloc('retrait academie : acces_id exact et raison', () => {
  const a = ok('retrait_acces_academie', { acces_id: U(7).toUpperCase(), raison: 'remboursé' })
  assert.deepEqual(a.params, { acces_id: U(7), raison: 'remboursé' })
  non('retrait_acces_academie', { acces_id: 'acces-7', raison: 'x' }, /acces_id/)
  non('retrait_acces_academie', { acces_id: U(7) }, /raison/)
})

const OFFRE_MODULE = { slug: 'module-ict-bases', titre: 'Les bases ICT (module seul)', ouvreTout: false, contenus: [{ module: 'Les bases ICT', entier: true, sections: 0 }] }
const OFFRE_TOUT = { slug: 'etm', titre: 'Elite Trader Mentorship', ouvreTout: true, contenus: [] }

bloc('cartes academie : la personne, l offre en clair, ce qu elle ouvre, la fin, la raison', () => {
  const p = { email: 'arthur@example.com', offre: 'module-ict-bases', fin: '2026-12-31', raison: 'geste commercial' }
  const c = P.carteAccesAcademie({ p, qui: 'Arthur Martin', offre: OFFRE_MODULE, compteVerifie: true })
  assert.match(c, /^Accorder à Arthur Martin \(arthur@example\.com\) l'offre « Les bases ICT \(module seul\) » de l'académie, jusqu'au 31\/12\/2026 inclus\./)
  assert.match(c, /Elle ouvre le module « Les bases ICT »\./)
  assert.match(c, /Raison notée : geste commercial/)
  assert.match(c, /s'ouvre tout de suite/)
  const sans = P.carteAccesAcademie({ p: { ...p, fin: null }, qui: null, offre: OFFRE_TOUT, compteVerifie: false })
  assert.match(sans, /^Accorder à arthur@example\.com l'offre « Elite Trader Mentorship » de l'académie, à vie/)
  assert.match(sans, /tout le catalogue, présent et à venir/)
  assert.match(sans, /s'ouvrira dès qu'il se connectera avec elle/)
  assert.equal(P.ceQuOuvreOffre({ ...OFFRE_MODULE, contenus: [{ module: 'A', entier: true, sections: 0 }, { module: 'B', entier: false, sections: 2 }] }),
    'les modules « A » et « B » (2 sections)')
  const r = P.carteRetraitAcademie({
    p: { acces_id: U(7), raison: 'remboursé' },
    acces: { accesId: U(7), email: 'arthur@example.com', qui: 'Arthur Martin', offre: OFFRE_MODULE, source: 'stripe', debut: '2026-10-02', fin: null },
  })
  assert.match(r, /^Retirer l'accès de Arthur Martin \(arthur@example\.com\) à l'offre « Les bases ICT \(module seul\) » \(achat Stripe, depuis le 02\/10\/2026, à vie\)\./)
  assert.match(r, /Il perd le module « Les bases ICT »/)
  assert.match(r, /ne rembourse rien/)
  for (const t of [c, sans, r]) { texteClavier(t, 'carte academie'); sansOutil(t, 'carte academie') }
})

// ---------------------------------------------------------------------------
// B. Academie : rangement
// ---------------------------------------------------------------------------

const M1 = U(1), M2 = U(2), S1 = U(11), S2 = U(12), L1 = U(21), L2 = U(22), L3 = U(23)
const lecon = (o) => ({
  section_id: null, slug: 'x', ordre: 1, type: 'video', hebergeur: 'bunny', bunny_bibliotheque: null, bunny_video_id: null, wistia_id: null,
  duree_s: null, statut: 'publie', apercu: false, a_contenu: false, fichiers: [], edite_le: null, deplace_le: null, statut_le: null,
  origine_module_id: null, origine_slug: null, ...o,
})
const ARBRE = {
  modules: [
    { id: M1, slug: 'ict-bases', titre: 'Les bases ICT', ordre: 1, parcours: null, statut: 'publie', edite_le: null, deplace_le: null, statut_le: null },
    { id: M2, slug: 'strategie', titre: 'Stratégie Parfaite', ordre: 2, parcours: null, statut: 'brouillon', edite_le: null, deplace_le: null, statut_le: null },
  ],
  sections: [
    { id: S1, module_id: M1, ordre: 1, titre: 'Introduction', ordre_fichier: 1, deplace_le: null },
    { id: S2, module_id: M2, ordre: 1, titre: 'Le plan', ordre_fichier: 1, deplace_le: null },
  ],
  lecons: [
    lecon({ id: L1, module_id: M1, section_id: S1, slug: 'bienvenue', ordre: 1, titre: 'Bienvenue' }),
    lecon({ id: L2, module_id: M1, section_id: S1, slug: 'le-dol', ordre: 2, titre: 'Le DOL', type: 'texte', hebergeur: null, statut: 'brouillon', a_contenu: true }),
    lecon({ id: L3, module_id: M2, section_id: S2, slug: 'bienvenue', ordre: 1, titre: 'Le plan du jour', hebergeur: null, statut: 'brouillon' }),
  ],
}

bloc('rangement : un geste a la fois, les cles de la route, uuid stricts, empreinte posee par le serveur', () => {
  const d = ok('rangement_academie', { geste: 'deplacer_lecons', ids: [L1.toUpperCase(), L1], module: M2, section: S2, avant: '', note: 'ignoree' })
  assert.deepEqual(d.params, { geste: 'deplacer_lecons', ids: [L1], module: M2, section: S2, avant: null, empreinte: null })
  assert.deepEqual(ok('rangement_academie', { geste: 'statut', cible: 'lecon', ids: [L2], statut: 'publie', section: S1 }).params,
    { geste: 'statut', cible: 'lecon', ids: [L2], statut: 'publie', empreinte: null }, 'une cle d\'un autre geste est ignoree')
  assert.deepEqual(ok('rangement_academie', { geste: 'deplacer_module', id: M2, avant: M1 }).params, { geste: 'deplacer_module', id: M2, avant: M1, empreinte: null })
  assert.deepEqual(ok('rangement_academie', { geste: 'creer_section', module: M1, titre: '  Exercices   pratiques ' }).params,
    { geste: 'creer_section', module: M1, titre: 'Exercices pratiques', empreinte: null })
  assert.equal(ok('rangement_academie', { geste: 'deplacer_section', id: S1, empreinte: 'a1b2c3d4' }).params.empreinte, 'a1b2c3d4')
  non('rangement_academie', { geste: 'supprimer', ids: [L1] }, /geste/)
  non('rangement_academie', { geste: 'statut', cible: 'lecon', ids: [L2], statut: 'archive' }, /statut/)
  non('rangement_academie', { geste: 'deplacer_lecons', ids: ['lecon-1'], module: M2 }, /deplacer_lecons/)
  non('rangement_academie', { geste: 'deplacer_lecons', ids: [L1], module: M2, avant: L1 }, /deplacer_lecons/)
  non('rangement_academie', { geste: 'statut', cible: 'lecon', ids: Array.from({ length: 201 }, (_, i) => U(1000 + i)), statut: 'publie' })
  non('rangement_academie', { geste: 'creer_section', module: M1, titre: '   ' }, /titre/)
  non('rangement_academie', { geste: 'deplacer_section', id: S1, empreinte: 'pas-hex' }, /Empreinte/)
})

bloc('rangement : la carte nomme par le TITRE, dit ou ca va, et que publier rend visible aux eleves', () => {
  const gPub = P.gesteDeRangement(P.lireParamsRangement({ geste: 'statut', cible: 'lecon', ids: [L2, L3], statut: 'publie' }))
  const planPub = A.planGeste(ARBRE, gPub)
  assert.ok(planPub.ok)
  const pub = P.carteRangement(ARBRE, gPub, planPub.plan)
  assert.match(pub, /^Publier 1 leçon : « Le DOL » \(module « Les bases ICT »\)\. Elle devient VISIBLE AUX ÉLÈVES qui ont accès à son module\./)
  assert.match(pub, /Pas publiables, elles restent en brouillon : « Le plan du jour » \(vidéo pas encore envoyée\)\./)
  assert.equal(P.rienNeChange(gPub, planPub.plan), null)

  const gDep = P.gesteDeRangement(P.lireParamsRangement({ geste: 'deplacer_lecons', ids: [L1], module: M2, section: S2, avant: L3 }))
  const planDep = A.planGeste(ARBRE, gDep)
  assert.ok(planDep.ok)
  const dep = P.carteRangement(ARBRE, gDep, planDep.plan)
  assert.match(dep, /^Déplacer 1 leçon de l'académie : « Bienvenue » \(module « Les bases ICT », section « Introduction »\)\./)
  assert.match(dep, /Elle va dans le module « Stratégie Parfaite », section « Le plan », juste avant « Le plan du jour »\./)
  assert.match(dep, /Changer de module change qui la voit : elle suit les accès du module « Stratégie Parfaite »\./)
  assert.match(dep, /Son statut \(publiée ou brouillon\) ne change pas\./)
  assert.match(dep, /bienvenue devient bienvenue-2/, 'le slug pris dans le module cible est dit')

  const gMod = P.gesteDeRangement(P.lireParamsRangement({ geste: 'statut', cible: 'module', ids: [M2], statut: 'publie' }))
  const mod = P.carteRangement(ARBRE, gMod, A.planGeste(ARBRE, gMod).plan)
  assert.match(mod, /Publier le module « Stratégie Parfaite » : il devient VISIBLE AUX ÉLÈVES dans le catalogue, avec ses leçons publiées \(0 sur 1\)\./)
  const gCache = P.gesteDeRangement(P.lireParamsRangement({ geste: 'statut', cible: 'module', ids: [M1], statut: 'brouillon' }))
  assert.match(P.carteRangement(ARBRE, gCache, A.planGeste(ARBRE, gCache).plan), /CACHÉ AUX ÉLÈVES/)

  const gSec = P.gesteDeRangement(P.lireParamsRangement({ geste: 'creer_section', module: M1, titre: 'Exercices' }))
  assert.match(P.carteRangement(ARBRE, gSec, null), /^Créer une section vide « Exercices » à la fin du module « Les bases ICT », après « Introduction »\./)
  const gModule = P.gesteDeRangement(P.lireParamsRangement({ geste: 'deplacer_module', id: M2, avant: M1 }))
  assert.match(P.carteRangement(ARBRE, gModule, A.planGeste(ARBRE, gModule).plan), /^Déplacer le module « Stratégie Parfaite » dans le catalogue, juste avant « Les bases ICT »\./)

  // Rien ne change : retour au modele, pas de carte.
  const gRien = P.gesteDeRangement(P.lireParamsRangement({ geste: 'statut', cible: 'lecon', ids: [L1], statut: 'publie' }))
  assert.match(P.rienNeChange(gRien, A.planGeste(ARBRE, gRien).plan), /Rien ne changerait/)
  const gVideo = P.gesteDeRangement(P.lireParamsRangement({ geste: 'statut', cible: 'lecon', ids: [L3], statut: 'publie' }))
  assert.match(P.rienNeChange(gVideo, A.planGeste(ARBRE, gVideo).plan), /vidéo pas encore envoyée/)
  for (const t of [pub, dep, mod]) { texteClavier(t, 'carte rangement'); sansOutil(t, 'carte rangement') }
  texteClavier(P.phraseRangementFait(gPub, { modifies: 1, renommees: [], refusees: planPub.plan.refusees }), 'phrase rangement')
})

bloc('rangement : l empreinte change si un element nomme change (titre, place, statut), pas avec un voisin', () => {
  const g = P.gesteDeRangement(P.lireParamsRangement({ geste: 'deplacer_lecons', ids: [L1], module: M2, section: S2, avant: L3 }))
  const e = P.empreinteRangement(ARBRE, g)
  assert.match(e, /^[0-9a-f]{8}$/)
  assert.equal(P.empreinteRangement(structuredClone(ARBRE), g), e, 'stable')
  const titre = structuredClone(ARBRE); titre.lecons[0].titre = 'Bienvenue !'
  assert.notEqual(P.empreinteRangement(titre, g), e)
  const statut = structuredClone(ARBRE); statut.lecons[2].statut = 'publie'
  assert.notEqual(P.empreinteRangement(statut, g), e, 'la lecon « avant » compte aussi')
  const voisin = structuredClone(ARBRE); voisin.lecons[1].titre = 'Autre'; voisin.lecons[0].ordre = 9
  assert.equal(P.empreinteRangement(voisin, g), e, 'un voisin ou l\'ordre ne comptent pas')
})

// ---------------------------------------------------------------------------
// C. Acces aux apps (mentorat)
// ---------------------------------------------------------------------------

bloc('acces aux apps : accorder ou retirer, email de connexion, note bornee', () => {
  assert.deepEqual(ok('acces_mentorat', { quoi: 'accorder', email: ' Arthur@Example.com', note: ' offert ' }).params, { quoi: 'accorder', email: 'arthur@example.com', note: 'offert' })
  assert.deepEqual(ok('acces_mentorat', { quoi: 'retirer', email: 'arthur@example.com', note: 'ignoree' }).params, { quoi: 'retirer', email: 'arthur@example.com', note: null })
  non('acces_mentorat', { quoi: 'prolonger', email: 'a@b.fr' }, /quoi/)
  non('acces_mentorat', { quoi: 'accorder', email: 'a@b' }, /email/)
  non('acces_mentorat', { quoi: 'accorder', email: 'a@b.fr', note: 'x'.repeat(501) }, /500/)
  const route = lire('src/app/api/cockpit/mentorat/route.ts')
  assert.ok(route.includes(`const EMAIL_RE = /${P.EMAIL_MENTORAT_RE.source}/`), 'meme motif d\'email que la route')
  assert.match(route, /const MAX_NOTE_LEN = 500/)
  const acc = P.carteMentorat({ p: { quoi: 'accorder', email: 'arthur@example.com', note: 'offert' }, qui: 'Arthur Martin', compteExiste: false, accordeLe: null, noteActuelle: null })
  assert.match(acc, /^Accorder à la main l'accès aux apps \(journal d'étude et extension, le mode mentorat\) à Arthur Martin \(arthur@example\.com\)\./)
  assert.match(acc, /s'ouvrira quand il se connectera avec elle/)
  const ret = P.carteMentorat({ p: { quoi: 'retirer', email: 'arthur@example.com', note: null }, qui: null, compteExiste: true, accordeLe: '2026-09-02T10:00:00Z', noteActuelle: 'offert' })
  assert.match(ret, /^Retirer l'accès aux apps accordé à la main à arthur@example\.com le 02\/09\/2026 \(note : offert\)\./)
  assert.match(ret, /Un droit automatique .* reste/)
  for (const t of [acc, ret]) { texteClavier(t, 'carte mentorat'); sansOutil(t, 'carte mentorat') }
})

// ---------------------------------------------------------------------------
// D. Clips
// ---------------------------------------------------------------------------

const R1 = U(31)
const REPLAY = { replayId: R1, titre: 'Live du mardi', personne: 'mel', dateLive: '2026-10-21', etat: 'trie', plage: { debut_s: 754, fin_s: 2710.5, passages: 5 }, creditsDepenses: 0 }
const CLIPS = [
  { clipId: U(41), replayId: R1, origine: 'opus', titre: 'Le DOL en 30 s', notreNote: 82, decision: null },
  { clipId: U(42), replayId: R1, origine: 'opus', titre: 'Pourquoi attendre', notreNote: null, decision: 'ecarter' },
]

bloc('decision sur des clips : ids dedoublonnes, 50 au plus, garder / ecarter / annuler, note bornee', () => {
  const a = ok('decision_clip', { clip_ids: [U(41), U(41).toUpperCase(), U(42)], decision: 'garder', note: ' bon rythme ' })
  assert.deepEqual(a.params, { clip_ids: [U(41), U(42)], decision: 'garder', note: 'bon rythme', replay_id: null })
  assert.equal(ok('decision_clip', { clip_ids: [U(41)], decision: 'annuler', note: 'x' }).params.note, null, 'pas de note pour remettre a trancher')
  assert.equal(ok('decision_clip', { clip_ids: [U(41)], decision: 'ecarter', replay_id: R1 }).params.replay_id, R1, 'le replay du controle survit au clic')
  non('decision_clip', { clip_ids: [], decision: 'garder' }, /clip_ids/)
  non('decision_clip', { clip_ids: ['clip-1'], decision: 'garder' }, /clip_id illisible/)
  non('decision_clip', { clip_ids: Array.from({ length: 51 }, (_, i) => U(500 + i)), decision: 'garder' }, /50 clips/)
  non('decision_clip', { clip_ids: [U(41)], decision: 'publier' }, /decision/)
  non('decision_clip', { clip_ids: [U(41)], decision: 'garder', note: 'x'.repeat(501) }, /500/)
})

bloc('decision sur des clips : refus avant la carte, carte avec titres et notes', () => {
  const p = (d) => P.lireParamsDecisionClip({ clip_ids: [U(41), U(42)], decision: d })
  assert.match(P.refusDecisionClip(p('garder'), CLIPS.slice(0, 1)), /Clip inconnu/)
  assert.match(P.refusDecisionClip(p('garder'), [CLIPS[0], { ...CLIPS[1], replayId: U(32) }]), /plusieurs replays/)
  assert.match(P.refusDecisionClip(p('garder'), [CLIPS[0], { ...CLIPS[1], origine: 'passage' }]), /rendus par Opus/)
  assert.match(P.refusDecisionClip(P.lireParamsDecisionClip({ clip_ids: [U(42)], decision: 'ecarter' }), [CLIPS[1]]), /déjà écartés/)
  assert.equal(P.refusDecisionClip(p('garder'), CLIPS), null)
  const c = P.carteDecisionClip({ p: p('garder'), clips: CLIPS, replay: REPLAY })
  assert.match(c, /^Garder 2 clips du replay « Live du mardi » \(live de Mel du 21\/10\/2026\) :\n« Le DOL en 30 s » \(notre note 82\), « Pourquoi attendre » \(sans note\)\./)
  assert.match(c, /Rien n'est publié/)
  const an = P.carteDecisionClip({ p: P.lireParamsDecisionClip({ clip_ids: [U(41), U(42)], decision: 'annuler' }), clips: CLIPS, replay: REPLAY })
  assert.match(an, /^Remettre à trancher 1 clip du replay/)
  assert.match(an, /« Pourquoi attendre » \(sans note, écarté\)/)
  assert.match(an, /Déjà à trancher, rien ne change : « Le DOL en 30 s »/)
  for (const t of [c, an]) { texteClavier(t, 'carte clips'); sansOutil(t, 'carte clips') }
})

bloc('preparer les clips d un replay : telegram ou youtube, comme l ecran, aucun credit Opus', () => {
  assert.deepEqual(ok('clips_replay', { source: 'telegram', message_id: 4521 }).params, { source: 'telegram', ref: '4521', personne: null })
  assert.deepEqual(ok('clips_replay', { source: 'telegram', message_id: '4521', personne: 'brice' }).params, { source: 'telegram', ref: '4521', personne: 'brice' })
  assert.deepEqual(ok('clips_replay', { source: 'youtube', lien: ' https://www.youtube.com/watch?v=dQw4w9WgXcQ ', personne: 'mel' }).params,
    { source: 'youtube', ref: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', personne: 'mel' })
  assert.equal(ok('clips_replay', { source: 'youtube', lien: 'https://youtu.be/dQw4w9WgXcQ', personne: 'brice' }).params.ref, 'https://youtu.be/dQw4w9WgXcQ')
  non('clips_replay', { source: 'youtube', lien: 'https://youtube.com.evil.example/x', personne: 'brice' }, /lien/)
  non('clips_replay', { source: 'youtube', lien: 'https://evil.example/youtube.com/x', personne: 'brice' }, /lien/)
  non('clips_replay', { source: 'youtube', lien: 'https://www.youtube.com/watch?v=x y', personne: 'brice' }, /lien/)
  non('clips_replay', { source: 'youtube', lien: 'https://youtu.be/abc' }, /le live de qui/)
  non('clips_replay', { source: 'telegram', message_id: -3 }, /message_id/)
  non('clips_replay', { source: 'telegram', message_id: 12, personne: 'adrien' }, /personne/)
  non('clips_replay', { source: 'drive', ref: 'x' }, /source/)
  assert.equal(P.personneReplayTelegram({ personne: 'brice' }), 'brice')
  assert.equal(P.personneReplayTelegram({ personne: 'autre' }), 'mel', 'comme le cockpit')
  const tg = { messageId: 4521, legende: 'Live du mardi\nanalyse EURUSD', posteLe: '2026-10-21', auteur: 'Mel', personne: 'mel', dureeS: 4440, replayId: null }
  const p = { source: 'telegram', ref: '4521', personne: 'mel' }
  assert.equal(P.refusClipsReplay({ p, telegram: tg, replayExistant: false, demandeEnCours: null }), null)
  assert.match(P.refusClipsReplay({ p, telegram: null, replayExistant: false, demandeEnCours: null }), /n'est pas dans les replays/)
  assert.match(P.refusClipsReplay({ p, telegram: { ...tg, replayId: R1 }, replayExistant: false, demandeEnCours: null }), /déjà préparé/)
  assert.match(P.refusClipsReplay({ p, telegram: tg, replayExistant: false, demandeEnCours: { etat: 'a_faire', poseLabel: 'Brice' } }), /Déjà demandé par Brice/)
  const c = P.carteClipsReplay({ p, telegram: tg })
  assert.match(c, /^Préparer les clips du replay du Live Club « Live du mardi » \(posté le 21\/10\/2026 par Mel, 74 min\), live de Mel :/)
  assert.match(c, /AUCUN CRÉDIT OPUS à ce stade/)
  const yt = P.carteClipsReplay({ p: { source: 'youtube', ref: 'https://youtu.be/abc', personne: 'brice' }, telegram: null })
  assert.match(yt, /^Préparer les clips du live YouTube https:\/\/youtu\.be\/abc, live de Brice/)
  for (const t of [c, yt, P.phraseClipsReplayPose({ p, titre: 'Live du mardi' })]) { texteClavier(t, 'carte replay'); sansOutil(t, 'carte replay') }
})

bloc('envoi a Opus : la plage proposee en minutes:secondes et ses credits (comme clips.py), relue au clic', () => {
  // clips.py : max(10, int(-(-(fin - debut) // 60))) = les minutes commencees, 10 au minimum.
  const py = (debut, fin) => Math.max(10, -Math.floor(-(fin - debut) / 60))
  for (const [d, f] of [[0, 300], [0, 600], [0, 601], [754, 2710.5], [100, 100 + 3600], [0.5, 7200.25]]) {
    assert.equal(P.creditsOpus(d, f), py(d, f), `${d} -> ${f}`)
  }
  assert.equal(P.creditsOpus(754, 2710.5), 33)
  assert.equal(P.horaire(754), '12:34')
  assert.equal(P.horaire(3754), '1:02:34')
  assert.equal(P.dureeLisible(1956.5), '32 min 37 s')
  const a = ok('envoi_opus', { replay_id: R1 })
  assert.deepEqual(a.params, { replay_id: R1, debut_s: null, fin_s: null, credits: null })
  assert.deepEqual(ok('envoi_opus', { replay_id: R1, debut_s: 754, fin_s: 2710.5, credits: 33 }).params, { replay_id: R1, debut_s: 754, fin_s: 2710.5, credits: 33 })
  non('envoi_opus', { replay_id: 'replay-1' }, /replay_id/)
  non('envoi_opus', { replay_id: R1, debut_s: 100, fin_s: 130 }, /trop courte/)
  non('envoi_opus', { replay_id: R1, credits: 3 }, /Crédits/)
  assert.equal(P.refusEnvoiOpus({ replay: REPLAY, demandeEnCours: null }), null)
  assert.match(P.refusEnvoiOpus({ replay: null, demandeEnCours: null }), /Replay inconnu/)
  assert.match(P.refusEnvoiOpus({ replay: { ...REPLAY, etat: 'envoye' }, demandeEnCours: null }), /déjà chez Opus/)
  assert.match(P.refusEnvoiOpus({ replay: { ...REPLAY, plage: null }, demandeEnCours: null }), /pas de plage/)
  assert.match(P.refusEnvoiOpus({ replay: REPLAY, demandeEnCours: { etat: 'en_cours', poseLabel: 'Mélanie' } }), /déjà demandé par Mélanie/)
  const c = P.carteEnvoiOpus(REPLAY)
  assert.match(c, /^Envoyer à OpusClip la plage 12:34 à 45:11 \(32 min 37 s\) du replay « Live du mardi » \(live de Mel du 21\/10\/2026\), 5 de nos meilleurs passages dedans\./)
  assert.match(c, /CELA DÉPENSE 33 CRÉDITS OPUS \(une minute commencée = un crédit, 10 au minimum par envoi\)/)
  assert.match(P.carteEnvoiOpus({ ...REPLAY, creditsDepenses: 12 }), /Déjà dépensés sur ce replay : 12 crédits\./)
  texteClavier(c, 'carte envoi'); sansOutil(c, 'carte envoi')
  // Le clic relit la plage et la compare a la carte avant de poser la demande.
  const serveur = lire('src/lib/agent-gestes-cockpit.ts')
  const envoi = serveur.slice(serveur.indexOf("if (a.type === 'envoi_opus')"))
  assert.ok(envoi.indexOf('Math.abs(pl.debut_s - p.debut_s!)') > 0 && envoi.indexOf('Math.abs(pl.debut_s - p.debut_s!)') < envoi.indexOf('insert into public.cockpit_clips_demandes'))
  assert.match(envoi, /creditsOpus\(pl\.debut_s, pl\.fin_s\) !== p\.credits/)
  assert.match(envoi, /values \('envoyer_opus', \$\{p\.replay_id\}, \$\{replay\.personne\}, \$\{uid\}::uuid\)/, 'meme format que le cockpit : ref = replay_id, personne du replay')
})

// ===========================================================================
// LOT 2 (05/11)
// ===========================================================================

const C1 = U(51), F1 = U(61), Q1 = U(71), Q2 = U(72), M9 = U(91)
const AUJ = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

// ---------------------------------------------------------------------------
// F. Charges
// ---------------------------------------------------------------------------

const CH = {
  outil: 'Supabase (plan Pro)', categorie: 'base et hebergement', montant: 25, devise: 'USD', montant_eur: null, periodicite: 'mois',
  payeur: 'brice', du: '2026-09-25', au: null, a_confirmer: true, note: null,
}

bloc('charge : ajouter (defauts de la table), modifier (seulement ce qui change), retirer ; regles de l ecran', () => {
  const a = ok('charge_fixe', { quoi: 'ajouter', outil: '  Notion  ', montant: '10', payeur: 'Mélanie', du: '2026-11-01' })
  assert.deepEqual(a.params, {
    quoi: 'ajouter', charge_id: null, empreinte: null, outil: 'Notion', categorie: null, montant: 10, devise: 'EUR', montant_eur: null,
    periodicite: 'mois', payeur: 'mel', du: '2026-11-01', au: null, a_confirmer: true, note: null,
  }, 'a confirmer par defaut, comme la table')
  assert.equal(ok('charge_fixe', { quoi: 'ajouter', outil: 'Supabase', montant: '25', devise: 'USD', montant_eur: '23,10' }).params.montant_eur, 23.1)
  assert.equal(ok('charge_fixe', { quoi: 'ajouter', outil: 'Skool', montant: 10, devise: 'EUR', montant_eur: 9 }).params.montant_eur, null, 'en euros, pas d equivalent (comme l ecran)')
  assert.equal(ok('charge_fixe', { quoi: 'ajouter', outil: 'Kit', montant: 'inconnu' }).params.montant, null, 'un prix inconnu reste inconnu')
  assert.equal(ok('charge_fixe', { quoi: 'ajouter', outil: 'Kit', a_confirmer: false }).params.a_confirmer, false)
  assert.equal(ok('charge_fixe', { quoi: 'ajouter', outil: 'Domaine', periodicite: 'annuel', du: '2026-01-01' }).params.periodicite, 'an')
  non('charge_fixe', { quoi: 'ajouter', montant: 10 }, /outil/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'x'.repeat(81) }, /80/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', montant: '-3' }, /montant/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', devise: 'JPY' }, /devise/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', periodicite: 'semaine' }, /periodicite/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', payeur: 'adil' }, /payeur/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', du: '2026-11-31' }, /AAAA-MM-JJ/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', du: '2026-11-10', au: '2026-11-01' }, /avant la date de début/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Domaine', periodicite: 'unique' }, /unique/)
  non('charge_fixe', { quoi: 'ajouter', outil: 'Kit', note: 'x'.repeat(1001) }, /1000/)
  // Modifier : seulement ce qui change ; « aucun » vide un champ facultatif ; un texte vide ou null ne change rien.
  const m = ok('charge_fixe', { quoi: 'modifier', charge_id: C1, montant: '29', payeur: 'aucun', categorie: '', outil: null })
  assert.deepEqual(m.params, { quoi: 'modifier', charge_id: C1, empreinte: null, montant: 29, payeur: null })
  assert.equal(ok('charge_fixe', { quoi: 'modifier', charge_id: C1, au: '2026-11-30', empreinte: 'a1b2c3d4' }).params.empreinte, 'a1b2c3d4')
  non('charge_fixe', { quoi: 'modifier', charge_id: C1 }, /Rien à modifier/)
  non('charge_fixe', { quoi: 'modifier', charge_id: 'charge-1', montant: 3 }, /charge_id/)
  non('charge_fixe', { quoi: 'modifier', charge_id: C1, montant: 3, empreinte: 'xyz' }, /Empreinte/)
  assert.deepEqual(ok('charge_fixe', { quoi: 'retirer', charge_id: C1.toUpperCase(), montant: 5 }).params, { quoi: 'retirer', charge_id: C1, empreinte: null })
  non('charge_fixe', { quoi: 'supprimer', charge_id: C1 }, /quoi/)
})

bloc('charge : la carte dit l outil, le montant, la periodicite, qui paie, depuis quand, et son poids dans la marge', () => {
  const pa = P.lireParamsCharge({ quoi: 'ajouter', outil: 'Notion', categorie: 'outils', montant: '10', payeur: 'brice', du: '2026-11-01', note: 'plan Plus' })
  const ca = P.carteCharge({ p: pa, lue: null })
  assert.match(ca, /^Ajouter la charge « Notion » \(outils\) : 10,00 EUR par mois, payée par Brice, depuis le 01\/11\/2026, en cours\./)
  assert.match(ca, /Elle compte pour 10,00 € par mois dans la marge\./)
  assert.match(ca, /À confirmer : pas encore vue sur une facture\./)
  assert.match(ca, /Note : plan Plus/)
  const cd = P.carteCharge({ p: pa, lue: null, doublon: { ...CH, outil: 'Notion', devise: 'EUR', montant: 8 } })
  assert.match(cd, /Attention, une charge « Notion » court déjà \(8,00 EUR par mois, depuis le 25\/09\/2026, en cours\)/)
  // Le poids dans la marge, comme coutMensuel de l'ecran.
  assert.match(P.poidsMarge(CH), /^À convertir/)
  assert.match(P.poidsMarge({ ...CH, montant_eur: 23.1 }), /23,10 € par mois/)
  assert.match(P.poidsMarge({ ...CH, montant: null }), /un prix inconnu ne compte pas zéro/)
  assert.match(P.poidsMarge({ ...CH, devise: 'EUR', montant: 120, periodicite: 'an' }), /10,00 € par mois/)
  assert.match(P.poidsMarge({ ...CH, devise: 'EUR', montant: 1234.5, periodicite: 'unique', du: '2026-11-04' }), /1 234,50 € dans la marge de novembre 2026/)
  // Modifier : ce qui change, avant et apres.
  const pm = P.lireParamsCharge({ quoi: 'modifier', charge_id: C1, montant: '29', a_confirmer: false, montant_eur: '26,70' })
  const cm = P.carteCharge({ p: pm, lue: CH })
  assert.match(cm, /^Modifier la charge « Supabase \(plan Pro\) » \(base et hebergement\) : 25,00 USD par mois, payée par Brice, depuis le 25\/09\/2026, en cours :/)
  assert.match(cm, /\n- Montant : 25,00 USD devient 29,00 USD ;\n- Équivalent en euros : vide devient 26,70 € ;\n- À confirmer : oui devient non\.\n/)
  assert.match(cm, /Ensuite : 29,00 USD par mois \(soit 26,70 € pour la même période\), payée par Brice, .* Elle compte pour 26,70 € par mois dans la marge\./)
  // Passer en euros vide l'equivalent, comme l'ecran.
  const apres = P.appliquerCharge({ ...CH, montant_eur: 23.1 }, P.lireParamsCharge({ quoi: 'modifier', charge_id: C1, devise: 'EUR' }))
  assert.equal(apres.montant_eur, null)
  assert.deepEqual(P.changementsCharge({ ...CH, montant_eur: 23.1 }, apres), ['devise', 'montant_eur'])
  // Refus avant la carte.
  assert.match(P.refusCharge(pm, null), /inconnue ou déjà retirée/)
  assert.match(P.refusCharge(P.lireParamsCharge({ quoi: 'modifier', charge_id: C1, montant: 25 }), CH), /Rien ne change/)
  assert.match(P.refusCharge(P.lireParamsCharge({ quoi: 'modifier', charge_id: C1, au: '2026-01-01' }), CH), /avant la date de début/)
  assert.equal(P.refusCharge(pm, CH), null)
  const cr = P.carteCharge({ p: P.lireParamsCharge({ quoi: 'retirer', charge_id: C1 }), lue: CH })
  assert.match(cr, /^Retirer la charge « Supabase \(plan Pro\) »/)
  assert.match(cr, /mois passés compris\. La ligne reste en base/)
  // L'empreinte d'une ligne lue.
  assert.match(P.empreinteLigne([1, 'a', null]), /^[0-9a-f]{8}$/)
  assert.notEqual(P.empreinteLigne([1, 'a', null]), P.empreinteLigne([1, 'a', 'x']))
  assert.equal(P.montantFr(1234567.891), '1 234 567,89')
  for (const t of [ca, cd, cm, cr, P.phraseChargeFaite(pm, CH, P.appliquerCharge(CH, pm)), P.phraseChargeFaite(pa, null, P.chargeAAjouter(pa))]) {
    texteClavier(t, 'carte charge'); sansOutil(t, 'carte charge')
  }
})

// ---------------------------------------------------------------------------
// G. Abonnements IA
// ---------------------------------------------------------------------------

const AB = { libelle: 'Claude Max', fournisseur: 'Anthropic', montant: 100, devise: 'USD', periodicite: 'mensuel', debut: '2026-11-01', fin: null, note: null }

bloc('abonnement IA : ajouter (le 1er du mois par defaut, comme l ecran), arreter (aujourd hui par defaut), retirer', () => {
  const a = ok('abonnement_ia', { quoi: 'ajouter', libelle: ' Claude Max ', fournisseur: 'Anthropic', montant: '100', devise: '$' })
  assert.deepEqual(a.params, {
    quoi: 'ajouter', fixe_id: null, libelle: 'Claude Max', fournisseur: 'Anthropic', montant: 100, devise: 'USD',
    periodicite: 'mensuel', debut: `${AUJ.slice(0, 7)}-01`, note: null, empreinte: null,
  })
  assert.equal(ok('abonnement_ia', { quoi: 'ajouter', libelle: 'X', montant: 200, periodicite: 'annuel', debut: '2026-01-15' }).params.debut, '2026-01-15')
  non('abonnement_ia', { quoi: 'ajouter', libelle: 'X', montant: 0 }, /montant/)
  non('abonnement_ia', { quoi: 'ajouter', libelle: 'X', montant: 100001 }, /montant/)
  non('abonnement_ia', { quoi: 'ajouter', libelle: 'X', montant: 10, devise: 'GBP' }, /devise/)
  non('abonnement_ia', { quoi: 'ajouter', montant: 10 }, /libelle/)
  assert.deepEqual(ok('abonnement_ia', { quoi: 'Arrêter', fixe_id: F1 }).params, { quoi: 'arreter', fixe_id: F1, fin: AUJ, empreinte: null })
  assert.equal(ok('abonnement_ia', { quoi: 'arreter', fixe_id: F1, fin: '2026-11-30' }).params.fin, '2026-11-30')
  assert.deepEqual(ok('abonnement_ia', { quoi: 'retirer', fixe_id: F1, montant: 3 }).params, { quoi: 'retirer', fixe_id: F1, empreinte: null })
  non('abonnement_ia', { quoi: 'modifier', fixe_id: F1 }, /quoi/)
  non('abonnement_ia', { quoi: 'arreter', fixe_id: 'x' }, /fixe_id/)
  const ca = P.carteAbonnementIA({ p: P.lireParamsAbonnementIA({ quoi: 'ajouter', libelle: 'Claude Max', fournisseur: 'Anthropic', montant: 100, devise: 'USD', debut: '2026-11-01' }, '2026-11-05'), lu: null })
  assert.match(ca, /^Ajouter l'abonnement IA « Claude Max » \(Anthropic\), 100,00 USD par mois depuis le 01\/11\/2026\./)
  assert.match(ca, /Il compte pour 92,00 € par mois dans la dépense IA \(dollars comptés à 0,92 €\)\./)
  assert.equal(P.USD_EUR_IA, 0.92)
  assert.equal(P.mensuelIA({ montant: 1200, devise: 'EUR', periodicite: 'annuel' }), 100, 'un douzieme par mois (fixeDuMois)')
  const par = P.lireParamsAbonnementIA({ quoi: 'arreter', fixe_id: F1, fin: '2026-11-05' }, '2026-11-05')
  const cs = P.carteAbonnementIA({ p: par, lu: AB })
  assert.match(cs, /^Arrêter l'abonnement IA « Claude Max » \(Anthropic\), 100,00 USD par mois depuis le 01\/11\/2026, au 05\/11\/2026\./)
  assert.match(cs, /Il compte encore pour novembre 2026, plus à partir de décembre 2026\./)
  assert.match(P.carteAbonnementIA({ p: { ...par, fin: '2026-12-31' }, lu: AB }), /plus à partir de janvier 2027/)
  assert.match(P.refusAbonnementIA(par, { ...AB, fin: '2026-11-02' }), /déjà arrêté \(le 02\/11\/2026\)/)
  assert.match(P.refusAbonnementIA({ ...par, fin: '2026-10-01' }, AB), /avant son début/)
  assert.match(P.refusAbonnementIA(par, null), /inconnu ou déjà retiré/)
  const cr = P.carteAbonnementIA({ p: P.lireParamsAbonnementIA({ quoi: 'retirer', fixe_id: F1 }, '2026-11-05'), lu: AB })
  assert.match(cr, /saisie fausse/)
  for (const t of [ca, cs, cr, P.phraseAbonnementFait(par, AB)]) { texteClavier(t, 'carte abonnement'); sansOutil(t, 'carte abonnement') }
  // Le meme taux que l'ecran du cockpit, quand le depot est la.
  const ecran = new URL('../../cockpit/src/lib/depense-ia.ts', import.meta.url)
  if (existsSync(ecran)) assert.match(readFileSync(ecran, 'utf8'), /export const USD_EUR = 0\.92/)
})

// ---------------------------------------------------------------------------
// H. Objectif d'une publication Instagram
// ---------------------------------------------------------------------------

bloc('objectif d une publication Instagram : la grille de l ecran, la carte nomme la publication (date, debut de legende)', () => {
  assert.deepEqual(ok('objectif_publication', { publication_id: ' 17890012345 ', objectif: 'Découverte' }).params, { publication_id: '17890012345', objectif: 'decouverte', avant: null })
  assert.equal(ok('objectif_publication', { publication_id: '1789', objectif: 'communauté', avant: 'sans' }).params.avant, 'sans')
  non('objectif_publication', { publication_id: '1789', objectif: 'notoriete' }, /objectif/)
  non('objectif_publication', { publication_id: 'a b', objectif: 'valeur' }, /publication_id/)
  non('objectif_publication', { publication_id: '1789', objectif: 'valeur', avant: 'nimporte' }, /redemande/)
  const ecran = new URL('../../cockpit/src/views/analyse/InstagramLecture.tsx', import.meta.url)
  if (existsSync(ecran)) {
    const src = readFileSync(ecran, 'utf8')
    // (l'ecran ecrit l'apostrophe echappee dans une chaine entre apostrophes)
    for (const o of P.OBJECTIFS_PUBLICATION) {
      assert.ok(src.includes(`{ cle: '${o.cle}', nom: '${o.nom}', lire: '${o.lire.replace(/'/g, "\\'")}'`), `grille de l'ecran : ${o.cle}`)
    }
  }
  const ch = (c) => String.fromCodePoint(c)
  const PUB = { publicationId: '1789', publieLe: '2026-11-03', type: 'REELS', legende: `Le DOL en 30 secondes ${ch(0x1f525)} ${ch(0x201c)}la base${ch(0x201d)} ${ch(0x2014)} suite\nligne 2` }
  const p = P.lireParamsObjectif({ publication_id: '1789', objectif: 'valeur' })
  const c = P.carteObjectif({ p, pub: PUB, actuel: null })
  assert.match(c, /^Objectif de la publication Instagram du 03\/11\/2026 \(reel\) « Le DOL en 30 secondes "la base" - suite » : Valeur\./)
  assert.match(c, /Avant : aucun objectif\./)
  assert.match(c, /Comment la lire ensuite : regarde d'abord les enregistrements, puis le temps de visionnage\./)
  assert.match(P.carteObjectif({ p, pub: PUB, actuel: 'decouverte' }), /Avant : Découverte\./)
  assert.match(P.refusObjectif(p, null, null), /inconnue/)
  assert.match(P.refusObjectif(p, { ...PUB, type: 'STORY' }, null), /story/)
  assert.match(P.refusObjectif(p, PUB, 'valeur'), /déjà l'objectif « Valeur »/)
  assert.equal(P.refusObjectif(p, PUB, 'decouverte'), null)
  assert.equal(P.extraitClavier('a'.repeat(100), 10), 'aaaaaaaaaa...')
  for (const t of [c, P.phraseObjectifPose(p, PUB)]) { texteClavier(t, 'carte objectif'); sansOutil(t, 'carte objectif') }
})

// ---------------------------------------------------------------------------
// I. Le fonds : note, decision, enquete
// ---------------------------------------------------------------------------

const PERS = { personneId: 'p-jean-dupont', nom: 'Jean Dupont', nature: 'eleve', messages: 466 }

bloc('fonds : note sur une personne connue ou un sujet, texte entier dans la carte, signee, interne', () => {
  assert.deepEqual(ok('note_fonds', { personne_id: 'p-jean-dupont', rubrique: 'Trading', texte: '  Il trade le DAX\n\n\n\nle matin  ', sujet: 'ignore' }).params,
    { personne_id: 'p-jean-dupont', sujet: null, rubrique: 'trading', texte: 'Il trade le DAX\n\nle matin' })
  assert.deepEqual(ok('note_fonds', { sujet: ' Thomas du coaching du 9 ', texte: 'veut un appel' }).params,
    { personne_id: null, sujet: 'Thomas du coaching du 9', rubrique: 'autre', texte: 'veut un appel' })
  assert.equal(ok('note_fonds', { sujet: 'x', texte: `a${String.fromCharCode(0x200b)}b` }).params.texte, 'ab', 'caractere invisible retire')
  assert.equal(ok('note_fonds', { personne_id: 'p-Jean-2', texte: 'x' }).params.personne_id, 'p-Jean-2', 'identifiant garde tel quel')
  non('note_fonds', { texte: 'x' }, /personne_id|sujet/)
  non('note_fonds', { personne_id: 'jean', texte: 'x' }, /personne_id/)
  non('note_fonds', { sujet: 'x', rubrique: 'secret', texte: 'x' }, /rubrique/)
  non('note_fonds', { sujet: 'x', texte: '   ' }, /texte/)
  non('note_fonds', { sujet: 'x', texte: 'x'.repeat(3001) }, /3000/)
  const c = P.carteNoteFonds({ p: P.lireParamsNoteFonds({ personne_id: 'p-jean-dupont', rubrique: 'trading', texte: 'Il trade le DAX le matin.' }), personne: PERS })
  assert.match(c, /^Écrire une note dans le fonds sur Jean Dupont \(élève, 466 messages\), rubrique « Son trading » :\n« Il trade le DAX le matin\. »/)
  assert.match(c, /Signée de ton compte/)
  assert.match(c, /jamais recopiée vers un membre/)
  const ps = P.lireParamsNoteFonds({ sujet: 'Thomas', texte: 'x' })
  const s = P.carteNoteFonds({ p: ps, personne: null })
  assert.match(s, /^Écrire une note dans le fonds sur « Thomas », rubrique « Autre » :/)
  assert.match(s, /boîte de réception/)
  for (const t of [c, s, P.phraseNoteFondsEcrite(ps, null)]) { texteClavier(t, 'carte note'); sansOutil(t, 'carte note') }
  // Les rubriques de l'ecran du cockpit, quand le depot est la.
  const ecran = new URL('../../cockpit/src/lib/fonds-archive.ts', import.meta.url)
  if (existsSync(ecran)) {
    const src = readFileSync(ecran, 'utf8')
    for (const cle of Object.keys(P.RUBRIQUES_FONDS)) assert.ok(src.includes(`{ cle: '${cle}',`), `rubrique de l'ecran : ${cle}`)
  }
})

bloc('fonds : decision sur des propositions d une meme personne, carte avec valeur, confiance et DOMAINE de la source', () => {
  assert.deepEqual(ok('decision_fonds', { proposition_ids: [Q1, Q1.toUpperCase(), Q2], statut: 'accepter' }).params, { proposition_ids: [Q1, Q2], statut: 'acceptee', personne_id: null })
  assert.equal(ok('decision_fonds', { proposition_ids: [Q1], statut: 'proposee', personne_id: 'p-jean-dupont' }).params.personne_id, 'p-jean-dupont')
  non('decision_fonds', { proposition_ids: [], statut: 'acceptee' }, /proposition_ids/)
  non('decision_fonds', { proposition_ids: ['x'], statut: 'acceptee' }, /illisible/)
  non('decision_fonds', { proposition_ids: Array.from({ length: 21 }, (_, i) => U(700 + i)), statut: 'acceptee' }, /20 propositions/)
  non('decision_fonds', { proposition_ids: [Q1], statut: 'fusionner' }, /statut/)
  const PROPS = [
    { propositionId: Q1, personneId: 'p-jean-dupont', champ: 'reseau', reseau: 'instagram', valeur: '@jdtrader', sourceUrl: 'https://www.instagram.com/jdtrader/', confiance: 'haute', statut: 'proposee' },
    { propositionId: Q2, personneId: 'p-jean-dupont', champ: 'societe', reseau: null, valeur: 'JD Conseil', sourceUrl: 'https://www.pappers.fr/entreprise/jd', confiance: 'moyenne', statut: 'acceptee' },
  ]
  const p = P.lireParamsDecisionFonds({ proposition_ids: [Q1, Q2], statut: 'acceptee' })
  assert.equal(P.refusDecisionFonds(p, PROPS), null)
  assert.match(P.refusDecisionFonds(p, PROPS.slice(0, 1)), /Proposition inconnue/)
  assert.match(P.refusDecisionFonds(p, [PROPS[0], { ...PROPS[1], personneId: 'p-autre' }]), /plusieurs personnes/)
  assert.match(P.refusDecisionFonds(P.lireParamsDecisionFonds({ proposition_ids: [Q2], statut: 'acceptee' }), [PROPS[1]]), /déjà acceptées/)
  const c = P.carteDecisionFonds({ p, props: PROPS, personne: PERS })
  assert.match(c, /^Accepter 1 proposition de l'enquête en ligne sur Jean Dupont :\n- Réseau \(instagram\) : « @jdtrader » \(confiance haute, source instagram\.com\)\./)
  assert.match(c, /Elle s'affiche sur sa fiche comme vérifiée en ligne, signée de ton compte\. Rien d'autre ne change/)
  assert.match(c, /Déjà acceptées, rien ne change : 1\./)
  assert.ok(!/https?:|\/entreprise/.test(c), "jamais l'adresse entiere d'une source")
  const r = P.carteDecisionFonds({ p: P.lireParamsDecisionFonds({ proposition_ids: [Q1, Q2], statut: 'refusee' }), props: PROPS, personne: PERS })
  assert.match(r, /^Refuser 2 propositions/)
  assert.match(r, /Refusées, elles restent en base : la prochaine enquête ne les reproposera pas\./)
  assert.equal(P.domaineSource('pas une url'), 'source illisible')
  assert.equal(P.domaineSource(null), 'sans source')
  for (const t of [c, r, P.phraseDecisionFondsFaite(p, 1, PERS)]) { texteClavier(t, 'carte decision fonds'); sansOutil(t, 'carte decision fonds') }
})

bloc('fonds : enquete en ligne, la carte dit qu elle COUTE (cout mesure, ou pas de mesure) et que rien ne s ajoute seul', () => {
  assert.deepEqual(ok('enquete_fonds', { personne_id: 'p-jean-dupont', autre: 'x' }).params, { personne_id: 'p-jean-dupont' })
  non('enquete_fonds', { personne_id: '' }, /personne_id/)
  non('enquete_fonds', { personne_id: 'p-' }, /personne_id/)
  const c = P.carteEnqueteFonds({ personne: PERS, etat: { attente: 0, acceptees: 0, refusees: 0, derniere: null }, cout: { n: 12, moyenneEur: 0.854, maxEur: 1.4 } })
  assert.match(c, /^Lancer une enquête en ligne sur Jean Dupont \(élève, 466 messages\) :/)
  assert.match(c, /CELA COÛTE : deux appels au modèle du cockpit avec recherche web, environ 0,85 € par enquête \(moyenne des 12 dernières, la plus chère 1,40 €\)\./)
  assert.match(c, /Rien ne s'ajoute à sa fiche : chaque proposition attend ta décision\./)
  assert.ok(!/Déjà une enquête/.test(c))
  const sans = P.carteEnqueteFonds({ personne: PERS, etat: { attente: 3, acceptees: 2, refusees: 1, derniere: '2026-09-07' }, cout: null })
  assert.match(sans, /CELA COÛTE : .*Pas encore de mesure ici/)
  assert.match(sans, /Déjà une enquête le 07\/09\/2026 : 3 à trancher, 2 acceptées, 1 refusée/)
  assert.match(P.phraseEnqueteFaite({ nom: 'Jean Dupont', posees: 0, sources: 14 }), /rien de nouveau à proposer \(14 pages consultées\)/)
  assert.match(P.phraseEnqueteFaite({ nom: 'Jean Dupont', posees: 4, sources: 14 }), /4 propositions à trancher \(14 pages consultées\)/)
  for (const t of [c, sans, P.phraseEnqueteFaite({ nom: 'Jean Dupont', posees: 1, sources: 1 })]) { texteClavier(t, 'carte enquete'); sansOutil(t, 'carte enquete') }
  assert.match(AP.libelleBoutonConfirmer('enquete_fonds'), /payant/, 'le bouton dit que ca coute')
})

// ---------------------------------------------------------------------------
// J. Relais d'accueil, K. adresse secondaire
// ---------------------------------------------------------------------------

bloc('relais d accueil : couper ou rallumer, la carte dit ce qu il ne recoit plus et ses boutons', () => {
  assert.deepEqual(ok('relais_accueil', { quoi: 'Couper', telegram_id: '2110821350' }).params, { quoi: 'couper', telegram_id: 2110821350 })
  assert.deepEqual(ok('relais_accueil', { quoi: 'réactiver', telegram_id: 2110821350 }).params, { quoi: 'rallumer', telegram_id: 2110821350 })
  non('relais_accueil', { quoi: 'supprimer', telegram_id: 1 }, /quoi/)
  non('relais_accueil', { quoi: 'couper', telegram_id: 'Alex' }, /telegram_id/)
  const R = { telegramId: 2110821350, nom: 'Alex', actif: true, motifs: ['accueil', 'silence'], enCours: 3, coupeLe: null }
  const pc = P.lireParamsRelais({ quoi: 'couper', telegram_id: 2110821350 })
  const c = P.carteRelais({ p: pc, r: R })
  assert.match(c, /^Couper le relais d'accueil Alex : le bot des membres ne lui envoie plus les nouveaux sans un mot et les silencieux \(14 jours sans message\), dès le prochain passage du matin\./)
  assert.match(c, /3 membres déjà transmis, pas encore faits, restent à marquer depuis le cockpit/)
  assert.match(c, /Rien ne lui est envoyé pour le prévenir\./)
  assert.match(P.carteRelais({ p: pc, r: { ...R, enCours: 1, motifs: ['accueil'] } }), /les nouveaux sans un mot, dès.*\n.*1 membre déjà transmis, pas encore fait, reste/)
  const pr = P.lireParamsRelais({ quoi: 'rallumer', telegram_id: 2110821350 })
  const cr = P.carteRelais({ p: pr, r: { ...R, actif: false, coupeLe: '2026-11-02' } })
  assert.match(cr, /^Rallumer le relais d'accueil Alex \(coupé le 02\/11\/2026\)/)
  assert.match(P.refusRelais(pc, { ...R, actif: false, coupeLe: '2026-11-02' }), /déjà coupé \(depuis le 02\/11\/2026\)/)
  assert.match(P.refusRelais(pr, R), /déjà actif/)
  assert.match(P.refusRelais(pc, null), /inconnu/)
  for (const t of [c, cr, P.phraseRelaisFait(pc, 'Alex'), P.phraseRelaisFait(pr, 'Alex')]) { texteClavier(t, 'carte relais'); sansOutil(t, 'carte relais') }
})

bloc('adresse secondaire : jamais la principale ; la carte dit le membre, l adresse retiree, la principale qui reste, ce que ca change', () => {
  assert.deepEqual(ok('retrait_adresse', { email: ' Bob@X.com ' }).params, { email: 'bob@x.com', membre_id: null })
  assert.equal(ok('retrait_adresse', { email: 'bob@x.com', membre_id: M9 }).params.membre_id, M9)
  non('retrait_adresse', { email: 'bob' }, /email/)
  non('retrait_adresse', { email: 'bob@x.com', membre_id: 'fiche-1' }, /redemande/)
  const A = { email: 'bob@x.com', membreId: M9, principal: false, verifie: true, nom: 'Jean Dupont', principales: ['jean@x.com'], autres: 1, compteSite: true }
  const p = P.lireParamsRetraitAdresse({ email: 'bob@x.com' })
  assert.equal(P.refusRetraitAdresse(p, A), null)
  assert.match(P.refusRetraitAdresse(p, { ...A, principal: true }), /adresse principale de Jean Dupont : elle porte ses paiements/)
  assert.match(P.refusRetraitAdresse(p, null), /aucune fiche/)
  assert.match(P.refusRetraitAdresse({ ...p, membre_id: U(98) }, A), /changé de fiche/)
  const c = P.carteRetraitAdresse(A)
  assert.match(c, /^Retirer l'adresse secondaire bob@x\.com \(vérifiée\) de la fiche de Jean Dupont\. Adresse principale qui reste : jean@x\.com \(et 1 autre adresse secondaire\)\./)
  assert.match(c, /n'est plus relié à cette fiche/)
  assert.match(c, /Live Club actif, ETM, rang Skool/)
  assert.match(c, /Un compte du site se connecte avec cette adresse vérifiée/)
  assert.match(c, /Les paiements restent sur la fiche/)
  assert.match(P.carteRetraitAdresse({ ...A, compteSite: false, autres: 0, verifie: false }), /Aucun compte du site ne porte cette adresse vérifiée\./)
  for (const t of [c, P.phraseAdresseRetiree(A)]) { texteClavier(t, 'carte adresse'); sansOutil(t, 'carte adresse') }
})

// ---------------------------------------------------------------------------
// LOT 2 : les executeurs (lecture du code, sans base)
// ---------------------------------------------------------------------------

bloc('LOT 2 : colonnes d acteur posees, parametres relus, empreinte au clic, droit au fonds, enquete de la route', () => {
  const serveur = lire('src/lib/agent-gestes-cockpit.ts')
  const lot2 = serveur.slice(serveur.indexOf('async function executerLot2('))
  assert.ok(lot2.length > 1000)
  // Charges : pose_par a l'ajout (default auth.uid(), nul ici), retire_par au retrait.
  assert.match(lot2, /insert into public\.cockpit_charges\n\s+\(outil, categorie, montant, devise, montant_eur, periodicite, payeur, du, au, a_confirmer, note, pose_par\)/)
  assert.match(lot2, /\$\{c\.note\}::text, \$\{uid\}::uuid\)`/)
  assert.match(lot2, /update public\.cockpit_charges set retire_le = now\(\), retire_par = \$\{uid\}::uuid/)
  // Abonnements IA : pose_par (not null), retire_par.
  assert.match(lot2, /insert into public\.cockpit_depenses_ia_fixes\n\s+\(libelle, fournisseur, montant, devise, periodicite, debut, note, pose_par\)/)
  assert.match(lot2, /\$\{ab\.note\}::text, \$\{uid\}::uuid\)`/)
  assert.match(lot2, /update public\.cockpit_depenses_ia_fixes set retire_le = now\(\), retire_par = \$\{uid\}::uuid/)
  // Objectif : pose_par et pose_le, comme l'upsert de l'ecran.
  assert.match(lot2, /insert into public\.cockpit_social_objectifs \(plateforme, publication_id, objectif, pose_par, pose_le\)\n\s+values \('instagram', \$\{p\.publication_id\}, \$\{p\.objectif\}, \$\{uid\}::uuid, now\(\)\)/)
  assert.match(lot2, /do update set objectif = excluded\.objectif, pose_par = excluded\.pose_par, pose_le = excluded\.pose_le/)
  // Fonds : ecrit_par ; decide_par ET decide_le (le trigger ne pose decide_le que pour authenticated).
  assert.match(lot2, /insert into public\.cockpit_arch_notes \(personne_id, sujet, rubrique, texte, ecrit_par\)/)
  assert.match(lot2, /\$\{p\.texte\}, \$\{uid\}::uuid\)`/)
  assert.match(lot2, /set statut = \$\{p\.statut\}, decide_par = \$\{uid\}::uuid, decide_le = now\(\)/)
  // Relais : coupe_par par un second update, apres celui d'actif (le trigger le remet a auth.uid()).
  const relais = lot2.slice(lot2.indexOf("a.type === 'relais_accueil'"), lot2.indexOf("a.type === 'retrait_adresse'"))
  assert.ok(relais.indexOf('set actif = ') > 0 && relais.indexOf('set actif = ') < relais.indexOf('set coupe_par = ${uid}::uuid'))
  assert.match(relais, /and not actif`/)
  // Adresse : jamais la principale, et la fiche lue par la carte.
  assert.match(lot2, /delete from public\.cockpit_membre_emails\n\s+where email = \$\{p\.email\} and principal = false and membre_id = \$\{p\.membre_id\}::uuid/)
  // Le fonds : acces_fonds au clic (le compte qui confirme) pour les trois gestes, et avant la carte (le compte qui parle).
  for (const t of ['note_fonds', 'decision_fonds', 'enquete_fonds']) {
    const debut = lot2.indexOf(`a.type === '${t}'`)
    const corps = lot2.slice(debut, lot2.indexOf('if (a.type ===', debut + 10))
    assert.match(corps, /if \(!\(await voitLeFonds\(uid\)\)\) throw new RefusAction/, `acces au fonds au clic : ${t}`)
  }
  assert.match(serveur, /if \(action\.type === 'note_fonds' \|\| action\.type === 'decision_fonds' \|\| action\.type === 'enquete_fonds'\) \{\n\s+if \(!\(await voitLeFonds\(userId\)\)\) return \{ erreur:/)
  assert.match(serveur, /select 1 as ok from public\.cockpit_allowlist where user_id = \$\{userId\}::uuid and acces_fonds/)
  // Chaque executeur relit ses parametres (ce qui s'execute est ce qui a ete valide).
  for (const lecteur of ['lireParamsCharge', 'lireParamsAbonnementIA', 'lireParamsObjectif', 'lireParamsNoteFonds', 'lireParamsDecisionFonds', 'lireParamsEnqueteFonds', 'lireParamsRelais', 'lireParamsRetraitAdresse']) {
    assert.ok(lot2.includes(`${lecteur}(a.params`), `${lecteur} au clic`)
  }
  // Ce qui s'ecrit est ce que la carte a lu : comparaison sous verrou AVANT l'ecriture.
  for (const [quoi, ecrit] of [
    ['La charge a changé depuis la carte', 'update public.cockpit_charges'],
    ["L'abonnement a changé depuis la carte", 'update public.cockpit_depenses_ia_fixes'],
    ["L'objectif de cette publication a changé", 'insert into public.cockpit_social_objectifs'],
    ['Les propositions de la carte ont changé', 'update public.cockpit_arch_propositions'],
    ['refusRetraitAdresse(p, lue)', 'delete from public.cockpit_membre_emails'],
  ]) {
    assert.ok(lot2.indexOf(quoi) > 0 && lot2.indexOf(quoi) < lot2.indexOf(ecrit), quoi)
  }
  assert.match(lot2, /lireCharge\(tx, p\.charge_id as string, true\)/)
  assert.match(lot2, /lireAbonnementIA\(tx, p\.fixe_id as string, true\)/)
  // L'enquete : la meme que la route, sans texte du web dans la phrase du clic.
  assert.match(lot2, /const \{ menerEnquete, preparerEnquete \} = await import\('@\/lib\/fonds-enquete'\)/)
  assert.match(lot2, /issue = await menerEnquete\(uid, prep\)/)
  const enq = lot2.slice(lot2.indexOf("a.type === 'enquete_fonds'"), lot2.indexOf("a.type === 'relais_accueil'"))
  assert.ok(!/issue\.resume|issue\.homonymes/.test(enq), 'ni resume ni homonymes du modele dans la phrase')
  const route = lire('src/app/api/cockpit/enquete/route.ts')
  assert.match(route, /const prep = await preparerEnquete\(personneId\)/)
  assert.match(route, /const r = await menerEnquete\(userId, prep\)/)
  assert.match(route, /\{ error: 'Personne inconnue du fonds' \}, \{ status: 404, headers: cors \}/)
  assert.match(route, /\{ error: 'Réservé aux comptes qui voient le fonds' \}, \{ status: 403, headers: cors \}/)
  assert.match(route, /\{ error: aiErrorMessage\(err, 'ANTHROPIC_API_KEY_COCKPIT'\) \},\n\s+\{ status: 502, headers: cors \}/)
  assert.ok(!/messages\.create/.test(route), "plus d'appel au modele dans la route : il est dans fonds-enquete.ts")
  const fe = lire('src/lib/fonds-enquete.ts')
  assert.equal([...fe.matchAll(/logAiUsage\(userId, 'cockpit', modele, \w+\.usage, null, \{ usage: 'enquete', echange \}\)/g)].length, 2, 'deux appels, comptes au poste enquete')
  assert.match(fe, /max_uses: 6/)
  // La carte de l'enquete, sans cle du modele : affichee sans bouton.
  assert.match(serveur, /aiKeyFor\('cockpit'\) \? c : \{ \.\.\.c, manque:/)
  // Le clic de la fenetre du cockpit tient une enquete (une a trois minutes).
  assert.match(lire('src/app/api/cockpit/agent/action/route.ts'), /export const maxDuration = 300/)
  // Une table absente ou une contrainte : refus clair, rien n'a change.
  assert.match(serveur, /if \(relationAbsente\(err\) && TABLES_LOT2\[action\.type\]\)/)
  assert.match(serveur, /La base a refusé cette écriture \(contrainte de la table\)/)
})

// ---------------------------------------------------------------------------
// Commun : resume de secours, logs, type inconnu
// ---------------------------------------------------------------------------

bloc('resumeAction et paramsPourLog : une phrase sans tiret long, des logs sans email ni raison ni lien', () => {
  const exemples = {
    acces_academie: { email: 'arthur@example.com', offre: 'module-ict-bases', raison: 'geste commercial secret' },
    retrait_acces_academie: { acces_id: U(7), raison: 'raison secrete' },
    rangement_academie: { geste: 'statut', cible: 'lecon', ids: [L2], statut: 'publie' },
    acces_mentorat: { quoi: 'accorder', email: 'arthur@example.com', note: 'note secrete' },
    decision_clip: { clip_ids: [U(41)], decision: 'garder', note: 'note secrete' },
    clips_replay: { source: 'youtube', lien: 'https://youtu.be/abc', personne: 'mel' },
    envoi_opus: { replay_id: R1, debut_s: 754, fin_s: 2710.5, credits: 33 },
    // (05/11, LOT 2)
    charge_fixe: { quoi: 'ajouter', outil: 'Notion', montant: 10, note: 'note secrete' },
    abonnement_ia: { quoi: 'ajouter', libelle: 'Claude Max', montant: 100, note: 'note secrete' },
    objectif_publication: { publication_id: '1789', objectif: 'valeur' },
    note_fonds: { personne_id: 'p-jean-dupont', texte: 'texte secret' },
    decision_fonds: { proposition_ids: [Q1], statut: 'acceptee', personne_id: 'p-jean-dupont' },
    enquete_fonds: { personne_id: 'p-jean-dupont' },
    relais_accueil: { quoi: 'couper', telegram_id: 2110821350 },
    retrait_adresse: { email: 'bob@x.com', membre_id: M9 },
  }
  for (const t of TYPES) {
    const a = ok(t, exemples[t])
    const r = S.resumeAction(a)
    assert.ok(r.length > 10, t)
    texteClavier(r, `resume ${t}`)
    const log = JSON.stringify(S.paramsPourLog(a))
    assert.ok(!/@|secret|https?:|youtu\.be/.test(log), `${t} : log trop bavard ${log}`)
    // (05/11, LOT 2) Ni nom de personne du fonds (personne_id en porte un), ni montant, ni identifiant Telegram d'un membre.
    assert.ok(!/jean|dupont|2110821350|"montant":/.test(log), `${t} : log trop bavard ${log}`)
  }
  assert.match(S.resumeAction(ok('envoi_opus', exemples.envoi_opus)), /33 crédits Opus/)
  assert.equal(P.estTypeGesteCockpit('code_promo'), false)
  assert.equal(typeof S.validerAction({ type: 'gestes_inconnus', params: {} }), 'string')
})

// ---------------------------------------------------------------------------
// L'agent : outils, types, boutons, descriptions, prompt
// ---------------------------------------------------------------------------

bloc('TYPE_PAR_OUTIL, OUTILS, boutons et descriptions sont coherents', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  const noms = [...src.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map(m => m[1])
  const table = src.slice(src.indexOf('const TYPE_PAR_OUTIL'), src.indexOf('}', src.indexOf('const TYPE_PAR_OUTIL')))
  const paires = Object.fromEntries([...table.matchAll(/^\s+(proposer_\w+): '(\w+)',$/gm)].map(m => [m[1], m[2]]))
  for (const [outil, type] of Object.entries(OUTIL_DE)) {
    assert.ok(noms.includes(outil), `${outil} absent de OUTILS`)
    assert.equal(paires[outil], type, `${outil} -> ${type}`)
    assert.notEqual(AP.libelleBoutonConfirmer(type), '✅ Confirmer et exécuter', `bouton de ${type}`)
    texteClavier(AP.libelleBoutonConfirmer(type).slice(2), `bouton ${type}`)
    assert.ok(AP.DESCRIPTIONS_OUTILS[outil] && !/_/.test(AP.DESCRIPTIONS_OUTILS[outil]), `description de ${outil}`)
    assert.ok(src.includes(outil, src.indexOf('const SYSTEM_PROMPT')) && src.indexOf(outil, src.indexOf('const SYSTEM_PROMPT')) < src.indexOf("// L'outil unique"), `${outil} cite dans le prompt`)
  }
  // Chaque type du lot a exactement un outil, et tous sont des types valides.
  assert.deepEqual(Object.values(OUTIL_DE).sort(), [...P.TYPES_GESTES_COCKPIT].sort())
  for (const type of Object.values(paires)) assert.ok(typeof AP.libelleBoutonConfirmer(type) === 'string')
  assert.match(AP.libelleBoutonConfirmer('envoi_opus'), /payant/, 'le bouton dit que ca coute')
  // Le geste sans carte : dans OUTILS, pas dans TYPE_PAR_OUTIL, dans GESTES_SANS_CARTE (refuse sous prudence).
  assert.ok(noms.includes('marquer_fil_traite'))
  assert.ok(!('marquer_fil_traite' in paires) && !/marquer_fil_traite: '/.test(src), 'pas une action a carte')
  assert.match(src, /const GESTES_SANS_CARTE = new Set\(\[[^\]]*'marquer_fil_traite'[^\]]*\]\)/)
  assert.match(src, /if \(prudence && \(TYPE_PAR_OUTIL\[bloc\.name\] \|\| GESTES_SANS_CARTE\.has\(bloc\.name\)\)\)/)
  assert.ok(AP.DESCRIPTIONS_OUTILS.marquer_fil_traite)
  assert.equal(AP.sansNomsOutils('Je propose proposer_envoi_opus.'), "Je propose la carte d'envoi à Opus.")
  // Le prompt compte toujours ses outils Stripe a part, et les quinze des deux lots dans leur parenthese (sept au LOT 1, huit au LOT 2).
  const parenthese = /\(et quinze pour les gestes du cockpit, décrits plus bas : ([^)]+)\)/.exec(src)
  assert.ok(parenthese, 'la parenthese des gestes du cockpit')
  assert.deepEqual(parenthese[1].split(', '), Object.keys(OUTIL_DE))
  assert.equal(Object.keys(OUTIL_DE).length, 15)
})

bloc('la boucle : controle avant la carte (compte qui parle), avant la repartition ; carte composee par le serveur', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  const boucle = src.slice(src.indexOf('const typeAction = TYPE_PAR_OUTIL'))
  const i = boucle.indexOf('estTypeGesteCockpit(action.type)')
  assert.ok(i > 0 && i < boucle.indexOf("action.compte === 'cockpit'"), 'avant la repartition (compte cockpit)')
  assert.match(boucle, /const controle = await controlerGesteCockpit\(action, userId\)/)
  assert.match(src, /resume: carte \?\? \(resumeAction\(action\)/)
  // Les deux canaux : la meme revalidation stricte, le meme executeur, l'acteur agent:<uuid>.
  const tg = lire('src/lib/agent-cockpit-telegram.ts')
  assert.match(tg, /const action = validerAction\(consommee\[0\]\.action_en_attente\)/)
  assert.match(tg, /executerAction\(action, `agent:\$\{compte\.user_id\}`\)/)
  const web = lire('src/app/api/cockpit/agent/action/route.ts')
  assert.match(web, /const action = validerAction\(consommee\[0\]\.action\)/)
  assert.match(web, /executerAction\(action, `agent:\$\{userId\}`\)/)
  const stripe = lire('src/lib/stripe-actions.ts')
  assert.match(stripe, /if \(estTypeGesteCockpit\(a\.type\)\) \{\n\s+const lu = lireParamsGesteCockpit\(a\.type, p, \{ aujourdhui: jourParis\(new Date\(\)\) \}\)/)
  const exec = stripe.slice(stripe.indexOf('export async function executerAction'))
  assert.ok(exec.indexOf('estTypeGesteCockpit(a.type)') > 0 && exec.indexOf('estTypeGesteCockpit(a.type)') < exec.indexOf("a.type === 'retirer_telegram'"), 'avant les branches Telegram et Stripe')
  assert.match(exec, /const \{ executerGesteCockpit \} = await import\('@\/lib\/agent-gestes-cockpit'\)\n\s+return executerGesteCockpit\(a, acteur\)/)
})

bloc('les executeurs posent les colonnes d acteur (auth.uid() est nul cote serveur) et reprennent la logique des routes', () => {
  const serveur = lire('src/lib/agent-gestes-cockpit.ts')
  // Clips : decide_le, decide_par, decide_label poses a la main ; la demande porte pose_par.
  assert.match(serveur, /decide_le = now\(\), decide_par = \$\{uid\}::uuid, decide_label = \$\{label\}::text/)
  assert.match(serveur, /from public\.cockpit_allowlist a where a\.user_id = \$\{userId\}::uuid/, 'libelle comme le trigger')
  const inserts = [...serveur.matchAll(/insert into public\.cockpit_clips_demandes \(action, ref, personne, pose_par\)/g)]
  assert.equal(inserts.length, 2, 'les deux demandes posent pose_par')
  // (05/11) Compte sur la partie LOT 1 du fichier : le LOT 2 (plus bas) a ses propres inserts, verifies dans son bloc.
  const lot1 = serveur.slice(0, serveur.indexOf('const TABLES_LOT2'))
  assert.ok(lot1.length > 1000)
  assert.equal([...lot1.matchAll(/\$\{uid\}::uuid\)`/g)].length, 2)
  // Academie : la meme fonction que la route, l'acteur agent:<uuid> en pose_par / retire_par.
  assert.match(serveur, /accorderAccesAcademieServeur\(\{ action: 'accorder', \.\.\.p \}, acteur\)/)
  assert.match(serveur, /retirerAccesAcademieServeur\(\{ action: 'retirer', accesId: p\.acces_id, raison: p\.raison \}, acteur\)/)
  assert.match(serveur, /return executerGeste\(tx, uid, g\)/, 'academie_editions.par = le compte qui confirme')
  assert.match(serveur, /if \(!estAdmin\(await roleAcademie\(uid\)\)\) throw new RefusAction/, 'admin du site, comme la route')
  assert.match(serveur, /if \(empreinteRangement\(await lireArbre\(tx\), g\) !== p\.empreinte\) return \{ issue: 'change' as const \}/)
  assert.match(serveur, /accorderMentorat\(p\.email, p\.note\)/)
  assert.match(serveur, /retirerMentorat\(p\.email\)/)
  // Chaque executeur relit ses parametres (ce qui s'execute est ce qui a ete valide).
  const exec = serveur.slice(serveur.indexOf('async function executer('))
  for (const lecteur of ['lireParamsAccesAcademie', 'lireParamsRetraitAcademie', 'lireParamsRangement', 'lireParamsMentorat', 'lireParamsDecisionClip', 'lireParamsClipsReplay', 'lireParamsEnvoiOpus']) {
    assert.ok(exec.includes(`${lecteur}(a.params`), `${lecteur} au clic`)
  }
  // Les routes du cockpit appellent les memes fonctions, sans SQL a elles.
  const routeAca = lire('src/app/api/cockpit/academie/route.ts')
  assert.match(routeAca, /accorderAccesAcademieServeur\(geste, acteur\)/)
  assert.match(routeAca, /retirerAccesAcademieServeur\(geste, acteur\)/)
  assert.ok(!/SQL_GESTE_(ACCORDER|RETIRER)/.test(routeAca))
  assert.match(routeAca, /\{ error: 'Offre inconnue\.' \}, \{ status: 400, headers \}/)
  assert.match(routeAca, /\{ ok: true, deja: true, acces_id: r\.accesId \}/)
  assert.match(routeAca, /'Accès inconnu ou déjà retiré : relis la liste\.' \}, \{ status: 409, headers \}/)
  const routeMen = lire('src/app/api/cockpit/mentorat/route.ts')
  assert.ok(!/prisma\.mentoratGrant/.test(routeMen))
  assert.match(routeMen, /await accorderMentorat\(email, note\)/)
  assert.match(routeMen, /\{ ok: true, retires: count \}/)
  const lib = lire('src/lib/academie/gestes-cockpit.ts')
  assert.match(lib, /SQL_GESTE_ACCORDER, geste\.email, geste\.offre, geste\.fin, acteur, noteAccorder\(geste\.raison\)/)
  assert.match(lib, /SQL_GESTE_RETIRER, geste\.accesId, acteur, ajoutRetrait\(geste\.raison\)/)
  // L'arbre : la meme fonction et le meme verrou que /api/academie/arbre.
  assert.match(lire('src/app/api/academie/arbre/route.ts'), /executerGeste\(tx, p\.userId, geste\)/)
})

// ---------------------------------------------------------------------------
// E. « Deja traite » par la phrase
// ---------------------------------------------------------------------------

bloc('deja traite : seulement sur l ordre du titulaire, dans ses mots', () => {
  const oui = [
    "c'est réglé pour Arthur", 'marque traité le fil 1a2b3c4d', 'Mel lui a répondu sur WhatsApp', 'Deja traite pour Loup',
    `c${String.fromCharCode(0x2019)}est bon pour lui`, 'je me suis occupé de Thomas, il est géré', 'résolu', 'plus besoin pour Arthur',
  ]
  for (const t of oui) assert.equal(P.ordreFilTraiteExplicite(t, null), true, t)
  const non2 = ['', '   ', "réponds-lui : merci pour ton message", 'qui attend un humain ?', 'rends la main au bot', 'Parle-moi de Arthur']
  for (const t of non2) assert.equal(P.ordreFilTraiteExplicite(t, null), false, t)
  assert.equal(P.ordreFilTraiteExplicite('oui', 'Je marque la demande de Arthur traitée ?'), true, 'accord a la proposition')
  assert.equal(P.ordreFilTraiteExplicite('oui', 'Je lui réponds ça ?'), false, 'accord a autre chose')
  assert.equal(P.ordreFilTraiteExplicite(null, 'traitée ?'), false)
  texteClavier(P.REFUS_FIL_TRAITE_SANS_ORDRE, 'refus deja traite')
  const src = lire('src/lib/agent-cockpit.ts')
  const corps = src.slice(src.indexOf("if (bloc.name === 'marquer_fil_traite')"), src.indexOf('// Un brouillon de post (19/10)'))
  assert.ok(corps.indexOf('canal.essai') < corps.indexOf('ordreFilTraiteExplicite('), 'rien en essai')
  assert.ok(corps.indexOf('ordreFilTraiteExplicite(canal.texteTitulaire') < corps.indexOf('marquerFilTraitePourAgent('), "l'ordre du titulaire avant le geste")
  assert.match(corps, /marquerFilTraitePourAgent\(bloc\.input, resoudrePersonnePourSupport, userId\)/, 'le compte qui parle')
  assert.ok(src.indexOf("bloc.name === 'marquer_fil_traite'") < src.indexOf('const resultat = await executerSql(sql, accesFonds)'))
  const rm = lire('src/lib/reponse-membre.ts')
  const f = rm.slice(rm.indexOf('export async function marquerFilTraitePourAgent'), rm.indexOf('export async function executerReponseMembre'))
  assert.match(f, /const r = await resoudreFil\(fil\.slice\(0, 120\), resoudre\)/, 'le fil se designe comme pour rendre la main')
  assert.match(f, /traiterFilHorsBot\(r\.choix\.fil\.id, userId, /, 'le geste du bouton')
  assert.match(f, /phraseFilTraite\(issue, r\.choix\.fil\.reference\)/)
  assert.match(src, /DÉJÀ TRAITÉ \(05\/11\)/)
})

bloc('textes visibles du lot : prompt et descriptions d outils sans tiret long ni caractere hors clavier', () => {
  const src = lire('src/lib/agent-cockpit.ts')
  const section = src.slice(src.indexOf("LES GESTES DU COCKPIT, D'ICI"), src.indexOf('LES DEMANDES QUE TU NE SAIS PAS ENCORE TRAITER'))
  assert.ok(section.length > 500)
  texteClavier(section, 'prompt, gestes du cockpit')
  const traite = src.slice(src.indexOf('- DÉJÀ TRAITÉ (05/11)'), src.indexOf('\n', src.indexOf('- DÉJÀ TRAITÉ (05/11)')))
  texteClavier(traite, 'prompt, deja traite')
  for (const outil of [...Object.keys(OUTIL_DE), 'marquer_fil_traite']) {
    const i = src.indexOf(`name: '${outil}'`)
    const desc = src.slice(i, src.indexOf("required: [", i))
    texteClavier(desc, `outil ${outil}`)
  }
  for (const f of ['src/lib/agent-gestes-cockpit-pur.ts', 'src/lib/agent-gestes-cockpit.ts']) {
    assert.ok(!HORS_CLAVIER.test(lire(f)) && !INVISIBLES.test(lire(f)), `${f} : caractere hors clavier`)
  }
})

console.log(`\n${n} blocs ok`)
process.exit(0)
