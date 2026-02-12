# Historical Version Ingestion Effort Estimate

## Current State

### Database Statistics
- **Total statutes ingested**: 81
- **Total provisions**: ~16,000
- **Total provision versions**: 16,980 (already in database!)
- **Provisions with amendment citations**: ~1,500-2,000 (estimated)
- **Average versions per statute**: ~210 versions

### Version Data Quality
The database already has `legal_provision_versions` table populated with historical data:
- ✅ All 81 statutes have version records
- ✅ Largest statute: 1,672 versions (2010:110 - Communications Act)
- ✅ Second largest: 1,487 versions (1999:1229 - Income Tax Act)
- ⚠️ Most version records have `valid_to = NULL` (needs backfill)
- ⚠️ No explicit amendment tracking (no link to amending SFS number)

## Amendment Patterns Analysis

### Sample Statutes with Known Amendments

| Statute | SFS | Short Name | Provisions | Amendments Observed |
|---------|-----|------------|------------|---------------------|
| Dataskyddslagen | 2018:218 | DSL | 81 | 6 (2018:1248, 2018:2002, 2021:1174, 2022:444, 2025:187, 2025:256) |
| Brottsbalken | 1962:700 | BrB | 489 | 100+ (heavily amended since 1962) |
| OSL | 2009:400 | OSL | 598 | 50+ amendments |
| Communications Act | 2010:110 | - | 1,672 versions | Heavily amended (telecom sector) |

### Amendment Frequency

Based on observed data:
- **Old statutes** (1960s-1980s): 5-20 amendments
- **Modern statutes** (2000s-2020s): 2-10 amendments
- **High-change sectors**: Technology, finance, criminal law (20-100+ amendments)
- **Low-change sectors**: Contract law, property law (1-5 amendments)

**Average**: ~10 amendments per statute × 81 statutes = **~810 amendments total**

## Riksdagen API Coverage

### Historical Text Availability

**Riksdagen provides CONSOLIDATED text only** - the API returns the current version with amendment citations appended. Historical text is NOT directly available.

To reconstruct historical versions, we must:
1. Fetch **original statute** (SFS YYYY:NNN)
2. Fetch **each amending statute** (SFS YYYY:MMM)
3. Parse amendment sections: "1 kap. 3 § ska ha följande lydelse"
4. Apply changes chronologically to build version chain

### API Limitations

**Tested queries:**
```bash
# Original statute
curl "https://data.riksdagen.se/dokumentlista/?sok=2018:218&doktyp=sfs"
# Returns: 1 document (consolidated current text)

# Amendments to 2018:218
curl "https://data.riksdagen.se/dokumentlista/?sok=ändringar+i+2018:218&doktyp=sfs"
# Returns: 0 documents (no direct amendment search)
```

**Blocker**: Riksdagen API does not provide:
- Direct search for "all amendments to statute X"
- Historical snapshots of statute text
- Amendment metadata linking

**Workaround**: Parse amendment citations from consolidated text, then fetch each amending SFS individually.

## Ingestion Effort Breakdown

### Phase 1: Enhanced Metadata (Feasible Now)
**Effort**: 2-4 hours development + 1 hour ingestion

Tasks:
1. Run amendment parser on existing 81 statutes
2. Extract `Lag (YYYY:NNN)` citations from provision text
3. Populate `statute_amendments` table with citations
4. Backfill `valid_to` dates in `legal_provision_versions`

**Output**:
- ~1,500 amendment records created
- Amendment chain queries enabled
- No new text fetching required (use existing data)

**Status**: **READY TO IMPLEMENT** - all necessary data already in database

### Phase 2: Fetch Amending Statutes (Moderate Effort)
**Effort**: 4-8 hours development + 4-8 hours ingestion

Tasks:
1. Extract unique amending SFS numbers from Phase 1 (~200-400 unique SFS)
2. Fetch each amending statute from Riksdagen API
3. Parse "Ändringar i [statute]" sections
4. Store amending statute text in database

**Challenges**:
- Rate limiting: 0.5s per request × 400 SFS = ~3-4 minutes
- Parsing complexity: Swedish legal language NLP
- Ambiguous references: "ska ha följande lydelse" interpretation

**Output**:
- Amending statute documents stored
- Foundation for text reconstruction

### Phase 3: Historical Text Reconstruction (High Effort)
**Effort**: 20-40 hours development + testing

Tasks:
1. Build amendment application engine
2. Parse amendment sections to extract:
   - Target provision reference
   - Change type (replace/insert/delete)
   - New text content
3. Apply amendments chronologically:
   - Start with original statute text
   - For each amendment date, apply changes
   - Generate version snapshot
4. Validate reconstructed text against known current version

**Challenges**:
- **Complex Swedish legal syntax**:
  - "5 § ska ha följande lydelse:" (replace entire section)
  - "I 5 § andra stycket" (replace specific paragraph)
  - "5 a § införs" (insert new section between 5 and 6)
  - "5 § upphävs" (delete section)
- **Ambiguous references**:
  - "I 3 kap." (affects all of chapter 3?)
  - Cross-references to other statutes
- **Edge cases**:
  - Retroactive amendments
  - Conditional effectiveness
  - Transitional rules

**Output**:
- Complete historical text for all provisions
- Accurate version records with content

**Status**: **FEASIBLE BUT REQUIRES ADVANCED NLP** - Swedish legal text parsing is non-trivial

### Phase 4: Full Historical Corpus (Very High Effort)
**Effort**: 40-80 hours development + weeks of processing

Scope expansion to cover:
- All ~300-500 Swedish statutes (not just 81 currently ingested)
- Pre-digital era statutes (1900-1990s)
- Historical case law versions
- Legislative history (draft versions from propositions)

**Blockers**:
- Many old statutes lack digital original text
- Riksdagen coverage starts ~1990s for full text
- Would require alternative sources (National Library archives, physical SFS)

**Status**: **NOT RECOMMENDED** - diminishing returns, data availability issues

## Alternative Data Sources

### 1. Lagrummet.se (Government Legal Database)
- **URL**: https://lagrummet.se
- **Coverage**: All Swedish statutes, some historical versions
- **API**: None (would require scraping)
- **License**: Government data (likely OK for non-commercial)
- **Effort**: High (scraping + parsing)
- **Recommendation**: **Fallback option** if Riksdagen insufficient

### 2. Lagen.nu (Third-Party Legal Database)
- **URL**: https://lagen.nu
- **Coverage**: Statutes + case law (CC-BY licensed)
- **API**: RDF/linked data available
- **Versioning**: Limited historical data
- **Recommendation**: **Not suitable** for historical versions (focuses on current)

### 3. SFS Print Archive (National Library)
- **Source**: Physical/PDF copies of original SFS publications
- **Coverage**: Complete (1824-present)
- **Format**: PDF/print
- **Effort**: Very high (OCR, manual digitization)
- **Recommendation**: **Not feasible** for automated ingestion

### 4. Reconstructive Approach (Recommended)
Work backwards from consolidated text:
1. Parse amendment citations from current text
2. Fetch amending statutes
3. Use NLP to extract change descriptions
4. Reconstruct historical snapshots

**Pros**:
- Uses available Riksdagen API data
- No alternative data source needed
- Scalable to full corpus

**Cons**:
- Requires advanced Swedish legal NLP
- May have gaps for complex amendments
- Accuracy depends on parsing quality

## Recommended Implementation Path

### Minimum Viable Product (MVP)
**Timeline**: 1-2 weeks

1. ✅ **Phase 1** (2-4 hours): Amendment citation parsing + metadata
   - Populate `statute_amendments` table
   - Enable amendment chain queries
   - Backfill `valid_to` dates
   - **Deliverable**: `get_amendment_history()` MCP tool

2. ⚠️ **Phase 2** (4-8 hours): Fetch amending statutes
   - Store ~200-400 amending SFS documents
   - Parse "Ändringar i" sections
   - **Deliverable**: Amendment document corpus

3. ⏸️ **Phase 3** (defer): Historical text reconstruction
   - Requires advanced NLP (20-40 hours)
   - Not essential for MVP
   - Can be added incrementally

### Full Implementation
**Timeline**: 2-3 months

- Complete Phases 1-3
- Add automated amendment detection pipeline
- Implement continuous updates (check for new SFS weekly)
- Validate reconstructed text against authoritative sources
- **Deliverable**: Full historical versioning system

## Data Quality & Validation

### Validation Strategy

For reconstructed historical text:
1. **Checksum validation**: Current reconstructed text must match consolidated API text
2. **Amendment count check**: Number of amendments should match citation count
3. **Date consistency**: All amendments must be chronologically ordered
4. **Cross-reference validation**: Amending SFS must exist as statute
5. **Spot checks**: Manual review of 5-10 statutes with known amendment history

### Known Limitations

1. **Pre-1990 statutes**: Limited digital availability
2. **Complex amendments**: May require manual correction
3. **Transitional rules**: Gradual phase-ins are hard to model
4. **Retroactive changes**: Effective date != amendment date

### Transparency Approach

Following MCP server's "verified data only" principle:
- Mark reconstructed versions with `metadata.source = "reconstructed"`
- Provide confidence score for parsing quality
- Link to source amending statute for verification
- Warn users when historical text is uncertain

## Cost-Benefit Analysis

### Option A: Phase 1 Only (Amendment Metadata)
**Effort**: 2-4 hours
**Benefit**:
- Amendment chain queries
- "What amended this provision?" tool
- Statistics on amendment frequency
**Cost**: Minimal
**Recommendation**: ✅ **DO IMMEDIATELY**

### Option B: Phases 1+2 (+ Amending Statute Corpus)
**Effort**: 6-12 hours
**Benefit**:
- Access to amending statute text
- Foundation for future reconstruction
- Richer amendment descriptions
**Cost**: Low
**Recommendation**: ✅ **RECOMMENDED FOR MVP**

### Option C: Phases 1+2+3 (Full Historical Text)
**Effort**: 26-52 hours
**Benefit**:
- Complete time-travel queries
- "Show me DSL as of 2020" tool
- Text diffs between dates
**Cost**: High (NLP complexity)
**Recommendation**: ⚠️ **DEFER TO V2** unless critical user need

## Conclusion

**Current state**: Database already has 16,980 version records! Much of the hard work is done.

**Immediate action**: Phase 1 (amendment citation parsing) should be implemented immediately - it's low effort and high value.

**Strategic recommendation**:
1. Implement Phases 1+2 for MVP (1-2 weeks)
2. Collect user feedback on demand for full historical text
3. Invest in Phase 3 (NLP reconstruction) only if users demonstrate clear need
4. Consider hybrid approach: manual curation for high-priority statutes (DSL, BrB, OSL), automated for rest

**Biggest blocker**: Riksdagen API lacks direct historical text access - reconstruction requires significant NLP investment.

**Best alternative**: Focus on amendment metadata (which provisions changed, when, by what SFS) rather than full historical text reconstruction. This provides 80% of value for 20% of effort.
