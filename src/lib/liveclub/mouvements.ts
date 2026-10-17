// Ecriture des arrivees et departs des chats traces (canal MELMOM, groupe
// Les AS du NAS) dans public.cockpit_telegram_mouvements (migration
// 20261017230000). Les regles vivent dans mouvements-pur.ts.
//
// Best effort, ne leve JAMAIS : Telegram livre les updates d'un webhook dans
// l'ordre et rejoue celui qui echoue. Une table absente ou une base lente ne
// doit pas bloquer derriere elle les updates du Live Club.
import { prisma } from '@/lib/db'
import { chatsTraces, mouvementDepuisUpdate, type ChangementMembreTg } from './mouvements-pur'

/** Les chats traces, lus a chaque appel (variable posee sans redeployer le code). */
export function chatsTracesDuServeur(): Set<string> {
  return chatsTraces(process.env.TELEGRAM_CHATS_TRACES, process.env.TELEGRAM_LIVECLUB_CHAT_ID)
}

export async function enregistrerMouvement(updateId: number, cm: ChangementMembreTg): Promise<void> {
  const l = mouvementDepuisUpdate(updateId, cm)
  if (!l) return
  try {
    // Un rejeu (meme update_id) est ignore. Un compte oublie a sa demande
    // (cockpit_telegram_oublis, 20261015200000) n'est pas ecrit.
    await prisma.$executeRaw`
      insert into public.cockpit_telegram_mouvements
        (update_id, chat_id, groupe, type_chat, telegram_id, pseudo, nom_affiche,
         ancien_statut, nouveau_statut, sens, mode, par_id, par_qui,
         invite_lien_nom, invite_lien_url, invite_cree_par, invite_cree_par_id,
         invite_principal, invite_sur_demande, invite_prix_etoiles,
         via_demande, via_dossier, survenu_le)
      select ${l.updateId}::bigint, ${l.chatId}::bigint, ${l.groupe}::text, ${l.typeChat}::text,
             ${l.telegramId}::bigint, ${l.pseudo}::text, ${l.nomAffiche}::text,
             ${l.ancienStatut}::text, ${l.nouveauStatut}::text, ${l.sens}::text, ${l.mode}::text,
             ${l.parId}::bigint, ${l.parQui}::text,
             ${l.inviteLienNom}::text, ${l.inviteLienUrl}::text, ${l.inviteCreePar}::text, ${l.inviteCreeParId}::bigint,
             ${l.invitePrincipal}::boolean, ${l.inviteSurDemande}::boolean, ${l.invitePrixEtoiles}::integer,
             ${l.viaDemande}::boolean, ${l.viaDossier}::boolean, ${l.survenuLe}::timestamptz
      where not exists (select 1 from public.cockpit_telegram_oublis o where o.telegram_id = ${l.telegramId}::bigint)
      on conflict (update_id) do nothing`
  } catch (err) {
    // Ni nom ni identifiant de membre dans les logs : le chat et la cause.
    const cause = (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200)
    console.warn(`[liveclub/telegram] mouvement du chat ${l.chatId} non enregistre : ${cause}`)
  }
}
