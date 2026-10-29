import { describe, expect, it } from 'vitest';
import { normalizeEmail, normalizePhone } from '../../src/domain/identifiers.js';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+2348012345678', '+2348012345678'],
    ['+234 801 234 5678', '+2348012345678'],
    ['+234-801-234-5678', '+2348012345678'],
    ['+233 24 123 4567', '+233241234567'],
    ['+237 6 71 23 45 67', '+237671234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['08012345678', '+234123', 'not-a-phone', '+1 000 000 0000'])('rejects %s', (input) => {
    expect(() => normalizePhone(input)).toThrow(/international format/);
  });
});
