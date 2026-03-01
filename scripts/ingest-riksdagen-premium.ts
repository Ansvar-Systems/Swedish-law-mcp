#!/usr/bin/env tsx
/**
 * Riksdagen Preparatory Works Premium Ingestion Script
 *
 * Fetches full-text preparatory works (propositioner, SOU, Ds) from the
 * Swedish Parliament's open data API (data.riksdagen.se) and populates
 * the premium preparatory_works_full table.
 *
 * Source: https://data.riksdagen.se/dokumentlista/
 *   - API docs: https://data.riksdagen.se/
 *   - Document types: prop (proposition), sou (SOU), ds (Ds)
 *   - Format: JSON with full text available
 *
 * Prerequisites:
 *   1. npm run build:db           -- base database with schema
 *   2. npm run build:db:paid      -- premium tables created
 *   3. npm run sync:prep-works    -- preparatory_works table populated
 *
 * Pipeline:
 *   preparatory_works table -> Riksdagen API (full text) -> preparatory_works_full
 *
 * For NEW propositions not yet in the database, the script also creates entries
 * in legal_documents and preparatory_works before fetching full text.
 *
 * Usage:
 *   npx tsx scripts/ingest-riksdagen-premium.ts [options]
 *
 * Options:
 *   --limit N      Process only first N preparatory works
 *   --resume       Skip works already in preparatory_works_full (default: true)
 *   --dry-run      Show what would be fetched without making changes
 *   --type TYPE    Filter to specific document type: prop, sou, ds (default: all)
 *   --year YYYY    Filter to specific year
 *   --fetch-new    Also discover and fetch new propositions from Riksdagen
 *                  that aren't yet linked to any statute (use with --year)
 *
 * Examples:
 *   npx tsx scripts/ingest-riksdagen-premium.ts --limit 100
 *   npx tsx scripts/ingest-riksdagen-premium.ts --type prop --year 2024
 *   npx tsx scripts/ingest-riksdagen-premium.ts --dry-run
 *   npx tsx scripts/ingest-riksdagen-premium.ts --fetch-new --year 2024 --limit 50
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DB_PATH = path.resolve(__dirname, '../data/database.db');
const LOG_DIR = path.resolve(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'ingest-riksdagen-premium.log');

const RIKSDAGEN_LIST_URL = 'https://data.riksdagen.se/dokumentlista/';
const RIKSDAGEN_DOC_URL = 'https://data.riksdagen.se/dokument';
const REQUEST_DELAY_MS = 600;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'Swedish-Law-MCP/1.2.0 (https://github.com/Ansvar-Systems/swedish-law-mcp; premium-ingestion)';

// Maximum text length to store per document (prevent extreme outliers)
const MAX_TEXT_LENGTH = 2_000_000;  // ~2 MB

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PrepWorkRow {
  id: number;
  statute_id: string;
  prep_document_id: string;
  title: string | null;
  summary: string | null;
}

interface RiksdagenDocument {
  dok_id: string;
  rm: string;             // Riksmote (session), e.g., "2023/24"
  beteckning: string;     // e.g., "105"
  typ: string;            // e.g., "prop"
  doktyp: string;         // Document type
  titel: string;
  undertitel?: string;
  subtitel?: string;
  datum: string;          // Date
  publicerad?: string;
  html_url?: string;
  text?: string;          // Full text
  html?: string;          // HTML content
  summary?: string;
}

interface RiksdagenListResponse {
  dokumentlista?: {
    '@antal': string;
    '@sida': string;
    '@sidor': string;
    dokument?: RiksdagenDocument[];
  };
}

interface RiksdagenDocResponse {
  dokumentstatus?: {
    dokument?: RiksdagenDocument;
  };
}

interface SectionSummary {
  heading: string;
  summary: string;
}

interface IngestionStats {
  total_candidates: number;
  already_enriched: number;
  fetched: number;
  enriched: number;
  failed: number;
  skipped_no_text: number;
  new_documents_created: number;
}

interface CliOptions {
  limit?: number;
  resume: boolean;
  dryRun: boolean;
  type?: string;
  year?: number;
  fetchNew: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, logMessage);
}

function logError(message: string, error?: Error): void {
  const timestamp = new Date().toISOString();
  const errorDetails = error ? `\n  Error: ${error.message}` : '';
  const logMessage = `[${timestamp}] ERROR: ${message}${errorDetails}\n`;
  console.error(logMessage.trim());
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, logMessage);
}

// ─────────────────────────────────────────────────────────────────────────────
// Network utilities
// ─────────────────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(url: string, retries = MAX_RETRIES): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1);
        await delay(backoff);
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        throw new Error('HTTP 404: NOT FOUND');
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error as Error;

      if (lastError.message.includes('404')) {
        throw lastError;
      }

      if (attempt < retries - 1) {
        log(`  Retry ${attempt + 1}/${retries - 1} for ${url}`);
      }
    }
  }

  throw lastError || new Error('Unknown error');
}

// ─────────────────────────────────────────────────────────────────────────────
// Document ID mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine Riksdagen document type from prep_document_id.
 *
 * Formats:
 *   "2017/18:105"  -> prop (proposition)
 *   "2017:39"      -> sou or ds (needs API check)
 */
function classifyDocumentId(prepDocId: string): 'prop' | 'sou' | 'ds' | 'unknown' {
  if (prepDocId.includes('/')) {
    return 'prop';  // Proposition format: 2017/18:105
  }
  if (/^\d{4}:\d+$/.test(prepDocId)) {
    return 'sou';   // Default to SOU; script tries SOU first, then Ds
  }
  return 'unknown';
}

/**
 * Build Riksdagen API search URL for a document.
 */
function buildSearchUrl(prepDocId: string, docType: string): string {
  return `${RIKSDAGEN_LIST_URL}?sok=${encodeURIComponent(prepDocId)}&doktyp=${docType}&format=json&utformat=json`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Text processing
// ─────────────────────────────────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Strip HTML tags from text while preserving readability.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract section summaries from preparatory work text.
 * Swedish propositions typically have numbered sections (1. Inledning, 2. Bakgrund, etc.)
 */
function extractSectionSummaries(text: string): string | null {
  const sections: SectionSummary[] = [];

  // Match numbered section headings
  const sectionPattern = /(?:^|\n)(\d+(?:\.\d+)*)\s+([A-ZÅÄÖ][^\n]{3,80})\n/g;
  const matches = Array.from(text.matchAll(sectionPattern));

  for (let i = 0; i < matches.length && i < 50; i++) {
    const match = matches[i];
    const heading = `${match[1]} ${match[2].trim()}`;

    // Get first 200 chars of section content as summary
    const startIdx = (match.index || 0) + match[0].length;
    const endIdx = i + 1 < matches.length
      ? (matches[i + 1].index || text.length)
      : Math.min(startIdx + 500, text.length);

    const content = text.substring(startIdx, endIdx).trim();
    const summary = content.length > 200
      ? content.substring(0, 197) + '...'
      : content;

    if (summary.length > 10) {
      sections.push({ heading, summary: normalizeWhitespace(summary) });
    }
  }

  if (sections.length === 0) {
    return null;
  }

  return JSON.stringify(sections);
}

// ─────────────────────────────────────────────────────────────────────────────
// Riksdagen API fetching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch full text for a preparatory work document from Riksdagen.
 * Returns the text content and metadata, or null if not found.
 */
async function fetchFullText(
  prepDocId: string,
): Promise<{ text: string; title: string; summary: string | null } | null> {
  const docType = classifyDocumentId(prepDocId);

  if (docType === 'unknown') {
    return null;
  }

  // Search for the document
  let typesToTry: string[];
  if (docType === 'prop') {
    typesToTry = ['prop'];
  } else {
    typesToTry = ['sou', 'ds'];  // Try SOU first, then Ds
  }

  for (const tryType of typesToTry) {
    try {
      const searchUrl = buildSearchUrl(prepDocId, tryType);
      const listData = await fetchJsonWithRetry(searchUrl) as RiksdagenListResponse;
      const documents = listData?.dokumentlista?.dokument ?? [];

      if (documents.length === 0) {
        continue;
      }

      // Find the best match
      const doc = documents[0];

      // Fetch full document with text
      await delay(REQUEST_DELAY_MS);
      const docUrl = `${RIKSDAGEN_DOC_URL}/${doc.dok_id}.json`;
      const docData = await fetchJsonWithRetry(docUrl) as RiksdagenDocResponse;
      const fullDoc = docData?.dokumentstatus?.dokument;

      if (!fullDoc) {
        continue;
      }

      // Extract text content (prefer plain text, fall back to HTML stripping)
      let text = fullDoc.text || '';
      if (!text && fullDoc.html) {
        text = stripHtml(fullDoc.html);
      }

      if (text.length < 50) {
        continue;
      }

      // Truncate extreme outliers
      if (text.length > MAX_TEXT_LENGTH) {
        text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Text truncated at 2 MB]';
      }

      // Build title
      let title: string;
      if (tryType === 'prop') {
        title = `Proposition ${prepDocId}`;
      } else if (tryType === 'sou') {
        title = `SOU ${prepDocId}`;
      } else {
        title = `Ds ${prepDocId}`;
      }
      if (fullDoc.titel) {
        title += `: ${normalizeWhitespace(fullDoc.titel)}`;
      }

      const summary = fullDoc.undertitel
        ? normalizeWhitespace(fullDoc.undertitel)
        : null;

      return { text, title, summary };
    } catch (error) {
      const err = error as Error;
      if (!err.message.includes('404')) {
        throw error;
      }
      // 404 means try next type
    }
  }

  return null;
}

/**
 * Discover new propositions from Riksdagen for a given year.
 * Returns documents not already in the database.
 */
async function discoverNewPropositions(
  db: Database.Database,
  year: number,
  docType: string,
  limit: number,
): Promise<RiksdagenDocument[]> {
  const discovered: RiksdagenDocument[] = [];
  let page = 1;
  const maxPages = 10;

  // Get existing prep document IDs
  const existingIds = new Set<string>(
    (db.prepare('SELECT id FROM legal_documents WHERE type IN (?, ?, ?)').all('bill', 'sou', 'ds') as any[])
      .map(r => r.id)
  );

  while (page <= maxPages && discovered.length < limit) {
    const rm = docType === 'prop' ? `${year}/${String(year + 1).slice(-2)}` : String(year);
    const url = `${RIKSDAGEN_LIST_URL}?doktyp=${docType}&rm=${encodeURIComponent(rm)}&format=json&utformat=json&p=${page}`;

    try {
      const listData = await fetchJsonWithRetry(url) as RiksdagenListResponse;
      const documents = listData?.dokumentlista?.dokument ?? [];

      if (documents.length === 0) {
        break;
      }

      for (const doc of documents) {
        // Build the prep_document_id
        let prepId: string;
        if (docType === 'prop') {
          prepId = `${doc.rm}:${doc.beteckning}`;
        } else {
          prepId = `${year}:${doc.beteckning}`;
        }

        if (!existingIds.has(prepId)) {
          discovered.push({ ...doc, dok_id: doc.dok_id });
          existingIds.add(prepId);  // Prevent duplicates in same run
        }

        if (discovered.length >= limit) {
          break;
        }
      }

      const totalPages = parseInt(listData?.dokumentlista?.['@sidor'] || '1', 10);
      if (page >= totalPages) {
        break;
      }

      page++;
      await delay(REQUEST_DELAY_MS);
    } catch (error) {
      logError(`Failed to fetch page ${page} for ${docType} ${year}`, error as Error);
      break;
    }
  }

  return discovered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ingestion
// ─────────────────────────────────────────────────────────────────────────────

async function ingestRiksdagenPremium(options: CliOptions): Promise<void> {
  log('Riksdagen Preparatory Works Premium Ingestion');
  log('='.repeat(70));
  log(`  Database:   ${DB_PATH}`);
  log(`  Limit:      ${options.limit || 'none'}`);
  log(`  Resume:     ${options.resume}`);
  log(`  Dry run:    ${options.dryRun}`);
  log(`  Type:       ${options.type || 'all'}`);
  log(`  Year:       ${options.year || 'all'}`);
  log(`  Fetch new:  ${options.fetchNew}`);
  log('');

  // Verify database exists
  if (!fs.existsSync(DB_PATH)) {
    logError('Database not found. Run npm run build:db first.');
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Verify premium tables exist
  const hasPaidTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='preparatory_works_full'"
  ).get();

  if (!hasPaidTable) {
    logError('Premium tables not found. Run npm run build:db:paid first.');
    db.close();
    process.exit(1);
  }

  const stats: IngestionStats = {
    total_candidates: 0,
    already_enriched: 0,
    fetched: 0,
    enriched: 0,
    failed: 0,
    skipped_no_text: 0,
    new_documents_created: 0,
  };

  try {
    // -- Phase 1: Enrich existing preparatory_works entries --

    // Build query for prep works needing enrichment
    let query = `
      SELECT pw.id, pw.statute_id, pw.prep_document_id, pw.title, pw.summary
      FROM preparatory_works pw
    `;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (options.resume) {
      conditions.push('pw.id NOT IN (SELECT prep_work_id FROM preparatory_works_full)');
    }

    if (options.type) {
      const typeMap: Record<string, string[]> = {
        'prop': ['bill'],
        'sou': ['sou'],
        'ds': ['ds'],
      };
      const types = typeMap[options.type];
      if (types) {
        conditions.push(`EXISTS (
          SELECT 1 FROM legal_documents ld
          WHERE ld.id = pw.prep_document_id AND ld.type IN (${types.map(() => '?').join(',')})
        )`);
        params.push(...types);
      }
    }

    if (options.year) {
      conditions.push(`pw.prep_document_id LIKE ?`);
      params.push(`${options.year}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY pw.prep_document_id DESC';

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const candidates = db.prepare(query).all(...params) as PrepWorkRow[];
    stats.total_candidates = candidates.length;

    // Count already enriched
    const totalPrepWorks = (db.prepare('SELECT COUNT(*) as c FROM preparatory_works').get() as any).c;
    const enrichedCount = (db.prepare('SELECT COUNT(*) as c FROM preparatory_works_full').get() as any).c;
    stats.already_enriched = enrichedCount;

    log(`  Total preparatory_works:     ${totalPrepWorks}`);
    log(`  Already enriched:            ${enrichedCount}`);
    log(`  Candidates for enrichment:   ${candidates.length}`);
    log('');

    if (options.dryRun) {
      log('DRY RUN - showing first 30 candidates:');
      for (const c of candidates.slice(0, 30)) {
        const docType = classifyDocumentId(c.prep_document_id);
        log(`  [${docType}] ${c.prep_document_id} -> ${c.title || '(no title)'}`);
      }
      if (candidates.length > 30) {
        log(`  ... and ${candidates.length - 30} more`);
      }

      // Show fetch-new preview if requested
      if (options.fetchNew && options.year) {
        log('');
        log(`DRY RUN - discovering new propositions for ${options.year}...`);
        const newDocs = await discoverNewPropositions(
          db, options.year, options.type || 'prop', options.limit || 50,
        );
        log(`  Found ${newDocs.length} new documents not yet in database`);
        for (const d of newDocs.slice(0, 10)) {
          log(`  ${d.rm}:${d.beteckning} - ${d.titel}`);
        }
      }

      db.close();
      return;
    }

    // Prepared statements
    const insertFull = db.prepare(`
      INSERT INTO preparatory_works_full (prep_work_id, full_text, section_summaries)
      VALUES (?, ?, ?)
      ON CONFLICT(prep_work_id) DO UPDATE SET
        full_text = excluded.full_text,
        section_summaries = excluded.section_summaries
    `);

    // Deduplicate: group by prep_document_id to avoid fetching the same document twice
    const byPrepDocId = new Map<string, PrepWorkRow[]>();
    for (const c of candidates) {
      const existing = byPrepDocId.get(c.prep_document_id) || [];
      existing.push(c);
      byPrepDocId.set(c.prep_document_id, existing);
    }

    const uniqueDocs = Array.from(byPrepDocId.entries());
    log(`  Unique documents to fetch: ${uniqueDocs.length}`);
    log('');

    // Process each unique document
    let processed = 0;
    for (let i = 0; i < uniqueDocs.length; i++) {
      const [prepDocId, rows] = uniqueDocs[i];

      if (options.limit && processed >= options.limit) {
        break;
      }

      try {
        // Fetch full text from Riksdagen
        const result = await fetchFullText(prepDocId);
        stats.fetched++;

        if (!result || result.text.length < 50) {
          stats.skipped_no_text++;
          if ((i + 1) % 50 === 0 || i < 5) {
            log(`  [${i + 1}/${uniqueDocs.length}] SKIPPED: ${prepDocId} (no text available)`);
          }
          await delay(REQUEST_DELAY_MS);
          continue;
        }

        // Extract section summaries
        const sectionSummaries = extractSectionSummaries(result.text);

        // Insert for each preparatory_works row referencing this document
        const transaction = db.transaction(() => {
          for (const row of rows) {
            insertFull.run(
              row.id,
              result.text,
              sectionSummaries
            );
          }
        });

        try {
          transaction();
          stats.enriched += rows.length;
        } catch (dbError) {
          stats.failed += rows.length;
          logError(`DB error for ${prepDocId}`, dbError as Error);
          continue;
        }

        processed += rows.length;

        // Progress reporting
        if ((i + 1) % 25 === 0 || i === uniqueDocs.length - 1) {
          const textLen = result.text.length;
          log(
            `  [${i + 1}/${uniqueDocs.length}] ${prepDocId} ` +
            `(${(textLen / 1024).toFixed(1)} KB, ${rows.length} links) ` +
            `[enriched: ${stats.enriched}, failed: ${stats.failed}]`
          );
        }

        // Rate limiting
        await delay(REQUEST_DELAY_MS);

      } catch (error) {
        const err = error as Error;

        if (err.message.includes('404')) {
          stats.skipped_no_text++;
        } else {
          stats.failed += rows.length;
          logError(`Failed to fetch ${prepDocId}`, err);
        }

        continue;
      }
    }

    // -- Phase 2: Discover and fetch new documents (optional) --

    if (options.fetchNew && options.year) {
      log('');
      log(`Discovering new propositions for year ${options.year}...`);

      const remainingLimit = options.limit
        ? Math.max(0, options.limit - processed)
        : 100;

      const types = options.type ? [options.type] : ['prop', 'sou'];

      for (const docType of types) {
        const newDocs = await discoverNewPropositions(
          db, options.year, docType, remainingLimit,
        );

        log(`  Found ${newDocs.length} new ${docType} documents`);

        // Prepared statements for creating new entries
        const insertDoc = db.prepare(`
          INSERT OR IGNORE INTO legal_documents
            (id, type, title, title_en, short_name, status, issued_date, in_force_date, url, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertPrepWork = db.prepare(`
          INSERT OR IGNORE INTO preparatory_works
            (statute_id, prep_document_id, title, summary)
          VALUES (?, ?, ?, ?)
        `);

        for (let j = 0; j < newDocs.length; j++) {
          if (options.limit && processed >= options.limit) {
            break;
          }

          const doc = newDocs[j];

          // Build prep_document_id
          let prepId: string;
          let ldType: 'bill' | 'sou' | 'ds';
          if (docType === 'prop') {
            prepId = `${doc.rm}:${doc.beteckning}`;
            ldType = 'bill';
          } else if (docType === 'sou') {
            prepId = `${options.year}:${doc.beteckning}`;
            ldType = 'sou';
          } else {
            prepId = `${options.year}:${doc.beteckning}`;
            ldType = 'ds';
          }

          try {
            // Fetch full document text
            await delay(REQUEST_DELAY_MS);
            const docUrl = `${RIKSDAGEN_DOC_URL}/${doc.dok_id}.json`;
            const docData = await fetchJsonWithRetry(docUrl) as RiksdagenDocResponse;
            const fullDoc = docData?.dokumentstatus?.dokument;

            let text = fullDoc?.text || '';
            if (!text && fullDoc?.html) {
              text = stripHtml(fullDoc.html);
            }

            if (text.length < 50) {
              stats.skipped_no_text++;
              continue;
            }

            if (text.length > MAX_TEXT_LENGTH) {
              text = text.substring(0, MAX_TEXT_LENGTH) + '\n\n[Text truncated at 2 MB]';
            }

            stats.fetched++;

            const title = normalizeWhitespace(doc.titel || prepId);
            const summary = doc.undertitel ? normalizeWhitespace(doc.undertitel) : null;
            const sectionSummaries = extractSectionSummaries(text);

            // Create entries in a transaction
            const transaction = db.transaction(() => {
              // Create legal_documents entry
              insertDoc.run(
                prepId,
                ldType,
                title,
                null,    // title_en
                null,    // short_name
                'in_force',
                doc.datum || null,
                null,    // in_force_date
                doc.html_url || null,
                summary
              );

              // Create a stub preparatory_works entry (linked to a placeholder statute)
              // Use the first statute in the DB as a placeholder if no specific link exists
              const firstStatute = db.prepare(
                "SELECT id FROM legal_documents WHERE type='statute' LIMIT 1"
              ).get() as { id: string } | undefined;

              if (firstStatute) {
                insertPrepWork.run(
                  firstStatute.id,
                  prepId,
                  title,
                  summary
                );
              }

              // Get the prep_work_id for the full text insert
              const pwRow = db.prepare(
                'SELECT id FROM preparatory_works WHERE prep_document_id = ? LIMIT 1'
              ).get(prepId) as { id: number } | undefined;

              if (pwRow) {
                insertFull.run(pwRow.id, text, sectionSummaries);
                stats.enriched++;
              }

              stats.new_documents_created++;
            });

            transaction();
            processed++;

            if ((j + 1) % 10 === 0) {
              log(`    [${j + 1}/${newDocs.length}] ${prepId}: ${title.substring(0, 60)}`);
            }

          } catch (error) {
            stats.failed++;
            logError(`Failed to fetch new doc ${doc.dok_id}`, error as Error);
          }
        }
      }
    }

    // Optimize database
    log('');
    log('Optimizing database...');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('ANALYZE');

  } finally {
    db.close();
  }

  // Final summary
  log('');
  log('='.repeat(70));
  log('Riksdagen Premium Ingestion Complete');
  log('='.repeat(70));
  log(`  Candidates:           ${stats.total_candidates}`);
  log(`  Already enriched:     ${stats.already_enriched}`);
  log(`  Fetched:              ${stats.fetched}`);
  log(`  Enriched:             ${stats.enriched}`);
  log(`  Failed:               ${stats.failed}`);
  log(`  Skipped (no text):    ${stats.skipped_no_text}`);
  log(`  New docs created:     ${stats.new_documents_created}`);
  log('='.repeat(70));

  const dbSize = fs.statSync(DB_PATH).size;
  log(`  Database size: ${(dbSize / 1024 / 1024).toFixed(1)} MB`);
  log(`  Log file: ${LOG_FILE}`);
  log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const isMainModule = process.argv[1] != null &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMainModule) {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    resume: true,
    dryRun: false,
    fetchNew: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        if (isNaN(options.limit) || options.limit <= 0) {
          console.error('Error: --limit must be a positive number');
          process.exit(1);
        }
        break;
      case '--resume':
        options.resume = true;
        break;
      case '--no-resume':
        options.resume = false;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--type':
        options.type = args[++i];
        if (!['prop', 'sou', 'ds'].includes(options.type)) {
          console.error('Error: --type must be prop, sou, or ds');
          process.exit(1);
        }
        break;
      case '--year':
        options.year = parseInt(args[++i], 10);
        if (isNaN(options.year) || options.year < 1900 || options.year > 2100) {
          console.error('Error: --year must be a valid year');
          process.exit(1);
        }
        break;
      case '--fetch-new':
        options.fetchNew = true;
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        console.error('');
        console.error('Usage: npx tsx scripts/ingest-riksdagen-premium.ts [options]');
        console.error('');
        console.error('Options:');
        console.error('  --limit N      Process only first N preparatory works');
        console.error('  --resume       Skip already enriched (default)');
        console.error('  --no-resume    Re-process all');
        console.error('  --dry-run      Show what would be fetched');
        console.error('  --type TYPE    Filter: prop, sou, ds');
        console.error('  --year YYYY    Filter to specific year');
        console.error('  --fetch-new    Discover and fetch new documents from Riksdagen');
        process.exit(1);
    }
  }

  ingestRiksdagenPremium(options).catch(error => {
    logError('Ingestion failed', error);
    process.exit(1);
  });
}
