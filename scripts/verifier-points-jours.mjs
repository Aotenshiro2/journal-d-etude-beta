// Les points par jour du classement Activite (09/11) : le branchement du
// passage quotidien et la migration 20261109234000 (droits, garde, regles
// partagees, commentaires sans point-virgule). Aucune base, aucun reseau.
// L'essai contre la base : scripts/essayer-migration-points-jours.mjs.
// node scripts/verifier-points-jours.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

let n = 0
const bloc = (nom, f) => { f(); n++; console.log(`ok  ${nom}`) }
const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8')

bloc('le passage rafraichit les points en dernier, sans minuterie', () => {
  const passage = lire('../src/lib/liveclub/passage.ts')
  const points = passage.indexOf("await etape('points_jours'")
  assert.ok(points > passage.indexOf("await etape('resume'"), 'apres le resume')
  assert.ok(points > passage.indexOf("await etape('a_contacter'"))
  assert.match(passage, /const b = await rafraichirPointsJours\(prisma, ACTEUR\)/)
  assert.match(passage, /points_jours: \{ etat: 'pas_lance', complet: false, recalcules: 0, jours_ecrits: 0, jours_retires: 0 \}/)
  assert.match(passage, /ctx\.s\.points_jours\.etat = 'reporte'/)
  const serveur = lire('../src/lib/points-jours.ts')
  assert.match(serveur, /to_regprocedure\('public\.aok_points_jours_rafraichir\(boolean,text\)'\)/)
  assert.ok(!/setInterval|setTimeout/.test(serveur), 'aucune minuterie')
  // Toujours un seul cron par jour (plan Hobby) : le passage du Live Club.
  const vercel = JSON.parse(lire('../vercel.json'))
  assert.ok(vercel.crons.some(c => c.path === '/api/cron/liveclub' && /^\d+ \d+ \* \* \*$/.test(c.schedule)))
})

bloc('la migration : tables fermees, rafraichissement reserve, regles en un seul endroit', () => {
  const relatif = 'sites/Aoknowledgecom/supabase/migrations/20261109234000_aok_points_jours.sql'
  const chemin = [
    process.env.AOK_WORKSPACE ? new URL(`file://${process.env.AOK_WORKSPACE.replace(/\/$/, '')}/${relatif}`) : null,
    new URL(`../../../${relatif}`, import.meta.url),
  ].filter(Boolean).find(u => existsSync(u))
  if (!chemin) { console.log('    (migration hors de ce poste, bloc saute : poser AOK_WORKSPACE dans un worktree)'); return }
  const sql = readFileSync(chemin, 'utf8')
  for (const t of ['aok_points_jours', 'aok_points_jours_comptes', 'aok_points_jours_passages']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(sql, new RegExp(`revoke all on public\\.${t} from anon, authenticated`))
  }
  assert.ok(!/create policy/i.test(sql), 'aucune policy')
  assert.ok(!/grant (select|insert|update|delete|all) on public\.aok_points/i.test(sql), 'aucun droit sur les tables')
  assert.match(sql, /revoke all on function public\.aok_points_jours_rafraichir\(boolean, text\) from public, anon, authenticated, service_role/)
  assert.match(sql, /grant execute on function public\.aok_classement\(text, text, integer\) to authenticated/)
  assert.match(sql, /pg_try_advisory_xact_lock\(hashtext\('aok_points_jours_rafraichir'\)\)/)
  assert.match(sql, /references public\.profiles\(id\) on delete cascade/)
  // La table est remplie par la regle de Mon espace, pas par une copie.
  const raf = sql.slice(sql.indexOf('as $rafraichir$'), sql.lastIndexOf('$rafraichir$'))
  assert.match(raf, /public\.aok_activite_par_jour\(v_ids\[v_i\], v_tzs\[v_i\]\)/)
  assert.ok(!/audit_log_entries a\s+where a\.payload ->> 'actor_id' = /.test(raf), 'pas de copie de la regle d activite')
  // La formule du jour n existe qu une fois : aok_points_calcul et aok_classement l appellent.
  assert.equal([...sql.matchAll(/least\(p_lecons, coalesce\(p_bareme\[5\], p_lecons\)\)/g)].length, 1)
  assert.match(sql.slice(sql.indexOf('as $points$')), /public\.aok_points_du_jour\(a\.lecons, a\.notes, a\.messages, v_bareme\)/)
  assert.match(sql.slice(sql.indexOf('as $classement$')), /public\.aok_points_du_jour\(t\.lecons, t\.notes, t\.messages, v_bareme\)/)
  // Le premier remplissage n est PAS dans la migration (transaction de 5 s).
  assert.ok(!/^select public\.aok_points_jours_rafraichir/m.test(sql), 'pas de passage dans la migration')
  // Garde md5 et ordre.
  assert.match(sql, /to_regprocedure\('public\.aok_classement\(text, text, integer\)'\) is null/)
  assert.match(sql, /v_activite not in \('4046ad2a606558f5f249ccaa1f1a9841', '[0-9a-f]{32}'\)/)
  assert.match(sql, /v_calcul not in \('254ea7b7fb23a1fb7c3812a70962b2ec', '[0-9a-f]{32}'\)/)
  for (const ligne of sql.split('\n').filter(l => l.trim().startsWith('--'))) {
    assert.ok(!ligne.includes(';'), `point-virgule dans un commentaire : ${ligne.trim()}`)
  }
  for (const m of sql.matchAll(/comment on [^']+'([^']*)'/g)) assert.ok(!m[1].includes(';'), m[1])
  assert.ok(!/\u2014/.test(sql), 'pas de tiret cadratin')
})

console.log(`\n${n} blocs verifies, tout est bon.`)
