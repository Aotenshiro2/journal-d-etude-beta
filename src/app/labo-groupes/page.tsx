'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, choix du rendu de la box de groupe.
   Route publique déclarée dans `middleware.ts` (publicPaths).
   À SUPPRIMER une fois la variante tranchée :
     rm -rf src/app/labo-groupes .next/types/app/labo-groupes
     puis retirer '/labo-groupes' de publicPaths dans middleware.ts
   Aucune donnée réelle ici : les cartes sont des maquettes figées.
   ───────────────────────────────────────────────────────────────────────────── */

import { useTheme } from '@/contexts/ThemeContext'

const GREEN = { border: '#34d399', bg: 'rgba(52,211,153,0.07)' }

// Reproduit fidèlement le markup de NoteMapNode (header / aperçu / pied).
function FakeCard({ title, preview, badge, badgeColor, date }: {
  title: string; preview: string; badge: string; badgeColor: string; date: string
}) {
  return (
    <div className="note-map-card" style={{ width: 250 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 14px 8px', flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0, marginTop: 2 }} />
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'var(--node-title)', lineHeight: '1.3',
          flex: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{title}</span>
      </div>
      <p style={{
        padding: '0 14px', fontSize: 11, color: 'var(--node-preview)', lineHeight: '1.6', flex: 1,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{preview}</p>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', marginTop: 'auto', borderTop: '1px solid var(--node-border)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 100, background: `${badgeColor}20`, color: badgeColor }}>{badge}</span>
          <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>{date}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--node-meta)' }}>↗ ouvrir</span>
      </div>
    </div>
  )
}

function Cards() {
  return (
    <>
      <div style={{ position: 'absolute', left: 40, top: 62 }}>
        <FakeCard title="Les macros" preview="NQ1! 30 347,75 ▼ −0.58% Cours élève https://fr.tradingview.com/chart/5g10onIm/ Exercice 1 : Observation 01/"
          badge="TradingView" badgeColor="#2dd4bf" date="il y a 3 sem" />
      </div>
      <div style={{ position: 'absolute', left: 176, top: 214 }}>
        <FakeCard title="Session 17 Mars" preview="TopStepX MNQM26 -0.41% RP&L: $52.40 · BAL: $49,408.80 · MLL: $48,000.00 · Daily Loss max: $1,300.00 · Compte:"
          badge="TopStep" badgeColor="#2dd4bf" date="il y a 4 mois" />
      </div>
    </>
  )
}

// Une tuile = un vrai bout de canvas (trame à points) avec une box de groupe dedans.
// `source` dit d'où vient le dessin : aucune des bases de Brice (shadcn, HeroUI,
// 21st.dev, AI SDK Elements) ne livre de nœud « groupe / frame », donc tout est
// dessiné ici. La question honnête est : dans QUEL vocabulaire on le dessine.
function Tile({ n, titre, note, source, children }: {
  n: number; titre: string; note: string; source: 'maison' | 'shadcn'; children: React.ReactNode
}) {
  const src = source === 'shadcn'
    ? { txt: 'vocabulaire shadcn Card', c: '#818cf8' }
    : { txt: 'dessin maison', c: 'var(--node-meta)' }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: 6, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)',
        }}>{n}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--node-title)' }}>{titre}</span>
        <span style={{ fontSize: 12, color: 'var(--node-meta)' }}>{note}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100,
          border: `1px solid ${src.c}`, color: src.c, opacity: 0.85,
        }}>{src.txt}</span>
      </div>
      <div style={{ position: 'relative', height: 420, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--node-border)' }}>
        <div className="canvas-grid" />
        <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
      </div>
    </div>
  )
}

const BOX: React.CSSProperties = { position: 'absolute', left: 24, top: 24, width: 520, height: 372 }

export default function LaboGroupes() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>Six façons de dessiner un groupe</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer' }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--node-meta)', marginBottom: 16, maxWidth: 760, lineHeight: 1.6 }}>
          Vraie trame du canvas, vraies cartes, échelle réelle. Regarde en sombre <em>et</em> en clair : c&apos;est là que les
          écarts se voient. Donne-moi un numéro, j&apos;applique la variante au vrai <code>GroupNode</code> et tu valides en ligne.
        </p>

        {/* Transparence : d'où vient chaque dessin. */}
        <div style={{
          fontSize: 12, color: 'var(--node-meta)', lineHeight: 1.65, marginBottom: 30,
          maxWidth: 760, padding: '12px 14px', borderRadius: 10,
          background: 'var(--node-bg)', border: '1px solid var(--node-border)',
        }}>
          <strong style={{ color: 'var(--node-title)' }}>D&apos;où viennent ces dessins.</strong> Vérifié : ni shadcn, ni HeroUI,
          ni 21st.dev, ni AI SDK Elements ne livrent de nœud « groupe / frame / conteneur ». Il n&apos;y a donc rien à copier
          pour cet objet précis, tout ce qui suit est dessiné. La seule question qui reste, c&apos;est le <em>vocabulaire</em> :
          les variantes marquées <span style={{ color: '#818cf8', fontWeight: 600 }}>vocabulaire shadcn Card</span> reprennent
          les valeurs réelles de shadcn (<code>rounded-xl</code>, <code>ring-1 ring-foreground/10</code>, bandeau en
          <code> bg-muted/50</code> avec <code>border-b</code>), celles marquées <span style={{ fontWeight: 600 }}>dessin maison</span> sont
          de moi. À noter : la carte-note, elle, <em>est</em> sourçable — elle a exactement le découpage du <code>Node</code> d&apos;AI
          SDK Elements, qui est une Card shadcn.
        </div>

        <div style={{ display: 'grid', gap: 40 }}>

          <Tile n={1} titre="Témoin" note="l'état actuel, halo supprimé" source="maison">
            <div style={{ ...BOX, borderRadius: 16, border: `1.5px dashed ${GREEN.border}`, background: GREEN.bg }}>
              <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 500, color: GREEN.border }}>cours</div>
            </div>
            <Cards />
          </Tile>

          <Tile n={2} titre="Card shadcn transposée" note="ring au lieu de bordure, bandeau de titre teinté" source="shadcn">
            <div style={{
              ...BOX, borderRadius: 12, overflow: 'hidden',
              boxShadow: 'inset 0 0 0 1px rgba(52,211,153,0.30)', background: 'rgba(52,211,153,0.04)',
            }}>
              <div style={{
                padding: '9px 14px', background: 'rgba(52,211,153,0.10)',
                borderBottom: '1px solid rgba(52,211,153,0.22)',
                fontSize: 12, fontWeight: 600, color: GREEN.border,
              }}>cours</div>
            </div>
            <Cards />
          </Tile>

          <Tile n={3} titre="Étiquette en onglet" note="dossier suspendu, le nom adossé au bord" source="maison">
            <div style={{ ...BOX, borderRadius: 16, border: '1px solid rgba(52,211,153,0.30)', background: 'rgba(52,211,153,0.05)' }}>
              <div style={{
                display: 'inline-block', margin: '-1px 0 0 16px', padding: '4px 12px 5px',
                borderRadius: '0 0 9px 9px', background: GREEN.border,
                fontSize: 11, fontWeight: 600, color: '#0b2c22',
              }}>cours</div>
            </div>
            <Cards />
          </Tile>

          <Tile n={4} titre="Frame Figma" note="aucun contour, un aplat et un nom posé au-dessus" source="maison">
            <div style={{ ...BOX, borderRadius: 16, background: 'var(--node-bg)', opacity: 0.55 }} />
            <div style={{ position: 'absolute', left: 26, top: 6, fontSize: 11, fontWeight: 600, color: 'var(--node-meta)' }}>cours</div>
            <Cards />
          </Tile>

          <Tile n={5} titre="Filet haut" note="2 px de couleur en haut, le reste sans contour" source="maison">
            <div style={{ ...BOX, borderRadius: '3px 3px 16px 16px', borderTop: `2px solid ${GREEN.border}`, background: 'rgba(52,211,153,0.05)' }}>
              <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: GREEN.border }}>cours</div>
            </div>
            <Cards />
          </Tile>

          <Tile n={6} titre="Pointillé fin" note="si tu tiens au pointillé : plus fin, désaturé, pastille de couleur" source="maison">
            <div style={{ ...BOX, borderRadius: 16, border: '1px dashed var(--node-border)', background: 'rgba(52,211,153,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: GREEN.border, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--node-meta)' }}>cours</span>
              </div>
            </div>
            <Cards />
          </Tile>

        </div>
      </div>
    </div>
  )
}
