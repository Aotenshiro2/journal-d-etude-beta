/**
 * La page de relecture de la liste des anciens membres (pour Brice), rendue
 * en HTML autonome : aucune ressource externe, jour et nuit, lisible au
 * telephone. Aucune adresse email : la liste n'en porte pas.
 * Appelee par lister-anciens-membres.mjs.
 */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const date = d => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '?')
const mille = n => Number(n ?? 0).toLocaleString('fr-FR').replace(/ | /g, ' ')
const ECOS = {
  izimoney: 'IziTrade', aoknowledge: 'AOKnowledge', 'deep-knowledge': 'Deep Knowledge', coaching: 'Coachings',
  'ligue-schlags': 'Ligue des Schlags', 'izi-gentleman': 'Izi Gentleman', 'live-club': 'Live Club',
}
const EPOQUE = { izitrade: 'IziTrade', learnybox: 'LearnyBox' }
const PALIER = { epais: 'épais', solide: 'solide', mince: 'mince', trace: 'trace' }
const NATURE = {
  equipe: 'équipe', associe: 'associé', associee: 'associée', 'associee-principale': 'associée principale',
  'eleve-equipe': 'élève, équipe', 'ancien-equipe': 'ancien de l’équipe', 'ancien-associe': 'ancien associé',
  'ancienne-associee': 'ancienne associée', eleve: 'élève', 'eleve-proche': 'élève proche', mentore: 'mentoré',
}
/** Apres le premier salon Deep Knowledge : une trace IziTrade tardive (salon de formation), a regarder. */
const IZITRADE_TARDIF = '2022-02-28'
/** Les offres de l'academie que Brice a citees dans ses droits (decisions-brice.json). */
const OFFRES = { 'formation-complete': '10% Club', 'vip-skool': 'VIP', 'live-club': 'Live Club', etm: 'ETM' }
const ETAT_ETM = {
  'a-poser': 'à poser sur la personne',
  'deja-sur-la-fiche': 'déjà ETM sur sa fiche client, à poser aussi sur la personne',
  'confirme-par-brice': 'confirmé par Brice le 09/11, à poser sur la personne',
}

/** Les statuts d'ancien eleve, en pastilles : le groupe au survol, « paiement non terminé » en alerte. */
function pastillesStatuts(l) {
  const t = []
  for (const s of l.statuts ?? []) {
    const titre = [s.groupes?.length ? `Groupes : ${s.groupes.join(', ')}` : null, s.depuis ? `depuis le ${date(s.depuis)}` : null].filter(Boolean).join(', ')
    t.push(`<span class="tag tag-statut${s.paiement_incomplet ? ' tag-alerte' : ''}" title="${esc(titre)}">${esc(s.libelle)}${s.paiement_incomplet ? ', paiement non terminé' : ''}</span>`)
  }
  if (l.etm_fiche && !(l.statuts ?? []).some(s => s.statut === 'etm')) t.push('<span class="tag tag-statut" title="Statut ETM posé sur sa fiche client">ETM (fiche)</span>')
  if (l.sans_droits) t.push('<span class="tag tag-alerte" title="Décision de Brice">ancienneté seulement, sans droits</span>')
  if (l.droits_brice?.length) t.push(`<span class="tag tag-droit" title="Droits dits par Brice">droits : ${l.droits_brice.map(d => OFFRES[d] ?? d).join(', ')}</span>`)
  if (l.deja_numerote) t.push(`<span class="tag" title="Son compte du site garde ce numéro">compte existant</span>`)
  if (l.anciennete_depuis_equipe) t.push(`<span class="tag" title="Décision de Brice : un numéro d’ancien, pas un numéro d’équipe">numéro d’ancien</span>`)
  if (l.a_trancher) t.push(`<span class="tag tag-alerte" title="${esc(l.a_trancher)}">à trancher</span>`)
  return t.join('')
}

function cleNom(nom) {
  if (typeof nom !== 'string') return null
  const mots = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter(m => m.length >= 2)
  return mots.length < 2 ? null : [...new Set(mots)].sort().join(' ')
}

function etiquettes(l, doublons, { epoque = false } = {}) {
  const t = []
  if (epoque && l.epoque) t.push(`<span class="tag tag-${l.epoque}">${EPOQUE[l.epoque]}</span>`)
  if (l.epoque_proposee && !l.epoque) t.push(`<span class="tag tag-${l.epoque_proposee}">${EPOQUE[l.epoque_proposee]} ?</span>`)
  t.push(`<span class="tag">${PALIER[l.palier] ?? esc(l.palier)}</span>`)
  if (!['eleve'].includes(l.nature)) t.push(`<span class="tag">${NATURE[l.nature] ?? esc(l.nature)}</span>`)
  if (l.epoque === 'izitrade' && l.premiere_izitrade && l.premiere_izitrade >= IZITRADE_TARDIF) t.push(`<span class="tag tag-alerte" title="Sa seule trace IziTrade est un salon de formation après 2022">IziTrade tardif</span>`)
  if (l.acces_learnybox?.length) t.push(`<span class="tag" title="Accès sans fin hérité de LearnyBox">${l.acces_learnybox.map(a => (a === 'vip-skool' ? 'VIP' : 'Premium')).join(', ')} sans fin</span>`)
  const k = cleNom(l.nom)
  if (k && doublons.get(k) > 1) t.push(`<span class="tag tag-alerte" title="Une autre ligne porte le même nom">doublon possible</span>`)
  return t.join('') + pastillesStatuts(l)
}

function ligne(l, doublons, opts = {}) {
  const fiche = l.fiche
    ? `<span class="${l.fiche.confiance === 'certain' ? 'ok' : 'moyen'}">oui</span> <small>${l.fiche.confiance === 'certain' ? 'liée, certaine' : 'liée par le nom'}, ${esc(l.fiche.id)}</small>`
    : '<span class="vide">non</span>'
  const compte = l.compte_du_site ? `<span class="${l.compte_du_site.lien === 'email' || l.compte_du_site.lien === 'telegram' ? 'ok' : 'moyen'}">${esc(l.compte_du_site.libelle)}</span>` : '<span class="vide">aucun</span>'
  const recherche = [l.numero, l.nom, l.telegram, l.personne_id, ...(l.statuts ?? []).map(s => s.libelle)].filter(Boolean).join(' ').toLowerCase()
  return `<div class="ligne" data-q="${esc(recherche)}">
  <div class="c-num">${l.numero != null ? `<b>${l.numero}</b>` : '<span class="vide">·</span>'}</div>
  <div class="c-nom"><div class="nom">${esc(l.nom)}</div>${l.telegram ? `<div class="pseudo">@${esc(l.telegram)}</div>` : ''}<div class="tags">${etiquettes(l, doublons, opts)}</div>${l.note_brice ? `<div class="note-brice">Brice : « ${esc(l.note_brice)} »</div>` : ''}</div>
  <div class="c-dates"><span class="lbl">Première</span> ${l.premiere_estimee ? '≈ ' : ''}${date(l.premiere_activite)}<br><span class="lbl">Dernière</span> ${date(l.derniere_activite)}</div>
  <div class="c-msg"><span class="lbl">Messages</span> ${mille(l.messages)}</div>
  <div class="c-eco"><span class="lbl">Où</span> ${l.ecosystemes.map(e => ECOS[e] ?? e).join(', ')}</div>
  <div class="c-fiche"><span class="lbl">Fiche du cockpit</span> ${fiche}</div>
  <div class="c-compte"><span class="lbl">Compte du site</span> ${compte}</div>
</div>`
}

function tableau(liste, doublons, opts) {
  if (!liste.length) return '<p class="vide">Personne.</p>'
  return `<div class="tableau">
  <div class="ligne entete"><div>N°</div><div>Nom</div><div>Activité</div><div>Messages</div><div>Où</div><div>Fiche du cockpit</div><div>Compte du site</div></div>
  ${liste.map(l => ligne(l, doublons, opts)).join('\n')}
</div>`
}

export function pageHtml(s) {
  const c = s.comptes
  const toutes = [...s.anciens, ...s.a_confirmer, ...s.epoque_a_confirmer, ...s.sans_nom, ...s.equipe]
  const doublons = new Map()
  for (const l of toutes) { const k = cleNom(l.nom); if (k) doublons.set(k, (doublons.get(k) ?? 0) + 1) }
  const izi = s.anciens.filter(l => l.epoque === 'izitrade')
  const lb = s.anciens.filter(l => l.epoque === 'learnybox')
  const traceIzi = s.a_confirmer.filter(l => l.epoque === 'izitrade')
  const traceLb = s.a_confirmer.filter(l => l.epoque === 'learnybox')
  const tardifs = izi.filter(l => l.premiere_izitrade && l.premiere_izitrade >= IZITRADE_TARDIF).length
  const nbDoublons = [...doublons.values()].filter(n => n > 1).length
  const genere = new Date(s.genere_le)
  const quand = `${date(s.genere_le.slice(0, 10))} à ${String(genere.getHours()).padStart(2, '0')} h ${String(genere.getMinutes()).padStart(2, '0')}`

  const statutsCompte = Object.entries(c.personnes_par_statut ?? {})
  const LIB_STATUT = Object.fromEntries(toutes.flatMap(l => (l.statuts ?? []).map(x => [x.statut, x.libelle])))
  const etm = (s.etm ?? []).map(e => `<div class="etm">
  <div class="etm-tete"><b>${esc(e.nom)}</b> <span class="gris">${esc(e.periode)}</span>${e.numero != null ? ` <span class="tag">n° ${e.numero}</span>` : ''}
    <span class="tag ${e.etat === 'deja-sur-la-fiche' ? '' : 'tag-statut'}">${esc(ETAT_ETM[e.etat] ?? e.etat)}</span>${e.dans_le_fonds ? '' : ' <span class="tag tag-alerte">absent du fonds</span>'}</div>
  <ul>${e.sources.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  ${e.identification ? `<p class="gris"><small>${esc(e.identification)}</small></p>` : ''}
  ${e.note ? `<p><small>${esc(e.note)}</small></p>` : ''}
</div>`).join('\n')
  const etmNon = (s.etm_non_retenus ?? []).map(x => `<li><b>${esc(x.nom)}</b> : ${esc(x.raison)}</li>`).join('')
  const diff = s.difference
  const aTrancher = Object.entries(s.a_trancher ?? {})

  const cites = s.cites.map(x => {
    const ou = !x.trouve ? 'pas retrouvé'
      : x.groupe === 'anciens' ? `n° ${x.numero}, ${EPOQUE[x.epoque]}`
      : x.groupe === 'equipe' ? (x.numero ? `n° ${x.numero}, équipe` : 'équipe, numéro de 5 à 20 à choisir')
      : x.groupe === 'a-confirmer' ? 'à confirmer (une seule apparition)'
      : x.groupe
    return `<li class="${x.trouve ? '' : 'absent'}"><b>${esc(x.cite)}</b>${x.trouve && x.nom !== x.cite ? ` <span class="gris">(${esc(x.nom)})</span>` : ''} : ${esc(ou)}${x.note ? `<br><small>${esc(x.note)}</small>` : ''}</li>`
  }).join('\n')

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Anciens membres à valider</title>
<style>
:root {
  --fond: #f6f5f1; --carte: #ffffff; --texte: #1d1d1b; --gris: #6b6a65; --trait: #e3e1da;
  --accent: #8a5a12; --izi: #9a4d00; --izi-fond: #fbeedd; --lb: #1f5f8b; --lb-fond: #e3eff8;
  --ok: #1e7a3c; --moyen: #9a6b00; --alerte: #a33a2a; --alerte-fond: #fbe7e3; --tag: #efede6;
  --statut: #5b3b8c; --statut-fond: #eee6f8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fond: #151513; --carte: #1e1e1b; --texte: #ecebe6; --gris: #a3a29b; --trait: #33322e;
    --accent: #e0b25c; --izi: #f0a35a; --izi-fond: #3a2a17; --lb: #8cc4ef; --lb-fond: #182a38;
    --ok: #6fd18f; --moyen: #e6c15a; --alerte: #f08b7a; --alerte-fond: #3d211c; --tag: #2a2925;
    --statut: #c8b0f0; --statut-fond: #2c2340;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--fond); color: var(--texte); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 28px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 4px; letter-spacing: -0.01em; }
h2 { font-size: 20px; margin: 40px 0 6px; }
h2 .compte { color: var(--gris); font-weight: 500; }
p { margin: 6px 0; }
.gris, small { color: var(--gris); }
.chapeau { color: var(--gris); margin-bottom: 18px; }
.plages { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 22px; }
.plage { background: var(--carte); border: 1px solid var(--trait); border-radius: 10px; padding: 8px 12px; }
.plage b { color: var(--accent); }
.tuiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.tuile { background: var(--carte); border: 1px solid var(--trait); border-radius: 12px; padding: 12px 14px; }
.tuile .n { font-size: 26px; font-weight: 700; line-height: 1.1; }
.tuile .t { color: var(--gris); font-size: 13px; }
.tuile.izi .n { color: var(--izi); } .tuile.lb .n { color: var(--lb); }
.encadre { background: var(--carte); border: 1px solid var(--trait); border-left: 4px solid var(--accent); border-radius: 10px; padding: 12px 16px; margin: 18px 0; }
.encadre ul, .encadre ol { margin: 6px 0; padding-left: 20px; }
.cites { list-style: none; padding: 0; margin: 8px 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.cites li { background: var(--carte); border: 1px solid var(--trait); border-radius: 10px; padding: 8px 12px; }
.cites li.absent { border-color: var(--alerte); background: var(--alerte-fond); }
.recherche { position: sticky; top: 0; z-index: 2; background: var(--fond); padding: 10px 0; }
.recherche input { width: 100%; font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--trait); background: var(--carte); color: var(--texte); }
.tableau { background: var(--carte); border: 1px solid var(--trait); border-radius: 12px; overflow: hidden; }
.ligne { display: grid; grid-template-columns: 52px minmax(180px, 2fr) 150px 90px minmax(120px, 1.2fr) minmax(120px, 1.1fr) minmax(130px, 1.2fr); gap: 10px; padding: 9px 12px; border-top: 1px solid var(--trait); align-items: start; }
.ligne.entete { border-top: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--gris); background: var(--tag); }
.ligne .lbl { display: none; }
.c-num b { font-size: 17px; color: var(--accent); }
.nom { font-weight: 600; }
.pseudo { color: var(--gris); font-size: 13px; }
.tags { margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px; }
.tag { font-size: 11.5px; background: var(--tag); border-radius: 999px; padding: 1px 8px; color: var(--gris); }
.tag-izitrade { background: var(--izi-fond); color: var(--izi); }
.tag-learnybox { background: var(--lb-fond); color: var(--lb); }
.tag-alerte { background: var(--alerte-fond); color: var(--alerte); }
.tag-statut { background: var(--statut-fond); color: var(--statut); }
.tag-droit { background: var(--izi-fond); color: var(--izi); }
.note-brice { margin-top: 4px; font-size: 13px; color: var(--accent); }
.etms { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; margin: 10px 0; }
.etm { background: var(--carte); border: 1px solid var(--trait); border-radius: 12px; padding: 10px 14px; }
.etm-tete { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; }
.etm ul { margin: 6px 0; padding-left: 18px; font-size: 13.5px; }
.c-dates, .c-msg, .c-eco, .c-fiche, .c-compte { font-size: 13.5px; }
.ok { color: var(--ok); font-weight: 600; } .moyen { color: var(--moyen); font-weight: 600; } .vide { color: var(--gris); }
details { margin: 14px 0; } summary { cursor: pointer; font-weight: 600; }
table.paliers { border-collapse: collapse; margin: 10px 0; background: var(--carte); border-radius: 10px; overflow: hidden; }
table.paliers th, table.paliers td { padding: 6px 14px; border-bottom: 1px solid var(--trait); text-align: right; }
table.paliers th:first-child, table.paliers td:first-child { text-align: left; }
.cache { display: none !important; }
@media (max-width: 760px) {
  .ligne.entete { display: none; }
  .ligne { grid-template-columns: 44px 1fr; gap: 2px 10px; }
  .ligne > div:nth-child(n+3) { grid-column: 2; }
  .ligne .lbl { display: inline; color: var(--gris); font-size: 12px; margin-right: 4px; }
  h1 { font-size: 24px; }
}
</style>
</head>
<body>
<main>
<h1>Anciens membres ${s.valide_le ? 'validés' : 'à valider'}</h1>
<p class="chapeau">Tirée de l’ontologie du cockpit le ${quand}, en lecture seule. ${s.valide_le ? `Liste validée par toi le ${date(String(s.valide_le).slice(0, 10))} ; les numéros ont été recalculés avec la nouvelle plage (30 et +) et tes choix.` : 'Rien n’est écrit en base tant que tu n’as pas validé.'} Aucune adresse email dans cette page.</p>

<div class="plages">
  <div class="plage"><b>1 à 20</b> l’équipe : Brice 1, Mélanie 2, Adil 3, Adrien 4, puis 5 à 20 posés par toi</div>
  <div class="plage"><b>30 à ${c.dernier_numero ?? '…'}</b> les anciens, du plus ancien au plus récent</div>
  <div class="plage"><b>${c.premier_inscrit} et +</b> les inscrits, juste après le dernier ancien : les comptes actuels y sont renumérotés à l’import, dans l’ordre d’inscription</div>
</div>
${aTrancher.length ? `<div class="encadre"><b>À trancher avant l’import</b><ul>${aTrancher.map(([id, t]) => `<li>${esc(id)} : ${esc(t)}</li>`).join('')}</ul><p class="gris">L’import refuse de tourner tant que cette liste n’est pas vide.</p></div>` : ''}

<div class="tuiles">
  <div class="tuile"><div class="n">${c.numerotes}</div><div class="t">anciens numérotés, n° ${c.premier_numero} à ${c.dernier_numero}</div></div>
  <div class="tuile izi"><div class="n">${c.par_epoque.izitrade ?? 0}</div><div class="t">depuis IziTrade</div></div>
  <div class="tuile lb"><div class="n">${c.par_epoque.learnybox ?? 0}</div><div class="t">depuis LearnyBox</div></div>
  <div class="tuile"><div class="n">${c.a_confirmer}</div><div class="t">à confirmer : une seule apparition</div></div>
  <div class="tuile"><div class="n">${c.epoque_a_confirmer}</div><div class="t">époque à confirmer</div></div>
  <div class="tuile"><div class="n">${c.sans_nom}</div><div class="t">sans nom (identifiant Telegram seul)</div></div>
  <div class="tuile"><div class="n">${c.equipe}</div><div class="t">équipe et associés (5 à 20)</div></div>
</div>

<table class="paliers">
  <tr><th>Numérotés, par palier</th><th>IziTrade</th><th>LearnyBox</th><th>Total</th></tr>
  ${['epais', 'solide', 'mince'].map(p => `<tr><td>${PALIER[p]}</td><td>${izi.filter(l => l.palier === p).length}</td><td>${lb.filter(l => l.palier === p).length}</td><td><b>${(c.par_palier[p] ?? 0)}</b></td></tr>`).join('')}
</table>
<p class="gris"><small>Épais, solide, mince : la place de la personne dans les échanges (beaucoup, régulièrement, un peu). Trace : une seule apparition.</small></p>

<h2>Les statuts d’anciens élèves</h2>
<p class="gris">Calculés depuis les groupes de formation des archives (${esc(c.statuts_source ?? '')}). Formateurs exclus, paiement non terminé signalé.</p>
<div class="tuiles">
  ${statutsCompte.map(([st, n]) => `<div class="tuile"><div class="n">${n}</div><div class="t">${esc(LIB_STATUT[st] ?? st)}</div></div>`).join('\n  ')}
</div>
${diff ? `<p class="gris"><small>Par rapport à la liste du ${date(String(diff.liste_du ?? '').slice(0, 10))} : ${diff.entres.length} entrée(s), ${diff.sortis.length} sortie(s), ${diff.epoque_changee.length} époque(s) changée(s).</small></p>` : ''}

<h2>Les ETM documentés <span class="compte">(${(s.etm ?? []).length})</span></h2>
<p class="gris">Un élève ETM le reste à vie. Le statut se pose sur la personne des archives, même sans fiche client. ${s.etm_valide_le ? `Liste validée le ${date(String(s.etm_valide_le).slice(0, 10))} : l’import les pose.` : 'À valider par toi : l’import ne les pose qu’après ta validation.'}</p>
<div class="etms">
${etm}
</div>
${etmNon ? `<details><summary>Cités mais pas retenus</summary><ul>${etmNon}</ul></details>` : ''}

<h2>Les noms que tu as cités</h2>
<ul class="cites">
${cites}
</ul>

<div class="encadre">
  <b>Ce que j’attends de toi</b>
  <ol>
    <li>Les retraits : quelqu’un qui n’a rien à faire dans la liste (pas un élève, un compte en double).</li>
    <li>Les entrées : quelqu’un des sections « à confirmer » qui mérite un numéro.</li>
    <li>Les époques à trancher : ${c.epoque_a_confirmer} personnes n’ont été vues ni dans IziTrade, ni dans Deep Knowledge ou AOKnowledge avant Skool ; une époque est proposée d’après la date.</li>
    <li>L’équipe : qui prend un numéro de 5 à 20, et lequel.</li>
  </ol>
  <p>Les numéros 30 et suivants se recalculent tout seuls après tes choix. À regarder en priorité : ${tardifs} ligne(s) marquée(s) « IziTrade tardif » et ${nbDoublons} nom(s) en « doublon possible ».</p>
</div>

<div class="recherche"><input type="search" id="q" placeholder="Chercher un nom, un pseudo, un numéro" autocomplete="off"></div>

<h2>L’équipe et les associés <span class="compte">(${s.equipe.length})</span></h2>
<p class="gris">Numéros 5 à 20 choisis par toi. Mélanie, Adil et Adrien gardent 2, 3 et 4 (leurs comptes existent). Un numéro d’équipe ne donne aucun droit : le statut équipe reste le rôle du compte. Brice n’est pas dans l’ontologie (il en est l’auteur).</p>
${tableau(s.equipe, doublons, { epoque: true })}

<h2>Depuis IziTrade <span class="compte">(${izi.length})</span></h2>
<p class="gris">Présents dans IziMoney / IziTrade (dès 2018) hors des groupes SMM de 2025, ou formés à l’époque IziTrade. Triés par ancienneté : la première activité dans les groupes AOK.</p>
${tableau(izi, doublons)}

<h2>Depuis LearnyBox <span class="compte">(${lb.length})</span></h2>
<p class="gris">KOFM, SMM ou Deep Knowledge, ou vus dans AOKnowledge avant la migration Skool (11/09/2025), ou avec un accès Premium ou VIP sans fin.</p>
${tableau(lb, doublons)}

<h2>À confirmer : une seule apparition <span class="compte">(${s.a_confirmer.length})</span></h2>
<p class="gris">Pas de numéro par défaut. Dis-moi qui faire entrer.</p>
<details><summary>IziTrade (${traceIzi.length})</summary>${tableau(traceIzi, doublons)}</details>
<details><summary>LearnyBox (${traceLb.length})</summary>${tableau(traceLb, doublons)}</details>

<h2>Époque à confirmer <span class="compte">(${s.epoque_a_confirmer.length})</span></h2>
<p class="gris">Vus seulement dans le Cercle Izi Gentleman, les coachings ou la Ligue des Schlags. Époque proposée d’après la date (avant le premier salon Deep Knowledge, le 28/02/2022 : IziTrade). Pas de numéro par défaut.</p>
${tableau(s.epoque_a_confirmer, doublons)}

<h2>Sans nom <span class="compte">(${s.sans_nom.length})</span></h2>
<p class="gris">L’archive n’a gardé que leur identifiant Telegram : impossible de les reconnaître à l’œil. Ils ne pourraient être activés que par leur compte Telegram. Pas de numéro par défaut.</p>
<details><summary>Voir les ${s.sans_nom.length} lignes</summary>${tableau(s.sans_nom, doublons, { epoque: true })}</details>

<h2>Comment la liste est faite</h2>
<details><summary>Les règles et ce qui n’y est pas</summary>
<ul>
  <li>Personnes de l’ontologie de nature élève, élève proche ou mentoré, vues dans au moins un groupe AOK : IziMoney / IziTrade, AOKnowledge, Deep Knowledge, coachings, Ligue des Schlags, Cercle Izi Gentleman, Live Club. Quelqu’un vu seulement dans Future Infinity, le MLM, SIGMA, les petits groupes ou hors écosystème n’y est pas, sauf s’il porte un statut d’ancien élève payé.</li>
  <li>Statuts : Formation IziTrade (groupes « Formation &lt;prénom&gt; », formation collective, session commune), Mentoré IziTrade (Communauté 6 mois), KOFM, SMM et Deep Knowledge. KOFM et SMM sont les noms de la formation sur LearnyBox. Les formateurs (Elgin) et le co-coach des salons KOFM (Adrien) ne prennent pas le statut de ces groupes.</li>
  <li>Époque, la plus ancienne des deux : IziTrade dès qu’il y a un statut IziTrade ou une trace dans IziMoney / IziTrade hors des groupes SMM de 2025, sinon LearnyBox.</li>
  <li>Première activité : la date d’entrée dans le groupe quand l’archive la connaît, sinon une estimation (marquée ≈) tirée de son premier message gardé.</li>
  <li>Pas dans la liste : ${c.actuels_hors_liste} membres vus seulement depuis Skool (le Live Club de 2026 surtout), et ${c.robots_retires} robot de groupe.</li>
  <li>Fiche du cockpit : la fiche membre liée à la personne. « Liée par le nom » veut dire que le lien n’a pas d’autre preuve que le nom.</li>
  <li>Compte du site : un compte existe déjà. Par email ou par Telegram, il prendra son numéro tout seul. Sur le nom seul, ou par une fiche liée par le nom, l’équipe confirme d’abord dans le cockpit.</li>
  <li>Le pseudo Telegram n’est connu que pour une poignée de personnes : l’archive garde surtout le nom affiché.</li>
</ul>
</details>
</main>
<script>
(function () {
  var champ = document.getElementById('q');
  if (!champ) return;
  champ.addEventListener('input', function () {
    var q = champ.value.trim().toLowerCase();
    var lignes = document.querySelectorAll('.ligne[data-q]');
    for (var i = 0; i < lignes.length; i++) {
      var l = lignes[i];
      l.classList.toggle('cache', q !== '' && l.getAttribute('data-q').indexOf(q) === -1);
    }
    if (q) { var d = document.querySelectorAll('details'); for (var j = 0; j < d.length; j++) d[j].open = true; }
  });
})();
</script>
</body>
</html>
`
}
