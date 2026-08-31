'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, le dernier verrou avant le 0.2 : la carte de relecture.

   Demande de Brice du 23/07 : « revoir le positionnement des blocs Verdict de la
   note et Trades notés — esthétiquement pas bon aujourd'hui ». Plus, du même
   jour, le bouton **Retravailler** à côté de « J'ai relu » : pouvoir rouvrir le
   canvas quand la réorganisation ne satisfait pas, SANS marquer la note relue.

   Deux défauts se lisent dans le code actuel, avant tout jugement de goût :
   · les deux blocs n'ont pas la même convention. « Verdict de la note » est un
     label DANS la boîte (prop `label` de `VerdictRow`), « Trades notés » est un
     titre de section AU-DESSUS de ses boîtes. Deux grammaires collées ;
   · le fond se répète : le bandeau est en `--canvas-bg` et chaque ligne de
     verdict à l'intérieur AUSSI. Rien ne se détache, seules les bordures
     travaillent — d'où l'aspect plat.

   Ce qui est simplifié ici, exprès : la zone du document est un bloc de
   remplacement. La question porte sur la place du RE-JUGEMENT dans la carte, pas
   sur le rendu du document (`DocumentView`, déjà validé). Les lignes de verdict
   reprennent en revanche la vraie recette (A/B/C à 44 px au doigt, causes sur
   leur propre ligne, champs à 16 px) pour que le volume soit honnête.

   Route publique déclarée dans `middleware.ts` (publicPaths).
   À SUPPRIMER une fois tranché :
     rm -rf src/app/labo-relecture .next/types/app/labo-relecture
     puis retirer '/labo-relecture' de publicPaths dans middleware.ts
   ───────────────────────────────────────────────────────────────────────────── */

import { useState } from 'react'
import {
  Check, SkipForward, ExternalLink, TrendingUp, Plus, ChevronDown, ChevronRight, Pencil,
} from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'

const GRADE_CLASS: Record<string, string> = {
  A: 'bg-green-400/10 text-green-500 border-green-500/30',
  B: 'bg-amber-400/10 text-amber-500 border-amber-500/30',
  C: 'bg-red-400/10 text-red-500 border-red-500/30',
}
const GRADES = ['A', 'B', 'C'] as const
const CAUSES = [
  { key: 'technique', label: 'Technique' },
  { key: 'connaissance', label: 'Connaissance' },
  { key: 'emotionnel', label: 'Émotionnel' },
]

/* ── Données factices ────────────────────────────────────────────────────────
   Un cas volontairement CHARGÉ : un verdict d'ensemble et trois trades notés.
   C'est là que la carte actuelle s'allonge et que le défaut se voit ; juger sur
   un seul verdict donnerait une fausse impression de sobriété. */
const VERDICT_NOTE = { id: 'g1', grade: 'B', phrase: "J'ai laissé courir sans plan de sortie." }
const VERDICTS_TRADES = [
  { id: 't1', grade: 'A', phrase: 'Entrée sur retour du déséquilibre, propre.', label: 'Trade · 10:32 · Gain', dot: '#22c55e' },
  { id: 't2', grade: 'C', phrase: 'Revenge trade dans la minute qui suit.', label: 'Trade · 10:41 · Perte', dot: '#ef4444' },
  { id: 't3', grade: 'B', phrase: 'Sortie au bruit, la thèse tenait encore.', label: 'Trade · 14:07 · BE', dot: 'var(--node-meta)' },
]

/* ── La ligne de re-jugement ─────────────────────────────────────────────── */

function LigneVerdict({
  v, label, dot, fond, labelDedans = true,
}: {
  v: { id: string; grade: string; phrase: string }
  label?: string
  dot?: string
  /** La surface de la ligne. Le défaut actuel : la même que celle du bandeau. */
  fond: string
  /** false = le label est rendu par l'appelant, au-dessus du groupe. */
  labelDedans?: boolean
}) {
  const [grade, setGrade] = useState(v.grade)
  const [cause, setCause] = useState<string | null>(null)

  return (
    <div className="rounded-xl p-3" style={{ background: fond, border: '1px solid var(--node-border)' }}>
      {labelDedans && label && (
        <div className="flex items-center gap-1.5 mb-2">
          {dot && <span className="w-2 h-2 rounded-full" style={{ background: dot }} />}
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--node-meta)' }}>{label}</span>
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        {GRADES.map(g => (
          <button key={g} onClick={() => setGrade(g)}
            className={`w-11 h-11 sm:w-8 sm:h-8 rounded-lg border text-base sm:text-sm font-semibold transition-all ${grade === g ? GRADE_CLASS[g] : ''}`}
            style={grade === g ? undefined : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}>
            {g}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {CAUSES.map(c => (
          <button key={c.key} onClick={() => setCause(cause === c.key ? null : c.key)}
            className="text-xs sm:text-[11px] px-3 py-2 sm:px-2 sm:py-0.5 rounded-full border transition-colors"
            style={cause === c.key ? { borderColor: 'var(--node-title)', color: 'var(--node-title)' } : { borderColor: 'var(--node-border)', color: 'var(--node-meta)' }}>
            {c.label}
          </button>
        ))}
      </div>
      <textarea defaultValue={v.phrase} rows={2}
        className="w-full resize-none rounded-lg px-2.5 py-2 text-base sm:text-[13px] outline-none mb-2"
        style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }} />
      <div className="flex justify-end">
        <button className="flex items-center gap-1.5 text-sm sm:text-xs font-medium px-4 py-2.5 sm:px-3 sm:py-1.5 rounded-lg text-white" style={{ background: '#3b82f6' }}>
          <Check size={13} /> Confirmer
        </button>
      </div>
    </div>
  )
}

/* ── Les morceaux communs à toutes les variantes ─────────────────────────── */

function EnTete() {
  return (
    <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3.5" style={{ borderBottom: '1px solid var(--float-border)' }}>
      <span style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0 }} />
      <h2 className="flex-1 min-w-0 text-sm font-semibold truncate" style={{ color: 'var(--node-title)' }}>Session 17 mars — TopStepX MNQM26</h2>
      <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full flex-shrink-0" style={{ color: '#f59e0b', background: 'var(--canvas-bg)' }}>
        <TrendingUp size={11} /> Positions / trades
      </span>
      <span className="flex-shrink-0 p-1 rounded-md" style={{ color: 'var(--node-meta)' }}><ExternalLink size={14} /></span>
    </div>
  )
}

/** Le document relu. Bloc de remplacement : ce n'est pas lui qu'on juge ici. */
function Document({ hauteur = '30vh' }: { hauteur?: string }) {
  return (
    <div className="px-4 sm:px-5 py-4" style={{ maxHeight: hauteur, overflowY: 'auto' }}>
      <div className="rounded-xl px-4 py-8 text-center text-[12px]"
        style={{ background: 'var(--canvas-bg)', border: '1px dashed var(--node-border)', color: 'var(--node-meta)' }}>
        la note réorganisée, en lecture seule<br />
        <span style={{ opacity: 0.7 }}>(DocumentView — déjà validé, remplacé ici pour ne pas brouiller le jugement)</span>
      </div>
    </div>
  )
}

function Capture() {
  return (
    <div className="px-4 sm:px-5 py-3.5" style={{ borderTop: '1px solid var(--float-border)' }}>
      <div className="flex items-center gap-2">
        <input placeholder="Une idée en relisant ?"
          className="flex-1 min-w-0 rounded-lg px-3 py-2.5 text-base sm:text-[13px] outline-none"
          style={{ background: 'var(--canvas-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }} />
        <button className="flex items-center gap-1 text-sm sm:text-xs font-medium px-3 py-2.5 sm:py-2 rounded-lg flex-shrink-0"
          style={{ border: '1px solid var(--node-border)', color: 'var(--node-title)' }}>
          <Plus size={13} /> Ajouter
        </button>
      </div>
    </div>
  )
}

/** La barre d'actions. `retravailler` place le nouveau bouton demandé le 23/07 :
 *  il rouvre le canvas SANS marquer la note relue — donc il ne doit pas se
 *  confondre avec « J'ai relu », qui, lui, sort la note de la file. */
function Actions({ retravailler }: { retravailler: 'a-cote' | 'discret' | 'sous-le-document' }) {
  const bouton = (
    <button className="flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-3 sm:py-2.5 rounded-xl"
      style={{ border: '1px solid var(--node-border)', color: 'var(--node-title)' }}>
      <Pencil size={14} /> Retravailler
    </button>
  )
  return (
    <div className="px-4 sm:px-5 py-3.5 safe-bottom" style={{ borderTop: '1px solid var(--float-border)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button className="flex items-center gap-1.5 text-sm sm:text-xs px-4 py-3 sm:px-3 sm:py-2 rounded-lg" style={{ color: 'var(--node-meta)' }}>
          <SkipForward size={13} /> Passer
        </button>
        {retravailler === 'a-cote' && bouton}
        <button className="flex-1 sm:flex-none flex items-center justify-center gap-2 text-sm font-medium px-5 py-3 sm:py-2.5 rounded-xl text-white" style={{ background: '#3b82f6' }}>
          <Check size={15} /> J&apos;ai relu
        </button>
      </div>
      {retravailler === 'discret' && (
        <div className="flex justify-center mt-3">
          <button className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-md underline" style={{ color: 'var(--node-meta)' }}>
            <Pencil size={12} /> Pas satisfait ? Retravailler la note
          </button>
        </div>
      )}
      <div className="flex items-center justify-center flex-wrap gap-x-1.5 gap-y-1 text-[11px] mt-3" style={{ color: 'var(--node-meta)', opacity: 0.8 }}>
        <span>Pas encore ancrée ? Me la reproposer dans</span>
        <button className="px-2.5 py-1.5 rounded-md underline" style={{ color: 'var(--node-meta)' }}>7 j</button>
        <button className="px-2.5 py-1.5 rounded-md underline" style={{ color: 'var(--node-meta)' }}>30 j</button>
      </div>
    </div>
  )
}

const CARTE = 'w-full rounded-2xl overflow-hidden'
const styleCarte = { background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' } as const

/* ── 0 · Le témoin ───────────────────────────────────────────────────────── */

function Temoin() {
  return (
    <div className={CARTE} style={styleCarte}>
      <EnTete />
      <Document />
      <div className="px-5 py-4 space-y-3" style={{ borderTop: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}>
        <div className="space-y-2.5">
          <LigneVerdict v={VERDICT_NOTE} label="Verdict de la note" fond="var(--canvas-bg)" />
        </div>
        <div className="space-y-2.5">
          <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--node-meta)' }}>Trades notés</p>
          {VERDICTS_TRADES.map(v => (
            <LigneVerdict key={v.id} v={v} label={v.label} dot={v.dot} fond="var(--canvas-bg)" />
          ))}
        </div>
      </div>
      <Capture />
      <Actions retravailler="a-cote" />
    </div>
  )
}

/* ── A · Une seule grammaire, et les lignes se détachent ─────────────────── */

function VarianteA() {
  return (
    <div className={CARTE} style={styleCarte}>
      <EnTete />
      <Document />
      <div className="px-4 sm:px-5 py-4" style={{ borderTop: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--node-title)' }}>Re-juger</p>

        <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>La note</p>
        <div className="space-y-2.5 mb-4">
          <LigneVerdict v={VERDICT_NOTE} fond="var(--node-bg)" labelDedans={false} />
        </div>

        <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>Les trades</p>
        <div className="space-y-2.5">
          {VERDICTS_TRADES.map(v => (
            <div key={v.id}>
              <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                <span className="w-2 h-2 rounded-full" style={{ background: v.dot }} />
                <span className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{v.label}</span>
              </div>
              <LigneVerdict v={v} fond="var(--node-bg)" labelDedans={false} />
            </div>
          ))}
        </div>
      </div>
      <Capture />
      <Actions retravailler="a-cote" />
    </div>
  )
}

/* ── B · Le verdict d'ensemble d'abord, les trades repliés ───────────────── */

function VarianteB() {
  const [ouvert, setOuvert] = useState(false)
  return (
    <div className={CARTE} style={styleCarte}>
      <EnTete />
      <Document />
      <div className="px-4 sm:px-5 py-4" style={{ borderTop: '1px solid var(--float-border)', background: 'var(--canvas-bg)' }}>
        <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>Verdict de la note</p>
        <LigneVerdict v={VERDICT_NOTE} fond="var(--node-bg)" labelDedans={false} />

        <button onClick={() => setOuvert(o => !o)}
          className="w-full flex items-center gap-2 rounded-xl px-3.5 py-2.5 mt-3"
          style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
          <span className="text-[13px] font-medium" style={{ color: 'var(--node-title)' }}>Trades notés</span>
          <span className="text-[11px] px-1.5 rounded-full" style={{ background: 'var(--canvas-bg)', color: 'var(--node-meta)' }}>{VERDICTS_TRADES.length}</span>
          <span className="flex-1" />
          <span className="flex items-center gap-1">
            {VERDICTS_TRADES.map(v => (
              <span key={v.id} className="w-2 h-2 rounded-full" style={{ background: v.dot }} />
            ))}
          </span>
          {ouvert ? <ChevronDown size={15} style={{ color: 'var(--node-meta)' }} /> : <ChevronRight size={15} style={{ color: 'var(--node-meta)' }} />}
        </button>

        {ouvert && (
          <div className="space-y-2.5 mt-2.5">
            {VERDICTS_TRADES.map(v => (
              <div key={v.id}>
                <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: v.dot }} />
                  <span className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{v.label}</span>
                </div>
                <LigneVerdict v={v} fond="var(--node-bg)" labelDedans={false} />
              </div>
            ))}
          </div>
        )}
      </div>
      <Capture />
      <Actions retravailler="discret" />
    </div>
  )
}

/* ── C · Deux colonnes au bureau ─────────────────────────────────────────── */

function VarianteC() {
  return (
    <div className={CARTE} style={styleCarte}>
      <EnTete />
      <div className="flex flex-col md:flex-row">
        <div className="md:flex-1 md:min-w-0 md:border-r" style={{ borderColor: 'var(--float-border)' }}>
          <Document hauteur="52vh" />
        </div>
        <div className="md:w-[340px] md:flex-shrink-0 px-4 sm:px-5 py-4 md:overflow-y-auto"
          style={{ background: 'var(--canvas-bg)', maxHeight: '52vh' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--node-title)' }}>Re-juger</p>
          <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>La note</p>
          <div className="mb-4">
            <LigneVerdict v={VERDICT_NOTE} fond="var(--node-bg)" labelDedans={false} />
          </div>
          <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--node-meta)' }}>Les trades</p>
          <div className="space-y-2.5">
            {VERDICTS_TRADES.map(v => (
              <div key={v.id}>
                <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: v.dot }} />
                  <span className="text-[11px]" style={{ color: 'var(--node-meta)' }}>{v.label}</span>
                </div>
                <LigneVerdict v={v} fond="var(--node-bg)" labelDedans={false} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <Capture />
      <Actions retravailler="a-cote" />
    </div>
  )
}

/* ── La page ─────────────────────────────────────────────────────────────── */

const VARIANTES = [
  {
    n: '0', titre: 'Témoin — aujourd\'hui',
    idee: 'le label « Verdict de la note » est DANS la boîte, « Trades notés » est un titre AU-DESSUS des siennes ; et les lignes ont le même fond que le bandeau qui les contient, donc rien ne se détache',
    Rendu: Temoin,
  },
  {
    n: 'A', titre: 'Une seule grammaire, et les lignes se détachent',
    idee: 'un titre « Re-juger » pour la zone, puis deux intertitres traités pareil (La note / Les trades). Le libellé du trade passe au-dessus de sa boîte comme celui de la note, et les lignes passent en `--node-bg` sur le bandeau `--canvas-bg`',
    Rendu: VarianteA,
  },
  {
    n: 'B', titre: 'Le verdict d\'ensemble d\'abord, les trades repliés',
    idee: 'même correction que A, plus une hiérarchie : le jugement de la note est ouvert, les trades sont derrière un dépliant qui montre déjà leurs pastilles. La carte cesse de s\'allonger quand il y a cinq trades. « Retravailler » est ici en lien discret, pas en bouton',
    Rendu: VarianteB,
  },
  {
    n: 'C', titre: 'Deux colonnes au bureau',
    idee: 'le document à gauche, le re-jugement dans sa colonne à droite : on ne scrolle plus pour passer de ce qu\'on relit à ce qu\'on juge. Une seule colonne sous 768 px, donc le téléphone retrouve exactement A',
    Rendu: VarianteC,
  },
]

export default function LaboRelecture() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 24px 80px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>La carte de relecture</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--node-meta)', marginBottom: 14, maxWidth: 800, lineHeight: 1.6 }}>
          Le dernier verrou avant le 0.2. Deux demandes du 23/07 : le positionnement des blocs <strong style={{ color: 'var(--node-title)' }}>Verdict
          de la note</strong> et <strong style={{ color: 'var(--node-title)' }}>Trades notés</strong>, et le bouton <strong style={{ color: 'var(--node-title)' }}>Retravailler</strong> —
          rouvrir le canvas quand la réorganisation ne te satisfait pas, <em>sans</em> marquer la note relue.
        </p>
        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 14, maxWidth: 800,
          padding: '12px 14px', borderRadius: 10, background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Ce qui cloche aujourd&apos;hui, avant tout jugement de goût.</strong> ① Les
          deux blocs n&apos;ont pas la même convention : « Verdict de la note » est un label <em>dans</em> la boîte, « Trades notés »
          un titre <em>au-dessus</em> des siennes. ② Le fond se répète — le bandeau est en <code>--canvas-bg</code> et chaque ligne
          de verdict à l&apos;intérieur aussi, donc seules les bordures travaillent. Les trois variantes corrigent les deux ; elles
          diffèrent sur la <em>hiérarchie</em> et sur la place du bouton Retravailler.
        </div>
        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 30, maxWidth: 800,
          padding: '12px 14px', borderRadius: 10, border: '1px dashed var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>Le cas montré est volontairement chargé</strong> — un verdict d&apos;ensemble
          et trois trades notés. C&apos;est là que la carte s&apos;allonge et que le défaut se voit : juger sur un seul verdict
          donnerait une fausse impression de sobriété. La zone du document est un bloc de remplacement, ce n&apos;est pas elle
          qu&apos;on juge ici. <strong style={{ color: 'var(--node-title)' }}>Rétrécis la fenêtre</strong> pour voir le comportement
          téléphone — c&apos;est là que C se replie sur A.
        </div>

        <div style={{ display: 'grid', gap: 40 }}>
          {VARIANTES.map(v => (
            <div key={v.n}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)',
                }}>{v.n}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--node-title)' }}>{v.titre}</span>
                <span style={{ fontSize: 12, color: 'var(--node-meta)', flex: 1, minWidth: 260 }}>{v.idee}</span>
              </div>
              <v.Rendu />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
