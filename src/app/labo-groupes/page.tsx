'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   PAGE JETABLE — 0.1.7, choix du rendu de la box de groupe. SECOND TOUR.
   Brice a retenu 3 finalistes au premier tour (ex-2, ex-3, ex-5). On les remet
   ici côte à côte, plus 3 hybrides qui croisent leurs bonnes idées, et cette
   fois avec DEUX groupes voisins : c'est là que le traitement du contour se
   juge vraiment (cf. sa capture du canvas réel).

   Route publique déclarée dans `middleware.ts` (publicPaths).
   À SUPPRIMER une fois la variante tranchée :
     rm -rf src/app/labo-groupes .next/types/app/labo-groupes
     puis retirer '/labo-groupes' de publicPaths dans middleware.ts
   Aucune donnée réelle : les cartes sont des maquettes figées.
   ───────────────────────────────────────────────────────────────────────────── */

import { useTheme } from '@/contexts/ThemeContext'

// Les deux teintes de GROUP_COLORS utilisées dans la capture de Brice.
const VERT = { rgb: '52,211,153', solide: '#34d399', encre: '#06281e' }
const BLEU = { rgb: '96,165,250', solide: '#60a5fa', encre: '#0a1f3d' }
type Teinte = typeof VERT

// Reproduit le markup de NoteMapNode (header / aperçu / pied).
function Carte({ titre, apercu, badge, badgeColor, date, x, y }: {
  titre: string; apercu: string; badge: string; badgeColor: string; date: string; x: number; y: number
}) {
  return (
    <div className="note-map-card" style={{ position: 'absolute', left: x, top: y, width: 228, height: 138 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '12px 12px 6px' }}>
        <div style={{ width: 15, height: 15, borderRadius: 3, background: 'var(--node-border)', flexShrink: 0, marginTop: 2 }} />
        <span style={{
          fontSize: 12.5, fontWeight: 600, color: 'var(--node-title)', lineHeight: '1.3', flex: 1,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{titre}</span>
      </div>
      <p style={{
        padding: '0 12px', fontSize: 10.5, color: 'var(--node-preview)', lineHeight: '1.55', flex: 1,
        display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>{apercu}</p>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px',
        marginTop: 'auto', borderTop: '1px solid var(--node-border)',
      }}>
        <span style={{ fontSize: 9.5, fontWeight: 600, padding: '2px 6px', borderRadius: 100, background: `${badgeColor}20`, color: badgeColor }}>{badge}</span>
        <span style={{ fontSize: 9.5, color: 'var(--node-meta)' }}>{date}</span>
      </div>
    </div>
  )
}

function ContenuCours() {
  return (
    <>
      <Carte x={30} y={64} titre="Les macros" apercu="NQ1! 30 347,75 ▼ −0.58% Cours élève https://fr.tradingview.com/chart/5g10onIm/ Exercice 1 : Observation 01/" badge="TradingView" badgeColor="#2dd4bf" date="il y a 3 sem" />
      <Carte x={128} y={214} titre="Session 17 Mars" apercu="TopStepX MNQM26 -0.41% RP&L: $52.40 · BAL: $49,408.80 · MLL: $48,000.00 · Daily Loss max: $1,300.00" badge="TopStep" badgeColor="#2dd4bf" date="il y a 4 mois" />
    </>
  )
}
function ContenuTrading() {
  return (
    <>
      <Carte x={26} y={70} titre="Je suis enragé d'avoir raté le trade" apercu="Je suis enragé d'avoir raté le trade 08/07/2026 10:34:25 · (1) | SimpleFX Webtrader (https://app.simplef" badge="Trading" badgeColor="#fbbf24" date="il y a 2 sem" />
      <Carte x={140} y={222} titre="SimpleFX Webtrader" apercu="SimpleFX Webtrader https://app.simplefx.com envie de prendre la vente 06/07/2026 · Capture" badge="Trading" badgeColor="#fbbf24" date="il y a 2 sem" />
    </>
  )
}

/* ── Les six façons de dessiner la box ───────────────────────────────────────
   Chaque rendu reçoit sa teinte + son nom, et place ses enfants (les cartes).
   Aucune base (ShadCN, HeroUI, 21st.dev, AI SDK Elements) ne livre de nœud
   groupe / frame : tout ceci est dessiné. Seul le vocabulaire change. */
type Rendu = (t: Teinte, nom: string, enfants: React.ReactNode) => React.ReactNode

const CADRE: React.CSSProperties = { position: 'absolute', width: 396, height: 344, top: 22 }

// A — Card ShadCN transposée : ring interne, bandeau de titre teinté pleine largeur.
const rA: Rendu = (t, nom, enfants) => (
  <div style={{ ...CADRE, borderRadius: 12, overflow: 'hidden', boxShadow: `inset 0 0 0 1px rgba(${t.rgb},0.30)`, background: `rgba(${t.rgb},0.04)` }}>
    <div style={{ padding: '9px 14px', background: `rgba(${t.rgb},0.10)`, borderBottom: `1px solid rgba(${t.rgb},0.22)`, fontSize: 12, fontWeight: 600, color: t.solide }}>{nom}</div>
    {enfants}
  </div>
)

// B — Étiquette en onglet : contour fin, le nom adossé au bord haut.
const rB: Rendu = (t, nom, enfants) => (
  <div style={{ ...CADRE, borderRadius: 16, border: `1px solid rgba(${t.rgb},0.30)`, background: `rgba(${t.rgb},0.05)` }}>
    <div style={{ display: 'inline-block', margin: '-1px 0 0 16px', padding: '4px 12px 5px', borderRadius: '0 0 9px 9px', background: t.solide, fontSize: 11, fontWeight: 600, color: t.encre }}>{nom}</div>
    {enfants}
  </div>
)

// C — Filet haut : 2 px de couleur en haut, aucun autre contour.
const rC: Rendu = (t, nom, enfants) => (
  <div style={{ ...CADRE, borderRadius: '3px 3px 16px 16px', borderTop: `2px solid ${t.solide}`, background: `rgba(${t.rgb},0.05)` }}>
    <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.solide }}>{nom}</div>
    {enfants}
  </div>
)

// D — Hybride A+B : le ring ShadCN, mais l'étiquette en onglet au lieu du bandeau.
const rD: Rendu = (t, nom, enfants) => (
  <div style={{ ...CADRE, borderRadius: 12, boxShadow: `inset 0 0 0 1px rgba(${t.rgb},0.30)`, background: `rgba(${t.rgb},0.04)` }}>
    <div style={{ display: 'inline-block', margin: '0 0 0 14px', padding: '5px 12px 6px', borderRadius: '0 0 8px 8px', background: t.solide, fontSize: 11, fontWeight: 600, color: t.encre }}>{nom}</div>
    {enfants}
  </div>
)

// E — Hybride C+A : le filet haut, et sous lui le bandeau teinté de la Card.
const rE: Rendu = (t, nom, enfants) => (
  <div style={{ ...CADRE, borderRadius: '2px 2px 14px 14px', overflow: 'hidden', borderTop: `2px solid ${t.solide}`, background: `rgba(${t.rgb},0.04)` }}>
    <div style={{ padding: '9px 14px', background: `rgba(${t.rgb},0.10)`, borderBottom: `1px solid rgba(${t.rgb},0.18)`, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.solide }}>{nom}</div>
    {enfants}
  </div>
)

// F — Hybride C+B : le filet haut, avec l'onglet plein posé dessus.
const rF: Rendu = (t, nom, enfants) => (
  <div style={{ ...CADRE, borderRadius: '2px 2px 16px 16px', borderTop: `2px solid ${t.solide}`, background: `rgba(${t.rgb},0.05)` }}>
    <div style={{ display: 'inline-block', margin: '-2px 0 0 16px', padding: '4px 12px 5px', borderRadius: '0 0 9px 9px', background: t.solide, fontSize: 11, fontWeight: 600, color: t.encre }}>{nom}</div>
    {enfants}
  </div>
)

const VARIANTES: { n: number; titre: string; note: string; src: 'shadcn' | 'maison' | 'hybride'; rendu: Rendu }[] = [
  { n: 1, titre: 'Card ShadCN transposée', note: 'ex-2 · ring interne + bandeau teinté', src: 'shadcn', rendu: rA },
  { n: 2, titre: 'Étiquette en onglet', note: 'ex-3 · contour fin + onglet plein', src: 'maison', rendu: rB },
  { n: 3, titre: 'Filet haut', note: 'ex-5 · 2 px en haut, rien d\'autre', src: 'maison', rendu: rC },
  { n: 4, titre: 'Ring + onglet', note: 'hybride 1 × 2', src: 'hybride', rendu: rD },
  { n: 5, titre: 'Filet + bandeau', note: 'hybride 3 × 1', src: 'hybride', rendu: rE },
  { n: 6, titre: 'Filet + onglet', note: 'hybride 3 × 2', src: 'hybride', rendu: rF },
]

const ETIQ = {
  shadcn: { txt: 'vocabulaire ShadCN Card', c: '#818cf8' },
  maison: { txt: 'dessin maison', c: 'var(--node-meta)' },
  hybride: { txt: 'hybride', c: '#fbbf24' },
}

export default function LaboGroupes() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas-bg)', padding: '28px 32px 80px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 6 }}>
          <h1 style={{ fontSize: 22, color: 'var(--node-title)' }}>Second tour : tes trois finalistes et leurs croisements</h1>
          <button onClick={toggleTheme} className="canvas-float-pill" style={{ padding: '8px 14px', fontSize: 13, color: 'var(--node-title)', cursor: 'pointer', flexShrink: 0 }}>
            {theme === 'dark' ? '☀ Voir en clair' : '☾ Voir en sombre'}
          </button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--node-meta)', marginBottom: 30, maxWidth: 760, lineHeight: 1.6 }}>
          Tu avais gardé la 2, la 3 et la 5 : les voici en 1, 2 et 3, plus trois hybrides qui croisent leurs bonnes idées.
          Cette fois <strong style={{ color: 'var(--node-title)' }}>deux groupes voisins</strong>, comme sur ta capture, parce que
          c&apos;est là que le contour se juge : le vrai test, c&apos;est de savoir où finit l&apos;un et où commence l&apos;autre
          sans avoir à le chercher. Regarde en sombre <em>et</em> en clair, puis donne-moi un numéro.
        </p>

        <div style={{ display: 'grid', gap: 34 }}>
          {VARIANTES.map(v => {
            const e = ETIQ[v.src]
            return (
              <div key={v.n}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)',
                  }}>{v.n}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--node-title)' }}>{v.titre}</span>
                  <span style={{ fontSize: 12, color: 'var(--node-meta)' }}>{v.note}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 100, border: `1px solid ${e.c}`, color: e.c, opacity: 0.85 }}>{e.txt}</span>
                </div>
                <div style={{ position: 'relative', height: 388, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--node-border)' }}>
                  <div className="canvas-grid" />
                  <div style={{ position: 'absolute', left: 22 }}>{v.rendu(VERT, 'cours', <ContenuCours />)}</div>
                  <div style={{ position: 'absolute', left: 442 }}>{v.rendu(BLEU, 'trading', <ContenuTrading />)}</div>
                </div>
              </div>
            )
          })}
        </div>

        <p style={{ fontSize: 12, color: 'var(--node-meta)', marginTop: 30, maxWidth: 760, lineHeight: 1.65 }}>
          Rappel de transparence : aucune de tes bases (ShadCN, HeroUI, 21st.dev, AI SDK Elements) ne livre de nœud
          groupe / frame pour un canvas React Flow, donc les six sont dessinés. Seule la 1 reprend les valeurs réelles de
          la Card ShadCN (<code>rounded-xl</code>, <code>ring-1 ring-foreground/10</code>, bandeau <code>bg-muted/50</code> +
          <code> border-b</code>), et la 4 et la 5 en héritent en partie.
        </p>
      </div>
    </div>
  )
}
