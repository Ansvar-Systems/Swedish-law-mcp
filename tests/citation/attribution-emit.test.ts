/**
 * Attribution emit (Gate 13) — verifies every customer-visible item carries
 * the source-attribution triple {source_url, publisher, license} per the
 * Source Attribution Airtight spec (2026-05-02).
 *
 * The gateway's `check_item_attribution` filter drops items missing any of
 * these fields, so this test is the unit-level guard against regression.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Database } from '@ansvar/mcp-sqlite';
import { getProvision } from '../../src/tools/get-provision.js';
import { searchLegislation } from '../../src/tools/search-legislation.js';
import { createTestDatabase, closeTestDatabase } from '../fixtures/test-db.js';

// Manifest contract — keep in sync with backstage/catalog/fleet-manifests/swedish-law.json
const EXPECTED_PUBLISHER = 'riksdagen.se';
const EXPECTED_LICENSE = 'Public-Domain';
const SOURCE_URL_PATTERN = /^https?:\/\/(?:www\.|data\.)?riksdagen\.se\/.+/;

describe('attribution emit — get_provision', () => {
  let db: Database;
  beforeAll(() => { db = createTestDatabase(); });
  afterAll(() => { closeTestDatabase(db); });

  it('emits _citation with publisher, license, and matching source_url', async () => {
    const response = await getProvision(db, {
      document_id: '2018:218',
      provision_ref: '1:1',
    });

    expect(response._citation).toBeDefined();
    expect(response._citation!.publisher).toBe(EXPECTED_PUBLISHER);
    expect(response._citation!.license).toBe(EXPECTED_LICENSE);
    expect(response._citation!.source_url).toMatch(SOURCE_URL_PATTERN);
  });

  it('emits a fallback source_url when document.url is null', async () => {
    // 1998:204 (PUL) has url=null in the test fixture — common in production too
    const response = await getProvision(db, {
      document_id: '1998:204',
      provision_ref: '5 a',
    });

    expect(response._citation).toBeDefined();
    expect(response._citation!.publisher).toBe(EXPECTED_PUBLISHER);
    expect(response._citation!.license).toBe(EXPECTED_LICENSE);
    // Fallback must still be a valid riksdagen.se URL pinning the SFS number
    expect(response._citation!.source_url).toMatch(SOURCE_URL_PATTERN);
    expect(response._citation!.source_url).toContain('1998-204');
  });
});

describe('attribution emit — search_legislation (per-item)', () => {
  let db: Database;
  beforeAll(() => { db = createTestDatabase(); });
  afterAll(() => { closeTestDatabase(db); });

  it('emits _citation on every result item', async () => {
    const response = await searchLegislation(db, { query: 'personuppgifter' });

    expect(response.results.length).toBeGreaterThan(0);
    for (const item of response.results) {
      expect(item._citation).toBeDefined();
      expect(item._citation!.publisher).toBe(EXPECTED_PUBLISHER);
      expect(item._citation!.license).toBe(EXPECTED_LICENSE);
      expect(item._citation!.source_url).toMatch(SOURCE_URL_PATTERN);
    }
  });

  it('per-item _citation references the originating document', async () => {
    const response = await searchLegislation(db, {
      query: 'personuppgifter',
      document_id: '2018:218',
    });

    expect(response.results.length).toBeGreaterThan(0);
    for (const item of response.results) {
      // canonical_ref should encode SFS 2018:218 for items from that document
      expect(item._citation!.canonical_ref).toBe('SFS 2018:218');
      expect(item._citation!.lookup.tool).toBe('get_provision');
      expect(item._citation!.lookup.args.document_id).toBe('2018:218');
    }
  });
});
