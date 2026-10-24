/**
 * Essai, dans une transaction ANNULEE, de la migration 20261024170000 : une
 * correction de @ validee tient contre la vieille saisie Stripe, cede a une
 * saisie nouvelle. Rien ne reste en base.
 * Lancement (apps/journal-d-etude, .env.local charge) : node scripts/essayer-pseudo-suit-stripe.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const SQL = readFileSync(new URL('../../../sites/Aoknowledgecom/supabase/migrations/20261024170000_cockpit_pseudo_corrige_suit_stripe.sql', import.meta.url), 'utf8')
const ANNULER = 'essai annule'
const p = new PrismaClient()
try {
  await p.$transaction(async tx => {
    // Un ordre a la fois (prisma refuse plusieurs commandes) : la fonction jusqu'a $fn$, puis le reste.
    const [fonction, reste] = SQL.split('$fn$;')
    for (const ordre of [fonction + '$fn$', ...reste.split(';')]) {
      if (ordre.replace(/--.*$/gm, '').trim()) await tx.$executeRawUnsafe(ordre)
    }
    const [m] = await tx.$queryRawUnsafe(`select membre_id::text as id from public.cockpit_membres order by created_at limit 1`)
    const fiche = async () => (await tx.$queryRawUnsafe(`select telegram from public.cockpit_membres where membre_id = '${m.id}'::uuid`))[0].telegram
    const statut = async () => (await tx.$queryRawUnsafe(`select statut from public.cockpit_liveclub_corrections_pseudo where membre_id = '${m.id}'::uuid order by correction_id desc limit 1`))[0].statut
    await tx.$executeRawUnsafe(`delete from public.cockpit_liveclub_corrections_pseudo where membre_id = '${m.id}'::uuid`)
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = '@ancien_x' where membre_id = '${m.id}'::uuid`)
    await tx.$executeRawUnsafe(`insert into public.cockpit_liveclub_corrections_pseudo (membre_id, pseudo, pseudo_fiche_avant, pseudo_compte, propose_par_telegram, statut, decide_le)
      values ('${m.id}'::uuid, 'bon_pseudo', '@ancien_x', 'bon_pseudo', 1, 'validee', now())`)
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = '@bon_pseudo' where membre_id = '${m.id}'::uuid`)
    assert.equal(await fiche(), '@bon_pseudo')
    // Le push rejoue la vieille saisie, puis rien : la correction tient.
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = '@Ancien_X' where membre_id = '${m.id}'::uuid`)
    assert.equal(await fiche(), '@bon_pseudo')
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = null where membre_id = '${m.id}'::uuid`)
    assert.equal(await fiche(), '@bon_pseudo')
    assert.equal(await statut(), 'validee')
    // Une autre mise a jour de la fiche (nom) ne touche pas au @.
    await tx.$executeRawUnsafe(`update public.cockpit_membres set nom = nom where membre_id = '${m.id}'::uuid`)
    assert.equal(await fiche(), '@bon_pseudo')
    // Saisie nouvelle au paiement : elle gagne, la correction est remplacee.
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = '@tout_neuf' where membre_id = '${m.id}'::uuid`)
    assert.equal(await fiche(), '@tout_neuf')
    assert.equal(await statut(), 'remplacee')
    // Plus de correction validee : la fiche suit le push.
    await tx.$executeRawUnsafe(`update public.cockpit_membres set telegram = null where membre_id = '${m.id}'::uuid`)
    assert.equal(await fiche(), null)
    console.log('ok  correction : tient contre la vieille saisie et le vide, cede a une saisie nouvelle')
    throw new Error(ANNULER)
  }, { timeout: 60000 })
} catch (err) {
  if (!(err instanceof Error) || err.message !== ANNULER) throw err
  console.log('Transaction annulee, rien ne reste en base.')
} finally {
  await p.$disconnect()
}
