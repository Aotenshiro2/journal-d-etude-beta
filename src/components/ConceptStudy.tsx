'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   « Étudier un concept » — 0.2, lot 1.

   Quatre zones, dans l'ordre de lecture voulu : ce que les chiffres disent, ce
   qu'on a VU (les captures de séance), ce qu'on a ÉCRIT (les blocs, par séance),
   et où aller ensuite (les concepts voisins).

   La galerie passe avant le texte, et c'est délibéré : mesuré le 31/08, le membre
   qui tague le plus met 42 de ses 89 liens sur des captures. Pour lui, étudier un
   concept, c'est d'abord revoir ses graphiques.

   ── LA RÈGLE D'HONNÊTETÉ DES CHIFFRES (à ne pas assouplir) ──────────────────
   Deux garde-fous imposés par ce que la base contient réellement :

   1. On DIT par quel chemin un chiffre est calculé. Le résultat est attribué à la
      SÉANCE où le concept apparaît, pas au trade où il était en jeu — parce que
      l'intersection entre les blocs tagués et les blocs rattachés à un trade est
      exactement 0 en base (mesure du 31/08). Laisser croire à la seconde lecture
      serait fabriquer une certitude fausse sur un concept.

   2. AUCUN POURCENTAGE sous le seuil. Afficher « 33 % de réussite » sur trois
      trades installe une croyance qu'aucune donnée ne soutient, et l'écran est
      censé faire l'inverse : « pas ceux que tu penses, ceux que tes notes
      confirment ». En dessous, les nombres bruts et rien d'autre.
   ───────────────────────────────────────────────────────────────────────────── */

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Images, FileText, TrendingUp, Maximize2 } from 'lucide-react'
import ImageLightbox from './ImageLightbox'

export type DonneesConcept = {
  tag: { id: string; name: string; color: string; category: string | null }
  seances: {
    id: string
    titre: string
    favicon: string | null
    date: string | null
    horodatage: number
    porteLeConcept: boolean
    grades: string[]
    blocsTexte: { id: string; texte: string; tradeRef: string | null }[]
  }[]
  captures: {
    id: string; src: string; legende: string
    seanceId: string; seanceTitre: string; date: string | null
  }[]
  voisins: { id: string; name: string; color: string; partagees: number }[]
  stats: {
    seances: number; blocs: number; captures: number
    resultats: { gain: number; perte: number; be: number }
    notation: { A: number; B: number; C: number }
    causes: { technique: number; connaissance: number; emotionnel: number }
  }
}

/** En dessous, on n'affiche aucun pourcentage. Voir l'en-tête du fichier. */
const SEUIL_POURCENTAGE = 10

const COULEUR_GRADE: Record<string, string> = { A: '#22c55e', B: '#f59e0b', C: '#ef4444' }
const COULEUR_RESULTAT: Record<string, string> = { gain: '#22c55e', perte: '#ef4444', be: 'var(--node-meta)' }
const NOM_CAUSE: Record<string, string> = { technique: 'Technique', connaissance: 'Connaissance', emotionnel: 'Émotionnel' }

function Tuile({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
      {children}
    </div>
  )
}

/** Une répartition en barres + nombres bruts. Le pourcentage n'apparaît qu'au
 *  delà du seuil, et le libellé du CHEMIN est obligatoire (prop `chemin`). */
function Repartition({ titre, chemin, parts, couleurs }: {
  titre: string
  chemin: string
  parts: Record<string, number>
  couleurs: Record<string, string>
}) {
  const cles = Object.keys(parts)
  const total = cles.reduce((n, k) => n + parts[k], 0)
  const assezPourPourcent = total >= SEUIL_POURCENTAGE

  return (
    <Tuile>
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--node-title)' }}>{titre}</p>
      <p className="text-[11px] mb-3" style={{ color: 'var(--node-meta)', opacity: 0.85 }}>{chemin}</p>

      {total === 0 ? (
        <p className="text-[12px]" style={{ color: 'var(--node-meta)' }}>Rien à montrer encore.</p>
      ) : (
        <>
          <div className="flex h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--canvas-bg)' }}>
            {cles.map(k => parts[k] > 0 && (
              <div key={k} style={{ width: `${(parts[k] / total) * 100}%`, background: couleurs[k] }} title={`${parts[k]} ${k}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {cles.map(k => (
              <span key={k} className="text-[12px] flex items-center gap-1.5" style={{ color: 'var(--node-preview)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: couleurs[k] }} />
                {k} <strong style={{ color: 'var(--node-title)' }}>{parts[k]}</strong>
                {assezPourPourcent && <span style={{ color: 'var(--node-meta)' }}>· {Math.round((parts[k] / total) * 100)} %</span>}
              </span>
            ))}
          </div>
          {!assezPourPourcent && (
            <p className="text-[10px] mt-2" style={{ color: 'var(--node-meta)', opacity: 0.75 }}>
              {total} au total — trop peu pour un pourcentage, on s&apos;en tient aux nombres.
            </p>
          )}
        </>
      )}
    </Tuile>
  )
}

export default function ConceptStudy({ donnees }: { donnees: DonneesConcept }) {
  const { tag, seances, captures, voisins, stats } = donnees
  const [agrandie, setAgrandie] = useState<string | null>(null)

  const seancesAvecTexte = seances.filter(s => s.blocsTexte.length > 0)
  const seancesSansRien = seances.filter(s => s.blocsTexte.length === 0)
  const causesPosees = Object.entries(stats.causes).filter(([, n]) => n > 0)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-5 sm:px-6 py-6 sm:py-8">

        {/* ── En-tête ─────────────────────────────────────────────────────── */}
        <Link href="/concepts" className="inline-flex items-center gap-1.5 text-[12px] mb-4 hover:underline" style={{ color: 'var(--node-meta)' }}>
          <ArrowLeft size={13} /> Tous les concepts
        </Link>

        <div className="flex items-center gap-2.5 flex-wrap mb-1">
          <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: tag.color }} />
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--node-title)' }}>{tag.name}</h1>
          {tag.category && (
            <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-meta)' }}>
              {tag.category}
            </span>
          )}
        </div>
        <p className="text-[13px] mb-6" style={{ color: 'var(--node-meta)' }}>
          {stats.seances} séance{stats.seances > 1 ? 's' : ''} · {stats.captures} capture{stats.captures > 1 ? 's' : ''} · {stats.blocs} bloc{stats.blocs > 1 ? 's' : ''} de note
        </p>

        {/* ── Les chiffres ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
          <Repartition
            titre="Résultat des séances"
            chemin="Trades des séances où ce concept apparaît — pas « les trades où il était en jeu ». La distinction compte."
            parts={stats.resultats}
            couleurs={COULEUR_RESULTAT}
          />
          <Repartition
            titre="Ta notation"
            chemin="Jugements A/B/C posés sur ces séances."
            parts={stats.notation}
            couleurs={COULEUR_GRADE}
          />
        </div>

        {causesPosees.length > 0 && (
          <div className="mb-8">
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>Causes relevées sur ces séances</p>
            <div className="flex flex-wrap gap-2">
              {causesPosees.map(([k, n]) => (
                <span key={k} className="text-[12px] px-3 py-1 rounded-full" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-preview)' }}>
                  {NOM_CAUSE[k]} <strong style={{ color: 'var(--node-title)' }}>{n}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── La galerie ──────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-3">
          <Images size={16} style={{ color: 'var(--node-title)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Ce que tu as vu</h2>
          <span className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{captures.length}</span>
        </div>

        {captures.length === 0 ? (
          <Tuile>
            <p className="text-[13px]" style={{ color: 'var(--node-meta)' }}>
              Aucune capture reliée à ce concept. Les screenshots de séance sont pourtant là — ils attendent d&apos;être reliés
              depuis le canvas d&apos;une note, en taguant le bloc image.
            </p>
          </Tuile>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
            {captures.map(c => (
              <div key={c.id} className="group rounded-xl overflow-hidden" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
                <button onClick={() => setAgrandie(c.src)} className="relative block w-full" style={{ aspectRatio: '16 / 10', cursor: 'zoom-in' }} title="Voir en grand">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.src} alt={c.legende || c.seanceTitre} className="w-full h-full object-cover" />
                  <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}>
                    <Maximize2 size={12} />
                  </span>
                </button>
                <div className="px-2.5 py-2">
                  <Link href={`/notes/${c.seanceId}`} className="block text-[11px] font-medium truncate hover:underline" style={{ color: 'var(--node-title)' }}>
                    {c.seanceTitre}
                  </Link>
                  {c.date && <p className="text-[10px]" style={{ color: 'var(--node-meta)' }}>{c.date}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Les références ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 mb-3 mt-8">
          <FileText size={16} style={{ color: 'var(--node-title)' }} />
          <h2 className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>Ce que tu as écrit</h2>
          <span className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{stats.blocs}</span>
        </div>

        {seancesAvecTexte.length === 0 ? (
          <Tuile>
            <p className="text-[13px]" style={{ color: 'var(--node-meta)' }}>Aucun bloc de texte relié à ce concept pour l&apos;instant.</p>
          </Tuile>
        ) : (
          <div className="space-y-3">
            {seancesAvecTexte.map(s => (
              <div key={s.id} className="rounded-2xl overflow-hidden" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
                <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--float-border)' }}>
                  {s.favicon
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.favicon} alt="" style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                    : <span style={{ width: 14, height: 14, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0 }} />}
                  <Link href={`/notes/${s.id}`} className="flex-1 min-w-0 text-[13px] font-semibold truncate hover:underline" style={{ color: 'var(--node-title)' }}>
                    {s.titre}
                  </Link>
                  {s.grades.map((g, i) => (
                    <span key={i} className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${COULEUR_GRADE[g]}22`, color: COULEUR_GRADE[g] }}>{g}</span>
                  ))}
                  {s.date && <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--node-meta)' }}>{s.date}</span>}
                </div>
                <div className="px-4 py-3 space-y-2.5">
                  {s.blocsTexte.map(b => (
                    <div key={b.id} className="flex gap-2.5">
                      <span className="w-1 rounded-full flex-shrink-0 mt-0.5" style={{ background: tag.color, opacity: 0.5 }} />
                      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--node-preview)', whiteSpace: 'pre-line' }}>{b.texte}</p>
                      {b.tradeRef && (
                        <span className="flex-shrink-0 self-start text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1" style={{ background: 'var(--canvas-bg)', color: '#f59e0b' }}>
                          <TrendingUp size={9} /> trade
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Les séances où la NOTE ENTIÈRE porte le concept, sans bloc tagué : ne
            pas les taire, c'est la moitié de l'usage (les membres qui taguent au
            niveau note). Sans ça leur écran paraîtrait vide. */}
        {seancesSansRien.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>
              Séances entières rattachées à ce concept
            </p>
            <div className="flex flex-wrap gap-2">
              {seancesSansRien.map(s => (
                <Link key={s.id} href={`/notes/${s.id}`} className="text-[12px] px-3 py-1.5 rounded-full hover:underline flex items-center gap-1.5" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-preview)' }}>
                  {s.titre}
                  {s.date && <span style={{ color: 'var(--node-meta)' }}>· {s.date}</span>}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── Où aller ensuite ────────────────────────────────────────────── */}
        {voisins.length > 0 && (
          <div className="mt-10">
            <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>Va avec</p>
            <div className="flex flex-wrap gap-2">
              {voisins.map(v => (
                <Link key={v.id} href={`/concepts/${v.id}`} className="text-[12px] px-3 py-1.5 rounded-full flex items-center gap-1.5 hover:underline" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-preview)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: v.color }} />
                  {v.name}
                  <span style={{ color: 'var(--node-meta)' }}>· {v.partagees}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {agrandie && <ImageLightbox src={agrandie} onClose={() => setAgrandie(null)} />}
    </div>
  )
}
