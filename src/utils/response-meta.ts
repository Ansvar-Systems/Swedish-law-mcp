/**
 * Response envelope metadata (`_meta`) for the MCP reliability contract.
 *
 * The watchdog (scripts/mcp-watchdog.sh) and gateway parse `_meta` as the
 * canonical envelope key. This helper is the sole sanctioned way to build it
 * — same pattern as `buildCitation()` in citation-universal.ts.
 *
 * Contract (see Golden Standard §4.9b and mcp-watchdog.sh:394-422):
 *   - `disclaimer` — non-empty string
 *   - `data_age`   — ISO 8601 date-time (leading YYYY-MM-DD enforced)
 *   - `source_url` — required when the MCP manifest asserts `meta_source_url`
 *
 * Note: historical law MCPs emitted `_metadata` (with `freshness` instead of
 * `data_age`) via `generateResponseMetadata()`. That shape is deprecated; the
 * watchdog accepts `_metadata` as a compat fallback during transition but
 * new code MUST emit `_meta` via this helper.
 *
 * See: docs/plans/2026-04-07-deterministic-citation-pipeline-design.md §Metadata naming standardization
 */

export interface MetaEnvelope {
  disclaimer: string;
  data_age: string;
  source_url?: string;
  source_authority?: string;
  data_source?: string;
  jurisdiction?: string;
  copyright?: string;
}

export interface MetaOptions {
  disclaimer: string;
  dataAge: string;
  sourceUrl?: string | null;
  sourceAuthority?: string | null;
  dataSource?: string | null;
  jurisdiction?: string | null;
  copyright?: string | null;
}

/**
 * Build the `_meta` envelope from explicit values. Pure function — use when
 * the caller already has `data_age` (e.g., from a cached manifest, env var,
 * or upstream API).
 */
export function buildMeta(opts: MetaOptions): MetaEnvelope {
  if (!opts.disclaimer || opts.disclaimer.trim() === '') {
    throw new Error('buildMeta: disclaimer is required and must be non-empty');
  }
  if (!opts.dataAge || !/^\d{4}-\d{2}-\d{2}/.test(opts.dataAge)) {
    throw new Error(
      `buildMeta: dataAge must be ISO 8601 (YYYY-MM-DD...), got: ${opts.dataAge}`,
    );
  }
  const envelope: MetaEnvelope = {
    disclaimer: opts.disclaimer,
    data_age: opts.dataAge,
  };
  if (opts.sourceUrl) envelope.source_url = opts.sourceUrl;
  if (opts.sourceAuthority) envelope.source_authority = opts.sourceAuthority;
  if (opts.dataSource) envelope.data_source = opts.dataSource;
  if (opts.jurisdiction) envelope.jurisdiction = opts.jurisdiction;
  if (opts.copyright) envelope.copyright = opts.copyright;
  return envelope;
}

/**
 * Minimal duck-typed DB interface — matches better-sqlite3 and
 * @ansvar/mcp-sqlite without importing either.
 */
interface MetaReadableDb {
  prepare(sql: string): { get(): unknown };
}

export interface MetaFromDbOptions {
  disclaimer: string;
  sourceUrl?: string | null;
  sourceAuthority?: string | null;
  dataSource?: string | null;
  jurisdiction?: string | null;
  copyright?: string | null;
  fallbackDataAge?: string;
}

/**
 * Build the `_meta` envelope from a SQLite `db_metadata` table, falling back
 * to `fallbackDataAge` (or today) if the table or `built_at` row is absent.
 * The `db_metadata` table is the scaffold convention (see http-server.ts:124).
 */
export function buildMetaFromDb(
  db: MetaReadableDb,
  opts: MetaFromDbOptions,
): MetaEnvelope {
  let dataAge = opts.fallbackDataAge || new Date().toISOString().slice(0, 10);
  try {
    const row = db
      .prepare("SELECT value FROM db_metadata WHERE key = 'built_at'")
      .get() as { value: string } | undefined;
    if (row && row.value) dataAge = row.value;
  } catch {
    /* db_metadata table absent — fall back to default */
  }
  return buildMeta({
    disclaimer: opts.disclaimer,
    dataAge,
    sourceUrl: opts.sourceUrl,
    sourceAuthority: opts.sourceAuthority,
    dataSource: opts.dataSource,
    jurisdiction: opts.jurisdiction,
    copyright: opts.copyright,
  });
}
