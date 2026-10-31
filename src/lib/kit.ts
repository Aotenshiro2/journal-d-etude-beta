// Le client de l'API Kit v4 cote serveur (31/10/2026) : abonnes, tags,
// changement d'adresse, desinscription. Base https://api.kit.com/v4, en-tete
// X-Kit-Api-Key.
//
// La cle : CONVERTKIT_API_KEY (deja posee sur Vercel, projet journal, pour
// /api/newsletter/subscribe), sinon KIT_API_KEY. Jamais dans le navigateur.
//
// Les erreurs ne portent QUE le statut HTTP et le chemin type (sans adresse) :
// le corps d'une reponse Kit peut citer l'adresse, il n'entre dans aucun log.
//
// Ce fichier n'importe rien et n'a que des types effacables : le verificateur
// (scripts/verifier-kit-abonnements.mjs) l'importe tel quel.

const BASE = 'https://api.kit.com/v4'
const DELAI_MS = 8000

export type AbonneKit = { id: number; email: string; etat: string; prenom: string | null }

export class ErreurKit extends Error {
  statut: number
  constructor(statut: number, quoi: string) {
    super(`kit ${quoi} ${statut}`)
    this.name = 'ErreurKit'
    this.statut = statut
  }
}

/** Ce que les abonnements demandent a Kit. Le verificateur en donne un faux. */
export type ClientKit = {
  abonneParEmail(email: string): Promise<AbonneKit | null>
  abonne(id: number): Promise<AbonneKit | null>
  creerAbonne(email: string, prenom: string | null): Promise<{ abonne: AbonneKit; cree: boolean }>
  /** 'pris' : l'adresse est deja celle d'un autre abonne (422). */
  changerEmail(id: number, email: string): Promise<'ok' | 'pris'>
  tagsDe(id: number): Promise<number[]>
  poserTag(tag: number, id: number): Promise<void>
  retirerTag(tag: number, id: number): Promise<void>
  desinscrire(id: number): Promise<void>
}

export function cleKit(): string | null {
  return process.env.CONVERTKIT_API_KEY?.trim() || process.env.KIT_API_KEY?.trim() || null
}

type Brut = { id?: unknown; email_address?: unknown; state?: unknown; first_name?: unknown }

function abonneDe(b: Brut | null | undefined): AbonneKit | null {
  if (!b || typeof b.id !== 'number' || typeof b.email_address !== 'string') return null
  return {
    id: b.id,
    email: b.email_address,
    etat: typeof b.state === 'string' ? b.state : 'inconnu',
    prenom: typeof b.first_name === 'string' ? b.first_name : null,
  }
}

export function clientKit(cle: string, f: typeof fetch = fetch): ClientKit {
  async function appel(chemin: string, init: RequestInit = {}): Promise<{ statut: number; json: unknown }> {
    const r = await f(BASE + chemin, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Kit-Api-Key': cle },
      signal: AbortSignal.timeout(DELAI_MS),
      cache: 'no-store',
    })
    const texte = await r.text().catch(() => '')
    let json: unknown = null
    try { json = texte ? JSON.parse(texte) : null } catch { json = null }
    return { statut: r.status, json }
  }
  const ok = (s: number) => s >= 200 && s < 300

  return {
    async abonneParEmail(email) {
      const q = new URLSearchParams({ email_address: email, status: 'all' })
      const r = await appel(`/subscribers?${q}`)
      if (!ok(r.statut)) throw new ErreurKit(r.statut, 'recherche')
      const liste = (r.json as { subscribers?: Brut[] } | null)?.subscribers ?? []
      const cible = email.toLowerCase()
      return abonneDe(liste.find(s => typeof s.email_address === 'string' && s.email_address.toLowerCase() === cible))
    },
    async abonne(id) {
      const r = await appel(`/subscribers/${id}`)
      if (r.statut === 404) return null
      if (!ok(r.statut)) throw new ErreurKit(r.statut, 'abonne')
      return abonneDe((r.json as { subscriber?: Brut } | null)?.subscriber)
    },
    async creerAbonne(email, prenom) {
      const r = await appel('/subscribers', {
        method: 'POST',
        body: JSON.stringify({ email_address: email, ...(prenom ? { first_name: prenom } : {}) }),
      })
      if (!ok(r.statut)) throw new ErreurKit(r.statut, 'creation')
      const a = abonneDe((r.json as { subscriber?: Brut } | null)?.subscriber)
      if (!a) throw new ErreurKit(r.statut, 'creation illisible')
      return { abonne: a, cree: r.statut === 201 }
    },
    async changerEmail(id, email) {
      const r = await appel(`/subscribers/${id}`, { method: 'PUT', body: JSON.stringify({ email_address: email }) })
      if (r.statut === 422) return 'pris'
      if (!ok(r.statut)) throw new ErreurKit(r.statut, 'adresse')
      return 'ok'
    },
    async tagsDe(id) {
      const ids: number[] = []
      let apres: string | null = null
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({ per_page: '1000', ...(apres ? { after: apres } : {}) })
        const r = await appel(`/subscribers/${id}/tags?${q}`)
        if (!ok(r.statut)) throw new ErreurKit(r.statut, 'tags')
        const j = r.json as { tags?: { id?: unknown }[]; pagination?: { has_next_page?: boolean; end_cursor?: string } } | null
        for (const t of j?.tags ?? []) if (typeof t.id === 'number') ids.push(t.id)
        if (!j?.pagination?.has_next_page || !j.pagination.end_cursor) break
        apres = j.pagination.end_cursor
      }
      return ids
    },
    async poserTag(tag, id) {
      const r = await appel(`/tags/${tag}/subscribers/${id}`, { method: 'POST', body: '{}' })
      if (!ok(r.statut)) throw new ErreurKit(r.statut, 'tag')
    },
    async retirerTag(tag, id) {
      const r = await appel(`/tags/${tag}/subscribers/${id}`, { method: 'DELETE' })
      // 404 : le tag n'etait pas pose (ou l'abonne a disparu) : rien a retirer.
      if (!ok(r.statut) && r.statut !== 404) throw new ErreurKit(r.statut, 'retrait')
    },
    async desinscrire(id) {
      const r = await appel(`/subscribers/${id}/unsubscribe`, { method: 'POST', body: '{}' })
      if (!ok(r.statut)) throw new ErreurKit(r.statut, 'desinscription')
    },
  }
}
