/**
 * Format a Swedish provision reference as a display label.
 *
 * Swedish statute convention: "N kap. M §" when a chapter is present,
 * "M §" when the statute is not chapter-divided. Used as a caller-safe
 * fallback when legal_provisions.title is null — which, empirically, is
 * ~94% of the corpus (seed scan 2026-04-22: 3,691 of 59,888 provisions
 * carry a source-provided rubrik). Returning a computed ref as "title"
 * would be inventing data; surfacing display_ref as a separate field
 * keeps `title` honest.
 *
 * The helper trims whitespace and collapses empty strings to null so
 * trailing "kap. §" artefacts can't slip through when the DB stores
 * "" instead of NULL.
 */
export function buildDisplayRef(chapter: string | null | undefined, section: string): string {
  const sec = (section ?? '').trim();
  const chap = (chapter ?? '').trim();
  if (chap && sec) return `${chap} kap. ${sec} §`;
  return `${sec} §`;
}
