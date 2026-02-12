# EU Law Integration Plan

## Overview

This document outlines the implementation roadmap for integrating EU law cross-references into the Swedish Law MCP server, with future integration to `@ansvar/eu-regulations-mcp`.

## Current Status

### Completed (Agent 5)

1. **EU Reference Taxonomy**
   - Surveyed 83 Swedish statutes
   - Identified 406 EU references (164 directives, 242 regulations)
   - Documented 8 reference pattern types
   - Created comprehensive taxonomy document

2. **Database Schema Design**
   - `eu_documents` table for EU directives/regulations metadata
   - `eu_references` table for Swedish → EU cross-references
   - 4 supporting views for common queries
   - Seed data for GDPR, eIDAS, Data Protection Directive

3. **EU Reference Parser**
   - TypeScript parser module (`src/parsers/eu-reference-parser.ts`)
   - Extracts directives and regulations from Swedish legal text
   - Handles 3 community designations (EU, EG, EEG)
   - Parses article references
   - Detects implementation keywords

4. **Extracted Reference Data**
   - 682 total EU references from 49 statutes
   - 227 unique EU documents (89 directives, 138 regulations)
   - Structured JSON seed file ready for import
   - Provision-level reference tracking

5. **MCP Tool Specifications**
   - 5 tool designs for EU cross-reference queries
   - SQL implementation queries
   - Error handling patterns
   - Integration plan with EU regulations MCP

## Implementation Phases

### Phase 1: Database Integration (Week 1-2)

#### Tasks

1. **Create Database Migration**
   ```bash
   npm run migrate:create add-eu-references
   ```

   Migration should:
   - Add `eu_documents` table
   - Add `eu_references` table
   - Add `eu_reference_keywords` table
   - Create indexes
   - Create views
   - Insert seed EU documents (GDPR, eIDAS, etc.)

2. **Import Extracted Reference Data**
   ```bash
   npm run import:eu-references
   ```

   Import script should:
   - Read `data/seed/eu-references.json`
   - Insert EU documents (deduplicate by ID)
   - Insert EU references with provision linking
   - Validate foreign key constraints
   - Report import statistics

3. **Update Database Builder**
   - Modify `scripts/build-db.ts` to include EU tables
   - Add EU reference processing to statute ingestion
   - Update FTS5 indexes if needed

4. **Testing**
   - Unit tests for EU reference queries
   - Integration tests with existing statute data
   - Verify all 682 references imported correctly
   - Test view performance

**Deliverables:**
- Database migration file
- EU reference import script
- Updated database builder
- Test suite for EU references

**Success Criteria:**
- ✅ All 227 EU documents in database
- ✅ All 682 references imported and linked
- ✅ No broken foreign key constraints
- ✅ All views return correct data
- ✅ Query performance < 100ms

---

### Phase 2: MCP Tool Implementation (Week 3-4)

#### Tasks

1. **Implement `get_eu_basis` Tool**
   - Location: `src/tools/get-eu-basis.ts`
   - Query EU documents for a Swedish statute
   - Include article references if requested
   - Return formatted results with metadata
   - Add to MCP tool registry

2. **Implement `get_swedish_implementations` Tool**
   - Location: `src/tools/get-swedish-implementations.ts`
   - Query Swedish statutes implementing EU directive/regulation
   - Filter by primary implementations
   - Filter by in-force status
   - Statistics on implementation coverage

3. **Implement `search_eu_implementations` Tool**
   - Location: `src/tools/search-eu-implementations.ts`
   - Search EU documents by keyword
   - Filter by type, year, community
   - Return Swedish implementation counts

4. **Implement `get_provision_eu_basis` Tool**
   - Location: `src/tools/get-provision-eu-basis.ts`
   - Provision-level EU reference lookup
   - Article citation extraction
   - Context display

5. **Update `build_legal_stance` Tool**
   - Add EU basis section to output
   - Show relevant EU directives/regulations
   - Link to EUR-Lex URLs

**Deliverables:**
- 5 MCP tool implementations
- Tool registration in `src/index.ts`
- TypeScript types for tool inputs/outputs
- Tool integration tests

**Success Criteria:**
- ✅ All 5 tools pass integration tests
- ✅ Tools work with MCP Inspector
- ✅ Response times < 200ms
- ✅ Correct handling of edge cases (no refs, multiple refs)

---

### Phase 3: EU Document Enrichment (Week 5-6)

#### Tasks

1. **EUR-Lex Metadata Fetching**
   - Implement EUR-Lex API client
   - Fetch official titles (English & Swedish)
   - Fetch CELEX numbers
   - Fetch adoption dates and entry-into-force dates
   - Fetch amendment relationships

2. **Short Name Mapping**
   - Create mapping of common EU law abbreviations
   - GDPR → regulation:2016/679
   - eIDAS → regulation:910/2014
   - DAC6 → directive:2018/822
   - MiFID II → directive:2014/65
   - etc.

3. **Update Seed Data**
   - Enrich `eu_documents` with fetched metadata
   - Add common short names
   - Add EUR-Lex URLs
   - Mark repealed directives

4. **Documentation**
   - Document top 50 most-cited EU acts
   - Create EU law glossary
   - Add examples to README

**Deliverables:**
- EUR-Lex API client
- Enriched EU documents seed data
- Short name mapping file
- EU law glossary

**Success Criteria:**
- ✅ All 227 EU documents have titles
- ✅ All have valid CELEX numbers
- ✅ Top 50 have short names assigned
- ✅ EUR-Lex URLs work

---

### Phase 4: Integration with @ansvar/eu-regulations-mcp (Week 7-8)

#### Prerequisites
- `@ansvar/eu-regulations-mcp` server exists and is functional
- Supports CELEX number lookups
- Returns full EU directive/regulation text
- Supports article-level queries

#### Tasks

1. **MCP Client Integration**
   - Add MCP client dependency
   - Configure connection to EU regulations MCP
   - Implement fallback if EU server unavailable

2. **Enhanced Tool: `get_eu_text`**
   - New tool combining Swedish Law + EU Regulations MCP
   - Input: SFS number + provision ref
   - Output: Swedish provision + full EU basis text
   - Side-by-side comparison view

3. **Enhanced Tool: `validate_eu_compliance`**
   - Fetch Swedish implementation
   - Fetch EU requirement (from EU regulations MCP)
   - Compare key terms and requirements
   - Flag potential discrepancies
   - Suggest improvements

4. **Cross-Server Queries**
   - Implement efficient cross-MCP querying
   - Cache EU law text
   - Batch requests where possible

**Deliverables:**
- MCP client integration
- 2 enhanced cross-server tools
- Integration test suite
- Performance benchmarks

**Success Criteria:**
- ✅ Can fetch EU law text via CELEX number
- ✅ Cross-server queries < 500ms
- ✅ Graceful degradation if EU server down
- ✅ Accurate compliance validation (manual spot-check)

---

### Phase 5: Advanced Features (Week 9-10)

#### Tasks

1. **Implementation Timeline Tracking**
   - Track EU directive transposition deadlines
   - Alert when Swedish implementation due
   - Compare Swedish implementation date vs deadline

2. **Amendment Correlation**
   - Link Swedish statute amendments to EU directive amendments
   - Track when Swedish law updated to reflect EU changes
   - Generate amendment reports

3. **Case Law Integration**
   - Link Swedish case law citing both Swedish and EU law
   - CJEU (Court of Justice of the European Union) references
   - Preliminary ruling tracking

4. **Comparative Implementation (Future)**
   - Compare Swedish implementation with other EU member states
   - Identify unique Swedish approaches
   - Highlight gold-plating (going beyond EU requirements)

**Deliverables:**
- Timeline tracking system
- Amendment correlation logic
- Case law EU reference support
- Comparative analysis framework

**Success Criteria:**
- ✅ Deadline alerts work
- ✅ Amendment tracking accurate
- ✅ Case law EU refs extracted

---

## Data Quality & Maintenance

### Ongoing Tasks

1. **Regular EUR-Lex Sync**
   - Weekly check for new EU legislation
   - Update Swedish implementation status
   - Track amendments and repeals

2. **Reference Validation**
   - Quarterly review of top 50 EU references
   - Fix parsing errors
   - Update short names

3. **Coverage Expansion**
   - Add preparatory works EU references (Prop., SOU)
   - Add case law EU references
   - Track Swedish government EU proposals

### Quality Metrics

Track these metrics over time:
- EU documents with complete metadata (target: 100%)
- References with verified CELEX numbers (target: 95%+)
- Primary implementations identified (target: 90%+)
- EUR-Lex URL validity (target: 100%)

---

## Technical Considerations

### Performance

1. **Database Indexes**
   - All EU reference queries use indexes
   - Provision-level lookups may be slow without index on provision_id
   - Consider materialized views for complex statistics

2. **Caching Strategy**
   - EU document metadata: cache 24 hours (rarely changes)
   - EUR-Lex data: cache 7 days
   - Cross-reference counts: cache 1 hour
   - Full EU law text (from EU MCP): cache 30 days

3. **Batch Operations**
   - Support fetching EU basis for multiple statutes at once
   - Batch EUR-Lex metadata fetching
   - Optimize GROUP_CONCAT queries

### Error Handling

1. **Missing EU Documents**
   - Create stub entry with parsed data
   - Flag for manual review
   - Fetch from EUR-Lex asynchronously

2. **Broken EUR-Lex URLs**
   - Fallback to CELEX search
   - Log for manual fixing
   - Don't block tool responses

3. **EU Regulations MCP Unavailable**
   - Return Swedish data with EU IDs only
   - Show warning in response
   - Queue for later retry

### Security & Compliance

1. **Data Sources**
   - EUR-Lex: Public domain, no authentication needed
   - Swedish statute data: Public domain
   - No personal data collected

2. **Rate Limiting**
   - Respect EUR-Lex rate limits (documented in their ToS)
   - Cache aggressively to minimize requests
   - Implement exponential backoff

---

## Testing Strategy

### Unit Tests

- EU reference parser (all pattern types)
- CELEX number generation
- Database query builders
- Tool input validation

### Integration Tests

- Full extraction pipeline (statute → EU refs)
- Database import with constraints
- Cross-reference queries
- Tool end-to-end tests

### Manual Testing

- MCP Inspector tool testing
- Complex multi-reference cases
- Edge cases (old EEG directives, amended regulations)
- Performance testing with large result sets

---

## Documentation

### User Documentation

1. **Tool Usage Guide**
   - Examples for each tool
   - Common use cases
   - Limitations and caveats

2. **EU Law Primer for Developers**
   - Directive vs regulation
   - CELEX numbering system
   - Swedish implementation process
   - Where to find EU law sources

3. **Integration Examples**
   - Combining with existing tools
   - Cross-server queries
   - Building compliance reports

### Developer Documentation

1. **Schema Documentation**
   - ER diagram with EU tables
   - Field descriptions
   - Index strategy

2. **Parser Documentation**
   - Pattern recognition logic
   - Known limitations
   - Adding new patterns

3. **API Integration**
   - EUR-Lex API usage
   - EU Regulations MCP protocol
   - Error handling patterns

---

## Success Metrics

### Quantitative

- **Coverage:** 100% of EU-related Swedish statutes have cross-references
- **Accuracy:** 95%+ of EU references correctly parsed
- **Performance:** <200ms average tool response time
- **Metadata:** 100% of EU documents have titles and CELEX numbers

### Qualitative

- **Usability:** Legal researchers can easily find EU basis for Swedish law
- **Reliability:** Zero-hallucination guarantee maintained (all references verified)
- **Utility:** Cross-border research enabled by EU/Swedish linking
- **Future-proof:** Architecture supports EU Regulations MCP integration

---

## Risks & Mitigations

### Risk 1: Parsing Accuracy

**Risk:** EU reference patterns not captured by regex, causing missed references

**Mitigation:**
- Manual review of top 20 statutes with EU refs
- Iterative parser improvement
- Fallback to manual curation for critical statutes (DSL, OSL, etc.)

### Risk 2: EUR-Lex API Changes

**Risk:** EUR-Lex changes API, breaking metadata fetching

**Mitigation:**
- Version EUR-Lex API client
- Monitor EUR-Lex changelog
- Graceful degradation (use cached data)
- Manual metadata backup

### Risk 3: CELEX Number Ambiguity

**Risk:** Multiple EU acts with similar identifiers

**Mitigation:**
- Always include year and number in ID
- Validate CELEX format strictly
- Cross-reference with EUR-Lex

### Risk 4: EU Regulations MCP Unavailability

**Risk:** Dependency on external MCP server

**Mitigation:**
- Design tools to work standalone
- Enhance functionality when EU MCP available
- Document fallback behavior
- Cache EU law text locally

---

## Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| 1: Database Integration | 2 weeks | Tables, import script, tests |
| 2: MCP Tools | 2 weeks | 5 tools implemented |
| 3: Enrichment | 2 weeks | EUR-Lex metadata, short names |
| 4: EU MCP Integration | 2 weeks | Cross-server tools |
| 5: Advanced Features | 2 weeks | Timelines, amendments, case law |

**Total:** 10 weeks to full EU integration

---

## Next Steps (Immediate)

1. **Review and approve** this integration plan
2. **Prioritize** phases (can do Phase 1-3 without EU Regulations MCP)
3. **Create database migration** for EU tables
4. **Import seed data** from `eu-references.json`
5. **Implement first tool** (`get_eu_basis`) as proof of concept
6. **Test with MCP Inspector** to validate approach

---

## Appendix: Reference Counts by Statute

See `data/eu-references-analysis.json` for full statistics.

Top 10 statutes by EU reference count:
1. Offentlighets- och sekretesslag (2009:400): 33 refs
2. Miljöbalk (1998:808): 32 refs
3. Lag om upphandling inom försörjningssektorn (2016:1146): 25 refs
4. Aktiebolagslag (2005:551): 23 refs
5. Lag om upphandling av koncessioner (2016:1147): 21 refs
6. Årsredovisningslag (1995:1554): 20 refs
7. Lag om offentlig upphandling (2016:1145): 20 refs
8. Lag om åtgärder mot penningtvätt (2017:630): 17 refs
9. Skatteförfarandelag (2011:1244): 17 refs
10. Lag om elektronisk kommunikation (2022:482): 16 refs
