import { describe, it, expect } from 'vitest';
import { parseRiksdagenProvisions } from '../../src/parsers/riksdagen-provision-parser.js';

describe('parseRiksdagenProvisions', () => {
  it('captures title lines that appear before section markers', () => {
    const text = `
1 kap. Inledande bestämmelser

Lagens syfte
1 § Denna lag gäller.
2 § Nästa bestämmelse.
`;

    const result = parseRiksdagenProvisions(text);

    expect(result.provisions).toHaveLength(2);
    expect(result.provisions[0].provision_ref).toBe('1:1');
    expect(result.provisions[0].title).toBe('Lagens syfte');
    expect(result.provisions[0].content).toBe('Denna lag gäller.');
  });

  it('attaches a heading that appears between sections to the next section, not the previous body', () => {
    // Reproduces the SFS 2018:672 ch.17 corpus defect: the Rubrik for §2 sits
    // on its own line after §1's body and before "2 §". It must become §2's
    // title, not bleed into §1's body (which left §2's title null).
    const text = `
17 kap. Likvidation

Föreningsstämmans beslut om likvidation
1 § Föreningsstämman får besluta att föreningen ska gå i likvidation.
Majoritetskrav vid beslut om likvidation
2 § Ett beslut av föreningsstämman om likvidation är giltigt om minst två tredjedelar.
Styrelsens skyldighet att låta stämman pröva frågan
3 § Styrelsen ska genast lägga fram frågan.
`;

    const result = parseRiksdagenProvisions(text);

    expect(result.provisions).toHaveLength(3);
    expect(result.provisions[0].provision_ref).toBe('17:1');
    expect(result.provisions[0].title).toBe('Föreningsstämmans beslut om likvidation');
    // §2's heading must NOT appear in §1's body
    expect(result.provisions[0].content).toBe('Föreningsstämman får besluta att föreningen ska gå i likvidation.');
    expect(result.provisions[1].provision_ref).toBe('17:2');
    expect(result.provisions[1].title).toBe('Majoritetskrav vid beslut om likvidation');
    expect(result.provisions[1].content).toBe('Ett beslut av föreningsstämman om likvidation är giltigt om minst två tredjedelar.');
    expect(result.provisions[2].provision_ref).toBe('17:3');
    expect(result.provisions[2].title).toBe('Styrelsens skyldighet att låta stämman pröva frågan');
  });

  it('captures a heading that wraps across multiple lines (lowercase continuation)', () => {
    // Real SFS 2018:672 17:3 layout: the Rubrik wraps and its 2nd line is
    // lowercase. Both lines must join into the title, not bleed into §2's body.
    const text = `
17 kap. Likvidation

Majoritetskrav vid beslut om likvidation

2 § Ett beslut är giltigt om minst två tredjedelar.

Styrelsens skyldighet att låta stämman pröva frågan om
likvidation

3 § Styrelsen ska genast lägga fram frågan.
`;
    const result = parseRiksdagenProvisions(text);
    const p2 = result.provisions.find((p) => p.provision_ref === '17:2');
    const p3 = result.provisions.find((p) => p.provision_ref === '17:3');
    expect(p2?.content).toBe('Ett beslut är giltigt om minst två tredjedelar.');
    expect(p3?.title).toBe('Styrelsens skyldighet att låta stämman pröva frågan om likvidation');
    expect(p3?.content).toBe('Styrelsen ska genast lägga fram frågan.');
  });

  it('does not treat an inline chapter cross-reference at a wrapped line start as a chapter boundary', () => {
    // Real SFS 2018:672 17:43: the body wraps and a continuation line starts
    // with "18 kap. 14 § ..." — an inline reference, not a new chapter. The
    // body must stay intact and no chapter 18 provision may be created here.
    const text = `
17 kap. Likvidation

Upphörande av likvidation

43 § Om föreningen har gått i likvidation på grund av föreningsstämmans beslut eller, i ett sådant fall som avses i
18 kap. 14 § första stycket, på grund av allmän domstols
beslut, får stämman besluta att likvidationen ska upphöra.
`;
    const result = parseRiksdagenProvisions(text);
    const p43 = result.provisions.find((p) => p.provision_ref === '17:43');
    expect(p43?.title).toBe('Upphörande av likvidation');
    expect(p43?.content).toContain('18 kap. 14 § första stycket');
    expect(p43?.content).toContain('likvidationen ska upphöra');
    expect(result.provisions.some((p) => p.provision_ref.startsWith('18:'))).toBe(false);
  });

  it('does not split on an inline section reference while a heading block is buffered', () => {
    // Real SFS 2018:672 6:36 / 22:32 family: a provision body wraps before an
    // inline "N §" reference whose continuation is lowercase/punctuation. The
    // reference must not start a spurious section, and the wrapped lead-in must
    // not become a title.
    const text = `
6 kap. Föreningsstämma

Ändring av stadgarna

35 § Ett beslut om ändring av stadgarna fattas av föreningsstämman. I de fall som avses i 35 och
36 § i detta kapitel krävs särskild majoritet.

37 § Nästa paragraf.
`;
    const result = parseRiksdagenProvisions(text);
    const refs = result.provisions.map((p) => p.provision_ref);
    expect(refs).toContain('6:35');
    expect(refs).not.toContain('6:36');
    const p35 = result.provisions.find((p) => p.provision_ref === '6:35');
    expect(p35?.title).toBe('Ändring av stadgarna');
    expect(p35?.content).toContain('36 § i detta kapitel krävs särskild majoritet.');
  });

  it('ignores spurious chapter markers when the next section does not restart at 1 §', () => {
    // Blank-delimited form mirrors real Riksdagen text: chapter headings sit in
    // their own block. A chapter marker followed by a non-"1 §" section is still
    // treated as spurious.
    const text = `
2 kap. Om svensk rätts tillämplighet

1 § Första bestämmelsen.

5 § Femte bestämmelsen.

6 kap. Om sexualbrott

6 § Sjätte bestämmelsen i samma kapitel.

7 § Sjunde bestämmelsen i samma kapitel.

3 kap. Om påföljder

1 § Första bestämmelsen i nytt kapitel.
`;

    const result = parseRiksdagenProvisions(text);
    const refs = result.provisions.map(p => p.provision_ref);

    expect(refs).toEqual(['2:1', '2:5', '2:6', '2:7', '3:1']);
    expect(result.diagnostics.ignored_chapter_markers).toBe(1);
  });

  it('does not treat an inline chapter cross-reference mid-paragraph as a chapter boundary', () => {
    // A chapter reference ("4 kap. ...") wrapping mid-body must not flush the
    // provision (which truncated its body) nor start a phantom chapter.
    const text = `
3 kap. Planering

Länsstyrelsens yttrande

16 § Länsstyrelsen ska i yttrandet ange om förslaget tillgodoser ett riksintresse enligt 3 eller
4 kap. miljöbalken eller om det är lämpligt med hänsyn till andra allmänna intressen.

17 § Nästa paragraf.
`;
    const result = parseRiksdagenProvisions(text);
    const p16 = result.provisions.find(p => p.provision_ref === '3:16');
    expect(p16?.title).toBe('Länsstyrelsens yttrande');
    expect(p16?.content).toContain('4 kap. miljöbalken');
    expect(p16?.content).toContain('andra allmänna intressen.');
    expect(result.provisions.some(p => p.provision_ref.startsWith('4:'))).toBe(false);
  });

  it('suppresses inline lower-case section-like references inside a provision', () => {
    const text = `
1 kap. Inledande bestämmelser
1 § Huvudregel.
2 § ska tillämpas i vissa fall.
fortsatt text i samma paragraf.
2 § Den andra paragrafen börjar här.
`;

    const result = parseRiksdagenProvisions(text);

    expect(result.provisions).toHaveLength(2);
    expect(result.provisions[0].provision_ref).toBe('1:1');
    expect(result.provisions[0].content).toContain('2 § ska tillämpas i vissa fall.');
    expect(result.provisions[1].provision_ref).toBe('1:2');
    expect(result.diagnostics.suppressed_section_candidates).toBe(1);
  });

  it('suppresses out-of-order section candidates that re-use an earlier section number', () => {
    const text = `
1 kap. Testkapitel
1 § Första paragraf.
2 § Andra paragraf.
1 § återges här endast som hänvisning.
3 § Tredje paragraf.
`;

    const result = parseRiksdagenProvisions(text);

    expect(result.provisions).toHaveLength(3);
    expect(result.provisions[1].provision_ref).toBe('1:2');
    expect(result.provisions[1].content).toContain('1 § återges här endast som hänvisning.');
    expect(result.provisions[2].provision_ref).toBe('1:3');
    expect(result.diagnostics.suppressed_section_candidates).toBe(1);
  });

  it('suppresses suspicious large section jumps in flat statutes', () => {
    const text = `
1 § Första paragraf.
2 § Andra paragraf.
3 § Vid tillämpning av 5 a, 6 h, 7 a, 11, 15, 22, 25, 26 och
39 § gäller följande särskilda bestämmelser om beräkning av anställningstid.
4 § Fjärde paragraf.
`;

    const result = parseRiksdagenProvisions(text);
    const refs = result.provisions.map(p => p.provision_ref);

    expect(refs).toEqual(['1', '2', '3', '4']);
    expect(result.provisions[2].content).toContain('39 § gäller följande särskilda bestämmelser');
    expect(result.diagnostics.suppressed_section_candidates).toBe(1);
  });
});
