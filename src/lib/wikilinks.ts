// 0.1.4 — Syntaxe [[concept]] (lot 2 de SPEC-second-cerveau.md).
// Un [[nom]] dans un bloc relie le bloc au concept (MessageTag) : la donnée
// de connexion naît au moment de l'écriture, comme dans Logseq/Obsidian.

export const WIKILINK_RE = /\[\[([^\]\n]{1,80})\]\]/g

/** Noms de concepts référencés dans un contenu (uniques, minuscules, trimés). */
export function extractWikilinks(content: string): string[] {
  const names = new Set<string>()
  for (const m of content.matchAll(WIKILINK_RE)) {
    const name = m[1].trim().toLowerCase()
    if (name) names.add(name)
  }
  return [...names]
}

/** Remplace [[nom]] par une pastille cliquable (HTML). Le contenu est déjà du
 *  HTML (dangerouslySetInnerHTML) — on ne touche qu'à la syntaxe [[…]]. */
export function renderWikilinks(html: string): string {
  return html.replace(WIKILINK_RE, (_, name: string) =>
    `<span class="wikilink" title="Concept — voir /concepts">${name.trim()}</span>`
  )
}
