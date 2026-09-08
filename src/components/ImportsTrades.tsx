'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'

// « Importer mes trades » — v1 Tradovate (go Brice 08/09/2026).
// Deux temps, jamais d'écriture silencieuse : ANALYSER montre ce qui serait
// importé (nouveaux vs déjà connus), IMPORTER n'écrit que les nouveaux.
// Réimporter le même fichier = « 0 nouveau », par construction.

interface Apercu {
  symbole: string
  direction: string | null
  quantite: number
  entreLe: string
  pnl: number
  devise: string
  nouveau: boolean
}

interface Analyse {
  format: string | null
  lus: number
  nouveaux: number
  dejaConnus: number
  importes: number
  erreurs: string[]
  apercu: Apercu[]
}

interface Etat {
  total: number
  parSource: { source: string; n: number }[]
  recents: { symbole: string; direction: string | null; quantite: number; entreLe: string; pnl: number; devise: string; source: string; fichier: string | null }[]
}

const NOM_SOURCE: Record<string, string> = {
  'tradovate-performance': 'Tradovate (rapport Performance)',
}

function fmtPnl(pnl: number, devise: string): string {
  const signe = pnl > 0 ? '+' : ''
  const symbole = devise === 'USD' ? '$' : devise === 'EUR' ? '€' : ` ${devise}`
  return `${signe}${pnl.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${symbole}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export default function ImportsTrades() {
  const [etat, setEtat] = useState<Etat | null>(null)
  const [csv, setCsv] = useState('')
  const [fichier, setFichier] = useState('')
  const [analyse, setAnalyse] = useState<Analyse | null>(null)
  const [enCours, setEnCours] = useState(false)
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const chargerEtat = useCallback(async () => {
    try {
      const r = await fetch('/api/imports-trades')
      if (r.ok) setEtat(await r.json())
    } catch { /* silencieux : l'écran reste utilisable */ }
  }, [])

  useEffect(() => { void chargerEtat() }, [chargerEtat])

  const poster = useCallback(async (contenu: string, nom: string, confirmer: boolean) => {
    setEnCours(true)
    setMessage('')
    try {
      const r = await fetch('/api/imports-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: contenu, fichier: nom || undefined, confirmer }),
      })
      const data = await r.json()
      if (!r.ok) {
        setMessage(data.error ?? 'Erreur pendant l’analyse.')
        return
      }
      setAnalyse(data)
      if (confirmer) {
        setMessage(data.importes > 0 ? `${data.importes} trade${data.importes > 1 ? 's' : ''} importé${data.importes > 1 ? 's' : ''}.` : 'Rien de nouveau à importer.')
        setCsv('')
        setFichier('')
        setAnalyse(null)
        await chargerEtat()
      }
    } catch {
      setMessage('Erreur réseau, réessaie.')
    } finally {
      setEnCours(false)
    }
  }, [chargerEtat])

  const lireFichier = useCallback((f: File) => {
    const lecteur = new FileReader()
    lecteur.onload = () => {
      const texte = String(lecteur.result ?? '')
      setCsv(texte)
      setFichier(f.name)
      void poster(texte, f.name, false)
    }
    lecteur.readAsText(f)
  }, [poster])

  const retirerSource = useCallback(async (source: string) => {
    if (!window.confirm(`Retirer tous les trades importés depuis « ${NOM_SOURCE[source] ?? source} » ? Tu pourras réimporter le fichier ensuite.`)) return
    await fetch('/api/imports-trades', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    await chargerEtat()
  }, [chargerEtat])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--node-title)' }}>Importer mes trades</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--node-meta)' }}>
          Ton fichier de plateforme devient la réalité d’exécution que le mentor lit à côté
          de tes jugements A/B/C. Rien n’est écrit sans ton accord, et réimporter un fichier
          déjà passé n’ajoute jamais de doublon. Format supporté aujourd’hui : le rapport
          Performance de Tradovate (CSV) — TopstepX et Quantower suivront.
        </p>
      </div>

      {/* Zone de dépôt */}
      <div
        className="rounded-xl border border-dashed p-6 text-center cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        style={{ borderColor: 'var(--node-border)' }}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const f = e.dataTransfer.files?.[0]
          if (f) lireFichier(f)
        }}
      >
        <Upload size={20} className="mx-auto mb-2" style={{ color: 'var(--node-meta)' }} />
        <p className="text-sm" style={{ color: 'var(--node-title)' }}>
          Dépose ton CSV ici, ou clique pour le choisir
        </p>
        {fichier && <p className="text-xs mt-1" style={{ color: 'var(--node-meta)' }}>{fichier}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) lireFichier(f)
            e.target.value = ''
          }}
        />
      </div>

      {message && (
        <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', color: 'var(--node-title)' }}>
          {message}
        </p>
      )}

      {/* Aperçu d'analyse */}
      {analyse && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm font-medium" style={{ color: 'var(--node-title)' }}>
              {analyse.lus} trade{analyse.lus > 1 ? 's' : ''} lu{analyse.lus > 1 ? 's' : ''} —{' '}
              <span style={{ color: '#22c55e' }}>{analyse.nouveaux} nouveau{analyse.nouveaux > 1 ? 'x' : ''}</span>
              {analyse.dejaConnus > 0 && <span style={{ color: 'var(--node-meta)' }}> · {analyse.dejaConnus} déjà connu{analyse.dejaConnus > 1 ? 's' : ''}</span>}
            </p>
            <button
              disabled={enCours || analyse.nouveaux === 0}
              onClick={() => poster(csv, fichier, true)}
              className="text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
              style={{ background: 'var(--node-title)', color: 'var(--node-bg)' }}
            >
              {enCours ? '…' : `Importer ${analyse.nouveaux} nouveau${analyse.nouveaux > 1 ? 'x' : ''}`}
            </button>
          </div>

          {analyse.erreurs.length > 0 && (
            <ul className="text-xs space-y-0.5" style={{ color: '#ef4444' }}>
              {analyse.erreurs.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          {analyse.apercu.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ color: 'var(--node-title)' }}>
                <thead>
                  <tr style={{ color: 'var(--node-meta)' }}>
                    <th className="text-left py-1 pr-3 font-medium">Entrée</th>
                    <th className="text-left py-1 pr-3 font-medium">Symbole</th>
                    <th className="text-left py-1 pr-3 font-medium">Sens</th>
                    <th className="text-right py-1 pr-3 font-medium">Qté</th>
                    <th className="text-right py-1 pr-3 font-medium">P&L</th>
                    <th className="text-left py-1 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {analyse.apercu.map((t, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--node-border)' }}>
                      <td className="py-1 pr-3 whitespace-nowrap">{fmtDate(t.entreLe)}</td>
                      <td className="py-1 pr-3">{t.symbole}</td>
                      <td className="py-1 pr-3">{t.direction ?? '—'}</td>
                      <td className="py-1 pr-3 text-right">{t.quantite}</td>
                      <td className="py-1 pr-3 text-right whitespace-nowrap" style={{ color: t.pnl > 0 ? '#22c55e' : t.pnl < 0 ? '#ef4444' : 'var(--node-meta)' }}>
                        {fmtPnl(t.pnl, t.devise)}
                      </td>
                      <td className="py-1" style={{ color: t.nouveau ? '#22c55e' : 'var(--node-meta)' }}>
                        {t.nouveau ? 'nouveau' : 'déjà connu'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analyse.lus > analyse.apercu.length && (
                <p className="text-xs mt-1" style={{ color: 'var(--node-meta)' }}>
                  … et {analyse.lus - analyse.apercu.length} autres lignes.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Déjà en base */}
      {etat && etat.total > 0 && (
        <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--node-title)' }}>
            {etat.total} trade{etat.total > 1 ? 's' : ''} importé{etat.total > 1 ? 's' : ''} au total
          </p>
          <ul className="text-xs space-y-1">
            {etat.parSource.map(s => (
              <li key={s.source} className="flex items-center gap-2" style={{ color: 'var(--node-meta)' }}>
                <span>{NOM_SOURCE[s.source] ?? s.source} : {s.n}</span>
                <button
                  onClick={() => retirerSource(s.source)}
                  className="inline-flex items-center gap-1 hover:underline underline-offset-2"
                  style={{ color: '#ef4444' }}
                  title="Retirer ces imports (réimportables ensuite)"
                >
                  <Trash2 size={11} /> retirer
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
