'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ImagePlus, Lightbulb, ThumbsUp, X } from 'lucide-react'

// « Il me manque quelque chose » dans le Journal (besoins des membres, lot 2,
// 06/11/2026). Monte depuis SupportBubble (meme panneau, memes styles : rien
// de dessine a neuf). Routes du journal, meme origine : la session passe par
// les cookies. Contrat commun aux outils : besoins-contrat-api.md.
//
// - « Déjà prévu » : lu a l'ouverture du formulaire (GET /api/besoins/prevus),
//   aucune minuterie ; « Moi aussi » (POST /api/besoins/voter).
// - La capture (facultative, fichier ou collage) est compressee ICI : plus
//   grand cote 1600 px, 1,5 Mo au plus, en WebP (JPEG si le navigateur ne sait
//   pas), puis envoyee en data URL. Le serveur reverifie tout.
// - La phrase affichee est celle du serveur, telle quelle.

const MAX_COTE = 1600
const MAX_OCTETS = 1_572_864
const TEXTE_MIN = 5
const TEXTE_MAX = 4000

type Prevu = { id: string; titre: string; statut: 'planifie' | 'en_cours'; votes: number; aVote: boolean }

function lireEnDataUrl(b: Blob): Promise<string> {
  return new Promise((ok, ko) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result))
    r.onerror = () => ko(new Error('lecture'))
    r.readAsDataURL(b)
  })
}

function versBlob(c: HTMLCanvasElement, type: string, qualite: number): Promise<Blob | null> {
  return new Promise(ok => c.toBlob(b => ok(b), type, qualite))
}

/** L'image reduite a 1600 px de cote et 1,5 Mo au plus, en data URL ; null si elle ne passe pas. */
async function compresser(fichier: Blob): Promise<string | null> {
  const url = URL.createObjectURL(fichier)
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => ko(new Error('image illisible'))
      i.src = url
    })
    let echelle = Math.min(1, MAX_COTE / Math.max(img.naturalWidth, img.naturalHeight))
    for (let essai = 0; essai < 4; essai++) {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.naturalWidth * echelle))
      c.height = Math.max(1, Math.round(img.naturalHeight * echelle))
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0, c.width, c.height)
      for (const q of [0.85, 0.7, 0.55]) {
        let b = await versBlob(c, 'image/webp', q)
        if (!b || b.type !== 'image/webp') b = await versBlob(c, 'image/jpeg', q)
        if (b && b.size <= MAX_OCTETS) return lireEnDataUrl(b)
      }
      echelle *= 0.75
    }
    return null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function BesoinFormulaire({ app, onFermer }: { app: string; onFermer: () => void }) {
  const [texte, setTexte] = useState('')
  const [capture, setCapture] = useState<string | null>(null)
  const [prevus, setPrevus] = useState<Prevu[] | null>(null)
  const [envoi, setEnvoi] = useState(false)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [avis, setAvis] = useState<string | null>(null)
  const fichierRef = useRef<HTMLInputElement>(null)

  // « Déjà prévu » : une lecture a l'ouverture, rien d'autre.
  useEffect(() => {
    let vivant = true
    fetch(`/api/besoins/prevus?app=${encodeURIComponent(app)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (vivant) setPrevus(Array.isArray(d?.besoins) ? (d.besoins as Prevu[]) : []) })
      .catch(() => { if (vivant) setPrevus([]) })
    return () => { vivant = false }
  }, [app])

  const prendreImage = async (f: Blob | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return
    setAvis(null)
    const d = await compresser(f)
    if (d) setCapture(d)
    else setAvis("Cette image ne passe pas (trop lourde ou illisible). Tu peux envoyer sans capture.")
  }

  const voter = async (id: string) => {
    try {
      const r = await fetch('/api/besoins/voter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ besoinId: id }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && typeof d.votes === 'number') {
        setPrevus(l => (l ?? []).map(p => (p.id === id ? { ...p, votes: d.votes, aVote: true } : p)))
      } else {
        setAvis(typeof d.error === 'string' ? d.error : "Le vote n'est pas passé, réessaie dans un instant.")
      }
    } catch {
      setAvis('Connexion impossible. Vérifie ton réseau et réessaie.')
    }
  }

  const envoyer = async () => {
    const t = texte.trim()
    if (t.length < TEXTE_MIN || envoi) return
    setEnvoi(true)
    setAvis(null)
    try {
      const r = await fetch('/api/besoins/signaler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app, texte: t, page: window.location.pathname, ...(capture ? { capture } : {}) }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && typeof d.phrase === 'string') {
        setPhrase(d.phrase)
        setTexte('')
        setCapture(null)
      } else {
        setAvis(typeof d.error === 'string' ? d.error : `Envoi impossible (HTTP ${r.status}). Réessaie dans un instant.`)
      }
    } catch {
      setAvis('Connexion impossible. Vérifie ton réseau et réessaie.')
    } finally {
      setEnvoi(false)
    }
  }

  const bouton = (actif: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, border: 'none',
    cursor: actif ? 'pointer' : 'default', background: '#3b82f6', color: '#fff', fontSize: 12, opacity: actif ? 1 : 0.4,
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={onFermer}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--node-meta)', padding: 0 }}
      >
        <ArrowLeft size={12} /> Retour au support
      </button>

      {phrase ? (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--node-title)', border: '1px solid #3b82f6', borderRadius: 10, padding: '10px 12px' }}>
          {phrase}
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setPhrase(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#3b82f6', padding: 0 }}>
              Signaler autre chose
            </button>
          </div>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--node-preview)', margin: 0 }}>
            Une fonction qui n&apos;existe pas, un blocage, un bug ? Dis-le avec tes mots : ton message arrive tel quel à l&apos;équipe.
          </p>
          <textarea
            value={texte}
            onChange={e => setTexte(e.target.value.slice(0, TEXTE_MAX))}
            onPaste={e => {
              const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
              if (item) {
                e.preventDefault()
                void prendreImage(item.getAsFile())
              }
            }}
            rows={4}
            placeholder="Ce qui te manque..."
            style={{
              resize: 'vertical', minHeight: 80, border: '1px solid var(--float-border)', borderRadius: 8, outline: 'none',
              background: 'var(--canvas-bg)', padding: '8px 10px', fontSize: 13, lineHeight: 1.5, color: 'var(--node-title)', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {capture ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capture} alt="Capture jointe" style={{ height: 36, borderRadius: 4, border: '1px solid var(--float-border)' }} />
                <button onClick={() => setCapture(null)} aria-label="Retirer la capture" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--node-meta)', display: 'flex' }}>
                  <X size={14} />
                </button>
              </span>
            ) : (
              <button
                onClick={() => fichierRef.current?.click()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--node-meta)', padding: 0 }}
              >
                <ImagePlus size={13} /> Ajouter une capture (ou colle-la)
              </button>
            )}
            <input
              ref={fichierRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={e => { void prendreImage(e.target.files?.[0]); e.target.value = '' }}
            />
            <button onClick={envoyer} disabled={envoi || texte.trim().length < TEXTE_MIN} style={bouton(!envoi && texte.trim().length >= TEXTE_MIN)}>
              {envoi ? 'Envoi...' : 'Envoyer'}
            </button>
          </div>
        </>
      )}

      {avis && (
        <div style={{ fontSize: 12, color: 'var(--node-preview)', border: '1px solid var(--float-border)', borderRadius: 8, padding: '8px 10px' }}>
          {avis}
        </div>
      )}

      {prevus && prevus.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--float-border)', paddingTop: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--node-meta)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Déjà prévu</span>
          {prevus.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--node-title)' }}>
              <span style={{ flex: 1 }}>
                {p.titre}
                <span style={{ color: 'var(--node-meta)' }}>{p.statut === 'en_cours' ? ' (en cours)' : ''}</span>
              </span>
              <button
                onClick={() => voter(p.id)}
                disabled={p.aVote}
                title={p.aVote ? 'Ton vote est compté' : 'Moi aussi'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--float-border)', borderRadius: 999,
                  background: 'none', padding: '3px 8px', fontSize: 11, cursor: p.aVote ? 'default' : 'pointer',
                  color: p.aVote ? '#3b82f6' : 'var(--node-meta)',
                }}
              >
                <ThumbsUp size={11} /> Moi aussi{p.votes > 0 ? ` (${p.votes})` : ''}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** L'entree visible dans le panneau du support. */
export function EntreeBesoin({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <button
      onClick={onOuvrir}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        width: '100%', padding: '8px 0', border: 'none', background: 'none',
        borderTop: '1px solid var(--float-border)', cursor: 'pointer',
        fontSize: 12, color: 'var(--node-meta)',
      }}
    >
      <Lightbulb size={12} /> Il me manque quelque chose
    </button>
  )
}
