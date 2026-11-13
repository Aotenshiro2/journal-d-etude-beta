// Verification HORS LIGNE du calendrier des lives (13/11/2026) : la REGLE du
// lien (qui y a droit, et quand), ce que la page d'un membre recoit (champs
// prevus, lien dans l'etat 'pret' seulement), la VALIDATION d'un lien colle
// par l'equipe, le nettoyage des textes, la lecture des demandes du cockpit,
// la migration (lue comme un fichier) et le code des routes (aucun lien ni
// titre dans les journaux, allowlist du cockpit, chemin public exact, aucune
// minuterie). Fonctions pures et lecture de fichiers : aucune base, aucun reseau.
//
// Lancement (depuis apps/journal-d-etude) : node scripts/verifier-lives.mjs
// Contre la base (transaction annulee) : scripts/essayer-migration-lives.mjs.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import * as L from '../src/lib/academie/lives.ts'

let blocs = 0
function bloc(nom, fn) {
  fn()
  blocs++
  console.log(`ok  ${nom}`)
}
const lire = chemin => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const c = (...cps) => String.fromCodePoint(...cps)

const MIGRATION = 'sites/Aoknowledgecom/supabase/migrations/20261113200000_academie_lives.sql'
function texteMigration() {
  const candidats = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${MIGRATION}`) : null,
    new URL(`../../../${MIGRATION}`, import.meta.url),
  ].filter(Boolean)
  const trouve = candidats.find(u => existsSync(u))
  if (!trouve) throw new Error(`migration introuvable : poser AOK_WORKSPACE (${MIGRATION})`)
  return readFileSync(trouve, 'utf8')
}

const MAINTENANT = Date.parse('2026-11-13T12:00:00Z')
const NON = { equipe: false, admin: false, etm: false, vip: false, liveClub: 'non' }

bloc('le lecteur : Live Club au sens des lives = abonnement, ETM, VIP, equipe ; jamais un faux non', () => {
  assert.deepEqual(L.lecteurDe(NON, 'communaute'), { connecte: true, liveClub: 'non', programme: false })
  assert.deepEqual(L.lecteurDe(NON, 'club_10'), { connecte: true, liveClub: 'non', programme: true })
  assert.deepEqual(L.lecteurDe(NON, 'eleve'), { connecte: true, liveClub: 'non', programme: true })
  assert.deepEqual(L.lecteurDe({ ...NON, liveClub: 'oui' }, 'live_club'), { connecte: true, liveClub: 'oui', programme: true })
  for (const k of ['equipe', 'admin', 'etm', 'vip']) {
    assert.equal(L.lecteurDe({ ...NON, [k]: true, liveClub: 'non_lu' }, 'communaute').liveClub, 'oui', k)
  }
  assert.equal(L.lecteurDe({ ...NON, liveClub: 'inconnu' }, 'communaute').liveClub, 'inconnu')
  assert.equal(L.lecteurDe(NON, null).programme, false)
})

bloc('le droit au lien par niveau (tous, programme, live_club)', () => {
  const v = { connecte: false }
  const g = L.lecteurDe(NON, 'communaute')
  const p = L.lecteurDe(NON, 'club_10')
  const lc = L.lecteurDe({ ...NON, liveClub: 'oui' }, 'live_club')
  const x = L.lecteurDe({ ...NON, liveClub: 'inconnu' }, 'communaute')
  const xp = L.lecteurDe({ ...NON, liveClub: 'inconnu' }, 'club_10')
  const table = {
    tous: [v, 'connexion', g, 'oui', p, 'oui', lc, 'oui', x, 'oui'],
    programme: [v, 'connexion', g, 'non', p, 'oui', lc, 'oui', x, 'inconnu', xp, 'oui'],
    live_club: [v, 'connexion', g, 'non', p, 'non', lc, 'oui', x, 'inconnu', xp, 'inconnu'],
  }
  for (const [niveau, paires] of Object.entries(table)) {
    for (let i = 0; i < paires.length; i += 2) assert.equal(L.aDroit(niveau, paires[i]), paires[i + 1], `${niveau} #${i / 2}`)
  }
})

const LIGNE = {
  cle: 's:b71ce000-0000-4000-8000-000000000001:2026-11-17', serie_id: 'b71ce000-0000-4000-8000-000000000001', live_id: 'x',
  date_serie: new Date('2026-11-17T00:00:00Z'), titre: 'Live de Brice', animateur: 'Brice', genre: 'aok', description: null,
  debut: new Date('2026-11-17T19:00:00Z'), debut_prevu: new Date('2026-11-17T19:00:00Z'), duree_min: 90, acces: 'live_club',
  lien: 'https://meet.google.com/abc-defg-hij', lien_le: new Date('2026-11-17T18:50:00Z'), lien_serie: false, statut: 'prevu',
}

bloc('la fenetre du lien : 30 minutes avant le debut, jusqu a la fin', () => {
  const lc = L.lecteurDe({ ...NON, liveClub: 'oui' }, 'live_club')
  const t = s => Date.parse(s)
  assert.equal(L.etatLien(LIGNE, lc, t('2026-11-17T18:29:59Z')), 'avant')
  assert.equal(L.etatLien(LIGNE, lc, t('2026-11-17T18:30:00Z')), 'pret')
  assert.equal(L.etatLien(LIGNE, lc, t('2026-11-17T20:29:59Z')), 'pret')
  assert.equal(L.etatLien(LIGNE, lc, t('2026-11-17T20:30:00Z')), 'fini')
  assert.equal(L.etatLien({ ...LIGNE, lien: null }, lc, t('2026-11-17T18:45:00Z')), 'attente')
  assert.equal(L.etatLien({ ...LIGNE, statut: 'annule' }, lc, t('2026-11-17T18:45:00Z')), 'annule')
  // Un niveau inconnu en base vaut le plus ferme.
  assert.equal(L.etatLien({ ...LIGNE, acces: 'n_importe' }, L.lecteurDe(NON, 'club_10'), t('2026-11-17T18:45:00Z')), 'ferme')
})

bloc('ce que la page recoit : champs prevus, lien dans l etat pret seulement, deplacement signale', () => {
  const lc = L.lecteurDe({ ...NON, liveClub: 'oui' }, 'live_club')
  const champs = 'acces,animateur,cle,debut,deplace_de,description,duree_min,etat,fin,genre,lien,ouvre_le,statut,titre'
  for (const [lecteur, quand, etat] of [
    [{ connecte: false }, '2026-11-17T18:45:00Z', 'connexion'],
    [L.lecteurDe(NON, 'communaute'), '2026-11-17T18:45:00Z', 'ferme'],
    [lc, '2026-11-17T12:00:00Z', 'avant'],
    [lc, '2026-11-17T18:45:00Z', 'pret'],
  ]) {
    const v = L.vueMembre(LIGNE, lecteur, Date.parse(quand))
    assert.equal(Object.keys(v).sort().join(','), champs)
    assert.equal(v.etat, etat)
    assert.equal(v.lien, etat === 'pret' ? LIGNE.lien : null)
    assert.equal(v.ouvre_le, '2026-11-17T18:30:00.000Z')
    assert.equal(v.fin, '2026-11-17T20:30:00.000Z')
    assert.equal(v.deplace_de, null)
    assert.ok(!JSON.stringify(v).includes('live_id') && !JSON.stringify(v).includes('lien_le'))
  }
  const dep = L.vueMembre({ ...LIGNE, debut: new Date('2026-11-18T18:30:00Z') }, lc, MAINTENANT)
  assert.equal(dep.deplace_de, '2026-11-17T19:00:00.000Z')
  const ponctuel = L.vueMembre({ ...LIGNE, serie_id: null, debut_prevu: new Date('2026-11-17T10:00:00Z') }, lc, MAINTENANT)
  assert.equal(ponctuel.deplace_de, null, 'un ponctuel n est jamais deplace par rapport a une serie')
})

bloc('un lien colle par l equipe : https complet seulement', () => {
  for (const ok of [
    'https://meet.google.com/abc-defg-hij',
    'https://us02web.zoom.us/j/81234567890?pwd=AbCdEf123',
    'https://www.futureslearn.com/live-fixing?ref=brice',
    '  https://youtube.com/live/xyz  ',
  ]) assert.ok(L.lireLien(ok), ok)
  for (const non of [
    'http://meet.google.com/abc', 'javascript:alert(1)', 'data:text/html,x', 'meet.google.com/abc', 'https://user:pass@exemple.fr/x',
    'https://exemple.fr/a b', 'https://exemple.fr/<script>', `https://exemple.fr/${c(0x200b)}x`, `https://exemple${c(0x202e)}.fr/x`,
    'https://localhost/x', 'https://exemple.fr./x', `https://exemple.fr/${'a'.repeat(500)}`, '', null, 42, 'ftp://exemple.fr/x',
  ]) assert.equal(L.lireLien(non), null, String(non))
  assert.equal(L.lireLien('https://Meet.Google.com/abc'), 'https://meet.google.com/abc')
})

bloc('les textes de l equipe : invisibles retires, longueurs', () => {
  assert.equal(L.texteLigne(`  Live${c(0x200b)} de   Brice${c(0xe0041)} `, 120), 'Live de Brice')
  assert.equal(L.texteLigne('a\nb\tc', 120), 'a b c')
  assert.equal(L.texteLigne('   ', 120), null)
  assert.equal(L.texteLigne('x'.repeat(121), 120), 'trop_long')
  assert.equal(L.texteBloc('Ligne 1\r\n\r\n\r\n\r\nLigne 2  ', 600), 'Ligne 1\n\nLigne 2')
  assert.equal(L.texteBloc(`a${c(0x2066)}b${c(0x2069)}`, 600), 'ab')
})

bloc('les demandes du cockpit : lues, bornees, le reste ignore', () => {
  const D = corps => L.lireDemandeEquipe(corps, MAINTENANT)
  const serie = { titre: 'Live de Brice', animateur: 'Brice', genre: 'aok', jours: [4, 2, 2], heure: '20:00', duree_min: 90, debut: '2026-11-16', acces: 'live_club' }
  const s = D({ action: 'creer_serie', serie })
  assert.deepEqual(s.serie.jours, [2, 4])
  assert.equal(s.serie.toutes_les_semaines, 1)
  assert.equal(s.serie.lien, null)
  assert.equal(s.serie.fin, null)
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, jours: [] } }), { erreur: 'jours' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, heure: '24:00' } }), { erreur: 'heure' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, duree_min: 5 } }), { erreur: 'duree' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, fin: '2026-11-01' } }), { erreur: 'fin' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, acces: 'vip' } }), { erreur: 'acces' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, lien: 'http://x.fr/y' } }), { erreur: 'lien' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, toutes_les_semaines: 5 } }), { erreur: 'semaines' })
  assert.deepEqual(D({ action: 'creer_serie', serie: { ...serie, titre: '  ' } }), { erreur: 'titre' })
  const live = { titre: 'Live Fixing', genre: 'partenaire', debut: '2026-11-20T20:30:00Z', duree_min: 30, acces: 'tous' }
  assert.equal(D({ action: 'creer_live', live }).live.debut, '2026-11-20T20:30:00.000Z')
  assert.deepEqual(D({ action: 'creer_live', live: { ...live, debut: '2025-01-01T00:00:00Z' } }), { erreur: 'debut' })
  assert.deepEqual(D({ action: 'creer_live', live: { ...live, genre: 'vip' } }), { erreur: 'genre' })
  const cs = { serie_id: 'B71CE000-0000-4000-8000-000000000001', date_serie: '2026-11-17' }
  assert.deepEqual(D({ action: 'lien', cible: cs, lien: '' }), { action: 'lien', cible: { serie_id: cs.serie_id.toLowerCase(), date_serie: '2026-11-17' }, lien: null })
  assert.deepEqual(D({ action: 'lien', cible: cs, lien: 'https://x.fr/<' }), { erreur: 'lien' })
  assert.deepEqual(D({ action: 'lien', cible: { serie_id: cs.serie_id, date_serie: '2026-02-30' }, lien: null }), { erreur: 'cible' })
  assert.deepEqual(D({ action: 'deplacer', cible: { id: 'b71ce000-0000-4000-8000-000000000009' }, debut: null }), { erreur: 'debut' })
  assert.equal(D({ action: 'deplacer', cible: cs, debut: null }).debut, null)
  assert.deepEqual(D({ action: 'texte_date', cible: { id: 'b71ce000-0000-4000-8000-000000000009' }, titre: '' }), { erreur: 'titre' })
  assert.deepEqual(D({ action: 'supprimer_tout' }), { erreur: 'action' })
  assert.deepEqual(D(null), { erreur: 'action' })
  // Un champ en trop (pose_par, cree_par...) n'est jamais repris.
  const t = D({ action: 'creer_live', live: { ...live, cree_par: 'pirate', modifie_par: 'pirate' } })
  assert.ok(!('cree_par' in t.live) && !('modifie_par' in t.live))
})

bloc('la demande d un membre : lire seulement', () => {
  assert.deepEqual(L.lireDemandeMembre(null), { action: 'lire' })
  assert.deepEqual(L.lireDemandeMembre({}), { action: 'lire' })
  assert.deepEqual(L.lireDemandeMembre({ action: 'lire' }), { action: 'lire' })
  assert.deepEqual(L.lireDemandeMembre({ action: 'lien' }), { erreur: 'action' })
})

bloc('les gestes sur une date : la bonne requete et ses valeurs', () => {
  const cs = { serie_id: 'b71ce000-0000-4000-8000-000000000001', date_serie: '2026-11-17' }
  const r = L.requeteDate({ action: 'lien', cible: cs, lien: 'https://x.fr/abc' }, 'cockpit:u')
  assert.equal(r.sql, L.SQL_LIEN_SERIE)
  assert.deepEqual(r.valeurs, [cs.serie_id, cs.date_serie, 'cockpit:u', 'https://x.fr/abc'])
  assert.match(L.SQL_LIEN_SERIE, /aok_lives_date_de_serie\(\$1::uuid, \$2::date\)/)
  assert.match(L.SQL_LIEN_SERIE, /on conflict \(serie_id, date_serie\) where serie_id is not null/)
  const p = L.requeteDate({ action: 'annuler', cible: { id: 'abc' } }, 'cockpit:u')
  assert.equal(p.sql, L.SQL_STATUT_PONCTUEL)
  assert.deepEqual(p.valeurs, ['abc', 'annule', 'cockpit:u'])
  assert.match(L.SQL_SUPPRIMER_LIVE, /serie_id is null/)
  assert.match(L.SQL_MODIFIER_LIVE, /serie_id is null/)
})

bloc('la migration : tables fermees, fonctions internes, serie de Brice, aucune policy', () => {
  const m = texteMigration()
  for (const t of ['academie_lives_series', 'academie_lives']) {
    assert.match(m, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(m, new RegExp(`alter table public\\.${t} force row level security`))
    assert.match(m, new RegExp(`revoke all on public\\.${t} from public, anon, authenticated, service_role`))
  }
  assert.doesNotMatch(m, /create policy/i)
  assert.doesNotMatch(m, /grant /i)
  assert.doesNotMatch(m, /security definer/i)
  assert.match(m, /revoke all on function public\.aok_lives_entre\(timestamptz, timestamptz\) from public, anon, authenticated, service_role/)
  assert.match(m, /revoke all on function public\.aok_lives_date_de_serie\(uuid, date\) from public, anon, authenticated, service_role/)
  assert.match(m, /lien ~ '\^https:\/\/\[\^\[:space:\]\]\+\$'/)
  assert.match(m, /'b71ce000-0000-4000-8000-000000000001', 'Live de Brice', 'Brice', 'aok', array\[2, 4\]::smallint\[\], '20:00', 90, '2026-11-16', 'live_club'/)
  // Le script d'application decoupe sur les points-virgules : aucun dans les textes (lignes hors commentaires, hors blocs $).
  const sansCommentaires = m.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
  for (const lit of sansCommentaires.match(/'[^']*'/g) ?? []) assert.ok(!lit.includes(';'), `point-virgule dans ${lit}`)
})

bloc('les routes : allowlist, chemin public exact, rien de sensible dans les journaux, aucune minuterie', () => {
  const membre = lire('../src/app/api/academie/lives/route.ts')
  const equipe = lire('../src/app/api/cockpit/lives/route.ts')
  const mw = lire('../middleware.ts')
  assert.match(mw, /pathname === '\/api\/academie\/lives'/)
  assert.doesNotMatch(mw, /publicPaths = \[[^\]]*'\/api\/academie\/lives'/)
  assert.doesNotMatch(mw, /'\/api\/cockpit\/lives'/)
  assert.match(equipe, /from public\.cockpit_allowlist where user_id = \$\{userId\}::uuid/)
  assert.match(equipe, /status: 403/)
  for (const [nom, src] of [['membre', membre], ['equipe', equipe]]) {
    for (const ligne of src.split('\n').filter(l => /console\.(info|warn|error|log)/.test(l))) {
      assert.doesNotMatch(ligne, /\.lien\b(?!\s*\?)|\.titre|\.description|email|\$\{userId\}/, `${nom} : ${ligne.trim()}`)
    }
    assert.doesNotMatch(src, /setInterval|setTimeout/, nom)
  }
  // Le lien ne sort que par vueMembre (etat pret) cote membre.
  assert.match(membre, /vueMembre\(l, lecteur, maintenant\)/)
  assert.doesNotMatch(membre, /lien: l\.lien/)
})

bloc('aucun tiret long ni guillemet courbe dans les textes du journal', () => {
  const INTERDITS = new RegExp(`[${[0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026].map(x => String.fromCharCode(x)).join('')}]`)
  for (const f of ['../src/lib/academie/lives.ts', '../src/app/api/academie/lives/route.ts', '../src/app/api/cockpit/lives/route.ts']) {
    assert.doesNotMatch(lire(f), INTERDITS, f)
  }
})

console.log(`\n${blocs} blocs ok`)
