// L'ESPACE PERSO DE BRICE : les notes entre Tab et Claude Code (20/10/2026).
// Ecritures en base (le serveur du journal est le seul a ecrire dans
// cockpit_perso_notes), ping email de Tab, message Telegram a Brice.
//
// Les PINGS (Brice veut que l'un « pingue » l'autre, pas un document qu'il faut
// penser a aller lire) :
// - note vers_tab  : un email court a l'adresse que Tab lit et qui le reveille
//   (TAB_NOTES_EMAIL, par defaut brice.delannay@mail.tab.bot), par Resend
//   (RESEND_API_KEY, l'envoi deja utilise par le journal pour le cockpit),
//   expediteur TAB_NOTES_FROM_EMAIL, par defaut support@aoknowledge.com.
//   Couper : TAB_NOTES_PING=off sur le projet Vercel.
// - note vers_claude : un message du bot Agent AOK a Brice sur Telegram (son
//   compte de cockpit_telegram_comptes). Claude, lui, la voit au demarrage de
//   sa session par le script local notes_tab.py --nouvelles.
// Un ping rate ne fait jamais echouer l'ecriture de la note : il est consigne
// (ping_envoye_le, ping_erreur).

import { Resend } from 'resend'
import { prisma } from '@/lib/db'
import { tgCockpit } from '@/lib/agent-cockpit-telegram'
import { BASE } from '@/lib/tab/aide'
import { emailPing, messageBrice, type Auteur, type NoteEntrante, type NotePerso, type Instance, type Sens, type StatutNote } from '@/lib/tab/notes-pur'

export const BRICE_USER_ID = '0636a40b-13a4-4fe8-af11-d060e2810767'

const COLONNES = `note_id::text as note_id, sens, auteur, sujet, texte, projet, liens, statut,
  cree_le, lu_le, traite_le, ping_envoye_le, instance, lue_par`

type Ligne = Omit<NotePerso, 'cree_le' | 'lu_le' | 'traite_le' | 'ping_envoye_le'> & {
  cree_le: Date; lu_le: Date | null; traite_le: Date | null; ping_envoye_le: Date | null
}

function versNote(l: Ligne): NotePerso {
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  return { ...l, cree_le: l.cree_le.toISOString(), lu_le: iso(l.lu_le), traite_le: iso(l.traite_le), ping_envoye_le: iso(l.ping_envoye_le) }
}

export async function listerNotes(sens: Sens, statut: StatutNote | 'toutes', limite: number): Promise<NotePerso[]> {
  const lignes = await prisma.$queryRawUnsafe<Ligne[]>(
    `select ${COLONNES} from public.cockpit_perso_notes
      where sens = $1 and ($2 = 'toutes' or statut = $2)
      order by cree_le desc limit $3`,
    sens, statut, limite,
  )
  return lignes.map(versNote)
}

/** Destinataire (vers_claude, les_deux par defaut) ou auteur Claude (vers_tab, sora par defaut). Brice : aucune. */
function instanceDe(sens: Sens, auteur: Auteur, i: Instance | null): Instance | null {
  if (sens === 'vers_claude') return i ?? 'les_deux'
  if (auteur !== 'claude') return null
  return i === 'umi' ? 'umi' : 'sora'
}

export async function creerNote(sens: Sens, auteur: Auteur, n: NoteEntrante): Promise<NotePerso> {
  const lignes = await prisma.$queryRawUnsafe<Ligne[]>(
    `insert into public.cockpit_perso_notes (sens, auteur, sujet, texte, projet, liens, instance)
     values ($1, $2, $3, $4, $5, $6::text[], $7) returning ${COLONNES}`,
    sens, auteur, n.sujet, n.texte, n.projet, n.liens, instanceDe(sens, auteur, n.instance),
  )
  return versNote(lignes[0])
}

/** Tab marque lue une note vers_tab. Rend la note, ou null si elle n'existe pas (ou n'est pas pour Tab). */
export async function marquerLueParTab(noteId: string): Promise<NotePerso | null> {
  const lignes = await prisma.$queryRawUnsafe<Ligne[]>(
    `update public.cockpit_perso_notes set statut = 'lue'
      where note_id = $1::uuid and sens = 'vers_tab' and statut = 'nouvelle'
      returning ${COLONNES}`,
    noteId,
  )
  if (lignes[0]) return versNote(lignes[0])
  const deja = await prisma.$queryRawUnsafe<Ligne[]>(
    `select ${COLONNES} from public.cockpit_perso_notes where note_id = $1::uuid and sens = 'vers_tab'`, noteId)
  return deja[0] ? versNote(deja[0]) : null
}

export function pingActif(): boolean {
  return !/^(off|non|0|false)$/i.test(process.env.TAB_NOTES_PING?.trim() ?? '')
}

/** L'email qui reveille Tab. Ne jette jamais ; consigne le resultat sur la note. */
export async function pingerTab(note: NotePerso, test = false): Promise<{ envoye: boolean; erreur?: string }> {
  let erreur: string | undefined
  if (!pingActif()) erreur = 'ping coupé (TAB_NOTES_PING=off)'
  const cle = process.env.RESEND_API_KEY?.trim()
  if (!erreur && !cle) erreur = 'RESEND_API_KEY absente du projet journal'
  if (!erreur) {
    try {
      const { objet, texte } = emailPing(note, BASE, test)
      const { error } = await new Resend(cle!).emails.send({
        from: process.env.TAB_NOTES_FROM_EMAIL?.trim() || 'Cockpit AOK <support@aoknowledge.com>',
        to: process.env.TAB_NOTES_EMAIL?.trim() || 'brice.delannay@mail.tab.bot',
        subject: objet,
        text: texte,
      })
      if (error) erreur = `Resend : ${String(error.message ?? error.name ?? '?').slice(0, 200)}`
    } catch (err) {
      erreur = `Resend : ${err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)}`
    }
  }
  try {
    await prisma.$executeRawUnsafe(
      `update public.cockpit_perso_notes set ping_envoye_le = $2, ping_erreur = $3 where note_id = $1::uuid`,
      note.note_id, erreur ? null : new Date(), erreur ?? null,
    )
  } catch (err) {
    console.error('[perso] consigner le ping', err instanceof Error ? err.message.split('\n').pop() : err)
  }
  if (erreur) console.error('[perso] ping de Tab', erreur)
  return erreur ? { envoye: false, erreur } : { envoye: true }
}

/** Le message Telegram a Brice : Tab a laisse une note pour Claude. Ne jette jamais. */
export async function prevenirBrice(note: NotePerso): Promise<boolean> {
  try {
    const comptes = await prisma.$queryRawUnsafe<{ telegram_id: string }[]>(
      `select telegram_id::text as telegram_id from public.cockpit_telegram_comptes where user_id = $1::uuid limit 1`, BRICE_USER_ID)
    if (!comptes[0]) return false
    const ok = await tgCockpit('sendMessage', {
      chat_id: Number(comptes[0].telegram_id), text: messageBrice(note.sujet, note.instance), disable_web_page_preview: true,
    })
    if (ok) {
      await prisma.$executeRawUnsafe(
        `update public.cockpit_perso_notes set ping_envoye_le = now() where note_id = $1::uuid`, note.note_id)
    }
    return ok
  } catch (err) {
    console.error('[perso] message a Brice', err instanceof Error ? err.message.split('\n').pop() : err)
    return false
  }
}
