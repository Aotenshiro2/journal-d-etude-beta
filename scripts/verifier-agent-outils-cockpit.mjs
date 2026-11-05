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
// Aucune base, aucun reseau, aucun appel au modele.
// Lancement (Node 22, depuis apps/journal-d-etude) : node scripts/verifier-agent-outils-cockpit.mjs
// Sort en code 1 au premier ecart.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const TYPES = ['acces_academie', 'retrait_acces_academie', 'rangement_academie', 'acces_mentorat', 'decision_clip', 'clips_replay', 'envoi_opus']
const OUTIL_DE = {
  proposer_acces_academie: 'acces_academie',
  proposer_retrait_acces_academie: 'retrait_acces_academie',
  proposer_rangement_academie: 'rangement_academie',
  proposer_acces_mentorat: 'acces_mentorat',
  proposer_decision_clip: 'decision_clip',
  proposer_clips_replay: 'clips_replay',
  proposer_envoi_opus: 'envoi_opus',
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
  }
  for (const t of TYPES) {
    const a = ok(t, exemples[t])
    const r = S.resumeAction(a)
    assert.ok(r.length > 10, t)
    texteClavier(r, `resume ${t}`)
    const log = JSON.stringify(S.paramsPourLog(a))
    assert.ok(!/@|secret|https?:|youtu\.be/.test(log), `${t} : log trop bavard ${log}`)
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
  // Le prompt compte toujours ses outils Stripe a part, et les sept du lot dans leur parenthese.
  assert.match(src, /\(et sept pour les gestes du cockpit, décrits plus bas : proposer_acces_academie, proposer_retrait_acces_academie, proposer_rangement_academie, proposer_acces_mentorat, proposer_decision_clip, proposer_clips_replay, proposer_envoi_opus\)/)
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
  assert.equal([...serveur.matchAll(/\$\{uid\}::uuid\)`/g)].length, 2)
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
  assert.ok(src.indexOf("bloc.name === 'marquer_fil_traite'") < src.indexOf('const resultat = await executerSql(sql)'))
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
