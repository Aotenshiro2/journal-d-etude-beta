import { prisma } from '@/lib/db'
import { USD_VERS_EUR } from '@/lib/ia-prix'
import { FOURNISSEUR_TRANSCRIPTION, cleTranscription, coutTranscriptionMicroEuros } from '@/lib/transcription-pur'

// La transcription cote SERVEUR (31/10/2026) : la cle, lue dans
// l'environnement, et le cout, trace dans AiUsage comme les appels Anthropic
// (ecran Depense IA du cockpit, poste « transcription »). Le chemin du fichier
// (telechargement, envoi au fournisseur, echecs) est pur :
// transcription-pur.ts. Le fournisseur se change la-bas, pas ici.

/**
 * La cle du fournisseur (GROQ_API_KEY_COCKPIT pour Groq), ou null. Jamais
 * affichee ni journalisee : seul le NOM de la variable peut l'etre.
 */
export function cleTranscriptionServeur(): string | null {
  return cleTranscription(process.env)
}

/**
 * (31/10) Une transcription dans AiUsage : produit 'cockpit' (Agent AOK),
 * poste 'transcription', modele du fournisseur, aucun jeton, cout a la duree
 * (fige a l'ecriture, comme le reste). Best effort : un echec du log ne casse
 * jamais la reponse.
 */
export async function tracerTranscription(o: { userId: string; dureeS: number | null; echange?: string | null }): Promise<void> {
  try {
    await prisma.aiUsage.create({
      data: {
        userId: o.userId,
        product: 'cockpit',
        model: FOURNISSEUR_TRANSCRIPTION.modele,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: coutTranscriptionMicroEuros(o.dureeS, USD_VERS_EUR),
        usage: 'transcription',
        echange: o.echange ?? null,
      },
    })
  } catch (err) {
    console.error('[transcription] cout non trace', err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : '?')
  }
}
