import { describe, expect, it } from 'vitest';
import { hashFingerprint } from '../../src/modules/idempotency/idempotency.service.js';

describe('hashFingerprint', () => {
  it('ignores key order', () => {
    expect(hashFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(
      hashFingerprint({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('changes when any value changes', () => {
    const base = { op: 'DEPOSIT', currency: 'USDx', amount: '10' };
    expect(hashFingerprint(base)).not.toBe(hashFingerprint({ ...base, amount: '10.01' }));
    expect(hashFingerprint(base)).not.toBe(hashFingerprint({ ...base, op: 'SWAP' }));
  });

  it('ignores undefined fields', () => {
    expect(hashFingerprint({ a: 1, b: undefined })).toBe(hashFingerprint({ a: 1 }));
  });
});
