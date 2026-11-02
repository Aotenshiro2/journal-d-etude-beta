// Les membres a contacter calcules une fois par jour (02/11) : la regle pure
// du choix de la source (instantane frais ou vue en direct), le branchement
// des lecteurs et du passage, et la migration 20261102150000 (droits, garde,
// commentaires sans point-virgule). Aucune base, aucun reseau.
// node scripts/verifier-contact-instantane.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { FRAICHEUR_INSTANTANE_MS, suffixeSource, SUFFIXE_INSTANTANE } from '../src/lib/liveclub/contact-instantane-pur.ts'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

const MAINTENANT = Date.parse('2026-11-03T07:00:30Z')

bloc('instantane frais : la table, sinon la vue en direct', () => {
  assert.equal(SUFFIXE_INSTANTANE, '_instantane')
  assert.equal(suffixeSource({ existe: true, calculeLe: '2026-11-03T07:00:05Z' }, MAINTENANT), '_instantane')
  assert.equal(suffixeSource({ existe: true, calculeLe: new Date('2026-11-02T07:00:05Z') }, MAINTENANT), '_instantane', 'la veille au matin reste bon')
  // Migration pas passee, jamais calcule, date illisible : la vue.
  assert.equal(suffixeSource({ existe: false, calculeLe: '2026-11-03T07:00:05Z' }, MAINTENANT), '')
  assert.equal(suffixeSource({ existe: true, calculeLe: null }, MAINTENANT), '')
  assert.equal(suffixeSource({ existe: true, calculeLe: 'pas une date' }, MAINTENANT), '')
  // Plus de 30 h (cron arrete) : la vue.
  assert.equal(FRAICHEUR_INSTANTANE_MS, 30 * 3600_000)
  assert.equal(suffixeSource({ existe: true, calculeLe: new Date(MAINTENANT - FRAICHEUR_INSTANTANE_MS - 1000) }, MAINTENANT), '')
  assert.equal(suffixeSource({ existe: true, calculeLe: new Date(MAINTENANT - FRAICHEUR_INSTANTANE_MS + 1000) }, MAINTENANT), '_instantane')
})

bloc('les lecteurs du journal passent par la source choisie', () => {
  const resume = lire('../src/lib/liveclub/resume.ts')
  assert.match(resume, /const source = await sourcesAContacter\(prisma\)/)
  assert.match(resume, /from public\.cockpit_membres_risque\$\{Prisma\.raw\(source\.risque\)\}`/)
  assert.match(resume, /from public\.cockpit_membres_a_venir\$\{Prisma\.raw\(source\.aVenir\)\} where/)
  const relais = lire('../src/lib/liveclub/relais.ts')
  assert.match(relais, /const source = await sourcesAContacter\(db\)/)
  const lectures = lire('../src/lib/tab/lectures.ts')
  assert.match(lectures, /const source = await sourcesAContacter\(tx\)/)
  assert.match(lectures, /from public\.cockpit_membres_risque\$\{source\.risque\} r/)
  assert.match(lectures, /from public\.cockpit_membres_a_venir\$\{source\.aVenir\} order by/)
  // Aucun lecteur ne lit plus la vue en dur.
  for (const [nom, src] of [['resume', resume], ['relais', relais], ['lectures', lectures]]) {
    assert.ok(!/from public\.cockpit_membres_(risque|a_venir)[\s`]/.test(src), `${nom} lit encore une vue en dur`)
  }
  // L'etat se lit sans jamais toucher une relation absente (transaction de Tab).
  const serveur = lire('../src/lib/liveclub/contact-instantane.ts')
  assert.match(serveur, /to_regclass\('public\.cockpit_instantanes'\)/)
  assert.match(serveur, /to_regprocedure\('public\.cockpit_membres_contact_recalculer\(text\)'\)/)
})

bloc('le passage refait l instantane avant le relais et le resume', () => {
  const passage = lire('../src/lib/liveclub/passage.ts')
  const instantane = passage.indexOf("await etape('a_contacter'")
  const relais = passage.indexOf("await etape('relais'")
  const resume = passage.indexOf("await etape('resume'")
  assert.ok(instantane > 0 && instantane < relais && relais < resume)
  assert.ok(instantane > passage.indexOf("await etape('purge'"), 'apres les taches du passage')
  assert.match(passage, /a_contacter: \{ etat: 'pas_lance', risque: 0, a_venir: 0 \}/)
})

bloc('la migration : tables gardees comme la vue, fonction fermee a anon, commentaires sans point-virgule', () => {
  const chemin = new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261102150000_cockpit_membres_contact_instantane.sql', import.meta.url)
  if (!existsSync(chemin)) { console.log('    (migration hors de ce poste, bloc saute)'); return }
  const sql = readFileSync(chemin, 'utf8')
  for (const t of ['cockpit_instantanes', 'cockpit_membres_risque_instantane', 'cockpit_membres_a_venir_instantane']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`))
    assert.match(sql, new RegExp(`grant select on public\\.${t} to authenticated, service_role`))
    assert.match(sql, new RegExp(`create policy ${t}_select on public\\.${t}\\s+for select to authenticated\\s+using \\(public\\.is_cockpit_member\\(\\)\\)`))
  }
  assert.ok(!/grant (insert|update|delete|all)/i.test(sql), 'aucune ecriture accordee')
  assert.match(sql, /security definer\s+set search_path = public, pg_temp/)
  assert.match(sql, /if auth\.uid\(\) is not null and not public\.is_cockpit_member\(\) then/)
  assert.match(sql, /revoke execute on function public\.cockpit_membres_contact_recalculer\(text\) from public, anon/)
  assert.match(sql, /pg_try_advisory_xact_lock/)
  for (const ligne of sql.split('\n').filter(l => l.trim().startsWith('--'))) {
    assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne.trim()}`)
  }
  // Les textes de comment on ... is '...' non plus.
  for (const m of sql.matchAll(/comment on [^']+'([^']*)'/g)) assert.ok(!m[1].includes(';'), m[1])
})

bloc('le cockpit lit l instantane, retombe sur la vue, et recalcule apres une exemption', () => {
  const chemin = new URL('../../cockpit/src/views/membres/MembresRisque.tsx', import.meta.url)
  if (!existsSync(chemin)) { console.log('    (cockpit hors de ce poste, bloc saute)'); return }
  const ecran = readFileSync(chemin, 'utf8')
  assert.match(ecran, /FRAICHEUR_INSTANTANE_MS = 30 \* 3600_000/, 'meme fraicheur que le journal')
  assert.match(ecran, /useVue<MembreRisque>\('cockpit_membres_risque', 'entree'\)/)
  assert.match(ecran, /`\$\{vue\}_instantane`/)
  const cockpit = readFileSync(new URL('../../cockpit/src/lib/cockpit.ts', import.meta.url), 'utf8')
  assert.equal((cockpit.match(/recalculerAContacterEnFond\(\)/g) ?? []).length >= 3, true, 'definition, pose et retrait')
})

console.log(`\n${n} blocs verts`)
