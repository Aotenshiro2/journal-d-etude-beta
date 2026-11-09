/**
 * Le coeur de l'import des anciens membres (10/11/2026), partage par
 * importer-anciens-membres.mjs (la vraie ecriture, sur go de Brice) et
 * essayer-migration-statuts-anciens.mjs (le meme code, dans une transaction
 * annulee). Voir importer-anciens-membres.mjs pour l'ordre des etapes.
 *
 * Ecritures groupees (une requete par etape, jsonb_to_recordset) : la
 * transaction verrouille profiles pendant la renumerotation, elle doit rester
 * courte.
 */

export const DROITS_OFFRES = { '10% club': 'formation-complete', vip: 'vip-skool', 'live club': 'live-club', etm: 'etm' }

/** Les controles sur le fichier et les decisions, avant toute connexion. */
export function preparer(liste, decisions = {}) {
  const dejaNumerotes = new Set(Object.keys(decisions.deja_numerotes ?? {}))
  const lignes = [
    ...liste.anciens.map(l => ({ ...l, equipe: false })),
    ...liste.equipe.filter(l => l.numero != null && l.numero >= 5 && l.numero <= 20 && !dejaNumerotes.has(l.personne_id))
      .map(l => ({ ...l, equipe: true })),
  ]
  const erreurs = []
  if (!liste.valide_le) erreurs.push('la liste ne porte pas "valide_le" : Brice ne l a pas validee (decisions-brice.json), rien ne sera ecrit')
  const aTrancher = { ...(liste.a_trancher ?? {}), ...(decisions.a_trancher ?? {}) }
  if (Object.keys(aTrancher).length) erreurs.push(`reste a trancher par Brice : ${Object.keys(aTrancher).join(', ')} (vider "a_trancher" dans decisions-brice.json, puis relancer la liste)`)
  if (decisions.valide_le && liste.valide_le && decisions.valide_le !== liste.valide_le) erreurs.push('decisions-brice.json a change depuis la liste : relancer lister-anciens-membres.mjs')
  const vus = new Set()
  for (const l of lignes) {
    if (vus.has(l.numero)) erreurs.push(`numero en double : ${l.numero}`)
    vus.add(l.numero)
    if (!l.equipe && !(Number.isInteger(l.numero) && l.numero >= 30)) erreurs.push(`numero d ancien sous 30 : ${l.numero}`)
    if (!l.equipe && !['izitrade', 'learnybox'].includes(l.epoque)) erreurs.push(`epoque manquante : ${l.numero}`)
    if (!l.nom || !String(l.nom).trim()) erreurs.push(`nom vide : ${l.numero}`)
  }
  const ids = lignes.map(l => l.personne_id)
  if (new Set(ids).size !== ids.length) erreurs.push('une personne apparait deux fois')
  const anciens = lignes.filter(l => !l.equipe).map(l => l.numero).sort((a, b) => a - b)
  if (anciens.some((n, i) => n !== 30 + i)) erreurs.push('les numeros d anciens ne se suivent pas a partir de 30')

  const reglages = new Map()
  const reglage = id => { if (!reglages.has(id)) reglages.set(id, { personne_id: id, sans_droits: false, droits: [], note: null }); return reglages.get(id) }
  for (const id of decisions.sans_droits ?? []) reglage(id).sans_droits = true
  for (const [id, l] of Object.entries(decisions.droits ?? {})) {
    for (const d of l) {
      const slug = DROITS_OFFRES[String(d).trim().toLowerCase()]
      if (!slug) erreurs.push(`droit inconnu pour ${id} : ${d}`)
      else if (!reglage(id).droits.includes(slug)) reglage(id).droits.push(slug)
    }
  }
  for (const [id, n] of Object.entries(decisions.notes ?? {})) reglage(id).note = String(n).trim().slice(0, 1000)

  const reservations = lignes.map(l => ({
    numero: l.numero, equipe: l.equipe, personne_id: l.personne_id, nom: String(l.nom).trim().slice(0, 120),
    telegram: l.telegram ?? null, epoque: l.equipe ? (l.epoque ?? null) : l.epoque, premiere_activite: l.premiere_activite ?? null,
  }))
  const etmValideLe = decisions.etm_valide_le ? String(decisions.etm_valide_le).slice(0, 10) : null
  const etm = (liste.etm ?? []).filter(e => e.dans_le_fonds).map(e => ({
    personne_id: e.personne_id, depuis: e.depuis ?? null,
    detail: e.sources.join(' · ').slice(0, 600),
    note: [e.periode ? `ETM ${e.periode}.` : null, e.note].filter(Boolean).join(' ').slice(0, 1000) || null,
  }))
  return {
    lignes, reservations, erreurs, reglages: [...reglages.values()], etm, etmValideLe,
    corrections: liste.corrections ?? [], anciens: { premier: anciens[0] ?? null, dernier: anciens.at(-1) ?? null, nombre: anciens.length },
  }
}

/**
 * Applique l'import dans la transaction tx (Prisma interactif). Avec
 * ecrire = false, ne fait que lire et compter. Rend un bilan.
 */
export async function appliquer(tx, prep, { ecrire, log = () => {} }) {
  const q = (s, ...p) => tx.$queryRawUnsafe(s, ...p)
  const x = (s, ...p) => tx.$executeRawUnsafe(s, ...p)
  const bilan = {}

  // 1. Les reservations.
  const deja = await q(`select numero::int as numero, personne_id from public.aok_anciens_membres order by numero`)
  if (deja.length) {
    const memes = deja.length === prep.reservations.length && deja.every(d => prep.reservations.some(l => l.numero === d.numero && l.personne_id === d.personne_id))
    if (!memes) throw new Error(`la table porte deja ${deja.length} ligne(s) differente(s) de la liste : refus`)
    log(`deja importe (${deja.length} lignes identiques) : on ne reinsere rien`)
    bilan.reservations = 0
  } else {
    const pris = Number((await q(`select count(*) as n from public.profiles where client_number = any($1::bigint[])`,
      prep.reservations.map(r => r.numero)))[0].n)
    if (pris) throw new Error(`${pris} compte(s) portent deja un numero reserve : refus`)
    if (ecrire) {
      bilan.reservations = await x(`insert into public.aok_anciens_membres (numero, equipe, personne_id, nom, telegram, tg_ids, epoque, premiere_activite)
        select r.numero, r.equipe, r.personne_id, r.nom, r.telegram,
               coalesce((select p.tg_ids from public.cockpit_arch_personnes p where p.personne_id = r.personne_id), '{}'::text[]),
               r.epoque, r.premiere_activite
          from jsonb_to_recordset($1::jsonb) as r(numero bigint, equipe boolean, personne_id text, nom text, telegram text, epoque text, premiere_activite date)`,
        JSON.stringify(prep.reservations))
    } else bilan.reservations = prep.reservations.length
    log(`reservations : ${bilan.reservations} ${ecrire ? 'inserees' : 'a inserer'}, aucun numero deja pris`)
  }

  // 2. Les corrections de nom dites par Brice (Marlon Wricka).
  bilan.corrections = []
  if (prep.corrections.length) {
    const brice = (await q(`select p.id::text as id from public.profiles p join public.cockpit_allowlist a on a.user_id = p.id
        where p.client_number = 1 and p.role::text = 'admin'`))[0]?.id
    for (const c of prep.corrections) {
      const p = (await q(`select nom, coalesce(alias, '') as alias,
          (select count(*) from public.cockpit_arch_notes n where n.personne_id = $1 and n.rubrique = 'identite' and n.texte like $2)::int as notes
          from public.cockpit_arch_personnes where personne_id = $1`, c.personne_id, `%${c.nom}%`))[0]
      if (!p) { log(`correction : ${c.personne_id} absent du fonds, rien fait`); continue }
      const alias = [...new Set([...p.alias.split(',').map(a => a.trim()).filter(Boolean), ...c.alias])].join(',')
      if (ecrire) {
        if (!brice) throw new Error('compte de Brice (n 1, admin du cockpit) introuvable : la note d identite n a pas d auteur')
        await x(`update public.cockpit_arch_personnes set nom = $2, alias = $3, maj_le = now() where personne_id = $1`, c.personne_id, c.nom, alias)
        if (!p.notes) {
          await x(`insert into public.cockpit_arch_notes (personne_id, rubrique, texte, ecrit_par) values ($1, 'identite', $2, $3::uuid)`,
            c.personne_id, `Nom complet : ${c.nom}. ${c.dit}.`, brice)
        }
      }
      bilan.corrections.push(c.personne_id)
      log(`correction ${c.personne_id} : nom « ${p.nom} » -> « ${c.nom} », note d identite ${p.notes ? 'deja la' : ecrire ? 'ajoutee' : 'a ajouter'}`)
    }
  }

  // 3. Les reglages des droits (decisions de Brice).
  if (ecrire && prep.reglages.length) {
    await x(`insert into public.cockpit_parcours_reglages as g (personne_id, vip, sans_droits, droits, note, maj_label, maj_le)
        select r.personne_id, 'vip-skool' = any(r.droits), r.sans_droits, r.droits, r.note, 'Brice, relecture du 09/11/2026', now()
          from jsonb_to_recordset($1::jsonb) as r(personne_id text, sans_droits boolean, droits text[], note text)
      on conflict (personne_id) do update set sans_droits = excluded.sans_droits, droits = excluded.droits, note = excluded.note,
        vip = g.vip or excluded.vip, maj_label = excluded.maj_label, maj_le = now()`,
      JSON.stringify(prep.reglages))
  }
  bilan.reglages = prep.reglages.length
  log(`reglages : ${prep.reglages.map(r => `${r.personne_id}${r.sans_droits ? ' sans droits' : ''}${r.droits.length ? ` ${r.droits.join('+')}` : ''}`).join(', ')}`)

  // 4. Les ETM documentes, apres validation de Brice.
  if (prep.etmValideLe) {
    const etiquette = `import, liste ETM validée le ${prep.etmValideLe}`
    bilan.etm = ecrire
      ? await x(`insert into public.cockpit_parcours (personne_id, statut, source, source_detail, depuis, note, pose_label)
          select e.personne_id, 'etm', 'registre', e.detail, e.depuis, e.note, $2
            from jsonb_to_recordset($1::jsonb) as e(personne_id text, depuis date, detail text, note text)
           where not exists (select 1 from public.cockpit_parcours p where p.personne_id = e.personne_id and p.statut = 'etm'
                               and p.source = 'registre' and p.retire_le is null)`, JSON.stringify(prep.etm), etiquette)
      : prep.etm.length
    log(`ETM : ${bilan.etm} ${ecrire ? 'pose(s)' : 'a poser'} sur la personne des archives`)
  } else {
    bilan.etm = 0
    log(`ETM : ${prep.etm.length} en attente de la validation de Brice ("etm_valide_le"), aucun pose`)
  }

  // 5. L'activation des comptes existants, puis 6. la renumerotation.
  if (ecrire) {
    const res = await q(`select p.client_number::int as avant, public.aok_anciens_activer(p.id) as r
        from public.profiles p where p.role::text <> 'admin' order by p.created_at`)
    const actives = res.filter(r => r.r?.active != null)
    bilan.actives = actives.length
    bilan.propositions = res.reduce((s, r) => s + Number(r.r?.propositions ?? 0), 0)
    log(`comptes existants : ${res.length} relus, ${actives.length} active(s) (${actives.map(r => `${r.avant} -> ${r.r.active}`).join(', ') || 'aucun'}), ${bilan.propositions} proposition(s) a confirmer dans le cockpit`)
    // La renumerotation : a la premiere ecriture, ou si une activation a laisse
    // un trou. Un rejeu sans rien de neuf (les ETM valides plus tard, par
    // exemple) ne la relance pas : elle refuserait des que des profils sont publics.
    if (bilan.reservations > 0 || bilan.actives > 0) {
      bilan.renumerotation = (await q(`select public.aok_numeros_renumeroter() as r`))[0].r
      log(`renumerotation : ${bilan.renumerotation.renumerotes} compte(s), n° ${bilan.renumerotation.premier} a ${bilan.renumerotation.dernier}, prochain inscrit ${bilan.renumerotation.prochain}`)
    } else {
      bilan.renumerotation = null
      log('renumerotation : rien de neuf (ni reservation inseree, ni activation), pas relancee')
    }
  } else {
    const n = Number((await q(`select count(*) as n from public.profiles where role::text <> 'admin'`))[0].n)
    log(`essai a blanc : ${n} compte(s) hors equipe a renumeroter a partir de ${prep.anciens.dernier + 1} (moins ceux qu une activation fera passer sur leur numero d ancien)`)
  }
  return bilan
}
