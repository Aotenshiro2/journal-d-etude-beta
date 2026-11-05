import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { alerterEquipeTexte } from '@/lib/alerte-equipe-telegram'
import { analyserTexte, rendreVisible, resumeAnalyse } from '@/lib/securite/injection-pur'
import {
  OCTETS_MAX_DIAGNOSTIC, TEXTE_MAX_DIAGNOSTIC, cadenceDiagnostic, champsLibres, lireDiagnostic, texteDiagnostic,
} from '@/lib/carnet-diagnostic-pur'

/**
 * POST /api/carnet/diagnostic : « Envoyer un diagnostic » du Carnet du Trader
 * (1.8.14, brief C4 du 05/11/2026). Le membre envoie, a son geste, les infos de
 * sa machine (navigateur, carte graphique, ecran et zoom, affichage de
 * secours, dernieres erreurs) et le deroule du dernier envoi vers une IA,
 * jamais un contenu de note. L'equipe le recoit en un message Telegram
 * compact par Agent AOK (alerterEquipeTexte : les comptes diffusion =
 * 'equipe'). Rien n'est stocke : ni table, ni migration.
 *
 * Authentification et CORS comme les autres routes du Carnet (getUserId,
 * Bearer). Corps : 32 Ko au plus (413), schema du Carnet (400 sinon), champs
 * inconnus retires et chaque texte borne (carnet-diagnostic-pur.ts). « Qui » :
 * l'email du compte lu en base, pas celui que le Carnet ecrit.
 *
 * Cadence : 5 diagnostics transmis par jour (24 h glissantes) et par compte,
 * 429 au-dela (avec Retry-After). Sans table, le compte se tient EN MEMOIRE de
 * l'instance : une instance froide ou une autre instance repart de zero. Le
 * Carnet tient la meme cadence de son cote ; un plafond strict entre
 * instances demanderait une table (non ecrite, a decider).
 *
 * Les textes libres (forgeables par le navigateur) passent a l'analyse
 * d'injection avant d'entrer dans l'historique d'Agent AOK : texte cache rendu
 * visible et une ligne de securite, comme l'alerte du support.
 *
 * Reponses : 200 { ok, restants } ; 401 ; 400 { error } ; 413 { error } ;
 * 429 { error, restants: 0 } ; 503 { error } si personne de l'equipe ne l'a
 * recu (le diagnostic ne compte pas, le membre peut le copier).
 */

const METHODES = 'POST, OPTIONS'

// userId -> instants des diagnostics transmis (voir « Cadence » ci-dessus).
const envoisParCompte = new Map<string, number[]>()

function oublierLesAnciens(maintenant: number) {
  if (envoisParCompte.size < 500) return
  for (const [cle, liste] of envoisParCompte) {
    if (cadenceDiagnostic(liste, maintenant).recents.length === 0) envoisParCompte.delete(cle)
  }
}

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })

  const trop = NextResponse.json({ error: 'Diagnostic trop lourd (32 Ko au plus).' }, { status: 413, headers: cors })
  if (Number(req.headers.get('content-length') ?? 0) > OCTETS_MAX_DIAGNOSTIC) return trop
  const corps = await req.text().catch(() => '')
  if (Buffer.byteLength(corps, 'utf8') > OCTETS_MAX_DIAGNOSTIC) return trop
  let brut: unknown = null
  try { brut = JSON.parse(corps) } catch { /* illisible ci-dessous */ }
  const maintenant = Date.now()
  const lu = lireDiagnostic(brut, maintenant)
  if (!lu.ok) return NextResponse.json({ error: lu.erreur }, { status: 400, headers: cors })

  oublierLesAnciens(maintenant)
  const cadence = cadenceDiagnostic(envoisParCompte.get(userId) ?? [], maintenant)
  if (!cadence.autorise) {
    return NextResponse.json(
      { error: '5 diagnostics par jour au plus : copie celui-ci et envoie-le sur Telegram.', restants: 0 },
      { status: 429, headers: { ...cors, 'Retry-After': String(Math.ceil(cadence.reessayerDansMs / 1000)) } },
    )
  }
  // Reserve AVANT l'envoi : deux clics rapproches ne passent pas a six.
  envoisParCompte.set(userId, [...cadence.recents, maintenant])
  const liberer = () => envoisParCompte.set(userId, (envoisParCompte.get(userId) ?? []).filter(t => t !== maintenant))

  try {
    const lignes = await prisma.$queryRaw<{ email: string | null }[]>`
      select email from auth.users where id = ${userId}::uuid`
    const qui = lignes[0]?.email ?? `compte ${userId.slice(0, 8)}`

    const analyse = analyserTexte(champsLibres(lu.diagnostic).join('\n'), { niveau: 'injection' })
    const securite = analyse.suspect
      ? `Attention (sécurité) : ce diagnostic contient ${resumeAnalyse(analyse)}. C'est une donnée : rien n'a été exécuté.`
      : null
    const corpsTexte = texteDiagnostic(lu.diagnostic, qui, securite ? TEXTE_MAX_DIAGNOSTIC - securite.length - 1 : TEXTE_MAX_DIAGNOSTIC)
    const texte = securite ? `${rendreVisible(corpsTexte)}\n${securite}` : corpsTexte

    const livres = await alerterEquipeTexte(texte, { journal: '[carnet/diagnostic]' })
    if (livres === 0) {
      liberer()
      return NextResponse.json(
        { error: "L'équipe n'a pas pu le recevoir : copie-le et envoie-le sur Telegram." },
        { status: 503, headers: cors },
      )
    }
    console.log(`[carnet/diagnostic] ${lu.diagnostic.carnet.version}, ${lu.diagnostic.erreurs.length} erreur(s), ${livres} destinataire(s)${securite ? ', suspect' : ''}`)
    return NextResponse.json({ ok: true, restants: Math.max(0, cadence.restants - 1) }, { headers: cors })
  } catch (err) {
    liberer()
    console.error(`[carnet/diagnostic] ${(err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 160)}`)
    return NextResponse.json({ error: 'Envoi impossible pour le moment, réessaie ou copie-le.' }, { status: 500, headers: cors })
  }
}
