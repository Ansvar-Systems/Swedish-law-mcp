import { describe, it, expect } from 'vitest';
import { buildDisplayRef } from '../../src/utils/provision-display.js';

describe('buildDisplayRef', () => {
  it('formats chapter + section in Swedish convention', () => {
    expect(buildDisplayRef('1', '1')).toBe('1 kap. 1 §');
    expect(buildDisplayRef('3', '12')).toBe('3 kap. 12 §');
  });

  it('omits chapter when absent', () => {
    expect(buildDisplayRef(null, '4')).toBe('4 §');
    expect(buildDisplayRef(undefined, '7')).toBe('7 §');
  });

  it('omits chapter when empty string (DB "" vs NULL drift)', () => {
    expect(buildDisplayRef('', '2')).toBe('2 §');
    expect(buildDisplayRef('   ', '5')).toBe('5 §');
  });

  it('handles whitespace in section', () => {
    expect(buildDisplayRef('1', ' 2 ')).toBe('1 kap. 2 §');
  });

  it('never returns a value containing "undefined" or "null" strings', () => {
    expect(buildDisplayRef(null, '1')).not.toContain('null');
    expect(buildDisplayRef(undefined, '1')).not.toContain('undefined');
  });
});
