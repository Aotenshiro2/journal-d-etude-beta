'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Les poignées de connexion d'une carte — 0.1.7

   HUIT poignées : sur chacun des quatre côtés, une source ET une cible
   superposées. Avant, il n'y en avait que quatre (`tt`/`tl` en cible, `sb`/`sr`
   en source), donc une carte ne pouvait se relier que bas/droite → haut/gauche.
   Un trait vers une carte située à gauche faisait le tour par le bas.

   Pourquoi pas `connectionMode: 'loose'`, qui semblerait plus simple : dans
   `getEdgePosition`, le `concat` du mode loose n'existe QUE côté cible. Le
   départ resterait contraint aux poignées de type `source`. On aurait donc une
   asymétrie trompeuse, et les `toHandle` persistés cesseraient de résoudre si on
   revenait en strict un jour. On reste en strict, avec un jeu d'ids symétrique.

   Les quatre ids déjà en base (`tt`, `tl`, `sb`, `sr`) sont conservés tels
   quels : aucun trait existant ne change de rendu, aucune migration.

   Deux poignées superposées est un cas géré par React Flow — `getClosestHandle`
   commente « when multiple handles overlay each other we prefer the opposite
   handle » et choisit celle du type opposé à l'origine du glisser. À l'écran,
   les deux points de 9 px se lisent comme un seul.
   ───────────────────────────────────────────────────────────────────────────── */

import { Fragment } from 'react'
import { Handle, Position } from '@xyflow/react'

const COTES = [
  { cle: 'haut', pos: Position.Top, source: 'st', cible: 'tt' },
  { cle: 'gauche', pos: Position.Left, source: 'sl', cible: 'tl' },
  { cle: 'bas', pos: Position.Bottom, source: 'sb', cible: 'tb' },
  { cle: 'droite', pos: Position.Right, source: 'sr', cible: 'tr' },
] as const

export function PoigneesCardinales({
  couleur = 'var(--node-handle)',
  taille = 9,
  classeSurvol = 'group-hover:!opacity-100',
}: {
  couleur?: string
  taille?: number
  /** Variante de révélation au survol. Un nœud qui NOMME son groupe Tailwind
   *  (`group/gz`) doit passer `group-hover/gz:!opacity-100`, sinon rien ne se
   *  déclenche. Chaîne vide = poignées jamais révélées : c'est le cas du groupe,
   *  dont les poignées vivent en `zIndex: -1` derrière les cartes et ne servent
   *  que d'ancrage géométrique au trait. */
  classeSurvol?: string
}) {
  // `opacity: 0` au repos + `group-hover` : la carte doit rester lisible tant
  // qu'on ne cherche pas à la relier. Le parent doit porter la classe `group`.
  const style = {
    background: couleur,
    opacity: 0,
    width: taille,
    height: taille,
    minWidth: 0,
    border: 'none',
  } as const

  return (
    <>
      {COTES.map(c => (
        <Fragment key={c.cle}>
          <Handle
            id={c.cible}
            type="target"
            position={c.pos}
            style={style}
            className={`!transition-opacity ${classeSurvol}`}
          />
          <Handle
            id={c.source}
            type="source"
            position={c.pos}
            style={style}
            className={`!transition-opacity ${classeSurvol}`}
          />
        </Fragment>
      ))}
    </>
  )
}
