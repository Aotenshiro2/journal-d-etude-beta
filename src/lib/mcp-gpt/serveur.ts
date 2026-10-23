// LE CONNECTEUR MCP DE CHATGPT POUR BELRIVE (23/10/2026) : le cote serveur.
//
// La cle (empreinte en temps constant, debit de 60 appels par minute compte
// dans cockpit_tab_acces, comme l'API de Tab), les transactions, et les pings
// des notes : les MEMES que celles de Tab (src/lib/tab/notes.ts) :
// - note pour Tab (vers_tab) : l'email qui reveille Tab ;
// - note pour Sora, Yume, Sekai ou toutes (vers_claude) : un message du bot
//   Agent AOK a Brice sur Telegram. Les instances la lisent au demarrage de
//   leur session (automations/notes_tab.py --nouvelles).
// Un ping rate ne fait jamais echouer la note.
//
// Toute lecture tourne dans une transaction READ ONLY (8 s par requete) ; les
// deux ecritures (une note, un document) dans une transaction courte.

import { prisma } from '@/lib/db'
import { pingerTab, prevenirBrice } from '@/lib/tab/notes'
import type { NotePerso } from '@/lib/tab/notes-pur'
import { choisirCle, DEBIT_PAR_MINUTE_GPT, type Base, type VerdictCle } from '@/lib/mcp-gpt/pur'
import * as R from '@/lib/mcp-gpt/requetes'

function raison(err: unknown): string {
  return err instanceof Error ? (err.message.split('\n').filter(Boolean).pop() ?? '') : String(err)
}

export async function verifierCleGpt(secret: string): Promise<VerdictCle> {
  let cles: R.LigneCle[]
  try {
    cles = await R.clesActives(prisma)
  } catch (err) {
    console.error('[mcp-gpt] cles illisibles', raison(err).slice(0, 200))
    return { ok: false, raison: 'base', cleId: null }
  }
  const c = choisirCle(cles, secret)
  if (!c) return { ok: false, raison: 'inconnue', cleId: null }
  if (c.appels >= DEBIT_PAR_MINUTE_GPT) return { ok: false, raison: 'debit', cleId: c.cle_id }
  return { ok: true, cleId: c.cle_id }
}

function lecture<T>(f: (db: R.Executeur) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('set transaction read only')
    await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
    return f(tx)
  }, { maxWait: 8000, timeout: 20000 })
}

function ecriture<T>(f: (db: R.Executeur) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local statement_timeout = '8000ms'`)
    return f(tx)
  }, { maxWait: 8000, timeout: 20000 })
}

function versNotePerso(l: R.LigneNoteEcrite): NotePerso {
  const ou = (d: Date | string | null) => (d ? R.iso(d) : null)
  return {
    note_id: l.note_id,
    sens: l.sens,
    auteur: 'gpt',
    sujet: l.sujet,
    texte: l.texte,
    projet: 'belrive',
    liens: l.liens ?? [],
    statut: l.statut,
    cree_le: R.iso(l.cree_le),
    lu_le: ou(l.lu_le),
    traite_le: ou(l.traite_le),
    ping_envoye_le: ou(l.ping_envoye_le),
    instance: (l.instance as NotePerso['instance']) ?? null,
    lue_par: l.lue_par ?? [],
  }
}

export const base: Base = {
  chercher: (r) => lecture((db) => R.chercher(db, r)),
  lireDocument: (id) => lecture((db) => R.lireDocument(db, id)),
  lireDocumentParChemin: (chemin) => lecture((db) => R.lireDocumentParChemin(db, chemin)),
  lireNote: (id) => lecture((db) => R.lireNote(db, id)),
  listerDocuments: () => lecture((db) => R.listerDocuments(db)),
  listerNotes: (statut, limite) => lecture((db) => R.listerNotes(db, statut, limite)),
  deposerDocument: (d) => ecriture((db) => R.deposerDocument(db, d)),
  ecrireNote: async (n) => {
    const ligne = await ecriture((db) => R.ecrireNote(db, n))
    const note = versNotePerso(ligne)
    let prevenu: string
    if (n.destinataire.sens === 'vers_tab') {
      const p = await pingerTab(note)
      prevenu = p.envoye ? 'Tab est prévenu par email.' : 'Note enregistrée, mais l\'email à Tab n\'est pas parti : il la verra à sa prochaine lecture des notes.'
    } else {
      const telegram = await prevenirBrice(note)
      prevenu = telegram
        ? 'Brice est prévenu sur Telegram. Les instances la lisent au démarrage de leur prochaine session.'
        : 'Note enregistrée. Les instances la lisent au démarrage de leur prochaine session.'
    }
    return { note: R.versNoteBelrive(ligne), prevenu }
  },
}
