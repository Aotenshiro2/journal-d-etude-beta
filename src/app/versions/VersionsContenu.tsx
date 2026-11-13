import { Map, Clock, Puzzle, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { VERSION_JOURNAL, MISE_A_JOUR, FEUILLE_DE_ROUTE, APPS_LIEES, HISTORIQUE } from './versions'

// « Versions et feuille de route » : la même mise en page que l'écran Versions
// du Guide du Carnet du Trader (un en-tête, une carte par section, l'historique
// par version), posée dans le langage du journal (le shell canvas et ses jetons
// --node-*). Décision de Brice du 20/09/2026 : chaque app porte cet écran.
// Mise à jour du 13/11/2026 : la section « Avec le Carnet et Pilotage », sur le
// modèle de la page /versions de Pilotage (en ligne depuis le 30/10/2026).
// Le contenu (textes) vit dans versions.ts ; ici, seulement la mise en page.
export default function VersionsContenu() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-4 sm:pt-8 pb-28">
        <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--node-title)' }}>Journal d&apos;Études</h1>
        <p className="text-xs mb-6" style={{ color: 'var(--node-meta)' }}>
          Versions et feuille de route - v{VERSION_JOURNAL} - à jour au {MISE_A_JOUR}
        </p>
        <p className="text-sm mb-8 leading-relaxed" style={{ color: 'var(--node-preview)' }}>
          Le numéro suit les espaces du menu : 0.1 Étudier mes notes, clos fin août ; 0.2 Observer les concepts, en cours.
          Un module se ferme quand on peut le montrer à un élève sans s&apos;excuser. En attendant, tout ce qui sort est daté
          dans l&apos;historique, même quand ça touche un autre espace, comme « Mes trades ».
        </p>

        <div className="space-y-6">
          <Section icon={Map} title="Feuille de route">
            <p className="text-[13px] leading-relaxed mb-4" style={{ color: 'var(--node-meta)' }}>
              Rien n&apos;est annoncé ici avant d&apos;être prêt, et aucune date n&apos;est promise : quand un palier sort, il entre dans l&apos;historique.
            </p>
            <div className="space-y-4">
              {FEUILLE_DE_ROUTE.map(r => (
                <div key={r.titre}>
                  <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--node-title)' }}>{r.titre}</h3>
                  <p className="text-[13px] leading-relaxed ml-4" style={{ color: 'var(--node-preview)' }}>{r.detail}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Puzzle} title="Avec le Carnet et Pilotage">
            <div className="space-y-5">
              {APPS_LIEES.map(app => (
                <div key={app.titre}>
                  <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--node-title)' }}>{app.titre}</h3>
                  <div className="space-y-2 ml-4">
                    {app.paragraphes.map(p => (
                      <p key={p} className="text-[13px] leading-relaxed" style={{ color: 'var(--node-preview)' }}>{p}</p>
                    ))}
                    <a
                      href={app.lien.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 py-1 text-[13px] font-medium underline underline-offset-2"
                      style={{ color: 'var(--node-title)' }}
                    >
                      {app.lien.libelle}
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Clock} title="Historique des versions">
            <div className="space-y-5">
              {HISTORIQUE.map(entree => (
                <div key={entree.version}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: 'var(--node-title)' }}>{entree.version}</span>
                    <span className="text-xs" style={{ color: 'var(--node-meta)' }}>{entree.titre}</span>
                    <span className="text-[11px]" style={{ color: 'var(--node-meta)', opacity: 0.75 }}>({entree.quand})</span>
                  </div>
                  <ul className="space-y-1 ml-4">
                    {entree.items.map((item, j) => (
                      <li key={j} className="text-[13px] leading-relaxed flex items-start gap-2" style={{ color: 'var(--node-preview)' }}>
                        <span className="mt-2 w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--node-meta)', opacity: 0.6 }} />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        </div>

        <p className="text-center text-[11px] mt-10" style={{ color: 'var(--node-meta)', opacity: 0.7 }}>
          Journal d&apos;Études by AOKnowledge - v{VERSION_JOURNAL}
        </p>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-4 sm:p-5" style={{ background: 'var(--node-bg)', border: '1px solid var(--node-border)', boxShadow: 'var(--node-shadow)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg" style={{ background: 'var(--canvas-bg)' }}>
          <Icon size={17} style={{ color: 'var(--node-title)' }} />
        </div>
        <h2 className="text-base font-semibold" style={{ color: 'var(--node-title)' }}>{title}</h2>
      </div>
      {children}
    </section>
  )
}
