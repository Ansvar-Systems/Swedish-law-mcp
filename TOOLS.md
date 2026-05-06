# Tools — Swedish Law MCP

18 tools for searching, retrieving, and validating Swedish legislation, case law, preparatory works, and EU cross-references.

For full parameter schemas, call `tools/list` against the running MCP server. The summaries below cover the most common call shapes.

---

## Tier Boundary

This MCP serves a single combined database. Free-tier and premium-tier tools are **separated by capability**, not by separate endpoints. Premium-sensitive tools still respond on the free tier — they emit a `_tier_notice` indicating limited coverage.

**Free tier tools** (full data):

| Tool | Purpose |
|------|---------|
| `search_legislation` | FTS5 search across statutes |
| `get_provision` | Retrieve a specific provision |
| `validate_citation` | Verify a citation exists |
| `format_citation` | Render a citation in full / short / pinpoint form |
| `check_currency` | Check in-force status |
| `get_eu_basis` | Statute-level EU CELEX link |
| `get_provision_eu_basis` | Provision-level EU CELEX link |
| `get_swedish_implementations` | Reverse lookup: EU directive → Swedish implementation |
| `search_eu_implementations` | Search Swedish-implemented EU regulations |
| `validate_eu_compliance` | Reference-validity check (Phase 1 — not substantive) |
| `list_sources` | Data provenance metadata |
| `about` | Server stats, freshness, build date |

**Premium-sensitive tools** (work on free tier but with limited data; full data on premium):

| Tool | Free-tier behaviour | Premium |
|------|---------------------|---------|
| `search_case_law` | Returns rows from a small seeded subset; emits `_tier_notice` | Full lagen.nu archive (12,767+ decisions across HD, HFD, AD, RH, MÖD, MIG, PMÖD) |
| `get_preparatory_works` | Returns linked propositions only | Full Riksdagen archive (6,735+ documents, 6,730 with full text) |
| `build_legal_stance` | Aggregates over the limited free corpus | Aggregates over full premium corpus |

**Premium-only tools** (require premium build):

| Tool | Purpose |
|------|---------|
| `get_provision_history` | Provision version history (amendment-by-amendment) |
| `diff_provision` | Diff two versions of a provision |
| `get_recent_changes` | Recent statute changes with effective dates |

The premium build is delivered as a separate Docker image (`swedish-law-mcp-premium`); local stdio runs ship the free build. Set `PREMIUM_ENABLED=true` and use the premium DB to lift tier gates.

---

## Search & Retrieval

### 1. `search_legislation`

Full-text search across Swedish statutes and regulations. FTS5 with BM25 ranking.

**Parameters:** `query` (string, required), `document_id` (SFS pattern), `status` (`in_force` / `amended` / `repealed`), `as_of_date` (`YYYY-MM-DD`), `limit` (1–50, default 10).

**Returns:** Matching provisions with document context, snippets, relevance scores.

### 2. `get_provision`

Retrieve a specific provision from a statute.

**Parameters:** `document_id` (required — SFS number `2018:218` or name `dataskyddslagen`), `chapter`, `section`, `provision_ref` (canonical `3:5` or Swedish `3 kap. 5 §`), `as_of_date`.

**Returns:** Full provision text with document metadata.

### 3. `search_case_law` *(premium-sensitive)*

Search Swedish court decisions (rättsfall). FTS5 with BM25 ranking.

**Parameters:** `query` (required), `court` (`HD` / `HFD` / `AD` / `RH` / `MÖD` / `MIG` / `PMÖD`), `date_from`, `date_to`, `limit` (default 10, max 50).

**Returns:** Case summaries with court, date, keywords, citation. Source: lagen.nu (CC-BY 4.0, attributed to Domstolsverket).

### 4. `get_preparatory_works` *(premium-sensitive)*

Get preparatory works (förarbeten) for a statute.

**Parameters:** `document_id` (required).

**Returns:** Linked propositioner, SOUs, Ds documents.

---

## Citation Tools

### 5. `validate_citation`

Verify a citation exists in the database (zero-hallucination check).

**Parameters:** `citation` (required).

**Returns:** Existence flag, document metadata, warnings.

### 6. `format_citation`

Format a citation per Swedish conventions.

**Parameters:** `citation` (required), `format` (`full` / `short` / `pinpoint`).

**Returns:** Formatted citation string.

### 7. `check_currency`

Check whether a statute or provision is currently in force.

**Parameters:** `document_id` (required), `provision_ref`.

**Returns:** Status, effective dates, warnings.

### 8. `build_legal_stance` *(premium-sensitive)*

Build a comprehensive set of citations for a legal question across statutes, case law, and preparatory works.

**Parameters:** `query` (required), `limit` (per category, default 5).

**Returns:** Aggregated provisions, cases, and prep works.

---

## EU Cross-References

### 9. `get_eu_basis`

Get the EU legal basis for a Swedish statute (statute-level CELEX link).

**Parameters:** `sfs_number` (required, e.g. `2018:218`).

**Returns:** Linked EU directive(s) / regulation(s).

### 10. `get_provision_eu_basis`

Get the EU legal basis for a specific provision (more granular than `get_eu_basis`).

**Parameters:** `sfs_number`, `provision_ref`.

### 11. `get_swedish_implementations`

Reverse lookup: find Swedish statutes implementing a given EU directive or regulation.

**Parameters:** `celex` or `eu_document_id`.

### 12. `search_eu_implementations`

Search EU directives/regulations with their Swedish implementation status.

**Parameters:** `query`, optional filters.

### 13. `validate_eu_compliance`

Phase-1 EU compliance check: reference validity (does the cited Swedish statute correctly link to the EU instrument it claims to implement). Does **not** assess substantive compliance.

**Parameters:** `sfs_number`, optional `provision_ref`.

---

## Versioning *(premium-only)*

### 14. `get_provision_history`

Provision version history showing amendments over time.

**Parameters:** `document_id`, `provision_ref`.

### 15. `diff_provision`

Diff two versions of a provision.

**Parameters:** `document_id`, `provision_ref`, `version_a`, `version_b`.

### 16. `get_recent_changes`

List recent statute changes within a time window.

**Parameters:** `since` (`YYYY-MM-DD`), `limit`.

---

## Server Metadata

### 17. `list_sources`

List all data sources with provenance metadata.

**Returns:** Per-source authority, URL, retrieval method, license, coverage scope, last-ingested date.

### 18. `about`

Server stats, freshness, build date, dataset summary.

**Returns:** Document/provision counts, build date, schema version, premium-enabled flag.
