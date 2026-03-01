#!/usr/bin/env tsx
/**
 * Case Law Premium Enrichment Script
 *
 * Fetches full case text from lagen.nu for each case_law entry missing
 * from case_law_full. Populates the premium tier with full-text opinions,
 * headnotes, and dissenting opinions.
 *
 * Prerequisites:
 *   1. npm run build:db           -- base database with schema
 *   2. npm run build:db:paid      -- premium tables created
 *   3. npm run ingest:cases:full-archive  -- case_law table populated
 *
 * Pipeline:
 *   case_law table -> lagen.nu HTML -> parse full text -> case_law_full
 *
 * Usage:
 *   npx tsx scripts/ingest-case-law-premium.ts [options]
 *
 * Options:
 *   --limit N     Process only first N cases
 *   --resume      Skip cases already in case_law_full (default: true)
 *   --dry-run     Show what would be fetched without making changes
 *   --court CODE  Filter to specific court (e.g., HFD, NJA, AD)
 *
 * Examples:
 *   npx tsx scripts/ingest-case-law-premium.ts --limit 50
 *   npx tsx scripts/ingest-case-law-premium.ts --court HFD
 *   npx tsx scripts/ingest-case-law-premium.ts --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import Database from 'better-sqlite3';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DB_PATH = path.resolve(__dirname, '../data/database.db');
const LOG_DIR = path.resolve(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'ingest-case-law-premium.log');

const LAGEN_NU_BASE = 'https://lagen.nu/dom';
const REQUEST_DELAY_MS = 800;  // Be polite to lagen.nu
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 2000;
const USER_AGENT = 'Swedish-Law-MCP/1.2.0 (https://github.com/Ansvar-Systems/swedish-law-mcp; premium-enrichment)';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CaseLawRow {
  id: number;
  document_id: string;
  court: string;
  case_number: string | null;
  decision_date: string | null;
  summary: string | null;
  keywords: string | null;
}

interface ParsedCaseText {
  full_text: string;
  headnotes: string | null;
  dissenting_opinions: string | null;
}

interface EnrichmentStats {
  total_candidates: number;
  already_enriched: number;
  fetched: number;
  enriched: number;
  failed: number;
  skipped_empty: number;
}

interface CliOptions {
  limit?: number;
  resume: boolean;
  dryRun: boolean;
  court?: string;
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

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string> {
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
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      if (response.status === 404) {
        throw new Error(`HTTP 404: NOT FOUND`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
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
// URL construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a case_law document_id to a lagen.nu HTML URL.
 *
 * Document ID formats observed:
 *   "HFD-2023:1"      -> https://lagen.nu/dom/hfd/2023:1
 *   "NJA-2020:45"     -> https://lagen.nu/dom/nja/2020:45
 *   "NJA_2020_s45"    -> https://lagen.nu/dom/nja/2020s45
 *   "AD-2023:57"      -> https://lagen.nu/dom/ad/2023:57
 *   "MÖD-2023:12"     -> https://lagen.nu/dom/mod/2023:12
 */
function documentIdToUrl(documentId: string): string {
  // Handle underscore format: "NJA_2020_s45" -> "nja/2020s45"
  const underscoreMatch = documentId.match(/^([A-ZÅÄÖ]+)_(\d{4})_s(\d+)$/i);
  if (underscoreMatch) {
    const court = underscoreMatch[1].toLowerCase()
      .replace('möd', 'mod')
      .replace('mmd', 'mod')
      .replace('pmöd', 'pmod');
    return `${LAGEN_NU_BASE}/${court}/${underscoreMatch[2]}s${underscoreMatch[3]}`;
  }

  // Handle dash format: "HFD-2023:1" -> "hfd/2023:1"
  const dashMatch = documentId.match(/^([A-ZÅÄÖ]+)-(\d{4}:\d+)$/i);
  if (dashMatch) {
    const court = dashMatch[1].toLowerCase()
      .replace('möd', 'mod')
      .replace('mmd', 'mod')
      .replace('pmöd', 'pmod');
    return `${LAGEN_NU_BASE}/${court}/${dashMatch[2]}`;
  }

  // Fallback: lowercase and replace dashes
  const normalized = documentId.toLowerCase()
    .replace('möd', 'mod')
    .replace('mmd', 'mod')
    .replace('pmöd', 'pmod')
    .replace('-', '/');
  return `${LAGEN_NU_BASE}/${normalized}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse lagen.nu case decision HTML page to extract full text, headnotes,
 * and dissenting opinions.
 *
 * Lagen.nu case pages typically have:
 * - A header section with metadata (court, case number, date)
 * - The "referat" (case summary/headnotes)
 * - The full decision text in the main content area
 * - Dissenting opinions marked with "Skiljaktig mening" or "Reservation"
 */
function parseCaseHtml(html: string): ParsedCaseText | null {
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Remove navigation, sidebars, and script elements
    const removeSelectors = [
      'nav', 'header', 'footer', 'script', 'style', 'noscript',
      '.sidebar', '.navigation', '.menu', '.breadcrumb', '.toc',
      '#sidebar', '#navigation', '#menu',
    ];
    for (const selector of removeSelectors) {
      const elements = doc.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        el.remove();
      }
    }

    // Look for the main content area
    // Lagen.nu uses various content containers
    const contentSelectors = [
      'article', '.content', '.document-content', '.case-content',
      'main', '#content', '#main', '.body', '.text',
    ];

    let contentEl: Element | null = null;
    for (const selector of contentSelectors) {
      contentEl = doc.querySelector(selector);
      if (contentEl && contentEl.textContent && contentEl.textContent.trim().length > 100) {
        break;
      }
      contentEl = null;
    }

    // Fallback to body if no content container found
    if (!contentEl) {
      contentEl = doc.body;
    }

    if (!contentEl || !contentEl.textContent) {
      return null;
    }

    // Extract full text
    const fullText = extractCleanText(contentEl);
    if (fullText.length < 50) {
      return null;  // Too short to be a real case
    }

    // Extract headnotes (referat/rubrik)
    let headnotes: string | null = null;
    const headnoteSelectors = [
      '.referatrubrik', '.headnote', '.rubrik', '.summary',
      'h2 + p', // First paragraph after heading
    ];
    for (const selector of headnoteSelectors) {
      const el = contentEl.querySelector(selector);
      if (el && el.textContent && el.textContent.trim().length > 20) {
        headnotes = el.textContent.trim();
        break;
      }
    }

    // If no structured headnotes found, try to extract from text
    if (!headnotes) {
      headnotes = extractHeadnotesFromText(fullText);
    }

    // Extract dissenting opinions
    const dissentingOpinions = extractDissentingOpinions(fullText);

    return {
      full_text: fullText,
      headnotes,
      dissenting_opinions: dissentingOpinions,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Extract clean text from an HTML element, preserving paragraph breaks.
 */
function extractCleanText(element: Element): string {
  const parts: string[] = [];

  function walk(node: Node): void {
    if (node.nodeType === 3) {
      // Text node
      const text = node.textContent?.trim();
      if (text) {
        parts.push(text);
      }
    } else if (node.nodeType === 1) {
      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      // Add paragraph breaks for block elements
      if (['p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'].includes(tag)) {
        parts.push('\n\n');
      }

      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }

      if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'].includes(tag)) {
        parts.push('\n\n');
      }
    }
  }

  walk(element);

  return parts.join(' ')
    .replace(/\n\s*\n/g, '\n\n')   // Collapse multiple newlines
    .replace(/ +/g, ' ')            // Collapse multiple spaces
    .replace(/\n +/g, '\n')         // Remove leading spaces on lines
    .trim();
}

/**
 * Extract headnotes from the beginning of full text.
 * Swedish case law typically starts with a summary/rubrik before the full decision.
 */
function extractHeadnotesFromText(fullText: string): string | null {
  // Look for common headnote markers in Swedish case law
  const markers = [
    'DOMSLUT',
    'YRKANDEN',
    'BAKGRUND',
    'SKÄLEN FÖR AVGÖRANDET',
    'SKÄL',
    'DOMSKÄL',
    'HÖGSTA DOMSTOLEN',
    'HÖGSTA FÖRVALTNINGSDOMSTOLEN',
    'Högsta domstolens avgörande',
    'Högsta förvaltningsdomstolens avgörande',
  ];

  for (const marker of markers) {
    const markerIndex = fullText.indexOf(marker);
    if (markerIndex > 50 && markerIndex < 2000) {
      // Everything before the first major section marker is likely the headnote
      const headnote = fullText.substring(0, markerIndex).trim();
      if (headnote.length >= 30) {
        return headnote;
      }
    }
  }

  return null;
}

/**
 * Extract dissenting opinions from case text.
 * Swedish: "Skiljaktig mening", "Reservation", "Skiljaktiga meningar"
 */
function extractDissentingOpinions(fullText: string): string | null {
  const markers = [
    'Skiljaktig mening',
    'Skiljaktiga meningar',
    'Reservation av',
    'SKILJAKTIG MENING',
    'SKILJAKTIGA MENINGAR',
  ];

  for (const marker of markers) {
    const index = fullText.indexOf(marker);
    if (index >= 0) {
      // Extract from the marker to the end (or next major section)
      const dissent = fullText.substring(index).trim();
      if (dissent.length >= 20) {
        return dissent;
      }
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main enrichment
// ─────────────────────────────────────────────────────────────────────────────

async function enrichCaseLaw(options: CliOptions): Promise<void> {
  log('Case Law Premium Enrichment');
  log('='.repeat(70));
  log(`  Database:  ${DB_PATH}`);
  log(`  Limit:     ${options.limit || 'none'}`);
  log(`  Resume:    ${options.resume}`);
  log(`  Dry run:   ${options.dryRun}`);
  if (options.court) {
    log(`  Court:     ${options.court}`);
  }
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
    "SELECT name FROM sqlite_master WHERE type='table' AND name='case_law_full'"
  ).get();

  if (!hasPaidTable) {
    logError('Premium tables not found. Run npm run build:db:paid first.');
    db.close();
    process.exit(1);
  }

  const stats: EnrichmentStats = {
    total_candidates: 0,
    already_enriched: 0,
    fetched: 0,
    enriched: 0,
    failed: 0,
    skipped_empty: 0,
  };

  try {
    // Build query for cases needing enrichment
    let query = `
      SELECT cl.id, cl.document_id, cl.court, cl.case_number,
             cl.decision_date, cl.summary, cl.keywords
      FROM case_law cl
    `;
    const params: string[] = [];

    if (options.resume) {
      query += `
        WHERE cl.id NOT IN (SELECT case_law_id FROM case_law_full)
      `;
    }

    if (options.court) {
      query += options.resume ? ' AND ' : ' WHERE ';
      query += `cl.court LIKE ?`;
      params.push(`%${options.court}%`);
    }

    query += ' ORDER BY cl.decision_date DESC';

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const candidates = db.prepare(query).all(...params) as CaseLawRow[];
    stats.total_candidates = candidates.length;

    // Count already enriched
    const totalCases = (db.prepare('SELECT COUNT(*) as c FROM case_law').get() as any).c;
    const enrichedCount = (db.prepare('SELECT COUNT(*) as c FROM case_law_full').get() as any).c;
    stats.already_enriched = enrichedCount;

    log(`  Total case_law entries:     ${totalCases}`);
    log(`  Already enriched:           ${enrichedCount}`);
    log(`  Candidates for enrichment:  ${candidates.length}`);
    log('');

    if (candidates.length === 0) {
      log('No cases to enrich. Run ingest:cases:full-archive first to populate case_law.');
      db.close();
      return;
    }

    if (options.dryRun) {
      log('DRY RUN - showing first 20 candidates:');
      for (const c of candidates.slice(0, 20)) {
        const url = documentIdToUrl(c.document_id);
        log(`  ${c.document_id} | ${c.court} | ${c.decision_date} -> ${url}`);
      }
      if (candidates.length > 20) {
        log(`  ... and ${candidates.length - 20} more`);
      }
      db.close();
      return;
    }

    // Prepared insert statement
    const insertFull = db.prepare(`
      INSERT INTO case_law_full (case_law_id, full_text, headnotes, dissenting_opinions)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(case_law_id) DO UPDATE SET
        full_text = excluded.full_text,
        headnotes = excluded.headnotes,
        dissenting_opinions = excluded.dissenting_opinions
    `);

    // Process each case
    for (let i = 0; i < candidates.length; i++) {
      const caseRow = candidates[i];
      const url = documentIdToUrl(caseRow.document_id);

      try {
        // Fetch HTML
        const html = await fetchWithRetry(url);
        stats.fetched++;

        // Parse full text
        const parsed = parseCaseHtml(html);

        if (!parsed || parsed.full_text.length < 50) {
          stats.skipped_empty++;
          if ((i + 1) % 25 === 0 || i < 5) {
            log(`  [${i + 1}/${candidates.length}] SKIPPED: ${caseRow.document_id} (empty/too short)`);
          }
          continue;
        }

        // Insert into case_law_full
        const transaction = db.transaction(() => {
          insertFull.run(
            caseRow.id,
            parsed.full_text,
            parsed.headnotes,
            parsed.dissenting_opinions
          );
        });

        try {
          transaction();
          stats.enriched++;
        } catch (dbError) {
          stats.failed++;
          logError(`DB error for ${caseRow.document_id}`, dbError as Error);
          continue;
        }

        // Progress reporting
        if ((i + 1) % 25 === 0 || i === candidates.length - 1) {
          const textLen = parsed.full_text.length;
          log(
            `  [${i + 1}/${candidates.length}] ${caseRow.document_id} ` +
            `(${(textLen / 1024).toFixed(1)} KB) ` +
            `[enriched: ${stats.enriched}, failed: ${stats.failed}, skipped: ${stats.skipped_empty}]`
          );
        }

        // Rate limiting
        if (i < candidates.length - 1) {
          await delay(REQUEST_DELAY_MS);
        }

      } catch (error) {
        const err = error as Error;

        if (err.message.includes('404')) {
          stats.skipped_empty++;
          if ((i + 1) % 50 === 0 || i < 5) {
            log(`  [${i + 1}/${candidates.length}] NOT FOUND: ${caseRow.document_id}`);
          }
        } else {
          stats.failed++;
          logError(`Failed to enrich ${caseRow.document_id}`, err);
        }

        continue;
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
  log('Case Law Premium Enrichment Complete');
  log('='.repeat(70));
  log(`  Candidates:        ${stats.total_candidates}`);
  log(`  Already enriched:  ${stats.already_enriched}`);
  log(`  Fetched:           ${stats.fetched}`);
  log(`  Enriched:          ${stats.enriched}`);
  log(`  Failed:            ${stats.failed}`);
  log(`  Skipped (empty):   ${stats.skipped_empty}`);
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
      case '--court':
        options.court = args[++i];
        if (!options.court) {
          console.error('Error: --court requires a value (e.g., HFD, NJA, AD)');
          process.exit(1);
        }
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        console.error('');
        console.error('Usage: npx tsx scripts/ingest-case-law-premium.ts [options]');
        console.error('');
        console.error('Options:');
        console.error('  --limit N     Process only first N cases');
        console.error('  --resume      Skip cases already in case_law_full (default)');
        console.error('  --no-resume   Re-process all cases');
        console.error('  --dry-run     Show what would be fetched');
        console.error('  --court CODE  Filter to specific court (e.g., HFD, NJA, AD)');
        process.exit(1);
    }
  }

  enrichCaseLaw(options).catch(error => {
    logError('Enrichment failed', error);
    process.exit(1);
  });
}
