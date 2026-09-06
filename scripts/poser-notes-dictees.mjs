/**
 * POSER LES NOTES QUE BRICE A DICTEES (01 et 02/09/2026).
 *
 * Premier vrai usage de `cockpit_arch_notes` : des faits qu'AUCUNE source ne
 * contient et qui viennent de lui seul. Le bouton de la fiche et la
 * capture-barre servent au cas courant ; ici on passe par la base parce que ces
 * notes ont ete dictees en session, hors navigateur.
 *
 * `ecrit_par` = le compte de Brice, parce que c'est lui la source. Chaque texte
 * dit d'ou il vient, pour qu'on ne prenne jamais une dictee pour une extraction.
 *
 * IDEMPOTENT : le script saute une note dont le texte exact est deja pose.
 *
 *   cd apps/journal-d-etude
 *   set -a && . ./.env && set +a && node scripts/poser-notes-dictees.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const NOTES = [
  // --- Dictees le 01/09 ---
  {
    personne_id: 'p-james',
    rubrique: 'identite',
    source: 'dicte par Brice, 01/09/2026',
    texte: [
      'JAMES MARSHALL. Createur de contenu, chaine YouTube « Natural Lifestyle », societe',
      'The Natural Lifestyles (thenaturallifestyles.com). Australien installe a Budapest.',
      'Pseudo Telegram @Jamesineurope. Ne le 05/08/1979 (47 ans).',
      'Telephone : +351 913 554 955 (mobile, Portugal).',
      'Photo de profil : exterieur, cheveux longs, lunettes de soleil.',
      'Support client : support@thenaturallifestyles.com, assistante Elvira — il renvoie',
      "explicitement dessus et n'aime pas qu'on lui pose ces questions a lui.",
    ].join(' '),
  },
  {
    personne_id: 'p-james',
    rubrique: 'liens',
    source: 'dicte par Brice, 01/09/2026',
    texte: [
      'LA RELATION EST INVERSEE PAR RAPPORT AU RESTE DU FONDS. Brice a consomme son',
      'contenu pendant des annees, PUIS achete sa formation de 5 semaines, qui donnait',
      "acces au groupe prive « MLM - Inner Circle ». Brice est donc son CLIENT, pas son",
      "eleve. Le registre le classe « eleve » faute de mieux : c'est la seule valeur",
      'disponible, et elle dit le contraire de la realite. Tout echange prive entre eux',
      'tient en DEUX messages, le 10/03/2023.',
    ].join(' '),
  },
  {
    personne_id: 'p-matthieu-faro',
    rubrique: 'identite',
    source: 'dicte par Brice, 01/09/2026',
    texte: [
      "Son nom d'affichage Telegram, « Majeur, 2003 et bientot immigre », est un surnom",
      'donne par Brice : Mathieu a demenage au Canada. Eleve proche. Brice compte changer',
      "ce surnom. ORTHOGRAPHE : Mathieu avec UN SEUL T — il l'a ecrit lui-meme le",
      '20/03/2023, « deja y a que 1 t a Mathieu ». Le registre ecrit « Matthieu Faro ».',
    ].join(' '),
  },
  {
    sujet: 'Les dossiers Telegram de Brice',
    rubrique: 'autre',
    source: 'dicte par Brice, 01/09/2026',
    texte: [
      "CE QUE L'EXPORT NE CONTIENT PAS ET QUI EST SA PROPRE TAXONOMIE. Brice avait range",
      "ses conversations en dossiers pour prioriser ses reponses ; l'export Telegram",
      'Desktop ne porte AUCUN dossier (verifie : zero occurrence de folder, filter,',
      "dialog_filter, chat_folder). Releves sur une capture d'ecran du 01/09/2026, dans",
      "l'ordre de la barre laterale : Contact pro · Groupes Pro · Ressources · Formation",
      '· Eleves exten · Groupe chill · Everything. Le contenu de chaque dossier reste a',
      "saisir : lui seul l'a.",
    ].join(' '),
  },

  // --- Corrections dictees le 02/09, sur captures d'ecran ---
  {
    personne_id: 'p-moha-mind',
    rubrique: 'identite',
    source: 'dicte par Brice, 02/09/2026',
    texte: [
      'Moha Mind (@moha_mindyt) est un SIMPLE DISTRIBUTEUR du canal Rise Up, pas un',
      "dirigeant. Brice l'a rencontre en 2026 a Marseille. Bio Telegram : « Un nouveau",
      'mind, tout par de rien, devenir LIBRE a 25 ans ». Il est admin du salon Rise Up -',
      'Team et y anime la « Power Hour ».',
      '',
      "CORRECTION D'UNE ERREUR D'ENQUETE : une passe automatique du 01/09 avait conclu",
      'que Moha Mind etait Mohammed Ifqirne, co-fondateur de la societe, en s appuyant',
      'sur une phrase de Jugurtha qui nomme Ifqirne dans le meme salon. C EST FAUX : ce',
      'sont deux personnes differentes. Une citation qui nomme quelqu un dans un salon',
      'ne designe pas le compte le plus visible de ce salon.',
    ].join(' '),
  },
  {
    sujet: 'Moha Ifqirne',
    rubrique: 'identite',
    source: 'dicte par Brice, 02/09/2026',
    texte: [
      'Ancien associe de Brice chez Future Infinity. A NE PAS CONFONDRE avec Moha Mind',
      '(@moha_mindyt), simple distributeur du canal Rise Up.',
      'Telephone : +33 6 29 50 72 54 (mobile).',
      "Aucun compte a ce nom n'a ete retrouve dans le fonds sous ce libelle : soit il n'y",
      "est pas, soit il y figure sous un autre nom d'affichage.",
    ].join(' '),
  },
  {
    personne_id: 'p-legacy',
    rubrique: 'identite',
    source: 'dicte par Brice, 02/09/2026',
    texte: [
      "Legacy (@LegacyKa) s'appelle Kevin — nom complet probablement KEVIN AMORIN.",
      'Instagram legacy_ka10, « Kevin A. | MAKE MONEY » : entrepreneuriat, education',
      "financiere, formation traders, trading automatique. Ami d'enfance de Sami",
      'Benguerar, qui l appelle « mon frere et associe » (02/03/2026, jour de son',
      'anniversaire).',
      '',
      "A NE PAS CONFONDRE AVEC KEVIN CHINDEKO (p-kevin-chindeko), qui est quelqu'un",
      "d'autre. C'est cette confusion-la que Brice signalait, et non une confusion avec",
      'Moha Mind.',
    ].join(' '),
  },
  {
    sujet: 'Karim Ait',
    rubrique: 'identite',
    source: 'dicte par Brice, 02/09/2026',
    texte: [
      'Leader du reseau Rise Up (« Karim Ait – Diamond 20 » dans le salon). AUCUN compte',
      "Telegram, nulle part dans l'archive : il n'existe que cite par d'autres, 175 fois.",
      "Brice l'a rencontre EN VRAI, a sa conference Future Infinity de 2022 au Mans. Il a",
      'ecrit son nom exactement deux fois en huit ans, dont le 10/04/2023 dans Deep',
      "Knowledge : « je sais que t'es sous Karim, j'ai entendu ton nom de sa propre bouche",
      'a Dubai ».',
      '',
      'ATTENTION : les 116 occurrences de « karim » dans Izitrade Communaute sont un',
      'AUTRE Karim, membre du groupe en 2018.',
    ].join(' '),
  },
  {
    personne_id: 'p-mathieu',
    rubrique: 'identite',
    source: 'dicte par Brice, 02/09/2026',
    texte: [
      'FUSION A DEFAIRE. Cet identifiant regroupe TROIS comptes sans rapport entre eux,',
      'rapproches sur le seul prenom : u5563491133 (117 msg, avril-juin 2023),',
      'u6287924071 (25 msg, aout 2025) et u5164751946 (10 msg, juillet-aout 2026).',
      'Aucune date commune, aucun salon commun.',
      '',
      'u6287924071 = MATHIEU TURPIN (@Mathieut83), confirme par Brice le 02/09/2026.',
      'Actif du 03 au 11 aout 2025, soit la semaine de son paiement.',
      '',
      'u5164751946 = un QUATRIEME Mathieu, venu du meme tunnel mais un an plus tard :',
      'il ecrit a Brice en prive le 24/07/2026 — « Bonjour Brice, j ai integre la',
      "communaute Live. Dans le message vocal de Mel, elle informe qu'il faut t'envoyer",
      'un message pour avoir acces a la formation. » 10 messages, Live Club + prive,',
      "du 24/07 au 28/08/2026. Il conseille deja d'autres membres.",
      '',
      "u5563491133 = encore un autre, 117 messages d'avril a juin 2023, un seul salon.",
    ].join(' '),
  },
  {
    sujet: 'Les Mathieu : quatre personnes, un prenom',
    rubrique: 'identite',
    source: 'mesure du 02/09/2026, confirmee et corrigee par Brice',
    texte: [
      '1. MATHIEU FARO (u1901414623, p-matthieu-faro) — eleve proche, ne en 2003, parti',
      'vivre a Montreal en decembre 2025, PVT le 11/02/2026. 42 723 messages sur six',
      'salons : la personne la plus prolifique du fonds.',
      '',
      '2. MATHIEU ROBERT (u740359867) — La Reunion (email en 974, fuseau +4 verifie sur',
      'trois dates), adulte marie et salarie en 2021, 270 messages de 2020 a 2022, dans',
      'le groupe « Formation Mathieu » qui ne comptait que trois personnes : lui, Brice',
      "et Mehdi. Son nom d'affichage est VIDE dans l'export. C'est l'eleve de l'epoque",
      'izimoney.',
      '',
      '3. MATHIEU TURPIN (u6287924071, @Mathieut83) — eleve venu du groupe de Melanie,',
      'entre a la promo. Virement Desjardins du 07/08/2025, objet « Formation AO',
      'Knowledge » : 500,00 EUR envoyes, 820,21 CAD convertis, 15,00 CAD de frais,',
      '835,21 CAD debites, taux 1 EUR = 1,640420 CAD. Confirmation 21908-59248, mode',
      'Swift. Compte payeur : Desjardins Vaudreuil-Soulanges, 709986-EOP, compte',
      "d'operations courantes. Beneficiaire : AO KNOWLEDGE, BRED Banque Populaire,",
      'France. Coordonnees du payeur sur le recu : Mathieu Turpin, 2584 ch',
      'Sainte-Angelique, Saint-Lazare, Quebec, CA, J7T 2K6, telephone 438 406-0580.',
      '',
      '4. UN QUATRIEME (u5164751946) — Live Club, arrive le 24/07/2026, meme tunnel',
      "Melanie mais un an apres Turpin. 10 messages. Son prenom d'affichage est aussi",
      '« Mathieu ». Prenom non confirme au-dela de l affichage.',
      '',
      "5. u5563491133 — 117 messages d'avril a juin 2023, un seul salon. Non identifie.",
      '',
      "PIEGE A RETENIR : DEUX de ces Mathieu sont au QUEBEC. Faro y vit depuis decembre",
      "2025, Turpin y payait deja en aout 2025. Le pays ne les distingue pas ; les dates,",
      'si.',
      '',
      "AVERTISSEMENT : @Mathieut83 n'est ecrit nulle part dans l'archive — zero occurrence.",
      "Le pseudo vient du registre de Brice, et son « 83 » ne renvoie ni au 974 de Mathieu",
      'Robert ni au Quebec de Turpin. Un pseudo qui ne se retrouve dans aucun message ne',
      "peut pas servir a rattacher un compte : c'est ce qui avait fait croire a une seule",
      'personne.',
    ].join(' '),
  },
]

async function main() {
  const [brice] = await prisma.$queryRawUnsafe(
    `select user_id, email from public.cockpit_allowlist
     where acces_fonds and email like 'brice%' limit 1`
  )
  if (!brice) throw new Error('Compte de Brice introuvable dans l allowlist.')
  console.log(`Signe par ${brice.email}\n`)

  let posees = 0
  let sautees = 0
  for (const n of NOTES) {
    const texte = `${n.texte}\n\n(${n.source})`
    const cible = n.personne_id
      ? `personne_id = '${n.personne_id}'`
      : `sujet = '${n.sujet.replace(/'/g, "''")}'`
    const [deja] = await prisma.$queryRawUnsafe(
      `select note_id from public.cockpit_arch_notes
       where ${cible} and rubrique = '${n.rubrique}'
         and texte = $tag$${texte}$tag$ limit 1`
    )
    if (deja) {
      sautees += 1
      continue
    }
    // La personne doit exister, sinon la cle etrangere refuse — et une note
    // silencieusement perdue est pire qu'une erreur.
    if (n.personne_id) {
      const [p] = await prisma.$queryRawUnsafe(
        `select personne_id from public.cockpit_arch_personnes
         where personne_id = '${n.personne_id}'`
      )
      if (!p) {
        console.error(`  X ${n.personne_id} n existe pas dans le fonds — note NON posee`)
        continue
      }
    }
    await prisma.$executeRawUnsafe(
      `insert into public.cockpit_arch_notes (personne_id, sujet, rubrique, texte, ecrit_par)
       values (${n.personne_id ? `'${n.personne_id}'` : 'null'},
               ${n.sujet ? `'${n.sujet.replace(/'/g, "''")}'` : 'null'},
               '${n.rubrique}', $tag$${texte}$tag$, '${brice.user_id}')`
    )
    posees += 1
    console.log(`  + ${n.personne_id ?? n.sujet} / ${n.rubrique}`)
  }

  const [{ n }] = await prisma.$queryRawUnsafe(
    `select count(*)::int as n from public.cockpit_arch_notes`
  )
  console.log(`\n${posees} posee(s), ${sautees} deja la. ${n} note(s) au total.`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
