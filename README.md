# Swedish Law MCP

MCP server for Swedish Law — 6,041 statutes from data.riksdagen.se

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-spec--compliant-green.svg)](https://modelcontextprotocol.io)
[![Jurisdiction](https://img.shields.io/badge/Jurisdiction-SE-informational.svg)](#coverage)

## What this is

Self-hostable MCP server providing search and retrieval over Swedish Law — 6,041 statutes and 58,570 provisions, indexed from data.riksdagen.se via the included ingestion script.

Part of the Ansvar MCP fleet — source-available servers published for self-hosting.

## Coverage

- **Corpus:** Swedish Law — 6,041 statutes, 58,570 provisions
- **Jurisdiction code:** `SE`
- **Corpus snapshot:** 2026-02-22

The corpus is rebuilt from the upstream sources by the included ingestion
script; re-run periodically to refresh. See **Sources** below for source URLs,
terms, and reuse conditions.

### Hosted gateway also covers (premium tier only)

The hosted gateway extends this corpus with material that is **not** in the
self-host build — distinct sourcing, different licensing, paid access only:

- **Case law:** 12,767 judgments — lagen.nu full archive. 7 courts (Supreme Court, Labour Court, Courts of Appeal, Supreme Administrative Court, Migration Court, Environmental Court), 1981-2023.
- **Preparatory works:** 6,735 documents
- **Agency guidance:** 84,661 items

Self-hosting from this repo gives you the statutes and provisions only. The
premium materials require a `team` or `company` gateway subscription.

## Two ways to use it

**Self-host (free, Apache 2.0)** — clone this repo, run the ingestion script
to build your local database from the listed upstream sources, point your MCP
client at the local server. Instructions below.

**Trial the hosted gateway (paid pilot, B2B)** — for production use against
the curated, kept-fresh corpus across the full Ansvar MCP fleet at once, with
citation enrichment, multi-jurisdiction fan-out, and audit-ledgered query
logs, see [ansvar.eu](https://ansvar.eu).

## Self-hosting

### Install

```bash
git clone https://github.com/Ansvar-Systems/Swedish-law-mcp.git
cd Swedish-law-mcp
npm install
```

### Build the database

```bash
npm run ingest
```

Ingestion fetches from the upstream source(s) listed under **Sources** below and builds a local SQLite database. Re-run periodically to refresh. Inspect the ingestion script (`scripts/ingest-*.ts` or `scripts/ingest-*.py`) for the actual access method (open API, bulk download, HTML scrape, or feed) and review the source's published terms before running it in a commercial deployment.

### Configure your MCP client

```json
{
  "mcpServers": {
    "swedish-law-mcp": {
      "command": "node",
      "args": ["dist/http-server.js"]
    }
  }
}
```

## Sources

| Source | Source URL | Terms / license URL | License basis | Attribution required | Commercial use | Redistribution / caching | Notes |
|---|---|---|---|---|---|---|---|
| [data.riksdagen.se](https://data.riksdagen.se/) | https://data.riksdagen.se/ | [Terms](https://www.riksdagen.se/sv/dokument-och-lagar/riksdagens-oppna-data/anvandarstod/anvandningsvillkor/) | Public domain (statutes, URL §9 / Swedish Copyright Act §9 excludes laws and decrees) — Riksdag open-data terms permit reuse with source attribution | Yes | Yes | Yes | Swedish statutes, regulations, and parliamentary documents are excluded from copyright under Upphovsrättslagen §9. Riksdag publishes via open API and CSV/JSON bulk downloads under open-data user terms; attribution to data.riksdagen.se / Sveriges riksdag is required. |

## What this repository does not provide

This repository contains only the MCP server code, schema, and ingestion
scripts. It does not include, redistribute, or license the upstream legal
materials.

Running ingestion may download, cache, transform, and index materials from the
listed upstream sources. You are responsible for confirming that your use of
those materials complies with the source terms, attribution requirements,
robots/rate limits, database rights, copyright rules, and any commercial-use
or redistribution limits that apply in your jurisdiction. The license below
covers the code in this repository only — not the legal corpus the ingestion
script downloads.

## License

Apache 2.0 — see [LICENSE](LICENSE). Commercial use, modification, and
redistribution of **the source code in this repository** are permitted under
that license. The license does not extend to upstream legal materials
downloaded by the ingestion script; those remain governed by the source
jurisdictions' own publishing terms (see Sources above).

## The Ansvar gateway

If you'd rather not self-host, [ansvar.eu](https://ansvar.eu) provides this
MCP plus the full Ansvar fleet through a single OAuth-authenticated endpoint,
with the curated production corpus, multi-MCP query orchestration, citation
enrichment, and (on the company tier) a per-tenant cryptographic audit
ledger. Pilot mode, B2B only.
