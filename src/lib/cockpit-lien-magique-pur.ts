// Connexion au COCKPIT par lien envoye par email, avec N'IMPORTE quelle adresse
// verifiee du compte (05/11, Brice : « son second mail devrait lui permettre de
// se connecter au cockpit aussi, voire meme tous ses mails »). La partie PURE,
// sans base ni reseau : regles, cles, email, et le deroule des deux routes avec
// des ports injectes (la vraie base et le vrai Supabase dans
// cockpit-lien-magique.ts, une fausse base et un faux Supabase dans
// scripts/verifier-lien-magique-cockpit.mjs). Aucun import relatif : Node 22 la
// charge telle quelle.
//
// Pourquoi pas signInWithOtp (05/11) : Supabase n'envoie un lien qu'a l'email
// de CONNEXION du compte (auth.users.email). Demande avec une adresse verifiee
// secondaire (le Gmail de Melanie, dans profile_emails), il ne part rien
// (shouldCreateUser: false), ou un compte vide est cree. Ici le serveur
// retrouve le compte par l'adresse tapee et envoie le lien a CETTE adresse.
//
// Le parcours (05/11) :
// 1. POST /api/cockpit/lien-magique { email } (route publique). Sous un verrou :
//    compteurs (adresse, IP, total), puis le compte. Seule une adresse qui est
//    l'email de connexion confirme OU une adresse verified = true de
//    profile_emails d'un compte de cockpit_allowlist recoit un lien. Reponse
//    identique dans tous les cas (sauf la limite de cadence, qui vaut pour
//    toute adresse, connue ou non) : pas d'enumeration. L'email part APRES la
//    reponse (after), pour que le temps de reponse ne trahisse rien non plus.
// 2. Le lien porte un jeton opaque de 32 octets (cockpit.aoknowledge.com/
//    auth/lien#lien=...), pas le jeton Supabase. La base n'en garde que le
//    HMAC, 15 minutes, une seule ouverture.
// 3. Au clic sur « Ouvrir le Cockpit », la page POST
//    /api/cockpit/lien-magique/ouvrir { lien }. Le serveur consomme le jeton,
//    relit le compte (toujours dans l'allowlist, adresse toujours verifiee),
//    genere alors seulement le jeton Supabase (auth.admin.generateLink de type
//    'recovery' sur l'email de connexion : ce type ne cree JAMAIS de compte,
//    contrairement a 'magiclink' qui inscrit une adresse inconnue) et rend son
//    token_hash. La page appelle verifyOtp({ token_hash, type }) : la session
//    s'ouvre dans le navigateur qui a clique, quel que soit l'appareil qui a
//    demande le lien (ni PKCE ni code_verifier).
//
// Jamais l'adresse, l'IP ni le jeton en clair dans un log ou dans la base :
// HMAC (cles derivees du secret du serveur, une par usage) et 8 caracteres
// pour recouper.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Un lien vaut 15 minutes, une seule ouverture. */
export const LIEN_VALIDITE_MINUTES = 15

/** Demandes au plus pour une meme adresse (connue ou non) : 5 par heure, 10 par 24 heures. */
export const DEMANDES_ADRESSE_HEURE = 5
export const DEMANDES_ADRESSE_JOUR = 10
/** Demandes au plus depuis une meme IP : 10 par heure, 30 par 24 heures. */
export const DEMANDES_IP_HEURE = 10
export const DEMANDES_IP_JOUR = 30
/** Plafond global (toutes adresses, toutes IP) : 60 demandes par heure. */
export const DEMANDES_TOTAL_HEURE = 60

/** Rafale : 15 demandes en une heure (refusees comprises), ou une limite atteinte. */
export const RAFALE_HEURE = 15
/** Une alerte de rafale a l'equipe toutes les 60 minutes au plus. */
export const ALERTE_INTERVALLE_MINUTES = 60
/** Le journal des demandes garde 30 jours. */
export const JOURNAL_JOURS = 30

export const URL_COCKPIT_DEFAUT = 'https://cockpit.aoknowledge.com'
export const CHEMIN_LIEN = '/auth/lien'
export const SUPPORT = 'support@aoknowledge.com'
export const EXPEDITEUR = 'Cockpit AO Knowledge <support@aoknowledge.com>'
export const SIGNATURE = 'Cockpit AO Knowledge'

/** Le seul type de jeton Supabase genere ici : il ne cree jamais de compte. */
export const TYPE_JETON_SUPABASE = 'recovery'

/** La reponse a toute demande lisible et sous les plafonds, adresse connue ou non. */
export const MESSAGE_NEUTRE = `Si cette adresse ouvre le cockpit, un lien vient de partir. Il marche ${LIEN_VALIDITE_MINUTES} minutes, une seule fois.`
export const MESSAGE_LIMITE = "Trop de demandes d'affilée pour l'instant. Réessayez dans une heure."

// ---------------------------------------------------------------------------
// Cles et jetons
// ---------------------------------------------------------------------------

const USAGE_ADRESSE = 'aok/cockpit_lien/adresse/v1'
const USAGE_IP = 'aok/cockpit_lien/ip/v1'
const USAGE_LIEN = 'aok/cockpit_lien/lien/v1'

function cleDerivee(secret: string, usage: string): Buffer {
  return createHmac('sha256', secret).update(usage, 'utf8').digest()
}

const hmac = (secret: string, usage: string, valeur: string) =>
  createHmac('sha256', cleDerivee(secret, usage)).update(valeur, 'utf8').digest('hex')

/** HMAC de l'adresse tapee (normalisee) : cle des compteurs et du journal, jamais l'adresse. */
export const hmacAdresse = (secret: string, email: string) => hmac(secret, USAGE_ADRESSE, email)
/** HMAC de l'IP ('aucune' si la requete n'en porte pas) : jamais l'IP. */
export const hmacIp = (secret: string, ip: string | null) => hmac(secret, USAGE_IP, ip ?? 'aucune')
/** HMAC du jeton du lien : la base ne garde que lui. */
export const hmacLien = (secret: string, jeton: string) => hmac(secret, USAGE_LIEN, jeton)

/** 8 caracteres d'un HMAC : de quoi recouper deux lignes de log, rien de plus. */
export const ref = (h: string) => h.slice(0, 8)

/** Un jeton de lien : 32 octets du generateur cryptographique, en base64url (43 caracteres). */
export function genererJeton(): string {
  return randomBytes(32).toString('base64url')
}

/** Le jeton lu dans une requete, ou null : exactement 43 caracteres base64url. */
export function lireJeton(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null
}

/** Egalite de deux HMAC hexadecimaux, a temps constant. */
export function memeHmac(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

/**
 * L'adresse du lien dans l'email. `base` vient du serveur (constante ou
 * COCKPIT_URL), jamais de la requete. Le jeton est dans le FRAGMENT (#lien=) :
 * un fragment n'est jamais envoye au serveur, il ne finit donc ni dans les
 * journaux de Vercel du cockpit ni dans un en-tete Referer.
 */
export function urlDuLien(base: string, jeton: string): string {
  return `${base.replace(/\/+$/, '')}${CHEMIN_LIEN}#lien=${encodeURIComponent(jeton)}`
}

/** La base du cockpit : https sur aoknowledge.com, ou localhost en dev. Sinon la valeur par defaut. */
export function baseCockpit(v: string | undefined | null): string {
  const b = (v ?? '').trim().replace(/\/+$/, '')
  if (/^https:\/\/([a-z0-9-]+\.)*aoknowledge\.com$/.test(b) || /^http:\/\/localhost(:\d{2,5})?$/.test(b)) return b
  return URL_COCKPIT_DEFAUT
}

// ---------------------------------------------------------------------------
// Regles
// ---------------------------------------------------------------------------

/** Les demandes deja faites (journal cockpit_lien_magique_demandes). Les refus de cadence ne comptent pas dans les plafonds. */
export type Compteurs = {
  adresseHeure: number
  adresseJour: number
  ipHeure: number
  ipJour: number
  totalHeure: number
  /** Toutes les demandes de l'heure, refus de cadence compris (pour la rafale). */
  toutesHeure: number
  limitesHeure: number
  envoyesHeure: number
  /** Une alerte de rafale est deja partie depuis moins de ALERTE_INTERVALLE_MINUTES. */
  alerteRecente: boolean
}

/** Une demande de plus depasserait-elle un plafond ? */
export function limiteAtteinte(c: Compteurs): boolean {
  return c.adresseHeure >= DEMANDES_ADRESSE_HEURE
    || c.adresseJour >= DEMANDES_ADRESSE_JOUR
    || c.ipHeure >= DEMANDES_IP_HEURE
    || c.ipJour >= DEMANDES_IP_JOUR
    || c.totalHeure >= DEMANDES_TOTAL_HEURE
}

/** Un compte qui porte l'adresse tapee, comme connexion ou dans profile_emails. */
export type CompteCandidat = {
  userId: string
  /** Inscrit dans cockpit_allowlist. */
  autorise: boolean
  /** 'connexion' = auth.users.email ; 'verifiee' = profile_emails verified ; 'non_verifiee' = profile_emails sans preuve. */
  lien: 'connexion' | 'verifiee' | 'non_verifiee'
  /** auth.users.email_confirmed_at pose. */
  connexionConfirmee: boolean
}

export type Issue = 'envoye' | 'inconnue' | 'non_verifiee' | 'hors_allowlist' | 'ambigu' | 'limite'

export type DecisionCompte =
  | { action: 'envoyer'; userId: string; parConnexion: boolean }
  | { action: 'ignorer'; issue: Exclude<Issue, 'envoye' | 'limite'> }

/** L'adresse prouve-t-elle ce compte ? Email de connexion confirme, ou adresse verifiee. */
const adresseProuvee = (c: CompteCandidat) => c.lien === 'verifiee' || (c.lien === 'connexion' && c.connexionConfirmee)

/**
 * Faut-il envoyer un lien, et pour quel compte ? Seulement un compte de
 * l'allowlist dont l'adresse tapee est prouvee. Deux comptes de l'allowlist
 * pour la meme adresse : rien (ambigu). La raison d'un refus ne va qu'au
 * journal, jamais dans la reponse.
 */
export function decisionCompte(candidats: CompteCandidat[]): DecisionCompte {
  const valides = candidats.filter(c => c.autorise && adresseProuvee(c))
  const ids = [...new Set(valides.map(c => c.userId.toLowerCase()))]
  if (ids.length > 1) return { action: 'ignorer', issue: 'ambigu' }
  if (ids.length === 1) {
    const c = valides.find(v => v.userId.toLowerCase() === ids[0])!
    return { action: 'envoyer', userId: c.userId, parConnexion: valides.some(v => v.lien === 'connexion') }
  }
  if (candidats.some(c => c.autorise)) return { action: 'ignorer', issue: 'non_verifiee' }
  if (candidats.length > 0) return { action: 'ignorer', issue: 'hors_allowlist' }
  return { action: 'ignorer', issue: 'inconnue' }
}

/** Faut-il alerter l'equipe ? Une limite atteinte, ou RAFALE_HEURE demandes en une heure ; une fois par intervalle. */
export function decisionAlerte(p: { limite: boolean; toutesHeure: number; alerteRecente: boolean }): boolean {
  if (p.alerteRecente) return false
  return p.limite || p.toutesHeure >= RAFALE_HEURE
}

/** Le texte de l'alerte a l'equipe : des nombres, aucune adresse ni IP. */
export function texteAlerte(c: { toutesHeure: number; limitesHeure: number; envoyesHeure: number }): string {
  return [
    'Cockpit, connexion par lien : beaucoup de demandes en peu de temps.',
    `Dernière heure : ${c.toutesHeure} demande${c.toutesHeure > 1 ? 's' : ''}, dont ${c.limitesHeure} bloquée${c.limitesHeure > 1 ? 's' : ''} par la limite de cadence et ${c.envoyesHeure} lien${c.envoyesHeure > 1 ? 's' : ''} envoyé${c.envoyesHeure > 1 ? 's' : ''}.`,
    "Un lien ne part que vers une adresse vérifiée d'un compte du cockpit : personne d'autre n'en reçoit.",
    "Si ce n'est pas l'un de vous, le détail (sans adresse) est dans la table cockpit_lien_magique_demandes.",
  ].join('\n')
}

// ---------------------------------------------------------------------------
// L'email
// ---------------------------------------------------------------------------

export type ModeleEmailLien = { sujet: string; avant: string[]; bouton: { texte: string; url: string }; apres: string[] }

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

/** « le 5 novembre à 14:32 », « le 1er décembre à 08:05 », heure de Paris. */
export function momentParis(d: Date): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const v = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const jour = Number(v('day'))
  return `le ${jour === 1 ? '1er' : jour} ${MOIS[Number(v('month')) - 1] ?? ''} à ${v('hour')}:${v('minute')}`
}

/**
 * Court et sobre : ce qui a ete demande, quand, le bouton, la duree, et quoi
 * faire si on n'a rien demande. Pas d'urgence, pas de piece jointe, l'adresse
 * du lien en clair (cockpit.aoknowledge.com). Le seul texte venu de la
 * requete est l'adresse tapee, deja normalisee (ASCII strict), echappee au rendu.
 */
export function modeleEmailLien(email: string, url: string, demandeLe: Date): ModeleEmailLien {
  return {
    sujet: 'Votre lien de connexion au Cockpit',
    avant: [
      'Bonjour,',
      `Une connexion au Cockpit AO Knowledge a été demandée avec l'adresse ${email}, ${momentParis(demandeLe)} (heure de Paris). Pour entrer, ouvrez ce lien :`,
    ],
    bouton: { texte: 'Ouvrir le Cockpit', url },
    apres: [
      `Le lien marche ${LIEN_VALIDITE_MINUTES} minutes et une seule fois, sur l'appareil de votre choix (ordinateur ou téléphone).`,
      "Vous n'avez rien demandé ? Ne faites rien : sans ce lien, personne n'entre. Ne le transférez à personne.",
      `Une question ? Écrivez à ${SUPPORT}.`,
    ],
  }
}

export function echapper(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Meme gabarit sobre que les emails du Live Club (htmlEmail) : texte, un bouton, le lien en clair. */
export function htmlEmailLien(m: ModeleEmailLien): string {
  const p = (t: string) => `<p style="margin:0 0 16px;line-height:1.5">${echapper(t)}</p>`
  const url = echapper(m.bouton.url)
  return `<!doctype html><html lang="fr"><body style="margin:0;padding:24px;background:#ffffff;color:#111827;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px">
<div style="max-width:560px;margin:0 auto">
${m.avant.map(p).join('\n')}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:600">${echapper(m.bouton.texte)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#6b7280">Si le bouton ne marche pas, copiez ce lien : ${url}</p>
${m.apres.map(p).join('\n')}
<p style="margin:32px 0 0;line-height:1.5">${echapper(SIGNATURE)}</p>
</div></body></html>`
}

export function texteEmailLien(m: ModeleEmailLien): string {
  return [...m.avant, m.bouton.url, ...m.apres, SIGNATURE].join('\n\n')
}

// ---------------------------------------------------------------------------
// Le deroule de la demande (POST /api/cockpit/lien-magique)
// ---------------------------------------------------------------------------

export type Reponse = { status: number; corps: Record<string, unknown> }

/** Une ligne du journal des demandes. Jamais l'adresse, l'IP ni le jeton : leurs HMAC. */
export type LigneJournal = {
  emailHmac: string
  ipHmac: string
  issue: Issue
  userId: string | null
  /** L'adresse tapee est l'email de connexion (sinon une adresse verifiee secondaire). null si aucun envoi. */
  parConnexion: boolean | null
  lienHmac: string | null
  /** Duree du lien, en minutes (la base pose expire_le = now() + duree). null si aucun envoi. */
  validiteMinutes: number | null
  alerte: boolean
}

/** Ce qui se fait sous le verrou, dans une seule transaction. */
export type TxDemande = {
  compter(emailHmac: string, ipHmac: string): Promise<Compteurs>
  /** Les comptes qui portent l'adresse : connexion, profile_emails verifiee ou non. Lecture seule. */
  candidats(email: string): Promise<CompteCandidat[]>
  consigner(l: LigneJournal): Promise<void>
}

export type PortsDemande = {
  secret: string
  urlCockpit: string
  maintenant(): Date
  jeton(): string
  dansVerrou<T>(f: (tx: TxDemande) => Promise<T>): Promise<T>
  envoyerEmail(destinataire: string, m: ModeleEmailLien): Promise<{ ok: true } | { ok: false; erreur: string }>
  /** L'email n'est pas parti : le lien ne doit plus pouvoir servir. */
  envoiRate(lienHmac: string): Promise<void>
  alerter(texte: string): Promise<void>
  journal(ligne: string): void
  /** Le code d'une erreur de base, jamais son message (il peut reprendre l'adresse). */
  codeErreur(err: unknown): string
}

export type IssueDemande = { reponse: Reponse; apres: (() => Promise<void>) | null; issue: Issue | 'indisponible' }

/**
 * `email` doit etre normalise (normaliserEmail de emails-confirmation-pur).
 * Rend la reponse a envoyer tout de suite, et ce qui se fait APRES elle
 * (l'email, l'alerte) : la route le passe a after().
 */
export async function traiterDemande(d: { email: string; ip: string | null }, p: PortsDemande): Promise<IssueDemande> {
  const emailHmac = hmacAdresse(p.secret, d.email)
  const ipHmac = hmacIp(p.secret, d.ip)
  const qui = `ref=${ref(emailHmac)} ip=${ref(ipHmac)}`

  type Resultat = { issue: Issue; decision: DecisionCompte | null; jeton: string | null; lienHmac: string | null; alerte: boolean; c: Compteurs }
  let r: Resultat
  try {
    r = await p.dansVerrou(async (tx): Promise<Resultat> => {
      const c = await tx.compter(emailHmac, ipHmac)
      if (limiteAtteinte(c)) {
        const alerte = decisionAlerte({ limite: true, toutesHeure: c.toutesHeure + 1, alerteRecente: c.alerteRecente })
        await tx.consigner({ emailHmac, ipHmac, issue: 'limite', userId: null, parConnexion: null, lienHmac: null, validiteMinutes: null, alerte })
        return { issue: 'limite', decision: null, jeton: null, lienHmac: null, alerte, c: { ...c, toutesHeure: c.toutesHeure + 1, limitesHeure: c.limitesHeure + 1 } }
      }
      const decision = decisionCompte(await tx.candidats(d.email))
      const alerte = decisionAlerte({ limite: false, toutesHeure: c.toutesHeure + 1, alerteRecente: c.alerteRecente })
      if (decision.action === 'envoyer') {
        const jeton = p.jeton()
        const lienHmac = hmacLien(p.secret, jeton)
        await tx.consigner({
          emailHmac, ipHmac, issue: 'envoye', userId: decision.userId, parConnexion: decision.parConnexion,
          lienHmac, validiteMinutes: LIEN_VALIDITE_MINUTES, alerte,
        })
        return { issue: 'envoye', decision, jeton, lienHmac, alerte, c: { ...c, toutesHeure: c.toutesHeure + 1, envoyesHeure: c.envoyesHeure + 1 } }
      }
      await tx.consigner({ emailHmac, ipHmac, issue: decision.issue, userId: null, parConnexion: null, lienHmac: null, validiteMinutes: null, alerte })
      return { issue: decision.issue, decision, jeton: null, lienHmac: null, alerte, c: { ...c, toutesHeure: c.toutesHeure + 1 } }
    })
  } catch (err) {
    p.journal(`demande ${qui} : base ${p.codeErreur(err)}`)
    return { reponse: { status: 503, corps: { ok: false, erreur: 'indisponible' } }, apres: null, issue: 'indisponible' }
  }

  // Le compte n'apparait qu'en 8 caracteres, et seulement quand un lien part.
  const compte = r.decision?.action === 'envoyer' ? ` compte=${r.decision.userId.slice(0, 8)}` : ''
  p.journal(`demande ${qui} : ${r.issue}${compte}${r.alerte ? ' (alerte rafale)' : ''}`)

  const taches: (() => Promise<void>)[] = []
  if (r.issue === 'envoye' && r.jeton && r.lienHmac) {
    const jeton = r.jeton
    const lienHmac = r.lienHmac
    const demandeLe = p.maintenant()
    taches.push(async () => {
      const envoi = await p.envoyerEmail(d.email, modeleEmailLien(d.email, urlDuLien(p.urlCockpit, jeton), demandeLe))
      if (envoi.ok) {
        p.journal(`demande ${qui} : email parti`)
        return
      }
      await p.envoiRate(lienHmac).catch(() => undefined)
      p.journal(`demande ${qui} : email NON parti (${envoi.erreur})`)
    })
  }
  if (r.alerte) {
    const texte = texteAlerte(r.c)
    taches.push(async () => { await p.alerter(texte) })
  }
  const apres = taches.length
    ? async () => {
      for (const t of taches) {
        try { await t() } catch (err) { p.journal(`demande ${qui} : apres la reponse, ${p.codeErreur(err)}`) }
      }
    }
    : null

  if (r.issue === 'limite') {
    return { reponse: { status: 429, corps: { ok: false, erreur: 'limite', message: MESSAGE_LIMITE } }, apres, issue: r.issue }
  }
  // Meme reponse, adresse connue ou non, envoi ou non.
  return { reponse: { status: 200, corps: { ok: true, message: MESSAGE_NEUTRE, minutes: LIEN_VALIDITE_MINUTES } }, apres, issue: r.issue }
}

// ---------------------------------------------------------------------------
// L'ouverture (POST /api/cockpit/lien-magique/ouvrir)
// ---------------------------------------------------------------------------

export type Consommation =
  | { etat: 'ok'; userId: string; emailHmac: string }
  | { etat: 'inconnu' | 'expire' | 'utilise' }

/** Le compte relu a l'ouverture. */
export type CompteOuverture = {
  autorise: boolean
  /** auth.users.email tel que stocke (pour generateLink), ou null. */
  emailConnexion: string | null
  connexionConfirmee: boolean
  /** Les adresses verified = true de profile_emails, en minuscules. */
  verifiees: string[]
}

export type JetonSupabase =
  | { ok: true; userId: string; tokenHash: string; type: string }
  | { ok: false; erreur: string }

export type PortsOuverture = {
  secret: string
  /** Pose ouvert_le si le lien est envoye, non ouvert et non expire (horloge de la base). Atomique. */
  consommer(lienHmac: string): Promise<Consommation>
  compte(userId: string): Promise<CompteOuverture | null>
  /** auth.admin.generateLink({ type: 'recovery', email }) : ne cree jamais de compte. */
  genererJeton(emailConnexion: string): Promise<JetonSupabase>
  journal(ligne: string): void
  codeErreur(err: unknown): string
}

const MESSAGES_OUVERTURE: Record<string, string> = {
  lien: "Ce lien n'est pas lisible. Copiez-le en entier, ou demandez-en un nouveau.",
  inconnu: "Ce lien n'est pas valable. Demandez-en un nouveau.",
  expire: `Ce lien a expiré : il marche ${LIEN_VALIDITE_MINUTES} minutes. Demandez-en un nouveau.`,
  utilise: "Ce lien a déjà servi : il ne marche qu'une fois. Demandez-en un nouveau.",
  refuse: "Ce lien n'ouvre plus le cockpit pour cette adresse.",
  generation: "La connexion n'a pas pu être préparée. Demandez un nouveau lien dans un moment.",
  indisponible: "Le serveur ne répond pas pour l'instant. Réessayez dans un moment.",
}

const refusOuverture = (erreur: keyof typeof MESSAGES_OUVERTURE, status: number): Reponse =>
  ({ status, corps: { ok: false, erreur, message: MESSAGES_OUVERTURE[erreur] } })

/**
 * Consomme le jeton, relit le compte, puis genere le jeton Supabase. Le jeton
 * du lien est consomme AVANT la generation : deux clics ne generent pas deux
 * jetons, et un echec apres coup demande un nouveau lien.
 */
export async function ouvrirLien(brut: unknown, p: PortsOuverture): Promise<Reponse> {
  const jeton = lireJeton(brut)
  if (!jeton) return refusOuverture('lien', 400)
  const lienHmac = hmacLien(p.secret, jeton)
  const qui = `lien=${ref(lienHmac)}`

  let c: Consommation
  let compte: CompteOuverture | null
  try {
    c = await p.consommer(lienHmac)
    if (c.etat !== 'ok') {
      p.journal(`ouverture ${qui} : ${c.etat}`)
      return c.etat === 'inconnu' ? refusOuverture('inconnu', 404) : refusOuverture(c.etat, 410)
    }
    compte = await p.compte(c.userId)
  } catch (err) {
    p.journal(`ouverture ${qui} : base ${p.codeErreur(err)}`)
    return refusOuverture('indisponible', 503)
  }
  const cid = c.userId.slice(0, 8)

  // Toujours dans l'allowlist, et l'adresse tapee toujours prouvee sur ce compte.
  const prouvees = [
    ...(compte?.emailConnexion && compte.connexionConfirmee ? [compte.emailConnexion.trim().toLowerCase()] : []),
    ...(compte?.verifiees ?? []),
  ]
  const adresseOk = prouvees.some(a => memeHmac(hmacAdresse(p.secret, a), c.emailHmac))
  if (!compte || !compte.autorise || !compte.emailConnexion || !adresseOk) {
    p.journal(`ouverture ${qui} compte=${cid} : refuse (${!compte ? 'compte absent' : !compte.autorise ? 'hors allowlist' : 'adresse plus verifiee'})`)
    return refusOuverture('refuse', 403)
  }

  let j: JetonSupabase
  try {
    j = await p.genererJeton(compte.emailConnexion)
  } catch (err) {
    j = { ok: false, erreur: p.codeErreur(err) }
  }
  if (!j.ok) {
    p.journal(`ouverture ${qui} compte=${cid} : generation impossible (${j.erreur})`)
    return refusOuverture('generation', 502)
  }
  if (j.userId.toLowerCase() !== c.userId.toLowerCase() || j.type !== TYPE_JETON_SUPABASE || !j.tokenHash) {
    // Ne doit jamais arriver : le jeton viserait un autre compte. On ne le rend pas.
    p.journal(`ouverture ${qui} compte=${cid} : jeton REFUSE (compte ${j.userId.slice(0, 8)}, type ${j.type})`)
    return refusOuverture('generation', 502)
  }
  p.journal(`ouverture ${qui} compte=${cid} : jeton rendu`)
  return { status: 200, corps: { ok: true, token_hash: j.tokenHash, type: TYPE_JETON_SUPABASE } }
}
