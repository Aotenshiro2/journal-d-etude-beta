// Ce que les deux fiches d'un trade montrent pareil (brief J2) : le ressenti
// (warmup avant le trade, cooldown après), le dernier jugement A/B/C et les
// captures du Carnet.

import Link from 'next/link'
import type { TradeSynthese } from '@/lib/synthese-trades-pur'
import { LIBELLE_CAUSE, Note } from './commun'

const TEXTE = { color: 'var(--node-preview)' }
const FORT = { color: 'var(--node-title)' }

export function ContenuRessenti({ trade }: { trade: TradeSynthese }) {
  const { emotionDepart, emotion, erreur, lecon } = trade.ressenti
  if (emotionDepart === null && !emotion && !erreur && !lecon) {
    return <p className="text-[12.5px]" style={TEXTE}>Rien de noté dans le Carnet pour ce trade.</p>
  }
  return (
    <div className="grid gap-1 text-[12.5px]" style={TEXTE}>
      {emotionDepart !== null && <p>Départ : <b className="font-semibold" style={FORT}>{emotionDepart} / 100</b></p>}
      {emotion && <p>Après : <b className="font-semibold" style={FORT}>{emotion}</b></p>}
      {erreur && <p>Erreur : {erreur}</p>}
      {lecon && <p>Leçon : {lecon}</p>}
    </div>
  )
}

export function ContenuJugement({ trade }: { trade: TradeSynthese }) {
  const j = trade.jugement
  if (!j) {
    return (
      <p className="text-[12.5px]" style={TEXTE}>
        Pas encore jugé.{' '}
        <Link href={`/review?note=${encodeURIComponent(trade.noteId)}`} className="font-medium underline-offset-2 hover:underline" style={{ color: 'var(--trade-bleu)' }}>
          Le juger dans la relecture
        </Link>
      </p>
    )
  }
  return (
    <p className="flex flex-wrap items-baseline gap-1.5 text-[12.5px]" style={TEXTE}>
      <Note grade={j.grade} />
      {j.cause && <span>{LIBELLE_CAUSE[j.cause] ?? j.cause}.</span>}
      {j.phrase && <span>{j.phrase}</span>}
    </p>
  )
}

export function ContenuCaptures({ trade }: { trade: TradeSynthese }) {
  if (trade.captures.length === 0) return <p className="text-[12.5px]" style={TEXTE}>Pas de capture rattachée à ce trade.</p>
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {trade.captures.slice(0, 4).map((c, i) => (
        <a key={c.messageId} href={c.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg" title="Ouvrir la capture en grand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={c.url} alt={`Capture ${i + 1} du trade`} className="block h-auto w-full" loading="lazy" />
        </a>
      ))}
    </div>
  )
}
