/**
 * Citation metadata — combines two contracts:
 *
 * 1. Deterministic citation pipeline (canonical_ref / display_text / aliases /
 *    lookup) used by the platform's entity linker.
 * 2. Source Attribution Airtight standard (publisher / license / source_url),
 *    enforced at gateway egress per the spec at
 *    docs/superpowers/specs/2026-05-02-source-attribution-airtight-design.md.
 *
 * The attribution triple is load-bearing: items missing any of the three
 * fields are dropped by `check_item_attribution` at the gateway.
 *
 * See: docs/guides/law-mcp-golden-standard.md Section 4.9c
 */

/**
 * Manifest-aligned attribution constants.
 *
 * MUST match `attribution.publisher` and `attribution.license` in
 * backstage/catalog/fleet-manifests/swedish-law.json — gateway egress
 * compares with strict equality.
 */
export const ATTRIBUTION_PUBLISHER = 'riksdagen.se';
export const ATTRIBUTION_LICENSE = 'Public-Domain';

export interface CitationMetadata {
  canonical_ref: string;
  display_text: string;
  aliases?: string[];
  source_url: string;
  publisher: string;
  license: string;
  lookup: {
    tool: string;
    args: Record<string, string>;
  };
}

/**
 * Resolve the source URL for a Swedish statute, falling back to the canonical
 * Riksdagen URL pattern when the document row has no stored URL. Same pattern
 * as the ingest script's fallback (`scripts/ingest-riksdagen.ts`).
 */
export function resolveRiksdagenSourceUrl(
  documentId: string,
  dbUrl: string | null | undefined,
): string {
  if (dbUrl && dbUrl.trim().length > 0) return dbUrl;
  if (/^\d{4}:\d+$/.test(documentId)) {
    return `https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/sfs-${documentId.replace(':', '-')}`;
  }
  // Non-SFS identifiers (case law, bills) — fall back to the document search.
  return `https://www.riksdagen.se/sv/dokument-och-lagar/?docid=${encodeURIComponent(documentId)}`;
}

/**
 * Build citation metadata for a get_provision response.
 *
 * @param documentId     DB identifier (e.g., "2018:218")
 * @param documentTitle  Human-readable law title (e.g., "Lag med kompletterande bestämmelser...")
 * @param provisionRef   Provision reference (e.g., "34" or "3:12")
 * @param inputDocId     The document_id argument as passed by the caller (e.g., "sfs-2018-218")
 * @param inputSection   The section argument as passed by the caller (e.g., "art-34")
 * @param sourceUrl      Official portal URL for this law (optional — fallback is constructed if missing)
 * @param shortName      Short name / alias (e.g., "DSL") (optional)
 */
export function buildProvisionCitation(
  documentId: string,
  documentTitle: string,
  provisionRef: string,
  inputDocId: string,
  inputSection: string,
  sourceUrl?: string | null,
  shortName?: string | null,
): CitationMetadata {
  const canonicalRef = documentId.match(/^\d{4}:\d+$/)
    ? `SFS ${documentId}`
    : documentTitle;

  const sectionLabel = provisionRef.includes(':')
    ? `${provisionRef.split(':')[0]} kap. ${provisionRef.split(':')[1]} §`
    : `${provisionRef} §`;
  const displayText = `${sectionLabel} ${canonicalRef}`;

  const aliases: string[] = [];
  if (shortName) aliases.push(shortName);
  if (documentId !== canonicalRef) aliases.push(documentId);

  return {
    canonical_ref: canonicalRef,
    display_text: displayText,
    ...(aliases.length > 0 && { aliases }),
    source_url: resolveRiksdagenSourceUrl(documentId, sourceUrl),
    publisher: ATTRIBUTION_PUBLISHER,
    license: ATTRIBUTION_LICENSE,
    lookup: {
      tool: 'get_provision',
      args: { document_id: inputDocId, section: inputSection },
    },
  };
}

/**
 * Build citation metadata for a single search_legislation result item.
 * Search items always carry `_citation` so the gateway egress filter
 * (check_item_attribution) accepts them.
 */
export function buildSearchItemCitation(
  documentId: string,
  documentTitle: string,
  provisionRef: string,
  sourceUrl?: string | null,
  shortName?: string | null,
): CitationMetadata {
  return buildProvisionCitation(
    documentId,
    documentTitle,
    provisionRef,
    documentId,
    provisionRef,
    sourceUrl,
    shortName,
  );
}
