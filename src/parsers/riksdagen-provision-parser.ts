/**
 * Parser tuned for Riksdagen statute text dumps.
 *
 * Riksdagen text contains line-break artifacts and occasional table-of-contents
 * fragments. This parser uses conservative chapter activation and section
 * monotonicity checks to avoid mislabeling provisions.
 */

export interface RiksdagenProvision {
  provision_ref: string;
  chapter?: string;
  section: string;
  title?: string;
  content: string;
}

export interface RiksdagenParseDiagnostics {
  ignored_chapter_markers: number;
  suppressed_section_candidates: number;
}

export interface RiksdagenParseResult {
  provisions: RiksdagenProvision[];
  diagnostics: RiksdagenParseDiagnostics;
}

const CHAPTER_PATTERN = /^(\d+)\s*kap\.\s*(.*)$/u;
const SECTION_PATTERN = /^(\d+\s*[a-z]?)\s*§\s*(.*)$/iu;
const LAW_NOTE_PATTERN = /^Lag \(\d{4}:\d+\)\.?$/u;

function normalizeSectionRef(section: string): string {
  return section.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sectionNumber(section: string): number | undefined {
  const match = section.match(/^(\d+)/);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1], 10);
}

function sectionOrdinal(section: string): number | undefined {
  const match = section.match(/^(\d+)(?:\s*([a-z]))?$/i);
  if (!match) {
    return undefined;
  }
  const base = Number.parseInt(match[1], 10);
  const suffix = (match[2] ?? '').toLowerCase();
  if (!suffix) {
    return base * 100;
  }
  const offset = suffix.charCodeAt(0) - 96;
  return base * 100 + Math.max(offset, 0);
}

function isLikelyTitle(line: string): boolean {
  return (
    line.length > 0 &&
    line.length < 100 &&
    /^[A-ZÅÄÖ]/u.test(line) &&
    !/^\d+\s*(kap\.|§)/u.test(line) &&
    !LAW_NOTE_PATTERN.test(line)
  );
}

// Matches a section cross-reference at the very start of a line, e.g.
// "16 § är ..." or "14 § första stycket ..." — used to tell an inline
// reference (which continues a wrapped sentence) apart from a real section
// start. The chapter-marker form "N kap. M § ..." reuses the same idea.
const INLINE_SECTION_REF_AT_START = /^\d+\s*[a-z]?\s*§/iu;

export function parseRiksdagenProvisions(text: string): RiksdagenParseResult {
  const lines = text.split(/\r?\n/);
  const provisions: RiksdagenProvision[] = [];
  const seenProvisionRefs = new Set<string>();
  const lastOrdinalByChapter = new Map<string, number>();
  const diagnostics: RiksdagenParseDiagnostics = {
    ignored_chapter_markers: 0,
    suppressed_section_candidates: 0,
  };

  let currentChapter: string | undefined;
  let pendingChapter: string | undefined;

  let currentSection: string | undefined;
  let currentTitle: string | undefined;
  // Heading lines are buffered until we know whether they introduce the next
  // section (a real "N §" follows → they become its title) or are just a
  // title-shaped wrapped body line (something else follows → flush to body).
  // Riksdagen headings can span multiple wrapped lines, hence an array.
  let pendingHeadingLines: string[] = [];
  const currentContent: string[] = [];

  const takePendingHeading = (): string | undefined => {
    if (pendingHeadingLines.length === 0) return undefined;
    const joined = pendingHeadingLines.join(' ').replace(/\s+/g, ' ').trim();
    pendingHeadingLines = [];
    return joined || undefined;
  };

  // The buffered lines were not a heading (no section followed). Move them to
  // the current section's body if one is active; otherwise drop (preamble/TOC).
  const flushPendingHeadingToBody = (): void => {
    if (pendingHeadingLines.length === 0) return;
    if (currentSection) {
      for (const h of pendingHeadingLines) currentContent.push(h);
    }
    pendingHeadingLines = [];
  };

  function flushCurrentSection(): void {
    if (!currentSection || currentContent.length === 0) {
      currentSection = undefined;
      currentTitle = undefined;
      currentContent.length = 0;
      return;
    }

    const section = normalizeSectionRef(currentSection);
    const provisionRef = currentChapter ? `${currentChapter}:${section}` : section;

    provisions.push({
      provision_ref: provisionRef,
      chapter: currentChapter,
      section,
      title: currentTitle,
      content: currentContent.join(' ').replace(/\s+/g, ' ').trim(),
    });

    seenProvisionRefs.add(provisionRef);

    if (currentChapter) {
      const ordinal = sectionOrdinal(section);
      if (ordinal !== undefined) {
        lastOrdinalByChapter.set(currentChapter, ordinal);
      }
    }

    currentSection = undefined;
    currentTitle = undefined;
    currentContent.length = 0;
  }

  let sawBlank = true;
  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li]!;
    const line = rawLine.trim();
    if (!line) {
      sawBlank = true;
      continue;
    }
    // Whether a blank line immediately preceded THIS line — the delimiter that
    // separates Riksdagen heading blocks and body paragraphs from each other.
    const precededByBlank = sawBlank;
    sawBlank = false;

    const chapterMatch = line.match(CHAPTER_PATTERN);
    if (chapterMatch) {
      // Distinguish a real chapter boundary from an inline chapter
      // cross-reference that merely starts a wrapped body line. Two tells:
      //   1. "18 kap. 14 § ..." — a chapter ref carrying a section ref; a real
      //      chapter marker is followed by a heading/title, never a "<n> §".
      //   2. A chapter marker mid-paragraph (no blank line before it while a
      //      provision body is open) — e.g. "... enligt 3 eller\n4 kap. ...".
      //      Real chapter headings sit in their own blank-delimited block.
      const inlineChapterRef =
        INLINE_SECTION_REF_AT_START.test(chapterMatch[2].trim()) ||
        (!precededByBlank && currentSection !== undefined && currentContent.length > 0);
      if (inlineChapterRef) {
        flushPendingHeadingToBody();
        if (currentSection) {
          currentContent.push(line);
        }
        continue;
      }
      flushCurrentSection();
      pendingChapter = chapterMatch[1];
      pendingHeadingLines = [];
      continue;
    }

    const sectionMatch = line.match(SECTION_PATTERN);
    if (sectionMatch) {
      const normalizedSection = normalizeSectionRef(sectionMatch[1]);
      const sectionNum = sectionNumber(normalizedSection);
      const remainder = sectionMatch[2].trim();

      let chapterForSection = currentChapter;
      let chapterActivated = false;

      if (pendingChapter) {
        if (!currentChapter || sectionNum === 1) {
          chapterForSection = pendingChapter;
          chapterActivated = chapterForSection !== currentChapter;
        } else {
          diagnostics.ignored_chapter_markers++;
        }
        pendingChapter = undefined;
      }

      const provisionRef = chapterForSection
        ? `${chapterForSection}:${normalizedSection}`
        : normalizedSection;

      const candidateOrdinal = sectionOrdinal(normalizedSection);
      const currentOrdinal = currentSection ? sectionOrdinal(currentSection) : undefined;
      const lastOrdinal = chapterForSection ? lastOrdinalByChapter.get(chapterForSection) : undefined;
      const candidateNumber = sectionNumber(normalizedSection);
      const currentNumber = currentSection ? sectionNumber(currentSection) : undefined;

      const isDuplicateRef = seenProvisionRefs.has(provisionRef);
      const isOutOfOrderFromCurrent = (
        currentOrdinal !== undefined &&
        candidateOrdinal !== undefined &&
        candidateOrdinal <= currentOrdinal
      );
      const isOutOfOrderFromHistory = (
        !chapterActivated &&
        lastOrdinal !== undefined &&
        candidateOrdinal !== undefined &&
        candidateOrdinal <= lastOrdinal
      );
      // An inline "N §" cross-reference continuing a wrapped sentence, rather
      // than a real section start. We're mid-provision (body already collected,
      // OR a heading block is buffered for the upcoming section), and the text
      // after the "§" does not begin like a fresh provision (real provisions
      // open with an uppercase sentence; a continuation opens lowercase or with
      // punctuation such as "i detta kapitel", ", om åtgärden", "första stycket").
      const isLikelyInlineReference = (
        !chapterActivated &&
        currentSection !== undefined &&
        (currentContent.length > 0 || pendingHeadingLines.length > 0) &&
        remainder.length > 0 &&
        !/^[A-ZÅÄÖ"«»]/u.test(remainder)
      );
      const isSuspiciousFlatJump = (
        !chapterActivated &&
        !chapterForSection &&
        currentNumber !== undefined &&
        candidateNumber !== undefined &&
        candidateNumber - currentNumber >= 8 &&
        currentContent.length > 0
      );

      if (
        isDuplicateRef ||
        isOutOfOrderFromCurrent ||
        isOutOfOrderFromHistory ||
        isLikelyInlineReference ||
        isSuspiciousFlatJump
      ) {
        diagnostics.suppressed_section_candidates++;
        // This "N §" is an inline reference, not a real section start, so any
        // buffered heading-shaped line before it was body, not a heading.
        flushPendingHeadingToBody();
        if (currentSection) {
          currentContent.push(line);
        }
        continue;
      }

      // A real section start: the buffered heading (possibly multi-line) is its
      // title.
      const titleForSection = takePendingHeading();
      flushCurrentSection();

      currentChapter = chapterForSection;
      currentSection = normalizedSection;
      currentTitle = titleForSection;

      if (remainder) {
        currentContent.push(remainder);
      }
      continue;
    }

    // Heading handling. Riksdagen Rubriks are title-shaped noun phrases that
    // may wrap across several lines; they sit in their own blank-delimited
    // block immediately before the section they introduce. We buffer a heading
    // block and defer the heading-vs-body decision until we see what follows:
    // a real "N §" makes the buffer that section's title; anything else flushes
    // it back into the current section's body (so text is never lost).
    const isHeadingStart = isLikelyTitle(line) && !/[.:;,]$/u.test(line);
    if (isHeadingStart) {
      // A new heading block after a blank: the previously buffered block was a
      // separate (e.g. higher-level) rubric, not this section's heading — flush
      // it rather than merge the two.
      if (precededByBlank && pendingHeadingLines.length > 0) {
        flushPendingHeadingToBody();
      }
      pendingHeadingLines.push(line);
      continue;
    }

    // A wrapped continuation of the current heading block (e.g. a lowercase
    // second line such as "likvidation"): no blank separates it from the
    // buffered heading, so keep it with the heading. If it closes a sentence it
    // was actually body — flush the whole block to content.
    if (pendingHeadingLines.length > 0 && !precededByBlank) {
      pendingHeadingLines.push(line);
      if (/[.:;]$/u.test(line)) {
        flushPendingHeadingToBody();
      }
      continue;
    }

    // Otherwise the buffered block (if any) was body, not a heading.
    flushPendingHeadingToBody();

    if (currentSection) {
      currentContent.push(line);
    }
  }

  flushPendingHeadingToBody();
  flushCurrentSection();

  return { provisions, diagnostics };
}
